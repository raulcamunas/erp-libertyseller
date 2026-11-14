'use client'

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { FOCO, Insignia } from '@/components/ui-ls'
import type { TonoEstado } from '@/lib/estilo/denso'
import { opcionDeRol, etiquetaDeRol, type OpcionDeRol } from '@/lib/usuarios/puestos'

/**
 * PIEZAS PEQUEÑAS DE GESTIÓN DE USUARIOS: el interruptor grande, la insignia de rol y el campo de texto con los tokens del kit.
 */

/** El clase de un campo de texto del kit (40 px; 44 con el dedo) */
export const CAMPO =
  'h-10 w-full rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-[13.5px] text-[var(--ls-t1)] outline-none transition-colors placeholder:text-[var(--ls-t4)] focus-visible:border-[var(--ls-acc-graf)] disabled:opacity-60 [@media(pointer:coarse)]:min-h-[44px]'

export function Campo({ id, etiqueta, ayuda, children }: { id: string; etiqueta: string; ayuda?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={id} className="text-[12.5px] font-medium text-[var(--ls-t2)]">
        {etiqueta}
      </label>
      {children}
      {ayuda && <p className="text-[11.5px] leading-snug text-[var(--ls-t4)]">{ayuda}</p>}
    </div>
  )
}

/**
 * INTERRUPTOR GRANDE (role=switch). El botón entero mide 44 px de alto para el dedo; la pista, 40×24. `mixto` = parte del grupo encendida (el interruptor de un grupo).
 */
export function Interruptor({
  activo,
  onCambio,
  etiqueta,
  deshabilitado,
  mixto,
  className,
}: {
  activo: boolean
  onCambio: (v: boolean) => void
  etiqueta: string
  deshabilitado?: boolean
  mixto?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={mixto ? 'mixed' : activo}
      aria-label={etiqueta}
      disabled={deshabilitado}
      onClick={() => onCambio(!activo)}
      className={cn('group inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-[12px] disabled:cursor-not-allowed', FOCO, className)}
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-6 w-10 items-center rounded-full border transition-colors duration-200',
          activo
            ? 'border-[color-mix(in_srgb,var(--ls-acento,var(--ls-acc))_60%,transparent)] bg-[var(--ls-acento,var(--ls-acc))]'
            : mixto
              ? 'border-[var(--ls-linea2)] bg-[color-mix(in_srgb,var(--ls-acento,var(--ls-acc))_35%,var(--ls-sup2))]'
              : 'border-[var(--ls-linea2)] bg-[var(--ls-sup3,var(--ls-sup2))]',
          deshabilitado && 'opacity-40',
        )}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 700, damping: 40 }}
          className={cn('block h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)]', activo ? 'ml-[19px]' : mixto ? 'ml-[11px]' : 'ml-[2px]')}
        />
      </span>
    </button>
  )
}

/** El tono de la insignia de cada rol o puesto (siempre de COLOR_ESTADO) */
export const TONO_DE_OPCION: Record<OpcionDeRol, TonoEstado> = {
  admin: 'naranja',
  ceo: 'magenta',
  partner: 'azul',
  comercial: 'verde',
  manager_comercial: 'violeta',
  comercial_autonomo: 'cian',
  gestion_administrativa: 'ambar',
  employee: 'gris',
  cliente: 'gris',
}

export function InsigniaDeRol({ role, puesto, llama, tamano = 'sm' }: { role: string; puesto?: string | null; llama?: boolean; tamano?: 'sm' | 'md' }) {
  const opcion = opcionDeRol(role, puesto ?? null)
  return (
    <Insignia
      tono={TONO_DE_OPCION[opcion]}
      tamano={tamano}
      title={opcion === 'manager_comercial' && llama ? 'También llama: sale en el equipo de Cold Calling y en la Agenda' : undefined}
    >
      {etiquetaDeRol(role, puesto ?? null)}
      {opcion === 'manager_comercial' && llama ? ' · llama' : ''}
    </Insignia>
  )
}
