'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { ArrowDownRight, ArrowRight, ArrowUpRight, FileText, Megaphone, Radar, Search, TriangleAlert, Trash2, X } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { ConsultaHistorica } from '@/lib/seo/datos'
import type { GastoSemanal } from '@/lib/seo/periodo-mostrado'
import type { Movimientos } from '@/lib/seo/movimientos'
import type { Tarea } from '@/lib/seo/tareas'
import { revisarFicha } from '@/lib/seo/norma'
import { puntuarListing } from '@/lib/seo/puntuacion'
import { resumenDeProducto } from '@/lib/seo/resumen'
import { ImagenDeProducto } from '@/components/productos/ImagenDeProducto'
import { consultasDe, decisionesDe, diagnosticoDe, estiloDeVeredicto, fichaDe, nombreDe, serieDe } from './comun'
import type { DatosSeo } from './useCuentaSeo'
import { AnilloDePuntuacion, colorDePuntuacion } from './TarjetaDelEstudio'
import { FichaDelProducto } from './FichaDelProducto'
import { PanelDeLaCuenta } from './PanelDeLaCuenta'

/**
 * LOS PRODUCTOS EN MOSAICO (pestaña Productos): una tarjeta por producto con su imagen, la puntuación del listing, la cuota de compras con su curva semanal, el diagnóstico del embudo
 * y lo pendiente (tareas, movimientos de la semana, PPC, norma, highlights). Se filtran y ordenan arriba. Al pulsar una, se abre el panel del producto: la imagen «vuela» de la tarjeta a la
 * cabecera y debajo va el resumen de siempre (FichaDelProducto), con accesos a Ficha, Búsquedas y Competencia.
 */

type Orden = 'oportunidad' | 'puntuacion' | 'cuota' | 'tareas' | 'ppc'
const ORDENES: Array<{ id: Orden; texto: string }> = [
  { id: 'oportunidad', texto: 'Más por hacer' },
  { id: 'puntuacion', texto: 'Peor puntuación' },
  { id: 'cuota', texto: 'Mayor cuota' },
  { id: 'tareas', texto: 'Más tareas' },
  { id: 'ppc', texto: 'Más gasto PPC' },
]

// Por debajo del 1 % se enseñan 2 decimales (0,35 %) para no ver «0 %»; el máximo nunca puede quedar por debajo del mínimo (RangeError y la pestaña entera caía)
const pct = (x: number | null | undefined, d = 1) => {
  if (x == null) return '—'
  const min = x < 0.01 && x > 0 ? 2 : 0
  return `${(x * 100).toLocaleString('es-ES', { minimumFractionDigits: min, maximumFractionDigits: Math.max(d, min) })} %`
}

interface Fila {
  id: string
  asin: string
  nombre: string
  puntuacion: number | null
  cuota: number | null
  serie: number[]
  variacion: number | null
  veredicto: ReturnType<typeof diagnosticoDe>['producto']['veredicto'] | null
  tareas: number
  graveTarea: boolean
  graves: number
  sinHighlights: boolean
  suben: number
  bajan: number
  gasto: number | null
  busquedas: number
  principal: string | null
}

export function MosaicoDeProductos({
  cuentaId,
  datos,
  movimientos,
  tareas,
  gasto4,
  quitar,
  historial,
  verBusquedas,
  verBusqueda,
  verFicha,
  verHoy,
  verCompetencia,
}: {
  cuentaId: string
  datos: DatosSeo
  movimientos: ReadonlyMap<string, Movimientos>
  tareas: readonly Tarea[]
  gasto4: (asin: string) => number | null
  quitar: (id: string, nombre: string) => void
  historial?: { filas: ConsultaHistorica[]; gastoSemanal: GastoSemanal[] | null }
  verBusquedas: (asin: string) => void
  verBusqueda?: (asin: string, consulta: string) => void
  verFicha: (asin: string) => void
  verHoy?: () => void
  verCompetencia?: (asin: string) => void
}) {
  const mkt = cuentaId.split('~')[1] ?? null
  const [buscar, setBuscar] = useState('')
  const [orden, setOrden] = useState<Orden>('oportunidad')
  const [abierto, setAbierto] = useState<string | null>(null)

  const filas = useMemo<Fila[]>(() => {
    const decisiones = decisionesDe(datos)
    return datos.productos.map((p) => {
      const ficha = fichaDe(datos, p.asin)
      const mes = consultasDe(datos, p.asin, 'MONTH')
      const consultas = mes.length > 0 ? mes : consultasDe(datos, p.asin, 'WEEK')
      const r = resumenDeProducto(consultas, ficha, datos.precios?.[p.asin] ?? null, decisiones)
      const diag = consultas.length > 0 ? diagnosticoDe(datos, p.asin) : null
      const serie = serieDe(datos, p.asin, 'WEEK').map((x) => x.cuotaCompras).filter((x): x is number => x != null).slice(-12)
      const ultima = serie[serie.length - 1]
      const penultima = serie[serie.length - 2]
      const puntuacion = ficha ? puntuarListing({ titulo: ficha.titulo ?? '', highlights: ficha.highlights ?? '', bullets: ficha.bullets, descripcion: ficha.descripcion, backend: ficha.backend ?? '' }, diag?.busquedas ?? []).total : null
      const mov = movimientos.get(p.asin)
      const suyas = tareas.filter((t) => t.asin === p.asin)
      return {
        id: p.id,
        asin: p.asin,
        nombre: nombreDe(p, ficha),
        puntuacion,
        cuota: r.cuotaCompras,
        serie,
        variacion: ultima != null && penultima != null && penultima > 0 ? ultima / penultima - 1 : null,
        veredicto: diag?.producto.veredicto ?? null,
        tareas: suyas.length,
        graveTarea: suyas.some((t) => t.gravedad === 'grave'),
        graves: ficha ? revisarFicha(ficha).incidencias.filter((i) => i.gravedad === 'grave').length : 0,
        sinHighlights: !!ficha && !ficha.origenHighlights,
        suben: mov?.suben.length ?? 0,
        bajan: mov?.bajan.length ?? 0,
        gasto: gasto4(p.asin),
        busquedas: r.busquedas,
        principal: r.principal,
      }
    })
  }, [datos, movimientos, tareas, gasto4])

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    const xs = filas.filter((f) => !q || f.nombre.toLowerCase().includes(q) || f.asin.toLowerCase().includes(q))
    const por: Record<Orden, (a: Fila, b: Fila) => number> = {
      oportunidad: (a, b) => Number(b.graveTarea) - Number(a.graveTarea) || b.tareas - a.tareas || (a.puntuacion ?? 101) - (b.puntuacion ?? 101),
      puntuacion: (a, b) => (a.puntuacion ?? 101) - (b.puntuacion ?? 101),
      cuota: (a, b) => (b.cuota ?? -1) - (a.cuota ?? -1),
      tareas: (a, b) => b.tareas - a.tareas,
      ppc: (a, b) => (b.gasto ?? -1) - (a.gasto ?? -1),
    }
    return [...xs].sort(por[orden])
  }, [filas, buscar, orden])

  const elegido = filas.find((f) => f.asin === abierto) ?? null
  const media = filas.filter((f) => f.puntuacion != null)
  const mediaPuntuacion = media.length ? Math.round(media.reduce((s, f) => s + (f.puntuacion ?? 0), 0) / media.length) : null

  return (
    <LayoutGroup>
      <PanelDeLaCuenta datos={datos} puntuaciones={filas.map((f) => f.puntuacion).filter((x): x is number => x != null)} sinHighlights={filas.filter((f) => f.sinHighlights).length} fueraDeNorma={filas.filter((f) => f.graves > 0).length} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-[320px]">
          <Search className="absolute left-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-[var(--ls-t4)]" />
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar producto o ASIN" className="h-[34px] w-full rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] pl-9 pr-3 text-[12.5px] text-[var(--ls-t1)] outline-none transition-colors focus:border-[var(--ls-acc)]" />
        </div>
        <div className="flex flex-wrap gap-1 rounded-[11px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-[3px]">
          {ORDENES.map((o) => (
            <button key={o.id} type="button" onClick={() => setOrden(o.id)} className="relative h-[28px] rounded-[8px] px-[10px] text-[12px] font-medium transition-colors" style={{ color: orden === o.id ? 'var(--ls-t1)' : 'var(--ls-t3)' }}>
              {orden === o.id && <motion.span layoutId="orden-mosaico" className="absolute inset-0 rounded-[8px] bg-[var(--ls-sup2)]" transition={{ type: 'spring', stiffness: 380, damping: 32 }} />}
              <span className="relative">{o.texto}</span>
            </button>
          ))}
        </div>
        {mediaPuntuacion != null && (
          <span className="ml-auto flex items-center gap-2 text-[12px] text-[var(--ls-t3)]">
            Puntuación media <AnilloDePuntuacion valor={mediaPuntuacion} lado={34} grosor={4} />
          </span>
        )}
      </div>

      <motion.div layout className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
        <AnimatePresence initial={true}>
          {visibles.map((f, i) => (
            <motion.article
              key={f.id}
              layout
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26, delay: Math.min(i, 12) * 0.03 }}
              whileHover={{ y: -3 }}
              onClick={() => setAbierto(f.asin)}
              className="group relative flex cursor-pointer flex-col overflow-hidden rounded-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] transition-[border-color,box-shadow] hover:border-[var(--ls-linea2)] hover:shadow-[var(--ls-sombra-2)]"
            >
              {/* Brillo del color de la puntuación al pasar el ratón */}
              <span aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-30" style={{ background: f.puntuacion != null ? colorDePuntuacion(f.puntuacion) : 'var(--ls-acc)' }} />
              <div className="relative flex items-start gap-3 p-3">
                <motion.div layoutId={`img-${f.asin}`}>
                  <ImagenDeProducto asin={f.asin} mkt={mkt} lado={64} redondeo={12} />
                </motion.div>
                <div className="min-w-0 flex-1">
                  <h3 className="line-clamp-2 text-[13px] font-semibold leading-[1.3] text-[var(--ls-t1)]" title={f.nombre}>
                    {f.nombre}
                  </h3>
                  <div className="mt-1 font-mono text-[10.5px] text-[var(--ls-t4)]">{f.asin}</div>
                </div>
                {f.puntuacion != null && <AnilloDePuntuacion valor={f.puntuacion} lado={40} grosor={4} />}
              </div>

              <div className="relative flex items-end justify-between gap-2 px-3">
                <div>
                  <div className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--ls-t4)]">Cuota de compras</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[22px] font-bold tabular-nums tracking-[-0.02em] text-[var(--ls-t1)]">{pct(f.cuota)}</span>
                    {f.variacion != null && Math.abs(f.variacion) >= 0.01 && (
                      <span className="inline-flex items-center text-[11px] font-semibold tabular-nums" style={{ color: f.variacion > 0 ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo }}>
                        {f.variacion > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {Math.abs(Math.round(f.variacion * 100))} %
                      </span>
                    )}
                  </div>
                </div>
                <Curva id={f.asin} valores={f.serie} />
              </div>

              <div className="relative mt-2 flex flex-wrap items-center gap-[6px] px-3 pb-3">
                {f.veredicto ? (
                  <span className="rounded-[6px] px-[7px] py-[1px] text-[11px] font-semibold" style={{ color: estiloDeVeredicto(f.veredicto).color, background: `color-mix(in srgb, ${estiloDeVeredicto(f.veredicto).color} 13%, transparent)` }} title={f.veredicto.motivo}>
                    {estiloDeVeredicto(f.veredicto).texto}
                  </span>
                ) : (
                  <span className="text-[11px] text-[var(--ls-t4)]">Sin búsquedas aún</span>
                )}
                {(f.suben > 0 || f.bajan > 0) && (
                  <span className="text-[11px] tabular-nums">
                    <span style={{ color: COLOR_ESTADO.verde }}>▲{f.suben}</span> <span style={{ color: COLOR_ESTADO.rojo }}>▼{f.bajan}</span>
                  </span>
                )}
              </div>

              <div className="relative mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap border-t border-[var(--ls-linea)] px-3 py-[8px] text-[11px] text-[var(--ls-t3)]">
                <span style={{ color: f.graveTarea ? COLOR_ESTADO.rojo : undefined }}>
                  {f.tareas} {f.tareas === 1 ? 'tarea' : 'tareas'}
                </span>
                {f.graves > 0 && <span style={{ color: COLOR_ESTADO.rojo }} title="Incidencias graves de la norma 2026">{f.graves} {f.graves === 1 ? 'grave' : 'graves'}</span>}
                {f.sinHighlights && (
                  <span className="inline-flex items-center gap-1" style={{ color: COLOR_ESTADO.ambar }} title="No están guardados los Item Highlights: pégalos en la pestaña Ficha">
                    <TriangleAlert className="h-3 w-3" /> highlights
                  </span>
                )}
                {f.gasto != null && (
                  <span className="ml-auto inline-flex items-center gap-1 tabular-nums" title="Gasto PPC de las 4 últimas semanas">
                    <Megaphone className="h-3 w-3" /> {Math.round(f.gasto).toLocaleString('es-ES')} €
                  </span>
                )}
              </div>
            </motion.article>
          ))}
        </AnimatePresence>
      </motion.div>
      {visibles.length === 0 && <p className="py-8 text-center text-[12.5px] text-[var(--ls-t4)]">Ningún producto con «{buscar}».</p>}

      <PanelDeProducto
        f={elegido}
        mkt={mkt}
        cerrar={() => setAbierto(null)}
        quitar={quitar}
        acciones={{ verFicha, verBusquedas, verCompetencia }}
      >
        {elegido && (
          <FichaDelProducto
            enPanel
            cuentaId={cuentaId}
            verCompetencia={verCompetencia}
            datos={datos}
            asin={elegido.asin}
            historial={historial?.filas ?? []}
            gastoSemanal={historial?.gastoSemanal ?? null}
            movimientos={movimientos.get(elegido.asin) ?? null}
            tareas={tareas.filter((t) => t.asin === elegido.asin)}
            volver={() => setAbierto(null)}
            verBusquedas={verBusquedas}
            verBusqueda={verBusqueda ?? ((a) => verBusquedas(a))}
            verFicha={verFicha}
            verHoy={verHoy ?? (() => undefined)}
          />
        )}
      </PanelDeProducto>
    </LayoutGroup>
  )
}

/** La curva semanal de la cuota de compras, con degradado; se dibuja de izquierda a derecha al aparecer */
function Curva({ id, valores, ancho = 112, alto = 40 }: { id: string; valores: number[]; ancho?: number; alto?: number }) {
  if (valores.length < 2) return <span className="text-[10.5px] text-[var(--ls-t4)]">curva en 2 semanas</span>
  const max = Math.max(...valores)
  const min = Math.min(...valores)
  const rango = max - min || max || 1
  const pts = valores.map((v, i) => [(i / (valores.length - 1)) * ancho, alto - 4 - ((v - min) / rango) * (alto - 8)] as const)
  const linea = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${linea} L${ancho},${alto} L0,${alto} Z`
  const sube = valores[valores.length - 1] >= valores[0]
  const color = sube ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo
  const gid = `g-${id}`
  return (
    <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path d={area} fill={`url(#${gid})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.2 }} />
      <motion.path d={linea} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: 'easeOut' }} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={color} />
    </svg>
  )
}

/** El panel del producto: entra desde la derecha con un muelle; la imagen llega volando desde la tarjeta */
function PanelDeProducto({
  f,
  mkt,
  cerrar,
  quitar,
  acciones,
  children,
}: {
  f: Fila | null
  mkt: string | null
  cerrar: () => void
  quitar: (id: string, nombre: string) => void
  acciones: { verFicha: (asin: string) => void; verBusquedas: (asin: string) => void; verCompetencia?: (asin: string) => void }
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!f) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && cerrar()
    window.addEventListener('keydown', k)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', k)
      document.body.style.overflow = antes
    }
  }, [f, cerrar])
  return (
    <AnimatePresence>
      {f && (
        <>
          <motion.div key="velo" className="fixed inset-0 z-50 bg-[rgba(6,7,9,0.6)] backdrop-blur-[4px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={cerrar} />
          <motion.aside
            key="panel"
            role="dialog"
            aria-label={f.nombre}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[980px] flex-col overflow-hidden border-l border-[var(--ls-linea2)] bg-[var(--ls-fondo)] shadow-[var(--ls-sombra-3)] sm:rounded-l-[22px]"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 280, damping: 32 }}
          >
            <div className="relative overflow-hidden border-b border-[var(--ls-linea)] px-5 pb-4 pt-5">
              <span aria-hidden className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full opacity-25 blur-3xl" style={{ background: f.puntuacion != null ? colorDePuntuacion(f.puntuacion) : 'var(--ls-acc)' }} />
              <div className="relative flex items-start gap-4">
                <motion.div layoutId={`img-${f.asin}`}>
                  <ImagenDeProducto asin={f.asin} mkt={mkt} lado={104} redondeo={16} />
                </motion.div>
                <div className="min-w-0 flex-1">
                  <motion.h2 initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="line-clamp-2 text-[17px] font-semibold leading-[1.3] text-[var(--ls-t1)]">
                    {f.nombre}
                  </motion.h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--ls-t4)]">
                    <span className="font-mono">{f.asin}</span>
                    {f.principal && (
                      <span>
                        · búsqueda principal <span className="text-[var(--ls-t2)]">{f.principal}</span>
                      </span>
                    )}
                  </div>
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }} className="mt-3 flex flex-wrap gap-2">
                    <BotonPanel icono={FileText} onClick={() => { cerrar(); acciones.verFicha(f.asin) }}>Editar la ficha</BotonPanel>
                    <BotonPanel icono={Search} onClick={() => { cerrar(); acciones.verBusquedas(f.asin) }}>Búsquedas</BotonPanel>
                    {acciones.verCompetencia && <BotonPanel icono={Radar} onClick={() => { cerrar(); acciones.verCompetencia?.(f.asin) }}>Competencia</BotonPanel>}
                    <button type="button" onClick={() => { cerrar(); quitar(f.id, f.nombre) }} className="inline-flex h-[30px] items-center gap-[6px] rounded-[9px] px-2 text-[12px] text-[var(--ls-t4)] transition-colors hover:text-[var(--ls-t1)]" title="Dejar de seguir">
                      <Trash2 className="h-[13px] w-[13px]" />
                    </button>
                  </motion.div>
                </div>
                {f.puntuacion != null && (
                  <div className="hidden flex-col items-center gap-1 sm:flex">
                    <AnilloDePuntuacion valor={f.puntuacion} lado={72} grosor={7} />
                    <span className="text-[10.5px] text-[var(--ls-t4)]">puntuación SEO</span>
                  </div>
                )}
                <button type="button" onClick={cerrar} aria-label="Cerrar" className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
                  <X className="h-[16px] w-[16px]" />
                </button>
              </div>
            </div>
            <motion.div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.25 }}>
              {children}
            </motion.div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function BotonPanel({ icono: Icono, onClick, children }: { icono: typeof FileText; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-[30px] items-center gap-[6px] rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-[10px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
      <Icono className="h-[13px] w-[13px]" /> {children} <ArrowRight className="h-3 w-3 opacity-50" />
    </button>
  )
}
