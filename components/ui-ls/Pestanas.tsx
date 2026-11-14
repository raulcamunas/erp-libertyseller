'use client'

import { motion, MotionConfig } from 'framer-motion'
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TACTIL } from './Boton'
import { colorDeAcento, type Modulo } from './utilidades'

/**
 * PESTAÑAS y SEGMENTADO, con el indicador que se desliza de una opción a otra (framer-motion layoutId) y teclado completo:
 * flechas izquierda/derecha (y arriba/abajo), Inicio y Fin; el foco va con la selección (tabindex itinerante).
 *
 *   <Pestanas etiqueta="Secciones" opciones={[{ id: 'resumen', texto: 'Resumen', icono: LayoutGrid }, { id: 'ppc', texto: 'PPC', cuenta: 3 }]} valor={tab} onCambio={setTab} acento="marketing" />
 *     → subrayado deslizante; para cambiar de sección de una pantalla. Con `idPanel` enlaza aria-controls.
 *   <Segmentado etiqueta="Periodo" opciones={[{ id: 7, texto: '7 días' }, { id: 30, texto: '30 días' }]} valor={dias} onCambio={setDias} />
 *     → pastilla deslizante; para elegir entre opciones excluyentes (periodo, vista, filtro).
 *
 * En el móvil las dos se desplazan en horizontal si no caben (nada desborda la página) y cada opción mide 44 px de alto con el dedo.
 */
export interface Opcion<T extends string | number> {
  id: T
  texto: string
  icono?: LucideIcon
  /** Número pequeño al lado (pendientes, resultados…) */
  cuenta?: number
  desactivada?: boolean
}

interface Comunes<T extends string | number> {
  opciones: ReadonlyArray<Opcion<T>>
  valor: T
  onCambio: (v: T) => void
  /** Nombre accesible del grupo («Secciones», «Periodo») */
  etiqueta: string
  className?: string
}

/** Mueve la selección con el teclado entre las opciones activas. */
function useTeclado<T extends string | number>(opciones: ReadonlyArray<Opcion<T>>, valor: T, onCambio: (v: T) => void) {
  const botones = useRef<Map<T, HTMLButtonElement>>(new Map())
  const alPulsarTecla = (e: KeyboardEvent<HTMLElement>) => {
    const activas = opciones.filter((o) => !o.desactivada)
    const i = activas.findIndex((o) => o.id === valor)
    let siguiente: Opcion<T> | undefined
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') siguiente = activas[(i + 1) % activas.length]
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') siguiente = activas[(i - 1 + activas.length) % activas.length]
    else if (e.key === 'Home') siguiente = activas[0]
    else if (e.key === 'End') siguiente = activas[activas.length - 1]
    if (!siguiente) return
    e.preventDefault()
    onCambio(siguiente.id)
    const b = botones.current.get(siguiente.id)
    b?.focus()
    b?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const registrar = (id: T) => (el: HTMLButtonElement | null) => {
    if (el) botones.current.set(id, el)
    else botones.current.delete(id)
  }
  return { alPulsarTecla, registrar }
}

function Cuenta({ n, activa }: { n: number; activa: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px] text-[10.5px] font-semibold tabular-nums',
        activa ? 'bg-[color-mix(in_srgb,var(--ls-acento)_20%,transparent)] text-[var(--ls-acento)]' : 'bg-[var(--ls-sup3)] text-[var(--ls-t3)]',
      )}
    >
      {n}
    </span>
  )
}

export function Pestanas<T extends string | number>({ opciones, valor, onCambio, etiqueta, className, acento, idPanel }: Comunes<T> & { acento?: Modulo | string; idPanel?: string }) {
  const grupo = useId()
  const { alPulsarTecla, registrar } = useTeclado(opciones, valor, onCambio)
  return (
    <MotionConfig reducedMotion="user">
      <div
        role="tablist"
        aria-label={etiqueta}
        onKeyDown={alPulsarTecla}
        className={cn('ls-sin-barra relative flex max-w-full items-end gap-1 overflow-x-auto border-b border-[var(--ls-linea)]', className)}
        style={{ ['--ls-acento' as string]: colorDeAcento(acento) }}
      >
        {opciones.map((o) => {
          const activa = o.id === valor
          const Icono = o.icono
          return (
            <button
              key={String(o.id)}
              ref={registrar(o.id)}
              type="button"
              role="tab"
              id={`${grupo}-tab-${o.id}`}
              aria-selected={activa}
              aria-controls={idPanel}
              tabIndex={activa ? 0 : -1}
              disabled={o.desactivada}
              onClick={() => onCambio(o.id)}
              className={cn(
                'relative inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-t-[8px] px-3 text-[13px] font-medium outline-none transition-colors',
                'focus-visible:bg-[var(--ls-sup2)] focus-visible:text-[var(--ls-t1)] disabled:opacity-40',
                TACTIL,
                activa ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]',
              )}
            >
              {Icono && <Icono className={cn('h-[15px] w-[15px]', activa && 'text-[var(--ls-acento)]')} aria-hidden />}
              {o.texto}
              {o.cuenta != null && <Cuenta n={o.cuenta} activa={activa} />}
              {activa && (
                <motion.span
                  layoutId={`${grupo}-indicador`}
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-[2px] rounded-full"
                  style={{ background: 'var(--ls-acento)', boxShadow: '0 0 12px color-mix(in srgb, var(--ls-acento) 70%, transparent)' }}
                  transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                />
              )}
            </button>
          )
        })}
      </div>
    </MotionConfig>
  )
}

export function Segmentado<T extends string | number>({ opciones, valor, onCambio, etiqueta, className, tamano = 'md', anchoCompleto }: Comunes<T> & { tamano?: 'sm' | 'md'; anchoCompleto?: boolean }) {
  const grupo = useId()
  const { alPulsarTecla, registrar } = useTeclado(opciones, valor, onCambio)
  return (
    <MotionConfig reducedMotion="user">
      <div
        role="radiogroup"
        aria-label={etiqueta}
        onKeyDown={alPulsarTecla}
        className={cn(
          'ls-sin-barra relative max-w-full items-center overflow-x-auto rounded-[11px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[3px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]',
          anchoCompleto ? 'flex w-full' : 'inline-flex',
          className,
        )}
      >
        {opciones.map((o) => {
          const activa = o.id === valor
          const Icono = o.icono
          return (
            <button
              key={String(o.id)}
              ref={registrar(o.id)}
              type="button"
              role="radio"
              aria-checked={activa}
              tabIndex={activa ? 0 : -1}
              disabled={o.desactivada}
              onClick={() => onCambio(o.id)}
              className={cn(
                'relative inline-flex shrink-0 items-center justify-center gap-[6px] whitespace-nowrap rounded-[8px] font-medium outline-none transition-colors',
                'focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] disabled:opacity-40',
                tamano === 'sm' ? 'h-7 px-[10px] text-[12px]' : 'h-8 px-3 text-[12.5px]',
                TACTIL,
                anchoCompleto && 'flex-1',
                activa ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]',
              )}
            >
              {activa && (
                <motion.span
                  layoutId={`${grupo}-pastilla`}
                  aria-hidden
                  className="absolute inset-0 rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] shadow-[0_1px_2px_rgba(0,0,0,0.25),0_4px_12px_-6px_rgba(0,0,0,0.4)]"
                  transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                />
              )}
              <span className="relative inline-flex items-center gap-[6px]">
                {Icono && <Icono className="h-[14px] w-[14px]" aria-hidden />}
                {o.texto}
                {o.cuenta != null && <span className={cn('text-[11px] tabular-nums', activa ? 'text-[var(--ls-acc)]' : 'text-[var(--ls-t4)]')}>{o.cuenta}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </MotionConfig>
  )
}

/** El panel que acompaña a <Pestanas idPanel="…">: role=tabpanel y una entrada suave al cambiar. */
export function PanelDePestana({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <div id={id} role="tabpanel" tabIndex={0} className={cn('ls-aparecer outline-none', className)}>
      {children}
    </div>
  )
}
