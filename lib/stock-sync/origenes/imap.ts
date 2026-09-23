import { ImapFlow, type FetchMessageObject } from 'imapflow'
import type { StockProfileOrigin } from '@/lib/types/stock-sync'
import { leerCredencial } from './credenciales'
import {
  OrigenError,
  type CandidatoOrigen,
  type ConectorOrigen,
  type ContextoOrigen,
  type EstadoOrigen,
  type FicheroOrigen,
  type ListadoOrigen,
  type SecretoOrigen,
} from './tipos'

/**
 * ORIGEN «IMAP»: un buzón que NO es de Google.
 *
 * El conector de correo que ya había habla con la API de Gmail, y eso solo vale
 * si el buzón está en nuestro Workspace. Un buzón de Hostinger, de un hosting
 * cualquiera o del propio cliente no se puede leer así, y es justo lo que hace
 * falta cuando se quiere una bandeja aparte —stock@…— sin pagar otra licencia.
 *
 *
 * ============ ESTE ES EL MÁS FRÁGIL DE TODOS. LO MISMO QUE EL DE GMAIL ======
 *
 * Depende de que nadie del equipo toque el correo: si alguien archiva el
 * mensaje, cambia el asunto o se va a spam, esto NO DA ERROR — simplemente no
 * encuentra nada nuevo, que es el peor tipo de fallo. Por eso `comprobar`
 * enseña los correos que HAY y cuál se cogería, en vez de contestar «bien».
 *
 * Si el cliente puede dar SFTP o Drive, es mejor.
 *
 *
 * ============ SOLO LEE. NUNCA MARCA, MUEVE NI BORRA ============
 *
 * El buzón se abre en modo SOLO LECTURA (`readOnly: true`). No es una promesa
 * de buenas intenciones: con eso el servidor RECHAZA cualquier escritura, así
 * que aunque un error de programación intentara marcar un correo como leído, no
 * podría. Importa porque el buzón puede ser del cliente, y un correo que
 * aparece leído sin que nadie lo abriera es una llamada de teléfono.
 *
 *
 * ============ LA CONTRASEÑA ES DE APLICACIÓN, NO LA DEL BUZÓN ============
 *
 * Se guarda cifrada en `stock_origen_credenciales`, igual que la de SFTP. Pero
 * conviene que sea una contraseña de aplicación y no la de la cuenta: si algún
 * día hay que revocarla, revocar la de la cuenta deja al equipo sin correo.
 */

/** Ni un buzón se abre en un minuto ni un adjunto tarda más de cinco */
const ESPERA_MS = 60_000
/** Cuántos mensajes se miran como mucho. Más es ruido y memoria */
const MAX_MENSAJES = 40
/** Tope del adjunto. El volcado real de ShoesF son 2 MB */
const MAX_BYTES = 30 * 1024 * 1024

interface ConfigImap {
  host: string
  puerto: number
  usuario: string
  /** El buzón dentro de la cuenta. INBOX salvo que se diga otra cosa */
  carpeta: string
  remitente: string | null
  asunto: string | null
  adjunto: string | null
  dias: number
  /** false solo para servidores viejos que no cifran. Se avisa en pantalla */
  seguro: boolean
}

function leerConfig(ctx: ContextoOrigen): ConfigImap {
  const c = ctx.config as Record<string, unknown>
  const texto = (k: string): string | null => {
    const v = c[k]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }

  const host = texto('host')
  if (!host) throw new OrigenError('Falta el servidor de correo (por ejemplo imap.hostinger.com)')

  const usuario = texto('usuario')
  if (!usuario) throw new OrigenError('Falta el usuario del buzón, que suele ser el correo entero')

  const puertoCrudo = Number(c.puerto)
  const seguro = c.seguro !== false && c.seguro !== 'false'

  return {
    host,
    // 993 es IMAP sobre TLS y 143 es el de siempre. Se usa el que toque según
    // el cifrado en vez de obligar a saberlo de memoria.
    puerto: Number.isFinite(puertoCrudo) && puertoCrudo > 0 ? puertoCrudo : seguro ? 993 : 143,
    usuario,
    carpeta: texto('carpeta') ?? 'INBOX',
    remitente: texto('remitente'),
    asunto: texto('asunto'),
    adjunto: texto('adjunto'),
    dias: Number.isFinite(Number(c.dias)) && Number(c.dias) > 0 ? Number(c.dias) : 7,
    seguro,
  }
}

async function resolverSecreto(ctx: ContextoOrigen): Promise<SecretoOrigen | null> {
  // La tecleada manda sobre la guardada: es lo que permite corregir una
  // contraseña y probarla antes de guardarla.
  if (ctx.secretoEnPantalla) return ctx.secretoEnPantalla
  if (!ctx.perfilId) return null
  return leerCredencial(ctx.perfilId)
}

/**
 * Traduce los fallos de IMAP a algo que se pueda leer.
 *
 * Los servidores contestan cosas como «AUTHENTICATIONFAILED» o simplemente
 * cierran la conexión. Un `ECONNREFUSED` pelado en pantalla no le dice a nadie
 * que probablemente el puerto es el otro.
 */
function traducir(error: unknown, cfg: ConfigImap): OrigenError {
  const m = (error instanceof Error ? error.message : String(error)).toLowerCase()

  if (m.includes('authenticationfailed') || m.includes('invalid credentials') || m.includes('login')) {
    return new OrigenError(
      `El servidor ha rechazado el usuario o la contraseña de ${cfg.usuario}. Si el buzón tiene ` +
        'verificación en dos pasos, hace falta una contraseña de aplicación, no la de la cuenta.',
      { esDeAcceso: true }
    )
  }
  if (m.includes('econnrefused')) {
    return new OrigenError(
      `${cfg.host} ha rechazado la conexión en el puerto ${cfg.puerto}. Prueba con 993 si el ` +
        'servidor cifra, o con 143 si no.',
      { esDeAcceso: true }
    )
  }
  if (m.includes('enotfound') || m.includes('eai_again')) {
    return new OrigenError(`No existe el servidor ${cfg.host}. Comprueba cómo está escrito.`, {
      esDeAcceso: true,
    })
  }
  if (m.includes('certificate') || m.includes('self-signed') || m.includes('altname')) {
    return new OrigenError(
      `El certificado de ${cfg.host} no es válido. No se desactiva la comprobación: por ahí entra ` +
        'quien se ponga en medio a leer la contraseña del buzón.',
      { esDeAcceso: true }
    )
  }
  if (m.includes('timeout') || m.includes('etimedout')) {
    return new OrigenError(`${cfg.host} no ha contestado a tiempo.`, { esDeAcceso: true })
  }
  if (m.includes('nonexistent') || m.includes('does not exist') || m.includes("can't open")) {
    return new OrigenError(
      `No existe la carpeta «${cfg.carpeta}» en ese buzón. En muchos servidores la bandeja de ` +
        'entrada se llama INBOX, en mayúsculas.'
    )
  }
  return new OrigenError(
    `No se ha podido leer el buzón: ${error instanceof Error ? error.message : 'error desconocido'}`
  )
}

/** Abre, hace lo que sea, y cierra pase lo que pase */
async function conBuzon<T>(
  cfg: ConfigImap,
  secreto: SecretoOrigen,
  fn: (cliente: ImapFlow) => Promise<T>
): Promise<T> {
  const cliente = new ImapFlow({
    host: cfg.host,
    port: cfg.puerto,
    secure: cfg.seguro,
    auth: { user: cfg.usuario, pass: secreto.valor },
    // Sin esto imapflow escribe la sesión entera en la consola del contenedor,
    // credenciales incluidas.
    logger: false,
    greetingTimeout: ESPERA_MS,
    socketTimeout: ESPERA_MS,
  })

  try {
    await cliente.connect()
  } catch (error) {
    throw traducir(error, cfg)
  }

  try {
    return await fn(cliente)
  } catch (error) {
    if (error instanceof OrigenError) throw error
    throw traducir(error, cfg)
  } finally {
    // `logout` habla con el servidor y puede fallar si ya se cayó; da igual,
    // lo que importa es no dejar el socket abierto.
    await cliente.logout().catch(() => cliente.close())
  }
}

interface MensajeMirado {
  uid: number
  fecha: Date | null
  de: string
  asunto: string
  adjuntos: Array<{ nombre: string; parte: string; bytes: number }>
}

/** Los adjuntos de un mensaje, sacados de su estructura sin descargar nada */
function adjuntosDe(nodo: unknown, camino: string[] = []): MensajeMirado['adjuntos'] {
  const n = nodo as {
    childNodes?: unknown[]
    part?: string
    disposition?: string
    dispositionParameters?: { filename?: string }
    parameters?: { name?: string }
    size?: number
    encoding?: string
  }
  if (!n) return []

  const salida: MensajeMirado['adjuntos'] = []
  const nombre = n.dispositionParameters?.filename ?? n.parameters?.name ?? null
  if (nombre && (n.disposition === 'attachment' || camino.length > 0)) {
    salida.push({ nombre, parte: n.part ?? camino.join('.'), bytes: n.size ?? 0 })
  }

  for (const [i, hijo] of (n.childNodes ?? []).entries()) {
    salida.push(...adjuntosDe(hijo, [...camino, String(i + 1)]))
  }
  return salida
}

/**
 * Los mensajes que encajan con el filtro, del más nuevo al más viejo.
 *
 * El filtro va en la BÚSQUEDA del servidor y no en memoria: un buzón con miles
 * de correos no cabe, y pedirlos todos para descartarlos aquí sería descargar
 * el buzón entero cada quince minutos.
 */
async function mirar(cliente: ImapFlow, cfg: ConfigImap): Promise<MensajeMirado[]> {
  const buzon = await cliente.mailboxOpen(cfg.carpeta, { readOnly: true })
  if (!buzon.exists) return []

  const desde = new Date(Date.now() - cfg.dias * 86_400_000)
  const criterio: Record<string, unknown> = { since: desde }
  if (cfg.remitente) criterio.from = cfg.remitente
  if (cfg.asunto) criterio.subject = cfg.asunto

  const uids = (await cliente.search(criterio, { uid: true })) || []
  if (uids.length === 0) return []

  // Los últimos, que son los que interesan. De más nuevo a más viejo.
  const ultimos = uids.slice(-MAX_MENSAJES).reverse()

  const mensajes: MensajeMirado[] = []
  for await (const msg of cliente.fetch(
    { uid: ultimos.join(',') },
    { uid: true, envelope: true, bodyStructure: true, internalDate: true },
    { uid: true }
  )) {
    const m = msg as FetchMessageObject & { bodyStructure?: unknown }
    const sobre = m.envelope
    mensajes.push({
      uid: m.uid,
      // `internalDate` y `envelope.date` llegan como Date en unos servidores y
      // como cadena en otros. Se normaliza aquí y no en cada uso.
      fecha: comoFecha(m.internalDate) ?? comoFecha(sobre?.date) ?? null,
      de: sobre?.from?.map((f) => f.address ?? '').filter(Boolean).join(', ') ?? '',
      asunto: sobre?.subject ?? '(sin asunto)',
      adjuntos: adjuntosDe(m.bodyStructure),
    })
  }

  return mensajes.sort((a, b) => (b.fecha?.getTime() ?? 0) - (a.fecha?.getTime() ?? 0))
}

function comoFecha(v: unknown): Date | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isFinite(t) ? new Date(t) : null
  }
  return null
}

/**
 * Los adjuntos que se ven, con el motivo de descarte ya calculado.
 *
 * Se enseñan TODOS, también los que no encajan: es lo que permite ver de un
 * vistazo que el cliente ha cambiado el nombre del fichero, que es el fallo más
 * habitual de este origen y el que no da error.
 */
function candidatosDe(mensajes: MensajeMirado[], patron: string | null): CandidatoOrigen[] {
  const salida: CandidatoOrigen[] = []
  let yaElegido = false
  for (const m of mensajes) {
    for (const a of m.adjuntos) {
      const vale = encaja(a.nombre, patron)
      const esteSeCoge = vale && !yaElegido
      if (esteSeCoge) yaElegido = true
      salida.push({
        nombre: a.nombre,
        idExterno: `${m.uid}:${a.parte}`,
        modificadoAt: m.fecha?.toISOString() ?? null,
        tamano: a.bytes || null,
        elegido: esteSeCoge,
        descarte: vale
          ? yaElegido && !esteSeCoge
            ? 'Hay uno más reciente que también encaja'
            : null
          : patron
            ? `No encaja con «${patron}»`
            : null,
      })
    }
  }
  return salida
}

function encaja(nombre: string, patron: string | null): boolean {
  if (!patron) return true
  // Se admite el comodín de toda la vida, que es lo que la gente escribe
  const re = new RegExp(
    '^' + patron.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    'i'
  )
  return re.test(nombre)
}

/** El primer mensaje con un adjunto que encaje, y ese adjunto */
function elegir(
  mensajes: MensajeMirado[],
  patron: string | null
): { mensaje: MensajeMirado; adjunto: MensajeMirado['adjuntos'][number] } | null {
  for (const m of mensajes) {
    const a = m.adjuntos.find((x) => encaja(x.nombre, patron))
    if (a) return { mensaje: m, adjunto: a }
  }
  return null
}

export const conectorImap: ConectorOrigen = {
  id: 'imap' as StockProfileOrigin,
  etiqueta: 'Correo (IMAP)',
  descripcion:
    'Un buzón que no es de Google: Hostinger, el hosting del cliente o cualquier servidor de ' +
    'correo. Se lee el último mensaje que encaje y se coge su adjunto.',
  construido: true,
  explorador: 'mensajes',
  clavesDestino: ['host', 'puerto', 'usuario'],

  secreto: {
    etiqueta: 'Contraseña del buzón',
    ayuda:
      'Mejor una contraseña de APLICACIÓN que la de la cuenta: si hay que revocarla, revocar la ' +
      'de la cuenta deja a esa persona sin correo. Se guarda cifrada y no se puede volver a leer.',
    tipos: [{ valor: 'password', etiqueta: 'Contraseña' }],
    admitePassphrase: false,
  },

  campos: [
    {
      clave: 'host',
      etiqueta: 'Servidor IMAP',
      tipo: 'texto',
      requerido: true,
      ejemplo: 'imap.hostinger.com',
      ayuda: 'Lo da el proveedor del correo. En Hostinger es imap.hostinger.com.',
    },
    {
      clave: 'puerto',
      etiqueta: 'Puerto',
      tipo: 'texto',
      requerido: false,
      ejemplo: '993',
      ayuda: 'Vacío usa 993, que es el cifrado. 143 solo si el servidor no cifra.',
    },
    {
      clave: 'usuario',
      etiqueta: 'Usuario',
      tipo: 'texto',
      requerido: true,
      ejemplo: 'stock@libertyseller.com',
      ayuda: 'Casi siempre el correo entero.',
    },
    {
      clave: 'carpeta',
      etiqueta: 'Carpeta',
      tipo: 'texto',
      requerido: false,
      ejemplo: 'INBOX',
      ayuda: 'Vacío usa INBOX. Si el cliente manda a una carpeta con regla, ponla aquí.',
    },
    {
      clave: 'remitente',
      etiqueta: 'Remitente esperado',
      tipo: 'texto',
      requerido: false,
      ejemplo: 'almacen@cliente.com',
      ayuda:
        'Filtra por quién lo manda. Opcional pero muy recomendable: sin esto, cualquier correo con ' +
        'un adjunto que encaje se podría coger.',
    },
    {
      clave: 'asunto',
      etiqueta: 'Asunto contiene',
      tipo: 'texto',
      requerido: false,
      ejemplo: 'Stock diario',
      ayuda:
        'Opcional Y A PROPÓSITO: es lo que más se rompe. El día que el cliente le añada el año al ' +
        'asunto, esto deja de encontrar nada y no da error.',
    },
    {
      clave: 'adjunto',
      etiqueta: 'Patrón del adjunto',
      tipo: 'texto',
      requerido: false,
      ejemplo: 'stock*.xlsx',
      ayuda: 'Admite * y ?. Vacío coge el primer adjunto que haya.',
    },
    {
      clave: 'dias',
      etiqueta: 'Días hacia atrás',
      tipo: 'texto',
      requerido: false,
      ejemplo: '7',
      ayuda:
        'Cuánto se mira hacia atrás. Acotarlo evita procesar el volcado de la semana pasada ' +
        'creyendo que es el de hoy, que sería mandar a Amazon un stock viejo.',
    },
  ],

  async comprobar(ctx: ContextoOrigen): Promise<EstadoOrigen> {
    const cfg = leerConfig(ctx)
    const secreto = await resolverSecreto(ctx)
    if (!secreto) {
      return {
        ok: false,
        mensaje: 'Falta la contraseña del buzón. Escríbela y vuelve a comprobar.',
        candidatos: [],
      }
    }

    try {
      const mensajes = await conBuzon(cfg, secreto, (c) => mirar(c, cfg))
      const elegido = elegir(mensajes, cfg.adjunto)

      if (!elegido) {
        // NO se dice «bien»: no encontrar nada es el fallo típico de este
        // origen, y hay que distinguirlo de «va todo correcto».
        return {
          ok: false,
          mensaje:
            mensajes.length === 0
              ? `Conecta bien con ${cfg.usuario}, pero no hay ningún correo de los últimos ${cfg.dias} días que encaje con el filtro.`
              : `Hay ${mensajes.length} correo(s) que encajan, pero ninguno trae un adjunto que case con «${cfg.adjunto}».`,
          // Se enseña lo que HAY aunque no sirva: es lo que permite ver que el
          // asunto ha cambiado, que es el fallo típico de este origen.
          candidatos: candidatosDe(mensajes, cfg.adjunto),
        }
      }

      return {
        ok: true,
        mensaje:
          `Se cogería «${elegido.adjunto.nombre}» del correo «${elegido.mensaje.asunto}» ` +
          `de ${elegido.mensaje.de}` +
          (mensajes.length > 1 ? ` (hay ${mensajes.length} correos que encajan)` : ''),
        candidatos: candidatosDe(mensajes, cfg.adjunto),
      }
    } catch (error) {
      if (error instanceof OrigenError) {
        return { ok: false, mensaje: error.message, candidatos: [] }
      }
      throw error
    }
  },

  async traer(ctx: ContextoOrigen): Promise<FicheroOrigen> {
    const cfg = leerConfig(ctx)
    const secreto = await resolverSecreto(ctx)
    if (!secreto) throw new OrigenError('Falta la contraseña del buzón', { esDeAcceso: true })

    return conBuzon(cfg, secreto, async (cliente) => {
      const mensajes = await mirar(cliente, cfg)
      const elegido = elegir(mensajes, cfg.adjunto)
      if (!elegido) {
        throw new OrigenError(
          `No hay ningún correo de los últimos ${cfg.dias} días con un adjunto que encaje. ` +
            'Comprueba el filtro, o si alguien ha archivado el mensaje.'
        )
      }

      if (elegido.adjunto.bytes > MAX_BYTES) {
        throw new OrigenError(
          `El adjunto pesa ${Math.round(elegido.adjunto.bytes / 1024 / 1024)} MB y el tope son ` +
            `${MAX_BYTES / 1024 / 1024} MB. Un volcado de stock no debería pesar tanto.`
        )
      }

      const { content } = await cliente.download(String(elegido.mensaje.uid), elegido.adjunto.parte, {
        uid: true,
      })

      const trozos: Buffer[] = []
      let total = 0
      for await (const trozo of content) {
        total += trozo.length
        // El tamaño declarado en la estructura puede mentir; esto corta de
        // verdad, antes de que un adjunto enorme se coma la memoria.
        if (total > MAX_BYTES) throw new OrigenError('El adjunto es más grande de lo declarado')
        trozos.push(trozo as Buffer)
      }

      return {
        nombre: elegido.adjunto.nombre,
        bytes: Buffer.concat(trozos),
        idExterno: String(elegido.mensaje.uid),
        /**
         * La huella es el UID del mensaje, no la fecha ni el tamaño.
         *
         * El UID es único y creciente dentro de una carpeta, así que un correo
         * nuevo siempre da huella nueva y el mismo correo siempre da la misma.
         * Con la fecha, dos volcados del mismo día se verían iguales; con el
         * tamaño, un fichero que no cambia de peso pasaría por repetido.
         */
        huella: `imap:${cfg.carpeta}:${elegido.mensaje.uid}`,
        modificadoAt: elegido.mensaje.fecha?.toISOString() ?? null,
        // El tamaño REAL de lo descargado, no el que declaraba la estructura:
        // algunos servidores dan el de antes de decodificar el base64 y sale
        // un tercio más grande de lo que es.
        tamano: total,
      }
    })
  },

  async explorar(ctx: ContextoOrigen): Promise<ListadoOrigen> {
    const cfg = leerConfig(ctx)
    const secreto = await resolverSecreto(ctx)
    if (!secreto) throw new OrigenError('Falta la contraseña del buzón', { esDeAcceso: true })

    const mensajes = await conBuzon(cfg, secreto, (c) => mirar(c, cfg))

    return {
      ruta: cfg.carpeta,
      migas: [{ nombre: cfg.carpeta, ruta: cfg.carpeta }],
      carpetas: [],
      ficheros: candidatosDe(mensajes, cfg.adjunto),
      seleccionable: false,
      aviso: cfg.seguro
        ? null
        : 'Esta conexión NO va cifrada: la contraseña del buzón viaja en claro por la red.',
    }
  },
}
