/**
 * UNA BASE DE DATOS FALSA, EN MEMORIA, PARA LAS PRUEBAS DEL SERVIDOR DE REMESAS.
 * ==============================================================================
 * SOLO PARA *.prueba.ts. Imita lo justo del cliente de Supabase (from → select/insert/update/delete/upsert, los
 * filtros eq/neq/in/is/not/gte/lte/gt, order, range/limit, single/maybeSingle y `{ count, head }`) sobre tablas en
 * memoria, para probar la lógica que escribe sin tocar producción.
 *
 * Se pueden simular:
 * - tablas que no existen (`sinTablas`: la migración sin lanzar → 42P01),
 * - columnas que no existen (`sinColumnas`: PGRST204 al escribirlas o leerlas),
 * - índices únicos (`unicos`: 23505),
 * - fallos a medida (`fallar(q)` devuelve un error para una operación concreta).
 */

export interface ErrorFalso { code: string; message: string }
type Fila = Record<string, unknown>

export interface OperacionFalsa {
  tabla: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  payload: unknown
  filtros: Array<{ tipo: string; columna: string; valor: unknown }>
  columnas: string | null
}

export interface OpcionesBaseFalsa {
  tablas?: Record<string, Fila[]>
  sinTablas?: string[]
  sinColumnas?: Record<string, string[]>
  /** Índices únicos parciales: tabla → columnas (solo cuentan las filas con todas no nulas) */
  unicos?: Record<string, string[][]>
  fallar?: (q: OperacionFalsa) => ErrorFalso | null
}

let contador = 0
const nuevoId = () => {
  contador++
  const h = contador.toString(16).padStart(12, '0')
  return `00000000-0000-4000-8000-${h}`
}

export function baseFalsa(opciones: OpcionesBaseFalsa = {}) {
  const tablas: Record<string, Fila[]> = {}
  for (const [t, filas] of Object.entries(opciones.tablas ?? {})) tablas[t] = filas.map((f) => ({ ...f }))
  const operaciones: OperacionFalsa[] = []

  const cumple = (f: Fila, filtros: OperacionFalsa['filtros']) =>
    filtros.every(({ tipo, columna, valor }) => {
      const v = f[columna]
      switch (tipo) {
        case 'eq': return v === valor
        case 'neq': return v !== valor
        case 'in': return (valor as unknown[]).includes(v)
        case 'is': return valor === null ? v === null || v === undefined : v === valor
        case 'not_is_null': return v !== null && v !== undefined
        case 'gte': return v != null && String(v) >= String(valor)
        case 'lte': return v != null && String(v) <= String(valor)
        case 'gt': return v != null && (typeof v === 'number' ? v > (valor as number) : String(v) > String(valor))
        default: return true
      }
    })

  const columnaQueFalta = (tabla: string, claves: string[]): string | null => {
    const faltan = opciones.sinColumnas?.[tabla] ?? []
    return claves.find((c) => faltan.includes(c)) ?? null
  }

  function from(tabla: string) {
    const estado: OperacionFalsa & {
      devolver: boolean; modo: 'lista' | 'single' | 'maybe'; desde: number | null; hasta: number | null; limite: number | null
      contar: boolean; cabeza: boolean
    } = { tabla, op: 'select', payload: null, filtros: [], columnas: null, devolver: false, modo: 'lista', desde: null, hasta: null, limite: null, contar: false, cabeza: false }

    const ejecutar = (): { data: unknown; error: ErrorFalso | null; count?: number | null } => {
      operaciones.push({ tabla, op: estado.op, payload: estado.payload, filtros: [...estado.filtros], columnas: estado.columnas })
      if (opciones.sinTablas?.includes(tabla)) return { data: null, error: { code: '42P01', message: `relation "public.${tabla}" does not exist` } }
      const aMedida = opciones.fallar?.(operaciones[operaciones.length - 1])
      if (aMedida) return { data: null, error: aMedida }
      const t = (tablas[tabla] ??= [])

      if (estado.op === 'select') {
        const pedidas = estado.columnas && estado.columnas !== '*' ? estado.columnas.split(',').map((c) => c.trim()) : []
        const falta = columnaQueFalta(tabla, pedidas)
        if (falta) return { data: null, error: { code: '42703', message: `column ${tabla}.${falta} does not exist` } }
        let filas = t.filter((f) => cumple(f, estado.filtros))
        const total = filas.length
        if (estado.desde !== null && estado.hasta !== null) filas = filas.slice(estado.desde, estado.hasta + 1)
        if (estado.limite !== null) filas = filas.slice(0, estado.limite)
        if (estado.cabeza) return { data: null, error: null, count: total }
        return terminar(filas.map((f) => ({ ...f })), estado.contar ? total : undefined)
      }

      if (estado.op === 'insert' || estado.op === 'upsert') {
        const nuevas = (Array.isArray(estado.payload) ? estado.payload : [estado.payload]) as Fila[]
        for (const n of nuevas) {
          const falta = columnaQueFalta(tabla, Object.keys(n))
          if (falta) return { data: null, error: { code: 'PGRST204', message: `Could not find the '${falta}' column of '${tabla}' in the schema cache` } }
        }
        const metidas: Fila[] = []
        for (const n of nuevas) {
          const fila: Fila = { id: nuevoId(), ...n }
          for (const cols of opciones.unicos?.[tabla] ?? []) {
            if (cols.some((c) => fila[c] == null)) continue
            if (t.some((f) => cols.every((c) => f[c] === fila[c]))) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint (${cols.join(', ')})` } }
          }
          t.push(fila)
          metidas.push({ ...fila })
        }
        return terminar(estado.devolver ? metidas : null)
      }

      if (estado.op === 'update') {
        const cambios = estado.payload as Fila
        const falta = columnaQueFalta(tabla, Object.keys(cambios))
        if (falta) return { data: null, error: { code: 'PGRST204', message: `Could not find the '${falta}' column of '${tabla}' in the schema cache` } }
        const tocadas = t.filter((f) => cumple(f, estado.filtros))
        for (const f of tocadas) Object.assign(f, cambios)
        return terminar(estado.devolver ? tocadas.map((f) => ({ ...f })) : null)
      }

      // delete
      const quedan = t.filter((f) => !cumple(f, estado.filtros))
      const borradas = t.filter((f) => cumple(f, estado.filtros))
      tablas[tabla] = quedan
      return terminar(estado.devolver ? borradas : null)
    }

    const terminar = (filas: Fila[] | null, count?: number) => {
      if (estado.modo === 'lista') return { data: filas, error: null, count: count ?? null }
      const lista = filas ?? []
      if (estado.modo === 'single' && lista.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
      if (estado.modo === 'maybe' && lista.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } }
      return { data: lista[0] ?? null, error: null }
    }

    const q = {
      select(columnas?: string, opts?: { count?: string; head?: boolean }) {
        if (estado.op === 'select') estado.columnas = columnas ?? '*'
        else estado.devolver = true
        if (opts?.count) estado.contar = true
        if (opts?.head) estado.cabeza = true
        return q
      },
      insert(p: unknown) { estado.op = 'insert'; estado.payload = p; return q },
      upsert(p: unknown) { estado.op = 'upsert'; estado.payload = p; return q },
      update(p: unknown) { estado.op = 'update'; estado.payload = p; return q },
      delete() { estado.op = 'delete'; return q },
      eq(c: string, v: unknown) { estado.filtros.push({ tipo: 'eq', columna: c, valor: v }); return q },
      neq(c: string, v: unknown) { estado.filtros.push({ tipo: 'neq', columna: c, valor: v }); return q },
      in(c: string, v: unknown[]) { estado.filtros.push({ tipo: 'in', columna: c, valor: v }); return q },
      is(c: string, v: unknown) { estado.filtros.push({ tipo: 'is', columna: c, valor: v }); return q },
      not(c: string, op: string, v: unknown) {
        if (op === 'is' && v === null) estado.filtros.push({ tipo: 'not_is_null', columna: c, valor: null })
        return q
      },
      gte(c: string, v: unknown) { estado.filtros.push({ tipo: 'gte', columna: c, valor: v }); return q },
      lte(c: string, v: unknown) { estado.filtros.push({ tipo: 'lte', columna: c, valor: v }); return q },
      gt(c: string, v: unknown) { estado.filtros.push({ tipo: 'gt', columna: c, valor: v }); return q },
      order() { return q },
      range(a: number, b: number) { estado.desde = a; estado.hasta = b; return q },
      limit(n: number) { estado.limite = n; return q },
      single() { estado.modo = 'single'; return Promise.resolve(ejecutar()) },
      maybeSingle() { estado.modo = 'maybe'; return Promise.resolve(ejecutar()) },
      then<A, B>(ok: (v: ReturnType<typeof ejecutar>) => A, ko?: (e: unknown) => B) {
        return Promise.resolve(ejecutar()).then(ok, ko)
      },
    }
    return q
  }

  return { cliente: { from } as unknown, tablas: () => tablas, operaciones }
}
