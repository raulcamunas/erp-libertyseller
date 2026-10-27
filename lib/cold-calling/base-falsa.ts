import { crearCliente, type Consulta, type ErrorDeBase, type Fila, type Resultado } from '@/lib/correo/secuencias/cliente-falso'

/**
 * UNA BASE DE MENTIRA PARA LAS PRUEBAS DE LAS LISTAS Y DE LOS PUESTOS — SOLO LA USAN LOS FICHEROS `.prueba.ts`. No se importa desde la aplicación.
 *
 * Apunta cada función SQL (`rpc`) que se llama, cada lectura y cada escritura, y contesta lo que se le diga. Lo que no se defina NO EXISTE, como en una base sin la
 * migración 257: una función que falta contesta PGRST202 y una tabla que falta PGRST205. Las lecturas aplican los filtros `eq`, para que "los permisos de Cold Calling" no
 * devuelvan los de todas las apps. Está hecha sobre el cliente falso de las secuencias (`crearCliente`), así que habla igual que el de Supabase.
 */

export interface LlamadaRpc {
  nombre: string
  args: Record<string, unknown>
}

export interface Escritura {
  tabla: string
  op: 'insert' | 'update' | 'upsert' | 'delete'
  valores: unknown
  filtros: Array<{ col: string; valor: unknown }>
}

type Respuesta = unknown | ((args: Record<string, unknown>) => unknown)

export interface OpcionesDeLaBaseFalsa {
  /** Lo que contesta cada función SQL. Si es una función, recibe los argumentos */
  rpc?: Record<string, Respuesta>
  /** Funciones SQL que existen pero fallan con este error */
  fallan?: Record<string, ErrorDeBase>
  /** Las tablas, con sus filas */
  tablas?: Record<string, Fila[]>
  /** Tablas que existen pero fallan con este error al leerlas o escribirlas */
  tablasQueFallan?: Record<string, ErrorDeBase>
  /** Columnas que no existen en una tabla (como `puesto` antes de la migración 257): pedirlas o escribirlas da el error 42703 de la base */
  columnasQueFaltan?: Record<string, string[]>
}

export function baseFalsa(opciones: OpcionesDeLaBaseFalsa = {}) {
  const rpcs: LlamadaRpc[] = []
  const lecturas: Consulta[] = []
  const escrituras: Escritura[] = []

  const columnaQueFalta = (tabla: string, columnas: string[]): string | null => (opciones.columnasQueFaltan?.[tabla] ?? []).find((c) => columnas.includes(c)) ?? null

  const service = crearCliente(async (c: Consulta): Promise<Resultado> => {
    if (c.op === 'rpc') {
      const { nombre, args } = c.rpc!
      rpcs.push({ nombre, args })
      const error = opciones.fallan?.[nombre]
      if (error) return { data: null, error, count: null }
      if (!opciones.rpc || !(nombre in opciones.rpc)) return { data: null, error: { code: 'PGRST202', message: `No existe la función ${nombre}` }, count: null }
      const r = opciones.rpc[nombre]
      return { data: typeof r === 'function' ? (r as (a: Record<string, unknown>) => unknown)(args) : r, error: null, count: null }
    }

    const fallo = opciones.tablasQueFallan?.[c.tabla]
    if (c.op === 'select') {
      lecturas.push(c)
      if (fallo) return { data: null, error: fallo, count: null }
      const falta = columnaQueFalta(c.tabla, c.columnas.split(',').map((x) => x.trim()))
      if (falta) return { data: null, error: { code: '42703', message: `column ${c.tabla}.${falta} does not exist` }, count: null }
      const todas = opciones.tablas?.[c.tabla]
      if (!todas) return { data: null, error: { code: 'PGRST205', message: `No existe la tabla ${c.tabla}` }, count: null }
      const filas = todas.filter((f) => c.filtros.every((x) => x.op !== 'eq' || f[x.col] === x.valor))
      return { data: c.rango ? filas.slice(c.rango[0], c.rango[1] + 1) : filas, error: null, count: null }
    }

    escrituras.push({ tabla: c.tabla, op: c.op, valores: c.valores, filtros: c.filtros.map((f) => ({ col: f.col, valor: f.valor })) })
    if (fallo) return { data: null, error: fallo, count: null }
    const claves = c.valores && typeof c.valores === 'object' && !Array.isArray(c.valores) ? Object.keys(c.valores as Record<string, unknown>) : []
    const falta = columnaQueFalta(c.tabla, claves)
    if (falta) return { data: null, error: { code: '42703', message: `column ${c.tabla}.${falta} does not exist` }, count: null }
    if (!opciones.tablas?.[c.tabla]) return { data: null, error: { code: 'PGRST205', message: `No existe la tabla ${c.tabla}` }, count: null }
    return { data: null, error: null, count: null }
  })

  return { service, rpcs, lecturas, escrituras }
}
