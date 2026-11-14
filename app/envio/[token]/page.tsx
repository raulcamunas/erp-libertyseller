import { headers } from 'next/headers'
import { EnlaceNoValido } from '@/components/encaje/EnlaceNoValido'
import { PortalCliente } from '@/components/portal/PortalCliente'
import { TEXTO_DE_ENLACE_NO_VALIDO, anotarApertura, datosParaEncajar, resolverEnlace } from '@/lib/fba/encaje-enlace'
import { datosDelPortal } from '@/lib/fba/portal'

/**
 * EL PORTAL DEL CLIENTE: UN ENLACE POR ENVÍO, CUATRO FASES.
 *
 * Propuesta → Etiquetas → Cajas → Envío. Se resuelve en el servidor: el token se comprueba aquí y a la
 * pantalla solo llegan los datos de ESE envío. La fase «Cajas» es el encaje de siempre (EncajeCliente), con
 * las fases del portal encima. Un enlace que no vale enseña qué hacer y nada de lo que hay detrás.
 */
export const dynamic = 'force-dynamic'

export default async function PortalDelEnvio({ params }: { params: { token: string } }) {
  const r = await resolverEnlace(params.token)
  if (!r.ok) return <EnlaceNoValido texto={TEXTO_DE_ENLACE_NO_VALIDO[r.motivo]} />

  const h = headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || null
  await anotarApertura(r.enlace, undefined, undefined, ip)

  const datos = await datosDelPortal(r)
  // El encaje solo se carga cuando toca: en propuesta o etiquetas no hay cajas que enseñar
  const encaje = ['encajando', 'lista', 'enviada', 'cerrada'].includes(r.remesa.estado) ? await datosParaEncajar(r) : null
  return <PortalCliente token={params.token} inicial={datos} encaje={encaje} />
}
