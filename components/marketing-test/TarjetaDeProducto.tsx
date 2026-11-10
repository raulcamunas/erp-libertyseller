'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import { COLOR_ESTADO, TEXTO, TIPO } from '@/lib/estilo/denso'
import type { GrupoDeProducto } from '@/lib/ads/productos-agrupar'
import { serieDiaria, tipoDeCampana, type FilaDiaria, type Totales } from '@/lib/ads/rendimiento-calculo'
import { COLOR_DE_TIPO, PuntoDeEstado, textoDeEstado } from './piezas'
import { decimal, dinero, entero, porcentaje } from './formato'
import type { CampanaViva } from './useRendimiento'

export type FilaDeCampana = Totales & { campaignId: string; nombre: string; estado: CampanaViva['estado'] | null; presupuesto: number | null; segmentacion: CampanaViva['segmentacion']; tipo: string }

/** Cómo se llama cada tipo de campaña en la tarjeta: lo que hace, no el código del SOP */
const NOMBRE_DE_TIPO: Record<string, string> = {
  'AUTO RADAR': 'Automática',
  'MANUAL AMPLIA': 'Amplia',
  'MANUAL EXACTA / DOMINIO': 'Exacta · dominio',
  'MANUAL EXACTA / ESTABILIDAD': 'Exacta · estabilidad',
  'ATAQUE ASIN': 'Ataque a ASIN',
  Otras: 'Sin nomenclatura',
}

/** El gasto y las ventas de cada día, en dos líneas sobre la misma escala */
function DobleChispa({ gasto, ventas }: { gasto: readonly number[]; ventas: readonly number[] }) {
  if (gasto.length < 2) return <div className="h-[44px]" />
  const max = Math.max(...gasto, ...ventas, 0.0001)
  const pts = (v: readonly number[]) => v.map((x, i) => `${(i / (v.length - 1)) * 100},${42 - (x / max) * 38}`).join(' ')
  return (
    <svg viewBox="0 0 100 44" preserveAspectRatio="none" className="h-[44px] w-full" aria-hidden>
      <polygon points={`0,44 ${pts(ventas)} 100,44`} fill={COLOR_ESTADO.verde} opacity="0.1" />
      <polyline points={pts(ventas)} fill="none" stroke={COLOR_ESTADO.verde} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <polyline points={pts(gasto)} fill="none" stroke={COLOR_ESTADO.azul} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

function Cifra({ etiqueta, valor, color, nota }: { etiqueta: string; valor: string; color?: string; nota?: string }) {
  return (
    <div className="min-w-0">
      <div className={`${TIPO.xs} ${TEXTO.t4}`}>{etiqueta}</div>
      <div className="text-[17px] font-semibold leading-[1.2] tracking-[-0.015em] tabular-nums" style={{ color: color ?? 'var(--ls-t1)' }}>
        {valor}
      </div>
      {nota && <div className={`${TIPO.xs} ${TEXTO.t4}`}>{nota}</div>}
    </div>
  )
}

/**
 * UN PRODUCTO, COMO UNA TARJETA: su nombre y ASIN, un veredicto frente a su ACoS de equilibrio, las cifras clave, la evolución del gasto y las ventas, cómo se reparte el gasto entre sus campañas y —al
 * desplegarlo— cada campaña con sus números. Sustituye a la tabla plana: con 50 campañas, lo que importa es qué producto va bien o mal, y eso se ve de un vistazo.
 */
export function TarjetaDeProducto({
  grupo,
  moneda,
  equilibrio,
  objetivo,
  filasDiarias,
  dias,
  conCifras,
  abierto,
  alternar,
  irAProductos,
}: {
  grupo: GrupoDeProducto<FilaDeCampana>
  moneda: string | null
  equilibrio: number | null
  /** El ACoS objetivo que ha fijado una persona (fracción), o null */
  objetivo: number | null
  filasDiarias: readonly FilaDiaria[]
  dias: readonly string[]
  conCifras: boolean
  abierto: boolean
  alternar: () => void
  irAProductos: () => void
}) {
  const t = grupo.totales
  const activas = grupo.campanas.filter((c) => c.estado === 'ENABLED').length
  const serie = serieDiaria(filasDiarias, dias)

  // El veredicto: primero, ¿pierde dinero (ACoS por encima de su equilibrio)?; después, ¿cumple el ACoS objetivo que fijó una persona?; y si no hay objetivo, ¿es rentable frente al equilibrio?
  let veredicto: { texto: string; color: string } | null = null
  if (conCifras && grupo.asin && (equilibrio !== null || objetivo !== null)) {
    if (t.acos === null) veredicto = t.gasto > 0 ? { texto: 'Gasta sin vender', color: COLOR_ESTADO.rojo } : null
    else if (equilibrio !== null && t.acos > equilibrio) veredicto = { texto: 'Pierde dinero', color: COLOR_ESTADO.rojo }
    else if (objetivo !== null) veredicto = t.acos <= objetivo ? { texto: 'En objetivo', color: COLOR_ESTADO.verde } : { texto: 'Por encima del objetivo', color: COLOR_ESTADO.ambar }
    else if (equilibrio !== null) veredicto = t.acos <= equilibrio * 0.7 ? { texto: 'Muy rentable', color: COLOR_ESTADO.verde } : { texto: 'Rentable', color: COLOR_ESTADO.verde }
  }
  const colorAcos = veredicto?.color

  // Cómo se reparte el gasto entre los tipos de campaña del producto
  const mezcla = (() => {
    const por = new Map<string, number>()
    for (const c of grupo.campanas) por.set(c.tipo, (por.get(c.tipo) ?? 0) + c.gasto)
    const total = [...por.values()].reduce((a, b) => a + b, 0)
    return total > 0 ? [...por.entries()].sort((a, b) => b[1] - a[1]).map(([tipo, gasto]) => ({ tipo, parte: gasto / total })) : []
  })()

  return (
    <article className="overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
      <button type="button" onClick={alternar} className="block w-full px-4 pb-3 pt-3 text-left hover:bg-[var(--ls-sup2)] focus-visible:outline-2 focus-visible:outline-[var(--ls-acc-graf)]" aria-expanded={abierto}>
        <div className="flex items-start gap-3">
          <span className="mt-[3px] text-[var(--ls-t3)]">{abierto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]" title={grupo.titulo}>
                {grupo.titulo}
              </h3>
              {veredicto && (
                <span className="inline-flex h-[19px] items-center rounded-full border px-[8px] text-[11px] font-medium" style={{ color: veredicto.color, borderColor: veredicto.color, background: 'transparent' }}>
                  {veredicto.texto}
                </span>
              )}
            </div>
            <div className={`mt-[2px] ${TIPO.xs} ${TEXTO.t4}`}>
              {grupo.asin ?? 'Campañas sin ASIN en el nombre'} · {grupo.campanas.length} {grupo.campanas.length === 1 ? 'campaña' : 'campañas'}
              {activas !== grupo.campanas.length ? ` · ${activas} ${activas === 1 ? 'activa' : 'activas'}` : ''}
              {grupo.asin && objetivo === null && (
                <>
                  {' · '}
                  <span
                    role="link"
                    tabIndex={0}
                    className="underline hover:text-[var(--ls-t1)]"
                    onClick={(e) => {
                      e.stopPropagation()
                      irAProductos()
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && irAProductos()}
                  >
                    fija su ACoS objetivo para valorarlo
                  </span>
                </>
              )}
            </div>
          </div>

          {conCifras && (
            <div className="hidden shrink-0 grid-cols-5 gap-5 md:grid">
              <Cifra etiqueta="Gasto" valor={dinero(t.gasto, moneda)} />
              <Cifra etiqueta="Ventas" valor={dinero(t.ventas, moneda)} />
              <Cifra etiqueta="ACoS" valor={porcentaje(t.acos)} color={colorAcos} nota={objetivo !== null ? `objetivo ${porcentaje(objetivo, 0)}` : equilibrio !== null ? `equilibrio ${porcentaje(equilibrio, 0)}` : undefined} />
              <Cifra etiqueta="ROAS" valor={t.roas == null ? '—' : decimal(t.roas)} />
              <Cifra etiqueta="Pedidos" valor={entero(t.pedidos)} />
            </div>
          )}
        </div>

        {conCifras && (
          <div className="mt-3 grid items-end gap-4 pl-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div>
              <DobleChispa gasto={serie.map((p) => p.gasto)} ventas={serie.map((p) => p.ventas)} />
              <div className={`mt-[2px] flex gap-3 ${TIPO.xs} ${TEXTO.t4}`}>
                <span className="inline-flex items-center gap-1"><span className="h-[6px] w-[6px] rounded-full" style={{ background: COLOR_ESTADO.azul }} /> Gasto diario</span>
                <span className="inline-flex items-center gap-1"><span className="h-[6px] w-[6px] rounded-full" style={{ background: COLOR_ESTADO.verde }} /> Ventas diarias</span>
              </div>
            </div>
            <div>
              {mezcla.length > 0 ? (
                <>
                  <div className="flex h-[8px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
                    {mezcla.map((m) => (
                      <div key={m.tipo} style={{ width: `${m.parte * 100}%`, background: COLOR_DE_TIPO[m.tipo] ?? COLOR_ESTADO.gris }} title={`${NOMBRE_DE_TIPO[m.tipo] ?? m.tipo}: ${porcentaje(m.parte, 0)}`} />
                    ))}
                  </div>
                  <div className={`mt-[5px] flex flex-wrap gap-x-3 gap-y-[2px] ${TIPO.xs} ${TEXTO.t3}`}>
                    {mezcla.map((m) => (
                      <span key={m.tipo} className="inline-flex items-center gap-1">
                        <span className="h-[6px] w-[6px] rounded-full" style={{ background: COLOR_DE_TIPO[m.tipo] ?? COLOR_ESTADO.gris }} />
                        {NOMBRE_DE_TIPO[m.tipo] ?? m.tipo} {porcentaje(m.parte, 0)}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <span className={`${TIPO.xs} ${TEXTO.t4}`}>Sin gasto en este periodo</span>
              )}
            </div>
          </div>
        )}
      </button>

      {abierto && (
        <div className="overflow-x-auto border-t border-[var(--ls-linea)] bg-[var(--ls-bg)]">
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr className={`${TIPO.xs} ${TEXTO.t4}`}>
                <th className="py-[6px] pl-11 pr-3 text-left font-semibold">Campaña</th>
                <th className="px-3 py-[6px] text-right font-semibold">Presupuesto / día</th>
                <th className="px-3 py-[6px] text-right font-semibold">Gasto</th>
                <th className="px-3 py-[6px] text-right font-semibold">Ventas</th>
                <th className="px-3 py-[6px] text-right font-semibold">ACoS</th>
                <th className="px-3 py-[6px] text-right font-semibold">Pedidos</th>
                <th className="px-3 py-[6px] text-right font-semibold">Clics</th>
                <th className="px-4 py-[6px] text-right font-semibold">CPC</th>
              </tr>
            </thead>
            <tbody>
              {grupo.campanas.map((f) => {
                const sinGastar = conCifras && f.gasto === 0
                return (
                  <tr key={f.campaignId} className={`hover:[&>td]:bg-[var(--ls-sup)] ${sinGastar ? 'opacity-55' : ''}`}>
                    <td className="border-t border-[var(--ls-linea)] py-[7px] pl-11 pr-3">
                      <div className="flex items-center gap-2">
                        <PuntoDeEstado estado={f.estado} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-[6px]">
                            <span className="h-[8px] w-[3px] rounded-full" style={{ background: COLOR_DE_TIPO[tipoDeCampana(f.nombre)] ?? COLOR_ESTADO.gris }} />
                            <span className={`${TEXTO.t1} font-medium`}>{f.nombre.startsWith('[ProductAI]') ? 'ProductAI (la crea Amazon)' : (NOMBRE_DE_TIPO[f.tipo] ?? f.tipo)}</span>
                            {f.estado !== 'ENABLED' && <span className={`${TIPO.xs} ${TEXTO.t4}`}>· {textoDeEstado(f.estado).toLowerCase()}</span>}
                          </div>
                          <div className={`max-w-[460px] truncate ${TIPO.xs} ${TEXTO.t4}`} title={f.nombre}>{f.nombre}</div>
                        </div>
                      </div>
                    </td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[7px] text-right tabular-nums text-[var(--ls-t2)]">{f.presupuesto == null ? '—' : dinero(f.presupuesto, moneda)}</td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[7px] text-right tabular-nums text-[var(--ls-t1)]">{conCifras ? dinero(f.gasto, moneda) : '—'}</td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[7px] text-right tabular-nums text-[var(--ls-t1)]">{conCifras ? dinero(f.ventas, moneda) : '—'}</td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[7px] text-right tabular-nums text-[var(--ls-t1)]">{conCifras ? porcentaje(f.acos) : '—'}</td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[7px] text-right tabular-nums text-[var(--ls-t1)]">{conCifras ? entero(f.pedidos) : '—'}</td>
                    <td className="border-t border-[var(--ls-linea)] px-3 py-[7px] text-right tabular-nums text-[var(--ls-t2)]">{conCifras ? entero(f.clics) : '—'}</td>
                    <td className="border-t border-[var(--ls-linea)] px-4 py-[7px] text-right tabular-nums text-[var(--ls-t2)]">{conCifras ? dinero(f.cpc, moneda) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}
