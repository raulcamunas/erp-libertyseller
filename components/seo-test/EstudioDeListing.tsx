'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { ArrowRight, Check, Plus, RotateCcw, Sparkles, Target, Wand2, X } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { bytesDe, caracteresDe, LIMITE_BACKEND_BYTES, LIMITE_BULLETS_BYTES, LIMITE_HIGHLIGHTS_CARACTERES, LIMITE_TITULO_CARACTERES } from '@/lib/seo/cobertura'
import { puntuarListing, type BloqueDePuntuacion, type PalabraDelEstudio } from '@/lib/seo/puntuacion'
import type { ConsultaGuardada } from '@/lib/seo/datos'
import type { BusquedaDiagnosticada } from '@/lib/seo/embudo'
import type { TextosFicha } from '@/lib/seo/edicion'
import { ImagenDeProducto } from '@/components/productos/ImagenDeProducto'

/**
 * EL ESTUDIO DE LISTING: a pantalla completa, para armar la ficha SEO definitiva con la puntuación de 0 a 100 en vivo (lib/seo/puntuacion.ts).
 *   · a la izquierda, los campos con sus contadores (se ponen ámbar al acercarse al límite y rojos al pasarlo);
 *   · a la derecha, el marcador que se mueve al escribir, los seis bloques, «lo siguiente» (las 3 acciones que más suman), las palabras que pesan (se encienden al entrar en la ficha; al
 *     pulsar una que falta se añade al backend) y las búsquedas, que se van marcando.
 * No escribe en Amazon: «Llevar al editor» pasa el texto al editor de siempre (validar en Amazon → confirmar → aplicar, con su registro).
 */

const VACIOS = (t: TextosFicha): TextosFicha => ({ ...t, bullets: t.bullets.length >= 5 ? [...t.bullets] : [...t.bullets, ...Array(5 - t.bullets.length).fill('')] })
const colorDe = (n: number) => (n >= 90 ? COLOR_ESTADO.verde : n >= 70 ? '#a3d65c' : n >= 50 ? COLOR_ESTADO.ambar : COLOR_ESTADO.rojo)
const ZONA: Record<NonNullable<PalabraDelEstudio['donde']>, string> = { titulo: 'título', highlights: 'highlights', bullets: 'viñetas', backend: 'backend', descripcion: 'descripción' }

export function EstudioDeListing({
  abierto,
  cerrar,
  asin,
  mkt,
  nombre,
  inicial,
  busquedas,
  llevarAlEditor,
}: {
  abierto: boolean
  cerrar: () => void
  asin: string
  mkt: string | null
  nombre: string
  inicial: TextosFicha
  busquedas: ReadonlyArray<BusquedaDiagnosticada<ConsultaGuardada>>
  llevarAlEditor?: (t: TextosFicha) => void
}) {
  const [t, setT] = useState<TextosFicha>(() => VACIOS(inicial))
  useEffect(() => {
    if (abierto) setT(VACIOS(inicial))
  }, [abierto, inicial])
  const base = useMemo(() => puntuarListing(VACIOS(inicial), busquedas).total, [inicial, busquedas])
  const p = useMemo(() => puntuarListing(t, busquedas), [t, busquedas])

  // Cerrar con Escape y no desplazar la página de detrás
  useEffect(() => {
    if (!abierto) return
    const f = (e: KeyboardEvent) => e.key === 'Escape' && cerrar()
    window.addEventListener('keydown', f)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', f)
      document.body.style.overflow = antes
    }
  }, [abierto, cerrar])

  const poner = (campo: keyof TextosFicha, valor: string) => setT((x) => ({ ...x, [campo]: valor }))
  const ponerVineta = (i: number, valor: string) => setT((x) => ({ ...x, bullets: x.bullets.map((b, j) => (j === i ? valor : b)) }))
  const alBackend = (palabra: string) => setT((x) => ({ ...x, backend: `${(x.backend ?? '').trim()} ${palabra}`.trim() }))

  return (
    <AnimatePresence>
      {abierto && (
        <motion.div key="estudio" className="fixed inset-0 z-[60] flex flex-col bg-[rgba(6,7,9,0.72)] backdrop-blur-[6px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <motion.div
            className="relative m-0 flex min-h-0 flex-1 flex-col overflow-hidden border-[var(--ls-linea2)] bg-[var(--ls-fondo)] shadow-[var(--ls-sombra-3)] sm:m-3 sm:rounded-[22px] sm:border lg:m-6"
            initial={{ opacity: 0, y: 28, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.99 }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          >
            {/* Luz del color de la puntuación, arriba */}
            <motion.div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[70%] -translate-x-1/2 rounded-full blur-3xl" animate={{ background: colorDe(p.total), opacity: 0.16 }} transition={{ duration: 0.6 }} />

            <header className="relative flex items-center gap-3 border-b border-[var(--ls-linea)] px-4 py-3 sm:px-6">
              <ImagenDeProducto asin={asin} mkt={mkt} lado={44} redondeo={10} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ls-t4)]">
                  <Wand2 className="h-3 w-3" /> Estudio de listing
                </div>
                <div className="truncate text-[15px] font-semibold text-[var(--ls-t1)]">{nombre}</div>
              </div>
              <button type="button" onClick={() => setT(VACIOS(inicial))} className="hidden h-[34px] items-center gap-[6px] rounded-[10px] border border-[var(--ls-linea)] px-3 text-[12.5px] text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)] sm:inline-flex" title="Volver a la ficha de Amazon">
                <RotateCcw className="h-[14px] w-[14px]" /> Empezar de nuevo
              </button>
              {llevarAlEditor && (
                <button
                  type="button"
                  onClick={() => {
                    llevarAlEditor({ ...t, bullets: t.bullets.filter((b) => b.trim()) })
                    cerrar()
                  }}
                  className="inline-flex h-[34px] items-center gap-[6px] rounded-[10px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)] transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
                >
                  Llevar al editor <ArrowRight className="h-[14px] w-[14px]" />
                </button>
              )}
              <button type="button" onClick={cerrar} aria-label="Cerrar" className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
                <X className="h-[16px] w-[16px]" />
              </button>
            </header>

            <div className="relative grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.9fr)] lg:overflow-hidden">
              {/* ---------- los campos ---------- */}
              <div className="flex flex-col gap-4 p-4 sm:p-6 lg:overflow-y-auto">
                <Campo etiqueta="Título" usado={caracteresDe(t.titulo)} limite={LIMITE_TITULO_CARACTERES} unidad="caracteres" ideal={60}>
                  <textarea value={t.titulo} onChange={(e) => poner('titulo', e.target.value.replace(/\n/g, ' '))} rows={2} className={CAMPO} placeholder="Marca + término principal + nicho + atributo + variante" />
                </Campo>
                <Campo etiqueta="Item Highlights" usado={caracteresDe(t.highlights ?? '')} limite={LIMITE_HIGHLIGHTS_CARACTERES} unidad="caracteres">
                  <textarea value={t.highlights ?? ''} onChange={(e) => poner('highlights', e.target.value.replace(/\n/g, ' '))} rows={2} className={CAMPO} placeholder="Lo que no cabe en el título: se indexa igual" />
                </Campo>
                <Campo etiqueta="Viñetas" usado={bytesDe(t.bullets.join(''))} limite={LIMITE_BULLETS_BYTES} unidad="bytes" ideal={750}>
                  <div className="flex flex-col gap-2">
                    {t.bullets.map((b, i) => (
                      <div key={i} className="relative">
                        <span className="absolute left-3 top-[11px] text-[11px] font-semibold tabular-nums text-[var(--ls-t4)]">{i + 1}</span>
                        <textarea value={b} onChange={(e) => ponerVineta(i, e.target.value.replace(/\n/g, ' '))} rows={2} className={`${CAMPO} pl-8 pr-14`} placeholder="Beneficio concreto delante y un grupo de búsquedas" />
                        <span className="absolute bottom-2 right-3 text-[10.5px] tabular-nums text-[var(--ls-t4)]">{bytesDe(b)} B</span>
                      </div>
                    ))}
                  </div>
                </Campo>
                <Campo etiqueta="Backend (palabras clave ocultas)" usado={bytesDe(t.backend)} limite={LIMITE_BACKEND_BYTES} unidad="bytes" ideal={180}>
                  <textarea value={t.backend} onChange={(e) => poner('backend', e.target.value.replace(/\n/g, ' '))} rows={3} className={`${CAMPO} font-mono text-[12.5px]`} placeholder="Sinónimos y búsquedas que no caben arriba, separados por espacios" />
                </Campo>
              </div>

              {/* ---------- el marcador ---------- */}
              <aside className="flex flex-col gap-4 border-t border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-sup)_55%,transparent)] p-4 sm:p-6 lg:overflow-y-auto lg:border-l lg:border-t-0">
                <div className="flex items-center gap-5">
                  <Marcador valor={p.total} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-[var(--ls-t1)]">{p.total >= 100 ? '¡Listing al 100!' : p.total >= 90 ? 'Casi perfecto' : p.total >= 70 ? 'Buen listing' : p.total >= 50 ? 'Mejorable' : 'Hay mucho que ganar'}</div>
                    <div className="mt-1 text-[12px] text-[var(--ls-t3)]">
                      La ficha de Amazon tiene <b className="tabular-nums text-[var(--ls-t2)]">{base}</b>
                      <AnimatePresence mode="popLayout">
                        {p.total !== base && (
                          <motion.span key={p.total - base} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="ml-2 inline-block rounded-full px-[7px] py-[1px] text-[11px] font-semibold tabular-nums" style={{ color: p.total > base ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo, background: `color-mix(in srgb, ${p.total > base ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo} 14%, transparent)` }}>
                            {p.total > base ? '+' : ''}
                            {p.total - base}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                    {p.sinBusquedas && <div className="mt-1 text-[11.5px]" style={{ color: COLOR_ESTADO.ambar }}>Sin búsquedas de Brand Analytics: se puntúa solo la norma, los highlights y el sitio.</div>}
                  </div>
                </div>

                <div className="flex flex-col gap-[10px]">
                  {p.bloques.map((b, i) => (
                    <BarraDeBloque key={b.id} b={b} i={i} />
                  ))}
                </div>

                {p.siguientes.length > 0 && (
                  <div className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
                    <div className="mb-2 flex items-center gap-[6px] text-[12px] font-semibold text-[var(--ls-t1)]">
                      <Target className="h-[13px] w-[13px]" style={{ color: 'var(--ls-acc)' }} /> Lo siguiente
                    </div>
                    <AnimatePresence initial={false}>
                      {p.siguientes.map((s) => (
                        <motion.div key={s.texto} layout initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10, height: 0 }} transition={{ duration: 0.25 }} className="flex items-start gap-2 py-[5px] text-[12.5px] leading-[1.45] text-[var(--ls-t2)]">
                          <span className="mt-[1px] shrink-0 rounded-full px-[6px] text-[10.5px] font-semibold tabular-nums" style={{ color: COLOR_ESTADO.verde, background: `color-mix(in srgb, ${COLOR_ESTADO.verde} 13%, transparent)` }}>
                            +{s.puntos}
                          </span>
                          {s.texto}
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}

                {p.palabras.length > 0 && (
                  <div>
                    <div className="mb-2 text-[12px] font-semibold text-[var(--ls-t1)]">Palabras que pesan</div>
                    <div className="flex flex-wrap gap-[6px]">
                      {p.palabras.map((x) => (
                        <motion.button
                          key={x.raiz}
                          type="button"
                          layout
                          onClick={() => !x.donde && alBackend(x.palabra)}
                          title={x.donde ? `En ${ZONA[x.donde]} · ${x.compras.toLocaleString('es-ES')} compras detrás` : `Falta · ${x.compras.toLocaleString('es-ES')} compras detrás. Pulsa para añadirla al backend`}
                          animate={{ scale: [1, x.donde ? 1.08 : 1, 1] }}
                          transition={{ duration: 0.35 }}
                          className="inline-flex items-center gap-1 rounded-full border px-[9px] py-[3px] text-[12px] transition-colors"
                          style={
                            x.donde
                              ? { borderColor: `color-mix(in srgb, ${COLOR_ESTADO.verde} 45%, transparent)`, color: COLOR_ESTADO.verde, background: `color-mix(in srgb, ${COLOR_ESTADO.verde} 10%, transparent)`, boxShadow: `0 0 14px -4px ${COLOR_ESTADO.verde}` }
                              : { borderColor: 'var(--ls-linea)', color: 'var(--ls-t3)', cursor: 'copy' }
                          }
                        >
                          {x.donde ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                          {x.palabra}
                          {x.donde && <span className="text-[10px] opacity-70">{ZONA[x.donde]}</span>}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                )}

                {p.busquedas.length > 0 && (
                  <div>
                    <div className="mb-2 text-[12px] font-semibold text-[var(--ls-t1)]">
                      Búsquedas del producto <span className="font-normal text-[var(--ls-t4)]">· {p.busquedas.filter((b) => b.enTitulo).length} en el título · {p.busquedas.filter((b) => b.enFicha).length} de {p.busquedas.length} en la ficha</span>
                    </div>
                    <div className="flex flex-col">
                      {p.busquedas.slice(0, 20).map((b) => {
                        const color = b.enTitulo ? COLOR_ESTADO.verde : b.enFicha ? COLOR_ESTADO.azul : 'var(--ls-t4)'
                        return (
                          <div key={b.consulta} className="flex items-center gap-2 border-t border-[var(--ls-linea)] py-[6px] text-[12.5px] first:border-t-0">
                            <motion.span layout className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border" style={{ borderColor: color, background: b.enFicha ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent' }}>
                              {b.enFicha && <Check className="h-[10px] w-[10px]" style={{ color }} />}
                            </motion.span>
                            <span className="min-w-0 flex-1 truncate text-[var(--ls-t1)]">{b.consulta}</span>
                            <span className="shrink-0 text-[11px]" style={{ color }}>
                              {b.enTitulo ? 'en el título' : b.enFicha ? 'en la ficha' : `falta: ${b.faltan.join(', ')}`}
                            </span>
                            <span className="w-[54px] shrink-0 text-right text-[11px] tabular-nums text-[var(--ls-t4)]">{b.compras.toLocaleString('es-ES')}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const CAMPO =
  'w-full resize-y rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-[9px] text-[13.5px] leading-[1.5] text-[var(--ls-t1)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ls-acc)_18%,transparent)]'

function Campo({ etiqueta, usado, limite, unidad, ideal, children }: { etiqueta: string; usado: number; limite: number; unidad: string; ideal?: number; children: React.ReactNode }) {
  const parte = Math.min(1, usado / limite)
  const color = usado > limite ? COLOR_ESTADO.rojo : ideal != null && usado < ideal ? COLOR_ESTADO.ambar : COLOR_ESTADO.verde
  return (
    <section>
      <div className="mb-[6px] flex items-center gap-3">
        <span className="text-[12.5px] font-semibold text-[var(--ls-t1)]">{etiqueta}</span>
        <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-[var(--ls-sup2)]">
          <motion.div className="h-full rounded-full" animate={{ width: `${parte * 100}%`, background: color }} transition={{ type: 'spring', stiffness: 220, damping: 26 }} />
        </div>
        <span className="text-[11.5px] tabular-nums" style={{ color: usado > limite ? COLOR_ESTADO.rojo : 'var(--ls-t3)' }}>
          {usado.toLocaleString('es-ES')} / {limite.toLocaleString('es-ES')} {unidad}
        </span>
      </div>
      {children}
    </section>
  )
}

/** El anillo de 0 a 100: se llena y cuenta con un muelle; al llegar a 100, brilla */
function Marcador({ valor }: { valor: number }) {
  const R = 46
  const L = 2 * Math.PI * R
  const mv = useMotionValue(0)
  const texto = useTransform(mv, (v) => Math.round(v).toString())
  const offset = useTransform(mv, (v) => L * (1 - v / 100))
  const previo = useRef(0)
  useEffect(() => {
    const c = animate(mv, valor, { type: 'spring', stiffness: 120, damping: 20 })
    previo.current = valor
    return () => c.stop()
  }, [valor, mv])
  const color = colorDe(valor)
  return (
    <div className="relative h-[116px] w-[116px] shrink-0">
      <motion.div aria-hidden className="absolute inset-2 rounded-full blur-xl" animate={{ background: color, opacity: valor >= 100 ? [0.35, 0.6, 0.35] : 0.18 }} transition={valor >= 100 ? { duration: 1.6, repeat: Infinity } : { duration: 0.5 }} />
      <svg viewBox="0 0 116 116" className="relative h-full w-full -rotate-90">
        <circle cx="58" cy="58" r={R} fill="none" stroke="var(--ls-sup2)" strokeWidth="9" />
        <motion.circle cx="58" cy="58" r={R} fill="none" strokeWidth="9" strokeLinecap="round" strokeDasharray={L} style={{ strokeDashoffset: offset }} animate={{ stroke: color }} transition={{ duration: 0.4 }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span className="text-[34px] font-bold leading-none tabular-nums tracking-[-0.03em] text-[var(--ls-t1)]">{texto}</motion.span>
        <span className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--ls-t4)]">de 100</span>
      </div>
      {valor >= 100 && (
        <motion.span className="absolute -right-1 -top-1" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
          <Sparkles className="h-5 w-5" style={{ color: COLOR_ESTADO.verde }} />
        </motion.span>
      )}
    </div>
  )
}

function BarraDeBloque({ b, i }: { b: BloqueDePuntuacion; i: number }) {
  const parte = b.maximo > 0 ? b.puntos / b.maximo : 0
  const color = !b.medible ? 'var(--ls-t4)' : parte >= 0.95 ? COLOR_ESTADO.verde : parte >= 0.6 ? COLOR_ESTADO.ambar : COLOR_ESTADO.rojo
  return (
    <div title={b.siguiente ?? 'Al máximo'}>
      <div className="mb-[4px] flex items-center justify-between text-[12px]">
        <span className="text-[var(--ls-t2)]">{b.nombre}</span>
        <span className="tabular-nums text-[var(--ls-t3)]">{b.medible ? `${Math.round(b.puntos)} / ${b.maximo}` : 'sin datos'}</span>
      </div>
      <div className="h-[7px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
        <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${(b.medible ? parte : 0) * 100}%`, background: color }} transition={{ type: 'spring', stiffness: 160, damping: 24, delay: i * 0.04 }} />
      </div>
    </div>
  )
}
