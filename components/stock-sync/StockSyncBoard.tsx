'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { useIsMobile } from '@/lib/use-is-mobile'
import { Boxes, ChevronRight, Database, History, Upload, Users } from 'lucide-react'
import {
  StockClient,
  StockMapping,
  StockRun,
  formatInt,
} from '@/lib/types/stock-sync'
import { StockProcessPanel } from './StockProcessPanel'
import { MappingsTable, NewMappingDraft } from './MappingsTable'
import { StockRunsHistory } from './StockRunsHistory'
import { ProcessResult, formatDay } from './shared'

type StockSupabase = ReturnType<typeof createClient>

/** Un cliente con lo que hace falta para pintar su tarjeta sin abrirlo */
export interface StockClientSummary {
  client: StockClient
  /** Filas de mapeo que tiene, activas e inactivas */
  mappingCount: number
  /** Cuándo se procesó su volcado por última vez; null si nunca */
  lastRunAt: string | null
}

export interface StockSyncBoardProps {
  clients: StockClientSummary[]
  /** Cliente que se abre al entrar; el servidor manda ya su mapeo y su historial */
  initialClientId: string | null
  initialMappings: StockMapping[]
  initialRuns: StockRun[]
  currentUserId: string
  /**
   * Si el usuario puede borrar líneas del mapeo. Solo admin y partner, igual
   * que la política RLS de la migración 106: al resto se les ofrece
   * desactivar, que conserva el histórico de lo que se subió a Amazon.
   */
  canDelete: boolean
}

// Supabase corta cualquier consulta a 1000 filas y un .limit() mayor NO lo salta.
const PAGE = 1000

/** Procesos que se enseñan. Son dos por semana: 30 son casi cuatro meses */
const RUNS_LIMIT = 30

/**
 * Columnas cuyo cambio tiene que verse en pantalla aunque lo haya hecho otro.
 *
 * Los inputs de la tabla no son controlados (si lo fueran, normalizar el
 * código en cada tecla se comería los ceros mientras se escribe), así que solo
 * se enteran de un cambio ajeno si se remontan. Remontarlos siempre que llega
 * un evento de realtime destrozaría lo que se está tecleando —el eco de tu
 * propio guardado llega mientras editas la celda de al lado—, así que se
 * comparan antes: si la fila que llega dice lo mismo que la que ya hay, no se
 * toca nada.
 */
const WATCHED: (keyof StockMapping)[] = [
  'ref_erp',
  'sku_amazon',
  'asin',
  'ean_amazon',
  'ean_erp',
  'ean_final',
  'is_active',
]

function differs(a: StockMapping, b: StockMapping): boolean {
  return WATCHED.some((field) => (a[field] ?? null) !== (b[field] ?? null))
}

async function fetchMappings(
  supabase: StockSupabase,
  clientId: string
): Promise<StockMapping[]> {
  const out: StockMapping[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('stock_mappings')
      .select('*')
      .eq('client_id', clientId)
      .order('sku_amazon', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const chunk = (data as StockMapping[]) ?? []
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

async function fetchRuns(supabase: StockSupabase, clientId: string): Promise<StockRun[]> {
  const { data, error } = await supabase
    .from('stock_runs')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(0, RUNS_LIMIT - 1)
  if (error) throw error
  return (data as StockRun[]) ?? []
}

type MobileView = 'clients' | 'process' | 'mappings' | 'runs'

export function StockSyncBoard({
  clients,
  initialClientId,
  initialMappings,
  initialRuns,
  currentUserId,
  canDelete,
}: StockSyncBoardProps) {
  const supabase = createClient()
  const isMobile = useIsMobile()

  const [clientId, setClientId] = useState<string | null>(
    initialClientId ?? clients[0]?.client.id ?? null
  )
  const [mappings, setMappings] = useState(initialMappings)
  const [runs, setRuns] = useState(initialRuns)
  const [loading, setLoading] = useState(false)
  // Cuántas filas tiene cada cliente. Arranca con lo que contó el servidor y
  // se corrige sola en cuanto se abre uno: dar de alta una línea tiene que
  // verse en la tarjeta sin recargar.
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(clients.map((c) => [c.client.id, c.mappingCount]))
  )
  const [lastRuns, setLastRuns] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(clients.map((c) => [c.client.id, c.lastRunAt]))
  )
  const [revisions, setRevisions] = useState<Record<string, number>>({})
  // En móvil no caben cuatro paneles: se entra por la lista de clientes.
  const [mobileView, setMobileView] = useState<MobileView>('clients')

  const client = useMemo(
    () => clients.find((c) => c.client.id === clientId)?.client ?? null,
    [clients, clientId]
  )

  const activeMappings = useMemo(() => mappings.filter((m) => m.is_active).length, [mappings])

  // ---------- Carga bajo demanda ----------
  const load = useCallback(
    async (id: string) => {
      setLoading(true)
      try {
        const [rows, history] = await Promise.all([
          fetchMappings(supabase, id),
          fetchRuns(supabase, id),
        ])
        setMappings(rows)
        setRuns(history)
        setCounts((prev) => ({ ...prev, [id]: rows.length }))
        setLastRuns((prev) => ({ ...prev, [id]: history[0]?.created_at ?? null }))
      } catch (err) {
        console.error('Error cargando la sincronización de stock:', err)
        toast.error('No se ha podido cargar el mapeo del cliente')
      } finally {
        setLoading(false)
      }
    },
    [supabase]
  )

  // El servidor ya mandó el primer cliente: recargarlo al montar sería pedir
  // dos veces lo mismo y provocar un parpadeo.
  const loadedRef = useRef(initialClientId ?? '')

  useEffect(() => {
    if (!clientId || loadedRef.current === clientId) return
    loadedRef.current = clientId
    load(clientId)
  }, [clientId, load])

  // ---------- Realtime ----------
  const clientIdRef = useRef(clientId)
  useEffect(() => {
    clientIdRef.current = clientId
  }, [clientId])

  // El canal se suscribe una vez y vive fuera del ciclo de render, así que lee
  // las filas de aquí y no del estado: si dependiera del estado habría que
  // resuscribirse en cada tecleo.
  const mappingsRef = useRef(mappings)
  useEffect(() => {
    mappingsRef.current = mappings
  }, [mappings])

  useEffect(() => {
    const channel = supabase
      .channel(`stock_sync_${currentUserId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'stock_mappings' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            // El evento de borrado solo trae la clave primaria, así que no se
            // puede filtrar por cliente: se quita por id, que es único.
            const old = payload.old as { id: string }
            setMappings((prev) => prev.filter((m) => m.id !== old.id))
            return
          }

          const row = payload.new as StockMapping
          if (row.client_id !== clientIdRef.current) return

          const existing = mappingsRef.current.find((m) => m.id === row.id)
          // Sin cambios visibles: es el eco del guardado propio, que llega
          // cuando puede que ya se esté escribiendo en la celda de al lado. No
          // se toca nada.
          if (existing && !differs(existing, row)) return

          // La revisión se sube fuera del updater de setMappings a propósito:
          // un updater tiene que ser puro y encadenar ahí otro setState hace
          // que React lo ejecute dos veces en desarrollo y descuadre el número.
          if (existing) {
            setRevisions((revs) => ({ ...revs, [row.id]: (revs[row.id] ?? 0) + 1 }))
          }

          setMappings((prev) =>
            prev.some((m) => m.id === row.id)
              ? prev.map((m) => (m.id === row.id ? { ...m, ...row } : m))
              : [...prev, row]
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, currentUserId])

  // El recuento de la tarjeta sigue a lo que hay en pantalla, venga de una
  // edición propia, de una importación o de otro navegador.
  useEffect(() => {
    if (!clientId) return
    setCounts((prev) => (prev[clientId] === mappings.length ? prev : { ...prev, [clientId]: mappings.length }))
  }, [clientId, mappings.length])

  // ---------- Guardado ----------
  async function patchMapping(row: StockMapping, patch: Partial<StockMapping>) {
    setMappings((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...patch } : m)))

    const { error } = await supabase.from('stock_mappings').update(patch).eq('id', row.id)
    if (!error) return

    console.error('Error guardando la línea de mapeo:', error)
    // El 23505 es el UNIQUE (client_id, sku_amazon): pasa al teclear un SKU que
    // ya tiene otra fila, y el mensaje de Postgres no se lo dice a nadie.
    const duplicate = (error as { code?: string }).code === '23505'
    toast.error(
      duplicate
        ? `Ya hay otra línea con el SKU ${patch.sku_amazon ?? ''}. Un SKU solo puede estar una vez`
        : 'No se ha podido guardar el cambio'
    )
    setMappings((prev) => prev.map((m) => (m.id === row.id ? row : m)))
    setRevisions((revs) => ({ ...revs, [row.id]: (revs[row.id] ?? 0) + 1 }))
  }

  async function createMapping(draft: NewMappingDraft): Promise<boolean> {
    if (!clientId) return false

    const { data, error } = await supabase
      .from('stock_mappings')
      .insert({ client_id: clientId, ...draft })
      .select('*')
      .single()

    if (error) {
      console.error('Error creando la línea de mapeo:', error)
      const duplicate = (error as { code?: string }).code === '23505'
      toast.error(
        duplicate
          ? `Ya hay una línea con el SKU ${draft.sku_amazon}`
          : 'No se ha podido crear la línea'
      )
      return false
    }

    const row = data as StockMapping
    setMappings((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
    toast.success(`${row.sku_amazon} añadido al mapeo`)
    return true
  }

  async function removeMapping(row: StockMapping) {
    if (
      !confirm(
        `¿Borrar la línea del SKU ${row.sku_amazon}?\n\nSi el listing sigue publicado en Amazon, dejará de actualizarse su stock. Para retirarlo temporalmente es mejor desactivarlo.`
      )
    ) {
      return
    }

    // .select() para saber cuántas filas se han borrado de verdad: con RLS,
    // borrar sin permiso no da error, simplemente no borra nada, y sin esto
    // la fila desaparecería de la pantalla y volvería al recargar.
    const { data, error } = await supabase
      .from('stock_mappings')
      .delete()
      .eq('id', row.id)
      .select('id')

    if (error) {
      console.error('Error borrando la línea de mapeo:', error)
      toast.error('No se ha podido borrar la línea')
      return
    }
    if (!data || data.length === 0) {
      toast.error('Tu usuario no puede borrar líneas del mapeo. Desactívala en su lugar')
      return
    }

    setMappings((prev) => prev.filter((m) => m.id !== row.id))
  }

  /**
   * Tras procesar se recarga el historial en vez de añadir la fila a mano: la
   * fecha y el identificador los pone la base de datos, y una fila inventada
   * en pantalla podría no coincidir con lo que quedó guardado.
   */
  async function onProcessed(result: ProcessResult) {
    if (!clientId) return
    try {
      const history = await fetchRuns(supabase, clientId)
      setRuns(history)
      setLastRuns((prev) => ({ ...prev, [clientId]: history[0]?.created_at ?? null }))
    } catch (err) {
      console.error('Error refrescando el historial de procesos:', err)
      // El proceso ha ido bien y el fichero está listo para descargar: que el
      // historial no se refresque no es motivo para alarmar a nadie.
      if (result.runId) setLastRuns((prev) => ({ ...prev, [clientId]: new Date().toISOString() }))
    }
  }

  async function reloadMappings() {
    if (!clientId) return
    setLoading(true)
    try {
      const rows = await fetchMappings(supabase, clientId)
      setMappings(rows)
    } catch (err) {
      console.error('Error recargando el mapeo:', err)
      toast.error('El mapeo se ha importado, pero no se ha podido refrescar la tabla')
    } finally {
      setLoading(false)
    }
  }

  // ---------- Navegación ----------
  function selectClient(id: string) {
    if (id !== clientId) {
      // Se vacía antes de cargar. Si no, durante el segundo que tarda la
      // consulta se vería el mapeo del cliente anterior bajo el nombre del
      // nuevo, que es la clase de confusión que acaba con el stock de uno
      // subido a la cuenta de otro.
      setMappings([])
      setRuns([])
    }
    setClientId(id)
    // «Al pulsar, nos metemos en su apartado»: en móvil eso es cambiar de
    // pantalla; en escritorio ya se ven los tres paneles a la vez.
    if (isMobile) setMobileView('process')
  }

  const panel = (view: MobileView) => (isMobile && mobileView !== view ? 'hidden' : 'flex')

  const tabs: { id: MobileView; icon: typeof Users; label: string }[] = [
    { id: 'clients', icon: Users, label: 'Clientes' },
    { id: 'process', icon: Upload, label: 'Actualizar' },
    { id: 'mappings', icon: Database, label: `Base (${formatInt(mappings.length)})` },
    { id: 'runs', icon: History, label: `Historial (${runs.length})` },
  ]

  return (
    <div className="flex flex-col h-full gap-3 min-w-0">
      {/* Selector de panel en móvil */}
      <div className="flex lg:hidden items-center gap-1.5 flex-shrink-0 overflow-x-auto -mx-1 px-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMobileView(t.id)}
            disabled={t.id !== 'clients' && !client}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-full border text-[11px] font-medium transition-colors whitespace-nowrap disabled:opacity-30 ${
              mobileView === t.id
                ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.1] text-white'
                : 'border-white/10 text-white/40'
            }`}
          >
            <t.icon className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{t.label}</span>
          </button>
        ))}
      </div>

      {/* La fila de arriba se lleva casi el doble de alto: ahí está el trabajo
          del día (subir el volcado y leer el resultado), mientras que el
          historial se consulta de higos a brevas. */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,210px)_minmax(0,1fr)_minmax(0,1.1fr)] lg:grid-rows-[minmax(0,1.9fr)_minmax(0,1fr)] gap-3">
        {/* Clientes */}
        <div
          className={`${panel('clients')} flex-col min-w-0 min-h-0 flex-1 lg:flex-none lg:col-start-1 lg:row-start-1 lg:row-span-2`}
        >
          <ClientsPanel
            clients={clients}
            selectedId={clientId}
            counts={counts}
            lastRuns={lastRuns}
            onSelect={selectClient}
            className="flex-1 min-h-0"
          />
        </div>

        {!client ? (
          <div className="hidden lg:flex lg:col-start-2 lg:col-span-2 lg:row-start-1 lg:row-span-2 rounded-2xl border border-white/10 bg-white/[0.02] items-center justify-center text-center px-6">
            <p className="text-[13px] text-white/35 max-w-[320px]">
              Elige un cliente en la lista de la izquierda para ver su tabla de
              mapeo y subir el volcado de su ERP.
            </p>
          </div>
        ) : (
          <>
            {/* Actualizar stock */}
            <div
              className={`${panel('process')} flex-col min-w-0 min-h-0 flex-1 lg:flex-none lg:col-start-2 lg:row-start-1`}
            >
              <StockProcessPanel
                // El `key` fuerza a empezar de cero al cambiar de cliente: sin
                // él seguirían en pantalla los ficheros elegidos y el resumen
                // del proceso del cliente anterior, con su botón de descarga.
                key={client.id}
                clientId={client.id}
                clientName={client.name}
                mappingCount={activeMappings}
                onProcessed={onProcessed}
                showBack={isMobile}
                onBack={() => setMobileView('clients')}
                className="flex-1 min-h-0"
              />
            </div>

            {/* Historial */}
            <div
              className={`${panel('runs')} flex-col min-w-0 min-h-0 flex-1 lg:flex-none lg:col-start-2 lg:row-start-2`}
            >
              <StockRunsHistory
                runs={runs}
                loading={loading}
                showBack={isMobile}
                onBack={() => setMobileView('clients')}
                className="flex-1 min-h-0"
              />
            </div>

            {/* Base de datos actual */}
            <div
              className={`${panel('mappings')} flex-col min-w-0 min-h-0 flex-1 lg:flex-none lg:col-start-3 lg:row-start-1 lg:row-span-2`}
            >
              <MappingsTable
                // Igual que arriba: la búsqueda y la página en la que estabas
                // no significan nada en el mapeo de otro cliente.
                key={client.id}
                clientId={client.id}
                clientName={client.name}
                mappings={mappings}
                onPatch={patchMapping}
                onCreate={createMapping}
                onRemove={removeMapping}
                onImported={reloadMappings}
                canDelete={canDelete}
                revisions={revisions}
                showBack={isMobile}
                onBack={() => setMobileView('clients')}
                className="flex-1 min-h-0"
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// =====================================================
// Lista de clientes
// =====================================================

interface ClientsPanelProps {
  clients: StockClientSummary[]
  selectedId: string | null
  counts: Record<string, number>
  lastRuns: Record<string, string | null>
  onSelect: (id: string) => void
  className?: string
}

function ClientsPanel({
  clients,
  selectedId,
  counts,
  lastRuns,
  onSelect,
  className = '',
}: ClientsPanelProps) {
  const visible = useMemo(
    () =>
      [...clients].sort(
        (a, b) =>
          Number(b.client.is_active) - Number(a.client.is_active) ||
          (a.client.position ?? 999) - (b.client.position ?? 999) ||
          a.client.name.localeCompare(b.client.name, 'es')
      ),
    [clients]
  )

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0 overflow-hidden ${className}`}
    >
      <div className="px-3 py-2 border-b border-white/[0.06] flex-shrink-0">
        <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider flex items-center gap-2">
          <Boxes className="h-3 w-3 flex-shrink-0" /> Clientes
        </h3>
      </div>

      {visible.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-6 text-center py-6">
          <p className="text-[12px] text-white/35">
            No hay ningún cliente dado de alta en la sincronización de stock.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto min-w-0 p-2 flex flex-col gap-1.5">
          {visible.map(({ client }) => {
            const selected = client.id === selectedId
            const count = counts[client.id] ?? 0
            const last = lastRuns[client.id] ?? null

            return (
              <button
                key={client.id}
                type="button"
                onClick={() => onSelect(client.id)}
                className={`text-left rounded-xl border px-3 py-2 transition-colors min-w-0 ${
                  selected
                    ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.08]'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20'
                } ${client.is_active ? '' : 'opacity-50'}`}
              >
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <span
                    className={`text-[13px] font-semibold truncate ${
                      selected ? 'text-white' : 'text-white/80'
                    }`}
                  >
                    {client.name}
                  </span>
                  <ChevronRight
                    className={`h-3.5 w-3.5 flex-shrink-0 ${
                      selected ? 'text-[#FF6600]' : 'text-white/20'
                    }`}
                  />
                </div>

                <p className="text-[11px] text-white/40 tabular-nums mt-0.5 truncate">
                  {formatInt(count)} referencias mapeadas
                </p>
                <p className="text-[11px] text-white/30 mt-px truncate">
                  {last ? `Último proceso: ${formatDay(last)}` : 'Sin procesar todavía'}
                </p>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
