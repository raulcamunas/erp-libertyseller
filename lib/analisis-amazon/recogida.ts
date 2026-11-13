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
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { construirAnalisis } from './construir'
import { guardarAnalisis } from './guardar'
import { estudiarVendedor, saldoKeepa, SinTokens } from './keepa'
import { falta303 } from './servidor'

export const BUCKET = 'analisis-keepa'
/** Lo más caro medido fueron 136 tokens; con este saldo una tienda no se queda a medias */
const TOKENS_POR_TIENDA = 150
const MINUTOS_POR_PASADA = 4
const INTENTOS_ANTES_DE_SALTAR = 3

export type EnCola = { lead: string; seller: string; tienda: string; comercial?: string }

/** Los fallos seguidos de cada vendedor, en memoria (el servidor es un solo proceso) */
const fallos = new Map<string, number>()
let enMarcha = false

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

export async function pasadaDeRecogida(): Promise<ResultadoDePasada> {
  const nada = (resumen: string, pendientes = 0, tokens = 0): ResultadoDePasada => ({ hechos: 0, tokens, pendientes, resumen })
  const clave = (process.env.KEEPA_KEY ?? '').trim()
  if (!clave) return nada('falta KEEPA_KEY en el entorno del servidor')
  if (enMarcha) return nada('ya hay una pasada en marcha')
  enMarcha = true
  try {
    const s = createServiceClient()
    const cola = await leerJson<EnCola[]>(s, 'cola.json', [])
    if (!cola.length) return nada('no hay cola (cola.json en Storage)')
    const saltados = await leerJson<Record<string, string>>(s, 'saltados.json', {})
    const hechos = await yaHechos(s)
    const pendientes = cola.filter((v) => !hechos.has(v.lead) && !saltados[v.seller])
    if (!pendientes.length) return nada('cola terminada')

    const fin = Date.now() + MINUTOS_POR_PASADA * 60_000
    let hechas = 0
    let tokens = 0
    let saltadosNuevos = false
    const nombres: string[] = []
    let motivoDeParar = ''

    for (const v of pendientes) {
      if (Date.now() > fin) break
      const saldo = await saldoKeepa(clave)
      if (saldo.tokens < TOKENS_POR_TIENDA) {
        motivoDeParar = `esperando saldo de Keepa (${saldo.tokens}/${TOKENS_POR_TIENDA})`
        break
      }
      try {
        const e = await estudiarVendedor(clave, v.seller)
        tokens += e.gastado
        if (e.sinDatos) {
          saltados[v.seller] = 'sin datos en Keepa'
          saltadosNuevos = true
          continue
        }
        const informe = construirAnalisis({ vendedorEs: e.vendedorEs, paises: e.paises, productos: e.productos, competencia: e.competencia, fecha: e.productos.fecha })
        const r = await guardarAnalisis(s, v, informe, e.productos.fecha)
        if (!r.ok) {
          if (falta303(r.error)) return nada('falta la migración 303', pendientes.length, tokens)
          // 23503: el lead ya no existe
          if (r.error.code === '23503') {
            saltados[v.seller] = 'el lead ya no existe'
            saltadosNuevos = true
            continue
          }
          throw new Error(`no se ha podido guardar: ${r.error.message}`)
        }
        fallos.delete(v.seller)
        hechas++
        nombres.push(v.tienda)
      } catch (e) {
        if (e instanceof SinTokens) {
          motivoDeParar = 'Keepa se ha quedado sin saldo a mitad de tienda (se repite en la próxima)'
          break
        }
        const n = (fallos.get(v.seller) ?? 0) + 1
        fallos.set(v.seller, n)
        console.warn(`[analisis-keepa] ${v.tienda}: ${(e as Error).message} (intento ${n})`)
        if (n >= INTENTOS_ANTES_DE_SALTAR) {
          saltados[v.seller] = `falla: ${(e as Error).message}`.slice(0, 200)
          saltadosNuevos = true
          fallos.delete(v.seller)
        }
        break
      }
    }
    if (saltadosNuevos) await escribirJson(s, 'saltados.json', saltados)

    const quedan = pendientes.length - hechas
    const partes = [hechas ? `${hechas} ${hechas === 1 ? 'informe' : 'informes'} (${nombres.join(', ')})` : 'ningún informe nuevo', `${quedan} en cola`]
    if (motivoDeParar) partes.push(motivoDeParar)
    return { hechos: hechas, tokens, pendientes: quedan, resumen: partes.join(' · ').slice(0, 480) }
  } finally {
    enMarcha = false
  }
}
