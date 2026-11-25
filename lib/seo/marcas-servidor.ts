/**
 * SEO · LAS MARCAS DE LA COMPETENCIA DE UNA CUENTA Y PAÍS. SOLO SERVIDOR. Migración 338 (sin ella: lista vacía y todo sigue como antes).
 *
 * `actualizarMarcas` las busca solas (lo llama el proceso horario `seo-competencia` y el botón «Buscar marcas ahora» de la pestaña Competencia):
 *   1. RIVALES: la marca de la última foto de cada competidor seguido (seo_competidores_fotos).
 *   2. CLICS: la marca, según el catálogo de Amazon, de los 3 productos que se llevan los clics en cada búsqueda de la cuenta (seo_top_terminos), menos los propios.
 *   3. IA: repasa las búsquedas de Brand Analytics de cada producto que aún no ha visto (seo_busquedas_marca) y dice, de cada una, si lleva una marca de la competencia
 *      (cuál), si es del producto o de otro. Con confianza ≥ 0,8 guarda la marca (origen 'ia') y la decisión «nuestra»/«ajena» como si fuera de una persona
 *      (seo_busquedas_decididas, `created_by` NULL), sin pisar nunca lo que haya decidido alguien. Así se arreglan también los «¿Ajena?» de la heurística que sí son del producto.
 * Lo nuevo se inserta sin pisar lo que haya: una marca desactivada a mano no vuelve.
 *
 * Coste de la IA: una llamada por producto con hasta 80 búsquedas nuevas (~0,001 $); cada búsqueda se repasa una sola vez.
 */

import OpenAI from 'openai'
import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { parametrosDeIa } from '@/lib/ia/modelo'
import { marcasDe } from '@/lib/productos/imagenes-servidor'
import { claveDeBusqueda } from './embudo'
import { claveDeMarca, esMarcaValida, marcaDelTitulo, type MarcaGuardada, type OrigenDeMarca } from './marcas'
import { consultasGuardadas, fichasGuardadas, productosSeguidos } from './datos'
import { enTrozos } from './paginar'

type Cuenta = { connectionId: string; marketplaceId: string }

export class FaltaMigracion338 extends Error {
  constructor() {
    super('Falta lanzar la migración 338 en Supabase para guardar las marcas de la competencia.')
  }
}

/** Todas las marcas guardadas de la cuenta y país (también las desactivadas). null sin la migración 338 */
export async function leerMarcas(c: Cuenta): Promise<MarcaGuardada[] | null> {
  const { data, error } = await createServiceClient().from('seo_marcas').select('marca, texto, origen, activa').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).order('texto').limit(5000)
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return ((data ?? []) as Array<{ marca: string; texto: string; origen: OrigenDeMarca; activa: boolean }>).map((r) => ({ clave: r.marca, texto: r.texto, origen: r.origen, activa: r.activa }))
}

/** Las marcas propias del cliente: la primera palabra del título de sus fichas */
export async function marcasPropias(c: Cuenta): Promise<string[]> {
  const fichas = await fichasGuardadas(c.connectionId, c.marketplaceId).catch(() => [])
  return [...new Set(fichas.map((f) => marcaDelTitulo(f.titulo)).filter((x): x is string => !!x))]
}

/** Las marcas que se usan para descartar búsquedas (activas, válidas y sin la propia), con la forma que espera el diagnóstico */
export async function marcasParaDiagnostico(c: Cuenta): Promise<Array<{ clave: string; texto: string; origen: OrigenDeMarca }>> {
  const [todas, propias] = await Promise.all([leerMarcas(c).catch(() => null), marcasPropias(c)])
  const suyas = new Set(propias)
  return (todas ?? []).filter((m) => m.activa && esMarcaValida(m.clave) && !suyas.has(m.clave)).map((m) => ({ clave: m.clave, texto: m.texto, origen: m.origen }))
}

async function insertarNuevas(c: Cuenta, marcas: Array<{ texto: string; origen: OrigenDeMarca }>, propias: ReadonlySet<string>): Promise<number> {
  const filas = new Map<string, Record<string, unknown>>()
  for (const m of marcas) {
    const clave = claveDeMarca(m.texto)
    if (!esMarcaValida(clave) || propias.has(clave) || filas.has(clave)) continue
    filas.set(clave, { connection_id: c.connectionId, marketplace_id: c.marketplaceId, marca: clave, texto: m.texto.trim().slice(0, 80), origen: m.origen, activa: true })
  }
  if (filas.size === 0) return 0
  const { data, error } = await createServiceClient().from('seo_marcas').upsert([...filas.values()], { onConflict: 'connection_id,marketplace_id,marca', ignoreDuplicates: true }).select('marca')
  if (error) {
    if (isMissingSchema(error)) throw new FaltaMigracion338()
    throw error
  }
  return (data ?? []).length
}

/** Una marca a mano (o reactivar una desactivada) */
export async function anadirMarca(c: Cuenta, texto: string, userId: string): Promise<void> {
  const clave = claveDeMarca(texto)
  if (!esMarcaValida(clave)) throw new Error('Eso no parece una marca: al menos 3 letras y nada genérico.')
  const { error } = await createServiceClient()
    .from('seo_marcas')
    .upsert({ connection_id: c.connectionId, marketplace_id: c.marketplaceId, marca: clave, texto: texto.trim().slice(0, 80), origen: 'manual', activa: true, created_by: userId, created_at: new Date().toISOString() }, { onConflict: 'connection_id,marketplace_id,marca' })
  if (error) {
    if (isMissingSchema(error)) throw new FaltaMigracion338()
    throw error
  }
}

/** «No es una marca de la competencia»: se desactiva (y no vuelve a añadirse sola). Las puestas a mano se borran */
export async function quitarMarca(c: Cuenta, clave: string): Promise<void> {
  const service = createServiceClient()
  const { data, error } = await service.from('seo_marcas').select('origen').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('marca', clave).maybeSingle()
  if (error) {
    if (isMissingSchema(error)) throw new FaltaMigracion338()
    throw error
  }
  if (!data) return
  const r =
    (data as { origen: string }).origen === 'manual'
      ? await service.from('seo_marcas').delete().eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('marca', clave)
      : await service.from('seo_marcas').update({ activa: false }).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('marca', clave)
  if (r.error) throw r.error
}

/* ------------------------------------------------------------------ */
/* La búsqueda automática                                              */

async function marcasDeRivales(c: Cuenta): Promise<string[]> {
  const service = createServiceClient()
  const { data, error } = await service.from('seo_competidores').select('id').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).limit(500)
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
  const marcas = new Set<string>()
  for (const lote of enTrozos(ids, 50)) {
    const { data: fotos, error: e } = await service.from('seo_competidores_fotos').select('marca').in('competidor_id', lote).not('marca', 'is', null).order('fecha', { ascending: false }).limit(2000)
    if (e) throw e
    for (const f of (fotos ?? []) as Array<{ marca: string | null }>) if (f.marca?.trim()) marcas.add(f.marca.trim())
  }
  return [...marcas]
}

async function marcasDeLosClics(c: Cuenta, propios: ReadonlySet<string>): Promise<string[]> {
  const service = createServiceClient()
  const { data: ultimo, error } = await service.from('seo_top_terminos').select('desde').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('periodo', 'WEEK').order('desde', { ascending: false }).limit(1)
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  const desde = ((ultimo ?? []) as Array<{ desde: string }>)[0]?.desde
  if (!desde) return []
  const { data, error: e } = await service.from('seo_top_terminos').select('asin').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('periodo', 'WEEK').eq('desde', desde).limit(5000)
  if (e) throw e
  const asins = [...new Set(((data ?? []) as Array<{ asin: string }>).map((r) => r.asin.toUpperCase()))].filter((a) => !propios.has(a)).slice(0, 400)
  if (asins.length === 0) return []
  const marcas = await marcasDe(c.marketplaceId, asins, { connectionId: c.connectionId })
  return [...new Set(Object.values(marcas).filter((m): m is string => !!m))]
}

const CONFIANZA = 0.8
const MAX_POR_LLAMADA = 80

/** La IA repasa las búsquedas aún no vistas de un producto. Devuelve cuántas ha repasado */
async function repasarConIa(c: Cuenta, asin: string, producto: { titulo: string | null; bullets: readonly string[] }, consultas: readonly string[], propias: ReadonlySet<string>): Promise<number> {
  const claveIa = process.env.OPENAI_API_KEY?.trim()
  if (!claveIa || !producto.titulo || consultas.length === 0) return 0
  const lista = consultas.slice(0, MAX_POR_LLAMADA)
  const cliente = new OpenAI({ apiKey: claveIa, maxRetries: 1 })
  const r = await cliente.chat.completions.create({
    ...parametrosDeIa({ maxSalida: 7000, esfuerzo: 'low' }),
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Eres analista de SEO de Amazon España. Te doy un producto y búsquedas reales de Amazon. Para cada búsqueda di: ' +
          '"m": el nombre de la MARCA comercial de otra empresa que aparezca en la búsqueda (p. ej. "skechers", "hey dude", "crocs", "doctor cutillas"), tal cual se escribe, o null si no lleva ninguna. ' +
          'No son marcas: palabras corrientes, tipos de producto, materiales, tallas, colores, ni la marca del propio producto (la del título). ' +
          '"e": "relevante" (quien la escribe compraría este tipo de producto), "otro_producto" (busca otra cosa) o "marca_ajena" (busca un producto de otra marca); ' +
          '"c": tu confianza de 0 a 1. Contesta SOLO JSON: {"b":[{"q":"<búsqueda tal cual>","m":<marca o null>,"e":"<etiqueta>","c":<0-1>}]}.',
      },
      { role: 'user', content: JSON.stringify({ producto: { titulo: producto.titulo, viñetas: producto.bullets.slice(0, 5).map((b) => b.slice(0, 250)) }, busquedas: lista }) },
    ],
  })
  let salida: Array<{ q?: unknown; m?: unknown; e?: unknown; c?: unknown }> = []
  try {
    const j = JSON.parse(r.choices[0]?.message?.content ?? '{}') as { b?: unknown }
    if (Array.isArray(j.b)) salida = j.b as typeof salida
  } catch {
    return 0
  }
  const validas = new Map(lista.map((q) => [q.trim().toLowerCase(), q]))
  const revisadas: Array<Record<string, unknown>> = []
  const decisiones: Array<Record<string, unknown>> = []
  const marcas: Array<{ texto: string; origen: OrigenDeMarca }> = []
  for (const x of salida) {
    const q = typeof x.q === 'string' ? x.q.trim().toLowerCase() : ''
    if (!validas.has(q)) continue
    const conf = typeof x.c === 'number' ? x.c : Number(x.c)
    const m = typeof x.m === 'string' && x.m.trim() ? x.m.trim() : null
    const e = x.e
    const claveM = m ? claveDeMarca(m) : ''
    // La marca tiene que estar de verdad en la búsqueda (palabras enteras) y no ser la propia
    const marcaBuena = !!m && esMarcaValida(claveM) && !propias.has(claveM) && ` ${claveDeMarca(q)} `.includes(` ${claveM} `)
    revisadas.push({ connection_id: c.connectionId, marketplace_id: c.marketplaceId, consulta: claveDeBusqueda(q), marca: marcaBuena ? claveM : null })
    if (!Number.isFinite(conf) || conf < CONFIANZA) continue
    if (marcaBuena) marcas.push({ texto: m as string, origen: 'ia' })
    const decision = !marcaBuena && e === 'relevante' ? 'nuestra' : e === 'otro_producto' && !marcaBuena ? 'ajena' : null
    if (decision) decisiones.push({ connection_id: c.connectionId, marketplace_id: c.marketplaceId, consulta: claveDeBusqueda(q), texto: q.slice(0, 300), decision, asin, created_by: null })
  }
  // Las que la IA no devolvió también cuentan como vistas (para no preguntar sin fin): sin marca
  const vistas = new Set(revisadas.map((x) => x.consulta))
  for (const q of lista) if (!vistas.has(claveDeBusqueda(q))) revisadas.push({ connection_id: c.connectionId, marketplace_id: c.marketplaceId, consulta: claveDeBusqueda(q), marca: null })
  const service = createServiceClient()
  if (marcas.length) await insertarNuevas(c, marcas, propias)
  if (decisiones.length) {
    const { error } = await service.from('seo_busquedas_decididas').upsert(decisiones, { onConflict: 'connection_id,marketplace_id,consulta', ignoreDuplicates: true })
    if (error && !isMissingSchema(error)) console.error('SEO marcas: decisiones de la IA:', error.message)
  }
  const { error } = await service.from('seo_busquedas_marca').upsert(revisadas, { onConflict: 'connection_id,marketplace_id,consulta', ignoreDuplicates: true })
  if (error) throw error
  return lista.length
}

export interface ResultadoDeMarcas {
  nuevas: number
  revisadasIa: number
  pendientesIa: number
}

/**
 * Busca las marcas de la competencia de una cuenta y país. `presupuestoMs` limita las llamadas a la IA (la parte lenta): lo que no da tiempo queda para la próxima pasada.
 */
export async function actualizarMarcas(c: Cuenta, opciones: { presupuestoMs?: number; conIa?: boolean } = {}): Promise<ResultadoDeMarcas> {
  const arranque = Date.now()
  const presupuesto = opciones.presupuestoMs ?? 60_000
  if ((await leerMarcas(c)) === null) throw new FaltaMigracion338()
  const [productos, fichas, propiasLista] = await Promise.all([productosSeguidos(c.connectionId, c.marketplaceId), fichasGuardadas(c.connectionId, c.marketplaceId).catch(() => []), marcasPropias(c)])
  const propias = new Set(propiasLista)
  const propios = new Set(productos.map((p) => p.asin.toUpperCase()))

  let nuevas = 0
  nuevas += await insertarNuevas(c, (await marcasDeRivales(c).catch(() => [])).map((texto) => ({ texto, origen: 'rival' as const })), propias)
  nuevas += await insertarNuevas(c, (await marcasDeLosClics(c, propios).catch((e) => (console.error('SEO marcas: clics:', e instanceof Error ? e.message : e), []))).map((texto) => ({ texto, origen: 'clics' as const })), propias)

  let revisadasIa = 0
  let pendientesIa = 0
  if (opciones.conIa !== false) {
    const service = createServiceClient()
    const vistas = new Set<string>()
    for (let i = 0; i < 50_000; i += 1000) {
      const { data, error } = await service.from('seo_busquedas_marca').select('consulta').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).range(i, i + 999)
      if (error) throw error
      for (const r of (data ?? []) as Array<{ consulta: string }>) vistas.add(r.consulta)
      if (!data || data.length < 1000) break
    }
    const [mes, semana] = await Promise.all([consultasGuardadas(c.connectionId, c.marketplaceId, 'MONTH'), consultasGuardadas(c.connectionId, c.marketplaceId, 'WEEK')])
    const antes = await leerMarcas(c)
    for (const p of productos) {
      const ficha = fichas.find((f) => f.asin === p.asin)
      const propiasDeEste = [...[...mes, ...semana].filter((x) => x.asin === p.asin)]
        .sort((a, b) => (b.comprasTotal ?? 0) - (a.comprasTotal ?? 0))
        .map((x) => x.consulta)
        .filter((q, i, a) => a.indexOf(q) === i)
        .filter((q) => !vistas.has(claveDeBusqueda(q)))
      if (propiasDeEste.length === 0) continue
      if (Date.now() - arranque > presupuesto || !ficha) {
        pendientesIa += propiasDeEste.length
        continue
      }
      try {
        const n = await repasarConIa(c, p.asin, { titulo: ficha.titulo, bullets: ficha.bullets }, propiasDeEste, propias)
        revisadasIa += n
        pendientesIa += Math.max(0, propiasDeEste.length - n)
        for (const q of propiasDeEste.slice(0, n)) vistas.add(claveDeBusqueda(q))
      } catch (e) {
        console.error('SEO marcas: IA:', e instanceof Error ? e.message : e)
        pendientesIa += propiasDeEste.length
      }
    }
    const despues = await leerMarcas(c)
    nuevas += Math.max(0, (despues?.length ?? 0) - (antes?.length ?? 0))
  }
  return { nuevas, revisadasIa, pendientesIa }
}

/** Todas las cuentas con productos seguidos, para el proceso horario. Lo que no da tiempo, la próxima hora */
export async function actualizarMarcasDeTodas(presupuestoMs: number): Promise<{ cuentas: number; nuevas: number; revisadasIa: number; pendientesIa: number; errores: string[] }> {
  const arranque = Date.now()
  const { data, error } = await createServiceClient().from('seo_productos').select('connection_id, marketplace_id').limit(5000)
  if (error) throw error
  const cuentas = [...new Map(((data ?? []) as Array<{ connection_id: string; marketplace_id: string }>).map((r) => [`${r.connection_id}~${r.marketplace_id}`, { connectionId: r.connection_id, marketplaceId: r.marketplace_id }])).values()]
  const total = { cuentas: 0, nuevas: 0, revisadasIa: 0, pendientesIa: 0, errores: [] as string[] }
  for (const c of cuentas) {
    const queda = presupuestoMs - (Date.now() - arranque)
    if (queda < 8_000) break
    try {
      const r = await actualizarMarcas(c, { presupuestoMs: Math.min(queda - 5_000, 45_000) })
      total.cuentas++
      total.nuevas += r.nuevas
      total.revisadasIa += r.revisadasIa
      total.pendientesIa += r.pendientesIa
    } catch (e) {
      if (e instanceof FaltaMigracion338) return total
      total.errores.push(e instanceof Error ? e.message : String(e))
    }
  }
  return total
}
