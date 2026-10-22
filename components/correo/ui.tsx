'use client'

import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * PIEZAS COMUNES DE LA PANTALLA DE CORREO.
 *
 * Se pintan con los tokens de superficie, texto y estado del ERP (`--ls-*`, ver lib/estilo/denso.ts), así que se ven
 * igual en el tema claro y en el oscuro. Los radios van en valor arbitrario (6 · 10 px) porque en este repositorio
 * `rounded-lg` son 24 px.
 */

export const CAMPO =
  'h-9 w-full rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-[13px] text-[var(--ls-t1)] outline-none transition-colors placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)] disabled:opacity-50'

export const BOTON_PRIMARIO =
  'inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[6px] bg-[var(--ls-acc-relleno)] px-4 text-[13px] font-semibold text-[var(--ls-acc-tinta)] transition-[filter,opacity] hover:brightness-110 disabled:opacity-40'

export const BOTON_SECUNDARIO =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] border border-[var(--ls-linea)] px-3 text-[12px] text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-linea2)] hover:text-[var(--ls-t1)] disabled:opacity-40'

export const BOTON_ICONO =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] disabled:opacity-40'

/** Un aviso con filo ámbar: lo que hay que hacer antes de poder seguir */
export function Aviso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-l-2 border-[var(--ls-linea)] border-l-[var(--ls-e-ambar)] bg-[var(--ls-sup)] p-4" role="alert">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden />
      <div className="text-[13px] leading-relaxed text-[var(--ls-t2)]">
        <p className="mb-1 font-semibold text-[var(--ls-t1)]">{titulo}</p>
        <div>{children}</div>
      </div>
    </div>
  )
}

/** Una etiqueta pequeña de estado (automático, esperando…) */
export function Etiqueta({ children, tono = 'neutro' }: { children: ReactNode; tono?: 'neutro' | 'ambar' | 'acento' }) {
  const clases =
    tono === 'ambar'
      ? 'bg-[color-mix(in_srgb,var(--ls-e-ambar)_14%,transparent)] text-[var(--ls-e-ambar)]'
      : tono === 'acento'
        ? 'bg-[var(--ls-acc-suave)] text-[var(--ls-acc)]'
        : 'bg-[var(--ls-sup3)] text-[var(--ls-t3)]'
  return <span className={`inline-flex h-[17px] items-center gap-1 whitespace-nowrap rounded-[4px] px-1.5 text-[10.5px] font-medium ${clases}`}>{children}</span>
}
