'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Link2, Loader2, Plug, RefreshCw, Unplug, UserPlus } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import {
  AMAZON_CONNECTION_STATUS_HINTS,
  AMAZON_MAX_AUTHORIZATIONS,
  AMAZON_REGIONS,
  connectionStatusLabel,
  daysUntilReauth,
  marketplaceLabel,
  needsReauthWarning,
  type AmazonClient,
  type AmazonConnection,
  type AmazonConnectionStatus,
} from '@/lib/types/amazon'
import { postAmazon, type AmazonMutation, type AmazonView } from '@/lib/amazon/client'
import { toast } from 'sonner'
import { AltaClienteDialog } from './AltaClienteDialog'
import { DesconectarDialog } from './DesconectarDialog'
import { EnlaceDialog } from './EnlaceDialog'
import {
  cardShell,
  dangerButton,
  errorBox,
  formatExact,
  formatInt,
  formatWhen,
  ghostButton,
  infoBox,
  primaryButton,
  statusPill,
  warnBox,
} from './shared'

/**
 * LA PANTALLA DE CONEXIONES DE AMAZON.
 *
 * Una tarjeta por CLIENTE, y dentro sus conexiones. No al revés, aunque la
 * tabla de la base se organice por conexión: quien mira esta pantalla piensa en
 * clientes («¿está Shoplamp conectado?»), no en autorizaciones. Un cliente
 * puede tener dos —Europa y Estados Unidos son regiones distintas y cada una
 * lleva su propia llave—, y eso se ve dentro de su tarjeta.
 *
 * LO QUE TIENE QUE QUEDAR CLARO DE UN VISTAZO, Y POR QUÉ:
 *
 *   EL ESTADO. Una conexión revocada no da ningún error visible: simplemente
 *   deja de refrescarse, y el catálogo se queda viejo sin que nadie se entere
 *   hasta que alguien manda un precio a una tienda que ya no nos escucha.
 *
 *   CUÁNDO SE REFRESCÓ POR ÚLTIMA VEZ. Es el dato que dice si lo que se está
 *   mirando es de hace seis minutos o de hace seis días.
 *
 *   CUÁNTAS AUTORIZACIONES QUEDAN. Con la aplicación sin publicar el tope son
 *   25, y es de los que se alcanzan sin previo aviso: la número 26 falla con el
 *   cliente delante.
 */

/**
 * Un momento en el tiempo, en relativo.
 *
 * Se pinta vacío hasta que monta el componente, y no es un capricho: este
 * componente también se renderiza en el servidor para el HTML inicial, y «hace
 * 3 minutos» calculado allí y calculado aquí no dan lo mismo. React avisaría de
 * un fallo de hidratación en cada tarjeta. Es el mismo motivo por el que
 * lib/use-is-mobile.ts arranca en false.
 */
function Momento({ iso }: { iso: string | null }) {
  const [texto, setTexto] = useState<string | null>(null)
  useEffect(() => setTexto(formatWhen(iso)), [iso])
  return (
    <span title={formatExact(iso)} className="tabular-nums">
      {texto ?? '…'}
    </span>
  )
}

interface Props {
  /**
   * El estado lo lleva AmazonBoard y no este componente.
   *
   * Tiene que ser el mismo que usa el catálogo: desconectar una cuenta desde
   * aquí tiene que quitarla del selector de clientes de arriba en el acto, y
   * dar de alta a uno tiene que hacerlo aparecer. Con un estado propio, las dos
   * mitades de la pantalla contarían cosas distintas hasta recargar.
   */
  data: AmazonView
  onData: (view: AmazonView) => void
  /** Qué variable de entorno falta, si falta alguna. Solo el nombre, nunca el valor */
  configError: string | null
  /**
   * ¿Sigue la aplicación en BORRADOR? Lo decide appIsDraft() en el servidor.
   *
   * El tope de 25 cuentas SOLO existe mientras no esté publicada, así que los
   * textos que hablan de él van condicionados a esto. Antes se enseñaban
   * siempre y el día que se publicara habrían pasado a mentir, incluido un
   * aviso bloqueante al llegar a 25.
   */
  appDraft: boolean
}

export function ConexionesBoard({ data, onData, configError, appDraft }: Props) {
  const [alta, setAlta] = useState(false)
  const [enlace, setEnlace] = useState<{ clientId?: string } | null>(null)
  const [desconectar, setDesconectar] = useState<AmazonConnection | null>(null)
  /** Qué conexión se está reintentando ahora mismo, para el spinner del botón */
  const [reintentando, setReintentando] = useState<string | null>(null)

  /**
   * VUELVE A PROBAR UNA CONEXIÓN MARCADA Y, SI AMAZON RESPONDE, LA REACTIVA.
   *
   * Es el único camino de vuelta que hay. Una conexión que cae en «Con
   * problemas» —basta un 403 pasajero de Amazon— dejaba de refrescarse, el
   * botón de refrescar contestaba 409 y enviar cambios fallaba, y lo único que
   * ofrecía esta tarjeta era «Desconectar»: o sea destruir la llave y pedirle
   * al cliente que volviera a autorizar, justo lo que /callback le había dicho
   * que no haría falta.
   */
  async function reintentar(conn: AmazonConnection) {
    setReintentando(conn.id)
    const res = await postAmazon<AmazonMutation & { retried?: boolean }>(
      `/api/amazon/connections/${conn.id}/retry`
    )
    setReintentando(null)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    onData(res.data)
    // El servidor NO reactiva a ciegas: si Amazon no contesta, la conexión se
    // queda como estaba y el motivo viene en el mensaje. Por eso el aviso
    // distingue los dos casos en vez de decir siempre «hecho».
    if (res.data.retried) toast.success(res.data.message ?? 'Conexión recuperada')
    else toast.warning(res.data.message ?? 'Amazon sigue sin responder a esta conexión')
  }

  /** Las conexiones de cada cliente, en el orden en el que se pintan */
  const porCliente = useMemo(() => {
    const mapa = new Map<string, AmazonConnection[]>()
    for (const conn of data.connections) {
      const lista = mapa.get(conn.client_id)
      if (lista) lista.push(conn)
      else mapa.set(conn.client_id, [conn])
    }
    return mapa
  }, [data.connections])

  const clientesPorId = useMemo(
    () => new Map(data.clients.map((c) => [c.id, c])),
    [data.clients]
  )

  const sinConfigurar = configError !== null

  return (
    <div className="min-w-0 space-y-4">
      {/* ---- Botones de alta y de conexión ---- */}
      {/* El recuento de autorizaciones lo pinta AmazonBoard, que está siempre
          visible: es un tope que se alcanza sin previo aviso y tiene que verse
          también desde el catálogo, no solo desde esta pestaña. */}
      <div className={`${cardShell} p-3 flex flex-wrap items-center justify-between gap-3`}>
        <p className="text-[11px] text-white/35 leading-relaxed min-w-0 max-w-[420px]">
          {appDraft
            ? `Mientras nuestra aplicación no esté publicada en el Appstore de Amazon, el tope son ${AMAZON_MAX_AUTHORIZATIONS} cuentas conectadas.`
            : 'Nuestra aplicación está publicada en el Appstore de Amazon: no hay tope de cuentas conectadas.'}
        </p>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button type="button" onClick={() => setAlta(true)} className={ghostButton}>
            <UserPlus className="h-3.5 w-3.5" />
            Añadir cliente
          </button>
          <button
            type="button"
            onClick={() => setEnlace({})}
            disabled={sinConfigurar || data.clients.length === 0}
            title={
              sinConfigurar
                ? 'Falta configurar el servidor'
                : data.clients.length === 0
                  ? 'Da de alta un cliente primero'
                  : undefined
            }
            className={primaryButton}
          >
            <Link2 className="h-3.5 w-3.5" />
            Conectar cliente
          </button>
        </div>
      </div>

      {appDraft && data.remainingAuthorizations === 0 && (
        <div className={warnBox}>
          No quedan autorizaciones libres. Para conectar a otro cliente hay que publicar la
          aplicación en el Appstore de Amazon.{' '}
          {/* Desconectar desde aquí NO libera nada del lado de Amazon: borra
              nuestra fila, pero la autorización sigue concedida hasta que el
              vendedor nos quite el acceso desde su Seller Central. Decir lo
              contrario lleva a un estado en el que aquí figuran 20 y Amazon
              rechaza la 21 con CONSENT_LIMIT_REACHED. */}
          Ojo: desconectar una cuenta desde el ERP no libera su autorización en Amazon — eso solo lo
          hace el cliente, retirándonos el acceso desde su Seller Central.
        </div>
      )}

      {configError && (
        <div className={errorBox}>
          Hasta que el servidor esté configurado se pueden dar de alta clientes, pero no generar
          enlaces de autorización.
        </div>
      )}

      {/* ---- Las tarjetas ---- */}
      {data.clients.length === 0 ? (
        <div className={`${cardShell} p-8 text-center`}>
          <Plug className="h-6 w-6 text-white/20 mx-auto mb-3" />
          <p className="text-[13px] text-white/45">Todavía no hay ningún cliente dado de alta.</p>
          <p className="text-[12px] text-white/30 mt-1">
            Empieza por añadir uno y luego genera su enlace de autorización.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 min-w-0">
          {data.clients.map((cliente) => (
            <TarjetaCliente
              key={cliente.id}
              cliente={cliente}
              conexiones={porCliente.get(cliente.id) ?? []}
              listingCounts={data.listingCounts}
              submissionCounts={data.submissionCounts}
              puedeConectar={!sinConfigurar}
              reintentando={reintentando}
              onConectar={() => setEnlace({ clientId: cliente.id })}
              onDesconectar={setDesconectar}
              onReintentar={reintentar}
            />
          ))}
        </div>
      )}

      <AnimatePresence>
        {alta && (
          <AltaClienteDialog
            key="alta"
            onClose={() => setAlta(false)}
            onDone={(view, clientId) => {
              onData(view)
              // Encadenado a propósito: quien acaba de dar de alta a un cliente
              // lo ha hecho para conectarlo, no para verlo en una lista.
              if (clientId && !sinConfigurar) setEnlace({ clientId })
            }}
          />
        )}

        {enlace && (
          <EnlaceDialog
            key="enlace"
            clients={data.clients}
            presetClientId={enlace.clientId}
            onClose={() => setEnlace(null)}
          />
        )}

        {desconectar && (
          <DesconectarDialog
            key="desconectar"
            connection={desconectar}
            clientName={clientesPorId.get(desconectar.client_id)?.name ?? 'este cliente'}
            listings={data.listingCounts[desconectar.id] ?? 0}
            submissions={data.submissionCounts[desconectar.id] ?? 0}
            onClose={() => setDesconectar(null)}
            onDone={onData}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function TarjetaCliente({
  cliente,
  conexiones,
  listingCounts,
  submissionCounts,
  puedeConectar,
  reintentando,
  onConectar,
  onDesconectar,
  onReintentar,
}: {
  cliente: AmazonClient
  conexiones: AmazonConnection[]
  listingCounts: Record<string, number>
  submissionCounts: Record<string, number>
  puedeConectar: boolean
  reintentando: string | null
  onConectar: () => void
  onDesconectar: (conn: AmazonConnection) => void
  onReintentar: (conn: AmazonConnection) => void
}) {
  return (
    <div className={`${cardShell} p-3 min-w-0 ${cliente.is_active ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-3 mb-2.5 min-w-0">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-white truncate">{cliente.name}</h2>
          <p className="text-[11px] text-white/30 truncate">{cliente.slug}</p>
        </div>
        <button
          type="button"
          onClick={onConectar}
          disabled={!puedeConectar}
          className={`${ghostButton} flex-shrink-0`}
        >
          <Link2 className="h-3.5 w-3.5" />
          {conexiones.length === 0 ? 'Conectar' : 'Otra región'}
        </button>
      </div>

      {conexiones.length === 0 ? (
        <div className={infoBox}>
          Sin ninguna cuenta de Amazon conectada. Genera su enlace y mándaselo: lo abre él desde su
          Seller Central y con eso queda conectado.
        </div>
      ) : (
        <div className="space-y-2">
          {conexiones.map((conn) => (
            <FilaConexion
              key={conn.id}
              conn={conn}
              listings={listingCounts[conn.id] ?? 0}
              submissions={submissionCounts[conn.id] ?? 0}
              reintentando={reintentando === conn.id}
              onDesconectar={() => onDesconectar(conn)}
              onReintentar={() => onReintentar(conn)}
            />
          ))}
        </div>
      )}

      {cliente.notes && (
        <p className="text-[11px] text-white/30 mt-2 leading-relaxed">{cliente.notes}</p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function FilaConexion({
  conn,
  listings,
  submissions,
  reintentando,
  onDesconectar,
  onReintentar,
}: {
  conn: AmazonConnection
  listings: number
  submissions: number
  reintentando: boolean
  onDesconectar: () => void
  onReintentar: () => void
}) {
  const estado = conn.status as AmazonConnectionStatus
  // Una conexión desactivada a mano se lee como rota, aunque su `status` diga
  // otra cosa: lo que importa es si se está usando.
  const viva = conn.is_active && estado === 'activa'
  const dias = daysUntilReauth(conn.authorized_at)
  const avisaRenovacion = viva && needsReauthWarning(conn.authorized_at)

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5 min-w-0">
      <div className="flex items-start justify-between gap-2 mb-1.5 min-w-0">
        <div className="min-w-0">
          <p className="text-[12px] text-white/85 font-medium truncate">{conn.name}</p>
          <p className="text-[11px] text-white/30 truncate">
            {AMAZON_REGIONS[conn.region]?.label ?? conn.region} · {conn.selling_partner_id}
          </p>
        </div>
        <span
          className={`${statusPill(estado)} flex-shrink-0`}
          title={AMAZON_CONNECTION_STATUS_HINTS[estado] ?? undefined}
        >
          {connectionStatusLabel(conn.status)}
        </span>
      </div>

      {/* Los países. Marcar el que abre por defecto no es decorativo: es sobre
          el que se van a escribir los precios si nadie cambia nada. */}
      {conn.marketplace_ids.length > 0 ? (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {conn.marketplace_ids.map((id) => {
            const porDefecto = id === conn.default_marketplace_id
            return (
              <span
                key={id}
                title={porDefecto ? 'Con este se abre el catálogo' : undefined}
                className={`text-[10px] px-1.5 py-0.5 rounded-md border whitespace-nowrap ${
                  porDefecto
                    ? 'border-[#FF6600]/40 bg-[#FF6600]/[0.08] text-white/85'
                    : 'border-white/10 bg-white/[0.03] text-white/50'
                }`}
              >
                {marketplaceLabel(id)}
              </span>
            )
          })}
        </div>
      ) : (
        <p className="text-[11px] text-white/30 mb-1.5">
          Todavía no sabemos en qué países vende. Se rellena en el próximo refresco.
        </p>
      )}

      <p className="text-[11px] text-white/40">
        {formatInt(listings)} {listings === 1 ? 'referencia' : 'referencias'} · refrescado{' '}
        <Momento iso={conn.last_sync_at} />
        {submissions > 0 && (
          <span className="text-white/30">
            {' '}
            · {formatInt(submissions)} {submissions === 1 ? 'cambio enviado' : 'cambios enviados'}
          </span>
        )}
      </p>

      {conn.status_detail && !viva && (
        <p className="text-[11px] text-yellow-300 mt-1.5 leading-relaxed">{conn.status_detail}</p>
      )}

      {conn.last_sync_error && (
        <p className="text-[11px] text-red-300 mt-1.5 leading-relaxed flex gap-1.5">
          <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-px" />
          <span>Último refresco: {conn.last_sync_error}</span>
        </p>
      )}

      {/* El barrido se quedó corto. Se pinta AQUÍ y no solo en el catálogo
          porque el recuento de arriba («N referencias») es justo el número que
          se lee como si fuera el total, y no lo es. */}
      {conn.last_sync_truncated && (
        <p className="text-[11px] text-yellow-300 mt-1.5 leading-relaxed flex gap-1.5">
          <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-px" />
          <span>
            {conn.last_sync_declared
              ? `Amazon dice que hay ${formatInt(conn.last_sync_declared)} referencias y por esta vía solo se pueden leer 1.000: lo que se ve no es todo el catálogo.`
              : 'Este catálogo pasa de 1.000 referencias y no se puede leer entero por esta vía: lo que se ve no es todo.'}
          </span>
        </p>
      )}

      {avisaRenovacion && (
        <p className="text-[11px] text-yellow-300 mt-1.5 leading-relaxed">
          {dias > 0
            ? `La autorización caduca en ${dias} ${dias === 1 ? 'día' : 'días'}. Amazon obliga a renovarla cada año: pídele al cliente que vuelva a autorizar antes de esa fecha.`
            : 'La autorización ya ha pasado del año que dura. Hay que pedirle al cliente que vuelva a autorizar.'}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        {/* «Reintentar conexión» solo cuando hay algo que reintentar: la
            conexión está marcada, o está viva pero el último refresco falló.
            Un botón siempre visible que casi nunca hace falta es ruido; este
            aparece exactamente cuando es la única salida que hay. */}
        {(!viva || conn.last_sync_error) && (
          <button
            type="button"
            onClick={onReintentar}
            disabled={reintentando}
            title="Vuelve a preguntarle a Amazon. Si responde, la cuenta se reactiva sin que el cliente tenga que hacer nada"
            className={ghostButton}
          >
            {reintentando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Reintentar conexión
          </button>
        )}
        <button type="button" onClick={onDesconectar} className={dangerButton}>
          <Unplug className="h-3.5 w-3.5" />
          Desconectar
        </button>
      </div>
    </div>
  )
}
