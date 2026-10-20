import { EncajeCliente } from '@/components/encaje/EncajeCliente'
import { EnlaceNoValido } from '@/components/encaje/EnlaceNoValido'
import { TEXTO_DE_ENLACE_NO_VALIDO, anotarApertura, datosParaEncajar, resolverEnlace } from '@/lib/fba/encaje-enlace'

/**
 * LA PÁGINA DEL CLIENTE: ABRIR EL ENLACE Y VER SU ENVÍO.
 *
 * Se resuelve en el servidor: el token se comprueba aquí y a la pantalla solo llegan los datos de ESE
 * envío (qué referencias, cuántas unidades y qué lleva ya encajado). Un enlace inventado, desactivado
 * o caducado enseña una pantalla que dice qué hacer y nada de lo que hay detrás.
 *
 * Cada apertura se anota —cuántas veces y cuándo— para que la agencia sepa si el cliente ha llegado a
 * mirarlo. Si anotarlo falla, la página sale igual.
 */
export const dynamic = 'force-dynamic'

export default async function PaginaDeEncaje({ params }: { params: { token: string } }) {
  const r = await resolverEnlace(params.token)
  if (!r.ok) return <EnlaceNoValido texto={TEXTO_DE_ENLACE_NO_VALIDO[r.motivo]} />

  await anotarApertura(r.enlace)
  const datos = await datosParaEncajar(r)
  return <EncajeCliente token={params.token} inicial={datos} />
}
