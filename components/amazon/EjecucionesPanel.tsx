'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, History, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { getAmazon, type EjecucionesResponse } from '@/lib/amazon/client'
import {
  STOCK_BRAKE_LABELS,
  STOCK_RUN_STATE_COLORS,
  STOCK_RUN_STATE_LABELS,
  formatInt,
  type StockProfileRun,
  type StockReadProfile,
} from '@/lib/types/stock-sync'
import {
  cardShell,
  errorBox,
  formatDayTime,
  formatExact,
  formatWhen,
  ghostButton,
  infoBox,
  warnBox,
  TH,
  tableShell,
} from './shared'

/**
 * QUÉ HA HECHO EL CICLO AUTOMÁTICO CON ESTE PERFIL.
 *
 * Esta pantalla existe para una pregunta concreta que llega por teléfono: «¿por
 * qué este producto lleva tres días con el stock viejo?». La respuesta está
 * siempre en una de estas filas —saltó un freno, el fichero no llegó, se mandó y
 * Amazon lo rechazó— y cada una lo dice con sus números.
 *
 * ARRIBA VA LO QUE PASA AHORA Y ABAJO LO QUE PASÓ, en ese orden y no al revés:
 * lo primero que hay que saber es si esto está mandando algo de verdad o
 * simplemente calculando. Un perfil con el envío apagado lleva semanas
 * pareciendo que funciona si lo único que se enseña es una tabla de ejecuciones
 * correctas.
 *
 * LAS PASADAS QUE NO HICIERON NADA NO TIENEN FILA, y eso hay que decirlo aquí o
 * la tabla engaña: cuando el fichero es idéntico al de hace un cuarto de hora no
 * se procesa ni se escribe nada, así que un perfil sano y al día puede pasarse
 * el día entero sin una sola fila nueva. Por eso la cabecera enseña «se miró
 * hace 4 minutos y el fichero era el mismo» aunque debajo no haya novedades.
 */
export function EjecucionesPanel({ perfil: perfilInicial }: { perfil: StockReadProfile }) {
  const [perfil, setPerfil] = useState(perfilInicial)
  const [runs, setRuns] = useState<StockProfileRun[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(
    async (silencioso = false) => {
      if (!silencioso) setCargando(true)
      const res = await getAmazon<EjecucionesResponse>(
        `/api/amazon/perfiles/${perfilInicial.id}/ejecuciones`
      )
      setCargando(false)

      if (!res.ok) {
        setError(res.error)
        if (!silencioso) toast.error(res.error)
        return
      }
      setError(null)
      setPerfil(res.data.perfil)
      setRuns(res.data.runs)
    },
    [perfilInicial.id]
  )

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <div className="space-y-3 min-w-0">
      <Cabecera perfil={perfil} cargando={cargando} onRefrescar={() => cargar(true)} />

      {error && <div className={errorBox}>{error}</div>}

      {cargando && runs.length === 0 ? (
        <div className={`${cardShell} p-6 flex items-center justify-center gap-2`}>
          <Loader2 className="h-4 w-4 animate-spin text-white/40" />
          <span className="text-[12px] text-white/45">Cargando el historial…</span>
        </div>
      ) : runs.length === 0 ? (
        <div className={`${cardShell} p-5 text-center`}>
          <History className="h-5 w-5 text-white/20 mx-auto mb-2" />
          <p className="text-[12px] text-white/45">Este perfil todavía no se ha ejecutado nunca.</p>
          <p className="text-[11px] text-white/30 mt-1 leading-relaxed">
            El ciclo lo mirará en la próxima pasada. Para no esperar, lanza un simulacro desde la
            pestaña de al lado: hace lo mismo salvo el envío.
          </p>
        </div>
      ) : (
        <Tabla runs={runs} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Lo que pasa ahora                                                   */
/* ------------------------------------------------------------------ */

function Cabecera({
  perfil,
  cargando,
  onRefrescar,
}: {
  perfil: StockReadProfile
  cargando: boolean
  onRefrescar: () => void
}) {
  const auto = perfil.envio_automatico
  // Boolean() y no `!== null`: mientras no se haya lanzado la migración 121 la
  // columna no existe y llega `undefined`, que no es null — la pantalla se
  // quedaría diciendo «ejecutándose ahora» para siempre.
  const enMarcha = Boolean(perfil.running_since)

  return (
    <div className={`${cardShell} p-3 space-y-2.5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${
              auto
                ? 'bg-green-500/20 text-green-300 border-green-500/30'
                : 'bg-zinc-600/25 text-zinc-300 border-zinc-500/30'
            }`}
          >
            {auto ? 'ENVÍO AUTOMÁTICO ENCENDIDO' : 'ENVÍO AUTOMÁTICO APAGADO'}
          </span>
          {enMarcha && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-yellow-500/20 text-yellow-300 border-yellow-500/30 whitespace-nowrap">
              <Loader2 className="h-3 w-3 animate-spin" />
              EJECUTÁNDOSE AHORA
            </span>
          )}
        </div>

        <button type="button" onClick={onRefrescar} disabled={cargando} className={ghostButton}>
          {cargando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refrescar
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Dato
          etiqueta="Última pasada"
          valor={formatWhen(perfil.last_run_at)}
          title={formatExact(perfil.last_run_at)}
        />
        <Dato
          etiqueta="Última correcta"
          valor={formatWhen(perfil.last_ok_at)}
          title={formatExact(perfil.last_ok_at)}
        />
        <Dato etiqueta="Cadencia" valor={`cada ${perfil.cadencia_minutos} min`} />
        <Dato
          etiqueta="Líneas de referencia"
          valor={perfil.lineas_referencia === null ? 'sin fijar' : formatInt(perfil.lineas_referencia)}
        />
      </div>

      {!auto && (
        <div className={infoBox}>
          Con el envío apagado el ciclo hace todo el trabajo salvo el último paso: lee el fichero,
          lo cruza y lo contrasta contra el catálogo, y deja aquí lo que <em>habría</em> mandado. Es
          el estado en el que nace todo cliente, y sirve para verlo funcionar sin riesgo antes de
          encenderlo.
        </div>
      )}

      {perfil.lineas_referencia === null && (
        <div className={warnBox}>
          Todavía no hay «líneas de referencia», así que el freno de fichero a medias no puede
          saltar: no hay contra qué comparar. Se fija sola con la primera lectura que salga bien.
        </div>
      )}

      {/* El «se miró y no había nada nuevo» va arriba y no en la tabla porque
          esas pasadas NO escriben fila: sin esto, un perfil al día y un perfil
          que el cron ni siquiera está mirando se ven exactamente igual. */}
      {perfil.last_skip_reason && (
        <div className={infoBox}>
          <strong className="text-white/70">
            Se miró {formatWhen(perfil.last_skipped_at)}:
          </strong>{' '}
          {perfil.last_skip_reason} Las pasadas que no encuentran nada nuevo no dejan fila en el
          historial de abajo.
        </div>
      )}

      {perfil.last_error && (
        <div className={errorBox}>
          <strong>La última pasada falló:</strong> {perfil.last_error}
        </div>
      )}
    </div>
  )
}

function Dato({ etiqueta, valor, title }: { etiqueta: string; valor: string; title?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-wider text-white/35">{etiqueta}</p>
      <p className="text-[12px] text-white/75 truncate" title={title}>
        {valor}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Lo que pasó                                                         */
/* ------------------------------------------------------------------ */

function Tabla({ runs }: { runs: StockProfileRun[] }) {
  return (
    <div className={`${tableShell} max-h-[52vh]`}>
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-20 bg-[#0d0d0d]">
          <tr>
            <th className={TH}>Cuándo</th>
            <th className={TH}>Estado</th>
            <th className={TH}>Fichero</th>
            <th className={`${TH} text-right`}>Líneas</th>
            <th className={`${TH} text-right`}>Casados</th>
            <th className={`${TH} text-right`}>Cambios</th>
            <th className={`${TH} text-right`}>Enviados</th>
            <th className={TH}>Qué pasó</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <Fila key={run.id} run={run} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Fila({ run }: { run: StockProfileRun }) {
  const cambios = (run.cambios_stock ?? 0) + (run.cambios_precio ?? 0)
  // `?? null` para que una fila anterior a la migración 121 —donde la columna no
  // existe y llega undefined— se pinte como «no se envió» y no como cero envíos.
  const aceptados = run.enviados_ok ?? null

  return (
    <tr className="border-b border-white/[0.06] hover:bg-white/[0.03] transition-colors align-top">
      <td className="px-2 py-1.5 text-[11px] text-white/60 whitespace-nowrap tabular-nums">
        <span title={formatExact(run.created_at)}>{formatDayTime(run.created_at)}</span>
        {/* created_by null = lo lanzó el reloj. Distinguirlo importa: una
            ejecución a mano y una automática se explican de forma distinta. */}
        <span className="block text-[9px] text-white/30">
          {run.created_by ? 'a mano' : 'automática'}
        </span>
      </td>

      <td className="px-2 py-1.5 whitespace-nowrap">
        <span
          className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
            STOCK_RUN_STATE_COLORS[run.estado] ?? 'bg-zinc-600/25 text-zinc-300 border-zinc-500/30'
          }`}
        >
          {STOCK_RUN_STATE_LABELS[run.estado] ?? run.estado}
        </span>
      </td>

      <td className="px-2 py-1.5 text-[11px] text-white/55 max-w-[220px]">
        <span className="block truncate" title={run.fichero_nombre ?? ''}>
          {run.fichero_nombre ?? '—'}
        </span>
      </td>

      <td className="px-2 py-1.5 text-[11px] text-white/60 text-right tabular-nums">
        {formatInt(run.lineas_leidas)}
      </td>
      <td className="px-2 py-1.5 text-[11px] text-white/60 text-right tabular-nums">
        {formatInt(run.sku_casados)}
      </td>
      <td className="px-2 py-1.5 text-[11px] text-white/60 text-right tabular-nums">
        {cambios === 0 ? '—' : formatInt(cambios)}
        {(run.sku_a_cero ?? 0) > 0 && (
          <span className="block text-[9px] text-yellow-300">
            {formatInt(run.sku_a_cero)} a cero
          </span>
        )}
      </td>
      <td className="px-2 py-1.5 text-[11px] text-right tabular-nums">
        {aceptados === null ? (
          <span className="text-white/25">—</span>
        ) : (
          <>
            <span className="text-green-300">{formatInt(aceptados)}</span>
            {(run.enviados_error ?? 0) > 0 && (
              <span className="block text-[9px] text-red-300">
                {formatInt(run.enviados_error)} fallaron
              </span>
            )}
          </>
        )}
      </td>

      <td className="px-2 py-1.5 text-[11px] text-white/55 max-w-[380px] leading-relaxed">
        <Explicacion run={run} />
        {/*
          LOS AVISOS DE ESA EJECUCIÓN. No frenan, y por eso mismo son lo único
          que explica un resultado raro cuando nadie estaba delante: el espejo
          del catálogo vacío, el fichero de códigos de barras que no se pudo
          leer, una columna emparejada por parecido de nombre. Antes se
          redactaban, se enseñaban una vez en la pantalla del simulacro y se
          perdían — en el ciclo automático, siempre.
        */}
        {(run.avisos ?? []).length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {(run.avisos ?? []).map((a, i) => (
              <li key={i} className="flex items-start gap-1.5 text-yellow-300/75 text-[10px]">
                <span aria-hidden className="flex-shrink-0">
                  ▲
                </span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  )
}

/**
 * La columna que de verdad se lee.
 *
 * La frase del freno se guarda ya redactada en la propia fila, con sus números,
 * para que dentro de seis meses siga diciendo lo mismo aunque el texto del
 * código haya cambiado. Aquí se pinta tal cual: no se vuelve a componer.
 */
function Explicacion({ run }: { run: StockProfileRun }) {
  if (run.estado === 'frenado') {
    return (
      <span className="flex items-start gap-1.5 text-yellow-300">
        <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
        <span>
          <strong>{run.freno ? STOCK_BRAKE_LABELS[run.freno] : 'Freno'}.</strong>{' '}
          {run.freno_detalle} No se ha mandado nada.
        </span>
      </span>
    )
  }

  if (run.estado === 'error') {
    // whitespace-pre-line: el mensaje del conector de Drive va a varias líneas
    // a propósito, con el correo de la cuenta de servicio en la suya, porque ese
    // correo es EL dato que hay que copiar para arreglarlo.
    return (
      <span className="text-red-300 whitespace-pre-line">
        {run.error_message ?? 'Error sin detalle.'}
      </span>
    )
  }

  if (run.estado === 'simulacro') {
    return <span>Preparado y no enviado: el envío automático estaba apagado.</span>
  }

  if (run.estado === 'sin_cambios') {
    return <span className="text-white/40">Lo que traía el fichero ya estaba publicado.</span>
  }

  return (
    <span>
      {run.envio_abortado ? (
        <span className="text-red-300">{run.envio_abortado}</span>
      ) : (
        <span className="text-white/40">
          {formatInt(run.sku_suben)} suben · {formatInt(run.sku_bajan)} bajan ·{' '}
          {formatInt(run.sku_a_cero)} a cero
        </span>
      )}
    </span>
  )
}
