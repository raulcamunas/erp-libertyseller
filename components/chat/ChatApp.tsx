'use client'

import { useEffect, useState } from 'react'
import { totalSinLeer } from '@/lib/chat/canales'
import { AsistenteDelErp } from './AsistenteDelErp'
import { BarraDeChat } from './BarraDeChat'
import { ChatProvider, useChat } from './ChatProvider'
import { JuntaProvider } from './JuntaProvider'
import { LlamadaEntrante } from './LlamadaEntrante'
import { PanelDeJunta } from './PanelDeJunta'
import { SaltarA } from './SaltarA'
import { VistaDeBandeja } from './VistaDeBandeja'
import { TemaDelChatProvider, useTemaDelChat } from './TemaDelChat'
import { PanelDeHilo } from './PanelDeHilo'
import { VistaDeCanal } from './VistaDeCanal'

export function Marco() {
  const { canales, hilo, actual, vista } = useChat()
  const [buscando, setBuscando] = useState(false)
  const { ajustes } = useTemaDelChat()
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
  // Soltar un archivo fuera de una zona (la barra, una cabecera…) haría que el navegador lo abra y se pierda el chat: se frena
  useEffect(() => {
    const frenar = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', frenar)
    window.addEventListener('drop', frenar)
    return () => {
      window.removeEventListener('dragover', frenar)
      window.removeEventListener('drop', frenar)
    }
  }, [])
  // Cmd+K (o Ctrl+K) abre el buscador desde cualquier sitio del chat
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setBuscando((b) => !b)
      }
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [])
  return (
    <div className="chat-marco" data-con-hilo={hilo ? 'true' : undefined} data-vista={actual || vista !== 'canal' ? 'canal' : 'barra'} data-fondo={ajustes.fondo} data-estilo={ajustes.estilo} data-densidad={ajustes.densidad} data-texto={ajustes.texto}>
      <BarraDeChat alBuscar={() => setBuscando(true)} />
      {vista === 'canal' ? <VistaDeCanal /> : <VistaDeBandeja />}
      <PanelDeHilo />
      <PanelDeJunta />
      <AsistenteDelErp />
      <LlamadaEntrante />
      {buscando && <SaltarA onCerrar={() => setBuscando(false)} />}
    </div>
  )
}

export function ChatApp({ canalInicial }: { canalInicial?: string | null }) {
  return (
    <TemaDelChatProvider>
      <ChatProvider canalInicial={canalInicial}>
        <JuntaProvider>
          <Marco />
        </JuntaProvider>
      </ChatProvider>
    </TemaDelChatProvider>
  )
}
