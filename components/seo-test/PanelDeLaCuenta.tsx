'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { DatosSeo } from './useCuentaSeo'
import { colorDePuntuacion } from './TarjetaDelEstudio'

/**
 * EL PANEL DE LA CUENTA (arriba del mosaico de Productos):
 *   · la evolución semanal de toda la cuenta: compras propias en sus búsquedas (barras) y cuota de compras (área), las 16 últimas semanas;
 *   · la salud de los listings: cuántos productos hay en cada tramo de puntuación (90+, 70–89, 50–69, menos de 50), con lo que falta (highlights, norma).
 */

const TRAMOS = [
  { id: 'top', texto: '90 o más', min: 90, color: colorDePuntuacion(95) },
  { id: 'bien', texto: '70–89', min: 70, color: colorDePuntuacion(75) },
  { id: 'medio', texto: '50–69', min: 50, color: colorDePuntuacion(55) },
  { id: 'bajo', texto: 'menos de 50', min: 0, color: colorDePuntuacion(10) },
] as const

export function PanelDeLaCuenta({ datos, puntuaciones, sinHighlights, fueraDeNorma }: { datos: DatosSeo; puntuaciones: number[]; sinHighlights: number; fueraDeNorma: number }) {
  const serie = useMemo(() => {
    const porSemana = new Map<string, { compras: number; total: number }>()
    for (const p of datos.evolucion ?? []) {
      if (p.periodo !== 'WEEK') continue
      const x = porSemana.get(p.desde) ?? { compras: 0, total: 0 }
      x.compras += p.compras
      x.total += p.cuotaCompras && p.cuotaCompras > 0 ? p.compras / p.cuotaCompras : 0
      porSemana.set(p.desde, x)
    }
    return [...porSemana.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-16)
      .map(([desde, v]) => ({
        etiqueta: new Date(`${desde}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
        compras: Math.round(v.compras),
        cuota: v.total > 0 ? Math.round((v.compras / v.total) * 10000) / 100 : null,
      }))
  }, [datos.evolucion])

  const conteo = TRAMOS.map((t, i) => ({ ...t, n: puntuaciones.filter((p) => p >= t.min && (i === 0 || p < TRAMOS[i - 1].min)).length }))
  const total = puntuaciones.length

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4">
        <div className="flex items-center gap-3 text-[13px] font-semibold text-[var(--ls-t1)]">
          Evolución de la cuenta
          <span className="flex items-center gap-1 text-[11px] font-normal text-[var(--ls-t4)]">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: 'var(--ls-acc)', opacity: 0.45 }} /> compras propias
          </span>
          <span className="flex items-center gap-1 text-[11px] font-normal text-[var(--ls-t4)]">
            <span className="h-[2px] w-3 rounded-full" style={{ background: COLOR_ESTADO.azul }} /> cuota de compras
          </span>
        </div>
        {serie.length < 2 ? (
          <p className="mt-3 text-[12.5px] text-[var(--ls-t4)]">Se va llenando con las semanas de Brand Analytics.</p>
        ) : (
          <div className="mt-2 h-[170px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={serie} margin={{ top: 6, right: 0, bottom: 0, left: -22 }}>
                <defs>
                  <linearGradient id="cuota-cuenta" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={COLOR_ESTADO.azul} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={COLOR_ESTADO.azul} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--ls-linea)" vertical={false} />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 10.5, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="c" tick={{ fontSize: 10.5, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="q" orientation="right" tick={{ fontSize: 10.5, fill: 'var(--ls-t4)' }} tickLine={false} axisLine={false} unit="%" />
                <Tooltip contentStyle={{ background: 'var(--ls-sup2)', border: '1px solid var(--ls-linea2)', borderRadius: 10, fontSize: 12 }} />
                <Bar yAxisId="c" dataKey="compras" name="Compras propias" fill="var(--ls-acc)" opacity={0.45} radius={[4, 4, 0, 0]} animationDuration={900} />
                <Area yAxisId="q" type="monotone" dataKey="cuota" name="Cuota de compras (%)" stroke={COLOR_ESTADO.azul} strokeWidth={2} fill="url(#cuota-cuenta)" connectNulls animationDuration={1100} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="flex flex-col rounded-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4">
        <div className="text-[13px] font-semibold text-[var(--ls-t1)]">Salud de los listings</div>
        <div className="mt-1 text-[11.5px] text-[var(--ls-t4)]">Puntuación SEO de las fichas de Amazon, de 0 a 100</div>
        <div className="mt-3 flex h-[12px] gap-[3px] overflow-hidden rounded-full">
          {conteo
            .filter((t) => t.n > 0)
            .map((t, i) => (
              <motion.div key={t.id} className="h-full first:rounded-l-full last:rounded-r-full" style={{ background: t.color }} initial={{ width: 0 }} animate={{ width: `${(t.n / Math.max(1, total)) * 100}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20, delay: 0.1 + i * 0.06 }} title={`${t.n} con ${t.texto}`} />
            ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {conteo.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-[12px]">
              <span className="h-[9px] w-[9px] rounded-full" style={{ background: t.color }} />
              <span className="text-[var(--ls-t3)]">{t.texto}</span>
              <span className="ml-auto font-semibold tabular-nums text-[var(--ls-t1)]">{t.n}</span>
            </div>
          ))}
        </div>
        <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-3 text-[11.5px]">
          {fueraDeNorma > 0 && <span style={{ color: COLOR_ESTADO.rojo }}>{fueraDeNorma} fuera de la norma 2026</span>}
          {sinHighlights > 0 && <span style={{ color: COLOR_ESTADO.ambar }}>{sinHighlights} sin Item Highlights guardados</span>}
          {fueraDeNorma === 0 && sinHighlights === 0 && <span style={{ color: COLOR_ESTADO.verde }}>Todas dentro de norma y con highlights</span>}
        </div>
      </motion.div>
    </div>
  )
}
