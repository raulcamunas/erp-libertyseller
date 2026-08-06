'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { useIsMobile } from '@/lib/use-is-mobile'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CalendarPlus,
  CopyPlus,
  Download,
  Euro,
  Eye,
  History,
  KeyRound,
  LayoutList,
  Loader2,
  MousePointer,
  MousePointerClick,
  Package,
  Percent,
  ShoppingCart,
  Target,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import {
  MarketingCampaign,
  MarketingCampaignStatus,
  MarketingChange,
  MarketingClient,
  MarketingKeyword,
  MarketingProduct,
  MarketingProductWeek,
  MarketingWeek,
  MarketingWeekStatus,
  CAMPAIGN_STATUS_LABELS,
  WEEK_STATUSES,
  WEEK_STATUS_COLORS,
  WEEK_STATUS_LABELS,
  currentWeekStart,
  extractAsin,
  formatEuros,
  formatInt,
  formatPct,
  isoWeekNumber,
  shiftWeek,
  weekEndFor,
  weekLabel,
  CAMPAIGN_TYPES,
} from '@/lib/types/marketing'
import { CampaignsTable, CampaignKeywordCount } from './CampaignsTable'
import { KeywordsPanel } from './KeywordsPanel'
import { ChangesLog } from './ChangesLog'
import { ProductsPanel, NewProductDraft } from './ProductsPanel'
import {
  MarketingChangeDraft,
  clientTacos,
  logMarketingChange,
  productWeekStats,
  sumMetrics,
} from './shared'

type MarketingSupabase = ReturnType<typeof createClient>

/** Autor de una línea del diario, con lo justo para pintar su nombre */
export interface MarketingAuthor {
  id: string
  full_name: string | null
  email: string | null
}

export interface MarketingBoardProps {
  clients: MarketingClient[]
  /** Todas las semanas de todos los clientes: son cuatro filas por cliente y mes, caben de sobra */
  initialWeeks: MarketingWeek[]
  initialClientId: string | null
  /** Lunes que se abre al entrar, calculado en servidor para que coincida con initialCampaigns */
  initialWeekStart: string
  /** Campañas de la semana inicial Y de la anterior: la comparativa de KPIs necesita las dos */
  initialCampaigns: MarketingCampaign[]
  /** Keywords de las campañas de la semana inicial */
  initialKeywords: MarketingKeyword[]
  /** Diario de la semana inicial */
  initialChanges: MarketingChange[]
  /** Catálogo del cliente inicial: el producto no es de una semana, es del cliente */
  initialProducts: MarketingProduct[]
  /** Cifras de Sellerboard de la semana inicial y de la anterior, para comparar el TACoS */
  initialProductWeeks: MarketingProductWeek[]
  team: MarketingAuthor[]
  currentUserId: string
}

// Supabase corta cualquier consulta a 1000 filas y .limit() no lo salta: una
// cuenta grande pasa de esa cifra en keywords sin despeinarse.
const PAGE = 1000

async function fetchCampaigns(
  supabase: MarketingSupabase,
  weekIds: string[]
): Promise<MarketingCampaign[]> {
  const out: MarketingCampaign[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('marketing_campaigns')
      .select('*')
      .in('week_id', weekIds)
      .order('position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const chunk = (data as MarketingCampaign[]) ?? []
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

async function fetchKeywords(
  supabase: MarketingSupabase,
  campaignIds: string[]
): Promise<MarketingKeyword[]> {
  if (campaignIds.length === 0) return []
  const out: MarketingKeyword[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('marketing_keywords')
      .select('*')
      .in('campaign_id', campaignIds)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const chunk = (data as MarketingKeyword[]) ?? []
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

async function fetchProducts(
  supabase: MarketingSupabase,
  clientId: string
): Promise<MarketingProduct[]> {
  const out: MarketingProduct[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('marketing_products')
      .select('*')
      .eq('client_id', clientId)
      .order('asin', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const chunk = (data as MarketingProduct[]) ?? []
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

async function fetchProductWeeks(
  supabase: MarketingSupabase,
  weekIds: string[]
): Promise<MarketingProductWeek[]> {
  if (weekIds.length === 0) return []
  const out: MarketingProductWeek[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('marketing_product_weeks')
      .select('*')
      .in('week_id', weekIds)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const chunk = (data as MarketingProductWeek[]) ?? []
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

async function fetchChanges(
  supabase: MarketingSupabase,
  weekId: string
): Promise<MarketingChange[]> {
  const { data, error } = await supabase
    .from('marketing_changes')
    .select('*')
    .eq('week_id', weekId)
    .order('created_at', { ascending: false })
    .range(0, PAGE - 1)
  if (error) throw error
  return (data as MarketingChange[]) ?? []
}

/** Hacia dónde tiene que moverse una métrica para que sea una buena noticia */
type Direction = 'up' | 'down' | 'neutral'

interface Kpi {
  key: string
  icon: LucideIcon
  label: string
  value: string
  tone: string
  current: number | null
  previous: number | null
  better: Direction
  /** Los porcentajes se comparan en puntos, no en porcentaje del porcentaje */
  points: boolean
  /** Corto, sustituye al delta cuando la cifra no cubre toda la cuenta */
  warning?: string | null
  /** El detalle completo del aviso, para el title */
  warningTitle?: string | null
}

interface Delta {
  text: string
  /** 1 sube, -1 baja, 0 se queda igual */
  sign: 1 | -1 | 0
}

/**
 * Variación contra la semana anterior.
 *
 * Los porcentajes (ACoS, CTR...) se comparan en puntos y no en porcentaje del
 * porcentaje: pasar de un ACoS del 20 % al 25 % es «+5 pp», no «+25 %», que es
 * lo que sale de dividir y no significa nada para quien lee.
 */
function deltaOf(current: number | null, previous: number | null, points: boolean): Delta | null {
  if (current == null || previous == null) return null
  const a = Number(current)
  const b = Number(previous)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  if (!points && b === 0) return null

  const raw = points ? a - b : ((a - b) / Math.abs(b)) * 100
  if (!Number.isFinite(raw)) return null

  const sign: 1 | -1 | 0 = raw > 0.05 ? 1 : raw < -0.05 ? -1 : 0
  const value = Math.abs(raw).toLocaleString('es-ES', {
    minimumFractionDigits: points ? 1 : 0,
    maximumFractionDigits: points ? 1 : 0,
  })
  return {
    sign,
    text: `${sign > 0 ? '+' : sign < 0 ? '−' : ''}${value}${points ? ' pp' : ' %'}`,
  }
}

/**
 * El color del delta no puede salir del signo: en ACoS y TACoS bajar es la
 * buena noticia, y pintar de rojo una bajada sería justo al revés de lo que
 * hay que leer. El gasto no tiene dirección buena — subirlo es malo si no
 * vende y bueno si escala — así que se queda en gris.
 */
function deltaTone(sign: 1 | -1 | 0, better: Direction): string {
  if (sign === 0 || better === 'neutral') return 'text-white/35'
  const good = better === 'up' ? sign > 0 : sign < 0
  return good ? 'text-green-300' : 'text-red-300'
}

export function MarketingBoard({
  clients,
  initialWeeks,
  initialClientId,
  initialWeekStart,
  initialCampaigns,
  initialKeywords,
  initialChanges,
  initialProducts,
  initialProductWeeks,
  team,
  currentUserId,
}: MarketingBoardProps) {
  const supabase = createClient()
  const isMobile = useIsMobile()

  const [weeks, setWeeks] = useState(initialWeeks)
  const [clientId, setClientId] = useState<string | null>(initialClientId ?? clients[0]?.id ?? null)
  const [weekStart, setWeekStart] = useState(initialWeekStart)
  const [campaigns, setCampaigns] = useState(initialCampaigns)
  const [keywords, setKeywords] = useState(initialKeywords)
  const [changes, setChanges] = useState(initialChanges)
  const [products, setProducts] = useState(initialProducts)
  const [productWeeks, setProductWeeks] = useState(initialProductWeeks)
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  // Campañas y productos son las dos caras de la misma semana y comparten
  // hueco: se mira una u otra, nunca las dos a la vez.
  const [mainView, setMainView] = useState<'campaigns' | 'products'>('campaigns')
  // En móvil no caben tres paneles: se enseña uno cada vez.
  const [mobileView, setMobileView] = useState<'campaigns' | 'keywords' | 'changes'>('campaigns')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)

  // ---------- Datos derivados ----------
  const visibleClients = useMemo(
    () =>
      clients
        .filter((c) => c.is_active || c.id === clientId)
        .sort((a, b) => (a.position ?? 999) - (b.position ?? 999)),
    [clients, clientId]
  )

  const client = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId]
  )

  const week = useMemo(
    () => weeks.find((w) => w.client_id === clientId && w.week_start === weekStart) ?? null,
    [weeks, clientId, weekStart]
  )

  const previousWeek = useMemo(() => {
    const prevStart = shiftWeek(weekStart, -1)
    return weeks.find((w) => w.client_id === clientId && w.week_start === prevStart) ?? null
  }, [weeks, clientId, weekStart])

  const weekCampaigns = useMemo(() => {
    if (!week) return []
    return campaigns
      .filter((c) => c.week_id === week.id)
      .sort(
        (a, b) =>
          (a.position ?? 9999) - (b.position ?? 9999) ||
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
  }, [campaigns, week])

  const previousCampaigns = useMemo(
    () => (previousWeek ? campaigns.filter((c) => c.week_id === previousWeek.id) : []),
    [campaigns, previousWeek]
  )

  const weekKeywords = useMemo(() => {
    const ids = new Set(weekCampaigns.map((c) => c.id))
    return keywords.filter((k) => ids.has(k.campaign_id))
  }, [keywords, weekCampaigns])

  const keywordCounts = useMemo(() => {
    const map = new Map<string, CampaignKeywordCount>()
    for (const k of weekKeywords) {
      const entry = map.get(k.campaign_id) ?? { total: 0, pending: 0 }
      entry.total += 1
      if (k.action !== 'mantener' && !k.applied) entry.pending += 1
      map.set(k.campaign_id, entry)
    }
    return map
  }, [weekKeywords])

  const selectedCampaign = useMemo(
    () => weekCampaigns.find((c) => c.id === selectedCampaignId) ?? null,
    [weekCampaigns, selectedCampaignId]
  )

  const selectedKeywords = useMemo(
    () =>
      keywords
        .filter((k) => k.campaign_id === selectedCampaignId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [keywords, selectedCampaignId]
  )

  const campaignNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of campaigns) map.set(c.id, c.name)
    return map
  }, [campaigns])

  const authorNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of team) map.set(p.id, p.full_name || p.email || 'Alguien del equipo')
    return map
  }, [team])

  const pendingKeywords = useMemo(
    () => weekKeywords.filter((k) => k.action !== 'mantener' && !k.applied).length,
    [weekKeywords]
  )

  // ---------- Productos ----------
  // Sin nombre primero, que son los recién dados de alta y es lo que hay que
  // terminar de rellenar; el resto por nombre.
  const clientProducts = useMemo(
    () =>
      products
        .filter((p) => p.client_id === clientId)
        .sort(
          (a, b) =>
            (a.name ?? '').localeCompare(b.name ?? '', 'es') || a.asin.localeCompare(b.asin)
        ),
    [products, clientId]
  )

  const productsByAsin = useMemo(() => {
    const map = new Map<string, MarketingProduct>()
    for (const p of clientProducts) map.set(p.asin, p)
    return map
  }, [clientProducts])

  const stats = useMemo(
    () =>
      productWeekStats(
        clientProducts,
        week ? productWeeks.filter((r) => r.week_id === week.id) : [],
        weekCampaigns
      ),
    [clientProducts, productWeeks, week, weekCampaigns]
  )

  const statsById = useMemo(() => {
    const map = new Map(stats.map((s) => [s.product.id, s]))
    return map
  }, [stats])

  const weekTacos = useMemo(() => clientTacos(stats, weekCampaigns), [stats, weekCampaigns])

  const previousTacos = useMemo(
    () =>
      clientTacos(
        productWeekStats(
          clientProducts,
          previousWeek ? productWeeks.filter((r) => r.week_id === previousWeek.id) : [],
          previousCampaigns
        ),
        previousCampaigns
      ),
    [clientProducts, productWeeks, previousWeek, previousCampaigns]
  )

  // Al cambiar de semana o de cliente la selección anterior ya no existe.
  // En móvil no se preselecciona nada: se entra por la lista de campañas.
  useEffect(() => {
    if (isMobile) return
    if (selectedCampaignId && weekCampaigns.some((c) => c.id === selectedCampaignId)) return
    setSelectedCampaignId(weekCampaigns[0]?.id ?? null)
  }, [isMobile, weekCampaigns, selectedCampaignId])

  // ---------- KPIs ----------
  const totals = useMemo(() => sumMetrics(weekCampaigns), [weekCampaigns])
  const previousTotals = useMemo(() => sumMetrics(previousCampaigns), [previousCampaigns])
  const hasPrevious = previousCampaigns.length > 0

  const kpis = useMemo<Kpi[]>(() => {
    const p = hasPrevious ? previousTotals : null

    // El TACoS agregado solo cubre los productos cuyas ventas totales ya están
    // volcadas. Enseñarlo a secas cuando faltan es peor que no enseñarlo: un
    // 8 % que en realidad deja fuera medio catálogo se lee como un 8 % bueno.
    const tacosWarning = weekTacos.partial
      ? [
          weekTacos.blindProducts > 0 ? `${weekTacos.blindProducts} sin ventas` : null,
          weekTacos.unlinkedCampaigns > 0
            ? `${weekTacos.unlinkedCampaigns} sin producto`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null

    const tacosTitle = weekTacos.partial
      ? `Parcial: solo entran los productos con ventas totales volcadas — ${formatEuros(
          weekTacos.spend
        )} de gasto entre ${formatEuros(
          weekTacos.totalSales
        )} de ventas. Quedan fuera ${formatEuros(
          weekTacos.uncoveredSpend
        )} de gasto: ${weekTacos.blindProducts} productos sin ventas de Sellerboard y ${
          weekTacos.unlinkedCampaigns
        } campañas sin producto enlazado.`
      : `${formatEuros(weekTacos.spend)} de gasto publicitario entre ${formatEuros(
          weekTacos.totalSales
        )} de ventas totales de todos los productos.`

    return [
      {
        key: 'spend',
        icon: Euro,
        label: 'Gasto',
        value: formatEuros(totals.spend),
        tone: 'text-red-300',
        current: totals.spend,
        previous: p?.spend ?? null,
        better: 'neutral' as Direction,
        points: false,
      },
      {
        key: 'sales',
        icon: TrendingUp,
        label: 'Ventas',
        value: formatEuros(totals.sales),
        tone: 'text-green-300',
        current: totals.sales,
        previous: p?.sales ?? null,
        better: 'up' as Direction,
        points: false,
      },
      {
        key: 'acos',
        icon: Target,
        label: 'ACoS',
        value: formatPct(totals.acos),
        tone: 'text-white',
        current: totals.acos,
        previous: p?.acos ?? null,
        better: 'down' as Direction,
        points: true,
      },
      {
        key: 'tacos',
        icon: Percent,
        label: 'TACoS',
        value: formatPct(weekTacos.tacos),
        tone: weekTacos.partial ? 'text-[#FBBF24]' : 'text-white',
        current: weekTacos.tacos,
        // Solo se compara contra una semana anterior que también estuviera
        // completa: medir una semana entera contra otra a la que le faltaba
        // medio catálogo inventaría una subida o una bajada que no ocurrió.
        previous: hasPrevious && !previousTacos.partial ? previousTacos.tacos : null,
        better: 'down' as Direction,
        points: true,
        warning: tacosWarning,
        warningTitle: tacosTitle,
      },
      {
        key: 'ctr',
        icon: MousePointerClick,
        label: 'CTR',
        value: formatPct(totals.ctr),
        tone: 'text-white',
        current: totals.ctr,
        previous: p?.ctr ?? null,
        better: 'up' as Direction,
        points: true,
      },
      {
        key: 'cvr',
        icon: ShoppingCart,
        label: 'CVR',
        value: formatPct(totals.cvr),
        tone: 'text-white',
        current: totals.cvr,
        previous: p?.cvr ?? null,
        better: 'up' as Direction,
        points: true,
      },
      {
        key: 'impressions',
        icon: Eye,
        label: 'Impresiones',
        value: formatInt(totals.impressions),
        tone: 'text-white',
        current: totals.impressions,
        previous: p?.impressions ?? null,
        better: 'up' as Direction,
        points: false,
      },
      {
        key: 'clicks',
        icon: MousePointer,
        label: 'Clics',
        value: formatInt(totals.clicks),
        tone: 'text-white',
        current: totals.clicks,
        previous: p?.clicks ?? null,
        better: 'up' as Direction,
        points: false,
      },
    ]
  }, [totals, previousTotals, hasPrevious, weekTacos, previousTacos])

  const reviewed = weekCampaigns.filter((c) => c.review_status === 'hecho').length
  const progress = weekCampaigns.length > 0 ? (reviewed / weekCampaigns.length) * 100 : 0

  // ---------- Carga bajo demanda ----------
  const weeksRef = useRef(weeks)
  useEffect(() => {
    weeksRef.current = weeks
  }, [weeks])

  const load = useCallback(
    async (cid: string, ws: string) => {
      setLoading(true)
      try {
        // El catálogo es del cliente y no de la semana, así que se carga aunque
        // la semana no esté abierta: dar de alta productos no depende de ella.
        setProducts(await fetchProducts(supabase, cid))

        const prevStart = shiftWeek(ws, -1)
        const scope = weeksRef.current.filter(
          (w) => w.client_id === cid && (w.week_start === ws || w.week_start === prevStart)
        )
        if (scope.length === 0) {
          setCampaigns([])
          setKeywords([])
          setChanges([])
          setProductWeeks([])
          return
        }
        const rows = await fetchCampaigns(
          supabase,
          scope.map((w) => w.id)
        )
        setCampaigns(rows)
        setProductWeeks(
          await fetchProductWeeks(
            supabase,
            scope.map((w) => w.id)
          )
        )

        const current = scope.find((w) => w.week_start === ws) ?? null
        const currentIds = current ? rows.filter((c) => c.week_id === current.id).map((c) => c.id) : []
        setKeywords(await fetchKeywords(supabase, currentIds))
        setChanges(current ? await fetchChanges(supabase, current.id) : [])
      } catch (err) {
        console.error('Error cargando la semana de marketing:', err)
        toast.error('No se pudo cargar la semana')
      } finally {
        setLoading(false)
      }
    },
    [supabase]
  )

  // El servidor ya mandó la primera semana: recargarla al montar sería pedir
  // dos veces lo mismo y provocar un parpadeo.
  const loadedKeyRef = useRef(`${initialClientId ?? ''}|${initialWeekStart}`)

  useEffect(() => {
    if (!clientId) return
    const key = `${clientId}|${weekStart}`
    if (loadedKeyRef.current === key) return
    loadedKeyRef.current = key
    load(clientId, weekStart)
  }, [clientId, weekStart, load])

  // ---------- Realtime ----------
  // El diario no está en la publicación, así que no llega solo: se refresca
  // aprovechando los eventos de campañas y keywords, que es justo cuando el
  // otro navegador acaba de apuntar algo.
  const visibleWeekIdsRef = useRef<Set<string>>(new Set())
  const visibleCampaignIdsRef = useRef<Set<string>>(new Set())
  const currentWeekIdRef = useRef<string | null>(null)
  const clientIdRef = useRef<string | null>(clientId)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    clientIdRef.current = clientId
  }, [clientId])

  useEffect(() => {
    const ids = new Set<string>()
    if (week) ids.add(week.id)
    if (previousWeek) ids.add(previousWeek.id)
    visibleWeekIdsRef.current = ids
    currentWeekIdRef.current = week?.id ?? null
  }, [week, previousWeek])

  useEffect(() => {
    visibleCampaignIdsRef.current = new Set(campaigns.map((c) => c.id))
  }, [campaigns])

  const scheduleChangesRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(async () => {
      const id = currentWeekIdRef.current
      if (!id) return
      try {
        setChanges(await fetchChanges(supabase, id))
      } catch (err) {
        console.error('Error refrescando el diario:', err)
      }
    }, 600)
  }, [supabase])

  useEffect(() => {
    const channel = supabase
      .channel(`marketing_${currentUserId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'marketing_campaigns' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setCampaigns((prev) => prev.filter((c) => c.id !== old.id))
            setKeywords((prev) => prev.filter((k) => k.campaign_id !== old.id))
            return
          }
          const row = payload.new as MarketingCampaign
          if (!visibleWeekIdsRef.current.has(row.week_id)) return
          setCampaigns((prev) =>
            prev.some((c) => c.id === row.id)
              ? prev.map((c) => (c.id === row.id ? { ...c, ...row } : c))
              : [...prev, row]
          )
          scheduleChangesRefresh()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'marketing_keywords' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setKeywords((prev) => prev.filter((k) => k.id !== old.id))
            return
          }
          const row = payload.new as MarketingKeyword
          if (!visibleCampaignIdsRef.current.has(row.campaign_id)) return
          setKeywords((prev) =>
            prev.some((k) => k.id === row.id)
              ? prev.map((k) => (k.id === row.id ? { ...k, ...row } : k))
              : [...prev, row]
          )
          scheduleChangesRefresh()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'marketing_products' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setProducts((prev) => prev.filter((p) => p.id !== old.id))
            setProductWeeks((prev) => prev.filter((r) => r.product_id !== old.id))
            return
          }
          const row = payload.new as MarketingProduct
          // Solo el catálogo del cliente que se está mirando: el de los demás
          // no se ha cargado y meterlo aquí lo dejaría a medias.
          if (row.client_id !== clientIdRef.current) return
          setProducts((prev) =>
            prev.some((p) => p.id === row.id)
              ? prev.map((p) => (p.id === row.id ? { ...p, ...row } : p))
              : [...prev, row]
          )
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'marketing_product_weeks' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setProductWeeks((prev) => prev.filter((r) => r.id !== old.id))
            return
          }
          const row = payload.new as MarketingProductWeek
          if (!visibleWeekIdsRef.current.has(row.week_id)) return
          setProductWeeks((prev) =>
            prev.some((r) => r.id === row.id)
              ? prev.map((r) => (r.id === row.id ? { ...r, ...row } : r))
              : [...prev, row]
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [supabase, currentUserId, scheduleChangesRefresh])

  // ---------- Diario ----------
  const appendChange = useCallback(
    async (draft: MarketingChangeDraft) => {
      const row = await logMarketingChange(supabase, currentUserId, draft)
      if (row) setChanges((prev) => (prev.some((c) => c.id === row.id) ? prev : [row, ...prev]))
    },
    [supabase, currentUserId]
  )

  // ---------- Guardado ----------
  async function patchWeek(patch: Partial<MarketingWeek>) {
    if (!week) return
    setWeeks((prev) => prev.map((w) => (w.id === week.id ? { ...w, ...patch } : w)))
    const { error } = await supabase.from('marketing_weeks').update(patch).eq('id', week.id)
    if (error) {
      console.error('Error guardando la semana:', error)
      toast.error('No se pudo guardar la semana')
      setWeeks((prev) => prev.map((w) => (w.id === week.id ? week : w)))
    }
  }

  async function patchCampaign(
    campaign: MarketingCampaign,
    requested: Partial<MarketingCampaign>
  ) {
    // Renombrar una campaña que aún no tiene producto es el momento de
    // engancharla: el nombre empieza por el ASIN («B104924910 | 942098») y esa
    // es la única pista fiable. Si ya tiene producto no se toca, porque puede
    // haberse corregido a mano y el nombre no siempre se actualiza.
    const patch = (() => {
      if (!requested.name || campaign.product_id || requested.product_id !== undefined) {
        return requested
      }
      const asin = extractAsin(requested.name)
      const product = asin ? productsByAsin.get(asin) : undefined
      return product ? { ...requested, product_id: product.id } : requested
    })()

    setCampaigns((prev) => prev.map((c) => (c.id === campaign.id ? { ...c, ...patch } : c)))
    const { error } = await supabase
      .from('marketing_campaigns')
      .update(patch)
      .eq('id', campaign.id)
    if (error) {
      console.error('Error guardando la campaña:', error)
      toast.error('No se pudo guardar la campaña')
      setCampaigns((prev) => prev.map((c) => (c.id === campaign.id ? campaign : c)))
      return
    }
    if (!week) return

    // Lo que acaba en el informe del cliente se apunta solo: si dependiera de
    // que alguien lo escriba a mano en el diario, no estaría.
    if (patch.status !== undefined && patch.status !== campaign.status) {
      appendChange({
        week_id: week.id,
        campaign_id: campaign.id,
        change_type: 'estado_campana',
        description: campaign.name,
        before_value: CAMPAIGN_STATUS_LABELS[campaign.status as MarketingCampaignStatus],
        after_value: CAMPAIGN_STATUS_LABELS[patch.status],
      })
    }
    if (patch.daily_budget !== undefined && (campaign.daily_budget ?? null) !== patch.daily_budget) {
      appendChange({
        week_id: week.id,
        campaign_id: campaign.id,
        change_type: 'presupuesto',
        description: campaign.name,
        before_value: formatEuros(campaign.daily_budget),
        after_value: formatEuros(patch.daily_budget),
      })
    }
  }

  async function patchKeyword(keyword: MarketingKeyword, patch: Partial<MarketingKeyword>) {
    setKeywords((prev) => prev.map((k) => (k.id === keyword.id ? { ...k, ...patch } : k)))
    const { error } = await supabase.from('marketing_keywords').update(patch).eq('id', keyword.id)
    if (error) {
      console.error('Error guardando la keyword:', error)
      toast.error('No se pudo guardar la keyword')
      setKeywords((prev) => prev.map((k) => (k.id === keyword.id ? keyword : k)))
      return
    }
    if (!week) return

    const campaignName = campaignNames.get(keyword.campaign_id) ?? ''

    if (patch.current_bid !== undefined && (keyword.current_bid ?? null) !== patch.current_bid) {
      appendChange({
        week_id: week.id,
        campaign_id: keyword.campaign_id,
        keyword_id: keyword.id,
        change_type: 'puja',
        description: `${campaignName} · ${keyword.keyword}`,
        before_value: formatEuros(keyword.current_bid),
        after_value: formatEuros(patch.current_bid),
      })
    }

    // Marcar «aplicada» es el momento en el que el cambio existe de verdad en
    // Amazon; es esa fecha, y no la de la decisión, la que interesa al cliente.
    if (patch.applied === true && !keyword.applied && keyword.action !== 'mantener') {
      const type =
        keyword.action === 'negativizar'
          ? 'keyword_negativa'
          : keyword.action === 'nueva'
            ? 'keyword_nueva'
            : 'puja'
      appendChange({
        week_id: week.id,
        campaign_id: keyword.campaign_id,
        keyword_id: keyword.id,
        change_type: type,
        description: `${campaignName} · ${keyword.keyword}`,
        before_value: formatEuros(keyword.current_bid),
        after_value: formatEuros(keyword.suggested_bid ?? keyword.current_bid),
      })
    }
  }

  // ---------- Altas y bajas ----------
  async function createWeek(): Promise<MarketingWeek | null> {
    if (!clientId) return null
    if (week) return week
    const { data, error } = await supabase
      .from('marketing_weeks')
      .insert({
        client_id: clientId,
        week_start: weekStart,
        week_end: weekEndFor(weekStart),
        label: weekLabel(weekStart),
        status: 'en_curso',
      })
      .select('*')
      .single()
    if (error) {
      console.error('Error abriendo la semana:', error)
      toast.error('No se pudo abrir la semana')
      return null
    }
    const row = data as MarketingWeek
    setWeeks((prev) => [...prev, row])
    return row
  }

  async function addCampaign() {
    const target = week ?? (await createWeek())
    if (!target) return
    const nextPosition = Math.max(0, ...weekCampaigns.map((c) => c.position ?? 0)) + 1
    const { data, error } = await supabase
      .from('marketing_campaigns')
      .insert({
        week_id: target.id,
        name: 'Nueva campaña',
        // El tipo por defecto sale de la lista, no de un literal suelto: un
        // valor a mano se quedo atras al cambiar la taxonomia y el CHECK de la
        // base de datos rechazaba cada campana nueva.
        campaign_type: CAMPAIGN_TYPES[0],
        status: 'activa',
        review_status: 'pendiente',
        position: nextPosition,
      })
      .select('*')
      .single()
    if (error) {
      console.error('Error creando la campaña:', error)
      toast.error('No se pudo crear la campaña')
      return
    }
    const row = data as MarketingCampaign
    setCampaigns((prev) => [...prev, row])
    setSelectedCampaignId(row.id)
  }

  async function removeCampaign(campaign: MarketingCampaign) {
    const count = keywordCounts.get(campaign.id)?.total ?? 0
    const extra = count > 0 ? ` y sus ${count} keywords` : ''
    if (!confirm(`¿Borrar «${campaign.name}»${extra}?`)) return
    const { error } = await supabase.from('marketing_campaigns').delete().eq('id', campaign.id)
    if (error) {
      console.error('Error borrando la campaña:', error)
      toast.error('No se pudo borrar')
      return
    }
    setCampaigns((prev) => prev.filter((c) => c.id !== campaign.id))
    setKeywords((prev) => prev.filter((k) => k.campaign_id !== campaign.id))
    if (selectedCampaignId === campaign.id) setSelectedCampaignId(null)
  }

  async function addKeyword() {
    if (!selectedCampaign) return
    const { data, error } = await supabase
      .from('marketing_keywords')
      .insert({
        campaign_id: selectedCampaign.id,
        keyword: 'nueva palabra clave',
        match_type: 'exacta',
        action: 'nueva',
        applied: false,
      })
      .select('*')
      .single()
    if (error) {
      console.error('Error creando la keyword:', error)
      toast.error('No se pudo crear la keyword')
      return
    }
    setKeywords((prev) => [...prev, data as MarketingKeyword])
  }

  async function removeKeyword(keyword: MarketingKeyword) {
    const { error } = await supabase.from('marketing_keywords').delete().eq('id', keyword.id)
    if (error) {
      console.error('Error borrando la keyword:', error)
      toast.error('No se pudo borrar')
      return
    }
    setKeywords((prev) => prev.filter((k) => k.id !== keyword.id))
  }

  // ---------- Productos ----------
  async function patchProduct(product: MarketingProduct, patch: Partial<MarketingProduct>) {
    setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, ...patch } : p)))
    const { error } = await supabase.from('marketing_products').update(patch).eq('id', product.id)
    if (error) {
      console.error('Error guardando el producto:', error)
      // El único fallo esperable es repetir un ASIN dentro del mismo cliente,
      // y decir «no se pudo guardar» a secas dejaría al usuario mirando un
      // campo que revierte sin saber por qué.
      toast.error(
        error.code === '23505'
          ? 'Ese ASIN ya está dado de alta en este cliente'
          : 'No se pudo guardar el producto'
      )
      setProducts((prev) => prev.map((p) => (p.id === product.id ? product : p)))
    }
  }

  /**
   * Da de alta un producto del cliente. Devuelve la fila para que quien lo
   * llame desde la tabla de campañas pueda enlazarla en el acto.
   */
  async function createProduct(draft: NewProductDraft): Promise<MarketingProduct | null> {
    if (!clientId) return null
    const asin = draft.asin.trim().toUpperCase().replace(/\s/g, '')
    if (!asin) return null

    if (clientProducts.some((p) => p.asin === asin)) {
      toast.error(`El ASIN ${asin} ya está dado de alta en este cliente`)
      return null
    }

    const { data, error } = await supabase
      .from('marketing_products')
      .insert({ client_id: clientId, asin, sku: draft.sku, name: draft.name })
      .select('*')
      .single()
    if (error) {
      console.error('Error creando el producto:', error)
      toast.error('No se pudo crear el producto')
      return null
    }

    const row = data as MarketingProduct
    setProducts((prev) => (prev.some((p) => p.id === row.id) ? prev : [...prev, row]))

    // El enlace automático solo funciona con ASINs con la forma que reconoce
    // extractAsin(), que es la misma que aplica la base de datos. Si se da de
    // alta otra cosa, el producto vale igual pero habrá que enlazarlo a mano
    // siempre, y más vale saberlo ahora que descubrirlo dentro de un mes.
    if (extractAsin(row.asin) !== row.asin) {
      toast.warning(`«${row.asin}» no tiene forma de ASIN: sus campañas no se enlazarán solas`)
    }
    return row
  }

  /** Alta desde la tabla de campañas: se crea el ASIN que lleva el nombre y se enlaza */
  async function createProductForCampaign(asin: string, campaign: MarketingCampaign) {
    const product = await createProduct({ asin, sku: null, name: null })
    if (!product) return
    await patchCampaign(campaign, { product_id: product.id })
    toast.success(`${product.asin} dado de alta y enlazado`)
  }

  async function removeProduct(product: MarketingProduct) {
    const linked = campaigns.filter((c) => c.product_id === product.id).length
    const extra = linked > 0 ? ` ${linked} campañas se quedarán sin producto.` : ''
    if (!confirm(`¿Borrar «${product.name || product.asin}»?${extra}`)) return

    const { error } = await supabase.from('marketing_products').delete().eq('id', product.id)
    if (error) {
      console.error('Error borrando el producto:', error)
      toast.error('No se pudo borrar')
      return
    }
    setProducts((prev) => prev.filter((p) => p.id !== product.id))
    setProductWeeks((prev) => prev.filter((r) => r.product_id !== product.id))
    // La FK es ON DELETE SET NULL, así que en base de datos ya están sueltas:
    // aquí solo se refleja para no seguir pintando un producto que ya no está.
    setCampaigns((prev) =>
      prev.map((c) => (c.product_id === product.id ? { ...c, product_id: null } : c))
    )
  }

  /**
   * Guarda las cifras de Sellerboard del producto en la semana abierta.
   *
   * La fila puede no existir todavía: se crea con el primer número que se
   * teclee, para no tener que abrir nada antes de escribir. El upsert se apoya
   * en el UNIQUE (product_id, week_id) por si otro navegador se ha adelantado.
   */
  async function patchProductWeek(
    product: MarketingProduct,
    patch: Partial<MarketingProductWeek>
  ) {
    if (!week) {
      toast.error('Abre la semana antes de volcar las cifras del producto')
      return
    }

    const existing =
      productWeeks.find((r) => r.product_id === product.id && r.week_id === week.id) ?? null

    if (existing) {
      setProductWeeks((prev) => prev.map((r) => (r.id === existing.id ? { ...r, ...patch } : r)))
      const { error } = await supabase
        .from('marketing_product_weeks')
        .update(patch)
        .eq('id', existing.id)
      if (error) {
        console.error('Error guardando las cifras del producto:', error)
        toast.error('No se pudieron guardar las cifras del producto')
        setProductWeeks((prev) => prev.map((r) => (r.id === existing.id ? existing : r)))
      }
      return
    }

    const { data, error } = await supabase
      .from('marketing_product_weeks')
      .upsert(
        { product_id: product.id, week_id: week.id, ...patch },
        { onConflict: 'product_id,week_id' }
      )
      .select('*')
      .single()
    if (error) {
      console.error('Error creando las cifras del producto:', error)
      toast.error('No se pudieron guardar las cifras del producto')
      return
    }
    const row = data as MarketingProductWeek
    setProductWeeks((prev) =>
      prev.some((r) => r.id === row.id) ? prev.map((r) => (r.id === row.id ? row : r)) : [...prev, row]
    )
  }

  /**
   * Arranca la semana con la estructura de la anterior: mismas campañas y
   * mismas keywords, con las métricas en blanco (son otra semana) pero
   * conservando las pujas, que es lo que costaría media hora volver a teclear.
   */
  async function duplicateFromPrevious() {
    if (!clientId || busy) return
    if (!previousWeek) {
      toast.error('La semana pasada no está abierta para este cliente')
      return
    }
    const source = campaigns.filter((c) => c.week_id === previousWeek.id)
    if (source.length === 0) {
      toast.error('La semana pasada no tiene campañas')
      return
    }

    setBusy(true)
    try {
      const target = week ?? (await createWeek())
      if (!target) return
      if (campaigns.some((c) => c.week_id === target.id)) {
        toast.error('Esta semana ya tiene campañas: bórralas antes de duplicar')
        return
      }

      const { data, error } = await supabase
        .from('marketing_campaigns')
        .insert(
          source.map((c, i) => ({
            week_id: target.id,
            name: c.name,
            campaign_type: c.campaign_type,
            status: c.status,
            daily_budget: c.daily_budget,
            // El producto es del cliente, no de la semana, así que el enlace
            // sigue valiendo tal cual y ahorra volver a emparejarlo entero.
            product_id: c.product_id,
            review_status: 'pendiente',
            position: c.position ?? i + 1,
          }))
        )
        .select('*')
      if (error) throw error
      const created = (data as MarketingCampaign[]) ?? []

      // Postgres devuelve las filas de un INSERT múltiple en el mismo orden en
      // que se mandaron, así que el índice basta para casar original y copia.
      // Cruzar por nombre no serviría: dos campañas pueden llamarse igual.
      const newIdBySource = new Map<string, string>()
      created.forEach((row, i) => {
        const src = source[i]
        if (src) newIdBySource.set(src.id, row.id)
      })

      // Las keywords de la semana pasada no están en memoria: solo se cargan
      // las de la semana visible.
      const sourceKeywords = await fetchKeywords(
        supabase,
        source.map((c) => c.id)
      )

      const payload = sourceKeywords
        .map((k) => {
          const campaignId = newIdBySource.get(k.campaign_id)
          if (!campaignId) return null
          return {
            campaign_id: campaignId,
            keyword: k.keyword,
            match_type: k.match_type,
            // Si el ajuste llegó a ejecutarse en Amazon, la puja de partida de
            // esta semana es la que se sugirió, no la vieja.
            current_bid: k.applied && k.suggested_bid != null ? k.suggested_bid : k.current_bid,
            suggested_bid: null,
            action: 'mantener',
            applied: false,
          }
        })
        .filter(Boolean) as Array<Record<string, unknown>>

      const insertedKeywords: MarketingKeyword[] = []
      const CHUNK = 500
      for (let i = 0; i < payload.length; i += CHUNK) {
        const { data: kwData, error: kwError } = await supabase
          .from('marketing_keywords')
          .insert(payload.slice(i, i + CHUNK))
          .select('*')
        if (kwError) throw kwError
        insertedKeywords.push(...((kwData as MarketingKeyword[]) ?? []))
      }

      // El coste unitario se arrastra y las ventas no: el coste es el mismo
      // hasta que el proveedor lo cambia, mientras que las ventas totales son
      // de esta semana y hay que ir a buscarlas a Sellerboard. Así la columna
      // de coste queda documentada aunque nadie la toque, que es justo lo que
      // se pedía, y las filas nacen ya creadas para que se vea qué falta.
      const previousCosts = productWeeks.filter(
        (r) => r.week_id === previousWeek.id && r.unit_cost != null
      )
      let carriedCosts: MarketingProductWeek[] = []
      if (previousCosts.length > 0) {
        const { data: costData, error: costError } = await supabase
          .from('marketing_product_weeks')
          .upsert(
            previousCosts.map((r) => ({
              product_id: r.product_id,
              week_id: target.id,
              unit_cost: r.unit_cost,
            })),
            { onConflict: 'product_id,week_id' }
          )
          .select('*')
        // Un fallo aquí no puede tumbar la duplicación: las campañas y las
        // keywords, que es lo que cuesta media hora rehacer, ya están dentro.
        if (costError) console.error('Error arrastrando el coste de producto:', costError)
        else carriedCosts = (costData as MarketingProductWeek[]) ?? []
      }

      setCampaigns((prev) => [...prev, ...created])
      setKeywords((prev) => [...prev, ...insertedKeywords])
      setProductWeeks((prev) => [
        ...prev.filter((r) => !carriedCosts.some((n) => n.id === r.id)),
        ...carriedCosts,
      ])
      setSelectedCampaignId(created[0]?.id ?? null)
      toast.success(
        `Duplicado: ${created.length} campañas y ${insertedKeywords.length} keywords`
      )
    } catch (err) {
      console.error('Error duplicando la semana anterior:', err)
      toast.error('No se pudo duplicar la semana anterior')
    } finally {
      setBusy(false)
    }
  }

  // ---------- Navegación ----------
  function goToWeek(next: string) {
    setWeekStart(next)
    setSelectedCampaignId(null)
    setMobileView('campaigns')
  }

  function selectClient(id: string) {
    setClientId(id)
    setSelectedCampaignId(null)
    setMobileView('campaigns')
  }

  function openCampaign(id: string) {
    setSelectedCampaignId(id)
    if (isMobile) setMobileView('keywords')
  }

  /**
   * Descarga el histórico completo del cliente en Excel.
   *
   * Se baja como blob en vez de navegar a la URL para poder enseñar el
   * spinner y avisar del fallo: el libro se arma con todas las semanas y
   * tarda lo suyo, y con una navegación un 500 dejaría la pestaña en blanco.
   */
  async function exportExcel() {
    if (!clientId || exporting) return
    setExporting(true)
    try {
      const res = await fetch(`/api/marketing/export?client_id=${clientId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const disposition = res.headers.get('Content-Disposition') ?? ''
      const named = /filename="?([^";]+)"?/.exec(disposition)
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = named?.[1] ?? 'marketing.xlsx'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      toast.success('Excel descargado')
    } catch (err) {
      console.error('Error exportando marketing:', err)
      toast.error('No se pudo generar el Excel')
    } finally {
      setExporting(false)
    }
  }

  const thisWeek = currentWeekStart()
  const panel = (view: typeof mobileView) =>
    isMobile && mobileView !== view ? 'hidden' : 'flex'

  // Campañas y productos comparten celda, así que en móvil son dos pestañas
  // del mismo panel y no dos paneles: cuál se ve lo decide `mainView`.
  const tabs = [
    {
      id: 'campaigns' as const,
      view: 'campaigns' as const,
      main: 'campaigns' as const,
      icon: LayoutList,
      label: `Campañas (${weekCampaigns.length})`,
    },
    {
      id: 'products' as const,
      view: 'campaigns' as const,
      main: 'products' as const,
      icon: Package,
      label: `Productos (${clientProducts.length})`,
      /** Trabajo pendiente del especialista: se ve desde la pestaña sin abrirla */
      badge: weekTacos.blindProducts,
    },
    {
      id: 'keywords' as const,
      view: 'keywords' as const,
      icon: KeyRound,
      label: `Keywords (${selectedKeywords.length})`,
    },
    {
      id: 'changes' as const,
      view: 'changes' as const,
      icon: History,
      label: `Diario (${changes.length})`,
    },
  ]

  const activeTab = mobileView === 'campaigns' ? mainView : mobileView

  return (
    <div className="flex flex-col h-full gap-3 min-w-0">
      {/* Clientes */}
      <div className="flex items-center gap-1.5 overflow-x-auto flex-shrink-0 -mx-1 px-1 pb-0.5 min-w-0">
        {visibleClients.map((c) => {
          const active = c.id === clientId
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => selectClient(c.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] font-medium whitespace-nowrap flex-shrink-0 transition-colors ${
                active ? 'text-white' : 'border-white/10 text-white/45 hover:text-white/80'
              }`}
              style={
                active
                  ? { borderColor: `${c.color}80`, backgroundColor: `${c.color}1f` }
                  : undefined
              }
            >
              <span
                className="h-2 w-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: c.color }}
              />
              {c.name}
            </button>
          )
        })}
      </div>

      {/* Semana */}
      <div className="flex flex-wrap items-center justify-between gap-2 flex-shrink-0 min-w-0">
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-1.5 py-1 min-w-0">
          <button
            type="button"
            onClick={() => goToWeek(shiftWeek(weekStart, -1))}
            className="h-7 w-7 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors flex-shrink-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <AnimatePresence mode="wait">
            <motion.span
              key={weekStart}
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 3 }}
              transition={{ duration: 0.15 }}
              className="text-[14px] font-semibold text-white px-2 whitespace-nowrap flex items-center gap-1.5"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 text-[#FF6600] animate-spin" />
              ) : (
                <CalendarDays className="h-3.5 w-3.5 text-[#FF6600]" />
              )}
              {weekLabel(weekStart)}
              <span className="text-[11px] font-normal text-white/35">
                S{isoWeekNumber(weekStart)}
              </span>
            </motion.span>
          </AnimatePresence>
          <button
            type="button"
            onClick={() => goToWeek(shiftWeek(weekStart, 1))}
            className="h-7 w-7 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors flex-shrink-0"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {weekStart !== thisWeek && (
            <button
              type="button"
              onClick={() => goToWeek(thisWeek)}
              className="text-[11px] text-white/40 hover:text-white px-2 transition-colors whitespace-nowrap"
            >
              Esta semana
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {week && (
            <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-0.5">
              {WEEK_STATUSES.map((s) => {
                const active = week.status === s
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => patchWeek({ status: s as MarketingWeekStatus })}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap ${
                      active ? 'text-white' : 'text-white/35 hover:text-white/70'
                    }`}
                    style={active ? { backgroundColor: `${WEEK_STATUS_COLORS[s]}2e` } : undefined}
                  >
                    {WEEK_STATUS_LABELS[s]}
                  </button>
                )
              })}
            </div>
          )}

          {!week && clientId && (
            <button
              type="button"
              onClick={createWeek}
              className="h-9 px-4 rounded-full border border-white/10 bg-white/[0.03] text-white/80 text-[13px] font-medium flex items-center gap-2 hover:bg-white/[0.06] hover:border-white/20 transition-colors"
            >
              <CalendarPlus className="h-4 w-4" /> Nueva semana
            </button>
          )}

          <button
            type="button"
            onClick={duplicateFromPrevious}
            disabled={busy || !previousWeek}
            title="Copia campañas y keywords de la semana pasada con las métricas en blanco y las pujas intactas"
            className="h-9 px-4 rounded-full border border-white/10 bg-white/[0.03] text-white/80 text-[13px] font-medium flex items-center gap-2 hover:bg-white/[0.06] hover:border-white/20 transition-colors disabled:opacity-40"
          >
            <CopyPlus className="h-4 w-4" />
            {busy ? 'Duplicando...' : 'Duplicar de la semana pasada'}
          </button>

          <button
            type="button"
            onClick={exportExcel}
            disabled={exporting || !clientId}
            title="Descarga en Excel todas las semanas de este cliente: resumen, campañas, keywords y diario"
            className="h-9 px-4 rounded-full border border-white/10 bg-white/[0.03] text-white/80 text-[13px] font-medium flex items-center gap-2 hover:bg-white/[0.06] hover:border-white/20 transition-colors disabled:opacity-40"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {exporting ? 'Generando...' : 'Excel'}
          </button>
        </div>
      </div>

      {/* KPIs de la semana contra la anterior */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 flex-shrink-0">
        {kpis.map((k) => {
          const delta = deltaOf(k.current, k.previous, k.points)
          return (
            <div
              key={k.key}
              className={`rounded-xl border px-3 py-2 ${
                k.warning
                  ? 'border-[#FBBF24]/30 bg-[#FBBF24]/[0.05]'
                  : 'border-white/10 bg-white/[0.02]'
              }`}
              title={k.warningTitle ?? undefined}
            >
              <p className="text-[10px] uppercase tracking-wider text-white/35 flex items-center gap-1.5">
                <k.icon className="h-3 w-3 flex-shrink-0" /> {k.label}
                {k.warning && (
                  <AlertTriangle className="h-3 w-3 flex-shrink-0 text-[#FBBF24]" />
                )}
              </p>
              <p className={`font-bold text-[19px] mt-0.5 tabular-nums truncate ${k.tone}`}>
                {k.value}
              </p>
              {/* Cuando la cifra no cubre toda la cuenta, el aviso se come el
                  delta: comparar dos semanas con distinta cobertura sería
                  inventarse una tendencia. */}
              <p className="text-[10px] mt-0.5 tabular-nums h-3.5 truncate">
                {k.warning ? (
                  <span className="text-[#FBBF24]/80">parcial · {k.warning}</span>
                ) : delta ? (
                  <span className={deltaTone(delta.sign, k.better)}>
                    {delta.sign > 0 ? '▲' : delta.sign < 0 ? '▼' : '='} {delta.text}
                  </span>
                ) : (
                  <span className="text-white/20">
                    {hasPrevious ? 'sin comparativa' : 'sin semana previa'}
                  </span>
                )}
              </p>
            </div>
          )
        })}
      </div>

      {/* Progreso de la revisión */}
      <div className="flex items-center gap-3 flex-shrink-0 min-w-0">
        <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden min-w-0">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[#FF7A1F] to-[#FF6600]"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.25 }}
          />
        </div>
        <span className="text-[11px] text-white/45 tabular-nums whitespace-nowrap flex-shrink-0">
          {reviewed}/{weekCampaigns.length} campañas revisadas
          {pendingKeywords > 0 && (
            <span className="text-[#FF6600] font-semibold"> · {pendingKeywords} pujas por aplicar</span>
          )}
        </span>
      </div>

      {/* Selector de panel en móvil */}
      <div className="flex lg:hidden items-center gap-1.5 flex-shrink-0 min-w-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setMobileView(t.view)
              if (t.main) setMainView(t.main)
            }}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1 px-2 py-1.5 rounded-full border text-[11px] font-medium transition-colors ${
              activeTab === t.id
                ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.1] text-white'
                : 'border-white/10 text-white/40'
            }`}
          >
            <t.icon className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{t.label}</span>
            {!!t.badge && (
              <span className="h-1.5 w-1.5 rounded-full bg-[#FBBF24] flex-shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* Paneles */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)] lg:grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)] gap-3">
        <div
          className={`${panel('campaigns')} flex-col min-w-0 min-h-0 flex-1 lg:flex-none lg:col-start-1 lg:row-start-1 gap-2`}
        >
          {/* En escritorio el cambio va aquí, pegado a la tabla: son la misma
              semana vista por campaña o por producto. */}
          <div className="hidden lg:flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-0.5 self-start flex-shrink-0">
            {tabs
              .filter((t) => t.main)
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => t.main && setMainView(t.main)}
                  className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                    mainView === t.main
                      ? 'bg-[#FF6600]/[0.14] text-white'
                      : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  <t.icon className="h-3 w-3" />
                  {t.label}
                  {!!t.badge && (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-[#FBBF24]"
                      title={`${t.badge} productos con gasto y sin ventas totales`}
                    />
                  )}
                </button>
              ))}
          </div>

          {mainView === 'campaigns' ? (
            <CampaignsTable
              campaigns={weekCampaigns}
              previousCampaigns={previousCampaigns}
              keywordCounts={keywordCounts}
              products={clientProducts}
              productStats={statsById}
              onCreateProduct={createProductForCampaign}
              selectedId={selectedCampaignId}
              onSelect={openCampaign}
              onPatch={patchCampaign}
              onAdd={addCampaign}
              onRemove={removeCampaign}
              hasWeek={!!week}
              onCreateWeek={createWeek}
              className="flex-1 min-h-0"
            />
          ) : (
            <ProductsPanel
              stats={stats}
              summary={weekTacos}
              weekId={week?.id ?? null}
              onCreateWeek={createWeek}
              onPatchProduct={patchProduct}
              onPatchWeek={patchProductWeek}
              onAdd={async (draft) => (await createProduct(draft)) != null}
              onRemove={removeProduct}
              showBack={isMobile}
              onBack={() => setMainView('campaigns')}
              className="flex-1 min-h-0"
            />
          )}
        </div>

        <div
          className={`${panel('changes')} flex-col min-w-0 min-h-0 flex-1 lg:flex-none lg:col-start-2 lg:row-start-1`}
        >
          <ChangesLog
            weekId={week?.id ?? null}
            changes={changes}
            campaignNames={campaignNames}
            authorNames={authorNames}
            currentUserId={currentUserId}
            onLogged={(row) =>
              setChanges((prev) => (prev.some((c) => c.id === row.id) ? prev : [row, ...prev]))
            }
            showBack={isMobile}
            onBack={() => setMobileView('campaigns')}
            className="flex-1 min-h-0"
          />
        </div>

        <div
          className={`${panel('keywords')} flex-col min-w-0 min-h-0 flex-1 lg:flex-none lg:col-start-1 lg:col-span-2 lg:row-start-2`}
        >
          <KeywordsPanel
            campaign={selectedCampaign}
            keywords={selectedKeywords}
            onPatch={patchKeyword}
            onAdd={addKeyword}
            onRemove={removeKeyword}
            showBack={isMobile}
            onBack={() => setMobileView('campaigns')}
            className="flex-1 min-h-0"
          />
        </div>
      </div>

      {client?.amazon_seller_url && (
        <a
          href={client.amazon_seller_url}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden lg:block text-[11px] text-white/30 hover:text-[#FF6600] transition-colors flex-shrink-0 truncate"
        >
          Abrir {client.name} en Seller Central
        </a>
      )}
    </div>
  )
}
