import type { Metadata } from 'next'

/** La página pública del análisis de Amazon de un lead: sin buscadores, sin decir de dónde viene quien entra */
export const metadata: Metadata = {
  title: 'Tu análisis de Amazon · Liberty Seller',
  description: 'Lo que dicen los datos públicos de Amazon sobre tu marca.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default function LayoutDelAnalisis({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
