'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ponerChatSinLeer } from '@/lib/avisos/contadores'
import { totalSinLeer } from '@/lib/chat/canales'
import { ponerProveedorDelChatVivo } from '@/lib/chat/dock-estado'
import { variablesDeFondo } from '@/lib/chat/fondos'
import { BarraDeChat } from './BarraDeChat'
import { ChatProvider, useChat } from './ChatProvider'
import { JuntaProvider } from './JuntaProvider'
import { LlamadaEntrante } from './LlamadaEntrante'
import { PanelDeJunta } from './PanelDeJunta'
import { SaltarA } from './SaltarA'
import { VistaDeBandeja } from './VistaDeBandeja'
import { TemaDelChatProvider, useTemaDelChat } from './TemaDelChat'
import { PanelDeHilo } from './PanelDeHilo'
import { useAjusteMovil } from './useAjusteMovil'
import { PanelDeMiembros, useMiembrosALaVista } from './PanelDeMiembros'
import { VistaDeCanal } from './VistaDeCanal'

/** En el dock, lo que debe cubrir la ventana entera (una llamada, el asistente) sale del recuadro pequeño y se pinta sobre la página */
function EnLaPagina({ activo, children }: { activo: boolean; children: ReactNode }) {
  return activo && typeof document !== 'undefined' ? createPortal(children, document.body) : <>{children}</>
}

export function Marco({ dock = false }: { dock?: boolean }) {
  const { canales, hilo, actual, vista } = useChat()
  const [buscando, setBuscando] = useState(false)
  const miembrosALaVista = useMiembrosALaVista()
  const { ajustes } = useTemaDelChat()
  // Lo que hay sin leer, a la barra del ERP; y mientras el chat está vivo, el dock deja de preguntarlo al servidor
  useEffect(() => {
    const t = totalSinLeer(canales)
    ponerChatSinLeer(t.mensajes, t.menciones)
  }, [canales])
  useEffect(() => {
    ponerProveedorDelChatVivo(true)
    return () => ponerProveedorDelChatVivo(false)
  }, [])
  // El título de la pestaña avisa de lo que hay sin leer aunque estés en otra (no en el dock: ahí el título es el de la página que se está viendo)
  useEffect(() => {
    if (dock) return
    const t = totalSinLeer(canales)
    const n = t.mensajes + t.menciones
    const titulo = document.title.replace(/^\(\d+\+?\)\s*/, '')
    document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${titulo}` : titulo
    return () => {
      document.title = document.title.replace(/^\(\d+\+?\)\s*/, '')
    }
  }, [canales, dock])
  // Soltar un archivo fuera de una zona (la barra, una cabecera…) haría que el navegador lo abra y se pierda el chat: se frena
  useEffect(() => {
    if (dock) return
    const frenar = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', frenar)
    window.addEventListener('drop', frenar)
    return () => {
      window.removeEventListener('dragover', frenar)
      window.removeEventListener('drop', frenar)
    }
  }, [dock])
  // Cmd+K (o Ctrl+K) abre el buscador desde cualquier sitio del chat
  useEffect(() => {
    // En el dock no se toma Cmd+K: es el buscador del ERP entero
    if (dock) return
    const alTeclear = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setBuscando((b) => !b)
      }
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [dock])
  return (
    <div className="chat-marco" data-con-hilo={hilo ? 'true' : undefined} data-con-miembros={miembrosALaVista ? 'true' : undefined} data-vista={actual || vista !== 'canal' ? 'canal' : 'barra'} data-fondo={ajustes.fondo} style={variablesDeFondo(ajustes.fondo) as CSSProperties} data-estilo={ajustes.estilo} data-densidad={ajustes.densidad} data-texto={ajustes.texto} data-dock={dock ? 'true' : undefined}>
      <BarraDeChat alBuscar={() => setBuscando(true)} />
      {vista === 'canal' ? <VistaDeCanal /> : <VistaDeBandeja />}
      <PanelDeHilo />
      <PanelDeMiembros />
      <EnLaPagina activo={dock}>
        <PanelDeJunta />
        <LlamadaEntrante />
      </EnLaPagina>
      {buscando && <SaltarA onCerrar={() => setBuscando(false)} />}
    </div>
  )
}

/** El chat entero. En el dock (`dock`) va dentro de una ventana pequeña: se adapta solo a su ancho y no toca la dirección, el título ni los atajos de la página */
export function ChatApp({ canalInicial, dock = false }: { canalInicial?: string | null; dock?: boolean }) {
  useAjusteMovil(!dock)
  return (
    <TemaDelChatProvider>
      <ChatProvider canalInicial={canalInicial} sincronizarUrl={!dock}>
        <JuntaProvider>
          <div className="chat-contenedor" data-dock={dock ? 'true' : undefined}>
            <Marco dock={dock} />
          </div>
        </JuntaProvider>
      </ChatProvider>
    </TemaDelChatProvider>
  )
}
