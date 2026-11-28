'use client'

import { Component, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { motion, MotionConfig } from 'framer-motion'
import { AlertTriangle, BellRing, Loader2, RefreshCw } from 'lucide-react'
import { EstadoVacio } from '@/components/ui-ls'
import type { PanelDeAlertas } from '@/lib/fba/alertas-lectura'
import type { PanelRemesas } from '@/lib/fba/datos'
import { vistaDesdeUrl, type VistaPedida } from '@/lib/fba/vista-url'
import { PanelAlertas } from './alertas/PanelAlertas'
import { EspacioCliente, seccionConPanel, seccionesDe } from './cliente/EspacioCliente'
import type { CallbacksRemesas, ClienteRemesas, IrA, SeccionCliente, SesionRemesas, VistaRemesas } from './comun/tipos-ui'
import { invalidarRemesas } from './comun/useAgencia'
import { ImportarPedidosDialog } from './envios/ImportarPedidosDialog'
import { TraerEnvioDialog } from './envios/TraerEnvioDialog'
import { useEnviosNuevosDeTodos } from './envios/useEnviosNuevos'
import { VistaHoy } from './hoy/VistaHoy'
import { CabeceraRemesas } from './navegacion/CabeceraRemesas'
import { PanelEnvioPropuesto } from './plan/PanelEnvioPropuesto'
import { VistaPlan } from './plan/VistaPlan'
import { NuevaPropuestaDialog } from './propuestas/NuevaPropuestaDialog'
import { PropuestaIaDialog } from './propuestas/PropuestaIaDialog'
import { TableroClientes, type ModoTablero } from './tablero/TableroClientes'
import { MercadoDeImagenes } from '@/components/productos/ImagenDeProducto'
import { PanelDeClientes, VolverATodos, type ClienteDelPanel, type ResumenDelPanel } from '@/components/plataforma/PanelDeClientes'

/**
 * REMESAS A FBA · LA CARCASA (spec remesas-pro §1.2-§1.4 y §11 D25, D37, D38, D39, D41).
 *
 * Ligera a propósito: la cabecera con las vistas, la vista abierta y lo que se abre encima desde cualquier vista. Nada de cálculos.
 *
 *   agencia            Hoy · Plan · Cliente · Tablero · Alertas
 *   cliente de fuera   Mi stock (vista «cliente») y, con varias cuentas, Mis cuentas (tablero reducido, solo envíos, sin salud ni €, D39)
 *
 * ============ LA URL MANDA ============
 * Qué se ve sale SIEMPRE de la URL (`useSearchParams` + `vistaDesdeUrl`, lib/fba/vista-url.ts), con la regla de los enlaces viejos en un solo
 * sitio. Así «Atrás», recargar y pegar un enlace abren lo mismo. Cómo se cambia:
 *   · cambiar de VISTA o de CLIENTE      → `router.push(url, { scroll: false })`: deja historial para «Atrás» (D25).
 *   · cambiar de SECCIÓN, filtros, modo  → `history.replaceState`, sin ir al servidor… salvo que la sección necesite el panel que calcula la
 *                                          página (Envíos y Propuestas) y no esté: entonces `router.replace`.
 *   · tras ESCRIBIR (crear, importar, traer, convertir) → se vacía la memoria del cliente (`invalidarRemesas`), se navega a lo creado y
 *                                          `router.refresh()`: la pantalla se pone al día sin recargar a mano.
 * `/dashboard/remesas/alertas` pinta esta misma carcasa con la vista `alertas` (la ruta lo dice: `usePathname`).
 *
 * ============ LO QUE SE MONTA UNA SOLA VEZ, AQUÍ ============
 * Se abre desde Hoy, Plan, Tablero, Alertas y Cliente, así que vive en la carcasa y las vistas lo piden con `CallbacksRemesas`:
 *   · PanelEnvioPropuesto      (agencia) `?envio=<id>` o `onAbrirEnvioPropuesto`. Al convertir, salta a la remesa nueva en Propuestas.
 *   · PropuestaIaDialog        (agencia que edita) `?ia=1` o `onPropuestaAMedida`.
 *   · ImportarPedidosDialog    `onImportarPedidos` (desde la cabecera del cliente, el aviso de Envíos, las tarjetas de Hoy y el «+N» del tablero).
 *   · TraerEnvioDialog         desde Envíos vacío y desde «Traer uno por su número» de Importar pedidos.
 *   · NuevaPropuestaDialog     «Nueva propuesta» (también el cliente de fuera con `puede_editar`, D39).
 *
 * Fuera la cabina de altura fija (`lg:h-[calc(100vh-4rem)]`): la página crece y hace scroll la ventana también en el escritorio.
 * `MotionConfig reducedMotion="user"`: con «reducir movimiento» las vistas cambian sin deslizarse.
 */

export interface EspacioRemesasProps {
  sesion: SesionRemesas
  clientes: ClienteRemesas[]
  /** El cliente que ha resuelto la página (el de la URL, el de `?remesa=` o el primero) */
  clienteInicial: string
  /** La remesa de `?remesa=` con su estado (para saber si va a Envíos o a Propuestas) */
  remesa: { id: string; estado: string | null } | null
  /** El panel del cliente (solo si la sección lo necesita, D25) */
  panel: PanelRemesas | null
  /** El tablero de alertas (solo en la vista alertas) */
  panelAlertas: PanelDeAlertas | null
  /** Alertas graves abiertas para la insignia. null = no se enseñan (cliente de fuera) */
  alertas: { criticas: number; altas: number } | null
  /** YYYY-MM-DD en Madrid */
  hoy: string
  /** La conexión de Amazon de cada cliente: solo llega a un admin («Leer de Amazon») */
  conexiones: Record<string, string>
  /** «Cliente» sin cliente en la URL (agencia con varios): el panel de todos. null = no toca */
  todos?: { clientes: ClienteDelPanel[]; resumen: ResumenDelPanel[] } | null
}

interface Pantalla {
  vista: VistaRemesas
  seccion: SeccionCliente
  cliente: ClienteRemesas
  modo: ModoTablero
  pedida: VistaPedida
}

const RUTA = '/dashboard/remesas'

/** Las vistas que puede abrir quien mira, en orden */
function vistasDe(sesion: Pick<SesionRemesas, 'actor'>, nClientes: number): VistaRemesas[] {
  if (sesion.actor === 'agencia') return ['hoy', 'plan', 'cliente', 'tablero', 'alertas']
  return nClientes > 1 ? ['cliente', 'tablero'] : ['cliente']
}

export function EspacioRemesas({ sesion, clientes, clienteInicial, remesa, panel, panelAlertas, alertas, hoy, conexiones, todos = null }: EspacioRemesasProps) {
  const router = useRouter()
  const ruta = usePathname() ?? RUTA
  const sp = useSearchParams()
  const [navegando, empezar] = useTransition()
  const [actualizando, empezarActualizar] = useTransition()
  /** El cliente al que se está yendo (late en el selector mientras llega) */
  const [destino, setDestino] = useState<string | null>(null)

  const enRutaAlertas = /\/remesas\/alertas\/?$/.test(ruta)
  const vistas = useMemo(() => vistasDe(sesion, clientes.length), [sesion, clientes.length])
  const clienteDe = useCallback((id: string | null | undefined) => (id ? clientes.find((c) => c.id === id) ?? null : null), [clientes])

  /* ================= QUÉ SE VE: DE LA URL ================= */

  const params = useMemo(() => {
    const o: Record<string, string> = {}
    sp?.forEach((v, k) => {
      if (!(k in o)) o[k] = v
    })
    return o
  }, [sp])

  const pantalla: Pantalla = useMemo(() => {
    const idRemesa = params.remesa ?? null
    const estado = idRemesa ? (panel?.remesas.find((r) => r.id === idRemesa)?.estado ?? (remesa?.id === idRemesa ? remesa.estado : null)) : null
    const pedida: VistaPedida = enRutaAlertas ? { vista: 'alertas', abrirIa: false } : vistaDesdeUrl(params, sesion.actor, estado)
    let vista = pedida.vista
    let seccion: SeccionCliente = pedida.seccion ?? 'resumen'
    if (!vistas.includes(vista)) {
      vista = 'cliente'
      seccion = 'resumen'
    }
    // ACOTADO a la lista, como la página: un id que no esté cae al que resolvió el servidor o al primero
    const cliente = clienteDe(pedida.clienteId) ?? clienteDe(clienteInicial) ?? clientes[0]
    const posibles = seccionesDe(sesion, cliente)
    if (!posibles.includes(seccion)) seccion = seccion === 'base' ? 'envios' : 'resumen'
    return { vista, seccion, cliente, modo: pedida.modo === 'fases' && sesion.actor === 'agencia' ? 'fases' : 'envios', pedida }
  }, [params, panel, remesa, enRutaAlertas, sesion, vistas, clienteDe, clienteInicial, clientes])

  const { vista, seccion, cliente } = pantalla
  /** La agencia con varios clientes tiene el panel de todos en «Cliente» sin cliente en la URL */
  const conPanelDeTodos = sesion.actor === 'agencia' && clientes.length > 1
  const verTodos = conPanelDeTodos && vista === 'cliente' && !params.cliente && !params.remesa
  const panelDeEste = panel && panel.clienteId === cliente.id ? panel : null

  /* ================= NAVEGAR ================= */

  /** La dirección de una pantalla. Con `remesa` y sin sección, la sección la decide el estado de la remesa (vistaDesdeUrl) */
  const urlDe = useCallback(
    (v: VistaRemesas, s: SeccionCliente | undefined, extra: Record<string, string> = {}): string => {
      const p = new URLSearchParams()
      p.set('vista', v)
      if (v === 'cliente') {
        p.set('cliente', extra.cliente ?? cliente.id)
        const conSeccion = s ?? (extra.remesa ? undefined : vista === 'cliente' ? seccion : 'resumen')
        if (conSeccion) p.set('seccion', conSeccion)
      }
      for (const [k, val] of Object.entries(extra)) if (val && !(v === 'cliente' && k === 'cliente')) p.set(k, val)
      return `${RUTA}?${p.toString()}`
    },
    [cliente.id, vista, seccion]
  )

  /** Cambia la URL sin ir al servidor (y sin historial). `null` como estado: así Next sincroniza useSearchParams y el router (14.2) */
  const reemplazarUrl = useCallback((url: string) => {
    window.history.replaceState(null, '', url)
  }, [])

  const irA: IrA = useCallback(
    (v, s, extra = {}) => {
      const url = urlDe(v, s, extra)
      const clienteDestino = v === 'cliente' ? (extra.cliente ?? cliente.id) : null
      const mismaPantalla = !enRutaAlertas && v === vista && (v !== 'cliente' || clienteDestino === cliente.id)
      const seccionDestino = s ?? seccion
      const faltaPanel =
        v === 'cliente' && (seccionConPanel(seccionDestino) || !!extra.remesa) && !(panel && panel.clienteId === clienteDestino)
      const faltaAlertas = v === 'alertas' && !panelAlertas
      if (!mismaPantalla) {
        setDestino(clienteDestino)
        empezar(() => router.push(url, { scroll: false }))
      } else if (faltaPanel || faltaAlertas) {
        empezar(() => router.replace(url, { scroll: false }))
      } else {
        reemplazarUrl(url)
      }
    },
    [urlDe, cliente.id, enRutaAlertas, vista, seccion, panel, panelAlertas, router, reemplazarUrl]
  )

  /** Tras escribir: memoria del cliente fuera, a lo creado, y el servidor vuelve a calcular (la cola del router hace las dos en orden) */
  const irTrasEscribir = useCallback(
    (clienteId: string, s: SeccionCliente, extra: Record<string, string> = {}) => {
      invalidarRemesas(clienteId)
      const url = urlDe('cliente', s, { ...extra, cliente: clienteId })
      const misma = !enRutaAlertas && vista === 'cliente' && clienteId === cliente.id
      setDestino(clienteId)
      empezar(() => {
        if (misma) router.replace(url, { scroll: false })
        else router.push(url, { scroll: false })
        router.refresh()
      })
    },
    [urlDe, enRutaAlertas, vista, cliente.id, router]
  )

  // Si la sección necesita el panel (o la vista, las alertas) y no ha llegado —por ejemplo al volver «Atrás» a una entrada cambiada con
  // replaceState—, se pide UNA vez por dirección
  const pedidoAlServidor = useRef<string | null>(null)
  const necesitaServidor =
    (vista === 'cliente' && seccionConPanel(seccion) && !panelDeEste) ||
    (vista === 'alertas' && sesion.actor === 'agencia' && !panelAlertas)
  const claveDeUrl = `${ruta}?${sp?.toString() ?? ''}`
  useEffect(() => {
    if (!necesitaServidor || navegando) return
    if (pedidoAlServidor.current === claveDeUrl) return
    pedidoAlServidor.current = claveDeUrl
    empezar(() => router.refresh())
  }, [necesitaServidor, navegando, claveDeUrl, router])

  /* ================= LO QUE SE ABRE ENCIMA ================= */

  const [envioAbierto, setEnvioAbierto] = useState<string | null>(() => (sesion.actor === 'agencia' ? (pantalla.pedida.envioId ?? null) : null))
  const envioDeUrl = pantalla.pedida.envioId ?? null
  useEffect(() => {
    if (envioDeUrl && sesion.actor === 'agencia') setEnvioAbierto(envioDeUrl)
  }, [envioDeUrl, sesion.actor])

  /** Quita un parámetro de la URL sin ir al servidor (para que recargar no vuelva a abrir lo que ya se cerró) */
  const quitarDeUrl = useCallback(
    (clave: string) => {
      if (!sp?.has(clave)) return
      const p = new URLSearchParams(sp.toString())
      p.delete(clave)
      // La pantalla se deja explícita: sin `envio`, `?vista=plan` sigue siendo el plan, y sin `ia=1` el cliente sigue en su sección
      if (!enRutaAlertas) {
        p.set('vista', vista)
        if (vista === 'cliente') {
          p.set('cliente', cliente.id)
          p.set('seccion', seccion)
        }
      }
      reemplazarUrl(`${ruta}${p.toString() ? `?${p.toString()}` : ''}`)
    },
    [sp, enRutaAlertas, vista, cliente.id, seccion, ruta, reemplazarUrl]
  )

  const cerrarEnvio = useCallback(() => {
    setEnvioAbierto(null)
    quitarDeUrl('envio')
  }, [quitarDeUrl])

  // «Propuesta a medida (IA)»: de qué cliente. `?ia=1` la abre al llegar (desde una alerta de «reponer ya»)
  const [iaDe, setIaDe] = useState<string | null>(null)
  useEffect(() => {
    if (!pantalla.pedida.abrirIa) return
    if (sesion.actor === 'agencia' && cliente.puedeEditar) setIaDe(cliente.id)
    quitarDeUrl('ia')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pantalla.pedida.abrirIa, cliente.id])

  const [nuevaDe, setNuevaDe] = useState<string | null>(null)
  const [importandoDe, setImportandoDe] = useState<string | null>(null)
  const [trayendoDe, setTrayendoDe] = useState<string | null>(null)
  const [versionTablero, setVersionTablero] = useState(0)

  const hayQueImportar = clientes.some((c) => c.puedeEditar)
  const { porCliente: nuevosPorCliente, refrescar: refrescarNuevos } = useEnviosNuevosDeTodos(hayQueImportar)

  /* ================= LOS CALLBACKS (estables: las vistas los meten en sus efectos) ================= */

  const vivos = useRef({ irA, clienteDe, sesion })
  vivos.current = { irA, clienteDe, sesion }
  const callbacks: CallbacksRemesas = useMemo(
    () => ({
      onAbrirEnvioPropuesto: (id) => {
        if (vivos.current.sesion.actor === 'agencia') setEnvioAbierto(id)
      },
      onIrA: (v, s, extra) => vivos.current.irA(v, s, extra),
      onPropuestaAMedida: (id) => {
        const c = vivos.current.clienteDe(id)
        if (c && vivos.current.sesion.actor === 'agencia' && c.puedeEditar) setIaDe(id)
      },
      onImportarPedidos: (id) => {
        if (vivos.current.clienteDe(id)?.puedeEditar) setImportandoDe(id)
      },
    }),
    []
  )

  const actualizar = useCallback(() => {
    invalidarRemesas()
    refrescarNuevos()
    setVersionTablero((v) => v + 1)
    empezarActualizar(() => router.refresh())
  }, [refrescarNuevos, router])

  /* ================= PINTAR ================= */

  const clienteDelPlan = vista === 'plan' ? (clienteDe(params.cliente)?.id ?? null) : null
  const cargandoCliente = navegando ? destino : null
  const clienteIa = clienteDe(iaDe)
  const clienteNueva = clienteDe(nuevaDe)
  const clienteImportar = clienteDe(importandoDe)
  const clienteTraer = clienteDe(trayendoDe)

  return (
    <MercadoDeImagenes.Provider value="A1RKKUPIHCS9HS">
    <MotionConfig reducedMotion="user">
      <div className="fba-cockpit flex min-w-0 flex-col pb-8 print:pb-0">
        <CabeceraRemesas
          sesion={sesion}
          vista={vista}
          vistas={vistas}
          onVista={(v) => {
            // La pestaña «Cliente» de la agencia abre primero el panel de todos (vista de pájaro); desde él se entra en cada uno
            if (v === 'cliente' && conPanelDeTodos && !verTodos) {
              setDestino(null)
              empezar(() => router.push(`${RUTA}?vista=cliente`, { scroll: false }))
            } else irA(v, v === 'cliente' ? seccion : undefined, v === 'cliente' ? { cliente: cliente.id } : {})
          }}
          alertas={alertas}
          actualizando={actualizando}
          onActualizar={vista === 'hoy' ? undefined : actualizar}
        />

        {/* Entrada suave al cambiar de vista (solo opacidad y 8 px). Sin AnimatePresence alrededor de la página (§6.4): la vista nueva se pinta
            sin esperar a que la vieja salga, y al acabar no queda `transform` en el ancestro de lo `fixed` */}
        <motion.div
            key={vista}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="min-w-0"
          >
            <SiFalla clave={`${vista}:${cliente.id}:${seccion}`} onActualizar={actualizar}>
            {vista === 'hoy' && <VistaHoy sesion={sesion} callbacks={callbacks} />}

            {vista === 'plan' && <VistaPlan sesion={sesion} callbacks={callbacks} clientes={clientes} clienteId={clienteDelPlan} hoy={hoy} />}

            {vista === 'tablero' && (
              <TableroClientes
                sesion={sesion}
                nuevosPorCliente={nuevosPorCliente}
                version={versionTablero}
                onAbrir={(clienteId, remesaId) => irA('cliente', remesaId ? undefined : 'envios', remesaId ? { cliente: clienteId, remesa: remesaId } : { cliente: clienteId })}
                onImportarPedidos={callbacks.onImportarPedidos}
                onAbrirEnvioPropuesto={sesion.actor === 'agencia' ? callbacks.onAbrirEnvioPropuesto : undefined}
                modo={pantalla.modo}
                onCambiarModo={(m) => reemplazarUrl(m === 'fases' ? `${RUTA}?vista=tablero&modo=fases` : `${RUTA}?vista=tablero`)}
                clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre }))}
                onAbrirPropuesta={(t) => irA('cliente', 'propuestas', { cliente: t.clienteId, remesa: t.id })}
              />
            )}

            {vista === 'alertas' &&
              (panelAlertas ? (
                <PanelAlertas panel={panelAlertas} esAdmin={sesion.esAdmin} sesion={sesion} incrustado onAbrirEnvioPropuesto={callbacks.onAbrirEnvioPropuesto} />
              ) : navegando || necesitaServidor ? (
                <p className="flex items-center gap-2 py-6 text-[12.5px] text-[var(--ls-t3)]" role="status">
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                  Leyendo las alertas…
                </p>
              ) : (
                <EstadoVacio icono={BellRing} acento="remesas" titulo="No se han podido leer las alertas" descripcion="Pulsa «Actualizar» para volver a probar." />
              ))}

            {vista === 'cliente' && verTodos && todos && (
              <PanelDeClientes titulo="Clientes" icono="remesas" incrustado yoId={sesion.usuarioId} clientes={todos.clientes} resumen={todos.resumen} />
            )}

            {vista === 'cliente' && verTodos && !todos && (
              <p className="flex items-center gap-2 py-6 text-[12.5px] text-[var(--ls-t3)]" role="status">
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                Leyendo los clientes…
              </p>
            )}

            {vista === 'cliente' && !verTodos && conPanelDeTodos && <VolverATodos href={`${RUTA}?vista=cliente`} />}

            {vista === 'cliente' && !verTodos && (
              <EspacioCliente
                sesion={sesion}
                cliente={cliente}
                clientes={clientes}
                seccion={seccion}
                onSeccion={(s) => irA('cliente', s, { cliente: cliente.id })}
                onCliente={(id) => irA('cliente', seccion, { cliente: id })}
                cambiando={cargandoCliente}
                panel={panelDeEste}
                remesaAbierta={params.remesa ?? null}
                hoy={hoy}
                callbacks={callbacks}
                enviosNuevos={nuevosPorCliente}
                conexionId={sesion.esAdmin ? (conexiones[cliente.id] ?? null) : null}
                onNuevaPropuesta={() => setNuevaDe(cliente.id)}
                onTraer={() => setTrayendoDe(cliente.id)}
                onPedirCajas={(remesaId) => empezar(() => router.replace(urlDe('cliente', 'propuestas', { cliente: cliente.id, remesa: remesaId }), { scroll: false }))}
                onEnviada={(remesaId) => irTrasEscribir(cliente.id, 'envios', { remesa: remesaId })}
              />
            )}
            </SiFalla>
          </motion.div>

        {/* ================= ENCIMA: UNA VEZ PARA TODAS LAS VISTAS ================= */}

        {sesion.actor === 'agencia' && (
          <PanelEnvioPropuesto
            envioId={envioAbierto}
            onCerrar={cerrarEnvio}
            onConvertida={(remesaId, clienteId) => {
              setEnvioAbierto(null)
              // Salta a la remesa nueva en Propuestas (la URL nueva ya no lleva `envio`)
              irTrasEscribir(clienteId, 'propuestas', { remesa: remesaId })
            }}
            usuarioId={sesion.usuarioId}
            esAdmin={sesion.esAdmin}
            puedeEditar={sesion.esAgencia}
            hoy={hoy}
          />
        )}

        {clienteIa && sesion.actor === 'agencia' && clienteIa.puedeEditar && (
          <PropuestaIaDialog
            sesion={sesion}
            cliente={clienteIa}
            hoy={hoy}
            onCerrar={() => setIaDe(null)}
            onCreada={(id) => {
              const de = clienteIa.id
              setIaDe(null)
              irTrasEscribir(de, 'propuestas', { remesa: id })
            }}
          />
        )}

        {clienteNueva && clienteNueva.puedeEditar && (
          <NuevaPropuestaDialog
            sesion={sesion}
            cliente={clienteNueva}
            onCerrar={() => setNuevaDe(null)}
            onCreada={(id) => {
              const de = clienteNueva.id
              setNuevaDe(null)
              irTrasEscribir(de, 'propuestas', { remesa: id })
            }}
          />
        )}

        {clienteImportar && (
          <ImportarPedidosDialog
            clienteId={clienteImportar.id}
            clienteNombre={clienteImportar.nombre}
            conPropuestasListas={panelDeEste?.clienteId === clienteImportar.id ? panelDeEste.remesas.some((r) => r.estado === 'lista') : (clienteImportar.contadores.listas ?? 0) > 0}
            onCerrar={() => setImportandoDe(null)}
            onManual={() => {
              const de = clienteImportar.id
              setImportandoDe(null)
              setTrayendoDe(de)
            }}
            onImportados={(ids) => {
              const de = clienteImportar.id
              refrescarNuevos()
              setVersionTablero((v) => v + 1)
              // Se abre el primero importado en su cliente (aunque el diálogo se abriera desde Hoy o el tablero)
              irTrasEscribir(de, 'envios', ids[0] ? { remesa: ids[0] } : {})
            }}
          />
        )}

        {clienteTraer && clienteTraer.puedeEditar && (
          <TraerEnvioDialog
            clienteId={clienteTraer.id}
            clienteNombre={clienteTraer.nombre}
            marketplaceId={clienteTraer.mercadoRemesa}
            onCerrar={() => setTrayendoDe(null)}
            onTraido={(id) => {
              const de = clienteTraer.id
              setTrayendoDe(null)
              refrescarNuevos()
              irTrasEscribir(de, 'envios', { remesa: id })
            }}
          />
        )}
      </div>
    </MotionConfig>
    </MercadoDeImagenes.Provider>
  )
}

/* ------------------------------------------------------------------ */
/* Si una vista falla al pintarse                                      */
/* ------------------------------------------------------------------ */

/**
 * Una vista que revienta al pintarse (un dato con una forma inesperada) no deja en blanco el módulo entero: la cabecera sigue ahí para
 * cambiar de vista o de cliente, y se puede volver a probar. Se reinicia sola al cambiar de vista, cliente o sección (`clave`).
 */
class SiFalla extends Component<{ clave: string; onActualizar: () => void; children: ReactNode }, { error: string | null; clave: string }> {
  state = { error: null as string | null, clave: this.props.clave }

  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) }
  }

  static getDerivedStateFromProps(props: { clave: string }, state: { error: string | null; clave: string }) {
    return props.clave !== state.clave ? { error: null, clave: props.clave } : null
  }

  componentDidCatch(e: unknown) {
    console.error('[Remesas] Una vista ha fallado al pintarse', e)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="rounded-[14px] border border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup)]">
        <EstadoVacio
          icono={AlertTriangle}
          acento="remesas"
          titulo="Esta pantalla no se ha podido pintar"
          descripcion={`Prueba a actualizar o cambia de vista; el resto de Remesas sigue funcionando. (${this.state.error.slice(0, 160)})`}
          accion={{
            texto: 'Volver a probar',
            icono: RefreshCw,
            onClick: () => {
              this.setState({ error: null })
              this.props.onActualizar()
            },
          }}
        />
      </div>
    )
  }
}
