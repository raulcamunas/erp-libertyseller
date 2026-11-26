'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, ChartColumnBig, LayoutGrid, Rows3, Calendar, Check, ChevronDown, Coins, GitCompareArrows, Globe, Loader2, Megaphone, Plus, Receipt, RefreshCw, ShoppingBag } from 'lucide-react'
import { CabeceraDeModulo, Chispa, CifraAnimada, PanelLateral, Segmentado } from '@/components/ui-ls'
import { hoyEnMadrid, periodosDe, rangoAComparar, sumarDias, TANDAS, totalizar, enRango, type Comparar, type FilaPanel, type Periodo, type Tanda, type Totales } from '@/lib/ventas/panel'
import type { CuentaDelPanel, LineaDelPanel } from '@/lib/ventas/panel-servidor'
import { SelectorDeCuenta } from './SelectorDeCuenta'
import { SelectorDeProductos, type ProductoElegible } from './SelectorDeProductos'
import { VistaGrafico } from './VistaGrafico'
import { VistaPyG } from './VistaPyG'
import { AltoEstable, SERIES_GRAFICA, type SerieGrafica, Buscador, Chip, CuentaDeResultados, Desglose, entero, euros, fechaCorta, GraficaVentas, pais, bandera, pct, RepartoDelDinero, ROJO, TablaPedidos, TablaProductos, VERDE } from './piezas'

/**
 * VENTAS · EL TABLERO (el «Sellerboard» propio, 26 nov 2026). Una cuenta arriba; cinco baldosas con su periodo (Hoy, Ayer, Este mes, Pronóstico, Mes
 * pasado… o las otras tandas) comparadas con el año anterior o el periodo anterior; al pulsar una, la gráfica, el reparto del dinero y las tablas de
 * productos, pedidos y cuenta de resultados se ponen en ese periodo. Todas las cuentas de beneficio, en el navegador (lib/ventas/panel.ts).
 */

type Datos = { filas: FilaPanel[]; productos: { titulos: Record<string, { titulo: string | null; asin: string | null }>; costes: Record<string, number>; catalogo?: Array<{ sku: string; mkt: string; asin: string | null; titulo: string | null; activo: boolean }> } | null; lineas: LineaDelPanel[] | null }
type Pestana = 'productos' | 'pedidos' | 'resultados'

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init })
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null
  if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`)
  return j as T
}

const minimo = (xs: string[]) => xs.reduce((a, b) => (b < a ? b : a))
const maximo = (xs: string[]) => xs.reduce((a, b) => (b > a ? b : a))

export function TableroVentas() {
  const [cuentas, setCuentas] = useState<CuentaDelPanel[] | null>(null)
  const [libres, setLibres] = useState<Array<{ id: string; nombre: string; cliente: string | null }>>([])
  const [cuentaId, setCuentaId] = useState<string | null>(null)
  const [tanda, setTanda] = useState<Tanda>('clasica')
  const [rango, setRango] = useState<{ desde: string; hasta: string } | null>(null)
  const [vista, setVista] = useState<'baldosas' | 'grafico' | 'pyg'>('baldosas')
  const [seleccion, setSeleccion] = useState<Set<string> | null>(null)
  // De qué cuenta son los datos que se están enseñando: al cambiar de cliente (o de filtros) las cifras cambian, pero eso NO es una venta nueva
  const [datosDe, setDatosDe] = useState<string | null>(null)
  const [series, setSeries] = useState<Set<SerieGrafica>>(new Set(['ventas', 'neto', 'publicidad']))
  const [comparar, setComparar] = useState<Comparar>('anio')
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
  const [anadir, setAnadir] = useState(false)
  const [reloj, setReloj] = useState(0)
  const peticion = useRef(0)
  const cache = useRef<{ productosDe: string | null; productos: Datos['productos']; compDe: string | null }>({ productosDe: null, productos: null, compDe: null })

  const { hoy, fraccion } = useMemo(() => hoyEnMadrid(), [reloj]) // eslint-disable-line react-hooks/exhaustive-deps
  const periodos: Periodo[] = useMemo(
    () => (tanda === 'rango' && rango ? [{ id: 'rango', titulo: 'Rango elegido', desde: rango.desde, hasta: rango.hasta }] : periodosDe(tanda === 'rango' ? 'clasica' : tanda, hoy, fraccion)),
    [tanda, rango, hoy, fraccion],
  )
  const comparados = useMemo(() => periodos.map((p) => rangoAComparar(p, comparar)), [periodos, comparar])
  const cuenta = cuentas?.find((c) => c.id === cuentaId) ?? null
  const periodoElegido = periodos.find((p) => p.id === elegido) ?? periodos[0]

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
    const claveComp = `${cuentaId}|${rangoComparacion?.desde}|${rangoComparacion?.hasta}`
    const conComp = cache.current.compDe !== claveComp
    const principal = pedir<Datos>(`/api/ventas?cuenta=${cuentaId}&desde=${rangoPrincipal.desde}&hasta=${rangoPrincipal.hasta}${conProductos ? '' : '&productos=0'}`)
    const comp = rangoComparacion && conComp ? pedir<Datos>(`/api/ventas?cuenta=${cuentaId}&desde=${rangoComparacion.desde}&hasta=${rangoComparacion.hasta}&productos=0`) : Promise.resolve(null)
    Promise.all([principal, comp])
      .then(([a, b]) => {
        if (n !== peticion.current) return
        if (conProductos) cache.current = { ...cache.current, productosDe: cuentaId, productos: a.productos }
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
    pedir<Datos>(`/api/ventas?cuenta=${cuentaId}&desde=${periodoElegido.desde}&hasta=${periodoElegido.desde}&productos=0&lineasDesde=${periodoElegido.desde}&lineasHasta=${periodoElegido.hasta}`)
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
  const iva = cuenta?.iva ?? 21

  const totales: Totales[] = useMemo(() => periodos.map((p) => totalizar(filas.filter((f) => enRango(f.dia, p)), iva, costes, p.escala ?? 1)), [periodos, filas, iva, costes])
  const totalesComp: Array<Totales | null> = useMemo(
    () => comparados.map((r) => (r ? totalizar(filasComp.filter((f) => enRango(f.dia, r)), iva, costes) : null)),
    [comparados, filasComp, iva, costes],
  )
  const iElegido = Math.max(0, periodos.findIndex((p) => p.id === periodoElegido.id))
  const tElegido = totales[iElegido]
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

  return (
    <Marco
      debajo={
        <Segmentado
          etiqueta="Vista"
          valor={vista}
          onCambio={setVista}
          opciones={[
            { id: 'baldosas', texto: 'Baldosas', icono: LayoutGrid },
            { id: 'grafico', texto: 'Gráfico', icono: ChartColumnBig },
            { id: 'pyg', texto: 'P&L', icono: Rows3 },
          ]}
        />
      }
      acciones={
        <div className="flex flex-wrap items-center gap-2">
          {cuentas && <SelectorDeCuenta cuentas={cuentas} valor={cuentaId} onCambio={(id) => (setCuentaId(id), setSeleccion(null))} onAnadir={() => setAnadir(true)} />}
          <button type="button" onClick={() => { cache.current = { productosDe: null, productos: null, compDe: null }; setReloj((x) => x + 1) }} className="inline-flex h-11 w-11 items-center justify-center rounded-[13px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t2)] hover:text-[var(--ls-t1)]" title="Volver a leer" aria-label="Volver a leer">
            {cargando ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <RefreshCw className="h-[14px] w-[14px]" />}
          </button>
        </div>
      }
    >
      <style>{`@keyframes ventas-entra { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }`}</style>

      {cuenta?.estado.primeraLectura && <ProgresoDeLectura estado={cuenta.estado} />}
      {cuenta?.estado.error && !cuenta.estado.primeraLectura && (
        <div className="mb-4 flex items-start gap-2 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3 text-[12px] text-[var(--ls-t3)]">
          <AlertTriangle className="mt-[1px] h-[14px] w-[14px] shrink-0" style={{ color: 'var(--ls-e-ambar)' }} /> Última lectura con avisos: {cuenta.estado.error}
        </div>
      )}
      {error && <p className="mb-4 rounded-[12px] border border-[var(--ls-linea)] p-3 text-[12.5px]" style={{ color: ROJO }}>{error}</p>}

      {cuenta && <SelectorDeProductos productos={elegibles} seleccion={seleccion} onCambio={setSeleccion} />}
      <AltoEstable clave={vista}>
      {cuenta && vista === 'grafico' && <VistaGrafico cuenta={cuenta} hoy={hoy} skus={seleccion} />}
      {cuenta && vista === 'pyg' && <VistaPyG cuenta={cuenta} hoy={hoy} skus={seleccion} />}
      {vista === 'baldosas' && (
        <>
      {/* Los filtros */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Desplegable icono={Calendar} texto={tanda === 'rango' && rango ? `${fechaCorta(rango.desde)} – ${fechaCorta(rango.hasta)}` : (TANDAS.find((t) => t.id === tanda)?.texto ?? '')}>
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
        <Desplegable icono={Globe} texto={!mercados || mercados.size === mercadosConDatos.length ? 'Todos los países' : `${mercados.size} ${mercados.size === 1 ? 'país' : 'países'}`}>
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
        <Desplegable icono={GitCompareArrows} texto={comparar === 'anio' ? 'Comparar con el año anterior' : comparar === 'anterior' ? 'Comparar con el periodo anterior' : 'Sin comparar'}>
          {(cerrar) =>
            (
              [
                ['anio', 'Comparar año sobre año'],
                ['anterior', 'Comparar con el periodo anterior'],
                ['no', 'No comparar'],
              ] as Array<[Comparar, string]>
            ).map(([v, t]) => (
              <Opcion key={v} activa={comparar === v} onClick={() => (setComparar(v), cerrar())}>
                {t}
              </Opcion>
            ))
          }
        </Desplegable>
        {cargando && !datos && <span className="inline-flex items-center gap-1 text-[12px] text-[var(--ls-t4)]"><Loader2 className="h-[12px] w-[12px] animate-spin" /> leyendo…</span>}
        {cuenta && !cuenta.estado.primeraLectura && <EstadoHistorial estado={cuenta.estado} hoy={hoy} />}
      </div>

      {/* Las baldosas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {periodos.map((p, i) => (
          <Baldosa key={`${tanda}-${p.id}`} contexto={`${datosDe}|${[...(mercados ?? [])].join()}|${[...(seleccion ?? [])].join()}`} p={p} i={i} t={totales[i]} c={totalesComp[i]} serie={serieDe(p)} cargando={Boolean(cuenta?.estado.primeraLectura) && !datos?.filas.length} elegida={p.id === periodoElegido.id} onElegir={() => setElegido(p.id)} onMas={() => setDesglose(p)} />
        ))}
      </div>

      {/* La gráfica y el reparto del dinero */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
        <section className={TARJETA + ' p-5'}>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div>
              <div className={ROTULO}>Evolución diaria</div>
              <div className="mt-1 text-[15px] font-semibold text-[var(--ls-t1)]">Ventas y ganancia</div>
            </div>
            <div className="ml-auto inline-flex flex-wrap items-center rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[3px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]" role="group" aria-label="Qué se dibuja">
              {SERIES_GRAFICA.map((x) => {
                const on = series.has(x.id)
                return (
                  <button
                    key={x.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSeries((s0) => { const n = new Set(s0); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n.size ? n : s0 })}
                    className="relative flex h-[28px] items-center gap-2 rounded-[9px] px-3 text-[12px] font-medium transition-all duration-200"
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
          <GraficaVentas filas={filas} dias={diasGrafica} ivaPct={iva} costes={costes} resaltado={periodoElegido} series={series} />
        </section>
        <section className={TARJETA + ' flex flex-col gap-5 p-5'}>
          <div>
            <div className={ROTULO}>{periodoElegido.titulo}</div>
            <div className="mt-1 text-[15px] font-semibold text-[var(--ls-t1)]">A dónde va cada euro</div>
          </div>
          {tElegido && <RepartoDelDinero t={tElegido} />}
          <div className="mt-auto grid grid-cols-3 gap-3 border-t border-[var(--ls-linea)] pt-4">
            <Mini texto="Ventas" valor={euros(tElegido?.ventas ?? 0, 0)} />
            <Mini texto="TACOS" valor={pct(tElegido?.tacos ?? null)} />
            <Mini texto="ROI" valor={tElegido?.roi == null ? '—' : pct(tElegido.roi, 0)} nota={tElegido?.unidadesSinCoste ? 'faltan costes' : undefined} />
          </div>
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
        {pestana === 'productos' && <TablaProductos filas={filasElegidas} ivaPct={iva} costes={costes} titulos={titulos} buscar={buscar} />}
        {pestana === 'pedidos' &&
          (lineas == null ? (
            <p className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-[var(--ls-t4)]">
              <Loader2 className="h-[14px] w-[14px] animate-spin" /> Cargando los pedidos…
            </p>
          ) : (
            <TablaPedidos lineas={mercados ? lineas.filter((l) => mercados.has(l.mkt)) : lineas} titulos={titulos} ivaPct={iva} costes={costes} buscar={buscar} />
          ))}
        {pestana === 'resultados' && <CuentaDeResultados periodos={periodos} totales={totales} />}
        </AltoEstable>
      </section>

        </>
      )}
      </AltoEstable>

      <PanelLateral abierto={desglose != null} onCambio={(a) => !a && setDesglose(null)} titulo={desglose?.titulo ?? ''} descripcion={desglose ? `${fechaCorta(desglose.desde)} – ${fechaCorta(desglose.hastaPronostico ?? desglose.hasta)}${desglose.escala ? ' · pronóstico del mes entero' : ''}` : ''} icono={Coins} acento="marca" ancho={440}>
        {desglose && <Desglose t={totales[periodos.findIndex((p) => p.id === desglose.id)] ?? totalizar([], iva, costes)} />}
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

function Marco({ children, acciones, debajo }: { children: React.ReactNode; acciones?: React.ReactNode; debajo?: React.ReactNode }) {
  return (
    <div className="w-full min-w-0 pb-12 lg:px-1">
      <CabeceraDeModulo icono={Coins} acento="marca" titulo="Sellerboard" subtitulo="Ventas, tarifas, publicidad y beneficio de cada cliente, con los datos de su cuenta de Amazon" acciones={acciones} debajo={debajo} />
      <div className="mt-4">{children}</div>
    </div>
  )
}

const TARJETA = 'rounded-[20px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_1px_2px_rgba(0,0,0,0.18)]'
const ROTULO = 'text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)]'

function Baldosa({ contexto, p, i, t, c, serie, cargando, elegida, onElegir, onMas }: { contexto: string; p: Periodo; i: number; t: Totales; c: Totales | null; serie: number[]; cargando: boolean; elegida: boolean; onElegir: () => void; onMas: () => void }) {
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
  const fechas = p.desde === p.hasta ? fechaCorta(p.desde).slice(0, 5) : `${fechaCorta(p.desde).slice(0, 5)} – ${fechaCorta(p.hastaPronostico ?? p.hasta).slice(0, 5)}`
  const hayComp = c != null && (c.ventas !== 0 || c.unidades !== 0)
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      onClick={onElegir}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onElegir()}
      aria-pressed={elegida}
      className={`group relative cursor-pointer overflow-hidden p-5 text-left transition-all duration-300 ${TARJETA} ${elegida ? '' : 'hover:border-[color-mix(in_srgb,var(--ls-t1)_16%,var(--ls-linea))]'}`}
      style={elegida ? { borderColor: 'color-mix(in srgb, #F26212 45%, var(--ls-linea))', background: 'linear-gradient(180deg, color-mix(in srgb, #F26212 7%, var(--ls-sup)) 0%, var(--ls-sup) 55%)', boxShadow: '0 18px 40px -24px rgba(242,98,18,0.55), inset 0 1px 0 rgba(255,255,255,0.05)' } : undefined}
    >
      {subida && (
        <>
          <motion.div key={`brillo-${subida.id}`} initial={{ opacity: 0.55 }} animate={{ opacity: 0 }} transition={{ duration: 2.6, ease: 'easeOut' }} className="pointer-events-none absolute inset-0 rounded-[20px]" style={{ background: 'radial-gradient(120% 80% at 30% 20%, rgba(74,222,128,0.22), transparent 60%)' }} />
          <motion.span key={`sube-${subida.id}`} initial={{ opacity: 0, y: 8, scale: 0.9 }} animate={{ opacity: [0, 1, 1, 0], y: [8, -6, -18, -30], scale: [0.9, 1, 1, 1] }} transition={{ duration: 3, times: [0, 0.15, 0.7, 1], ease: 'easeOut' }} className="pointer-events-none absolute right-5 top-[62px] z-[2] rounded-full px-[9px] py-[3px] text-[12px] font-semibold tabular-nums text-[#0b2e17]" style={{ background: 'linear-gradient(135deg, #4ADE80, #86EFAC)', boxShadow: '0 6px 18px -6px rgba(74,222,128,0.7)' }}>
            +{euros(subida.importe, 2)}
          </motion.span>
        </>
      )}
      {elegida && <motion.div layoutId="baldosa-elegida" className="absolute inset-x-6 top-0 h-[2px] rounded-full" style={{ background: 'linear-gradient(90deg, transparent, #FF8A3D, transparent)' }} />}
      <div className="flex items-baseline justify-between gap-2">
        <span className={`truncate text-[13px] font-medium ${elegida ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t2)]'}`}>{p.escala ? 'Pronóstico' : p.titulo}</span>
        <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-[var(--ls-t4)]">{fechas}</span>
      </div>

      {cargando ? (
        <div className="mt-5 flex flex-col gap-3">
          <div className="h-[26px] w-2/3 animate-pulse rounded-[8px] bg-[var(--ls-sup2)]" />
          <div className="h-[34px] w-full animate-pulse rounded-[8px] bg-[var(--ls-sup2)]" />
          <div className="h-[30px] w-full animate-pulse rounded-[8px] bg-[var(--ls-sup2)]" />
        </div>
      ) : (
        <>
          <div className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)]">Ventas</div>
          <div className="mt-1 flex items-baseline gap-2">
            <CifraAnimada valor={t.ventas} formato={(v) => euros(v, 0)} className="text-[27px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[var(--ls-t1)]" />
          </div>
          <div className="mt-[6px] flex h-[16px] items-center gap-2 text-[11.5px] text-[var(--ls-t4)]">
            {hayComp ? (
              <>
                <Chip actual={t.ventas} anterior={c?.ventas} />
                <span className="tabular-nums">vs {euros(c?.ventas ?? 0, 0)}</span>
              </>
            ) : (
              <span>{p.escala ? 'al ritmo de este mes' : '\u00a0'}</span>
            )}
          </div>
          <div className="-mx-1 mt-3 opacity-90 transition-opacity group-hover:opacity-100">
            <Chispa valores={serie} color={elegida ? '#FF8A3D' : 'var(--ls-t3)'} alto={34} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[var(--ls-linea)] pt-3">
            <Mini texto="Uds." valor={entero(t.unidades)} delta={hayComp ? <Chip actual={t.unidades} anterior={c?.unidades} /> : null} />
            <Mini texto="Reemb." valor={entero(t.reembolsos)} delta={hayComp ? <Chip actual={t.reembolsos} anterior={c?.reembolsos} inverso /> : null} />
            <Mini texto="Neto" valor={compacto(t.neto)} color={t.neto >= 0 ? VERDE : ROJO} delta={hayComp ? <Chip actual={t.neto} anterior={c?.neto} /> : null} />
          </div>
        </>
      )}
      <button type="button" onClick={(e) => (e.stopPropagation(), onMas())} className="mt-3 inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--ls-t4)] transition-colors hover:text-[#FF8A3D] group-hover:text-[var(--ls-t2)]">
        Desglose <ArrowRight className="h-[12px] w-[12px] transition-transform group-hover:translate-x-[2px]" />
      </button>
    </motion.div>
  )
}

/** «9.636 €», y de 10.000 en adelante «10,1k €» (cabe en la columna) */
const compacto = (v: number) => (Math.abs(v) >= 10_000 ? `${(v / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })}k €` : euros(v, 0))

function Mini({ texto, valor, color, delta, nota }: { texto: string; valor: string; color?: string; delta?: React.ReactNode; nota?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ls-t4)]">{texto}</div>
      <div className="truncate text-[14px] font-semibold tabular-nums" style={{ color: color ?? 'var(--ls-t1)' }}>
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
  const objetivo = estado.historicoObjetivo ?? sumarDias(hoy, -730)
  const completo = desde <= objetivo
  return (
    <span className="ml-auto inline-flex items-center gap-2 text-[11.5px] text-[var(--ls-t4)]" title={completo ? 'Historial completo: 2 años' : 'El historial se carga solo hacia atrás, mes a mes, hasta 2 años'}>
      {completo ? <Check className="h-[12px] w-[12px]" style={{ color: VERDE }} /> : <Loader2 className="h-[12px] w-[12px] animate-spin" />}
      Datos desde el {fechaCorta(desde)}
      {!completo && <span className="text-[var(--ls-t4)]">· cargando hasta el {fechaCorta(objetivo)}</span>}
    </span>
  )
}


function Desplegable({ icono: Icono, texto, children }: { icono: typeof Calendar; texto: string; children: (cerrar: () => void) => React.ReactNode }) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setAbierto(false)
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])
  return (
    <div ref={caja} className="relative">
      <button type="button" onClick={() => setAbierto((x) => !x)} className="inline-flex h-9 items-center gap-2 rounded-[11px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 text-[12.5px] text-[var(--ls-t2)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors hover:text-[var(--ls-t1)] hover:border-[color-mix(in_srgb,var(--ls-t1)_18%,var(--ls-linea))]" aria-expanded={abierto}>
        <Icono className="h-[14px] w-[14px] text-[var(--ls-t4)]" />
        {texto}
        <ChevronDown className={`h-[13px] w-[13px] text-[var(--ls-t4)] transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.16 }} className="absolute left-0 top-[42px] z-30 min-w-[260px] rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-1 shadow-[var(--ls-sombra-3)]">
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

