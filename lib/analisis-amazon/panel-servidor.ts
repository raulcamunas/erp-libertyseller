/**
 * LAS LECTURAS DEL PANEL «INFORMES» DE COLD CALLING (con la clave de servicio: las tablas de la 303 están cerradas al navegador).
 * La lógica de qué se enseña está en panel.ts. Aquí solo se lee, y con cuidado con la base (memoria «Protección de carga»):
 *   · de analisis_amazon NUNCA el `informe` (20 KB por fila) ni el `token`
 *   · las colas del bucket (1,6 MB) se guardan 60 s en memoria
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { leerConfigCron } from '@/lib/sistema/cron'
import { leerJson, type EnCola, type EnColaSinAmazon, type EventoDeBitacora } from './almacen'
import { MARCA_ENVIADO } from './correo-servidor'
import { saldoKeepa } from './keepa'
import { construirPanel, type FilaDeCron, type FilaDeInforme, type PanelDeInformes } from './panel'
import { recogidaEnMarcha } from './recogida'

const VIDA_DEL_BUCKET_MS = 60_000
let copiaDelBucket: { at: number; datos: Bucket } | null = null
type Bucket = { cola: EnCola[]; colaSin: EnColaSinAmazon[]; saltados: Record<string, string>; bitacora: EventoDeBitacora[] }

async function delBucket(s: SupabaseClient): Promise<Bucket> {
  if (copiaDelBucket && Date.now() - copiaDelBucket.at < VIDA_DEL_BUCKET_MS) return copiaDelBucket.datos
  const [cola, colaSin, saltados, bitacora] = await Promise.all([
    leerJson<EnCola[]>(s, 'cola.json', []),
    leerJson<EnColaSinAmazon[]>(s, 'cola-sin-amazon.json', []),
    leerJson<Record<string, string>>(s, 'saltados.json', {}),
    leerJson<EventoDeBitacora[]>(s, 'bitacora.json', []),
  ])
  const datos = { cola, colaSin, saltados, bitacora: Array.isArray(bitacora) ? bitacora : [] }
  copiaDelBucket = { at: Date.now(), datos }
  return datos
}

/** Lee una consulta entera de 1.000 en 1.000 */
async function todo<T>(pagina: (desde: number, hasta: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, tope = 50_000): Promise<T[]> {
  const salida: T[] = []
  for (let desde = 0; desde < tope; desde += 1000) {
    const { data, error } = await pagina(desde, desde + 999)
    if (error) throw new Error(error.message)
    salida.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return salida
}

type FilaCruda = Omit<FilaDeInforme, 'lead'> & { cold_leads: FilaDeInforme['lead'] | Array<NonNullable<FilaDeInforme['lead']>> | null }

async function saldoConPrisa(): Promise<{ tokens: number; ritmo: number } | null> {
  const clave = (process.env.KEEPA_KEY ?? '').trim()
  if (!clave) return null
  try {
    return await Promise.race([saldoKeepa(clave), new Promise<null>((r) => setTimeout(() => r(null), 5_000))])
  } catch {
    return null
  }
}

export async function leerPanelDeInformes(): Promise<PanelDeInformes> {
  const s = createServiceClient()
  const ahora = Date.now()
  const hace48 = new Date(ahora - 48 * 3_600_000).toISOString()

  const [crudas, envios, cron, perfiles, bucket, config, saldoAhora] = await Promise.all([
    todo<FilaCruda>((a, b) =>
      s.from('analisis_amazon').select('id, lead_id, seller_id, version, aperturas, abierto_ultima_at, creado_en, cold_leads(store_name, assigned_to)').order('creado_en', { ascending: true }).range(a, b),
    ),
    todo<{ lead_id: string; occurred_at: string }>((a, b) => s.from('cold_lead_notes').select('lead_id, occurred_at').eq('kind', 'email').like('body', `%${MARCA_ENVIADO}%`).range(a, b)),
    todo<FilaDeCron>((a, b) =>
      s.from('cron_ejecuciones').select('iniciado_at, terminado_at, ok, resumen, error, duracion_ms').eq('tarea', 'analisis-keepa').gte('iniciado_at', hace48).order('iniciado_at', { ascending: true }).range(a, b),
    ),
    todo<{ id: string; full_name: string | null }>((a, b) => s.from('profiles').select('id, full_name').range(a, b)),
    delBucket(s),
    leerConfigCron({ copia: true }),
    saldoConPrisa(),
  ])

  const informes: FilaDeInforme[] = crudas.map(({ cold_leads, ...f }) => ({ ...f, lead: Array.isArray(cold_leads) ? (cold_leads[0] ?? null) : cold_leads }))
  const c = config.find((x) => x.tarea === 'analisis-keepa')

  return construirPanel({
    ahora,
    informes,
    envios,
    cron,
    config: c ? { activo: c.activo, cadaMinutos: c.cada_minutos } : null,
    ...bucket,
    perfiles,
    saldoAhora,
    enMarcha: recogidaEnMarcha(),
  })
}
