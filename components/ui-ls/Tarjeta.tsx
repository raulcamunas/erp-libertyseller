'use client'

import Link from 'next/link'
import { useCallback, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FOCO } from './Boton'
import { colorDeAcento, mezcla, type Modulo } from './utilidades'

/**
 * TARJETA. La caja de todo: radio 14, borde sutil, superficie --ls-sup con un velo de luz arriba y sombra --ls-sombra-1 (capas, no un rectángulo plano).
 *
 *   variante="normal"       la de siempre
 *   variante="interactiva"  levanta 2 px al pasar, el borde se aclara y un foco de luz del acento sigue al ratón. Con onClick o href es un botón/enlace accesible.
 *   variante="destacada"    filo de acento a la izquierda, brillo arriba y un halo suave: para lo que hay que mirar primero (máximo una o dos por pantalla).
 *
 *   <Tarjeta titulo="Ventas" subtitulo="Últimos 30 días" icono={Euro} acento="marketing" acciones={<Boton …/>} pie={…}>…</Tarjeta>
 *   <Tarjeta variante="interactiva" href={`/dashboard/cuentas?c=${slug}`}>…</Tarjeta>
 *   <Tarjeta sinRelleno>…tabla a sangre…</Tarjeta>
 */
export type VarianteTarjeta = 'normal' | 'interactiva' | 'destacada'

export interface TarjetaProps {
  variante?: VarianteTarjeta
  acento?: Modulo | string
  titulo?: ReactNode
  subtitulo?: ReactNode
  icono?: LucideIcon
  /** A la derecha de la cabecera */
  acciones?: ReactNode
  pie?: ReactNode
  children?: ReactNode
  /** El cuerpo sin relleno (tablas, gráficos a sangre) */
  sinRelleno?: boolean
  onClick?: () => void
  href?: string
  className?: string
  cuerpoClassName?: string
  style?: CSSProperties
  /** Posición en una lista, para la entrada escalonada (.ls-aparecer). Sin él no hay animación de entrada. */
  indice?: number
  'aria-label'?: string
}

export function CabeceraDeTarjeta({ titulo, subtitulo, icono: Icono, acciones, color }: { titulo?: ReactNode; subtitulo?: ReactNode; icono?: LucideIcon; acciones?: ReactNode; color: string }) {
  return (
    <div className="relative flex min-h-[52px] items-center gap-3 border-b border-[var(--ls-linea)] px-4 py-[10px]">
      {Icono && (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]" style={{ background: mezcla(color, 14), color, boxShadow: `inset 0 0 0 1px ${mezcla(color, 26)}` }}>
          <Icono className="h-4 w-4" strokeWidth={2} aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {titulo && <div className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">{titulo}</div>}
        {subtitulo && <div className="truncate text-[12px] text-[var(--ls-t4)]">{subtitulo}</div>}
      </div>
      {acciones && <div className="flex shrink-0 items-center gap-1">{acciones}</div>}
    </div>
  )
}

export function Tarjeta({ variante = 'normal', acento, titulo, subtitulo, icono, acciones, pie, children, sinRelleno, onClick, href, className, cuerpoClassName, style, indice, ...aria }: TarjetaProps) {
  const color = colorDeAcento(acento)
  const interactiva = variante === 'interactiva'
  const destacada = variante === 'destacada'
  const pulsable = Boolean(onClick || href)

  // El foco de luz sigue al ratón escribiendo dos variables CSS: sin estado de React, sin re-renderizar
  const mover = useCallback((e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`)
  }, [])

  const teclado = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (!onClick) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick()
      }
    },
    [onClick],
  )

  const clases = cn(
    'relative flex min-w-0 flex-col overflow-hidden rounded-[14px] border bg-[var(--ls-sup)] text-left shadow-[var(--ls-sombra-1)]',
    'before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[image:var(--ls-velo)]',
    destacada ? 'border-[color-mix(in_srgb,var(--ls-acento)_32%,var(--ls-linea))]' : 'border-[var(--ls-linea)]',
    interactiva && 'ls-elevar ls-foco cursor-pointer hover:border-[var(--ls-linea2)]',
    pulsable && FOCO,
    indice != null && 'ls-aparecer',
    className,
  )

  const estilo: CSSProperties = {
    ['--ls-acento' as string]: color,
    ...(indice != null ? { ['--ls-i' as string]: indice } : null),
    ...(destacada ? { boxShadow: `var(--ls-sombra-1), 0 0 0 1px ${mezcla(color, 8)}, 0 18px 50px -28px ${mezcla(color, 55)}` } : null),
    ...style,
  }

  const contenido = (
    <>
      {destacada && (
        <>
          <span aria-hidden className="ls-filo-brillo pointer-events-none absolute inset-0" />
          <span aria-hidden className="pointer-events-none absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: `linear-gradient(180deg, ${color}, ${mezcla(color, 30)})` }} />
          <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full blur-3xl" style={{ background: mezcla(color, 16) }} />
        </>
      )}
      {(titulo || subtitulo || icono || acciones) && <CabeceraDeTarjeta titulo={titulo} subtitulo={subtitulo} icono={icono} acciones={acciones} color={color} />}
      <div className={cn('relative min-w-0 flex-1', !sinRelleno && 'p-4', cuerpoClassName)}>{children}</div>
      {pie && <div className="relative border-t border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-sup2)_70%,transparent)] px-4 py-[10px] text-[12.5px] text-[var(--ls-t3)]">{pie}</div>}
    </>
  )

  if (href) {
    return (
      <Link href={href} className={clases} style={estilo} onPointerMove={interactiva ? mover : undefined} aria-label={aria['aria-label']}>
        {contenido}
      </Link>
    )
  }
  return (
    <div
      className={clases}
      style={estilo}
      onPointerMove={interactiva ? mover : undefined}
      onClick={onClick}
      onKeyDown={onClick ? teclado : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={aria['aria-label']}
    >
      {contenido}
    </div>
  )
}
