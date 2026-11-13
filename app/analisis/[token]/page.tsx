import { notFound } from 'next/navigation'
import { InformeAnalisis } from '@/components/analisis-amazon/InformeAnalisis'
import { InformeSinAmazon } from '@/components/analisis-amazon/InformeSinAmazon'
import { esSinAmazon } from '@/lib/analisis-sin-amazon/construir'
import { RegistrarApertura } from '@/components/analisis-amazon/RegistrarApertura'
import { analisisPorToken, contactoDelLead } from '@/lib/analisis-amazon/servidor'

/**
 * EL ANÁLISIS DE AMAZON DE UN LEAD, PÚBLICO. Dos clases: el de su cuenta de Amazon y, si no vende allí, el de su tienda (clase 'sin_amazon').
 * La credencial es el token de la dirección (largo y al azar, migración 303): da paso a UN informe y a nada más del ERP. Se lee en el
 * servidor con la clave de servicio; el navegador no habla con la base. La apertura la apunta RegistrarApertura (una vez por visita).
 */
export const dynamic = 'force-dynamic'

export default async function PaginaDelAnalisis({ params }: { params: { token: string } }) {
  const a = await analisisPorToken(params.token)
  if (!a) notFound()
  const contacto = await contactoDelLead(a.lead_id)
  return (
    <>
      {esSinAmazon(a.informe) ? <InformeSinAmazon informe={a.informe} contacto={contacto} /> : <InformeAnalisis informe={a.informe} contacto={contacto} />}
      <RegistrarApertura token={params.token} />
    </>
  )
}
