'use client'

import type { ReactNode } from 'react'
import { AVISO, BOTON, COLOR_ESTADO, INSIGNIA, TARJETA, type TonoEstado } from '@/lib/estilo/denso'

/**
 * LAS PIEZAS PEQUEÑAS DEL HUB DEL CRM, EN EL ESTILO DENSO (lib/estilo/denso.ts).
 * Todo lo que se repite en las pestañas de la ficha vive aquí para que las seis se vean como una sola pantalla: la tarjeta con su cabecera de 30 px, la fila etiqueta-valor,
 * la insignia de estado, el aviso con filo de color y el campo que no parece un campo hasta que pasas por encima.
 */

export function Seccion({ titulo, icono, derecha, children, className = '', cuerpoClase = '' }: { titulo: string; icono?: ReactNode; derecha?: ReactNode; children: ReactNode; className?: string; cuerpoClase?: string }) {
  return (
    <section className={`${TARJETA.base} ${className}`}>
      <header className={TARJETA.cabecera}>
        {icono && <span className="shrink-0 text-[var(--ls-t4)] [&>svg]:h-[13px] [&>svg]:w-[13px]">{icono}</span>}
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--ls-t1)]">{titulo}</h3>
        {derecha}
      </header>
      <div className={`${TARJETA.cuerpo} ${cuerpoClase}`}>{children}</div>
    </section>
  )
}

/** Una fila «etiqueta — valor». La etiqueta fija 104 px para que los valores de una tarjeta queden alineados */
export function Fila({ etiqueta, icono, children, ancho = 104 }: { etiqueta: string; icono?: ReactNode; children: ReactNode; ancho?: number }) {
  return (
    <div className="flex min-h-[26px] min-w-0 items-center gap-2 py-px">
      <div className="flex shrink-0 items-center gap-[5px] text-[11.5px] text-[var(--ls-t4)]" style={{ width: ancho }}>
        {icono && <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">{icono}</span>}
        <span className="truncate">{etiqueta}</span>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** El valor de solo lectura de una fila (con la misma altura y sangría que el campo editable, para que no salte al alternar) */
export function Valor({ children, vacio = '—' }: { children?: ReactNode; vacio?: string }) {
  const hay = children !== null && children !== undefined && children !== ''
  return <span className={`block min-h-[26px] break-words px-2 py-[3px] text-[12.5px] ${hay ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t4)]'}`}>{hay ? children : vacio}</span>
}

/** Campo de texto que no parece un campo hasta que pasas por encima (CELDA.editable pero para fichas) */
export const INPUT_FANTASMA =
  'block w-full h-[26px] px-2 rounded-[6px] border border-transparent bg-transparent text-[12.5px] text-[var(--ls-t1)] outline-none ' +
  'placeholder:text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:border-[var(--ls-linea)] ' +
  'focus:bg-[var(--ls-sup2)] focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)] ' +
  'read-only:hover:bg-transparent read-only:hover:border-transparent read-only:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:border-transparent'

export const AREA_FANTASMA =
  'block w-full min-h-[52px] px-2 py-[5px] rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] text-[12.5px] leading-[1.5] text-[var(--ls-t1)] outline-none resize-y ' +
  'placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] ' +
  'focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)] ' +
  'read-only:resize-none read-only:hover:border-[var(--ls-linea)] read-only:cursor-default'

export function Insignia({ tono = 'gris', icono, children, titulo }: { tono?: TonoEstado; icono?: ReactNode; children: ReactNode; titulo?: string }) {
  return (
    <span className={INSIGNIA.base} title={titulo}>
      {icono && (
        <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3" style={{ color: COLOR_ESTADO[tono] }}>
          {icono}
        </span>
      )}
      {!icono && <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: COLOR_ESTADO[tono] }} />}
      {children}
    </span>
  )
}

export function Aviso({ tono = 'ambar', icono, children, className = '' }: { tono?: TonoEstado; icono?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`${AVISO.base} ${AVISO.conTono} ${className}`} style={{ borderLeftColor: COLOR_ESTADO[tono] }}>
      {icono && (
        <span className="mt-[2px] shrink-0 [&>svg]:h-[13px] [&>svg]:w-[13px]" style={{ color: COLOR_ESTADO[tono] }}>
          {icono}
        </span>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function Vacio({ children, icono }: { children: ReactNode; icono?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      {icono && <span className="text-[var(--ls-t4)] [&>svg]:h-5 [&>svg]:w-5">{icono}</span>}
      <p className="max-w-[44ch] text-[12px] leading-[1.55] text-[var(--ls-t3)]">{children}</p>
    </div>
  )
}

/** Botón en el estilo denso. `tono="primario"`: uno por pantalla */
export function Boton({
  children,
  onClick,
  tono = 'secundario',
  icono,
  disabled,
  alto,
  titulo,
  type = 'button',
}: {
  children?: ReactNode
  onClick?: () => void
  tono?: 'primario' | 'secundario'
  icono?: ReactNode
  disabled?: boolean
  alto?: boolean
  titulo?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={titulo} className={`${BOTON.base} ${tono === 'primario' ? BOTON.primario : BOTON.secundario} ${alto ? BOTON.alto : ''}`}>
      {icono && <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">{icono}</span>}
      {children}
    </button>
  )
}

/** Un dato con su rótulo, en vertical: para las tiras de cifras dentro de una tarjeta */
export function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold text-[var(--ls-t4)]">{etiqueta}</p>
      <div className="mt-px min-w-0 text-[12.5px] text-[var(--ls-t1)]">{children}</div>
    </div>
  )
}

/** Una lista con viñetas sobrias (el cuadradito es del color de acento) */
export function Lista({ items, vacio = 'Nada.' }: { items: readonly string[]; vacio?: string }) {
  if (items.length === 0) return <p className="text-[12px] text-[var(--ls-t4)]">{vacio}</p>
  return (
    <ul className="space-y-[5px]">
      {items.map((t, i) => (
        <li key={i} className="flex gap-[7px] text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
          <span className="mt-[7px] h-[4px] w-[4px] shrink-0 rounded-[1px] bg-[var(--ls-acc-graf)]" />
          <span className="min-w-0 break-words">{t}</span>
        </li>
      ))}
    </ul>
  )
}
