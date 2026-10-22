import { simpleParser } from 'mailparser'
import type { createServiceClient } from '@/lib/supabase/service'
import { PERMISO_EQUIPO_COMERCIAL } from '@/lib/config/apps'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { nombreDeFichero } from './analizar'
import { almacenSupabase, type FilaDeBuzon, type FilaDeCarpeta } from './almacen'
import { NO_EXISTE, UUID, decidirAcceso, type ModoDeAcceso, type QuienPide } from './acceso'
import { elegirCarpetas } from './carpetas'
import { ErrorDeCorreo, MENSAJE_DE_ERROR_DE_CORREO, abrirImap, cerrarImap, convertirError, crearTransporte, type CodigoDeErrorDeCorreo } from './conexion'
import { borrarContrasena, buzonesConContrasena, leerContrasena } from './credenciales'
import { etiquetaDePersona } from './direcciones'
import { encabezadoDeCita } from './html'
import { enviarCorreo, type ContextoDeRespuesta, type CopiaEnEnviados, type EntradaDeEnvio, type ResultadoDeEnvio } from './enviar'
import { leerBuzon } from './sincronizar'
import type { AccesoRegistrado, AdjuntoDeMensaje, BuzonVisible, HiloAbierto, HiloDeLista, MensajeDeHilo, ResumenDeBuzon, VistaDeCorreo } from './tipos'

/**
 * LO QUE EL SERVIDOR HACE CON LOS BUZONES — SOLO SERVIDOR.
 * ========================================================
 * Une la lógica pura (acceso.ts, sincronizar.ts, enviar.ts) con Supabase, con las conexiones de correo y con el
 * cifrado de la contraseña. Las rutas de /api/correo son delgadas: validan la entrada, llaman aquí y contestan.
 *
 * LAS TABLAS correo_* ESTÁN CERRADAS AL NAVEGADOR. Todo pasa por aquí, con la clave de servicio, y la regla de quién
 * abre qué buzón es acceso.ts. Por eso CADA función que lee o escribe un buzón recibe ya un buzón autorizado (el
 * resultado de autorizarBuzon) y no un id suelto.
 *
 * LOS ERRORES QUE SALEN DE AQUÍ SON FRASES FIJAS. Esto maneja una contraseña de correo: no se reenvía el texto de ninguna
 * excepción (ni de la base, ni de imapflow, ni de nodemailer), y la contraseña no se escribe en ningún registro.
 */

type Servicio = ReturnType<typeof createServiceClient>

export const FALTA_MIGRACION_CORREO = 'Falta lanzar la migración 236_correo.sql en el editor SQL de Supabase: hasta entonces el correo no puede guardar ni leer nada.'

/** ¿Este error es que la migración 236 no está lanzada? Mira el error original, que viaja como `cause` */
export function esFaltaDeMigracion(error: unknown): boolean {
  return isMissingSchema(error) || isMissingSchema((error as { cause?: unknown } | null)?.cause)
}

const nombreDe = (p: { full_name: string | null; email: string | null }): string => p.full_name?.trim() || p.email || 'Sin nombre'

const CAMPOS_DE_BUZON =
  'id, user_id, direccion, nombre, usuario, proveedor, imap_host, imap_puerto, imap_seguro, smtp_host, smtp_puerto, smtp_seguro, desde_fecha, firma, vinculado_at, ultimo_sync_at, ultimo_intento_at, ultimo_error, fallos_seguidos, credenciales_invalidas, historico_completo, lectura_hasta'

/* ------------------------------------------------------------------ */
/* Quién es quién y qué puede abrir                                    */
/* ------------------------------------------------------------------ */

export async function cargarBuzon(service: Servicio, buzonId: string): Promise<FilaDeBuzon | null> {
  const { data, error } = await service.from('correo_buzones').select(CAMPOS_DE_BUZON).eq('id', buzonId).maybeSingle()
  if (error) throw new Error('No se ha podido leer el buzón.', { cause: error })
  return (data as FilaDeBuzon | null) ?? null
}

export async function quienPide(service: Servicio, sesion: { userId: string; role: string }): Promise<QuienPide> {
  // Un administrador lo puede leer todo sin pasar por el permiso. Un partner NO: su rol no supervisa nada (ver acceso.ts)
  if (sesion.role === 'admin') return { ...sesion, tienePermisoEquipo: false }
  const { data, error } = await service.from('user_app_permissions').select('can_access').eq('user_id', sesion.userId).eq('app_id', PERMISO_EQUIPO_COMERCIAL).maybeSingle()
  if (error) throw new Error('No se ha podido comprobar el permiso.', { cause: error })
  return { ...sesion, tienePermisoEquipo: (data as { can_access: boolean } | null)?.can_access === true }
}

export type Autorizacion =
  | { ok: true; buzon: FilaDeBuzon; esDueno: boolean; porSupervision: boolean; quien: QuienPide }
  | { ok: false; estado: number; mensaje: string }

/** Decide si esta sesión puede hacer `modo` sobre el buzón pedido. Lo que no puede ver, «no existe» */
export async function autorizarBuzon(service: Servicio, sesion: { userId: string; role: string }, buzonId: unknown, modo: ModoDeAcceso): Promise<Autorizacion> {
  if (typeof buzonId !== 'string' || !UUID.test(buzonId)) return { ok: false, estado: 404, mensaje: NO_EXISTE }
  const buzon = await cargarBuzon(service, buzonId.toLowerCase())
  if (!buzon) return { ok: false, estado: 404, mensaje: NO_EXISTE }

  const quien = await quienPide(service, sesion)
  let esComercial: boolean | null = null
  if (buzon.user_id !== sesion.userId) {
    const { data, error } = await service.from('profiles').select('is_comercial').eq('id', buzon.user_id).maybeSingle()
    if (error) throw new Error('No se ha podido comprobar al dueño del buzón.', { cause: error })
    esComercial = (data as { is_comercial: boolean | null } | null)?.is_comercial ?? null
  }

  const d = decidirAcceso(quien, buzon, { is_comercial: esComercial }, modo)
  if (!d.ok) return d
  return { ok: true, buzon, esDueno: d.esDueno, porSupervision: d.porSupervision, quien }
}

/* ------------------------------------------------------------------ */
/* Los buzones que una sesión puede ver                                */
/* ------------------------------------------------------------------ */

const SIN_RESUMEN: ResumenDeBuzon = { hilos: 0, hilosSinLeer: 0, sinLeer: 0, esperandoRespuesta: 0, ultimoMensajeAt: null }

/** Los buzones propios y, si se supervisa, los de las personas que se pueden supervisar. Siempre pasa por decidirAcceso */
export async function buzonesVisibles(service: Servicio, sesion: { userId: string; role: string }): Promise<BuzonVisible[]> {
  const quien = await quienPide(service, sesion)
  const supervisa = quien.role === 'admin' || quien.tienePermisoEquipo

  const consulta = service.from('correo_buzones').select(CAMPOS_DE_BUZON).order('direccion', { ascending: true })
  const { data, error } = await (supervisa ? consulta : consulta.eq('user_id', sesion.userId))
  if (error) throw new Error('No se han podido leer los buzones.', { cause: error })
  const todos = (data ?? []) as FilaDeBuzon[]
  if (todos.length === 0) return []

  const idsDuenos = [...new Set(todos.map((b) => b.user_id))]
  const { data: perfiles, error: errorPerfiles } = await service.from('profiles').select('id, full_name, email, is_comercial').in('id', idsDuenos)
  if (errorPerfiles) throw new Error('No se han podido leer los dueños de los buzones.', { cause: errorPerfiles })
  const duenos = new Map(((perfiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null; is_comercial: boolean | null }>).map((p) => [p.id, p]))

  const visibles = todos.filter((b) => decidirAcceso(quien, b, { is_comercial: duenos.get(b.user_id)?.is_comercial ?? null }, 'leer').ok)
  if (visibles.length === 0) return []

  const ids = visibles.map((b) => b.id)
  const [conectados, resumenes] = await Promise.all([
    buzonesConContrasena(service, ids),
    service.rpc('correo_resumen_buzones', { p_buzones: ids }),
  ])
  if (resumenes.error) throw new Error('No se han podido contar los correos.', { cause: resumenes.error })
  const resumenPorBuzon = new Map(
    ((resumenes.data ?? []) as Array<{ buzon_id: string; hilos: number | string; hilos_sin_leer: number | string; sin_leer: number | string; esperando_respuesta: number | string; ultimo_mensaje_at: string | null }>).map((r) => [
      r.buzon_id,
      { hilos: Number(r.hilos), hilosSinLeer: Number(r.hilos_sin_leer), sinLeer: Number(r.sin_leer), esperandoRespuesta: Number(r.esperando_respuesta), ultimoMensajeAt: r.ultimo_mensaje_at } satisfies ResumenDeBuzon,
    ])
  )

  return visibles
    .map<BuzonVisible>((b) => {
      const dueno = duenos.get(b.user_id)
      const esMio = b.user_id === sesion.userId
      return {
        id: b.id,
        direccion: b.direccion,
        nombre: b.nombre,
        proveedor: b.proveedor,
        propietario: { id: b.user_id, nombre: dueno ? nombreDe(dueno) : 'Sin nombre' },
        esMio,
        conectado: conectados.has(b.id),
        credencialesInvalidas: b.credenciales_invalidas,
        ultimoSyncAt: b.ultimo_sync_at,
        ultimoError: b.ultimo_error,
        historicoCompleto: b.historico_completo,
        desdeFecha: b.desde_fecha,
        firma: esMio ? b.firma : null,
        resumen: resumenPorBuzon.get(b.id) ?? SIN_RESUMEN,
      }
    })
    .sort((a, b) => Number(b.esMio) - Number(a.esMio) || a.propietario.nombre.localeCompare(b.propietario.nombre, 'es'))
}

/* ------------------------------------------------------------------ */
/* El rastro de quien mira buzones ajenos                              */
/* ------------------------------------------------------------------ */

const ACCESOS_RECIENTES = new Map<string, number>()
/** Mirar el mismo hilo (o la misma lista) varias veces seguidas deja UNA fila, no veinte */
const SIN_REPETIR_MS = 30 * 60_000

export type AccionDeAcceso = 'lista' | 'hilo' | 'busqueda' | 'adjunto'

/**
 * Apunta que alguien ha mirado un buzón que no es suyo. SI NO SE PUEDE APUNTAR, LANZA: la ruta no enseña el buzón sin
 * dejar rastro (cierra en vez de abrir). Solo hace falta cuando `porSupervision` es true.
 */
export async function registrarAcceso(
  service: Servicio,
  quien: { userId: string; nombre: string },
  buzonId: string,
  accion: AccionDeAcceso,
  hilo?: { id: string; asunto: string } | null,
  ahora: number = Date.now()
): Promise<void> {
  const clave = `${quien.userId}|${buzonId}|${accion}|${hilo?.id ?? ''}`
  const ultima = ACCESOS_RECIENTES.get(clave)
  if (ultima !== undefined && ahora - ultima < SIN_REPETIR_MS) return

  const { error } = await service.from('correo_accesos').insert({
    buzon_id: buzonId,
    usuario_id: quien.userId,
    usuario_nombre: quien.nombre.slice(0, 200),
    accion,
    hilo_id: hilo?.id ?? null,
    asunto: hilo ? hilo.asunto.slice(0, 300) : null,
  })
  if (error) throw new Error('No se ha podido dejar constancia del acceso.', { cause: error })

  ACCESOS_RECIENTES.set(clave, ahora)
  if (ACCESOS_RECIENTES.size > 5000) {
    for (const [k, t] of ACCESOS_RECIENTES) if (ahora - t >= SIN_REPETIR_MS) ACCESOS_RECIENTES.delete(k)
  }
}

export async function nombreDeLaSesion(service: Servicio, userId: string): Promise<string> {
  const { data } = await service.from('profiles').select('full_name, email').eq('id', userId).maybeSingle()
  const p = data as { full_name: string | null; email: string | null } | null
  return p ? nombreDe(p) : 'Sin nombre'
}

export async function accesosDeBuzon(service: Servicio, buzonId: string, limite = 50): Promise<AccesoRegistrado[]> {
  const { data, error } = await service
    .from('correo_accesos')
    .select('id, usuario_nombre, accion, asunto, creado_at')
    .eq('buzon_id', buzonId)
    .order('creado_at', { ascending: false })
    .limit(limite)
  if (error) throw new Error('No se han podido leer los accesos.', { cause: error })
  return ((data ?? []) as Array<{ id: string; usuario_nombre: string; accion: AccesoRegistrado['accion']; asunto: string | null; creado_at: string }>).map((f) => ({
    id: f.id,
    quien: f.usuario_nombre,
    accion: f.accion,
    asunto: f.asunto,
    cuando: f.creado_at,
  }))
}

/* ------------------------------------------------------------------ */
/* Leer un buzón (con su turno, su contraseña y el estado al terminar)  */
/* ------------------------------------------------------------------ */

export type ResultadoDeSincronizacion =
  | { tipo: 'hecha'; importados: number; quedan: number; completo: boolean; ultimoSyncAt: string }
  | { tipo: 'ocupada' }
  | { tipo: 'no_existe' }
  | { tipo: 'desconectado' }
  | { tipo: 'credenciales_invalidas' }
  | { tipo: 'error'; codigo: CodigoDeErrorDeCorreo | 'base' | 'contrasena'; mensaje: string }

const MENSAJE_DE_BASE = 'No se han podido guardar los correos. Vuelve a probar en un momento.'
const MENSAJE_DE_CONTRASENA_ILEGIBLE = 'No se ha podido leer la contraseña guardada. Vuelve a escribirla.'
/** El turno de un buzón caduca solo: si el proceso muere a mitad, a los 5 minutos otra lectura puede tomarlo */
const TURNO_MS = 5 * 60_000

/** Lo que falla al hablar con la base lleva el error original en `cause`; lo del servidor de correo, no */
const esFalloDeBase = (error: unknown): boolean => error instanceof Error && !(error instanceof ErrorDeCorreo) && 'cause' in error && (error as { cause?: unknown }).cause !== undefined

export async function sincronizarBuzonPorId(service: Servicio, buzonId: string, opciones: { presupuestoMs: number }): Promise<ResultadoDeSincronizacion> {
  const almacen = almacenSupabase(service)
  if (!(await almacen.tomarTurno(buzonId, Date.now() + TURNO_MS))) return { tipo: 'ocupada' }

  try {
    const buzon = await cargarBuzon(service, buzonId)
    if (!buzon) return { tipo: 'no_existe' }
    if (buzon.credenciales_invalidas) return { tipo: 'credenciales_invalidas' }

    const contrasena = await leerContrasena(service, buzonId)
    if ('sinContrasena' in contrasena) return { tipo: 'desconectado' }
    if ('ilegible' in contrasena) {
      await almacen.anotarBuzon(buzonId, { ultimo_intento_at: new Date().toISOString(), ultimo_error: MENSAJE_DE_CONTRASENA_ILEGIBLE, fallos_seguidos: buzon.fallos_seguidos + 1 })
      return { tipo: 'error', codigo: 'contrasena', mensaje: MENSAJE_DE_CONTRASENA_ILEGIBLE }
    }

    await almacen.anotarBuzon(buzonId, { ultimo_intento_at: new Date().toISOString() })

    let cliente: Awaited<ReturnType<typeof abrirImap>> | null = null
    try {
      cliente = await abrirImap(buzon, contrasena.password)
      const resultado = await leerBuzon(cliente, almacen, buzon, { presupuestoMs: opciones.presupuestoMs })
      const ahora = new Date().toISOString()
      await almacen.anotarBuzon(buzonId, {
        ultimo_sync_at: ahora,
        ultimo_error: null,
        fallos_seguidos: 0,
        credenciales_invalidas: false,
        historico_completo: resultado.completo,
      })
      return { tipo: 'hecha', importados: resultado.importados, quedan: resultado.quedan, completo: resultado.completo, ultimoSyncAt: ahora }
    } catch (error) {
      if (esFalloDeBase(error)) {
        console.error('Correo · lectura: fallo de la base', { codigo: (error as { cause?: { code?: unknown } }).cause?.code ?? null })
        await almacen.anotarBuzon(buzonId, { ultimo_error: MENSAJE_DE_BASE }).catch(() => undefined)
        return { tipo: 'error', codigo: 'base', mensaje: MENSAJE_DE_BASE }
      }
      const e = convertirError(error)
      console.error('Correo · lectura: fallo del servidor de correo', { codigo: e.codigo })
      const invalida = e.codigo === 'credenciales'
      await almacen
        .anotarBuzon(buzonId, { ultimo_error: e.message, fallos_seguidos: buzon.fallos_seguidos + 1, ...(invalida ? { credenciales_invalidas: true } : {}) })
        .catch(() => undefined)
      return invalida ? { tipo: 'credenciales_invalidas' } : { tipo: 'error', codigo: e.codigo, mensaje: e.message }
    } finally {
      await cerrarImap(cliente)
    }
  } finally {
    await almacen.soltarTurno(buzonId).catch(() => undefined)
  }
}

/** Cuántos minutos hay que dejar pasar antes de volver a intentar un buzón que falla: 2, 4, 8… hasta una hora */
export function esperaTrasFallos(fallosSeguidos: number): number {
  if (fallosSeguidos <= 0) return 0
  return Math.min(60, 2 ** Math.min(fallosSeguidos, 6)) * 60_000
}

/* ------------------------------------------------------------------ */
/* Enviar                                                              */
/* ------------------------------------------------------------------ */

/**
 * Cuántos correos ha enviado este buzón desde `desdeMs`, mirando la FECHA del correo y no la de cuándo entró en el ERP:
 * al conectar un buzón se importan cientos de enviados antiguos de golpe, y contarlos por su fecha de entrada dejaría a
 * quien acaba de conectarse sin poder enviar durante un minuto («estás enviando demasiado rápido»).
 */
export async function contarEnviosRecientes(service: Servicio, buzonId: string, desdeMs: number): Promise<number> {
  const { count, error } = await service
    .from('correo_mensajes')
    .select('id', { count: 'exact', head: true })
    .eq('buzon_id', buzonId)
    .eq('direccion', 'saliente')
    .gte('fecha', new Date(desdeMs).toISOString())
  if (error) throw new Error('No se han podido contar los envíos recientes.', { cause: error })
  return count ?? 0
}

export type ResultadoDeEnviar = { tipo: 'enviado'; resultado: ResultadoDeEnvio } | { tipo: 'error'; codigo: CodigoDeErrorDeCorreo | 'base' | 'contrasena'; mensaje: string; estado: number }

const ESTADO_HTTP: Record<CodigoDeErrorDeCorreo, number> = {
  credenciales: 422,
  red: 502,
  tls: 502,
  servidor_no_permitido: 422,
  servidor_no_resuelve: 422,
  limite: 429,
  rechazado: 422,
  sin_enviados: 409,
  ocupado: 409,
  otro: 502,
}

export const estadoHttpDe = (codigo: CodigoDeErrorDeCorreo): number => ESTADO_HTTP[codigo]

/** Copia un mensaje a la carpeta Enviados del buzón. null si no hay carpeta de Enviados o no se ha podido */
export function copiarAEnviadosDe(buzon: FilaDeBuzon, password: string): (crudo: Buffer, fecha: Date) => Promise<CopiaEnEnviados | null> {
  return async (crudo, fecha) => {
    let cliente: Awaited<ReturnType<typeof abrirImap>> | null = null
    try {
      cliente = await abrirImap(buzon, password)
      const lista = await cliente.list()
      const { enviados } = elegirCarpetas(lista.map((c) => ({ path: c.path, specialUse: c.specialUse, flags: c.flags })))
      if (!enviados) return null
      const r = await cliente.append(enviados, crudo, ['\\Seen'], fecha)
      if (!r) return { ruta: enviados, uid: null, uidValidity: null }
      return { ruta: r.destination ?? enviados, uid: typeof r.uid === 'number' ? r.uid : null, uidValidity: r.uidValidity !== undefined ? Number(r.uidValidity) : null }
    } catch {
      return null
    } finally {
      await cerrarImap(cliente)
    }
  }
}

export async function enviarDesdeBuzon(service: Servicio, buzon: FilaDeBuzon, entrada: EntradaDeEnvio): Promise<ResultadoDeEnviar> {
  const contrasena = await leerContrasena(service, buzon.id)
  if ('sinContrasena' in contrasena) return { tipo: 'error', codigo: 'credenciales', mensaje: 'Este buzón está desconectado. Vuelve a conectarlo para poder enviar.', estado: 409 }
  if ('ilegible' in contrasena) return { tipo: 'error', codigo: 'contrasena', mensaje: MENSAJE_DE_CONTRASENA_ILEGIBLE, estado: 422 }

  let transporte: Awaited<ReturnType<typeof crearTransporte>> | null = null
  try {
    transporte = await crearTransporte(buzon, contrasena.password)
    const resultado = await enviarCorreo({ almacen: almacenSupabase(service), transporte, copiarAEnviados: copiarAEnviadosDe(buzon, contrasena.password) }, buzon, entrada)
    return { tipo: 'enviado', resultado }
  } catch (error) {
    if (esFalloDeBase(error)) {
      // El correo ya salió si el fallo es de la base: se dice, para que no se envíe dos veces
      console.error('Correo · envío: fallo de la base', { codigo: (error as { cause?: { code?: unknown } }).cause?.code ?? null })
      return { tipo: 'error', codigo: 'base', mensaje: 'El correo se ha enviado, pero no se ha podido guardar aquí. Revisa tu carpeta de Enviados en el webmail.', estado: 500 }
    }
    const e = convertirError(error)
    console.error('Correo · envío: fallo', { codigo: e.codigo })
    if (e.codigo === 'credenciales') await almacenSupabase(service).anotarBuzon(buzon.id, { credenciales_invalidas: true, ultimo_error: e.message }).catch(() => undefined)
    return { tipo: 'error', codigo: e.codigo, mensaje: e.message, estado: ESTADO_HTTP[e.codigo] }
  } finally {
    transporte?.close()
  }
}

/** Lo que se cita de un mensaje al contestarlo o reenviarlo: tope para no meter un volcado entero en la respuesta */
const MAX_CITA = 20_000

/**
 * El contexto de un correo que contesta o reenvía a otro del MISMO buzón: a quién responde (cabeceras de hilo) y lo
 * que se cita debajo. null si el mensaje no existe en ese buzón.
 */
export async function cargarContextoDeRespuesta(
  service: Servicio,
  buzonId: string,
  mensajeId: unknown,
  modo: 'responder' | 'reenviar',
  conCita: boolean
): Promise<ContextoDeRespuesta | null> {
  if (typeof mensajeId !== 'string' || !UUID.test(mensajeId)) return null
  const { data, error } = await service
    .from('correo_mensajes')
    .select('message_id, referencias, texto, fecha, de_nombre, de_direccion, asunto, para')
    .eq('id', mensajeId.toLowerCase())
    .eq('buzon_id', buzonId)
    .maybeSingle()
  if (error) throw new Error('No se ha podido leer el mensaje al que se contesta.', { cause: error })
  const m = data as { message_id: string | null; referencias: string[] | null; texto: string; fecha: string; de_nombre: string | null; de_direccion: string; asunto: string; para: MensajeDeHilo['para'] | null } | null
  if (!m) return null

  const quien = etiquetaDePersona({ nombre: m.de_nombre ?? '', direccion: m.de_direccion })
  const texto = m.texto.slice(0, MAX_CITA)
  if (modo === 'reenviar') {
    const encabezado = [
      '---------- Mensaje reenviado ----------',
      `De: ${quien}`,
      `Fecha: ${new Date(m.fecha).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Madrid' })}`,
      `Asunto: ${m.asunto}`,
      ...(m.para && m.para.length > 0 ? [`Para: ${m.para.map(etiquetaDePersona).join(', ')}`] : []),
    ].join('\n')
    return { messageId: null, referencias: [], cita: { encabezado, texto } }
  }
  return { messageId: m.message_id, referencias: m.referencias ?? [], cita: conCita ? { encabezado: encabezadoDeCita(new Date(m.fecha), quien), texto } : null }
}

/* ------------------------------------------------------------------ */
/* Leer hilos y mensajes                                               */
/* ------------------------------------------------------------------ */

const CAMPOS_DE_LISTA =
  'id, asunto, contraparte, contraparte_direccion, vista_previa, ultimo_mensaje_at, mensajes, no_leidos, entrantes, salientes, tiene_adjuntos, destacado, ultimo_es_entrante, automatico'

interface FilaDeLista {
  id: string
  asunto: string
  contraparte: string
  contraparte_direccion: string
  vista_previa: string
  ultimo_mensaje_at: string
  mensajes: number
  no_leidos: number
  entrantes: number
  salientes: number
  tiene_adjuntos: boolean
  destacado: boolean
  ultimo_es_entrante: boolean
  automatico: boolean
}

const hiloDeLista = (f: FilaDeLista): HiloDeLista => ({
  id: f.id,
  asunto: f.asunto,
  contraparte: f.contraparte,
  contraparteDireccion: f.contraparte_direccion,
  vistaPrevia: f.vista_previa,
  ultimoMensajeAt: f.ultimo_mensaje_at,
  mensajes: f.mensajes,
  noLeidos: f.no_leidos,
  entrantes: f.entrantes,
  salientes: f.salientes,
  tieneAdjuntos: f.tiene_adjuntos,
  destacado: f.destacado,
  esperandoRespuesta: f.ultimo_es_entrante,
  automatico: f.automatico,
})

export const POR_PAGINA = 40
export const MAX_POR_PAGINA = 100

export interface OpcionesDeLista {
  vista: VistaDeCorreo
  soloNoLeidos: boolean
  busqueda: string | null
  /** Fecha del último mensaje del último hilo ya enseñado: se pide lo anterior */
  antes: string | null
  limite: number
}

export async function listarHilos(service: Servicio, buzonId: string, o: OpcionesDeLista): Promise<{ hilos: HiloDeLista[]; siguiente: string | null }> {
  const limite = Math.min(Math.max(1, Math.floor(o.limite) || POR_PAGINA), MAX_POR_PAGINA)

  if (o.busqueda) {
    const { data: aciertos, error } = await service.rpc('correo_buscar', { p_buzon: buzonId, p_q: o.busqueda, p_limite: limite })
    if (error) throw new Error('No se ha podido buscar.', { cause: error })
    const ids = ((aciertos ?? []) as Array<{ hilo_id: string }>).map((a) => a.hilo_id)
    if (ids.length === 0) return { hilos: [], siguiente: null }
    const { data, error: errorHilos } = await service.from('correo_hilos').select(CAMPOS_DE_LISTA).in('id', ids)
    if (errorHilos) throw new Error('No se han podido leer los hilos.', { cause: errorHilos })
    const porId = new Map(((data ?? []) as FilaDeLista[]).map((f) => [f.id, f]))
    return { hilos: ids.map((id) => porId.get(id)).filter((f): f is FilaDeLista => !!f).map(hiloDeLista), siguiente: null }
  }

  let q = service.from('correo_hilos').select(CAMPOS_DE_LISTA).eq('buzon_id', buzonId).gt('mensajes', 0)
  if (o.vista === 'recibidos') q = q.gt('entrantes', 0)
  else if (o.vista === 'enviados') q = q.gt('salientes', 0)
  else if (o.vista === 'destacados') q = q.eq('destacado', true)
  else if (o.vista === 'pendientes') q = q.eq('ultimo_es_entrante', true)
  if (o.soloNoLeidos) q = q.gt('no_leidos', 0)
  if (o.antes) q = q.lt('ultimo_mensaje_at', o.antes)

  const { data, error } = await q.order('ultimo_mensaje_at', { ascending: false }).limit(limite + 1)
  if (error) throw new Error('No se han podido leer los hilos.', { cause: error })
  const filas = (data ?? []) as FilaDeLista[]
  const hayMas = filas.length > limite
  const pagina = filas.slice(0, limite)
  return { hilos: pagina.map(hiloDeLista), siguiente: hayMas ? pagina[pagina.length - 1].ultimo_mensaje_at : null }
}

/** De qué buzón es un hilo (para autorizar antes de leerlo) */
export async function buzonDeHilo(service: Servicio, hiloId: string): Promise<{ buzonId: string; asunto: string } | null> {
  if (!UUID.test(hiloId)) return null
  const { data, error } = await service.from('correo_hilos').select('buzon_id, asunto').eq('id', hiloId.toLowerCase()).maybeSingle()
  if (error) throw new Error('No se ha podido leer el hilo.', { cause: error })
  const f = data as { buzon_id: string; asunto: string } | null
  return f ? { buzonId: f.buzon_id, asunto: f.asunto } : null
}

const MENSAJES_POR_HILO = 100

interface FilaDeMensajeLeida {
  id: string
  direccion: 'entrante' | 'saliente'
  de_nombre: string | null
  de_direccion: string
  para: MensajeDeHilo['para']
  cc: MensajeDeHilo['cc']
  responder_a: MensajeDeHilo['responderA']
  asunto: string
  fecha: string
  texto: string
  html: string | null
  adjuntos: AdjuntoDeMensaje[]
  leido: boolean
  automatico: boolean
  message_id: string | null
}

export async function abrirHilo(service: Servicio, buzonId: string, hiloId: string): Promise<HiloAbierto | null> {
  const { data: hilo, error } = await service.from('correo_hilos').select('id, buzon_id, asunto, destacado, mensajes').eq('id', hiloId).eq('buzon_id', buzonId).maybeSingle()
  if (error) throw new Error('No se ha podido leer el hilo.', { cause: error })
  const h = hilo as { id: string; buzon_id: string; asunto: string; destacado: boolean; mensajes: number } | null
  if (!h) return null

  // Los más recientes, que se devuelven del más antiguo al más nuevo
  const { data, error: errorMensajes } = await service
    .from('correo_mensajes')
    .select('id, direccion, de_nombre, de_direccion, para, cc, responder_a, asunto, fecha, texto, html, adjuntos, leido, automatico, message_id')
    .eq('hilo_id', hiloId)
    .order('fecha', { ascending: false })
    .order('creado_at', { ascending: false })
    .limit(MENSAJES_POR_HILO)
  if (errorMensajes) throw new Error('No se han podido leer los mensajes.', { cause: errorMensajes })
  const filas = ((data ?? []) as FilaDeMensajeLeida[]).reverse()

  return {
    id: h.id,
    buzonId: h.buzon_id,
    asunto: h.asunto,
    destacado: h.destacado,
    recortado: h.mensajes > filas.length,
    mensajes: filas.map((f) => ({
      id: f.id,
      direccion: f.direccion,
      deNombre: f.de_nombre ?? '',
      deDireccion: f.de_direccion,
      para: f.para ?? [],
      cc: f.cc ?? [],
      responderA: f.responder_a ?? [],
      asunto: f.asunto,
      fecha: f.fecha,
      texto: f.texto,
      html: f.html,
      adjuntos: f.adjuntos ?? [],
      leido: f.leido,
      automatico: f.automatico,
      messageId: f.message_id,
    })),
  }
}

/* ------------------------------------------------------------------ */
/* Marcar leído / destacado                                            */
/* ------------------------------------------------------------------ */

/** Marca como leídos todos los mensajes sin leer del hilo. Devuelve cuántos y dónde están (para marcarlos también en el servidor) */
export async function marcarHiloLeido(service: Servicio, hiloId: string): Promise<Array<{ carpetaId: string; uid: number }>> {
  const { data, error } = await service.from('correo_mensajes').select('id, carpeta_id, uid').eq('hilo_id', hiloId).eq('leido', false)
  if (error) throw new Error('No se han podido leer los mensajes sin leer.', { cause: error })
  const filas = (data ?? []) as Array<{ id: string; carpeta_id: string; uid: number | string | null }>
  if (filas.length === 0) return []
  await almacenSupabase(service).marcarLeidos(filas.map((f) => f.id))
  await almacenSupabase(service).actualizarHilo(hiloId)
  return filas.filter((f) => f.uid !== null).map((f) => ({ carpetaId: f.carpeta_id, uid: Number(f.uid) }))
}

/** Marca como no leído el último mensaje que llegó. Devuelve dónde está, para marcarlo también en el servidor */
export async function marcarHiloNoLeido(service: Servicio, hiloId: string): Promise<Array<{ carpetaId: string; uid: number }>> {
  const { data, error } = await service
    .from('correo_mensajes')
    .select('id, carpeta_id, uid')
    .eq('hilo_id', hiloId)
    .eq('direccion', 'entrante')
    .order('fecha', { ascending: false })
    .limit(1)
  if (error) throw new Error('No se ha podido leer el último mensaje.', { cause: error })
  const fila = ((data ?? []) as Array<{ id: string; carpeta_id: string; uid: number | string | null }>)[0]
  if (!fila) return []
  const { error: errorUpdate } = await service.from('correo_mensajes').update({ leido: false }).eq('id', fila.id)
  if (errorUpdate) throw new Error('No se ha podido marcar como no leído.', { cause: errorUpdate })
  await almacenSupabase(service).actualizarHilo(hiloId)
  return fila.uid === null ? [] : [{ carpetaId: fila.carpeta_id, uid: Number(fila.uid) }]
}

export async function destacarHilo(service: Servicio, hiloId: string, destacado: boolean): Promise<void> {
  const { error } = await service.from('correo_hilos').update({ destacado }).eq('id', hiloId)
  if (error) throw new Error('No se ha podido destacar el hilo.', { cause: error })
}

/**
 * Pone o quita «leído» en el servidor de correo, para que el webmail del proveedor y el móvil vean lo mismo. Mejor
 * esfuerzo: si falla, el ERP ya tiene su estado y la próxima lectura trae el del servidor.
 */
export async function marcarEnElServidor(service: Servicio, buzon: FilaDeBuzon, mensajes: Array<{ carpetaId: string; uid: number }>, leido: boolean): Promise<void> {
  if (mensajes.length === 0) return
  const contrasena = await leerContrasena(service, buzon.id)
  if (!('password' in contrasena)) return

  const carpetaIds = [...new Set(mensajes.map((m) => m.carpetaId))]
  const { data, error } = await service.from('correo_carpetas').select('id, ruta').in('id', carpetaIds)
  if (error) return
  const rutas = new Map(((data ?? []) as Array<Pick<FilaDeCarpeta, 'id' | 'ruta'>>).map((c) => [c.id, c.ruta]))

  let cliente: Awaited<ReturnType<typeof abrirImap>> | null = null
  try {
    cliente = await abrirImap(buzon, contrasena.password)
    for (const carpetaId of carpetaIds) {
      const ruta = rutas.get(carpetaId)
      if (!ruta) continue
      const uids = mensajes.filter((m) => m.carpetaId === carpetaId).map((m) => m.uid)
      const cerrojo = await cliente.getMailboxLock(ruta)
      try {
        if (leido) await cliente.messageFlagsAdd(uids.join(','), ['\\Seen'], { uid: true })
        else await cliente.messageFlagsRemove(uids.join(','), ['\\Seen'], { uid: true })
      } finally {
        cerrojo.release()
      }
    }
  } catch {
    // Sin el texto del error: la contraseña viaja en la conexión que acaba de fallar
  } finally {
    await cerrarImap(cliente)
  }
}

/* ------------------------------------------------------------------ */
/* Descargar un adjunto                                                */
/* ------------------------------------------------------------------ */

export type ResultadoDeAdjunto =
  | { tipo: 'ok'; nombre: string; tipoMime: string; contenido: Buffer }
  | { tipo: 'no_existe' }
  | { tipo: 'sin_copia' }
  | { tipo: 'error'; mensaje: string; estado: number }

/**
 * Trae de nuevo el correo del servidor y saca el adjunto `n`. Los ficheros no se guardan en el ERP: se piden cuando
 * alguien los descarga, y solo a través de esta función, que antes comprueba que el buzón es suyo o que lo supervisa.
 */
export async function descargarAdjunto(service: Servicio, buzon: FilaDeBuzon, mensajeId: string, n: number): Promise<ResultadoDeAdjunto> {
  if (!UUID.test(mensajeId) || !Number.isInteger(n) || n < 0) return { tipo: 'no_existe' }
  const { data, error } = await service.from('correo_mensajes').select('carpeta_id, uid, adjuntos').eq('id', mensajeId.toLowerCase()).eq('buzon_id', buzon.id).maybeSingle()
  if (error) throw new Error('No se ha podido leer el mensaje.', { cause: error })
  const fila = data as { carpeta_id: string; uid: number | string | null; adjuntos: AdjuntoDeMensaje[] } | null
  const ficha = fila?.adjuntos?.find((a) => a.n === n)
  if (!fila || !ficha) return { tipo: 'no_existe' }
  if (fila.uid === null) return { tipo: 'sin_copia' }

  const { data: carpeta } = await service.from('correo_carpetas').select('ruta').eq('id', fila.carpeta_id).maybeSingle()
  const ruta = (carpeta as { ruta: string } | null)?.ruta
  if (!ruta) return { tipo: 'no_existe' }

  const contrasena = await leerContrasena(service, buzon.id)
  if (!('password' in contrasena)) return { tipo: 'error', mensaje: 'Este buzón está desconectado, así que no se pueden descargar sus adjuntos.', estado: 409 }

  let cliente: Awaited<ReturnType<typeof abrirImap>> | null = null
  try {
    cliente = await abrirImap(buzon, contrasena.password)
    // Solo lectura y sin marcar el mensaje como leído
    const cerrojo = await cliente.getMailboxLock(ruta, { readOnly: true })
    let fuente: Buffer | null = null
    try {
      const m = await cliente.fetchOne(String(Number(fila.uid)), { uid: true, source: true }, { uid: true })
      fuente = m && m.source ? m.source : null
    } finally {
      cerrojo.release()
    }
    if (!fuente) return { tipo: 'no_existe' }

    const p = await simpleParser(fuente, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true })
    const adjunto = p.attachments[n]
    // Se comprueba que es el que se ficha: si el correo cambió de sitio, no se entrega otro fichero por error
    if (!adjunto || nombreDeFichero(adjunto.filename) !== ficha.nombre) return { tipo: 'no_existe' }
    return { tipo: 'ok', nombre: ficha.nombre, tipoMime: ficha.tipo, contenido: adjunto.content }
  } catch (error) {
    const e = convertirError(error)
    console.error('Correo · adjunto: fallo', { codigo: e.codigo })
    return { tipo: 'error', mensaje: e.message, estado: ESTADO_HTTP[e.codigo] }
  } finally {
    await cerrarImap(cliente)
  }
}

/* ------------------------------------------------------------------ */
/* Desconectar                                                         */
/* ------------------------------------------------------------------ */

/** Borra la contraseña. El historial ya importado SE QUEDA (es el seguimiento comercial); lo que se pierde es poder leer y enviar */
export async function desconectarBuzon(service: Servicio, buzonId: string): Promise<boolean> {
  const borrada = await borrarContrasena(service, buzonId)
  if (!borrada) return false
  await almacenSupabase(service).anotarBuzon(buzonId, { ultimo_error: null, fallos_seguidos: 0, credenciales_invalidas: false })
  return true
}

export { MENSAJE_DE_ERROR_DE_CORREO }
