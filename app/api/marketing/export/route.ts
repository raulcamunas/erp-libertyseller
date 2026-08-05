import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { toMadrid } from '@/lib/timezone'
import {
  MarketingCampaign,
  MarketingChange,
  MarketingClient,
  MarketingKeyword,
  MarketingWeek,
  BID_ACTION_LABELS,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_TYPE_LABELS,
  MATCH_TYPE_LABELS,
  REVIEW_STATUS_LABELS,
  WEEK_STATUS_LABELS,
  acos,
  changeTypeLabel,
  ctr,
  cvr,
  isoWeekNumber,
  weekLabel,
} from '@/lib/types/marketing'

/**
 * Vuelca el módulo de marketing entero a un .xlsx de cuatro hojas.
 *
 * No es un informe: es la base de datos aplanada para poder dársela a un
 * modelo y que redacte el informe del cliente. De ahí las decisiones de
 * formato: fechas ISO, números como números y los UUID de cada fila al final
 * de cada hoja, que son los que permiten cruzar las cuatro hojas entre sí.
 */

const ROLES_PERMITIDOS = new Set(['admin', 'partner', 'employee'])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type MarketingSupabase = Awaited<ReturnType<typeof createClient>>

interface MarketingAuthorRow {
  id: string
  full_name: string | null
  email: string | null
}

// =====================================================
// Lectura
// =====================================================

// Supabase corta cualquier consulta a 1000 filas y .limit() no lo salta.
const PAGE = 1000

// Los ids de un .in() viajan en la query string: con miles de UUID el servidor
// responde 414 antes de mirar la consulta, así que la lista se trocea.
const ID_CHUNK = 150

/**
 * Todas las filas de `table` cuyo `column` esté en `ids`.
 *
 * Ordena por id, no por lo que interese enseñar: el troceado en páginas de
 * .range() necesita un orden total y estable, y position/created_at empatan.
 * La ordenación de presentación se hace luego en memoria.
 */
async function fetchAllIn<T>(
  supabase: MarketingSupabase,
  table: string,
  column: string,
  ids: string[],
  columns = '*'
): Promise<T[]> {
  if (ids.length === 0) return []
  const out: T[] = []

  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const slice = ids.slice(i, i + ID_CHUNK)
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .in(column, slice)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw error
      const chunk = (data ?? []) as T[]
      out.push(...chunk)
      if (chunk.length < PAGE) break
    }
  }

  return out
}

async function fetchClients(
  supabase: MarketingSupabase,
  clientId: string | null
): Promise<MarketingClient[]> {
  const out: MarketingClient[] = []

  for (let from = 0; ; from += PAGE) {
    let query = supabase.from('marketing_clients').select('*')
    if (clientId) query = query.eq('id', clientId)

    const { data, error } = await query
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const chunk = (data ?? []) as MarketingClient[]
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }

  return out
}

// =====================================================
// Números
// =====================================================

type CellValue = string | number | null

/**
 * Deja el número listo para una celda numérica: redondeado, para que no
 * aparezcan colas de coma flotante, y null cuando no hay dato — la celda se
 * queda vacía en vez de con un cero que se leería como un cero real.
 */
function num(value: number | null | undefined, decimals = 2): number | null {
  if (value == null) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}

/** Entero, para impresiones, clics y pedidos */
function int(value: number | null | undefined): number | null {
  return num(value, 0)
}

/**
 * Suma tratando null como «todavía no volcado desde Amazon».
 *
 * Si ninguna fila trae el dato devuelve null y no cero: un cero en la hoja de
 * resumen haría escribir que esa semana no hubo actividad, cuando lo que pasa
 * es que no se ha cargado. Es la misma distinción que guarda la tabla.
 */
function sumOrNull<T>(rows: T[], pick: (row: T) => number | null): number | null {
  let total = 0
  let seen = false
  for (const row of rows) {
    const value = pick(row)
    if (value == null) continue
    const n = Number(value)
    if (!Number.isFinite(n)) continue
    total += n
    seen = true
  }
  return seen ? total : null
}

/**
 * Variación relativa en %.
 *
 * Con base cero devuelve null en vez de infinito: pasar de 0 a 40 pedidos no
 * es «un 4000 % más», es una métrica que no existía la semana anterior.
 */
function pctChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

/**
 * Diferencia entre dos porcentajes, en puntos porcentuales.
 *
 * Restar un ACoS de otro no da un porcentaje de variación sino puntos; la
 * cabecera de la columna lo dice para que nadie los sume como si fueran %.
 */
function ppChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null
  return current - previous
}

// =====================================================
// Fechas
// =====================================================

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** week_start y week_end son DATE y ya llegan en ISO; el slice cubre un futuro cambio a timestamp */
function isoDay(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null
}

/**
 * Instante del diario partido en día y hora de España.
 *
 * En UTC, un cambio anotado un lunes a las 00:30 de Madrid caería en la fecha
 * del domingo y se contaría en la semana anterior en cualquier análisis que
 * agrupe por fecha.
 */
function madridDayAndTime(iso: string): { day: string; time: string } {
  const d = toMadrid(iso)
  return {
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

/** Nombre de cliente apto para una cabecera Content-Disposition: sin tildes, espacios ni comillas */
function slug(value: string): string {
  const plain = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return plain || 'cliente'
}

// =====================================================
// Construcción del libro
// =====================================================

/** Sin esto Excel deja todas las columnas en 8,43 y las cabeceras largas se cortan */
function columnWidths(headers: readonly string[]): { wch: number }[] {
  return headers.map((header) => {
    if (header.startsWith('ID ')) return { wch: 38 }
    if (
      header === 'Descripción' ||
      header === 'Notas' ||
      header === 'Antes' ||
      header === 'Después' ||
      header === 'Palabra clave' ||
      header === 'Etiqueta'
    ) {
      return { wch: 30 }
    }
    if (header === 'Cliente' || header === 'Campaña' || header === 'Autor') return { wch: 26 }
    return { wch: Math.max(11, header.length + 2) }
  })
}

/**
 * Añade una hoja con las columnas en el orden de `headers`.
 *
 * El `header` explícito no es solo orden: con él la hoja sale con cabecera
 * aunque no haya ni una fila, que es lo que pasa con un cliente recién dado de
 * alta, y así el fichero sigue siendo legible como esquema.
 */
function addSheet(
  workbook: XLSX.WorkBook,
  name: string,
  headers: readonly string[],
  rows: Record<string, CellValue>[]
): void {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...headers] })
  sheet['!cols'] = columnWidths(headers)
  const lastColumn = XLSX.utils.encode_col(headers.length - 1)
  sheet['!autofilter'] = { ref: `A1:${lastColumn}${rows.length + 1}` }
  XLSX.utils.book_append_sheet(workbook, sheet, name)
}

/**
 * Pone la cabecera en negrita y congela la primera fila.
 *
 * xlsx 0.18.5 es la edición comunitaria: al escribir descarta el `s` de cada
 * celda y cualquier panel congelado, eso solo lo hace la versión de pago. Como
 * el propio paquete sí exporta su implementación de ZIP (CFB), se reabre el
 * .xlsx recién generado y se parchean los dos XML a mano. Es lo que evita
 * meter una segunda librería de Excel en el ERP solo por el formato.
 *
 * Si el parcheo falla se devuelve el libro sin formato: una cabecera sin
 * negrita no le quita valor a la exportación, un 500 sí.
 */
function withBoldFrozenHeader(buffer: Buffer): Buffer {
  try {
    const CFB = XLSX.CFB
    const cfb = CFB.read(buffer, { type: 'buffer' })

    const read = (path: string): string => {
      const entry = CFB.find(cfb, path)
      if (!entry) throw new Error(`El .xlsx generado no contiene ${path}`)
      return Buffer.from(entry.content).toString('utf8')
    }

    const styles = read('/xl/styles.xml')
    const font = appendToList(
      styles,
      'fonts',
      '<font><b/><sz val="12"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
    )
    const format = appendToList(
      font.xml,
      'cellXfs',
      `<xf numFmtId="0" fontId="${font.index}" fillId="0" borderId="0" xfId="0" applyFont="1"/>`
    )
    CFB.utils.cfb_add(cfb, '/xl/styles.xml', Buffer.from(format.xml, 'utf8'))

    for (const fullPath of [...cfb.FullPaths] as string[]) {
      if (!/\/xl\/worksheets\/sheet\d+\.xml$/.test(fullPath)) continue
      // FullPaths viene con el «Root Entry» delante y CFB.find lo quiere sin él
      const path = fullPath.slice(fullPath.indexOf('/'))

      const patched = read(path)
        .replace(
          /<sheetView\b([^>]*)\/>/,
          '<sheetView$1><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView>'
        )
        .replace(/<row r="1"(?:\s[^>]*)?>[\s\S]*?<\/row>/, (row) =>
          row.replace(/<c /g, `<c s="${format.index}" `)
        )

      CFB.utils.cfb_add(cfb, path, Buffer.from(patched, 'utf8'))
    }

    return CFB.write(cfb, { type: 'buffer', fileType: 'zip' }) as Buffer
  } catch (error) {
    console.error('No se pudo dar formato a la cabecera del Excel:', error)
    return buffer
  }
}

/** Añade `child` dentro de `<tag>`, sube su atributo count y devuelve el índice que ocupa */
function appendToList(xml: string, tag: string, child: string): { xml: string; index: number } {
  const opening = new RegExp(`<${tag}([^>]*)>`).exec(xml)
  if (!opening || opening[0].endsWith('/>')) throw new Error(`styles.xml no trae <${tag}>`)

  const count = Number(/count="(\d+)"/.exec(opening[1])?.[1] ?? '0')
  const withCount = opening[0].replace(/count="\d+"/, `count="${count + 1}"`)
  const head =
    xml.slice(0, opening.index) + withCount + xml.slice(opening.index + opening[0].length)

  const closing = head.indexOf(`</${tag}>`, opening.index)
  if (closing < 0) throw new Error(`styles.xml no cierra <${tag}>`)

  return { xml: head.slice(0, closing) + child + head.slice(closing), index: count }
}

// =====================================================
// Hojas
// =====================================================

const SUMMARY_HEADERS = [
  'Cliente',
  'Semana (inicio)',
  'Semana (fin)',
  'Semana ISO',
  'Etiqueta',
  'Estado',
  'Campañas',
  'Campañas activas',
  'Impresiones',
  'Clics',
  'CTR (%)',
  'Pedidos',
  'CVR (%)',
  'Gasto (€)',
  'Ventas (€)',
  'ACoS (%)',
  'TACoS (%)',
  'Semana anterior (inicio)',
  'Δ Impresiones (%)',
  'Δ Clics (%)',
  'Δ Pedidos (%)',
  'Δ Gasto (%)',
  'Δ Ventas (%)',
  'Δ ACoS (p.p.)',
  'Δ TACoS (p.p.)',
  'Notas',
  'ID semana',
  'ID cliente',
] as const

const CAMPAIGN_HEADERS = [
  'Cliente',
  'Semana (inicio)',
  'Semana (fin)',
  'Semana ISO',
  'Campaña',
  'Tipo',
  'Estado',
  'Presupuesto diario (€)',
  'Impresiones',
  'Clics',
  'CTR (%)',
  'Pedidos',
  'CVR (%)',
  'Gasto (€)',
  'Ventas (€)',
  'ACoS (%)',
  'TACoS (%)',
  'Revisión',
  'Palabras clave',
  'Notas',
  'ID campaña',
  'ID semana',
  'ID cliente',
] as const

const KEYWORD_HEADERS = [
  'Cliente',
  'Semana (inicio)',
  'Semana (fin)',
  'Campaña',
  'Tipo campaña',
  'Palabra clave',
  'Concordancia',
  'Puja antes (€)',
  'Puja después (€)',
  'Δ Puja (€)',
  'Acción',
  'Aplicado',
  'Impresiones',
  'Clics',
  'CTR (%)',
  'Pedidos',
  'CVR (%)',
  'Gasto (€)',
  'Ventas (€)',
  'ACoS (%)',
  'Notas',
  'ID palabra clave',
  'ID campaña',
  'ID semana',
  'ID cliente',
] as const

const CHANGE_HEADERS = [
  'Fecha',
  'Hora',
  'Cliente',
  'Semana (inicio)',
  'Semana (fin)',
  'Campaña',
  'Palabra clave',
  'Tipo',
  'Descripción',
  'Antes',
  'Después',
  'Autor',
  'ID cambio',
  'ID campaña',
  'ID palabra clave',
  'ID semana',
  'ID cliente',
] as const

type SummaryRow = Record<(typeof SUMMARY_HEADERS)[number], CellValue>
type CampaignRow = Record<(typeof CAMPAIGN_HEADERS)[number], CellValue>
type KeywordRow = Record<(typeof KEYWORD_HEADERS)[number], CellValue>
type ChangeRow = Record<(typeof CHANGE_HEADERS)[number], CellValue>

/**
 * Los porcentajes guardados mandan sobre los calculados: Amazon los reporta
 * con su propia ventana de atribución y son los que ve el cliente en Seller
 * Central. Solo se calculan cuando la columna está vacía.
 */
function pctOf(stored: number | null, computed: number | null): number | null {
  return num(stored ?? computed)
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // El especialista de PPC es 'employee', igual que en is_marketing_team:
    // dejarlo fuera sería cerrarle la exportación a quien lleva el módulo.
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (!profile || !ROLES_PERMITIDOS.has(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const clientId = request.nextUrl.searchParams.get('client_id')
    if (clientId && !UUID.test(clientId)) {
      return NextResponse.json({ error: 'client_id no es un UUID válido' }, { status: 400 })
    }

    const clients = await fetchClients(supabase, clientId)
    if (clients.length === 0) {
      return NextResponse.json(
        { error: clientId ? 'El cliente no existe' : 'No hay clientes de marketing que exportar' },
        { status: 404 }
      )
    }

    const weeks = await fetchAllIn<MarketingWeek>(
      supabase,
      'marketing_weeks',
      'client_id',
      clients.map((c) => c.id)
    )
    const campaigns = await fetchAllIn<MarketingCampaign>(
      supabase,
      'marketing_campaigns',
      'week_id',
      weeks.map((w) => w.id)
    )
    const keywords = await fetchAllIn<MarketingKeyword>(
      supabase,
      'marketing_keywords',
      'campaign_id',
      campaigns.map((c) => c.id)
    )
    const changes = await fetchAllIn<MarketingChange>(
      supabase,
      'marketing_changes',
      'week_id',
      weeks.map((w) => w.id)
    )

    const authorIds = Array.from(
      new Set(changes.map((c) => c.author_id).filter((id): id is string => Boolean(id)))
    )
    const authors = await fetchAllIn<MarketingAuthorRow>(
      supabase,
      'profiles',
      'id',
      authorIds,
      'id, full_name, email'
    )

    // ---------- Índices ----------
    const clientById = new Map(clients.map((c) => [c.id, c]))
    const weekById = new Map(weeks.map((w) => [w.id, w]))
    const campaignById = new Map(campaigns.map((c) => [c.id, c]))
    const keywordById = new Map(keywords.map((k) => [k.id, k]))
    const authorById = new Map(authors.map((a) => [a.id, a]))

    const campaignsByWeek = new Map<string, MarketingCampaign[]>()
    for (const campaign of campaigns) {
      const list = campaignsByWeek.get(campaign.week_id)
      if (list) list.push(campaign)
      else campaignsByWeek.set(campaign.week_id, [campaign])
    }

    const keywordsByCampaign = new Map<string, MarketingKeyword[]>()
    for (const keyword of keywords) {
      const list = keywordsByCampaign.get(keyword.campaign_id)
      if (list) list.push(keyword)
      else keywordsByCampaign.set(keyword.campaign_id, [keyword])
    }

    // ---------- Orden de presentación ----------
    const clientName = (id: string | null | undefined): string =>
      (id && clientById.get(id)?.name) || ''

    const orderedClients = [...clients].sort(
      (a, b) => (a.position ?? 9999) - (b.position ?? 9999) || a.name.localeCompare(b.name, 'es')
    )

    // Cada cliente con sus semanas de la más antigua a la más reciente: la
    // comparativa contra la semana anterior necesita ese orden y el informe se
    // lee como una evolución, no como un ranking.
    const weeksByClient = new Map<string, MarketingWeek[]>()
    for (const client of orderedClients) weeksByClient.set(client.id, [])
    for (const week of weeks) weeksByClient.get(week.client_id)?.push(week)
    for (const list of weeksByClient.values()) {
      list.sort((a, b) => a.week_start.localeCompare(b.week_start))
    }

    const orderedCampaigns = (weekId: string): MarketingCampaign[] =>
      [...(campaignsByWeek.get(weekId) ?? [])].sort(
        (a, b) =>
          (a.position ?? 9999) - (b.position ?? 9999) ||
          a.created_at.localeCompare(b.created_at)
      )

    // ---------- Hoja 1: resumen semanal ----------
    const summaryRows: SummaryRow[] = []

    for (const client of orderedClients) {
      const clientWeeks = weeksByClient.get(client.id) ?? []

      // Se comparan revisiones consecutivas, no lunes contra lunes menos siete
      // días: si una semana no se revisó, la anterior real es la que da la
      // comparación honesta. La columna «Semana anterior (inicio)» dice contra
      // cuál se está comparando para que el dato no quede implícito.
      let previous: ReturnType<typeof aggregateWeek> | null = null

      for (const week of clientWeeks) {
        const current = aggregateWeek(orderedCampaigns(week.id))

        summaryRows.push({
          Cliente: client.name,
          'Semana (inicio)': isoDay(week.week_start),
          'Semana (fin)': isoDay(week.week_end),
          'Semana ISO': isoWeekNumber(week.week_start),
          Etiqueta: week.label || weekLabel(week.week_start),
          Estado: WEEK_STATUS_LABELS[week.status] ?? week.status,
          Campañas: current.total,
          'Campañas activas': current.active,
          Impresiones: int(current.impressions),
          Clics: int(current.clicks),
          'CTR (%)': num(current.ctr),
          Pedidos: int(current.orders),
          'CVR (%)': num(current.cvr),
          'Gasto (€)': num(current.spend),
          'Ventas (€)': num(current.sales),
          'ACoS (%)': num(current.acos),
          'TACoS (%)': num(current.tacos),
          'Semana anterior (inicio)': previous ? isoDay(previous.weekStart) : null,
          'Δ Impresiones (%)': num(pctChange(current.impressions, previous?.impressions ?? null)),
          'Δ Clics (%)': num(pctChange(current.clicks, previous?.clicks ?? null)),
          'Δ Pedidos (%)': num(pctChange(current.orders, previous?.orders ?? null)),
          'Δ Gasto (%)': num(pctChange(current.spend, previous?.spend ?? null)),
          'Δ Ventas (%)': num(pctChange(current.sales, previous?.sales ?? null)),
          'Δ ACoS (p.p.)': num(ppChange(current.acos, previous?.acos ?? null)),
          'Δ TACoS (p.p.)': num(ppChange(current.tacos, previous?.tacos ?? null)),
          Notas: week.notes,
          'ID semana': week.id,
          'ID cliente': client.id,
        })

        previous = { ...current, weekStart: week.week_start }
      }
    }

    // ---------- Hoja 2: campañas ----------
    const campaignRows: CampaignRow[] = []

    for (const client of orderedClients) {
      for (const week of weeksByClient.get(client.id) ?? []) {
        for (const campaign of orderedCampaigns(week.id)) {
          campaignRows.push({
            Cliente: client.name,
            'Semana (inicio)': isoDay(week.week_start),
            'Semana (fin)': isoDay(week.week_end),
            'Semana ISO': isoWeekNumber(week.week_start),
            Campaña: campaign.name,
            Tipo: CAMPAIGN_TYPE_LABELS[campaign.campaign_type] ?? campaign.campaign_type,
            Estado: CAMPAIGN_STATUS_LABELS[campaign.status] ?? campaign.status,
            'Presupuesto diario (€)': num(campaign.daily_budget),
            Impresiones: int(campaign.impressions),
            Clics: int(campaign.clicks),
            'CTR (%)': pctOf(campaign.ctr, ctr(campaign.clicks, campaign.impressions)),
            Pedidos: int(campaign.orders),
            'CVR (%)': pctOf(campaign.cvr, cvr(campaign.orders, campaign.clicks)),
            'Gasto (€)': num(campaign.spend),
            'Ventas (€)': num(campaign.sales),
            'ACoS (%)': pctOf(campaign.acos, acos(campaign.spend, campaign.sales)),
            'TACoS (%)': num(campaign.tacos),
            Revisión: REVIEW_STATUS_LABELS[campaign.review_status] ?? campaign.review_status,
            'Palabras clave': keywordsByCampaign.get(campaign.id)?.length ?? 0,
            Notas: campaign.notes,
            'ID campaña': campaign.id,
            'ID semana': week.id,
            'ID cliente': client.id,
          })
        }
      }
    }

    // ---------- Hoja 3: palabras clave ----------
    const keywordRows: KeywordRow[] = []

    for (const client of orderedClients) {
      for (const week of weeksByClient.get(client.id) ?? []) {
        for (const campaign of orderedCampaigns(week.id)) {
          const list = [...(keywordsByCampaign.get(campaign.id) ?? [])].sort((a, b) =>
            a.created_at.localeCompare(b.created_at)
          )

          for (const keyword of list) {
            keywordRows.push({
              Cliente: client.name,
              'Semana (inicio)': isoDay(week.week_start),
              'Semana (fin)': isoDay(week.week_end),
              Campaña: campaign.name,
              'Tipo campaña': CAMPAIGN_TYPE_LABELS[campaign.campaign_type] ?? campaign.campaign_type,
              'Palabra clave': keyword.keyword,
              Concordancia: MATCH_TYPE_LABELS[keyword.match_type] ?? keyword.match_type,
              'Puja antes (€)': num(keyword.current_bid),
              'Puja después (€)': num(keyword.suggested_bid),
              'Δ Puja (€)':
                keyword.current_bid == null || keyword.suggested_bid == null
                  ? null
                  : num(keyword.suggested_bid - keyword.current_bid),
              Acción: BID_ACTION_LABELS[keyword.action] ?? keyword.action,
              Aplicado: keyword.applied ? 'Sí' : 'No',
              Impresiones: int(keyword.impressions),
              Clics: int(keyword.clicks),
              'CTR (%)': num(ctr(keyword.clicks, keyword.impressions)),
              Pedidos: int(keyword.orders),
              'CVR (%)': num(cvr(keyword.orders, keyword.clicks)),
              'Gasto (€)': num(keyword.spend),
              'Ventas (€)': num(keyword.sales),
              'ACoS (%)': pctOf(keyword.acos, acos(keyword.spend, keyword.sales)),
              Notas: keyword.notes,
              'ID palabra clave': keyword.id,
              'ID campaña': campaign.id,
              'ID semana': week.id,
              'ID cliente': client.id,
            })
          }
        }
      }
    }

    // ---------- Hoja 4: diario de cambios ----------
    // Cliente, luego semana, luego instante ascendente: el diario se lee como
    // el relato de lo que se fue haciendo en la cuenta, que es justo lo que
    // hay que contarle al cliente. El autofiltro deja reordenarlo por fecha.
    const orderedChanges = [...changes].sort((a, b) => {
      const weekA = weekById.get(a.week_id)
      const weekB = weekById.get(b.week_id)
      return (
        clientName(weekA?.client_id).localeCompare(clientName(weekB?.client_id), 'es') ||
        (weekA?.week_start ?? '').localeCompare(weekB?.week_start ?? '') ||
        a.created_at.localeCompare(b.created_at)
      )
    })

    const changeRows: ChangeRow[] = orderedChanges.map((change) => {
      const week = weekById.get(change.week_id)
      const client = week ? clientById.get(week.client_id) : undefined
      // campaign_id y keyword_id son ON DELETE SET NULL: el cambio sobrevive a
      // lo que tocó, así que la celda puede quedarse vacía sin que sea un error
      const campaign = change.campaign_id ? campaignById.get(change.campaign_id) : undefined
      const keyword = change.keyword_id ? keywordById.get(change.keyword_id) : undefined
      const author = change.author_id ? authorById.get(change.author_id) : undefined
      const { day, time } = madridDayAndTime(change.created_at)

      return {
        Fecha: day,
        Hora: time,
        Cliente: client?.name ?? null,
        'Semana (inicio)': isoDay(week?.week_start),
        'Semana (fin)': isoDay(week?.week_end),
        Campaña: campaign?.name ?? null,
        'Palabra clave': keyword?.keyword ?? null,
        Tipo: changeTypeLabel(change.change_type),
        Descripción: change.description,
        Antes: change.before_value,
        Después: change.after_value,
        Autor: author?.full_name || author?.email || null,
        'ID cambio': change.id,
        'ID campaña': change.campaign_id,
        'ID palabra clave': change.keyword_id,
        'ID semana': change.week_id,
        'ID cliente': week?.client_id ?? null,
      }
    })

    // ---------- Libro ----------
    const workbook = XLSX.utils.book_new()
    addSheet(workbook, 'Resumen semanal', SUMMARY_HEADERS, summaryRows)
    addSheet(workbook, 'Campañas', CAMPAIGN_HEADERS, campaignRows)
    addSheet(workbook, 'Palabras clave', KEYWORD_HEADERS, keywordRows)
    addSheet(workbook, 'Cambios', CHANGE_HEADERS, changeRows)

    const raw = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    // El Buffer de Node no encaja en el BodyInit del fetch de la plataforma
    // (los tipos lo tratan como una vista sobre un ArrayBufferLike cualquiera)
    const file = new Uint8Array(withBoldFrozenHeader(raw))

    const scope = clientId ? slug(clients[0].name) : 'todos'
    const { day } = madridDayAndTime(new Date().toISOString())
    const filename = `marketing-${scope}-${day}.xlsx`

    return new NextResponse(file, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        // Sin Content-Length a mano: si el proxy de delante recodifica el
        // cuerpo, una longitud fija corta la descarga a medias.
        //
        // La exportación lleva datos de clientes, así que ni el navegador ni
        // el proxy deben guardarse una copia que sirva a la siguiente sesión.
        'Cache-Control': 'no-store',
      },
    })
  } catch (error: any) {
    console.error('Error exportando el módulo de marketing a Excel:', error)
    return NextResponse.json(
      { error: error?.message || 'Error al generar el Excel' },
      { status: 500 }
    )
  }
}

interface WeekAggregate {
  total: number
  active: number
  impressions: number | null
  clicks: number | null
  orders: number | null
  spend: number | null
  sales: number | null
  ctr: number | null
  cvr: number | null
  acos: number | null
  tacos: number | null
  weekStart?: string
}

/**
 * Totales de una semana a partir de sus campañas.
 *
 * Los porcentajes NO se promedian: la media de los ACoS de cinco campañas no
 * es el ACoS de la cuenta, porque una campaña de 3 € pesaría lo mismo que otra
 * de 300 €. Se recalculan sobre las sumas.
 *
 * El TACoS es la excepción y sí se suma, porque cada campaña lo mide contra la
 * MISMA facturación total de la cuenta y las partes suman el todo. Es el mismo
 * criterio que usa el tablero, para que la hoja cuadre con lo que se ve en el ERP.
 */
function aggregateWeek(campaigns: MarketingCampaign[]): WeekAggregate {
  const impressions = sumOrNull(campaigns, (c) => c.impressions)
  const clicks = sumOrNull(campaigns, (c) => c.clicks)
  const orders = sumOrNull(campaigns, (c) => c.orders)
  const spend = sumOrNull(campaigns, (c) => c.spend)
  const sales = sumOrNull(campaigns, (c) => c.sales)

  return {
    total: campaigns.length,
    active: campaigns.filter((c) => c.status === 'activa').length,
    impressions,
    clicks,
    orders,
    spend,
    sales,
    ctr: ctr(clicks, impressions),
    cvr: cvr(orders, clicks),
    acos: acos(spend, sales),
    tacos: sumOrNull(campaigns, (c) => c.tacos),
  }
}
