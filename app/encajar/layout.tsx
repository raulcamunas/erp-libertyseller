import type { Metadata } from 'next'
import localFont from 'next/font/local'

/**
 * LA ENVOLTURA DE LA PÁGINA PÚBLICA DEL ENCAJE.
 *
 * Aquí NO está el ERP —ni el menú, ni el tema oscuro, ni la sesión—: quien llega es un cliente con un
 * enlace. Solo trae la fuente de los titulares, que va guardada en el repositorio (app/fonts) por la
 * misma razón que Inter en el layout raíz: que ningún despliegue dependa de que Google conteste.
 *
 * NO SE INDEXA y no manda a ningún sitio de dónde viene: la dirección lleva el token, que es la
 * credencial, y no tiene que acabar en un buscador ni en la cabecera Referer de nada.
 */
const sora = localFont({
  src: '../fonts/Sora-SemiBold.ttf',
  weight: '600',
  variable: '--font-sora',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
})

export const metadata: Metadata = {
  title: 'Encaja tu envío · Liberty Seller',
  description: 'Reparte las unidades de tu envío en cajas.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default function LayoutDeEncaje({ children }: { children: React.ReactNode }) {
  return <div className={sora.variable}>{children}</div>
}
