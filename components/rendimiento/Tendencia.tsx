'use client'

import type { PuntoDeTendencia } from '@/lib/rendimiento/comparativa'

/**
 * UNA TENDENCIA EN MINIATURA: una línea con un punto por periodo, para ver de un vistazo si una persona sube o baja.
 *
 * El color dice hacia dónde va el ÚLTIMO punto respecto a la media de los anteriores: verde si está por encima,
 * rojo si por debajo y gris si es lo de siempre. Los números exactos salen al dejar el ratón encima.
 */

const redondear = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('es-ES')

export function Tendencia({ puntos, ancho = 72, alto = 22 }: { puntos: PuntoDeTendencia[]; ancho?: number; alto?: number }) {
  if (puntos.length < 2) return null

  const valores = puntos.map((p) => p.valor)
  const max = Math.max(...valores)
  const min = Math.min(...valores)
  const margen = 3
  const x = (i: number) => margen + (i * (ancho - 2 * margen)) / (puntos.length - 1)
  const y = (v: number) => (max === min ? alto / 2 : alto - margen - ((v - min) / (max - min)) * (alto - 2 * margen))

  const camino = puntos.map((p, i) => `${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ')
  const anteriores = valores.slice(0, -1)
  const media = anteriores.reduce((s, v) => s + v, 0) / anteriores.length
  const ultimo = valores[valores.length - 1]
  const color = media === 0 && ultimo === 0 ? 'text-white/25' : ultimo >= media * 1.05 ? 'text-emerald-400' : ultimo <= media * 0.95 ? 'text-red-400' : 'text-white/45'

  const resumen = puntos.map((p) => `${p.etiqueta}: ${redondear(p.valor)}`).join(' · ')

  return (
    <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={`Tendencia. ${resumen}`} className={color}>
      <title>{resumen}</title>
      <polyline points={camino} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      <circle cx={x(puntos.length - 1)} cy={y(ultimo)} r={2.2} fill="currentColor" />
    </svg>
  )
}
