'use client'

import { Clock } from 'lucide-react'

/**
 * EL AVISO DE UN MINUTO ANTES: «tu sesión se cerrará por inactividad». Cualquier toque de ratón o de teclado lo quita, y
 * el botón existe para que haya algo que pulsar (que es lo que renueva la sesión).
 *
 * Es un recuadro abajo en el centro, por encima de todo y sin tapar la pantalla: quien está leyendo algo largo lo ve,
 * mueve el ratón y sigue.
 */
export function AvisoDeInactividad({ segundos, minutos }: { segundos: number; minutos: number }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-6 left-1/2 z-[300] flex w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-[10px] border border-[var(--ls-linea2)] border-l-2 border-l-[var(--ls-e-ambar)] bg-[var(--ls-sup)] px-4 py-3 shadow-2xl"
    >
      <Clock className="h-5 w-5 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden />
      <div className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--ls-t2)]">
        <p className="font-semibold text-[var(--ls-t1)]">
          Tu sesión se cerrará en <span className="tabular-nums">{segundos}</span> s
        </p>
        <p className="text-[12px] text-[var(--ls-t3)]">Llevas {minutos} min sin actividad. Mueve el ratón o pulsa una tecla para seguir.</p>
      </div>
      <button
        type="button"
        className="h-8 shrink-0 rounded-[6px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)] transition-opacity hover:opacity-90"
      >
        Seguir conectado
      </button>
    </div>
  )
}
