import { redirect } from 'next/navigation'
import { AparienciaProvider } from '@/components/tareas-clientes/AparienciaProvider'
import { exigirChat } from '@/lib/chat/acceso'
import { leerApariencias } from '@/lib/tareas-clientes/apariencia-servidor'

export const dynamic = 'force-dynamic'

/**
 * EL CHAT SE ABRE A PANTALLA COMPLETA, como Tareas de clientes: la barra lateral del ERP se esconde (lib/layout/inmersivo.ts) y la barra del ERP queda a la izquierda a partir de 1024 px.
 * Comparte con las tareas el icono y el color que cada persona ha elegido para sí.
 */
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const permiso = await exigirChat()
  if (!permiso.ok) redirect('/dashboard')
  const apariencias = await leerApariencias()
  return (
    <AparienciaProvider inicial={apariencias.mapa} disponibleAlInicio={apariencias.disponible}>
      <div className="tc-inmersivo chat-inmersivo">
        {children}
      </div>
    </AparienciaProvider>
  )
}
