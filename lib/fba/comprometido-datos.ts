import { createServiceClient } from '@/lib/supabase/service'
import { leerTodo } from './paginar'

/**
 * LO COMPROMETIDO DE UN CLIENTE: REMESAS QUE AÚN NO HAN SALIDO (spec remesas-pro §11 D3). SOLO SERVIDOR, SOLO LECTURA.
 * ==================================================================================================================
 * Las remesas en `borrador | aprobada | encajando | lista` con sus líneas, sumadas por referencia. Es lo que el planificador
 * (S1), las alertas (S4a), la propuesta a medida (S4b) y el resumen (S5) restan para no pedir dos veces lo mismo. Qué cuenta y
 * cuándo llega lo decide `llegadasDeSku` (llegadas.ts): un borrador parado ≥ 21 días no cuenta.
 *
 * `diasParada` = días desde el último cambio de la remesa (`updated_at`), como el tablero (tablero-propuestas.ts).
 *
 * Dos consultas, se tengan las remesas que se tengan: las remesas del cliente y sus líneas (paginadas).
 */

type Servicio = ReturnType<typeof createServiceClient>

export const ESTADOS_COMPROMETIDOS = ['borrador', 'aprobada', 'encajando', 'lista'] as const
export type EstadoComprometido = (typeof ESTADOS_COMPROMETIDOS)[number]

export interface Comprometido {
  remesaId: string
  nombre: string | null
  estado: EstadoComprometido
  /** Fecha prevista de envío ('YYYY-MM-DD') */
  fechaEnvio: string | null
  /** Días desde el último cambio; null si no hay fecha */
  diasParada: number | null
  unidades: number
}

const aMs = (f: string): number => Date.parse(`${f.slice(0, 10)}T00:00:00Z`)

/** Días desde un instante (ISO) hasta `hoy`, por días de calendario en España */
function diasDesde(instante: string | null, hoy: string): number | null {
  if (!instante) return null
  const ms = Date.parse(instante)
  if (Number.isNaN(ms)) return null
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
  return Math.max(0, Math.round((aMs(hoy) - aMs(dia)) / 86_400_000))
}

/** Por referencia, la lista de remesas sin salir que la llevan (una entrada por remesa, con las unidades sumadas) */
export async function leerComprometido(service: Servicio, clienteId: string, hoy: string): Promise<Map<string, Comprometido[]>> {
  const { data, error } = await service
    .from('fba_remesas')
    .select('id, nombre, estado, fecha_envio, updated_at')
    .eq('client_id', clienteId)
    .in('estado', ESTADOS_COMPROMETIDOS as unknown as string[])
    .limit(1000)
  if (error) throw error
  const remesas = (data ?? []) as Array<{ id: string; nombre: string | null; estado: EstadoComprometido; fecha_envio: string | null; updated_at: string | null }>
  const resultado = new Map<string, Comprometido[]>()
  if (remesas.length === 0) return resultado

  const ids = remesas.map((r) => r.id)
  const lineas = await leerTodo<{ remesa_id: string; sku: string | null; unidades: number | null }>((a, b) =>
    service.from('fba_remesa_lineas').select('remesa_id, sku, unidades').in('remesa_id', ids).order('id', { ascending: true }).range(a, b)
  )

  // remesa → sku → unidades
  const porRemesa = new Map<string, Map<string, number>>()
  for (const l of lineas) {
    const sku = (l.sku ?? '').trim()
    const u = Number(l.unidades)
    if (!sku || !Number.isFinite(u) || u <= 0) continue
    const m = porRemesa.get(l.remesa_id) ?? new Map<string, number>()
    m.set(sku, (m.get(sku) ?? 0) + u)
    porRemesa.set(l.remesa_id, m)
  }

  for (const r of remesas) {
    const skus = porRemesa.get(r.id)
    if (!skus) continue
    const diasParada = diasDesde(r.updated_at, hoy)
    for (const [sku, unidades] of skus) {
      const lista = resultado.get(sku) ?? []
      lista.push({ remesaId: r.id, nombre: r.nombre, estado: r.estado, fechaEnvio: r.fecha_envio ? r.fecha_envio.slice(0, 10) : null, diasParada, unidades })
      resultado.set(sku, lista)
    }
  }
  return resultado
}
