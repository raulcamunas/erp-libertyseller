import { UUID } from './acceso'
import type { Duracion } from './tipos'

/**
 * PATCH /api/correo/hilos/[id]: QUÉ HACE FALTA PARA CADA CAMBIO, SIN BASE DE DATOS.
 * ===============================================================================
 *   · personales (solo para quien pide): `silenciado`, `silenciarRemitente` → leer
 *   · del buzón (los ve todo el mundo):  `leido`, `destacado` → responder; `asignar` → responder, o ser admin con lectura;
 *                                         `hecho` → leer si quien pide es la encargada, si no responder
 *
 * Una petición que mezcla un campo personal con uno del buzón se rechaza (400): así un supervisor no puede colar un «leído» con un silencio.
 * Con varios campos del buzón se pide el modo MÁS exigente: leer < admin-o-responder < responder.
 */

export type ModoDePeticionDeHilo = 'leer' | 'responder' | 'admin-o-responder'

export interface CamposDePeticionDeHilo {
  destacado?: boolean
  leido?: boolean
  silenciado?: Duracion | 'quitar'
  silenciarRemitente?: Duracion | 'quitar'
  asignar?: { personaId: string | null; nota?: string }
  hecho?: boolean
}

const PERSONALES = ['silenciado', 'silenciarRemitente'] as const
const DEL_BUZON = ['destacado', 'leido', 'asignar', 'hecho'] as const
const EXIGENCIA: Record<ModoDePeticionDeHilo, number> = { leer: 0, 'admin-o-responder': 1, responder: 2 }

export const MAX_LARGO_DE_NOTA = 280

const presente = (campos: object, k: string) => (campos as Record<string, unknown>)[k] !== undefined

/** El modo que exige la petición, o el error si mezcla campos personales con los del buzón o no trae nada */
export function modoDePeticionDeHilo(
  campos: Partial<Record<keyof CamposDePeticionDeHilo, unknown>>,
  ctx: { esEncargada: boolean },
): { ok: true; modo: ModoDePeticionDeHilo } | { ok: false; error: string } {
  const personales = PERSONALES.filter((k) => presente(campos, k))
  const delBuzon = DEL_BUZON.filter((k) => presente(campos, k))
  if (personales.length > 0 && delBuzon.length > 0) {
    return { ok: false, error: 'Silenciar es solo para ti y no se puede mezclar con cambios del buzón en la misma petición.' }
  }
  if (personales.length === 0 && delBuzon.length === 0) return { ok: false, error: 'No hay nada que cambiar.' }
  if (personales.length > 0) return { ok: true, modo: 'leer' }

  let modo: ModoDePeticionDeHilo = 'leer'
  const subir = (m: ModoDePeticionDeHilo) => {
    if (EXIGENCIA[m] > EXIGENCIA[modo]) modo = m
  }
  for (const k of delBuzon) {
    if (k === 'leido' || k === 'destacado') subir('responder')
    else if (k === 'asignar') subir('admin-o-responder')
    else if (k === 'hecho') subir(ctx.esEncargada ? 'leer' : 'responder')
  }
  return { ok: true, modo }
}

const DURACIONES: readonly string[] = ['8h', 'manana', 'semana', 'siempre']
const esSilencio = (v: unknown): v is Duracion | 'quitar' => v === 'quitar' || (typeof v === 'string' && DURACIONES.includes(v))

/** Valida los tipos del cuerpo del PATCH (los campos que no se conocen se ignoran). No decide permisos: eso es `modoDePeticionDeHilo` */
export function validarPeticionDeHilo(entrada: unknown): { ok: true; campos: CamposDePeticionDeHilo } | { ok: false; error: string } {
  if (typeof entrada !== 'object' || entrada === null || Array.isArray(entrada)) return { ok: false, error: 'El cuerpo no es válido.' }
  const e = entrada as Record<string, unknown>
  const campos: CamposDePeticionDeHilo = {}
  for (const k of ['destacado', 'leido', 'hecho'] as const) {
    if (e[k] === undefined) continue
    if (typeof e[k] !== 'boolean') return { ok: false, error: `«${k}» tiene que ser sí o no.` }
    campos[k] = e[k] as boolean
  }
  for (const k of PERSONALES) {
    if (e[k] === undefined) continue
    if (!esSilencio(e[k])) return { ok: false, error: 'La duración del silencio no es válida.' }
    campos[k] = e[k] as Duracion | 'quitar'
  }
  if (e.asignar !== undefined) {
    const a = e.asignar
    if (typeof a !== 'object' || a === null || Array.isArray(a)) return { ok: false, error: 'La asignación no es válida.' }
    const { personaId, nota } = a as Record<string, unknown>
    if (personaId !== null && (typeof personaId !== 'string' || !UUID.test(personaId))) return { ok: false, error: 'La persona no es válida.' }
    if (nota !== undefined && nota !== null && typeof nota !== 'string') return { ok: false, error: 'La nota no es válida.' }
    const notaLimpia = typeof nota === 'string' ? nota.trim() : ''
    if (notaLimpia.length > MAX_LARGO_DE_NOTA) return { ok: false, error: `La nota es demasiado larga (máximo ${MAX_LARGO_DE_NOTA} caracteres).` }
    campos.asignar = { personaId: personaId === null ? null : (personaId as string).toLowerCase(), ...(notaLimpia ? { nota: notaLimpia } : {}) }
  }
  return { ok: true, campos }
}

/** Valida y decide el modo en un paso (lo que usa la ruta) */
export function leerPeticionDeHilo(
  entrada: unknown,
  ctx: { esEncargada: boolean },
): { ok: true; campos: CamposDePeticionDeHilo; modo: ModoDePeticionDeHilo } | { ok: false; error: string } {
  const v = validarPeticionDeHilo(entrada)
  if (!v.ok) return v
  const m = modoDePeticionDeHilo(v.campos, ctx)
  if (!m.ok) return m
  return { ok: true, campos: v.campos, modo: m.modo }
}
