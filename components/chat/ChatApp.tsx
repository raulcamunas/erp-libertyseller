'use client'

import { useEffect } from 'react'
import { totalSinLeer } from '@/lib/chat/canales'
import { BarraDeChat } from './BarraDeChat'
import { ChatProvider, useChat } from './ChatProvider'
import { JuntaProvider } from './JuntaProvider'
import { LlamadaEntrante } from './LlamadaEntrante'
import { PanelDeJunta } from './PanelDeJunta'
import { PanelDeHilo } from './PanelDeHilo'
import { VistaDeCanal } from './VistaDeCanal'

function Marco() {
  const { canales, hilo, actual } = useChat()
  // El título de la pestaña avisa de lo que hay sin leer aunque estés en otra
  useEffect(() => {
    const t = totalSinLeer(canales)
    const n = t.mensajes + t.menciones
    const titulo = document.title.replace(/^\(\d+\+?\)\s*/, '')
    document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${titulo}` : titulo
    return () => {
      document.title = document.title.replace(/^\(\d+\+?\)\s*/, '')
    }
  }, [canales])
  return (
    <div className="chat-marco" data-con-hilo={hilo ? 'true' : undefined} data-vista={actual ? 'canal' : 'barra'}>
      <BarraDeChat />
      <VistaDeCanal />
      <PanelDeHilo />
      <PanelDeJunta />
      <LlamadaEntrante />
    </div>
  )
}

export function ChatApp({ canalInicial }: { canalInicial?: string | null }) {
  return (
    <ChatProvider canalInicial={canalInicial}>
      <JuntaProvider>
        <Marco />
      </JuntaProvider>
    </ChatProvider>
  )
}
