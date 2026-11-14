import type { Metadata } from 'next'

/** La página pública del informe de una cuenta para su cliente: sin buscadores, sin decir de dónde viene quien entra */
export const metadata: Metadata = {
  title: 'Informe de tu cuenta de Amazon · Liberty Seller',
  description: 'Cómo ha ido tu cuenta de Amazon en el periodo.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default function LayoutDelInforme({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
