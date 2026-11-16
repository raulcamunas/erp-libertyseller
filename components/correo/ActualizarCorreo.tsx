'use client'

import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Boton, FOCO, TACTIL } from '@/components/ui-ls'
import { hace } from '@/lib/correo/fechas'
import { cn } from '@/lib/utils'

/**
 * LO QUE LA CABECERA DE CORREO ENSEÑA SOBRE LA FRESCURA DEL BUZÓN: «Actualizado hace…», el botón de actualizar y el interruptor «Auto».
 * Solo pintan; quién lee qué y cuándo lo decide PanelCorreo (la lectura en sí, la hace el servidor). Spec «Correo Pro», flujo 18.
 *
 * COMPACTO TAMBIÉN EN EL MÓVIL: la etiqueta ya no se esconde por debajo de md. En el móvil dice solo «hace 5 min» (o «Buscando…»), y desde
 * md «Actualizado hace 5 min» (o «Buscando correos nuevos…»). Las fechas salen de lib/correo/fechas.ts (`hace`), la única fuente.
 */

/** El texto de la etiqueta, corto (móvil) y largo (desde md). PURO: lo comprueba ActualizarCorreo.prueba.ts */
export function textoDeActualizado(e: { ultimoSyncAt: string | null; sincronizando: boolean; conectado: boolean }, ahora: number = Date.now()): { corto: string; largo: string } {
  if (e.sincronizando) return { corto: 'Buscando…', largo: 'Buscando correos nuevos…' }
  const cuando = hace(e.ultimoSyncAt, ahora)
  if (cuando) return { corto: cuando, largo: `Actualizado ${cuando}` }
  if (e.conectado) return { corto: 'Sin leer aún', largo: 'Todavía sin leer' }
  return { corto: '', largo: '' }
}

/** «Actualizado hace…»: se repinta solo cada 15 s para que no se quede en «hace 2 min» cuando ya son 5 (el resto de la pantalla no se repinta por esto) */
export function EtiquetaDeActualizado({
  ultimoSyncAt,
  sincronizando,
  conectado,
  className,
}: {
  ultimoSyncAt: string | null
  sincronizando: boolean
  conectado: boolean
  /** OPCIONAL. Clases extra (por ejemplo, dentro de un menú) */
  className?: string
}) {
  const [, repintar] = useState(0)
  useEffect(() => {
    const t = setInterval(() => repintar((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])
  const { corto, largo } = textoDeActualizado({ ultimoSyncAt, sincronizando, conectado })
  if (!largo) return null
  return (
    <span
      className={cn('min-w-0 truncate whitespace-nowrap pr-1 text-[12px] tabular-nums text-[var(--ls-t4)] lg:text-[11.5px]', className)}
      title={largo}
      aria-live="polite"
      suppressHydrationWarning
    >
      <span className="md:hidden">{corto}</span>
      <span className="hidden md:inline">{largo}</span>
    </span>
  )
}

/** El botón de actualizar (en cualquier buzón que se lea) y el interruptor «Auto»: con él encendido la pantalla se pone al día sola cada 30 s mientras se mira */
export function ControlesDeActualizar({
  onActualizar,
  actualizando = false,
  deshabilitado = false,
  titulo,
  auto,
  onAuto,
}: {
  onActualizar: () => void
  actualizando?: boolean
  deshabilitado?: boolean
  titulo: string
  auto: boolean
  onAuto: () => void
}) {
  return (
    <>
      <Boton variante="fantasma" tamano="sm" soloIcono onClick={onActualizar} disabled={actualizando || deshabilitado} title={titulo} aria-label={titulo} aria-busy={actualizando || undefined}>
        <RefreshCw className={cn('h-4 w-4', actualizando && 'animate-spin motion-reduce:animate-none')} aria-hidden />
      </Boton>
      <button
        type="button"
        onClick={onAuto}
        aria-pressed={auto}
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] px-2 text-[12px] font-medium transition-colors hover:bg-[var(--ls-sup2)]',
          TACTIL,
          FOCO,
          auto ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t4)] hover:text-[var(--ls-t1)]',
        )}
        title={auto ? 'Se actualiza solo cada 30 segundos mientras miras esta pantalla. Pulsa para desactivarlo' : 'Actualización automática apagada. Pulsa para que se actualice sola cada 30 segundos'}
      >
        Auto
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 rounded-full transition-[background-color,box-shadow] motion-reduce:transition-none',
            auto ? 'bg-[var(--ls-acc)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--ls-acc)_22%,transparent)]' : 'bg-[var(--ls-t4)] opacity-50',
          )}
        />
      </button>
    </>
  )
}
