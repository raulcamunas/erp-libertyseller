import type { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import {
  accionDeHistorial,
  armarVistaDeAsignaciones,
  efectosDeAsignar,
  ordenDeCambio,
  type AccionDeHistorialDeAsignacion,
  type PeticionDeAsignacion,
  type VistaDeAsignaciones,
} from './asignaciones'
import { avisoDeAsignacionDeHilo, type AvisoParaLaCampana } from './campana'
import { escribirAvisoDeAsignacion } from './campana-servidor'
import type { MotivoDeAsignacion } from './campana-tipos'
import { cargarReglaEnBloque, type ReglaEnBloque } from './lectores-servidor'
import { MAX_LARGO_DE_NOTA } from './peticion-hilo'
import { leerDuenos } from './quien-servidor'

/**
 * ASIGNAR BUZONES Y CONVERSACIONES — SOLO SERVIDOR, SIN IMAP.
 * ===========================================================
 * Lo que dice la migración 318 (correo_buzon_asignaciones y correo_hilo_asignaciones), con la regla pura de asignaciones.ts. Nunca importa servidor.ts:
 * solo quien-servidor, campana-servidor y lectores-servidor (sección 9.3 de la especificación).
 *
 * BUZONES. Solo un administrador asigna (lo comprueba la ruta). El orden de cada cambio importa, como en `cambiarLectores`:
 *   · lo que DA acceso (`asignar`, `responde`) escribe el historial ANTES: si no se puede escribir, no se cambia nada;
 *   · lo que QUITA (`solo_avisos`, `quitar`) se aplica ANTES y el historial va después (si falla, al registro): nunca un acceso de más por un historial caído.
 *   Asignar quita antes el bloqueo, si lo había (con su `desbloqueado` en el historial). Avisos `correo_asignado` a la persona y al dueño por la vía
 *   propia de la campana (`escribirAvisoDeAsignacion`): un aviso que no se escribe no deshace la asignación.
 *
 * CONVERSACIONES. Una persona por hilo, que tiene que poder LEER el buzón (`puedeEncargarseA`, la misma regla que la lista `encargables`). Avisa a la
 * encargada salvo que se lo asigne ella misma. El PATCH de /api/correo/hilos/[id] solo llama a `asignarHilo` y `marcarHiloHecho`: no hay otra copia.
 *
 * SIN LA 318: lo que se lee sale `{ disponible: false }` y lo que se escribe `{ ok: false, estado: 503, faltaMigracion: true }` (la ruta contesta
 * FALTA_MIGRACION_318).
 */

type Servicio = ReturnType<typeof createServiceClient>

const nombreDe = (p: { full_name: string | null; email: string | null }): string => p.full_name?.trim() || p.email || 'Sin nombre'
const codigo = (e: unknown): string | null => ((e as { code?: unknown } | null)?.code as string | undefined) ?? null

export const SIN_LA_318 = 'Falta lanzar la migración 318_correo_mis_asignaciones_silencios.sql en el editor SQL de Supabase: hasta entonces no se pueden elegir, asignar ni silenciar correos. El resto de Correo funciona.'

export type FalloDeAsignacion = { ok: false; estado: 400 | 403 | 404 | 503; error: string; faltaMigracion?: boolean }
const falta318 = (): FalloDeAsignacion => ({ ok: false, estado: 503, error: SIN_LA_318, faltaMigracion: true })

/** Los avisos de asignación nunca rompen nada: un aviso de menos */
async function avisar(service: Servicio, avisos: AvisoParaLaCampana[]): Promise<void> {
  if (avisos.length === 0) return
  try {
    await escribirAvisoDeAsignacion(service, avisos)
  } catch (e) {
    console.error('Correo · asignaciones: no se ha podido avisar en la campana', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
  }
}

const epoch = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : Date.now()
}

const recortar = (t: string, max: number): string => {
  const l = t.replace(/\s+/g, ' ').trim()
  return l.length > max ? `${l.slice(0, max - 1).trimEnd()}…` : l
}

/** Dirección corta para un título: «daniela@» */
const corta = (direccion: string): string => `${direccion.split('@')[0]}@`

/* ------------------------------------------------------------------ */
/* Los avisos (claves de la sección 3.5)                               */
/* ------------------------------------------------------------------ */

function avisoDeBuzon(e: {
  a: string
  motivo: Extract<MotivoDeAsignacion, 'buzon' | 'buzon_dueno'>
  buzon: { id: string; direccion: string }
  persona: { id: string; nombre: string }
  por: { id: string; nombre: string }
  puedeResponder: boolean
  asignadoAt: string | null
}): AvisoParaLaCampana {
  const clave = `asig:buzon:${e.buzon.id}:${e.persona.id}:${epoch(e.asignadoAt)}${e.motivo === 'buzon_dueno' ? ':dueno' : ''}`
  const titulo =
    e.motivo === 'buzon'
      ? `${e.por.nombre} te ha asignado ${corta(e.buzon.direccion)}${e.puedeResponder ? ' (puedes responder)' : ''}`
      : `${e.por.nombre} ha dado a ${e.persona.nombre} acceso para ${e.puedeResponder ? 'responder desde' : 'leer'} tu buzón`
  const mensaje =
    e.motivo === 'buzon'
      ? e.puedeResponder
        ? `Lo tienes en «Mis correos». Lo que envíes saldrá desde ${e.buzon.direccion} y quedará anotado que lo enviaste tú.`
        : `Lo tienes en «Mis correos» y te avisará de lo nuevo. Para responder desde él, pídeselo a un administrador.`
      : e.puedeResponder
        ? `${e.persona.nombre} puede leer ${e.buzon.direccion} y enviar desde él. Cada envío queda anotado.`
        : `${e.persona.nombre} puede leer ${e.buzon.direccion} y recibe sus avisos.`
  return {
    userId: e.a,
    tipo: 'correo_asignado',
    clave,
    titulo: recortar(titulo, 100),
    mensaje: recortar(mensaje, 260),
    datos: { buzonId: e.buzon.id, porId: e.por.id, porNombre: e.por.nombre, motivo: e.motivo },
  }
}

/* ------------------------------------------------------------------ */
/* Leer las asignaciones de buzón (pestaña «Asignaciones»)             */
/* ------------------------------------------------------------------ */

/** Un cambio del historial (concedido, quitado, bloqueado, desbloqueado, asignado, desasignado, responde, solo_avisos) */
export interface CambioDeAsignacion {
  accion: string
  buzon: string
  lector: string
  porQuien: string
  cuando: string
  /** Lo que cambió, si se anotó (p. ej. «responde») */
  detalle: string | null
}

interface PerfilLeido {
  id: string
  full_name: string | null
  email: string | null
  role: string | null
  puesto: string | null
}

/**
 * Lo que enseña la pestaña «Asignaciones» de «Equipo y permisos»: cada buzón con quién lo trabaja, las personas a las que se puede asignar (employees y
 * admins con la app de Correo; «Yo» la primera) con sus bloqueos, y los últimos cambios. Solo para administradores (lo comprueba la ruta).
 */
export async function leerAsignaciones(service: Servicio, yoId: string): Promise<{ disponible: false } | { disponible: true; vista: VistaDeAsignaciones<CambioDeAsignacion> }> {
  const [buzonesR, asignacionesR, personasR, permisosR, bloqueosR] = await Promise.all([
    service.from('correo_buzones').select('id, user_id, direccion, nombre').order('direccion', { ascending: true }),
    service.from('correo_buzon_asignaciones').select('buzon_id, persona_id, puede_responder, asignado_por, asignado_at'),
    service.from('profiles').select('id, full_name, email, role, puesto').in('role', ['employee', 'admin']),
    service.from('user_app_permissions').select('user_id').eq('app_id', 'correo').eq('can_access', true),
    service.from('correo_buzon_bloqueos').select('buzon_id, lector_id'),
  ])
  if (asignacionesR.error) {
    if (isMissingSchema(asignacionesR.error)) return { disponible: false }
    throw new Error('No se han podido leer las asignaciones.', { cause: asignacionesR.error })
  }
  if (buzonesR.error) throw new Error('No se han podido leer los buzones.', { cause: buzonesR.error })
  if (personasR.error) throw new Error('No se han podido leer las personas del equipo.', { cause: personasR.error })
  if (permisosR.error) throw new Error('No se han podido leer los permisos.', { cause: permisosR.error })
  // Los bloqueos son de la 260: sin ella, ninguno
  if (bloqueosR.error && !isMissingSchema(bloqueosR.error)) throw new Error('No se han podido leer los buzones bloqueados.', { cause: bloqueosR.error })

  // El historial con «detalle» (318); si la columna no está, sin él
  let historial = await service
    .from('correo_buzon_lectores_historial')
    .select('accion, buzon_direccion, lector_nombre, hecho_por_nombre, hecho_at, detalle')
    .order('hecho_at', { ascending: false })
    .limit(30)
  if (historial.error && (codigo(historial.error) === '42703' || codigo(historial.error) === 'PGRST204')) {
    historial = (await service
      .from('correo_buzon_lectores_historial')
      .select('accion, buzon_direccion, lector_nombre, hecho_por_nombre, hecho_at')
      .order('hecho_at', { ascending: false })
      .limit(30)) as typeof historial
  }
  if (historial.error && !isMissingSchema(historial.error)) throw new Error('No se han podido leer los últimos cambios.', { cause: historial.error })

  const buzones = (buzonesR.data ?? []) as Array<{ id: string; user_id: string; direccion: string; nombre: string | null }>
  const asignaciones = (asignacionesR.data ?? []) as Array<{ buzon_id: string; persona_id: string; puede_responder: boolean; asignado_por: string | null; asignado_at: string }>
  const perfiles = (personasR.data ?? []) as PerfilLeido[]
  const conCorreo = new Set(((permisosR.data ?? []) as Array<{ user_id: string }>).map((p) => p.user_id))
  const bloqueos = bloqueosR.error ? [] : ((bloqueosR.data ?? []) as Array<{ buzon_id: string; lector_id: string }>)

  // Los dueños y quienes asignaron pueden no salir en la lista (un partner, alguien que ya no está): se piden aparte
  const conocidos = new Map(perfiles.map((p) => [p.id, p]))
  const faltan = [...new Set([...buzones.map((b) => b.user_id), ...asignaciones.flatMap((a) => [a.persona_id, a.asignado_por ?? ''])])].filter((i) => i !== '' && !conocidos.has(i))
  if (faltan.length > 0) {
    const { data, error } = await service.from('profiles').select('id, full_name, email, role, puesto').in('id', faltan)
    if (error) throw new Error('No se han podido leer los dueños de los buzones.', { cause: error })
    for (const p of (data ?? []) as PerfilLeido[]) conocidos.set(p.id, p)
  }
  const nombres = new Map([...conocidos].map(([id, p]) => [id, nombreDe(p)]))

  const cambios: CambioDeAsignacion[] = ((historial.data ?? []) as Array<{ accion: string; buzon_direccion: string; lector_nombre: string; hecho_por_nombre: string; hecho_at: string; detalle?: string | null }>).map((h) => ({
    accion: h.accion,
    buzon: h.buzon_direccion,
    lector: h.lector_nombre,
    porQuien: h.hecho_por_nombre,
    cuando: h.hecho_at,
    detalle: h.detalle ?? null,
  }))

  const vista = armarVistaDeAsignaciones<CambioDeAsignacion>({
    yoId,
    buzones: buzones.map((b) => {
      const d = conocidos.get(b.user_id)
      return { id: b.id, direccion: b.direccion, nombre: b.nombre, dueno: { id: b.user_id, nombre: d ? nombreDe(d) : 'Sin nombre', role: d?.role ?? null, puesto: d?.puesto ?? null } }
    }),
    asignaciones,
    // Un administrador entra en Correo sin casilla; un employee, con la de la app
    personas: perfiles.map((p) => ({ id: p.id, nombre: nombreDe(p), role: p.role, puesto: p.puesto, tieneCorreo: p.role === 'admin' || conCorreo.has(p.id) })),
    bloqueos: bloqueos.map((b) => ({ buzonId: b.buzon_id, lectorId: b.lector_id })),
    nombres,
    cambios,
  })
  return { disponible: true, vista }
}

/* ------------------------------------------------------------------ */
/* Asignar, cambiar y quitar un buzón                                  */
/* ------------------------------------------------------------------ */

export type ResultadoDeCambiarAsignacion =
  | { ok: true; cambiado: boolean; accion: PeticionDeAsignacion['accion']; puedeResponder: boolean | null; desbloqueado: boolean }
  | FalloDeAsignacion

/**
 * Asigna, quita o cambia («responde» / «solo avisos») el buzón de una persona. Quien llama ya ha comprobado que `hechoPor` es administrador.
 * `puedeResponder` solo cuenta al asignar (por defecto, true: la casilla viene marcada).
 */
export async function cambiarAsignacion(
  service: Servicio,
  hechoPor: { id: string; nombre: string },
  peticion: PeticionDeAsignacion & { puedeResponder?: boolean }
): Promise<ResultadoDeCambiarAsignacion> {
  const { buzonId, personaId, accion } = peticion

  const [buzonR, actualR] = await Promise.all([
    service.from('correo_buzones').select('id, user_id, direccion').eq('id', buzonId).maybeSingle(),
    service.from('correo_buzon_asignaciones').select('puede_responder, asignado_at').eq('buzon_id', buzonId).eq('persona_id', personaId).maybeSingle(),
  ])
  if (actualR.error) {
    if (isMissingSchema(actualR.error)) return falta318()
    throw new Error('No se ha podido leer la asignación.', { cause: actualR.error })
  }
  if (buzonR.error) throw new Error('No se ha podido leer el buzón.', { cause: buzonR.error })
  const buzon = buzonR.data as { id: string; user_id: string; direccion: string } | null
  if (!buzon) return { ok: false, estado: 404, error: 'No existe ese buzón.' }
  const actual = actualR.data as { puede_responder: boolean; asignado_at: string } | null

  const duenos = await leerDuenos(service, [personaId, buzon.user_id])
  const persona = duenos.get(personaId)
  if (!persona && accion !== 'quitar') return { ok: false, estado: 404, error: 'No existe esa persona.' }
  const nombreDePersona = persona?.nombre ?? 'Sin nombre'

  const filaDeHistorial = (h: AccionDeHistorialDeAsignacion | 'desbloqueado', detalle: string | null) => ({
    buzon_id: buzon.id,
    buzon_direccion: buzon.direccion,
    lector_id: personaId,
    lector_nombre: nombreDePersona,
    accion: h,
    hecho_por: hechoPor.id,
    hecho_por_nombre: hechoPor.nombre,
    detalle,
  })
  const anotarDespues = async (h: AccionDeHistorialDeAsignacion, detalle: string | null) => {
    const { error } = await service.from('correo_buzon_lectores_historial').insert(filaDeHistorial(h, detalle))
    if (error) console.error('[correo] no se ha podido anotar un cambio de asignación', { accion: h, codigo: codigo(error) })
  }

  /* ---- Lo que QUITA: se aplica primero ---- */
  if (ordenDeCambio(accion) === 'quita') {
    if (!actual) return { ok: true, cambiado: false, accion, puedeResponder: null, desbloqueado: false }
    if (accion === 'quitar') {
      const { error } = await service.from('correo_buzon_asignaciones').delete().eq('buzon_id', buzon.id).eq('persona_id', personaId)
      if (error) throw new Error('No se ha podido quitar la asignación.', { cause: error })
      await anotarDespues(accionDeHistorial(accion), null)
      return { ok: true, cambiado: true, accion, puedeResponder: null, desbloqueado: false }
    }
    // solo_avisos
    if (!actual.puede_responder) return { ok: true, cambiado: false, accion, puedeResponder: false, desbloqueado: false }
    const { error } = await service.from('correo_buzon_asignaciones').update({ puede_responder: false }).eq('buzon_id', buzon.id).eq('persona_id', personaId)
    if (error) throw new Error('No se ha podido cambiar la asignación.', { cause: error })
    await anotarDespues(accionDeHistorial(accion), 'solo_avisos')
    return { ok: true, cambiado: true, accion, puedeResponder: false, desbloqueado: false }
  }

  /* ---- Lo que DA: el historial primero ---- */
  if (accion === 'responde') {
    if (!actual) return { ok: false, estado: 400, error: 'Esa persona no tiene asignado este buzón.' }
    if (actual.puede_responder) return { ok: true, cambiado: false, accion, puedeResponder: true, desbloqueado: false }
    const rastro = await service.from('correo_buzon_lectores_historial').insert(filaDeHistorial('responde', 'responde'))
    if (rastro.error) throw new Error('No se ha podido dejar constancia del cambio, así que no se ha cambiado nada.', { cause: rastro.error })
    const { error } = await service.from('correo_buzon_asignaciones').update({ puede_responder: true }).eq('buzon_id', buzon.id).eq('persona_id', personaId)
    if (error) throw new Error('No se ha podido cambiar la asignación.', { cause: error })
    return { ok: true, cambiado: true, accion, puedeResponder: true, desbloqueado: false }
  }

  // asignar
  if (actual) return { ok: true, cambiado: false, accion, puedeResponder: actual.puede_responder, desbloqueado: false }
  const { data: bloqueo, error: errorBloqueo } = await service
    .from('correo_buzon_bloqueos')
    .select('bloqueado_por, bloqueado_at')
    .eq('buzon_id', buzon.id)
    .eq('lector_id', personaId)
    .maybeSingle()
  if (errorBloqueo && !isMissingSchema(errorBloqueo)) throw new Error('No se ha podido comprobar si el buzón estaba bloqueado.', { cause: errorBloqueo })
  const bloqueoPrevio = errorBloqueo ? null : (bloqueo as { bloqueado_por: string | null; bloqueado_at: string } | null)

  const dueno = duenos.get(buzon.user_id)
  const efectos = efectosDeAsignar({
    role: persona?.role ?? null,
    esPartner: persona?.role === 'partner',
    esDueno: personaId === buzon.user_id,
    tieneBloqueo: bloqueoPrevio !== null,
    buzonDeOtroAdmin: dueno?.role === 'admin' && buzon.user_id !== hechoPor.id,
    aUnoMismo: personaId === hechoPor.id,
    asignaElDueno: buzon.user_id === hechoPor.id,
  })
  if (!efectos.ok) return { ok: false, estado: efectos.estado, error: efectos.error }
  const puedeResponder = peticion.puedeResponder !== false

  // 1. El historial (desbloqueo, si lo hay, y asignación) ANTES de tocar nada: si no se puede escribir, no se cambia nada
  const filas = [
    ...(efectos.efectos.quitarBloqueo ? [filaDeHistorial('desbloqueado', 'asignado')] : []),
    filaDeHistorial('asignado', puedeResponder ? 'responde' : 'solo_avisos'),
  ]
  const rastro = await service.from('correo_buzon_lectores_historial').insert(filas)
  if (rastro.error) {
    if (isMissingSchema(rastro.error)) return falta318()
    throw new Error('No se ha podido dejar constancia del cambio, así que no se ha asignado nada.', { cause: rastro.error })
  }

  // 2. Fuera el bloqueo (asignación y bloqueo no conviven)
  if (efectos.efectos.quitarBloqueo) {
    const { error } = await service.from('correo_buzon_bloqueos').delete().eq('buzon_id', buzon.id).eq('lector_id', personaId)
    if (error) throw new Error('No se ha podido quitar el bloqueo, así que no se ha asignado el buzón.', { cause: error })
  }

  // 3. La asignación. Si falla, el bloqueo vuelve a estar como estaba
  const { data: insertada, error } = await service
    .from('correo_buzon_asignaciones')
    .insert({ buzon_id: buzon.id, persona_id: personaId, puede_responder: puedeResponder, asignado_por: hechoPor.id })
    .select('asignado_at')
    .maybeSingle()
  if (error) {
    if (efectos.efectos.quitarBloqueo && bloqueoPrevio) {
      const r = await service.from('correo_buzon_bloqueos').insert({ buzon_id: buzon.id, lector_id: personaId, ...bloqueoPrevio })
      if (r.error) console.error('[correo] no se ha podido restaurar un bloqueo tras fallar la asignación', { codigo: codigo(r.error) })
    }
    throw new Error('No se ha podido asignar el buzón.', { cause: error })
  }
  const asignadoAt = (insertada as { asignado_at: string } | null)?.asignado_at ?? new Date().toISOString()

  // 4. Avisos (si fallan, la asignación ya está hecha)
  const comun = { buzon: { id: buzon.id, direccion: buzon.direccion }, persona: { id: personaId, nombre: nombreDePersona }, por: hechoPor, puedeResponder, asignadoAt }
  await avisar(service, [
    ...(efectos.efectos.avisarPersona ? [avisoDeBuzon({ ...comun, a: personaId, motivo: 'buzon' })] : []),
    ...(efectos.efectos.avisarDueno ? [avisoDeBuzon({ ...comun, a: buzon.user_id, motivo: 'buzon_dueno' })] : []),
  ])

  return { ok: true, cambiado: true, accion, puedeResponder, desbloqueado: efectos.efectos.quitarBloqueo }
}

/* ------------------------------------------------------------------ */
/* A quién se le puede encargar una conversación                       */
/* ------------------------------------------------------------------ */

export interface Encargable {
  id: string
  nombre: string
  /** Puede además responder desde el buzón */
  puedeResponder: boolean
}

/**
 * La regla de a quién se puede encargar una conversación (la misma para la lista y para el PATCH): la persona LEE el buzón, tiene la app de
 * Correo, está activa y no es partner; y, si quien pide no es administrador, además es el dueño o tiene el buzón asignado. Devuelve la persona o null.
 */
export function puedeEncargarseA(regla: ReglaEnBloque, personaId: string, buzon: { id: string; user_id: string }, pideAdmin: boolean): Encargable | null {
  const p = regla.persona(personaId)
  if (!p || !p.activo || !p.appCorreo || p.role === 'partner') return null
  const d = regla.evaluar(personaId, buzon, 'leer')
  if (!d.ok) return null
  if (!pideAdmin && !d.esDueno && !d.asignado) return null
  return { id: personaId, nombre: p.nombre, puedeResponder: d.puedeResponder }
}

/**
 * Las personas a las que se puede encargar una conversación de este buzón. Quien llama (la ruta) ya ha comprobado que `pide` puede responder o es
 * administrador. Todo en bloque (`cargarReglaEnBloque`) y decidirAcceso en memoria.
 *   · A un administrador: todas las personas que LEEN el buzón (con la app de Correo, activas y que no son partners).
 *   · A los demás: solo el dueño y las personas con el buzón asignado, sin decir por qué vía lo leen los demás (nunca supervisores, concesiones ni bloqueos).
 * Por nombre, con quien pide arriba.
 */
export async function encargables(service: Servicio, buzon: { id: string; user_id: string }, pide: { userId: string; role: string }): Promise<Encargable[]> {
  const regla = await cargarReglaEnBloque(service)
  const esAdmin = pide.role === 'admin'
  const salida: Encargable[] = []
  for (const id of regla.personas) {
    const e = puedeEncargarseA(regla, id, buzon, esAdmin)
    if (e) salida.push(e)
  }
  return salida.sort((a, b) => (a.id === pide.userId ? -1 : b.id === pide.userId ? 1 : a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })))
}

/* ------------------------------------------------------------------ */
/* Encargar una conversación y marcarla hecha                          */
/* ------------------------------------------------------------------ */

export const NO_SE_LE_PUEDE_ENCARGAR = 'Esa persona no puede leer este buzón: no se le puede encargar la conversación.'
export const NADIE_LA_LLEVA = 'Esta conversación no la lleva nadie.'

export type ResultadoDeHilo =
  | { ok: true; cambiado: boolean; asignacion: { personaId: string; nombre: string; asignadoAt: string | null; nota: string | null } | null }
  | FalloDeAsignacion

interface EncargoActual {
  persona_id: string
  hecho_at: string | null
  nota: string | null
  asignado_at: string | null
}

async function leerEncargo(service: Servicio, hiloId: string): Promise<EncargoActual | null | 'falta318'> {
  const { data, error } = await service.from('correo_hilo_asignaciones').select('persona_id, hecho_at, nota, asignado_at').eq('hilo_id', hiloId).maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return 'falta318'
    throw new Error('No se ha podido leer quién lleva la conversación.', { cause: error })
  }
  return (data as EncargoActual | null) ?? null
}

/**
 * Encarga una conversación a una persona (o se la quita, con personaId null). Es lo ÚNICO que usa el PATCH de /api/correo/hilos/[id].
 * Quien llama (la ruta) ya ha comprobado que `hechoPor` puede responder en el buzón o es administrador con lectura.
 *   · La persona tiene que poder LEER el buzón con la misma regla que `encargables` (carga en bloque): con la app de Correo, activa y que no sea
 *     partner; y, si quien pide NO es administrador, solo el dueño o alguien con el buzón asignado. Cualquier otra, el mismo 400 (sin decir la vía).
 *   · A quien ya la lleva: solo cambia la nota, sin volver a avisar. Sin `nota` en la petición se conserva la que tenía.
 *   · A otra persona (o a la misma si estaba «hecha»): encargo nuevo y aviso `correo_asignado`, salvo que se lo asigne ella misma.
 */
export async function asignarHilo(
  service: Servicio,
  hechoPor: { id: string; nombre: string; role: string },
  hilo: { id: string; buzonId: string; asunto: string; duenoId: string },
  cambio: { personaId: string | null; nota?: string | null }
): Promise<ResultadoDeHilo> {
  const actual = await leerEncargo(service, hilo.id)
  if (actual === 'falta318') return falta318()

  if (cambio.personaId === null) {
    if (!actual) return { ok: true, cambiado: false, asignacion: null }
    const { error } = await service.from('correo_hilo_asignaciones').delete().eq('hilo_id', hilo.id)
    if (error) throw new Error('No se ha podido quitar a la persona encargada.', { cause: error })
    return { ok: true, cambiado: true, asignacion: null }
  }

  const personaId = cambio.personaId.toLowerCase()
  const regla = await cargarReglaEnBloque(service)
  const persona = puedeEncargarseA(regla, personaId, { id: hilo.buzonId, user_id: hilo.duenoId }, hechoPor.role === 'admin')
  if (!persona) return { ok: false, estado: 400, error: NO_SE_LE_PUEDE_ENCARGAR }

  const notaPedida = cambio.nota === undefined ? undefined : cambio.nota && cambio.nota.trim() !== '' ? cambio.nota.trim().slice(0, MAX_LARGO_DE_NOTA) : null
  const sigue = actual !== null && actual.persona_id === personaId && actual.hecho_at === null

  if (sigue) {
    // Ya la llevaba: como mucho cambia la nota (sin `nota` en la petición, se queda la que tenía), y no se vuelve a avisar
    const nota = notaPedida === undefined ? actual.nota : notaPedida
    if (nota !== actual.nota) {
      const { error } = await service.from('correo_hilo_asignaciones').update({ nota }).eq('hilo_id', hilo.id)
      if (error) throw new Error('No se ha podido cambiar la nota de la conversación.', { cause: error })
    }
    return { ok: true, cambiado: nota !== actual.nota, asignacion: { personaId, nombre: persona.nombre, asignadoAt: actual.asignado_at, nota } }
  }

  const nota = notaPedida ?? null
  const asignadoAt = new Date().toISOString()
  const { error } = await service
    .from('correo_hilo_asignaciones')
    .upsert({ hilo_id: hilo.id, buzon_id: hilo.buzonId, persona_id: personaId, asignado_por: hechoPor.id, nota, asignado_at: asignadoAt, hecho_at: null }, { onConflict: 'hilo_id' })
  if (error) {
    if (isMissingSchema(error)) return falta318()
    throw new Error('No se ha podido encargar la conversación.', { cause: error })
  }

  const aviso = avisoDeAsignacionDeHilo({ userId: personaId, buzonId: hilo.buzonId, hiloId: hilo.id, porId: hechoPor.id, porNombre: hechoPor.nombre, asunto: hilo.asunto, nota, asignadoAt })
  if (aviso) await avisar(service, [aviso])
  return { ok: true, cambiado: true, asignacion: { personaId, nombre: persona.nombre, asignadoAt, nota } }
}

/**
 * Marca hecha (o vuelve a abrir) la conversación encargada. La ruta ya ha comprobado que `hechoPor` es la encargada o puede responder.
 * Reabrirla la cuenta como un encargo nuevo (asignado_at de ahora) y avisa otra vez a la encargada, salvo que la reabra ella misma.
 * Sin nadie encargado: 404.
 */
export async function marcarHiloHecho(
  service: Servicio,
  hechoPor: { id: string; nombre: string },
  hilo: { id: string; buzonId: string; asunto: string },
  hecho: boolean
): Promise<{ ok: true; cambiado: boolean } | FalloDeAsignacion> {
  const actual = await leerEncargo(service, hilo.id)
  if (actual === 'falta318') return falta318()
  if (!actual) return { ok: false, estado: 404, error: NADIE_LA_LLEVA }
  if ((actual.hecho_at !== null) === hecho) return { ok: true, cambiado: false }

  const ahora = new Date().toISOString()
  const { error } = await service
    .from('correo_hilo_asignaciones')
    .update(hecho ? { hecho_at: ahora } : { hecho_at: null, asignado_at: ahora })
    .eq('hilo_id', hilo.id)
  if (error) {
    if (isMissingSchema(error)) return falta318()
    throw new Error('No se ha podido marcar la conversación.', { cause: error })
  }

  if (!hecho) {
    const aviso = avisoDeAsignacionDeHilo({ userId: actual.persona_id, buzonId: hilo.buzonId, hiloId: hilo.id, porId: hechoPor.id, porNombre: hechoPor.nombre, asunto: hilo.asunto, nota: actual.nota, asignadoAt: ahora })
    if (aviso) await avisar(service, [aviso])
  }
  return { ok: true, cambiado: true }
}
