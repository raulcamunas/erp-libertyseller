import { ErrorDeHerramienta } from './protocolo'

/**
 * LOS ARGUMENTOS DE UNA HERRAMIENTA, VALIDADOS.
 * PURO. Cada función lee UN argumento y lanza un ErrorDeHerramienta con un
 * mensaje en español que dice cuál es y qué se esperaba: es lo que lee el modelo
 * para corregirse, así que tiene que bastar para acertar a la segunda.
 *
 * Los argumentos llegan de un modelo, no de una persona: se desconfía de todo,
 * también de los tipos. Un número que viene como texto («20») se acepta, porque es
 * el error más común y no cambia nada; un texto donde se esperaba un número, no.
 */

type Args = Record<string, unknown>

export function texto(
  args: Args,
  nombre: string,
  opciones: { requerido?: boolean; max?: number } = {}
): string | undefined {
  const v = args[nombre]
  if (v === undefined || v === null || v === '') {
    if (opciones.requerido) throw new ErrorDeHerramienta(`Falta el argumento «${nombre}».`)
    return undefined
  }
  if (typeof v !== 'string') throw new ErrorDeHerramienta(`«${nombre}» tiene que ser un texto.`)
  const t = v.trim()
  if (t === '') {
    if (opciones.requerido) throw new ErrorDeHerramienta(`Falta el argumento «${nombre}».`)
    return undefined
  }
  const max = opciones.max ?? 200
  if (t.length > max) throw new ErrorDeHerramienta(`«${nombre}» es demasiado largo (máximo ${max} caracteres).`)
  return t
}

export function entero(
  args: Args,
  nombre: string,
  opciones: { min: number; max: number; defecto: number }
): number {
  const v = args[nombre]
  if (v === undefined || v === null || v === '') return opciones.defecto
  const n = typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    throw new ErrorDeHerramienta(`«${nombre}» tiene que ser un número entero.`)
  }
  if (n < opciones.min || n > opciones.max) {
    throw new ErrorDeHerramienta(`«${nombre}» tiene que estar entre ${opciones.min} y ${opciones.max}.`)
  }
  return n
}

export function booleano(args: Args, nombre: string, defecto = false): boolean {
  const v = args[nombre]
  if (v === undefined || v === null || v === '') return defecto
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  throw new ErrorDeHerramienta(`«${nombre}» tiene que ser verdadero o falso.`)
}

export function opcion<T extends string>(
  args: Args,
  nombre: string,
  validas: readonly T[],
  defecto: T
): T {
  const v = args[nombre]
  if (v === undefined || v === null || v === '') return defecto
  if (typeof v !== 'string' || !(validas as readonly string[]).includes(v)) {
    throw new ErrorDeHerramienta(`«${nombre}» tiene que ser uno de: ${validas.join(', ')}.`)
  }
  return v as T
}

/**
 * Recorta un texto largo (un mensaje de Amazon, un título) a `max` caracteres,
 * diciéndolo. Una respuesta que se corta sin avisar parece completa.
 */
export function acortar(t: string | null | undefined, max: number): string | null {
  if (t === null || t === undefined) return null
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/**
 * Serializa el resultado de una herramienta para el modelo, con un TECHO de
 * tamaño. Si se pasa, se avisa dentro del propio JSON: una lista cortada en
 * silencio es peor que una lista corta.
 */
export function aTexto(datos: unknown, techo = 24_000): string {
  const t = JSON.stringify(datos, null, 1)
  if (t.length <= techo) return t
  return (
    t.slice(0, techo) +
    `\n…[respuesta cortada: pasaba de ${techo.toLocaleString('es-ES')} caracteres. Pide menos filas o filtra más.]`
  )
}
