'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, RotateCcw, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  AMAZON_FIELD_LABELS,
  marketplaceLabel,
  pendingChangeKey,
  type AmazonPendingChange,
} from '@/lib/types/amazon'
import {
  MAX_CHANGES_PER_REQUEST,
  formatCampo,
  isBigJump,
  type CatalogConflict,
} from '@/lib/amazon/catalogo'
import { postAmazon, type ApiResult, type SendChangesResponse } from '@/lib/amazon/client'
import type { SentChange } from '@/lib/amazon/data'
import { Dialogo } from './Dialogo'
import { dangerButton, errorBox, ghostButton, infoBox, primaryButton, warnBox } from './shared'

/**
 * LA PANTALLA DE «ESTO ES LO QUE VA A SALIR» (decisión C).
 *
 * Es el último sitio donde se puede parar algo, y por eso enseña la lista
 * ENTERA —no un resumen, no un contador— con las cuatro cosas que hacen falta
 * para reconocer un error: qué SKU, qué campo, de qué valor y a qué valor. Nada
 * llega aquí por teclear en una celda; llega por pulsar «Enviar cambios», y de
 * aquí solo sale por pulsar otra vez.
 *
 * DOS AVISOS QUE NO SON DECORATIVOS:
 *
 *   EL SALTO GORDO. Un cambio que multiplica o divide por tres o más sale
 *   marcado. Persigue el error clásico del punto decimal —1499 por 14,99, que
 *   es exactamente un factor 100— y no bloquea, porque hay rebajas de verdad.
 *
 *   EL CONFLICTO. Si desde que se tecleó el valor Amazon ha cambiado el suyo,
 *   se dice con los dos números delante. Es la decisión E: nadie decide por la
 *   persona, se le pone delante lo único que no podía saber.
 */

type Fase = 'revisando' | 'enviando' | 'hecho'

export function EnviarCambiosDialog({
  connectionId,
  clientName,
  changes,
  conflicts,
  onClose,
  onSent,
}: {
  connectionId: string
  clientName: string
  changes: AmazonPendingChange[]
  conflicts: CatalogConflict[]
  onClose: () => void
  /**
   * Los que Amazon ha aceptado, para que la tabla los quite de pendientes. Los
   * que fallan NO se tocan: se quedan tecleados, que es lo que permite
   * reintentar sin volver a escribirlo todo.
   */
  onSent: (result: { accepted: string[]; response: SendChangesResponse }) => void
}) {
  const [fase, setFase] = useState<Fase>('revisando')
  const [enviados, setEnviados] = useState(0)
  const [resultados, setResultados] = useState<SentChange[]>([])
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)

  /** Los que se van a mandar en esta pasada. Al reintentar, solo los que fallaron */
  const [cola, setCola] = useState<AmazonPendingChange[]>(changes)

  /**
   * Los que NI SE INTENTARON porque el envío se cortó antes de llegar a ellos.
   *
   * No son lo mismo que los fallidos y la diferencia se notaba: `fallidos` solo
   * recoge los que volvieron con un fallo POR ÍTEM, así que con 120 cambios y
   * un corte en el segundo tramo el botón decía «Reintentar los 3 que fallaron»
   * cuando en realidad había 3 rechazados por Amazon y 70 que no habían salido
   * siquiera — y al pulsarlo, esos 70 desaparecían de este diálogo. Siguen
   * tecleados en la tabla, pero eso no es lo que la pantalla estaba diciendo.
   */
  const [sinIntentar, setSinIntentar] = useState<AmazonPendingChange[]>([])

  /**
   * El envío se cortó porque la CONEXIÓN dejó de valer (acceso retirado, falta
   * de permisos), no porque fallara un cambio concreto.
   *
   * Cuando pasa esto no se ofrece reintentar: volver a dispararlo todo contra
   * una conexión revocada son otros trescientos canjes de token fallidos y
   * trescientas filas de error idénticas.
   */
  const [cortadoPorConexion, setCortadoPorConexion] = useState(false)

  const conflictosPorClave = useMemo(
    () => new Map(conflicts.map((c) => [c.key, c])),
    [conflicts]
  )

  const porMarketplace = useMemo(() => {
    const mapa = new Map<string, AmazonPendingChange[]>()
    for (const c of cola) {
      const lista = mapa.get(c.marketplaceId)
      if (lista) lista.push(c)
      else mapa.set(c.marketplaceId, [c])
    }
    return mapa
  }, [cola])

  const fallidos = useMemo(() => resultados.filter((r) => r.status !== 'aceptado'), [resultados])
  const aceptados = useMemo(() => resultados.filter((r) => r.status === 'aceptado'), [resultados])

  async function enviar() {
    setFase('enviando')
    setEnviados(0)
    setResultados([])
    setErrorGeneral(null)
    setSinIntentar([])
    setCortadoPorConexion(false)

    const acumulado: SentChange[] = []
    const aceptadasClaves: string[] = []
    let ultima: SendChangesResponse | null = null
    // El primer tramo lo genera el servidor; los siguientes lo reciben, para
    // que todo el lote quede agrupado bajo el mismo identificador en el
    // registro aunque hayan sido seis peticiones.
    let batchId: string | null = null

    for (let i = 0; i < cola.length; i += MAX_CHANGES_PER_REQUEST) {
      const tramo = cola.slice(i, i + MAX_CHANGES_PER_REQUEST)
      // Se copia a una constante antes de la llamada. Sin esto, TypeScript ve
      // que el tipo de `batchId` dentro del bucle depende de la respuesta y que
      // la respuesta depende de `batchId`, y se planta con un ciclo.
      const lote: string | null = batchId

      // El tipo va escrito y no inferido por la misma razón que la constante de
      // arriba: dentro del bucle, inferirlo se muerde la cola.
      const res: ApiResult<SendChangesResponse> = await postAmazon<SendChangesResponse>(
        '/api/amazon/changes',
        {
          connectionId,
          batchId: lote,
          changes: tramo.map((c) => ({
            sku: c.sku,
            marketplaceId: c.marketplaceId,
            field: c.field,
            newValue: c.newValue,
          })),
        }
      )

      if (!res.ok) {
        // Se corta aquí y NO se sigue con los tramos siguientes. Lo que ya salió
        // se queda enviado y en pantalla; insistir a ciegas después de un fallo
        // de servidor solo consigue no saber qué llegó y qué no.
        //
        // Los de ESTE tramo y los de todos los siguientes quedan sin intentar, y
        // se guardan para que el botón de reintentar los recoja: si no, se
        // caerían de este diálogo sin que nadie los cuente.
        setErrorGeneral(res.error)
        setSinIntentar(cola.slice(i))
        break
      }

      // El identificador que ha generado el servidor en el primer tramo viaja a
      // los siguientes: sin esto cada tramo quedaría como un lote suelto en el
      // registro y lo que salió junto no se podría reconocer junto.
      batchId = res.data.batchId
      ultima = res.data
      acumulado.push(...res.data.results)
      for (const r of res.data.results) {
        if (r.status === 'aceptado') {
          aceptadasClaves.push(
            pendingChangeKey({ marketplaceId: r.marketplaceId, sku: r.sku, field: r.field })
          )
        }
      }

      setResultados([...acumulado])
      setEnviados(Math.min(i + tramo.length, cola.length))

      // El servidor ha cortado el lote porque la conexión dejó de valer (acceso
      // retirado, permisos). Los de este tramo ya vienen marcados dentro de
      // `results`; los de los tramos siguientes ni se piden.
      if (res.data.abortReason) {
        setErrorGeneral(res.data.abortReason)
        setCortadoPorConexion(true)
        setSinIntentar(cola.slice(i + tramo.length))
        break
      }
    }

    setFase('hecho')

    if (ultima) {
      onSent({ accepted: aceptadasClaves, response: { ...ultima, results: acumulado } })
      const fallos = acumulado.length - aceptadasClaves.length
      if (fallos === 0) {
        toast.success(
          `${aceptadasClaves.length} ${aceptadasClaves.length === 1 ? 'cambio enviado' : 'cambios enviados'} a Amazon`
        )
      } else {
        toast.warning(`${fallos} de ${acumulado.length} no han salido. Mira el detalle`)
      }
    }
  }

  /**
   * Vuelve a intentar lo que no ha quedado enviado, sin teclear nada otra vez.
   *
   * SON DOS CONJUNTOS Y HAY QUE JUNTARLOS: los que Amazon rechazó uno a uno
   * (`fallidos`) y los que no llegaron a salir porque el envío se cortó antes
   * (`sinIntentar`). Con solo los primeros, un corte en mitad del lote dejaba
   * fuera del reintento a todos los tramos que no se habían pedido.
   */
  const pendientesDeReintento = useMemo(() => {
    const claves = new Set(
      fallidos.map((r) =>
        pendingChangeKey({ marketplaceId: r.marketplaceId, sku: r.sku, field: r.field })
      )
    )
    for (const c of sinIntentar) claves.add(pendingChangeKey(c))
    return changes.filter((c) => claves.has(pendingChangeKey(c)))
  }, [fallidos, sinIntentar, changes])

  function reintentar() {
    if (pendientesDeReintento.length === 0) return
    setCola(pendientesDeReintento)
    setResultados([])
    setEnviados(0)
    setErrorGeneral(null)
    setSinIntentar([])
    setCortadoPorConexion(false)
    setFase('revisando')
  }

  const total = cola.length
  const progreso = total === 0 ? 0 : Math.round((enviados / total) * 100)

  return (
    <Dialogo
      title={fase === 'hecho' ? 'Resultado del envío' : 'Esto es lo que va a salir'}
      subtitle={
        fase === 'hecho'
          ? `${clientName} · ${aceptados.length} de ${resultados.length} aceptados`
          : `${clientName} · ${total} ${total === 1 ? 'cambio' : 'cambios'} hacia Amazon`
      }
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      {fase === 'revisando' && (
        <div className="space-y-3">
          <div className={infoBox}>
            Se manda a la tienda de <span className="text-white/75">{clientName}</span>. Amazon
            acepta el cambio en el momento pero lo aplica después: hasta el siguiente refresco
            aparecerá como «enviado», no como «confirmado».
          </div>

          {conflicts.length > 0 && (
            <div className={warnBox}>
              {conflicts.length === 1
                ? 'Un cambio se escribió mirando un valor que en Amazon ya no está.'
                : `${conflicts.length} cambios se escribieron mirando valores que en Amazon ya no están.`}{' '}
              Van marcados abajo con lo que hay ahora.
            </div>
          )}

          <div className="max-h-[46vh] overflow-y-auto min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.02]">
            {Array.from(porMarketplace.entries()).map(([marketplaceId, lista]) => (
              <div key={marketplaceId} className="min-w-0">
                {/* El país va SIEMPRE por delante, aunque solo haya uno: una
                    conexión europea cubre cuatro tiendas y «14,99» sin decir
                    dónde no es un dato completo. */}
                <div className="sticky top-0 px-2.5 py-1.5 bg-[#0d0d0d] border-b border-white/[0.07] flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-white/70">
                    {marketplaceLabel(marketplaceId)}
                  </span>
                  <span className="text-[10px] text-white/35 tabular-nums">
                    {lista.length} {lista.length === 1 ? 'cambio' : 'cambios'}
                  </span>
                </div>

                {lista.map((c) => (
                  <LineaRevision
                    key={pendingChangeKey(c)}
                    change={c}
                    conflict={conflictosPorClave.get(pendingChangeKey(c)) ?? null}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={ghostButton}>
              Cancelar
            </button>
            <button type="button" onClick={enviar} disabled={total === 0} className={primaryButton}>
              <Send className="h-3.5 w-3.5" />
              Enviar {total} {total === 1 ? 'cambio' : 'cambios'}
            </button>
          </div>
        </div>
      )}

      {fase === 'enviando' && (
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2 text-[12px] text-white/70">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FF6600]" />
            Enviando a Amazon…
          </div>

          {/* La barra es de verdad: avanza cuando un tramo ha vuelto con
              respuesta, no con un temporizador. Amazon limita a cinco cambios
              por segundo y por vendedor, así que esto tarda lo que tarda. */}
          <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#FF7A1F] to-[#FF6600] transition-[width] duration-300"
              style={{ width: `${progreso}%` }}
            />
          </div>

          <p className="text-[11px] text-white/45 tabular-nums">
            {enviados} de {total}
          </p>
          {/* Se puede cerrar: el envío sigue en marcha aunque la ventana no
              esté delante, y el resultado de cada uno queda en el historial.
              Un botón de cerrar que no cierra enseña a desconfiar de los
              botones. */}
          <p className="text-[11px] text-white/30 leading-relaxed">
            Puedes cerrar esta ventana: el envío sigue y todo queda registrado en el historial.
          </p>
        </div>
      )}

      {fase === 'hecho' && (
        <div className="space-y-3">
          {errorGeneral && (
            <div className={errorBox}>
              {/* El texto depende de si llegó a salir algo. Antes decía siempre
                  «lo que aparece abajo sí salió» incluso cuando el corte había
                  sido en el primer tramo y la caja de abajo estaba vacía. */}
              {resultados.length === 0
                ? `No ha salido ninguno: ${errorGeneral}`
                : `El envío se ha cortado: ${errorGeneral}`}{' '}
              {sinIntentar.length > 0 && (
                <>
                  {sinIntentar.length === 1
                    ? 'Hay 1 cambio que ni siquiera se ha intentado.'
                    : `Hay ${sinIntentar.length} cambios que ni siquiera se han intentado.`}{' '}
                </>
              )}
              {cortadoPorConexion &&
                'Esta cuenta ha quedado marcada como no conectada: reintentar no serviría de nada hasta que el cliente vuelva a autorizar.'}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Resumen
              icono={<Check className="h-3 w-3" />}
              texto={`${aceptados.length} ${aceptados.length === 1 ? 'aceptado' : 'aceptados'}`}
              tono="ok"
            />
            {fallidos.length > 0 && (
              <Resumen
                icono={<X className="h-3 w-3" />}
                texto={`${fallidos.length} sin salir`}
                tono="mal"
              />
            )}
            {sinIntentar.length > 0 && (
              <Resumen
                icono={<X className="h-3 w-3" />}
                texto={`${sinIntentar.length} sin intentar`}
                tono="mal"
              />
            )}
          </div>

          <div className="max-h-[44vh] overflow-y-auto min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.02] divide-y divide-white/[0.04]">
            {resultados.map((r) => (
              <LineaResultado
                key={`${r.marketplaceId}|${r.sku}|${r.field}`}
                result={r}
              />
            ))}
          </div>

          {pendientesDeReintento.length > 0 && (
            <div className={infoBox}>
              Los que no han salido siguen tecleados en la tabla: puedes corregirlos y volver a
              enviarlos{cortadoPorConexion ? ' cuando la cuenta vuelva a estar conectada' : ', o reintentarlos tal cual desde aquí'}.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            {/* Sin botón de reintentar cuando lo que ha fallado es la CONEXIÓN:
                volver a dispararlo todo contra una cuenta que nos ha retirado el
                acceso son otros trescientos errores idénticos. */}
            {pendientesDeReintento.length > 0 && !cortadoPorConexion && (
              <button type="button" onClick={reintentar} className={dangerButton}>
                <RotateCcw className="h-3.5 w-3.5" />
                Reintentar {pendientesDeReintento.length}
              </button>
            )}
            <button type="button" onClick={onClose} className={primaryButton}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */

function LineaRevision({
  change,
  conflict,
}: {
  change: AmazonPendingChange
  conflict: CatalogConflict | null
}) {
  const salto = isBigJump(change.previousValue, change.newValue)

  return (
    <div className="px-2.5 py-1.5 border-b border-white/[0.04] min-w-0">
      <div className="flex items-baseline gap-2 min-w-0">
        <span
          title={change.sku}
          className="text-[12px] text-white/85 tabular-nums truncate flex-1 min-w-0"
        >
          {change.sku}
        </span>
        <span className="text-[10px] text-white/40 uppercase tracking-wider flex-shrink-0">
          {AMAZON_FIELD_LABELS[change.field]}
        </span>
        <span className="text-[12px] tabular-nums flex-shrink-0 whitespace-nowrap">
          <span className="text-white/40 line-through">
            {formatCampo(change.field, change.previousValue, change.currency)}
          </span>
          <span className="text-white/25 mx-1">→</span>
          <span className="text-white font-semibold">
            {formatCampo(change.field, change.newValue, change.currency)}
          </span>
        </span>
      </div>

      {salto && (
        <p className="text-[10px] text-yellow-300 mt-0.5 flex items-start gap-1 leading-relaxed">
          <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0 mt-[3px]" />
          Es un salto grande. Comprueba que la coma está donde tiene que estar.
        </p>
      )}

      {conflict && (
        <p className="text-[10px] text-yellow-300 mt-0.5 leading-relaxed">
          Cuando lo escribiste ponía{' '}
          {formatCampo(conflict.field, conflict.seenValue, change.currency)} y ahora en Amazon pone{' '}
          {formatCampo(conflict.field, conflict.currentValue, change.currency)}.
        </p>
      )}
    </div>
  )
}

function LineaResultado({ result }: { result: SentChange }) {
  const ok = result.status === 'aceptado'

  return (
    <div className="px-2.5 py-1.5 min-w-0">
      <div className="flex items-baseline gap-2 min-w-0">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${ok ? 'bg-green-400' : 'bg-red-400'}`}
        />
        <span
          title={result.sku}
          className="text-[12px] text-white/85 tabular-nums truncate flex-1 min-w-0"
        >
          {result.sku}
        </span>
        <span className="text-[10px] text-white/40 uppercase tracking-wider flex-shrink-0">
          {AMAZON_FIELD_LABELS[result.field]}
        </span>
        {/* Con la divisa, igual que en la lista de revisión. Sin ella, la
            pantalla que CONFIRMA lo que se ha mandado decía «14,99» tres
            segundos después de que la de revisión dijera «14,99 €» — y con un
            cliente que vende en euros y en dólares eso no es un dato completo. */}
        <span className="text-[12px] tabular-nums text-white/75 flex-shrink-0">
          {formatCampo(result.field, result.newValue, result.currency)}
        </span>
      </div>

      {/* El motivo en cristiano, no un código. Viene ya traducido de
          lib/amazon/errors.ts y sin credenciales dentro. */}
      {!ok && result.message && (
        <p className="text-[10px] text-red-300 mt-0.5 leading-relaxed">{result.message}</p>
      )}
      {ok && result.message && (
        <p className="text-[10px] text-yellow-300 mt-0.5 leading-relaxed">{result.message}</p>
      )}
    </div>
  )
}

function Resumen({
  icono,
  texto,
  tono,
}: {
  icono: React.ReactNode
  texto: string
  tono: 'ok' | 'mal'
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg border ${
        tono === 'ok'
          ? 'border-green-500/30 bg-green-500/20 text-green-300'
          : 'border-red-500/30 bg-red-500/[0.08] text-red-300'
      }`}
    >
      {icono}
      {texto}
    </span>
  )
}
