'use client'

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { AmazonView, PerfilesVista } from '@/lib/amazon/client'
import { BOTON, PANTALLA, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { Aviso, Dialogo } from '@/components/plataforma/comun'
import { BotonInfo, ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import {
  PARAM_PESTANA,
  PESTANAS,
  pestanaDesdeUrl,
  type PestanaId,
} from './pestanas'
import type { PropsPanel } from './tipos'

import { PanelBsr, InfoBsr } from './paneles/PanelBsr'
import { PanelCatalogo, InfoCatalogo } from './paneles/PanelCatalogo'
import { PanelCostes, InfoCostes } from './paneles/PanelCostes'
import { PanelCuentas, InfoCuentas } from './paneles/PanelCuentas'
import { PanelIngesta, InfoIngesta } from './paneles/PanelIngesta'
import { PanelSistema, InfoSistema } from './paneles/PanelSistema'
import { PanelMarcas, InfoMarcas } from './paneles/PanelMarcas'
import { PanelOrigen, InfoOrigen } from './paneles/PanelOrigen'
import { PanelSeguimiento, InfoSeguimiento } from './paneles/PanelSeguimiento'

/**
 * LA CARCASA DE AMAZON API — LAS TRIPAS DE TODO.
 *
 * Ocho pestañas sobre una sola idea: aquí se configura con qué va a trabajar la
 * agencia en la cuenta de cada cliente, y aquí se ve toda la información que
 * guardamos de sus productos y de sus cuentas. Trabajar sobre esa cuenta es el
 * otro módulo, Growth Partner.
 *
 *
 * ============ AÑADIR UNA PESTAÑA SON DOS LÍNEAS ============
 *
 * Una entrada en PESTANAS (pestanas.ts) y una entrada en PANELES (aquí abajo).
 * Nada más. Si algún día hace falta tocar el resto de este fichero para meter
 * una pestaña, es que la carcasa se ha estropeado y hay que arreglarla, no
 * rodearla.
 *
 * Cada panel vive en SU fichero y exporta dos cosas: el panel y su texto de
 * información. Los dos juntos para que quien escriba la pantalla escriba también
 * su explicación, sin tener que venir aquí a pelearse con siete agentes más.
 *
 *
 * ============ POR QUÉ LAS PESTAÑAS NO SON NAVEGACIÓN DE VERDAD ============
 *
 * Cambiar de pestaña NO es un `<Link>`: es estado de React más un
 * `history.replaceState`. Dos motivos, los dos medidos:
 *
 *   1. EL GUARDIÁN DE LOS CAMBIOS SIN ENVIAR. Las ediciones de precio y stock
 *      del catálogo viven en memoria. Con navegación de verdad, el cambio de
 *      pestaña no se puede interceptar y desaparecerían sin decir nada. Con
 *      estado, pasa por `alSalir` igual que el cambio de cliente.
 *   2. La página es `force-dynamic` y carga las conexiones y el recuento de
 *      referencias de las 16 cuentas. Un `<Link>` a la misma ruta rehace ese
 *      trabajo en el servidor CADA vez que se pincha una pestaña.
 *
 * Y aun así la pestaña VA EN LA URL —`?p=catalogo`— para que se pueda enlazar
 * por chat y para que volver a la página caiga donde estabas. `replaceState` y
 * no `pushState` a propósito: con `pushState`, salir del módulo después de mirar
 * seis pestañas cuesta seis pulsaciones del botón de atrás.
 */

/**
 * LA PESTAÑA -> SU PANEL Y SU INFORMACIÓN.
 *
 * `Record<PestanaId, …>` y no un objeto suelto: si mañana se añade un id a
 * PESTANAS y se olvida el panel, esto DEJA DE COMPILAR. Con un objeto normal, la
 * pestaña se pintaría y al pulsarla no habría nada, sin dar ningún error.
 */
const PANELES: Record<
  PestanaId,
  { Panel: ComponentType<PropsPanel>; Info: ComponentType }
> = {
  cuentas: { Panel: PanelCuentas, Info: InfoCuentas },
  catalogo: { Panel: PanelCatalogo, Info: InfoCatalogo },
  marcas: { Panel: PanelMarcas, Info: InfoMarcas },
  seguimiento: { Panel: PanelSeguimiento, Info: InfoSeguimiento },
  costes: { Panel: PanelCostes, Info: InfoCostes },
  origen: { Panel: PanelOrigen, Info: InfoOrigen },
  bsr: { Panel: PanelBsr, Info: InfoBsr },
  ingesta: { Panel: PanelIngesta, Info: InfoIngesta },
  sistema: { Panel: PanelSistema, Info: InfoSistema },
}

export function Carcasa({
  initialData,
  perfiles,
  configError,
  appDraft,
  pestanaInicial,
}: {
  initialData: AmazonView
  perfiles: PerfilesVista | null
  configError: string | null
  appDraft: boolean
  /** La que dice la URL, ya validada en el servidor */
  pestanaInicial: PestanaId
}) {
  const [data, setData] = useState<AmazonView>(initialData)
  const [pestana, setPestana] = useState<PestanaId>(pestanaInicial)
  /** La conexión elegida. Compartida por las ocho pestañas; ver PropsPanel */
  const [conexionId, setConexionId] = useState<string | null>(null)

  /** Cuántas ediciones sin enviar hay ahora mismo, y de qué cliente */
  const [pendientes, setPendientes] = useState<{ n: number; cliente: string }>({
    n: 0,
    cliente: '',
  })
  /** Lo que se iba a hacer cuando se descubrió que había cambios sin enviar */
  const [salidaBloqueada, setSalidaBloqueada] = useState<null | { accion: () => void }>(null)

  /**
   * La última pestaña que hemos escrito en la URL.
   *
   * Sirve para distinguir «he cambiado yo de pestaña» de «ha llegado una
   * navegación de verdad con otra `?p=`»: sin esto, el efecto de abajo pisaría
   * la pestaña recién elegida en cuanto React repintara con el mismo prop.
   */
  const ultimaUrl = useRef<PestanaId>(pestanaInicial)

  useEffect(() => {
    if (ultimaUrl.current === pestanaInicial) return
    ultimaUrl.current = pestanaInicial
    setPestana(pestanaInicial)
  }, [pestanaInicial])

  /**
   * ATRÁS Y ADELANTE DEL NAVEGADOR.
   *
   * El efecto de arriba solo mira el prop del SERVIDOR, y con `replaceState` ese
   * prop no cambia: la entrada que Next guarda en su caché del router es la que
   * se renderizó, o sea la de `?p=` vacío. Resultado medido: pestaña BSR ->
   * Atrás -> Adelante devolvía la dirección `?p=bsr` pero marcaba «Cuentas». La
   * dirección mentía sobre lo que había debajo, que es justo lo que el
   * `replaceState` quería evitar.
   *
   * Se lee de `location` y no del prop porque en un `popstate` la URL ya es la
   * buena y el prop todavía no.
   */
  useEffect(() => {
    const alVolver = () => {
      const id = pestanaDesdeUrl(new URL(window.location.href).searchParams.get(PARAM_PESTANA))
      ultimaUrl.current = id
      setPestana(id)
    }
    window.addEventListener('popstate', alVolver)
    return () => window.removeEventListener('popstate', alVolver)
  }, [])

  /**
   * Cambia de pestaña y lo deja escrito en la dirección.
   *
   * `history.replaceState` y no el router: el router volvería al servidor a
   * recargar las conexiones de las 16 cuentas para pintar la misma pantalla.
   */
  const aplicarPestana = useCallback((id: PestanaId) => {
    setPestana(id)
    ultimaUrl.current = id
    const url = new URL(window.location.href)
    url.searchParams.set(PARAM_PESTANA, id)
    window.history.replaceState(window.history.state, '', url)
  }, [])

  /**
   * Cualquier cosa que desmonte el catálogo, preguntando antes.
   *
   * Se pregunta en vez de guardar por debajo porque un cambio de precio guardado
   * a medias, que reaparece días después cuando ya no viene a cuento, es peor
   * que perderlo.
   */
  const alSalir = useCallback(
    (accion: () => void) => {
      if (pendientes.n > 0) {
        setSalidaBloqueada({ accion })
        return
      }
      accion()
    },
    [pendientes.n]
  )

  /**
   * useCallback CON LISTA VACÍA, Y NO ES UN ADORNO: esta función baja hasta el
   * panel del catálogo, que la usa dentro de un efecto. Si cambiara de identidad
   * en cada render, el efecto se dispararía en bucle.
   */
  const onPendientes = useCallback((n: number, cliente: string) => {
    setPendientes((prev) => (prev.n === n && prev.cliente === cliente ? prev : { n, cliente }))
  }, [])

  function confirmarSalida() {
    const accion = salidaBloqueada?.accion
    setSalidaBloqueada(null)
    setPendientes({ n: 0, cliente: '' })
    accion?.()
  }

  const { Panel, Info } = PANELES[pestana]
  const actual = PESTANAS.find((p) => p.id === pestana)

  const propsPanel: PropsPanel = {
    data,
    onData: setData,
    conexionId,
    onConexionId: setConexionId,
    perfiles,
    configError,
    appDraft,
    alSalir,
    onPendientes,
  }

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      {/* -------- Cabecera: título, pestañas y el botón de información -------- */}
      <div
        // El hueco de la derecha es para la barra FIJA del layout —el cambio de
        // tema y la campana de avisos—, que va en `fixed … right-16 lg:right-20
        // z-50` y flota POR ENCIMA de esta fila. Sin reservarlo, el contador de
        // «N sin enviar» quedaba literalmente debajo del icono de la campana:
        // justo el aviso que sí es accionable y el único que se deja en pantalla.
        // El layout no se toca, que lo comparten los treinta módulos.
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-[6px] min-w-0 lg:pr-36"
      >
        <h1 className={`${TITULO.pantalla} shrink-0`}>Amazon API</h1>

        <nav className="flex flex-wrap items-center gap-[4px] min-w-0" role="tablist" aria-label="Pestañas de Amazon API">
          {PESTANAS.map((p) => {
            const Icono = p.icono
            const activa = p.id === pestana
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={activa}
                title={p.pista}
                onClick={() => {
                  if (activa) return
                  // Solo el catálogo tiene nada que perder, pero el guardián se
                  // pone SIEMPRE: el día que otra pestaña guarde algo en
                  // memoria, ya está protegida sin que nadie se acuerde.
                  alSalir(() => aplicarPestana(p.id))
                }}
                className={`${BOTON.chip} ${activa ? BOTON.chipEncendido : ''}`}
              >
                <Icono className="h-[13px] w-[13px] shrink-0" />
                {p.nombre}
              </button>
            )
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-[6px]">
          {/* Los cambios sin enviar se dicen SIEMPRE, en la cabecera y en todas
              las pestañas: es lo único de esta pantalla que se pierde al
              recargar, y quien se ha ido a mirar los costes no se acuerda. */}
          {pendientes.n > 0 && (
            <span className={`${TIPO.xs} ${TEXTO.acento} tabular-nums`}>
              {pendientes.n} sin enviar
            </span>
          )}
          <BotonInfo titulo={actual ? `Amazon API · ${actual.nombre}` : 'Amazon API'}>
            <InfoModulo />
            <Info />
          </BotonInfo>
        </div>
      </div>

      {/* El servidor a medio configurar SÍ se queda en pantalla: es accionable y
          sin ello la mitad de las pestañas fallan sin explicar por qué. */}
      {configError && (
        <div className="shrink-0">
          <Aviso tono="rojo" icono={AlertTriangle}>
            <span className="font-semibold text-[var(--ls-t1)]">
              El servidor no está configurado del todo.
            </span>{' '}
            {configError}
          </Aviso>
        </div>
      )}

      <div className="flex-1 min-h-0 min-w-0">
        <Panel {...propsPanel} />
      </div>

      {salidaBloqueada && (
        <Dialogo
          titulo="Tienes cambios sin enviar"
          entradilla={`${pendientes.n} ${pendientes.n === 1 ? 'cambio' : 'cambios'} en ${pendientes.cliente}`}
          onCerrar={() => setSalidaBloqueada(null)}
          pie={
            <>
              <button
                type="button"
                onClick={() => setSalidaBloqueada(null)}
                className={`${BOTON.base} ${BOTON.primario}`}
              >
                Quedarme y revisarlos
              </button>
              <button
                type="button"
                onClick={confirmarSalida}
                className={`${BOTON.base} ${BOTON.secundario}`}
              >
                Salir y perderlos
              </button>
            </>
          }
        >
          <p className={`${TIPO.s} ${TEXTO.t2}`}>
            Si te vas se pierden: todavía no han salido hacia Amazon y no se guardan en ningún
            sitio.
          </p>
        </Dialogo>
      )}
    </div>
  )
}

/**
 * Lo que hay que saber del módulo entero, delante de la explicación de cada
 * pestaña. Se repite en las ocho a propósito: es el corte que decide dónde está
 * cada cosa, y es la pregunta que se hace todo el mundo la primera semana.
 */
function InfoModulo() {
  return (
    <SeccionInfo titulo="Qué es Amazon API y qué no">
      <p>
        Son <strong>las tripas</strong>: aquí se configura con qué vamos a trabajar en la cuenta de
        cada cliente y aquí se ve toda la información que guardamos de sus productos y sus cuentas.
      </p>
      <p>
        La regla que decide dónde está cada pantalla:{' '}
        <strong>configurar va aquí, trabajar va en Growth Partner</strong>. De dónde llega el
        fichero de un cliente se configura aquí; sincronizarlo de verdad se hace allí. Qué marcas
        son suyas se decide aquí; el análisis FBM→FBA que usa esa marca se hace allí.
      </p>
      <ListaInfo>
        <li>
          Las ocho pestañas están en el orden en el que hay que rellenarlas para que un cliente
          nuevo quede operativo.
        </li>
        <li>
          La pestaña se queda escrita en la dirección, así que este enlace se puede pasar por chat
          y cae donde estás ahora.
        </li>
      </ListaInfo>
    </SeccionInfo>
  )
}
