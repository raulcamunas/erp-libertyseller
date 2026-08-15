/**
 * MARKETING API · DÓNDE ESTÁ AMAZON ADS Y CON QUÉ CREDENCIALES
 * ===========================================================
 * SOLO SERVIDOR. Aquí se leen `AMAZON_ADS_CLIENT_ID` y `AMAZON_ADS_CLIENT_SECRET`.
 *
 *
 * ============ LAS URL DE LA DOCUMENTACIÓN SON LAS DE EEUU ============
 *
 * Y esto se lleva un día entero si no se sabe. La documentación de Amazon Ads
 * enseña `www.amazon.com/ap/oa`, `api.amazon.com/auth/o2/token` y
 * `advertising-api.amazon.com`. Son las de Norteamérica.
 *
 * Con un cliente europeo, esas URL hacen algo peor que fallar: la autorización
 * PARECE FUNCIONAR —Amazon devuelve un `code` y hasta un refresh token— y
 * después TODAS las llamadas contestan 401 sin decir por qué. El token es bueno,
 * pero para otra región.
 *
 * Por eso la región no es un ajuste con valor por defecto escondido: viaja con
 * cada conexión, está en la tabla, y de ella salen las tres URL a la vez. Las
 * tres o ninguna: mezclar el login de una con la API de otra da el mismo 401.
 */

export type RegionAds = 'eu' | 'na' | 'fe'

interface EndpointsAds {
  /** Donde se manda al usuario a autorizar */
  autorizar: string
  /** Donde se canjea el código y se renueva el access token */
  token: string
  /** La API en sí */
  api: string
  etiqueta: string
}

export const ENDPOINTS: Record<RegionAds, EndpointsAds> = {
  eu: {
    autorizar: 'https://eu.account.amazon.com/ap/oa',
    token: 'https://api.amazon.co.uk/auth/o2/token',
    api: 'https://advertising-api-eu.amazon.com',
    etiqueta: 'Europa',
  },
  na: {
    autorizar: 'https://www.amazon.com/ap/oa',
    token: 'https://api.amazon.com/auth/o2/token',
    api: 'https://advertising-api.amazon.com',
    etiqueta: 'Norteamérica',
  },
  fe: {
    autorizar: 'https://apac.account.amazon.com/ap/oa',
    token: 'https://api.amazon.co.jp/auth/o2/token',
    api: 'https://advertising-api-fe.amazon.com',
    etiqueta: 'Extremo Oriente',
  },
}

/**
 * El permiso que se pide.
 *
 * `advertising::campaign_management` es el único que Amazon ha aprobado para
 * esta cuenta, y cubre lo que hace falta: campañas, grupos, keywords, product
 * ads, los informes de la v3 y el listado de perfiles. Fuera quedan DSP,
 * Marketing Cloud y audiencias, que son scopes aparte y se piden por separado.
 */
export const SCOPE_ADS = 'advertising::campaign_management'

/**
 * La dirección de vuelta.
 *
 * TIENE QUE COINCIDIR LETRA POR LETRA con una de las «Allowed Return URLs» de
 * la aplicación en la consola de Login with Amazon. Si sobra una barra al final
 * o cambia http por https, Amazon corta ANTES de enseñar la pantalla de
 * autorización, con un error que no menciona la URL.
 *
 * Se lee del entorno para que producción y local puedan ser distintas sin tocar
 * código, pero el valor por defecto es el de producción: una variable que falta
 * no puede convertirse en un callback a localhost en el servidor de verdad.
 */
export function urlDeVuelta(): string {
  return (
    process.env.AMAZON_ADS_REDIRECT_URI?.trim() ||
    'https://app.libertyseller.com/api/ads/callback'
  )
}

export function credenciales(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.AMAZON_ADS_CLIENT_ID?.trim()
  const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

/** Para que la pantalla pueda decir «falta configurar» en vez de fallar al pulsar */
export function faltaConfigurar(): string | null {
  if (!credenciales()) {
    return (
      'El servidor no tiene configuradas las credenciales de Amazon Ads ' +
      '(AMAZON_ADS_CLIENT_ID y AMAZON_ADS_CLIENT_SECRET). Sin ellas no se puede conectar ninguna cuenta.'
    )
  }
  return null
}
