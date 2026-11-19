import type { Metadata } from 'next'
import localFont from 'next/font/local'

/** LA ENVOLTURA DEL AUDITOR DE STOCK PARA EL CLIENTE (migración 323): enlace con clave, no se indexa ni manda a ningún sitio de dónde viene */
const sora = localFont({
  src: '../fonts/Sora-SemiBold.ttf',
  weight: '600',
  variable: '--font-sora',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
})

export const metadata: Metadata = {
  title: 'Stock Amazon y tienda · Liberty Seller',
  description: 'El stock de cada producto en Amazon frente a la tienda, al día.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default function LayoutDeStock({ children }: { children: React.ReactNode }) {
  return <div className={sora.variable}>{children}</div>
}
