'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart3, Boxes, ClipboardList, Database, GanttChartSquare, LayoutDashboard, Loader2, Package, PackagePlus, Plus, RefreshCcw, Sparkles,
} from 'lucide-react'
import { Boton, EstadoVacio, Pestanas, type Opcion } from '@/components/ui-ls'
import type { PanelRemesas, RemesaDePanel } from '@/lib/fba/datos'
import { esEnvio, esPropuesta } from '@/lib/fba/vista'
import { VistaBaseDeDatos } from '../catalogo/VistaBaseDeDatos'
import type { CallbacksRemesas, ClienteRemesas, SeccionCliente, SesionRemesas } from '../comun/tipos-ui'
import { cx } from '../comun/ui'
import { invalidarRemesas } from '../comun/useAgencia'
import { SeccionEnvios } from '../envios/SeccionEnvios'
import { nuevosDe } from '../envios/useEnviosNuevos'
import { PanelInventario } from '../inventario/PanelInventario'
import { useLeerDeAmazon } from '../inventario/useInventario'
import { VistaLotes } from '../lotes/VistaLotes'
import { SelectorDeCliente } from '../navegacion/SelectorDeCliente'
import { EspacioPropuesta } from '../propuestas/EspacioPropuesta'
import { ListaPropuestas } from '../propuestas/ListaPropuestas'
import { VistaReposicion } from '../reposicion/VistaReposicion'
import { VistaVentas } from '../ventas/VistaVentas'
import { ResumenCliente } from './ResumenCliente'

/**
 * LA VISTA «CLIENTE» DE REMESAS A FBA (`?vista=cliente&cliente=<id>&seccion=<s>`). Spec remesas-pro §1.2, §1.3, §8 y §11 D25, D38, D39, D41.
 *
 * Arriba, el selector de cliente (fila de clientes en el escritorio, hoja con buscador en el móvil) y las acciones del cliente (Importar
 * pedidos, Nueva propuesta, Propuesta a medida (IA)); debajo, las secciones en una segunda fila de `Pestanas`:
 *
 *   resumen · stock · ventas · reposicion (solo agencia) · envios · lotes · propuestas · base (si tiene catálogo, D40)
 *
 * Cada sección pide sus datos ella misma (useAgencia, memoria de 5 min), salvo Envíos y Propuestas, que usan el panel que sirve la página
 * (D25: la página solo lo calcula cuando estás en una de las dos o hay `?remesa=`). Mientras llega, una línea de carga.
 *
 * Propuestas se monta aquí (lista + espacio de la propuesta) con el mismo comportamiento de siempre: las cajas de una propuesta que se está
 * encajando llegan por la URL (`?remesa=`, una vez por propuesta y paso) y, en el móvil, lista y detalle van APILADOS con «← Volver» (D38).
 *
 * Los diálogos (Importar pedidos, Traer envío, Nueva propuesta, Propuesta a medida (IA)) y el panel del envío propuesto los monta UNA vez la
 * carcasa (EspacioRemesas), porque también se abren desde Hoy, Plan, Tablero y Alertas: aquí se piden con `callbacks` y los `on…`.
 *
 *   <EspacioCliente sesion cliente clientes seccion onSeccion onCliente panel remesaAbierta hoy callbacks … />
 */

export interface EspacioClienteProps {
  sesion: SesionRemesas
  cliente: ClienteRemesas
  clientes: readonly ClienteRemesas[]
  seccion: SeccionCliente
  onSeccion: (s: SeccionCliente) => void
  onCliente: (id: string) => void
  /** El cliente que se está cargando (cambio de cliente en curso) */
  cambiando?: string | null
  /** El panel de ESTE cliente, si la página lo ha calculado (Envíos y Propuestas). null = todavía no */
  panel: PanelRemesas | null
  /** La remesa que hay que abrir (`?remesa=` o la que se acaba de crear o enviar) */
  remesaAbierta: string | null
  hoy: string
  callbacks: CallbacksRemesas
  /** Envíos nuevos en Amazon por cliente (useEnviosNuevosDeTodos) */
  enviosNuevos: Record<string, number>
  /** La conexión de Amazon del cliente (solo la recibe un admin: «Leer de Amazon» en Ventas y Reposición) */
  conexionId: string | null
  onNuevaPropuesta: () => void
  onTraer: () => void
  /** Pide al servidor las cajas de una propuesta que se está encajando (router.replace con `?remesa=`) */
  onPedirCajas: (remesaId: string) => void
  /** Una propuesta se ha marcado como enviada: a Envíos con ella abierta */
  onEnviada: (remesaId: string) => void
  /** Se ha elegido otro envío o propuesta en la lista (para recordarlo, sin tocar el servidor) */
  onElegirRemesa?: (remesaId: string | null) => void
}

const SECCION: Record<SeccionCliente, { texto: string; icono: typeof Package }> = {
  resumen: { texto: 'Resumen', icono: LayoutDashboard },
  stock: { texto: 'Stock', icono: Boxes },
  ventas: { texto: 'Ventas', icono: BarChart3 },
  reposicion: { texto: 'Reponer', icono: RefreshCcw },
  envios: { texto: 'Envíos', icono: Package },
  lotes: { texto: 'Lotes', icono: GanttChartSquare },
  propuestas: { texto: 'Propuestas', icono: ClipboardList },
  base: { texto: 'Base de datos', icono: Database },
}

/** Las secciones que ve quien mira, en orden (reposición solo la agencia; base si hay catálogo) */
export function seccionesDe(sesion: Pick<SesionRemesas, 'actor'>, cliente: Pick<ClienteRemesas, 'tieneCatalogo'>): SeccionCliente[] {
  const todas: SeccionCliente[] = ['resumen', 'stock', 'ventas', 'reposicion', 'envios', 'lotes', 'propuestas', 'base']
  return todas.filter((s) => (s !== 'reposicion' || sesion.actor === 'agencia') && (s !== 'base' || cliente.tieneCatalogo))
}

/** ¿Esta sección usa el panel que calcula la página? (D25) */
export const seccionConPanel = (s: SeccionCliente): boolean => s === 'envios' || s === 'propuestas'

export function EspacioCliente({
  sesion,
  cliente,
  clientes,
  seccion,
  onSeccion,
  onCliente,
  cambiando = null,
  panel,
  remesaAbierta,
  hoy,
  callbacks,
  enviosNuevos,
  conexionId,
  onNuevaPropuesta,
  onTraer,
  onPedirCajas,
  onEnviada,
  onElegirRemesa,
}: EspacioClienteProps) {
  const esAgencia = sesion.actor === 'agencia'
  const puedeEditar = cliente.puedeEditar
  const conIa = esAgencia && puedeEditar
  const nuevos = nuevosDe(enviosNuevos, cliente.id, puedeEditar)
  const panelDeEste = panel && panel.clienteId === cliente.id ? panel : null

  // Las cuentas de las pestañas: del panel si está (al día), si no de los contadores de la página
  const cuentas = useMemo(() => {
    if (!panelDeEste) return { envios: cliente.contadores.envios, propuestas: cliente.contadores.propuestas }
    return { envios: panelDeEste.remesas.filter(esEnvio).length, propuestas: panelDeEste.remesas.filter(esPropuesta).length }
  }, [panelDeEste, cliente.contadores])

  const opciones: Array<Opcion<SeccionCliente>> = seccionesDe(sesion, cliente).map((s) => ({
    id: s,
    texto: s === 'stock' && !esAgencia ? 'Mi stock' : SECCION[s].texto,
    icono: SECCION[s].icono,
    ...(s === 'envios' && cuentas.envios > 0 ? { cuenta: cuentas.envios } : {}),
    ...(s === 'propuestas' && cuentas.propuestas > 0 ? { cuenta: cuentas.propuestas } : {}),
  }))

  /**
   * «VOLVER ATRÁS» DESDE ENVÍOS (enviada → lista, D19): la remesa deja de ser un envío y pasa a Propuestas. Tras el `router.refresh()` de la
   * BarraAcciones, si el envío que se estaba mirando aparece ahora como propuesta, se salta a Propuestas con ella abierta (si no, la lista
   * de Envíos la perdía de vista y enseñaba otra). Solo en la TRANSICIÓN: un enlace viejo a una propuesta no mueve a nadie.
   */
  const mirandoEnvio = useRef<string | null>(seccion === 'envios' ? remesaAbierta : null)
  useEffect(() => {
    if (seccion === 'envios' && remesaAbierta) mirandoEnvio.current = remesaAbierta
  }, [seccion, remesaAbierta])
  const estadoAntes = useRef<Map<string, boolean>>(new Map())
  useEffect(() => {
    if (!panelDeEste) return
    const antes = estadoAntes.current
    estadoAntes.current = new Map(panelDeEste.remesas.map((r) => [r.id, esEnvio(r)]))
    if (seccion !== 'envios' || antes.size === 0) return
    const vueltas = panelDeEste.remesas.filter((r) => antes.get(r.id) === true && esPropuesta(r)).map((r) => r.id)
    // La que se miraba; si no se había elegido ninguna (se veía la de por defecto), la única que ha vuelto
    const id = mirandoEnvio.current && vueltas.includes(mirandoEnvio.current) ? mirandoEnvio.current : !mirandoEnvio.current && vueltas.length === 1 ? vueltas[0] : null
    if (id) callbacks.onIrA('cliente', 'propuestas', { cliente: cliente.id, remesa: id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelDeEste])

  const elegirEnvio = (id: string | null) => {
    if (seccion === 'envios') mirandoEnvio.current = id
    onElegirRemesa?.(id)
  }

  // «Leer de Amazon» (solo admin: gasta cupo de informes). Al acabar, la pantalla se vuelve a leer
  const lector = useLeerDeAmazon(cliente.id)
  const leerAmazon = sesion.esAdmin && conexionId ? () => lector.leer(conexionId) : undefined

  const accionesCliente = (
    <>
      {puedeEditar && (
        <Boton
          variante="secundario"
          tamano="sm"
          icono={PackagePlus}
          onClick={() => callbacks.onImportarPedidos(cliente.id)}
          title="Los envíos que Amazon tiene en la cuenta de este cliente y el ERP todavía no: se marcan y se importan de golpe"
        >
          Importar pedidos
          {nuevos > 0 && (
            <span className="ml-1 rounded-full px-[6px] text-[10.5px] font-semibold tabular-nums" style={{ background: 'color-mix(in srgb, var(--ls-e-ambar) 18%, transparent)', color: 'var(--ls-e-ambar)' }}>
              {nuevos}
            </span>
          )}
        </Boton>
      )}
      {puedeEditar && seccion !== 'propuestas' && (
        <Boton variante={conIa ? 'secundario' : 'primario'} tamano="sm" icono={Plus} onClick={onNuevaPropuesta} title="Eliges tú qué mandar, producto a producto">
          Nueva propuesta
        </Boton>
      )}
      {conIa && seccion !== 'propuestas' && (
        <Boton
          variante="primario"
          tamano="sm"
          icono={Sparkles}
          onClick={() => callbacks.onPropuestaAMedida(cliente.id)}
          title="La IA mira el inventario, las ventas y lo que ya va de camino y propone qué mandar. Se revisa antes de crearla"
        >
          Propuesta a medida (IA)
        </Boton>
      )}
    </>
  )
  const hayAcciones = puedeEditar

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ================= CLIENTE Y SUS ACCIONES ================= */}
      {(clientes.length > 1 || hayAcciones) && (
        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
          {clientes.length > 1 ? (
            <SelectorDeCliente clientes={clientes} activo={cliente.id} onElegir={onCliente} cargando={cambiando} nuevos={enviosNuevos} />
          ) : (
            <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--ls-t1)]">{cliente.nombre}</p>
          )}
          {hayAcciones && (
            // En el móvil la fila se desliza de lado dentro de su ancho: nada ensancha la página
            <div className="ls-sin-barra -mx-4 flex min-w-0 items-center gap-2 overflow-x-auto px-4 pb-px sm:mx-0 sm:px-0 lg:shrink-0 lg:overflow-visible">
              {accionesCliente}
            </div>
          )}
        </div>
      )}

      {/* ================= SECCIONES ================= */}
      <Pestanas etiqueta={`Secciones de ${cliente.nombre}`} opciones={opciones} valor={seccion} onCambio={onSeccion} acento="remesas" idPanel="panel-seccion-cliente" />

      <motion.div
        key={`${cliente.id}:${seccion}`}
        id="panel-seccion-cliente"
        role="tabpanel"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className={cx('min-w-0', cambiando && cambiando !== cliente.id && 'opacity-70 transition-opacity')}
      >
        {seccion === 'resumen' && <ResumenCliente sesion={sesion} cliente={cliente} hoy={hoy} callbacks={callbacks} />}
        {seccion === 'stock' && <PanelInventario sesion={sesion} cliente={cliente} hoy={hoy} callbacks={callbacks} />}
        {seccion === 'ventas' && <VistaVentas sesion={sesion} cliente={cliente} onLeerAmazon={leerAmazon} leyendo={lector.leyendo} />}
        {seccion === 'reposicion' && esAgencia && <VistaReposicion sesion={sesion} cliente={cliente} {...callbacks} onLeerAmazon={leerAmazon} leyendo={lector.leyendo} />}
        {seccion === 'lotes' && <VistaLotes clienteId={cliente.id} hoy={hoy} onAbrirEnvio={(remesaId) => callbacks.onIrA('cliente', 'envios', { cliente: cliente.id, remesa: remesaId })} />}
        {seccion === 'base' && cliente.tieneCatalogo && <VistaBaseDeDatos cliente={cliente} sesion={sesion} />}

        {seccionConPanel(seccion) &&
          (!panelDeEste ? (
            <CargandoPanel nombre={cliente.nombre} que={seccion === 'envios' ? 'los envíos' : 'las propuestas'} />
          ) : seccion === 'envios' ? (
            <SeccionEnvios
              cliente={cliente}
              sesion={sesion}
              panel={panelDeEste}
              remesaAbierta={remesaAbierta}
              enviosNuevos={nuevos}
              onImportar={() => callbacks.onImportarPedidos(cliente.id)}
              onTraer={onTraer}
              onElegir={elegirEnvio}
            />
          ) : (
            <SeccionPropuestas
              sesion={sesion}
              cliente={cliente}
              panel={panelDeEste}
              remesaAbierta={remesaAbierta}
              hoy={panelDeEste.hoy}
              onNueva={onNuevaPropuesta}
              onNuevaIa={conIa ? () => callbacks.onPropuestaAMedida(cliente.id) : undefined}
              onPedirCajas={onPedirCajas}
              onEnviada={onEnviada}
              onElegir={onElegirRemesa}
            />
          ))}
      </motion.div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Carga del panel                                                     */
/* ------------------------------------------------------------------ */

function CargandoPanel({ nombre, que }: { nombre: string; que: string }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t3)]">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        Leyendo {que} de {nombre}…
      </p>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]">
        <div className="h-[260px] animate-pulse rounded-[14px] bg-[var(--ls-sup)] motion-reduce:animate-none" />
        <div className="hidden h-[360px] animate-pulse rounded-[14px] bg-[var(--ls-sup)] motion-reduce:animate-none lg:block" />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Propuestas: lista + espacio de la propuesta                          */
/* ------------------------------------------------------------------ */

function SeccionPropuestas({
  sesion,
  cliente,
  panel,
  remesaAbierta,
  hoy,
  onNueva,
  onNuevaIa,
  onPedirCajas,
  onEnviada,
  onElegir,
}: {
  sesion: SesionRemesas
  cliente: ClienteRemesas
  panel: PanelRemesas
  remesaAbierta: string | null
  hoy: string
  onNueva: () => void
  onNuevaIa?: () => void
  onPedirCajas: (remesaId: string) => void
  onEnviada: (remesaId: string) => void
  onElegir?: (remesaId: string | null) => void
}) {
  const propuestas = useMemo(() => panel.remesas.filter(esPropuesta), [panel.remesas])
  const [elegida, setElegida] = useState<string | null>(remesaAbierta)
  // En el móvil, ¿se ve el detalle (y no la lista)? Al llegar con ?remesa= de una propuesta, sí
  const [abierto, setAbierto] = useState<boolean>(() => !!remesaAbierta && propuestas.some((r) => r.id === remesaAbierta))
  const raiz = useRef<HTMLDivElement>(null)
  const scrollDeLaLista = useRef(0)

  // Si cambia la remesa pedida (una nueva recién creada, un enlace), se abre
  useEffect(() => {
    if (!remesaAbierta || !propuestas.some((r) => r.id === remesaAbierta)) return
    setElegida(remesaAbierta)
    setAbierto(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remesaAbierta, propuestas.length])

  /**
   * LA ELEGIDA, DERIVADA Y NO CORREGIDA: si todavía no está en el panel (acaba de crearse y el servidor no ha contestado) se enseña la
   * primera, sin tocar la elección; cuando lleguen los datos, la elegida está ahí y se abre sola.
   */
  const propuesta: RemesaDePanel | null = propuestas.find((r) => r.id === elegida) ?? propuestas[0] ?? null

  // Las cajas de una propuesta que se está encajando llegan por la URL: es lo único que obliga a ir al servidor al elegir una. Se pide UNA
  // vez por propuesta y paso (la clave lo recuerda): si el servidor no las trae, no se queda preguntando en bucle.
  const cajasPedidas = useRef<string | null>(null)
  const clave = propuesta ? `${propuesta.id}:${propuesta.estado}` : null
  const cajasLlegadas = panel.cajasDe?.remesaId ?? null
  useEffect(() => {
    if (!propuesta || !clave) return
    const necesitaCajas = propuesta.estado === 'encajando' || propuesta.estado === 'lista'
    if (!necesitaCajas || cajasLlegadas === propuesta.id || cajasPedidas.current === clave) return
    cajasPedidas.current = clave
    onPedirCajas(propuesta.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, cajasLlegadas])

  // D25: si las propuestas del panel cambian (aprobar, encajar, enviar, borrar…), la memoria de las rutas nuevas de este cliente ya no vale
  const firma = useMemo(() => propuestas.map((r) => `${r.id}:${r.estado}:${r.version ?? ''}`).join('|'), [propuestas])
  const firmaAnterior = useRef(firma)
  useEffect(() => {
    if (firmaAnterior.current === firma) return
    firmaAnterior.current = firma
    invalidarRemesas(cliente.id)
  }, [firma, cliente.id])

  const esMovil = () => typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches

  function elegir(id: string) {
    setElegida(id)
    onElegir?.(id)
    if (!esMovil()) return
    scrollDeLaLista.current = window.scrollY
    setAbierto(true)
    // La ventana sube al principio de la sección (no scrollIntoView: movía también contenedores con scroll)
    requestAnimationFrame(() => {
      const top = raiz.current ? raiz.current.getBoundingClientRect().top + window.scrollY - 72 : 0
      window.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
    })
  }

  function volver() {
    setAbierto(false)
    const y = scrollDeLaLista.current
    requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'auto' }))
  }

  // Sin ninguna: solo la lista, con su estado vacío y sus botones (dos «No hay ninguna propuesta» lado a lado no dicen nada más)
  if (propuestas.length === 0) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-[560px]">
        <ListaPropuestas propuestas={propuestas} sesion={sesion} cliente={cliente} seleccionada={null} onElegir={elegir} hoy={hoy} onNueva={onNueva} onNuevaIa={onNuevaIa} />
      </div>
    )
  }

  return (
    <div ref={raiz} className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:items-start">
      <div className={cx('min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1', abierto && 'hidden lg:block')}>
        <ListaPropuestas
          propuestas={propuestas}
          sesion={sesion}
          cliente={cliente}
          seleccionada={propuesta?.id ?? null}
          onElegir={elegir}
          hoy={hoy}
          onNueva={onNueva}
          onNuevaIa={onNuevaIa}
        />
      </div>

      <section aria-label="Detalle de la propuesta" className={cx('min-w-0', !abierto && 'hidden lg:block', abierto && 'ls-aparecer lg:animate-none')}>
        {propuesta ? (
          <EspacioPropuesta
            key={propuesta.id}
            remesa={propuesta}
            sesion={sesion}
            cliente={cliente}
            cajas={panel.cajasDe?.remesaId === propuesta.id ? panel.cajasDe.datos : null}
            hoy={hoy}
            onEnviada={onEnviada}
            onVolver={volver}
          />
        ) : (
          <div className="rounded-[14px] border border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup)]">
            <EstadoVacio
              icono={ClipboardList}
              acento="remesas"
              titulo="No hay ninguna propuesta"
              descripcion="Se propone qué mandar, el cliente lo aprueba, etiqueta y encaja, y la agencia crea el envío en Amazon. Cuando está enviada pasa a Envíos."
            />
          </div>
        )}
      </section>
    </div>
  )
}
