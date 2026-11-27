import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { comisionDe, precioMinimoParaMargen } from './margenes'
import { decidirPrecio, type MotivoDinamico } from './dinamico'
import { FRASE_DE_CONFIRMACION, leerTodasLasOfertas, ofertasDeProductos, subirOfertas } from './mirakl'
import { productosDelProveedor } from './proveedor'
import { conTope, maximosPorTope } from '@/lib/entrais/topes'
import type { OfertaParaSubir } from './datos'

/**
 * PRECIOS DINÁMICOS DE ENTRAIS EN PCCOMPONENTES — LA PASADA. SOLO SERVIDOR. ESCRIBE EN LA TIENDA (si no está en ensayo).
 *
 *   1. Lee las ofertas de Entrais (OF21) y, de esos productos, las de todas las tiendas (P11, 100 por llamada).
 *   2. Para cada una decide el precio con `decidirPrecio` (lib/pccomponentes/dinamico.ts) y el mínimo del margen por tramos de coste.
 *   3. En ENSAYO apunta lo que haría en `pcc_precios_log` y no toca nada. Si no, manda los que cambian (OF24, 500 por envío, uno por minuto) con TODOS los
 *      campos de la oferta: Mirakl reinicia a su valor por defecto cualquiera que no se mande.
 *
 * El reloj está en la configuración (`cada_minutos`): la ruta del cron se llama cada minuto y casi siempre contesta sin hacer nada.
 */

export interface ConfigDinamica {
  activo: boolean
  ensayo: boolean
  cada_minutos: number
  centimos: number
  limite_coste: number
  margen_bajo: number
  margen_alto: number
  subir: boolean
  ultima_pasada_at: string | null
  ultimo_resumen: Record<string, unknown> | null
}

export class FaltaMigracion321 extends Error {
  constructor() {
    super('Falta lanzar la migración 321 (precios dinámicos de PcComponentes).')
  }
}

export async function leerConfig(): Promise<ConfigDinamica> {
  const { data, error } = await createServiceClient().from('pcc_precios_config').select('*').eq('unica', true).maybeSingle()
  if (error) throw isMissingSchema(error) ? new FaltaMigracion321() : error
  if (!data) throw new FaltaMigracion321()
  const c = data as Record<string, unknown>
  return {
    activo: c.activo === true,
    ensayo: c.ensayo !== false,
    cada_minutos: Number(c.cada_minutos),
    centimos: Number(c.centimos),
    limite_coste: Number(c.limite_coste),
    margen_bajo: Number(c.margen_bajo),
    margen_alto: Number(c.margen_alto),
    subir: c.subir !== false,
    ultima_pasada_at: (c.ultima_pasada_at as string | null) ?? null,
    ultimo_resumen: (c.ultimo_resumen as Record<string, unknown> | null) ?? null,
  }
}

export async function guardarConfig(cambios: Partial<Omit<ConfigDinamica, 'ultima_pasada_at' | 'ultimo_resumen'>>, userId: string): Promise<ConfigDinamica> {
  const { error } = await createServiceClient()
    .from('pcc_precios_config')
    .update({ ...cambios, actualizado_at: new Date().toISOString(), actualizado_por: userId })
    .eq('unica', true)
  if (error) throw isMissingSchema(error) ? new FaltaMigracion321() : error
  return leerConfig()
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Subidas (de 500) por pasada: PcComponentes admite una por minuto */
const MAX_LOTES = 4

export interface ResumenDePasada {
  hecho: boolean
  motivo: string
  ensayo?: boolean
  ofertas?: number
  cambios?: number
  bajan?: number
  suben?: number
  alMinimo?: number
  sinCoste?: number
  enviados?: number
  nuevas?: number
  stock?: number
  pendientes?: number
  conStockDelProveedor?: boolean
  /** Ofertas que quedan publicadas tras la pasada, cuántas con stock y en cuántas (con stock) somos los más baratos */
  publicadas?: number
  conStock?: number
  primeros?: number
  importaciones?: string[]
  errores?: string[]
}

/** ¿Le toca pasada ahora? (para no abrir registro de cron cada minuto) */
export async function tocaPasada(): Promise<boolean> {
  const c = await leerConfig()
  return c.activo && (!c.ultima_pasada_at || Date.now() - Date.parse(c.ultima_pasada_at) >= c.cada_minutos * 60_000 - 20_000)
}

/** Una pasada si toca (o si se fuerza). `forzarEnsayo` la hace en ensayo aunque la configuración diga que no (el botón «Probar ahora») */
export async function pasadaSiToca(opciones: { forzar?: boolean; forzarEnsayo?: boolean } = {}): Promise<ResumenDePasada> {
  const config = await leerConfig()
  if (!config.activo && !opciones.forzar) return { hecho: false, motivo: 'apagado' }
  if (!opciones.forzar && config.ultima_pasada_at && Date.now() - Date.parse(config.ultima_pasada_at) < config.cada_minutos * 60_000 - 20_000) {
    return { hecho: false, motivo: 'todavía no toca' }
  }
  const ensayo = config.ensayo || opciones.forzarEnsayo === true
  const service = createServiceClient()
  const ahora = new Date().toISOString()
  // Se sella al empezar: si esta pasada se cuelga, la siguiente no arranca encima cada minuto
  await service.from('pcc_precios_config').update({ ultima_pasada_at: ahora }).eq('unica', true)

  const { ofertas } = await leerTodasLasOfertas(5000, { forzar: true })
  const porSku = new Map(ofertas.map((o) => [o.sku, o]))

  const maximos = await maximosPorTope()

  // EL STOCK, del proveedor (el catálogo que trae el ciclo de stock, sin gastar llamadas). Sin él, el stock no se toca y no se crean ofertas
  let stockDe: Map<string, number> | null = null
  try {
    const p = await productosDelProveedor()
    if (p.productos.length > 0) stockDe = new Map(p.productos.map((x) => [x.codigo, x.stock]))
  } catch {
    stockDe = null
  }

  // EL CATÁLOGO: todo lo de Entrais con coste que existe en PcComponentes (pcc_mercado), más lo que ya está publicado
  const precios = await fetchAll<{ sku: string; ean: string | null; coste: number | null; canon: number | null; precio: number | null }>((a, b) =>
    service.from('entrais_precios').select('sku, ean, coste, canon, precio').order('sku', { ascending: true }).range(a, b)
  )
  const deEntrais = new Map(precios.map((f) => [f.sku, f]))
  const delMercado = await fetchAll<{ ean: string; categoria: string | null; titulo: string | null }>((a, b) => service.from('pcc_mercado').select('ean, categoria, titulo').eq('existe', true).order('ean', { ascending: true }).range(a, b))
  const enPcc = new Map(delMercado.map((f) => [f.ean, f.categoria]))
  const tituloDe = new Map(delMercado.filter((f) => f.titulo).map((f) => [f.ean, f.titulo as string]))
  const skus = new Set<string>([...ofertas.filter((o) => o.ean).map((o) => o.sku), ...precios.filter((f) => f.ean && f.coste !== null && enPcc.has(f.ean)).map((f) => f.sku)])

  // Los valores con que nace una oferta nueva: los más repetidos en las que ya hay (plazo, clase logística, estado)
  const masRepetido = <T,>(xs: Array<T | null>, porDefecto: T): T => {
    const c = new Map<T, number>()
    for (const x of xs) if (x !== null && x !== undefined) c.set(x, (c.get(x) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? porDefecto
  }
  const plazoPorDefecto = masRepetido(ofertas.map((o) => o.plazoEnvioDias), 2)
  const clasePorDefecto = masRepetido(ofertas.map((o) => o.claseLogistica), 'medio')
  const estadoPorDefecto = masRepetido(ofertas.map((o) => o.estadoProducto), '1')

  const eansDelCatalogo = [...new Set([...skus].map((sku) => porSku.get(sku)?.ean ?? deEntrais.get(sku)?.ean ?? null).filter((e): e is string => !!e))]
  const mercado = await ofertasDeProductos(eansDelCatalogo)

  const log: Array<Record<string, unknown>> = []
  const aSubir: Array<{ subir: OfertaParaSubir; nueva: boolean; fila: Record<string, unknown> }> = []
  const cuenta: Record<MotivoDinamico, number> = { bajar_bajo_rival: 0, subir_bajo_siguiente: 0, al_minimo_rival_mas_barato: 0, subir_al_minimo: 0, sin_rivales: 0, ya_esta: 0, sin_coste: 0 }
  let nuevas = 0
  let cambiosDeStock = 0
  // Para las cifras del panel del cliente: cuántas quedan publicadas, cuántas con stock y en cuántas somos los más baratos
  let publicadas = 0
  let conStock = 0
  let primeros = 0

  for (const sku of skus) {
    const o = porSku.get(sku) ?? null
    const e = deEntrais.get(sku) ?? null
    const ean = o?.ean ?? e?.ean ?? null
    if (!ean) continue
    // Con tope de unidades (oferta limitada del distribuidor), nunca más de lo que queda del tope en Amazon + PcComponentes
    const stock = conTope(sku, stockDe ? Math.max(0, stockDe.get(sku) ?? 0) : (o?.cantidad ?? 0), maximos)
    // Sin oferta todavía: se crea solo si hay stock y se sabe el stock del proveedor
    if (!o && (!stockDe || stock <= 0)) continue

    const lista = mercado.get(ean) ?? []
    const idx = o ? lista.findIndex((x) => x.ofertaId !== null && x.ofertaId === o.ofertaId) : -1
    const yo = idx >= 0 ? lista[idx] : null
    const rivales = lista.filter((x, i) => i !== idx && x.activa && x.cantidad > 0).map((x) => ({ tienda: x.tienda, precio: x.precio, total: x.total }))
    const coste = e?.coste === null || e?.coste === undefined ? null : Number(e.coste)
    const margen = coste === null ? 0 : coste < config.limite_coste ? config.margen_bajo : config.margen_alto
    const categoria = o?.categoria ?? enPcc.get(ean) ?? null
    const minimo = coste === null || !(coste > 0) ? null : precioMinimoParaMargen(coste, margen, comisionDe(categoria))

    let precioNuevo: number | null
    let motivo: string
    let rival: { tienda: string | null; total: number } | null = null
    if (o && o.precio !== null && o.precio > 0) {
      const d = decidirPrecio({ precio: o.precio, total: yo?.total ?? null, rivales, minimo, centimos: config.centimos, subir: config.subir })
      cuenta[d.motivo] += 1
      precioNuevo = d.precio ?? o.precio
      motivo = d.motivo
      rival = d.rival
    } else {
      // Oferta NUEVA: por debajo del más barato, nunca bajo el mínimo; sin nadie más, el precio de Amazon (o el mínimo si es más alto)
      if (minimo === null) continue
      const d = decidirPrecio({ precio: minimo, total: null, rivales, minimo, centimos: config.centimos, subir: true })
      const sinRivales = rivales.length === 0
      precioNuevo = sinRivales ? Math.max(minimo, e?.precio && e.precio > 0 ? Number(e.precio) : minimo) : (d.precio ?? minimo)
      motivo = 'nueva'
      rival = d.rival
      nuevas += 1
    }

    const envioNuestro = yo ? Math.max(0, yo.total - yo.precio) : 0
    const masBaratoRival = rivales.reduce((m, r) => (r.total > 0 && r.total < m ? r.total : m), Infinity)
    publicadas += 1
    if (stock > 0) conStock += 1
    if (stock > 0 && precioNuevo + envioNuestro <= masBaratoRival + 0.001) primeros += 1

    const cambiaPrecio = !o || o.precio === null || Math.abs(precioNuevo - o.precio) >= 0.005
    const cambiaStock = !o || o.cantidad !== stock
    if (!cambiaPrecio && !cambiaStock) continue
    if (o && !cambiaPrecio && cambiaStock) motivo = 'stock'
    if (o && cambiaStock) cambiosDeStock += 1

    const fila: Record<string, unknown> = {
      pasada_at: ahora,
      sku,
      ean,
      titulo: (o?.titulo || tituloDe.get(ean) || '').slice(0, 200) || null,
      precio_antes: o?.precio ?? null,
      precio_nuevo: r2(precioNuevo),
      minimo,
      competidor_precio: rival?.total ?? null,
      competidor_tienda: rival?.tienda ?? null,
      puesto: idx >= 0 ? idx + 1 : null,
      tiendas: lista.length,
      stock_antes: o ? o.cantidad : null,
      stock_nuevo: stock,
      motivo,
      ensayo,
      enviado: false,
    }
    log.push(fila)
    if (!ensayo) {
      aSubir.push({
        nueva: !o,
        fila,
        subir: {
          sku,
          ean,
          precio: r2(precioNuevo),
          cantidad: stock,
          estadoProducto: o?.estadoProducto ?? estadoPorDefecto,
          plazoEnvioDias: o?.plazoEnvioDias ?? plazoPorDefecto,
          claseLogistica: o?.claseLogistica ?? clasePorDefecto,
          tipoIva: o?.adicionales['tipo-iva'] !== undefined ? Number(o.adicionales['tipo-iva']) : 21,
          canon: o?.adicionales['canon'] !== undefined ? Number(o.adicionales['canon']) : Number(e?.canon ?? 0) || 0,
        },
      })
    }
  }
  // Primero lo que ya está publicado (precio y stock), luego las nuevas. PcComponentes admite una subida por minuto: como mucho MAX_LOTES por pasada
  aSubir.sort((a, b) => Number(a.nueva) - Number(b.nueva))

  const importaciones: string[] = []
  const errores: string[] = []
  let pendientes = 0
  if (!ensayo && aSubir.length > 0) {
    const tope = MAX_LOTES * 500
    pendientes = Math.max(0, aSubir.length - tope)
    const estaVez = aSubir.slice(0, tope)
    for (let i = 0; i < estaVez.length; i += 500) {
      const lote = estaVez.slice(i, i + 500)
      // PcComponentes admite una subida por minuto
      if (i > 0) await new Promise((r) => setTimeout(r, 62_000))
      try {
        const { importacionId } = await subirOfertas(lote.map((x) => x.subir), FRASE_DE_CONFIRMACION)
        importaciones.push(importacionId)
        for (const x of lote) Object.assign(x.fila, { enviado: true, importacion_id: importacionId })
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e)
        errores.push(m)
        for (const x of lote) x.fila.error = m.slice(0, 300)
      }
    }
  }

  // Sin la migración 329 no existen las columnas del stock: se guarda sin ellas
  let sinColumnasDeStock = false
  const sinStock = (filas: Array<Record<string, unknown>>) =>
    filas.map((f) => {
      const c = { ...f }
      delete c.stock_antes
      delete c.stock_nuevo
      return c
    })
  for (let i = 0; i < log.length; i += 500) {
    const trozo = log.slice(i, i + 500)
    let { error } = await service.from('pcc_precios_log').insert(sinColumnasDeStock ? sinStock(trozo) : trozo)
    if (error && !sinColumnasDeStock && /stock_(antes|nuevo)/.test(error.message)) {
      sinColumnasDeStock = true
      ;({ error } = await service.from('pcc_precios_log').insert(sinStock(trozo)))
    }
    if (error) errores.push(`No se ha podido guardar el registro: ${error.message}`)
  }

  const enviados = log.filter((f) => f.enviado === true).length
  const resumen: ResumenDePasada = {
    hecho: true,
    motivo: ensayo
      ? `Ensayo: ${log.length} cambios (${nuevas} ofertas nuevas)`
      : `${enviados} de ${log.length} cambios enviados a PcComponentes (${nuevas} ofertas nuevas, ${cambiosDeStock} de stock)${pendientes > 0 ? `; ${pendientes} quedan para la próxima pasada` : ''}${stockDe ? '' : '. Sin el catálogo del proveedor en memoria: el stock no se ha tocado y no se han creado ofertas'}`,
    ensayo,
    ofertas: ofertas.length,
    nuevas,
    stock: cambiosDeStock,
    pendientes,
    conStockDelProveedor: Boolean(stockDe),
    publicadas,
    conStock,
    primeros,
    cambios: log.length,
    bajan: cuenta.bajar_bajo_rival,
    suben: cuenta.subir_bajo_siguiente + cuenta.subir_al_minimo,
    alMinimo: cuenta.al_minimo_rival_mas_barato,
    sinCoste: cuenta.sin_coste,
    enviados,
    importaciones,
    errores,
  }
  await service.from('pcc_precios_config').update({ ultimo_resumen: { ...resumen, at: ahora } }).eq('unica', true)
  return resumen
}

export interface FilaDeLog {
  id: number
  pasada_at: string
  sku: string
  titulo: string | null
  precio_antes: number | null
  precio_nuevo: number | null
  minimo: number | null
  competidor_precio: number | null
  competidor_tienda: string | null
  puesto: number | null
  tiendas: number | null
  motivo: MotivoDinamico
  ensayo: boolean
  enviado: boolean
  error: string | null
}

export async function ultimosCambios(limite = 300): Promise<FilaDeLog[]> {
  const { data, error } = await createServiceClient().from('pcc_precios_log').select('id, pasada_at, sku, titulo, precio_antes, precio_nuevo, minimo, competidor_precio, competidor_tienda, puesto, tiendas, motivo, ensayo, enviado, error').order('pasada_at', { ascending: false }).order('id', { ascending: false }).limit(limite)
  if (error) throw isMissingSchema(error) ? new FaltaMigracion321() : error
  return (data ?? []) as FilaDeLog[]
}
