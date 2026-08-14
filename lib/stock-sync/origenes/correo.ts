/**
 * ORIGEN «CORREO»: el cliente manda el volcado como adjunto.
 *
 * Se mira un buzón NUESTRO, se busca el último correo que encaje con el filtro
 * (remitente, asunto y nombre del adjunto) y se coge su adjunto. Solo lectura:
 * no se marca como leído, no se responde, no se mueve y no se borra nada.
 *
 *
 * ============ ESTE ES EL MÁS FRÁGIL DE LOS TRES. A PROPÓSITO, POR ESCRITO ====
 *
 * Drive y SFTP dependen de que un fichero esté en un sitio. Esto depende además
 * de que nadie del equipo toque el correo. Los tres fallos que va a tener y que
 * conviene saber ANTES de ofrecérselo a un cliente:
 *
 *   1. El cliente cambia el asunto («Stock diario» → «STOCK DIARIO 2026») y
 *      deja de encajar. No da error: simplemente no encuentra nada nuevo, que
 *      es el peor tipo de fallo. Por eso `comprobar` enseña los correos que HAY
 *      y cuál se cogería, y por eso el filtro por asunto es opcional.
 *   2. Alguien borra o archiva el correo y el fichero desaparece. En un SFTP
 *      el fichero sigue ahí.
 *   3. El correo llega tarde, o se queda en spam. `newer_than` acota la
 *      búsqueda para no procesar el volcado de la semana pasada creyendo que es
 *      el de hoy — que sería mandar a Amazon un stock viejo.
 *
 * Si un cliente puede dar SFTP o Drive, es mejor. Esto es la última opción.
 *
 *
 * ============ POR QUÉ GMAIL Y NO IMAP ============
 *
 * Porque la delegación de dominio YA ESTÁ MONTADA para el calendario, con la
 * misma cuenta de servicio. Con IMAP habría que: añadir un paquete
 * (`imapflow` o `node-imap`), pedirle al equipo una contraseña de aplicación,
 * guardarla cifrada y mantenerla viva cuando caduque. Con Gmail no hay paquete,
 * no hay contraseña que guardar —así que la decisión de las credenciales
 * cifradas ni siquiera aplica aquí— y el filtro que pide el encargo (remitente,
 * asunto y nombre del adjunto) lo resuelve la sintaxis `q` de Gmail de una vez.
 *
 * SI EL BUZÓN NO ES DE NUESTRO WORKSPACE, esto no sirve y hay que ir a IMAP. El
 * mensaje de error de abajo lo dice, en vez de dejar un 404 pelado.
 *
 *
 * ============ LO QUE FALTA PARA QUE ESTO FUNCIONE, Y NO ES CÓDIGO ============
 *
 * Igual que el explorador de Drive: hay que añadir el scope a la delegación de
 * dominio en el panel de Workspace. Hoy solo está el de calendario.
 *
 *     Admin › Seguridad › Control de acceso y datos › Controles de API
 *       › Delegación en todo el dominio › (Client ID de la cuenta de servicio)
 *       › añadir  https://www.googleapis.com/auth/gmail.readonly
 *
 * Sin ese paso Google contesta `unauthorized_client` SIN mencionar el scope, y
 * es imposible de adivinar. Por eso el error de aquí abajo lo escribe entero.
 *
 * ESTE CONECTOR NO SE HA PODIDO PROBAR CONTRA UN BUZÓN REAL: la delegación no
 * tiene todavía ese permiso. Está escrito entero y traduce sus fallos, pero
 * hasta que alguien lo pruebe con un correo de verdad hay que tratarlo como lo
 * que es: código que no ha visto nunca un dato real.
 */

import { auth as googleAuth } from '@googleapis/calendar'
import { ESPERA_DESCARGA_MS } from '@/lib/tiempos-espera'
import {
  OrigenError,
  encajaPatron,
  extensionValida,
  textoConfig,
  type CandidatoOrigen,
  type ConectorOrigen,
  type ContextoOrigen,
  type EstadoOrigen,
  type FicheroOrigen,
  type ListadoOrigen,
} from './tipos'

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

/**
 * Cuántos correos se miran como mucho.
 *
 * Cada uno cuesta una llamada para leer sus cabeceras, así que esto es
 * directamente el tiempo que tarda el explorador. Con 15 sobra: si el que busca
 * el filtro no está entre los 15 más recientes que ya encajan con la consulta de
 * Gmail, el problema es el filtro y no el número.
 */
const MAX_CORREOS = 15

/** Días hacia atrás por omisión. Ver el fallo 3 de la cabecera */
const DIAS_POR_OMISION = 7

export const conectorCorreo: ConectorOrigen = {
  id: 'correo',
  etiqueta: 'Correo',
  descripcion:
    'El cliente manda el volcado como adjunto a un buzón nuestro y el ERP se queda con el último que encaje con el filtro. Es el origen más frágil de los tres: depende de que nadie cambie el asunto ni borre el correo.',
  construido: true,
  explorador: 'mensajes',

  campos: [
    {
      clave: 'buzon',
      etiqueta: 'Buzón',
      tipo: 'texto',
      requerido: false,
      ayuda:
        'La dirección de NUESTRO Workspace a la que el cliente manda el fichero. Vacío = la cuenta que el ERP ya usa para el calendario. Tiene que ser una cuenta del dominio: un Gmail personal o un buzón de otro proveedor no se puede leer por aquí.',
      ejemplo: 'stock-cliente@libertyseller.com',
    },
    {
      clave: 'remitente',
      etiqueta: 'Remitente esperado',
      tipo: 'texto',
      requerido: false,
      ayuda:
        'Solo se aceptan adjuntos de esta dirección. Dejarlo vacío significa procesar el adjunto de cualquiera que escriba a ese buzón, que es exactamente como se cuela un fichero que no es del cliente y acaba publicándose en Amazon.',
      ejemplo: 'erp@cliente.com',
    },
    {
      clave: 'asunto',
      etiqueta: 'Asunto contiene',
      tipo: 'texto',
      requerido: false,
      ayuda:
        'Para distinguir el correo del volcado del resto. Es «contiene», no exacto: si el cliente le pega la fecha detrás, sigue encajando.',
      ejemplo: 'Stock diario',
    },
    {
      clave: 'adjunto',
      etiqueta: 'Patrón del adjunto',
      tipo: 'texto',
      requerido: false,
      ayuda:
        'El nombre del fichero adjunto. Vale * y ?; no distingue mayúsculas. Es lo que salva el caso de un correo con la firma en imagen y el volcado: sin esto se cogería lo primero que pareciera un fichero.',
      ejemplo: 'STOCK_*.csv',
    },
    {
      clave: 'adjunto_ean',
      etiqueta: 'Patrón del segundo adjunto (códigos de barras)',
      tipo: 'texto',
      requerido: false,
      ayuda:
        'Solo si el cliente manda LOS DOS ficheros EN EL MISMO CORREO. Con esto, el de códigos de barras se saca de ese mismo mensaje y no hace falta un segundo perfil. Vacío = el fichero de EAN se busca donde diga su propio perfil, o no se usa.',
      ejemplo: 'ARTICULOS_EAN*',
    },
    {
      clave: 'dias',
      etiqueta: 'Días hacia atrás',
      tipo: 'texto',
      requerido: false,
      ayuda: `Vacío = ${DIAS_POR_OMISION}. Acota la búsqueda para no coger el volcado de la semana pasada creyendo que es el de hoy: mandar a Amazon un stock viejo es peor que no mandar nada.`,
      ejemplo: '7',
    },
  ],

  /* ---------------- ¿Llegamos? ---------------- */

  async comprobar(ctx: ContextoOrigen): Promise<EstadoOrigen> {
    const cfg = leerConfig(ctx)

    if (!configurado()) {
      return {
        ok: false,
        mensaje:
          'Falta configurar la cuenta de servicio de Google en el servidor (GOOGLE_SA_CLIENT_EMAIL, ' +
          'GOOGLE_SA_PRIVATE_KEY y GOOGLE_IMPERSONATE_SUBJECT). Sin ella no se puede leer ningún buzón.',
        candidatos: [],
      }
    }

    try {
      const correos = await buscar(cfg)
      const { elegido, candidatos } = clasificar(correos, cfg)

      if (correos.length === 0) {
        return {
          ok: false,
          mensaje:
            `Se entra en el buzón ${cfg.buzon} sin problemas, pero en los últimos ${cfg.dias} días no hay ` +
            'ningún correo con adjunto que encaje con el filtro' +
            (cfg.remitente ? ` de «${cfg.remitente}»` : '') +
            (cfg.asunto ? ` con «${cfg.asunto}» en el asunto` : '') +
            '. Prueba a quitar filtros para ver qué llega de verdad.',
          candidatos: [],
        }
      }
      if (!elegido) {
        return {
          ok: false,
          mensaje:
            `Hay ${correos.length} ${correos.length === 1 ? 'correo' : 'correos'} que encajan, pero ninguno ` +
            'trae un adjunto aprovechable' +
            (cfg.adjunto ? ` que encaje con «${cfg.adjunto}»` : ' (.xlsx, .xls o .csv)') +
            '. Abajo está la lista con el motivo de cada uno.',
          candidatos,
        }
      }

      return {
        ok: true,
        mensaje:
          `Se lee el buzón ${cfg.buzon}. Se procesaría «${elegido.adjunto.nombre}», del correo ` +
          `«${elegido.correo.asunto}» que mandó ${elegido.correo.de} el ${fechaLegible(elegido.correo.fecha)}.`,
        candidatos,
      }
    } catch (error) {
      return { ok: false, mensaje: traducir(error, cfg).message, candidatos: [] }
    }
  },

  /* ---------------- Traer el fichero ---------------- */

  async traer(ctx: ContextoOrigen): Promise<FicheroOrigen> {
    const cfg = leerConfig(ctx)

    if (!configurado()) {
      throw new OrigenError(
        `El perfil «${ctx.perfil}» lee de un buzón y el servidor no tiene configurada la cuenta de ` +
          'servicio de Google (GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY y GOOGLE_IMPERSONATE_SUBJECT).'
      )
    }

    let elegido: Elegido | null
    try {
      const correos = await buscar(cfg)
      elegido = clasificar(correos, cfg).elegido
    } catch (error) {
      throw traducir(error, cfg)
    }

    if (!elegido) {
      throw new OrigenError(
        `En el buzón ${cfg.buzon} no hay ningún correo de los últimos ${cfg.dias} días con un adjunto ` +
          'que encaje con el filtro de este perfil' +
          (cfg.remitente ? ` (remitente «${cfg.remitente}»)` : '') +
          (cfg.asunto ? ` (asunto con «${cfg.asunto}»)` : '') +
          (cfg.adjunto ? ` (adjunto «${cfg.adjunto}»)` : '') +
          '. O el cliente todavía no lo ha mandado hoy, o ha cambiado el asunto y el filtro ya no le pilla.'
      )
    }

    if (elegido.adjunto.tamano > ctx.maxBytes) {
      throw new OrigenError(
        `El adjunto «${elegido.adjunto.nombre}» ocupa ${mb(elegido.adjunto.tamano)} MB y el máximo son ${mb(ctx.maxBytes)} MB.`
      )
    }

    try {
      const bytes = await bajarAdjunto(cfg, elegido.correo.id, elegido.adjunto.id)

      if (bytes.byteLength === 0) {
        throw new OrigenError(`El adjunto «${elegido.adjunto.nombre}» ha llegado vacío (0 bytes).`)
      }
      if (bytes.byteLength > ctx.maxBytes) {
        throw new OrigenError(
          `El adjunto «${elegido.adjunto.nombre}» ocupa ${mb(bytes.byteLength)} MB y el máximo son ${mb(ctx.maxBytes)} MB.`
        )
      }

      return {
        nombre: elegido.adjunto.nombre,
        bytes,
        idExterno: elegido.correo.id,
        /**
         * La huella es el ID DEL CORREO, que es único y no se repite nunca.
         *
         * Es el mejor caso de los tres orígenes: dos correos distintos son dos
         * volcados distintos aunque traigan el mismo fichero con el mismo
         * nombre, y el mismo correo leído dos veces da la misma huella, así que
         * no se reprocesa. Ni Drive ni SFTP tienen algo tan limpio.
         */
        huella: `gmail:${elegido.correo.id}`,
        modificadoAt: elegido.correo.fecha,
        tamano: bytes.byteLength,
      }
    } catch (error) {
      throw traducir(error, cfg)
    }
  },

  /* ---------------- Ver qué hay ---------------- */

  /**
   * No hay carpetas que navegar en un buzón: lo que se enseña es LA LISTA DE
   * CORREOS que encajan con el filtro de ahora mismo, con su adjunto y con cuál
   * se cogería. Es la misma pregunta que en Drive y en SFTP —«¿qué se va a
   * procesar mañana?»— con otra forma de contestarla.
   *
   * `ruta` no se usa y por eso no se declara: aquí no se baja a ningún sitio.
   */
  async explorar(ctx: ContextoOrigen): Promise<ListadoOrigen> {
    const cfg = leerConfig(ctx)

    if (!configurado()) {
      throw new OrigenError(
        'Falta configurar la cuenta de servicio de Google en el servidor (GOOGLE_SA_CLIENT_EMAIL, ' +
          'GOOGLE_SA_PRIVATE_KEY y GOOGLE_IMPERSONATE_SUBJECT).'
      )
    }

    try {
      const correos = await buscar(cfg)
      const { candidatos } = clasificar(correos, cfg)

      return {
        ruta: cfg.buzon,
        migas: [{ nombre: cfg.buzon, ruta: cfg.buzon }],
        carpetas: [],
        ficheros: candidatos,
        // No hay nada que «elegir»: el buzón y el filtro son la configuración.
        seleccionable: false,
        aviso:
          correos.length === 0
            ? `En los últimos ${cfg.dias} días no ha llegado ningún correo con adjunto que encaje. ` +
              'Quita filtros para ver qué llega de verdad y ajústalos con eso delante.'
            : null,
      }
    } catch (error) {
      throw traducir(error, cfg)
    }
  },
}

/* ------------------------------------------------------------------ */
/* Configuración                                                       */
/* ------------------------------------------------------------------ */

interface ConfigCorreo {
  buzon: string
  remitente: string
  asunto: string
  adjunto: string
  /** Patrón del SEGUNDO adjunto: el de códigos de barras. '' = no hay */
  adjuntoEan: string
  dias: number
}

function leerConfig(ctx: ContextoOrigen): ConfigCorreo {
  const dias = Number.parseInt(textoConfig(ctx.config, 'dias'), 10)

  return {
    // Vacío = la cuenta que el ERP ya suplanta para el calendario. Es la que
    // seguro que está autorizada en la delegación.
    buzon: textoConfig(ctx.config, 'buzon') || (process.env.GOOGLE_IMPERSONATE_SUBJECT ?? ''),
    remitente: textoConfig(ctx.config, 'remitente'),
    asunto: textoConfig(ctx.config, 'asunto'),
    adjunto: textoConfig(ctx.config, 'adjunto'),
    adjuntoEan: textoConfig(ctx.config, 'adjunto_ean'),
    dias: Number.isFinite(dias) && dias > 0 && dias <= 90 ? dias : DIAS_POR_OMISION,
  }
}

function configurado(): boolean {
  return Boolean(
    process.env.GOOGLE_SA_CLIENT_EMAIL &&
      process.env.GOOGLE_SA_PRIVATE_KEY &&
      process.env.GOOGLE_IMPERSONATE_SUBJECT
  )
}

/* ------------------------------------------------------------------ */
/* Token                                                               */
/* ------------------------------------------------------------------ */

/**
 * Un cliente JWT por buzón.
 *
 * El buzón es el `subject` de la suplantación: para leer stock@… hay que actuar
 * EN NOMBRE de stock@…, no de la cuenta del calendario. Se memorizan porque
 * google-auth-library cachea el access token dentro de la instancia.
 */
const clientes = new Map<string, InstanceType<typeof googleAuth.JWT>>()

async function token(buzon: string): Promise<string> {
  let cliente = clientes.get(buzon)

  if (!cliente) {
    const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL
    // Sin deshacer los \n escapados, la firma del JWT falla con un error de
    // OpenSSL que no menciona la causa.
    const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, '\n')
    if (!clientEmail || !privateKey) {
      throw new OrigenError('Falta la cuenta de servicio de Google en el servidor.')
    }

    cliente = new googleAuth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: [GMAIL_SCOPE],
      subject: buzon,
    })
    clientes.set(buzon, cliente)
  }

  const { token: valor } = await cliente.getAccessToken()
  if (!valor) {
    throw new OrigenError(
      'Google no ha devuelto ningún token para leer el buzón. Comprueba que GOOGLE_SA_PRIVATE_KEY ' +
        'es la clave completa y no está recortada.'
    )
  }
  return valor
}

async function pedir(cfg: ConfigCorreo, ruta: string): Promise<Response> {
  const res = await fetch(`${GMAIL}${ruta}`, {
    headers: { Authorization: `Bearer ${await token(cfg.buzon)}` },
    cache: 'no-store',
    // Tope holgado: por aquí pasan tanto los listados de mensajes como la
    // descarga de adjuntos. Ver lib/tiempos-espera.ts.
    signal: AbortSignal.timeout(ESPERA_DESCARGA_MS),
  })
  if (res.ok) return res

  let detalle = ''
  try {
    const cuerpo = (await res.json()) as { error?: { message?: string } }
    detalle = cuerpo?.error?.message ?? ''
  } catch {
    /* un cuerpo que no es JSON no aporta nada */
  }

  throw new OrigenError(
    `Gmail ha contestado ${res.status}${detalle ? `: ${detalle}` : ''}.`,
    { esDeAcceso: res.status === 401 || res.status === 403 || res.status === 404 }
  )
}

/* ------------------------------------------------------------------ */
/* Buscar                                                              */
/* ------------------------------------------------------------------ */

interface Adjunto {
  id: string
  nombre: string
  tamano: number
}

interface Correo {
  id: string
  de: string
  asunto: string
  /** ISO */
  fecha: string | null
  adjuntos: Adjunto[]
}

interface Elegido {
  correo: Correo
  adjunto: Adjunto
}

/**
 * La consulta de Gmail.
 *
 * `has:attachment` y `newer_than` van SIEMPRE: son los dos que recortan de miles
 * a decenas, y sin ellos cada comprobación se pasearía por el buzón entero.
 *
 * El remitente y el asunto se meten en la consulta para que filtre Google, pero
 * LOS DOS SE VUELVEN A COMPROBAR aquí abajo, en clasificar(). La búsqueda de
 * Gmail es por PALABRAS y con acentos y mayúsculas normalizados, así que «Stock
 * diario» encuentra también «diario de stock». Filtrar dos veces es lo que hace
 * que lo que se enseña en pantalla sea de verdad lo que se va a coger.
 *
 * Y CON EL REMITENTE ESO NO ES UN REFINAMIENTO, ES EL FILTRO ENTERO. El operador
 * `from:` de Gmail casa por tokens y mira también el NOMBRE PARA MOSTRAR, no
 * solo la dirección de la cabecera From:. O sea que cualquiera puede escribir a
 * ese buzón desde la dirección que quiera poniéndose «erp@cliente.com» como
 * nombre visible, adjuntar un STOCK_2026-08-10.csv, y sería el más reciente que
 * encaja. Eso es exactamente lo que la ayuda del campo dice que no puede pasar:
 * «así es como se cuela un fichero que no es del cliente y acaba publicándose en
 * Amazon». La comparación que decide es la de direccionDe() contra cfg.remitente,
 * exacta y en local.
 */
function consulta(cfg: ConfigCorreo): string {
  const partes = ['has:attachment', `newer_than:${cfg.dias}d`]
  if (cfg.remitente) partes.push(`from:${cfg.remitente}`)
  if (cfg.asunto) partes.push(`subject:"${cfg.asunto.replace(/"/g, '')}"`)
  return partes.join(' ')
}

async function buscar(cfg: ConfigCorreo): Promise<Correo[]> {
  if (!cfg.buzon) {
    throw new OrigenError(
      'Este perfil no tiene puesto el buzón y el servidor tampoco tiene GOOGLE_IMPERSONATE_SUBJECT.'
    )
  }

  const params = new URLSearchParams({
    q: consulta(cfg),
    maxResults: String(MAX_CORREOS),
  })

  const res = await pedir(cfg, `/messages?${params}`)
  const cuerpo = (await res.json()) as { messages?: { id?: string }[] }
  const ids = (cuerpo.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string')

  // En serie y no en paralelo: son hasta quince llamadas al mismo buzón y
  // Gmail devuelve 429 con facilidad cuando se le lanzan todas a la vez. Esto
  // corre en una pantalla de configuración, no en un bucle de producción.
  const correos: Correo[] = []
  for (const id of ids) {
    const correo = await leerCorreo(cfg, id)
    if (correo) correos.push(correo)
  }

  // Gmail ya los devuelve del más reciente al más antiguo, pero se ordena otra
  // vez porque de eso depende cuál se coge y no se puede depender de que el
  // orden de una API ajena no cambie.
  return correos.sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))
}

async function leerCorreo(cfg: ConfigCorreo, id: string): Promise<Correo | null> {
  const res = await pedir(cfg, `/messages/${encodeURIComponent(id)}?format=full`)
  const msg = (await res.json()) as {
    id?: string
    internalDate?: string
    payload?: ParteGmail
  }
  if (!msg.payload) return null

  const cabeceras = new Map<string, string>()
  for (const h of msg.payload.headers ?? []) {
    if (h.name && h.value) cabeceras.set(h.name.toLowerCase(), h.value)
  }

  const fecha = msg.internalDate
    ? new Date(Number.parseInt(msg.internalDate, 10)).toISOString()
    : null

  return {
    id: msg.id ?? id,
    de: cabeceras.get('from') ?? '(sin remitente)',
    asunto: cabeceras.get('subject') ?? '(sin asunto)',
    fecha,
    adjuntos: adjuntosDe(msg.payload),
  }
}

interface ParteGmail {
  filename?: string
  mimeType?: string
  headers?: { name?: string; value?: string }[]
  body?: { attachmentId?: string; size?: number }
  parts?: ParteGmail[]
}

/**
 * Los adjuntos de un correo, mirando el árbol de partes entero.
 *
 * Es un ÁRBOL y no una lista: un correo con cuerpo en texto y en HTML más un
 * adjunto viene como multipart/mixed con un multipart/alternative dentro. Mirar
 * solo el primer nivel se deja fuera el adjunto en cuanto el cliente escribe
 * desde Outlook.
 */
function adjuntosDe(parte: ParteGmail): Adjunto[] {
  const salida: Adjunto[] = []

  const recorrer = (p: ParteGmail) => {
    // `attachmentId` es lo que distingue un adjunto de verdad del cuerpo del
    // mensaje: las partes del cuerpo traen `data` y no `attachmentId`.
    if (p.filename && p.body?.attachmentId) {
      salida.push({
        id: p.body.attachmentId,
        nombre: p.filename,
        tamano: p.body.size ?? 0,
      })
    }
    for (const hija of p.parts ?? []) recorrer(hija)
  }

  recorrer(parte)
  return salida
}

/** Cuál se coge y por qué se descarta cada uno de los demás */
function clasificar(
  correos: Correo[],
  cfg: ConfigCorreo
): { elegido: Elegido | null; candidatos: CandidatoOrigen[] } {
  let elegido: Elegido | null = null
  const candidatos: CandidatoOrigen[] = []
  const esperado = cfg.remitente.trim().toLowerCase()

  for (const correo of correos) {
    // El asunto y el REMITENTE se vuelven a comprobar aquí, y el segundo es el
    // que de verdad decide si el fichero es del cliente: ver consulta().
    const asuntoOk =
      !cfg.asunto || correo.asunto.toLowerCase().includes(cfg.asunto.toLowerCase())
    const remitenteOk = esperado === '' || direccionDe(correo.de) === esperado

    if (correo.adjuntos.length === 0) {
      candidatos.push(filaDe(correo, correo.asunto, null, 'El correo no trae ningún adjunto'))
      continue
    }

    for (const adjunto of correo.adjuntos) {
      let descarte: string | null = null

      /**
       * EL SEGUNDO ADJUNTO TAMBIÉN SE COGE, Y LA LISTA TIENE QUE DECIRLO.
       *
       * Esta comprobación va la PRIMERA de todas porque, sin ella, el fichero
       * de códigos de barras aparecía marcado como «No encaja con el patrón
       * ARTICULOS_STOCK*» — o sea, la pantalla decía justo lo contrario de lo
       * que iba a pasar: ese adjunto SÍ se coge, por el otro patrón. Una vista
       * previa que contradice al motor es peor que no tener vista previa,
       * porque manda a corregir algo que está bien.
       */
      const esElSegundo =
        remitenteOk &&
        asuntoOk &&
        cfg.adjuntoEan !== '' &&
        encajaPatron(adjunto.nombre, cfg.adjuntoEan) &&
        extensionValida(adjunto.nombre)

      if (esElSegundo) {
        candidatos.push(
          filaDe(correo, adjunto.nombre, adjunto.tamano, null, true, 'códigos de barras')
        )
        continue
      }

      if (!remitenteOk) {
        descarte = `Lo mandó ${direccionDe(correo.de) || correo.de}, no «${cfg.remitente}»`
      } else if (!asuntoOk) {
        descarte = `El asunto no contiene «${cfg.asunto}»`
      } else if (!encajaPatron(adjunto.nombre, cfg.adjunto)) {
        descarte = `No encaja con el patrón «${cfg.adjunto}»`
      } else if (!extensionValida(adjunto.nombre)) {
        descarte = 'No es un .xlsx, .xls ni .csv'
      }

      const bueno = descarte === null && elegido === null
      if (bueno) elegido = { correo, adjunto }

      candidatos.push(
        filaDe(
          correo,
          adjunto.nombre,
          adjunto.tamano,
          descarte ?? (bueno ? null : 'Hay otro correo más reciente que también encaja'),
          bueno,
          bueno && cfg.adjuntoEan !== '' ? 'stock' : null
        )
      )
    }
  }

  return { elegido, candidatos }
}

/**
 * LA DIRECCIÓN DE VERDAD DE UNA CABECERA `From:`.
 *
 * Gmail devuelve la cabecera entera —«ERP del cliente <erp@cliente.com>»— y lo
 * único comparable de ahí es lo que va entre los ángulos. El nombre para mostrar
 * lo elige quien manda el correo, así que comparar contra la cadena completa es
 * exactamente igual de inútil que no comparar nada.
 *
 * Si no lleva ángulos, la cabecera ES la dirección («erp@cliente.com» a secas),
 * que es como la mandan casi todos los ERP.
 */
function direccionDe(cabecera: string): string {
  const entreAngulos = cabecera.match(/<([^>]+)>/)
  return (entreAngulos ? entreAngulos[1] : cabecera).trim().toLowerCase()
}

function filaDe(
  correo: Correo,
  nombre: string,
  tamano: number | null,
  descarte: string | null,
  elegido = false,
  /** Para qué se coge: 'stock' o 'códigos de barras'. Solo cuando hay dos */
  papel: string | null = null
): CandidatoOrigen {
  return {
    // EL REMITENTE VA EN LA FILA porque en un buzón el fichero solo se entiende
    // con quién lo mandó: dos clientes pueden mandar «stock.csv», y sobre todo
    // porque es el dato que permite ver de un vistazo que se ha colado un correo
    // de un desconocido. Va la dirección, no el nombre para mostrar, que es el
    // que se puede falsificar.
    nombre: `${nombre} — ${direccionDe(correo.de) || correo.de} — ${correo.asunto}`,
    idExterno: correo.id,
    modificadoAt: correo.fecha,
    tamano,
    elegido,
    descarte,
    // Con dos adjuntos elegidos, «se cogería este» a secas no distingue cuál es
    // cuál. La nota dice el papel de cada uno.
    nota: papel ? `se coge como el fichero de ${papel}` : null,
  }
}

/**
 * EL SEGUNDO ADJUNTO DEL MISMO CORREO.
 *
 * Un cliente manda los dos ficheros —el volcado de stock y el de códigos de
 * barras— EN EL MISMO MENSAJE, tres veces por semana. Con dos perfiles cada uno
 * buscaría su correo por su cuenta, y ahí hay un fallo que no da ningún error:
 * pueden acabar cogiendo mensajes de DÍAS DISTINTOS. El stock del lunes cruzado
 * con los EAN del viernes casa referencias que ya no son las mismas, y no lo
 * delata nada.
 *
 * Pasando el id del correo del que salió el fichero de stock, esto es imposible
 * por construcción: los dos adjuntos vienen del mismo mensaje o no vienen.
 *
 * Devuelve null cuando ese correo no trae ningún adjunto que encaje. No es un
 * error: quien llama sigue sin la vía por EAN y lo dice en los avisos, igual que
 * cuando el cliente no tiene fichero de códigos de barras.
 */
export async function segundoAdjunto(
  config: Record<string, unknown>,
  correoId: string,
  patron: string,
  maxBytes: number
): Promise<{ nombre: string; bytes: Uint8Array } | null> {
  if (!configurado() || !correoId || !patron.trim()) return null

  const cfg = leerConfig({ config, perfil: '', maxBytes })
  const correo = await leerCorreo(cfg, correoId)
  if (!correo) return null

  const candidatos = correo.adjuntos.filter(
    (a) => encajaPatron(a.nombre, patron) && extensionValida(a.nombre)
  )
  // El más reciente no significa nada dentro de un correo, así que se coge el
  // primero que encaje: si hay dos que encajan, el patrón está mal escrito y
  // elegir por tamaño o por orden sería adivinar.
  const elegido = candidatos[0]
  if (!elegido) return null

  if (elegido.tamano > maxBytes) {
    throw new OrigenError(
      `El adjunto de códigos de barras «${elegido.nombre}» ocupa ${mb(elegido.tamano)} MB y el máximo son ${mb(maxBytes)} MB.`
    )
  }

  const bytes = new Uint8Array(await bajarAdjunto(cfg, correoId, elegido.id))
  if (bytes.byteLength === 0) return null
  return { nombre: elegido.nombre, bytes }
}

async function bajarAdjunto(
  cfg: ConfigCorreo,
  correoId: string,
  adjuntoId: string
): Promise<ArrayBuffer> {
  const res = await pedir(
    cfg,
    `/messages/${encodeURIComponent(correoId)}/attachments/${encodeURIComponent(adjuntoId)}`
  )
  const cuerpo = (await res.json()) as { data?: string }

  if (typeof cuerpo.data !== 'string' || cuerpo.data === '') {
    throw new OrigenError('Gmail no ha devuelto el contenido del adjunto.')
  }

  // base64URL, no base64: Gmail cambia '+' por '-' y '/' por '_'. Descodificarlo
  // como base64 normal da bytes distintos en uno de cada pocos ficheros, y el
  // resultado es un Excel «corrupto» que en Gmail se abre perfectamente.
  const buffer = Buffer.from(cuerpo.data, 'base64url')
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

/* ------------------------------------------------------------------ */
/* Errores                                                             */
/* ------------------------------------------------------------------ */

/**
 * TRADUCE EL FALLO A LA FRASE QUE LO ARREGLA.
 *
 * Los dos primeros casos son los que van a pasar de verdad, y ninguno de los dos
 * se puede adivinar leyendo lo que contesta Google.
 */
function traducir(error: unknown, cfg: ConfigCorreo): OrigenError {
  if (error instanceof OrigenError) {
    const texto = error.message.toLowerCase()

    if (texto.includes('401') || texto.includes('403') || texto.includes('insufficient')) {
      return new OrigenError(faltaElScope(cfg), { esDeAcceso: true })
    }
    if (texto.includes('404') || texto.includes('not found')) {
      return new OrigenError(buzonQueNoExiste(cfg), { esDeAcceso: true })
    }
    return error
  }

  const detalle = error instanceof Error ? error.message : 'error desconocido'

  if (/unauthorized_client|access_denied|invalid_grant/i.test(detalle)) {
    return new OrigenError(faltaElScope(cfg), { esDeAcceso: true })
  }

  return new OrigenError(`No se ha podido leer el buzón ${cfg.buzon}: ${detalle}`)
}

function faltaElScope(cfg: ConfigCorreo): string {
  return (
    `Google no deja a la cuenta de servicio leer el buzón ${cfg.buzon}.\n\n` +
    'Falta autorizar el permiso de Gmail en la delegación de dominio. Se hace una vez, en:\n' +
    '    Admin de Google Workspace › Seguridad › Control de acceso y datos › Controles de API\n' +
    '    › Delegación en todo el dominio › (el Client ID de la cuenta de servicio) › Editar\n\n' +
    'y hay que añadir a la lista de permisos, tal cual:\n' +
    `    ${GMAIL_SCOPE}\n\n` +
    'Hoy esa lista solo tiene el de calendario. Google tarda un par de minutos en propagarlo.'
  )
}

function buzonQueNoExiste(cfg: ConfigCorreo): string {
  return (
    `El buzón ${cfg.buzon} no existe en nuestro Workspace, o el correo no está.\n` +
    'Este conector solo puede leer cuentas de nuestro dominio: un Gmail personal o un buzón de otro ' +
    'proveedor necesitaría IMAP, que es otra cosa y todavía no está construida.\n' +
    'Si la dirección es un alias, pon la cuenta real: un alias no se puede suplantar.'
  )
}

/* ------------------------------------------------------------------ */

function fechaLegible(iso: string | null): string {
  if (!iso) return 'sin fecha'
  return new Date(iso).toLocaleString('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}
