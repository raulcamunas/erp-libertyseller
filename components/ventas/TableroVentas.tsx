'use client'

import { guardarCatalogo, type CatalogoDeCuenta } from './catalogo'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, ArrowRight, ChartColumnBig, LayoutGrid, Rows3, Calendar, CalendarDays, Check, ChevronDown, Coins, Globe, Loader2, Megaphone, Plus, Receipt, RefreshCw, ShoppingBag } from 'lucide-react'
import { CabeceraDeModulo, CifraAnimada, PanelLateral, Segmentado } from '@/components/ui-ls'
import { ajustarPeriodo, hoyEnMadrid, PREAJUSTES, rangoDePreajuste, type Preajuste, periodosDe, rangoAComparar, sumarDias, TANDAS, totalizar, enRango, type AjusteBaldosa, type Comparar, type FilaPanel, type Periodo, type Rango, type Tanda, type Totales } from '@/lib/ventas/panel'
import type { InventarioDelProducto, BsrDelProducto, CuentaDelPanel, LineaDelPanel } from '@/lib/ventas/panel-servidor'
import { SelectorDeCuenta } from './SelectorDeCuenta'
import { SelectorDeProductos, type ProductoElegible } from './SelectorDeProductos'
import { VistaGrafico } from './VistaGrafico'
import { VistaPyG } from './VistaPyG'
import { AltoEstable, SERIES_GRAFICA, type SerieGrafica, Buscador, Chip, CuentaDeResultados, Desglose, MotivosDeReembolso, entero, euros, ponerMonedaDelPanel, fechaCorta, GraficaVentas, pais, bandera, pct, RepartoDelDinero, RepartoPorCanal, ROJO, TablaPedidos, TablaProductos, VERDE } from './piezas'

/**
 * VENTAS · EL TABLERO (el «Sellerboard» propio, 26 nov 2026). Una cuenta arriba; cinco baldosas con su periodo (Hoy, Ayer, Este mes, Pronóstico, Mes
 * pasado… o las otras tandas) comparadas con el año anterior o el periodo anterior; al pulsar una, la gráfica, el reparto del dinero y las tablas de
 * productos, pedidos y cuenta de resultados se ponen en ese periodo. Todas las cuentas de beneficio, en el navegador (lib/ventas/panel.ts).
 */

type Datos = { filas: FilaPanel[]; productos: { titulos: Record<string, { titulo: string | null; asin: string | null }>; costes: Record<string, number>; stock?: Record<string, number>; bsr?: Record<string, BsrDelProducto>; inventario?: Record<string, InventarioDelProducto>; catalogo?: Array<{ sku: string; mkt: string; asin: string | null; titulo: string | null; activo: boolean }> } | null; lineas: LineaDelPanel[] | null; sesiones?: Record<string, number> | null }
type Pestana = 'productos' | 'pedidos' | 'resultados'

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init })
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null
  if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`)
  return j as T
}

const minimo = (xs: string[]) => xs.reduce((a, b) => (b < a ? b : a))
const maximo = (xs: string[]) => xs.reduce((a, b) => (b > a ? b : a))

export function TableroVentas({ cuentaInicial = null }: { cuentaInicial?: string | null } = {}) {
  const router = useRouter()
  const [cuentas, setCuentas] = useState<CuentaDelPanel[] | null>(null)
  const [libres, setLibres] = useState<Array<{ id: string; nombre: string; cliente: string | null }>>([])
  const [cuentaId, setCuentaId] = useState<string | null>(cuentaInicial)
  const [tanda, setTanda] = useState<Tanda>('clasica')
  const [rango, setRango] = useState<{ desde: string; hasta: string } | null>(null)
  const [vista, setVista] = useState<'baldosas' | 'grafico' | 'pyg'>('baldosas')
  const [reparto, setReparto] = useState<'euro' | 'canal'>('euro')
  const [seleccion, setSeleccion] = useState<Set<string> | null>(null)
  // De qué cuenta son los datos que se están enseñando: al cambiar de cliente (o de filtros) las cifras cambian, pero eso NO es una venta nueva
  const [datosDe, setDatosDe] = useState<string | null>(null)
  const [series, setSeries] = useState<Set<SerieGrafica>>(new Set(['ventas', 'neto', 'publicidad']))
  // Siempre contra el año anterior (Raúl, 27 nov 2026: «siempre voy a querer comparar vs el año anterior»)
  const comparar: Comparar = 'anio'
  const [mercados, setMercados] = useState<Set<string> | null>(null)
  const [elegido, setElegido] = useState('hoy')
  const [pestana, setPestana] = useState<Pestana>('productos')
  const [buscar, setBuscar] = useState('')
  const [datos, setDatos] = useState<Datos | null>(null)
  const [comparacion, setComparacion] = useState<FilaPanel[]>([])
  const [lineas, setLineas] = useState<LineaDelPanel[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [desglose, setDesglose] = useState<Periodo | null>(null)
  const [motivos, setMotivos] = useState<Periodo | null>(null)
  const [anadir, setAnadir] = useState(false)
  const [reloj, setReloj] = useState(0)
  const peticion = useRef(0)
  const cache = useRef<{ productosDe: string | null; productos: Datos['productos']; compDe: string | null }>({ productosDe: null, productos: null, compDe: null })

  const { hoy, fraccion } = useMemo(() => hoyEnMadrid(), [reloj]) // eslint-disable-line react-hooks/exhaustive-deps
  // BALDOSAS A MEDIDA: cada baldosa puede llevar otro periodo y otra comparación (se guarda en este navegador, por tanda y baldosa)
  const [ajustes, setAjustes] = useState<Record<string, AjusteBaldosa>>({})
  useEffect(() => {
    try {
      const x = JSON.parse(localStorage.getItem(AJUSTES_BALDOSAS) ?? 'null')
      if (x && typeof x === 'object') setAjustes(x as Record<string, AjusteBaldosa>)
    } catch {
      /* sin ajustes guardados */
    }
  }, [])
  const ajustar = useCallback((clave: string, a: AjusteBaldosa | null) => {
    setAjustes((prev) => {
      const n = { ...prev }
      if (a) n[clave] = a
      else delete n[clave]
      try {
        localStorage.setItem(AJUSTES_BALDOSAS, JSON.stringify(n))
      } catch {
        /* da igual */
      }
      return n
    })
  }, [])
  const periodos: Periodo[] = useMemo(
    () =>
      tanda === 'rango' && rango
        ? [{ id: 'rango', titulo: 'Rango elegido', desde: rango.desde, hasta: rango.hasta }]
        : periodosDe(tanda === 'rango' ? 'clasica' : tanda, hoy, fraccion).map((p) => ajustarPeriodo(p, ajustes[`${tanda}:${p.id}`], hoy)),
    [tanda, rango, hoy, fraccion, ajustes],
  )
  const comparados = useMemo(() => periodos.map((p) => ajustes[`${tanda}:${p.id}`]?.comp ?? rangoAComparar(p, comparar)), [periodos, comparar, ajustes, tanda])
  const cuenta = cuentas?.find((c) => c.id === cuentaId) ?? null
  const periodoElegido = periodos.find((p) => p.id === elegido) ?? periodos[0]

  // MÓVIL: las baldosas se pasan de lado. La que queda en el centro es la elegida (los productos de abajo la siguen), y al abrir se enseña la elegida
  const carrusel = useRef<HTMLDivElement>(null)
  const elegidoRef = useRef(elegido)
  elegidoRef.current = elegido
  useEffect(() => {
    const el = carrusel.current
    if (!el) return
    const enCarrusel = () => el.scrollWidth > el.clientWidth + 4 && getComputedStyle(el).display === 'flex'
    const hijo = el.querySelector<HTMLElement>(`[data-periodo="${elegidoRef.current}"]`)
    if (hijo && enCarrusel()) { const r = el.getBoundingClientRect(), h = hijo.getBoundingClientRect(); el.scrollLeft += h.left + h.width / 2 - (r.left + r.width / 2) }
    let t: ReturnType<typeof setTimeout> | undefined
    const alMover = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        if (!enCarrusel()) return
        const r = el.getBoundingClientRect()
        const centro = r.left + r.width / 2
        let mejor: { id: string; d: number } | null = null
        for (const h of Array.from(el.querySelectorAll<HTMLElement>('[data-periodo]'))) {
          const b = h.getBoundingClientRect()
          const d = Math.abs(b.left + b.width / 2 - centro)
          if (!mejor || d < mejor.d) mejor = { id: h.dataset.periodo ?? '', d }
        }
        if (mejor?.id && mejor.id !== elegidoRef.current) setElegido(mejor.id)
      }, 140)
    }
    el.addEventListener('scroll', alMover, { passive: true })
    return () => { el.removeEventListener('scroll', alMover); clearTimeout(t) }
  }, [periodos.length, vista])

  // Las cuentas
  const cargarCuentas = useCallback(async () => {
    const r = await pedir<{ cuentas: CuentaDelPanel[]; libres: Array<{ id: string; nombre: string; cliente: string | null }> }>('/api/ventas?que=cuentas')
    setCuentas(r.cuentas)
    setLibres(r.libres)
    setCuentaId((x) => x ?? r.cuentas[0]?.id ?? null)
  }, [])
  useEffect(() => {
    cargarCuentas().catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [cargarCuentas])
  useEffect(() => {
    if (!periodos.some((p) => p.id === elegido)) setElegido(periodos[0].id)
  }, [periodos, elegido])

  // Los datos: el tramo de las baldosas (y la gráfica: 30 días como mínimo) y el de la comparación
  const desdeGrafica = sumarDias(hoy, -29)
  const rangoPrincipal = useMemo(() => ({ desde: minimo([...periodos.map((p) => p.desde), desdeGrafica]), hasta: maximo(periodos.map((p) => p.hasta)) }), [periodos, desdeGrafica])
  const rangoComparacion = useMemo(() => {
    const rs = comparados.filter((r): r is NonNullable<typeof r> => r != null)
    return rs.length ? { desde: minimo(rs.map((r) => r.desde)), hasta: maximo(rs.map((r) => r.hasta)) } : null
  }, [comparados])

  useEffect(() => {
    if (!cuentaId) return
    const n = ++peticion.current
    // Los refrescos solos (cada minuto) no enseñan «leyendo…»: las cifras suben animadas en su sitio
    setCargando(true)
    setError(null)
    // MENOS CARGA A LA BASE (aviso de CPU de Supabase, 26 nov 2026): el catálogo (títulos y costes) se pide UNA vez por cuenta, y la comparación (que es
    // pasado y no cambia) solo cuando cambian la cuenta o las fechas. El refresco solo relee las cifras del periodo.
    const conProductos = cache.current.productosDe !== cuentaId
    // Al cambiar de cuenta, fuera las cifras de la anterior: se pintaban con el IVA y los ajustes de la nueva hasta que llegaban los datos
    if (conProductos) {
      setDatos(null)
      setComparacion([])
      setLineas(null)
      setDatosDe(null)
    }
    const claveComp = `${cuentaId}|${rangoComparacion?.desde}|${rangoComparacion?.hasta}`
    const conComp = cache.current.compDe !== claveComp
    const principal = pedir<Datos>(`/api/ventas?cuenta=${cuentaId}&desde=${rangoPrincipal.desde}&hasta=${rangoPrincipal.hasta}${conProductos ? '' : '&productos=0'}`)
    const comp = rangoComparacion && conComp ? pedir<Datos>(`/api/ventas?cuenta=${cuentaId}&desde=${rangoComparacion.desde}&hasta=${rangoComparacion.hasta}&productos=0&sesiones=0`) : Promise.resolve(null)
    Promise.all([principal, comp])
      .then(([a, b]) => {
        if (n !== peticion.current) return
        if (conProductos) {
          cache.current = { ...cache.current, productosDe: cuentaId, productos: a.productos }
          // Para Gráfico y P&L: el mismo catálogo, sin volver a pedirlo
          if (a.productos) guardarCatalogo(cuentaId, a.productos as unknown as CatalogoDeCuenta)
        }
        setDatos({ ...a, productos: conProductos ? a.productos : cache.current.productos })
        setDatosDe(cuentaId)
        if (b) {
          cache.current = { ...cache.current, compDe: claveComp }
          setComparacion(b.filas)
        } else if (!rangoComparacion) setComparacion([])
      })
      .catch((e) => n === peticion.current && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => n === peticion.current && setCargando(false))
  }, [cuentaId, rangoPrincipal, rangoComparacion, reloj])

  // Los pedidos del periodo elegido (solo hay detalle de los últimos ~62 días)
  useEffect(() => {
    if (!cuentaId || pestana !== 'pedidos') return
    let vivo = true
    setLineas(null)
    pedir<Datos>(`/api/ventas?cuenta=${cuentaId}&desde=${periodoElegido.desde}&hasta=${periodoElegido.desde}&productos=0&sesiones=0&lineasDesde=${periodoElegido.desde}&lineasHasta=${periodoElegido.hasta}`)
      .then((r) => vivo && setLineas(r.lineas ?? []))
      .catch(() => vivo && setLineas([]))
    return () => {
      vivo = false
    }
  }, [cuentaId, pestana, periodoElegido.desde, periodoElegido.hasta, reloj])

  // Se vuelve a leer cada 2 minutos con la pantalla a la vista: lo que el cron trae de Amazon aparece solo, con las cifras subiendo
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && setReloj((x) => x + 1), 120_000)
    return () => clearInterval(t)
  }, [])

  const mercadosConDatos = useMemo(() => [...new Set((datos?.filas ?? []).map((f) => f.mkt))].sort((a, b) => pais(a).localeCompare(pais(b), 'es')), [datos])
  const filtrar = useCallback((fs: readonly FilaPanel[]) => fs.filter((f) => (!mercados || mercados.has(f.mkt)) && (!seleccion || seleccion.has(f.sku))), [mercados, seleccion])
  const filas = useMemo(() => filtrar(datos?.filas ?? []), [datos, filtrar])
  const filasComp = useMemo(() => filtrar(comparacion), [comparacion, filtrar])
  const costes = useMemo(() => datos?.productos?.costes ?? {}, [datos])
  const titulos = useMemo(() => datos?.productos?.titulos ?? {}, [datos])
  // El COGS se cambia desde la fila del producto: se guarda y se cambia aquí mismo (las baldosas y la tabla se recalculan sin volver a leer)
  const onCoste = useCallback(
    async (sku: string, coste: number | null): Promise<boolean> => {
      if (!cuentaId) return false
      const r = await fetch('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'coste', cuenta: cuentaId, sku, coste }) })
      const j = await r.json().catch(() => null)
      if (!r.ok) {
        toast.error(j?.error ?? 'No se ha podido guardar el COGS')
        return false
      }
      const cambiar = (p: NonNullable<Datos['productos']>) => {
        const costes = { ...p.costes }
        if (coste === null) delete costes[sku]
        else costes[sku] = coste
        return { ...p, costes }
      }
      setDatos((d) => (d?.productos ? { ...d, productos: cambiar(d.productos) } : d))
      if (cache.current.productos) {
        cache.current = { ...cache.current, productos: cambiar(cache.current.productos) }
        guardarCatalogo(cuentaId, cache.current.productos as unknown as CatalogoDeCuenta)
      }
      toast.success(coste === null ? `COGS de ${sku} quitado` : `COGS de ${sku}: ${euros(coste)}`)
      return true
    },
    [cuentaId]
  )
  const extras = useMemo(() => ({ stock: datos?.productos?.stock, bsr: datos?.productos?.bsr, sesiones: datos?.sesiones, inventario: datos?.productos?.inventario, onCoste }), [datos, onCoste])
  const iva = useMemo(() => ({ ...cuenta?.ajustes, pct: cuenta?.iva ?? 21, porPais: cuenta?.ivaPorPais ?? false }), [cuenta?.iva, cuenta?.ivaPorPais, cuenta?.ajustes])

  // «Habilitar el cambio de moneda en el panel» (Configuración): las cifras se enseñan en la moneda elegida, con el cambio del día
  const conCambio = Boolean(cuenta?.ajustes?.cambioMoneda)
  const [moneda, setMoneda] = useState('EUR')
  const [porEuro, setPorEuro] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    try {
      const m = localStorage.getItem('ventas-moneda')
      if (m) setMoneda(m)
    } catch {
      /* sin preferencia */
    }
  }, [])
  useEffect(() => {
    if (!conCambio || porEuro) return
    fetch('/api/ventas?que=cambios', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { porEuro?: Record<string, number> } | null) => j?.porEuro && setPorEuro(j.porEuro))
      .catch(() => undefined)
  }, [conCambio, porEuro])
  const monedaVista = conCambio && porEuro && (moneda === 'EUR' || porEuro[moneda]) ? moneda : 'EUR'
  ponerMonedaDelPanel(monedaVista, monedaVista === 'EUR' ? 1 : (porEuro?.[monedaVista] ?? 1))
  useEffect(() => () => ponerMonedaDelPanel('EUR', 1), [])

  const totales: Totales[] = useMemo(() => periodos.map((p) => totalizar(filas.filter((f) => enRango(f.dia, p)), iva, costes, p.escala ?? 1)), [periodos, filas, iva, costes])
  const totalesComp: Array<Totales | null> = useMemo(
    () => comparados.map((r) => (r ? totalizar(filasComp.filter((f) => enRango(f.dia, r)), iva, costes) : null)),
    [comparados, filasComp, iva, costes],
  )
  const iElegido = Math.max(0, periodos.findIndex((p) => p.id === periodoElegido.id))
  const tElegido = totales[iElegido]
  // Mientras llegan los datos de la cuenta (al entrar o al cambiar de cliente): la animación de «contando», no un 0,00 € que parece real
  const sinDatos = !datos || datosDe !== cuentaId
  const filasElegidas = useMemo(() => filas.filter((f) => enRango(f.dia, periodoElegido)), [filas, periodoElegido])
  const diasGrafica = useMemo(() => {
    // Un periodo antiguo (o un rango elegido) se dibuja él solo; lo reciente, con los últimos 30 días alrededor
    const antiguo = tanda === 'rango' || periodoElegido.hasta < desdeGrafica
    const desde = antiguo ? periodoElegido.desde : periodoElegido.desde < desdeGrafica ? periodoElegido.desde : desdeGrafica
    const hasta = antiguo ? periodoElegido.hasta : hoy
    const dias: string[] = []
    for (let d = desde; d <= hasta && dias.length < 800; d = sumarDias(d, 1)) dias.push(d)
    return dias
  }, [tanda, periodoElegido.desde, periodoElegido.hasta, desdeGrafica, hoy])

  // Los productos que se pueden elegir arriba: el catálogo de la cuenta y lo que se ha vendido aunque no esté en él, lo que más vende primero
  const elegibles: ProductoElegible[] = useMemo(() => {
    const ventas = new Map<string, number>()
    for (const f of datos?.filas ?? []) if (f.sku) ventas.set(f.sku, (ventas.get(f.sku) ?? 0) + f.ventas)
    const por = new Map<string, ProductoElegible>()
    for (const c of datos?.productos?.catalogo ?? []) if (!por.has(c.sku) && (c.activo || ventas.has(c.sku))) por.set(c.sku, { sku: c.sku, asin: c.asin, titulo: c.titulo, mkt: c.mkt })
    for (const f of datos?.filas ?? []) if (f.sku && !por.has(f.sku)) por.set(f.sku, { sku: f.sku, asin: f.asin, titulo: datos?.productos?.titulos[f.sku]?.titulo ?? null, mkt: f.mkt })
    return [...por.values()].map((p) => ({ ...p, ventas: ventas.get(p.sku) ?? 0 }))
  }, [datos])

  // La minigráfica de cada baldosa: las ventas de cada día del periodo (o de los 14 días hasta su final, si es de un día o dos)
  const ventasPorDia = new Map<string, number>()
  for (const f of filas) ventasPorDia.set(f.dia, (ventasPorDia.get(f.dia) ?? 0) + f.ventas)
  const serieDe = (p: Periodo) => {
    const desde = p.desde < sumarDias(p.hasta, -13) ? p.desde : sumarDias(p.hasta, -13)
    const out: number[] = []
    for (let d = desde; d <= p.hasta; d = sumarDias(d, 1)) out.push(ventasPorDia.get(d) ?? 0)
    return out
  }

  if (cuentas && cuentas.length === 0) {
    return (
      <Marco>
        <p className="py-16 text-center text-[13px] text-[var(--ls-t3)]">Todavía no hay ninguna cuenta en el panel. Falta lanzar la migración 344 o añadir una.</p>
      </Marco>
    )
  }

  const filtrosBaldosas = (
    <>
        <Desplegable icono={Calendar} texto={tanda === 'rango' && rango ? `${fechaCorta(rango.desde)} – ${fechaCorta(rango.hasta)}` : (TANDAS.find((t) => t.id === tanda)?.texto ?? '')} textoCorto={tanda === 'rango' && rango ? `${fechaCorta(rango.desde).slice(0, 5)}–${fechaCorta(rango.hasta).slice(0, 5)}` : (TANDAS.find((t) => t.id === tanda)?.corto ?? 'Periodo')} crece>
          {(cerrar) => (
            <>
              {TANDAS.map((t) => (
                <Opcion key={t.id} activa={t.id === tanda} onClick={() => (setTanda(t.id), cerrar())}>
                  {t.texto}
                </Opcion>
              ))}
              <ElegirRango
                inicial={rango ?? { desde: sumarDias(hoy, -365 - 29), hasta: sumarDias(hoy, -365) }}
                hoy={hoy}
                activo={tanda === 'rango'}
                onAplicar={(r) => {
                  setRango(r)
                  setTanda('rango')
                  setElegido('rango')
                  cerrar()
                }}
              />
            </>
          )}
        </Desplegable>
        <Desplegable icono={Globe} texto={!mercados || mercados.size === mercadosConDatos.length ? 'Todos los países' : `${mercados.size} ${mercados.size === 1 ? 'país' : 'países'}`} textoCorto={!mercados || mercados.size === mercadosConDatos.length ? '' : String(mercados.size)}>
          {() => (
            <>
              <Opcion activa={!mercados} onClick={() => setMercados(null)}>
                Todos los países
              </Opcion>
              {mercadosConDatos.map((m) => {
                const activa = !mercados || mercados.has(m)
                return (
                  <Opcion
                    key={m}
                    activa={activa}
                    onClick={() => {
                      const base = new Set(mercados ?? mercadosConDatos)
                      if (base.has(m)) base.delete(m)
                      else base.add(m)
                      setMercados(base.size === mercadosConDatos.length ? null : base)
                    }}
                  >
                    {bandera(m)} {pais(m)}
                  </Opcion>
                )
              })}
            </>
          )}
        </Desplegable>
        {cargando && !datos && <span className="inline-flex items-center gap-1 text-[12px] text-[var(--ls-t4)]"><Loader2 className="h-[12px] w-[12px] animate-spin" /> leyendo…</span>}
    </>
  )

  return (
    <Marco
      acciones={
        <div className="flex w-full items-center gap-2 sm:w-auto sm:flex-wrap">
          <Link href="/dashboard/ventas" title="Todas las cuentas" aria-label="Todas las cuentas" className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[12.5px] font-medium text-[var(--ls-t2)] transition-colors hover:text-[var(--ls-t1)] sm:h-11 sm:w-auto sm:rounded-[13px] sm:px-3">
            <ArrowLeft className="h-[14px] w-[14px]" />
            <span className="hidden sm:inline">Todas las cuentas</span>
          </Link>
          {conCambio && (
            <select
              value={monedaVista}
              onChange={(e) => {
                setMoneda(e.target.value)
                try {
                  localStorage.setItem('ventas-moneda', e.target.value)
                } catch {
                  /* da igual */
                }
              }}
              aria-label="Moneda del panel"
              title="Moneda en la que se enseñan las cifras (cambio del día)"
              className="h-10 shrink-0 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2 text-[16px] text-[var(--ls-t1)] sm:h-11 sm:text-[13px]"
            >
              {['EUR', 'USD', 'GBP', 'PLN', 'SEK', 'MXN', 'CAD'].filter((m) => m === 'EUR' || porEuro?.[m]).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          {cuentas && <SelectorDeCuenta className="min-w-0 flex-1 sm:flex-none" cuentas={cuentas} valor={cuentaId} onCambio={(id) => { setCuentaId(id); setSeleccion(null); router.replace(`/dashboard/ventas?cuenta=${id}`, { scroll: false }) }} onAnadir={() => setAnadir(true)} />}
          <button type="button" onClick={() => { cache.current = { productosDe: null, productos: null, compDe: null }; setReloj((x) => x + 1) }} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t2)] hover:text-[var(--ls-t1)] sm:h-11 sm:w-11 sm:rounded-[13px]" title="Volver a leer" aria-label="Volver a leer">
            {cargando ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <RefreshCw className="h-[14px] w-[14px]" />}
          </button>
        </div>
      }
    >
      <style>{`@keyframes ventas-entra { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
@keyframes ventas-trazo { 0% { stroke-dashoffset: 1; opacity: 0 } 12% { opacity: 1 } 70% { stroke-dashoffset: 0; opacity: 1 } 100% { stroke-dashoffset: 0; opacity: 0 } }
@keyframes ventas-relleno { 0%, 35% { opacity: 0 } 70% { opacity: 1 } 100% { opacity: 0 } }
@keyframes ventas-brillo { from { background-position: 180% 0 } to { background-position: -80% 0 } }
.ventas-brillo { background: linear-gradient(90deg, var(--ls-sup2) 25%, color-mix(in srgb, var(--ls-t1) 9%, var(--ls-sup2)) 45%, var(--ls-sup2) 65%); background-size: 260% 100%; animation: ventas-brillo 1.4s ease-in-out infinite; }`}</style>

      {cuenta?.estado.primeraLectura && <ProgresoDeLectura estado={cuenta.estado} />}
      {cuenta?.estado.error && !cuenta.estado.primeraLectura && (
        <div className="mb-3 flex items-start gap-2 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-[11.5px] text-[var(--ls-t3)] sm:mb-4 sm:p-3 sm:text-[12px]" title={cuenta.estado.error}>
          <AlertTriangle className="mt-[1px] h-[14px] w-[14px] shrink-0" style={{ color: 'var(--ls-e-ambar)' }} /> <span className="line-clamp-2 sm:line-clamp-none">Última lectura con avisos: {cuenta.estado.error}</span>
        </div>
      )}
      {error && <p className="mb-4 rounded-[12px] border border-[var(--ls-linea)] p-3 text-[12.5px]" style={{ color: ROJO }}>{error}</p>}

      {/* Todo en una línea: la vista, los productos y (en Baldosas) el periodo y los países. En el móvil: la vista, el periodo y los países en UNA fila
          (solo iconos donde hace falta) y debajo los productos */}
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-5 xl:flex-nowrap">
        <div className="flex w-full items-center gap-2 sm:contents">
          {/* En el móvil solo los iconos (Baldosas, Gráfico, P&L): la fila tiene que dejar sitio al periodo y a los países */}
          <Segmentado
            etiqueta="Vista: baldosas, gráfico o P&L"
            valor={vista}
            onCambio={setVista}
            tamano="sm"
            className="shrink-0 sm:hidden"
            opciones={[
              { id: 'baldosas', texto: '', icono: LayoutGrid },
              { id: 'grafico', texto: '', icono: ChartColumnBig },
              { id: 'pyg', texto: 'P&L', icono: undefined },
            ]}
          />
          <Segmentado
            etiqueta="Vista"
            valor={vista}
            onCambio={setVista}
            className="hidden sm:inline-flex"
            opciones={[
              { id: 'baldosas', texto: 'Baldosas', icono: LayoutGrid },
              { id: 'grafico', texto: 'Gráfico', icono: ChartColumnBig },
              { id: 'pyg', texto: 'P&L', icono: Rows3 },
            ]}
          />
          {vista === 'baldosas' && <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:hidden">{filtrosBaldosas}</div>}
        </div>
        {cuenta && <SelectorDeProductos productos={elegibles} seleccion={seleccion} onCambio={setSeleccion} className="w-full sm:w-auto sm:min-w-[260px] sm:flex-1" />}
        {vista === 'baldosas' && <div className="hidden items-center gap-2 sm:contents">{filtrosBaldosas}</div>}
      </div>
      <AltoEstable clave={vista}>
      {cuenta && vista === 'grafico' && <VistaGrafico cuenta={cuenta} hoy={hoy} skus={seleccion} />}
      {cuenta && vista === 'pyg' && <VistaPyG cuenta={cuenta} hoy={hoy} skus={seleccion} />}
      {vista === 'baldosas' && (
        <>
      {cuenta && !cuenta.estado.primeraLectura && (
        <div className="-mt-3 mb-4 hidden justify-end sm:flex">
          <EstadoHistorial estado={cuenta.estado} hoy={hoy} />
        </div>
      )}

      {/* Las baldosas */}
      {/* En el móvil, como Sellerboard: una baldosa por pantalla y se pasa de lado (con imán); desde sm, la rejilla de siempre */}
      <div ref={carrusel} className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:pb-0 xl:grid-cols-5 [&::-webkit-scrollbar]:hidden">
        {periodos.map((p, i) => (
          <div key={`${tanda}-${p.id}`} data-periodo={p.id} className="w-[86%] max-w-[380px] shrink-0 snap-center sm:w-auto sm:max-w-none">
          <Baldosa key={`${tanda}-${p.id}`} contexto={`${datosDe}|${[...(mercados ?? [])].join()}|${[...(seleccion ?? [])].join()}`} p={p} i={i} t={totales[i]} c={totalesComp[i]} comp={comparados[i]} ajuste={tanda === 'rango' ? null : (ajustes[`${tanda}:${p.id}`] ?? null)} onAjustar={tanda === 'rango' ? undefined : (a) => ajustar(`${tanda}:${p.id}`, a)} hoy={hoy} serie={serieDe(p)} cargando={sinDatos || (Boolean(cuenta?.estado.primeraLectura) && !datos?.filas.length)} elegida={p.id === periodoElegido.id} onElegir={() => setElegido(p.id)} onMas={() => setDesglose(p)} onReembolsos={() => setMotivos(p)} />
          </div>
        ))}
      </div>

      {/* La gráfica y el reparto del dinero */}
      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)] [&>section]:min-w-0">
        <section className={TARJETA + ' p-4 sm:p-5'}>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div>
              <div className={ROTULO}>Evolución diaria</div>
              <div className="mt-1 text-[15px] font-semibold text-[var(--ls-t1)]">Ventas y ganancia</div>
            </div>
            <div className="ls-sin-barra flex w-full min-w-0 items-center overflow-x-auto rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[3px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)] sm:mx-0 sm:ml-auto sm:inline-flex sm:w-auto sm:flex-wrap" role="group" aria-label="Qué se dibuja">
              {SERIES_GRAFICA.map((x) => {
                const on = series.has(x.id)
                return (
                  <button
                    key={x.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSeries((s0) => { const n = new Set(s0); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n.size ? n : s0 })}
                    className="relative flex h-[28px] shrink-0 items-center gap-2 whitespace-nowrap rounded-[9px] px-[10px] text-[12px] font-medium transition-all duration-200 sm:px-3"
                    style={on ? { background: 'var(--ls-sup)', color: 'var(--ls-t1)', boxShadow: '0 1px 2px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)' } : { color: 'var(--ls-t4)' }}
                    title={x.id === 'ppc' ? 'Ventas que Amazon Ads atribuye a un clic en un anuncio el mismo día' : x.id === 'organico' ? 'Ventas menos las atribuidas a la publicidad' : undefined}
                  >
                    <svg width="16" height="8" viewBox="0 0 16 8" aria-hidden className="shrink-0 transition-opacity" style={{ opacity: on ? 1 : 0.45 }}>
                      {x.id === 'publicidad' ? (
                        <line x1="1" y1="4" x2="15" y2="4" stroke={on ? x.color : 'currentColor'} strokeWidth="2" strokeDasharray="3 2.5" strokeLinecap="round" />
                      ) : (
                        <path d="M1 6 C 5 6, 6 2, 9 2 S 13 4, 15 3" fill="none" stroke={on ? x.color : 'currentColor'} strokeWidth="2.2" strokeLinecap="round" />
                      )}
                    </svg>
                    {x.texto}
                  </button>
                )
              })}
            </div>
          </div>
          {sinDatos ? (
            <div className="flex h-[260px] items-center justify-center">
              <TrazoCargando color="#FF8A3D" alto={200} rejilla />
            </div>
          ) : (
            <GraficaVentas filas={filas} dias={diasGrafica} ivaPct={iva} costes={costes} resaltado={periodoElegido} series={series} />
          )}
        </section>
        <section className={TARJETA + ' flex flex-col gap-4 p-4 sm:gap-5 sm:p-5'}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className={ROTULO}>{reparto === 'euro' ? periodoElegido.titulo : 'Ventas por canal'}</div>
              <div className="mt-1 text-[15px] font-semibold text-[var(--ls-t1)]">{reparto === 'euro' ? 'A dónde va cada euro' : 'FBA / FBM'}</div>
            </div>
            <div className="inline-flex rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[3px]" role="group" aria-label="Qué se reparte">
              {(
                [
                  ['euro', 'Dinero'],
                  ['canal', 'FBA / FBM'],
                ] as const
              ).map(([id, texto]) => (
                <button key={id} type="button" onClick={() => setReparto(id)} className={`h-[26px] rounded-[7px] px-[10px] text-[12px] font-medium transition-colors ${reparto === id ? 'bg-[var(--ls-sup)] text-[var(--ls-t1)] shadow-sm' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'}`}>
                  {texto}
                </button>
              ))}
            </div>
          </div>
          {reparto === 'canal' && cuentaId ? (
            <RepartoPorCanal cuenta={cuentaId} hoy={hoy} mercados={mercados} skus={seleccion} />
          ) : sinDatos ? (
            <div className="flex h-[180px] flex-col justify-center gap-3" role="status" aria-label="Cargando el reparto">
              {[82, 64, 46, 30].map((w, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="ventas-brillo h-[10px] w-[22%] rounded-full opacity-70" />
                  <div className="ventas-brillo h-[14px] rounded-full" style={{ width: `${w * 0.7}%` }} />
                </div>
              ))}
            </div>
          ) : (
            tElegido && <RepartoDelDinero t={tElegido} />
          )}
          {reparto === 'euro' && (
          <div className="mt-auto grid grid-cols-3 gap-3 border-t border-[var(--ls-linea)] pt-4">
            <Mini texto="Ventas" valor={euros(tElegido?.ventas ?? 0, 0)} />
            <Mini texto="TACOS" valor={pct(tElegido?.tacos ?? null)} />
            <Mini texto="ROI" valor={tElegido?.roi == null ? '—' : pct(tElegido.roi, 0)} nota={tElegido?.unidadesSinCoste ? 'faltan costes' : undefined} />
          </div>
          )}
        </section>
      </div>

      {/* Las tablas */}
      <section className={TARJETA + ' mt-4 overflow-hidden'}>
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--ls-linea)] px-5 py-4">
          <div className="mr-2">
            <div className={ROTULO}>Detalle</div>
            <div className="mt-1 text-[15px] font-semibold text-[var(--ls-t1)]">{periodoElegido.titulo}</div>
          </div>
          <Segmentado
            etiqueta="Vista"
            tamano="sm"
            valor={pestana}
            onCambio={setPestana}
            opciones={[
              { id: 'productos', texto: 'Productos' },
              { id: 'pedidos', texto: 'Pedidos' },
              { id: 'resultados', texto: 'Cuenta de resultados' },
            ]}
          />
          <span className="ml-auto" />
          {pestana !== 'resultados' && <Buscador valor={buscar} onCambio={setBuscar} />}
        </div>
        <AltoEstable clave={pestana}>
        {pestana === 'productos' && <TablaProductos filas={filasElegidas} ivaPct={iva} costes={costes} titulos={titulos} buscar={buscar} extras={extras} />}
        {pestana === 'pedidos' &&
          (lineas == null ? (
            <p className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-[var(--ls-t4)]">
              <Loader2 className="h-[14px] w-[14px] animate-spin" /> Cargando los pedidos…
            </p>
          ) : (
            <TablaPedidos lineas={lineas.filter((l) => (!mercados || mercados.has(l.mkt)) && (!seleccion || seleccion.has(l.sku)))} titulos={titulos} ivaPct={iva} costes={costes} buscar={buscar} />
          ))}
        {pestana === 'resultados' && <CuentaDeResultados periodos={periodos} totales={totales} />}
        </AltoEstable>
      </section>

        </>
      )}
      </AltoEstable>

      <PanelLateral abierto={desglose != null} onCambio={(a) => !a && setDesglose(null)} titulo={desglose?.titulo ?? ''} descripcion={desglose ? `${fechaCorta(desglose.desde)} – ${fechaCorta(desglose.hastaPronostico ?? desglose.hasta)}${desglose.escala ? ' · pronóstico del mes entero' : ''}` : ''} icono={Coins} acento="marca" ancho={440}>
        {desglose && <Desglose t={totales[periodos.findIndex((p) => p.id === desglose.id)] ?? totalizar([], iva, costes)} onReembolsos={() => (setMotivos(desglose), setDesglose(null))} />}
      </PanelLateral>

      <PanelLateral abierto={motivos != null} onCambio={(a) => !a && setMotivos(null)} titulo={motivos ? `Reembolsos · ${motivos.titulo}` : ''} descripcion={motivos ? `${fechaCorta(motivos.desde)} – ${fechaCorta(motivos.hasta)} · por qué se devolvió, con lo que escribió el comprador` : ''} icono={Coins} acento="marca" ancho={460}>
        {motivos && cuentaId && <MotivosDeReembolso cuenta={cuentaId} desde={motivos.desde} hasta={motivos.hasta} skus={seleccion} mercados={mercados} />}
      </PanelLateral>

      <PanelLateral abierto={anadir} onCambio={setAnadir} titulo="Añadir una cuenta al panel" descripcion="Empieza a leerse sola en la próxima pasada (5 minutos) y en un rato tiene sus últimos 62 días." icono={Plus} acento="marca">
        <div className="flex flex-col gap-1">
          {libres.length === 0 && <p className="text-[12.5px] text-[var(--ls-t4)]">Todas las cuentas conectadas ya están en el panel.</p>}
          {libres.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={async () => {
                await pedir('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'anadir', cuenta: l.id }) })
                setAnadir(false)
                await cargarCuentas()
                setCuentaId(l.id)
              }}
              className="flex items-center justify-between rounded-[10px] border border-[var(--ls-linea)] px-3 py-[10px] text-left text-[13px] text-[var(--ls-t1)] hover:border-[var(--ls-acc)]"
            >
              <span>
                {l.cliente ?? l.nombre}
                {l.cliente && l.cliente !== l.nombre && <span className="text-[var(--ls-t4)]"> · {l.nombre}</span>}
              </span>
              <Plus className="h-[14px] w-[14px] text-[var(--ls-t3)]" />
            </button>
          ))}
        </div>
      </PanelLateral>
    </Marco>
  )
}

/* ------------------------------------------------------------------ */

export function Marco({ children, acciones, debajo, titulo = 'Sellerboard', subtitulo = 'Ventas, tarifas, publicidad y beneficio de cada cliente, con los datos de su cuenta de Amazon', icono = Coins }: { children: React.ReactNode; acciones?: React.ReactNode; debajo?: React.ReactNode; titulo?: string; subtitulo?: string; icono?: typeof Coins }) {
  return (
    <div className="relative isolate w-full min-w-0 pb-12 lg:px-1">
      {/* La luz de fondo: dos manchas muy difusas (naranja y violeta) que dan profundidad sin distraer */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-10 -z-10 h-[620px] overflow-hidden"
        // El resplandor se apaga ANTES de los bordes de su caja: sin esto se ve el corte recto a los lados y abajo
        style={{ maskImage: 'radial-gradient(ellipse 50% 100% at 50% 0%, #000 30%, transparent 100%)', WebkitMaskImage: 'radial-gradient(ellipse 50% 100% at 50% 0%, #000 30%, transparent 100%)' }}
      >
        <div className="absolute -left-20 top-0 h-[420px] w-[620px] rounded-full opacity-[0.10] blur-[120px]" style={{ background: '#F26212' }} />
        <div className="absolute right-[-120px] top-24 h-[380px] w-[560px] rounded-full opacity-[0.07] blur-[130px]" style={{ background: '#8B5CF6' }} />
        <div className="absolute left-[38%] top-[280px] h-[260px] w-[420px] rounded-full opacity-[0.05] blur-[110px]" style={{ background: '#38BDF8' }} />
      </div>
      {/* EN EL MÓVIL, SIN EL BLOQUE DEL TÍTULO: la barra de arriba de la app ya dice dónde estás; aquí solo los controles (cuenta, volver a leer…) */}
      <div className="hidden sm:block">
        <CabeceraDeModulo icono={icono} acento="marca" titulo={titulo} subtitulo={subtitulo} acciones={acciones} debajo={debajo} />
      </div>
      {(acciones || debajo) && (
        <div className="flex flex-col gap-2 pt-1 sm:hidden">
          {acciones}
          {debajo}
        </div>
      )}
      <div className="mt-3 sm:mt-4">{children}</div>
    </div>
  )
}

export const TARJETA = 'rounded-[22px] border border-[color-mix(in_srgb,var(--ls-t1)_7%,var(--ls-linea))] bg-[var(--ls-sup)] [background-image:linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0)_42%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_30px_-18px_rgba(0,0,0,0.6)]'

/** El color de cada baldosa (Hoy, Ayer, Este mes, Pronóstico, Mes pasado): naranja, ámbar, rosa, violeta y cielo */
export const ACENTOS = [
  ['#FF7A1A', '#FFB36B'],
  ['#F5B942', '#FDE68A'],
  ['#FF5C8A', '#FDA4C4'],
  ['#A78BFA', '#DDD6FE'],
  ['#38BDF8', '#BAE6FD'],
] as const
const ROTULO = 'text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)]'

const AJUSTES_BALDOSAS = 'ventas-baldosas'

function Baldosa({ contexto, p, i, t, c, comp, ajuste, onAjustar, hoy, serie, cargando, elegida, onElegir, onMas, onReembolsos }: { contexto: string; p: Periodo; i: number; t: Totales; c: Totales | null; comp: Rango | null; ajuste: AjusteBaldosa | null; onAjustar?: (a: AjusteBaldosa | null) => void; hoy: string; serie: number[]; cargando: boolean; elegida: boolean; onElegir: () => void; onMas: () => void; onReembolsos: () => void }) {
  const [editar, setEditar] = useState<DOMRect | null>(null)
  // EL DINERO QUE SUBE: cuando entra una venta nueva (el refresco de cada minuto trae más que antes), la cifra sube contando y sale «+119,99 €» flotando
  // hacia arriba, con un brillo suave en la baldosa. Sin avisos ni sonidos: solo se ve.
  const anterior = useRef<{ contexto: string; ventas: number } | null>(null)
  const [subida, setSubida] = useState<{ id: number; importe: number } | null>(null)
  useEffect(() => {
    const prevRef = anterior.current
    anterior.current = { contexto, ventas: t.ventas }
    // Solo cuando es la MISMA cuenta con los mismos filtros y ya había cifras: cambiar de cliente, de país o de productos no es una venta
    if (!prevRef || prevRef.contexto !== contexto || prevRef.ventas === 0 || cargando) {
      setSubida(null)
      return
    }
    const prev = prevRef.ventas
    const diff = t.ventas - prev
    if (diff >= 0.5) {
      setSubida({ id: Date.now(), importe: diff })
      const x = setTimeout(() => setSubida(null), 3200)
      return () => clearTimeout(x)
    }
  }, [t.ventas, cargando, contexto])
  const fechas = p.desde === p.hasta ? fechaCorta(p.desde).slice(0, 5) : `${fechaCorta(p.desde).slice(0, 5)}–${fechaCorta(p.hastaPronostico ?? p.hasta).slice(0, 5)}`
  const hayComp = c != null && (c.ventas !== 0 || c.unidades !== 0)
  const [a, b] = ACENTOS[i % ACENTOS.length]
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.06, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -3 }}
      onClick={onElegir}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onElegir()}
      aria-pressed={elegida}
      className="group relative cursor-pointer overflow-hidden rounded-[20px] border p-4 text-left transition-[border-color,box-shadow] duration-300 sm:rounded-[22px] sm:p-5"
      style={{
        borderColor: elegida ? `color-mix(in srgb, ${a} 55%, var(--ls-linea))` : 'color-mix(in srgb, var(--ls-t1) 7%, var(--ls-linea))',
        background: `radial-gradient(140% 90% at 100% 0%, color-mix(in srgb, ${a} ${elegida ? 20 : 11}%, transparent) 0%, transparent 58%), linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0) 42%), var(--ls-sup)`,
        boxShadow: elegida ? `0 24px 50px -28px ${a}, 0 0 0 1px color-mix(in srgb, ${a} 22%, transparent), inset 0 1px 0 rgba(255,255,255,0.07)` : 'inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 30px -18px rgba(0,0,0,0.6)',
      }}
    >
      {subida && (
        <>
          <motion.div key={`brillo-${subida.id}`} initial={{ opacity: 0.55 }} animate={{ opacity: 0 }} transition={{ duration: 2.6, ease: 'easeOut' }} className="pointer-events-none absolute inset-0 rounded-[22px]" style={{ background: 'radial-gradient(120% 80% at 30% 20%, rgba(74,222,128,0.22), transparent 60%)' }} />
          <motion.span key={`sube-${subida.id}`} initial={{ opacity: 0, y: 8, scale: 0.9 }} animate={{ opacity: [0, 1, 1, 0], y: [8, -6, -18, -30], scale: [0.9, 1, 1, 1] }} transition={{ duration: 3, times: [0, 0.15, 0.7, 1], ease: 'easeOut' }} className="pointer-events-none absolute right-5 top-[64px] z-[2] rounded-full px-[9px] py-[3px] text-[12px] font-semibold tabular-nums text-[#0b2e17]" style={{ background: 'linear-gradient(135deg, #4ADE80, #86EFAC)', boxShadow: '0 6px 18px -6px rgba(74,222,128,0.7)' }}>
            +{euros(subida.importe, 2)}
          </motion.span>
        </>
      )}
      {/* La línea de color de arriba: tenue en todas, viva en la elegida */}
      <div className="absolute inset-x-5 top-0 h-[2px] rounded-full transition-opacity duration-300" style={{ background: `linear-gradient(90deg, transparent, ${a}, ${b}, transparent)`, opacity: elegida ? 1 : 0.28 }} />

      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="relative flex h-[8px] w-[8px] shrink-0">
            {elegida && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50" style={{ background: a }} />}
            <span className="relative h-[8px] w-[8px] rounded-full" style={{ background: a, boxShadow: `0 0 10px ${a}` }} />
          </span>
          <span className={`truncate text-[13px] font-semibold ${elegida ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t2)]'}`}>{p.ajustado ? p.titulo : p.escala ? 'Pronóstico' : p.id === 'pasado' ? 'Mes pasado' : p.titulo}</span>
        </span>
        {onAjustar ? (
          <button
            type="button"
            title={`Cambiar el periodo de esta baldosa${comp ? ` · se compara con ${fechaCorta(comp.desde)} – ${fechaCorta(comp.hasta)}` : ''}`}
            onClick={(e) => (e.stopPropagation(), setEditar(e.currentTarget.getBoundingClientRect()))}
            onKeyDown={(e) => e.stopPropagation()}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-[7px] py-[2px] text-[10px] font-medium tabular-nums transition-colors hover:text-[var(--ls-t1)]"
            style={{ background: `color-mix(in srgb, ${a} ${ajuste ? 22 : 10}%, var(--ls-sup2))`, color: 'var(--ls-t3)' }}
          >
            {fechas}
            <CalendarDays className="h-[11px] w-[11px] opacity-70" />
          </button>
        ) : (
          <span className="shrink-0 whitespace-nowrap rounded-full px-[7px] py-[2px] text-[10px] font-medium tabular-nums" style={{ background: `color-mix(in srgb, ${a} 10%, var(--ls-sup2))`, color: 'var(--ls-t3)' }}>
            {fechas}
          </span>
        )}
      </div>
      {editar && onAjustar && <EditorDeBaldosa ancla={editar} p={p} comp={comp} ajuste={ajuste} hoy={hoy} onCerrar={() => setEditar(null)} onAplicar={(x) => (onAjustar(x), setEditar(null))} />}

      {cargando ? (
        // La MISMA altura que con cifras (así no salta al llegar): «contando el dinero» con monedas que saltan y barras con brillo
        <div className="mt-4 flex flex-col">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ls-t4)]">Ventas</div>
          <div role="status" aria-label="Cargando las cifras" className="contents">
            <div className="ventas-brillo mt-1 h-[30px] w-[58%] rounded-[8px]" />
            <div className="ventas-brillo mt-[9px] h-[14px] w-[34%] rounded-full opacity-70" />
            <div className="-mx-4 mt-2 sm:-mx-5">
              <TrazoCargando color={a} alto={44} />
            </div>
            <div className="ventas-brillo -mt-1 h-[52px] w-full rounded-[13px] opacity-80" />
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ls-t4)]">Ventas</div>
          <CifraAnimada valor={t.ventas} formato={(v) => euros(v, 0)} className="mt-1 block text-[30px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-[var(--ls-t1)]" />
          <div className="mt-[7px] flex h-[16px] items-center gap-2 text-[11.5px] text-[var(--ls-t4)]">
            {hayComp ? (
              <>
                <Chip actual={t.ventas} anterior={c?.ventas} />
                <span className="tabular-nums">vs {euros(c?.ventas ?? 0, 0)}</span>
              </>
            ) : (
              <span>{p.escala ? 'al ritmo de este mes' : '\u00a0'}</span>
            )}
          </div>
          <div className="-mx-4 mt-2 sm:-mx-5">
            <MiniArea valores={serie} color={a} id={`ba-${i}`} viva={elegida} />
          </div>
          <div className="-mt-1 grid grid-cols-[1fr_1fr_1.25fr] divide-x divide-[color-mix(in_srgb,var(--ls-t1)_7%,transparent)] rounded-[13px] border border-[color-mix(in_srgb,var(--ls-t1)_6%,transparent)] bg-[color-mix(in_srgb,var(--ls-sup2)_72%,transparent)] py-[8px]">
            <Dato texto="Uds." valor={entero(t.unidades)} delta={hayComp ? <Chip actual={t.unidades} anterior={c?.unidades} /> : null} />
            <Dato onClick={t.reembolsos ? onReembolsos : undefined} texto="Reemb." valor={entero(t.reembolsos)} delta={hayComp ? <Chip actual={t.reembolsos} anterior={c?.reembolsos} inverso /> : null} />
            <Dato texto="Neto" valor={corto(t.neto)} color={t.neto >= 0 ? VERDE : ROJO} delta={hayComp ? <Chip actual={t.neto} anterior={c?.neto} /> : null} />
          </div>
        </>
      )}
      <button type="button" onClick={(e) => (e.stopPropagation(), onMas())} className="mt-3 inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--ls-t4)] transition-colors group-hover:text-[var(--ls-t2)]" style={{ ['--hover' as string]: a }} onMouseEnter={(e) => (e.currentTarget.style.color = b)} onMouseLeave={(e) => (e.currentTarget.style.color = '')}>
        Desglose <ArrowRight className="h-[12px] w-[12px] transition-transform group-hover:translate-x-[2px]" />
      </button>
    </motion.div>
  )
}

/**
 * CAMBIAR UNA BALDOSA (como Sellerboard): el periodo con un preajuste («Este mes», «Último trimestre»…, que se mueve con los días) o con fechas
 * propias, y con qué se compara (por defecto el mismo periodo del año anterior). Va en un portal: la baldosa se mueve (transform) y lo descolocaría.
 */
function EditorDeBaldosa({ ancla, p, comp, ajuste, hoy, onCerrar, onAplicar }: { ancla: DOMRect; p: Periodo; comp: Rango | null; ajuste: AjusteBaldosa | null; hoy: string; onCerrar: () => void; onAplicar: (a: AjusteBaldosa | null) => void }) {
  const [preajuste, setPreajuste] = useState<Preajuste | null>(ajuste?.preajuste ?? null)
  const [desde, setDesde] = useState(p.desde)
  const [hasta, setHasta] = useState(p.hastaPronostico ?? p.hasta)
  const [compPropia, setCompPropia] = useState(Boolean(ajuste?.comp))
  const [cDesde, setCDesde] = useState(comp?.desde ?? '')
  const [cHasta, setCHasta] = useState(comp?.hasta ?? '')
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar])
  const elegir = (x: Preajuste) => {
    const r = rangoDePreajuste(x, hoy)
    setPreajuste(x)
    setDesde(r.desde)
    setHasta(r.hasta)
  }
  const valido = /^\d{4}-\d{2}-\d{2}$/.test(desde) && /^\d{4}-\d{2}-\d{2}$/.test(hasta) && desde <= hasta && (!compPropia || (/^\d{4}-\d{2}-\d{2}$/.test(cDesde) && /^\d{4}-\d{2}-\d{2}$/.test(cHasta) && cDesde <= cHasta))
  const aplicar = () => {
    if (!valido) return
    const a: AjusteBaldosa = preajuste ? { preajuste } : { desde, hasta }
    if (compPropia) a.comp = { desde: cDesde, hasta: cHasta }
    onAplicar(a)
  }
  const ANCHO = 560
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight
  const movil = vw < 640
  const left = movil ? 8 : Math.min(Math.max(8, ancla.right - ANCHO), vw - ANCHO - 8)
  const abajo = ancla.bottom + 8
  const top = movil ? Math.max(8, vh - 560) : abajo + 470 > vh ? Math.max(8, ancla.top - 478) : abajo
  const campo = 'h-10 w-full rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-[13px] text-[var(--ls-t1)] outline-none focus:border-[#F26212] disabled:opacity-50'
  return createPortal(
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Cerrar" className="fixed inset-0 z-[60] cursor-default bg-black/20" onClick={onCerrar} />
      <div role="dialog" aria-label="Periodo de la baldosa" className="fixed z-[61] flex max-h-[88dvh] flex-col overflow-hidden rounded-[18px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-3)] sm:flex-row" style={{ left, top, width: movil ? vw - 16 : ANCHO }}>
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--ls-linea)] p-2 sm:w-[190px] sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r">
          {PREAJUSTES.map(([k, t]) => (
            <button key={k} type="button" onClick={() => elegir(k)} className={`flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-[9px] px-3 py-[7px] text-left text-[12.5px] ${preajuste === k ? 'bg-[color-mix(in_srgb,#F26212_14%,transparent)] text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)]'}`}>
              {t}
              {preajuste === k && <Check className="h-[13px] w-[13px] text-[#FF8A3D]" />}
            </button>
          ))}
          <button type="button" onClick={() => setPreajuste(null)} className={`flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-[9px] px-3 py-[7px] text-left text-[12.5px] ${!preajuste ? 'bg-[color-mix(in_srgb,#F26212_14%,transparent)] text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)]'}`}>
            Rango propio
            {!preajuste && <Check className="h-[13px] w-[13px] text-[#FF8A3D]" />}
          </button>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ls-t4)]">Periodo</div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={desde} max={hasta || undefined} onChange={(e) => (setDesde(e.target.value), setPreajuste(null))} className={campo} />
              <input type="date" value={hasta} min={desde || undefined} onChange={(e) => (setHasta(e.target.value), setPreajuste(null))} className={campo} />
            </div>
            {preajuste && <div className="mt-[6px] text-[11.5px] text-[var(--ls-t4)]">Se mueve solo con los días (mañana «{PREAJUSTES.find((x) => x[0] === preajuste)?.[1]}» seguirá siendo eso).</div>}
          </div>
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ls-t4)]">Comparar con</div>
            <label className="flex cursor-pointer items-center gap-2 py-1 text-[12.5px] text-[var(--ls-t2)]">
              <input type="radio" checked={!compPropia} onChange={() => setCompPropia(false)} className="accent-[#F26212]" />
              El mismo periodo del año anterior
            </label>
            <label className="flex cursor-pointer items-center gap-2 py-1 text-[12.5px] text-[var(--ls-t2)]">
              <input type="radio" checked={compPropia} onChange={() => setCompPropia(true)} className="accent-[#F26212]" />
              Otras fechas
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input type="date" disabled={!compPropia} value={cDesde} max={cHasta || undefined} onChange={(e) => setCDesde(e.target.value)} className={campo} />
              <input type="date" disabled={!compPropia} value={cHasta} min={cDesde || undefined} onChange={(e) => setCHasta(e.target.value)} className={campo} />
            </div>
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            {ajuste && (
              <button type="button" onClick={() => onAplicar(null)} className="mr-auto text-[12px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
                Volver a la de siempre
              </button>
            )}
            <button type="button" onClick={onCerrar} className="ml-auto h-10 rounded-[10px] border border-[var(--ls-linea)] px-4 text-[12.5px] text-[var(--ls-t2)]">
              Cancelar
            </button>
            <button type="button" disabled={!valido} onClick={aplicar} className="h-10 rounded-[10px] px-5 text-[12.5px] font-semibold text-[#141414] disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#F26212,#FF8A3D)' }}>
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** La minigráfica de la baldosa: área rellena con el color del periodo, que se dibuja al entrar */
export function MiniArea({ valores, color, id, viva, alto = 46 }: { valores: number[]; color: string; id: string; viva: boolean; alto?: number }) {
  // Se dibuja al ancho REAL de la baldosa (nada de estirar el SVG: deformaba el punto y la línea se quedaba corta al animarse)
  const caja = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(0)
  useEffect(() => {
    const el = caja.current
    if (!el) return
    const medir = () => setW(Math.round(el.getBoundingClientRect().width))
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = alto
  const PAD_X = 10
  const ARRIBA = 6
  const ABAJO = 4
  if (valores.length < 2) return <div ref={caja} style={{ height: H }} />
  const max = Math.max(...valores, 1)
  const ancho = Math.max(1, W - PAD_X * 2)
  const y = (v: number) => ARRIBA + (1 - Math.max(0, v) / max) * (H - ARRIBA - ABAJO)
  const pts = valores.map((v, k) => [PAD_X + (k / (valores.length - 1)) * ancho, y(v)] as const)
  // Curva suave que no se pasa de los valores (los puntos de control se quedan dentro del alto)
  const dentro = (v: number) => Math.min(H - ABAJO, Math.max(ARRIBA, v))
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = pts[k - 1] ?? pts[k]
    const p1 = pts[k]
    const p2 = pts[k + 1]
    const p3 = pts[k + 2] ?? p2
    const t = 0.18
    d += ` C ${(p1[0] + (p2[0] - p0[0]) * t).toFixed(1)} ${dentro(p1[1] + (p2[1] - p0[1]) * t).toFixed(1)}, ${(p2[0] - (p3[0] - p1[0]) * t).toFixed(1)} ${dentro(p2[1] - (p3[1] - p1[1]) * t).toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  const ultimo = pts[pts.length - 1]
  const area = `${d} L ${ultimo[0].toFixed(1)} ${H} L ${pts[0][0].toFixed(1)} ${H} Z`
  return (
    <div ref={caja} style={{ height: H }}>
      {W > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={`${id}-f`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={viva ? 0.28 : 0.16} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
            <clipPath id={`${id}-c`}>
              <motion.rect x={0} y={-10} height={H + 20} initial={{ width: 0 }} animate={{ width: W }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${id}-c)`}>
            <path d={area} fill={`url(#${id}-f)`} />
            <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" opacity={viva ? 1 : 0.8} />
          </g>
          <circle cx={ultimo[0]} cy={ultimo[1]} r={6} fill={color} opacity={0.18} />
          <circle cx={ultimo[0]} cy={ultimo[1]} r={2.8} fill={color} stroke="var(--ls-sup)" strokeWidth={1.2} />
        </svg>
      )}
    </div>
  )
}

/** El neto en la baldosa (que es estrecha): «964 €», y de 1.000 en adelante «8,7k €» */
const corto = (v: number) => euros(v)

/** Una de las tres cifras de abajo de la baldosa */
function Dato({ texto, valor, color, delta, onClick }: { texto: string; valor: string; color?: string; delta?: React.ReactNode; onClick?: () => void }) {
  if (onClick) {
    return (
      <button type="button" onClick={(e) => (e.stopPropagation(), onClick())} title="Ver los motivos" className="group/dato min-w-0 rounded-[8px] px-[10px] text-left transition-colors hover:bg-[color-mix(in_srgb,var(--ls-t1)_5%,transparent)]">
        <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)] group-hover/dato:text-[#60A5FA]">{texto} ›</div>
        <div className="whitespace-nowrap text-[14.5px] font-semibold tabular-nums text-[#60A5FA]">{valor}</div>
        <div className="h-[15px] whitespace-nowrap [&_*]:!text-[10.5px]">{delta}</div>
      </button>
    )
  }
  return (
    <div className="min-w-0 px-[10px]">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)]">{texto}</div>
      <div className="whitespace-nowrap text-[14.5px] font-semibold tabular-nums" style={{ color: color ?? 'var(--ls-t1)', textShadow: color ? `0 0 14px color-mix(in srgb, ${color} 40%, transparent)` : undefined }}>
        {valor}
      </div>
      <div className="h-[15px] whitespace-nowrap [&_*]:!text-[10.5px]">{delta}</div>
    </div>
  )
}


function Mini({ texto, valor, color, delta, nota, brillo }: { texto: string; valor: string; color?: string; delta?: React.ReactNode; nota?: string; brillo?: boolean }) {
  return (
    <div className="min-w-0 rounded-[12px] border border-[color-mix(in_srgb,var(--ls-t1)_5%,transparent)] bg-[color-mix(in_srgb,var(--ls-sup2)_70%,transparent)] px-[9px] py-[7px]">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)]">{texto}</div>
      <div className="truncate text-[14px] font-semibold tabular-nums" style={{ color: color ?? 'var(--ls-t1)', textShadow: brillo && color ? `0 0 14px color-mix(in srgb, ${color} 45%, transparent)` : undefined }}>
        {valor}
      </div>
      {delta && <div className="mt-[1px]">{delta}</div>}
      {nota && <div className="text-[10px] text-[var(--ls-t4)]">{nota}</div>}
    </div>
  )
}

function ProgresoDeLectura({ estado }: { estado: CuentaDelPanel['estado'] }) {
  const inicio = Date.now() - 62 * 86_400_000
  const avance = (hasta: string | null) => (hasta ? Math.max(0.04, Math.min(1, (Date.parse(hasta.length === 10 ? `${hasta}T23:59:00Z` : hasta) - inicio) / (Date.now() - inicio))) : 0.02)
  const pasos = [
    { icono: ShoppingBag, texto: 'Pedidos', hasta: estado.pedidosHasta },
    { icono: Receipt, texto: 'Dinero (comisiones y reembolsos)', hasta: estado.dineroHasta },
    { icono: Megaphone, texto: 'Publicidad por producto', hasta: estado.publicidadHasta },
  ]
  return (
    <div className={TARJETA + ' mb-5 p-5'}>
      <div className="flex items-center gap-3">
        <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,#F26212_14%,transparent)]">
          <Loader2 className="h-[15px] w-[15px] animate-spin text-[#FF8A3D]" />
        </span>
        <div>
          <div className="text-[14px] font-semibold text-[var(--ls-t1)]">Trayendo los últimos 62 días de Amazon</div>
          <div className="text-[12px] text-[var(--ls-t4)]">Se llena solo en unos minutos. No hace falta quedarse en la pantalla.</div>
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {pasos.map((p) => {
          const a = avance(p.hasta)
          const Icono = p.icono
          return (
            <div key={p.texto}>
              <div className="flex items-center gap-2 text-[12px] text-[var(--ls-t2)]">
                <Icono className="h-[13px] w-[13px] text-[var(--ls-t4)]" /> {p.texto}
                <span className="ml-auto tabular-nums text-[var(--ls-t4)]">{a >= 0.99 ? <Check className="h-[13px] w-[13px]" style={{ color: VERDE }} /> : p.hasta ? `hasta el ${fechaCorta(p.hasta.slice(0, 10)).slice(0, 5)}` : 'en cola'}</span>
              </div>
              <div className="mt-2 h-[4px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
                <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${a * 100}%` }} transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }} style={{ background: 'linear-gradient(90deg, #F26212, #FF8A3D)' }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ElegirRango({ inicial, hoy, activo, onAplicar }: { inicial: { desde: string; hasta: string }; hoy: string; activo: boolean; onAplicar: (r: { desde: string; hasta: string }) => void }) {
  const [desde, setDesde] = useState(inicial.desde)
  const [hasta, setHasta] = useState(inicial.hasta)
  const valido = desde && hasta && desde <= hasta && hasta <= hoy
  const campo = 'h-8 w-full rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12.5px] text-[var(--ls-t1)] outline-none [color-scheme:dark]'
  return (
    <div className="mt-1 border-t border-[var(--ls-linea)] px-3 pb-2 pt-3">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-[var(--ls-t2)]">
        <span className="w-[14px]">{activo && <Check className="h-[13px] w-[13px] text-[var(--ls-acc)]" />}</span>
        Rango personalizado
      </div>
      <div className="grid grid-cols-2 gap-2 pl-[22px]">
        <label className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ls-t4)]">
          Desde
          <input type="date" value={desde} max={hoy} onChange={(e) => setDesde(e.target.value)} className={campo} />
        </label>
        <label className="text-[10.5px] uppercase tracking-[0.08em] text-[var(--ls-t4)]">
          Hasta
          <input type="date" value={hasta} max={hoy} onChange={(e) => setHasta(e.target.value)} className={campo} />
        </label>
      </div>
      <div className="mt-2 flex justify-end">
        <button type="button" disabled={!valido} onClick={() => onAplicar({ desde, hasta })} className="h-8 rounded-[8px] px-3 text-[12px] font-semibold text-[#141414] disabled:opacity-40" style={{ background: 'linear-gradient(135deg, #F26212, #FF8A3D)' }}>
          Ver ese rango
        </button>
      </div>
    </div>
  )
}

function EstadoHistorial({ estado, hoy }: { estado: CuentaDelPanel['estado']; hoy: string }) {
  const desde = estado.historicoHasta ?? sumarDias(hoy, -62)
  // Amazon guarda 730 días: el objetivo nunca es más viejo que eso (lib/ventas/lectura-servidor.ts)
  const limite = sumarDias(hoy, -728)
  const objetivo = [estado.historicoObjetivo ?? limite, limite].sort().reverse()[0]
  const completo = desde <= objetivo
  return (
    <span className="ml-auto inline-flex items-center gap-2 text-[11.5px] text-[var(--ls-t4)]" title={completo ? 'Historial completo: 2 años' : 'El historial se carga solo hacia atrás, mes a mes, hasta 2 años'}>
      {completo ? <Check className="h-[12px] w-[12px]" style={{ color: VERDE }} /> : <Loader2 className="h-[12px] w-[12px] animate-spin" />}
      Datos desde el {fechaCorta(desde)}
      {!completo && <span className="text-[var(--ls-t4)]">· cargando hasta el {fechaCorta(objetivo)}</span>}
    </span>
  )
}


/** `textoCorto`: lo que se ve en el móvil ('' = solo el icono). `crece`: en el móvil ocupa el hueco que quede en la fila */
function Desplegable({ icono: Icono, texto, textoCorto, crece, children }: { icono: typeof Calendar; texto: string; textoCorto?: string; crece?: boolean; children: (cerrar: () => void) => React.ReactNode }) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setAbierto(false)
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])
  return (
    <div ref={caja} className={`relative ${crece ? 'min-w-0 flex-1 sm:flex-none' : 'shrink-0'}`}>
      <button type="button" onClick={() => setAbierto((x) => !x)} title={texto} className={`inline-flex h-9 max-w-full items-center gap-2 rounded-[11px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 text-[12.5px] text-[var(--ls-t2)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors hover:text-[var(--ls-t1)] hover:border-[color-mix(in_srgb,var(--ls-t1)_18%,var(--ls-linea))] ${crece ? 'w-full sm:w-auto' : ''}`} aria-expanded={abierto}>
        <Icono className="h-[14px] w-[14px] shrink-0 text-[var(--ls-t4)]" />
        {textoCorto !== undefined ? (
          <>
            {textoCorto && <span className="min-w-0 truncate sm:hidden">{textoCorto}</span>}
            <span className="hidden sm:inline">{texto}</span>
          </>
        ) : (
          texto
        )}
        <ChevronDown className={`ml-auto h-[13px] w-[13px] shrink-0 text-[var(--ls-t4)] transition-transform sm:ml-0 ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.16 }} className="absolute right-0 top-[42px] z-30 w-[min(300px,calc(100vw-2rem))] rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-1 shadow-[var(--ls-sombra-3)] sm:left-0 sm:right-auto sm:w-auto sm:min-w-[260px]">
          {children(() => setAbierto(false))}
        </motion.div>
      )}
    </div>
  )
}

function Opcion({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[12.5px] text-[var(--ls-t1)] hover:bg-[var(--ls-sup2)]">
      <span className="w-[14px]">{activa && <Check className="h-[13px] w-[13px] text-[var(--ls-acc)]" />}</span>
      {children}
    </button>
  )
}

/** Mientras llegan las cifras: una línea de ventas que se dibuja sola, con su relleno suave (y la rejilla en la gráfica grande). Sin texto ni monedas */
function TrazoCargando({ color, alto, rejilla = false }: { color: string; alto: number; rejilla?: boolean }) {
  const d = 'M0,70 C40,64 70,40 110,46 S170,72 210,58 S280,22 330,30 S400,52 440,38 S500,18 520,22'
  return (
    <div className="w-full" style={{ height: alto }} role="status" aria-label="Cargando">
      <svg viewBox="0 0 520 90" preserveAspectRatio="none" className="h-full w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={`tc-${color.slice(1)}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".22" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {rejilla && [18, 40, 62, 84].map((y) => <line key={y} x1="0" x2="520" y1={y} y2={y} stroke="var(--ls-linea)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3 5" />)}
        <path d={`${d} L520,90 L0,90 Z`} fill={`url(#tc-${color.slice(1)})`} style={{ animation: 'ventas-relleno 2.2s ease-in-out infinite' }} />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" pathLength={1} strokeDasharray="1" style={{ animation: 'ventas-trazo 2.2s cubic-bezier(.45,0,.25,1) infinite' }} />
      </svg>
    </div>
  )
}
