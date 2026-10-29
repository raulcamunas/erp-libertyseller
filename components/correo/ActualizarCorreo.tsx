'use client'

import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { RefreshCw, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { BOTON_ICONO } from './ui'

/**
 * LO QUE LA CABECERA DE CORREO ENSEÑA SOBRE LA FRESCURA DEL BUZÓN: «Actualizado hace…», el botón de actualizar y el interruptor «Auto».
 * Solo pintan; quién lee qué y cuándo lo decide PanelCorreo (la lectura en sí, la hace el servidor).
 */

const hace = (iso: string) => formatDistanceToNow(new Date(Math.min(Date.parse(iso), Date.now())), { locale: es, addSuffix: true })

/** «Actualizado hace…»: se repinta solo cada 15 s para que no se quede en «hace 2 minutos» cuando ya son 5 (el resto de la pantalla no se repinta por esto) */
export function EtiquetaDeActualizado({ ultimoSyncAt, sincronizando, conectado }: { ultimoSyncAt: string | null; sincronizando: boolean; conectado: boolean }) {
  const [, repintar] = useState(0)
  useEffect(() => {
    const t = setInterval(() => repintar((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="hidden truncate pr-1 text-[11.5px] text-[var(--ls-t4)] md:inline" suppressHydrationWarning>
      {sincronizando ? 'Buscando correos nuevos…' : ultimoSyncAt ? `Actualizado ${hace(ultimoSyncAt)}` : conectado ? 'Todavía sin leer' : ''}
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
      <button type="button" onClick={onActualizar} disabled={actualizando || deshabilitado} className={BOTON_ICONO} title={titulo} aria-label={titulo}>
        <RefreshCw className={`h-4 w-4 ${actualizando ? 'animate-spin' : ''}`} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onAuto}
        aria-pressed={auto}
        className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-[6px] px-2 text-[11.5px] font-medium transition-colors hover:bg-[var(--ls-sup3)] ${auto ? 'text-[var(--ls-acc)]' : 'text-[var(--ls-t4)] hover:text-[var(--ls-t1)]'}`}
        title={auto ? 'Se actualiza solo cada 30 segundos mientras miras esta pantalla. Pulsa para desactivarlo' : 'Actualización automática apagada. Pulsa para que se actualice sola cada 30 segundos'}
      >
        <Timer className="h-3.5 w-3.5" aria-hidden /> Auto
      </button>
    </>
  )
}
