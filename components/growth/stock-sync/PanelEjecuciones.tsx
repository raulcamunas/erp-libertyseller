'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  History,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react'
import {
  STOCK_RUN_STATE_COLORS,
  STOCK_RUN_STATE_LABELS,
  formatInt,
  type FaseRegistrada,
  type StockProfileOrigin,
  type StockProfileRunState,
} from '@/lib/types/stock-sync'
import {
  AMAZON_FIELD_LABELS,
  AMAZON_SUBMISSION_STATUS_LABELS,
  type AmazonSubmission,
  type AmazonSubmissionField,
  type AmazonSubmissionStatus,
} from '@/lib/types/amazon'
import { formatDateTime } from './shared'
import { LineaDeVida } from './LineaDeVida'

/**
 * QUÉ HA HECHO EL ERP EN LA CUENTA DE ESTE CLIENTE.
 *
 * A la izquierda las ejecuciones —cuándo, qué fichero, cómo acabó, cuánto
 * tardó—; a la derecha, de la que esté seleccionada, EL VALOR ANTIGUO Y EL
 * NUEVO de cada SKU que se tocó.
 *
 *
 * ============ POR QUÉ ESTA PANTALLA Y NO LA DE ANTES ============
 *
 * Aquí había un formulario para subir el volcado a mano y la tabla de mapeo. Eso
 * describe cómo se trabajaba cuando el stock se subía dos veces por semana
 * pulsando un botón, y cómo trabaja HOY un solo cliente —el que tiene su
 * diccionario referencia→SKU importado—. Para el resto, el ciclo entra cada
 * quince minutos y lo hace solo.
 *
 * Con el formulario delante, la única pregunta que importa no tenía respuesta:
 * «¿qué le ha hecho el ERP a esta cuenta hoy?». Se veía un botón para hacer algo
 * que ya se estaba haciendo.
 *
 *
 * ============ SE ENSEÑAN TAMBIÉN LAS QUE NO MANDARON NADA ============
 *
 * Y no es relleno. Una ejecución frenada, o una que leyó el fichero y no
 * encontró ningún cambio, no deja NI UNA fila en el historial de cambios: si
 * esta pantalla solo listara envíos, un cliente frenado tres días seguidos se
 * vería exactamente igual que uno al que no le hacía falta cambiar nada — o
 * sea, no se vería. El estado de cada ejecución es la mitad de la información.
 */

export interface PanelEjecucionesProps {
  clientId: string
  clientName: string
  ejecuciones: EjecucionVista[]
  /** El estado VIVO de cada perfil. Ver la nota de EstadoAhora() */
  perfiles?: EstadoPerfilVista[]
  className?: string
}

export interface EstadoPerfilVista {
  id: string
  name: string
  is_active: boolean
  envio_automatico: boolean
  cadencia_minutos: number | null
  last_run_at: string | null
  last_error: string | null
  last_skip_reason: string | null
}

/** Lo que esta pantalla necesita de una fila de stock_profile_runs */
export interface EjecucionVista {
  id: string
  created_at: string
  estado: StockProfileRunState
  perfil_nombre: string | null
  fichero_nombre: string | null
  batch_id: string | null
  enviados_ok: number | null
  enviados_error: number | null
  cambios_stock: number | null
  cambios_precio: number | null
  sku_casados: number | null
  sku_sin_casar: number | null
  sku_a_cero: number | null
  duracion_ms: number | null
  origen: StockProfileOrigin | null
  /** El detalle de los pasos. NULL en las pasadas anteriores a la migración 165 */
  fases: FaseRegistrada[] | null
  freno_detalle: string | null
  error_message: string | null
  avisos: string[] | null
}

const th =
  'text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 py-1.5 whitespace-nowrap'

const ESTADO_COLOR_PUNTO: Record<StockProfileRunState, string> = {
  sin_cambios: 'bg-zinc-500',
  simulacro: 'bg-zinc-500',
  frenado: 'bg-yellow-400',
  enviado: 'bg-green-400',
  error: 'bg-red-400',
}

const ESTADO_SUBMISSION_COLOR: Record<AmazonSubmissionStatus, string> = {
  pendiente: 'text-white/35',
  aceptado: 'text-green-300/90',
  confirmado: 'text-green-300',
  invalido: 'text-red-300',
  error: 'text-red-300',
}

/** «hace 4 min», «hace 2 h». null si nunca */
function hace(iso: string | null): string | null {
  if (!iso) return null
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (min < 1) return 'hace nada'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} días`
}

/**
 * LA FRANJA QUE DICE QUE ESTO SIGUE VIVO.
 *
 * Existe por una confusión concreta y muy razonable: cuando un fallo SE REPITE
 * IGUAL, el ciclo lo reintenta en cada pasada pero NO escribe una fila nueva —si
 * no, con cadencia de quince minutos serían 96 filas idénticas al día y el
 * historial no contendría otra cosa—. Visto desde la pantalla, «no salen filas
 * nuevas» y «se ha parado» son indistinguibles, y lo primero que piensa
 * cualquiera es lo segundo.
 *
 * Así que se dice con todas las letras: última pasada, cada cuánto entra, y si
 * está reintentando algo. El dato sale de las columnas del perfil, que sí se
 * mueven en cada pasada aunque no se escriba historial.
 */
function EstadoAhora({ perfiles }: { perfiles: EstadoPerfilVista[] }) {
  /**
   * Y DESDE LA LÍNEA DE VIDA, SOLO LO QUE VA MAL.
   *
   * «Última pasada hace 2 min · entra cada 30 min · envía solo» ya lo dice la
   * tira de arriba, con el recorrido entero y la cuenta atrás. Repetirlo aquí
   * era la misma frase dos veces y dos sitios donde mirar.
   *
   * Lo que la tira NO dice —y por eso esto no se ha borrado— es el perfil
   * apagado y el fallo que se está reintentando en silencio. Eso se queda, y
   * ahora destaca porque es lo único que sale.
   */
  const dignos = perfiles.filter((p) => !p.is_active || p.last_error)
  if (dignos.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5 flex-shrink-0">
      {dignos.map((p) => {
        const ultima = hace(p.last_run_at)
        const reintentando = Boolean(p.last_error)
        return (
          <div
            key={p.id}
            className={`rounded-xl border px-3 py-2 text-[11px] ${
              !p.is_active
                ? 'border-white/10 bg-white/[0.02]'
                : reintentando
                  ? 'border-yellow-500/25 bg-yellow-400/[0.05]'
                  : 'border-green-400/20 bg-green-400/[0.04]'
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5 text-white/80 font-medium">
                {!p.is_active ? (
                  <Ban className="h-3 w-3 text-white/30" />
                ) : reintentando ? (
                  <RefreshCw className="h-3 w-3 text-yellow-400" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 text-green-400" />
                )}
                {p.name}
              </span>

              {!p.is_active ? (
                <span className="text-white/40">Perfil apagado: no se lee ni se procesa.</span>
              ) : (
                <>
                  <span className="text-white/50">
                    {ultima ? `Última pasada ${ultima}` : 'Todavía no ha entrado ninguna pasada'}
                  </span>
                  {p.cadencia_minutos && (
                    <span className="text-white/40">· entra cada {p.cadencia_minutos} min</span>
                  )}
                  <span className={p.envio_automatico ? 'text-white/40' : 'text-white/40'}>
                    · {p.envio_automatico ? 'envía solo' : 'solo simulacro, no envía'}
                  </span>
                </>
              )}
            </div>

            {/* EL MENSAJE COMPLETO, no cortado. Es el que dice qué hay que
                hacer, y esconderlo detrás de puntos suspensivos obliga a ir a
                buscarlo a otra pantalla. */}
            {p.is_active && reintentando && (
              <p className="mt-1 text-yellow-200/80 leading-relaxed">
                <strong className="text-yellow-200">Sigue reintentando</strong> en cada pasada. No
                se escribe una fila nueva mientras el fallo sea el mismo, para que el historial no
                se llene de la misma línea. El último fue: {p.last_error}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** «1,4 s» o «2 min 10 s». Un número en milisegundos no lo lee nadie */
function duracion(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`
  const min = Math.floor(ms / 60_000)
  const seg = Math.round((ms % 60_000) / 1000)
  return `${min} min ${seg} s`
}

/**
 * El valor de un cambio, tal cual se guardó.
 *
 * Los dos vienen como TEXTO de la base y se enseñan como texto: son lo que se
 * le mandó a Amazon, letra por letra. Convertirlos a número para «darles
 * formato» es cómo un precio de «24.90» acaba pintado como 2.490 y alguien se
 * pasa media hora buscando un cambio que nunca ocurrió.
 */
function valor(v: string | null, moneda: string | null, campo: AmazonSubmissionField): string {
  if (v == null || v === '') return '—'
  return campo === 'precio' && moneda ? `${v} ${moneda}` : v
}

export function PanelEjecuciones({
  clientId,
  clientName,
  ejecuciones,
  perfiles = [],
  className = '',
}: PanelEjecucionesProps) {
  // La primera de la lista viene abierta: es la que se viene a mirar.
  const [seleccionada, setSeleccionada] = useState<string | null>(ejecuciones[0]?.id ?? null)
  const [cambios, setCambios] = useState<AmazonSubmission[]>([])
  const [cargando, setCargando] = useState(false)
  const [errorCambios, setErrorCambios] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [soloConCambios, setSoloConCambios] = useState(false)

  /**
   * EL FILTRO ESCONDE EL RUIDO, NO LOS PROBLEMAS.
   *
   * Antes dejaba pasar solo lo que había enviado algo. Con el historial completo
   * —donde la mayoría de filas son «el proveedor mandaba lo mismo»— ese filtro
   * es justo el que se va a pulsar para quitarse el ruido de encima, y tal como
   * estaba se llevaba por delante los errores y los frenos.
   *
   * Así que esconde lo que no hizo nada Y salió limpio. Un fallo o un freno se
   * ven siempre, con el filtro puesto o quitado.
   */
  const visibles = useMemo(
    () =>
      soloConCambios
        ? ejecuciones.filter(
            (e) =>
              (e.enviados_ok ?? 0) > 0 || e.estado === 'error' || e.estado === 'frenado'
          )
        : ejecuciones,
    [ejecuciones, soloConCambios]
  )

  const actual = useMemo(
    () => ejecuciones.find((e) => e.id === seleccionada) ?? null,
    [ejecuciones, seleccionada]
  )

  /**
   * Los cambios se piden AL SELECCIONAR, no al cargar la pantalla.
   *
   * Un envío son cientos de filas; traerse los de doscientas ejecuciones para
   * pintar los de una sería mover megas por nada.
   */
  useEffect(() => {
    if (!actual?.batch_id) {
      setCambios([])
      setErrorCambios(null)
      return
    }

    // `cancelado` evita que la respuesta de una ejecución que ya no está
    // seleccionada pise a la de la que sí: se pulsa rápido en la lista y las
    // peticiones no vuelven en orden.
    let cancelado = false
    setCargando(true)
    setErrorCambios(null)

    fetch(
      `/api/growth/ejecuciones/cambios?batch=${encodeURIComponent(actual.batch_id)}&cliente=${encodeURIComponent(clientId)}`
    )
      .then(async (res) => {
        const payload = (await res.json().catch(() => null)) as {
          cambios?: AmazonSubmission[]
          error?: string
        } | null
        if (cancelado) return
        if (!res.ok) {
          setErrorCambios(payload?.error ?? 'No se han podido cargar los cambios')
          setCambios([])
          return
        }
        setCambios(payload?.cambios ?? [])
      })
      .catch(() => {
        if (!cancelado) {
          setErrorCambios('No hay conexión con el servidor')
          setCambios([])
        }
      })
      .finally(() => {
        if (!cancelado) setCargando(false)
      })

    return () => {
      cancelado = true
    }
  }, [actual?.batch_id, clientId])

  const cambiosVisibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return cambios
    return cambios.filter(
      (c) =>
        c.sku.toLowerCase().includes(q) ||
        (c.asin ?? '').toLowerCase().includes(q) ||
        (c.new_value ?? '').toLowerCase().includes(q)
    )
  }, [cambios, busqueda])

  /**
   * EL PERFIL DE LA EJECUCIÓN QUE SE ESTÁ MIRANDO.
   *
   * Se empareja por nombre porque la fila de la ejecución no trae el id del
   * perfil. Con un solo perfil —que es el caso de todos los clientes de hoy— se
   * coge ese y no hay nada que emparejar; el `find` está para el día que un
   * cliente tenga dos ficheros distintos y los nombres importen.
   */
  const perfilDeLaActual = useMemo(() => {
    if (perfiles.length === 0) return null
    if (perfiles.length === 1) return perfiles[0]
    return perfiles.find((p) => p.name === actual?.perfil_nombre) ?? null
  }, [perfiles, actual?.perfil_nombre])

  const resumen = useMemo(() => {
    const enviadas = ejecuciones.filter((e) => e.estado === 'enviado').length
    const frenadas = ejecuciones.filter((e) => e.estado === 'frenado').length
    const conError = ejecuciones.filter((e) => e.estado === 'error').length
    const cambiosTotales = ejecuciones.reduce((s, e) => s + (e.enviados_ok ?? 0), 0)
    return { enviadas, frenadas, conError, cambiosTotales }
  }, [ejecuciones])

  if (ejecuciones.length === 0) {
    return (
      <div className={`flex flex-col gap-2 min-h-0 ${className}`}>
        <EstadoAhora perfiles={perfiles} />
        <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col items-center justify-center gap-2 px-6 text-center">
        <History className="h-6 w-6 text-white/20" />
        <p className="text-[13px] text-white/40">
          Todavía no hay ninguna ejecución de {clientName}.
        </p>
        <p className="text-[11px] text-white/25 max-w-[420px]">
          El ciclo entra cada quince minutos. Si lleva tiempo sin aparecer nada, mira que su origen
          esté configurado y activo en Amazon API · Origen.
        </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col min-h-0 gap-2 ${className}`}>
      {/* ---------------- El recorrido de la pasada ---------------- */}
      <LineaDeVida
        ejecucion={actual}
        perfil={perfilDeLaActual}
        origen={actual?.origen ?? null}
        esLaUltima={actual?.id === ejecuciones[0]?.id}
      />

      <EstadoAhora perfiles={perfiles} />

      {/* Control de un vistazo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 flex-shrink-0">
        {[
          { icono: CheckCircle2, etiqueta: 'Enviadas', valor: resumen.enviadas },
          { icono: ArrowRight, etiqueta: 'Cambios en Amazon', valor: resumen.cambiosTotales },
          { icono: Ban, etiqueta: 'Frenadas', valor: resumen.frenadas },
          { icono: AlertTriangle, etiqueta: 'Con error', valor: resumen.conError },
        ].map((m) => (
          <div key={m.etiqueta} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-white/35 flex items-center gap-1.5">
              <m.icono className="h-3 w-3" /> {m.etiqueta}
            </p>
            <p className="text-white font-semibold text-[15px] mt-0.5 tabular-nums">
              {formatInt(m.valor)}
            </p>
          </div>
        ))}
      </div>

      <div className="flex-1 min-h-0 min-w-0 grid grid-cols-1 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] gap-3">
        {/* ---------- Las ejecuciones ---------- */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2 flex-shrink-0">
            <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider flex items-center gap-2">
              <History className="h-3 w-3" /> Ejecuciones · {ejecuciones.length}
            </h3>
            <button
              type="button"
              onClick={() => setSoloConCambios((v) => !v)}
              className={`ml-auto px-2 py-0.5 rounded-full border text-[10px] font-medium transition-colors ${
                soloConCambios
                  ? 'border-[#FF6600]/60 bg-[#FF6600]/15 text-white'
                  : 'border-white/10 text-white/40 hover:text-white/80'
              }`}
              title="Esconder las pasadas que no tenían nada que hacer. Los errores y los frenos se siguen viendo."
            >
              Esconder las vacías
            </button>
          </div>

          <div className="flex-1 overflow-auto min-w-0">
            {visibles.map((e, i) => {
              const activa = e.id === seleccionada

              /**
               * LOS HUECOS DEL HISTORIAL, EXPLICADOS DONDE SE VEN.
               *
               * El ciclo NO escribe fila cuando una pasada falla con el mismo
               * mensaje que la anterior. Está hecho a propósito —si no, un error
               * repetido llena la lista con noventa y seis copias al día y
               * entierra todo lo demás— pero tiene un efecto que nadie previó:
               * en el historial quedan saltos de dos horas y media, y eso se lee
               * como «el ciclo no se está ejecutando».
               *
               * El aviso de arriba solo sale MIENTRAS está fallando. En cuanto
               * se recupera desaparece, y los huecos se quedan ahí sin que nada
               * diga de qué son.
               *
               * Así que se dice aquí, entre las dos filas: cuántas pasadas
               * faltan y por qué. Se calcula con la cadencia del perfil, no con
               * un número fijo — a 15 minutos y a 120 el mismo salto significa
               * cosas muy distintas.
               */
              const siguiente = visibles[i + 1]
              const cadencia =
                (perfiles.find((p) => p.name === e.perfil_nombre) ?? (perfiles.length === 1 ? perfiles[0] : undefined))
                  ?.cadencia_minutos ?? null
              let hueco: number | null = null
              if (siguiente && cadencia && cadencia > 0) {
                const minutos = Math.round(
                  (Date.parse(e.created_at) - Date.parse(siguiente.created_at)) / 60_000
                )
                // Milésima y media de la cadencia: por debajo de eso es el
                // margen normal del cron, no un hueco.
                const faltan = Math.round(minutos / cadencia) - 1
                if (minutos > cadencia * 1.5 && faltan >= 1) hueco = faltan
              }

              return (
                <Fragment key={e.id}>
                <button
                  type="button"
                  onClick={() => setSeleccionada(e.id)}
                  className={`w-full text-left px-3 py-2 border-b border-white/[0.04] transition-colors ${
                    activa ? 'bg-[#FF6600]/[0.08]' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`h-2 w-2 rounded-full flex-shrink-0 ${ESTADO_COLOR_PUNTO[e.estado]}`}
                    />
                    <span className="text-[12px] text-white tabular-nums whitespace-nowrap">
                      {formatDateTime(e.created_at)}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded border leading-none whitespace-nowrap flex-shrink-0 ${STOCK_RUN_STATE_COLORS[e.estado]}`}
                    >
                      {STOCK_RUN_STATE_LABELS[e.estado]}
                    </span>
                    <span className="ml-auto text-[10px] text-white/30 tabular-nums whitespace-nowrap">
                      {duracion(e.duracion_ms)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-1 pl-4 min-w-0">
                    <span className="text-[11px] text-white/40 truncate flex-1 min-w-0">
                      {e.fichero_nombre ?? 'sin fichero'}
                    </span>
                    {(e.enviados_ok ?? 0) > 0 && (
                      <span className="text-[10px] text-green-300/80 tabular-nums whitespace-nowrap">
                        {formatInt(e.enviados_ok)} cambios
                      </span>
                    )}
                    {(e.enviados_error ?? 0) > 0 && (
                      <span className="text-[10px] text-red-300/80 tabular-nums whitespace-nowrap">
                        {formatInt(e.enviados_error)} fallaron
                      </span>
                    )}
                  </div>

                  {/* El porqué de una ejecución que no mandó nada va EN LA
                      LISTA y no escondido en el detalle: es la información que
                      hace falta para decidir si hay que hacer algo. */}
                  {(e.freno_detalle || e.error_message) && (
                    <p
                      className={`text-[10px] mt-1 pl-4 line-clamp-2 ${
                        e.error_message ? 'text-red-300/70' : 'text-yellow-300/70'
                      }`}
                    >
                      {e.error_message ?? e.freno_detalle}
                    </p>
                  )}
                </button>
                {hueco !== null && (
                  <div className="px-3 py-1.5 border-b border-white/[0.04] bg-white/[0.015] text-[10.5px] leading-relaxed text-white/35">
                    {hueco === 1 ? 'Falta 1 pasada' : `Faltan ${hueco} pasadas`} entre estas dos.
                    Desde que el ciclo apunta todas —también las que no tenían nada que hacer— un
                    hueco significa que esas pasadas NO entraron: el cron parado, un despliegue, o
                    el perfil apagado durante ese rato.
                  </div>
                )}
                </Fragment>
                )
              })}
            {visibles.length === 0 && (
              <p className="text-[12px] text-white/30 text-center py-8 px-4">
                Ninguna de las {ejecuciones.length} ejecuciones mandó cambios.
              </p>
            )}
          </div>
        </div>

        {/* ---------- Qué cambió ---------- */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/[0.06] flex flex-wrap items-center gap-2 flex-shrink-0">
            <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider">
              Qué cambió
              {actual && (
                <span className="ml-2 normal-case tracking-normal text-white/30">
                  {formatDateTime(actual.created_at)}
                  {actual.perfil_nombre ? ` · ${actual.perfil_nombre}` : ''}
                </span>
              )}
            </h3>

            {cambios.length > 0 && (
              <div className="relative ml-auto">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-white/30" />
                <input
                  value={busqueda}
                  onChange={(ev) => setBusqueda(ev.target.value)}
                  placeholder="SKU o ASIN"
                  className="h-6 w-[180px] rounded-full border border-white/10 bg-white/[0.03] pl-7 pr-2 text-[11px] text-white outline-none focus:border-[#FF6600] transition-colors placeholder:text-white/25"
                />
              </div>
            )}
          </div>

          {/* Los avisos de la ejecución: explican un resultado raro sin que
              nadie tenga que ir a buscarlos. */}
          {actual?.avisos && actual.avisos.length > 0 && (
            <div className="px-3 py-2 border-b border-white/[0.06] flex-shrink-0 space-y-1">
              {actual.avisos.map((a, i) => (
                <p key={i} className="text-[11px] text-yellow-300/70 flex gap-1.5">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                  {a}
                </p>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-auto min-w-0">
            {cargando ? (
              <div className="h-full flex items-center justify-center gap-2 text-white/35">
                <Loader2 className="h-4 w-4 animate-spin text-[#FF6600]" />
                <span className="text-[12px]">Cargando los cambios…</span>
              </div>
            ) : errorCambios ? (
              <p className="text-[12px] text-red-300/80 text-center py-8 px-4">{errorCambios}</p>
            ) : !actual?.batch_id ? (
              /* NO ES UN HUECO, ES LA RESPUESTA: esa ejecución no mandó nada, y
                 el motivo está en la tarjeta de la izquierda. */
              <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-[13px] text-white/35">
                  Esta ejecución no mandó ningún cambio a Amazon.
                </p>
                <p className="text-[11px] text-white/25 max-w-[380px]">
                  {actual?.estado === 'frenado'
                    ? 'Saltó un freno: el motivo está en la tarjeta de la izquierda.'
                    : actual?.estado === 'error'
                      ? 'Terminó con error. El mensaje está en la tarjeta de la izquierda.'
                      : actual?.estado === 'simulacro'
                        ? 'Es un simulacro: se calculó todo pero el envío está apagado para este cliente.'
                        : 'Leyó el fichero y lo que decía era lo que Amazon ya tenía.'}
                </p>
              </div>
            ) : cambiosVisibles.length === 0 ? (
              <p className="text-[12px] text-white/30 text-center py-8 px-4">
                {busqueda ? 'Ningún SKU con esa búsqueda.' : 'Sin cambios registrados en este lote.'}
              </p>
            ) : (
              <table className="w-full min-w-[520px] text-[12px] border-collapse">
                <thead className="sticky top-0 bg-[#0d0d0d] z-10">
                  <tr>
                    <th className={`${th} text-left px-2.5`}>SKU</th>
                    <th className={`${th} text-left px-1 w-[70px]`}>Campo</th>
                    <th className={`${th} text-right px-1 w-[90px]`}>Antes</th>
                    <th className={`${th} text-center px-1 w-[24px]`}></th>
                    <th className={`${th} text-right px-1 w-[90px]`}>Ahora</th>
                    <th className={`${th} text-left px-2.5 w-[92px]`}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {cambiosVisibles.map((c) => {
                    const campo = c.field as AmazonSubmissionField
                    const antes = valor(c.previous_value, c.currency, campo)
                    const ahora = valor(c.new_value, c.currency, campo)
                    const aCero = campo === 'cantidad' && c.new_value === '0'
                    return (
                      <tr
                        key={c.id}
                        className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                        title={c.error_message ?? undefined}
                      >
                        <td className="px-2.5 py-1.5 text-white/85 font-medium">
                          <span className="block truncate max-w-[200px]" title={c.sku}>
                            {c.sku}
                          </span>
                          {c.asin && (
                            <span className="block text-[10px] text-white/25">{c.asin}</span>
                          )}
                        </td>
                        <td className="px-1 py-1.5 text-white/45">
                          {AMAZON_FIELD_LABELS[campo] ?? campo}
                        </td>
                        <td className="px-1 py-1.5 text-right tabular-nums text-white/40">
                          {antes}
                        </td>
                        <td className="px-1 py-1.5 text-center text-white/20">→</td>
                        <td
                          className={`px-1 py-1.5 text-right tabular-nums font-semibold ${
                            /* Un stock que se va a cero se pinta en rojo: es el
                               cambio que retira un producto de la venta, y el
                               que hay que poder encontrar de un vistazo cuando
                               un cliente pregunta por qué dejó de vender. */
                            aCero ? 'text-red-300' : 'text-white'
                          }`}
                        >
                          {ahora}
                        </td>
                        <td
                          className={`px-2.5 py-1.5 ${ESTADO_SUBMISSION_COLOR[c.status as AmazonSubmissionStatus] ?? 'text-white/40'}`}
                        >
                          {AMAZON_SUBMISSION_STATUS_LABELS[c.status as AmazonSubmissionStatus] ??
                            c.status}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {cambios.length > 0 && (
            <div className="px-3 py-1.5 border-t border-white/[0.06] flex-shrink-0 text-[10px] text-white/30">
              {formatInt(cambiosVisibles.length)}
              {busqueda ? ` de ${formatInt(cambios.length)}` : ''} cambios · «Antes» es lo que Amazon
              tenía publicado justo antes de este envío.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
