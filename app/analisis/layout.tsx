import type { Metadata } from 'next'

/** La página pública del análisis de Amazon de un lead: sin buscadores, sin decir de dónde viene quien entra */
export const metadata: Metadata = {
  title: 'Análisis de su cuenta de Amazon · Liberty Seller',
  description: 'Lo que dicen los datos públicos de su cuenta de Amazon.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default function LayoutDelAnalisis({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
