'use client'

import { Volume2 } from 'lucide-react'
import { abrirDialogoDeSonidos } from '@/lib/sonidos/dialogo'

/** Abre el selector de sonidos (la biblioteca): elegir qué suena al entrar a una junta, mutearte, que te llamen, un mensaje… */
export function BotonDeSonidos() {
  return (
    <fieldset className="chat-ap-grupo">
      <legend>Sonidos</legend>
      <button type="button" className="chat-boton-sonidos" onClick={abrirDialogoDeSonidos}>
        <Volume2 className="h-3.5 w-3.5" />
        Elegir los sonidos…
      </button>
    </fieldset>
  )
}
