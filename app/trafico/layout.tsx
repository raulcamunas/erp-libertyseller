import type { Metadata } from 'next'
import localFont from 'next/font/local'

/**
 * LA ENVOLTURA DE LA PÁGINA DE TRÁFICO DEL CLIENTE (migración 322). Aquí NO está el ERP: quien llega es el cliente (o su agencia) con un enlace y una clave. No se indexa
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
  title: 'Tráfico y conversión · Liberty Seller',
  description: 'Sesiones, unidades, conversión y Buy Box de tu tienda en Amazon, al día.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default function LayoutDeTrafico({ children }: { children: React.ReactNode }) {
  return <div className={sora.variable}>{children}</div>
}
