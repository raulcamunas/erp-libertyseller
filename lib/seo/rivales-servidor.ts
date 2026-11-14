/**
 * SEO · LA COMPETENCIA QUE SE SIGUE CADA DÍA. SOLO SERVIDOR. Solo LEE de Amazon.
 *
 *   · alta / baja de ASIN rivales por producto (a mano, desde el Top 3 de Brand Analytics o desde las columnas del Cerebro multi-ASIN).
 *   · fotografiarCompetencia(): el proceso `seo-competencia` (cada hora) hace la foto del día de los rivales que aún no la tienen, con PRESUPUESTO:
 *       - Catalog Items (2 por segundo, 20 ASIN por llamada): todos los que quepan en el tiempo.
 *       - getItemOffersBatch (UNA cada 10 segundos, 20 ASIN): como mucho MAX_LLAMADAS_OFERTAS por pasada; los que no entran heredan el precio de la foto
 *         anterior y se piden en la pasada siguiente. Si la cuenta no tiene el rol de precios (403), se deja de pedir en esa cuenta durante el proceso.
 *     El cupo es por vendedor y aplicación: se usan las credenciales de la cuenta dueña del producto.
 *   · Compara con la foto anterior (lib/seo/rivales.ts) y apunta los cambios: la línea de tiempo por rival y el feed «esta semana».
 */

import { createServiceClient } from '@/lib/supabase/service'
import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError } from '@/lib/amazon/errors'
import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { cambiosEntreFotos, completarConAnterior, fotoDeItemCatalogo, hashDeFoto, ofertasDeRespuesta, type CambioRival, type CampoRival, type FotoRival, type RankRival } from './rivales'

export interface Rival {
  id: string
  asinRival: string
  asinPropio: string | null
  nombre: string | null
  origen: 'manual' | 'top_terms' | 'cerebro'
  activo: boolean
  fotoAt: string | null
  error: string | null
  ultima: (FotoRival & { fecha: string }) | null
  /** Las fotos de los últimos 30 días, para la línea del precio y el BSR */
  serie: Array<{ fecha: string; precio: number | null; bsr: number | null }>
}

export interface CambioGuardado {
  id: string
  competidorId: string
  asinRival: string
  nombre: string | null
  fecha: string
  detectadoAt: string
  campo: CampoRival
  antes: unknown
  despues: unknown
  magnitud: number
  resumen: string | null
}

type Cuenta = { connectionId: string; marketplaceId: string }

const fotoDeFila = (r: Record<string, unknown>): FotoRival & { fecha: string } => ({
  fecha: String(r.fecha),
  titulo: (r.titulo as string | null) ?? null,
  bullets: (r.bullets as string[]) ?? [],
  imagenes: (r.imagenes as string[]) ?? [],
  marca: (r.marca as string | null) ?? null,
  bsr: (r.bsr as RankRival[]) ?? [],
  precio: r.precio == null ? null : Number(r.precio),
  moneda: (r.moneda as string | null) ?? null,
  buyboxVendedor: (r.buybox_vendedor as string | null) ?? null,
  ofertas: (r.ofertas as number | null) ?? null,
})

const COLUMNAS_FOTO = 'competidor_id, fecha, titulo, bullets, imagenes, marca, bsr, precio, moneda, buybox_vendedor, ofertas'

/** Los rivales de una cuenta con su última foto y la serie de 30 días. null si falta la migración 312 */
export async function rivalesDe(c: Cuenta): Promise<{ rivales: Rival[]; cambios: CambioGuardado[] } | null> {
  const service = createServiceClient()
  const { data, error } = await service.from('seo_competidores').select('id, asin_rival, asin_propio, nombre, origen, activo, foto_at, error').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).order('created_at', { ascending: true }).limit(300)
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  const filas = (data ?? []) as Array<Record<string, unknown>>
  const ids = filas.map((f) => String(f.id))
  const fotos = new Map<string, Array<FotoRival & { fecha: string }>>()
  const desde = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10)
  for (let i = 0; i < ids.length; i += 100) {
    const { data: fs, error: e } = await service.from('seo_competidores_fotos').select(COLUMNAS_FOTO).in('competidor_id', ids.slice(i, i + 100)).gte('fecha', desde).order('fecha', { ascending: true }).limit(5000)
    if (e) throw e
    for (const f of (fs ?? []) as Array<Record<string, unknown>>) {
      const k = String(f.competidor_id)
      const lista = fotos.get(k) ?? []
      lista.push(fotoDeFila(f))
      fotos.set(k, lista)
    }
  }
  const rivales: Rival[] = filas.map((f) => {
    const lista = fotos.get(String(f.id)) ?? []
    return {
      id: String(f.id),
      asinRival: String(f.asin_rival),
      asinPropio: (f.asin_propio as string | null) ?? null,
      nombre: (f.nombre as string | null) ?? null,
      origen: f.origen as Rival['origen'],
      activo: Boolean(f.activo),
      fotoAt: (f.foto_at as string | null) ?? null,
      error: (f.error as string | null) ?? null,
      ultima: lista[lista.length - 1] ?? null,
      serie: lista.map((x) => ({ fecha: x.fecha, precio: x.precio, bsr: (x.bsr.find((b) => b.tipo === 'grupo') ?? x.bsr[0])?.rank ?? null })),
    }
  })
  const porId = new Map(rivales.map((r) => [r.id, r]))
  const cambios: CambioGuardado[] = []
  if (ids.length > 0) {
    const { data: cs, error: e } = await service.from('seo_competidores_cambios').select('id, competidor_id, fecha, detectado_at, campo, antes, despues, magnitud, resumen').in('competidor_id', ids.slice(0, 300)).order('detectado_at', { ascending: false }).limit(300)
    if (e) throw e
    for (const x of (cs ?? []) as Array<Record<string, unknown>>) {
      const r = porId.get(String(x.competidor_id))
      cambios.push({ id: String(x.id), competidorId: String(x.competidor_id), asinRival: r?.asinRival ?? '', nombre: r?.nombre ?? r?.ultima?.titulo ?? null, fecha: String(x.fecha), detectadoAt: String(x.detectado_at), campo: x.campo as CampoRival, antes: x.antes, despues: x.despues, magnitud: Number(x.magnitud ?? 0), resumen: (x.resumen as string | null) ?? null })
    }
  }
  return { rivales, cambios }
}

const MAX_RIVALES_POR_CUENTA = 150

export async function altaRivales(c: Cuenta, e: { asins: string[]; asinPropio: string | null; origen: Rival['origen']; userId: string }): Promise<number> {
  const service = createServiceClient()
  const { count } = await service.from('seo_competidores').select('id', { count: 'exact', head: true }).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId)
  const caben = Math.max(0, MAX_RIVALES_POR_CUENTA - (count ?? 0))
  if (caben === 0) throw new Error(`Esta cuenta ya sigue ${MAX_RIVALES_POR_CUENTA} ASIN de la competencia: quita alguno antes.`)
  const filas = [...new Set(e.asins)].slice(0, caben).map((a) => ({ connection_id: c.connectionId, marketplace_id: c.marketplaceId, asin_rival: a, asin_propio: e.asinPropio, origen: e.origen, activo: true, created_by: e.userId }))
  if (filas.length === 0) return 0
  const { data, error } = await service.from('seo_competidores').upsert(filas, { onConflict: 'connection_id,marketplace_id,asin_rival', ignoreDuplicates: true }).select('id')
  if (error) throw error
  return (data ?? []).length
}

export async function bajaRival(c: Cuenta, id: string): Promise<void> {
  const { error } = await createServiceClient().from('seo_competidores').delete().eq('id', id).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId)
  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* La foto diaria                                                      */
/* ------------------------------------------------------------------ */

/** Llamadas de ofertas por pasada (cada una espera 10 s por el cupo de Amazon): 3 → 60 ASIN con precio por pasada, ~30 s */
export const MAX_LLAMADAS_OFERTAS = 3
const sinRolDePrecios = new Set<string>()

async function leerCatalogo(creds: AmazonCredentials, marketplaceId: string, asins: string[]): Promise<Map<string, ReturnType<typeof fotoDeItemCatalogo>>> {
  const { data } = await spApiRequest<{ items?: Array<Record<string, unknown>> }>(creds, 'searchCatalogItems', {
    method: 'GET',
    path: '/catalog/2022-04-01/items',
    query: { identifiers: asins, identifiersType: 'ASIN', marketplaceIds: [marketplaceId], includedData: ['attributes', 'images', 'salesRanks', 'summaries'], pageSize: 20 },
  })
  const salida = new Map<string, ReturnType<typeof fotoDeItemCatalogo>>()
  for (const item of data.items ?? []) if (typeof item.asin === 'string') salida.set(item.asin, fotoDeItemCatalogo(item, marketplaceId))
  return salida
}

async function leerOfertas(creds: AmazonCredentials, marketplaceId: string, asins: string[]): Promise<Map<string, ReturnType<typeof ofertasDeRespuesta>>> {
  const { data } = await spApiRequest<{ responses?: Array<{ status?: { statusCode?: number }; body?: unknown; request?: { uri?: string } }> }>(creds, 'getItemOffersBatch', {
    method: 'POST',
    path: '/batches/products/pricing/v0/itemOffers',
    body: { requests: asins.map((a) => ({ uri: `/products/pricing/v0/items/${a}/offers`, method: 'GET', MarketplaceId: marketplaceId, ItemCondition: 'New', CustomerType: 'Consumer' })) },
    repeatable: true,
    maxAttempts: 2,
  })
  const salida = new Map<string, ReturnType<typeof ofertasDeRespuesta>>()
  for (const r of data.responses ?? []) {
    if ((r.status?.statusCode ?? 200) >= 300) continue
    const o = ofertasDeRespuesta(r.body)
    const asin = o.asin ?? r.request?.uri?.match(/items\/([A-Z0-9]{10})\//)?.[1] ?? null
    if (asin) salida.set(asin, o)
  }
  return salida
}

const hoy = () => new Date().toISOString().slice(0, 10)

/**
 * UNA PASADA del seguimiento diario. Fotografía a los rivales activos sin foto de hoy, cuenta por cuenta, hasta que se acaba el tiempo. Devuelve el
 * resumen para el registro de procesos. `soloCuenta`: desde la pantalla («Actualizar ahora»), solo esa cuenta y como mucho 40 rivales.
 */
export async function fotografiarCompetencia(presupuestoMs: number, soloCuenta?: Cuenta): Promise<{ fotos: number; cambios: number; cuentas: number; pendientes: number; errores: string[] }> {
  const arranque = Date.now()
  const service = createServiceClient()
  const inicioDelDia = `${hoy()}T00:00:00Z`
  let q = service.from('seo_competidores').select('id, connection_id, marketplace_id, asin_rival, foto_at').eq('activo', true).or(`foto_at.is.null,foto_at.lt."${inicioDelDia}"`).order('foto_at', { ascending: true, nullsFirst: true }).limit(soloCuenta ? 40 : 600)
  if (soloCuenta) q = q.eq('connection_id', soloCuenta.connectionId).eq('marketplace_id', soloCuenta.marketplaceId)
  const { data, error } = await q
  if (error) throw error
  const pendientes = (data ?? []) as Array<{ id: string; connection_id: string; marketplace_id: string; asin_rival: string }>
  const grupos = new Map<string, typeof pendientes>()
  for (const p of pendientes) grupos.set(`${p.connection_id}|${p.marketplace_id}`, [...(grupos.get(`${p.connection_id}|${p.marketplace_id}`) ?? []), p])

  let fotos = 0
  let cambios = 0
  let llamadasOfertas = 0
  const errores: string[] = []
  for (const [clave, lista] of grupos) {
    if (Date.now() - arranque > presupuestoMs) break
    const [connectionId, marketplaceId] = clave.split('|')
    const resuelta = await connectionCredentials(connectionId)
    if (!resuelta) continue
    const creds = resuelta.credentials
    for (let i = 0; i < lista.length; i += 20) {
      if (Date.now() - arranque > presupuestoMs) break
      const tanda = lista.slice(i, i + 20)
      const asins = tanda.map((t) => t.asin_rival)
      try {
        const catalogo = await leerCatalogo(creds, marketplaceId, asins)
        let ofertas = new Map<string, ReturnType<typeof ofertasDeRespuesta>>()
        const conOfertas = llamadasOfertas < MAX_LLAMADAS_OFERTAS && !sinRolDePrecios.has(connectionId)
        if (conOfertas) {
          llamadasOfertas++
          ofertas = await leerOfertas(creds, marketplaceId, asins).catch((e) => {
            if (e instanceof AmazonApiError && e.kind === 'permisos') sinRolDePrecios.add(connectionId)
            else console.error('SEO competencia: ofertas:', e instanceof Error ? e.message : e)
            return new Map()
          })
        }
        const r = await guardarFotos(tanda, catalogo, ofertas, conOfertas && ofertas.size > 0)
        fotos += r.fotos
        cambios += r.cambios
      } catch (e) {
        const texto = e instanceof AmazonApiError ? (e.humanMessage ?? e.message) : e instanceof Error ? e.message : 'error desconocido'
        errores.push(texto.slice(0, 120))
        // Se apunta el error y la hora: no se reintenta en bucle dentro del mismo día
        await service.from('seo_competidores').update({ error: texto.slice(0, 300), foto_at: new Date().toISOString() }).in('id', tanda.map((t) => t.id))
        if (!(e instanceof AmazonApiError)) throw e
      }
    }
  }
  return { fotos, cambios, cuentas: grupos.size, pendientes: Math.max(0, pendientes.length - fotos), errores }
}

async function guardarFotos(tanda: Array<{ id: string; asin_rival: string }>, catalogo: Map<string, ReturnType<typeof fotoDeItemCatalogo>>, ofertas: Map<string, ReturnType<typeof ofertasDeRespuesta>>, conOfertas: boolean): Promise<{ fotos: number; cambios: number }> {
  const service = createServiceClient()
  const fecha = hoy()
  const ids = tanda.map((t) => t.id)
  // La foto anterior de cada uno (la más reciente antes de hoy)
  const { data: previas } = await service.from('seo_competidores_fotos').select(`${COLUMNAS_FOTO}, hash`).in('competidor_id', ids).lt('fecha', fecha).order('fecha', { ascending: false }).limit(ids.length * 5)
  const anterior = new Map<string, FotoRival>()
  for (const p of (previas ?? []) as Array<Record<string, unknown>>) if (!anterior.has(String(p.competidor_id))) anterior.set(String(p.competidor_id), fotoDeFila(p))

  let fotos = 0
  let cambios = 0
  const ahora = new Date().toISOString()
  for (const t of tanda) {
    const cat = catalogo.get(t.asin_rival)
    if (!cat) {
      await service.from('seo_competidores').update({ foto_at: ahora, error: 'Amazon no devuelve este ASIN en este país (retirado o mal escrito).' }).eq('id', t.id)
      continue
    }
    const of = ofertas.get(t.asin_rival)
    const previa = anterior.get(t.id) ?? null
    const foto = completarConAnterior({ ...cat, precio: of?.precio ?? null, moneda: of?.moneda ?? null, buyboxVendedor: of?.buyboxVendedor ?? null, ofertas: of?.ofertas ?? null }, previa, conOfertas && !!of)
    const { error } = await service.from('seo_competidores_fotos').upsert({ competidor_id: t.id, fecha, titulo: foto.titulo, bullets: foto.bullets, imagenes: foto.imagenes, marca: foto.marca, bsr: foto.bsr, precio: foto.precio, moneda: foto.moneda, buybox_vendedor: foto.buyboxVendedor, ofertas: foto.ofertas, fuente: 'sp-api', hash: hashDeFoto(foto) }, { onConflict: 'competidor_id,fecha' })
    if (error) throw error
    fotos++
    const lista: CambioRival[] = cambiosEntreFotos(previa, foto)
    if (lista.length > 0) {
      const { error: e2 } = await service.from('seo_competidores_cambios').upsert(lista.map((x) => ({ competidor_id: t.id, fecha, campo: x.campo, antes: x.antes as never, despues: x.despues as never, magnitud: x.magnitud, resumen: x.resumen.slice(0, 400) })), { onConflict: 'competidor_id,fecha,campo', ignoreDuplicates: true })
      if (e2) throw e2
      cambios += lista.length
    }
    await service.from('seo_competidores').update({ foto_at: ahora, error: null, ...(foto.titulo ? { nombre: foto.titulo.slice(0, 200) } : {}) }).eq('id', t.id)
  }
  // Lo de más de 120 días no hace falta: las fotos son para comparar y para la línea de 30 días
  await service.from('seo_competidores_fotos').delete().in('competidor_id', ids).lt('fecha', new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10))
  return { fotos, cambios }
}

/** ¿Hay algo que fotografiar hoy? Una consulta pequeña: el proceso contesta enseguida si no */
export async function hayCompetenciaPendiente(): Promise<boolean> {
  const { data, error } = await createServiceClient().from('seo_competidores').select('id').eq('activo', true).or(`foto_at.is.null,foto_at.lt."${hoy()}T00:00:00Z"`).limit(1)
  if (error) {
    if (isMissingSchema(error)) return false
    throw error
  }
  return (data ?? []).length > 0
}
