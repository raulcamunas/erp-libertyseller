'use client'

import * as Popover from '@radix-ui/react-popover'
import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Boton } from '@/components/ui-ls'

/**
 * ¿Pantalla de ordenador? Para decidir si el editor del día sale en popover (PC) o en hoja inferior (móvil). Solo se usa
 * después de un clic, así que empezar en false no hace saltar nada al hidratar.
 */
export function useEsEscritorio(): boolean {
  const [es, setEs] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const cambiar = () => setEs(mq.matches)
    cambiar()
    mq.addEventListener('change', cambiar)
    return () => mq.removeEventListener('change', cambiar)
  }, [])
  return es
}

/**
 * EL EDITOR DEL DÍA EN PC: un popover anclado a la casilla, para que la rejilla NO salte (antes se desplegaba encima del
 * calendario y lo empujaba hacia abajo). En portal, con foco atrapado y Escape para cerrar.
 */
export function PopoverDelDia({
  abierto,
  onCerrar,
  titulo,
  subtitulo,
  ancla,
  children,
}: {
  abierto: boolean
  onCerrar: () => void
  titulo: ReactNode
  subtitulo?: ReactNode
  ancla: ReactNode
  children: ReactNode
}) {
  return (
    <Popover.Root open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <Popover.Anchor asChild>{ancla}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="center"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-[340px] rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-4 text-[var(--ls-t1)] shadow-[var(--ls-sombra-3)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
        >
          <div className="mb-3 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold tracking-[-0.01em]">{titulo}</p>
              {subtitulo && <p className="truncate text-[12px] text-[var(--ls-t3)]">{subtitulo}</p>}
            </div>
            <Popover.Close asChild>
              <Boton variante="fantasma" tamano="sm" soloIcono icono={X} aria-label="Cerrar" />
            </Popover.Close>
          </div>
          {children}
          <Popover.Arrow className="fill-[var(--ls-sup)]" width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
