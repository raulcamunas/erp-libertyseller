import type { Metadata } from 'next'
import localFont from 'next/font/local'

/**
 * LA ENVOLTURA DEL PANEL DE PCCOMPONENTES DEL CLIENTE (migración 329). Aquí NO está el ERP: quien llega es el cliente (o su agencia) con un enlace y una clave. No se indexa
 * y no manda a ningún sitio de dónde viene (la dirección lleva el token).
 */
const sora = localFont({
  src: '../fonts/Sora-SemiBold.ttf',
  weight: '600',
  variable: '--font-sora',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
})

export const metadata: Metadata = {
  title: 'PcComponentes · Liberty Seller',
  description: 'Ventas, pedidos, precios y stock de tu tienda en PcComponentes, al día.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default function LayoutDePcc({ children }: { children: React.ReactNode }) {
  return <div className={sora.variable}>{children}</div>
}
