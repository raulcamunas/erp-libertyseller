import { partesDeMadrid } from './fechas'

/**
 * UN SUPABASE DE MENTIRA EN MEMORIA — SOLO PARA LAS PRUEBAS DE LAS SECUENCIAS.
 * ============================================================================
 * Solo lo usan los ficheros `.prueba.ts` de esta carpeta. No se importa desde la aplicación.
 *
 * Imita la parte del cliente de Supabase que usa almacen.ts (from/select/eq/in/is/not/gt/gte/lt/lte/ilike/order/limit/range/maybeSingle/
 * single/insert/update/upsert/delete/rpc) sobre tablas que son listas de objetos, y repite en JavaScript las funciones SQL de la migración 245
 * (reservar pasos, contar envíos, resumen, entrantes…). Así el almacén REAL y el motor entero se prueban sin base de datos, con un reloj inventado.
 *
 * Es estricto a propósito: una columna que no existe, una tabla que falta o un valor que la base rechazaría dan el mismo error que daría
 * PostgREST (`42703`, `PGRST205`, `23505`, `23502`), de modo que un nombre mal escrito en una consulta se descubre aquí y no en producción.
 * El mismo recorrido se repite contra Postgres de verdad (el ejecutor de arriba se cambia por uno que escribe SQL) al validar la migración.
 *
 * Se divide en dos mitades: el CONSTRUCTOR de consultas (`crearCliente`), que solo anota qué se ha pedido, y el EJECUTOR, que lo hace. Cualquier
 * ejecutor que reciba una `Consulta` y devuelva un `Resultado` sirve: este en memoria, o uno contra Postgres.
 */

/* ------------------------------------------------------------------ */
/* La consulta y el resultado                                          */
/* ------------------------------------------------------------------ */

export interface Filtro {
  col: string
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is' | 'isnot' | 'ilike'
  valor: unknown
}

export interface Consulta {
  tabla: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'rpc'
  columnas: string
  devolver: boolean
  filtros: Filtro[]
  orden: Array<{ col: string; asc: boolean; nullsFirst: boolean | null }>
  limite: number | null
  rango: [number, number] | null
  contar: boolean
  cabecera: boolean
  modo: 'lista' | 'uno' | 'quizas'
  valores: unknown
  conflicto: string | null
  rpc: { nombre: string; args: Record<string, unknown> } | null
}

export interface ErrorDeBase {
  message: string
  code?: string
  details?: string
}

export interface Resultado {
  data: unknown
  error: ErrorDeBase | null
  count: number | null
}

export type Ejecutor = (c: Consulta) => Promise<Resultado>

class Constructor implements PromiseLike<Resultado> {
  private c: Consulta
  constructor(
    private readonly ejecutor: Ejecutor,
    inicial: Partial<Consulta> & Pick<Consulta, 'tabla' | 'op'>
  ) {
    this.c = {
      columnas: '*',
      devolver: false,
      filtros: [],
      orden: [],
      limite: null,
      rango: null,
      contar: false,
      cabecera: false,
      modo: 'lista',
      valores: null,
      conflicto: null,
      rpc: null,
      ...inicial,
    }
  }

  select(columnas = '*', opciones?: { count?: 'exact'; head?: boolean }): this {
    if (this.c.op === 'select') this.c.columnas = columnas
    else {
      this.c.devolver = true
      this.c.columnas = columnas
    }
    if (opciones?.count) this.c.contar = true
    if (opciones?.head) this.c.cabecera = true
    return this
  }
  private filtro(col: string, op: Filtro['op'], valor: unknown): this {
    this.c.filtros.push({ col, op, valor })
    return this
  }
  eq(col: string, valor: unknown): this {
    return this.filtro(col, 'eq', valor)
  }
  neq(col: string, valor: unknown): this {
    return this.filtro(col, 'neq', valor)
  }
  gt(col: string, valor: unknown): this {
    return this.filtro(col, 'gt', valor)
  }
  gte(col: string, valor: unknown): this {
    return this.filtro(col, 'gte', valor)
  }
  lt(col: string, valor: unknown): this {
    return this.filtro(col, 'lt', valor)
  }
  lte(col: string, valor: unknown): this {
    return this.filtro(col, 'lte', valor)
  }
  in(col: string, valores: readonly unknown[]): this {
    return this.filtro(col, 'in', valores)
  }
  is(col: string, valor: null | boolean): this {
    return this.filtro(col, 'is', valor)
  }
  not(col: string, operador: string, valor: unknown): this {
    if (operador !== 'is') throw new Error(`El cliente falso solo entiende not(…, 'is', …), no «${operador}»`)
    return this.filtro(col, 'isnot', valor)
  }
  ilike(col: string, patron: string): this {
    return this.filtro(col, 'ilike', patron)
  }
  order(col: string, opciones?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.c.orden.push({ col, asc: opciones?.ascending !== false, nullsFirst: opciones?.nullsFirst ?? null })
    return this
  }
  limit(n: number): this {
    this.c.limite = n
    return this
  }
  range(desde: number, hasta: number): this {
    this.c.rango = [desde, hasta]
    return this
  }
  maybeSingle(): this {
    this.c.modo = 'quizas'
    return this
  }
  single(): this {
    this.c.modo = 'uno'
    return this
  }

  then<A = Resultado, B = never>(alExito?: ((r: Resultado) => A | PromiseLike<A>) | null, alFallo?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.ejecutor(this.c).then(alExito, alFallo)
  }
}

export interface ClienteFalso {
  from(tabla: string): {
    select(columnas?: string, opciones?: { count?: 'exact'; head?: boolean }): Constructor
    insert(valores: unknown): Constructor
    update(valores: unknown): Constructor
    upsert(valores: unknown, opciones?: { onConflict?: string }): Constructor
    delete(): Constructor
  }
  rpc(nombre: string, args?: Record<string, unknown>): Constructor
}

/** El cliente con la misma forma que el de Supabase, ejecutando con lo que se le dé */
export function crearCliente(ejecutor: Ejecutor): ClienteFalso {
  return {
    from: (tabla) => ({
      select: (columnas = '*', opciones) => new Constructor(ejecutor, { tabla, op: 'select' }).select(columnas, opciones),
      insert: (valores) => new Constructor(ejecutor, { tabla, op: 'insert', valores }),
      update: (valores) => new Constructor(ejecutor, { tabla, op: 'update', valores }),
      upsert: (valores, opciones) => new Constructor(ejecutor, { tabla, op: 'upsert', valores, conflicto: opciones?.onConflict ?? null }),
      delete: () => new Constructor(ejecutor, { tabla, op: 'delete' }),
    }),
    rpc: (nombre, args = {}) => new Constructor(ejecutor, { tabla: '', op: 'rpc', rpc: { nombre, args } }),
  }
}

/* ------------------------------------------------------------------ */
/* El ejecutor en memoria                                              */
/* ------------------------------------------------------------------ */

export type Fila = Record<string, unknown>

interface EsquemaDeTabla {
  columnas: readonly string[]
  /** Columnas que la base no deja vacías (error 23502) */
  requeridas?: readonly string[]
  /** Columna con identificador numérico que se rellena sola */
  serial?: string
}

const COMUNES_DE_SECUENCIA_PASO = [
  'id', 'inscripcion_id', 'buzon_id', 'dominio', 'orden', 'estado', 'motivo', 'asunto', 'texto', 'texto_enviado', 'dias_habiles', 'objetivo_dia',
  'programado_at', 'enviado_at', 'message_id', 'intentos', 'siguiente_intento_at', 'reclamado_at', 'decision', 'creado_at', 'actualizado_at',
] as const

export const ESQUEMA: Readonly<Record<string, EsquemaDeTabla>> = {
  profiles: { columnas: ['id', 'full_name', 'email', 'role', 'is_comercial'] },
  cold_leads: {
    columnas: [
      'id', 'store_name', 'company', 'status', 'assigned_to', 'email', 'emails_extra', 'phone', 'category', 'subcategory', 'province', 'ciudad', 'tipo_lead',
      'vende_en_amazon', 'tipo_empresa', 'plataforma', 'n_productos', 'anos_tienda', 'amazon_start', 'web', 'instagram', 'follow_up', 'call_attempts',
      'last_contacted_at', 'next_call_date', 'updated_at',
    ],
  },
  cold_lead_notes: { columnas: ['id', 'lead_id', 'author_id', 'kind', 'body', 'occurred_at', 'created_at', 'es_respuesta'], requeridas: ['lead_id', 'kind', 'body'] },
  rinkel_llamadas: { columnas: ['id', 'user_id', 'rinkel_id', 'fecha', 'direccion', 'duracion_s', 'estado', 'lead_id'] },
  rinkel_transcripciones: { columnas: ['llamada_id', 'user_id', 'estado', 'tipo', 'resumen', 'hecha_at'] },
  correo_buzones: { columnas: ['id', 'user_id', 'direccion', 'nombre', 'firma', 'usuario', 'imap_host', 'smtp_host', 'desde_fecha', 'credenciales_invalidas', 'ultimo_sync_at'] },
  correo_credenciales: { columnas: ['buzon_id', 'secreto_cifrado'] },
  correo_carpetas: { columnas: ['id', 'buzon_id', 'ruta', 'rol'] },
  correo_hilos: { columnas: ['id', 'buzon_id', 'asunto', 'primer_mensaje_at', 'ultimo_mensaje_at'] },
  correo_mensajes: {
    columnas: ['id', 'buzon_id', 'hilo_id', 'carpeta_id', 'message_id', 'direccion', 'de_direccion', 'destinatarios', 'asunto', 'fecha', 'texto', 'automatico', 'creado_at'],
  },
  correo_direcciones_malas: { columnas: ['direccion', 'estado', 'motivo', 'origen', 'veces', 'primera_vez', 'ultima_vez'], requeridas: ['direccion'] },
  correo_secuencias: { columnas: ['id', 'nombre', 'activa', 'es_base', 'pasos'] },
  correo_secuencia_ajustes: {
    columnas: [
      'id', 'activa', 'modo_ensayo', 'ventana_desde_min', 'ventana_hasta_min', 'hueco_global_s', 'hueco_buzon_s', 'peso_manana_pct', 'rampa', 'tope_hora',
      'dias_hasta_no_interesa', 'freno_rebotes_pct', 'freno_minimo_envios', 'festivos', 'vigilancia_at', 'purgado_at', 'actualizada_at', 'actualizada_por',
      'respuestas_ia', 'respuestas_cerrar_no', 'respuestas_rellamada', 'respuestas_at',
    ],
  },
  correo_respuestas_ia: {
    columnas: [
      'mensaje_id', 'lead_id', 'buzon_id', 'inscripcion_id', 'estado', 'intentos', 'proximo_intento_at', 'reclamado_at', 'clase', 'confianza', 'resumen', 'evidencia',
      'fecha_pedida', 'modelo', 'modo', 'accion', 'aplicada', 'nota', 'recibida_at', 'creada_at', 'actualizada_at',
    ],
    requeridas: ['mensaje_id', 'lead_id', 'buzon_id', 'recibida_at'],
  },
  correo_secuencia_buzones: {
    columnas: [
      'buzon_id', 'participa', 'pausado_hasta', 'motivo_pausa', 'rampa_inicio', 'tope_diario', 'llamadas_desde_min', 'llamadas_hasta_min', 'creado_at', 'actualizado_at',
    ],
    requeridas: ['buzon_id'],
  },
  correo_secuencia_inscripciones: {
    columnas: [
      'id', 'secuencia_id', 'lead_id', 'buzon_id', 'user_id', 'hilo_id', 'message_id_inicial', 'destinatario', 'asunto_base', 'estado', 'motivo', 'codigo',
      'primer_envio_at', 'no_interesa_en', 'parada_at', 'ia_modelo', 'creada_at', 'actualizada_at',
    ],
    requeridas: ['secuencia_id', 'lead_id', 'buzon_id', 'user_id', 'destinatario', 'primer_envio_at'],
  },
  correo_secuencia_pasos: { columnas: COMUNES_DE_SECUENCIA_PASO, requeridas: ['inscripcion_id', 'buzon_id', 'orden'] },
  correo_secuencia_eventos: { columnas: ['id', 'inscripcion_id', 'paso_id', 'buzon_id', 'tipo', 'detalle', 'creado_at'], requeridas: ['tipo'], serial: 'id' },
}

const RE_ISO = /^\d{4}-\d{2}-\d{2}T/

/** Compara dos valores como lo haría la base: las fechas como instantes, los números como números, lo demás como texto */
function comparar(a: unknown, b: unknown): number {
  if (typeof a === 'string' && typeof b === 'string' && RE_ISO.test(a) && RE_ISO.test(b)) return Date.parse(a) - Date.parse(b)
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const x = String(a)
  const y = String(b)
  return x < y ? -1 : x > y ? 1 : 0
}

const iguales = (a: unknown, b: unknown): boolean => comparar(a, b) === 0

function error(code: string, message: string): Resultado {
  return { data: null, error: { code, message }, count: null }
}

const copia = <T>(v: T): T => (v === undefined ? v : (structuredClone(v) as T))

function patronDeIlike(patron: string): RegExp {
  // Como en PostgreSQL: % es cualquier cosa, _ una letra, \ escapa
  let r = ''
  for (let i = 0; i < patron.length; i++) {
    const c = patron[i]
    if (c === '\\' && i + 1 < patron.length) r += patron[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (c === '%') r += '[\\s\\S]*'
    else if (c === '_') r += '[\\s\\S]'
    else r += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${r}$`, 'i')
}

export class BaseEnMemoria {
  readonly tablas = new Map<string, Fila[]>()
  /** El reloj de la base: lo que vale NOW() y los valores por defecto de las fechas */
  reloj: () => number
  private numeracion = new Map<string, number>()
  private contadorDeIds = 0
  /** Tablas que «no existen» (la migración sin lanzar): cualquier consulta da PGRST205 */
  ausentes = new Set<string>()
  /** Cada consulta que ha pasado, por si una prueba quiere comprobar qué se ha pedido */
  registro: Consulta[] = []

  constructor(reloj: () => number = () => Date.now()) {
    this.reloj = reloj
    for (const t of Object.keys(ESQUEMA)) this.tablas.set(t, [])
  }

  /** Atajo para sembrar datos: rellena lo que falta como lo haría la base, y falla si no es válido */
  sembrar(tabla: string, filas: Fila | Fila[]): Fila[] {
    const r = this.insertar(tabla, Array.isArray(filas) ? filas : [filas])
    if (r.error) throw new Error(`No se ha podido sembrar ${tabla}: ${r.error.message}`)
    return r.data as Fila[]
  }

  filas(tabla: string): Fila[] {
    return this.tablas.get(tabla) ?? []
  }

  ejecutor: Ejecutor = async (c) => {
    this.registro.push(c)
    if (c.op === 'rpc') return this.rpc(c.rpc!.nombre, c.rpc!.args)
    if (this.ausentes.has(c.tabla) || !this.tablas.has(c.tabla)) return error('PGRST205', `La tabla ${c.tabla} no está en la caché de esquema`)
    switch (c.op) {
      case 'select':
        return this.leer(c)
      case 'insert':
        return this.salidaDeEscritura(c, this.insertar(c.tabla, Array.isArray(c.valores) ? (c.valores as Fila[]) : [c.valores as Fila]))
      case 'upsert':
        return this.salidaDeEscritura(c, this.upsert(c))
      case 'update':
        return this.salidaDeEscritura(c, this.actualizar(c))
      case 'delete':
        return this.borrar(c)
    }
  }

  /* ---- lectura ---- */

  private coincide(tabla: string, fila: Fila, c: Consulta): string | null | boolean {
    const esquema = ESQUEMA[tabla]
    for (const f of c.filtros) {
      if (!esquema.columnas.includes(f.col)) return null
      const v = fila[f.col]
      switch (f.op) {
        case 'eq':
          if (v === null || v === undefined || !iguales(v, f.valor)) return false
          break
        case 'neq':
          if (v === null || v === undefined || iguales(v, f.valor)) return false
          break
        case 'gt':
          if (v === null || v === undefined || comparar(v, f.valor) <= 0) return false
          break
        case 'gte':
          if (v === null || v === undefined || comparar(v, f.valor) < 0) return false
          break
        case 'lt':
          if (v === null || v === undefined || comparar(v, f.valor) >= 0) return false
          break
        case 'lte':
          if (v === null || v === undefined || comparar(v, f.valor) > 0) return false
          break
        case 'in':
          if (v === null || v === undefined || !(f.valor as unknown[]).some((x) => iguales(v, x))) return false
          break
        case 'is':
          if (f.valor === null ? !(v === null || v === undefined) : v !== f.valor) return false
          break
        case 'isnot':
          if (f.valor === null ? v === null || v === undefined : v === f.valor) return false
          break
        case 'ilike':
          if (typeof v !== 'string' || !patronDeIlike(String(f.valor)).test(v)) return false
          break
      }
    }
    return true
  }

  private seleccionar(tabla: string, c: Consulta): { filas: Fila[]; mala: string | null } {
    const esquema = ESQUEMA[tabla]
    const filas: Fila[] = []
    for (const f of this.filas(tabla)) {
      const r = this.coincide(tabla, f, c)
      if (r === null) return { filas: [], mala: c.filtros.find((x) => !esquema.columnas.includes(x.col))?.col ?? '?' }
      if (r) filas.push(f)
    }
    return { filas, mala: null }
  }

  private proyectar(tabla: string, filas: Fila[], columnas: string): { filas: Fila[]; mala: string | null } {
    const esquema = ESQUEMA[tabla]
    const lista = columnas.split(',').map((x) => x.trim()).filter(Boolean)
    if (lista.length === 0 || lista.includes('*')) return { filas: filas.map(copia), mala: null }
    const mala = lista.find((x) => !esquema.columnas.includes(x))
    if (mala) return { filas: [], mala }
    return { filas: filas.map((f) => Object.fromEntries(lista.map((col) => [col, copia(f[col] ?? null)]))), mala: null }
  }

  private ordenar(tabla: string, filas: Fila[], c: Consulta): Fila[] | string {
    const esquema = ESQUEMA[tabla]
    for (const o of c.orden) if (!esquema.columnas.includes(o.col)) return o.col
    if (c.orden.length === 0) return filas
    return [...filas].sort((a, b) => {
      for (const o of c.orden) {
        const x = a[o.col]
        const y = b[o.col]
        const xn = x === null || x === undefined
        const yn = y === null || y === undefined
        if (xn || yn) {
          if (xn && yn) continue
          // Como PostgreSQL: en orden ascendente los nulos van al final, y al principio en el descendente (salvo que se diga)
          const nulosPrimero = o.nullsFirst ?? !o.asc
          return xn ? (nulosPrimero ? -1 : 1) : nulosPrimero ? 1 : -1
        }
        const d = comparar(x, y)
        if (d !== 0) return o.asc ? d : -d
      }
      return 0
    })
  }

  private leer(c: Consulta): Resultado {
    const { filas, mala } = this.seleccionar(c.tabla, c)
    if (mala) return error('42703', `La columna ${mala} no existe en ${c.tabla}`)
    const ordenadas = this.ordenar(c.tabla, filas, c)
    if (typeof ordenadas === 'string') return error('42703', `La columna ${ordenadas} no existe en ${c.tabla}`)
    const total = ordenadas.length
    let pagina = ordenadas
    if (c.rango) pagina = pagina.slice(c.rango[0], c.rango[1] + 1)
    if (c.limite !== null) pagina = pagina.slice(0, c.limite)
    const p = this.proyectar(c.tabla, pagina, c.columnas)
    if (p.mala) return error('42703', `La columna ${p.mala} no existe en ${c.tabla}`)
    return this.formaFinal(c, p.filas, c.contar ? total : null)
  }

  private formaFinal(c: Consulta, filas: Fila[], count: number | null): Resultado {
    if (c.cabecera) return { data: null, error: null, count }
    if (c.modo === 'lista') return { data: filas, error: null, count }
    if (filas.length > 1) return error('PGRST116', 'JSON object requested, multiple (or no) rows returned')
    if (filas.length === 0) return c.modo === 'uno' ? error('PGRST116', 'JSON object requested, multiple (or no) rows returned') : { data: null, error: null, count }
    return { data: filas[0], error: null, count }
  }

  /* ---- escritura ---- */

  private ahoraIso(): string {
    return new Date(this.reloj()).toISOString()
  }

  private nuevoId(): string {
    // Un UUID válido y repetible: el reloj no hace falta, basta un contador
    const n = (++this.contadorDeIds).toString(16).padStart(12, '0')
    return `00000000-0000-4000-8000-${n}`
  }

  private rellenar(tabla: string, fila: Fila): Fila {
    const e = ESQUEMA[tabla]
    const f: Fila = {}
    for (const col of e.columnas) f[col] = col in fila ? copia(fila[col]) : null
    const tiene = (c: string) => e.columnas.includes(c)
    if (tiene('id') && f.id === null) {
      if (e.serial === 'id') {
        const n = (this.numeracion.get(tabla) ?? 0) + 1
        this.numeracion.set(tabla, n)
        f.id = n
      } else if (tabla !== 'correo_secuencia_ajustes') f.id = this.nuevoId()
    }
    const ahora = this.ahoraIso()
    for (const col of ['creado_at', 'creada_at', 'actualizado_at', 'actualizada_at', 'occurred_at']) if (tiene(col) && f[col] === null) f[col] = ahora
    // Los valores por defecto de la migración 245
    const defecto = (col: string, v: unknown) => {
      if (tiene(col) && f[col] === null) f[col] = v
    }
    if (tabla === 'correo_secuencia_inscripciones') {
      defecto('estado', 'activa')
      defecto('asunto_base', '')
    }
    if (tabla === 'correo_secuencia_pasos') {
      defecto('estado', 'pendiente')
      defecto('dominio', '')
      defecto('asunto', '')
      defecto('texto', '')
      defecto('dias_habiles', 0)
      defecto('intentos', 0)
    }
    if (tabla === 'correo_secuencia_buzones') {
      defecto('participa', true)
      defecto('llamadas_desde_min', 600)
      defecto('llamadas_hasta_min', 840)
    }
    if (tabla === 'correo_secuencia_ajustes') {
      // Los de la migración 246 nacen encendidos
      defecto('respuestas_ia', true)
      defecto('respuestas_cerrar_no', true)
      defecto('respuestas_rellamada', true)
    }
    if (tabla === 'correo_respuestas_ia') {
      defecto('estado', 'pendiente')
      defecto('intentos', 0)
      defecto('aplicada', false)
    }
    if (tabla === 'cold_lead_notes') defecto('es_respuesta', false)
    if (tabla === 'correo_direcciones_malas') {
      defecto('estado', 'mala')
      defecto('origen', 'rebote')
      defecto('veces', 1)
      defecto('primera_vez', ahora)
      defecto('ultima_vez', ahora)
    }
    if (tabla === 'cold_leads') {
      defecto('status', 'pendiente')
      defecto('call_attempts', 0)
    }
    if (tabla === 'correo_mensajes') {
      defecto('automatico', false)
      defecto('texto', '')
      defecto('destinatarios', '')
      defecto('asunto', '')
      defecto('de_direccion', '')
    }
    return f
  }

  /** Las reglas de unicidad de la migración 245 */
  private conflicto(tabla: string, fila: Fila, excepto: Fila | null): string | null {
    const otras = this.filas(tabla).filter((f) => f !== excepto)
    if (tabla === 'correo_secuencia_inscripciones' && (fila.estado === 'activa' || fila.estado === 'pausada')) {
      if (otras.some((f) => f.lead_id === fila.lead_id && (f.estado === 'activa' || f.estado === 'pausada'))) return 'correo_secuencia_inscripciones_una_viva_idx'
    }
    if (tabla === 'correo_secuencia_pasos' && otras.some((f) => f.inscripcion_id === fila.inscripcion_id && f.orden === fila.orden)) return 'correo_secuencia_pasos_uno_por_orden'
    if (tabla === 'correo_secuencia_buzones' && otras.some((f) => f.buzon_id === fila.buzon_id)) return 'correo_secuencia_buzones_pkey'
    if (tabla === 'correo_direcciones_malas' && otras.some((f) => f.direccion === fila.direccion)) return 'correo_direcciones_malas_pkey'
    if (tabla === 'correo_respuestas_ia' && otras.some((f) => f.mensaje_id === fila.mensaje_id)) return 'correo_respuestas_ia_pkey'
    if (tabla !== 'correo_secuencia_ajustes' && 'id' in fila && fila.id !== null && otras.some((f) => f.id === fila.id)) return `${tabla}_pkey`
    return null
  }

  private validarFila(tabla: string, fila: Fila): ErrorDeBase | null {
    const e = ESQUEMA[tabla]
    for (const col of e.requeridas ?? []) if (fila[col] === null || fila[col] === undefined) return { code: '23502', message: `null value in column "${col}" of relation "${tabla}" violates not-null constraint` }
    if (tabla === 'correo_secuencia_inscripciones' && !['activa', 'pausada', 'respondida', 'parada', 'completada', 'sin_respuesta', 'cancelada'].includes(String(fila.estado))) return { code: '23514', message: 'estado no válido' }
    if (tabla === 'correo_secuencia_pasos') {
      if (!['pendiente', 'enviando', 'enviado', 'pausado', 'saltado', 'cancelado', 'fallido'].includes(String(fila.estado))) return { code: '23514', message: 'estado de paso no válido' }
      if (typeof fila.orden !== 'number' || fila.orden < 0 || fila.orden > 5) return { code: '23514', message: 'orden fuera de rango' }
    }
    if (tabla === 'correo_secuencia_eventos' && fila.inscripcion_id === null && fila.buzon_id === null) return { code: '23514', message: 'correo_secuencia_eventos_de_alguien' }
    if (tabla === 'cold_lead_notes' && !['llamada', 'email', 'whatsapp', 'linkedin', 'nota'].includes(String(fila.kind))) return { code: '23514', message: 'kind no válido' }
    if (tabla === 'correo_respuestas_ia') {
      if (!['pendiente', 'procesando', 'hecha', 'fallida'].includes(String(fila.estado))) return { code: '23514', message: 'estado de respuesta no válido' }
      if (fila.clase !== null && !['interesado', 'pide_info', 'no_interesa', 'baja', 'mas_tarde', 'derivacion', 'fuera_de_oficina', 'otro'].includes(String(fila.clase))) return { code: '23514', message: 'clase no válida' }
      if (fila.confianza !== null && !['alta', 'media', 'baja'].includes(String(fila.confianza))) return { code: '23514', message: 'confianza no válida' }
      if (fila.accion !== null && !['ninguna', 'cerrar', 'rellamar', 'revisar'].includes(String(fila.accion))) return { code: '23514', message: 'acción no válida' }
      if (fila.modo !== null && !['ensayo', 'real'].includes(String(fila.modo))) return { code: '23514', message: 'modo no válido' }
      if (typeof fila.resumen === 'string' && fila.resumen.length > 300) return { code: '23514', message: 'resumen demasiado largo' }
    }
    if (tabla === 'cold_leads' && !['pendiente', 'no_contesta', 'programado', 'email_enviado', 'seguimiento', 'cita_cualificada', 'no_interesa'].includes(String(fila.status))) return { code: '23514', message: 'estado de lead no válido' }
    return null
  }

  private insertar(tabla: string, entradas: Fila[]): Resultado {
    const e = ESQUEMA[tabla]
    const nuevas: Fila[] = []
    for (const entrada of entradas) {
      const mala = Object.keys(entrada).find((k) => !e.columnas.includes(k))
      if (mala) return error('PGRST204', `No existe la columna ${mala} en ${tabla}`)
      const fila = this.rellenar(tabla, entrada)
      const invalida = this.validarFila(tabla, fila)
      if (invalida) return { data: null, error: invalida, count: null }
      const choca = this.conflicto(tabla, fila, null) ?? nuevas.map((n) => this.conflictoEntre(tabla, n, fila)).find(Boolean) ?? null
      if (choca) return error('23505', `duplicate key value violates unique constraint "${choca}"`)
      nuevas.push(fila)
    }
    this.filas(tabla).push(...nuevas)
    return { data: nuevas, error: null, count: null }
  }

  private conflictoEntre(tabla: string, a: Fila, b: Fila): string | null {
    if (tabla === 'correo_secuencia_pasos' && a.inscripcion_id === b.inscripcion_id && a.orden === b.orden) return 'correo_secuencia_pasos_uno_por_orden'
    return null
  }

  private upsert(c: Consulta): Resultado {
    const e = ESQUEMA[c.tabla]
    const entradas = Array.isArray(c.valores) ? (c.valores as Fila[]) : [c.valores as Fila]
    const col = c.conflicto
    if (!col || !e.columnas.includes(col)) return error('42703', 'upsert sin una columna de conflicto válida')
    const salida: Fila[] = []
    for (const entrada of entradas) {
      const existente = this.filas(c.tabla).find((f) => f[col] === entrada[col])
      if (existente) {
        const mala = Object.keys(entrada).find((k) => !e.columnas.includes(k))
        if (mala) return error('PGRST204', `No existe la columna ${mala} en ${c.tabla}`)
        for (const [k, v] of Object.entries(entrada)) existente[k] = copia(v)
        salida.push(existente)
      } else {
        const r = this.insertar(c.tabla, [entrada])
        if (r.error) return r
        salida.push(...(r.data as Fila[]))
      }
    }
    return { data: salida, error: null, count: null }
  }

  private actualizar(c: Consulta): Resultado {
    const e = ESQUEMA[c.tabla]
    const cambios = c.valores as Fila
    const mala = Object.keys(cambios).find((k) => !e.columnas.includes(k))
    if (mala) return error('PGRST204', `No existe la columna ${mala} en ${c.tabla}`)
    const { filas, mala: columnaMala } = this.seleccionar(c.tabla, c)
    if (columnaMala) return error('42703', `La columna ${columnaMala} no existe en ${c.tabla}`)
    const hechas: Fila[] = []
    for (const f of filas) {
      const nueva = { ...f }
      for (const [k, v] of Object.entries(cambios)) nueva[k] = copia(v)
      const invalida = this.validarFila(c.tabla, nueva)
      if (invalida) return { data: null, error: invalida, count: null }
      const choca = this.conflicto(c.tabla, nueva, f)
      if (choca) return error('23505', `duplicate key value violates unique constraint "${choca}"`)
      Object.assign(f, nueva)
      hechas.push(f)
    }
    return { data: hechas, error: null, count: null }
  }

  private borrar(c: Consulta): Resultado {
    const { filas, mala } = this.seleccionar(c.tabla, c)
    if (mala) return error('42703', `La columna ${mala} no existe en ${c.tabla}`)
    const fuera = new Set(filas)
    this.tablas.set(c.tabla, this.filas(c.tabla).filter((f) => !fuera.has(f)))
    // Borrados en cascada (ON DELETE CASCADE de la migración 245)
    if (c.tabla === 'correo_secuencia_inscripciones') {
      const ids = new Set(filas.map((f) => f.id))
      this.tablas.set('correo_secuencia_pasos', this.filas('correo_secuencia_pasos').filter((p) => !ids.has(p.inscripcion_id)))
      this.tablas.set('correo_secuencia_eventos', this.filas('correo_secuencia_eventos').filter((p) => !ids.has(p.inscripcion_id)))
    }
    return { data: filas.map(copia), error: null, count: null }
  }

  private salidaDeEscritura(c: Consulta, r: Resultado): Resultado {
    if (r.error) return r
    if (!c.devolver) return { data: null, error: null, count: null }
    const p = this.proyectar(c.tabla, r.data as Fila[], c.columnas)
    if (p.mala) return error('42703', `La columna ${p.mala} no existe en ${c.tabla}`)
    return this.formaFinal(c, p.filas, null)
  }

  /* ---- las funciones SQL de la migración 245, en JavaScript ---- */

  private rpc(nombre: string, a: Record<string, unknown>): Resultado {
    const ahora = this.reloj()
    const iso = (v: unknown): number => Date.parse(String(v))
    switch (nombre) {
      case 'correo_secuencia_reclamar_pasos': {
        const hora = iso(a.p_ahora)
        const limite = Math.max(Number(a.p_limite ?? 5), 0)
        const bloqueo = Number(a.p_bloqueo_min ?? 10) * 60_000
        const activas = new Set(this.filas('correo_secuencia_inscripciones').filter((i) => i.estado === 'activa').map((i) => i.id))
        const candidatos = this.filas('correo_secuencia_pasos')
          .filter((p) => {
            if (!activas.has(p.inscripcion_id) || (p.orden as number) <= 0) return false
            if (p.estado === 'pendiente') {
              return p.programado_at !== null && iso(p.programado_at) <= hora && (p.siguiente_intento_at === null || iso(p.siguiente_intento_at) <= hora)
            }
            return p.estado === 'enviando' && p.reclamado_at !== null && iso(p.reclamado_at) < hora - bloqueo
          })
          .sort((x, y) => {
            const px = x.programado_at === null ? Infinity : iso(x.programado_at)
            const py = y.programado_at === null ? Infinity : iso(y.programado_at)
            return px - py || (x.orden as number) - (y.orden as number)
          })
          .slice(0, limite)
        for (const p of candidatos) {
          p.estado = 'enviando'
          p.reclamado_at = new Date(hora).toISOString()
          p.intentos = (p.intentos as number) + 1
          p.actualizado_at = new Date(hora).toISOString()
        }
        return { data: candidatos.map(copia), error: null, count: null }
      }
      case 'correo_respuestas_reclamar': {
        const desde = iso(a.p_desde)
        const hora = iso(a.p_ahora)
        const limite = Math.max(Number(a.p_limite ?? 8), 0)
        const bloqueo = Number(a.p_bloqueo_min ?? 10) * 60_000
        const apuntados = new Set(this.filas('correo_respuestas_ia').map((r) => r.mensaje_id))
        const buzonDe = new Map(this.filas('correo_buzones').map((b) => [b.id, b]))
        const participa = (buzonId: unknown): boolean => this.filas('correo_secuencia_buzones').find((x) => x.buzon_id === buzonId)?.participa !== false
        const direccionesDe = (l: Fila): string[] =>
          `${l.email ?? ''} ${l.emails_extra ?? ''}`
            .toLowerCase()
            .split(/[\s/,;]+/)
            .filter(Boolean)
        const inscripciones = this.filas('correo_secuencia_inscripciones')
        const masReciente = (lista: Fila[]): Fila | undefined => [...lista].sort((x, y) => iso(y.creada_at) - iso(x.creada_at))[0]
        const nuevos = this.filas('correo_mensajes').filter((m) => m.direccion === 'entrante' && m.automatico !== true && iso(m.creado_at) >= desde && iso(m.creado_at) <= hora && !apuntados.has(m.id) && participa(m.buzon_id))
        for (const m of nuevos) {
          const creado = iso(m.creado_at)
          const remitente = String(m.de_direccion ?? '').trim().toLowerCase()
          const dueno = buzonDe.get(m.buzon_id)?.user_id
          let leadId: unknown = null
          let inscripcionId: unknown = null
          // 1a. Por la dirección de quien escribe: gana el lead de la persona dueña del buzón y, después, el tocado más recientemente
          const candidatos = this.filas('cold_leads')
            .filter((l) => direccionesDe(l).includes(remitente))
            .sort((x, y) => Number(y.assigned_to === dueno) - Number(x.assigned_to === dueno) || (y.updated_at ? iso(y.updated_at) : 0) - (x.updated_at ? iso(x.updated_at) : 0))
          if (candidatos.length > 0) {
            leadId = candidatos[0].id
            inscripcionId = masReciente(inscripciones.filter((i) => i.lead_id === leadId && i.buzon_id === m.buzon_id && iso(i.primer_envio_at) <= creado))?.id ?? null
          } else {
            // 1b. Por el hilo del primer correo de una secuencia
            const porHilo = masReciente(inscripciones.filter((i) => i.buzon_id === m.buzon_id && i.hilo_id !== null && i.hilo_id === m.hilo_id && iso(i.primer_envio_at) <= creado))
            if (porHilo) {
              leadId = porHilo.lead_id
              inscripcionId = porHilo.id
            }
          }
          if (leadId === null) continue
          const r = this.insertar('correo_respuestas_ia', [{ mensaje_id: m.id, lead_id: leadId, buzon_id: m.buzon_id, inscripcion_id: inscripcionId, recibida_at: m.creado_at }])
          if (r.error) return r
        }
        // 2. Reservar lo que toca leer
        const candidatas = this.filas('correo_respuestas_ia')
          .filter((r) => (r.estado === 'pendiente' && (r.proximo_intento_at === null || iso(r.proximo_intento_at) <= hora)) || (r.estado === 'procesando' && r.reclamado_at !== null && iso(r.reclamado_at) < hora - bloqueo))
          .sort((x, y) => iso(x.recibida_at) - iso(y.recibida_at))
          .slice(0, limite)
        const salida = candidatas.map((r) => {
          r.estado = 'procesando'
          r.reclamado_at = new Date(hora).toISOString()
          r.intentos = (r.intentos as number) + 1
          r.actualizada_at = new Date(hora).toISOString()
          const m = this.filas('correo_mensajes').find((x) => x.id === r.mensaje_id) as Fila
          return {
            mensaje_id: r.mensaje_id,
            lead_id: r.lead_id,
            buzon_id: r.buzon_id,
            inscripcion_id: r.inscripcion_id,
            intentos: r.intentos,
            de_direccion: m.de_direccion,
            asunto: m.asunto,
            texto: String(m.texto ?? '').slice(0, 8000),
            fecha: m.fecha,
            hilo_id: m.hilo_id,
            recibida_at: r.recibida_at,
          }
        })
        return { data: salida, error: null, count: null }
      }
      case 'correo_secuencia_purgar': {
        const dias = Number(a.p_dias ?? 180)
        if (dias < 30) return error('P0001', 'No se purga lo de menos de 30 dias.')
        const limite = ahora - dias * 86_400_000
        const fuera = this.filas('correo_secuencia_inscripciones').filter((i) => !['activa', 'pausada'].includes(String(i.estado)) && iso(i.actualizada_at) < limite)
        const ids = new Set(fuera.map((i) => i.id))
        this.tablas.set('correo_secuencia_inscripciones', this.filas('correo_secuencia_inscripciones').filter((i) => !ids.has(i.id)))
        this.tablas.set('correo_secuencia_pasos', this.filas('correo_secuencia_pasos').filter((p) => !ids.has(p.inscripcion_id)))
        this.tablas.set('correo_secuencia_eventos', this.filas('correo_secuencia_eventos').filter((p) => !ids.has(p.inscripcion_id)))
        return { data: fuera.length, error: null, count: null }
      }
      case 'correo_secuencia_salientes_por_hora': {
        const desde = iso(a.p_desde)
        const buzones = Array.isArray(a.p_buzones) ? (a.p_buzones as string[]) : null
        const automaticos = new Set(this.filas('correo_secuencia_pasos').filter((p) => p.estado === 'enviado' && (p.orden as number) > 0 && p.message_id).map((p) => p.message_id as string))
        const grupos = new Map<string, { buzon_id: unknown; dia: string; hora: number; total: number; automaticos: number }>()
        for (const m of this.filas('correo_mensajes')) {
          if (m.direccion !== 'saliente' || iso(m.fecha) < desde || (buzones && !buzones.includes(m.buzon_id as string))) continue
          const p = partesDeMadrid(iso(m.fecha))
          const clave = `${m.buzon_id}|${p.dia}|${p.hora}`
          const g = grupos.get(clave) ?? { buzon_id: m.buzon_id, dia: p.dia, hora: p.hora, total: 0, automaticos: 0 }
          g.total++
          if (m.message_id && automaticos.has(m.message_id as string)) g.automaticos++
          grupos.set(clave, g)
        }
        return { data: [...grupos.values()], error: null, count: null }
      }
      case 'correo_secuencia_salud_buzones': {
        const desde = iso(a.p_desde)
        const filas = this.filas('correo_buzones').map((b) => ({
          buzon_id: b.id,
          enviados: this.filas('correo_mensajes').filter((m) => m.buzon_id === b.id && m.direccion === 'saliente' && iso(m.fecha) >= desde).length,
          rebotes: this.filas('correo_mensajes').filter(
            (m) =>
              m.buzon_id === b.id &&
              m.direccion === 'entrante' &&
              m.automatico === true &&
              iso(m.creado_at) >= desde &&
              /^(mailer-daemon|postmaster|mail-daemon|maildelivery)/i.test(String(m.de_direccion)) &&
              (/\b5\.\d{1,3}\.\d{1,3}\b/.test(String(m.texto)) || /(user unknown|no such user|does not exist|no existe|address rejected|recipient rejected|usuario desconocido)/i.test(String(m.texto)))
          ).length,
        }))
        return { data: filas, error: null, count: null }
      }
      case 'correo_secuencia_resumen': {
        const desde = iso(a.p_desde)
        const buzones = Array.isArray(a.p_buzones) ? (a.p_buzones as string[]) : null
        const ins = this.filas('correo_secuencia_inscripciones').filter((i) => iso(i.creada_at) >= desde && (!buzones || buzones.includes(i.buzon_id as string)))
        const contar = (claves: unknown[]): Record<string, number> => {
          const r: Record<string, number> = {}
          for (const k of claves) r[String(k)] = (r[String(k)] ?? 0) + 1
          return r
        }
        const ids = new Set(ins.map((i) => i.id))
        const pasos = this.filas('correo_secuencia_pasos').filter((p) => ids.has(p.inscripcion_id))
        const enviados = contar(pasos.filter((p) => p.estado === 'enviado').map((p) => p.orden))
        const respuestas = contar(
          ins
            .filter((i) => i.estado === 'respondida')
            .map((i) => {
              const hasta = i.parada_at ? iso(i.parada_at) : ahora
              const ordenes = pasos.filter((p) => p.inscripcion_id === i.id && p.estado === 'enviado' && p.enviado_at && iso(p.enviado_at) <= hasta).map((p) => p.orden as number)
              return ordenes.length > 0 ? Math.max(...ordenes) : 0
            })
        )
        return {
          data: {
            total: ins.length,
            por_estado: contar(ins.map((i) => i.estado)),
            por_codigo: contar(ins.filter((i) => i.codigo && !['activa', 'pausada'].includes(String(i.estado))).map((i) => i.codigo)),
            enviados,
            respuestas,
          },
          error: null,
          count: null,
        }
      }
      case 'correo_secuencia_vigilar': {
        const desde = iso(a.p_desde)
        const libres = new Set(((a.p_libres as string[] | null) ?? []).map((d) => d.toLowerCase()))
        const vivas = this.filas('correo_secuencia_inscripciones').filter((i) => i.estado === 'activa' || i.estado === 'pausada')
        const pares: Array<{ m: Fila; i: Fila }> = []
        for (const m of this.filas('correo_mensajes')) {
          if (m.direccion !== 'entrante' || iso(m.creado_at) < desde) continue
          const de = String(m.de_direccion ?? '').toLowerCase()
          for (const i of vivas) {
            if (i.buzon_id !== m.buzon_id || iso(m.creado_at) < iso(i.primer_envio_at)) continue
            const destino = String(i.destinatario).toLowerCase()
            const dominioDestino = destino.split('@')[1] ?? ''
            const casa =
              (i.hilo_id !== null && m.hilo_id === i.hilo_id) ||
              de === destino ||
              (dominioDestino !== '' && !libres.has(dominioDestino) && de.split('@')[1] === dominioDestino) ||
              (m.automatico === true && (String(m.texto ?? '').slice(0, 20000).toLowerCase().includes(destino) || String(m.asunto ?? '').toLowerCase().includes(destino)))
            if (casa) pares.push({ m, i })
          }
        }
        pares.sort((x, y) => iso(x.m.creado_at) - iso(y.m.creado_at) || String(x.i.id).localeCompare(String(y.i.id)))
        const filas = pares.slice(0, 2000).map(({ m, i }) => ({
          inscripcion_id: i.id,
          buzon_id: i.buzon_id,
          destinatario: i.destinatario,
          hilo_id: i.hilo_id,
          primer_envio_at: i.primer_envio_at,
          mensaje_id: m.id,
          mensaje_hilo_id: m.hilo_id,
          de_direccion: m.de_direccion,
          asunto: m.asunto,
          texto: String(m.texto ?? '').slice(0, 8000),
          fecha: m.fecha,
          automatico: m.automatico,
        }))
        return { data: filas, error: null, count: null }
      }
      case 'correo_secuencia_rebotes': {
        const desde = iso(a.p_desde)
        const limite = Math.max(Math.min(Number(a.p_limite ?? 500), 1000), 1)
        const filas = this.filas('correo_mensajes')
          .filter(
            (m) =>
              m.direccion === 'entrante' &&
              m.automatico === true &&
              iso(m.creado_at) >= desde &&
              /^(mailer-daemon|postmaster|mail-daemon|maildelivery)/i.test(String(m.de_direccion)) &&
              (/\b5\.\d{1,3}\.\d{1,3}\b/.test(String(m.texto)) || /(user unknown|no such user|does not exist|no existe|address rejected|recipient rejected|usuario desconocido)/i.test(String(m.texto)))
          )
          .sort((x, y) => iso(x.creado_at) - iso(y.creado_at))
          .slice(0, limite)
          .map((m) => ({ id: m.id, buzon_id: m.buzon_id, de_direccion: m.de_direccion, asunto: m.asunto, texto: String(m.texto ?? '').slice(0, 8000), fecha: m.fecha, creado_at: m.creado_at }))
        return { data: filas, error: null, count: null }
      }
      case 'correo_secuencia_entrantes_de': {
        const desde = iso(a.p_desde)
        const direccion = String(a.p_direccion ?? '').toLowerCase()
        const dominio = String(a.p_dominio ?? '').toLowerCase()
        const filas = this.filas('correo_mensajes')
          .filter((m) => {
            if (m.buzon_id !== a.p_buzon || m.direccion !== 'entrante' || iso(m.creado_at) < desde) return false
            const de = String(m.de_direccion ?? '').toLowerCase()
            return (
              (a.p_hilo !== null && a.p_hilo !== undefined && m.hilo_id === a.p_hilo) ||
              de === direccion ||
              (dominio !== '' && de.split('@')[1] === dominio) ||
              (m.automatico === true && (String(m.texto ?? '').toLowerCase().includes(direccion) || String(m.asunto ?? '').toLowerCase().includes(direccion)))
            )
          })
          .sort((x, y) => iso(x.fecha) - iso(y.fecha))
          .slice(0, 200)
          .map((m) => ({ id: m.id, hilo_id: m.hilo_id, de_direccion: m.de_direccion, asunto: m.asunto, texto: String(m.texto ?? '').slice(0, 8000), fecha: m.fecha, automatico: m.automatico }))
        return { data: filas, error: null, count: null }
      }
      default:
        return error('PGRST202', `No existe la función ${nombre}`)
    }
  }
}

/** Una base en memoria y el cliente que habla con ella, listos para pasarle al almacén (`as unknown as Servicio`) */
export function nuevaBase(reloj?: () => number): { base: BaseEnMemoria; service: ClienteFalso } {
  const base = new BaseEnMemoria(reloj)
  return { base, service: crearCliente(base.ejecutor) }
}
