'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { euros, eurosPrecise, periodLabel } from '@/lib/types/treasury'

export interface PuntoEvolucion {
  key: string
  income: number
  expense: number
}

type Serie = 'income' | 'expense' | 'profit'

const COLOR: Record<Serie, string> = { income: '#34D399', expense: '#FB7185', profit: '#FFFFFF' }
const NOMBRE: Record<Serie, string> = { income: 'Ingresos', expense: 'Gastos', profit: 'Beneficio' }

/**
 * EVOLUCIÓN DE LOS ÚLTIMOS 12 MESES, EN GRANDE Y CON EL RATÓN.
 * Antes era una tira fija al pie de Tesorería que se comía media pantalla; ahora vive detrás de un botón. Barras de ingresos
 * y gastos, y encima la línea del beneficio. Se puede apagar cada serie y, al pasar por un mes, salen sus tres cifras.
 * Pulsar un mes cierra la ventana y lo abre en Tesorería. Las cifras son las MISMAS que ya calcula el tablero (`evolution`).
 */
export function EvolucionModal({
  datos,
  periodoActual,
  incompleto,
  onSelect,
  onClose,
}: {
  datos: PuntoEvolucion[]
  periodoActual: string
  /** Faltan meses por sumar el coste del equipo: las cifras de gastos y beneficio pueden quedarse cortas */
  incompleto: boolean
  /** Índice (0–11) del mes pulsado */
  onSelect: (index: number) => void
  onClose: () => void
}) {
  const [activas, setActivas] = useState<Record<Serie, boolean>>({ income: true, expense: true, profit: true })
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose])

  const puntos = useMemo(() => datos.map((d) => ({ ...d, profit: d.income - d.expense })), [datos])

  // Geometría del SVG: el cero queda en su sitio aunque haya meses con pérdidas
  const W = 1000
  const H = 360
  const M = { l: 56, r: 16, t: 16, b: 36 }
  const maxV = Math.max(1, ...puntos.flatMap((p) => [p.income, p.expense, p.profit]))
  const minV = Math.min(0, ...puntos.map((p) => p.profit))
  const y = (v: number) => M.t + ((maxV - v) / (maxV - minV)) * (H - M.t - M.b)
  const paso = (W - M.l - M.r) / puntos.length
  const xc = (i: number) => M.l + paso * (i + 0.5)
  const ancho = Math.min(26, paso * 0.28)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => minV + (maxV - minV) * t)
  const linea = puntos.map((p, i) => `${i === 0 ? 'M' : 'L'}${xc(i)},${y(p.profit)}`).join(' ')
  const h = hover != null ? puntos[hover] : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-5xl rounded-2xl border border-white/10 bg-[#0d0d0d] shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
          <div>
            <h3 className="text-[15px] font-semibold text-white">Evolución de los últimos 12 meses</h3>
            <p className="text-[11px] text-white/40">Pasa el ratón por un mes para ver sus cifras · pulsa para abrirlo</p>
          </div>
          <div className="flex items-center gap-2">
            {(Object.keys(COLOR) as Serie[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setActivas((a) => ({ ...a, [s]: !a[s] }))}
                className={`h-7 px-3 rounded-full border text-[12px] flex items-center gap-1.5 transition-colors ${
                  activas[s] ? 'border-white/20 bg-white/[0.06] text-white' : 'border-white/10 text-white/35 hover:text-white/70'
                }`}
              >
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: COLOR[s], opacity: activas[s] ? 1 : 0.35 }} />
                {NOMBRE[s]}
              </button>
            ))}
            <button type="button" onClick={onClose} className="h-8 w-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {incompleto && <p className="px-5 text-[11px] text-yellow-400/90">Faltan meses por sumar el coste del equipo: gastos y beneficio pueden salir cortos hasta que termine de cargar.</p>}

        <div className="relative px-3 pb-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Ingresos, gastos y beneficio de los últimos doce meses">
            {ticks.map((t, i) => (
              <g key={i}>
                <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="white" strokeOpacity={t === 0 ? 0.25 : 0.07} strokeDasharray={t === 0 ? undefined : '3 4'} />
                <text x={M.l - 8} y={y(t) + 3} textAnchor="end" fontSize="10" fill="white" fillOpacity="0.35">
                  {euros(t)}
                </text>
              </g>
            ))}

            {puntos.map((p, i) => (
              <g key={p.key}>
                {(hover === i || p.key === periodoActual) && (
                  <rect x={M.l + paso * i + 2} y={M.t} width={paso - 4} height={H - M.t - M.b} rx="8" fill="white" fillOpacity={hover === i ? 0.07 : 0.04} />
                )}
                {activas.income && (
                  <rect x={xc(i) - ancho - 1} y={y(Math.max(p.income, 0))} width={ancho} height={Math.max(0, y(0) - y(p.income))} rx="4" fill={COLOR.income} opacity={hover == null || hover === i ? 0.9 : 0.4} />
                )}
                {activas.expense && (
                  <rect x={xc(i) + 1} y={y(Math.max(p.expense, 0))} width={ancho} height={Math.max(0, y(0) - y(p.expense))} rx="4" fill={COLOR.expense} opacity={hover == null || hover === i ? 0.9 : 0.4} />
                )}
                <text x={xc(i)} y={H - 14} textAnchor="middle" fontSize="11" fill="white" fillOpacity={p.key === periodoActual ? 0.95 : 0.4} fontWeight={p.key === periodoActual ? 700 : 400}>
                  {periodLabel(p.key).slice(0, 3)}
                </text>
                {/* Zona de ratón del mes entero: más cómoda que acertar a la barra */}
                <rect
                  x={M.l + paso * i}
                  y={M.t}
                  width={paso}
                  height={H - M.t}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSelect(i)}
                />
              </g>
            ))}

            {activas.profit && (
              <g pointerEvents="none">
                <path d={linea} fill="none" stroke={COLOR.profit} strokeWidth="2" strokeOpacity="0.85" strokeLinejoin="round" />
                {puntos.map((p, i) => (
                  <circle key={p.key} cx={xc(i)} cy={y(p.profit)} r={hover === i ? 5 : 3} fill="#0d0d0d" stroke={COLOR.profit} strokeWidth="2" />
                ))}
              </g>
            )}
          </svg>

          {h && hover != null && (
            <div
              className="pointer-events-none absolute top-3 rounded-xl border border-white/15 bg-[#161616]/95 px-3 py-2 text-[12px] shadow-xl"
              style={{ left: `${Math.min(78, Math.max(2, ((xc(hover) / W) * 100) - 10))}%` }}
            >
              <p className="font-semibold text-white capitalize mb-1">{periodLabel(h.key)}</p>
              <p className="flex justify-between gap-6"><span className="text-green-300">Ingresos</span><span className="tabular-nums text-white">{eurosPrecise(h.income)}</span></p>
              <p className="flex justify-between gap-6"><span className="text-red-300">Gastos</span><span className="tabular-nums text-white">{eurosPrecise(h.expense)}</span></p>
              <p className="flex justify-between gap-6 border-t border-white/10 mt-1 pt-1"><span className="text-white/70">Beneficio</span><span className={`tabular-nums font-semibold ${h.profit < 0 ? 'text-red-300' : 'text-white'}`}>{eurosPrecise(h.profit)}</span></p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 px-5 pb-4 text-[12px]">
          {(['income', 'expense', 'profit'] as Serie[]).map((s) => {
            const total = puntos.reduce((acc, p) => acc + p[s], 0)
            return (
              <div key={s} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/40">{NOMBRE[s]} · 12 meses</p>
                <p className="text-[18px] font-bold tabular-nums" style={{ color: s === 'profit' ? '#fff' : COLOR[s] }}>{eurosPrecise(total)}</p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
