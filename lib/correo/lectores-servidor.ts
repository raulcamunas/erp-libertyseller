import type { createServiceClient } from '@/lib/supabase/service'
import { PERMISO_CORREO_SUPERVISION, PERMISO_EQUIPO_COMERCIAL } from '@/lib/config/apps'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { armarMatriz, decidirCambios, type Bloqueo, type BuzonDeLaMatriz, type CambioDeLector, type CambioReciente, type Concesion, type DatosDeLaMatriz, type PeticionDeCambio, type PersonaDeLaMatriz } from './lectores'

/**
 * LOS BUZONES ABIERTOS A MANO: LEERLOS Y CAMBIARLOS — SOLO SERVIDOR.
 * ==================================================================
 * Lo que dice la migración 255. La tabla correo_buzon_lectores está cerrada al navegador: esto la lee con la clave de servicio, y solo lo llaman
 *   · quienPide (lib/correo/servidor.ts), para saber qué buzones ajenos puede leer quien pide, y
 *   · la ruta de administradores /api/correo/lectores, que es la ÚNICA que escribe.
 *
 * SIN LA MIGRACIÓN NADA SE ROMPE: quien pide no tiene ningún buzón abierto y Correo sigue como siempre. Solo la pantalla «Quién ve qué» lo dice, con el nombre del
 * fichero que hay que lanzar.
 *
 * LOS BUZONES BLOQUEADOS (migración 260, tabla correo_buzon_bloqueos) van por el mismo camino: un administrador le bloquea a una persona un buzón concreto y esa persona no lo lee
 * por ningún permiso. quienPide los carga con los abiertos, y la regla de acceso (lib/correo/acceso.ts) los respeta. Sin la 260 no hay ninguno y la pantalla no ofrece bloquear.
 * A diferencia de los abiertos, si la lectura de los bloqueados FALLA por otra cosa que no sea la tabla que falta, se falla también la petición: dejar leer un buzón porque no se
 * pudo comprobar que estaba bloqueado sería abrirlo.
 */

type Servicio = ReturnType<typeof createServiceClient>

export const FALTA_MIGRACION_LECTORES = 'Falta lanzar la migración 255_correo_lectores_por_buzon.sql en el editor SQL de Supabase: hasta entonces no se pueden abrir buzones uno a uno. El resto de Correo no se ve afectado.'

export class FaltaMigracionDeLectores extends Error {
  constructor() {
    super(FALTA_MIGRACION_LECTORES)
    this.name = 'FaltaMigracionDeLectores'
  }
}

export const FALTA_MIGRACION_BLOQUEOS = 'Falta lanzar la migración 260_correo_buzones_bloqueados.sql en el editor SQL de Supabase: hasta entonces no se pueden bloquear buzones a una persona. El resto de Correo no se ve afectado.'

export class FaltaMigracionDeBloqueos extends Error {
  constructor() {
    super(FALTA_MIGRACION_BLOQUEOS)
    this.name = 'FaltaMigracionDeBloqueos'
  }
}

const nombreDe = (p: { full_name: string | null; email: string | null }): string => p.full_name?.trim() || p.email || 'Sin nombre'

/** Los buzones que esta persona tiene abiertos a mano. Sin la tabla (migración sin lanzar), ninguno */
export async function buzonesConcedidosA(service: Servicio, userId: string): Promise<Set<string>> {
  const { data, error } = await service.from('correo_buzon_lectores').select('buzon_id').eq('lector_id', userId)
  if (error) {
    if (isMissingSchema(error)) return new Set()
    throw new Error('No se han podido comprobar los buzones abiertos.', { cause: error })
  }
  return new Set(((data ?? []) as Array<{ buzon_id: string }>).map((f) => f.buzon_id))
}

/** Los buzones que un administrador le tiene BLOQUEADOS a esta persona. Sin la tabla (migración 260 sin lanzar), ninguno. Cualquier otro fallo se propaga: no se abre lo que no se pudo comprobar */
export async function buzonesBloqueadosA(service: Servicio, userId: string): Promise<Set<string>> {
  const { data, error } = await service.from('correo_buzon_bloqueos').select('buzon_id').eq('lector_id', userId)
  if (error) {
    if (isMissingSchema(error)) return new Set()
    throw new Error('No se han podido comprobar los buzones bloqueados.', { cause: error })
  }
  return new Set(((data ?? []) as Array<{ buzon_id: string }>).map((f) => f.buzon_id))
}

interface PerfilLeido {
  id: string
  full_name: string | null
  email: string | null
  role: string | null
  is_comercial: boolean | null
  /** Migración 257 */
  puesto: string | null
}

/** Lo que enseña «Quién ve qué»: la matriz de personas por buzón, los bloqueos y los últimos cambios. Lanza FaltaMigracionDeLectores si falta la migración 255; sin la 260 sale sin bloqueos y lo dice */
export async function leerDatosDeLaMatriz(service: Servicio): Promise<DatosDeLaMatriz> {
  const lecturas = await Promise.all([
    service.from('correo_buzones').select('id, user_id, direccion, nombre').order('direccion', { ascending: true }),
    service.from('correo_buzon_lectores').select('buzon_id, lector_id, concedido_por, concedido_at'),
    service.from('correo_buzon_lectores_historial').select('accion, buzon_direccion, lector_nombre, hecho_por_nombre, hecho_at').order('hecho_at', { ascending: false }).limit(15),
    service.from('profiles').select('id, full_name, email, role, is_comercial, puesto').eq('role', 'employee'),
    service.from('user_app_permissions').select('user_id, app_id').in('app_id', ['correo', PERMISO_EQUIPO_COMERCIAL, PERMISO_CORREO_SUPERVISION]).eq('can_access', true),
    service.from('correo_buzon_bloqueos').select('buzon_id, lector_id, bloqueado_por, bloqueado_at'),
  ])
  const [buzonesR, lectoresR, historialR, empleadosR, permisosR, bloqueosR] = lecturas
  for (const r of [lectoresR, historialR]) {
    if (r.error) {
      if (isMissingSchema(r.error)) throw new FaltaMigracionDeLectores()
      throw new Error('No se han podido leer los buzones abiertos.', { cause: r.error })
    }
  }
  if (buzonesR.error) throw new Error('No se han podido leer los buzones.', { cause: buzonesR.error })
  if (empleadosR.error) throw new Error('No se han podido leer las personas del equipo.', { cause: empleadosR.error })
  if (permisosR.error) throw new Error('No se han podido leer los permisos.', { cause: permisosR.error })
  // Los bloqueos son de la migración 260: sin ella no hay ninguno y la pantalla no ofrece bloquear. Cualquier otro error sí rompe
  let bloqueosDisponibles = true
  if (bloqueosR.error) {
    if (!isMissingSchema(bloqueosR.error)) throw new Error('No se han podido leer los buzones bloqueados.', { cause: bloqueosR.error })
    bloqueosDisponibles = false
  }

  const buzones = (buzonesR.data ?? []) as Array<{ id: string; user_id: string; direccion: string; nombre: string | null }>
  const filasLectores = (lectoresR.data ?? []) as Array<{ buzon_id: string; lector_id: string; concedido_por: string | null; concedido_at: string }>
  const filasBloqueos = (bloqueosDisponibles ? (bloqueosR.data ?? []) : []) as Array<{ buzon_id: string; lector_id: string; bloqueado_por: string | null; bloqueado_at: string }>
  const empleados = (empleadosR.data ?? []) as PerfilLeido[]

  // Los dueños de buzón y quienes los abrieron pueden no ser employees (un administrador): se piden aparte lo que falte
  const conocidos = new Map(empleados.map((p) => [p.id, p]))
  const faltan = [...new Set([...buzones.map((b) => b.user_id), ...filasLectores.flatMap((f) => [f.lector_id, f.concedido_por ?? '']), ...filasBloqueos.flatMap((f) => [f.lector_id, f.bloqueado_por ?? ''])])].filter((i) => i !== '' && !conocidos.has(i))
  if (faltan.length > 0) {
    const { data, error } = await service.from('profiles').select('id, full_name, email, role, is_comercial, puesto').in('id', faltan)
    if (error) throw new Error('No se han podido leer los dueños de los buzones.', { cause: error })
    for (const p of (data ?? []) as PerfilLeido[]) conocidos.set(p.id, p)
  }

  const permisos = (permisosR.data ?? []) as Array<{ user_id: string; app_id: string }>
  const tiene = (userId: string, app: string) => permisos.some((p) => p.user_id === userId && p.app_id === app)

  // Las personas de la matriz: los employees y, si alguien con un buzón abierto o bloqueado ya no lo es, también (para poder quitárselo)
  const idsDePersonas = new Set([...empleados.map((p) => p.id), ...filasLectores.map((f) => f.lector_id), ...filasBloqueos.map((f) => f.lector_id)])
  const personas: PersonaDeLaMatriz[] = [...idsDePersonas]
    .map((id) => conocidos.get(id))
    .filter((p): p is PerfilLeido => p !== undefined)
    .map((p) => ({
      id: p.id,
      nombre: nombreDe(p),
      email: p.email,
      role: p.role ?? 'employee',
      tieneCorreo: tiene(p.id, 'correo'),
      permisoEquipo: tiene(p.id, PERMISO_EQUIPO_COMERCIAL),
      permisoCorreo: tiene(p.id, PERMISO_CORREO_SUPERVISION),
    }))

  const buzonesMatriz: BuzonDeLaMatriz[] = buzones.map((b) => {
    const dueno = conocidos.get(b.user_id)
    return { id: b.id, direccion: b.direccion, nombre: b.nombre, dueno: { id: b.user_id, nombre: dueno ? nombreDe(dueno) : 'Sin nombre', role: dueno?.role ?? null, esComercial: dueno?.is_comercial ?? null, puesto: dueno?.puesto ?? null } }
  })

  const concesiones: Concesion[] = filasLectores.map((f) => ({ buzonId: f.buzon_id, lectorId: f.lector_id, por: f.concedido_por ? (conocidos.get(f.concedido_por) ? nombreDe(conocidos.get(f.concedido_por)!) : null) : null, desde: f.concedido_at }))

  const nombreDeQuien = (id: string | null): string | null => (id && conocidos.get(id) ? nombreDe(conocidos.get(id)!) : null)
  const bloqueos: Bloqueo[] = filasBloqueos.map((f) => ({ buzonId: f.buzon_id, lectorId: f.lector_id, por: nombreDeQuien(f.bloqueado_por), desde: f.bloqueado_at }))

  const recientes = ((historialR.data ?? []) as Array<{ accion: CambioReciente['accion']; buzon_direccion: string; lector_nombre: string; hecho_por_nombre: string; hecho_at: string }>).map((h) => ({
    accion: h.accion,
    buzon: h.buzon_direccion,
    lector: h.lector_nombre,
    porQuien: h.hecho_por_nombre,
    cuando: h.hecho_at,
  }))

  return { matriz: armarMatriz({ personas, buzones: buzonesMatriz, concesiones, bloqueos }), concesiones, bloqueos, bloqueosDisponibles, recientes }
}

export interface ResultadoDeCambiar {
  ok: true
  concedidos: number
  quitados: number
  bloqueados: number
  desbloqueados: number
  rechazados: Array<{ buzonId: string; motivo: string }>
}

const esDeLectura = (c: CambioDeLector): c is Extract<CambioDeLector, { leer: boolean }> => typeof c.leer === 'boolean'
const esDeBloqueo = (c: CambioDeLector): c is Extract<CambioDeLector, { bloquear: boolean }> => typeof c.bloquear === 'boolean'

/**
 * Abre, cierra, bloquea o desbloquea buzones a una persona. Solo lo que cambia de verdad deja rastro en el historial (abrir uno ya abierto, cerrar uno cerrado, bloquear uno ya
 * bloqueado o desbloquear uno que no lo estaba no hace nada). Quien llama ya ha comprobado que es un administrador. Devuelve un fallo con estado y frase si la petición no es posible.
 *
 * El orden importa cuando algo falla a medias: primero lo que QUITA acceso (cerrar y bloquear) y después lo que lo DA (abrir y desbloquear). Así, si algo se rompe en medio,
 * lo que queda hecho es siempre el lado seguro.
 */
export async function cambiarLectores(service: Servicio, hechoPor: { id: string; nombre: string }, peticion: PeticionDeCambio): Promise<ResultadoDeCambiar | { ok: false; estado: number; error: string }> {
  const { data: perfil, error: errorPerfil } = await service.from('profiles').select('id, full_name, email, role').eq('id', peticion.lectorId).maybeSingle()
  if (errorPerfil) throw new Error('No se ha podido leer a la persona.', { cause: errorPerfil })
  const lector = perfil as { id: string; full_name: string | null; email: string | null; role: string | null } | null

  const { data: filasBuzones, error: errorBuzones } = await service.from('correo_buzones').select('id, user_id, direccion').in('id', peticion.cambios.map((c) => c.buzonId))
  if (errorBuzones) throw new Error('No se han podido leer los buzones.', { cause: errorBuzones })
  const buzones = new Map(((filasBuzones ?? []) as Array<{ id: string; user_id: string; direccion: string }>).map((b) => [b.id, b]))

  const decision = decidirCambios(lector ? { id: lector.id, role: lector.role ?? '' } : null, new Map([...buzones].map(([id, b]) => [id, { dueno: b.user_id }])), peticion)
  if (!decision.ok) return decision
  const sinCambios: ResultadoDeCambiar = { ok: true, concedidos: 0, quitados: 0, bloqueados: 0, desbloqueados: 0, rechazados: decision.rechazados }
  if (decision.aplicar.length === 0) return sinCambios

  const deLectura = decision.aplicar.filter(esDeLectura)
  const deBloqueo = decision.aplicar.filter(esDeBloqueo)

  // Lo que ya está abierto y lo que ya está bloqueado, para no repetir ni anotar cambios que no lo son
  let abiertos = new Set<string>()
  if (deLectura.length > 0) {
    const { data, error } = await service.from('correo_buzon_lectores').select('buzon_id').eq('lector_id', peticion.lectorId).in('buzon_id', deLectura.map((c) => c.buzonId))
    if (error) {
      if (isMissingSchema(error)) throw new FaltaMigracionDeLectores()
      throw new Error('No se han podido leer los buzones abiertos.', { cause: error })
    }
    abiertos = new Set(((data ?? []) as Array<{ buzon_id: string }>).map((f) => f.buzon_id))
  }
  let bloqueadosAhora = new Map<string, { bloqueado_por: string | null; bloqueado_at: string }>()
  if (deBloqueo.length > 0) {
    const { data, error } = await service.from('correo_buzon_bloqueos').select('buzon_id, bloqueado_por, bloqueado_at').eq('lector_id', peticion.lectorId).in('buzon_id', deBloqueo.map((c) => c.buzonId))
    if (error) {
      if (isMissingSchema(error)) throw new FaltaMigracionDeBloqueos()
      throw new Error('No se han podido leer los buzones bloqueados.', { cause: error })
    }
    bloqueadosAhora = new Map(((data ?? []) as Array<{ buzon_id: string; bloqueado_por: string | null; bloqueado_at: string }>).map((f) => [f.buzon_id, { bloqueado_por: f.bloqueado_por, bloqueado_at: f.bloqueado_at }]))
  }

  const abrir = deLectura.filter((c) => c.leer && !abiertos.has(c.buzonId)).map((c) => c.buzonId)
  const cerrar = deLectura.filter((c) => !c.leer && abiertos.has(c.buzonId)).map((c) => c.buzonId)
  const bloquear = deBloqueo.filter((c) => c.bloquear && !bloqueadosAhora.has(c.buzonId)).map((c) => c.buzonId)
  const desbloquear = deBloqueo.filter((c) => !c.bloquear && bloqueadosAhora.has(c.buzonId)).map((c) => c.buzonId)

  const nombreDelLector = lector ? nombreDe(lector) : 'Sin nombre'
  const filaDeHistorial = (id: string, accion: CambioReciente['accion']) => ({
    buzon_id: id,
    buzon_direccion: buzones.get(id)?.direccion ?? '',
    lector_id: peticion.lectorId,
    lector_nombre: nombreDelLector,
    accion,
    hecho_por: hechoPor.id,
    hecho_por_nombre: hechoPor.nombre,
  })

  // LO QUE QUITA ACCESO NO DEPENDE DE PODER ANOTARLO: quitar un permiso o bloquear un buzón no puede quedarse sin hacer porque el rastro falle. Se hace primero y el rastro va después
  if (cerrar.length > 0) {
    const { error } = await service.from('correo_buzon_lectores').delete().eq('lector_id', peticion.lectorId).in('buzon_id', cerrar)
    if (error) throw new Error('No se han podido cerrar los buzones.', { cause: error })
    const rastro = await service.from('correo_buzon_lectores_historial').insert(cerrar.map((id) => filaDeHistorial(id, 'quitado')))
    if (rastro.error) console.error('[correo] no se ha podido anotar el cierre de un buzón', { codigo: (rastro.error as { code?: string }).code ?? null })
  }
  if (bloquear.length > 0) {
    const { error } = await service.from('correo_buzon_bloqueos').insert(bloquear.map((buzon_id) => ({ buzon_id, lector_id: peticion.lectorId, bloqueado_por: hechoPor.id })))
    if (error) {
      if (isMissingSchema(error)) throw new FaltaMigracionDeBloqueos()
      throw new Error('No se han podido bloquear los buzones.', { cause: error })
    }
    const rastro = await service.from('correo_buzon_lectores_historial').insert(bloquear.map((id) => filaDeHistorial(id, 'bloqueado')))
    if (rastro.error) console.error('[correo] no se ha podido anotar el bloqueo de un buzón', { codigo: (rastro.error as { code?: string }).code ?? null })
  }

  // LO QUE DA ACCESO NO SE DEJA A MEDIAS: un buzón abierto (o desbloqueado) sin rastro de quién lo hizo es justo lo que esta auditoría existe para evitar. Si el rastro no se puede
  // escribir, se deshace lo hecho y se avisa
  if (abrir.length > 0) {
    const { error } = await service.from('correo_buzon_lectores').insert(abrir.map((buzon_id) => ({ buzon_id, lector_id: peticion.lectorId, concedido_por: hechoPor.id })))
    if (error) throw new Error('No se han podido abrir los buzones.', { cause: error })
    const rastro = await service.from('correo_buzon_lectores_historial').insert(abrir.map((id) => filaDeHistorial(id, 'concedido')))
    if (rastro.error) {
      await service.from('correo_buzon_lectores').delete().eq('lector_id', peticion.lectorId).in('buzon_id', abrir)
      throw new Error('No se ha podido dejar constancia del cambio, así que no se ha abierto ningún buzón.', { cause: rastro.error })
    }
  }
  if (desbloquear.length > 0) {
    const { error } = await service.from('correo_buzon_bloqueos').delete().eq('lector_id', peticion.lectorId).in('buzon_id', desbloquear)
    if (error) throw new Error('No se han podido desbloquear los buzones.', { cause: error })
    const rastro = await service.from('correo_buzon_lectores_historial').insert(desbloquear.map((id) => filaDeHistorial(id, 'desbloqueado')))
    if (rastro.error) {
      // Se vuelven a bloquear tal como estaban (con quién y cuándo), para que el bloqueo no se pierda sin rastro
      await service.from('correo_buzon_bloqueos').insert(desbloquear.map((buzon_id) => ({ buzon_id, lector_id: peticion.lectorId, ...bloqueadosAhora.get(buzon_id) })))
      throw new Error('No se ha podido dejar constancia del cambio, así que no se ha desbloqueado ningún buzón.', { cause: rastro.error })
    }
  }

  return { ...sinCambios, concedidos: abrir.length, quitados: cerrar.length, bloqueados: bloquear.length, desbloqueados: desbloquear.length }
}
