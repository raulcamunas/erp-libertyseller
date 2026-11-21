'use client'

import { useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { Segmentado } from '@/components/marketing-test/piezas'
import { entero } from '@/components/marketing-test/formato'
import type { ConsultaGuardada, FilaCompetencia } from '@/lib/seo/datos'
import type { Veredicto } from '@/lib/seo/embudo'
import type { Cobertura } from '@/lib/seo/cobertura'
import type { BusquedaSinExacta } from '@/lib/seo/publicidad-calculo'
import { ChipAjena, EtiquetaDeVeredicto, Marca } from './comun'

/**
 * LA FICHA DE UNA BÚSQUEDA (panel lateral de «Búsquedas»; también se abre desde Hoy y Productos).
 *   1. Evolución: cuota de impresiones, clics y compras (líneas) y el volumen (barras grises), por semana o por mes. Un periodo en el que no salió es un HUECO, no un cero.
 *   2. Embudo frente al mercado: impresiones › clics › carrito › compras de Amazon entero y del producto, con las tasas comparadas (en rojo si se queda por debajo del 70 %).
 *   3. Contexto: si está en título, viñetas y backend, quién se lleva los clics (Top 3), si tiene keyword EXACTA en publicidad y el aviso de «posible ajena».
 */

const norm = (s: string) => s.trim().toLowerCase()
const pct = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`)

export interface FichaDeBusquedaProps {
  consulta: string
  asin: string
  fila: (ConsultaGuardada & { v?: Veredicto; cobertura: Cobertura | null; posibleAjena: boolean }) | null
  historial: readonly ConsultaGuardada[]
  cargandoHistorial: boolean
  top3: readonly FilaCompetencia[]
  sinExacta: readonly BusquedaSinExacta[] | null
}

export function FichaDeBusqueda({ consulta, asin, fila, historial, cargandoHistorial, top3, sinExacta }: FichaDeBusquedaProps) {
  const [periodo, setPeriodo] = useState<'WEEK' | 'MONTH'>('WEEK')
  const serie = useMemo(() => {
    const k = norm(consulta)
    const delPeriodo = historial.filter((f) => f.asin === asin && f.periodo === periodo)
    const fechas = [...new Set(delPeriodo.map((f) => f.desde))].sort()
    return fechas.map((desde) => {
      const f = delPeriodo.find((x) => x.desde === desde && norm(x.consulta) === k)
      return {
        desde,
        etiqueta: new Date(`${desde}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
        impresiones: f?.cuotaImpresiones ?? null,
        clics: f?.cuotaClics ?? null,
        compras: f?.cuotaCompras ?? null,
        volumen: f?.volumen ?? null,
        comprasAsin: f?.comprasAsin ?? null,
        comprasTotal: f?.comprasTotal ?? null,
      }
    })
  }, [historial, asin, consulta, periodo])
  const enInforme = serie.filter((p) => p.volumen != null).length
  const exacta = sinExacta ? !sinExacta.some((s) => norm(s.consulta) === norm(consulta)) : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {fila?.v && <EtiquetaDeVeredicto v={fila.v} />}
        {fila?.posibleAjena && <ChipAjena />}
        {fila?.volumen != null && <span className="text-[12px] text-[var(--ls-t3)]">Volumen {entero(fila.volumen)}</span>}
      </div>

      {/* 1 · Evolución */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[13px] font-semibold text-[var(--ls-t1)]">Evolución</h4>
          <Segmentado<'WEEK' | 'MONTH'>
            etiqueta="Periodo"
            opciones={[
              { id: 'WEEK', texto: 'Semana' },
              { id: 'MONTH', texto: 'Mes' },
            ]}
            valor={periodo}
            cambiar={setPeriodo}
          />
        </div>
        {cargandoHistorial ? (
          <div className="h-[200px] animate-pulse rounded-[10px] bg-[var(--ls-sup2)]" />
        ) : serie.length <= 1 ? (
          <p className="text-[12.5px] text-[var(--ls-t3)]">Se va llenando: hay {serie.length} {periodo === 'WEEK' ? (serie.length === 1 ? 'semana' : 'semanas') : serie.length === 1 ? 'mes' : 'meses'} leídos de Brand Analytics.</p>
        ) : (
          <>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={serie} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="var(--ls-linea)" vertical={false} />
                  <XAxis dataKey="etiqueta" tick={{ fontSize: 10.5, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="c" tick={{ fontSize: 10.5, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={false} unit="%" />
                  <YAxis yAxisId="v" orientation="right" hide />
                  <Tooltip
                    contentStyle={{ background: 'var(--ls-sup2)', border: '1px solid var(--ls-linea2)', borderRadius: 10, fontSize: 12 }}
                    formatter={(v: unknown, nombre: string) => (nombre === 'Volumen' ? entero(v as number) : pct(v as number | null))}
                  />
                  <Bar yAxisId="v" dataKey="volumen" name="Volumen" fill="var(--ls-t4)" opacity={0.25} radius={[3, 3, 0, 0]} />
                  <Line yAxisId="c" dataKey="impresiones" name="Impresiones" stroke={COLOR_ESTADO.azul} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
                  <Line yAxisId="c" dataKey="clics" name="Clics" stroke={COLOR_ESTADO.ambar} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
                  <Line yAxisId="c" dataKey="compras" name="Compras" stroke={COLOR_ESTADO.verde} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11.5px] text-[var(--ls-t4)]">
              Cuota de impresiones (azul), clics (ámbar) y compras (verde); el volumen en gris. En {enInforme} de {serie.length} {periodo === 'WEEK' ? 'semanas' : 'meses'} salía en el informe: los huecos son periodos en que no salió.
            </p>
          </>
        )}
      </section>

      {/* 2 · Embudo frente al mercado */}
      {fila && <EmbudoFrenteAlMercado f={fila} />}

      {/* 3 · Contexto */}
      <section className="flex flex-col gap-2">
        <h4 className="text-[13px] font-semibold text-[var(--ls-t1)]">En la ficha y en la publicidad</h4>
        {fila?.cobertura ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Marca si={fila.cobertura.titulo} texto="Título" />
            <Marca si={fila.cobertura.bullets} texto="Viñetas" />
            <Marca si={fila.cobertura.backend} texto="Backend" />
            {fila.cobertura.faltan.length > 0 && <span className="text-[11.5px] text-[var(--ls-t4)]">Falta en toda la ficha: {fila.cobertura.faltan.join(', ')}</span>}
          </div>
        ) : (
          <p className="text-[12px] text-[var(--ls-t4)]">Sin la ficha leída no se sabe si está en el título.</p>
        )}
        {exacta != null && (
          <p className="text-[12.5px] text-[var(--ls-t2)]">
            Keyword EXACTA en publicidad: <b className="font-semibold" style={{ color: exacta ? COLOR_ESTADO.verde : COLOR_ESTADO.ambar }}>{exacta ? 'sí (o no hace falta)' : 'no'}</b>
          </p>
        )}
        {top3.length > 0 && (
          <div className="text-[12.5px] text-[var(--ls-t2)]">
            <p className="mb-1 font-medium">Quién se lleva los clics</p>
            <ol className="flex flex-col gap-0.5">
              {top3.map((t) => (
                <li key={t.posicion} className="flex gap-2 tabular-nums">
                  <span className="w-4 text-[var(--ls-t4)]">{t.posicion}</span>
                  <span className={t.asin === asin ? 'font-semibold text-[var(--ls-t1)]' : ''}>{t.asin}{t.asin === asin ? ' (tuyo)' : ''}</span>
                  <span className="ml-auto text-[var(--ls-t3)]">{pct(t.cuotaClics)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {fila?.posibleAjena && (
          <p className="rounded-[8px] px-2.5 py-1.5 text-[12px]" style={{ color: COLOR_ESTADO.ambar, background: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 10%, transparent)` }}>
            Puede ser otro producto o una marca ajena: no la metas en la ficha; valora negativizarla en PPC.
          </p>
        )}
      </section>
    </div>
  )
}

function EmbudoFrenteAlMercado({ f }: { f: ConsultaGuardada }) {
  const mercado = [f.impresionesTotal, f.clicsTotal, f.carritosTotal, f.comprasTotal]
  const tuyo = [f.impresionesAsin, f.clicsAsin, f.carritosAsin, f.comprasAsin]
  const tasa = (a: number | null, b: number | null) => (a != null && b != null && a > 0 ? b / a : null)
  const pasos = ['Impresiones', 'Clics', 'Carrito', 'Compras']
  const tasas = [1, 2, 3].map((i) => {
    const m = tasa(mercado[i - 1], mercado[i])
    const t = tasa(tuyo[i - 1], tuyo[i])
    const ratio = m != null && t != null && m > 0 ? t / m : null
    return { nombre: `${pasos[i - 1].toLowerCase()} → ${pasos[i].toLowerCase()}`, m, t, ratio, pocos: (tuyo[i - 1] ?? 0) < 20 }
  })
  const fmtTasa = (x: number | null) => (x == null ? '—' : `${(x * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`)
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[13px] font-semibold text-[var(--ls-t1)]">Embudo frente al mercado</h4>
      <div className="grid grid-cols-[auto_repeat(4,minmax(0,1fr))] gap-x-2 gap-y-1 text-[12px] tabular-nums">
        <span />
        {pasos.map((p) => (
          <span key={p} className="text-right text-[11px] text-[var(--ls-t4)]">{p}</span>
        ))}
        <span className="text-[var(--ls-t3)]">Amazon</span>
        {mercado.map((x, i) => (
          <span key={i} className="text-right text-[var(--ls-t2)]">{x == null ? '—' : entero(x)}</span>
        ))}
        <span className="font-medium text-[var(--ls-t1)]">Tú</span>
        {tuyo.map((x, i) => (
          <span key={i} className="text-right font-medium text-[var(--ls-t1)]">{x == null ? '—' : entero(x)}</span>
        ))}
      </div>
      <ul className="flex flex-col gap-0.5 text-[12px]">
        {tasas.map((t) => (
          <li key={t.nombre} className="flex items-baseline justify-between gap-2">
            <span className="text-[var(--ls-t3)]">De {t.nombre}</span>
            <span className="tabular-nums">
              <b className="font-semibold" style={{ color: t.pocos ? 'var(--ls-t3)' : t.ratio != null && t.ratio < 0.7 ? COLOR_ESTADO.rojo : 'var(--ls-t1)' }}>{fmtTasa(t.t)}</b>
              <span className="text-[var(--ls-t4)]"> frente a {fmtTasa(t.m)}{t.pocos ? ' · pocos datos' : ''}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
