'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  Link2,
  Loader2,
  Megaphone,
  MousePointerClick,
  Plug,
  RefreshCw,
  Tags,
  Trash2,
  Unplug,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  AMAZON_CONNECTION_STATUS_HINTS,
  AMAZON_MAX_AUTHORIZATIONS,
  AMAZON_REGIONS,
  connectionStatusLabel,
  daysUntilReauth,
  marketplaceById,
  marketplaceLabel,
  needsReauthWarning,
  type AmazonClient,
  type AmazonConnection,
  type AmazonConnectionStatus,
} from '@/lib/types/amazon'
import {
  CADENCIA_CLIENTE_LABELS,
  MODELOS_NEGOCIO,
  MODELO_NEGOCIO_LABELS,
  POLITICAS_BSR,
  POLITICA_BSR_LABELS,
  cadenciaBsrCliente,
  clienteSinClasificar,
  type CadenciaCliente,
  type ModeloNegocio,
  type PoliticaBsr,
} from '@/lib/plataforma/modelo-negocio'
import { patchAmazon, postAmazon, type AmazonMutation } from '@/lib/amazon/client'
import {
  BOTON,
  CIFRAS,
  COLOR_ESTADO,
  ESTADO,
  LINEA,
  PANTALLA,
  RADIO,
  TABLA,
  TEXTO,
  TIPO,
  type TonoEstado,
} from '@/lib/estilo/denso'
import { Aviso, Vacio, cifra, fechaHora, hace } from '@/components/plataforma/comun'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import { AltaClienteDialog } from '@/components/amazon/AltaClienteDialog'
import { BorrarClienteDialog } from '@/components/amazon/BorrarClienteDialog'
import { DesconectarDialog } from '@/components/amazon/DesconectarDialog'
import { EnlaceDialog } from '@/components/amazon/EnlaceDialog'
import type { PropsPanel } from '../tipos'

/**
 * PESTAÑA «CUENTAS» — LO PRIMERO QUE HAY QUE RELLENAR.
 *
 * Una fila por cliente con las dos decisiones que lo gobiernan todo —su MODELO DE
 * NEGOCIO y su POLÍTICA DE BSR— y, colgando de ella, sus cuentas conectadas con
 * sus países y su estado de autorización.
 *
 *
 * ============ POR QUÉ VA PRIMERA DE LAS OCHO ============
 *
 * Porque el modelo de negocio decide si al catálogo de ese cliente se le mide el
 * ranking cada noche, y eso no es un detalle de configuración: en reventa el BSR
 * es el del ASIN de otro —mide el producto, no la cuenta del cliente— y son justo
 * los catálogos enormes. Barrer trece mil referencias a dos llamadas por segundo
 * son unas seis horas de ventana nocturna gastadas en catálogo ajeno.
 *
 * Y hoy TODOS los clientes nacen en «mixto», que es el valor por defecto de la
 * migración 123. O sea que hasta que alguien los clasifique no se ahorra ni un
 * minuto. Por eso la pantalla lleva el contador de «sin clasificar» arriba y su
 * filtro al lado: es la lista de trabajo, no un adorno.
 *
 *
 * ============ EL TEXTO QUE NO ESTÁ AQUÍ ============
 *
 * Esta pantalla tenía cinco párrafos de ayuda encima de los controles: el tope de
 * 25 autorizaciones, cómo se conecta una cuenta, qué pasa al desconectar, qué
 * significa cada estado. Están TODOS escritos, detrás del botón de información de
 * la cabecera, en InfoCuentas() al final de este fichero. No se ha perdido nada:
 * se ha movido.
 *
 * Lo que SÍ se queda en pantalla es lo accionable de hoy —una autorización a
 * punto de caducar, un refresco que falló, un catálogo que se leyó a medias—,
 * porque esconder eso detrás de un botón es no darlo.
 */

/* ------------------------------------------------------------------ */
/* Mapas de presentación                                               */
/* ------------------------------------------------------------------ */

const TONO_CONEXION: Record<AmazonConnectionStatus, TonoEstado> = {
  activa: 'verde',
  revocada: 'rojo',
  caducada: 'ambar',
  error: 'rojo',
}

const ICONO_CONEXION: Record<AmazonConnectionStatus, LucideIcon> = {
  activa: CircleCheck,
  revocada: CircleSlash,
  caducada: CircleAlert,
  error: CircleAlert,
}

/** Qué se le va a medir a este cliente, con forma antes que color */
const CADENCIA_ADORNO: Record<CadenciaCliente, { icono: LucideIcon; tono: TonoEstado }> = {
  diario: { icono: CalendarDays, tono: 'azul' },
  por_sku: { icono: Tags, tono: 'violeta' },
  bajo_demanda: { icono: MousePointerClick, tono: 'gris' },
  nunca: { icono: CircleSlash, tono: 'gris' },
}

/**
 * EL DESPLEGABLE DE UNA FILA DE LA TABLA.
 *
 * No usa CELDA.editable de denso.ts, y es la única desviación del contrato en
 * esta pantalla. CELDA.editable existe para que doce columnas editables no se
 * lean como un formulario: no parece un campo hasta que pasas por encima. Aquí
 * las columnas editables son DOS y son el motivo por el que existe la pantalla,
 * así que esconderlas hasta el hover sería esconder justo lo que se viene a
 * hacer.
 *
 * Tampoco usa CAMPO.input tal cual: mide 26 px y el contrato dice que la altura
 * de fila la manda el control de dentro, así que la fila se iría a 34. A 22 px la
 * fila mide 30 y el control sigue teniendo su borde y su fondo.
 *
 * Se escribe entero en vez de concatenar un `h-[22px]` a CAMPO.input a propósito:
 * dos clases de altura en el mismo elemento tienen la misma especificidad y
 * decide el orden de la hoja compilada, no el orden del atributo. Es la trampa
 * que documenta BOTON.chipEncendido en denso.ts y que dejó los chips de filtro
 * pintándose iguales encendidos y apagados durante semanas.
 */
const SELECT_FILA =
  'h-[22px] w-full cursor-pointer appearance-none rounded-[6px] border pl-[6px] pr-[17px] ' +
  'border-[var(--ls-linea)] bg-[var(--ls-sup2)] text-[12px] text-[var(--ls-t1)] outline-none ' +
  'hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] ' +
  'focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)] ' +
  'disabled:cursor-default disabled:opacity-45'

/* ------------------------------------------------------------------ */
/* La pantalla                                                         */
/* ------------------------------------------------------------------ */

/** Lo que devuelve PATCH /api/amazon/clients/[id]: la fila, no la vista entera */
interface RespuestaClasificacion {
  client: AmazonClient
  message?: string
  /** Falta la migración 128. Se dice UNA vez, al guardar */
  avisoMigracion?: string
}

/** Lo que esta pantalla necesita saber de la conexión de publicidad de un cliente */
interface AdsDeCliente {
  conectada: boolean
  /** Cuántas regiones tiene autorizadas. Europa y Norteamérica van aparte */
  regiones: number
  perfiles: number
  sinAsignar: number
}

export function PanelCuentas({ data, onData, configError, appDraft }: PropsPanel) {
  /**
   * EL ESTADO DE PUBLICIDAD, PEDIDO APARTE.
   *
   * Son dos autorizaciones distintas del mismo cliente —Selling Partner para el
   * catálogo y Advertising para las campañas— con aplicaciones, permisos y
   * ciclos de vida independientes. Aquí se juntan en la misma fila porque para
   * quien trabaja son «las conexiones de este cliente», que es justo lo que
   * faltaba: dar de alta un cliente una vez y conectarle lo que haga falta.
   *
   * Se pide en una llamada suya y no se mete en `AmazonView`: ese objeto lo
   * carga la carcasa en CADA visita a Amazon API para las nueve pestañas, y las
   * otras ocho no lo usan.
   */
  const [ads, setAds] = useState<Record<string, AdsDeCliente>>({})

  useEffect(() => {
    let cancelado = false
    fetch('/api/ads/estado')
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (cancelado || !payload?.clientes) return
        const mapa: Record<string, AdsDeCliente> = {}
        for (const c of payload.clientes as Array<{
          id: string
          conexiones: Array<{ perfiles: Array<{ cliente_id: string | null }> }>
        }>) {
          const perfiles = c.conexiones.flatMap((x) => x.perfiles)
          mapa[c.id] = {
            // Una por región: Europa y Norteamérica son autorizaciones distintas
            // y un token de una no lee las cuentas de la otra.
            conectada: c.conexiones.length > 0,
            regiones: c.conexiones.length,
            perfiles: perfiles.length,
            sinAsignar: perfiles.filter((p) => p.cliente_id === null).length,
          }
        }
        setAds(mapa)
      })
      .catch(() => {
        // Que no se pueda leer el estado de publicidad no puede tumbar la
        // pantalla de cuentas, que es la que de verdad se viene a usar.
      })
    return () => {
      cancelado = true
    }
  }, [])

  const [alta, setAlta] = useState(false)
  const [enlace, setEnlace] = useState<{ clientId?: string } | null>(null)
  const [desconectar, setDesconectar] = useState<AmazonConnection | null>(null)
  const [borrando, setBorrando] = useState<AmazonClient | null>(null)
  /** Qué conexión se está reintentando, para el spinner de su botón */
  const [reintentando, setReintentando] = useState<string | null>(null)
  /** Qué cliente se está guardando, para bloquear sus dos desplegables */
  const [guardando, setGuardando] = useState<string | null>(null)
  const [soloPendientes, setSoloPendientes] = useState(false)

  /**
   * ¿Ya se ha dicho lo de la migración que falta?
   *
   * UNA VEZ Y NO UNA POR GUARDADO. Clasificar a los 16 clientes son entre 16 y 32
   * guardados seguidos, y el servidor manda el mismo aviso en todos: 32 avisos
   * idénticos no informan de nada y le quitan credibilidad a los que sí hay que
   * atender. Va en un `ref` y no en el estado a propósito — cambia dentro del
   * guardado y no tiene que repintar la tabla.
   */
  const avisoDado = useRef(false)

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

  /**
   * QUIÉNES SIGUEN SIN CLASIFICAR.
   *
   * No es «cuántos están en mixto»: mixto es una respuesta legítima —lo normal en
   * cuanto un revendedor saca su marca— y confundirla con el hueco dejaría un
   * aviso encendido para siempre. Lo que se mira es si alguien se ha pronunciado,
   * que es lo que guarda `modelo_negocio_at`. Ver clienteSinClasificar().
   */
  const pendientes = useMemo(
    () =>
      new Set(
        data.clients
          .filter((c) =>
            clienteSinClasificar({
              modelo: c.modelo_negocio ?? 'mix',
              clasificadoAt: c.modelo_negocio_at,
            })
          )
          .map((c) => c.id)
      ),
    [data.clients]
  )

  const visibles = soloPendientes
    ? data.clients.filter((c) => pendientes.has(c.id))
    : data.clients

  const sinConfigurar = configError !== null

  /**
   * GUARDA LA CLASIFICACIÓN DE UN CLIENTE, PINTÁNDOLA ANTES DE QUE VUELVA.
   *
   * Optimista porque un desplegable que no cambia al soltarlo se lee como roto, y
   * con reversión porque un desplegable que cambia y no ha guardado nada es peor:
   * la pantalla diría que ese catálogo ya no se barre de noche cuando sí.
   *
   * Se mandan SIEMPRE los dos valores aunque solo se haya tocado uno: `auto`
   * significa una cosa u otra según el modelo, así que son un par y guardar medio
   * par deja al cliente en un estado que nadie ha elegido.
   */
  async function clasificar(
    cliente: AmazonClient,
    cambio: { modelo?: ModeloNegocio; politica?: PoliticaBsr }
  ) {
    const modelo = cambio.modelo ?? cliente.modelo_negocio ?? 'mix'
    const politica = cambio.politica ?? cliente.bsr_politica ?? 'auto'

    const sustituir = (fila: AmazonClient) =>
      onData((prev) => ({
        ...prev,
        clients: prev.clients.map((c) => (c.id === cliente.id ? fila : c)),
      }))

    sustituir({
      ...cliente,
      modelo_negocio: modelo,
      bsr_politica: politica,
      // `undefined` significa que la columna todavía no existe en la base, y eso
      // no lo arregla un guardado: se deja como estaba para que el contador siga
      // cayendo a su criterio de reserva en vez de mentir.
      modelo_negocio_at:
        cliente.modelo_negocio_at === undefined ? undefined : new Date().toISOString(),
    })
    setGuardando(cliente.id)

    const res = await patchAmazon<RespuestaClasificacion>(`/api/amazon/clients/${cliente.id}`, {
      modelo_negocio: modelo,
      bsr_politica: politica,
    })
    setGuardando(null)

    if (!res.ok) {
      sustituir(cliente)
      toast.error(res.error)
      return
    }
    sustituir(res.data.client)
    if (res.data.avisoMigracion && !avisoDado.current) {
      avisoDado.current = true
      toast.warning(res.data.avisoMigracion)
    }
  }

  /**
   * Vuelve a probar una conexión marcada y, si Amazon responde, la reactiva.
   *
   * Es el único camino de vuelta que hay: una conexión que cae en «con problemas»
   * —basta un 403 pasajero— deja de refrescarse, y lo único que quedaba antes era
   * desconectar, o sea destruir la llave y pedirle al cliente que autorice otra
   * vez. El servidor no reactiva a ciegas: si Amazon no contesta, la conexión se
   * queda como estaba y el motivo viene en el mensaje.
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
    if (res.data.retried) toast.success(res.data.message ?? 'Conexión recuperada')
    else toast.warning(res.data.message ?? 'Amazon sigue sin responder a esta conexión')
  }

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      {/* -------- Cifras y acciones, en una sola fila de 32 px -------- */}
      <div className={PANTALLA.filtros}>
        <div className={CIFRAS.tira}>
          <span className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{cifra(data.activeConnections)}</span>
            <span className={CIFRAS.rotulo}>
              {data.activeConnections === 1 ? 'cuenta conectada' : 'cuentas conectadas'}
            </span>
          </span>
          {/* El cupo SOLO existe mientras la aplicación siga en borrador en el
              portal de Amazon. Condicionado para que el día que se publique deje
              de hablarse de él sin que nadie tenga que acordarse. */}
          {appDraft && (
            <span className={CIFRAS.celda}>
              <span className={CIFRAS.valor}>{cifra(data.remainingAuthorizations)}</span>
              <span className={CIFRAS.rotulo}>libres de {AMAZON_MAX_AUTHORIZATIONS}</span>
            </span>
          )}
          <span className={CIFRAS.celda}>
            <span className={`${CIFRAS.valor} ${pendientes.size > 0 ? CIFRAS.urgente : ''}`}>
              {cifra(pendientes.size)}
            </span>
            <span className={CIFRAS.rotulo}>sin clasificar</span>
          </span>
        </div>

        {/* El filtro solo aparece cuando hay algo que filtrar: un chip que nunca
            hace nada es ruido en la única fila de controles de la pantalla. */}
        {pendientes.size > 0 && (
          <button
            type="button"
            onClick={() => setSoloPendientes((v) => !v)}
            aria-pressed={soloPendientes}
            className={`${BOTON.chip} ${soloPendientes ? BOTON.chipEncendido : ''}`}
          >
            <CircleHelp className="h-[13px] w-[13px]" />
            Solo sin clasificar
          </button>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-[6px]">
          <button
            type="button"
            onClick={() => setAlta(true)}
            className={`${BOTON.base} ${BOTON.secundario}`}
          >
            <UserPlus className="h-[13px] w-[13px]" />
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
                  : 'Genera el enlace de consentimiento para que lo abra el cliente'
            }
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            <Link2 className="h-[13px] w-[13px]" />
            Conectar cliente
          </button>
        </div>
      </div>

      {/* Se queda en pantalla porque es accionable HOY: con el cupo lleno, la
          autorización siguiente falla con el cliente delante. El porqué y la
          salida están detrás del botón de información. */}
      {appDraft && data.remainingAuthorizations === 0 && (
        <div className="shrink-0">
          <Aviso tono="ambar" icono={AlertTriangle}>
            No quedan autorizaciones libres de {AMAZON_MAX_AUTHORIZATIONS}: no se puede conectar a
            nadie más hasta publicar la aplicación en el Appstore de Amazon.
          </Aviso>
        </div>
      )}

      {/* -------- La tabla -------- */}
      {data.clients.length === 0 ? (
        <Vacio
          icono={<Plug />}
          titulo="Todavía no hay ningún cliente dado de alta"
          accion={
            <button
              type="button"
              onClick={() => setAlta(true)}
              className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
            >
              <UserPlus className="h-[13px] w-[13px]" />
              Añadir el primero
            </button>
          }
        >
          Un cliente se da de alta aquí y se conecta después, con su enlace de autorización.
        </Vacio>
      ) : (
        <div className={TABLA.caja}>
          {/*
            NO LLEVA EL `min-w-max` DE TABLA.tabla, Y ES LA DIFERENCIA ENTRE QUE
            LA PANTALLA SE VEA O NO.

            Ese `min-w-max` es lo correcto en una tabla de catálogo: doce columnas
            de datos que no se pueden partir y que scrollean de lado dentro de su
            caja. Aquí hay cinco, y debajo de cada cliente va una fila de
            `colSpan` con los países de su cuenta. Con `min-w-max`, esa fila se
            mide a `max-content`: no envuelve nunca, y una cuenta con ocho
            marketplaces —la conectada tiene ocho, cinco de ellos de sandbox—
            estiraba la tabla lo suficiente como para dejar «Se mide» y el botón
            de conectar fuera de la ventana. O sea que la columna que dice si a
            ese cliente se le mide el BSR había que ir a buscarla con la barra.

            Con la tabla a `w-full` la fila de países envuelve y las cinco
            columnas caben siempre. La primera lleva `w-full` para que se quede
            ella con el espacio sobrante en vez de repartirlo entre todas.
          */}
          <table className="w-full border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr>
                <th className={`${TABLA.cabecera} w-full`}>Cliente</th>
                <th className={TABLA.cabecera}>Modelo de negocio</th>
                <th className={TABLA.cabecera}>Política de BSR</th>
                <th className={TABLA.cabecera}>Se mide</th>
                <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((cliente) => (
                <FilasCliente
                  key={cliente.id}
                  cliente={cliente}
                  conexiones={porCliente.get(cliente.id) ?? []}
                  listingCounts={data.listingCounts}
                  pendiente={pendientes.has(cliente.id)}
                  guardando={guardando === cliente.id}
                  puedeConectar={!sinConfigurar}
                  reintentando={reintentando}
                  onClasificar={(cambio) => clasificar(cliente, cambio)}
                  ads={ads[cliente.id] ?? null}
                  onConectar={() => setEnlace({ clientId: cliente.id })}
                  onBorrar={() => setBorrando(cliente)}
                  onDesconectar={setDesconectar}
                  onReintentar={reintentar}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AnimatePresence>
        {alta && (
          <AltaClienteDialog
            key="alta"
            onClose={() => setAlta(false)}
            onDone={(view, clientId) => {
              onData(view)
              // Encadenado a propósito: quien acaba de dar de alta a un cliente lo
              // ha hecho para conectarlo, no para verlo en una lista.
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

        {borrando && (
          <BorrarClienteDialog
            key="borrar"
            cliente={borrando}
            conexiones={(porCliente.get(borrando.id) ?? []).length}
            onClose={() => setBorrando(null)}
            onDone={onData}
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
/* Un cliente: su fila de clasificación y las de sus cuentas           */
/* ------------------------------------------------------------------ */

function FilasCliente({
  cliente,
  conexiones,
  listingCounts,
  pendiente,
  guardando,
  puedeConectar,
  reintentando,
  ads,
  onClasificar,
  onConectar,
  onBorrar,
  onDesconectar,
  onReintentar,
}: {
  cliente: AmazonClient
  conexiones: AmazonConnection[]
  listingCounts: Record<string, number>
  pendiente: boolean
  guardando: boolean
  puedeConectar: boolean
  reintentando: string | null
  /** null mientras se carga o si no se ha podido leer */
  ads: AdsDeCliente | null
  onClasificar: (cambio: { modelo?: ModeloNegocio; politica?: PoliticaBsr }) => void
  onConectar: () => void
  onBorrar: () => void
  onDesconectar: (conn: AmazonConnection) => void
  onReintentar: (conn: AmazonConnection) => void
}) {
  // `?? 'mix'` y `?? 'auto'` no son paranoia: las migraciones de este módulo se
  // lanzan a mano en el editor SQL de Supabase, así que el código puede estar
  // desplegado antes que ellas y estas columnas llegar sin valor. Es el mismo
  // criterio que ya aplica lib/plataforma/planificador.ts al leerlas.
  const modelo = cliente.modelo_negocio ?? 'mix'
  const politica = cliente.bsr_politica ?? 'auto'
  const cadencia = cadenciaBsrCliente({ modelo, politica })
  const { icono: IconoCadencia, tono: tonoCadencia } = CADENCIA_ADORNO[cadencia]

  /** La cabecera de grupo se levanta una superficie sobre las filas de cuentas */
  const celdaCliente = `${TABLA.celda} h-[30px] bg-[var(--ls-sup2)] border-t ${LINEA.fuerte}`

  return (
    <Fragment>
      <tr className={cliente.is_active ? '' : 'opacity-60'}>
        <td className={celdaCliente}>
          <span className="flex items-center gap-[6px] min-w-0">
            <span className={`${TIPO.m} font-semibold ${TEXTO.t1} truncate`} title={cliente.slug}>
              {cliente.name}
            </span>
            {pendiente && (
              <span
                className={`inline-flex h-4 shrink-0 items-center gap-[3px] ${RADIO.r1} border px-[5px] text-[10.5px] font-medium`}
                style={{ borderColor: COLOR_ESTADO.ambar, color: COLOR_ESTADO.ambar }}
                title="Nadie ha dicho todavía cómo vende este cliente: «mixto» es solo el valor por defecto"
              >
                <CircleHelp className="h-[11px] w-[11px]" />
                sin clasificar
              </span>
            )}
          </span>
        </td>

        <td className={celdaCliente}>
          <Selector
            valor={modelo}
            opciones={MODELOS_NEGOCIO}
            etiquetas={MODELO_NEGOCIO_LABELS}
            disabled={guardando}
            etiquetaAria={`Modelo de negocio de ${cliente.name}`}
            ancho="min-w-[148px]"
            onCambio={(v) => onClasificar({ modelo: v })}
          />
        </td>

        <td className={celdaCliente}>
          <Selector
            valor={politica}
            opciones={POLITICAS_BSR}
            etiquetas={POLITICA_BSR_LABELS}
            disabled={guardando}
            etiquetaAria={`Política de BSR de ${cliente.name}`}
            // 206 px es lo que mide «Según el modelo de negocio», que es la
            // opción por defecto y por tanto la que se lee en las 16 filas: con
            // menos salía cortada justo en la palabra que la distingue.
            ancho="min-w-[206px]"
            onCambio={(v) => onClasificar({ politica: v })}
          />
        </td>

        <td className={celdaCliente}>
          <span className="flex items-center gap-[5px]">
            {guardando ? (
              <span className={`${ESTADO.linea} ${TEXTO.t4}`}>
                <Loader2 className={`${ESTADO.icono} animate-spin`} />
                Guardando…
              </span>
            ) : (
              <span className={ESTADO.linea}>
                <IconoCadencia
                  className={ESTADO.icono}
                  style={{ color: COLOR_ESTADO[tonoCadencia] }}
                />
                {CADENCIA_CLIENTE_LABELS[cadencia]}
              </span>
            )}
          </span>
        </td>

        <td className={`${celdaCliente} ${TABLA.derecha}`}>
          <span className="flex items-center justify-end gap-[4px]">
            <button
              type="button"
              onClick={onConectar}
              disabled={!puedeConectar}
              title={
                puedeConectar
                  ? 'Genera el enlace de consentimiento de este cliente'
                  : 'Falta configurar el servidor'
              }
              className={`${BOTON.base} ${BOTON.secundario}`}
            >
              <Link2 className="h-[13px] w-[13px]" />
              {conexiones.length === 0 ? 'Conectar' : 'Otra región'}
            </button>
            {/* Se ofrece SIEMPRE, también con cuentas conectadas, pero el
                servidor lo rechaza mientras las haya y lo dice. Esconder el
                botón dejaría la pregunta «¿y este cliente cómo se quita?» sin
                respuesta en pantalla; enseñarlo con su motivo la contesta. */}
            <button
              type="button"
              onClick={onBorrar}
              title={
                conexiones.length > 0
                  ? 'Hay que desconectar antes su cuenta de Amazon: ahí es donde se destruye la llave de acceso a su tienda'
                  : 'Borrar este cliente y todo lo suyo. No se puede deshacer'
              }
              className={BOTON.icono}
            >
              <Trash2 className="h-[13px] w-[13px]" />
              <span className="sr-only">Borrar cliente</span>
            </button>
          </span>
        </td>
      </tr>

      {conexiones.length === 0 ? (
        <tr>
          <td colSpan={5} className={`${TABLA.celda} pl-[18px] ${TEXTO.t4}`}>
            <span className={ESTADO.linea}>
              <CircleSlash className={ESTADO.icono} style={{ color: COLOR_ESTADO.gris }} />
              Sin ninguna cuenta de Amazon conectada
            </span>
          </td>
        </tr>
      ) : (
        conexiones.map((conn) => (
          <FilaConexion
            key={conn.id}
            conn={conn}
            listings={listingCounts[conn.id] ?? 0}
            reintentando={reintentando === conn.id}
            onDesconectar={() => onDesconectar(conn)}
            onReintentar={() => onReintentar(conn)}
          />
        ))
      )}

      {/* PUBLICIDAD, en su propia línea y siempre visible.
          Un cliente sin Ads conectada tiene que verlo aquí, en la misma fila
          donde ve lo demás: es la pregunta «¿qué le falta a este cliente?», y
          esconderla en otra pestaña la deja sin contestar. */}
      <tr>
        <td colSpan={5} className={`${TABLA.celda} pl-[18px] ${TEXTO.t4}`}>
          <span className={ESTADO.linea}>
            <Megaphone
              className={ESTADO.icono}
              style={{ color: ads?.conectada ? COLOR_ESTADO.verde : COLOR_ESTADO.gris }}
            />
            {!ads ? (
              'Publicidad · comprobando…'
            ) : !ads.conectada ? (
              <>
                Publicidad · sin conectar
                <a
                  href="/dashboard/amazon-api?p=publicidad"
                  className="underline underline-offset-2 hover:text-[var(--ls-t1)]"
                >
                  Conectar Amazon Ads
                </a>
              </>
            ) : (
              <>
                Publicidad · {ads.perfiles}{' '}
                {ads.perfiles === 1 ? 'cuenta de anunciante' : 'cuentas de anunciante'}
                {ads.regiones === 1 && ' · solo una región conectada'}
                {ads.sinAsignar > 0 && (
                  <span style={{ color: COLOR_ESTADO.ambar }}>
                    · {ads.sinAsignar} sin asignar a ningún cliente
                  </span>
                )}
                <a
                  href="/dashboard/amazon-api?p=publicidad"
                  className="underline underline-offset-2 hover:text-[var(--ls-t1)]"
                >
                  Gestionar
                </a>
              </>
            )}
          </span>
        </td>
      </tr>
    </Fragment>
  )
}

/* ------------------------------------------------------------------ */
/* Una cuenta conectada                                                */
/* ------------------------------------------------------------------ */

function FilaConexion({
  conn,
  listings,
  reintentando,
  onDesconectar,
  onReintentar,
}: {
  conn: AmazonConnection
  listings: number
  reintentando: boolean
  onDesconectar: () => void
  onReintentar: () => void
}) {
  const estado = conn.status as AmazonConnectionStatus
  /**
   * Una conexión desactivada a mano NO está viva aunque su `status` siga diciendo
   * «activa»: lo que importa es si se está usando. Se pinta en gris y no en
   * verde, o la pantalla diría que esa cuenta se está refrescando cuando no.
   *
   * Y los dos mapas se leen con `??` porque `status` es TEXT en la base: un valor
   * que no esté en el mapa tiene que dar un icono, no `undefined` y una pantalla
   * en blanco. Es el mismo criterio de connectionStatusLabel().
   */
  const desactivada = !conn.is_active
  const viva = conn.is_active && estado === 'activa'
  const dias = daysUntilReauth(conn.authorized_at)
  const avisaRenovacion = viva && needsReauthWarning(conn.authorized_at)
  const Icono = desactivada ? CircleSlash : (ICONO_CONEXION[estado] ?? CircleAlert)
  const tono: TonoEstado = desactivada ? 'gris' : (TONO_CONEXION[estado] ?? 'gris')

  return (
    <tr className={TABLA.fila}>
      <td
        colSpan={5}
        className={`h-auto whitespace-normal border-b px-2 py-[5px] pl-[18px] ${LINEA.normal} ${TEXTO.t2}`}
      >
        {/*
          Los botones NO van dentro de la misma tira que envuelve. Estando ahí,
          una cuenta con ocho países empujaba «Desconectar» a una línea suya al
          final, o sea que el botón que destruye una llave de acceso cambiaba de
          sitio según cuántos mercados tuviera el cliente. Fuera de la tira y
          pegados arriba a la derecha, están siempre en el mismo punto.
        */}
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="flex flex-1 flex-wrap items-center gap-x-[10px] gap-y-[4px] min-w-0">
            <span
              className={ESTADO.linea}
              title={AMAZON_CONNECTION_STATUS_HINTS[estado] ?? undefined}
            >
              <Icono className={ESTADO.icono} style={{ color: COLOR_ESTADO[tono] }} />
              <span className={ESTADO.fuerte}>
                {connectionStatusLabel(conn.status)}
                {desactivada && ' · desactivada'}
              </span>
            </span>

            <span className={`${TIPO.s} ${TEXTO.t3}`}>
              {AMAZON_REGIONS[conn.region]?.label ?? conn.region} · {conn.selling_partner_id}
            </span>

            <Marketplaces conn={conn} />

            <span className={`${TIPO.s} ${TEXTO.t4} ${TIPO.num}`}>
              {cifra(listings)} {listings === 1 ? 'referencia' : 'referencias'} · refrescado{' '}
              <Momento iso={conn.last_sync_at} />
            </span>
          </div>

          <span className="flex shrink-0 items-center gap-[5px]">
            {/* Solo cuando hay algo que reintentar. Un botón siempre visible que
                casi nunca hace falta es ruido; este aparece exactamente cuando es
                la única salida que hay. */}
            {(!viva || conn.last_sync_error) && (
              <button
                type="button"
                onClick={onReintentar}
                disabled={reintentando}
                title="Vuelve a preguntarle a Amazon. Si responde, la cuenta se reactiva sin que el cliente tenga que hacer nada"
                className={`${BOTON.base} ${BOTON.secundario}`}
              >
                {reintentando ? (
                  <Loader2 className="h-[13px] w-[13px] animate-spin" />
                ) : (
                  <RefreshCw className="h-[13px] w-[13px]" />
                )}
                Reintentar
              </button>
            )}
            <button
              type="button"
              onClick={onDesconectar}
              title="Destruye la llave de acceso. El cliente tendría que volver a autorizar"
              className={`${BOTON.base} ${BOTON.secundario}`}
            >
              <Unplug className="h-[13px] w-[13px]" />
              Desconectar
            </button>
          </span>
        </div>

        {/* -------- Lo accionable de hoy. Nada de esto va detrás del botón -------- */}
        {conn.status_detail && !viva && (
          <Linea tono="ambar">{conn.status_detail}</Linea>
        )}

        {conn.last_sync_error && (
          <Linea tono="rojo">Último refresco: {conn.last_sync_error}</Linea>
        )}

        {/* Se pinta aquí y no solo en el catálogo porque el recuento de al lado es
            justo el número que se lee como si fuera el total, y no lo es. */}
        {conn.last_sync_truncated && (
          <Linea tono="ambar">
            {conn.last_sync_declared
              ? `Catálogo incompleto: Amazon declara ${cifra(conn.last_sync_declared)} referencias y por esta vía solo se leen 1.000.`
              : 'Catálogo incompleto: pasa de 1.000 referencias y por esta vía no se puede leer entero.'}
          </Linea>
        )}

        {avisaRenovacion && (
          <Linea tono="ambar">
            {dias > 0
              ? `La autorización caduca en ${dias} ${dias === 1 ? 'día' : 'días'}: pídele al cliente que vuelva a autorizar.`
              : 'La autorización ha pasado del año que dura: hay que pedirle al cliente que vuelva a autorizar.'}
          </Linea>
        )}
      </td>
    </tr>
  )
}

/**
 * LOS PAÍSES DE UNA CUENTA, INCLUIDOS LOS QUE EL ERP NO SABE NOMBRAR.
 *
 * `getMarketplaceParticipations` devuelve con `isParticipating: true` cosas que
 * no son tiendas de verdad —marketplaces de sandbox, entradas internas de
 * Amazon—, y el filtro de participación no las quita. En la cuenta piloto eran
 * cuatro de ocho.
 *
 * El planificador ya se los salta al montar la cola de trabajos, y ESTE es el
 * sitio donde se ve por qué. No se esconden: la otra posibilidad es que sea una
 * tienda real que falta en el catálogo de lib/types/amazon.ts, y entonces el que
 * se está quedando sin ingesta es un cliente de verdad. Un hueco que se ve se
 * arregla; uno que no, no.
 */
function Marketplaces({ conn }: { conn: AmazonConnection }) {
  const [guardando, setGuardando] = useState(false)
  /** Plegado por defecto: la fila enseña dónde se trabaja, no dónde no */
  const [verTodos, setVerTodos] = useState(false)

  /**
   * La elección se guarda AQUÍ y no se sube al estado de la pantalla.
   *
   * Nada más de esta pantalla depende de `marketplaces_activos`: no cambia el
   * recuento de referencias, ni el estado de la conexión, ni el cupo. Subirlo
   * obligaría a enhebrar un callback por tres componentes para que ninguno lo
   * use. Se siembra del servidor y a partir de ahí manda lo local.
   */
  const [elegidos, setElegidos] = useState<string[]>(conn.marketplaces_activos ?? [])

  /**
   * Los que sabemos nombrar PRIMERO, y los demás detrás.
   *
   * No es cosmética: la cuenta conectada hoy tiene ocho mercados y cuatro no
   * están en el catálogo del ERP. Intercalados, los países donde el cliente
   * vende de verdad quedaban escondidos entre identificadores en bruto de
   * catorce caracteres. El orden en que los devuelve Amazon no significa nada.
   */
  const ordenados = useMemo(() => {
    const conocidos = conn.marketplace_ids.filter((id) => marketplaceById(id) !== null)
    const resto = conn.marketplace_ids.filter((id) => marketplaceById(id) === null)
    return [...conocidos, ...resto]
  }, [conn.marketplace_ids])

  /**
   * VACÍO SIGNIFICA TODOS, no ninguno.
   *
   * Es lo que hace que la migración 134 no cambiara nada de lo que ya
   * funcionaba: hasta que alguien elige, se trabaja en todos. Aquí eso se
   * traduce en que, sin elección hecha, TODAS las casillas salen marcadas —que
   * es lo que de verdad está pasando— en vez de todas vacías, que haría pensar
   * que no se está trabajando en ninguna.
   */
  const activos = useMemo(() => {
    if (elegidos.length > 0) return new Set(elegidos)
    return new Set(conn.marketplace_ids.filter((id) => marketplaceById(id) !== null))
  }, [elegidos, conn.marketplace_ids])

  async function alternar(id: string) {
    if (guardando) return
    const siguiente = new Set(activos)
    if (siguiente.has(id)) siguiente.delete(id)
    else siguiente.add(id)

    const conocidos = conn.marketplace_ids.filter((m) => marketplaceById(m) !== null)
    // Si quedan marcados TODOS los que sabemos nombrar, se guarda la lista
    // vacía: es la misma cosa dicha de la forma que no envejece. Si mañana el
    // cliente abre un país nuevo, con la lista vacía entra solo; con la lista
    // completa de hoy se quedaría fuera sin que nadie se entere.
    const todos = conocidos.length > 0 && conocidos.every((m) => siguiente.has(m))
    const mercados = todos ? [] : [...siguiente]

    setGuardando(true)
    try {
      const res = await fetch(`/api/amazon/connections/${conn.id}/mercados`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mercados }),
      })
      const datos = await res.json()
      if (!res.ok) throw new Error(datos?.error ?? 'No se ha podido guardar')
      setElegidos(datos.conexion?.marketplaces_activos ?? mercados)
      toast.success(
        mercados.length === 0
          ? 'Se trabaja en todos sus mercados'
          : `${mercados.length} ${mercados.length === 1 ? 'mercado' : 'mercados'} en uso`
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
    } finally {
      setGuardando(false)
    }
  }

  if (conn.marketplace_ids.length === 0) {
    return <span className={`${TIPO.s} ${TEXTO.t4} shrink-0`}>Países todavía sin leer</span>
  }

  const conocidos = ordenados.filter((id) => marketplaceById(id) !== null)
  const desconocidos = ordenados.filter((id) => marketplaceById(id) === null)
  const encendidos = conocidos.filter((id) => activos.has(id))
  const apagados = conocidos.filter((id) => !activos.has(id))
  const ocultos = apagados.length + desconocidos.length

  function chip(id: string) {
    const porDefecto = id === conn.default_marketplace_id
    const activo = activos.has(id)
    return (
      <button
        key={id}
        type="button"
        disabled={guardando}
        onClick={() => alternar(id)}
        aria-pressed={activo}
        title={
          activo
            ? `Se trabaja en ${marketplaceLabel(id)}. Pulsa para dejar de traer sus datos${porDefecto ? ' (con este se abre el catálogo)' : ''}`
            : `No se traen datos de ${marketplaceLabel(id)}. Pulsa para empezar`
        }
        className={`inline-flex h-[17px] shrink-0 items-center ${RADIO.r1} border px-[5px] text-[10.5px] transition-colors disabled:opacity-60 ${
          activo
            ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] text-[var(--ls-t1)]'
            : `border-dashed ${LINEA.normal} ${TEXTO.t4} hover:${TEXTO.t3}`
        }`}
      >
        {marketplaceLabel(id)}
      </button>
    )
  }

  return (
    <span className="flex flex-wrap items-center gap-[3px] min-w-0">
      {/* SOLO DONDE SE TRABAJA, y todos en naranja.
          Antes salían también los apagados tachados y los de sandbox en ámbar:
          en la cuenta piloto eran ONCE etiquetas para decir que se trabaja en
          UNA. La fila contaba lo que NO se hace, que es la información que no
          se necesita a diario. */}
      {encendidos.map(chip)}

      {encendidos.length === 0 && (
        <span className={`${TIPO.s}`} style={{ color: COLOR_ESTADO.ambar }}>
          Sin ningún mercado activo
        </span>
      )}

      {/* Los apagados y los de sandbox NO desaparecen, se pliegan. Si se
          borraran de la vista no habría forma de volver a encender un país, y
          un mercado de sandbox que en realidad fuera una tienda de verdad que
          falta en el catálogo dejaría a un cliente sin datos en silencio. */}
      {ocultos > 0 && (
        <button
          type="button"
          onClick={() => setVerTodos((v) => !v)}
          className={`inline-flex h-[17px] shrink-0 items-center ${RADIO.r1} border border-dashed ${LINEA.normal} px-[5px] text-[10.5px] ${TEXTO.t4} transition-colors hover:${TEXTO.t3}`}
          title={verTodos ? 'Ocultar los que no se usan' : 'Ver y cambiar los mercados apagados'}
        >
          {verTodos ? 'ocultar' : `+${ocultos}`}
        </button>
      )}

      {verTodos && apagados.map(chip)}

      {verTodos &&
        desconocidos.map((id) => (
          <span
            key={id}
            className={`inline-flex h-[17px] shrink-0 items-center gap-[3px] ${RADIO.r1} border px-[5px] text-[10.5px] ${TIPO.num}`}
            style={{ borderColor: COLOR_ESTADO.ambar, color: COLOR_ESTADO.ambar }}
            title="Este mercado no está en el catálogo del ERP, así que no se programa nada contra él. Suele ser uno de sandbox. Si resultara ser una tienda real donde el cliente vende, hay que darlo de alta o se queda sin datos"
          >
            <AlertTriangle className="h-[11px] w-[11px]" />
            {id}
          </span>
        ))}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas menudas                                                      */
/* ------------------------------------------------------------------ */

/** Una línea de aviso dentro de la fila de una cuenta. Icono además de color */
function Linea({ tono, children }: { tono: TonoEstado; children: React.ReactNode }) {
  return (
    <p
      className={`mt-[3px] flex items-start gap-[5px] ${TIPO.s} leading-[1.45]`}
      style={{ color: COLOR_ESTADO[tono] }}
    >
      <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/**
 * El desplegable de una fila, con su galón dibujado aparte.
 *
 * `appearance-none` quita la flecha nativa —que en cada sistema mide una cosa y
 * se lleva por delante la altura de 22 px— y el galón se pinta encima con
 * `pointer-events-none` para que pinchar en él siga abriendo la lista.
 */
function Selector<T extends string>({
  valor,
  opciones,
  etiquetas,
  onCambio,
  disabled,
  etiquetaAria,
  ancho,
}: {
  valor: T
  opciones: readonly T[]
  etiquetas: Record<T, string>
  onCambio: (valor: T) => void
  disabled?: boolean
  etiquetaAria: string
  ancho: string
}) {
  return (
    <span className={`relative block ${ancho}`}>
      <select
        value={valor}
        disabled={disabled}
        aria-label={etiquetaAria}
        onChange={(e) => {
          const nuevo = e.target.value as T
          if (nuevo !== valor) onCambio(nuevo)
        }}
        className={SELECT_FILA}
      >
        {opciones.map((o) => (
          <option key={o} value={o}>
            {etiquetas[o]}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className={`pointer-events-none absolute right-[4px] top-1/2 h-3 w-3 -translate-y-1/2 ${TEXTO.t4}`}
      />
    </span>
  )
}

/**
 * Un momento en el tiempo, en relativo.
 *
 * Vacío hasta que monta, y no es un capricho: este componente también se
 * renderiza en el servidor para el HTML inicial, y «hace 3 minutos» calculado
 * allí y aquí no dan lo mismo. React avisaría de un fallo de hidratación en cada
 * cuenta.
 */
function Momento({ iso }: { iso: string | null }) {
  const [texto, setTexto] = useState<string | null>(null)
  useEffect(() => setTexto(hace(iso)), [iso])
  return (
    <span title={fechaHora(iso)} className={TIPO.num}>
      {texto ?? '…'}
    </span>
  )
}

/* ================================================================== */
/* LA EXPLICACIÓN ENTERA — detrás del botón de información             */
/* ================================================================== */

export function InfoCuentas() {
  return (
    <>
      <SeccionInfo titulo="Empieza por aquí">
        <p>
          Un cliente no existe para el resto del ERP hasta que tiene una cuenta conectada y un
          modelo de negocio puesto. Todo lo demás —marcas, seguimiento, costes, BSR— cuelga de eso.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Modelo de negocio: la decisión que más pesa">
        <ListaInfo>
          <li>
            <strong>Marca propia</strong> — los ASIN son suyos. El BSR es su termómetro y se mide a
            diario. Suelen ser catálogos cortos.
          </li>
          <li>
            <strong>Arbitraje / reventa</strong> — es uno de quince vendedores sobre el producto de
            otro. El BSR mide el producto, no su cuenta: puede subir mientras él pierde todas sus
            ventas por no tener la Buy Box. Ahí lo que decide es Buy Box y precio.
          </li>
          <li>
            <strong>Mixto</strong> — las dos cosas, que es lo normal en cuanto un revendedor saca su
            propia marca. Se resuelve referencia a referencia según esté marcada como marca propia,
            en la pestaña Marcas. Por eso la columna «Se mide» dice ahí{' '}
            <strong>según cada referencia</strong> y no una cadencia: a nivel de cliente esa
            pregunta no tiene respuesta.
          </li>
        </ListaInfo>
        {/* El ejemplo va SIN nombre de cliente: esta pantalla cuelga de un
            cliente concreto, y meter ahí el tamaño de catálogo de otro es
            justo el borde que el compromiso con Amazon pide no rozar. El
            número ilustra igual de bien sin decir de quién es. */}
        <p>
          El coste de equivocarse es medible: pedirle el BSR a diario a un catálogo de reventa de
          unas 14.000 referencias son cerca de 44.000 llamadas, que a dos por segundo son{' '}
          <strong>seis horas cada noche</strong> midiendo el ranking de productos que no son suyos.
          Los catálogos grandes de la agencia están en ese orden de magnitud, y alguno lo dobla.
        </p>
        <p>
          En arbitraje no se apaga del todo: sin datos de velocidad de venta, el BSR es la única
          señal de rotación que queda para decidir si un FBM merece pasar a FBA. Lo que se quita es
          el barrido diario, no la medición puntual.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Por qué «sin clasificar» no es lo mismo que «mixto»">
        <p>
          Todos los clientes nacen en <strong>mixto</strong> porque es el valor por defecto de la
          base de datos, no porque nadie lo haya decidido. Mientras siga así, el planificador les
          pide el BSR a diario: <strong>hasta que se clasifiquen no se ahorra nada</strong>.
        </p>
        <p>
          Por eso la marca de «sin clasificar» no mira el valor, mira si alguien se ha pronunciado.
          Un cliente que de verdad es mixto deja de aparecer en la lista en cuanto se guarda, y el
          contador de arriba puede llegar a cero. Si contáramos «los que están en mixto», ese aviso
          no se apagaría nunca — y un aviso que no se apaga no lo lee nadie.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="La política de BSR es para la excepción">
        <ListaInfo>
          <li>
            <strong>Según el modelo de negocio</strong> — lo normal. Se deduce de la columna de al
            lado y no hay que tocar nada.
          </li>
          <li>
            <strong>Siempre, a diario</strong> — para el revendedor que está preparando el
            lanzamiento de su marca y quiere el ranking pase lo que pase.
          </li>
          <li>
            <strong>Solo lo que se esté evaluando</strong> — no hay barrido nocturno; el BSR se pide
            desde la ficha del producto cuando alguien lo está mirando.
          </li>
          <li>
            <strong>No medir el BSR</strong> — ni eso. Para el cliente de marca propia con veinte
            mil referencias heredadas que no interesan.
          </li>
        </ListaInfo>
        <p>
          La política gana siempre sobre el modelo: es la excepción que alguien ha puesto a mano.
          Solo cuando dice «según el modelo» se mira la otra columna.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Cómo se conecta una cuenta">
        <p>
          Nosotros no metemos las claves de nadie. Se da de alta el cliente, se genera un enlace de
          consentimiento y es <strong>él</strong> quien entra en su Seller Central y autoriza. A
          partir de ahí guardamos una llave de acceso cifrada, nunca su contraseña.
        </p>
        <p>
          Una autorización cubre una <strong>región entera</strong>: la misma llave vale para
          España, Francia, Italia y Alemania. Estados Unidos es otra región y necesita su propia
          autorización — de ahí el botón «Otra región».
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Una conexión rota no avisa por su cuenta">
        <p>
          Cuando Amazon retira un acceso no llega ningún error: la cuenta simplemente deja de
          refrescarse y sus datos envejecen en silencio, hasta que alguien manda un precio a una
          tienda que ya no nos escucha. Por eso cada cuenta lleva aquí su estado y su último
          refresco.
        </p>
        <p>
          Si una cae en «con problemas» —basta un 403 pasajero— hay un botón para volver a probarla,
          y el servidor no la reactiva a ciegas: si Amazon no contesta, se queda como estaba.
          Desconectar destruye la llave y obliga al cliente a autorizar otra vez: es el último
          recurso, no el primero.
        </p>
        <p>
          Al desconectar, el <strong>historial de cambios se conserva</strong> —con a qué tienda fue
          cada uno— y el espejo del catálogo se borra, porque se vuelve a leer entero en cuanto se
          reconecte.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Países que el ERP no sabe nombrar">
        <p>
          Amazon devuelve como «participa» cosas que no son tiendas de verdad: mercados de sandbox y
          entradas internas suyas. En la cuenta piloto eran cuatro de ocho.
        </p>
        <p>
          Salen aquí en ámbar y con su identificador en bruto. La ingesta{' '}
          <strong>no programa nada contra ellos</strong>, y eso es lo correcto casi siempre. Pero si
          uno de esos es una tienda real donde el cliente vende, lo que pasa es que ese país se
          queda sin ingesta: entonces hay que añadirlo al catálogo de mercados del ERP. Por eso se
          enseñan en vez de ocultarse.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="El tope de 25 autorizaciones">
        <p>
          Mientras la aplicación no esté publicada en el Appstore de Amazon solo admite 25
          autorizaciones en total. Con 16 clientes vamos al 64 % del cupo, y es un tope que se
          alcanza sin previo aviso: la número 26 falla con el cliente delante.
        </p>
        <p>
          Ojo con una cosa: <strong>desconectar desde el ERP no libera la autorización</strong> en
          Amazon. Borra nuestra fila, pero el consentimiento sigue concedido hasta que el vendedor
          nos quite el acceso desde su Seller Central. Creer lo contrario lleva a un estado en el
          que aquí figuran 20 y Amazon rechaza la 21.
        </p>
        <p>
          Cuando la aplicación se publique, este tope desaparece y la pantalla deja de hablar de él
          sola.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Qué hace falta en la base de datos">
        <p>
          Las dos columnas que se editan aquí vienen de{' '}
          <code>123_plataforma_a1.sql</code>, y la marca de «clasificado por alguien» de{' '}
          <code>128_amazon_clientes_clasificacion.sql</code>. Las migraciones se lanzan a mano en el
          editor SQL de Supabase.
        </p>
        <p>
          Sin la 128 la pantalla sigue funcionando y guarda igual: lo único que pierde es poder
          distinguir un «mixto» decidido de uno por defecto, así que da por pendiente a todo el que
          esté en mixto. Al guardar lo avisa una vez.
        </p>
      </SeccionInfo>
    </>
  )
}
