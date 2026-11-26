/**
 * KIT VISUAL COMÚN · LÓGICA PURA.
 *
 * Todo lo que las piezas de components/ui-ls calculan sin pintar nada: acentos por módulo, paleta de gráficos, la variación frente al periodo anterior, iniciales y color
 * estable del avatar, ordenar y paginar filas, «hace cuánto», la palabra de confirmación. Sin React y sin el navegador, para poder probarlo con
 * `npx tsx components/ui-ls/utilidades.prueba.ts`.
 */
import type { TonoEstado } from '@/lib/estilo/denso'

/* ------------------------------------------------------------------ */
/* Acentos por módulo                                                  */
/* ------------------------------------------------------------------ */

/** Los módulos con color propio. El acento va en el icono de cabecera, el filo de las tarjetas y los gráficos; nunca en texto largo. */
export type Modulo = 'marketing' | 'seo' | 'cumplimiento' | 'remesas' | 'personas' | 'cuentas' | 'marca' | 'neutro'

export const ACENTO: Record<Modulo, string> = {
  marketing: 'var(--ls-mod-marketing)',
  seo: 'var(--ls-mod-seo)',
  cumplimiento: 'var(--ls-mod-cumplimiento)',
  remesas: 'var(--ls-mod-remesas)',
  personas: 'var(--ls-mod-personas)',
  cuentas: 'var(--ls-mod-cuentas)',
  marca: 'var(--ls-acc-graf)',
  neutro: 'var(--ls-mod-neutro)',
}

/** El segundo color de los módulos que lo tienen (Cumplimiento: ámbar y rojo). Para degradados del icono de cabecera. */
export const ACENTO_2: Partial<Record<Modulo, string>> = {
  cumplimiento: 'var(--ls-mod-cumplimiento-2)',
}

/** Acepta un módulo o un color CSS cualquiera y devuelve el color CSS. */
export function colorDeAcento(acento: Modulo | string | undefined): string {
  if (!acento) return ACENTO.marca
  return acento in ACENTO ? ACENTO[acento as Modulo] : acento
}

/** Mezcla un color CSS con transparente: `mezcla('var(--ls-mod-seo)', 14)` → fondo suave del 14 %. */
export const mezcla = (color: string, porcentaje: number): string => `color-mix(in srgb, ${color} ${Math.max(0, Math.min(100, porcentaje))}%, transparent)`

/** La paleta de gráficos, en orden. El color sigue a la entidad: la misma serie lleva el mismo hueco en todos los gráficos. */
export const VIZ = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)'] as const

/* ------------------------------------------------------------------ */
/* Variación frente al periodo anterior                                */
/* ------------------------------------------------------------------ */

export type Mejor = 'sube' | 'baja' | 'neutro'

export interface LecturaDeVariacion {
  /** Proporción (0,12 = +12 %). null si no se puede comparar. */
  proporcion: number | null
  direccion: 'sube' | 'baja' | 'igual'
  /** true = buena noticia, false = mala, null = no se juzga o no hay comparación */
  buena: boolean | null
  tono: TonoEstado
}

/**
 * Lee una variación. `mejor` dice qué dirección es buena: las ventas suben = verde, el ACoS sube = rojo, el gasto `neutro` (azul, no se juzga).
 * Sin anterior, o con anterior 0, no hay porcentaje que dar.
 */
export function leerVariacion(actual: number | null | undefined, anterior: number | null | undefined, mejor: Mejor = 'sube'): LecturaDeVariacion {
  if (actual == null || anterior == null || !Number.isFinite(actual) || !Number.isFinite(anterior) || anterior === 0) {
    return { proporcion: null, direccion: 'igual', buena: null, tono: 'gris' }
  }
  const proporcion = (actual - anterior) / Math.abs(anterior)
  const direccion = proporcion > 0.0005 ? 'sube' : proporcion < -0.0005 ? 'baja' : 'igual'
  if (direccion === 'igual') return { proporcion, direccion, buena: null, tono: 'gris' }
  if (mejor === 'neutro') return { proporcion, direccion, buena: null, tono: 'azul' }
  const buena = mejor === direccion
  return { proporcion, direccion, buena, tono: buena ? 'verde' : 'rojo' }
}

/** «12,4 %» con coma española; sin signo (la flecha ya lo dice). */
export const porcentajeCorto = (proporcion: number): string =>
  `${Math.abs(proporcion * 100).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: 'always' })}\u00a0%`

/* ------------------------------------------------------------------ */
/* Avatar                                                              */
/* ------------------------------------------------------------------ */

/** Las iniciales de un nombre: «Raúl Camuñas» → «RC», «ana» → «AN», «» → «?». Ignora partículas (de, del, la). */
export function iniciales(nombre: string | null | undefined): string {
  const limpio = (nombre ?? '').replace(/[@].*$/, '').replace(/[._-]+/g, ' ').trim()
  if (!limpio) return '?'
  const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'van', 'von'])
  const partes = limpio.split(/\s+/).filter((p) => !PARTICULAS.has(p.toLowerCase()))
  const usar = partes.length ? partes : limpio.split(/\s+/)
  if (usar.length === 1) return usar[0].slice(0, 2).toLocaleUpperCase('es-ES')
  return (usar[0][0] + usar[usar.length - 1][0]).toLocaleUpperCase('es-ES')
}

const TONOS_DE_AVATAR: readonly TonoEstado[] = ['azul', 'violeta', 'cian', 'verde', 'ambar', 'magenta', 'naranja', 'rojo']

/** Un tono estable para un nombre: el mismo nombre sale siempre del mismo color, en cualquier pantalla y en los dos temas. */
export function tonoEstable(semilla: string | null | undefined): TonoEstado {
  const s = (semilla ?? '').trim().toLowerCase()
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return TONOS_DE_AVATAR[(h >>> 0) % TONOS_DE_AVATAR.length]
}

/* ------------------------------------------------------------------ */
/* Tabla: ordenar y paginar                                            */
/* ------------------------------------------------------------------ */

export type Sentido = 'asc' | 'desc'
export type ValorOrdenable = string | number | Date | boolean | null | undefined

const COLADOR = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

/** Compara dos valores: números como números, fechas por tiempo, texto con orden español (tildes y números dentro del texto). Los vacíos, siempre al final. */
export function comparar(a: ValorOrdenable, b: ValorOrdenable, sentido: Sentido = 'asc'): number {
  const vacioA = a == null || a === '' || (typeof a === 'number' && Number.isNaN(a))
  const vacioB = b == null || b === '' || (typeof b === 'number' && Number.isNaN(b))
  if (vacioA && vacioB) return 0
  if (vacioA) return 1
  if (vacioB) return -1
  const signo = sentido === 'asc' ? 1 : -1
  const na = a instanceof Date ? a.getTime() : typeof a === 'boolean' ? Number(a) : a
  const nb = b instanceof Date ? b.getTime() : typeof b === 'boolean' ? Number(b) : b
  if (typeof na === 'number' && typeof nb === 'number') return (na - nb) * signo
  return COLADOR.compare(String(na), String(nb)) * signo
}

/** Ordena sin tocar el array original; estable (los iguales conservan su orden). */
export function ordenarFilas<T>(filas: readonly T[], valorDe: ((fila: T) => ValorOrdenable) | undefined, sentido: Sentido): T[] {
  if (!valorDe) return [...filas]
  return filas
    .map((fila, i) => ({ fila, i, v: valorDe(fila) }))
    .sort((x, y) => comparar(x.v, y.v, sentido) || x.i - y.i)
    .map((x) => x.fila)
}

export interface Pagina<T> {
  filas: T[]
  pagina: number
  paginas: number
  desde: number
  hasta: number
  total: number
}

/** Una página (empieza en 1). Si la página pedida ya no existe (se filtró y hay menos filas), se queda en la última. */
export function paginar<T>(filas: readonly T[], pagina: number, porPagina: number): Pagina<T> {
  const total = filas.length
  const tam = Math.max(1, Math.floor(porPagina))
  const paginas = Math.max(1, Math.ceil(total / tam))
  const p = Math.min(Math.max(1, Math.floor(pagina) || 1), paginas)
  const inicio = (p - 1) * tam
  const trozo = filas.slice(inicio, inicio + tam)
  return { filas: trozo, pagina: p, paginas, desde: total ? inicio + 1 : 0, hasta: inicio + trozo.length, total }
}

/* ------------------------------------------------------------------ */
/* Tiempo y texto                                                      */
/* ------------------------------------------------------------------ */

/** «hace 5 min», «hace 3 h», «ayer», «hace 4 días», o la fecha corta si pasó más de una semana. */
export function haceCuanto(cuando: Date | string | number, ahora: number = Date.now()): string {
  const t = cuando instanceof Date ? cuando.getTime() : typeof cuando === 'number' ? cuando : Date.parse(cuando)
  if (!Number.isFinite(t)) return '—'
  const s = Math.round((ahora - t) / 1000)
  if (s < 0) return new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  if (s < 45) return 'ahora mismo'
  const min = Math.round(s / 60)
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  if (d === 1) return 'ayer'
  if (d < 7) return `hace ${d} días`
  const fecha = new Date(t)
  const mismoAno = fecha.getFullYear() === new Date(ahora).getFullYear()
  return fecha.toLocaleDateString('es-ES', mismoAno ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

/** ¿Lo escrito coincide con la palabra de confirmación? Sin distinguir mayúsculas ni tildes y sin espacios de los lados. */
export function palabraCoincide(escrito: string, palabra: string): boolean {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLocaleUpperCase('es-ES')
  return norm(palabra).length > 0 && norm(escrito) === norm(palabra)
}

/** Limita una proporción a [0, 1]; lo que no es número cuenta como 0. */
export const proporcionSegura = (valor: number, maximo = 1): number => {
  if (!Number.isFinite(valor) || !Number.isFinite(maximo) || maximo <= 0) return 0
  return Math.max(0, Math.min(1, valor / maximo))
}

/** Formateadores de siempre, en español. */
export const formatoEntero = (n: number) => Math.round(n).toLocaleString('es-ES', { useGrouping: 'always' })
export const formatoEuros = (n: number, decimales = 0) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: decimales, minimumFractionDigits: decimales })
export const formatoPorcentaje = (proporcion: number, decimales = 1) => `${(proporcion * 100).toLocaleString('es-ES', { maximumFractionDigits: decimales, minimumFractionDigits: decimales })} %`

/** «hace 5 min», «hace 3 h», «ayer a las 14:32», «12 nov · 09:10» */
export function cuandoFue(iso: string): string {
  const t = Date.parse(iso)
  const seg = (Date.now() - t) / 1000
  const hora = new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  if (seg < 60) return 'ahora mismo'
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`
  const hoy = new Date()
  const d = new Date(t)
  const mismoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (mismoDia(d, hoy)) return `hace ${Math.floor(seg / 3600)} h`
  const ayer = new Date(hoy)
  ayer.setDate(hoy.getDate() - 1)
  if (mismoDia(d, ayer)) return `ayer a las ${hora}`
  return `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', ...(d.getFullYear() !== hoy.getFullYear() ? { year: 'numeric' } : {}) })} · ${hora}`
}

