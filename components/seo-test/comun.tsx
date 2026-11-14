'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, Check, Copy, X } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { ConsultaAnterior, ConsultaGuardada, FichaGuardada, ProductoSeguido, PuntoDeEvolucion } from '@/lib/seo/datos'
import { cuotasDe, diagnosticarTodas, embudoDelProducto, ETAPAS, NOMBRE_DE_ETAPA, RESPONSABLE, RESPONSABLE_INFRAEXPUESTA, type BusquedaDiagnosticada, type ContextoDeEmbudo, type Etapa, type FilaDeEmbudo, type Veredicto } from '@/lib/seo/embudo'
import { consultasDelProducto } from '@/lib/seo/tareas'
import type { DatosSeo } from './useCuentaSeo'

/** Las búsquedas de un producto en el periodo pedido (o, si no hay del mes, las de la semana) */
export function consultasDe(datos: DatosSeo, asin: string, periodo: 'MONTH' | 'WEEK'): ConsultaGuardada[] {
  return datos.consultas[periodo].filter((c) => c.asin === asin)
}

export function fichaDe(datos: DatosSeo, asin: string): FichaGuardada | null {
  return datos.fichas.find((f) => f.asin === asin) ?? null
}

export const nombreDe = (p: ProductoSeguido, ficha: FichaGuardada | null) => p.nombre || ficha?.titulo || p.asin

/** El selector de producto de las pestañas Búsquedas y Ficha */
export function SelectorDeProducto({ productos, datos, asin, setAsin }: { productos: ProductoSeguido[]; datos: DatosSeo; asin: string | null; setAsin: (a: string) => void }) {
  return (
    <label className="inline-flex min-w-0 items-center gap-2">
      <span className="text-[12px] text-[var(--ls-t4)]">Producto</span>
      <select value={asin ?? ''} onChange={(e) => setAsin(e.target.value)} className="h-[30px] max-w-[420px] rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12.5px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]">
        {productos.map((p) => (
          <option key={p.id} value={p.asin}>
            {nombreDe(p, fichaDe(datos, p.asin)).slice(0, 70)} · {p.asin}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Una marca de «está» / «no está» para la cobertura en la ficha */
export function Marca({ si, texto }: { si: boolean; texto: string }) {
  return (
    <span className="inline-flex h-[20px] items-center gap-[3px] rounded-[5px] px-[5px] text-[10.5px] font-semibold" style={si ? { color: COLOR_ESTADO.verde, background: `color-mix(in srgb, ${COLOR_ESTADO.verde} 13%, transparent)` } : { color: 'var(--ls-t4)', background: 'var(--ls-sup2)' }} title={`${texto}: ${si ? 'está entera' : 'no está entera'}`}>
      {si ? <Check className="h-[10px] w-[10px]" /> : <X className="h-[10px] w-[10px]" />}
      {texto}
    </span>
  )
}

/** Una barra de cuota (0..1) con su porcentaje */
export function BarraDeCuota({ valor, color = COLOR_ESTADO.azul }: { valor: number | null; color?: string }) {
  if (valor == null) return <span className="text-[var(--ls-t4)]">—</span>
  const pct = Math.max(0, Math.min(1, valor))
  return (
    <div className="ml-auto flex w-[96px] items-center justify-end gap-2">
      <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-[var(--ls-sup2)]">
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct * 100, 2)}%`, background: color }} />
      </div>
      <span className="w-[42px] text-right tabular-nums">{(pct * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %</span>
    </div>
  )
}

/** La evolución de un producto en un tipo de periodo, de la más vieja a la más nueva */
export function serieDe(datos: DatosSeo, asin: string, periodo: 'MONTH' | 'WEEK'): PuntoDeEvolucion[] {
  return (datos.evolucion ?? []).filter((p) => p.asin === asin && p.periodo === periodo).sort((a, b) => a.desde.localeCompare(b.desde))
}

/** La misma búsqueda en el periodo anterior (por texto normalizado) */
export function mapaAnterior(datos: DatosSeo, asin: string, periodo: 'MONTH' | 'WEEK'): Map<string, ConsultaAnterior> {
  return new Map((datos.anteriores?.[periodo] ?? []).filter((c) => c.asin === asin).map((c) => [c.consulta.trim().toLowerCase(), c]))
}

/** Una variación en puntos porcentuales (cuotas): verde si sube, rojo si baja */
export function DeltaPuntos({ actual, anterior }: { actual: number | null; anterior: number | null | undefined }) {
  if (actual == null || anterior == null) return <span className="text-[var(--ls-t4)]">—</span>
  const d = (actual - anterior) * 100
  if (Math.abs(d) < 0.05) return <span className="text-[var(--ls-t4)]">=</span>
  const color = d > 0 ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo
  return (
    <span className="tabular-nums font-medium" style={{ color }} title="Variación de la cuota de compras frente al periodo anterior, en puntos">
      {d > 0 ? '▲' : '▼'} {Math.abs(d).toLocaleString('es-ES', { maximumFractionDigits: 1 })} pt
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* El diagnóstico del embudo (lib/seo/embudo.ts) en pantalla           */
/* ------------------------------------------------------------------ */

export interface DiagnosticoDeProducto {
  periodo: 'MONTH' | 'WEEK'
  contexto: ContextoDeEmbudo
  busquedas: Array<BusquedaDiagnosticada<ConsultaGuardada>>
  porConsulta: Map<string, Veredicto>
  producto: ReturnType<typeof embudoDelProducto<ConsultaGuardada>>
}

/** El diagnóstico de un producto con las búsquedas del periodo pedido (o, sin `periodo`, las del mes si hay y si no las de la semana) */
export function diagnosticoDe(datos: DatosSeo, asin: string, periodo?: 'MONTH' | 'WEEK'): DiagnosticoDeProducto {
  const elegido = periodo ? { filas: consultasDe(datos, asin, periodo), periodo } : consultasDelProducto(datos.consultas, asin)
  const { contexto, busquedas } = diagnosticarTodas(elegido.filas, datos.precios?.[asin] ?? null)
  return { periodo: elegido.periodo, contexto, busquedas, porConsulta: new Map(busquedas.map((b) => [b.fila.consulta, b.veredicto])), producto: embudoDelProducto(busquedas, contexto) }
}

/** El color y el texto corto de cada veredicto */
export function estiloDeVeredicto(v: Veredicto): { texto: string; color: string; pista: string } {
  switch (v.tipo) {
    case 'ruido':
      return { texto: 'Ruido', color: 'var(--ls-t4)', pista: 'Sin intención de compra: no trabajarla' }
    case 'otro-precio':
      return { texto: 'Otro precio', color: 'var(--ls-t4)', pista: 'El sector compra a menos de la mitad: no es tu búsqueda' }
    case 'lider':
      return { texto: 'Lidera', color: COLOR_ESTADO.verde, pista: 'Ya se lleva una parte grande de las compras' }
    case 'infraexpuesta':
      return { texto: 'Infraexpuesta', color: COLOR_ESTADO.violeta, pista: 'PPC: convierte de sobra y sale poco' }
    case 'visibilidad':
      return { texto: 'Falta visibilidad', color: COLOR_ESTADO.azul, pista: 'Es SEO: falta salir más' }
    case 'fuga':
      return { texto: `Pierde en ${NOMBRE_DE_ETAPA[v.etapa].toLowerCase()}`, color: v.caida >= 0.7 ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar, pista: `${RESPONSABLE[v.etapa].quien} — no es SEO` }
  }
}

/** La etiqueta del diagnóstico de una búsqueda, con el porqué y qué hacer al pasar el ratón */
export function EtiquetaDeVeredicto({ v }: { v: Veredicto | undefined }) {
  if (!v) return <span className="text-[11px] text-[var(--ls-t4)]">—</span>
  const e = estiloDeVeredicto(v)
  const accion = v.tipo === 'fuga' ? RESPONSABLE[v.etapa].accion : v.tipo === 'visibilidad' ? RESPONSABLE.impresiones.accion : v.tipo === 'infraexpuesta' ? RESPONSABLE_INFRAEXPUESTA.accion : ''
  return (
    <span className="inline-flex flex-col items-start gap-[1px]" title={`${v.motivo}${accion ? `\n\nQué hacer: ${accion}` : ''}`}>
      <span className="inline-flex h-[20px] items-center rounded-[5px] px-[6px] text-[10.5px] font-semibold" style={{ color: e.color, background: `color-mix(in srgb, ${e.color} 13%, transparent)` }}>
        {e.texto}
      </span>
      <span className="text-[10.5px] text-[var(--ls-t4)]">{e.pista}</span>
    </span>
  )
}

const pctCorto = (x: number | null) => (x == null ? '—' : `${(x * 100).toLocaleString('es-ES', { maximumFractionDigits: x < 0.1 ? 1 : 0 })}%`)

/** Las cuatro cuotas de una búsqueda en una línea (impresiones › clics › carrito › compra), con el escalón donde se cae en su color */
export function EmbudoMini({ fila, v }: { fila: FilaDeEmbudo; v: Veredicto | undefined }) {
  const c = cuotasDe(fila)
  const cae: Etapa | null = v?.tipo === 'fuga' ? v.etapa : null
  return (
    <span className="inline-flex items-center gap-[3px] text-[11.5px] tabular-nums" title="Tu cuota en cada escalón: impresiones › clics › carrito › compras">
      {ETAPAS.map((e, i) => (
        <span key={e} className="inline-flex items-center gap-[3px]">
          {i > 0 && <span className="text-[var(--ls-t4)]">›</span>}
          <span className={e === cae ? 'rounded-[4px] px-[3px] font-semibold' : 'text-[var(--ls-t2)]'} style={e === cae ? { color: COLOR_ESTADO.rojo, background: `color-mix(in srgb, ${COLOR_ESTADO.rojo} 12%, transparent)` } : undefined}>
            {pctCorto(c[e])}
          </span>
        </span>
      ))}
    </span>
  )
}

/**
 * EL EMBUDO DEL PRODUCTO, grande: la cuota en cada escalón (sumando sus búsquedas relevantes), cuánto se conserva de un escalón al siguiente (por debajo de ×0,7 se cae) y el veredicto del SOP: dónde se cae y de quién es el
 * trabajo. Es la «puerta de salida»: si se cae en clics, carrito o compra, lo primero no es reescribir la ficha.
 */
export function TarjetaDeEmbudo({ d, compacta = false }: { d: DiagnosticoDeProducto; compacta?: boolean }) {
  const v = d.producto.veredicto
  const c = cuotasDe(d.producto.suma)
  const max = Math.max(...ETAPAS.map((e) => c[e] ?? 0), 0.0001)
  const e = v ? estiloDeVeredicto(v) : null
  const responsable = v?.tipo === 'fuga' ? RESPONSABLE[v.etapa] : v?.tipo === 'visibilidad' ? RESPONSABLE.impresiones : v?.tipo === 'infraexpuesta' ? RESPONSABLE_INFRAEXPUESTA : null
  return (
    <section className="min-w-0 overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
      <header className="flex min-h-[46px] flex-wrap items-center gap-2 border-b border-[var(--ls-linea)] px-4 py-2">
        <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Embudo del producto</h3>
        <span className="text-[11.5px] text-[var(--ls-t4)]">
          {d.producto.relevantes} búsquedas del producto · {d.producto.descartadas} descartadas (ruido u otro precio) · {d.periodo === 'MONTH' ? 'último mes' : 'última semana'}
        </span>
        {e && (
          <span className="ml-auto inline-flex h-[22px] items-center rounded-full px-[9px] text-[11.5px] font-semibold" style={{ color: e.color, background: `color-mix(in srgb, ${e.color} 13%, transparent)` }}>
            {e.texto}
          </span>
        )}
      </header>
      <div className="px-4 py-[14px]">
        {!v ? (
          <p className="text-[12.5px] text-[var(--ls-t3)]">Sin búsquedas del producto que diagnosticar: todas son ruido o compran a otro precio, o aún no han llegado.</p>
        ) : (
          <div className={`grid gap-4 ${compacta ? '' : 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]'}`}>
            <div className="grid grid-cols-4 gap-2">
              {ETAPAS.map((etapa, i) => {
                const valor = c[etapa]
                const previa = i > 0 ? c[ETAPAS[i - 1]] : null
                const ratio = valor != null && previa != null && previa > 0 ? valor / previa : null
                const cae = v.tipo === 'fuga' && v.etapa === etapa
                const color = cae ? COLOR_ESTADO.rojo : etapa === 'impresiones' ? COLOR_ESTADO.cian : etapa === 'compra' ? COLOR_ESTADO.verde : COLOR_ESTADO.azul
                return (
                  <div key={etapa} className="flex min-w-0 flex-col gap-[6px]">
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="truncate text-[11px] text-[var(--ls-t4)]">{NOMBRE_DE_ETAPA[etapa]}</span>
                      {ratio != null && (
                        <span className="text-[10.5px] tabular-nums" style={{ color: ratio < 0.7 ? COLOR_ESTADO.rojo : ratio >= 1 ? COLOR_ESTADO.verde : 'var(--ls-t4)' }} title="Cuánto conserva frente al escalón anterior: por debajo de ×0,7 se cae (umbral estimado)">
                          ×{ratio.toLocaleString('es-ES', { maximumFractionDigits: 1 })}
                        </span>
                      )}
                    </div>
                    <div className="flex h-[54px] items-end rounded-[8px] bg-[var(--ls-sup2)] p-[3px]">
                      <div className="w-full rounded-[6px]" style={{ height: `${Math.max(6, ((valor ?? 0) / max) * 100)}%`, background: color, opacity: cae ? 1 : 0.75 }} />
                    </div>
                    <span className="text-[15px] font-semibold tabular-nums tracking-[-0.01em]" style={{ color: cae ? COLOR_ESTADO.rojo : 'var(--ls-t1)' }}>
                      {valor == null ? '—' : `${(valor * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="flex min-w-0 flex-col gap-[6px] text-[12.5px] leading-[1.5]">
              <p className="text-[var(--ls-t2)]">{v.motivo}</p>
              {responsable && (
                <p className="text-[var(--ls-t3)]">
                  <span className="font-semibold text-[var(--ls-t1)]">De quién es: </span>
                  {responsable.quien}. {responsable.accion}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/** Copiar un texto al portapapeles, con aviso. Lo pegan en Seller Central: el ERP no escribe la ficha por ellos */
export function BotonCopiar({ texto, etiqueta = 'Copiar', compacto = false }: { texto: string; etiqueta?: string; compacto?: boolean }) {
  const [hecho, setHecho] = useState(false)
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      setHecho(true)
      setTimeout(() => setHecho(false), 1500)
    } catch {
      toast.error('El navegador no ha dejado copiar. Selecciona el texto y cópialo a mano.')
    }
  }
  return (
    <button type="button" onClick={copiar} disabled={!texto} className={`inline-flex shrink-0 items-center gap-[5px] rounded-[7px] font-medium text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] disabled:opacity-40 ${compacto ? 'h-[22px] px-[6px] text-[11px]' : 'h-[26px] px-[8px] text-[11.5px]'}`} title="Copiar al portapapeles">
      {hecho ? <Check className="h-3 w-3" style={{ color: COLOR_ESTADO.verde }} /> : <Copy className="h-3 w-3" />}
      {hecho ? 'Copiado' : etiqueta}
    </button>
  )
}

/** Un enlace a otra pestaña, en pequeño */
export function IrA({ texto, onClick }: { texto: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-[28px] shrink-0 items-center gap-[5px] rounded-[8px] px-[9px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
      {texto} <ArrowRight className="h-3 w-3" />
    </button>
  )
}
