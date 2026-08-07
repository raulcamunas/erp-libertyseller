'use client'

import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight, Plug, Settings2 } from 'lucide-react'
import {
  AMAZON_MAX_AUTHORIZATIONS,
  AMAZON_REGIONS,
  connectionStatusLabel,
  marketplaceLabel,
  needsReauthWarning,
  type AmazonConnection,
  type AmazonConnectionStatus,
} from '@/lib/types/amazon'
import type { AmazonView } from '@/lib/amazon/client'
import { useIsMobile } from '@/lib/use-is-mobile'
import { CatalogoPanel } from './CatalogoPanel'
import { ConexionesBoard } from './ConexionesBoard'
import { Dialogo } from './Dialogo'
import {
  cardShell,
  errorBox,
  formatInt,
  ghostButton,
  primaryButton,
  statusPill,
} from './shared'

/**
 * LA PANTALLA DEL MÓDULO.
 *
 * Se entra por los BOTONES DE LOS CLIENTES, que es literalmente lo que se pidió
 * («cuando clique en la app, tienen que aparecer botones de los clientes que me
 * han dado acceso»). Un botón por CONEXIÓN y no por cliente: un mismo cliente
 * puede tener dos autorizaciones —Europa y Estados Unidos son regiones
 * distintas, con su propia llave— y cada una tiene su catálogo. Enseñar un solo
 * botón por cliente obligaría a elegir la región después, en un sitio donde ya
 * se está mirando una tabla de precios.
 *
 * Y la gestión de accesos —dar de alta, generar enlaces, desconectar— se aparta
 * detrás de un botón. Es lo que se hace una vez por cliente; el catálogo es lo
 * que se hace todos los días.
 */
export function AmazonBoard({
  initialData,
  configError,
  appDraft,
}: {
  initialData: AmazonView
  /** Qué variable de entorno falta, si falta alguna. Solo el nombre, nunca el valor */
  configError: string | null
  /**
   * ¿Sigue la aplicación en BORRADOR en el portal de Amazon?
   *
   * Lo decide appIsDraft() en el servidor. De esto depende que la pantalla
   * hable del tope de 25 autorizaciones, que SOLO existe mientras la
   * aplicación no esté listada en el Appstore. Antes el tope se enseñaba
   * siempre: el día que se publicara y se pusiera AMAZON_APP_DRAFT=false, la
   * cabecera habría seguido diciendo «quedan 3 de 25» y al llegar a 25 habría
   * saltado un aviso bloqueante que ya no sería verdad.
   */
  appDraft: boolean
}) {
  const [data, setData] = useState<AmazonView>(initialData)
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [gestionando, setGestionando] = useState(false)
  /**
   * Lo que se iba a hacer cuando se descubrió que había cambios sin enviar.
   *
   * Se guarda la ACCIÓN y no el destino porque hay dos formas de perderlos —
   * cambiar de cliente y saltar a la pantalla de conexiones— y las dos tienen
   * que pasar por la misma pregunta. Con un destino, la segunda se colaba: el
   * panel del catálogo se desmontaba y las ediciones desaparecían sin decir
   * nada.
   */
  const [salidaBloqueada, setSalidaBloqueada] = useState<null | { accion: () => void }>(null)
  const [pendientes, setPendientes] = useState(0)

  /**
   * A PARTIR DE QUÉ ANCHO EL CATÁLOGO DEJA DE SER EDITABLE.
   *
   * El valor por defecto de useIsMobile es 1023px, o sea el breakpoint `lg` de
   * Tailwind, y eso NO es «el móvil»: es cualquier ventana de menos de 1024,
   * incluido un portátil con la ventana a media pantalla o un iPad — que es
   * justo como se trabaja esto, con Seller Central abierto al lado. Con ese
   * umbral, media agencia se encontraba el catálogo en modo consulta sin
   * haberlo pedido.
   *
   * 768 es donde una tabla de siete columnas deja de caber de verdad. Por
   * debajo de ahí sí se pasa a tarjetas, y ahora además se dice en pantalla
   * (ver el aviso de CatalogoPanel): editar un precio con el pulgar sobre una
   * celda de doce píxeles es exactamente cómo se manda un 1499 a la tienda de
   * un cliente.
   */
  const isMobile = useIsMobile('(max-width: 767px)')

  const clientesPorId = useMemo(
    () => new Map(data.clients.map((c) => [c.id, c])),
    [data.clients]
  )

  /**
   * Las conexiones, con las vivas delante.
   *
   * Una conexión rota sigue enseñándose: su catálogo es la última foto que
   * pudimos leer y sigue sirviendo para consultar. Lo que no se puede es
   * escribir en ella, y eso lo dice su propia tarjeta.
   */
  const conexiones = useMemo(
    () =>
      [...data.connections].sort(
        (a, b) =>
          Number(b.is_active && b.status === 'activa') -
            Number(a.is_active && a.status === 'activa') ||
          (clientesPorId.get(a.client_id)?.name ?? '').localeCompare(
            clientesPorId.get(b.client_id)?.name ?? '',
            'es'
          ) ||
          a.name.localeCompare(b.name, 'es')
      ),
    [data.connections, clientesPorId]
  )

  const seleccionada = conexiones.find((c) => c.id === connectionId) ?? null
  const clienteSeleccionado = seleccionada
    ? (clientesPorId.get(seleccionada.client_id)?.name ?? seleccionada.name)
    : ''

  /**
   * Cualquier cosa que desmonte el catálogo, preguntando antes.
   *
   * Las ediciones sin enviar viven en memoria y son de un solo cliente: irse
   * las pierde. Se pregunta en vez de guardarlas por debajo porque un cambio de
   * precio guardado a medias, que reaparece días después cuando ya no viene a
   * cuento, es peor que perderlo.
   */
  function salirDelCatalogo(accion: () => void) {
    if (pendientes > 0) {
      setSalidaBloqueada({ accion })
      return
    }
    accion()
  }

  function irA(destino: string) {
    if (destino === connectionId) return
    salirDelCatalogo(() => setConnectionId(destino))
  }

  function confirmarSalida() {
    const accion = salidaBloqueada?.accion
    setSalidaBloqueada(null)
    setPendientes(0)
    accion?.()
  }

  /**
   * Refleja en el botón de arriba lo que acaba de refrescar el panel.
   *
   * useCallback CON LISTA VACÍA, Y NO ES UN ADORNO. Esta función baja al panel
   * del catálogo, que la usa para construir su función de carga, y esa función
   * es una dependencia del efecto que pide el catálogo y del temporizador de
   * quince minutos. Si cambiara de identidad en cada render, el efecto de carga
   * se dispararía en bucle —cargar, pintar, cargar— y el temporizador se
   * reiniciaría antes de llegar a cumplir, así que el refresco automático no
   * saltaría NUNCA. `setData` es estable, así que la lista puede estar vacía.
   */
  const actualizarConexion = useCallback((conn: AmazonConnection) => {
    setData((prev) => ({
      ...prev,
      connections: prev.connections.map((c) => (c.id === conn.id ? conn : c)),
    }))
  }, [])

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 gap-3">
      {/* ---------------- Cabecera ---------------- */}
      <div
        className={`${cardShell} p-2.5 flex flex-wrap items-center justify-between gap-2 flex-shrink-0`}
      >
        <p className="text-[12px] text-white/70 min-w-0">
          <span className="text-white font-semibold tabular-nums">
            {formatInt(data.activeConnections)}
          </span>{' '}
          {data.activeConnections === 1 ? 'cuenta conectada' : 'cuentas conectadas'}
          {appDraft && (
            <span className="text-white/35">
              {' '}
              · quedan {formatInt(data.remainingAuthorizations)} de {AMAZON_MAX_AUTHORIZATIONS}
            </span>
          )}
        </p>

        <button
          type="button"
          onClick={() =>
            gestionando
              ? setGestionando(false)
              : salirDelCatalogo(() => setGestionando(true))
          }
          aria-pressed={gestionando}
          className={gestionando ? primaryButton : ghostButton}
        >
          <Settings2 className="h-3.5 w-3.5" />
          {gestionando ? 'Volver al catálogo' : 'Conexiones y accesos'}
        </button>
      </div>

      {configError && (
        <div className={`${errorBox} flex-shrink-0`}>
          <span className="font-semibold">El servidor no está configurado del todo.</span>{' '}
          {configError}
        </div>
      )}

      {gestionando ? (
        <div className="flex-1 min-h-0 min-w-0 overflow-auto">
          <ConexionesBoard
            data={data}
            onData={setData}
            configError={configError}
            appDraft={appDraft}
          />
        </div>
      ) : (
        <>
          {/* ---------------- Los botones de los clientes ---------------- */}
          {conexiones.length === 0 ? (
            <div className={`${cardShell} p-8 text-center flex-1 flex items-center justify-center`}>
              <div>
                <Plug className="h-6 w-6 text-white/20 mx-auto mb-3" />
                <p className="text-[13px] text-white/45">
                  Todavía no hay ninguna cuenta de Amazon conectada.
                </p>
                <p className="text-[12px] text-white/30 mt-1">
                  Entra en «Conexiones y accesos» para dar de alta un cliente y mandarle su enlace
                  de autorización.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-shrink-0 min-w-0 max-h-[26vh] lg:max-h-[128px] overflow-y-auto">
                <div className="flex flex-wrap gap-2 min-w-0">
                  {conexiones.map((conn) => (
                    <BotonCliente
                      key={conn.id}
                      conn={conn}
                      clientName={clientesPorId.get(conn.client_id)?.name ?? conn.name}
                      listings={data.listingCounts[conn.id] ?? 0}
                      selected={conn.id === connectionId}
                      onSelect={() => irA(conn.id)}
                    />
                  ))}
                </div>
              </div>

              {seleccionada ? (
                <CatalogoPanel
                  // Cambiar de cliente empieza de cero: la búsqueda, los
                  // filtros y la página en la que estabas no significan nada en
                  // el catálogo de otro.
                  key={seleccionada.id}
                  connection={seleccionada}
                  clientName={clienteSeleccionado}
                  onConnection={actualizarConexion}
                  onPendingCount={setPendientes}
                  isMobile={isMobile}
                />
              ) : (
                <div
                  className={`${cardShell} flex-1 min-h-0 flex items-center justify-center px-6 text-center`}
                >
                  <p className="text-[13px] text-white/35 max-w-[360px]">
                    Elige un cliente arriba para ver su catálogo completo con sus precios y su
                    stock.
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}

      {salidaBloqueada && (
        <Dialogo
          title="Tienes cambios sin enviar"
          subtitle={`${pendientes} ${pendientes === 1 ? 'cambio' : 'cambios'} en ${clienteSeleccionado}`}
          onClose={() => setSalidaBloqueada(null)}
        >
          <div className="space-y-3">
            <p className="text-[12px] text-white/70 leading-relaxed">
              Si te vas a otro cliente se pierden: todavía no han salido hacia Amazon y no se
              guardan en ningún sitio.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSalidaBloqueada(null)}
                className={primaryButton}
              >
                Quedarme y revisarlos
              </button>
              <button type="button" onClick={confirmarSalida} className={ghostButton}>
                Salir y perderlos
              </button>
            </div>
          </div>
        </Dialogo>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * El botón de un cliente.
 *
 * Lleva el estado dentro porque una conexión con el acceso retirado no da
 * ningún error visible: deja de refrescarse y el catálogo envejece en silencio.
 * Verlo aquí, antes de entrar, es lo que evita ponerse a editar precios de una
 * tienda que ya no nos escucha.
 */
function BotonCliente({
  conn,
  clientName,
  listings,
  selected,
  onSelect,
}: {
  conn: AmazonConnection
  clientName: string
  listings: number
  selected: boolean
  onSelect: () => void
}) {
  const estado = conn.status as AmazonConnectionStatus
  const viva = conn.is_active && estado === 'activa'
  const avisa = viva && needsReauthWarning(conn.authorized_at)

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`text-left rounded-xl border px-3 py-2 transition-colors min-w-[210px] max-w-[280px] ${
        selected
          ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.08]'
          : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20'
      } ${viva ? '' : 'opacity-60'}`}
    >
      <span className="flex items-center justify-between gap-2 min-w-0">
        <span
          className={`text-[13px] font-semibold truncate ${selected ? 'text-white' : 'text-white/80'}`}
        >
          {clientName}
        </span>
        {viva ? (
          <ChevronRight
            className={`h-3.5 w-3.5 flex-shrink-0 ${selected ? 'text-[#FF6600]' : 'text-white/20'}`}
          />
        ) : (
          <span className={`${statusPill(estado)} flex-shrink-0`}>
            {connectionStatusLabel(conn.status)}
          </span>
        )}
      </span>

      <span className="block text-[11px] text-white/40 truncate mt-0.5">
        {AMAZON_REGIONS[conn.region]?.label ?? conn.region}
        {conn.marketplace_ids.length > 0 && (
          <>
            {' · '}
            {conn.marketplace_ids.length <= 2
              ? conn.marketplace_ids.map((m) => marketplaceLabel(m)).join(', ')
              : `${conn.marketplace_ids.length} países`}
          </>
        )}
      </span>

      <span className="block text-[11px] text-white/30 tabular-nums truncate mt-px">
        {formatInt(listings)} {listings === 1 ? 'referencia' : 'referencias'}
      </span>

      {avisa && (
        <span className="flex items-center gap-1 text-[10px] text-yellow-300 mt-1">
          <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0" />
          Toca renovar la autorización
        </span>
      )}
    </button>
  )
}
