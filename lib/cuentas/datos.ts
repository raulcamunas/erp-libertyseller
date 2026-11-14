/**
 * CUENTAS DE CLIENTES · LO GUARDADO: responsable, inicio del ciclo y pasos hechos (migración 307). SOLO SERVIDOR.
 *
 * Las tablas están cerradas al navegador: se leen y escriben aquí con el cliente de servicio, detrás de requireAppDeCuentas().
 * Sin la 307 lanzada todo sigue funcionando: no hay responsables ni ciclo, y la pantalla dice qué falta.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { APP_CUENTAS } from './acceso'

export interface GestionDeCuenta {
  amazonClientId: string
  responsableId: string | null
  cicloInicio: string | null
  notas: string | null
  /** A quién se manda el informe (se recuerda la última dirección usada) */
  correoInformes: string | null
}

export interface Persona {
  id: string
  nombre: string
}

export const FALTA_307 = 'Falta lanzar la migración 307 en Supabase: sin ella no se guardan el responsable ni el ciclo de cada cliente.'

/** Lo guardado de todos los clientes. `falta307` = la tabla no existe todavía */
export async function leerGestion(): Promise<{ porCliente: Map<string, GestionDeCuenta>; falta307: boolean }> {
  const { data, error } = await createServiceClient().from('cuentas_gestion').select('amazon_client_id, responsable_id, ciclo_inicio, notas, correo_informes')
  if (error) {
    if (isMissingSchema(error)) return { porCliente: new Map(), falta307: true }
    throw error
  }
  const porCliente = new Map<string, GestionDeCuenta>()
  for (const r of (data ?? []) as Array<{ amazon_client_id: string; responsable_id: string | null; ciclo_inicio: string | null; notas: string | null; correo_informes: string | null }>) {
    porCliente.set(r.amazon_client_id, { amazonClientId: r.amazon_client_id, responsableId: r.responsable_id, cicloInicio: r.ciclo_inicio, notas: r.notas, correoInformes: r.correo_informes })
  }
  return { porCliente, falta307: false }
}

export async function guardarGestion(amazonClientId: string, cambios: Partial<Pick<GestionDeCuenta, 'responsableId' | 'cicloInicio' | 'notas' | 'correoInformes'>>, userId: string): Promise<void> {
  const fila: Record<string, unknown> = { amazon_client_id: amazonClientId, updated_at: new Date().toISOString(), updated_by: userId }
  if ('responsableId' in cambios) fila.responsable_id = cambios.responsableId
  if ('cicloInicio' in cambios) fila.ciclo_inicio = cambios.cicloInicio
  if ('notas' in cambios) fila.notas = cambios.notas
  if ('correoInformes' in cambios) fila.correo_informes = cambios.correoInformes
  const { error } = await createServiceClient().from('cuentas_gestion').upsert(fila, { onConflict: 'amazon_client_id' })
  if (error) throw error
}

/** Los pasos marcados como hechos de una semana (su lunes), por cliente */
export async function leerHechos(semanas: ReadonlyArray<{ amazonClientId: string; lunes: string }>): Promise<Map<string, Set<string>>> {
  const salida = new Map<string, Set<string>>()
  if (semanas.length === 0) return salida
  const lunes = [...new Set(semanas.map((s) => s.lunes))]
  const { data, error } = await createServiceClient()
    .from('cuentas_ciclo_hechos')
    .select('amazon_client_id, semana, paso')
    .in('amazon_client_id', semanas.map((s) => s.amazonClientId))
    .in('semana', lunes)
  if (error) {
    if (isMissingSchema(error)) return salida
    throw error
  }
  const quiero = new Set(semanas.map((s) => `${s.amazonClientId}|${s.lunes}`))
  for (const r of (data ?? []) as Array<{ amazon_client_id: string; semana: string; paso: string }>) {
    if (!quiero.has(`${r.amazon_client_id}|${r.semana}`)) continue
    const set = salida.get(r.amazon_client_id) ?? new Set<string>()
    set.add(r.paso)
    salida.set(r.amazon_client_id, set)
  }
  return salida
}

export async function marcarPaso(amazonClientId: string, lunes: string, paso: string, hecho: boolean, userId: string): Promise<void> {
  const s = createServiceClient()
  if (hecho) {
    const { error } = await s.from('cuentas_ciclo_hechos').upsert({ amazon_client_id: amazonClientId, semana: lunes, paso, hecho_por: userId, hecho_at: new Date().toISOString() }, { onConflict: 'amazon_client_id,semana,paso' })
    if (error) throw error
  } else {
    const { error } = await s.from('cuentas_ciclo_hechos').delete().eq('amazon_client_id', amazonClientId).eq('semana', lunes).eq('paso', paso)
    if (error) throw error
  }
}

/** Quién puede ser responsable de una cuenta: los administradores (no CEO) y los empleados con la casilla de «Cuentas de clientes» */
export async function personasQueLlevanCuentas(): Promise<Persona[]> {
  const s = createServiceClient()
  const [{ data: perfiles }, { data: permisos }] = await Promise.all([
    s.from('profiles').select('id, full_name, role, puesto'),
    s.from('user_app_permissions').select('user_id').eq('app_id', APP_CUENTAS).eq('can_access', true),
  ])
  const conCasilla = new Set(((permisos ?? []) as Array<{ user_id: string }>).map((p) => p.user_id))
  return ((perfiles ?? []) as Array<{ id: string; full_name: string | null; role: string | null; puesto: string | null }>)
    .filter((p) => (p.role === 'admin' && p.puesto !== 'ceo') || (p.role === 'employee' && conCasilla.has(p.id)) || (p.role === 'admin' && conCasilla.has(p.id)))
    .map((p) => ({ id: p.id, nombre: (p.full_name ?? '').trim() || 'Sin nombre' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}
