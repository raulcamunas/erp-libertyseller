'use client'

import { useEffect } from 'react'
import { Phone, PhoneOff } from 'lucide-react'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { avisarEnEscritorio } from '@/lib/avisos/sonido-tareas'
import { iniciarTonoDeLlamada } from '@/lib/chat/sonidos-voz'
import { useChat } from './ChatProvider'
import { useJunta } from './JuntaProvider'

const SUENA_MS = 40_000

/** «Daniella te llama»: solo en los directos, y solo si no estás ya en otra junta */
export function LlamadaEntrante() {
  const { llamadaEntrante, descartarLlamada, canales, nombreDe, seleccionar } = useChat()
  const { actual, entrar, disponible } = useJunta()
  const canal = llamadaEntrante ? canales.find((c) => c.id === llamadaEntrante.canalId) : null
  const visible = Boolean(llamadaEntrante && canal && canal.tipo === 'directo' && canal.soy_miembro && !canal.silenciado && !actual && disponible)

  useEffect(() => {
    if (!visible) return
    const parar = iniciarTonoDeLlamada()
    // Con la pestaña oculta, también sale la notificación del sistema (si están activadas): pulsarla lleva a la conversación
    if (llamadaEntrante) avisarEnEscritorio(`${nombreDe(llamadaEntrante.de)} te llama`, 'Llamada de voz en el chat', `/dashboard/chat?canal=${llamadaEntrante.canalId}`)
    const apagar = setTimeout(descartarLlamada, SUENA_MS)
    return () => {
      parar()
      clearTimeout(apagar)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, llamadaEntrante?.en, descartarLlamada])

  if (!visible || !llamadaEntrante) return null
  const nombre = nombreDe(llamadaEntrante.de)
  return (
    <div className="chat-llamada" role="alertdialog" aria-label={`${nombre} te llama`}>
      <Avatar id={llamadaEntrante.de} nombre={nombre} tamano={44} />
      <div className="min-w-0">
        <b>{nombre}</b>
        <span>te está llamando…</span>
      </div>
      <button type="button" className="chat-llamada-rechazar" onClick={descartarLlamada} aria-label="Ahora no" title="Ahora no"><PhoneOff className="h-4 w-4" /></button>
      <button
        type="button"
        className="chat-llamada-aceptar"
        onClick={() => {
          const canalId = llamadaEntrante.canalId
          descartarLlamada()
          seleccionar(canalId)
          void entrar(canalId)
        }}
        aria-label="Responder"
        title="Responder"
      >
        <Phone className="h-4 w-4" />
      </button>
    </div>
  )
}
