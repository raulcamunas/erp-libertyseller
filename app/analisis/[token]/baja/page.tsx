import { notFound } from 'next/navigation'
import { analisisPorToken } from '@/lib/analisis-amazon/servidor'
import { BotonDeBaja } from './BotonDeBaja'

export const dynamic = 'force-dynamic'

/** LA BAJA DEL CORREO DEL ANÁLISIS: un botón y nada más. Abrir la página no da de baja (los antivirus abren todos los enlaces) */
export default async function Baja({ params }: { params: { token: string } }) {
  const a = await analisisPorToken(params.token)
  if (!a) notFound()
  return (
    <main style={{ minHeight: '100vh', background: '#080808', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'Inter, Arial, sans-serif' }}>
      <div style={{ maxWidth: 440, width: '100%', background: '#111214', border: '1px solid #23262B', borderRadius: 16, padding: 28 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logos/logo.png" alt="Liberty Seller" width={130} style={{ display: 'block', height: 'auto' }} />
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4, margin: '24px 0 8px' }}>Dejar de recibir correos</h1>
        <p style={{ color: '#A1A1AA', fontSize: 14.5, lineHeight: 1.6, margin: '0 0 20px' }}>
          No volveremos a escribir por correo a {a.informe?.vendedor?.nombre ?? 'su empresa'}. El análisis seguirá disponible en su enlace por si lo necesita.
        </p>
        <BotonDeBaja token={params.token} />
      </div>
    </main>
  )
}
