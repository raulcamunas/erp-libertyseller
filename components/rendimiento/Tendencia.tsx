'use client'

import type { CSSProperties } from 'react'
import type { PuntoDeTendencia } from '@/lib/rendimiento/comparativa'
import { COLOR_ESTADO } from '@/lib/estilo/denso'

/**
 * UNA TENDENCIA EN MINIATURA: una línea con un punto por periodo, para ver de un vistazo si una persona sube o baja.
 *
 * El color dice hacia dónde va el ÚLTIMO punto respecto a la media de los anteriores: verde si está por encima,
 * rojo si por debajo y gris si es lo de siempre. Los números exactos salen al dejar el ratón encima. La línea se
 * dibuja de izquierda a derecha al aparecer, con un velo suave debajo, y el último punto late.
 */

const redondear = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('es-ES')

export function Tendencia({ puntos, ancho = 76, alto = 24, indice = 0 }: { puntos: PuntoDeTendencia[]; ancho?: number; alto?: number; indice?: number }) {
  if (puntos.length < 2) return null

  const valores = puntos.map((p) => p.valor)
  const max = Math.max(...valores)
  const min = Math.min(...valores)
  const margen = 3
  const x = (i: number) => margen + (i * (ancho - 2 * margen)) / (puntos.length - 1)
  const y = (v: number) => (max === min ? alto / 2 : alto - margen - ((v - min) / (max - min)) * (alto - 2 * margen))

  const camino = puntos.map((p, i) => `${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ')
  const velo = `${x(0).toFixed(1)},${alto} ${camino} ${x(puntos.length - 1).toFixed(1)},${alto}`
  const largo = Math.ceil(puntos.slice(1).reduce((s, p, i) => s + Math.hypot(x(i + 1) - x(i), y(p.valor) - y(puntos[i].valor)), 0)) + 2
  const anteriores = valores.slice(0, -1)
  const media = anteriores.reduce((s, v) => s + v, 0) / anteriores.length
  const ultimo = valores[valores.length - 1]
  const color = media === 0 && ultimo === 0 ? 'var(--ls-t4)' : ultimo >= media * 1.05 ? COLOR_ESTADO.verde : ultimo <= media * 0.95 ? COLOR_ESTADO.rojo : 'var(--ls-t3)'

  const resumen = puntos.map((p) => `${p.etiqueta}: ${redondear(p.valor)}`).join(' · ')

  return (
    <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={`Tendencia. ${resumen}`} style={{ color, '--largo': largo, '--d': indice } as CSSProperties} className="overflow-visible">
      <title>{resumen}</title>
      <polygon points={velo} fill="currentColor" opacity={0.1} />
      <polyline className="rend-dibuja" points={camino} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(puntos.length - 1)} cy={y(ultimo)} r={2.4} fill="currentColor" />
      <circle className="rend-onda" cx={x(puntos.length - 1)} cy={y(ultimo)} r={2.4} fill="currentColor" style={{ transformOrigin: `${x(puntos.length - 1)}px ${y(ultimo)}px` }} />
    </svg>
  )
}
