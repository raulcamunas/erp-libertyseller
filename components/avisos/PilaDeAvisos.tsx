'use client'

import { CalendarCheck, Flame, Mail, MailWarning, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { cerrarAviso, leerAvisos, suscribirAvisos, type Aviso, type TipoDeAviso } from '@/lib/avisos/pila'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'

/**
 * LOS AVISOS DE ABAJO A LA DERECHA: tarjetas que entran deslizándose, se quedan unos segundos y se van solas.
 *
 *   · Con el ratón encima NO se van: la barra de abajo (que cuenta lo que les queda) y el temporizador se paran.
 *   · Con la pestaña oculta tampoco corre el tiempo: lo que llega mientras no se mira sigue ahí al volver.
 *   · Pulsar la tarjeta hace lo que dice su botón (abrir el correo, ir a Correo) y la cierra; la X solo la cierra.
 *   · Entran sin movimiento si la persona ha pedido menos movimiento (`prefers-reduced-motion`, en globals.css).
 *
 * Los publica quien lo sabe (components/avisos/AvisosEnVivo.tsx) en lib/avisos/pila.ts; esto solo los pinta. Va FUERA del recuadro animado
 * del layout, para que `fixed` sea respecto a la ventana.
 */

const ICONO: Record<TipoDeAviso, { icono: LucideIcon; tono: TonoEstado }> = {
  correo: { icono: Mail, tono: 'azul' },
  rebote: { icono: MailWarning, tono: 'ambar' },
  hito: { icono: Flame, tono: 'ambar' },
  cita: { icono: CalendarCheck, tono: 'verde' },
}

const vacia: readonly Aviso[] = []

function Tarjeta({ aviso }: { aviso: Aviso }) {
  const { icono: Icono, tono } = ICONO[aviso.tipo]
  const color = COLOR_ESTADO[tono]
  const [encima, setEncima] = useState(false)
  const [oculta, setOculta] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden')
  const pausada = encima || oculta

  // Cuánto tiempo queda, que se va descontando cada vez que se para
  const restante = useRef(aviso.duracionMs)
  const arrancó = useRef(0)

  useEffect(() => {
    const alCambiar = () => setOculta(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', alCambiar)
    return () => document.removeEventListener('visibilitychange', alCambiar)
  }, [])

  useEffect(() => {
    if (pausada) return
    arrancó.current = Date.now()
    const temporizador = setTimeout(() => cerrarAviso(aviso.id), Math.max(0, restante.current))
    return () => {
      clearTimeout(temporizador)
      restante.current -= Date.now() - arrancó.current
    }
  }, [pausada, aviso.id])

  const pulsar = () => {
    aviso.accion?.alPulsar()
    cerrarAviso(aviso.id)
  }

  return (
    <li
      role="status"
      className="rend-aviso pointer-events-auto relative w-full overflow-hidden rounded-[12px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] shadow-2xl shadow-black/40"
      onMouseEnter={() => setEncima(true)}
      onMouseLeave={() => setEncima(false)}
    >
      <div className="flex items-start gap-3 p-3 pr-9">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]" style={{ color, background: `color-mix(in srgb, ${color} 15%, var(--ls-sup))` }}>
          <Icono className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold leading-tight text-[var(--ls-t1)]">{aviso.titulo}</p>
          {aviso.detalle && <p className="mt-0.5 truncate text-[12px] leading-snug text-[var(--ls-t2)]">{aviso.detalle}</p>}
          {aviso.texto && <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-[var(--ls-t4)]">{aviso.texto}</p>}
          {aviso.accion && (
            <button type="button" onClick={pulsar} className="mt-2 inline-flex h-6 items-center rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2 text-[11.5px] font-medium text-[var(--ls-t1)] transition-colors hover:border-[var(--ls-acc-graf)] hover:bg-[var(--ls-sup3)]">
              {aviso.accion.etiqueta}
            </button>
          )}
        </div>
      </div>
      <button type="button" onClick={() => cerrarAviso(aviso.id)} aria-label="Cerrar el aviso" className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]">
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span aria-hidden className="rend-cuenta-atras absolute inset-x-0 bottom-0 h-[2px]" style={{ background: color, '--dur': `${aviso.duracionMs}ms`, animationPlayState: pausada ? 'paused' : undefined } as CSSProperties} />
    </li>
  )
}

export function PilaDeAvisos() {
  const avisos = useSyncExternalStore(suscribirAvisos, leerAvisos, () => vacia)
  if (avisos.length === 0) return null
  return (
    <ol aria-label="Avisos" className="pointer-events-none fixed inset-x-3 bottom-3 z-[70] flex flex-col items-end gap-2 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[360px]">
      {avisos.map((a) => (
        <Tarjeta key={a.id} aviso={a} />
      ))}
    </ol>
  )
}
