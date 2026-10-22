import type { ImapFlow } from 'imapflow'
import { analizarMensaje, type MensajeAnalizado } from './analizar'
import type { Almacen, FilaDeBuzon, FilaDeCarpeta, FilaDeMensaje, HiloBasico, RolDeCarpeta } from './almacen'
import { elegirCarpetas } from './carpetas'
import { ErrorDeCorreo } from './conexion'
import { lineaDePersonas } from './direcciones'
import { asuntoSirveParaAgrupar, elegirHiloPorAsunto, hiloQueSeQueda, idsParaElHilo, normalizarAsunto, participantesDe } from './hilos'

/**
 * LEER UN BUZÓN: DEL SERVIDOR DE CORREO A LA BASE — SOLO SERVIDOR.
 * ================================================================
 * Se comprueba con sincronizar.prueba.ts contra un servidor de correo falso y una base falsa en memoria.
 *
 * LA IDEA. No se lleva ningún cursor de «por dónde voy». En cada pasada se le pide al servidor el UID de todo lo que
 * cae dentro de la fecha elegida al conectar el buzón, se le restan los UID que ya están guardados y se trae lo que
 * falta, LO MÁS RECIENTE PRIMERO. Así:
 *
 *   · La primera importación enseña ya lo último que ha llegado mientras sigue trayendo lo antiguo.
 *   · Una pasada que se queda sin tiempo no pierde nada: la siguiente retoma exactamente lo que faltaba.
 *   · Si un correo se borra en el servidor, el nuestro se queda (el seguimiento comercial no se pierde porque alguien
 *     vacíe la bandeja).
 *   · Si el servidor cambia el UIDVALIDITY de una carpeta (pasa al restaurar o mover un buzón), los UID guardados ya no
 *     valen: se les quita el UID y se vuelven a emparejar por Message-ID en vez de duplicarlos.
 *
 * SOLO SE LEE. Las carpetas se abren en modo solo lectura y los mensajes se piden sin marcarlos como leídos. Marcar
 * como leído en el servidor es algo que hace el dueño del buzón al abrir un hilo (servidor.ts), nunca la lectura.
 */

/** Cuántos mensajes como máximo se piden de una vez, y cuántos bytes juntos: acota la memoria de una lectura */
export const LOTE_MAX_MENSAJES = 25
export const LOTE_MAX_BYTES = 12 * 1024 * 1024
/** Un mensaje que pasa de esto no se trae entero: se guardan sus cabeceras y un aviso */
export const MENSAJE_MAX_BYTES = 15 * 1024 * 1024
/** Cuántos mensajes sin leer se revisan en cada pasada por si se han leído en otro sitio (el móvil, el webmail) */
export const NO_LEIDOS_A_REVISAR = 300

/** Lo que se usa de ImapFlow: con esto basta para sustituirlo por uno falso en las pruebas */
export type ClienteDeLectura = Pick<ImapFlow, 'list' | 'getMailboxLock' | 'search' | 'fetch' | 'fetchOne' | 'mailbox'>

export interface OpcionesDeLectura {
  /** Cuánto tiempo se puede gastar. Pasado, se termina el lote en curso y se para */
  presupuestoMs: number
  ahora?: () => number
}

export interface ResumenDeCarpeta {
  rol: RolDeCarpeta
  ruta: string
  importados: number
  /** Cuántos mensajes de dentro de la fecha faltan por traer (-1 = ni se ha empezado esta carpeta) */
  quedan: number
}

export interface ResultadoDeLectura {
  importados: number
  quedan: number
  /** true = no queda nada por traer en ninguna de las dos carpetas */
  completo: boolean
  carpetas: ResumenDeCarpeta[]
}

/* ------------------------------------------------------------------ */
/* Poner un mensaje en su hilo                                         */
/* ------------------------------------------------------------------ */

export interface ContextoDeColocacion {
  buzon: Pick<FilaDeBuzon, 'id' | 'direccion'>
  carpetaId: string
  direccion: 'entrante' | 'saliente'
  uid: number | null
  leido: boolean
  tamano: number | null
}

export interface ResultadoDeColocar {
  hiloId: string
  insertado: boolean
  /** Hilos que se han fundido en `hiloId` (el cliente ya los puede dar por desaparecidos) */
  fusionados: string[]
}

/** Convierte un mensaje analizado en la fila que se guarda */
export function filaDeMensaje(ctx: ContextoDeColocacion, hiloId: string, m: MensajeAnalizado): FilaDeMensaje {
  return {
    buzon_id: ctx.buzon.id,
    hilo_id: hiloId,
    carpeta_id: ctx.carpetaId,
    uid: ctx.uid,
    message_id: m.messageId,
    en_respuesta_a: m.enRespuestaA,
    referencias: m.referencias,
    direccion: ctx.direccion,
    de_nombre: m.deNombre,
    de_direccion: m.deDireccion,
    para: m.para,
    cc: m.cc,
    destinatarios: lineaDePersonas(m.para, m.cc),
    responder_a: m.responderA,
    automatico: m.automatico,
    asunto: m.asunto,
    fecha: m.fecha.toISOString(),
    texto: m.texto,
    html: m.html,
    vista_previa: m.vistaPrevia,
    leido: ctx.leido,
    adjuntos: m.adjuntos,
    tamano: ctx.tamano,
  }
}

/**
 * Busca el hilo de un mensaje (por las cabeceras y, si no hay, por el asunto), lo guarda, funde los hilos que el
 * mensaje demuestra que eran uno y deja el hilo recalculado.
 *
 * El recálculo es por mensaje y no por lote A PROPÓSITO: emparejar por asunto mira los participantes y las fechas
 * del hilo, y un hilo recién creado en este mismo lote los tiene vacíos hasta que se recalcula. Con el recálculo al
 * final del lote, dos correos sin cabeceras de hilo que llegan juntos nunca se emparejarían entre sí.
 */
export async function colocarMensaje(almacen: Almacen, ctx: ContextoDeColocacion, m: MensajeAnalizado): Promise<ResultadoDeColocar> {
  const ids = idsParaElHilo(m)
  let hilos: HiloBasico[] = ids.length > 0 ? await almacen.hilosDeIds(ctx.buzon.id, ids) : []

  const clave = normalizarAsunto(m.asunto)
  // Por el asunto solo cuando las cabeceras no dicen nada, y nunca un aviso automático: cien «Resumen diario» no son una conversación
  if (hilos.length === 0 && !m.automatico && asuntoSirveParaAgrupar(clave)) {
    const candidatos = await almacen.hilosPorAsunto(ctx.buzon.id, clave)
    const participantes = participantesDe([m.deDireccion, ...m.para.map((p) => p.direccion), ...m.cc.map((p) => p.direccion)], ctx.buzon.direccion)
    const elegido = elegirHiloPorAsunto(candidatos, { participantes, fecha: m.fecha })
    if (elegido) hilos = candidatos.filter((h) => h.id === elegido)
  }

  const destino = hiloQueSeQueda(hilos)
  const hiloId = destino ? destino.id : await almacen.crearHilo(ctx.buzon.id, m.asunto, clave, m.fecha)

  const insertado = await almacen.insertarMensaje(filaDeMensaje(ctx, hiloId, m))

  const fusionados = destino ? hilos.filter((h) => h.id !== destino.id).map((h) => h.id) : []
  if (insertado && fusionados.length > 0) await almacen.fusionarHilos(hiloId, fusionados)
  else if (insertado) await almacen.actualizarHilo(hiloId)
  return { hiloId, insertado, fusionados: insertado ? fusionados : [] }
}

/* ------------------------------------------------------------------ */
/* Leer una carpeta                                                    */
/* ------------------------------------------------------------------ */

interface Metadatos {
  uid: number
  flags: Set<string>
  internalDate: Date | null
  size: number
}

/** El mensaje que se guarda cuando no hay forma de leer el que llegó: así su UID no se vuelve a pedir en cada pasada */
function mensajeIlegible(meta: Metadatos, ahora: Date): MensajeAnalizado {
  return {
    messageId: null,
    enRespuestaA: null,
    referencias: [],
    deNombre: '',
    deDireccion: '',
    para: [],
    cc: [],
    responderA: [],
    asunto: '(Correo que no se ha podido leer)',
    fecha: meta.internalDate ?? ahora,
    texto: 'No se ha podido leer el contenido de este correo. Ábrelo en el webmail del proveedor.',
    html: null,
    vistaPrevia: 'No se ha podido leer el contenido de este correo.',
    adjuntos: [],
    automatico: false,
  }
}

const fechaDeFetch = (v: Date | string | undefined): Date | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}

/** Agrupa los mensajes en lotes que no pasen de LOTE_MAX_BYTES ni de LOTE_MAX_MENSAJES; los enormes van aparte, solos */
function agruparPorTamano(metas: Metadatos[]): { normales: Metadatos[][]; grandes: Metadatos[] } {
  const normales: Metadatos[][] = []
  const grandes: Metadatos[] = []
  let actual: Metadatos[] = []
  let bytes = 0
  for (const m of metas) {
    if (m.size > MENSAJE_MAX_BYTES) {
      grandes.push(m)
      continue
    }
    if (actual.length > 0 && (actual.length >= LOTE_MAX_MENSAJES || bytes + m.size > LOTE_MAX_BYTES)) {
      normales.push(actual)
      actual = []
      bytes = 0
    }
    actual.push(m)
    bytes += m.size
  }
  if (actual.length > 0) normales.push(actual)
  return { normales, grandes }
}

const esCarpetaInexistente = (error: unknown): boolean => (error as { mailboxMissing?: unknown } | null)?.mailboxMissing === true

interface EstadoDeCarpeta {
  buzon: FilaDeBuzon
  carpeta: FilaDeCarpeta
  direccion: 'entrante' | 'saliente'
  /** Mensajes de la carpeta sin UID por emparejar. Baja a medida que se emparejan; con 0 no se vuelve a preguntar */
  sinUid: number
  /** Hilos cuyos contadores hay que recalcular al final (por mensajes que han pasado a leídos) */
  tocados: Set<string>
  importados: number
}

async function guardarUno(almacen: Almacen, estado: EstadoDeCarpeta, meta: Metadatos, fuente: Buffer | null, ahora: Date): Promise<void> {
  let analizado: MensajeAnalizado
  try {
    analizado = fuente
      ? await analizarMensaje(fuente, { fechaDelServidor: meta.internalDate, ahora, soloCabeceras: meta.size > MENSAJE_MAX_BYTES ? { tamano: meta.size } : null })
      : mensajeIlegible(meta, ahora)
  } catch {
    analizado = mensajeIlegible(meta, ahora)
  }

  if (estado.sinUid > 0 && analizado.messageId) {
    const adoptado = await almacen.adoptarSinUid(estado.buzon.id, estado.carpeta.id, estado.direccion, analizado.messageId, meta.uid)
    if (adoptado) {
      // El mensaje ya estaba contado en su hilo: solo ha recibido su UID
      estado.sinUid -= 1
      return
    }
  }

  const resultado = await colocarMensaje(
    almacen,
    {
      buzon: estado.buzon,
      carpetaId: estado.carpeta.id,
      direccion: estado.direccion,
      uid: meta.uid,
      leido: estado.direccion === 'saliente' ? true : meta.flags.has('\\Seen'),
      tamano: meta.size,
    },
    analizado
  )
  if (resultado.insertado) estado.importados += 1
}

async function leerMetadatos(cliente: ClienteDeLectura, uids: number[]): Promise<Metadatos[]> {
  const metas: Metadatos[] = []
  for await (const m of cliente.fetch(uids.join(','), { uid: true, flags: true, internalDate: true, size: true }, { uid: true })) {
    metas.push({ uid: m.uid, flags: m.flags ?? new Set<string>(), internalDate: fechaDeFetch(m.internalDate), size: m.size ?? 0 })
  }
  // Del más reciente al más antiguo, que es como se importa
  return metas.sort((a, b) => b.uid - a.uid)
}

async function importarLote(cliente: ClienteDeLectura, almacen: Almacen, estado: EstadoDeCarpeta, lote: Metadatos[], ahora: Date): Promise<void> {
  const porUid = new Map(lote.map((m) => [m.uid, m]))
  // Los mensajes se piden TODOS antes de guardar ninguno: no se mezclan órdenes de IMAP con las consultas a la base
  const fuentes = new Map<number, Buffer>()
  for await (const m of cliente.fetch([...porUid.keys()].join(','), { uid: true, source: true }, { uid: true })) {
    if (m.source) fuentes.set(m.uid, m.source)
  }
  for (const meta of lote) await guardarUno(almacen, estado, meta, fuentes.get(meta.uid) ?? null, ahora)
}

async function importarGrande(cliente: ClienteDeLectura, almacen: Almacen, estado: EstadoDeCarpeta, meta: Metadatos, ahora: Date): Promise<void> {
  const cabeceras = await cliente.fetchOne(String(meta.uid), { uid: true, headers: true }, { uid: true })
  await guardarUno(almacen, estado, meta, cabeceras && cabeceras.headers ? cabeceras.headers : null, ahora)
}

/** Si lo que se había guardado como no leído ya está leído en el servidor (se leyó en el móvil o en el webmail), se actualiza */
async function revisarLeidos(cliente: ClienteDeLectura, almacen: Almacen, estado: EstadoDeCarpeta): Promise<void> {
  const pendientes = await almacen.noLeidosDeCarpeta(estado.carpeta.id, NO_LEIDOS_A_REVISAR)
  if (pendientes.length === 0) return
  const vistos = new Set<number>()
  for await (const m of cliente.fetch(pendientes.map((p) => p.uid).join(','), { uid: true, flags: true }, { uid: true })) {
    if (m.flags?.has('\\Seen')) vistos.add(m.uid)
  }
  const leidos = pendientes.filter((p) => vistos.has(p.uid))
  if (leidos.length === 0) return
  await almacen.marcarLeidos(leidos.map((l) => l.id))
  for (const l of leidos) estado.tocados.add(l.hiloId)
}

async function leerCarpeta(
  cliente: ClienteDeLectura,
  almacen: Almacen,
  buzon: FilaDeBuzon,
  carpeta: FilaDeCarpeta,
  limite: number,
  reloj: () => number
): Promise<{ importados: number; quedan: number }> {
  let cerrojo: { release: () => void }
  try {
    // Solo lectura: abrir la carpeta no cambia nada en el servidor
    cerrojo = await cliente.getMailboxLock(carpeta.ruta, { readOnly: true })
  } catch (error) {
    if (esCarpetaInexistente(error)) return { importados: 0, quedan: 0 }
    throw error
  }

  try {
    const abierta = cliente.mailbox
    const uidValidity = abierta && typeof abierta === 'object' ? Number(abierta.uidValidity) : NaN
    if (!Number.isFinite(uidValidity)) throw new ErrorDeCorreo('otro')

    if (carpeta.uidvalidity !== uidValidity) {
      // La primera vez no hay nada que despegar; las siguientes, si cambia, ya no valen los UID de antes
      if (carpeta.uidvalidity !== null) await almacen.despegarUids(carpeta.id)
      await almacen.anotarCarpeta(carpeta.id, { uidvalidity: uidValidity })
    }

    const desdeFecha = new Date(buzon.desde_fecha)
    const desde = Number.isFinite(desdeFecha.getTime()) ? desdeFecha : new Date(reloj() - 60 * 24 * 3600 * 1000)
    const enServidor = await cliente.search({ since: desde }, { uid: true })
    if (!Array.isArray(enServidor)) throw new ErrorDeCorreo('otro')

    const guardados = new Set(await almacen.uidsGuardados(carpeta.id))
    const faltan = enServidor.filter((u) => !guardados.has(u)).sort((a, b) => b - a)

    const estado: EstadoDeCarpeta = {
      buzon,
      carpeta,
      direccion: carpeta.rol === 'enviados' ? 'saliente' : 'entrante',
      sinUid: faltan.length > 0 ? await almacen.contarSinUid(carpeta.id) : 0,
      tocados: new Set<string>(),
      importados: 0,
    }
    const ahora = new Date(reloj())

    while (faltan.length > 0 && reloj() < limite) {
      const candidatos = faltan.splice(0, LOTE_MAX_MENSAJES)
      const metas = await leerMetadatos(cliente, candidatos)
      const { normales, grandes } = agruparPorTamano(metas)

      for (const lote of normales) {
        if (reloj() >= limite) {
          // Sin tiempo: lo que no se ha tocado vuelve a la cola para la siguiente pasada
          faltan.unshift(...lote.map((m) => m.uid))
          continue
        }
        await importarLote(cliente, almacen, estado, lote, ahora)
      }
      for (const meta of grandes) {
        if (reloj() >= limite) {
          faltan.unshift(meta.uid)
          continue
        }
        await importarGrande(cliente, almacen, estado, meta, ahora)
      }
    }

    if (carpeta.rol === 'entrada' && reloj() < limite) {
      await revisarLeidos(cliente, almacen, estado)
      for (const hilo of estado.tocados) await almacen.actualizarHilo(hilo)
      estado.tocados.clear()
    }

    await almacen.anotarCarpeta(carpeta.id, { ultimo_sync_at: new Date(reloj()).toISOString() })
    return { importados: estado.importados, quedan: faltan.length }
  } finally {
    cerrojo.release()
  }
}

/**
 * Lee las dos carpetas (Entrada y Enviados) de un buzón con la sesión ya abierta. Lanza ErrorDeCorreo (o el error
 * original de la base) si algo falla; lo que ya se ha guardado se queda.
 */
export async function leerBuzon(cliente: ClienteDeLectura, almacen: Almacen, buzon: FilaDeBuzon, opciones: OpcionesDeLectura): Promise<ResultadoDeLectura> {
  const reloj = opciones.ahora ?? Date.now
  const limite = reloj() + opciones.presupuestoMs

  const lista = await cliente.list()
  const { entrada, enviados } = elegirCarpetas(lista.map((c) => ({ path: c.path, specialUse: c.specialUse, flags: c.flags })))
  const objetivos: Array<{ rol: RolDeCarpeta; ruta: string }> = [{ rol: 'entrada', ruta: entrada }]
  if (enviados) objetivos.push({ rol: 'enviados', ruta: enviados })

  const resultado: ResultadoDeLectura = { importados: 0, quedan: 0, completo: true, carpetas: [] }
  for (const objetivo of objetivos) {
    const carpeta = await almacen.asegurarCarpeta(buzon.id, objetivo.rol, objetivo.ruta)
    if (reloj() >= limite) {
      resultado.completo = false
      resultado.carpetas.push({ rol: objetivo.rol, ruta: objetivo.ruta, importados: 0, quedan: -1 })
      continue
    }
    const r = await leerCarpeta(cliente, almacen, buzon, carpeta, limite, reloj)
    resultado.importados += r.importados
    resultado.quedan += r.quedan
    if (r.quedan > 0) resultado.completo = false
    resultado.carpetas.push({ rol: objetivo.rol, ruta: objetivo.ruta, importados: r.importados, quedan: r.quedan })
  }
  return resultado
}
