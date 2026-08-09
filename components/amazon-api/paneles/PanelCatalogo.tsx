'use client'

import { useCallback, useMemo } from 'react'
import { AlertTriangle, ChevronRight, Plug } from 'lucide-react'
import {
  AMAZON_REGIONS,
  connectionStatusLabel,
  marketplaceLabel,
  needsReauthWarning,
  type AmazonConnection,
  type AmazonConnectionStatus,
} from '@/lib/types/amazon'
import { useIsMobile } from '@/lib/use-is-mobile'
import { CatalogoPanel } from '@/components/amazon/CatalogoPanel'
import { cardShell, formatInt, statusPill } from '@/components/amazon/shared'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { PropsPanel } from '../tipos'

/**
 * PESTAÑA «CATÁLOGO» — LA QUE YA FUNCIONABA.
 *
 * Es el catálogo de siempre: precios, stock y el envío de cambios a Amazon, con
 * cada cambio registrado uno a uno. NO SE HA TOCADO SU FUNCIONAMIENTO; lo único
 * que ha cambiado es que ahora vive dentro de una pestaña en vez de ser la
 * pantalla entera del módulo.
 *
 * Lo que sí ha cambiado de sitio: el guardián de las ediciones sin enviar ahora
 * lo lleva la carcasa (`alSalir`), porque desde que hay ocho pestañas existen
 * tres formas de perder los cambios y no dos. El panel lo usa igual que antes
 * para el cambio de cliente, y la carcasa lo usa además para el cambio de
 * pestaña. Un solo guardián y un solo diálogo.
 *
 * Se entra por LOS BOTONES DE LOS CLIENTES, que es literalmente lo que se pidió.
 * Un botón por CONEXIÓN y no por cliente: un mismo cliente puede tener dos
 * autorizaciones —Europa y Estados Unidos son regiones distintas, con su propia
 * llave— y cada una tiene su catálogo. Un botón por cliente obligaría a elegir
 * la región después, en medio de una tabla de precios.
 */
export function PanelCatalogo({
  data,
  onData,
  conexionId,
  onConexionId,
  alSalir,
  onPendientes,
}: PropsPanel) {
  /**
   * A PARTIR DE QUÉ ANCHO EL CATÁLOGO DEJA DE SER EDITABLE.
   *
   * El valor por defecto de useIsMobile es 1023 px, o sea el breakpoint `lg` de
   * Tailwind, y eso NO es «el móvil»: es cualquier ventana de menos de 1024,
   * incluido un portátil a media pantalla o un iPad — que es justo como se
   * trabaja esto, con Seller Central abierto al lado. Con ese umbral, media
   * agencia se encontraba el catálogo en modo consulta sin haberlo pedido.
   *
   * 768 es donde una tabla de siete columnas deja de caber de verdad.
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

  const seleccionada = conexiones.find((c) => c.id === conexionId) ?? null
  const clienteSeleccionado = seleccionada
    ? (clientesPorId.get(seleccionada.client_id)?.name ?? seleccionada.name)
    : ''

  function irA(destino: string) {
    if (destino === conexionId) return
    alSalir(() => onConexionId(destino))
  }

  /**
   * Refleja en el estado compartido lo que acaba de refrescar el panel.
   *
   * useCallback CON LISTA VACÍA, Y NO ES UN ADORNO. Esta función baja al panel
   * del catálogo, que la usa para construir su función de carga, y esa función
   * es una dependencia del efecto que pide el catálogo y del temporizador de
   * quince minutos. Si cambiara de identidad en cada render, el efecto de carga
   * se dispararía en bucle —cargar, pintar, cargar— y el temporizador se
   * reiniciaría antes de cumplir, así que el refresco automático no saltaría
   * NUNCA.
   *
   * Por eso se usa el ACTUALIZADOR FUNCIONAL y no `{...data}`: leer `data` del
   * render actual obligaría a meterlo en las dependencias, que es justo lo que
   * se acaba de descartar. `onData` es el `setState` de la carcasa, y esos son
   * estables de por vida.
   */
  const actualizarConexion = useCallback(
    (conn: AmazonConnection) => {
      onData((prev) => ({
        ...prev,
        connections: prev.connections.map((c) => (c.id === conn.id ? conn : c)),
      }))
    },
    [onData]
  )

  /** El recuento de ediciones sin enviar, hacia la carcasa */
  const contarPendientes = useCallback(
    (n: number) => onPendientes(n, clienteSeleccionado),
    [onPendientes, clienteSeleccionado]
  )

  if (conexiones.length === 0) {
    return (
      <div className={`${cardShell} flex h-full items-center justify-center p-8 text-center`}>
        <div>
          <Plug className="mx-auto mb-3 h-6 w-6 text-white/20" />
          <p className="text-[13px] text-white/45">
            Todavía no hay ninguna cuenta de Amazon conectada.
          </p>
          <p className="mt-1 text-[12px] text-white/30">
            Ve a la pestaña «Cuentas» para dar de alta un cliente y mandarle su enlace de
            autorización.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2">
      <div className="min-w-0 flex-shrink-0 max-h-[26vh] overflow-y-auto lg:max-h-[128px]">
        <div className="flex min-w-0 flex-wrap gap-2">
          {conexiones.map((conn) => (
            <BotonCliente
              key={conn.id}
              conn={conn}
              clientName={clientesPorId.get(conn.client_id)?.name ?? conn.name}
              listings={data.listingCounts[conn.id] ?? 0}
              selected={conn.id === conexionId}
              onSelect={() => irA(conn.id)}
            />
          ))}
        </div>
      </div>

      {seleccionada ? (
        <CatalogoPanel
          // Cambiar de cliente empieza de cero: la búsqueda, los filtros y la
          // página en la que estabas no significan nada en el catálogo de otro.
          key={seleccionada.id}
          connection={seleccionada}
          clientName={clienteSeleccionado}
          onConnection={actualizarConexion}
          onPendingCount={contarPendientes}
          isMobile={isMobile}
        />
      ) : (
        <div
          className={`${cardShell} flex min-h-0 flex-1 items-center justify-center px-6 text-center`}
        >
          <p className="max-w-[360px] text-[13px] text-white/35">
            Elige un cliente arriba para ver su catálogo completo con sus precios y su stock.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * El botón de un cliente.
 *
 * Lleva el estado dentro porque una conexión con el acceso retirado no da ningún
 * error visible: deja de refrescarse y el catálogo envejece en silencio. Verlo
 * aquí, antes de entrar, es lo que evita ponerse a editar precios de una tienda
 * que ya no nos escucha.
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
      className={`min-w-[210px] max-w-[280px] rounded-xl border px-3 py-2 text-left transition-colors ${
        selected
          ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.08]'
          : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'
      } ${viva ? '' : 'opacity-60'}`}
    >
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span
          className={`truncate text-[13px] font-semibold ${selected ? 'text-white' : 'text-white/80'}`}
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

      <span className="mt-0.5 block truncate text-[11px] text-white/40">
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

      <span className="mt-px block truncate text-[11px] tabular-nums text-white/30">
        {formatInt(listings)} {listings === 1 ? 'referencia' : 'referencias'}
      </span>

      {avisa && (
        <span className="mt-1 flex items-center gap-1 text-[10px] text-yellow-300">
          <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0" />
          Toca renovar la autorización
        </span>
      )}
    </button>
  )
}

export function InfoCatalogo() {
  return (
    <>
      <SeccionInfo titulo="Qué se ve aquí">
        <p>
          El catálogo completo de una cuenta conectada: precio, stock y estado de cada referencia,
          tal y como lo tiene Amazon la última vez que se leyó.
        </p>
        <p>
          Un botón por <strong>conexión</strong>, no por cliente. Un mismo cliente puede tener dos
          autorizaciones —Europa y Estados Unidos son regiones distintas, con su propia llave— y
          cada una tiene su catálogo.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Los cambios se envían a mano, y quedan registrados">
        <ListaInfo>
          <li>
            Editar una celda <strong>no</strong> manda nada: se acumula y se revisa antes de
            enviar.
          </li>
          <li>
            Las ediciones sin enviar viven en memoria y son de un solo cliente. Cambiar de cliente,
            cambiar de pestaña o recargar las pierde, y por eso se pregunta antes.
          </li>
          <li>
            Cada envío queda anotado con quién, cuándo y qué valor tenía antes. Es lo que permite
            responderle a un cliente por qué su precio cambió un martes a las once.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="Una cuenta apagada sigue enseñándose">
        <p>
          Si una autorización caduca o Amazon la retira, la conexión deja de refrescarse pero su
          última foto se conserva y se puede consultar. Lo que no se puede es escribir en ella. La
          tarjeta del cliente lo dice antes de entrar, porque una conexión rota{' '}
          <strong>no da ningún error visible</strong>: el catálogo simplemente envejece en silencio.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Por debajo de 768 px se lee, no se edita">
        <p>
          Con la ventana estrecha la tabla pasa a tarjetas y las celdas dejan de ser editables.
          Ajustar un precio con el pulgar sobre una celda de doce píxeles es exactamente cómo se
          manda un 1499 a la tienda de un cliente.
        </p>
      </SeccionInfo>
    </>
  )
}
