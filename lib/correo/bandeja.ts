import { UUID } from './acceso'
import type { VistaDeCorreo } from './tipos'

/**
 * LA BANDEJA UNIFICADA («Mis correos»), SIN BASE DE DATOS.
 * =======================================================
 * GET /api/correo/bandeja?vista=&sinLeer=&q=&antes=&antesId=&limite=&carpeta=mios|asignados&silenciados=0|1
 *
 * Orden: `ultimoMensajeAt` de más nuevo a más viejo y, a igualdad, `id` de mayor a menor (el mismo orden que `correo_bandeja` y su índice
 * `correo_hilos_bandeja_idx`). El cursor (antes, antesId) es la última fila de la página: estable aunque dos hilos tengan la misma fecha.
 *
 * Lo silenciado SALE por defecto (atenuado). `silenciados=0` (el chip «Ocultar silenciados», que no se recuerda) lo quita.
 */

export const VISTAS_DE_CORREO: readonly VistaDeCorreo[] = ['todos', 'recibidos', 'enviados', 'destacados', 'pendientes']
export type CarpetaDeBandeja = 'mios' | 'asignados'

export const LIMITE_DE_BANDEJA = 40
export const LIMITE_MAXIMO_DE_BANDEJA = 100
export const MAX_BUZONES_EN_BANDEJA = 30
/** Una búsqueda necesita al menos esto (como la lista de un buzón) */
export const MIN_LARGO_DE_BUSQUEDA = 2
export const MAX_LARGO_DE_BUSQUEDA = 200
/** Nunca más de estas filas nuevas animadas a la vez */
export const MAX_FILAS_ANIMADAS = 12

export interface ConsultaDeBandeja {
  vista: VistaDeCorreo
  sinLeer: boolean
  /** null = sin búsqueda (o con menos de 2 caracteres) */
  q: string | null
  /** El cursor: ultimo_mensaje_at e id de la última fila de la página anterior. Los dos o ninguno */
  antes: string | null
  antesId: string | null
  limite: number
  carpeta: CarpetaDeBandeja
  /** true (por defecto) = los silenciados salen, atenuados; false = se ocultan */
  silenciados: boolean
}

export interface Cursor {
  antes: string
  antesId: string
}

type Parametros = URLSearchParams | { get(nombre: string): string | null } | Record<string, string | null | undefined>

const leer = (p: Parametros, nombre: string): string | null => {
  if (typeof (p as { get?: unknown }).get === 'function') return (p as { get(n: string): string | null }).get(nombre)
  const v = (p as Record<string, string | null | undefined>)[nombre]
  return v === undefined ? null : v
}

const siNo = (v: string | null, porDefecto: boolean): boolean | null => {
  if (v === null || v === '') return porDefecto
  if (v === '1' || v === 'true') return true
  if (v === '0' || v === 'false') return false
  return null
}

/** Lee y valida la consulta de la bandeja. Lo que falta toma su valor por defecto; lo que viene mal es un 400 */
export function leerQueryDeBandeja(p: Parametros): { ok: true; consulta: ConsultaDeBandeja } | { ok: false; error: string } {
  const vista = (leer(p, 'vista') || 'todos') as VistaDeCorreo
  if (!VISTAS_DE_CORREO.includes(vista)) return { ok: false, error: 'La vista no es válida.' }

  const carpeta = (leer(p, 'carpeta') || 'mios') as CarpetaDeBandeja
  if (carpeta !== 'mios' && carpeta !== 'asignados') return { ok: false, error: 'La carpeta no es válida.' }

  const sinLeer = siNo(leer(p, 'sinLeer'), false)
  if (sinLeer === null) return { ok: false, error: '«Sin leer» tiene que ser 0 o 1.' }
  const silenciados = siNo(leer(p, 'silenciados'), true)
  if (silenciados === null) return { ok: false, error: '«Silenciados» tiene que ser 0 o 1.' }

  const qCruda = (leer(p, 'q') ?? '').trim().replace(/\s+/g, ' ')
  if (qCruda.length > MAX_LARGO_DE_BUSQUEDA) return { ok: false, error: `La búsqueda es demasiado larga (máximo ${MAX_LARGO_DE_BUSQUEDA} caracteres).` }
  const q = qCruda.length >= MIN_LARGO_DE_BUSQUEDA ? qCruda : null

  const antesCrudo = leer(p, 'antes')
  const antesIdCrudo = leer(p, 'antesId')
  let antes: string | null = null
  let antesId: string | null = null
  if (antesCrudo) {
    const t = Date.parse(antesCrudo)
    if (!Number.isFinite(t)) return { ok: false, error: 'El cursor no es válido.' }
    antes = new Date(t).toISOString()
    if (antesIdCrudo) {
      if (!UUID.test(antesIdCrudo)) return { ok: false, error: 'El cursor no es válido.' }
      antesId = antesIdCrudo.toLowerCase()
    }
  } else if (antesIdCrudo) {
    return { ok: false, error: 'El cursor no es válido.' }
  }

  const limiteCrudo = leer(p, 'limite')
  let limite = LIMITE_DE_BANDEJA
  if (limiteCrudo) {
    const n = Number(limiteCrudo)
    if (!Number.isFinite(n)) return { ok: false, error: 'El límite no es válido.' }
    limite = Math.min(Math.max(Math.trunc(n), 1), LIMITE_MAXIMO_DE_BANDEJA)
  }

  return { ok: true, consulta: { vista, sinLeer, q, antes, antesId, limite, carpeta, silenciados } }
}

/* ------------------------------------------------------------------ */
/* Orden y cursor                                                       */
/* ------------------------------------------------------------------ */

interface Ordenable {
  id: string
  ultimoMensajeAt: string
}

const tiempo = (s: string): number => {
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY
}

/** Comparador de la bandeja: más nuevo primero y, a igualdad de fecha, id mayor primero (como la RPC) */
export function compararHilos(a: Ordenable, b: Ordenable): number {
  const d = tiempo(b.ultimoMensajeAt) - tiempo(a.ultimoMensajeAt)
  if (d !== 0 && !Number.isNaN(d)) return d > 0 ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/**
 * Corta lo que devuelve la RPC (hasta limite + 1 filas, ya ordenadas) en la página y el cursor de la siguiente.
 * Si no sobra ninguna fila, no hay más: siguiente = null.
 */
export function siguienteCursor<T extends Ordenable>(filas: readonly T[], limite: number): { pagina: T[]; siguiente: Cursor | null } {
  const n = Math.max(1, Math.trunc(limite))
  const pagina = filas.slice(0, n)
  if (filas.length <= n) return { pagina, siguiente: null }
  const ultima = pagina[pagina.length - 1]
  return { pagina, siguiente: { antes: ultima.ultimoMensajeAt, antesId: ultima.id } }
}

/** Mezcla los resultados de buscar en cada buzón: sin repetir, por fecha (desempate por id) y cortados a `limite` */
export function mezclarResultadosDeBusqueda<T extends Ordenable>(listas: ReadonlyArray<readonly T[]>, limite: number): T[] {
  const vistos = new Set<string>()
  const todos: T[] = []
  for (const lista of listas) {
    for (const h of lista) {
      if (vistos.has(h.id)) continue
      vistos.add(h.id)
      todos.push(h)
    }
  }
  return todos.sort(compararHilos).slice(0, Math.max(0, Math.trunc(limite)))
}

/* ------------------------------------------------------------------ */
/* El sondeo: fusionar la primera página con lo que ya hay en pantalla  */
/* ------------------------------------------------------------------ */

const iguales = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * El sondeo cada 30 s pide SOLO la primera página y la funde con lo que ya hay en pantalla:
 *   · la primera página manda (versiones frescas, y lo que ya no está en ella dentro de su tramo se ha ido: leído con «Sin leer», fusionado…);
 *   · lo de más abajo (lo ya cargado con el scroll) se queda, sin lo que ha subido a la primera página, y con su cursor;
 *   · si la primera página dice que no hay más, la lista es solo ella.
 * `nuevas` = filas que no estaban o que han recibido un mensaje (para la animación de entrada), como mucho 12. En la primera carga, ninguna.
 * Una fila que no ha cambiado conserva el MISMO objeto, para que su `memo` no la repinte.
 */
export function fusionarPrimeraPagina<T extends Ordenable>(
  actual: { hilos: readonly T[]; siguiente: Cursor | null },
  primera: { hilos: readonly T[]; siguiente: Cursor | null },
): { hilos: T[]; siguiente: Cursor | null; nuevas: string[] } {
  const previas = new Map(actual.hilos.map((h) => [h.id, h]))
  const nuevas: string[] = []
  const cabeza = primera.hilos.map((h) => {
    const antes = previas.get(h.id)
    if (!antes) {
      if (actual.hilos.length > 0) nuevas.push(h.id)
      return h
    }
    if (tiempo(h.ultimoMensajeAt) > tiempo(antes.ultimoMensajeAt)) nuevas.push(h.id)
    return iguales(antes, h) ? antes : h
  })

  if (primera.siguiente === null || primera.hilos.length === 0) {
    return { hilos: cabeza, siguiente: primera.siguiente, nuevas: nuevas.slice(0, MAX_FILAS_ANIMADAS) }
  }

  const enCabeza = new Set(cabeza.map((h) => h.id))
  const tope = primera.hilos[primera.hilos.length - 1]
  // Solo lo que queda por debajo del final de la primera página: lo de dentro de su tramo que no ha vuelto se ha ido
  const cola = actual.hilos.filter((h) => !enCabeza.has(h.id) && compararHilos(tope, h) < 0)
  return {
    hilos: [...cabeza, ...cola],
    siguiente: cola.length > 0 ? actual.siguiente : primera.siguiente,
    nuevas: nuevas.slice(0, MAX_FILAS_ANIMADAS),
  }
}
