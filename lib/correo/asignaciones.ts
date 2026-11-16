import { UUID } from './acceso'

/**
 * ASIGNAR UN BUZÓN A UNA PERSONA: LA REGLA, SIN BASE DE DATOS.
 * ===========================================================
 * Solo un administrador asigna. Se asigna a un `employee` o a un `admin` (también a uno mismo); nunca a un partner ni al dueño del buzón.
 * Asignar da lectura, avisos y «Mis correos»; con `puede_responder` (marcado por defecto), además envía desde el buzón (queda anotado quién).
 *
 * El orden de cada cambio importa (como en `cambiarLectores`):
 *   · las acciones que DAN (`asignar`, `responde`) escriben el historial ANTES: si el historial falla, no se cambia nada (nunca un acceso sin rastro);
 *   · las que QUITAN (`solo_avisos`, `quitar`) se aplican ANTES: si el historial falla después, se queda en el registro de errores (nunca un acceso de más
 *     por un historial caído).
 *
 * Asignar quita antes el bloqueo, si lo había (con su `desbloqueado` en el historial): asignación y bloqueo no conviven.
 */

export type AccionDeAsignacion = 'asignar' | 'quitar' | 'responde' | 'solo_avisos'
export const ACCIONES_DE_ASIGNACION: readonly AccionDeAsignacion[] = ['asignar', 'quitar', 'responde', 'solo_avisos']

/** Lo que queda en correo_buzon_lectores_historial por cada acción */
export type AccionDeHistorialDeAsignacion = 'asignado' | 'desasignado' | 'responde' | 'solo_avisos'

export interface PeticionDeAsignacion {
  buzonId: string
  personaId: string
  accion: AccionDeAsignacion
}

/** El cuerpo de POST /api/correo/asignaciones, validado (ids en minúsculas) */
export function validarPeticionDeAsignacion(entrada: unknown): { ok: true; peticion: PeticionDeAsignacion } | { ok: false; error: string } {
  if (typeof entrada !== 'object' || entrada === null || Array.isArray(entrada)) return { ok: false, error: 'El cuerpo no es válido.' }
  const { buzonId, personaId, accion } = entrada as Record<string, unknown>
  if (typeof buzonId !== 'string' || !UUID.test(buzonId)) return { ok: false, error: 'Falta el buzón.' }
  if (typeof personaId !== 'string' || !UUID.test(personaId)) return { ok: false, error: 'Falta la persona.' }
  if (typeof accion !== 'string' || !(ACCIONES_DE_ASIGNACION as readonly string[]).includes(accion)) {
    return { ok: false, error: 'La acción tiene que ser asignar, quitar, responde o solo_avisos.' }
  }
  return { ok: true, peticion: { buzonId: buzonId.toLowerCase(), personaId: personaId.toLowerCase(), accion: accion as AccionDeAsignacion } }
}

export interface EfectosDeAsignar {
  /** Tenía el buzón bloqueado: se quita antes (y se anota `desbloqueado`) */
  quitarBloqueo: boolean
  /** Aviso `correo_asignado` (motivo 'buzon') a la persona. No, si se lo asigna uno mismo */
  avisarPersona: boolean
  /** Aviso `correo_asignado` (motivo 'buzon_dueno') al dueño. No, si quien asigna es el dueño */
  avisarDueno: boolean
  /** El buzón es de otro administrador: la pantalla pide confirmación («Vas a dejar que X escriba como <dirección>») */
  pedirConfirmacion: boolean
}

/**
 * ¿Se puede asignar este buzón a esta persona, y qué más pasa? La ruta comprueba antes que quien asigna es administrador.
 *   · role tiene que ser 'employee' o 'admin' (también quien asigna) → si no, 400
 *   · partner → 400 · dueño del buzón → 400
 */
export function efectosDeAsignar(e: {
  role: string | null | undefined
  esPartner: boolean
  esDueno: boolean
  tieneBloqueo: boolean
  buzonDeOtroAdmin: boolean
  /** Quien asigna se lo asigna a sí mismo */
  aUnoMismo?: boolean
  /** Quien asigna es el dueño del buzón (un admin que asigna su propio buzón) */
  asignaElDueno?: boolean
}): { ok: true; efectos: EfectosDeAsignar } | { ok: false; estado: 400; error: string } {
  if (e.esPartner || e.role === 'partner') return { ok: false, estado: 400, error: 'Un buzón no se puede asignar a un partner.' }
  if (e.esDueno) return { ok: false, estado: 400, error: 'Esa persona es la dueña del buzón: ya lo lleva.' }
  if (e.role !== 'employee' && e.role !== 'admin') return { ok: false, estado: 400, error: 'Solo se puede asignar a alguien del equipo.' }
  return {
    ok: true,
    efectos: {
      quitarBloqueo: e.tieneBloqueo,
      avisarPersona: !e.aUnoMismo,
      avisarDueno: !e.asignaElDueno,
      pedirConfirmacion: e.buzonDeOtroAdmin,
    },
  }
}

/** 'da' = historial primero (si falla, no se cambia nada); 'quita' = aplicar primero y el historial después */
export function ordenDeCambio(accion: AccionDeAsignacion): 'da' | 'quita' {
  return accion === 'asignar' || accion === 'responde' ? 'da' : 'quita'
}

export function accionDeHistorial(accion: AccionDeAsignacion): AccionDeHistorialDeAsignacion {
  switch (accion) {
    case 'asignar':
      return 'asignado'
    case 'quitar':
      return 'desasignado'
    case 'responde':
      return 'responde'
    case 'solo_avisos':
      return 'solo_avisos'
  }
}

/* ------------------------------------------------------------------ */
/* Lo que contesta GET /api/correo/asignaciones                         */
/* ------------------------------------------------------------------ */

export interface AsignacionDeBuzon {
  personaId: string
  nombre: string
  puedeResponder: boolean
  asignadoAt: string
  /** Nombre de quien la hizo, si se sabe */
  asignadoPor: string | null
}

export interface BuzonConAsignaciones {
  id: string
  direccion: string
  nombre: string | null
  dueno: { id: string; nombre: string; role: string | null; puesto: string | null }
  /** El dueño es administrador: asignarlo pide confirmación */
  deAdmin: boolean
  asignaciones: AsignacionDeBuzon[]
}

export interface PersonaAsignable {
  id: string
  nombre: string
  role: 'employee' | 'admin'
  puesto: string | null
  /** Es quien mira: sale la primera («Yo») */
  esYo: boolean
  /** Buzones que tiene bloqueados (asignar quita el bloqueo: la pantalla lo advierte) */
  bloqueados: string[]
}

export interface VistaDeAsignaciones<C = unknown> {
  buzones: BuzonConAsignaciones[]
  personas: PersonaAsignable[]
  cambios: C[]
}

const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })

/**
 * Arma la vista de «Asignaciones» con lo leído de la base:
 *   · buzones por dirección, cada uno con sus asignaciones por nombre (una asignación a alguien que ya no sale en `personas` se enseña igual, para poder
 *     quitarla, con su nombre si se sabe);
 *   · personas a las que se puede asignar: employees y admins activos con la app de Correo; «Yo» la primera, luego por nombre. Nunca partners.
 */
export function armarVistaDeAsignaciones<C = unknown>(e: {
  yoId: string
  buzones: ReadonlyArray<{ id: string; direccion: string; nombre?: string | null; dueno: { id: string; nombre: string; role: string | null; puesto?: string | null } }>
  asignaciones: ReadonlyArray<{ buzon_id: string; persona_id: string; puede_responder: boolean; asignado_por?: string | null; asignado_at: string }>
  personas: ReadonlyArray<{ id: string; nombre: string; role: string | null; puesto?: string | null; activo?: boolean; tieneCorreo?: boolean }>
  bloqueos?: ReadonlyArray<{ buzonId: string; lectorId: string }>
  /** Nombres de personas que no están en `personas` (quien asignó, alguien que ya no es asignable…) */
  nombres?: ReadonlyMap<string, string>
  cambios?: readonly C[]
}): VistaDeAsignaciones<C> {
  const nombreDe = (id: string | null | undefined): string | null => {
    if (!id) return null
    return e.personas.find((p) => p.id === id)?.nombre ?? e.nombres?.get(id) ?? null
  }

  const porBuzon = new Map<string, AsignacionDeBuzon[]>()
  for (const a of e.asignaciones) {
    const lista = porBuzon.get(a.buzon_id) ?? []
    lista.push({
      personaId: a.persona_id,
      nombre: nombreDe(a.persona_id) ?? 'Persona sin nombre',
      puedeResponder: a.puede_responder,
      asignadoAt: a.asignado_at,
      asignadoPor: nombreDe(a.asignado_por),
    })
    porBuzon.set(a.buzon_id, lista)
  }

  const buzones: BuzonConAsignaciones[] = e.buzones
    .map((b) => ({
      id: b.id,
      direccion: b.direccion,
      nombre: b.nombre ?? null,
      dueno: { id: b.dueno.id, nombre: b.dueno.nombre, role: b.dueno.role, puesto: b.dueno.puesto ?? null },
      deAdmin: b.dueno.role === 'admin',
      asignaciones: (porBuzon.get(b.id) ?? []).sort(porNombre),
    }))
    .sort((a, b) => a.direccion.localeCompare(b.direccion, 'es'))

  const bloqueadosDe = new Map<string, string[]>()
  for (const b of e.bloqueos ?? []) {
    const lista = bloqueadosDe.get(b.lectorId) ?? []
    lista.push(b.buzonId)
    bloqueadosDe.set(b.lectorId, lista)
  }

  const personas: PersonaAsignable[] = e.personas
    .filter((p) => (p.role === 'employee' || p.role === 'admin') && p.activo !== false && p.tieneCorreo !== false)
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      role: p.role as 'employee' | 'admin',
      puesto: p.puesto ?? null,
      esYo: p.id === e.yoId,
      bloqueados: bloqueadosDe.get(p.id) ?? [],
    }))
    .sort((a, b) => (a.esYo !== b.esYo ? (a.esYo ? -1 : 1) : porNombre(a, b)))

  return { buzones, personas, cambios: [...(e.cambios ?? [])] }
}

/** El selector de [+ Asignar] de un buzón: las personas asignables menos el dueño y quien ya lo tiene. «Yo» sigue arriba */
export function personasParaAsignar(vista: Pick<VistaDeAsignaciones, 'buzones' | 'personas'>, buzonId: string): PersonaAsignable[] {
  const buzon = vista.buzones.find((b) => b.id === buzonId)
  if (!buzon) return []
  const yaLoTienen = new Set(buzon.asignaciones.map((a) => a.personaId))
  return vista.personas.filter((p) => p.id !== buzon.dueno.id && !yaLoTienen.has(p.id))
}
