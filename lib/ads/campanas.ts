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
  const puja = c.dynamicBidding as { strategy?: string } | undefined

  return {
    campaignId: String(c.campaignId ?? ''),
    nombre: (c.name as string) ?? '(sin nombre)',
    estado: ((c.state as string) ?? 'PAUSED').toUpperCase() as EstadoCampana,
    segmentacion: (c.targetingType as 'AUTO' | 'MANUAL' | undefined) ?? null,
    presupuesto: typeof presupuesto?.budget === 'number' ? presupuesto.budget : null,
    presupuestoTipo: presupuesto?.budgetType ?? null,
    estrategiaPuja: puja?.strategy ?? null,
    inicio: (c.startDate as string) ?? null,
    fin: (c.endDate as string) ?? null,
    crudo: c,
  }
}
