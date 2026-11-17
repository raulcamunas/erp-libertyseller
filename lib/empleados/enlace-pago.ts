import { randomBytes } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { cuentaResumida, validarDatos, type DatosDePago } from './datos-de-pago'

/**
 * EL ENLACE PARA QUE UN EMPLEADO ENVÍE SUS DATOS DE PAGO. SOLO SERVIDOR (migración 320).
 *
 * El token ES la credencial, como en el enlace del encaje (lib/fba/encaje-enlace.ts):
 *
 *   · 256 bits de azar: no se adivina ni se recorre.
 *   · Caduca a los 7 días y sirve UNA vez: al enviar queda usado. Generar uno nuevo desactiva el anterior.
 *   · Solo sirve para ENVIAR. No enseña los datos de nadie, ni los de la propia persona: si el enlace acaba en manos de otro, no saca nada.
 *   · Inventado, caducado, usado o desactivado se contesta igual: «no es válido».
 *
 * Cada envío queda en el historial con fecha e IP. Si alguien cambia la cuenta para desviar un pago, se ve cuándo y desde dónde.
 */

export const DIAS_DE_VIDA = 7
export const FORMA_DE_TOKEN = /^[A-Za-z0-9_-]{43}$/
export const MAX_BYTES = 16 * 1024
const DIA_MS = 86_400_000

export const nuevoToken = () => randomBytes(32).toString('base64url')
export const rutaDelEnlace = (token: string) => `/datos-de-pago/${token}`

export class FaltaMigracion extends Error {
  constructor() {
    super('Falta lanzar la migración 320 (datos de pago de los empleados).')
  }
}

interface FilaEnlace {
  id: string
  employee_id: string
  token: string
  creado_at: string
  caduca_at: string
  usado_at: string | null
  desactivado: boolean
  aperturas: number
}

export type MotivoNoValido = 'formato' | 'no-existe' | 'caducado' | 'usado' | 'desactivado'

export async function crearEnlace(employeeId: string, userId: string): Promise<{ token: string; caduca: string }> {
  const s = createServiceClient()
  const { data: emp, error: e0 } = await s.from('employees').select('id').eq('id', employeeId).maybeSingle()
  if (e0) throw e0
  if (!emp) throw new Error('Ese empleado no existe.')
  // Uno vivo por persona: el nuevo desactiva los anteriores sin usar
  const { error: e1 } = await s.from('employee_payment_links').update({ desactivado: true }).eq('employee_id', employeeId).is('usado_at', null).eq('desactivado', false)
  if (e1) throw isMissingSchema(e1) ? new FaltaMigracion() : e1
  const token = nuevoToken()
  const caduca = new Date(Date.now() + DIAS_DE_VIDA * DIA_MS).toISOString()
  const { error } = await s.from('employee_payment_links').insert({ employee_id: employeeId, token, creado_por: userId, caduca_at: caduca })
  if (error) throw isMissingSchema(error) ? new FaltaMigracion() : error
  return { token, caduca }
}

export async function resolverEnlace(token: string): Promise<{ ok: true; enlace: FilaEnlace; nombre: string } | { ok: false; motivo: MotivoNoValido }> {
  if (!FORMA_DE_TOKEN.test(token)) return { ok: false, motivo: 'formato' }
  const s = createServiceClient()
  const { data, error } = await s.from('employee_payment_links').select('id, employee_id, token, creado_at, caduca_at, usado_at, desactivado, aperturas').eq('token', token).maybeSingle()
  if (error) throw isMissingSchema(error) ? new FaltaMigracion() : error
  const e = data as FilaEnlace | null
  if (!e) return { ok: false, motivo: 'no-existe' }
  if (e.usado_at) return { ok: false, motivo: 'usado' }
  if (e.desactivado) return { ok: false, motivo: 'desactivado' }
  if (Date.parse(e.caduca_at) < Date.now()) return { ok: false, motivo: 'caducado' }
  const { data: emp } = await s.from('employees').select('name').eq('id', e.employee_id).maybeSingle()
  return { ok: true, enlace: e, nombre: (emp as { name?: string } | null)?.name ?? '' }
}

export async function anotarApertura(e: FilaEnlace): Promise<void> {
  try {
    await createServiceClient().from('employee_payment_links').update({ aperturas: e.aperturas + 1, ultima_apertura: new Date().toISOString() }).eq('id', e.id)
  } catch {
    /* que la página salga aunque no se anote */
  }
}

/** Guarda lo enviado: valida, sustituye los datos vigentes, deja rastro, gasta el enlace y avisa a dirección */
export async function guardarDatos(token: string, entrada: Record<string, unknown>, origen: { ip: string | null; userAgent: string | null }): Promise<{ ok: true } | { ok: false; noValido?: true; errores?: Record<string, string> }> {
  const r = await resolverEnlace(token)
  if (!r.ok) return { ok: false, noValido: true }
  const v = validarDatos(entrada)
  if (!v.ok) return { ok: false, errores: v.errores }

  const s = createServiceClient()
  const ahora = new Date().toISOString()
  // Se gasta el enlace PRIMERO y solo si seguía libre: dos envíos a la vez con el mismo enlace no escriben dos veces
  const { data: gastado, error: e0 } = await s.from('employee_payment_links').update({ usado_at: ahora }).eq('id', r.enlace.id).is('usado_at', null).select('id')
  if (e0) throw e0
  if (!gastado?.length) return { ok: false, noValido: true }

  const fila = { employee_id: r.enlace.employee_id, datos: v.datos, enviado_at: ahora, enviado_ip: origen.ip }
  const { error: e1 } = await s.from('employee_payment_details').upsert({ ...fila, actualizado_at: ahora }, { onConflict: 'employee_id' })
  if (e1) {
    // Que no se pierda el enlace por un fallo nuestro
    await s.from('employee_payment_links').update({ usado_at: null }).eq('id', r.enlace.id)
    throw e1
  }
  await s.from('employee_payment_details_historial').insert({ ...fila, user_agent: origen.userAgent?.slice(0, 300) ?? null })

  try {
    const { data: admins } = await s.from('profiles').select('id').eq('role', 'admin')
    const filas = ((admins ?? []) as { id: string }[]).map((a) => ({
      user_id: a.id,
      type: 'datos_de_pago',
      title: 'Datos de pago recibidos',
      message: `${r.nombre || 'Un empleado'} ha enviado sus datos de pago (${v.datos.banco} ${cuentaResumida(v.datos)}). Están en Control empleados.`,
    }))
    if (filas.length) await s.from('notifications').insert(filas)
  } catch (e) {
    console.error('No se ha podido avisar de los datos de pago:', e)
  }
  return { ok: true }
}

export interface EstadoDePago {
  employeeId: string
  nombre: string
  activo: boolean
  datos: { tipo: DatosDePago['tipo']; titular: string; banco: string; paisBanco: string; moneda: string; cuenta: string; enviado: string } | null
  enlace: { token: string; caduca: string; aperturas: number } | null
}

/** Para dirección: de cada empleado, si ya tiene datos (resumidos, sin la cuenta entera) y si tiene un enlace vivo */
export async function estadoDelEquipo(): Promise<EstadoDePago[]> {
  const s = createServiceClient()
  const [emps, detalles, enlaces] = await Promise.all([
    s.from('employees').select('id, name, is_active, ended_on').order('position', { ascending: true, nullsFirst: false }).order('name'),
    s.from('employee_payment_details').select('employee_id, datos, enviado_at'),
    s.from('employee_payment_links').select('employee_id, token, caduca_at, usado_at, desactivado, aperturas, creado_at').is('usado_at', null).eq('desactivado', false).gt('caduca_at', new Date().toISOString()),
  ])
  for (const r of [emps, detalles, enlaces]) if (r.error) throw isMissingSchema(r.error) ? new FaltaMigracion() : r.error
  const det = new Map(((detalles.data ?? []) as { employee_id: string; datos: DatosDePago; enviado_at: string }[]).map((d) => [d.employee_id, d]))
  const enl = new Map(((enlaces.data ?? []) as { employee_id: string; token: string; caduca_at: string; aperturas: number }[]).map((e) => [e.employee_id, e]))
  return ((emps.data ?? []) as { id: string; name: string; is_active: boolean; ended_on: string | null }[]).map((e) => {
    const d = det.get(e.id)
    const l = enl.get(e.id)
    return {
      employeeId: e.id,
      nombre: e.name,
      activo: e.is_active && !e.ended_on,
      datos: d ? { tipo: d.datos.tipo, titular: d.datos.titular, banco: d.datos.banco, paisBanco: d.datos.paisBanco, moneda: d.datos.moneda, cuenta: cuentaResumida(d.datos), enviado: d.enviado_at } : null,
      enlace: l ? { token: l.token, caduca: l.caduca_at, aperturas: l.aperturas } : null,
    }
  })
}
