import { randomBytes } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { armarPanel, COLUMNAS_DEL_PORTAL, FORMA_DE_TOKEN_DEL_PORTAL, type FilaParaElPortal, type PanelDelCliente } from './portal'
import { ErrorDeTareas, exigirAcceso } from './servidor'
import type { Permitidos } from './permisos'
import type { ClienteTC } from './tipos'

/**
 * EL ENLACE DEL PANEL DEL CLIENTE (tabla `tc_enlaces_cliente`, migración 278). SOLO SERVIDOR.
 *
 * Igual que el enlace del encaje: el token ES la credencial (256 bits de azar), se puede desactivar o cambiar en cualquier momento y desde fuera un enlace inventado, desactivado
 * o cambiado se contesta igual («no es válido»). La tabla no se puede leer desde el navegador: todo pasa por aquí con la clave de servicio. Qué ve el cliente lo decide portal.ts.
 */

export interface EstadoDelEnlace {
  disponible: boolean
  activo: boolean
  token: string | null
  /** Cuántas tareas marcadas «Ve el cliente» hay ahora mismo */
  visibles: number
  aperturas: number
  ultima_apertura: string | null
}

const faltaLaTabla = (e: { message?: string; code?: string } | null): boolean => Boolean(e && (e.code === '42P01' || /tc_enlaces_cliente/.test(e.message ?? '')))
export const nuevoTokenDelPortal = (): string => randomBytes(32).toString('base64url')

async function contarVisibles(clienteId: string): Promise<number> {
  const { count } = await createServiceClient().from('tc_tareas').select('id', { count: 'exact', head: true }).eq('cliente_id', clienteId).eq('visible_cliente', true).eq('archivada', false)
  return count ?? 0
}

export async function estadoDelEnlace(clienteId: string, permitidos: Permitidos): Promise<EstadoDelEnlace> {
  exigirAcceso(permitidos, clienteId)
  const { data, error } = await createServiceClient().from('tc_enlaces_cliente').select('token, activo, aperturas, ultima_apertura').eq('cliente_id', clienteId).maybeSingle()
  if (error) {
    if (faltaLaTabla(error)) return { disponible: false, activo: false, token: null, visibles: 0, aperturas: 0, ultima_apertura: null }
    throw new ErrorDeTareas(`No se ha podido leer el enlace: ${error.message}`, 500)
  }
  const f = data as { token: string; activo: boolean; aperturas: number; ultima_apertura: string | null } | null
  return { disponible: true, activo: f?.activo ?? false, token: f?.token ?? null, visibles: await contarVisibles(clienteId), aperturas: f?.aperturas ?? 0, ultima_apertura: f?.ultima_apertura ?? null }
}

/** Activa el panel (creando el enlace la primera vez), lo desactiva o cambia el enlace por otro nuevo (el viejo deja de valer). Solo un administrador, comprobado en la ruta */
export async function cambiarEnlace(clienteId: string, quien: string, accion: { activo?: boolean; regenerar?: boolean }): Promise<EstadoDelEnlace> {
  const service = createServiceClient()
  const { data: cliente } = await service.from('tc_clientes').select('id').eq('id', clienteId).maybeSingle()
  if (!cliente) throw new ErrorDeTareas('Ese cliente no existe.', 404)
  const { data: actual, error } = await service.from('tc_enlaces_cliente').select('token, activo').eq('cliente_id', clienteId).maybeSingle()
  if (error) throw new ErrorDeTareas(faltaLaTabla(error) ? 'Falta lanzar la migración 278 en Supabase para compartir el panel con el cliente.' : error.message, faltaLaTabla(error) ? 503 : 500)
  const previo = actual as { token: string; activo: boolean } | null
  const token = !previo || accion.regenerar ? nuevoTokenDelPortal() : previo.token
  const activo = accion.activo ?? (accion.regenerar ? true : previo?.activo ?? true)
  const { error: errorAlGuardar } = await service.from('tc_enlaces_cliente').upsert({ cliente_id: clienteId, token, activo, creado_por: quien, ...(accion.regenerar || !previo ? { aperturas: 0, ultima_apertura: null } : {}) }, { onConflict: 'cliente_id' })
  if (errorAlGuardar) throw new ErrorDeTareas(`No se ha podido guardar el enlace: ${errorAlGuardar.message}`, 500)
  // La marca del cliente sigue al enlace: nada se enseña a un cliente cuyo panel esté apagado
  await service.from('tc_clientes').update({ visible_cliente: activo }).eq('id', clienteId)
  return estadoDelEnlace(clienteId, null)
}

export type ResultadoDelPanel = { ok: true; panel: PanelDelCliente } | { ok: false }

/** Abre el panel con el token de la dirección. Un enlace que no vale (forma rara, inventado, desactivado) devuelve lo mismo: `ok: false` */
export async function abrirPanelDelCliente(token: string): Promise<ResultadoDelPanel> {
  if (!FORMA_DE_TOKEN_DEL_PORTAL.test(token)) return { ok: false }
  const service = createServiceClient()
  const { data: enlace, error } = await service.from('tc_enlaces_cliente').select('cliente_id, activo, aperturas').eq('token', token).maybeSingle()
  const e = enlace as { cliente_id: string; activo: boolean; aperturas: number } | null
  if (error || !e || !e.activo) return { ok: false }
  const { data: cliente } = await service.from('tc_clientes').select('nombre, icono, opciones').eq('id', e.cliente_id).eq('activo', true).maybeSingle()
  if (!cliente) return { ok: false }
  const { data: filas } = await service.from('tc_tareas').select(COLUMNAS_DEL_PORTAL).eq('cliente_id', e.cliente_id).eq('visible_cliente', true).eq('archivada', false).limit(2000)
  // Anotar la apertura no puede impedir que se vea el panel
  void service.from('tc_enlaces_cliente').update({ aperturas: (e.aperturas ?? 0) + 1, ultima_apertura: new Date().toISOString() }).eq('cliente_id', e.cliente_id).then(() => undefined, () => undefined)
  return { ok: true, panel: armarPanel(cliente as Pick<ClienteTC, 'nombre' | 'icono' | 'opciones'>, (filas ?? []) as unknown as FilaParaElPortal[]) }
}
