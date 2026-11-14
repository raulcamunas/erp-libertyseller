import type { Viewport } from 'next'
import { redirect } from 'next/navigation'
import { exigirChat } from '@/lib/chat/acceso'

export const dynamic = 'force-dynamic'

/** El chat en el móvil es como una aplicación: sin zoom y a pantalla completa, hasta debajo de la muesca (los márgenes seguros los pone el CSS) */
export const viewport: Viewport = {
  themeColor: '#0F1114',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

/**
 * EL CHAT SE ABRE A PANTALLA COMPLETA, como Tareas de clientes: la barra lateral del ERP se esconde (lib/layout/inmersivo.ts) y la barra del ERP queda a la izquierda a partir de 1024 px.
 * Comparte con las tareas el icono y el color que cada persona ha elegido para sí.
 */
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const permiso = await exigirChat()
  if (!permiso.ok) redirect('/dashboard')
  return <div className="tc-inmersivo chat-inmersivo">{children}</div>
}
