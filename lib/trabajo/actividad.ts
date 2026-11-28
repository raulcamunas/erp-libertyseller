import { createServiceClient } from '@/lib/supabase/service'
import { cuentasDeCliente } from '@/lib/ads/cuenta'
import { conexionesDeCliente } from '@/lib/cumplimiento/conexiones'
import { tcClienteDeAmazon } from './servidor'

/**
 * LA ACTIVIDAD DE UN CLIENTE, DE TODOS LOS MÓDULOS JUNTOS (pestaña «Actividad» de Cuentas de clientes). SOLO SERVIDOR. Solo lee.
 *
 * Junta, de los últimos `dias`: los cambios de PPC (ads_cambios_log, de personas y del agente), el registro de Cumplimiento (comentarios, descartes,
 * correcciones), los cambios de ficha de SEO (seo_ediciones), los pasos del ciclo marcados (cuentas_ciclo_hechos) y lo que pasa en sus tareas (tc_actividad).
 * Cada fuente con su tope (no se traen miles de filas para pintar 300) y ordenado del más nuevo al más viejo.
 */

export interface EntradaDeActividad {
  at: string
  modulo: 'ppc' | 'seo' | 'cumplimiento' | 'ciclo' | 'tareas'
  quien: string
  texto: string
  ok: boolean
}

const TOPE_POR_FUENTE = 200

export async function actividadDeCliente(amazonClientId: string, dias = 30): Promise<EntradaDeActividad[]> {
  const s = createServiceClient()
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  const [perfiles, conexiones, tcCliente] = await Promise.all([
    cuentasDeCliente(amazonClientId).catch(() => []),
    conexionesDeCliente(amazonClientId).catch(() => []),
    tcClienteDeAmazon(amazonClientId).catch(() => null),
  ])
  const paisDe = new Map(perfiles.map((p) => [p.id, p.pais]))

  const [ppc, cump, seo, ciclo, tareas] = await Promise.all([
    perfiles.length
      ? s.from('ads_cambios_log').select('perfil_id, nombre_campana, entidad, accion, campo, valor_anterior, valor_nuevo, motivo, origen, ok, error, usuario_id, creado_at').in('perfil_id', perfiles.map((p) => p.id)).gte('creado_at', desde).order('creado_at', { ascending: false }).limit(TOPE_POR_FUENTE)
      : Promise.resolve({ data: [] }),
    s.from('cumplimiento_registro').select('marketplace_id, sku, tipo, texto, autor, created_at').eq('client_id', amazonClientId).gte('created_at', desde).order('created_at', { ascending: false }).limit(TOPE_POR_FUENTE),
    conexiones.length
      ? s.from('seo_ediciones').select('asin, campos, estado, creado_por, enviado_por, created_at').in('connection_id', conexiones.map((c) => c.id)).gte('created_at', desde).order('created_at', { ascending: false }).limit(TOPE_POR_FUENTE)
      : Promise.resolve({ data: [] }),
    s.from('cuentas_ciclo_hechos').select('semana, paso, hecho_por, hecho_at').eq('amazon_client_id', amazonClientId).gte('hecho_at', desde).order('hecho_at', { ascending: false }).limit(TOPE_POR_FUENTE),
    tcCliente ? s.from('tc_actividad').select('tarea_id, actor_nombre, tipo, datos, creado_en').eq('cliente_id', tcCliente).gte('creado_en', desde).order('creado_en', { ascending: false }).limit(TOPE_POR_FUENTE) : Promise.resolve({ data: [] }),
  ])

  type Fila = Record<string, unknown>
  const filasDe = (r: { data?: unknown }) => ((r.data ?? []) as Fila[])
  // Los nombres de las personas que aparecen
  const ids = new Set<string>()
  for (const f of filasDe(ppc)) if (f.usuario_id) ids.add(String(f.usuario_id))
  for (const f of filasDe(cump)) if (f.autor && /^[0-9a-f-]{36}$/i.test(String(f.autor))) ids.add(String(f.autor))
  for (const f of filasDe(seo)) for (const k of ['enviado_por', 'creado_por']) if (f[k]) ids.add(String(f[k]))
  for (const f of filasDe(ciclo)) if (f.hecho_por) ids.add(String(f.hecho_por))
  const nombres = new Map<string, string>()
  if (ids.size > 0) {
    const { data } = await s.from('profiles').select('id, full_name, email').in('id', [...ids])
    for (const p of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) nombres.set(p.id, (p.full_name ?? '').trim() || (p.email ?? '').split('@')[0] || 'Alguien')
  }
  const nombre = (id: unknown, porDefecto: string) => (id ? (nombres.get(String(id)) ?? porDefecto) : porDefecto)
  // Los títulos de las tareas
  const titulos = new Map<string, string>()
  const tareaIds = [...new Set(filasDe(tareas).map((f) => String(f.tarea_id ?? '')).filter(Boolean))]
  if (tareaIds.length > 0) {
    const { data } = await s.from('tc_tareas').select('id, titulo').in('id', tareaIds.slice(0, 300))
    for (const t of (data ?? []) as Array<{ id: string; titulo: string }>) titulos.set(t.id, t.titulo)
  }

  const salida: EntradaDeActividad[] = []
  for (const f of filasDe(ppc)) {
    const quien = f.origen === 'agente' ? 'Agente PPC' : f.origen === 'automatico' ? 'Piloto automático' : nombre(f.usuario_id, 'Alguien')
    const cambio = f.valor_anterior != null || f.valor_nuevo != null ? `: ${f.valor_anterior ?? '—'} → ${f.valor_nuevo ?? '—'}` : ''
    const pais = paisDe.get(String(f.perfil_id))
    salida.push({ at: String(f.creado_at), modulo: 'ppc', quien, ok: f.ok !== false, texto: `${String(f.accion ?? '')} ${String(f.campo ?? f.entidad ?? '')}${cambio}${f.nombre_campana ? ` · ${String(f.nombre_campana)}` : ''}${pais ? ` (${pais})` : ''}${f.ok === false && f.error ? ` · falló: ${String(f.error).slice(0, 120)}` : ''}`.trim() })
  }
  for (const f of filasDe(cump)) {
    const autor = f.autor && /^[0-9a-f-]{36}$/i.test(String(f.autor)) ? nombre(f.autor, 'Alguien') : String(f.autor ?? 'Sistema')
    salida.push({ at: String(f.created_at), modulo: 'cumplimiento', quien: autor, ok: true, texto: `${String(f.tipo ?? '')}${f.sku ? ` ${String(f.sku)}` : ''}${f.texto ? `: ${String(f.texto).slice(0, 200)}` : ''}` })
  }
  for (const f of filasDe(seo)) {
    const campos = Array.isArray(f.campos) ? (f.campos as string[]).join(', ') : ''
    salida.push({ at: String(f.created_at), modulo: 'seo', quien: nombre(f.enviado_por ?? f.creado_por, 'Alguien'), ok: !['error', 'no_aplicada', 'rechazada'].includes(String(f.estado)), texto: `Cambio de ficha de ${String(f.asin ?? '')}${campos ? ` (${campos})` : ''}: ${String(f.estado ?? '')}` })
  }
  for (const f of filasDe(ciclo)) salida.push({ at: String(f.hecho_at), modulo: 'ciclo', quien: nombre(f.hecho_por, 'Alguien'), ok: true, texto: `Paso del ciclo hecho: ${String(f.paso ?? '')} (semana del ${String(f.semana ?? '')})` })
  for (const f of filasDe(tareas)) salida.push({ at: String(f.creado_en), modulo: 'tareas', quien: String(f.actor_nombre || 'Alguien'), ok: true, texto: `${String(f.tipo ?? '')} «${titulos.get(String(f.tarea_id)) ?? 'tarea'}»` })

  return salida.filter((x) => x.at && x.at !== 'undefined').sort((a, b) => b.at.localeCompare(a.at)).slice(0, 400)
}
