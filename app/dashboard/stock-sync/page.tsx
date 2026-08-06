import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { StockSyncBoard } from '@/components/stock-sync/StockSyncBoard'
import type { StockClientSummary } from '@/components/stock-sync/StockSyncBoard'
import { StockClient, StockMapping, StockRun } from '@/lib/types/stock-sync'

// Supabase corta cualquier consulta a 1000 filas y un .limit() mayor no lo
// salta. El mapeo de un cliente con catálogo grande pasa de ahí sin
// despeinarse, y quedarse a medias aquí no da error: enseñaría el catálogo
// incompleto y quien lo mirase daría por perdidos listings que sí están.
const PAGE = 1000

/** Procesos que se enseñan de entrada; el mismo número que espera el tablero */
const RUNS_LIMIT = 30

/**
 * Consulta paginada. El orden lo fija quien llama y siempre termina en una
 * columna única, porque .range() sobre un orden con empates puede repetir o
 * saltarse filas entre tramos.
 */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) {
      console.error('Error cargando sincronismo de stock:', error)
      break
    }
    const chunk = (data as T[]) ?? []
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

export default async function StockSyncPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  // Misma lista que is_stock_team en la migración 106: quien sube el stock a
  // Amazon dos veces por semana es la persona de operaciones y su rol es
  // 'employee'. Cerrar la página a admin/partner dejaría el módulo sin nadie
  // que lo usara.
  if (!['admin', 'partner', 'employee'].includes(profile.role)) redirect('/dashboard')

  // Solo admin y partner pueden borrar, igual que las políticas de la 106.
  // Con RLS un borrado sin permiso no da error, simplemente no borra: el
  // tablero necesita saberlo de antemano para ofrecer desactivar en su lugar.
  const canDelete = profile.role === 'admin' || profile.role === 'partner'

  const clientRows = await fetchAll<StockClient>((from, to) =>
    supabase
      .from('stock_clients')
      .select('*')
      .order('position', { ascending: true, nullsFirst: false })
      .order('id')
      .range(from, to)
  )

  // Recuento y última ejecución por cliente. Son dos consultas por cliente,
  // pero los clientes que mandan volcado se cuentan con los dedos de una mano
  // y traerse los mapeos de todos para contarlos costaría bastante más.
  const summaries: StockClientSummary[] = await Promise.all(
    clientRows.map(async (client) => {
      const [{ count }, { data: lastRun }] = await Promise.all([
        supabase
          .from('stock_mappings')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id),
        supabase
          .from('stock_runs')
          .select('created_at')
          .eq('client_id', client.id)
          .order('created_at', { ascending: false })
          .limit(1),
      ])

      return {
        client,
        mappingCount: count ?? 0,
        lastRunAt: lastRun?.[0]?.created_at ?? null,
      }
    })
  )

  // Se abre el primer cliente activo: el inactivo está ahí por histórico y
  // entrar en él daría la impresión de que el módulo no tiene datos.
  const initialClientId =
    summaries.find((s) => s.client.is_active)?.client.id ?? summaries[0]?.client.id ?? null

  const initialMappings = initialClientId
    ? await fetchAll<StockMapping>((from, to) =>
        supabase
          .from('stock_mappings')
          .select('*')
          .eq('client_id', initialClientId)
          .order('sku_amazon')
          .order('id')
          .range(from, to)
      )
    : []

  const { data: runRows } = initialClientId
    ? await supabase
        .from('stock_runs')
        .select('*')
        .eq('client_id', initialClientId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(RUNS_LIMIT)
    : { data: [] as StockRun[] }

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)] min-w-0">
      <div className="mb-3 flex-shrink-0">
        <h1 className="heading-medium text-white mb-1">Sincronismo de stock</h1>
        <p className="text-white/50 text-sm">
          Del volcado del ERP del cliente al fichero de stock que se sube a
          Amazon.
        </p>
      </div>

      <div className="flex-1 min-h-0 min-w-0">
        <StockSyncBoard
          clients={summaries}
          initialClientId={initialClientId}
          initialMappings={initialMappings}
          initialRuns={(runRows as StockRun[]) || []}
          currentUserId={user.id}
          canDelete={canDelete}
        />
      </div>
    </div>
  )
}
