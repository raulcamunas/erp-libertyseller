import type { Metadata } from 'next'
import localFont from 'next/font/local'

/**
 * LA ENVOLTURA DEL FORMULARIO PÚBLICO DE DATOS DE PAGO. Fuera del ERP: sin menú ni sesión. Como el encaje: NO se indexa y no manda la dirección
 * (que lleva el token) en la cabecera Referer a ningún sitio.
 */
const sora = localFont({
  src: '../fonts/Sora-SemiBold.ttf',
  weight: '600',
  variable: '--font-sora',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
})

export const metadata: Metadata = {
  title: 'Datos de pago · Liberty Seller',
  description: 'Envía tus datos bancarios para recibir tus pagos.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default function LayoutDeDatosDePago({ children }: { children: React.ReactNode }) {
  return <div className={sora.variable}>{children}</div>
}
