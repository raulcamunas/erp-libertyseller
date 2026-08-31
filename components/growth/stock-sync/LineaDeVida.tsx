'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Ban,
  Check,
  Clock,
  Download,
  FileSpreadsheet,
  GitCompareArrows,
  Link2,
  Loader2,
  Minus,
  Send,
  Store,
  X,
} from 'lucide-react'
import {
  PASOS_PASADA,
  PASO_HACIENDO,
  PASO_TITULO,
  STOCK_PROFILE_ORIGIN_LABELS,
  formatInt,
  type FaseRegistrada,
  type PasoPasada,
  type StockProfileOrigin,
} from '@/lib/types/stock-sync'
import type { LotePrecio } from '@/lib/growth/ejecuciones'
import type { EjecucionVista, EstadoPerfilVista } from './PanelEjecuciones'
import { formatDateTime } from './shared'

/**
 * LA LÍNEA DE VIDA DE UNA PASADA.
 *
 * El recorrido entero, de izquierda a derecha: de dónde sale el fichero, qué se
 * leyó, qué casó con Amazon, qué contestó Amazon, qué diferencias había y qué se
 * mandó. Con el tiempo que tardó cada paso y el número que lo resume.
 *
 *
 * ============ LO QUE SE ANIMA ES REAL, Y POR ESO SE LLAMA «ÚLTIMA PASADA» ============
 *
 * Esto es la decisión importante de la pantalla, así que conviene que esté
 * escrita: la fila de una ejecución SE ESCRIBE AL TERMINAR, no mientras corre.
 * Mientras la pasada está en marcha —y son 2,6 segundos de media— no hay en la
 * base ninguna forma de saber por qué paso va.
 *
 * Había dos maneras de hacer esta pantalla:
 *
 *   · Escribir el paso en curso en cada uno de los seis. Serían seis escrituras
 *     más por pasada y por cliente: a 48 pasadas diarias y cuatro clientes,
 *     1.152 al día para pintar una barrita — en la misma base que llegó al 177 %
 *     de la cuota el 27 de agosto.
 *
 *   · Animar el recorrido DE LA PASADA QUE ACABA DE TERMINAR, con sus tiempos
 *     reales, y contar los minutos hasta la siguiente.
 *
 * Es la segunda. Y por eso la cabecera dice siempre CUÁNDO fue lo que se está
 * viendo. Una animación que se mueve mientras arriba pone «hace 12 min» es una
 * animación; una que se mueve dando a entender que está pasando ahora es una
 * mentira, y esta pantalla existe precisamente para que nadie tenga que adivinar
 * si el ERP está haciendo algo.
 *
 * EL REPLAY VA A ESCALA. Un paso que tardó 78 segundos tarda visiblemente más en
 * llenarse que uno de 100 ms. No es adorno: es la respuesta a «¿por qué esta
 * pasada ha tardado medio minuto?» sin tener que abrir nada.
 */

/* ------------------------------------------------------------------ */

type EstadoNodo = FaseRegistrada['estado'] | 'sin_dato'

interface Nodo {
  paso: PasoPasada
  /** Cuando el paso no se llama como en el ciclo de stock. Ver nodosDePrecio() */
  titulo?: string
  estado: EstadoNodo
  ms: number | null
  cifra: number | null
  nota: string | null
}

const ICONO: Record<PasoPasada, typeof Download> = {
  origen: Download,
  leer: FileSpreadsheet,
  cruzar: Link2,
  amazon: Store,
  contrastar: GitCompareArrows,
  enviar: Send,
}

const PALETA: Record<EstadoNodo, { anillo: string; fondo: string; icono: string; texto: string }> =
  {
    ok: {
      anillo: 'border-emerald-400/50',
      fondo: 'bg-emerald-400/10',
      icono: 'text-emerald-300',
      texto: 'text-emerald-200/70',
    },
    aviso: {
      anillo: 'border-amber-400/50',
      fondo: 'bg-amber-400/10',
      icono: 'text-amber-300',
      texto: 'text-amber-200/70',
    },
    freno: {
      anillo: 'border-amber-400/50',
      fondo: 'bg-amber-400/10',
      icono: 'text-amber-300',
      texto: 'text-amber-200/70',
    },
    error: {
      anillo: 'border-red-400/60',
      fondo: 'bg-red-400/10',
      icono: 'text-red-300',
      texto: 'text-red-200/75',
    },
    omitido: {
      anillo: 'border-white/12',
      fondo: 'bg-white/[0.03]',
      icono: 'text-white/30',
      texto: 'text-white/35',
    },
    sin_dato: {
      anillo: 'border-white/10 border-dashed',
      fondo: 'bg-transparent',
      icono: 'text-white/20',
      texto: 'text-white/25',
    },
  }

function MarcaEstado({ estado }: { estado: EstadoNodo }) {
  const base = 'h-3 w-3'
  if (estado === 'ok') return <Check className={`${base} text-emerald-300`} strokeWidth={3} />
  if (estado === 'error') return <X className={`${base} text-red-300`} strokeWidth={3} />
  if (estado === 'aviso' || estado === 'freno')
    return <AlertTriangle className={`${base} text-amber-300`} strokeWidth={2.5} />
  if (estado === 'omitido') return <Minus className={`${base} text-white/30`} strokeWidth={3} />
  return <span className="block h-1 w-1 rounded-full bg-white/20" />
}

/** «1,2 s», «340 ms». El milisegundo suelto no lo lee nadie */
function ms(v: number | null): string {
  if (v == null) return ''
  if (v < 1000) return `${v} ms`
  if (v < 60_000) return `${(v / 1000).toFixed(1).replace('.', ',')} s`
  return `${Math.floor(v / 60_000)} min ${Math.round((v % 60_000) / 1000)} s`
}

// El mismo formateador que las cifras de arriba del panel: si dos números de la
// misma pantalla se agrupan distinto, uno de los dos está mal.
function num(v: number | null): string {
  return v == null ? '' : formatInt(v)
}

/** «1 línea» y no «1 líneas». Se ve todos los días en un catálogo con un cambio */
function plural(n: number, una: string, varias: string): string {
  return `${num(n)} ${n === 1 ? una : varias}`
}

function pesos(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

/**
 * LO QUE VA DEBAJO DEL ICONO: la cifra que resume el paso.
 *
 * No es el mismo número en todos, y ponerle a todos «cifra» sería no decir
 * nada. En el fichero es lo que pesa, en la lectura son líneas, en Amazon son
 * referencias y al final son cambios.
 */
function cifraDe(nodo: Nodo): string {
  if (nodo.estado === 'sin_dato') return 'no consta'
  if (nodo.cifra == null) return ''
  // Un nodo con título propio es de un recorrido que no es el del stock, así que
  // su cifra tampoco son líneas ni referencias casadas: son precios.
  if (nodo.titulo) {
    return nodo.paso === 'enviar'
      ? nodo.cifra === 0
        ? 'ninguno aceptado'
        : plural(nodo.cifra, 'aceptado', 'aceptados')
      : plural(nodo.cifra, 'precio', 'precios')
  }
  switch (nodo.paso) {
    case 'origen':
      return pesos(nodo.cifra)
    case 'leer':
      return plural(nodo.cifra, 'línea', 'líneas')
    case 'cruzar':
      return plural(nodo.cifra, 'casada', 'casadas')
    case 'amazon':
      return plural(nodo.cifra, 'leída', 'leídas')
    case 'contrastar':
      return nodo.cifra === 0 ? 'sin diferencias' : plural(nodo.cifra, 'diferencia', 'diferencias')
    case 'enviar':
      return nodo.cifra === 0 ? 'nada que mandar' : plural(nodo.cifra, 'enviado', 'enviados')
  }
}

/**
 * LOS PASOS DE UNA EJECUCIÓN, VENGAN GUARDADOS O HAYA QUE DEDUCIRLOS.
 *
 * Las pasadas anteriores a la migración 165 tienen `fases` a null, y son casi
 * todo el historial. Se reconstruyen con las columnas de siempre —que sí están—
 * y solo se pierde el tiempo por paso. La alternativa era enseñar el historial
 * en blanco hasta que pasara media hora, que es peor de lo que arregla.
 *
 * Y lo que no se sabe se dice: el paso de Amazon en una pasada vieja sale como
 * «no consta», no como si no hubiera ocurrido.
 */
function nodosDe(e: EjecucionVista): Nodo[] {
  if (e.fases && e.fases.length > 0) {
    const porPaso = new Map(e.fases.map((f) => [f.paso, f]))
    return PASOS_PASADA.map((paso) => {
      const f = porPaso.get(paso)
      return f
        ? { paso, estado: f.estado, ms: f.ms, cifra: f.cifra, nota: f.nota }
        : { paso, estado: 'sin_dato' as const, ms: null, cifra: null, nota: null }
    })
  }

  const cambios = (e.cambios_stock ?? 0) + (e.cambios_precio ?? 0)
  const reventó = e.estado === 'error'

  return [
    {
      paso: 'origen',
      estado: e.fichero_nombre ? 'ok' : 'sin_dato',
      ms: null,
      cifra: null,
      nota: e.fichero_nombre,
    },
    {
      paso: 'leer',
      estado: e.sku_casados == null && e.sku_sin_casar == null ? 'sin_dato' : 'ok',
      ms: null,
      cifra: null,
      nota: null,
    },
    {
      paso: 'cruzar',
      estado: e.sku_casados == null ? 'sin_dato' : e.sku_casados > 0 ? 'ok' : 'aviso',
      ms: null,
      cifra: e.sku_casados,
      nota:
        e.sku_sin_casar && e.sku_sin_casar > 0 ? `${num(e.sku_sin_casar)} sin casar` : null,
    },
    // Esta vía es de septiembre; en las pasadas de antes no existía y en las de
    // después no se guardaba. Decir «no consta» es lo único cierto.
    { paso: 'amazon', estado: 'sin_dato', ms: null, cifra: null, nota: null },
    {
      paso: 'contrastar',
      estado: e.estado === 'frenado' ? 'freno' : 'ok',
      ms: null,
      cifra: cambios,
      nota: e.estado === 'frenado' ? e.freno_detalle : null,
    },
    {
      paso: 'enviar',
      estado: reventó
        ? 'error'
        : e.enviados_ok == null
          ? 'omitido'
          : (e.enviados_error ?? 0) > 0
            ? 'aviso'
            : 'ok',
      ms: null,
      cifra: e.enviados_ok,
      nota: reventó
        ? e.error_message
        : (e.enviados_error ?? 0) > 0
          ? `${num(e.enviados_error)} no los aceptó Amazon`
          : e.enviados_ok == null
            ? e.estado === 'frenado'
              ? 'Frenado antes de mandar nada'
              : 'No había nada que mandar'
            : null,
    },
  ]
}

/**
 * LOS PASOS DE UNA PUBLICACIÓN DE PRECIOS.
 *
 * Tres, no seis, y con sus nombres: aquí no hay fichero de proveedor que
 * recoger ni referencias que casar con SKU —el motor de precios trabaja ya sobre
 * el catálogo cruzado—. Enseñar los seis del stock con tres apagados sería
 * inventar unos pasos que en este recorrido no existen.
 *
 * Se reconstruyen del propio lote de envíos, que es donde está el dato entero:
 * cuántos se mandaron, cuántos entraron y cuántos rebotó Amazon. No hace falta
 * guardar nada aparte. Ver la migración 167.
 */
function nodosDePrecio(lote: LotePrecio): Nodo[] {
  const rebotados = lote.fallidos
  const enCola = lote.pendientes

  return [
    {
      paso: 'contrastar',
      titulo: 'Calcular con las reglas',
      // SIN CIFRA, A PROPÓSITO. El lote solo sabe lo que se MANDÓ; cuántas
      // referencias se calcularon para llegar ahí no está en `amazon_submissions`
      // y no se puede deducir. Poner aquí `lote.total` daría el mismo número que
      // el paso siguiente con otro nombre, que se lee como si fueran dos datos
      // distintos — y el de la izquierda sería falso.
      estado: 'ok',
      ms: null,
      cifra: null,
      nota: null,
    },
    {
      paso: 'amazon',
      titulo: 'Precios que cambiaban',
      estado: 'ok',
      ms: null,
      cifra: lote.total,
      nota: null,
    },
    {
      paso: 'enviar',
      titulo: 'Enviar a Amazon',
      estado: rebotados > 0 ? (lote.aceptados > 0 ? 'aviso' : 'error') : 'ok',
      ms: null,
      cifra: lote.aceptados,
      nota:
        rebotados > 0
          ? `${num(rebotados)} no los ha aceptado Amazon` +
            (lote.primer_error ? `. El primero: ${lote.primer_error.slice(0, 200)}` : '')
          : enCola > 0
            ? `${num(enCola)} todavía en cola: Amazon tarda un rato en confirmarlos`
            : null,
    },
  ]
}

/**
 * El calendario del replay.
 *
 * Proporcional al tiempo real, con suelo y techo: sin suelo, los pasos de 50 ms
 * pasarían sin verse; sin techo, una pasada de 30 s tardaría 30 s en pintarse y
 * nadie espera eso mirando una pantalla.
 */
const REPLAY_MS = 2200
const MIN_NODO = 190
const MAX_NODO = 850

function calendario(nodos: Nodo[]): number[] {
  const total = nodos.reduce((s, n) => s + (n.ms ?? 0), 0)
  const duraciones = nodos.map((n) => {
    if (total <= 0 || n.ms == null) return REPLAY_MS / nodos.length
    return Math.min(MAX_NODO, Math.max(MIN_NODO, (n.ms / total) * REPLAY_MS))
  })
  const offsets: number[] = []
  let acc = 0
  for (const d of duraciones) {
    offsets.push(acc)
    acc += d
  }
  return offsets
}

/* ------------------------------------------------------------------ */

export interface LineaDeVidaProps {
  ejecucion: EjecucionVista | null
  /** Cuando lo que se mira es una publicación de precios y no una pasada de stock */
  lote?: LotePrecio | null
  perfil: EstadoPerfilVista | null
  origen?: StockProfileOrigin | null
  /** true = la ejecución que se está viendo es la más reciente del historial */
  esLaUltima: boolean
}

export function LineaDeVida({
  ejecucion,
  lote = null,
  perfil,
  origen,
  esLaUltima,
}: LineaDeVidaProps) {
  const router = useRouter()
  const nodos = useMemo(
    () => (lote ? nodosDePrecio(lote) : ejecucion ? nodosDe(ejecucion) : []),
    [ejecucion, lote]
  )

  /**
   * HASTA DÓNDE LLEGÓ LA PASADA DE VERDAD.
   *
   * Después de un paso que revienta no hay más pasos: la ejecución se acabó
   * ahí. Encender los siguientes —aunque fuera medio segundo, de camino— sería
   * enseñar «Preguntando a Amazon…» en una pasada que murió bajando el fichero
   * y que no llegó a hablar con Amazon en toda su vida.
   */
  const alcance = useMemo(() => {
    const i = nodos.findIndex((n) => n.estado === 'error')
    return i === -1 ? nodos.length : i + 1
  }, [nodos])

  const offsets = useMemo(() => calendario(nodos.slice(0, alcance)), [nodos, alcance])

  /** Cuántos nodos van encendidos. Avanza con el calendario de arriba */
  const [encendidos, setEncendidos] = useState(0)
  /**
   * EL RELOJ NACE A NULL Y ARRANCA AL MONTAR.
   *
   * Si `Date.now()` se evalúa también en el servidor, el HTML llega con una
   * cuenta atrás calculada allí y el navegador la recalcula al hidratar. Son
   * dos textos distintos en el mismo sitio, y React lo tira todo abajo con un
   * error de hidratación. Por eso la cuenta atrás no se pinta hasta que hay
   * navegador: es medio segundo de guion en vez de una pantalla rota.
   */
  const [ahora, setAhora] = useState<number | null>(null)
  const pidiendo = useRef(false)

  // El replay se rearranca cuando cambia la ejecución que se mira: al entrar, al
  // pulsar otra del historial, y cuando el ciclo mete una nueva.
  useEffect(() => {
    if (nodos.length === 0) return
    setEncendidos(0)
    const timers = offsets.map((off, i) =>
      setTimeout(() => setEncendidos(i + 1), off + MIN_NODO / 2)
    )
    return () => timers.forEach(clearTimeout)
  }, [ejecucion?.id, lote?.batch_id, nodos.length, offsets])

  // El reloj de la cuenta atrás. Un segundo: es lo que se espera de algo que
  // cuenta minutos y segundos, y no cuesta nada.
  useEffect(() => {
    setAhora(Date.now())
    const t = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const cadenciaMs = (perfil?.cadencia_minutos ?? 0) * 60_000
  const ultimaMs = perfil?.last_run_at ? Date.parse(perfil.last_run_at) : null
  const proximaEn =
    ahora !== null && cadenciaMs > 0 && ultimaMs !== null
      ? ultimaMs + cadenciaMs - ahora
      : null

  /**
   * CUANDO LA CUENTA ATRÁS LLEGA A CERO, SE PREGUNTA AL SERVIDOR.
   *
   * Y no antes. Recargar cada minuto «por si acaso» sería una consulta por
   * minuto y por pestaña abierta contra la cuenta de un cliente, para no
   * enterarse de nada el 96 % de las veces.
   *
   * El margen de 20 segundos es porque el cron entra cada minuto y la pasada
   * tarda unos segundos: preguntar en el instante exacto del cero es preguntar
   * antes de que exista la fila.
   */
  useEffect(() => {
    if (proximaEn === null || proximaEn > -20_000 || pidiendo.current) return
    pidiendo.current = true
    router.refresh()
    const t = setTimeout(() => {
      pidiendo.current = false
    }, 30_000)
    return () => clearTimeout(t)
  }, [proximaEn, router])

  if (nodos.length === 0) return null

  const apagado = perfil && !perfil.is_active
  const entrando = proximaEn !== null && proximaEn <= 0 && !apagado

  return (
    <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.035] to-transparent px-3 py-2.5">
      {/* ---------------- Cabecera: qué se está mirando ---------------- */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-medium text-white/85">
            {lote
              ? 'Publicación de precios'
              : esLaUltima
                ? 'Última pasada'
                : 'Pasada del historial'}
          </span>
          <span className="text-white/40">
            {formatDateTime(lote ? lote.created_at : (ejecucion?.created_at ?? null))}
          </span>
          {lote ? (
            <span className="rounded border border-sky-400/25 bg-sky-400/10 px-1.5 py-px text-[10px] text-sky-200/80">
              Precios
            </span>
          ) : (
            origen && (
              <span className="rounded border border-white/10 px-1.5 py-px text-[10px] text-white/45">
                {STOCK_PROFILE_ORIGIN_LABELS[origen]}
              </span>
            )
          )}
          {!lote && ejecucion?.duracion_ms != null && (
            <span className="text-white/35">· {ms(ejecucion.duracion_ms)} en total</span>
          )}
          {lote?.source_ref?.startsWith('entrais-automatico') && (
            <span className="text-white/30">· la mandó el ciclo, no una persona</span>
          )}
        </div>

        <CuentaAtras
          montado={ahora !== null}
          restanteMs={proximaEn}
          cadenciaMs={cadenciaMs}
          apagado={Boolean(apagado)}
          entrando={entrando}
          envioAutomatico={perfil?.envio_automatico ?? false}
        />
      </div>

      {/* ---------------- El recorrido ---------------- */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="flex min-w-[720px] items-start">
          {nodos.map((nodo, i) => {
            const on = i < encendidos
            const Icono = ICONO[nodo.paso]
            const p = PALETA[nodo.estado]
            /**
             * EL GERUNDIO Y LA RUEDECITA, SOLO EN LOS PASOS QUE CORRIERON.
             *
             * Un paso omitido o sin dato no estuvo «enviando a Amazon» ni medio
             * segundo. Se enciende con su cara final y ya está.
             */
            const enCurso =
              i === encendidos &&
              encendidos < alcance &&
              (nodo.estado === 'ok' || nodo.estado === 'aviso')
            const noLlego = i >= alcance

            return (
              <div key={nodo.paso} className="flex flex-1 items-start">
                {/* --- El nodo --- */}
                <div className="flex w-[104px] flex-shrink-0 flex-col items-center text-center">
                  <div
                    className={`relative flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-500 ${
                      on ? `${p.anillo} ${p.fondo}` : 'border-white/[0.07] bg-transparent'
                    } ${on && nodo.estado === 'error' ? 'lv-late' : ''}`}
                  >
                    {enCurso ? (
                      <Loader2 className="h-4 w-4 animate-spin text-white/50" />
                    ) : (
                      <Icono
                        className={`h-4 w-4 transition-colors duration-500 ${
                          on ? p.icono : 'text-white/15'
                        }`}
                        strokeWidth={1.75}
                      />
                    )}

                    {/* La marca de resultado, en la esquina. Aparece cuando el
                        nodo ya ha «ocurrido» en el replay, no antes. */}
                    {on && (
                      <span className="lv-pop absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-[#0b0b0d] bg-[#141417]">
                        <MarcaEstado estado={nodo.estado} />
                      </span>
                    )}
                  </div>

                  <p
                    className={`mt-1.5 text-[10.5px] leading-tight transition-colors duration-500 ${
                      on ? 'text-white/75' : 'text-white/25'
                    }`}
                  >
                    {enCurso
                      ? PASO_HACIENDO[nodo.paso]
                      : (nodo.titulo ?? PASO_TITULO[nodo.paso])}
                  </p>

                  <p
                    className={`text-[10px] leading-tight ${
                      noLlego ? 'text-white/20' : on ? p.texto : 'text-white/15'
                    }`}
                  >
                    {noLlego ? 'no llegó' : cifraDe(nodo)}
                  </p>

                  {nodo.ms != null && (
                    <p
                      className={`text-[9.5px] tabular-nums transition-colors duration-500 ${
                        on ? 'text-white/30' : 'text-white/10'
                      }`}
                    >
                      {ms(nodo.ms)}
                    </p>
                  )}
                </div>

                {/* --- El hilo hasta el siguiente --- */}
                {i < nodos.length - 1 && (
                  <div className="relative mt-5 h-px flex-1 overflow-hidden bg-white/[0.07]">
                    <span
                      className={`absolute inset-y-0 left-0 bg-gradient-to-r from-white/25 to-white/45 transition-[width] ease-out ${
                        on ? 'w-full' : 'w-0'
                      }`}
                      style={{ transitionDuration: `${Math.round(MIN_NODO * 1.6)}ms` }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ---------------- Lo que hay que leer, si lo hay ---------------- */}
      {(() => {
        /**
         * SOLO SE ESCRIBE LA FRASE DE LOS PASOS QUE NO SALIERON LIMPIOS.
         *
         * Poner la nota de los seis convierte la tira en un párrafo y esconde
         * la única que importa. Un paso en verde ya se explica solo con su
         * cifra.
         */
        const dignas = nodos.filter(
          (n) => n.nota && n.estado !== 'ok' && n.estado !== 'sin_dato'
        )
        if (dignas.length === 0) return null
        return (
          <div className="mt-2 space-y-1 border-t border-white/[0.07] pt-2">
            {dignas.map((n) => (
              <p
                key={n.paso}
                className={`text-[10.5px] leading-relaxed ${PALETA[n.estado].texto}`}
              >
                <strong className="font-medium">{n.titulo ?? PASO_TITULO[n.paso]}:</strong>{' '}
                {n.nota}
              </p>
            ))}
          </div>
        )
      })()}
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * CUÁNTO FALTA PARA LA SIGUIENTE, CON EL ANILLO QUE SE VACÍA.
 *
 * El anillo no es decoración: enseña la proporción de la espera que queda, que
 * es lo que se mira de reojo sin leer el número.
 */
function CuentaAtras({
  montado,
  restanteMs,
  cadenciaMs,
  apagado,
  entrando,
  envioAutomatico,
}: {
  montado: boolean
  restanteMs: number | null
  cadenciaMs: number
  apagado: boolean
  entrando: boolean
  envioAutomatico: boolean
}) {
  // El hueco antes de que arranque el reloj. Del mismo alto que lo que va a
  // sustituir, para que la cabecera no dé un salto al montarse.
  if (!montado && !apagado) return <span className="h-4 text-[11px] text-white/20">·</span>

  if (apagado) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-white/40">
        <Ban className="h-3.5 w-3.5 text-white/30" />
        Perfil apagado: no entra ninguna pasada
      </span>
    )
  }

  if (restanteMs === null) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-white/40">
        <Clock className="h-3.5 w-3.5 text-white/30" />
        Sin cadencia: solo entra cuando se lanza a mano
      </span>
    )
  }

  if (entrando) {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-[#FF8A3D]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        La pasada está entrando…
      </span>
    )
  }

  const seg = Math.max(0, Math.round(restanteMs / 1000))
  const mm = Math.floor(seg / 60)
  const ss = seg % 60
  // Lo que queda de vuelta al reloj. 0 = acaba de entrar, 1 = está a punto.
  const avance = cadenciaMs > 0 ? 1 - Math.min(1, Math.max(0, restanteMs / cadenciaMs)) : 0
  const R = 8
  const C = 2 * Math.PI * R

  return (
    <span className="flex items-center gap-2 text-[11px] text-white/50">
      <svg viewBox="0 0 20 20" className="h-4 w-4 -rotate-90">
        <circle cx="10" cy="10" r={R} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="2" />
        <circle
          cx="10"
          cy="10"
          r={R}
          fill="none"
          stroke="#FF6600"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - avance)}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      Siguiente pasada en{' '}
      <strong className="font-medium tabular-nums text-white/80">
        {mm}:{String(ss).padStart(2, '0')}
      </strong>
      <span className="text-white/30">
        · {envioAutomatico ? 'y se manda sola' : 'solo simulacro, no manda'}
      </span>
    </span>
  )
}
