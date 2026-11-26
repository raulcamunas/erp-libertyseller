'use client'

import * as Alerta from '@radix-ui/react-alert-dialog'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Boton, FOCO, TACTIL } from './Boton'
import { useAltoDelTeclado } from './useAltoDelTeclado'
import { palabraCoincide } from './utilidades'

/**
 * CONFIRMACIÓN DE ACCIONES IRREVERSIBLES. Para borrar, enviar a un cliente, lanzar algo que no se puede deshacer: hay que ESCRIBIR una palabra (por defecto
 * «BORRAR») para que se active el botón. Sin palabra (`palabra={null}`) es una confirmación normal de dos botones.
 *
 * Si onConfirmar devuelve una promesa, el botón se queda «cargando» hasta que termine y el diálogo solo se cierra si no falla (el error lo enseña quien llama, con un toast).
 *
 *   <Confirmacion abierto={abrir} onCambio={setAbrir} titulo="¿Borrar la cuenta de Shoplamp?"
 *     descripcion="Se borran sus 469 filas del diccionario. No se puede deshacer." palabra="BORRAR" textoConfirmar="Borrar para siempre"
 *     onConfirmar={async () => { await borrar() }} />
 */
export interface ConfirmacionProps {
  abierto: boolean
  onCambio: (abierto: boolean) => void
  titulo: ReactNode
  descripcion?: ReactNode
  /** La palabra a escribir. null = sin palabra. */
  palabra?: string | null
  textoConfirmar?: string
  textoCancelar?: string
  tono?: 'peligro' | 'normal'
  onConfirmar: () => void | Promise<unknown>
  /** Contenido extra (lista de lo que se va a borrar, por ejemplo) */
  children?: ReactNode
  /** true = el botón de confirmar sigue apagado (p. ej. falta escribir un motivo en `children`) */
  bloqueado?: boolean
}

export function Confirmacion({ abierto, onCambio, titulo, descripcion, palabra = 'BORRAR', textoConfirmar = 'Confirmar', textoCancelar = 'Cancelar', tono = 'peligro', onConfirmar, children, bloqueado = false }: ConfirmacionProps) {
  const [escrito, setEscrito] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const idCampo = useId()
  // El campo de la palabra coge el foco al abrir y en el móvil sale el teclado: el diálogo se centra en lo que queda visible encima, o el botón de confirmar
  // quedaría tapado (15 nov 2026, 375×740: el botón acababa en y=531 y el teclado empieza hacia y=440)
  const teclado = useAltoDelTeclado(abierto)

  // Cada vez que se abre, la palabra se vuelve a escribir
  useEffect(() => {
    if (abierto) setEscrito('')
  }, [abierto])

  const listo = !bloqueado && (palabra == null || palabraCoincide(escrito, palabra))

  const confirmar = async () => {
    if (!listo || trabajando) return
    try {
      setTrabajando(true)
      await onConfirmar()
      onCambio(false)
    } catch {
      // Lo enseña quien llama; aquí solo no se cierra
    } finally {
      setTrabajando(false)
    }
  }

  const peligro = tono === 'peligro'
  return (
    <Alerta.Root open={abierto} onOpenChange={(a) => !trabajando && onCambio(a)}>
      <Alerta.Portal>
        <Alerta.Overlay className="fixed inset-0 z-[70] bg-[rgba(6,7,9,0.66)] backdrop-blur-[3px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Alerta.Content
          style={{ ['--ls-teclado' as string]: `${teclado}px` }}
          className={cn(
            // Centrado con inset-0 + margin auto (y no con translate -50 %): así la animación de zoom no lo descoloca al empezar
            'fixed inset-x-0 bottom-[var(--ls-teclado,0px)] top-0 z-[70] m-auto h-fit max-h-[calc(100dvh-2rem-var(--ls-teclado,0px))] w-[calc(100vw-2rem)] max-w-[440px] overflow-y-auto rounded-[18px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-3)] outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-[0.97] data-[state=closed]:zoom-out-[0.97] motion-reduce:animate-none',
          )}
        >
          {peligro && <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28" style={{ background: 'radial-gradient(70% 100% at 50% 0%, color-mix(in srgb, var(--ls-e-rojo) 16%, transparent), transparent)' }} />}
          <form
            className="relative p-5"
            onSubmit={(e) => {
              e.preventDefault()
              void confirmar()
            }}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
                style={{
                  color: peligro ? 'var(--ls-e-rojo)' : 'var(--ls-e-ambar)',
                  background: `color-mix(in srgb, ${peligro ? 'var(--ls-e-rojo)' : 'var(--ls-e-ambar)'} 14%, transparent)`,
                  boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${peligro ? 'var(--ls-e-rojo)' : 'var(--ls-e-ambar)'} 34%, transparent)`,
                }}
              >
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <Alerta.Title className="text-[16px] font-semibold tracking-[-0.015em] text-[var(--ls-t1)]">{titulo}</Alerta.Title>
                {descripcion ? <Alerta.Description className="mt-1 text-[13px] leading-[1.55] text-[var(--ls-t3)]">{descripcion}</Alerta.Description> : <Alerta.Description className="sr-only">Confirma la acción</Alerta.Description>}
              </div>
            </div>

            {children && <div className="mt-4 text-[13px] text-[var(--ls-t2)]">{children}</div>}

            {palabra != null && (
              <div className="mt-5">
                <label htmlFor={idCampo} className="text-[12.5px] text-[var(--ls-t3)]">
                  Para confirmar, escribe <strong className="rounded-[5px] bg-[var(--ls-sup3)] px-[6px] py-[1px] font-mono text-[12px] font-semibold tracking-[0.04em] text-[var(--ls-t1)]">{palabra}</strong>
                </label>
                <input
                  id={idCampo}
                  value={escrito}
                  onChange={(e) => setEscrito(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  autoFocus
                  className={cn(
                    'mt-2 h-10 w-full rounded-[10px] border bg-[var(--ls-sup2)] px-3 font-mono text-[14px] tracking-[0.04em] text-[var(--ls-t1)] placeholder:text-[var(--ls-t4)] transition-colors [@media(pointer:coarse)]:text-[16px]',
                    TACTIL,
                    FOCO,
                    listo ? 'border-[color-mix(in_srgb,var(--ls-e-verde)_55%,transparent)]' : 'border-[var(--ls-linea2)]',
                  )}
                  placeholder={palabra}
                />
              </div>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Alerta.Cancel asChild>
                <Boton variante="secundario" disabled={trabajando}>
                  {textoCancelar}
                </Boton>
              </Alerta.Cancel>
              <Boton type="submit" variante={peligro ? 'peligro' : 'primario'} disabled={!listo} cargando={trabajando}>
                {textoConfirmar}
              </Boton>
            </div>
          </form>
        </Alerta.Content>
      </Alerta.Portal>
    </Alerta.Root>
  )
}
