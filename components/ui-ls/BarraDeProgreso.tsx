'use client'

import { motion, MotionConfig } from 'framer-motion'
import type { ReactNode } from 'react'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { cn } from '@/lib/utils'
import { colorDeAcento, formatoPorcentaje, mezcla, proporcionSegura, type Modulo } from './utilidades'

/**
 * BARRA DE PROGRESO. Crece desde 0 al entrar (o se pinta quieta si se pide menos movimiento). El color sale de un tono de estado o del acento del módulo.
 *
 *   <BarraDeProgreso valor={3} maximo={4} etiqueta="Semana 3 de 4" mostrarPorcentaje />
 *   <BarraDeProgreso valor={0.82} tono="ambar" tamano="sm" />
 *   <BarraDeProgreso valor={stock} maximo={capacidad} umbrales={{ ambar: 0.7, rojo: 0.9 }} />   ← cambia de color al llenarse
 */
export interface BarraDeProgresoProps {
  valor: number
  maximo?: number
  tono?: TonoEstado
  acento?: Modulo | string
  etiqueta?: ReactNode
  /** Texto a la derecha de la etiqueta; por defecto, el porcentaje si mostrarPorcentaje */
  detalle?: ReactNode
  mostrarPorcentaje?: boolean
  /** Cambia a ámbar / rojo al pasar de esas proporciones (para capacidad, presupuesto…) */
  umbrales?: { ambar?: number; rojo?: number }
  tamano?: 'sm' | 'md'
  className?: string
}

export function BarraDeProgreso({ valor, maximo = 1, tono, acento, etiqueta, detalle, mostrarPorcentaje, umbrales, tamano = 'md', className }: BarraDeProgresoProps) {
  const p = proporcionSegura(valor, maximo)
  let color = tono ? COLOR_ESTADO[tono] : colorDeAcento(acento)
  if (umbrales?.rojo != null && p >= umbrales.rojo) color = COLOR_ESTADO.rojo
  else if (umbrales?.ambar != null && p >= umbrales.ambar) color = COLOR_ESTADO.ambar
  const derecha = detalle ?? (mostrarPorcentaje ? formatoPorcentaje(p, 0) : null)
  return (
    <div className={cn('min-w-0', className)}>
      {(etiqueta || derecha) && (
        <div className="mb-[6px] flex items-baseline justify-between gap-3 text-[12px]">
          <span className="truncate text-[var(--ls-t3)]">{etiqueta}</span>
          {derecha != null && <span className="shrink-0 font-medium tabular-nums text-[var(--ls-t1)]">{derecha}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p * 100)}
        className={cn('relative overflow-hidden rounded-full bg-[var(--ls-sup3)]', tamano === 'sm' ? 'h-[5px]' : 'h-2')}
        style={{ boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.18)' }}
      >
        <MotionConfig reducedMotion="user">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ background: `linear-gradient(90deg, ${mezcla(color, 65)}, ${color})`, boxShadow: `0 0 12px ${mezcla(color, 45)}` }}
            initial={{ width: 0 }}
            animate={{ width: `${p * 100}%` }}
            transition={{ duration: 0.8, ease: [0.2, 0.7, 0.2, 1] }}
          />
        </MotionConfig>
      </div>
    </div>
  )
}
