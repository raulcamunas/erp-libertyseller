import { simpleParser } from 'mailparser'
import type { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { nombreDeFichero } from './analizar'
import { almacenSupabase, type FilaDeBuzon, type FilaDeCarpeta } from './almacen'
import { avisarDeCorreoNuevo, marcarAvisosDeCorreoLeidos } from './campana-servidor'
import { NO_EXISTE, UUID, decidirAcceso, type DecisionDeAcceso, type ModoDeAcceso, type QuienPide } from './acceso'
import { mezclarResultadosDeBusqueda, siguienteCursor, type ConsultaDeBandeja, type Cursor } from './bandeja'
import { elegirCarpetas } from './carpetas'
import { ErrorDeCorreo, MENSAJE_DE_ERROR_DE_CORREO, abrirImap, cerrarImap, convertirError, crearTransporte, type CodigoDeErrorDeCorreo } from './conexion'
import { borrarContrasena, buzonesConContrasena, leerContrasena } from './credenciales'
import { etiquetaDePersona } from './direcciones'
import { CAMPOS_DE_LISTA, enriquecerHiloAbierto, enriquecerHilos, enviadoPorDe, leerAutoresDeEnvio, nombresDePersonas, type FilaDeLista } from './enriquecer-servidor'
import { encabezadoDeCita } from './html'
import { enviarCorreo, type AutorDeEnvio, type ContextoDeRespuesta, type CopiaEnEnviados, type EntradaDeEnvio, type ResultadoDeEnvio } from './enviar'
import { buzonSilenciado, enMisCorreos, misBuzonesQueAvisan, type Preferencia } from './preferencias'
import { leerPreferencias, sinLeerMios } from './preferencias-servidor'
import { CAMPOS_DE_BUZON, cargarBuzon, leerDuenos, quienPide, registrarAcceso, type DuenoLeido } from './quien-servidor'
import { esRebote } from './avisos'
import { leerBuzon } from './sincronizar'
import type { AccesoRegistrado, AdjuntoDeMensaje, BuzonVisible, HiloAbierto, HiloDeLista, MensajeDeHilo, ResumenDeBuzon, VistaDeCorreo } from './tipos'

/** Con «Ocultar silenciados» se quita lo silenciado, salvo los rebotes: un rebote no se silencia nunca (la misma regla que esRebote y que la lista del cliente) */
const noSeOculta = (h: { silenciado?: boolean; contraparteDireccion?: string | null; asunto?: string | null }): boolean =>
  !h.silenciado || esRebote({ de_direccion: h.contraparteDireccion ?? '', asunto: h.asunto ?? '' })

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
 * QUIÉN PIDE, EL BUZÓN, SUS DUEÑOS Y EL RASTRO viven en quien-servidor.ts (sin IMAP, para que la campana, las preferencias y las asignaciones
 * los usen sin cargar mailparser). Se reexportan aquí: quien los importaba de servidor.ts no cambia. Lo que la 318 añade a listas e hilos
 * (silencios, encargada, quién envió) vive en enriquecer-servidor.ts, en consultas aparte y tolerantes: sin la 318, todo sale como hoy.
 *
 * LOS ERRORES QUE SALEN DE AQUÍ SON FRASES FIJAS. Esto maneja una contraseña de correo: no se reenvía el texto de ninguna
 * excepción (ni de la base, ni de imapflow, ni de nodemailer), y la contraseña no se escribe en ningún registro.
 */

export { ACCESOS_RECIENTES, buzonesAsignadosA, cargarBuzon, leerDuenos, quienPide, registrarAcceso, type AccionDeAcceso } from './quien-servidor'

type Servicio = ReturnType<typeof createServiceClient>

export const FALTA_MIGRACION_CORREO = 'Falta lanzar la migración 236_correo.sql en el editor SQL de Supabase: hasta entonces el correo no puede guardar ni leer nada.'

/** ¿Este error es que la migración 236 no está lanzada? Mira el error original, que viaja como `cause` */
export function esFaltaDeMigracion(error: unknown): boolean {
  return isMissingSchema(error) || isMissingSchema((error as { cause?: unknown } | null)?.cause)
}

const nombreDe = (p: { full_name: string | null; email: string | null }): string => p.full_name?.trim() || p.email || 'Sin nombre'

/* ------------------------------------------------------------------ */
/* Qué puede hacer una sesión con un buzón                             */
/* ------------------------------------------------------------------ */

export type Autorizacion =
  | {
      ok: true
      buzon: FilaDeBuzon
      esDueno: boolean
      porSupervision: boolean
      /** Un administrador se lo ha asignado a quien pide (318) */
      asignado: boolean
      /** Puede enviar, responder y marcar desde él (el dueño, o asignado con respuesta) */
      puedeResponder: boolean
      quien: QuienPide
    }
  | { ok: false; estado: number; mensaje: string }

/** Decide si esta sesión puede hacer `modo` sobre el buzón pedido. Lo que no puede ver, «no existe» */
export async function autorizarBuzon(service: Servicio, sesion: { userId: string; role: string }, buzonId: unknown, modo: ModoDeAcceso): Promise<Autorizacion> {
  if (typeof buzonId !== 'string' || !UUID.test(buzonId)) return { ok: false, estado: 404, mensaje: NO_EXISTE }
  const buzon = await cargarBuzon(service, buzonId.toLowerCase())
  if (!buzon) return { ok: false, estado: 404, mensaje: NO_EXISTE }

  const quien = await quienPide(service, sesion)
  const duenos = buzon.user_id === sesion.userId ? new Map<string, DuenoLeido>() : await leerDuenos(service, [buzon.user_id])
  const dueno = duenos.get(buzon.user_id)

  const d = decidirAcceso(quien, buzon, { is_comercial: dueno?.is_comercial ?? null, role: dueno?.role ?? null }, modo)
  if (!d.ok) return d
  return { ok: true, buzon, esDueno: d.esDueno, porSupervision: d.porSupervision, asignado: d.asignado, puedeResponder: d.puedeResponder, quien }
}

/* ------------------------------------------------------------------ */
/* Los buzones que una sesión puede leer                               */
/* ------------------------------------------------------------------ */

const SIN_RESUMEN: ResumenDeBuzon = { hilos: 0, hilosSinLeer: 0, sinLeer: 0, esperandoRespuesta: 0, ultimoMensajeAt: null }

type DecisionPositiva = Extract<DecisionDeAcceso, { ok: true }>

interface BuzonLegible {
  fila: FilaDeBuzon
  decision: DecisionPositiva
  dueno: DuenoLeido | undefined
}

/**
 * Los buzones que esta sesión puede LEER, cada uno con la decisión de acceso. Supervisa (y por tanto mira más allá de los suyos) quien es admin,
 * tiene un permiso de supervisión, algún buzón abierto a mano o algún buzón ASIGNADO (318). Todo pasa por decidirAcceso.
 */
async function buzonesLegibles(service: Servicio, sesion: { userId: string; role: string }): Promise<{ quien: QuienPide; legibles: BuzonLegible[] }> {
  const quien = await quienPide(service, sesion)
  const supervisa =
    quien.role === 'admin' || quien.tienePermisoEquipo || quien.tienePermisoCorreo || (quien.buzonesConcedidos?.size ?? 0) > 0 || (quien.buzonesAsignados?.size ?? 0) > 0

  const consulta = service.from('correo_buzones').select(CAMPOS_DE_BUZON).order('direccion', { ascending: true })
  const { data, error } = await (supervisa ? consulta : consulta.eq('user_id', sesion.userId))
  if (error) throw new Error('No se han podido leer los buzones.', { cause: error })
  const todos = (data ?? []) as FilaDeBuzon[]
  if (todos.length === 0) return { quien, legibles: [] }

  const duenos = await leerDuenos(service, todos.map((b) => b.user_id))
  const legibles: BuzonLegible[] = []
  for (const fila of todos) {
    const dueno = duenos.get(fila.user_id)
    const decision = decidirAcceso(quien, fila, { is_comercial: dueno?.is_comercial ?? null, role: dueno?.role ?? null }, 'leer')
    if (decision.ok) legibles.push({ fila, decision, dueno })
  }
  return { quien, legibles }
}

/** Las personas que trabajan cada buzón (asignaciones de la 318), con su nombre. Sin la 318, ninguna. Un fallo de otra clase, ninguna y al registro */
async function asignacionesDeBuzones(service: Servicio, buzonIds: string[]): Promise<Map<string, BuzonVisible['asignaciones']>> {
  if (buzonIds.length === 0) return new Map()
  const { data, error } = await service.from('correo_buzon_asignaciones').select('buzon_id, persona_id, puede_responder').in('buzon_id', buzonIds)
  if (error) {
    if (!isMissingSchema(error)) console.error('Correo · buzones: no se han podido leer las asignaciones', { codigo: (error as { code?: unknown }).code ?? null })
    return new Map()
  }
  const filas = (data ?? []) as Array<{ buzon_id: string; persona_id: string; puede_responder: boolean | null }>
  const nombres = await nombresDePersonas(service, filas.map((f) => f.persona_id))
  const porBuzon = new Map<string, BuzonVisible['asignaciones']>()
  for (const f of filas) {
    const lista = porBuzon.get(f.buzon_id) ?? []
    lista.push({ personaId: f.persona_id, nombre: nombres.get(f.persona_id) ?? 'Persona sin nombre', puedeResponder: f.puede_responder === true })
    porBuzon.set(f.buzon_id, lista)
  }
  for (const lista of porBuzon.values()) lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
  return porBuzon
}

/** Mis correos primero (por el orden elegido; sin orden, los propios delante), luego el resto por el nombre del dueño */
function compararBuzones(a: BuzonVisible, b: BuzonVisible): number {
  if (a.enMisCorreos !== b.enMisCorreos) return a.enMisCorreos ? -1 : 1
  if (a.enMisCorreos) {
    const oa = a.orden ?? Number.POSITIVE_INFINITY
    const ob = b.orden ?? Number.POSITIVE_INFINITY
    if (oa !== ob) return oa < ob ? -1 : 1
    if (a.esMio !== b.esMio) return a.esMio ? -1 : 1
  }
  return a.propietario.nombre.localeCompare(b.propietario.nombre, 'es') || a.direccion.localeCompare(b.direccion, 'es')
}

export interface BuzonesConCuentas {
  buzones: BuzonVisible[]
  /** Conversaciones sin leer de «Mis correos» que avisan (sin los buzones ni los hilos silenciados): el número del menú */
  sinLeerMios: number
  /** false si falta lanzar la migración 318: no se puede elegir, asignar ni silenciar */
  preferenciasDisponibles: boolean
}

/**
 * Los buzones que esta sesión puede leer, ya listos para la pantalla, y el número del menú. Es lo que contesta GET /api/correo/buzones (le falta solo
 * `cifradoConfigurado`). Siempre pasa por decidirAcceso.
 *
 *   · puedeResponder / asignado: de la decisión de acceso. La FIRMA del buzón va a quien puede responder desde él.
 *   · enMisCorreos, orden, silenciado: las preferencias de quien mira (sin la 318: lo de por defecto, propios y asignados en Mis correos, nada silenciado).
 *   · asignaciones: quién lo trabaja, solo para el dueño y para un administrador.
 *   · hilosSinLeerMios: sin los hilos silenciados por quien mira; sin la 318 (o si la cuenta falla), el total del buzón.
 */
export async function buzonesVisiblesConCuentas(service: Servicio, sesion: { userId: string; role: string }, ahora: number = Date.now()): Promise<BuzonesConCuentas> {
  const [{ quien, legibles }, preferencias] = await Promise.all([buzonesLegibles(service, sesion), leerPreferencias(service, sesion.userId)])
  if (legibles.length === 0) return { buzones: [], sinLeerMios: 0, preferenciasDisponibles: preferencias.disponible }

  const ids = legibles.map((l) => l.fila.id)
  const esAdmin = quien.role === 'admin'
  const conAsignacionesVisibles = legibles.filter((l) => esAdmin || l.decision.esDueno).map((l) => l.fila.id)

  const [conectados, resumenes, asignaciones, sinLeerPorBuzon] = await Promise.all([
    buzonesConContrasena(service, ids),
    service.rpc('correo_resumen_buzones', { p_buzones: ids }),
    preferencias.disponible ? asignacionesDeBuzones(service, conAsignacionesVisibles) : Promise.resolve(new Map<string, BuzonVisible['asignaciones']>()),
    preferencias.disponible
      ? sinLeerMios(service, sesion.userId, ids).catch((e: unknown) => {
          console.error('Correo · buzones: no se han podido contar los sin leer sin lo silenciado', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
          return null
        })
      : Promise.resolve(null),
  ])
  if (resumenes.error) throw new Error('No se han podido contar los correos.', { cause: resumenes.error })
  const resumenPorBuzon = new Map(
    ((resumenes.data ?? []) as Array<{ buzon_id: string; hilos: number | string; hilos_sin_leer: number | string; sin_leer: number | string; esperando_respuesta: number | string; ultimo_mensaje_at: string | null }>).map((r) => [
      r.buzon_id,
      { hilos: Number(r.hilos), hilosSinLeer: Number(r.hilos_sin_leer), sinLeer: Number(r.sin_leer), esperandoRespuesta: Number(r.esperando_respuesta), ultimoMensajeAt: r.ultimo_mensaje_at } satisfies ResumenDeBuzon,
    ])
  )

  const buzones = legibles
    .map<BuzonVisible>(({ fila: b, decision, dueno }) => {
      const esMio = decision.esDueno
      const pref: Preferencia | undefined = preferencias.porBuzon.get(b.id)
      const resumen = resumenPorBuzon.get(b.id) ?? SIN_RESUMEN
      const silenciado = buzonSilenciado(pref, ahora)
      return {
        id: b.id,
        direccion: b.direccion,
        nombre: b.nombre,
        proveedor: b.proveedor,
        propietario: { id: b.user_id, nombre: dueno?.nombre ?? 'Sin nombre' },
        esMio,
        conectado: conectados.has(b.id),
        credencialesInvalidas: b.credenciales_invalidas,
        ultimoSyncAt: b.ultimo_sync_at,
        ultimoError: b.ultimo_error,
        historicoCompleto: b.historico_completo,
        desdeFecha: b.desde_fecha,
        firma: decision.puedeResponder ? b.firma : null,
        resumen,
        puedeResponder: decision.puedeResponder,
        asignado: decision.asignado,
        enMisCorreos: enMisCorreos({ esMio, asignado: decision.asignado }, pref),
        orden: pref?.orden ?? null,
        silenciado,
        silenciadoHasta: silenciado ? pref?.silenciadoHasta ?? null : null,
        asignaciones: asignaciones.get(b.id) ?? [],
        // La RPC solo devuelve los buzones con algo sin leer: el que no sale, 0. Sin la cuenta (318 o fallo), el total del buzón
        hilosSinLeerMios: sinLeerPorBuzon ? sinLeerPorBuzon.get(b.id) ?? 0 : resumen.hilosSinLeer,
      }
    })
    .sort(compararBuzones)

  // El número del menú: los de «Mis correos» que avisan (sin los silenciados), descontando los hilos silenciados
  const queAvisan = new Set(misBuzonesQueAvisan(buzones, preferencias.porBuzon, ahora))
  const total = buzones.filter((b) => queAvisan.has(b.id)).reduce((s, b) => s + b.hilosSinLeerMios, 0)
  return { buzones, sinLeerMios: total, preferenciasDisponibles: preferencias.disponible }
}

/** Los buzones propios y, si se supervisa o se tiene alguno asignado, los de las demás personas que se pueden leer. Siempre pasa por decidirAcceso */
export async function buzonesVisibles(service: Servicio, sesion: { userId: string; role: string }): Promise<BuzonVisible[]> {
  return (await buzonesVisiblesConCuentas(service, sesion)).buzones
}

/* ------------------------------------------------------------------ */
/* El rastro de quien mira buzones ajenos (registrarAcceso vive en quien-servidor.ts) */
/* ------------------------------------------------------------------ */

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

    const inicioDeLaLectura = Date.now()
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
      // Lo que ha entrado de personas (y los rebotes) avisa en la campana de su dueño, esté o no mirando el ERP. Si el aviso falla, el correo ya está leído
      if (resultado.importados > 0) {
        try {
          await avisarDeCorreoNuevo(service, buzon, { desde: inicioDeLaLectura })
        } catch (e) {
          console.error('Correo · campana: no se ha podido avisar del correo nuevo', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
        }
        // Los correos de Amazon que nombran un caso de cumplimiento dado de alta se cuelgan de él y avisan en #cumplimiento-normativo (solo en los
        // buzones vigilados; nunca lanza). Import dinámico: la lectura del correo no carga Tareas de clientes si no hace falta
        try {
          const { enlazarCorreosNuevos } = await import('@/lib/tareas-clientes/casos-servidor')
          await enlazarCorreosNuevos(service, buzon, inicioDeLaLectura)
        } catch (e) {
          console.error('Correo · casos: no se han podido enlazar los correos nuevos', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
        }
      }
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

/**
 * Envía desde el buzón. `opciones.autor` = quien envía cuando NO es el dueño (un buzón asignado con respuesta): viaja hasta la MISMA inserción del
 * mensaje (`enviado_por`, `enviado_por_nombre`; sin la 318 se guarda sin ellas). El rastro 'envio' lo escribe la ruta ANTES de llamar aquí.
 */
export async function enviarDesdeBuzon(
  service: Servicio,
  buzon: FilaDeBuzon,
  entrada: EntradaDeEnvio,
  opciones: { id?: string; autor?: AutorDeEnvio } = {}
): Promise<ResultadoDeEnviar> {
  const contrasena = await leerContrasena(service, buzon.id)
  if ('sinContrasena' in contrasena) return { tipo: 'error', codigo: 'credenciales', mensaje: 'Este buzón está desconectado. Vuelve a conectarlo para poder enviar.', estado: 409 }
  if ('ilegible' in contrasena) return { tipo: 'error', codigo: 'contrasena', mensaje: MENSAJE_DE_CONTRASENA_ILEGIBLE, estado: 422 }

  let transporte: Awaited<ReturnType<typeof crearTransporte>> | null = null
  try {
    transporte = await crearTransporte(buzon, contrasena.password)
    // `opciones.id` fija el Message-ID (`id@dominio`): las secuencias lo apuntan ANTES de enviar para poder comprobar después si un envío cortado llegó a salir
    const resultado = await enviarCorreo({ almacen: almacenSupabase(service), transporte, copiarAEnviados: copiarAEnviadosDe(buzon, contrasena.password) }, buzon, entrada, opciones)
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

export const POR_PAGINA = 40
export const MAX_POR_PAGINA = 100

export interface OpcionesDeLista {
  vista: VistaDeCorreo
  soloNoLeidos: boolean
  busqueda: string | null
  /** Fecha del último mensaje del último hilo ya enseñado: se pide lo anterior */
  antes: string | null
  limite: number
  /** Quien mira: con él, cada fila dice si lo tiene silenciado. Sin él, ninguna sale silenciada */
  userId?: string
}

/**
 * Los hilos de UN buzón ya autorizado, con su buzón, si quien mira los tiene silenciados y quién los lleva (enriquecer-servidor.ts, tolerante: sin la
 * 318 sale como hoy). El rastro de lista o búsqueda lo deja la ruta.
 */
export async function listarHilos(service: Servicio, buzonId: string, o: OpcionesDeLista): Promise<{ hilos: HiloDeLista[]; siguiente: string | null }> {
  const limite = Math.min(Math.max(1, Math.floor(o.limite) || POR_PAGINA), MAX_POR_PAGINA)
  // Sin quien mira no hay silencios que buscar: un id que no existe no casa con ninguno
  const userId = o.userId ?? '00000000-0000-0000-0000-000000000000'

  if (o.busqueda) {
    const { data: aciertos, error } = await service.rpc('correo_buscar', { p_buzon: buzonId, p_q: o.busqueda, p_limite: limite })
    if (error) throw new Error('No se ha podido buscar.', { cause: error })
    const ids = ((aciertos ?? []) as Array<{ hilo_id: string }>).map((a) => a.hilo_id)
    if (ids.length === 0) return { hilos: [], siguiente: null }
    const { data, error: errorHilos } = await service.from('correo_hilos').select(CAMPOS_DE_LISTA).in('id', ids)
    if (errorHilos) throw new Error('No se han podido leer los hilos.', { cause: errorHilos })
    const porId = new Map(((data ?? []) as FilaDeLista[]).map((f) => [f.id, f]))
    const filas = ids.map((id) => porId.get(id)).filter((f): f is FilaDeLista => !!f)
    return { hilos: await enriquecerHilos(service, userId, filas), siguiente: null }
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
  return { hilos: await enriquecerHilos(service, userId, pagina), siguiente: hayMas ? pagina[pagina.length - 1].ultimo_mensaje_at : null }
}

/* ------------------------------------------------------------------ */
/* La bandeja unificada («Mis correos» y «Asignados a mí»)              */
/* ------------------------------------------------------------------ */

/** Como mucho estos buzones a la vez en la bandeja (sección 5) */
const MAX_BUZONES_DE_BANDEJA = 30
/** Búsquedas en paralelo, como mucho */
const BUSQUEDAS_A_LA_VEZ = 6
/** «Asignados a mí»: son pocos, sin cursor */
const MAX_ASIGNADOS_A_MI = 100

export type ResultadoDeBandeja =
  | { tipo: 'ok'; hilos: HiloDeLista[]; siguiente: Cursor | null }
  /** Falta lanzar la migración 318: la ruta contesta 503 FALTA_MIGRACION_318 y la pantalla cae a la vista por buzón */
  | { tipo: 'falta_318' }

/** Ejecuta `tarea` sobre cada elemento, como mucho `n` a la vez, y devuelve los resultados en el mismo orden */
async function aLaVez<T, R>(elementos: readonly T[], n: number, tarea: (e: T) => Promise<R>): Promise<R[]> {
  const salida = new Array<R>(elementos.length)
  let siguiente = 0
  const obrero = async () => {
    while (siguiente < elementos.length) {
      const i = siguiente++
      salida[i] = await tarea(elementos[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, elementos.length) }, obrero))
  return salida
}

/** Una fila de la lista como la entienden siguienteCursor y mezclarResultadosDeBusqueda (bandeja.ts), sin perder la fila */
const ordenableDe = <F extends FilaDeLista>(fila: F): { id: string; ultimoMensajeAt: string; fila: F } => ({ id: fila.id, ultimoMensajeAt: fila.ultimo_mensaje_at, fila })

const pasaLaVista = (f: FilaDeLista, vista: VistaDeCorreo, soloNoLeidos: boolean): boolean =>
  f.mensajes > 0 &&
  (vista !== 'recibidos' || f.entrantes > 0) &&
  (vista !== 'enviados' || f.salientes > 0) &&
  (vista !== 'destacados' || f.destacado) &&
  (vista !== 'pendientes' || f.ultimo_es_entrante) &&
  (!soloNoLeidos || f.no_leidos > 0)

const casaConLaBusqueda = (f: FilaDeLista, q: string): boolean => {
  const t = q.toLowerCase()
  return [f.asunto, f.contraparte, f.contraparte_direccion, f.vista_previa].some((c) => (c ?? '').toLowerCase().includes(t))
}

/** El rastro de lista o búsqueda por cada buzón AJENO que sale en la página. Si no se puede dejar, lanza (la regla de siempre) */
async function rastroDeBandeja(service: Servicio, userId: string, legibles: Map<string, BuzonLegible>, hilos: HiloDeLista[], accion: 'lista' | 'busqueda'): Promise<void> {
  const ajenos = [...new Set(hilos.map((h) => h.buzonId))].filter((id) => legibles.get(id)?.decision.porSupervision === true)
  if (ajenos.length === 0) return
  const nombre = await nombreDeLaSesion(service, userId)
  for (const buzonId of ajenos) await registrarAcceso(service, { userId, nombre }, buzonId, accion)
}

/**
 * La bandeja unificada (sección 5 de la especificación). `consulta` ya validada con leerQueryDeBandeja.
 *
 *   · carpeta 'mios': los buzones de «Mis correos» que quien mira PUEDE LEER (recalculado con decidirAcceso), como mucho 30. Con silenciados = true
 *     (por defecto) los buzones silenciados entran y sus filas salen atenuadas; con false, ni sus buzones ni los hilos silenciados.
 *     Sin búsqueda: la RPC correo_bandeja con el cursor (antes, antesId). Con búsqueda: correo_buscar por buzón (6 a la vez), mezclado y sin cursor;
 *     los filtros de vista se aplican en el cliente.
 *   · carpeta 'asignados': las conversaciones que quien mira tiene encargadas y sin hacer (las 100 últimas), solo de buzones que aún puede leer.
 *   · Rastro 'lista' o 'busqueda' por cada buzón ajeno que sale en la página (caché de 30 min). Si no se puede dejar, lanza.
 *   · Sin la 318: { tipo: 'falta_318' }.
 */
export async function listarBandeja(service: Servicio, sesion: { userId: string; role: string }, consulta: ConsultaDeBandeja, ahora: number = Date.now()): Promise<ResultadoDeBandeja> {
  const [{ legibles: lista }, preferencias] = await Promise.all([buzonesLegibles(service, sesion), leerPreferencias(service, sesion.userId)])
  if (!preferencias.disponible) return { tipo: 'falta_318' }
  const legibles = new Map(lista.map((l) => [l.fila.id, l]))
  const accion = consulta.q ? 'busqueda' : 'lista'
  // La RPC y enriquecerHilos solo saben del silencio del hilo y del remitente: un BUZÓN silenciado también atenúa sus filas (sección 5)
  const conSilencioDeBuzon = (hilos: HiloDeLista[]): HiloDeLista[] =>
    hilos.map((h) => (h.silenciado || !buzonSilenciado(preferencias.porBuzon.get(h.buzonId), ahora) ? h : { ...h, silenciado: true }))

  if (consulta.carpeta === 'asignados') {
    const { data, error } = await service
      .from('correo_hilo_asignaciones')
      .select('hilo_id, asignado_at')
      .eq('persona_id', sesion.userId)
      .is('hecho_at', null)
      .order('asignado_at', { ascending: false })
      .limit(MAX_ASIGNADOS_A_MI)
    if (error) {
      if (isMissingSchema(error)) return { tipo: 'falta_318' }
      throw new Error('No se han podido leer las conversaciones asignadas.', { cause: error })
    }
    const ids = ((data ?? []) as Array<{ hilo_id: string }>).map((f) => f.hilo_id)
    if (ids.length === 0) return { tipo: 'ok', hilos: [], siguiente: null }
    const { data: hilos, error: errorHilos } = await service.from('correo_hilos').select(CAMPOS_DE_LISTA).in('id', ids)
    if (errorHilos) throw new Error('No se han podido leer los hilos.', { cause: errorHilos })
    const porId = new Map(((hilos ?? []) as FilaDeLista[]).map((f) => [f.id, f]))
    const filas = ids
      .map((id) => porId.get(id))
      // Un buzón que ya no se puede leer no enseña sus conversaciones, aunque siguieran encargadas
      .filter((f): f is FilaDeLista => !!f && legibles.has(f.buzon_id))
      .filter((f) => pasaLaVista(f, consulta.vista, consulta.sinLeer) && (!consulta.q || casaConLaBusqueda(f, consulta.q)))
      .map((f) => ({ ...f, asignado_a: sesion.userId }))
    let enriquecidos = conSilencioDeBuzon(await enriquecerHilos(service, sesion.userId, filas, ahora))
    if (!consulta.silenciados) enriquecidos = enriquecidos.filter(noSeOculta)
    await rastroDeBandeja(service, sesion.userId, legibles, enriquecidos, accion)
    return { tipo: 'ok', hilos: enriquecidos, siguiente: null }
  }

  // «Mis correos»: los que están en la lista de quien mira y puede leer
  const mios = lista
    .filter((l) => enMisCorreos({ esMio: l.decision.esDueno, asignado: l.decision.asignado }, preferencias.porBuzon.get(l.fila.id)))
    .sort((a, b) => (preferencias.porBuzon.get(a.fila.id)?.orden ?? Number.POSITIVE_INFINITY) - (preferencias.porBuzon.get(b.fila.id)?.orden ?? Number.POSITIVE_INFINITY))
    .slice(0, MAX_BUZONES_DE_BANDEJA)
  const ids = mios.map((l) => l.fila.id)
  if (ids.length === 0) return { tipo: 'ok', hilos: [], siguiente: null }
  // Los buzones silenciados se quedan en la consulta aunque se oculten: sus hilos se quitan DENTRO de la RPC (y en JS más abajo), pero un rebote nunca se oculta
  const idsSilenciados = mios.filter((l) => buzonSilenciado(preferencias.porBuzon.get(l.fila.id), ahora)).map((l) => l.fila.id)

  if (consulta.q) {
    const q = consulta.q
    const porBuzon = await aLaVez(ids, BUSQUEDAS_A_LA_VEZ, async (buzonId) => {
      const { data, error } = await service.rpc('correo_buscar', { p_buzon: buzonId, p_q: q, p_limite: consulta.limite })
      if (error) throw new Error('No se ha podido buscar.', { cause: error })
      return ((data ?? []) as Array<{ hilo_id: string }>).map((a) => a.hilo_id)
    })
    const hiloIds = [...new Set(porBuzon.flat())]
    if (hiloIds.length === 0) return { tipo: 'ok', hilos: [], siguiente: null }
    const { data, error } = await service.from('correo_hilos').select(CAMPOS_DE_LISTA).in('id', hiloIds)
    if (error) throw new Error('No se han podido leer los hilos.', { cause: error })
    const deMisBuzones = ((data ?? []) as FilaDeLista[]).filter((f) => f.mensajes > 0 && ids.includes(f.buzon_id))
    // El mismo orden que la RPC (más nuevo primero; a igualdad, id mayor), sin repetir y cortado: mezclarResultadosDeBusqueda, la de las pruebas
    const filas = mezclarResultadosDeBusqueda([deMisBuzones.map(ordenableDe)], consulta.limite).map((o) => o.fila)
    let hilos = conSilencioDeBuzon(await enriquecerHilos(service, sesion.userId, filas, ahora))
    if (!consulta.silenciados) hilos = hilos.filter(noSeOculta)
    await rastroDeBandeja(service, sesion.userId, legibles, hilos, accion)
    return { tipo: 'ok', hilos, siguiente: null }
  }

  const { data, error } = await service.rpc('correo_bandeja', {
    p_user: sesion.userId,
    p_buzones: ids,
    p_vista: consulta.vista,
    p_solo_no_leidos: consulta.sinLeer,
    p_antes: consulta.antes,
    p_antes_id: consulta.antesId,
    p_limite: consulta.limite,
    // Lo silenciado se quita en SQL, por buzón y antes de cortar la página: si se quitara aquí, una página entera de un remitente
    // silenciado llegaría vacía (con `siguiente`) y la lista se quedaría en «No hay conversaciones»
    p_ocultar_silenciados: !consulta.silenciados,
    p_buzones_silenciados: idsSilenciados,
  })
  if (error) {
    if (isMissingSchema(error)) return { tipo: 'falta_318' }
    throw new Error('No se ha podido leer la bandeja.', { cause: error })
  }
  const filas = (data ?? []) as Array<FilaDeLista & { silenciado: boolean | null; asignado_a: string | null }>
  // La RPC devuelve hasta limite + 1: la que sobra dice que hay más, y el cursor es la última de la página (antes de quitar silenciados).
  // siguienteCursor es la misma función que prueban bandeja.prueba.ts y bandeja-servidor.prueba.ts
  const corte = siguienteCursor(filas.map(ordenableDe), consulta.limite)
  const pagina = corte.pagina.map((o) => o.fila)
  const siguiente = corte.siguiente
  const hilos = conSilencioDeBuzon(
    await enriquecerHilos(
      service,
      sesion.userId,
      pagina.map((f) => ({ ...f, silenciado: f.silenciado === true, asignado_a: f.asignado_a ?? null })),
      ahora
    )
  )
  await rastroDeBandeja(service, sesion.userId, legibles, hilos, accion)
  return { tipo: 'ok', hilos, siguiente }
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

/** Quién mira el hilo: con esto el hilo dice si puede responder, qué tiene silenciado y, en los salientes, quién los envió si no fue el dueño */
export interface QuienAbreElHilo {
  userId: string
  /** De la decisión de acceso (autorizarBuzon): el dueño, o asignado con respuesta */
  puedeResponder: boolean
  /** El dueño del buzón (auth.buzon.user_id). Sin él se lee cuando hace falta */
  duenoId?: string
}

/**
 * Un hilo de un buzón ya autorizado. Lo de la 318 (silencios, encargada y «Enviado por») va por enriquecer-servidor.ts, en consultas aparte: sin la
 * 318 el hilo se abre igual. enviado_por NUNCA se pide en el select de los mensajes. Sin `quien`, puedeResponder es false y nada sale silenciado.
 */
export async function abrirHilo(service: Servicio, buzonId: string, hiloId: string, quien?: QuienAbreElHilo): Promise<HiloAbierto | null> {
  const { data: hilo, error } = await service
    .from('correo_hilos')
    .select('id, buzon_id, asunto, destacado, mensajes, contraparte_direccion')
    .eq('id', hiloId)
    .eq('buzon_id', buzonId)
    .maybeSingle()
  if (error) throw new Error('No se ha podido leer el hilo.', { cause: error })
  const h = hilo as { id: string; buzon_id: string; asunto: string; destacado: boolean; mensajes: number; contraparte_direccion: string | null } | null
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

  const salientes = filas.filter((f) => f.direccion === 'saliente').map((f) => f.id)
  const [autores, extra] = await Promise.all([
    leerAutoresDeEnvio(service, salientes),
    quien ? enriquecerHiloAbierto(service, quien.userId, { id: h.id, contraparteDireccion: h.contraparte_direccion ?? '' }) : Promise.resolve(null),
  ])
  let duenoId = quien?.duenoId ?? null
  if (autores.size > 0 && duenoId === null) {
    const { data: b } = await service.from('correo_buzones').select('user_id').eq('id', buzonId).maybeSingle()
    duenoId = (b as { user_id: string } | null)?.user_id ?? null
  }

  return {
    id: h.id,
    buzonId: h.buzon_id,
    asunto: h.asunto,
    destacado: h.destacado,
    recortado: h.mensajes > filas.length,
    mensajes: filas.map((f) => {
      const enviadoPor = f.direccion === 'saliente' && duenoId !== null ? enviadoPorDe(autores.get(f.id), duenoId) : null
      return {
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
        ...(enviadoPor ? { enviadoPor } : {}),
      }
    }),
    puedeResponder: quien?.puedeResponder ?? false,
    silenciado: extra?.silenciado ?? { hilo: false, remitente: false },
    asignacion: extra?.asignacion ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Marcar leído / destacado                                            */
/* ------------------------------------------------------------------ */

/**
 * Marca como leídos todos los mensajes sin leer del hilo. Devuelve cuántos y dónde están (para marcarlos también en el servidor).
 * `userId` es quien lo lee: solo se apagan SUS avisos de la campana, no los del dueño ni los de otras personas con el buzón
 */
export async function marcarHiloLeido(service: Servicio, hiloId: string, userId: string): Promise<Array<{ carpetaId: string; uid: number }>> {
  const { data, error } = await service.from('correo_mensajes').select('id, carpeta_id, uid').eq('hilo_id', hiloId).eq('leido', false)
  if (error) throw new Error('No se han podido leer los mensajes sin leer.', { cause: error })
  const filas = (data ?? []) as Array<{ id: string; carpeta_id: string; uid: number | string | null }>
  if (filas.length === 0) return []
  await almacenSupabase(service).marcarLeidos(filas.map((f) => f.id))
  await almacenSupabase(service).actualizarHilo(hiloId)
  // Lo que se acaba de leer ya no hace falta que lo avise la campana
  await marcarAvisosDeCorreoLeidos(service, userId, filas.map((f) => f.id))
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
