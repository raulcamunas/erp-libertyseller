'use client'

import { iniciales, mezcla } from '@/components/ui-ls'
import { cn } from '@/lib/utils'

/**
 * El avatar de una persona CON SU COLOR DEL CALENDARIO (el de su ficha o uno estable por su id), para que en la bandeja,
 * en la lista y en el calendario la misma persona se reconozca por el mismo color. Pendiente = anillo discontinuo.
 */
export function AvatarDePersona({ nombre, color, tamano = 32, pendiente, className }: { nombre: string; color: string; tamano?: number; pendiente?: boolean; className?: string }) {
  return (
    <span
      role="img"
      aria-label={nombre}
      title={nombre}
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold', className)}
      style={{
        width: tamano,
        height: tamano,
        fontSize: Math.max(10, Math.round(tamano * 0.38)),
        color: pendiente ? color : '#fff',
        background: pendiente ? mezcla(color, 14) : `linear-gradient(140deg, ${color}, ${mezcla(color, 72)})`,
        boxShadow: pendiente ? `inset 0 0 0 1.5px ${color}` : `0 4px 14px -6px ${color}`,
        outline: pendiente ? `1.5px dashed ${color}` : undefined,
        outlineOffset: pendiente ? 2 : undefined,
      }}
    >
      {iniciales(nombre)}
    </span>
  )
}
