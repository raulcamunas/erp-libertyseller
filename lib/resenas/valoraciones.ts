import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { clientesGrowth } from '@/lib/growth/clientes'
import { cuentasDeCliente } from '@/lib/ads/cuenta'
import { asinDeCampana } from '@/lib/ads/productos-agrupar'
import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'
import { pedir, saldoKeepa, SinTokens } from '@/lib/analisis-amazon/keepa'
import { leerGestion } from '@/lib/cuentas/datos'

/**
 * RESEÑAS · LA VALORACIÓN Y EL NÚMERO DE RESEÑAS DE CADA PRODUCTO, UNA VEZ AL DÍA (migración 357). SOLO SERVIDOR.
 *
 * La API de Amazon no da las reseñas; Keepa sí da, por ASIN y país, la valoración media y cuántas reseñas tiene (`rating=1`, ~2 tokens por producto).
 * Se miran los productos ANUNCIADOS (campañas con gasto en 14 días) y los SEGUIDOS en SEO de cada cliente, hasta 400 al día. Con la foto de hoy y la de hace
 * 7 días: aviso al responsable de la cuenta (campana) si la nota baja 0,1 o más, o si entran reseñas nuevas con la nota a la baja (señal de una negativa).
 * La corre el proceso de Reseñas (cada 10 min), solo una vez al día y a partir de las 8 de la mañana.
 */

const DOMINIO: Record<string, number> = { US: 1, UK: 2, GB: 2, DE: 3, FR: 4, IT: 8, ES: 9, MX: 11 }
const MAX_ASINS = 400
const LOTE = 100

export interface CambioDeValoracion {
  asin: string
  pais: string
  titulo: string | null
  ahora: { valoracion: number | null; num: number | null }
  antes: { valoracion: number | null; num: number | null }
  motivo: string
}

/** PURO. ¿Merece aviso? Nota que baja 0,1 o más, o reseñas nuevas con la nota a la baja */
export function cambioDeValoracion(ahora: { valoracion: number | null; num: number | null }, antes: { valoracion: number | null; num: number | null }): string | null {
  if (ahora.valoracion == null || antes.valoracion == null) return null
  const baja = Math.round((antes.valoracion - ahora.valoracion) * 100) / 100
  const nuevas = ahora.num != null && antes.num != null ? ahora.num - antes.num : 0
  if (baja >= 0.1) return `la nota baja de ${antes.valoracion.toFixed(1)} a ${ahora.valoracion.toFixed(1)}${nuevas > 0 ? ` con ${nuevas} ${nuevas === 1 ? 'reseña nueva' : 'reseñas nuevas'}` : ''}`
  if (nuevas > 0 && baja > 0) return `${nuevas} ${nuevas === 1 ? 'reseña nueva' : 'reseñas nuevas'} y la nota baja (de ${antes.valoracion.toFixed(2)} a ${ahora.valoracion.toFixed(2)}): probablemente alguna negativa`
  return null
}

/** El último valor de una serie de Keepa ([t, v, t, v…]); -1 = sin dato */
const ultimo = (serie: unknown): number | null => {
  if (!Array.isArray(serie) || serie.length < 2) return null
  const v = Number(serie[serie.length - 1])
  return Number.isFinite(v) && v >= 0 ? v : null
}

const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
const horaMadrid = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }))

/** Los productos a mirar: por cliente, los anunciados (por el nombre de sus campañas) y los seguidos en SEO, con su país */
async function productosAMirar(): Promise<Array<{ amazonClientId: string; pais: string; asin: string }>> {
  const s = createServiceClient()
  const salida = new Map<string, { amazonClientId: string; pais: string; asin: string }>()
  const desde = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)
  for (const c of (await clientesGrowth()).filter((x) => x.amazonClientId && x.activo)) {
    const id = c.amazonClientId as string
    for (const cuenta of await cuentasDeCliente(id).catch(() => [])) {
      const { data } = await s.from('ads_rendimiento_diario').select('nombre').eq('perfil_id', cuenta.id).gte('fecha', desde).gt('gasto', 0).limit(1000)
      for (const r of (data ?? []) as Array<{ nombre: string | null }>) {
        const asin = r.nombre ? asinDeCampana(r.nombre) : null
        if (asin) salida.set(`${cuenta.pais}|${asin}`, { amazonClientId: id, pais: cuenta.pais.toUpperCase(), asin: asin.toUpperCase() })
      }
    }
    const { data: con } = await s.from('amazon_connections').select('id').eq('client_id', id).eq('is_active', true)
    const ids = ((con ?? []) as Array<{ id: string }>).map((x) => x.id)
    if (ids.length) {
      const { data } = await s.from('seo_productos').select('marketplace_id, asin').in('connection_id', ids).limit(1000)
      for (const r of (data ?? []) as Array<{ marketplace_id: string; asin: string }>) {
        const pais = AMAZON_MARKETPLACES.find((m) => m.id === r.marketplace_id)?.countryCode
        if (pais && r.asin) salida.set(`${pais}|${r.asin.toUpperCase()}`, { amazonClientId: id, pais: pais.toUpperCase(), asin: r.asin.toUpperCase() })
      }
    }
  }
  return [...salida.values()].filter((x) => DOMINIO[x.pais] != null).slice(0, MAX_ASINS)
}

export interface ResultadoDeValoraciones {
  hecho: boolean
  motivo?: string
  leidos: number
  avisos: number
  tokens: number
}

/** La foto del día (si no está hecha y son más de las 8 en Madrid). Nunca lanza por Keepa: lo que falla va en `motivo` */
export async function fotoDeValoracionesSiFalta(opciones: { forzar?: boolean } = {}): Promise<ResultadoDeValoraciones> {
  const r: ResultadoDeValoraciones = { hecho: false, leidos: 0, avisos: 0, tokens: 0 }
  const clave = (process.env.KEEPA_KEY ?? '').trim()
  if (!clave) return { ...r, motivo: 'sin clave de Keepa' }
  if (!opciones.forzar && horaMadrid() < 8) return { ...r, motivo: 'antes de las 8' }
  const s = createServiceClient()
  const hoy = hoyMadrid()
  const ya = await s.from('resenas_valoraciones').select('asin').eq('dia', hoy).limit(1)
  if (ya.error) return { ...r, motivo: isMissingSchema(ya.error) ? 'falta la migración 357' : ya.error.message }
  if (!opciones.forzar && (ya.data ?? []).length > 0) return { ...r, motivo: 'ya hecha hoy' }

  const productos = await productosAMirar()
  if (productos.length === 0) return { ...r, motivo: 'ningún producto anunciado ni seguido' }
  // Keepa da los tokens poco a poco (y los comparte el análisis de cuentas): sin saldo para TODOS, se espera a la pasada siguiente (no se deja la foto a medias)
  const saldo = await saldoKeepa(clave).catch(() => null)
  const necesarios = productos.length * 2 + 20
  if (!saldo || saldo.tokens < necesarios) return { ...r, motivo: `esperando tokens de Keepa (${saldo?.tokens ?? '?'} de ${necesarios})` }
  const porPais = new Map<string, typeof productos>()
  for (const p of productos) porPais.set(p.pais, [...(porPais.get(p.pais) ?? []), p])
  const filas: Array<{ pais: string; asin: string; dia: string; amazon_client_id: string; valoracion: number | null; num_resenas: number | null; titulo: string | null }> = []
  try {
    for (const [pais, lista] of porPais) {
      for (let i = 0; i < lista.length; i += LOTE) {
        const trozo = lista.slice(i, i + LOTE)
        const d = await pedir(clave, `product?domain=${DOMINIO[pais]}&asin=${trozo.map((x) => x.asin).join(',')}&rating=1`)
        r.tokens += Number(d?.tokensConsumed ?? 0)
        const clienteDe = new Map(trozo.map((x) => [x.asin, x.amazonClientId]))
        for (const prod of (d?.products ?? []) as Array<{ asin?: string; title?: string; csv?: unknown[] }>) {
          const asin = String(prod.asin ?? '').toUpperCase()
          const cliente = clienteDe.get(asin)
          if (!cliente) continue
          const nota = ultimo(prod.csv?.[16])
          const num = ultimo(prod.csv?.[17])
          filas.push({ pais, asin, dia: hoy, amazon_client_id: cliente, valoracion: nota == null ? null : Math.round(nota) / 10, num_resenas: num, titulo: prod.title ? String(prod.title).slice(0, 200) : null })
        }
      }
    }
  } catch (e) {
    if (filas.length === 0) return { ...r, motivo: e instanceof SinTokens ? 'Keepa sin tokens: se reintenta en la siguiente pasada' : e instanceof Error ? e.message : String(e) }
  }
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await s.from('resenas_valoraciones').upsert(filas.slice(i, i + 500), { onConflict: 'pais,asin,dia' })
    if (error) return { ...r, motivo: error.message }
  }
  r.hecho = true
  r.leidos = filas.length

  // Avisos: frente a la foto de hace 7 días (o la más cercana anterior de esa semana)
  const hace7 = new Date(Date.parse(`${hoy}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10)
  const { data: antes } = await s.from('resenas_valoraciones').select('pais, asin, valoracion, num_resenas, dia').gte('dia', hace7).lt('dia', hoy).order('dia', { ascending: true }).limit(5000)
  const previa = new Map<string, { valoracion: number | null; num: number | null }>()
  for (const a of (antes ?? []) as Array<{ pais: string; asin: string; valoracion: number | null; num_resenas: number | null }>) if (!previa.has(`${a.pais}|${a.asin}`)) previa.set(`${a.pais}|${a.asin}`, { valoracion: a.valoracion == null ? null : Number(a.valoracion), num: a.num_resenas })
  const porCliente = new Map<string, CambioDeValoracion[]>()
  for (const f of filas) {
    const p = previa.get(`${f.pais}|${f.asin}`)
    if (!p) continue
    const motivo = cambioDeValoracion({ valoracion: f.valoracion, num: f.num_resenas }, p)
    if (motivo) porCliente.set(f.amazon_client_id, [...(porCliente.get(f.amazon_client_id) ?? []), { asin: f.asin, pais: f.pais, titulo: f.titulo, ahora: { valoracion: f.valoracion, num: f.num_resenas }, antes: p, motivo }])
  }
  if (porCliente.size > 0) {
    const { porCliente: gestion } = await leerGestion().catch(() => ({ porCliente: new Map() as Awaited<ReturnType<typeof leerGestion>>['porCliente'] }))
    for (const [cliente, cambios] of porCliente) {
      const responsable = gestion.get(cliente)?.responsableId
      if (!responsable) continue
      const { error } = await s.from('notifications').insert({
        user_id: responsable,
        type: 'cuenta_aviso',
        title: `Reseñas: ${cambios.length} ${cambios.length === 1 ? 'producto empeora' : 'productos empeoran'} esta semana`,
        message: cambios
          .slice(0, 5)
          .map((c) => `${c.titulo ? c.titulo.slice(0, 50) : c.asin} (${c.pais}): ${c.motivo}`)
          .join(' · ')
          .slice(0, 600),
        clave: `resenas:${cliente}:${hoy}`,
        datos: { app: 'ventas-resenas' },
      })
      if (!error) r.avisos++
    }
  }
  return r
}

/** Para la pantalla: por cliente, la última foto de cada producto con su cambio en 7 días */
export async function valoracionesDeClientes(): Promise<Array<{ amazonClientId: string; asin: string; pais: string; titulo: string | null; valoracion: number | null; num: number | null; valoracion7: number | null; num7: number | null; aviso: string | null; dia: string }>> {
  const s = createServiceClient()
  const desde = new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await s.from('resenas_valoraciones').select('amazon_client_id, pais, asin, dia, valoracion, num_resenas, titulo').gte('dia', desde).order('dia', { ascending: false }).limit(5000)
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  const filas = (data ?? []) as Array<{ amazon_client_id: string; pais: string; asin: string; dia: string; valoracion: number | null; num_resenas: number | null; titulo: string | null }>
  const ultima = new Map<string, (typeof filas)[number]>()
  const vieja = new Map<string, (typeof filas)[number]>()
  for (const f of filas) {
    const k = `${f.pais}|${f.asin}`
    if (!ultima.has(k)) ultima.set(k, f)
    vieja.set(k, f) // al ir de más nuevo a más viejo, la última que queda es la más vieja
  }
  return [...ultima.entries()].map(([k, f]) => {
    const v = vieja.get(k)
    const ahora = { valoracion: f.valoracion == null ? null : Number(f.valoracion), num: f.num_resenas }
    const antes = v && v.dia !== f.dia ? { valoracion: v.valoracion == null ? null : Number(v.valoracion), num: v.num_resenas } : { valoracion: null, num: null }
    return { amazonClientId: f.amazon_client_id, asin: f.asin, pais: f.pais, titulo: f.titulo, valoracion: ahora.valoracion, num: ahora.num, valoracion7: antes.valoracion, num7: antes.num, aviso: cambioDeValoracion(ahora, antes), dia: f.dia }
  })
}
