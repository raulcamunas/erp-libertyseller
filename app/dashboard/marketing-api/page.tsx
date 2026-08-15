import { redirect } from 'next/navigation'

/**
 * MARKETING API YA NO ES UN MÓDULO DEL MENÚ.
 *
 * Su contenido —la conexión con Amazon Ads y qué cuentas de anunciante se
 * trabajan— es ahora la pestaña «Publicidad» de Amazon API. Es donde le toca
 * por la regla que separa los dos módulos de Amazon:
 *
 *     CONFIGURAR va en Amazon API. TRABAJAR va en Growth Partner.
 *
 * Autorizar una cuenta de publicidad y decidir qué perfiles se usan es
 * configurar, exactamente igual que conectar la cuenta de vendedor en «Cuentas»
 * o decir de dónde llega el fichero de stock en «Origen». Un módulo propio para
 * eso era una tercera puerta a la misma casa.
 *
 * La dirección se queda viva y redirige: estuvo en el menú y puede estar en un
 * marcador o en un enlace de esta conversación. Un 404 no explica nada.
 */
export const dynamic = 'force-dynamic'

export default function MarketingApiRedirect() {
  redirect('/dashboard/amazon-api?p=publicidad')
}
