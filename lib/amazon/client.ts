import type { AmazonServerData, SendChangesResult, SyncResult } from '@/lib/amazon/data'
import type { EstadoOrigen } from '@/lib/stock-sync/origenes/tipos'
import type { PerfilesView } from '@/lib/stock-sync/perfiles'
import type { PruebaPerfil, ResultadoProceso } from '@/lib/stock-sync/proceso'
import type {
  AmazonClient,
  AmazonConnection,
  AmazonListing,
  AmazonSubmission,
} from '@/lib/types/amazon'
import type { StockProfileRun, StockReadProfile } from '@/lib/types/stock-sync'

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

/* ------------------------------------------------------------------ */
/* Perfiles de lectura (la automatización)                             */
/* ------------------------------------------------------------------ */

/**
 * La vista de la pantalla de automatización.
 *
 * Igual que AmazonView: el tipo se toma prestado del módulo de servidor con
 * `import type`, que TypeScript borra al compilar. No queda ni un require de
 * lib/stock-sync/perfiles —que usa service_role— en el paquete del navegador, y
 * a cambio la pantalla no puede desviarse de lo que la ruta devuelve de verdad.
 */
export type PerfilesVista = PerfilesView

export interface PruebaResponse {
  prueba: PruebaPerfil
}

/**
 * El resultado del simulacro, con las listas ya recortadas por el servidor.
 * `recortado` dice cuáles se han quedado a medias: los totales del resumen son
 * siempre los de verdad, así que sin esta bandera una tabla cortada parecería
 * un catálogo pequeño.
 */
export interface SimulacroResponse extends ResultadoProceso {
  recortado: { filas: boolean; huerfanos: boolean; sinCasar: boolean }
}

export interface OrigenResponse {
  estado: EstadoOrigen
}

/**
 * El historial de un perfil.
 *
 * Trae el perfil RECIÉN LEÍDO además de las ejecuciones, y no es relleno: el
 * cerrojo, la hora de la última pasada y el «el fichero no ha cambiado» se
 * mueven solos cada quince minutos, así que si el perfil viniera de la vista
 * cargada al abrir la pantalla, la cabecera diría una cosa y la tabla de debajo
 * otra.
 */
export interface EjecucionesResponse {
  perfil: StockReadProfile
  runs: StockProfileRun[]
  /** Cuántas se han pedido: si vuelven justo esas, hay más sin enseñar */
  limite: number
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

/**
 * Las otras tres formas de llamar, con el mismo contrato: NUNCA lanzan y
 * devuelven un resultado discriminado.
 *
 * Están escritas aparte y no como un parámetro `method` de postAmazon porque la
 * de subir ficheros tiene una diferencia que no se puede olvidar (ver abajo), y
 * un parámetro opcional invita justo a olvidarla.
 */
export async function patchAmazon<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  return peticion<T>(url, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) })
}

/**
 * Una lectura.
 *
 * `cache: 'no-store'` no es opcional: sin él, refrescar el historial de un
 * perfil devolvería la respuesta que el navegador guardó hace diez minutos y la
 * pantalla enseñaría como «última ejecución» una que ya no lo es. Es
 * exactamente el dato que se está yendo a mirar.
 */
export async function getAmazon<T>(url: string): Promise<ApiResult<T>> {
  return peticion<T>(url, { method: 'GET', cache: 'no-store' })
}

export async function deleteAmazon<T>(url: string): Promise<ApiResult<T>> {
  return peticion<T>(url, { method: 'DELETE' })
}

/**
 * Sube ficheros con FormData.
 *
 * NO SE PONE Content-Type A MANO, y es lo único importante de esta función: el
 * navegador tiene que ponerlo él para incluir el `boundary` que separa las
 * partes. Fijándolo a 'multipart/form-data' a secas, el servidor recibe un
 * cuerpo que no sabe partir y contesta que no ha llegado ningún fichero.
 */
export async function subirAmazon<T>(url: string, form: FormData): Promise<ApiResult<T>> {
  return peticion<T>(url, { method: 'POST', body: form })
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function peticion<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init)
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
