import type { AmazonServerData, SendChangesResult, SyncResult } from '@/lib/amazon/data'
import type {
  AmazonClient,
  AmazonConnection,
  AmazonListing,
  AmazonSubmission,
} from '@/lib/types/amazon'

/**
 * LO QUE HABLA LA PANTALLA CON /api/amazon.
 *
 * Se puede importar desde un componente de cliente: aquí no hay sesión, ni
 * cliente de Supabase, ni service_role. Solo `fetch`. Es la diferencia con
 * lib/amazon/api.ts y con lib/amazon/data.ts, que son sus gemelos de servidor y
 * NO se pueden tocar desde el navegador — data.ts descifra llaves de tiendas.
 *
 * POR QUÉ TODO VA POR RUTA DE API Y NO CONTRA SUPABASE
 * ---------------------------------------------------
 * Porque desde el navegador NO SE PUEDE. La migración 118 le retira a
 * `authenticated` cualquier permiso sobre amazon_connections y no le deja
 * ninguna política: la tabla lleva dentro las llaves de las tiendas de los
 * clientes, así que ni un admin la lee desde el navegador. Todo lo que toque
 * conexiones pasa por el servidor o no pasa.
 *
 * El tipo de la vista se toma prestado del módulo de servidor con `import
 * type`, que TypeScript borra al compilar: no queda ni un require en el paquete
 * del navegador, y a cambio la pantalla no puede desviarse de lo que la ruta
 * devuelve de verdad.
 */
export type AmazonView = AmazonServerData

/** Lo que devuelve cualquier escritura: la vista ya recargada, y lo suyo */
export interface AmazonMutation extends AmazonView {
  message?: string
  /** Alta de cliente */
  client?: AmazonClient
  /** Desconexión: cuántos cambios se han conservado en el historial */
  keptSubmissions?: number
}

/** El enlace de consentimiento recién generado */
export interface ConsentLinkResponse {
  url: string
  expiresAt: string
  /** La URI de vuelta que espera el ERP, para cotejarla con la del portal de Amazon */
  redirectUri: string | null
}

/**
 * El catálogo de una conexión en un país, tal y como lo devuelven
 * /api/amazon/catalog y /api/amazon/sync.
 *
 * Viene con la CONEXIÓN dentro, y no es relleno: es la fila recién releída, con
 * su `last_sync_at`, su `last_sync_error` y su estado. Sin ella, después de un
 * refresco la pantalla seguiría enseñando el «refrescado hace…» de antes de
 * pulsar el botón, y ese es justo el dato que se ha ido a mirar.
 */
export interface CatalogResponse {
  connection: AmazonConnection
  marketplaceId: string
  listings: AmazonListing[]
  submissions: AmazonSubmission[]
  /** id de perfil -> nombre de quien mandó cada cambio. El registro guarda un
      UUID, y un UUID no contesta «¿quién le tocó el precio a esto?» */
  authors: Record<string, string>
  fetchedAt: string
}

/** Lo mismo, más el detalle de lo que hizo el barrido contra Amazon */
export interface SyncResponse extends CatalogResponse {
  results: SyncResult[]
}

/** El resultado de un tramo de envío, con el registro ya actualizado */
export interface SendChangesResponse extends SendChangesResult {
  submissions: AmazonSubmission[]
  authors: Record<string, string>
}

export interface HistoryResponse {
  submissions: AmazonSubmission[]
  authors: Record<string, string>
  /** Cuántas se han pedido: si vuelven justo esas, hay más sin enseñar */
  limit: number
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Una escritura del módulo, con el error ya convertido en una frase que se
 * puede enseñar.
 *
 * Nunca lanza: quien llama pinta `error` en un toast y sigue. Un throw aquí
 * dejaría el botón girando para siempre, que es lo que pasa cuando el servidor
 * contesta con HTML —un 502 del proxy— y alguien hace `.json()` sin red.
 */
export async function postAmazon<T>(url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })

    const payload = (await res.json().catch(() => null)) as (T & { error?: string }) | null

    if (!res.ok) {
      return {
        ok: false,
        error:
          payload?.error ??
          'No se ha podido completar la operación. Vuelve a intentarlo y avisa si sigue fallando.',
      }
    }
    return { ok: true, data: payload as T }
  } catch {
    return { ok: false, error: 'No hay conexión con el servidor. Inténtalo otra vez.' }
  }
}
