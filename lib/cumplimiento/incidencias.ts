import {
  ACCIONES_QUE_OCULTAN,
  TEMAS,
  type Gravedad,
  type Incidencia,
  type IncidenciaNueva,
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

const TXT_PELIGROSAS =
  /(peligros|hazmat|bateria|litio|hoja de datos de seguridad|inflamable|dangerous goods|\badr\b)/
const TXT_NORMATIVA =
  /(gpsr|seguridad (de los |del )?productos?|normativ|reglament|cumplimiento|certificad|conformidad|marcado ce|persona responsable|operador economico|etiqueta energetica|raee|rohs|\breach\b|residuos|envases|compliance|regulat)/
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
  const txt = plano(i.mensaje)
  const tieneAttr = (trozos: readonly string[]) => trozos.some((t) => attr.includes(t))
  const tieneFicha = (palabras: ReadonlySet<string>) => [...palabras].some((p) => fichas.has(p))
  const cat = (c: string) => i.categorias.includes(c)

  // Amazon marca así lo que exige una aprobación previa: es lo que más manda
  if (cat('QUALIFICATION_REQUIRED')) return 'aprobacion'

  if (tieneAttr(ATTR_PELIGROSAS)) return 'peligrosas'
  if (tieneAttr(ATTR_NORMATIVA) || tieneFicha(TOKEN_NORMATIVA)) return 'normativa'
  if (TXT_PELIGROSAS.test(txt)) return 'peligrosas'
  if (TXT_NORMATIVA.test(txt)) return 'normativa'
  if (TXT_APROBACION.test(txt)) return 'aprobacion'

  if (attr.includes('brand') || /\bmarca\b/.test(txt)) return 'marca'
  if (tieneAttr(ATTR_IDENTIFICADORES) || tieneFicha(TOKEN_IDENTIFICADORES) || TXT_IDENTIFICADORES.test(txt)) {
    return 'identificadores'
  }

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

/** Cuánto pesa una incidencia para ordenar: ocultar > error > aviso > info */
function pesoParaOrdenar(i: IncidenciaNueva, ahora: Date): number {
  return (ocultaAhora(i, ahora) ? 10 : 0) + PESO_GRAVEDAD[i.gravedad]
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
 * Las `info` no cuentan como errores ni como avisos: son sugerencias de Amazon, y
 * contarlas llenaría de «listings con problemas» una cuenta sana.
 */
export function resumir(incidencias: readonly IncidenciaNueva[], ahora: Date): ResumenCumplimiento {
  const orden = ordenarIncidencias(incidencias, ahora)
  const relevantes = orden.filter((i) => i.gravedad !== 'info' || ocultaAhora(i, ahora))

  let errores = 0
  let avisos = 0
  let suprimido = false
  for (const i of incidencias) {
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

/** Desde cuándo está el problema más antiguo de la lista, o null si no hay */
export function problemaMasAntiguo(incidencias: readonly Incidencia[]): string | null {
  let mejor: string | null = null
  for (const i of incidencias) {
    if (i.gravedad === 'info') continue
    if (mejor === null || Date.parse(i.desde) < Date.parse(mejor)) mejor = i.desde
  }
  return mejor
}
