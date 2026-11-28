import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { connectionCredentials } from '@/lib/amazon/data'
import { leerOfertas, MAX_SKUS_OFERTAS } from '@/lib/plataforma/buybox/api'
import { leerLoteOfertas } from '@/lib/plataforma/buybox/lectura'
import { marketplaceDePais } from '../cuenta'
import { todasLasFilas } from '../paginar'
import { congelado, siguienteFila, tocaAvisar, type EstadoDeBuyBox, type FilaDeBuyBox } from './buybox-calculo'

/**
 * AMAZON ADS · EL AGENTE PPC: LEER LA BUY BOX DE LO ANUNCIADO (SOLO SERVIDOR). Las reglas están en buybox-calculo.ts.
 *
 * Lo llama vigilar (cada pocos minutos), pero cada ASIN se lee como mucho una vez por hora y no más de 40 por pasada (2 llamadas de 20 a
 * getListingOffersBatch, la misma que usa el módulo de Buy Box por la noche). Por SKU propio: el del país de la cuenta de Ads, preferiblemente FBA con stock.
 * Sin la migración 355, sin conexión de vendedor o sin permiso de precios: no hace nada y no congela nada (no se decide con un dato que no hay).
 */

const RELEER_MS = 60 * 60_000
const MAX_POR_PASADA = 40

type FilaBd = { asin: string; estado: string; sin_desde: string | null; recuperada_at: string | null; perdida_horas: number | null; avisada_at: string | null; leida_at: string }
const deBd = (r: FilaBd): FilaDeBuyBox => ({ asin: r.asin, estado: r.estado as EstadoDeBuyBox, sinDesde: r.sin_desde, recuperadaAt: r.recuperada_at, perdidaHoras: r.perdida_horas == null ? null : Number(r.perdida_horas), avisadaAt: r.avisada_at, leidaAt: r.leida_at })
const aBd = (perfilId: string, f: FilaDeBuyBox) => ({ perfil_id: perfilId, asin: f.asin, estado: f.estado, sin_desde: f.sinDesde, recuperada_at: f.recuperadaAt, perdida_horas: f.perdidaHoras, avisada_at: f.avisadaAt, leida_at: f.leidaAt })

/** Los ASIN congelados ahora (sin leer nada de Amazon). Sin la tabla, ninguno */
export async function congeladosPorBuyBox(perfilId: string, ahora = Date.now()): Promise<Map<string, string>> {
  const salida = new Map<string, string>()
  const { data, error } = await todasLasFilas<FilaBd>((x, y) => createServiceClient().from('ads_agente_buybox').select('asin, estado, sin_desde, recuperada_at, perdida_horas, avisada_at, leida_at').eq('perfil_id', perfilId).order('asin').range(x, y))
  if (error) {
    if (isMissingSchema(error)) return salida
    throw error
  }
  for (const r of (data ?? []) as FilaBd[]) {
    const c = congelado(deBd(r), ahora)
    if (c.congelado && c.porque) salida.set(r.asin.toUpperCase(), c.porque)
  }
  return salida
}

export interface ResultadoDeBuyBox {
  leidos: number
  /** Pérdidas de las que hay que avisar ahora (una por episodio) */
  perdidas: Array<{ asin: string; estado: EstadoDeBuyBox; porque: string }>
  /** Recuperadas en esta lectura */
  recuperadas: Array<{ asin: string; horas: number }>
  error: string | null
}

/** Lee la Buy Box de los ASIN anunciados que tocan (más de una hora sin leer) y guarda el estado. Nunca lanza */
export async function vigilarBuyBox(perfilId: string, anunciados: readonly string[], ahora = Date.now()): Promise<ResultadoDeBuyBox> {
  const r: ResultadoDeBuyBox = { leidos: 0, perdidas: [], recuperadas: [], error: null }
  try {
    const service = createServiceClient()
    const { data: previas, error: ePrevias } = await todasLasFilas<FilaBd>((x, y) => service.from('ads_agente_buybox').select('asin, estado, sin_desde, recuperada_at, perdida_horas, avisada_at, leida_at').eq('perfil_id', perfilId).order('asin').range(x, y))
    if (ePrevias) {
      if (isMissingSchema(ePrevias)) return r
      throw ePrevias
    }
    const previa = new Map(((previas ?? []) as FilaBd[]).map((x) => [x.asin.toUpperCase(), deBd(x)]))
    const tocan = anunciados
      .map((a) => a.toUpperCase())
      .filter((a) => {
        const p = previa.get(a)
        return !p || ahora - Date.parse(p.leidaAt) >= RELEER_MS
      })
      .sort((a, b) => Date.parse(previa.get(a)?.leidaAt ?? '1970-01-01') - Date.parse(previa.get(b)?.leidaAt ?? '1970-01-01'))
      .slice(0, MAX_POR_PASADA)
    if (tocan.length === 0) return r

    // El país de la cuenta de Ads → el marketplace y las conexiones de vendedor del cliente
    const { data: perfil, error: ePerfil } = await service.from('ads_profiles').select('pais, ads_connections(client_id)').eq('id', perfilId).maybeSingle()
    if (ePerfil) throw ePerfil
    const p = perfil as { pais: string | null; ads_connections: { client_id: string | null } | Array<{ client_id: string | null }> | null } | null
    const con = Array.isArray(p?.ads_connections) ? p?.ads_connections[0] : p?.ads_connections
    const mk = p?.pais ? marketplaceDePais(String(p.pais).toUpperCase()) : null
    if (!con?.client_id || !mk) return r
    const { data: conexiones, error: eCon } = await service.from('amazon_connections').select('id').eq('client_id', con.client_id).eq('is_active', true)
    if (eCon) throw eCon
    const ids = ((conexiones ?? []) as Array<{ id: string }>).map((c) => c.id)
    if (ids.length === 0) return r
    const { data: listings, error: eL } = await service.from('amazon_listings').select('connection_id, asin, sku, is_fba, fba_fulfillable_quantity, quantity').in('connection_id', ids).eq('marketplace_id', mk).in('asin', tocan).limit(2000)
    if (eL) throw eL
    // Un SKU por ASIN: FBA con stock primero, después cualquiera con stock, después el que sea
    const elegido = new Map<string, { conexion: string; sku: string; nota: number }>()
    for (const l of (listings ?? []) as Array<{ connection_id: string; asin: string | null; sku: string | null; is_fba: boolean | null; fba_fulfillable_quantity: number | null; quantity: number | null }>) {
      const asin = String(l.asin ?? '').toUpperCase()
      if (!asin || !l.sku) continue
      const nota = (l.is_fba && (l.fba_fulfillable_quantity ?? 0) > 0 ? 2 : 0) + ((l.quantity ?? 0) > 0 || (l.fba_fulfillable_quantity ?? 0) > 0 ? 1 : 0)
      const ya = elegido.get(asin)
      if (!ya || nota > ya.nota) elegido.set(asin, { conexion: l.connection_id, sku: l.sku, nota })
    }
    const porConexion = new Map<string, Array<{ asin: string; sku: string }>>()
    for (const [asin, e] of elegido) porConexion.set(e.conexion, [...(porConexion.get(e.conexion) ?? []), { asin, sku: e.sku }])

    const filas: FilaDeBuyBox[] = []
    for (const [conexion, lista] of porConexion) {
      const resuelta = await connectionCredentials(conexion)
      if (!resuelta?.credentials.sellingPartnerId) continue
      for (let i = 0; i < lista.length; i += MAX_SKUS_OFERTAS) {
        const trozo = lista.slice(i, i + MAX_SKUS_OFERTAS)
        const skus = trozo.map((x) => x.sku)
        const resp = await leerOfertas(resuelta.credentials, { marketplaceId: mk, skus })
        const lote = leerLoteOfertas(resp.datos, skus, { nuestroSellerId: resuelta.credentials.sellingPartnerId })
        for (const x of trozo) {
          const leido = (lote.porSku.get(x.sku)?.buybox ?? 'desconocido') as EstadoDeBuyBox
          const antes = previa.get(x.asin) ?? null
          const nueva = siguienteFila(antes, x.asin, leido, ahora)
          if (antes?.sinDesde && !nueva.sinDesde && nueva.perdidaHoras != null) r.recuperadas.push({ asin: x.asin, horas: nueva.perdidaHoras })
          if (tocaAvisar(nueva, ahora)) {
            r.perdidas.push({ asin: x.asin, estado: nueva.estado, porque: congelado(nueva, ahora).porque ?? '' })
            nueva.avisadaAt = new Date(ahora).toISOString()
          }
          filas.push(nueva)
          r.leidos++
        }
      }
    }
    // Los que siguen sin la Buy Box y no se han releído en esta pasada también pueden pasar de las 2 h: se avisa con lo guardado
    for (const [asin, f] of previa) {
      if (filas.some((x) => x.asin === asin) || !anunciados.some((a) => a.toUpperCase() === asin)) continue
      if (tocaAvisar(f, ahora)) {
        r.perdidas.push({ asin, estado: f.estado, porque: congelado(f, ahora).porque ?? '' })
        filas.push({ ...f, avisadaAt: new Date(ahora).toISOString() })
      }
    }
    if (filas.length > 0) {
      const { error } = await service.from('ads_agente_buybox').upsert(filas.map((f) => aBd(perfilId, f)), { onConflict: 'perfil_id,asin' })
      if (error) throw error
    }
  } catch (err) {
    r.error = err instanceof Error ? err.message : String(err)
    console.error(`[agente] Buy Box de ${perfilId}:`, r.error)
  }
  return r
}
