'use client'

import { useState } from 'react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { cn } from '@/lib/utils'
import { iniciales, mezcla, tonoEstable } from './utilidades'

/**
 * AVATAR con iniciales y un color ESTABLE: la misma persona sale siempre del mismo color en todas las pantallas (sale de un hash del nombre, no del orden de la lista).
 * Si hay foto se usa, y si la foto falla se vuelve a las iniciales.
 *
 *   <Avatar nombre="Raúl Camuñas" />
 *   <Avatar nombre={p.full_name} src={p.avatar_url} tamano={40} estado="verde" />
 *   <GrupoDeAvatares nombres={['Ana', 'Luis', 'Marta', 'Pedro']} max={3} />
 */
export interface AvatarProps {
  nombre: string | null | undefined
  src?: string | null
  /** Lado en px (por defecto 32) */
  tamano?: number
  /** Puntito de estado abajo a la derecha (verde = conectado, por ejemplo) */
  estado?: keyof typeof COLOR_ESTADO
  className?: string
}

export function Avatar({ nombre, src, tamano = 32, estado, className }: AvatarProps) {
  const [fallo, setFallo] = useState(false)
  const color = COLOR_ESTADO[tonoEstable(nombre)]
  const texto = iniciales(nombre)
  return (
    <span
      className={cn('relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-[-0.01em]', className)}
      style={{
        width: tamano,
        height: tamano,
        fontSize: Math.max(10, Math.round(tamano * 0.38)),
        color,
        background: `linear-gradient(140deg, ${mezcla(color, 26)}, ${mezcla(color, 10)})`,
        boxShadow: `inset 0 0 0 1px ${mezcla(color, 34)}`,
      }}
      title={nombre ?? undefined}
      role="img"
      aria-label={nombre ?? 'Sin nombre'}
    >
      {src && !fallo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full rounded-full object-cover" onError={() => setFallo(true)} />
      ) : (
        texto
      )}
      {estado && (
        <span
          aria-hidden
          className="absolute bottom-0 right-0 rounded-full ring-2 ring-[var(--ls-sup)]"
          style={{ width: Math.max(7, tamano * 0.26), height: Math.max(7, tamano * 0.26), background: COLOR_ESTADO[estado] }}
        />
      )}
    </span>
  )
}

export function GrupoDeAvatares({ nombres, max = 4, tamano = 28 }: { nombres: readonly string[]; max?: number; tamano?: number }) {
  const vistos = nombres.slice(0, max)
  const resto = nombres.length - vistos.length
  return (
    <span className="inline-flex items-center" aria-label={nombres.join(', ')}>
      {vistos.map((n, i) => (
        <Avatar key={`${n}-${i}`} nombre={n} tamano={tamano} className={cn('ring-2 ring-[var(--ls-sup)]', i > 0 && '-ml-2')} />
      ))}
      {resto > 0 && (
        <span
          className="-ml-2 inline-flex items-center justify-center rounded-full bg-[var(--ls-sup3)] text-[11px] font-semibold text-[var(--ls-t2)] ring-2 ring-[var(--ls-sup)]"
          style={{ width: tamano, height: tamano }}
          title={nombres.slice(max).join(', ')}
        >
          +{resto}
        </span>
      )}
    </span>
  )
}
