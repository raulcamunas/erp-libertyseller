'use client'

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Slot, Slottable } from '@radix-ui/react-slot'
import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * BOTÓN DEL KIT. Cuatro variantes y dos tamaños; en pantallas táctiles crece a 44 px de alto (TACTIL) sin cambiar nada en el ordenador.
 *
 *   <Boton variante="primario" icono={Plus} onClick={…}>Nuevo</Boton>       ← uno por pantalla
 *   <Boton variante="secundario">Exportar</Boton>
 *   <Boton variante="fantasma" icono={X} soloIcono aria-label="Cerrar" />
 *   <Boton variante="peligro" cargando={borrando}>Borrar</Boton>
 *   <Boton asChild><Link href="/…">Ir</Link></Boton>
 */

/** Objetivo táctil de 44 px solo donde el puntero es un dedo. Úsalo en cualquier control propio. */
export const TACTIL = '[@media(pointer:coarse)]:min-h-[44px]'
export const TACTIL_CUADRADO = '[@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]'

/** El anillo de foco común a todos los controles del kit. */
export const FOCO = 'outline-none focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ls-fondo)]'

export type VarianteBoton = 'primario' | 'secundario' | 'fantasma' | 'peligro'

const VARIANTES: Record<VarianteBoton, string> = {
  primario:
    'border border-[var(--ls-acc-borde)] bg-[linear-gradient(180deg,#FF7A26,var(--ls-acc-relleno))] text-[var(--ls-acc-tinta)] font-semibold ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_1px_2px_rgba(0,0,0,0.3),0_6px_18px_-8px_rgba(255,102,0,0.7)] hover:brightness-[1.07]',
  secundario:
    'border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] text-[var(--ls-t1)] shadow-[var(--ls-sombra-1)] hover:bg-[var(--ls-sup3)]',
  fantasma: 'border border-transparent text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]',
  peligro:
    'border border-[color-mix(in_srgb,var(--ls-e-rojo)_45%,transparent)] bg-[color-mix(in_srgb,var(--ls-e-rojo)_14%,transparent)] text-[var(--ls-e-rojo)] font-semibold ' +
    'hover:bg-[color-mix(in_srgb,var(--ls-e-rojo)_22%,transparent)]',
}

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton
  tamano?: 'sm' | 'md'
  icono?: LucideIcon
  /** Icono a la derecha (flecha de «ir a») */
  iconoDerecha?: LucideIcon
  soloIcono?: boolean
  cargando?: boolean
  asChild?: boolean
  children?: ReactNode
}

export const Boton = forwardRef<HTMLButtonElement, BotonProps>(function Boton(
  { variante = 'secundario', tamano = 'md', icono: Icono, iconoDerecha: IconoD, soloIcono, cargando, asChild, className, children, disabled, type, ...resto },
  ref,
) {
  const Comp = asChild ? Slot : 'button'
  const icono = cargando ? <Loader2 className="h-[14px] w-[14px] animate-spin" aria-hidden /> : Icono ? <Icono className="h-[14px] w-[14px]" aria-hidden /> : null
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      disabled={asChild ? undefined : disabled || cargando}
      aria-busy={cargando || undefined}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center gap-[7px] whitespace-nowrap rounded-[10px] font-medium transition-[background-color,color,box-shadow,filter,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-45',
        tamano === 'sm' ? 'h-8 text-[12.5px]' : 'h-9 text-[13px]',
        soloIcono ? (tamano === 'sm' ? 'w-8' : 'w-9') : tamano === 'sm' ? 'px-3' : 'px-[14px]',
        soloIcono ? TACTIL_CUADRADO : TACTIL,
        FOCO,
        VARIANTES[variante],
        className,
      )}
      {...resto}
    >
      {icono}
      {asChild ? <Slottable>{children}</Slottable> : children}
      {IconoD && !cargando && <IconoD className="h-[14px] w-[14px] opacity-80" aria-hidden />}
    </Comp>
  )
})
