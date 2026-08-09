'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { useIsMobile } from '@/lib/use-is-mobile'
import { Database, History, Upload } from 'lucide-react'
import { StockMapping, StockRun, formatInt } from '@/lib/types/stock-sync'
import { StockProcessPanel } from './StockProcessPanel'
import { MappingsTable, NewMappingDraft } from './MappingsTable'
import { StockRunsHistory } from './StockRunsHistory'

type StockSupabase = ReturnType<typeof createClient>

/**
 * EL TABLERO DEL SINCRONISMO DE STOCK — TRABAJA SOBRE UN SOLO CLIENTE.
 *
 * Hasta la reorganización este tablero traía DENTRO su propia lista de clientes:
 * era una pantalla suelta y tenía que elegir sobre quién trabajaba. Ahora vive
 * dentro de Growth Partner, que tiene UN selector de cliente arriba común a todos
 * sus submódulos, así que el cliente llega ya decidido por propiedad.
 *
 * No es solo quitar una columna:
 *
 *   · Se acabaron los DOS selectores en la misma pantalla, que es literalmente el
 *     «está todo pegado» del que viene esta reorganización.
 *   · Se acabó leer los datos de los DIECISÉIS clientes para pintar la lista. El
 *     servidor pide ahora el mapeo y el historial DE UNO. Los datos de un vendedor
 *     se usan exclusivamente para operar su cuenta, así que cuantas menos consultas
 *     rocen a los demás, mejor.
 *   · Se acabó la carga bajo demanda al cambiar de cliente: el selector de arriba
 *     rehace la página en el servidor y este componente se remonta con su llave.
 *     Ya no hay dos caminos por los que llegan los mismos datos.
 *
 * LO DEMÁS NO SE HA TOCADO. El cruce está verificado contra ficheros reales y se
 * usa dos veces por semana: esto es una mudanza, no una reescritura.
 *
 * DE DÓNDE SALE EL FICHERO DEL CLIENTE NO SE CONFIGURA AQUÍ: eso es Amazon API ·
 * Origen. Aquí se trabaja con él.
 */
export interface StockSyncBoardProps {
  /** El cliente elegido arriba, en `stock_clients`. Fijo mientras el tablero vive */
  clientId: string
  clientName: string
  /** Su mapeo y su historial, ya traídos por el servidor */
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

/** En móvil no caben tres paneles: se entra por el trabajo del día */
type MobileView = 'process' | 'mappings' | 'runs'

export function StockSyncBoard({
  clientId,
  clientName,
  initialMappings,
  initialRuns,
  currentUserId,
  canDelete,
}: StockSyncBoardProps) {
  const supabase = createClient()
  const isMobile = useIsMobile()

  const [mappings, setMappings] = useState(initialMappings)
  const [runs, setRuns] = useState(initialRuns)
  const [loading, setLoading] = useState(false)
  const [revisions, setRevisions] = useState<Record<string, number>>({})
  const [mobileView, setMobileView] = useState<MobileView>('process')

  const activeMappings = useMemo(() => mappings.filter((m) => m.is_active).length, [mappings])

  // ---------- Realtime ----------

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
          // El cliente ya no cambia sin remontar el componente, así que se puede
          // comparar con la propiedad directamente. Antes hacía falta una ref
          // porque el canal sobrevivía al cambio de cliente y se quedaba mirando
          // el que había cuando se suscribió.
          if (row.client_id !== clientId) return

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
  }, [supabase, currentUserId, clientId])

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
  async function onProcessed() {
    setLoading(true)
    try {
      setRuns(await fetchRuns(supabase, clientId))
    } catch (err) {
      console.error('Error refrescando el historial de procesos:', err)
      // El proceso ha ido bien y el fichero está listo para descargar: que el
      // historial no se refresque no es motivo para alarmar a nadie.
    } finally {
      setLoading(false)
    }
  }

  async function reloadMappings() {
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

  const panel = (view: MobileView) => (isMobile && mobileView !== view ? 'hidden' : 'flex')

  const tabs: { id: MobileView; icon: typeof Upload; label: string }[] = [
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
            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-full border text-[11px] font-medium transition-colors whitespace-nowrap ${
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
      <div className="flex-1 min-h-0 min-w-0 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:grid-rows-[minmax(0,1.9fr)_minmax(0,1fr)] gap-3">
        {/* Actualizar stock */}
        <div
          className={`${panel('process')} flex-col min-w-0 min-h-0 flex-1 lg:flex-none lg:col-start-1 lg:row-start-1`}
        >
          <StockProcessPanel
            clientId={clientId}
            clientName={clientName}
            mappingCount={activeMappings}
            onProcessed={onProcessed}
            className="flex-1 min-h-0"
          />
        </div>

        {/* Historial */}
        <div
          className={`${panel('runs')} flex-col min-w-0 min-h-0 flex-1 lg:flex-none lg:col-start-1 lg:row-start-2`}
        >
          <StockRunsHistory runs={runs} loading={loading} className="flex-1 min-h-0" />
        </div>

        {/* Base de datos actual */}
        <div
          className={`${panel('mappings')} flex-col min-w-0 min-h-0 flex-1 lg:flex-none lg:col-start-2 lg:row-start-1 lg:row-span-2`}
        >
          <MappingsTable
            clientId={clientId}
            clientName={clientName}
            mappings={mappings}
            onPatch={patchMapping}
            onCreate={createMapping}
            onRemove={removeMapping}
            onImported={reloadMappings}
            canDelete={canDelete}
            revisions={revisions}
            className="flex-1 min-h-0"
          />
        </div>
      </div>
    </div>
  )
}
