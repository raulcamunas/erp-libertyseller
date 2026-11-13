/**
 * LA RECOGIDA DE KEEPA EN EL SERVIDOR: cada minuto, si Keepa tiene saldo para una tienda entera, se analiza la siguiente de la cola, se
 * construye su informe y se guarda (el lead queda con «Con informe»). Sustituye a la recogida y al importador del portátil.
 *
 * LA COLA vive en Storage (bucket privado `analisis-keepa`, sin migración):
 *   cola.json      [{ lead, seller, tienda, comercial }] en el orden acordado: primero los «sin contactar», luego Fase 2 y 3 con llamada
 *                  próxima, luego el resto y al final los «no interesa», por turnos Alejandro → Maoli → Daniela.
 *   saltados.json  { sellerId: motivo } los que no tienen informe posible (Keepa no los conoce, sin productos, el lead ya no existe…)
 * Lo hecho no se apunta aparte: es el lead con `analisis_amazon_at`. Así lo que cargó el portátil cuenta igual.
 *
 * Una tienda se hace de una tirada (unos segundos) y solo si hay saldo para ella: no hay esperas largas dentro de la ruta. Si hay saldo
 * acumulado (tras un despliegue, por ejemplo) hace varias seguidas hasta MINUTOS_POR_PASADA.
 *
 * DOS COLAS A LA VEZ (13 nov 2026): la de vendedores de Amazon (cola.json) y la de tiendas online que no venden en Amazon
 * (cola-sin-amazon.json, informe de lib/analisis-sin-amazon). Se alternan: una de cada, y si una se acaba sigue la otra. Las de la
 * segunda se apuntan en saltados.json con la clave `lead:<id>`. Si al estudiar una tienda «sin Amazon» resulta que el vendedor de su
 * marca es ella (mismo CIF o razón social), el lead se marca como vendedor y pasa al principio de la cola de Amazon.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { construirAnalisis } from './construir'
import { guardarAnalisis } from './guardar'
import { estudiarVendedor, saldoKeepa, SinTokens } from './keepa'
import { falta303 } from './servidor'
import { clientesActuales, esCliente, type Clientes } from './clientes'
import { leerCatalogo } from '@/lib/analisis-sin-amazon/catalogo'
import { estudiarTienda, planDeEstudio } from '@/lib/analisis-sin-amazon/estudio'
import { construirSinAmazon, SELLER_SIN_AMAZON } from '@/lib/analisis-sin-amazon/construir'

export const BUCKET = 'analisis-keepa'
/** Lo más caro medido fueron 136 tokens; con este saldo una tienda no se queda a medias */
const TOKENS_POR_TIENDA = 150
/** El de tiendas sin Amazon gasta más: marca, sus vendedores y hasta 3 mercados (medido 210-300) */
const TOKENS_SIN_AMAZON = 280
const MINUTOS_POR_PASADA = 4
const INTENTOS_ANTES_DE_SALTAR = 3

export type EnCola = { lead: string; seller: string; tienda: string; comercial?: string }
export type EnColaSinAmazon = { lead: string; tienda: string; web: string; comercial?: string }

/** Los fallos seguidos de cada vendedor, en memoria (el servidor es un solo proceso) */
const fallos = new Map<string, number>()
let enMarcha = false
/** De quién es el turno: se alternan las dos colas */
let turno: 'amazon' | 'sin' = 'amazon'

async function leerJson<T>(s: SupabaseClient, nombre: string, siNoHay: T): Promise<T> {
  const { data, error } = await s.storage.from(BUCKET).download(nombre)
  if (error || !data) return siNoHay
  return JSON.parse(await data.text()) as T
}

async function escribirJson(s: SupabaseClient, nombre: string, datos: unknown) {
  await s.storage.from(BUCKET).upload(nombre, new Blob([JSON.stringify(datos)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' })
}

/** Los leads de la cola que ya tienen informe */
async function yaHechos(s: SupabaseClient): Promise<Set<string>> {
  const hechos = new Set<string>()
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await s.from('cold_leads').select('id').not('analisis_amazon_at', 'is', null).range(desde, desde + 999)
    if (error) throw error
    for (const f of data ?? []) hechos.add((f as { id: string }).id)
    if (!data || data.length < 1000) break
  }
  return hechos
}

export type ResultadoDePasada = { hechos: number; tokens: number; pendientes: number; resumen: string }

type Tarea = { tipo: 'amazon'; v: EnCola } | { tipo: 'sin'; v: EnColaSinAmazon }
type Hecho = { ok: true; nombre: string } | { ok: false; saltar?: string; parar?: string }

async function hacerAmazon(s: SupabaseClient, clave: string, v: EnCola, clientes: Clientes): Promise<Hecho & { tokens: number }> {
  if (esCliente(clientes, { seller: v.seller, nombres: [v.tienda] })) return { ok: false, saltar: 'es cliente nuestro', tokens: 0 }
  const e = await estudiarVendedor(clave, v.seller)
  if (e.sinDatos) return { ok: false, saltar: 'sin datos en Keepa', tokens: e.gastado }
  const informe = construirAnalisis({ vendedorEs: e.vendedorEs, paises: e.paises, productos: e.productos, competencia: e.competencia, fecha: e.productos.fecha })
  const r = await guardarAnalisis(s, v, informe, e.productos.fecha)
  if (!r.ok) {
    if (falta303(r.error)) return { ok: false, parar: 'falta la migración 303', tokens: e.gastado }
    if (r.error.code === '23503') return { ok: false, saltar: 'el lead ya no existe', tokens: e.gastado }
    throw new Error(`no se ha podido guardar: ${r.error.message}`)
  }
  return { ok: true, nombre: v.tienda, tokens: e.gastado }
}

async function hacerSinAmazon(s: SupabaseClient, clave: string, v: EnColaSinAmazon, clientes: Clientes): Promise<Hecho & { tokens: number }> {
  const { data: lead, error } = await s.from('cold_leads').select('id, store_name, web, cif, company, vende_en_amazon, seller_url').eq('id', v.lead).maybeSingle()
  if (error) throw error
  const l = lead as { store_name: string | null; web: string | null; cif: string | null; company: string | null; vende_en_amazon: string | null; seller_url: string | null } | null
  if (!l) return { ok: false, saltar: 'el lead ya no existe', tokens: 0 }
  if (esCliente(clientes, { nombres: [l.store_name, l.company, v.tienda], web: l.web ?? v.web })) return { ok: false, saltar: 'es cliente nuestro', tokens: 0 }
  if (l.vende_en_amazon === 'vende' || l.seller_url) return { ok: false, saltar: 'ya vende en Amazon', tokens: 0 }
  const web = l.web ?? v.web
  const catalogo = web ? await leerCatalogo(web) : null
  if (!catalogo) return { ok: false, saltar: 'su web no contesta', tokens: 0 }
  const nombre = l.store_name ?? v.tienda
  const datos = { nombre, web: catalogo.origen, cif: l.cif, empresa: l.company }
  const plan = await planDeEstudio(datos, catalogo)
  if (!plan.marcas.length && !plan.busquedas.length) return { ok: false, saltar: 'no se sabe qué vende', tokens: 0 }
  const e = await estudiarTienda(clave, datos, plan, catalogo.productos.map((p) => p.titulo))

  if (e.propio) {
    // Es vendedor de Amazon: se marca y pasa al principio de la cola del informe de Amazon
    await s.from('cold_leads').update({ vende_en_amazon: 'vende', seller_url: `https://www.amazon.es/sp?seller=${e.propio.sellerId}` }).eq('id', v.lead)
    const cola = await leerJson<EnCola[]>(s, 'cola.json', [])
    if (!cola.some((c) => c.lead === v.lead)) await escribirJson(s, 'cola.json', [{ lead: v.lead, seller: e.propio.sellerId, tienda: nombre, comercial: v.comercial }, ...cola])
    return { ok: false, saltar: `vende en Amazon como ${e.propio.nombre} (por ${e.propio.por}): pasa a la cola de Amazon`, tokens: e.gastado }
  }
  if (!e.marca.productos.length && !e.mercados.length) return { ok: false, saltar: 'nada comparable en Amazon', tokens: e.gastado }

  const informe = construirSinAmazon(e, { nombre, web: catalogo.origen, productosWeb: catalogo.productos.length, cif: l.cif, empresa: l.company })
  const r = await guardarAnalisis(s, { lead: v.lead, seller: SELLER_SIN_AMAZON }, informe, e.fecha)
  if (!r.ok) {
    if (falta303(r.error)) return { ok: false, parar: 'falta la migración 303', tokens: e.gastado }
    if (r.error.code === '23503') return { ok: false, saltar: 'el lead ya no existe', tokens: e.gastado }
    throw new Error(`no se ha podido guardar: ${r.error.message}`)
  }
  return { ok: true, nombre: `${nombre} (sin Amazon)`, tokens: e.gastado }
}

export async function pasadaDeRecogida(): Promise<ResultadoDePasada> {
  const nada = (resumen: string, pendientes = 0, tokens = 0): ResultadoDePasada => ({ hechos: 0, tokens, pendientes, resumen })
  const clave = (process.env.KEEPA_KEY ?? '').trim()
  if (!clave) return nada('falta KEEPA_KEY en el entorno del servidor')
  if (enMarcha) return nada('ya hay una pasada en marcha')
  enMarcha = true
  try {
    const s = createServiceClient()
    const [cola, colaSin, saltados, hechos, clientes] = await Promise.all([
      leerJson<EnCola[]>(s, 'cola.json', []),
      leerJson<EnColaSinAmazon[]>(s, 'cola-sin-amazon.json', []),
      leerJson<Record<string, string>>(s, 'saltados.json', {}),
      yaHechos(s),
      clientesActuales(s),
    ])
    if (!cola.length && !colaSin.length) return nada('no hay cola (cola.json en Storage)')
    const pendientes = cola.filter((v) => !hechos.has(v.lead) && !saltados[v.seller])
    const pendientesSin = colaSin.filter((v) => !hechos.has(v.lead) && !saltados[`lead:${v.lead}`])
    if (!pendientes.length && !pendientesSin.length) return nada('cola terminada')

    const fin = Date.now() + MINUTOS_POR_PASADA * 60_000
    let hechas = 0
    let tokens = 0
    let saltadosNuevos = false
    const nombres: string[] = []
    let motivoDeParar = ''
    let ia = 0
    let ib = 0

    while (Date.now() < fin) {
      const quiere: 'amazon' | 'sin' = turno === 'amazon' ? (ia < pendientes.length ? 'amazon' : 'sin') : ib < pendientesSin.length ? 'sin' : 'amazon'
      const tarea: Tarea | null =
        quiere === 'amazon' ? (ia < pendientes.length ? { tipo: 'amazon', v: pendientes[ia] } : null) : ib < pendientesSin.length ? { tipo: 'sin', v: pendientesSin[ib] } : null
      if (!tarea) break
      const necesita = tarea.tipo === 'amazon' ? TOKENS_POR_TIENDA : TOKENS_SIN_AMAZON
      const saldo = await saldoKeepa(clave)
      if (saldo.tokens < necesita) {
        motivoDeParar = `esperando saldo de Keepa (${saldo.tokens}/${necesita})`
        break
      }
      const llave = tarea.tipo === 'amazon' ? tarea.v.seller : `lead:${tarea.v.lead}`
      if (tarea.tipo === 'amazon') ia++
      else ib++
      try {
        const r = tarea.tipo === 'amazon' ? await hacerAmazon(s, clave, tarea.v, clientes) : await hacerSinAmazon(s, clave, tarea.v, clientes)
        tokens += r.tokens
        if (r.ok) {
          fallos.delete(llave)
          hechas++
          nombres.push(r.nombre)
          turno = tarea.tipo === 'amazon' ? 'sin' : 'amazon'
        } else if (r.parar) {
          return nada(r.parar, pendientes.length + pendientesSin.length - hechas, tokens)
        } else if (r.saltar) {
          saltados[llave] = r.saltar.slice(0, 200)
          saltadosNuevos = true
        }
      } catch (e) {
        if (e instanceof SinTokens) {
          motivoDeParar = 'Keepa se ha quedado sin saldo a mitad de tienda (se repite en la próxima)'
          if (tarea.tipo === 'amazon') ia--
          else ib--
          break
        }
        const n = (fallos.get(llave) ?? 0) + 1
        fallos.set(llave, n)
        console.warn(`[analisis-keepa] ${tarea.v.tienda}: ${(e as Error).message} (intento ${n})`)
        if (n >= INTENTOS_ANTES_DE_SALTAR) {
          saltados[llave] = `falla: ${(e as Error).message}`.slice(0, 200)
          saltadosNuevos = true
          fallos.delete(llave)
        }
        // Que el siguiente fallo no bloquee la otra cola
        turno = tarea.tipo === 'amazon' ? 'sin' : 'amazon'
        break
      }
    }
    if (saltadosNuevos) await escribirJson(s, 'saltados.json', saltados)

    const quedan = pendientes.length + pendientesSin.length - hechas
    const partes = [
      hechas ? `${hechas} ${hechas === 1 ? 'informe' : 'informes'} (${nombres.join(', ')})` : 'ningún informe nuevo',
      `${quedan} en cola (${pendientes.length} de Amazon, ${pendientesSin.length} sin Amazon)`,
    ]
    if (motivoDeParar) partes.push(motivoDeParar)
    return { hechos: hechas, tokens, pendientes: quedan, resumen: partes.join(' · ').slice(0, 480) }
  } finally {
    enMarcha = false
  }
}
