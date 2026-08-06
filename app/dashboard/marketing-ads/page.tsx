import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { MarketingBoard } from '@/components/marketing/MarketingBoard'
import type { MarketingAuthor } from '@/components/marketing/MarketingBoard'
import {
  MarketingCampaign,
  MarketingChange,
  MarketingClient,
  MarketingKeyword,
  MarketingProduct,
  MarketingProductWeek,
  MarketingWeek,
  currentWeekStart,
  shiftWeek,
} from '@/lib/types/marketing'

// Supabase corta cualquier consulta a 1000 filas y un .limit() mayor no lo
// salta: las keywords de una cuenta grande pasan de ahí sin despeinarse.
const PAGE = 1000

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
      console.error('Error cargando marketing:', error)
      break
    }
    const chunk = (data as T[]) ?? []
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

export default async function MarketingAdsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  // Aquí entra también el employee: el especialista de PPC lleva las
  // revisiones y es quien más usa el módulo. Coincide con is_marketing_team,
  // que es lo que aplican las políticas RLS de la 103.
  if (!['admin', 'partner', 'employee'].includes(profile.role)) redirect('/dashboard')

  const clients = await fetchAll<MarketingClient>((from, to) =>
    supabase
      .from('marketing_clients')
      .select('*')
      .order('position', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to)
  )

  // Todas las semanas de todos los clientes: son cuatro filas por cliente y
  // mes, y tenerlas de golpe evita una consulta cada vez que se navega.
  const weeks = await fetchAll<MarketingWeek>((from, to) =>
    supabase
      .from('marketing_weeks')
      .select('*')
      .order('week_start', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
  )

  const initialClientId =
    clients.find((c) => c.is_active)?.id ?? clients[0]?.id ?? null

  const weekStart = currentWeekStart()
  const previousStart = shiftWeek(weekStart, -1)

  const currentWeek =
    weeks.find((w) => w.client_id === initialClientId && w.week_start === weekStart) ?? null
  const previousWeek =
    weeks.find((w) => w.client_id === initialClientId && w.week_start === previousStart) ?? null

  // La semana anterior viaja con la actual porque los KPIs de cabecera son
  // comparativos: sin ella el tablero abriría sin variaciones.
  const weekIds = [currentWeek?.id, previousWeek?.id].filter(Boolean) as string[]

  const campaigns =
    weekIds.length === 0
      ? []
      : await fetchAll<MarketingCampaign>((from, to) =>
          supabase
            .from('marketing_campaigns')
            .select('*')
            .in('week_id', weekIds)
            .order('position', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        )

  const campaignIds = currentWeek
    ? campaigns.filter((c) => c.week_id === currentWeek.id).map((c) => c.id)
    : []

  const keywords =
    campaignIds.length === 0
      ? []
      : await fetchAll<MarketingKeyword>((from, to) =>
          supabase
            .from('marketing_keywords')
            .select('*')
            .in('campaign_id', campaignIds)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        )

  const changes = !currentWeek
    ? []
    : await fetchAll<MarketingChange>((from, to) =>
        supabase
          .from('marketing_changes')
          .select('*')
          .eq('week_id', currentWeek.id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)
      )

  // El catálogo es del cliente y no de la semana: se carga entero para poder
  // dar de alta productos aunque la semana todavía no esté abierta.
  const products = !initialClientId
    ? []
    : await fetchAll<MarketingProduct>((from, to) =>
        supabase
          .from('marketing_products')
          .select('*')
          .eq('client_id', initialClientId)
          .order('asin', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      )

  // Las dos semanas, igual que las campañas: el KPI de TACoS compara con la
  // anterior y necesita sus ventas totales, no solo las de esta.
  const productWeeks =
    weekIds.length === 0
      ? []
      : await fetchAll<MarketingProductWeek>((from, to) =>
          supabase
            .from('marketing_product_weeks')
            .select('*')
            .in('week_id', weekIds)
            .order('id', { ascending: true })
            .range(from, to)
        )

  const { data: team } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('role', ['admin', 'partner', 'employee'])
    .order('full_name', { ascending: true, nullsFirst: false })

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)] min-w-0">
      <div className="mb-3 flex-shrink-0">
        <h1 className="heading-medium text-white mb-1">Marketing</h1>
        <p className="text-white/50 text-sm">
          Revisión semanal de Amazon Ads: métricas por campaña, pujas de cada
          keyword y registro de lo que se tocó.
        </p>
      </div>

      <div className="flex-1 min-h-0 min-w-0">
        <MarketingBoard
          clients={clients}
          initialWeeks={weeks}
          initialClientId={initialClientId}
          initialWeekStart={weekStart}
          initialCampaigns={campaigns}
          initialKeywords={keywords}
          initialChanges={changes}
          initialProducts={products}
          initialProductWeeks={productWeeks}
          team={(team as MarketingAuthor[]) || []}
          currentUserId={profile.id}
        />
      </div>
    </div>
  )
}
