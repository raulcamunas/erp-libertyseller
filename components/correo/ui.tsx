'use client'

import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * PIEZAS COMUNES DE LA PANTALLA DE CORREO (clases sueltas para controles nativos).
 *
 * Se pintan con los tokens de superficie, texto y estado del ERP (`--ls-*`), así que se ven igual en el tema claro y en el
 * oscuro. Las usan también Cold Calling (CorreoRapido, EnviarAnalisisPorCorreo) y el laboratorio de la IA
 * (CalibradorDeWhatsapp, PanelLaboratorio): la API (nombres, y que sean cadenas de clases) no cambia.
 *
 * - En el móvil los controles miden 44 px (`h-11`) y el texto de los campos 16 px, para que Safari no amplíe la pantalla.
 *   Desde `lg` vuelven a 32-36 px y 13.5 px.
 * - Los radios van en valor arbitrario (10 px) porque en este repositorio `rounded-lg` son 24 px.
 * - El foco del teclado se ve siempre (`focus-visible`), con el naranja de la marca.
 */

/** Anillo de foco de teclado (el mismo que el kit) */
const FOCO =
  'outline-none focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ls-fondo)]'

export const CAMPO =
  'h-11 w-full rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-base text-[var(--ls-t1)] outline-none transition-[border-color,box-shadow] ' +
  'placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] ' +
  'focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ls-acc-graf)_22%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 lg:h-9 lg:text-[13.5px]'

export const BOTON_PRIMARIO =
  'inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] px-4 ' +
  'text-[14px] font-semibold text-[var(--ls-acc-tinta)] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] transition-[filter,opacity] hover:brightness-110 ' +
  'active:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 lg:h-9 lg:text-[13px] ' +
  FOCO

export const BOTON_SECUNDARIO =
  'inline-flex h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 ' +
  'text-[13px] text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] ' +
  'disabled:cursor-not-allowed disabled:opacity-40 lg:h-8 lg:text-[12.5px] ' +
  FOCO

export const BOTON_ICONO =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] ' +
  'disabled:cursor-not-allowed disabled:opacity-40 lg:h-8 lg:w-8 ' +
  FOCO

/** Un aviso con filo ámbar: lo que hay que hacer antes de poder seguir */
export function Aviso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-3 rounded-[14px] border border-l-[3px] border-[var(--ls-linea)] border-l-[var(--ls-e-ambar)] bg-[var(--ls-sup)] p-4 shadow-[var(--ls-sombra-1)]"
      role="alert"
    >
      <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--ls-e-ambar)_14%,transparent)]">
        <AlertTriangle className="h-4 w-4 text-[var(--ls-e-ambar)]" aria-hidden />
      </span>
      <div className="min-w-0 text-[13.5px] leading-relaxed text-[var(--ls-t2)]">
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
  return (
    <span className={`inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[10.5px] font-medium ${clases}`}>{children}</span>
  )
}
