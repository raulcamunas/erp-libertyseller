'use client'

import { useEffect, type ReactNode } from 'react'
import { ponerChatSinLeer } from '@/lib/avisos/contadores'
import { totalSinLeer } from '@/lib/chat/canales'
import { ponerProveedorDelChatVivo } from '@/lib/chat/dock-estado'
import { ChatProvider, useChat } from './ChatProvider'
import { DialogoDeAjustesDeVoz } from './DialogoDeAjustesDeVoz'
import { JuntaFlotante } from './JuntaFlotante'
import { JuntaProvider } from './JuntaProvider'
import { LlamadaEntrante } from './LlamadaEntrante'
import { PuertaLlamando } from './PuertaLlamando'
import { SonidosDeLaJunta } from './SonidosDeLaJunta'

/** Lo que el resto del ERP necesita saber del chat aunque no esté abierto: lo que hay sin leer (barra y pastilla) y que el chat está vivo (el dock deja de preguntarlo al servidor) */
function EfectosDelChat() {
  const { canales } = useChat()
  useEffect(() => {
    const t = totalSinLeer(canales)
    ponerChatSinLeer(t.mensajes, t.menciones)
  }, [canales])
  useEffect(() => {
    ponerProveedorDelChatVivo(true)
    return () => ponerProveedorDelChatVivo(false)
  }, [])
  return null
}

/**
 * EL CHAT Y LA JUNTA, VIVOS EN TODO EL ERP. Este proveedor cuelga del layout de /dashboard (que no se vuelve a montar al navegar), así que la conexión del chat y la de la junta de voz NO
 * dependen de la pantalla en la que se esté: se puede salir de la pantalla del Chat, ir a Cold Calling o cambiar de pestaña y la junta sigue (con una cápsula pequeña junto a la pastilla del
 * chat, JuntaFlotante). Antes cada pantalla del chat tenía su propia conexión y salir de ella cortaba la junta.
 *
 * El dock (DockDelChat) y la pantalla del Chat (ChatApp) son solo VISTAS de este mismo estado. El tema del chat NO está aquí: pinta variables en la raíz y solo debe estar mientras se ve el chat
 * (TemaDelChatProvider, dentro de ChatApp).
 */
export function ProveedoresDelChat({ children }: { children: ReactNode }) {
  return (
    <ChatProvider>
      <JuntaProvider>
        <EfectosDelChat />
        <SonidosDeLaJunta />
        {children}
        <JuntaFlotante />
        <LlamadaEntrante />
        <PuertaLlamando />
        <DialogoDeAjustesDeVoz />
      </JuntaProvider>
    </ChatProvider>
  )
}
