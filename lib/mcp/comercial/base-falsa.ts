import type { Servicio } from '../contexto'

/**
 * UNA BASE DE MENTIRA EN MEMORIA — SOLO PARA LAS PRUEBAS DE LAS HERRAMIENTAS DEL EQUIPO COMERCIAL.
 * No se importa desde la aplicación: solo desde los `.prueba.ts` de esta carpeta.
 *
 * Imita la parte del cliente de Supabase que usan estas herramientas (solo lectura): from/select (con count y head)/eq/neq/gt/gte/lt/lte/in/is/not/ilike/or/
 * order/range/limit/maybeSingle/single y rpc; y, para probar lo que escribe poco (los lectores de correo), insert (con claves únicas) y delete. Es ESTRICTA en lo que pilla errores de verdad: `select('a, b')` devuelve SOLO esas columnas (como PostgREST), así que
 * un campo que se lee sin pedirlo sale `undefined` en la prueba; y con `columnas` por tabla, una columna que no existe da el 42703 que daría la base.
 *
 * Lo que NO imita: la semántica fina de Postgres (collation, husos horarios, índices). Eso se comprueba contra la base real, en solo lectura.
 */

type Fila = Record<string, unknown>

export interface OpcionesDeBase {
  /** Las columnas que forman la clave única de cada tabla: insertar una fila repetida da el 23505 de la base */
  unicos?: Record<string, readonly string[]>
  /** Columnas que existen por tabla: si se da, pedir o filtrar por otra falla con 42703 */
  columnas?: Record<string, readonly string[]>
  /** Las funciones de la base (rpc): reciben los argumentos y devuelven las filas */
  rpc?: Record<string, (args: Record<string, unknown>) => Fila[]>
}

interface ErrorFalso {
  code: string
  message: string
}

type Predicado = (f: Fila) => boolean

function comparar(a: unknown, b: unknown): number {
  const esFecha = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)
  if (esFecha(a) && esFecha(b)) return Date.parse(a) - Date.parse(b)
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const x = String(a)
  const y = String(b)
  return x < y ? -1 : x > y ? 1 : 0
}

function patron(p: string): RegExp {
  let r = ''
  for (const c of p) {
    if (c === '%') r += '[\\s\\S]*'
    else if (c === '_') r += '[\\s\\S]'
    else r += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${r}$`, 'i')
}

/** Los trozos de un `or(a.ilike.%x%,b.eq.y)`, separados por las comas de primer nivel */
function trocearOr(texto: string): string[] {
  const trozos: string[] = []
  let actual = ''
  let nivel = 0
  for (const c of texto) {
    if (c === '(') nivel++
    if (c === ')') nivel--
    if (c === ',' && nivel === 0) {
      trozos.push(actual)
      actual = ''
    } else actual += c
  }
  if (actual) trozos.push(actual)
  return trozos
}

class Consulta implements PromiseLike<{ data: unknown; error: ErrorFalso | null; count: number | null }> {
  private filtros: Array<{ col: string | null; pred: Predicado }> = []
  private ordenes: Array<{ col: string; asc: boolean; nullsFirst?: boolean }> = []
  private rango: [number, number] | null = null
  private tope: number | null = null
  private columnasPedidas: string[] | null = null
  private contar = false
  private soloCabecera = false
  private modo: 'lista' | 'uno' | 'quizas' = 'lista'
  private operacion: 'select' | 'insert' | 'delete' = 'select'
  private nuevas: Fila[] = []

  constructor(
    private readonly tabla: string,
    private readonly filas: Fila[] | null,
    private readonly opciones: OpcionesDeBase,
    private readonly errores: Map<string, ErrorFalso>,
    private readonly rpc: { nombre: string; args: Record<string, unknown> } | null = null
  ) {}

  insert(valores: Fila | Fila[]): this {
    this.operacion = 'insert'
    this.nuevas = Array.isArray(valores) ? valores : [valores]
    return this
  }
  delete(): this {
    this.operacion = 'delete'
    return this
  }

  select(columnas = '*', opciones?: { count?: 'exact'; head?: boolean }): this {
    this.columnasPedidas = columnas.trim() === '*' ? null : columnas.split(',').map((c) => c.trim()).filter(Boolean)
    if (opciones?.count) this.contar = true
    if (opciones?.head) this.soloCabecera = true
    return this
  }
  private añadir(col: string | null, pred: Predicado): this {
    this.filtros.push({ col, pred })
    return this
  }
  eq(col: string, v: unknown): this {
    return this.añadir(col, (f) => f[col] !== null && f[col] !== undefined && comparar(f[col], v) === 0)
  }
  neq(col: string, v: unknown): this {
    return this.añadir(col, (f) => f[col] === null || f[col] === undefined || comparar(f[col], v) !== 0)
  }
  gt(col: string, v: unknown): this {
    return this.añadir(col, (f) => f[col] != null && comparar(f[col], v) > 0)
  }
  gte(col: string, v: unknown): this {
    return this.añadir(col, (f) => f[col] != null && comparar(f[col], v) >= 0)
  }
  lt(col: string, v: unknown): this {
    return this.añadir(col, (f) => f[col] != null && comparar(f[col], v) < 0)
  }
  lte(col: string, v: unknown): this {
    return this.añadir(col, (f) => f[col] != null && comparar(f[col], v) <= 0)
  }
  in(col: string, vs: readonly unknown[]): this {
    return this.añadir(col, (f) => vs.some((v) => f[col] != null && comparar(f[col], v) === 0))
  }
  is(col: string, v: null | boolean): this {
    return this.añadir(col, (f) => (v === null ? f[col] === null || f[col] === undefined : f[col] === v))
  }
  not(col: string, operador: string, v: unknown): this {
    if (operador !== 'is') throw new Error(`La base falsa solo entiende not(…, 'is', …), no «${operador}»`)
    return this.añadir(col, (f) => (v === null ? f[col] !== null && f[col] !== undefined : f[col] !== v))
  }
  ilike(col: string, p: string): this {
    const re = patron(p)
    return this.añadir(col, (f) => typeof f[col] === 'string' && re.test(f[col] as string))
  }
  /** `or('store_name.ilike.%x%,company.ilike.%x%')`: solo ilike y eq, que es lo que usan estas herramientas */
  or(expresion: string): this {
    const ramas = trocearOr(expresion).map((t) => {
      const [col, op, ...resto] = t.split('.')
      const valor = resto.join('.')
      if (op === 'ilike') {
        const re = patron(valor)
        return (f: Fila) => typeof f[col] === 'string' && re.test(f[col] as string)
      }
      if (op === 'eq') return (f: Fila) => f[col] != null && String(f[col]) === valor
      throw new Error(`La base falsa solo entiende or() con ilike y eq, no «${op}»`)
    })
    return this.añadir(null, (f) => ramas.some((r) => r(f)))
  }
  order(col: string, opciones?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.ordenes.push({ col, asc: opciones?.ascending !== false, nullsFirst: opciones?.nullsFirst })
    return this
  }
  range(desde: number, hasta: number): this {
    this.rango = [desde, hasta]
    return this
  }
  limit(n: number): this {
    this.tope = n
    return this
  }
  maybeSingle(): this {
    this.modo = 'quizas'
    return this
  }
  single(): this {
    this.modo = 'uno'
    return this
  }

  private comprobarColumnas(cols: readonly string[]): ErrorFalso | null {
    const validas = this.opciones.columnas?.[this.tabla]
    if (!validas) return null
    const mala = cols.find((c) => !validas.includes(c))
    return mala ? { code: '42703', message: `column ${this.tabla}.${mala} does not exist` } : null
  }

  private ejecutar(): { data: unknown; error: ErrorFalso | null; count: number | null } {
    if (this.rpc) {
      const f = this.opciones.rpc?.[this.rpc.nombre]
      if (!f) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${this.rpc.nombre}` }, count: null }
      let filas = f(this.rpc.args)
      if (this.rango) filas = filas.slice(this.rango[0], this.rango[1] + 1)
      return { data: filas, error: null, count: null }
    }
    const inyectado = this.errores.get(this.tabla)
    if (inyectado) return { data: null, error: inyectado, count: null }
    if (this.filas === null) return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${this.tabla}' in the schema cache` }, count: null }

    if (this.operacion === 'insert') {
      const unicos = this.opciones.unicos?.[this.tabla]
      const existentes = this.filas
      for (const nueva of this.nuevas) {
        if (unicos && existentes.some((f) => unicos.every((c) => comparar(f[c], nueva[c]) === 0))) {
          return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${this.tabla}` }, count: null }
        }
        existentes.push(structuredClone(nueva))
      }
      return { data: null, error: null, count: null }
    }
    if (this.operacion === 'delete') {
      const quitar = this.filas.filter((f) => this.filtros.every((x) => x.pred(f)))
      for (const f of quitar) this.filas.splice(this.filas.indexOf(f), 1)
      return { data: null, error: null, count: null }
    }

    const malas = this.comprobarColumnas([...(this.columnasPedidas ?? []), ...this.filtros.map((f) => f.col).filter((c): c is string => !!c), ...this.ordenes.map((o) => o.col)])
    if (malas) return { data: null, error: malas, count: null }

    let salida = this.filas.filter((f) => this.filtros.every((x) => x.pred(f)))
    const total = salida.length
    if (this.ordenes.length > 0) {
      salida = [...salida].sort((a, b) => {
        for (const o of this.ordenes) {
          const x = a[o.col]
          const y = b[o.col]
          if (x == null && y == null) continue
          // Como Postgres: sin decir nada, los nulos van al final al subir y al principio al bajar; `nullsFirst` lo manda
          const nulosPrimero = o.nullsFirst ?? !o.asc
          if (x == null) return nulosPrimero ? -1 : 1
          if (y == null) return nulosPrimero ? 1 : -1
          const c = comparar(x, y)
          if (c !== 0) return o.asc ? c : -c
        }
        return 0
      })
    }
    // Como PostgREST: sin pedir más, 1.000 filas como mucho
    const techo = 1000
    if (this.rango) salida = salida.slice(this.rango[0], Math.min(this.rango[1] + 1, this.rango[0] + techo))
    else salida = salida.slice(0, Math.min(this.tope ?? techo, techo))
    if (this.columnasPedidas) {
      const cols = this.columnasPedidas
      salida = salida.map((f) => Object.fromEntries(cols.map((c) => [c, f[c]])))
    }
    const count = this.contar ? total : null
    if (this.soloCabecera) return { data: null, error: null, count }
    if (this.modo === 'lista') return { data: structuredClone(salida), error: null, count }
    if (salida.length === 0) return this.modo === 'quizas' ? { data: null, error: null, count } : { data: null, error: { code: 'PGRST116', message: 'no rows' }, count }
    return { data: structuredClone(salida[0]), error: null, count }
  }

  then<A = { data: unknown; error: ErrorFalso | null; count: number | null }, B = never>(
    alExito?: ((r: { data: unknown; error: ErrorFalso | null; count: number | null }) => A | PromiseLike<A>) | null,
    alFallo?: ((e: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.ejecutar()).then(alExito, alFallo)
  }
}

export interface BaseFalsa {
  servicio: Servicio
  tablas: Map<string, Fila[] | null>
  errores: Map<string, ErrorFalso>
  /** Las peticiones hechas, en orden: «tabla.select» o «rpc:nombre» */
  peticiones: string[]
}

/** Una tabla en `null` es una tabla que no existe (la migración sin lanzar) */
export function crearBaseFalsa(datos: Record<string, Fila[] | null>, opciones: OpcionesDeBase = {}): BaseFalsa {
  const tablas = new Map<string, Fila[] | null>(Object.entries(datos))
  const errores = new Map<string, ErrorFalso>()
  const peticiones: string[] = []
  const servicio = {
    from: (tabla: string) => ({
      select: (columnas = '*', op?: { count?: 'exact'; head?: boolean }) => {
        peticiones.push(`${tabla}.select`)
        return new Consulta(tabla, tablas.has(tabla) ? tablas.get(tabla)! : null, opciones, errores).select(columnas, op)
      },
      insert: (valores: Fila | Fila[]) => {
        peticiones.push(`${tabla}.insert`)
        return new Consulta(tabla, tablas.has(tabla) ? tablas.get(tabla)! : null, opciones, errores).insert(valores)
      },
      delete: () => {
        peticiones.push(`${tabla}.delete`)
        return new Consulta(tabla, tablas.has(tabla) ? tablas.get(tabla)! : null, opciones, errores).delete()
      },
    }),
    rpc: (nombre: string, args: Record<string, unknown> = {}) => {
      peticiones.push(`rpc:${nombre}`)
      return new Consulta('', [], opciones, errores, { nombre, args })
    },
  } as unknown as Servicio
  return { servicio, tablas, errores, peticiones }
}
