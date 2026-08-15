/**
 * MARKETING · LAS CAMPAÑAS DE UNA CUENTA
 * ======================================
 * SOLO SERVIDOR.
 *
 * Se piden a Amazon EN VIVO y no se guardan. En esta fase es lo correcto: una
 * campaña cambia de estado y de presupuesto varias veces al día, y una copia en
 * la base sería una copia vieja en cuanto alguien tocara algo en Seller Central.
 * El día que haga falta histórico —para ver la evolución del presupuesto, por
 * ejemplo— se guardará eso, que es otra cosa distinta.
 */

import { llamarAds } from './datos'

/** El tipo de contenido de las campañas en la v3. Ver la nota de llamarAds() */
const TIPO_CAMPANA = 'application/vnd.spCampaign.v3+json'

/** Cuántas se piden por página. 500 es el máximo que admite Amazon */
const POR_PAGINA = 500

/** Tope de páginas, para que una cuenta enorme no cuelgue la pantalla */
const MAX_PAGINAS = 6

export type EstadoCampana = 'ENABLED' | 'PAUSED' | 'ARCHIVED'

export interface Campana {
  campaignId: string
  nombre: string
  estado: EstadoCampana
  /** AUTO = Amazon elige a quién enseñarla; MANUAL = lo eliges tú */
  segmentacion: 'AUTO' | 'MANUAL' | null
  presupuesto: number | null
  /** DAILY casi siempre. Amazon admite otros y conviene verlo */
  presupuestoTipo: string | null
  /** LEGACY_FOR_SALES | AUTO_FOR_SALES | MANUAL | RULE_BASED */
  estrategiaPuja: string | null
  /**
   * El ajuste de puja para el TOP DE BÚSQUEDAS, en tanto por ciento.
   *
   * Es el multiplicador que Amazon aplica cuando el anuncio va a salir arriba
   * del todo de los resultados: con 50, se puja un 50 % más por esa posición.
   * Es la palanca que más mueve el ACOS de una campaña y la que casi nadie
   * toca, porque en Seller Central está a tres clics de profundidad.
   *
   * null = no está puesto, que Amazon trata como 0.
   */
  topDeBusquedas: number | null
  inicio: string | null
  fin: string | null
  /** Lo que trae Amazon sin tocar, para lo que todavía no se sabe que hará falta */
  crudo: Record<string, unknown>
}

interface RespuestaCampanas {
  campaigns?: Array<Record<string, unknown>>
  totalResults?: number
  nextToken?: string
}

/**
 * Todas las campañas de una cuenta, paginadas.
 *
 * INCLUIDAS LAS PAUSADAS Y LAS ARCHIVADAS, a propósito y sin filtro por defecto.
 * Una campaña pausada es la mitad de la conversación con un cliente —«esto lo
 * paramos en marzo y no lo hemos vuelto a encender»— y una lista que solo
 * enseñara las activas haría creer que la cuenta es más pequeña de lo que es. El
 * filtro se pone en la pantalla, que es donde se decide qué mirar.
 */
export async function campanasDe(
  conexionId: string,
  profileId: number
): Promise<{ campanas: Campana[]; total: number; truncado: boolean }> {
  const campanas: Campana[] = []
  let token: string | undefined
  let total = 0
  let paginas = 0

  do {
    const res = await llamarAds<RespuestaCampanas>(conexionId, '/sp/campaigns/list', {
      perfilId: profileId,
      metodo: 'POST',
      cabeceras: { Accept: TIPO_CAMPANA, 'Content-Type': TIPO_CAMPANA },
      cuerpo: {
        maxResults: POR_PAGINA,
        ...(token ? { nextToken: token } : {}),
      },
    })

    total = res.totalResults ?? total
    for (const c of res.campaigns ?? []) campanas.push(interpretar(c))

    token = res.nextToken
    paginas++
  } while (token && paginas < MAX_PAGINAS)

  return {
    campanas,
    total: total || campanas.length,
    // Se DICE si se ha cortado. Una lista truncada en silencio se lee como una
    // cuenta pequeña, y de ahí salen decisiones sobre campañas que no se ven.
    truncado: Boolean(token),
  }
}

/**
 * De lo que manda Amazon a lo que enseña la pantalla.
 *
 * El presupuesto viene anidado (`budget.budget`) y con su tipo al lado; la
 * estrategia de puja también. Se aplanan aquí y no en el componente para que la
 * forma de la respuesta de Amazon esté en UN sitio: el día que la v3 cambie un
 * nombre, se toca esta función y nada más.
 */
function interpretar(c: Record<string, unknown>): Campana {
  const presupuesto = c.budget as { budget?: number; budgetType?: string } | undefined
  const puja = c.dynamicBidding as
    | {
        strategy?: string
        placementBidding?: Array<{ placement?: string; percentage?: number }>
      }
    | undefined

  // PLACEMENT_TOP es el top de búsquedas. Hay más —PLACEMENT_PRODUCT_PAGE,
  // PLACEMENT_REST_OF_SEARCH— y vienen en la misma lista, así que hay que
  // buscarlo por nombre y no coger el primero.
  const top = puja?.placementBidding?.find((p) => p.placement === 'PLACEMENT_TOP')

  return {
    campaignId: String(c.campaignId ?? ''),
    nombre: (c.name as string) ?? '(sin nombre)',
    estado: ((c.state as string) ?? 'PAUSED').toUpperCase() as EstadoCampana,
    segmentacion: (c.targetingType as 'AUTO' | 'MANUAL' | undefined) ?? null,
    presupuesto: typeof presupuesto?.budget === 'number' ? presupuesto.budget : null,
    presupuestoTipo: presupuesto?.budgetType ?? null,
    estrategiaPuja: puja?.strategy ?? null,
    topDeBusquedas: typeof top?.percentage === 'number' ? top.percentage : null,
    inicio: (c.startDate as string) ?? null,
    fin: (c.endDate as string) ?? null,
    crudo: c,
  }
}

/**
 * Cambia el ajuste de puja del top de búsquedas de una campaña.
 *
 * ESTO ESCRIBE EN LA CUENTA DEL CLIENTE Y GASTA SU DINERO. Subir este porcentaje
 * hace que cada clic desde la primera posición cueste más, y eso se ve en la
 * factura del mismo día.
 *
 * Se manda SOLO ese placement y no la lista entera de `placementBidding`: si se
 * mandara completa habría que reconstruir los otros ajustes —página de producto,
 * resto de la búsqueda— y cualquier despiste los pondría a cero sin que nadie lo
 * pidiera. Amazon acepta el ajuste suelto y deja los demás como estaban.
 */
export async function cambiarTopDeBusquedas(
  conexionId: string,
  profileId: number,
  campaignId: string,
  porcentaje: number
): Promise<void> {
  await llamarAds(conexionId, '/sp/campaigns', {
    perfilId: profileId,
    metodo: 'PUT',
    cabeceras: { Accept: TIPO_CAMPANA, 'Content-Type': TIPO_CAMPANA },
    cuerpo: {
      campaigns: [
        {
          campaignId,
          dynamicBidding: {
            placementBidding: [
              { placement: 'PLACEMENT_TOP', percentage: Math.round(porcentaje) },
            ],
          },
        },
      ],
    },
  })
}
