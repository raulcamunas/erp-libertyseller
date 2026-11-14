import {
  ACCIONES_QUE_OCULTAN,
  TEMAS,
  type Gravedad,
  type Incidencia,
  type IncidenciaNueva,
  type Nivel,
  type ResumenCumplimiento,
  type Tema,
} from './tipos'

/**
 * LAS INCIDENCIAS DE UN LISTING: LIMPIARLAS, CLASIFICARLAS Y RESUMIRLAS.
 * PURO: sin red, sin base de datos y sin reloj (la hora llega siempre de fuera).
 * Se prueba entero en incidencias.prueba.ts.
 *
 *
 * ============ LO QUE LLEGA DE AMAZON ============
 *
 * `searchListingsItems` con `includedData=issues` devuelve, por listing, una lista
 * de incidencias con esta forma (todos los campos son opcionales para quien los
 * lee, y por eso aquí NO se fía de ninguno):
 *
 *   {
 *     code: '90220',
 *     message: 'El atributo «Fabricante» es obligatorio...',   // en el idioma de issueLocale
 *     severity: 'ERROR' | 'WARNING' | 'INFO',
 *     attributeNames: ['manufacturer'],
 *     categories: ['MISSING_ATTRIBUTE'],
 *     enforcements: {
 *       actions: [{ action: 'SEARCH_SUPPRESSED' }],
 *       exemption: { status: 'EXEMPT_UNTIL_EXPIRY_DATE', expiryDate: '2026-12-01T00:00:00Z' }
 *     }
 *   }
 *
 * Todo lo que entra por aquí es dato de un tercero. Un campo que no es del tipo
 * esperado se descarta; no se lanza, porque una incidencia rara no puede tumbar
 * la revisión de los otros 19 listings de la misma llamada.
 *
 *
 * ============ EL TEMA ES UNA HEURÍSTICA ============
 *
 * Amazon NO dice «esto es de normativa». Dice un código, un mensaje y, a veces,
 * unas categorías muy generales (falta un atributo, imagen inválida...). El tema
 * se deduce mirando los nombres de los atributos implicados y el texto del
 * mensaje. Sirve para agrupar y para filtrar, NUNCA para decidir nada: la
 * pantalla enseña siempre el mensaje original de Amazon al lado. Un tema mal
 * puesto se ve y se corrige aquí, en una regla; un mensaje que desapareciera
 * detrás de una etiqueta no se vería nunca.
 */

/* ------------------------------------------------------------------ */
/* Texto                                                               */
/* ------------------------------------------------------------------ */

/** Minúsculas y sin acentos: «Batería» y «bateria» son la misma palabra */
function plano(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function texto(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

/** Una lista de textos. Solo textos: un número en una lista de atributos o de categorías es un dato roto */
function listaDeTextos(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    const t = typeof x === 'string' ? x.trim() : ''
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Tema                                                                */
/* ------------------------------------------------------------------ */

// ---- por el NOMBRE DE LOS ATRIBUTOS (lo más fiable: son nombres técnicos fijos) ----

/** Trozos de nombre de atributo de mercancías peligrosas y baterías */
const ATTR_PELIGROSAS = [
  'dg_hz',
  'hazmat',
  'dangerous',
  'safety_data_sheet',
  'ghs_',
  'lithium',
  'batter',
  'flash_point',
  'unna',
  'cas_number',
]

/** Trozos de nombre de atributo de normativa y seguridad de producto (GPSR y afines) */
const ATTR_NORMATIVA = [
  'gpsr',
  'dsa_',
  'responsible_party',
  'manufacturer_contact',
  'compliance',
  'safety_attestation',
  'eu_responsible',
  'certif',
  'conformity',
  'regulat',
  'cpsia',
  'energy_label',
  'eprel',
  'energy_effic',
]

/** Siglas que solo valen como palabra entera del nombre (`ce` no puede ser «price») */
const TOKEN_NORMATIVA = new Set(['ce', 'rohs', 'weee', 'reach', 'epr'])
const TOKEN_IDENTIFICADORES = new Set(['gtin', 'ean', 'upc', 'isbn'])
const ATTR_IDENTIFICADORES = [
  'externally_assigned_product_identifier',
  'merchant_suggested_asin',
  'product_identifier',
]

// ---- por el TEXTO del mensaje (en español: se pide con issueLocale es_ES) ----

/** Cuánto del mensaje se mira para deducir el tema. Ver clasificarTema */
const VENTANA_TEXTO = 220

const TXT_PELIGROSAS =
  /(peligros|hazmat|bateria|litio|hoja de datos de seguridad|inflamable|dangerous goods|\badr\b)/
/**
 * Las cuatro últimas, medidas el 14 nov 2026: la Directiva de equipos radioeléctricos (100525, 100791: «indica si
 * incluye cargador»), la información alimentaria FIC (100793), la documentación de seguridad de juguetes (100390:
 * «debes facilitar documentación relativa a…») y el documento de cumplimiento rechazado (100540). Son obligaciones
 * legales con plazo y salían como «datos» u «otros».
 */
const TXT_NORMATIVA =
  /(gpsr|seguridad (de los |del )?productos?|normativ|reglament|cumplimiento|certificad|conformidad|marcado ce|persona responsable|operador economico|etiqueta energetica|raee|rohs|\breach\b|residuos|envases|compliance|regulat|directiva|informacion alimentaria|documentacion relativa|rechazado el documento)/
/**
 * «La traducción automática falló de ES a [IE]…» (100325 y 100326, 28 listings el 14 nov 2026): Amazon no ha podido
 * copiar la ficha a otro país. Dice «normas de cumplimiento transfronterizo» y por esa palabra salía como normativa,
 * cuando lo único que pasa es que la ficha no existe en ese otro país. Va ANTES que la normativa.
 */
const TXT_TRADUCCION = /^la traduccion automatica fallo/
/**
 * Lo que es normativa SIN DISCUSIÓN, aunque Amazon lo marque como «necesita aprobación».
 *
 * Medido en la cuenta real (16 oct 2026): Amazon pone QUALIFICATION_REQUIRED a los
 * bloqueos por la responsabilidad ampliada del productor (RAP) —«debes obtener la
 * información de una RER para cumplir la normativa…»— y eran 1.514 listings que
 * salían como «aprobación», que es lo que se pide para una marca, cuando lo que
 * falta es un registro de normativa. Esto va ANTES de mirar la categoría.
 */
const TXT_NORMATIVA_FUERTE =
  /(gpsr|reglamento general de seguridad|responsabilidad ampliada|\brap\b|persona responsable|raee|rohs|\breach\b)/
const TXT_APROBACION =
  /(aprobacion|autorizacion|restring|cualificacion|no tienes permiso|no tiene permiso|approval)/
const TXT_IDENTIFICADORES =
  /(\bgtin\b|\bean\b|\bupc\b|codigo de barras|identificador(es)? (externo|de producto)|exencion de (gtin|identificador))/

/**
 * El tema de UNA incidencia.
 *
 * El orden de las reglas es el orden de la lista: lo más específico primero. Una
 * incidencia de baterías que además dice «normativa» en su texto es de
 * mercancías peligrosas, no de normativa en general.
 */
export function clasificarTema(i: {
  codigo?: string
  mensaje: string
  atributos: readonly string[]
  categorias: readonly string[]
}): Tema {
  const attr = i.atributos.join(' ').toLowerCase()
  const fichas = new Set(i.atributos.flatMap((a) => a.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)))
  // SOLO EL PRINCIPIO DEL MENSAJE. Los de Amazon son largos y acaban con consejos que
  // nombran de todo: uno de códigos de barras termina pidiendo «tu certificado GS1» y
  // «el nombre de tu marca», y salía como normativa o como marca. Lo que dice de qué
  // va está en la primera o la segunda frase.
  const txt = plano(i.mensaje).slice(0, VENTANA_TEXTO)
  const tieneAttr = (trozos: readonly string[]) => trozos.some((t) => attr.includes(t))
  const tieneFicha = (palabras: ReadonlySet<string>) => [...palabras].some((p) => fichas.has(p))
  const cat = (c: string) => i.categorias.includes(c)

  if (TXT_TRADUCCION.test(txt)) return 'otros'

  // La normativa inequívoca gana incluso a «necesita aprobación» (ver TXT_NORMATIVA_FUERTE)
  if (TXT_NORMATIVA_FUERTE.test(txt)) return 'normativa'

  // Amazon marca así lo que exige una aprobación previa: es lo que más manda
  if (cat('QUALIFICATION_REQUIRED')) return 'aprobacion'

  if (tieneAttr(ATTR_PELIGROSAS)) return 'peligrosas'
  if (tieneAttr(ATTR_NORMATIVA) || tieneFicha(TOKEN_NORMATIVA)) return 'normativa'
  if (TXT_PELIGROSAS.test(txt)) return 'peligrosas'
  if (TXT_NORMATIVA.test(txt)) return 'normativa'
  if (TXT_APROBACION.test(txt)) return 'aprobacion'

  if (attr.includes('brand')) return 'marca'
  // Los códigos de producto van ANTES que la palabra «marca» del texto: «el ID de producto
  // (ASIN, UPC, EAN…) no coincide con los registros de nuestra marca» va de códigos de barras
  if (tieneAttr(ATTR_IDENTIFICADORES) || tieneFicha(TOKEN_IDENTIFICADORES) || TXT_IDENTIFICADORES.test(txt)) {
    return 'identificadores'
  }
  if (/\bmarca\b/.test(txt)) return 'marca'

  if (cat('INVALID_IMAGE') || cat('MISSING_IMAGE')) return 'imagenes'
  if (cat('INVALID_PRICE') || cat('MISSING_PRICE')) return 'precio'
  if (cat('DUPLICATE')) return 'duplicado'
  if (cat('MISSING_ATTRIBUTE') || cat('INVALID_ATTRIBUTE')) return 'datos'

  if (/imagen/.test(txt)) return 'imagenes'
  if (/\bprecio\b/.test(txt)) return 'precio'
  if (/duplicad/.test(txt)) return 'duplicado'
  if (i.atributos.length > 0) return 'datos'
  return 'otros'
}

/* ------------------------------------------------------------------ */
/* Normalizar lo que llega de Amazon                                   */
/* ------------------------------------------------------------------ */

function gravedadDe(v: unknown): Gravedad {
  const s = texto(v).toUpperCase()
  if (s === 'ERROR') return 'error'
  if (s === 'INFO') return 'info'
  // WARNING y también cualquier valor que no conozcamos: antes enseñar un aviso
  // de más que esconder una gravedad nueva que Amazon se saque de la manga.
  return 'aviso'
}

/** Orden de gravedad para elegir cuál se queda cuando dos son la misma */
const PESO_GRAVEDAD: Record<Gravedad, number> = { error: 2, aviso: 1, info: 0 }

/**
 * La huella de una incidencia: lo que la hace «la misma» entre una revisión y la
 * siguiente. Código + atributos, y NO el mensaje: el mensaje puede llevar el
 * nombre del producto o un valor, y cambiaría sin que el problema fuese otro.
 * Sin código, el principio del mensaje.
 */
export function huella(i: { codigo: string; atributos: readonly string[]; mensaje: string }): string {
  const base = i.codigo || plano(i.mensaje).slice(0, 60)
  return `${base}|${[...i.atributos].sort().join(',')}`
}

/**
 * Convierte la lista cruda de Amazon en incidencias limpias.
 *
 * Dos filas con la misma huella son UNA: Amazon repite a veces la misma causa por
 * cada marketplace de la petición. Se queda la más grave y se juntan sus acciones.
 */
/**
 * LO QUE AMAZON DICE Y NO ES UN PROBLEMA DE LA FICHA: no entra en el ERP.
 *
 * 100907 sobre `compliance_media` («Es necesario actualizar tus permisos de acceso. Comprueba la configuración del navegador…»): Amazon no
 * puede abrir el documento de cumplimiento que la ficha ya tiene, incluso cuando el enlace apunta a su propio almacén de documentos. Sale en
 * muchas fichas que están bien y se venden, y contarlo como error escondía los de verdad (Raúl, 11 nov 2026). Lo que sí se sigue viendo es
 * cuando FALTA la información de seguridad o la persona responsable: esas llegan con otros códigos y mensajes.
 */
export function esRuidoDeAmazon(i: { codigo: string; atributos: readonly string[]; mensaje?: string }): boolean {
  if (i.codigo === '100907' && i.atributos.length > 0 && i.atributos.every((a) => a === 'compliance_media')) return true
  // 300403 cuando el archivo está en el almacén de documentos DE AMAZON (`dew-document-storage`): es el mismo caso que el 100907
  // (Amazon no consigue abrir el documento de cumplimiento que él mismo guarda). Medido el 14 nov 2026: los 47 que había eran
  // todos así. Si el enlace es del vendedor (su web, su servidor), sí se guarda: ese enlace roto es suyo y lo puede arreglar.
  if (i.codigo === '300403' && /dew-document-storage/i.test(i.mensaje ?? '')) return true
  return false
}

/* ------------------------------------------------------------------ */
/* Importancia: lo que hay que mirar y lo que no                       */
/* ------------------------------------------------------------------ */

/**
 * LO QUE AMAZON DICE Y NO CAMBIA NADA EN LA VENTA: se guarda (está en la ficha, y quien quiera lo ve con «ver también
 * avisos menores»), pero NO cuenta como error ni como aviso, no da tema al listing y no sale por defecto en ninguna pantalla.
 *
 * Por qué hace falta (medido el 14 nov 2026 en las 11 cuentas, 33.831 listings con alguna incidencia): de las 55.461
 * incidencias, 16.202 (el 29 %) eran de estos códigos, y ninguna oculta el listing ni le pone plazo. Con ellas dentro,
 * «necesitan atención» decía 20.753 listings (4.462 con stock) y pasa a 16.420 (3.850); «solo avisos» baja de 13.078 a
 * 9.195, y 8.216 listings que solo tenían esto pasan a contar como limpios.
 *
 * El criterio, código a código (las cifras son de ese día):
 */
const MENORES: Readonly<Record<string, string>> = {
  // ---- recomendaciones y publicidad de Amazon ----
  /** «Faltan algunos atributos clave… La falta de estos atributos NO impide que tu producto aparezca». Lo dice Amazon. 8.560 listings */
  '18448': 'recomendacion',
  /** «Previsión de ventas de 204 EUR si pasas a FBA»: es publicidad de Logística de Amazon, no un problema. 481 */
  '101265': 'recomendacion',
  /** «No puedes crear nuevas relaciones de variante para esta marca. Puedes añadir ofertas…»: informativo. 955, ninguno con stock */
  '8040': 'recomendacion',
  /** «Tu producto se ha identificado como con restricción de edad»: solo informa (el que bloquea llega con otro código). 5, sin stock */
  '101232': 'recomendacion',
  /** «Para beneficiarte del Registro de marcas, proporciona product_type»: sugerencia. 1 */
  '8907': 'recomendacion',

  // ---- envíos rechazados: Amazon se queda con lo que ya tenía y la ficha sigue igual (a la venta si lo estaba) ----
  /** «Los datos del listing son diferentes de los del catálogo» (casi siempre la marca vacía): se descarta lo enviado. 2.808; 209 de 227 con stock se pueden comprar */
  '8541': 'envio-rechazado',
  /** «No puedes cambiar el nombre de la marca en este ASIN». 521 */
  '5995': 'envio-rechazado',
  /** «Intentas contribuir a un ASIN genérico restringido…». 16 */
  '5885': 'envio-rechazado',
  '5886': 'envio-rechazado',
  /** Valores distintos entre países para el ASIN recomendado o el ID externo. 8 */
  '101077': 'envio-rechazado',
  '101078': 'envio-rechazado',
  /** Valores de atributos que Amazon no acepta (fuera de lista, mínimo/máximo, demasiadas veces, edades, pesos, HTML…): no se guardan y la ficha conserva los de antes. 2.213 entre todos */
  '90244': 'envio-rechazado',
  '100095': 'envio-rechazado',
  '90004205': 'envio-rechazado',
  '99016': 'envio-rechazado',
  '99022': 'envio-rechazado',
  '100339': 'envio-rechazado',
  '90114': 'envio-rechazado',
  '90147': 'envio-rechazado',
  '90226': 'envio-rechazado',
  '90197': 'envio-rechazado',
  '8603': 'envio-rechazado',
  '101067': 'envio-rechazado',
  /** El título del último envío repite palabras o lleva una frase prohibida: se queda el título de antes. 144, ninguno oculto */
  '100470': 'envio-rechazado',
  '100473': 'envio-rechazado',
  /** «Un nombre de 75 caracteres o menos para usar los puntos destacados»: solo pierde ese adorno. 1 */
  '100476': 'envio-rechazado',

  // ---- fallos de Amazon o del envío, no de la ficha ----
  /** «Se ha producido un error interno. Vuelve a enviar el feed». 40 */
  '500211': 'error-de-amazon',
  '50027': 'error-de-amazon',
  '4000000': 'error-de-amazon',
  /** La traducción automática a otro país ha fallado: la ficha de aquí no cambia (ver TXT_TRADUCCION). 28 */
  '100325': 'error-de-amazon',
  '100326': 'error-de-amazon',
  /** Una imagen del último envío no se pudo descargar (URL caída, 404, formato, tamaño): la ficha conserva las que tenía. Si falta la principal llega el 18320, que sí oculta. 320 */
  '20000': 'imagen-no-descargada',
  '300404': 'imagen-no-descargada',
  '300060': 'imagen-no-descargada',
  '20015': 'imagen-no-descargada',
  '20005': 'imagen-no-descargada',
  '20009': 'imagen-no-descargada',
}

/** El tipo de aviso menor de un código, o null si no es de los menores conocidos */
export function motivoMenor(codigo: string): string | null {
  return MENORES[codigo] ?? null
}

/** Frases con las que Amazon dice él mismo que el aviso no tiene efecto (por si llegan con un código nuevo) */
const TXT_SIN_EFECTO = /(no impide que tu producto aparezca|no impide que el producto aparezca)/

/**
 * ¿Es un aviso menor? Nunca si oculta el listing AHORA: lo que oculta se ve siempre, tenga el código que tenga.
 * Las `info` (sugerencias) son menores por definición.
 */
export function esMenor(i: Pick<IncidenciaNueva, 'codigo' | 'gravedad' | 'mensaje' | 'acciones' | 'exencion'>, ahora: Date): boolean {
  if (ocultaAhora(i, ahora)) return false
  if (i.gravedad === 'info') return true
  if (MENORES[i.codigo]) return true
  return TXT_SIN_EFECTO.test(plano(i.mensaje).slice(0, VENTANA_TEXTO))
}

/**
 * LA IMPORTANCIA DE UNA INCIDENCIA, de más a menos:
 *
 *   bloquea    Amazon la tiene oculta o fuera de la venta ahora mismo.
 *   normativa  obligación legal (GPSR, RAP, etiqueta energética, juguetes…): aún se vende, pero Amazon avisa de que la retirará.
 *   afecta     se vende, pero peor: imágenes que no enseña, una talla fuera de su familia, un texto retirado, un dato de baterías…
 *   menor      no cambia nada en la venta (ver MENORES).
 */
export function nivelDe(i: Pick<IncidenciaNueva, 'codigo' | 'gravedad' | 'mensaje' | 'acciones' | 'exencion' | 'tema'>, ahora: Date): Nivel {
  if (ocultaAhora(i, ahora)) return 'bloquea'
  if (esMenor(i, ahora)) return 'menor'
  if (i.tema === 'normativa') return 'normativa'
  return 'afecta'
}

export function normalizarIncidencias(crudas: unknown): IncidenciaNueva[] {
  if (!Array.isArray(crudas)) return []

  const porHuella = new Map<string, IncidenciaNueva>()
  for (const c of crudas) {
    if (!c || typeof c !== 'object') continue
    const r = c as Record<string, unknown>

    const codigo = texto(r.code)
    const mensaje = texto(r.message)
    if (!codigo && !mensaje) continue

    const atributos = listaDeTextos(r.attributeNames)
    // El campo antiguo, en singular: por si Amazon lo vuelve a mandar
    const unico = texto(r.attributeName)
    if (unico && !atributos.includes(unico)) atributos.push(unico)
    atributos.sort()

    if (esRuidoDeAmazon({ codigo, atributos, mensaje })) continue

    const categorias = listaDeTextos(r.categories)

    let acciones: string[] = []
    let exencion: IncidenciaNueva['exencion'] = null
    const ef = r.enforcements
    if (ef && typeof ef === 'object') {
      const e = ef as Record<string, unknown>
      if (Array.isArray(e.actions)) {
        acciones = listaDeTextos(
          e.actions.map((a) =>
            a && typeof a === 'object' ? (a as Record<string, unknown>).action : a
          )
        )
      }
      const ex = e.exemption
      if (ex && typeof ex === 'object') {
        const x = ex as Record<string, unknown>
        const estado = texto(x.status)
        if (estado) exencion = { estado, caduca: texto(x.expiryDate) || null }
      }
    }

    const nueva: IncidenciaNueva = {
      codigo,
      gravedad: gravedadDe(r.severity),
      mensaje,
      atributos,
      categorias,
      acciones,
      exencion,
      tema: clasificarTema({ codigo, mensaje, atributos, categorias }),
    }

    const clave = huella(nueva)
    const previa = porHuella.get(clave)
    if (!previa) {
      porHuella.set(clave, nueva)
      continue
    }
    const mejor = PESO_GRAVEDAD[nueva.gravedad] > PESO_GRAVEDAD[previa.gravedad] ? nueva : previa
    porHuella.set(clave, {
      ...mejor,
      acciones: [...new Set([...previa.acciones, ...nueva.acciones])],
      exencion: mejor.exencion ?? previa.exencion ?? nueva.exencion,
    })
  }
  return [...porHuella.values()]
}

/* ------------------------------------------------------------------ */
/* Desde cuándo                                                        */
/* ------------------------------------------------------------------ */

/**
 * Pone a cada incidencia el «desde cuándo está abierta».
 *
 * Si la misma (por huella) ya estaba en la revisión anterior, conserva su fecha;
 * si es nueva, lleva la de esta revisión. Es lo único que permite decir «lleva 40
 * días así» en vez de «hay un problema», que es lo que decide a quién se llama.
 *
 * Una incidencia que desaparece y vuelve más tarde cuenta como nueva: entre medias
 * estuvo arreglada, y eso es lo que hay que poder ver.
 */
export function conservarDesde(
  nuevas: readonly IncidenciaNueva[],
  previas: readonly Incidencia[],
  ahoraIso: string
): Incidencia[] {
  const antes = new Map(previas.map((p) => [huella(p), p.desde]))
  return nuevas.map((n) => ({ ...n, desde: antes.get(huella(n)) ?? ahoraIso }))
}

/* ------------------------------------------------------------------ */
/* Resumir                                                             */
/* ------------------------------------------------------------------ */

/**
 * ¿Tiene Amazon concedido un plazo de gracia VIGENTE para esta incidencia?
 *
 * `EXEMPT` es una exención sin fecha. `EXEMPT_UNTIL_EXPIRY_DATE` solo cuenta si la
 * fecha todavía no ha pasado: una exención caducada ya no protege a nadie, y
 * contarla como vigente escondería justo el listing que va a ocultarse mañana.
 */
export function estaExenta(ex: Incidencia['exencion'] | IncidenciaNueva['exencion'], ahora: Date): boolean {
  if (!ex) return false
  if (ex.estado === 'EXEMPT') return true
  if (ex.estado === 'EXEMPT_UNTIL_EXPIRY_DATE') {
    const t = ex.caduca ? Date.parse(ex.caduca) : NaN
    return Number.isFinite(t) && t > ahora.getTime()
  }
  return false
}

/** ¿Esta incidencia, ahora mismo, saca el listing de la venta o de las búsquedas? */
export function ocultaAhora(i: Pick<Incidencia, 'acciones' | 'exencion'>, ahora: Date): boolean {
  return i.acciones.some((a) => ACCIONES_QUE_OCULTAN.has(a)) && !estaExenta(i.exencion, ahora)
}

/** Cuánto pesa una incidencia para ordenar: ocultar > error > aviso > info, y los avisos menores al final de todo */
function pesoParaOrdenar(i: IncidenciaNueva, ahora: Date): number {
  return (ocultaAhora(i, ahora) ? 10 : 0) + (esMenor(i, ahora) ? -5 : 0) + PESO_GRAVEDAD[i.gravedad]
}

/** Las incidencias de la más grave a la menos; a igual gravedad, por tema */
export function ordenarIncidencias<T extends IncidenciaNueva>(lista: readonly T[], ahora: Date): T[] {
  return [...lista].sort(
    (a, b) =>
      pesoParaOrdenar(b, ahora) - pesoParaOrdenar(a, ahora) ||
      TEMAS.indexOf(a.tema) - TEMAS.indexOf(b.tema)
  )
}

/**
 * El resumen de un listing: lo que se guarda en columnas para poder filtrar y
 * ordenar sin abrir el JSON.
 *
 * LOS AVISOS MENORES NO CUENTAN (ver MENORES y esMenor), y las `info` tampoco: ni como
 * errores, ni como avisos, ni para el tema. Contarlas llenaba de «listings con problemas»
 * una cuenta sana y escondía los de verdad. Siguen dentro de `incidencias`.
 */
export function resumir(incidencias: readonly IncidenciaNueva[], ahora: Date): ResumenCumplimiento {
  const orden = ordenarIncidencias(incidencias, ahora)
  const relevantes = orden.filter((i) => !esMenor(i, ahora))

  let errores = 0
  let avisos = 0
  let suprimido = false
  for (const i of relevantes) {
    if (i.gravedad === 'error') errores += 1
    else if (i.gravedad === 'aviso') avisos += 1
    if (ocultaAhora(i, ahora)) suprimido = true
  }

  const temas: Tema[] = []
  for (const i of relevantes) if (!temas.includes(i.tema)) temas.push(i.tema)

  return { errores, avisos, suprimido, tema: temas[0] ?? null, temas }
}

/** ¿Hay que mirar este listing? Errores u ocultación. Los avisos solos no urgen */
export function necesitaAtencion(r: Pick<ResumenCumplimiento, 'errores' | 'suprimido'>): boolean {
  return r.errores > 0 || r.suprimido
}

/**
 * Desde cuándo está el problema más antiguo de la lista, o null si no hay. Sin los avisos
 * menores: «lleva 90 días» tiene que hablar de algo que importe, no de una recomendación.
 * Sin `ahora`, solo se quitan las `info` (como antes).
 */
export function problemaMasAntiguo(incidencias: readonly Incidencia[], ahora?: Date): string | null {
  let mejor: string | null = null
  for (const i of incidencias) {
    if (i.gravedad === 'info') continue
    if (ahora && esMenor(i, ahora)) continue
    if (mejor === null || Date.parse(i.desde) < Date.parse(mejor)) mejor = i.desde
  }
  return mejor
}
