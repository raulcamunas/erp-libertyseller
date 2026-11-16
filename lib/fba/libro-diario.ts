import { createServiceClient } from '@/lib/supabase/service'
import { leerTodo } from './paginar'

/**
 * EL LIBRO MAYOR AGREGADO POR REFERENCIA Y DÍA (spec remesas-pro §11 D29). SOLO SERVIDOR, SOLO LECTURA.
 * ==================================================================================================
 * El ritmo, las ventas y la estacionalidad no necesitan cada movimiento del libro, sino la suma por SKU, día, tipo y
 * disposición. La migración 316 trae la función `fba_movimientos_diarios`, que lo agrega en la base y evita paginar miles de
 * filas. Mientras no esté lanzada, se lee con `leerTodo` como hasta ahora y se agrega aquí: mismo resultado, más lento.
 *
 * Lo comparten S1 (plan), S4 (alertas y propuesta a medida) y S5 (ventas). La forma de cada fila es la de la función.
 */

type Servicio = ReturnType<typeof createServiceClient>

/** Una fila del libro agregado (forma de `fba_movimientos_diarios`) */
export interface MovimientoDiario {
  sku: string
  /** 'YYYY-MM-DD' */
  fecha: string
  /** Shipments, CustomerReturns, Receipts, VendorReturns, Adjustments, WhseTransfers… */
  tipo: string
  disposicion: string | null
  /** Suma con signo, como la manda Amazon (Shipments y VendorReturns en negativo) */
  cantidad: number
}

/** «Esa función no existe»: PostgREST la busca en su caché de esquema (PGRST202); Postgres, 42883 */
const faltaLaFuncion = (e: { code?: string } | null | undefined): boolean => e?.code === 'PGRST202' || e?.code === '42883'

/** Agrega movimientos sueltos por SKU, día, tipo y disposición (lo que hace la función de la 316), ordenado por fecha y SKU */
export function agregarPorDia(filas: Array<{ sku: string; fecha: string; tipo: string; disposicion: string | null; cantidad: number | string | null }>): MovimientoDiario[] {
  const sumas = new Map<string, MovimientoDiario>()
  for (const f of filas) {
    const fecha = String(f.fecha).slice(0, 10)
    const clave = `${f.sku}\u0000${fecha}\u0000${f.tipo}\u0000${f.disposicion ?? '\u0001nulo'}`
    const x = sumas.get(clave)
    const c = Number(f.cantidad) || 0
    if (x) x.cantidad += c
    else sumas.set(clave, { sku: f.sku, fecha, tipo: f.tipo, disposicion: f.disposicion ?? null, cantidad: c })
  }
  return [...sumas.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.sku.localeCompare(b.sku))
}

/**
 * Los movimientos de una conexión y un mercado entre `desde` y `hasta` (incluidos), agregados por día.
 * Con la función de la 316, paginada de mil en mil (PostgREST corta las funciones igual que las tablas) y con un orden
 * único (sku, fecha, tipo y disposición son la clave del agregado). Sin ella, el libro entero y se agrega en memoria.
 * Un error que no sea «falta la función» no se traga: un ritmo con ventas de menos es peor que un fallo.
 */
export async function leerLibroDiario(service: Servicio, conexion: string, mercado: string, desde: string, hasta: string): Promise<MovimientoDiario[]> {
  const parametros = { p_conexion: conexion, p_mercado: mercado, p_desde: desde, p_hasta: hasta }
  try {
    const filas = await leerTodo<{ sku: string; fecha: string; tipo: string; disposicion: string | null; cantidad: number | string }>((a, b) =>
      service
        .rpc('fba_movimientos_diarios', parametros)
        .order('fecha', { ascending: true })
        .order('sku', { ascending: true })
        .order('tipo', { ascending: true })
        .order('disposicion', { ascending: true, nullsFirst: true })
        .range(a, b)
    )
    return filas.map((f) => ({ sku: f.sku, fecha: String(f.fecha).slice(0, 10), tipo: f.tipo, disposicion: f.disposicion ?? null, cantidad: Number(f.cantidad) || 0 }))
  } catch (e) {
    if (!faltaLaFuncion(e as { code?: string })) throw e
  }

  const sueltas = await leerTodo<{ sku: string; fecha: string; tipo: string; disposicion: string | null; cantidad: number }>((a, b) =>
    service
      .from('fba_movimientos')
      .select('sku, fecha, tipo, disposicion, cantidad')
      .eq('connection_id', conexion)
      .eq('marketplace_id', mercado)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b)
  )
  return agregarPorDia(sueltas)
}
