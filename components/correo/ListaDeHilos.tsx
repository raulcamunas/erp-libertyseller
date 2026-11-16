'use client'

import * as Menu from '@radix-ui/react-dropdown-menu'
import { motion, MotionConfig } from 'framer-motion'
import { AlertTriangle, ArrowLeft, BellOff, Check, ChevronDown, Inbox, MailPlus, PartyPopper, PenSquare, Search, SearchX, UserCheck, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Boton, FOCO, TACTIL } from '@/components/ui-ls/Boton'
import { EstadoVacio, type AccionDeVacio } from '@/components/ui-ls/EstadoVacio'
import { Segmentado } from '@/components/ui-ls/Pestanas'
import type { BuzonVisible, ResumenDeBuzon, VistaDeCorreo } from '@/lib/correo/tipos'
import { cn } from '@/lib/utils'
import type { ModoDeLista, PropsDeListaDeHilos } from './contratos'
import { FilaDeHilo } from './FilaDeHilo'
import { buscandoDe, estadoDeFiltro, filtrarEnCliente, idsAnimados, segmentoActivo, tituloDeModo, vacioDeLista, VISTAS_DE_MAS, type Segmento, type TipoDeVacio } from './lista-de-hilos'
import { FilaEsqueleto, FilasEsqueleto } from './piezas'

/**
 * LA LISTA DE HILOS (columna 2 en el ordenador; nivel «Lista» en el móvil). Spec 1.2, 1.4, 1.5, 1.6, 5 y 9.8.
 *
 * Una fila es un HILO, no un correo. Arriba: buscador (en el móvil detrás de la lupa de la cabecera pegajosa), el segmentado Todos ·
 * Sin leer · Pendientes y el menú «Más» (Destacados, Enviados, Recibidos). La búsqueda YA NO esconde los filtros: se aplican en el cliente
 * sobre los resultados. En «Mis correos», el chip «Ocultar silenciados» (no se recuerda; por defecto salen atenuados).
 *
 * El scroll infinito: un IntersectionObserver a 600 px del final pide la página siguiente; «Ver más antiguos» se queda de respaldo.
 * En el ordenador y la tableta la lista tiene su propio scroll; en el móvil hace scroll la página (sin caja de altura fija) y el
 * observador mira la ventana.
 */

/**
 * Las Props del contrato y, para no romper el PanelCorreo de hoy (oleada 4 lo cambia), lo que aún pasa con su nombre viejo.
 * Lo nuevo del contrato que PanelCorreo todavía no manda es opcional AQUÍ, con un valor por defecto que se porta como hoy.
 * Extras opcionales de esta pieza (W4 puede subirlos a contratos.ts): `titulo`, `onAtras`, `onRedactar` y `sinBuscador`.
 */
type Nuevas = 'onCargarMas' | 'modo' | 'buzonesPorId' | 'onSilenciar' | 'onAlternarLeido' | 'onDestacar' | 'nuevos' | 'ocultarSilenciados' | 'onOcultarSilenciados'
export type PropsDeLista = Omit<PropsDeListaDeHilos, Nuevas> &
  Partial<Pick<PropsDeListaDeHilos, Nuevas>> & {
    /** @deprecated El nombre viejo de onCargarMas (PanelCorreo de hoy) */
    onMas?: () => void
    /** Título de la cabecera pegajosa del móvil. Por defecto: «Mis correos», «Asignados a mí» o «Correo» */
    titulo?: string
    /** «←» de la cabecera del móvil: volver al nivel Carpetas. Sin él no sale */
    onAtras?: () => void
    /** ✎ de la cabecera del móvil (44 px). Sin él no sale */
    onRedactar?: () => void
    /** La cabecera del ordenador ya tiene el buscador: desde md no se pinta aquí (en el móvil sigue detrás de la lupa) */
    sinBuscador?: boolean
  }

const SIN_NUEVOS: ReadonlySet<string> = new Set()
const SIN_BUZONES: ReadonlyMap<string, BuzonVisible> = new Map()
const nada = () => {}
const numero = (n: number) => n.toLocaleString('es-ES')

const ICONO_DE_VACIO: Record<TipoDeVacio, typeof Inbox> = { 'sin-elegir': MailPlus, asignados: UserCheck, busqueda: SearchX, filtro: PartyPopper, vacio: Inbox }

const NOMBRE_DE_VISTA: Record<VistaDeCorreo, string> = { todos: 'Todos', recibidos: 'Recibidos', enviados: 'Enviados', destacados: 'Destacados', pendientes: 'Pendientes' }

const OPCION_DE_MENU =
  'flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] text-[var(--ls-t1)] outline-none data-[highlighted]:bg-[var(--ls-sup3)] lg:min-h-9 lg:text-[13px]'

/** ¿El contenedor tiene scroll propio? (desde md sí; en el móvil hace scroll la página) */
function tieneScrollPropio(el: HTMLElement | null): boolean {
  if (!el || typeof window === 'undefined') return false
  const o = window.getComputedStyle(el).overflowY
  return o === 'auto' || o === 'scroll'
}

/** Escucha si estamos desde md (768 px): cambia quién hace scroll, y con ello la raíz del observador */
function useDesdeMd(): boolean {
  const [si, setSi] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(min-width: 768px)')
    const leer = () => setSi(mq.matches)
    leer()
    mq.addEventListener?.('change', leer)
    return () => mq.removeEventListener?.('change', leer)
  }, [])
  return si
}

function Buscador({ valor, onCambio, modo, autoFoco, onCerrar }: { valor: string; onCambio: (t: string) => void; modo: ModoDeLista; autoFoco?: boolean; onCerrar?: () => void }) {
  const sitio = modo === 'mios' ? 'Mis correos' : modo === 'asignados' ? 'Asignados a mí' : 'este buzón'
  return (
    <label className="relative block">
      <span className="sr-only">Buscar en {sitio}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
      <input
        type="search"
        value={valor}
        autoFocus={autoFoco}
        onChange={(e) => onCambio(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && valor) {
            e.stopPropagation()
            onCambio('')
          }
        }}
        placeholder={`Buscar en ${sitio}…`}
        enterKeyHint="search"
        data-buscador-correo=""
        className={cn(
          'h-11 w-full rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-9 pr-10 text-base text-[var(--ls-t1)] outline-none transition-[border-color,box-shadow]',
          'placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ls-acc-graf)_22%,transparent)]',
          'lg:h-9 lg:text-[13.5px] [&::-webkit-search-cancel-button]:hidden',
        )}
      />
      {(valor || onCerrar) && (
        <button
          type="button"
          onClick={() => {
            if (valor) onCambio('')
            else onCerrar?.()
          }}
          aria-label={valor ? 'Borrar la búsqueda' : 'Cerrar el buscador'}
          className={cn('absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[8px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)] lg:h-7 lg:w-7', FOCO)}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </label>
  )
}

/** «Trayendo correos antiguos · faltan N» con una barra que va y viene (quieta si se pide menos movimiento) */
function FranjaDeImportacion({ quedan }: { quedan: number }) {
  return (
    <div role="status" className="border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-4 py-1.5">
      <p className="text-[12px] text-[var(--ls-t3)]">
        Trayendo correos antiguos · faltan <span className="tabular-nums">{numero(quedan)}</span>
      </p>
      <div aria-hidden className="relative mt-1 h-[3px] overflow-hidden rounded-full bg-[var(--ls-sup3)]">
        <motion.span
          className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-[var(--ls-acc-graf)]"
          initial={{ x: '-100%' }}
          animate={{ x: '300%' }}
          transition={{ duration: 1.4, ease: 'easeInOut', repeat: Infinity }}
        />
      </div>
    </div>
  )
}

export function ListaDeHilos(props: PropsDeLista) {
  const {
    hilos,
    cargando,
    cargandoMas,
    hayMas,
    seleccionado,
    onElegir,
    vista,
    onVista,
    soloNoLeidos,
    onSoloNoLeidos,
    busqueda,
    onBusqueda,
    resumen,
    importando,
    error,
    modo = 'buzon',
    buzonesPorId = SIN_BUZONES,
    onSilenciar = nada,
    onAlternarLeido = nada,
    onDestacar = nada,
    nuevos = SIN_NUEVOS,
    ocultarSilenciados = false,
    onOcultarSilenciados,
    onAsignar,
    esAdmin = false,
    onElegirMisCorreos,
    onResumen,
    onBuscarEnTodos,
    titulo,
    onAtras,
    onRedactar,
    sinBuscador,
  } = props
  const onCargarMas = props.onCargarMas ?? props.onMas ?? nada

  const desdeMd = useDesdeMd()
  const [lupaAbierta, setLupaAbierta] = useState(false)
  const buscadorMovil = lupaAbierta || busqueda !== ''
  const buscando = buscandoDe(busqueda)

  const visibles = useMemo(
    () => filtrarEnCliente(hilos, { busqueda, vista, soloNoLeidos, ocultarSilenciados, modo, seleccionado }),
    [hilos, busqueda, vista, soloNoLeidos, ocultarSilenciados, modo, seleccionado],
  )
  const animadas = useMemo(() => idsAnimados(visibles, nuevos), [visibles, nuevos])
  const hayMisBuzones = useMemo(() => {
    for (const b of buzonesPorId.values()) if (b.enMisCorreos) return true
    return false
  }, [buzonesPorId])

  /* ---------- Filtros ---------- */
  function aplicar(eleccion: Segmento | VistaDeCorreo) {
    const e = estadoDeFiltro(eleccion)
    if (e.vista !== vista) onVista(e.vista)
    if (e.soloNoLeidos !== soloNoLeidos) onSoloNoLeidos(e.soloNoLeidos)
  }
  function quitarFiltros() {
    if (vista !== 'todos') onVista('todos')
    if (soloNoLeidos) onSoloNoLeidos(false)
    if (ocultarSilenciados) onOcultarSilenciados?.(false)
  }
  const segmento = segmentoActivo(vista, soloNoLeidos)
  const cuentas = cuentasDe(resumen)
  const enMas = segmento === null

  /* ---------- Scroll infinito ---------- */
  const scroll = useRef<HTMLDivElement>(null)
  const centinela = useRef<HTMLDivElement>(null)
  const pedir = useRef(onCargarMas)
  pedir.current = onCargarMas
  const puedePedir = hayMas && !cargandoMas && !cargando && !error
  useEffect(() => {
    const c = centinela.current
    if (!puedePedir || !c || typeof IntersectionObserver === 'undefined') return
    const raiz = tieneScrollPropio(scroll.current) ? scroll.current : null
    const io = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          io.disconnect()
          pedir.current()
        }
      },
      { root: raiz, rootMargin: '0px 0px 600px 0px' },
    )
    io.observe(c)
    return () => io.disconnect()
    // visibles.length: con la página nueva el centinela se ha movido y hay que volver a mirar
  }, [puedePedir, desdeMd, visibles.length])

  /* ---------- La seleccionada, a la vista (j/k en el ordenador) ---------- */
  useEffect(() => {
    if (!seleccionado || !desdeMd) return
    const c = scroll.current
    if (!c || !tieneScrollPropio(c)) return
    const fila = c.querySelector<HTMLElement>(`[data-hilo-id="${CSS.escape(seleccionado)}"]`)
    fila?.scrollIntoView({ block: 'nearest' })
  }, [seleccionado, desdeMd])

  /* ---------- Vacíos ---------- */
  const vacio = vacioDeLista({ modo, busqueda, vista, soloNoLeidos, ocultarSilenciados, hayMisBuzones, importando: !!importando })
  let accion: AccionDeVacio | undefined
  let accionSecundaria: AccionDeVacio | undefined
  if (vacio.tipo === 'sin-elegir') {
    if (onElegirMisCorreos) accion = { texto: 'Elegir mis correos', onClick: onElegirMisCorreos, icono: MailPlus }
    if (onResumen) accionSecundaria = { texto: 'Ver resumen del equipo', onClick: onResumen }
  } else if (vacio.tipo === 'busqueda') {
    if (onBuscarEnTodos && modo !== 'buzon') accion = { texto: 'Buscar en todos los buzones que lees', onClick: onBuscarEnTodos, icono: Search }
  } else if (vacio.tipo === 'filtro') {
    accion = { texto: 'Quitar filtro', onClick: quitarFiltros, icono: X }
  }

  const nombre = titulo ?? tituloDeModo(modo)

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col md:h-full md:min-h-0">
        {/* ---------- Cabecera pegajosa del móvil (el hueco de la hamburguesa, y «←» después) ---------- */}
        <div className="sticky top-0 z-20 bg-[var(--ls-fondo)] md:hidden">
          <div className="flex h-14 items-center gap-1 pl-14 pr-0 lg:pl-0">
            {onAtras && (
              <button type="button" onClick={onAtras} aria-label="Volver a las carpetas" className={cn('-ml-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-[var(--ls-t2)] active:bg-[var(--ls-sup3)]', FOCO)}>
                <ArrowLeft className="h-5 w-5" aria-hidden />
              </button>
            )}
            <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">{nombre}</h2>
            <button
              type="button"
              onClick={() => setLupaAbierta((v) => !v || busqueda !== '')}
              aria-label="Buscar"
              aria-expanded={buscadorMovil}
              className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] active:bg-[var(--ls-sup3)]', buscadorMovil ? 'text-[var(--ls-acc)]' : 'text-[var(--ls-t2)]', FOCO)}
            >
              <Search className="h-5 w-5" aria-hidden />
            </button>
            {onRedactar && (
              <button type="button" onClick={onRedactar} aria-label="Redactar" className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-[var(--ls-acc)] active:bg-[var(--ls-sup3)]', FOCO)}>
                <PenSquare className="h-5 w-5" aria-hidden />
              </button>
            )}
          </div>
          {buscadorMovil && (
            <div className="pb-2">
              <Buscador valor={busqueda} onCambio={onBusqueda} modo={modo} autoFoco={lupaAbierta && busqueda === ''} onCerrar={() => setLupaAbierta(false)} />
            </div>
          )}
        </div>

        {/* ---------- Buscador (desde md) y filtros ---------- */}
        <div className="space-y-2 border-b border-[var(--ls-linea)] pb-2 pt-1 md:p-2.5">
          {!sinBuscador && (
            <div className="hidden md:block">
              <Buscador valor={busqueda} onCambio={onBusqueda} modo={modo} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <Segmentado<Segmento | 'mas'>
              etiqueta="Filtrar conversaciones"
              tamano="sm"
              valor={segmento ?? 'mas'}
              onCambio={(v) => v !== 'mas' && aplicar(v)}
              opciones={[
                { id: 'todos', texto: 'Todos' },
                { id: 'sin-leer', texto: 'Sin leer', cuenta: cuentas.sinLeer },
                { id: 'pendientes', texto: 'Pendientes', cuenta: cuentas.pendientes },
              ]}
            />
            <Menu.Root modal={false}>
              <Menu.Trigger asChild>
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-[34px] items-center gap-1 rounded-[10px] border px-2.5 text-[12px] font-medium transition-colors',
                    enMas
                      ? 'border-[color-mix(in_srgb,var(--ls-acc-graf)_40%,transparent)] bg-[var(--ls-acc-suave)] text-[var(--ls-acc)]'
                      : 'border-[var(--ls-linea)] bg-[var(--ls-sup2)] text-[var(--ls-t3)] hover:text-[var(--ls-t1)] data-[state=open]:text-[var(--ls-t1)]',
                    TACTIL,
                    FOCO,
                  )}
                >
                  {enMas ? NOMBRE_DE_VISTA[vista] : 'Más'}
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content
                  align="start"
                  sideOffset={6}
                  collisionPadding={16}
                  className="z-[80] w-[min(calc(100vw-32px),220px)] rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-1.5 shadow-[var(--ls-sombra-3)] motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95"
                >
                  {VISTAS_DE_MAS.map((v) => (
                    <Menu.Item key={v.id} className={OPCION_DE_MENU} onSelect={() => aplicar(v.id)}>
                      <span className="flex-1">{v.nombre}</span>
                      {vista === v.id && !soloNoLeidos && <Check className="h-4 w-4 text-[var(--ls-acc)]" aria-label="Elegido" />}
                    </Menu.Item>
                  ))}
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
            {modo === 'mios' && onOcultarSilenciados && (
              <button
                type="button"
                aria-pressed={ocultarSilenciados}
                onClick={() => onOcultarSilenciados(!ocultarSilenciados)}
                title={ocultarSilenciados ? 'Enseñar otra vez lo silenciado (atenuado)' : 'Esconder las conversaciones y los buzones silenciados'}
                className={cn(
                  'inline-flex h-[34px] items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors',
                  ocultarSilenciados
                    ? 'border-[color-mix(in_srgb,var(--ls-acc-graf)_40%,transparent)] bg-[var(--ls-acc-suave)] text-[var(--ls-acc)]'
                    : 'border-[var(--ls-linea)] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]',
                  TACTIL,
                  FOCO,
                )}
              >
                <BellOff className="h-3.5 w-3.5" aria-hidden />
                Ocultar silenciados
              </button>
            )}
          </div>
        </div>

        {importando && <FranjaDeImportacion quedan={importando.quedan} />}

        {error && visibles.length > 0 && (
          <p role="alert" className="flex items-center gap-2 border-b border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-e-ambar)_10%,transparent)] px-4 py-2 text-[12.5px] text-[var(--ls-e-ambar)]">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {error}
          </p>
        )}

        {/* ---------- Las filas ---------- */}
        <div ref={scroll} className="md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain">
          {cargando ? (
            <FilasEsqueleto cuantas={8} className="px-1.5 py-1" />
          ) : error && visibles.length === 0 ? (
            <EstadoVacio compacto icono={AlertTriangle} acento="var(--ls-e-ambar)" titulo="No se han podido cargar las conversaciones" descripcion={error} />
          ) : visibles.length === 0 && !hayMas ? (
            <EstadoVacio
              compacto={!(vacio.tipo === 'sin-elegir')}
              icono={ICONO_DE_VACIO[vacio.tipo]}
              acento="marca"
              titulo={vacio.titulo}
              descripcion={vacio.descripcion}
              accion={accion}
              accionSecundaria={accionSecundaria}
            />
          ) : visibles.length === 0 ? (
            // Red de seguridad: una página vacía que dice que hay más (lo que se ha quitado de ella, p. ej. lo silenciado) no es «No hay
            // conversaciones»: se deja pedir la siguiente
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <p className="text-[13px] text-[var(--ls-t3)]">No hay nada que enseñar en estas conversaciones, pero hay más antiguas.</p>
              <Boton variante="secundario" onClick={onCargarMas} disabled={cargandoMas} cargando={cargandoMas}>
                {cargandoMas ? 'Cargando…' : 'Ver más antiguos'}
              </Boton>
            </div>
          ) : (
            <>
              <ul className="flex flex-col gap-px px-1.5 py-1" aria-label={buscando ? `Resultados de «${busqueda.trim()}»` : `Conversaciones de ${nombre}`} aria-busy={cargandoMas || undefined}>
                {visibles.map((h) => (
                  <FilaDeHilo
                    key={h.id}
                    hilo={h}
                    activo={seleccionado === h.id}
                    modo={modo}
                    buzon={buzonesPorId.get(h.buzonId)}
                    nuevo={animadas.has(h.id)}
                    onElegir={onElegir}
                    onSilenciar={onSilenciar}
                    onAlternarLeido={onAlternarLeido}
                    onDestacar={onDestacar}
                    onAsignar={onAsignar}
                    esAdmin={esAdmin}
                  />
                ))}
              </ul>
              {cargandoMas && (
                <div role="status" aria-label="Cargando más conversaciones" className="px-1.5">
                  <FilaEsqueleto indice={0} />
                  <FilaEsqueleto indice={1} />
                </div>
              )}
              <div ref={centinela} aria-hidden className="h-px" />
              {hayMas && (
                <div className="px-3 pb-4 pt-2">
                  <Boton variante="fantasma" className="w-full" onClick={onCargarMas} disabled={cargandoMas} cargando={cargandoMas}>
                    {cargandoMas ? 'Cargando…' : 'Ver más antiguos'}
                  </Boton>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </MotionConfig>
  )
}

/** Los números del segmentado: solo con un buzón abierto (en Mis correos y Asignados no hay un resumen único). 0 no se enseña */
function cuentasDe(resumen: ResumenDeBuzon | null): { sinLeer?: number; pendientes?: number } {
  if (!resumen) return {}
  return {
    sinLeer: resumen.hilosSinLeer > 0 ? resumen.hilosSinLeer : undefined,
    pendientes: resumen.esperandoRespuesta > 0 ? resumen.esperandoRespuesta : undefined,
  }
}
