'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { History, Loader2, PackageSearch, RefreshCw, Search, Send } from 'lucide-react'
import { toast } from 'sonner'
import {
  AMAZON_REFRESH_MINUTES,
  marketplaceLabel,
  pendingChangeKey,
  type AmazonConnection,
  type AmazonListing,
  type AmazonPendingChange,
  type AmazonSubmission,
  type AmazonSubmissionField,
} from '@/lib/types/amazon'
import {
  CATALOG_FILTERS,
  CATALOG_FILTER_HINTS,
  CATALOG_FILTER_LABELS,
  clearPendingChange,
  clearPendingChanges,
  filterListings,
  frescura,
  hayNovedades,
  lastSubmissionsByCell,
  marketplaceDeEntrada,
  marketplacesCubiertos,
  mergeRefresh,
  previewRefresh,
  setPendingChange,
  sortPendingChanges,
  type CatalogConflict,
  type CatalogFilter,
  type RefreshPreview,
} from '@/lib/amazon/catalogo'
import type { JobRespuesta } from '@/lib/plataforma/cliente'
import {
  postAmazon,
  type CatalogResponse,
  type SendChangesResponse,
  type SyncResponse,
} from '@/lib/amazon/client'
import { CatalogoTabla, CatalogoTarjetas } from './CatalogoTabla'
import { EnviarCambiosDialog } from './EnviarCambiosDialog'
import { HistorialPanel } from './HistorialPanel'
import {
  cardShell,
  errorBox,
  fieldInput,
  filterChip,
  formatExact,
  formatInt,
  formatWhen,
  ghostButton,
  infoBox,
  primaryButton,
  warnBox,
} from './shared'

/**
 * EL CATÁLOGO DE UN CLIENTE, Y LA EDICIÓN.
 *
 * Aquí se juntan las tres cosas que tenían que convivir sin estorbarse: una
 * tabla de miles de líneas, un refresco automático cada cuarto de hora y unas
 * ediciones a medio escribir que no pueden perderse.
 *
 *
 * CÓMO CONVIVEN EL REFRESCO Y LO QUE HAY SIN ENVIAR (decisión E)
 * ==============================================================
 * Hay dos refrescos y NO se comportan igual, a propósito:
 *
 *   EL AUTOMÁTICO (cada quince minutos, nadie lo ha pedido).
 *     - Sin ediciones pendientes: se aplica solo y en silencio. No hay nada que
 *       proteger y sí un catálogo que envejece.
 *     - Con ediciones pendientes: NO TOCA LA PANTALLA. Se guarda a un lado y
 *       sale un aviso que dice cuántas líneas se han movido y —esto es lo que
 *       permite decidir— cuántas de esas tocan algo tuyo. Se actualiza cuando
 *       tú digas.
 *     - Y si el barrido no ha movido ni una fila, que es lo normal, no sale
 *       ningún aviso: se aplica en silencio. Un aviso que salta cada cuarto de
 *       hora para no decir nada es un aviso que se aprende a ignorar, y el día
 *       que diga algo tampoco se leerá.
 *
 *   EL BOTÓN. Lo ha pulsado alguien, así que se aplica en el acto. Preguntarle
 *   a quien acaba de pedir datos nuevos si quiere datos nuevos es de las cosas
 *   que enseñan a pulsar «sí» sin leer.
 *
 * En los dos casos, aplicar NO BORRA NUNCA UNA EDICIÓN. Lo que se hace con
 * ellas lo decide mergeRefresh() en lib/amazon/catalogo.ts, y el resumen es:
 * las líneas sin tocar se actualizan, las tecleadas se conservan, y si el valor
 * de Amazon se ha movido justo debajo de una edición, esa celda queda marcada
 * como conflicto —en la tabla y en la lista de «Enviar cambios»— con los dos
 * números delante. El conflicto es de cada celda, no de la pantalla: preguntar
 * «¿recargo?» en un catálogo de dos mil líneas con tres editadas es una
 * pregunta que nadie puede responder bien.
 */

/** Filas que se pintan de golpe. Ver el comentario de CatalogoTabla */
const PAGE = 150

/** Cada cuánto se mira si hay datos nuevos, en milisegundos */
const POLL_MS = AMAZON_REFRESH_MINUTES * 60_000

interface Props {
  connection: AmazonConnection
  clientName: string
  /** Para que la tarjeta del selector de arriba se entere del nuevo refresco */
  onConnection: (conn: AmazonConnection) => void
  /**
   * Cuántas ediciones hay sin enviar. Lo sabe la pantalla de arriba para poder
   * avisar antes de cambiar de cliente: estas ediciones viven en memoria y
   * salir de aquí las pierde.
   */
  onPendingCount: (n: number) => void
  isMobile: boolean
}

export function CatalogoPanel({
  connection,
  clientName,
  onConnection,
  onPendingCount,
  isMobile,
}: Props) {
  const [marketplaceId, setMarketplaceId] = useState(
    () => marketplaceDeEntrada(connection) ?? ''
  )
  const [listings, setListings] = useState<AmazonListing[]>([])
  const [submissions, setSubmissions] = useState<AmazonSubmission[]>([])
  /** id de perfil -> nombre, para el «quién lo mandó» del historial */
  const [authors, setAuthors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Map<string, AmazonPendingChange>>(() => new Map())
  const [conflicts, setConflicts] = useState<CatalogConflict[]>([])
  const [novedades, setNovedades] = useState<{
    res: CatalogResponse
    preview: RefreshPreview
  } | null>(null)

  // Arranca cargando solo si hay un país al que pedir. Sin él no se va a pedir
  // nada, y un cargador girando para siempre es la peor forma de decirlo.
  const [cargando, setCargando] = useState(() => marketplaceDeEntrada(connection) !== null)
  const [refrescando, setRefrescando] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<CatalogFilter[]>([])
  const [visible, setVisible] = useState(PAGE)
  const [enviando, setEnviando] = useState(false)
  const [censando, setCensando] = useState(false)
  const [verHistorial, setVerHistorial] = useState(false)

  /**
   * Espejos de lo que hay en pantalla, para poder consultarlo desde el
   * temporizador y desde las respuestas de red sin arrastrar un cierre viejo.
   * Se actualizan en un efecto y no durante el render: quien los lee siempre
   * corre después de pintar.
   */
  const pendingRef = useRef(pending)
  const listingsRef = useRef(listings)
  useEffect(() => {
    pendingRef.current = pending
    onPendingCount(pending.size)
  }, [pending, onPendingCount])
  useEffect(() => {
    listingsRef.current = listings
  }, [listings])

  /* ---------------- Aplicar una foto del catálogo ---------------- */

  const aplicar = useCallback(
    (res: CatalogResponse) => {
      const { pending: siguen, conflicts: nuevos, gone } = mergeRefresh({
        fresh: res.listings,
        pending: pendingRef.current.values(),
      })

      setListings(res.listings)
      setSubmissions(res.submissions)
      setAuthors((prev) => ({ ...prev, ...res.authors }))
      setPending(siguen)
      setConflicts(nuevos)
      setNovedades(null)
      onConnection(res.connection)

      if (gone.length > 0) {
        toast.warning(
          gone.length === 1
            ? `El SKU ${gone[0].sku} ya no está en el catálogo: se ha quitado tu cambio sin enviar`
            : `${gone.length} SKU ya no están en el catálogo: se han quitado sus cambios sin enviar`
        )
      }
      if (nuevos.length > 0) {
        toast.warning(
          nuevos.length === 1
            ? 'Un valor ha cambiado en Amazon por debajo de un cambio tuyo sin enviar. Está marcado en la tabla'
            : `${nuevos.length} valores han cambiado en Amazon por debajo de cambios tuyos sin enviar. Están marcados en la tabla`
        )
      }
    },
    [onConnection]
  )

  /* ---------------- Carga inicial y cambio de país ---------------- */

  const cargar = useCallback(
    async (mercado: string) => {
      setCargando(true)
      setErrorCarga(null)
      const res = await postAmazon<CatalogResponse>('/api/amazon/catalog', {
        connectionId: connection.id,
        marketplaceId: mercado,
      })
      setCargando(false)

      if (!res.ok) {
        setErrorCarga(res.error)
        return
      }
      aplicar(res.data)
    },
    [connection.id, aplicar]
  )

  useEffect(() => {
    if (!marketplaceId) return
    void cargar(marketplaceId)
    // Al cambiar de país se vuelve arriba: la página en la que estabas no
    // significa nada en otro catálogo.
    setVisible(PAGE)
  }, [marketplaceId, cargar])

  /* ---------------- El refresco automático ---------------- */

  const mirarSiHayNovedades = useCallback(async () => {
    if (!marketplaceId) return
    const res = await postAmazon<CatalogResponse>('/api/amazon/catalog', {
      connectionId: connection.id,
      marketplaceId,
    })
    // En silencio: es un refresco de fondo que nadie ha pedido, y un aviso de
    // error cada cuarto de hora por una wifi que se cayó un segundo solo
    // consigue que se deje de mirar la pantalla.
    if (!res.ok) return

    if (pendingRef.current.size === 0) {
      aplicar(res.data)
      return
    }

    const preview = previewRefresh({
      current: listingsRef.current,
      fresh: res.data.listings,
      pending: pendingRef.current,
    })

    // Nada se ha movido: se aplica igualmente —trae el estado de los envíos y
    // la hora del último barrido— pero sin molestar a nadie.
    if (!hayNovedades(preview)) {
      aplicar(res.data)
      return
    }

    setNovedades({ res: res.data, preview })
  }, [connection.id, marketplaceId, aplicar])

  useEffect(() => {
    const id = setInterval(() => {
      void mirarSiHayNovedades()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [mirarSiHayNovedades])

  /* ---------------- El censo por informe ---------------- */

  /**
   * Pide el censo del catálogo, que es lo único capaz de enumerarlo entero.
   *
   * NO ESPERA A QUE TERMINE, y no es una simplificación: el informe de Amazon
   * tarda entre uno y veinte minutos en generarse, y ninguna petición HTTP
   * aguanta eso. Lo que hace la ruta es encolar el trabajo; el motor lo recoge
   * en la siguiente pasada y va escribiendo en el mismo espejo del que se pinta
   * esta tabla. Por eso el aviso dice que se puede cerrar la pantalla.
   *
   * Si ya hay uno pendiente no se crea otro —la ruta no duplica— y contesta
   * diciéndolo, que es la respuesta correcta a pulsar el botón dos veces.
   */
  async function pedirCenso() {
    if (!marketplaceId || censando) return
    setCensando(true)
    const res = await postAmazon<JobRespuesta>('/api/plataforma/jobs', {
      tipo: 'censo_catalogo',
      clientId: connection.client_id,
      connectionId: connection.id,
      marketplaceId,
    })
    setCensando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(
      res.data.mensaje ??
        'Censo encolado. Cuando termine, el catálogo entero aparecerá aquí sin hacer nada más.'
    )
  }

  /* ---------------- El botón de refrescar ---------------- */

  async function refrescar() {
    if (!marketplaceId) return
    setRefrescando(true)
    const res = await postAmazon<SyncResponse>('/api/amazon/sync', {
      connectionId: connection.id,
      marketplaceId,
    })
    setRefrescando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }

    aplicar(res.data)

    const fallo = res.data.results.find((r) => r.error)
    if (fallo?.error) {
      toast.error(fallo.error)
      return
    }

    const leidos = res.data.results.reduce((n, r) => n + r.items, 0)
    toast.success(`${formatInt(leidos)} referencias leídas de Amazon`)

    // Por encima de 1000 SKU la API de listings deja de devolver páginas SIN
    // dar error: el catálogo parece completo y no lo está. Es exactamente el
    // fallo que nadie detecta mirando la pantalla, así que se dice.
    const recortado = res.data.results.find((r) => r.truncated)
    if (recortado) {
      toast.warning(
        (recortado.declared > 0
          ? `Amazon declara ${formatInt(recortado.declared)} referencias y este refresco solo puede leer 1.000. `
          : 'Este catálogo pasa de 1.000 referencias y este refresco no puede recorrerlo entero. ') +
          'Usa «Leer el catálogo entero» para traerlas todas.'
      )
    }
  }

  /* ---------------- Editar ---------------- */

  function editar(listing: AmazonListing, field: AmazonSubmissionField, value: number) {
    setPending((prev) => setPendingChange(prev, listing, field, value))
    // Una edición nueva sobre una celda en conflicto lo resuelve: el valor se
    // acaba de decidir mirando lo que hay ahora.
    setConflicts((prev) =>
      prev.filter(
        (c) =>
          c.key !==
          pendingChangeKey({ marketplaceId: listing.marketplace_id, sku: listing.sku, field })
      )
    )
  }

  function deshacer(listing: AmazonListing, field: AmazonSubmissionField) {
    const clave = pendingChangeKey({
      marketplaceId: listing.marketplace_id,
      sku: listing.sku,
      field,
    })
    setPending((prev) => clearPendingChange(prev, clave))
    setConflicts((prev) => prev.filter((c) => c.key !== clave))
  }

  function deshacerTodo() {
    setPending(new Map())
    setConflicts([])
  }

  function trasEnviar({
    accepted,
    response,
  }: {
    accepted: string[]
    response: SendChangesResponse
  }) {
    // Solo se quitan los ACEPTADOS. Los que han fallado se quedan tecleados en
    // la tabla, que es lo que permite corregirlos o reintentarlos sin volver a
    // escribirlo todo.
    setPending((prev) => clearPendingChanges(prev, accepted))
    setConflicts((prev) => prev.filter((c) => !accepted.includes(c.key)))
    setSubmissions(response.submissions)
    setAuthors((prev) => ({ ...prev, ...response.authors }))
  }

  /**
   * Cerrar la pestaña con cambios sin enviar.
   *
   * Las ediciones viven solo en memoria —a propósito: lo que no se ha revisado
   * no tiene por qué persistir— así que cerrar aquí las pierde. El navegador
   * enseña su propio aviso, que no se puede personalizar, pero se puede
   * provocar. Es lo único que separa media hora de trabajo de un clic en la X.
   */
  useEffect(() => {
    if (pending.size === 0) return
    function avisar(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [pending.size])

  /* ---------------- Lo que se pinta ---------------- */

  const sentPorCelda = useMemo(() => lastSubmissionsByCell(submissions), [submissions])

  const filtrados = useMemo(
    () => filterListings(listings, { search, filters }, pending),
    [listings, search, filters, pending]
  )

  const aPintar = useMemo(() => filtrados.slice(0, visible), [filtrados, visible])

  const cambios = useMemo(() => sortPendingChanges(pending), [pending])

  // La MISMA función que usa el servidor para decidir qué acepta. Si aquí se
  // ofreciera un país que allí se rechaza, el selector tendría opciones que
  // devuelven un error al elegirlas.
  const mercados = marketplacesCubiertos(connection)

  const estadoFrescura = frescura(connection.last_sync_at)
  const conexionViva = connection.is_active && connection.status === 'activa'

  function alternarFiltro(f: CatalogFilter) {
    setVisible(PAGE)
    setFilters((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]))
  }

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 gap-2.5">
      {/* ---------------- Barra de herramientas ---------------- */}
      <div className={`${cardShell} p-2.5 flex flex-wrap items-center gap-2 flex-shrink-0`}>
        {/* El país. Va el primero y siempre visible: una conexión europea cubre
            cuatro tiendas, y de aquí depende qué se está leyendo y, sobre todo,
            dónde se va a escribir. */}
        {mercados.length > 1 ? (
          <label className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] text-white/40 uppercase tracking-wider flex-shrink-0">
              País
            </span>
            <select
              value={marketplaceId}
              onChange={(e) => setMarketplaceId(e.target.value)}
              aria-label="País del catálogo"
              className="h-8 bg-white/[0.04] border border-white/10 rounded-lg px-2 text-[12px] text-white outline-none focus:border-[#FF6600] transition-colors"
            >
              {mercados.map((id) => (
                <option key={id} value={id}>
                  {marketplaceLabel(id)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-[12px] text-white/70 whitespace-nowrap">
            {marketplaceLabel(marketplaceId)}
          </span>
        )}

        {/* UN CONTADOR, NO UNA ALARMA.
            Antes esto se ponía en amarillo pasados 15 minutos, o sea casi
            siempre que alguien abría la pantalla: una alerta que salta
            siempre es una alerta que nadie lee, y de paso le quitaba
            credibilidad a las que sí importan (un token caído, un feed
            rechazado). Se queda como lo que es: cuándo se leyó esto. */}
        <span
          title={formatExact(connection.last_sync_at)}
          className="text-[11px] whitespace-nowrap text-white/35"
        >
          Refrescado <Momento iso={connection.last_sync_at} />
        </span>

        <div className="flex-1 min-w-[140px]" />

        <button
          type="button"
          onClick={() => setVerHistorial((v) => !v)}
          className={`${ghostButton} flex-shrink-0`}
          aria-pressed={verHistorial}
        >
          <History className="h-3.5 w-3.5" />
          Historial
        </button>

        <button
          type="button"
          onClick={refrescar}
          disabled={refrescando || cargando || !conexionViva}
          title={conexionViva ? undefined : 'Esta cuenta no está conectada ahora mismo'}
          className={`${ghostButton} flex-shrink-0`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refrescando ? 'animate-spin' : ''}`} />
          Refrescar
        </button>

        <button
          type="button"
          onClick={() => setEnviando(true)}
          disabled={pending.size === 0 || !conexionViva}
          title={
            pending.size > 0
              ? undefined
              : isMobile
                ? // En pantalla estrecha no hay tabla que tocar: el catálogo es
                  // de consulta. Invitar a «tocar un precio en la tabla» donde
                  // no se puede es lo que hace que alguien lo intente tres
                  // veces y acabe creyendo que la pantalla está rota.
                  'En pantallas estrechas el catálogo es de consulta. Ábrelo en una ventana más ancha para cambiar precios y stock'
                : 'Toca un precio o un stock en la tabla para preparar un cambio'
          }
          className={`${primaryButton} flex-shrink-0`}
        >
          <Send className="h-3.5 w-3.5" />
          Enviar {pending.size > 0 ? `${pending.size} ` : ''}
          {pending.size === 1 ? 'cambio' : 'cambios'}
        </button>
      </div>

      {/* ---------------- Avisos ---------------- */}
      <div className="flex-shrink-0 space-y-2 min-w-0 empty:hidden">
        {!conexionViva && (
          <div className={errorBox}>
            {connection.status_detail ??
              'Esta cuenta no está conectada ahora mismo. Lo que se ve es la última foto que pudimos leer y no se puede enviar nada.'}
          </div>
        )}

        {connection.last_sync_error && conexionViva && (
          <div className={errorBox}>
            <span className="font-semibold">El último refresco falló.</span>{' '}
            {connection.last_sync_error}
          </div>
        )}

        {/* EL CATÁLOGO ESTÁ INCOMPLETO, y hay que decirlo AL ABRIR y no solo
            tras pulsar «Refrescar». searchListingsItems deja de paginar a los
            1000 SKU sin dar ningún error, y quien refresca de verdad es el cron
            de cada quince minutos, que no tiene a nadie delante. Sin esto, un
            cliente de 1.500 referencias aparece con 1.000, el buscador no
            encuentra las que faltan y la conclusión es que ese producto no está
            en Amazon.

            EL BOTÓN VA AQUÍ Y NO EN «MARCAS», que es donde estaba. El censo por
            informe es LA respuesta a este aviso, y estaba a dos pestañas de
            distancia y solo visible para clientes con CERO referencias — o sea,
            escondido justo en el caso para el que existe. */}
        {connection.last_sync_truncated && (
          <div className={`${warnBox} flex flex-wrap items-center gap-x-2 gap-y-1.5`}>
            <span>
              <span className="font-semibold">Esto no es todo el catálogo.</span>{' '}
              {connection.last_sync_declared
                ? `El refresco de cada ${AMAZON_REFRESH_MINUTES} minutos solo puede leer 1.000 referencias y Amazon declara ${formatInt(connection.last_sync_declared)}.`
                : `El refresco de cada ${AMAZON_REFRESH_MINUTES} minutos no puede leer más de 1.000 referencias.`}{' '}
              Para traerlas todas hace falta el censo por informe, que además trae las suprimidas y
              las inactivas. Tarda entre unos minutos y media hora.
            </span>
            <button
              type="button"
              onClick={() => void pedirCenso()}
              disabled={censando || !marketplaceId}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-yellow-500/40 bg-yellow-400/10 px-2 py-1 text-[11px] font-medium text-yellow-200 hover:bg-yellow-400/20 disabled:opacity-50 transition-colors"
              title="Pide el informe de listings completo. Se hace en segundo plano: puedes cerrar esta pantalla"
            >
              {censando ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <PackageSearch className="h-3 w-3" />
              )}
              Leer el catálogo entero
            </button>
          </div>
        )}

        {/* En pantalla estrecha el catálogo se pinta en tarjetas y NO se puede
            editar. Antes eso no se decía en ninguna parte: la persona tocaba un
            precio, no pasaba nada, y no había forma de saber si estaba roto o
            si era a propósito. Es la función central de este módulo
            desapareciendo en silencio. */}
        {isMobile && (
          <div className={infoBox}>
            En pantallas estrechas el catálogo es <span className="text-white/80">de consulta</span>
            . Para cambiar precios y stock, ábrelo en una ventana más ancha.
          </div>
        )}

        {/* Solo el catálogo que NO SE HA LEÍDO NUNCA, que es lo único
            accionable: hay un botón que lo arregla. El aviso de «lleva más de
            15 minutos» se quitó a propósito — saltaba en cuanto pasaba el
            cuarto de hora, o sea prácticamente siempre, y con la pantalla
            abierta el contador de arriba ya dice lo mismo sin gritar. Si el
            proceso del servidor deja de correr, eso se ve donde tiene que
            verse: en las incidencias de Plataforma. */}
        {estadoFrescura === 'nunca' && conexionViva && !connection.last_sync_error && (
          <div className={warnBox}>
            Este catálogo no se ha leído nunca. Pulsa «Refrescar» para traerlo de Amazon.
          </div>
        )}

        {novedades && (
          <AvisoNovedades
            preview={novedades.preview}
            onAplicar={() => aplicar(novedades.res)}
            onIgnorar={() => setNovedades(null)}
          />
        )}

        {conflicts.length > 0 && (
          <div className={warnBox}>
            {conflicts.length === 1
              ? 'Un valor ha cambiado en Amazon desde que lo tecleaste.'
              : `${conflicts.length} valores han cambiado en Amazon desde que los tecleaste.`}{' '}
            Están marcados en amarillo en la tabla, y la lista de «Enviar cambios» los saca con los
            dos números para que decidas.
          </div>
        )}

        {pending.size > 0 && (
          <div className={`${infoBox} flex flex-wrap items-center justify-between gap-2`}>
            <span>
              <span className="text-white/80 font-semibold">{pending.size}</span>{' '}
              {pending.size === 1 ? 'cambio sin enviar' : 'cambios sin enviar'}. Nada sale hacia
              Amazon hasta que lo revises en «Enviar cambios».
            </span>
            <button
              type="button"
              onClick={deshacerTodo}
              className="text-[11px] text-white/45 hover:text-white transition-colors underline underline-offset-2 flex-shrink-0"
            >
              Deshacerlos todos
            </button>
          </div>
        )}

        {errorCarga && <div className={errorBox}>{errorCarga}</div>}
      </div>

      {/* ---------------- Buscador y filtros ---------------- */}
      <div className="flex flex-wrap items-center gap-2 flex-shrink-0 min-w-0">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="h-3.5 w-3.5 text-white/25 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setVisible(PAGE)
            }}
            placeholder="Buscar por SKU, ASIN o título"
            aria-label="Buscar en el catálogo"
            className={`${fieldInput} pl-8 h-8`}
          />
        </div>

        {CATALOG_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => alternarFiltro(f)}
            title={CATALOG_FILTER_HINTS[f]}
            aria-pressed={filters.includes(f)}
            className={filterChip(filters.includes(f))}
          >
            {CATALOG_FILTER_LABELS[f]}
          </button>
        ))}

        <span className="text-[11px] text-white/35 tabular-nums whitespace-nowrap ml-auto">
          {formatInt(filtrados.length)}
          {filtrados.length !== listings.length && ` de ${formatInt(listings.length)}`}{' '}
          {listings.length === 1 ? 'referencia' : 'referencias'}
        </span>
      </div>

      {/* ---------------- Catálogo + historial ---------------- */}
      <div
        className={`flex-1 min-h-0 min-w-0 gap-2.5 ${
          verHistorial
            ? 'flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]'
            : 'flex flex-col'
        }`}
      >
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          {!marketplaceId ? (
            // Pasa con una conexión de una región para la que todavía no hay
            // ningún marketplace dado de alta en AMAZON_MARKETPLACES. Se dice
            // qué falta y dónde, en vez de dejar la pantalla en blanco.
            <div className={`${cardShell} flex-1 flex items-center justify-center px-6 text-center`}>
              <p className="text-[13px] text-white/45 max-w-[380px]">
                No sabemos en qué países vende este cliente y su región no tiene ninguno dado de
                alta en el ERP. Añádelo en <code className="text-white/60">AMAZON_MARKETPLACES</code>{' '}
                y vuelve a entrar.
              </p>
            </div>
          ) : cargando ? (
            <div className={`${cardShell} flex-1 flex items-center justify-center`}>
              <Loader2 className="h-5 w-5 animate-spin text-white/20" />
            </div>
          ) : filtrados.length === 0 ? (
            <div className={`${cardShell} flex-1 flex items-center justify-center px-6 text-center`}>
              <div>
                <PackageSearch className="h-6 w-6 text-white/20 mx-auto mb-3" />
                <p className="text-[13px] text-white/45">
                  {listings.length === 0
                    ? 'Todavía no hemos leído el catálogo de este país.'
                    : 'Ninguna referencia con esa búsqueda.'}
                </p>
                {listings.length === 0 && (
                  <p className="text-[12px] text-white/30 mt-1">
                    Pulsa «Refrescar» para traerlo de Amazon.
                  </p>
                )}
              </div>
            </div>
          ) : isMobile ? (
            <div className="flex-1 min-h-0 overflow-auto min-w-0">
              <CatalogoTarjetas listings={aPintar} pending={pending} sent={sentPorCelda} />
              <VerMas total={filtrados.length} visible={visible} onMas={() => setVisible((v) => v + PAGE)} />
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0 min-w-0">
                <CatalogoTabla
                  listings={aPintar}
                  pending={pending}
                  sent={sentPorCelda}
                  onEdit={editar}
                  onUndo={deshacer}
                  readOnly={!conexionViva}
                />
              </div>
              <VerMas total={filtrados.length} visible={visible} onMas={() => setVisible((v) => v + PAGE)} />
            </>
          )}
        </div>

        {verHistorial && (
          <HistorialPanel
            // El `key` fuerza a empezar de cero al cambiar de cliente: los
            // filtros del historial de uno no significan nada en el de otro.
            key={connection.id}
            connectionId={connection.id}
            initialSubmissions={submissions}
            initialAuthors={authors}
            className="flex-1 lg:flex-none min-h-0 lg:h-full"
          />
        )}
      </div>

      {enviando && (
        <EnviarCambiosDialog
          connectionId={connection.id}
          clientName={clientName}
          changes={cambios}
          conflicts={conflicts}
          onClose={() => setEnviando(false)}
          onSent={trasEnviar}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * El aviso de que hay datos nuevos sin aplicar.
 *
 * Dice NÚMEROS, no «hay novedades»: con doce líneas movidas y ninguna que toque
 * lo tuyo, actualizar es gratis; con dos que sí, hay que mirarlas. Sin esa
 * distinción no se puede decidir, y lo que se acaba haciendo es pulsar siempre
 * lo mismo.
 */
function AvisoNovedades({
  preview,
  onAplicar,
  onIgnorar,
}: {
  preview: RefreshPreview
  onAplicar: () => void
  onIgnorar: () => void
}) {
  const partes: string[] = []
  if (preview.changed > 0) {
    partes.push(
      `${preview.changed} ${preview.changed === 1 ? 'referencia ha cambiado' : 'referencias han cambiado'} de precio o de stock`
    )
  }
  if (preview.added > 0) partes.push(`${preview.added} nuevas`)
  if (preview.removed > 0) partes.push(`${preview.removed} han desaparecido`)

  return (
    <div className={`${warnBox} flex flex-wrap items-center justify-between gap-2`}>
      <span className="min-w-0">
        <span className="font-semibold">Hay datos nuevos de Amazon.</span> {partes.join(', ')}.
        {preview.touchesEdited > 0 && (
          <>
            {' '}
            {preview.touchesEdited === 1
              ? 'Una de ellas tiene un cambio tuyo sin enviar encima'
              : `${preview.touchesEdited} de ellas tienen cambios tuyos sin enviar encima`}
            , y se conservarán marcados.
          </>
        )}{' '}
        Tus cambios no se pierden al actualizar.
      </span>

      <span className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={onIgnorar}
          className="text-[11px] text-white/45 hover:text-white transition-colors"
        >
          Ahora no
        </button>
        <button
          type="button"
          onClick={onAplicar}
          className="h-7 px-3 rounded-full border border-yellow-500/40 bg-yellow-400/[0.12] text-[11px] font-semibold text-yellow-300 hover:bg-yellow-400/[0.18] transition-colors whitespace-nowrap"
        >
          Actualizar
        </button>
      </span>
    </div>
  )
}

/**
 * «Ver más», la paginación del ERP.
 *
 * Se trae de Cold Calling tal cual. No hay virtualización en ninguna tabla de
 * este ERP y esta no va a ser la primera: con esto, un catálogo de varios miles
 * se abre instantáneo y solo crece si alguien baja.
 */
function VerMas({
  total,
  visible,
  onMas,
}: {
  total: number
  visible: number
  onMas: () => void
}) {
  if (visible >= total) return null
  return (
    <button
      type="button"
      onClick={onMas}
      className="mt-2 flex-shrink-0 w-full rounded-lg border border-dashed border-white/12 py-2 text-[11px] text-white/45 hover:text-white hover:border-white/25 transition-colors"
    >
      Ver más ({formatInt(total - visible)} restantes)
    </button>
  )
}

/**
 * Un momento en el tiempo, en relativo.
 *
 * Vacío hasta que monta, como en ConexionesBoard: «hace 3 minutos» calculado en
 * el servidor y en el navegador no dan lo mismo, y React avisaría de un fallo
 * de hidratación.
 */
function Momento({ iso }: { iso: string | null }) {
  const [texto, setTexto] = useState<string | null>(null)
  useEffect(() => setTexto(formatWhen(iso)), [iso])
  return <span className="tabular-nums">{texto ?? '…'}</span>
}
