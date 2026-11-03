import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { buscarProductosPorEan } from './mirakl'

/**
 * EL MERCADO DE CADA PRODUCTO DEL PROVEEDOR EN PCCOMPONENTES — SOLO SERVIDOR.
 * ===========================================================================
 * Cruza dos cosas que ya existen y las guarda para no volver a preguntar:
 *
 *   · el COSTE y el EAN de cada producto: `entrais_precios`, que alimenta el ciclo de stock. NO gasta ninguna llamada al proveedor.
 *   · lo que hay en el catálogo de PcComponentes (existencia, categoría, tiendas, precio más bajo): P11, de 100 en 100, guardado en `pcc_mercado`.
 *
 * Preguntar por todos son unas 63 llamadas y casi dos minutos, así que se hace por tramos desde un botón y la pantalla lee lo guardado.
 * El EAN de `entrais_precios` lo escribe el motor de precios en cada recálculo (migración 269): sin recalcular, no hay EAN que preguntar.
 */

export const FALTA_LA_MIGRACION_270 = 'Falta lanzar la migración 270 (tabla pcc_mercado): sin ella no hay dónde guardar lo que se lee de PcComponentes.'

const faltaLaTabla = (e: { code?: string } | null) => e?.code === '42P01' || e?.code === 'PGRST205'

export interface FilaMercado {
  sku: string
  ean: string
  /** Proveedor + canon + porte, sin IVA */
  coste: number
  titulo: string
  marca: string | null
  categoria: string | null
  ofertas: number
  precioMin: number | null
  tiendaMin: string | null
}

export interface LecturaMercado {
  filas: FilaMercado[]
  /** Productos del proveedor con EAN: es lo que se pregunta */
  conEan: number
  /** Cuántos EAN se han preguntado ya (existan o no) */
  comprobados: number
  existen: number
  actualizadoAt: string | null
}

interface FilaPrecios {
  sku: string
  ean: string | null
  coste: number | null
}

interface FilaGuardada {
  ean: string
  existe: boolean
  titulo: string | null
  marca: string | null
  categoria: string | null
  ofertas: number
  precio_min: number | null
  tienda_min: string | null
  actualizado_at: string
}

async function productosConEan(): Promise<FilaPrecios[]> {
  const service = createServiceClient()
  const filas = await fetchAll<FilaPrecios>((a, b) => service.from('entrais_precios').select('sku, ean, coste').not('ean', 'is', null).order('sku', { ascending: true }).range(a, b))
  return filas.filter((f) => f.ean)
}

export async function leerMercado(): Promise<LecturaMercado> {
  const service = createServiceClient()
  const productos = await productosConEan()
  let guardadas: FilaGuardada[]
  try {
    guardadas = await fetchAll<FilaGuardada>((a, b) =>
      service.from('pcc_mercado').select('ean, existe, titulo, marca, categoria, ofertas, precio_min, tienda_min, actualizado_at').order('ean', { ascending: true }).range(a, b)
    )
  } catch (error) {
    if (faltaLaTabla(error as { code?: string })) throw new Error(FALTA_LA_MIGRACION_270)
    throw error
  }
  const porEan = new Map(guardadas.map((g) => [g.ean, g]))
  const filas: FilaMercado[] = []
  for (const p of productos) {
    const g = porEan.get(p.ean!)
    const coste = Number(p.coste)
    if (!g || !g.existe || !(coste > 0)) continue
    filas.push({
      sku: p.sku,
      ean: p.ean!,
      coste,
      titulo: g.titulo ?? '',
      marca: g.marca,
      categoria: g.categoria,
      ofertas: g.ofertas,
      precioMin: g.precio_min === null ? null : Number(g.precio_min),
      tiendaMin: g.tienda_min,
    })
  }
  return {
    filas,
    conEan: new Set(productos.map((p) => p.ean)).size,
    comprobados: guardadas.length,
    existen: guardadas.filter((g) => g.existe).length,
    actualizadoAt: guardadas.reduce<string | null>((m, g) => (m === null || g.actualizado_at > m ? g.actualizado_at : m), null),
  }
}

export interface ResultadoDeTramo {
  desde: number
  procesados: number
  existen: number
  /** null = ya se ha recorrido todo */
  siguiente: number | null
  total: number
}

/**
 * A PcComponentes se le pregunta despacio. A 700 ms entre llamadas (≈ 85 por minuto) acabó contestando 429 «Too Many Requests» —y al mismo tiempo la propia
 * pantalla, que lee la cuenta y las ofertas, también—. Con unos 2,2 s por llamada (≈ 26 por minuto) se recorrió el catálogo entero sin un solo corte.
 */
const PAUSA_ENTRE_LLAMADAS_MS = 2000
/** Esperas antes de reintentar una llamada que PcComponentes ha cortado: 8 s, 15 s y 25 s */
const ESPERAS_DE_REINTENTO_MS = [8000, 15000, 25000]

/**
 * Pregunta a PcComponentes por un tramo de EAN y guarda el resultado (también de los que no existen).
 * Un tramo de 1.000 son 10 llamadas y unos 25 segundos: la pantalla los encadena hasta terminar.
 */
export async function actualizarTramo(desde: number, max = 1000): Promise<ResultadoDeTramo> {
  const service = createServiceClient()
  const eans = [...new Set((await productosConEan()).map((p) => p.ean!))].sort()
  const tramo = eans.slice(desde, desde + max)
  const ahora = new Date().toISOString()
  let existen = 0

  for (let i = 0; i < tramo.length; i += 100) {
    const trozo = tramo.slice(i, i + 100)
    let hallados: Awaited<ReturnType<typeof buscarProductosPorEan>> | null = null
    for (let intento = 0; hallados === null; intento++) {
      try {
        hallados = await buscarProductosPorEan(trozo)
      } catch (error) {
        if (intento >= ESPERAS_DE_REINTENTO_MS.length) throw error
        await new Promise((r) => setTimeout(r, ESPERAS_DE_REINTENTO_MS[intento]))
      }
    }
    const filas = trozo.map((ean) => {
      const p = hallados!.get(ean)
      if (p) existen++
      return {
        ean,
        existe: p !== undefined,
        producto_id: p?.productoId ?? null,
        titulo: p?.titulo ?? null,
        marca: p?.marca ?? null,
        categoria: p?.categoria ?? null,
        ofertas: p?.ofertas ?? 0,
        precio_min: p?.precioMinimo ?? null,
        tienda_min: p?.tiendaMasBarata ?? null,
        actualizado_at: ahora,
      }
    })
    const { error } = await service.from('pcc_mercado').upsert(filas, { onConflict: 'ean' })
    if (error) {
      if (faltaLaTabla(error)) throw new Error(FALTA_LA_MIGRACION_270)
      throw error
    }
    await new Promise((r) => setTimeout(r, PAUSA_ENTRE_LLAMADAS_MS))
  }

  return { desde, procesados: tramo.length, existen, siguiente: desde + max < eans.length ? desde + max : null, total: eans.length }
}
