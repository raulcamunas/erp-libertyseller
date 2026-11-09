'use client'

import { Volume2 } from 'lucide-react'
import { SONIDOS_PARA_PROBAR, probarSonidoDeVoz } from '@/lib/chat/sonidos-voz'

/** Escuchar a mano cada sonido de la junta y de las llamadas, sin tener que montar una llamada. Suenan aunque «Sonidos de la junta» esté apagado (es para probarlos) */
export function ProbadorDeSonidos() {
  return (
    <fieldset className="chat-ap-grupo">
      <legend>Probar los sonidos</legend>
      <div className="chat-sonidos-prueba">
        {SONIDOS_PARA_PROBAR.map((s) => (
          <button key={s.id} type="button" onClick={() => probarSonidoDeVoz(s.id)} title={s.cuando} aria-label={`Escuchar: ${s.nombre}. ${s.cuando}`}>
            <Volume2 className="h-3.5 w-3.5" />
            {s.nombre}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
