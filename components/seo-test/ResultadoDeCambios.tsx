'use client'

import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronDown, FlaskConical, Minus, TriangleAlert } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { Insignia } from '@/components/ui-ls'
import type { EdicionGuardada } from '@/lib/seo/edicion-servidor'
import { resultadoDelCambio, type EstadoResultado, type ResultadoDelCambio } from '@/lib/seo/resultado-cambio'
import type { DecisionesDeBusquedas } from '@/lib/seo/embudo'
import { useHistorial } from './useHistorial'
import { useDelProducto } from './useDelProducto'

/**
 * «RESULTADO DE LOS CAMBIOS» (pestaña Ficha): por cada cambio de ficha aplicado (los 3 últimos), las 3 semanas de antes frente a las 3 de después con la misma cesta de búsquedas
 * (lib/seo/resultado-cambio.ts), la barra semanal con la semana del cambio marcada, las búsquedas que el cambio metió o sacó y lo que ensucia la comparación (stock, otro cambio, publicidad).
 */

export const ESTILO_RESULTADO: Record<EstadoResultado, { texto: string; color: string }> = {
  mejora: { texto: 'Mejora', color: COLOR_ESTADO.verde },
  empeora: { texto: 'Empeora', color: COLOR_ESTADO.rojo },
  igual: { texto: 'Sin efecto claro', color: 'var(--ls-t3)' },
  'no-atribuible': { texto: 'No atribuible', color: COLOR_ESTADO.ambar },
  provisional: { texto: 'Provisional', color: COLOR_ESTADO.azul },
  esperando: { texto: 'Esperando datos', color: 'var(--ls-t4)' },
  'pocos-datos': { texto: 'Pocos datos', color: 'var(--ls-t4)' },
}

export const APLICADAS: ReadonlySet<EdicionGuardada['estado']> = new Set(['aplicada', 'parcial'])
export const fechaDe = (e: EdicionGuardada) => (e.verificadaAt ?? e.enviadaAt ?? e.createdAt).slice(0, 10)
const p1 = (x: number | null) => (x == null ? '—' : `${(x * 100).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: x < 0.1 ? 1 : 0 })} %`)
const n1 = (x: number | null) => (x == null ? '—' : x.toLocaleString('es-ES', { maximumFractionDigits: 1 }))
const fCorta = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })
export const NOMBRE_CAMPO: Record<string, string> = { titulo: 'título', highlights: 'Item Highlights', bullets: 'viñetas', descripcion: 'descripción', backend: 'backend' }

export function ResultadoDeCambios({ cuentaId, asin, precio, decisiones }: { cuentaId: string; asin: string; precio: number | null; decisiones: DecisionesDeBusquedas }) {
  const ediciones = useDelProducto<{ ediciones: EdicionGuardada[]; sinMigracion: boolean }>(`/api/seo/ediciones?cuenta=${encodeURIComponent(cuentaId)}&asin=${asin}`)
  const aplicadas = useMemo(() => (ediciones.datos?.ediciones ?? []).filter((e) => APLICADAS.has(e.estado) && e.antes), [ediciones.datos])
  const historial = useHistorial(aplicadas.length > 0 ? cuentaId : null, { asin, semanas: 40 })
  const hoy = new Date().toISOString().slice(0, 10)

  const resultados = useMemo(() => {
    if (aplicadas.length === 0 || historial.filas.length === 0) return []
    const fechas = aplicadas.map(fechaDe)
    return aplicadas
      .slice()
      .sort((a, b) => fechaDe(b).localeCompare(fechaDe(a)))
      .slice(0, 3)
      .map((e) => ({
        e,
        r: resultadoDelCambio({
          asin,
          fecha: fechaDe(e),
          antes: e.antes,
          despues: e.despues,
          filas: historial.filas,
          precio,
          decisiones,
          sinVentas: historial.sinVentas?.[asin] ?? null,
          gastoSemanal: historial.gastoSemanal ? historial.gastoSemanal.filter((g) => g.asin === asin) : null,
          otrosCambios: fechas,
          hoy,
        }),
      }))
  }, [aplicadas, historial.filas, historial.sinVentas, historial.gastoSemanal, asin, precio, decisiones, hoy])

  if (aplicadas.length === 0) return null
  return (
    <div className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <FlaskConical className="h-[15px] w-[15px] text-[var(--ls-t3)]" />
        <span className="text-[14px] font-semibold text-[var(--ls-t1)]">Resultado de los cambios de ficha</span>
        <span className="text-[11.5px] text-[var(--ls-t4)]">3 semanas antes frente a 3 después, mismas búsquedas a los dos lados</span>
      </div>
      {historial.cargando && resultados.length === 0 && <p className="mt-3 text-[12.5px] text-[var(--ls-t4)]">Cargando las semanas de Brand Analytics…</p>}
      {historial.error && <p className="mt-3 text-[12.5px]" style={{ color: COLOR_ESTADO.rojo }}>{historial.error}</p>}
      <div className="mt-3 flex flex-col gap-3">
        {resultados.map(({ e, r }) => (
          <TarjetaDeResultado key={e.id} e={e} r={r} />
        ))}
      </div>
    </div>
  )
}

function TarjetaDeResultado({ e, r }: { e: EdicionGuardada; r: ResultadoDelCambio }) {
  const [ver, setVer] = useState(false)
  const est = ESTILO_RESULTADO[r.estado]
  const Flecha = r.variacion == null ? Minus : r.variacion >= 0.1 ? ArrowUpRight : r.variacion <= -0.1 ? ArrowDownRight : Minus
  const medidaTxt = r.medida === 'compras' ? 'cuota de compras' : r.medida === 'impresiones' ? 'cuota de impresiones' : null
  return (
    <div className="rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-[6px] px-[8px] py-[2px] text-[12px] font-semibold" style={{ color: est.color, background: `color-mix(in srgb, ${est.color} 14%, transparent)` }}>
          {est.texto}
        </span>
        {r.variacion != null && (
          <span className="inline-flex items-center gap-[2px] text-[13px] font-semibold tabular-nums" style={{ color: est.color }}>
            <Flecha className="h-[14px] w-[14px]" />
            {r.variacion >= 0 ? '+' : '−'}
            {Math.abs(Math.round(r.variacion * 100))} %{medidaTxt && <span className="ml-1 font-normal text-[var(--ls-t4)]">{medidaTxt}</span>}
          </span>
        )}
        <span className="text-[12px] text-[var(--ls-t3)]">
          Cambio del {fCorta(r.fechaCambio)} · {e.campos.map((c) => NOMBRE_CAMPO[c] ?? c).join(', ')}
          {e.enviadoPor ? ` · ${e.enviadoPor}` : ''}
        </span>
        {e.origen === 'ia' && <Insignia tono="violeta" tamano="sm">IA</Insignia>}
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">{r.resumen}</p>

      {r.antes.semanas > 0 && (
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            <span />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">Antes</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">Después</span>
            <Fila etiqueta="Cuota de impresiones" a={p1(r.antes.cuotaImpresiones)} d={r.despues.semanas ? p1(r.despues.cuotaImpresiones) : '…'} />
            <Fila etiqueta="Cuota de clics" a={p1(r.antes.cuotaClics)} d={r.despues.semanas ? p1(r.despues.cuotaClics) : '…'} />
            <Fila etiqueta="Cuota de compras" a={p1(r.antes.cuotaCompras)} d={r.despues.semanas ? p1(r.despues.cuotaCompras) : '…'} />
            <Fila etiqueta="Compras / semana" a={n1(r.antes.comprasSemana)} d={r.despues.semanas ? n1(r.despues.comprasSemana) : '…'} />
            {r.antes.gastoSemana != null && <Fila etiqueta="Publicidad €/semana" a={n1(r.antes.gastoSemana)} d={r.despues.semanas ? n1(r.despues.gastoSemana) : '…'} />}
            <span className="col-span-3 mt-1 text-[11px] text-[var(--ls-t4)]">
              {r.cesta.length} búsquedas del producto (las que más vendían antes del cambio) · semanas: {r.antes.semanas} antes, {r.despues.semanas} después
            </span>
          </div>
          <Barras r={r} />
        </div>
      )}

      {r.avisos.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {r.avisos.map((a) => (
            <div key={a} className="flex items-start gap-2 text-[12px] leading-[1.45]" style={{ color: COLOR_ESTADO.ambar }}>
              <TriangleAlert className="mt-[2px] h-[13px] w-[13px] shrink-0" /> {a}
            </div>
          ))}
        </div>
      )}

      {r.tocadas.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setVer((v) => !v)} aria-expanded={ver} className="flex items-center gap-1 text-[12px] font-medium text-[var(--ls-t2)] hover:text-[var(--ls-t1)]">
            <ChevronDown className="h-[13px] w-[13px] transition-transform" style={{ transform: ver ? 'rotate(180deg)' : undefined }} />
            {ver ? 'Ocultar' : 'Ver'} las {r.tocadas.length} búsquedas que el cambio metió o sacó de la ficha
          </button>
          {ver && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-[12px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--ls-t4)]">
                    <th className="py-1 pr-2 font-semibold">Búsqueda</th>
                    <th className="py-1 pr-2 font-semibold">Cambio</th>
                    <th className="py-1 pr-2 text-right font-semibold">Impresiones antes</th>
                    <th className="py-1 pr-2 text-right font-semibold">Después</th>
                    <th className="py-1 text-right font-semibold">Compras/sem antes → después</th>
                  </tr>
                </thead>
                <tbody>
                  {r.tocadas.slice(0, 15).map((t) => (
                    <tr key={t.consulta} className="border-t border-[var(--ls-linea)]">
                      <td className="py-1 pr-2 text-[var(--ls-t1)]">{t.consulta}</td>
                      <td className="py-1 pr-2" style={{ color: t.cambio === 'entra' ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo }}>
                        {t.cambio === 'entra' ? 'Entra' : 'Sale'} {t.donde === 'titulo' ? 'del título' : 'de la ficha'}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums text-[var(--ls-t2)]">{t.antes.semanas ? p1(t.antes.cuotaImpresiones) : 'no sale'}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-[var(--ls-t2)]">{t.despues.semanas ? p1(t.despues.cuotaImpresiones) : 'no sale'}</td>
                      <td className="py-1 text-right tabular-nums text-[var(--ls-t2)]">
                        {n1(t.antes.comprasAsin)} → {n1(t.despues.comprasAsin)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Fila({ etiqueta, a, d }: { etiqueta: string; a: string; d: string }) {
  return (
    <>
      <span className="text-[var(--ls-t3)]">{etiqueta}</span>
      <span className="tabular-nums text-[var(--ls-t2)]">{a}</span>
      <span className="tabular-nums font-semibold text-[var(--ls-t1)]">{d}</span>
    </>
  )
}

/** Una barra por semana con la cuota que decide (o la de impresiones), la semana del cambio rayada */
function Barras({ r }: { r: ResultadoDelCambio }) {
  const valor = (p: ResultadoDelCambio['serie'][number]) => (r.medida === 'compras' ? p.cuotaCompras : p.cuotaImpresiones)
  const max = Math.max(...r.serie.map((p) => valor(p) ?? 0), 0.0001)
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">{r.medida === 'compras' ? 'Cuota de compras' : 'Cuota de impresiones'} por semana</div>
      <div className="mt-2 flex h-[92px] items-end gap-[6px]">
        {r.serie.map((p) => {
          const v = valor(p)
          const color = p.lado === 'antes' ? 'var(--ls-t4)' : p.lado === 'cambio' ? COLOR_ESTADO.ambar : ESTILO_RESULTADO[r.estado].color === 'var(--ls-t4)' ? COLOR_ESTADO.azul : ESTILO_RESULTADO[r.estado].color
          return (
            <div key={p.desde} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`Semana del ${fCorta(p.desde)}: ${p1(v)}${p.lado === 'cambio' ? ' (semana del cambio, no cuenta)' : ''}`}>
              <span className="text-[10px] tabular-nums text-[var(--ls-t4)]">{v == null ? '' : p1(v)}</span>
              <div
                className="w-full rounded-t-[4px]"
                style={{
                  height: v == null ? 2 : `${Math.max(4, (v / max) * 60)}px`,
                  background: p.lado === 'cambio' ? `repeating-linear-gradient(45deg, ${color} 0 3px, transparent 3px 6px)` : color,
                  opacity: v == null ? 0.3 : p.lado === 'antes' ? 0.55 : 1,
                }}
              />
              <span className="text-[10px] text-[var(--ls-t4)]">{fCorta(p.desde)}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-[10.5px] text-[var(--ls-t4)]">
        <span>Gris: antes</span>
        <span style={{ color: COLOR_ESTADO.ambar }}>Rayada: semana del cambio</span>
        <span>Color: después</span>
      </div>
    </div>
  )
}
