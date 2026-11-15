'use client'

import * as Dialogo from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Boton } from './Boton'
import { useAltoDelTeclado } from './useAltoDelTeclado'
import { colorDeAcento, mezcla, type Modulo } from './utilidades'

/**
 * PANEL LATERAL (Sheet). Radix Dialog por debajo: foco atrapado, Escape cierra, se devuelve el foco al cerrar, se bloquea el scroll de detrás. Va en un portal, así que
 * no le afecta el `transform` que deja puesto la entrada de página (.page-transition).
 *
 * En el ordenador sale por la derecha (ancho `ancho`, 460 px por defecto); en el móvil es una HOJA INFERIOR de casi toda la pantalla con su asa. Lo decide CSS.
 *
 *   <PanelLateral abierto={!!sel} onCambio={(a) => !a && setSel(null)} titulo={sel?.nombre} descripcion="Envío a FBA" icono={Package} acento="remesas"
 *     pie={<><Boton onClick={cerrar}>Cancelar</Boton><Boton variante="primario">Guardar</Boton></>}>
 *     …contenido con scroll propio…
 *   </PanelLateral>
 */
export interface PanelLateralProps {
  abierto: boolean
  onCambio: (abierto: boolean) => void
  titulo: ReactNode
  descripcion?: ReactNode
  icono?: LucideIcon
  acento?: Modulo | string
  children: ReactNode
  /** Barra de abajo (acciones), fija */
  pie?: ReactNode
  /** Ancho en el ordenador, en px */
  ancho?: number
  /** Algo junto a la X (una insignia, un menú) */
  acciones?: ReactNode
}

export function PanelLateral({ abierto, onCambio, titulo, descripcion, icono: Icono, acento, children, pie, ancho = 460, acciones }: PanelLateralProps) {
  const color = colorDeAcento(acento)
  // En el móvil la hoja se apoya ENCIMA del teclado: si no, el pie con «Guardar» queda debajo mientras se escribe (ver useAltoDelTeclado)
  const teclado = useAltoDelTeclado(abierto)
  return (
    <Dialogo.Root open={abierto} onOpenChange={onCambio}>
      <Dialogo.Portal>
        <Dialogo.Overlay className="fixed inset-0 z-50 bg-[rgba(6,7,9,0.62)] backdrop-blur-[3px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialogo.Content
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden border-[var(--ls-linea2)] bg-[var(--ls-sup)] text-[var(--ls-t1)] shadow-[var(--ls-sombra-3)] outline-none',
            // Móvil: hoja inferior, por encima del teclado si lo hay (--ls-teclado; en el ordenador siempre es 0 y lg:inset-y-0 / lg:max-h-none mandan)
            'inset-x-0 bottom-[var(--ls-teclado,0px)] max-h-[calc(92dvh-var(--ls-teclado,0px))] rounded-t-[20px] border-t pb-[env(safe-area-inset-bottom)]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom data-[state=open]:duration-300 data-[state=closed]:duration-200',
            // Ordenador: panel a la derecha, a toda altura
            'lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[var(--ancho-panel)] lg:max-w-[calc(100vw-2rem)] lg:rounded-none lg:rounded-l-[18px] lg:border-l lg:border-t-0 lg:pb-0',
            'lg:data-[state=open]:slide-in-from-right lg:data-[state=closed]:slide-out-to-right lg:data-[state=open]:slide-in-from-bottom-0 lg:data-[state=closed]:slide-out-to-bottom-0',
            'motion-reduce:animate-none',
          )}
          style={{ ['--ancho-panel' as string]: `${ancho}px`, ['--ls-acento' as string]: color, ['--ls-teclado' as string]: `${teclado}px` }}
        >
          {/* Asa de la hoja (solo móvil) */}
          <div aria-hidden className="flex justify-center pt-2 lg:hidden">
            <span className="h-1 w-10 rounded-full bg-[var(--ls-linea2)]" />
          </div>
          {/* Luz del acento arriba */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32" style={{ background: `radial-gradient(60% 100% at 20% 0%, ${mezcla(color, 14)}, transparent)` }} />

          <div className="relative flex items-start gap-3 border-b border-[var(--ls-linea)] px-5 pb-4 pt-3 lg:pt-5">
            {Icono && (
              <span className="mt-[2px] flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]" style={{ background: mezcla(color, 16), color, boxShadow: `inset 0 0 0 1px ${mezcla(color, 34)}` }}>
                <Icono className="h-[18px] w-[18px]" aria-hidden />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <Dialogo.Title className="truncate text-[16px] font-semibold tracking-[-0.015em] text-[var(--ls-t1)]">{titulo}</Dialogo.Title>
              {descripcion ? <Dialogo.Description className="mt-[2px] text-[12.5px] text-[var(--ls-t3)]">{descripcion}</Dialogo.Description> : <Dialogo.Description className="sr-only">Panel de detalle</Dialogo.Description>}
            </div>
            {acciones}
            <Dialogo.Close asChild>
              <Boton variante="fantasma" soloIcono tamano="sm" icono={X} aria-label="Cerrar" />
            </Dialogo.Close>
          </div>

          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>

          {pie && <div className="relative flex items-center justify-end gap-2 border-t border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-5 py-3">{pie}</div>}
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}
