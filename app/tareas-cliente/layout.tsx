import type { Metadata } from 'next'
import localFont from 'next/font/local'

/**
 * LA ENVOLTURA DEL PANEL PÚBLICO DEL CLIENTE. Aquí NO está el ERP: quien llega es un cliente con un enlace. Igual que la del encaje, no se indexa y no manda a ningún sitio
 * de dónde viene (la dirección lleva el token, que es la credencial).
 */
const sora = localFont({
  src: '../fonts/Sora-SemiBold.ttf',
  weight: '600',
  variable: '--font-sora',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
})

export const metadata: Metadata = {
  title: 'Tu cuenta · Liberty Seller',
  description: 'En qué estamos trabajando para ti.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default function LayoutDelPanelDelCliente({ children }: { children: React.ReactNode }) {
  return <div className={sora.variable}>{children}</div>
}
