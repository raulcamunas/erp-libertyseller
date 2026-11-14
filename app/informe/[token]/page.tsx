import { notFound } from 'next/navigation'
import { informePorToken } from '@/lib/cuentas/informes'
import { DocumentoInforme } from '@/components/cuentas/DocumentoInforme'
import { BotonImprimir } from '@/components/cuentas/BotonImprimir'

/**
 * EL INFORME DE UNA CUENTA, PARA SU CLIENTE. Público: la credencial es el token de la dirección (largo y al azar, migración 307), que abre ESE informe
 * y nada más del ERP. Se lee en el servidor con la clave de servicio. Solo se enseña lo ENVIADO: un borrador no se ve desde fuera aunque se tenga el enlace.
 */
export const dynamic = 'force-dynamic'

export default async function PaginaDelInforme({ params }: { params: { token: string } }) {
  const inf = await informePorToken(params.token).catch(() => null)
  if (!inf || inf.estado !== 'enviado') notFound()
  return (
    <main style={{ background: '#EDE6DC', minHeight: '100vh', padding: '24px 12px 48px' }}>
      <div className="no-imprimir" style={{ maxWidth: 820, margin: '0 auto 12px', display: 'flex', justifyContent: 'flex-end' }}>
        <BotonImprimir />
      </div>
      <DocumentoInforme d={inf.datos} lectura={inf.lectura} extra={inf.extra} />
    </main>
  )
}
