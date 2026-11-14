import { createServiceClient } from '@/lib/supabase/service'
import { notionConfigurado } from './notion/cliente'
import { escrituraPermitida } from './notion/sync'
import { REUNIONES_DESDE } from './reuniones'
import { claveDeAjuste, COMPROBACIONES_MANUALES, evaluar, resumir, type Comprobacion, type Metricas, type ResumenDeSalida } from './salida'

/** Las tablas de las migraciones 275 a 280: si falta alguna, hay una migración sin lanzar */
const TABLAS_ESPERADAS = ['tc_tareas', 'tc_plantillas', 'tc_acceso_clientes', 'tc_versiones', 'tc_adjuntos', 'tc_subtareas', 'tc_auto_config', 'tc_briefings', 'tc_reuniones', 'tc_propuestas', 'push_suscripciones'] as const
const INTENTOS_ATASCADA = 6
const HORA = 3_600_000

export interface EstadoDeSalida {
  comprobaciones: Comprobacion[]
  manuales: Array<{ clave: string; titulo: string; descripcion: string; final: boolean; hecho: boolean }>
  resumen: ResumenDeSalida
  medidoEn: string
}

/** Una cuenta que, si la tabla no existe todavía, no tumba la pantalla: devuelve null y lo cuenta como «falta» */
async function contar(consulta: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number | null> {
  const { count, error } = await consulta
  return error ? null : count ?? 0
}

export async function recogerMetricas(ahora: number = Date.now()): Promise<Metricas> {
  const service = createServiceClient()
  const hace = (ms: number) => new Date(ahora - ms).toISOString()
  const cabeza = { count: 'exact' as const, head: true }

  const [conNotion, conError, cola, atascada, eventos, enviadas, conErrorErp, cron, actividad, push, reuniones, aceptadas, existen] = await Promise.all([
    contar(service.from('tc_clientes').select('id', cabeza).eq('activo', true).not('notion_db_id', 'is', null)),
    contar(service.from('tc_clientes').select('id', cabeza).eq('activo', true).not('notion_db_id', 'is', null).not('sync_error', 'is', null)),
    contar(service.from('tc_notion_cola').select('id', cabeza).is('hecho_en', null)),
    contar(service.from('tc_notion_cola').select('id', cabeza).is('hecho_en', null).gte('intentos', INTENTOS_ATASCADA)),
    contar(service.from('tc_notion_eventos').select('id', cabeza).gte('recibido_en', hace(24 * HORA))),
    contar(service.from('tc_tareas').select('id', cabeza).eq('origen', 'erp').eq('sync_estado', 'ok').not('notion_page_id', 'is', null)),
    contar(service.from('tc_tareas').select('id', cabeza).eq('origen', 'erp').eq('sync_estado', 'error')),
    service.from('cron_ejecuciones').select('iniciado_at').eq('tarea', 'tareas-notion').eq('ok', true).order('iniciado_at', { ascending: false }).limit(1),
    // Quién ha hecho algo esta semana: se cuentan acciones por persona (las filas son pocas: un día de trabajo del equipo)
    service.from('tc_actividad').select('actor_id').gte('creado_en', hace(7 * 24 * HORA)).not('actor_id', 'is', null).limit(5000),
    contar(service.from('push_suscripciones').select('id', cabeza)),
    contar(service.from('tc_reuniones').select('id', cabeza).in('estado', ['analizada', 'sin_propuestas']).gte('creada_en', `${REUNIONES_DESDE}T00:00:00Z`)),
    contar(service.from('tc_propuestas').select('id', cabeza).eq('estado', 'aceptada').gte('creada_en', `${REUNIONES_DESDE}T00:00:00Z`)),
    Promise.all(TABLAS_ESPERADAS.map(async (t) => ({ t, n: await contar(service.from(t).select('*', cabeza).limit(1)) }))),
  ])

  const [tabla, imagen, desplegable] = await Promise.all(
    (['tabla', 'imagen', 'desplegable'] as const).map((tipo) =>
      contar(service.from('tc_tareas').select('id', cabeza).eq('origen', 'erp').eq('sync_estado', 'ok').not('notion_page_id', 'is', null).contains('contenido', [{ tipo }])),
    ),
  )

  const porPersona = new Map<string, number>()
  for (const f of (actividad.data ?? []) as Array<{ actor_id: string }>) porPersona.set(f.actor_id, (porPersona.get(f.actor_id) ?? 0) + 1)

  return {
    notionConfigurado: notionConfigurado(),
    escrituraActiva: escrituraPermitida(),
    clientesConNotion: conNotion ?? 0,
    clientesConError: conError ?? 0,
    cronUltimoOk: ((cron.data ?? [])[0] as { iniciado_at?: string } | undefined)?.iniciado_at ?? null,
    colaPendiente: cola ?? 0,
    colaAtascada: atascada ?? 0,
    eventosDelWebhook24h: eventos ?? 0,
    tareasDelErpEnviadas: enviadas ?? 0,
    tareasDelErpConError: conErrorErp ?? 0,
    conTabla: tabla ?? 0,
    conImagen: imagen ?? 0,
    conDesplegable: desplegable ?? 0,
    personasActivas7d: [...porPersona.values()].filter((n) => n >= 10).length,
    dispositivosPush: push ?? 0,
    reunionesAnalizadas: reuniones ?? 0,
    propuestasAceptadas: aceptadas ?? 0,
    tablasQueFaltan: existen.filter((e) => e.n === null).map((e) => e.t),
  }
}

async function leerManuales(): Promise<Map<string, boolean>> {
  const service = createServiceClient()
  const { data } = await service.from('app_settings').select('key, value').in('key', COMPROBACIONES_MANUALES.map((c) => claveDeAjuste(c.clave)))
  return new Map(((data ?? []) as Array<{ key: string; value: number | string }>).map((f) => [f.key, Number(f.value) === 1]))
}

export async function estadoDeLaSalida(): Promise<EstadoDeSalida> {
  const [metricas, guardadas] = await Promise.all([recogerMetricas(), leerManuales()])
  const comprobaciones = evaluar(metricas)
  const manuales = COMPROBACIONES_MANUALES.map((c) => ({ clave: c.clave, titulo: c.titulo, descripcion: c.descripcion, final: Boolean(c.final), hecho: guardadas.get(claveDeAjuste(c.clave)) === true }))
  return { comprobaciones, manuales, resumen: resumir(comprobaciones, manuales), medidoEn: new Date().toISOString() }
}

export async function marcarManual(clave: string, hecho: boolean): Promise<void> {
  const service = createServiceClient()
  const { error } = await service.from('app_settings').upsert({ key: claveDeAjuste(clave), value: hecho ? 1 : 0 }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
}
