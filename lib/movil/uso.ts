/**
 * CUÁNTO USA CADA PERSONA CADA APLICACIÓN EN ESTE NAVEGADOR (para el móvil: «Recientes» del Inicio y las pestañas de la barra de abajo).
 * ======================================================================================================================================
 * Vive en el almacenamiento del navegador y nunca sale de él: no es un registro de actividad, es una comodidad. Sin almacenamiento (ventana privada,
 * datos bloqueados) todo sigue funcionando: no hay recientes y las pestañas salen por el orden de siempre.
 *
 * La cuenta se olvida sola: cada apertura suma 1 y lo que había pierde la mitad cada semana (n = n · 0,5^(días/7) + 1). Así, lo que se usó mucho hace un
 * mes no le quita el sitio a lo que se usa esta semana.
 *
 * Las funciones de cálculo son PURAS (reciben los datos y la hora) y se comprueban con uso.prueba.ts; las que leen y escriben el almacenamiento van al final.
 */

export interface UsoDeUnaApp {
  /** La cuenta con el olvido aplicado hasta `t` */
  n: number
  /** Cuándo se abrió por última vez (ms) */
  t: number
}

export type Uso = Readonly<Record<string, UsoDeUnaApp>>

export const CLAVE_USO = 'erp:movil:uso'
export const CLAVE_FIJADAS = 'erp:movil:fijadas'
/** «Solo las mías»: los huecos de la barra que no se han elegido se quedan vacíos en vez de rellenarse con las más usadas */
export const CLAVE_SOLO_FIJADAS = 'erp:movil:solo-fijadas'
/** Cuántas aplicaciones caben entre «Inicio» y «Más» en la barra de abajo */
export const MAX_FIJADAS = 4
/** Aviso (en `window`) de que han cambiado las fijadas o el uso: lo escuchan la barra de abajo y el Inicio */
export const EVENTO_USO_CAMBIA = 'erp:movil:uso-cambia'

const SEMANA_MS = 7 * 24 * 60 * 60 * 1000
/** Más allá de esto, una aplicación ya no cuenta: así el almacenamiento no crece sin fin */
const OLVIDO_TOTAL = 0.05

/** La cuenta de una aplicación vista desde `ahora`, con lo que se haya olvidado desde la última vez */
export function cuentaA(u: UsoDeUnaApp | undefined, ahora: number): number {
  if (!u || !Number.isFinite(u.n) || u.n <= 0) return 0
  const dias = Math.max(0, ahora - u.t) / SEMANA_MS
  return u.n * Math.pow(0.5, dias)
}

/** El uso después de abrir `id` a la hora `ahora` (no cambia el que recibe) */
export function sumarApertura(uso: Uso, id: string, ahora: number): Uso {
  const siguiente: Record<string, UsoDeUnaApp> = {}
  for (const [clave, valor] of Object.entries(uso)) {
    if (clave === id) continue
    // De paso se tiran las que ya casi no cuentan
    if (cuentaA(valor, ahora) >= OLVIDO_TOTAL) siguiente[clave] = valor
  }
  siguiente[id] = { n: cuentaA(uso[id], ahora) + 1, t: ahora }
  return siguiente
}

/** La puntuación de cada aplicación a la hora `ahora` */
export function puntuar(uso: Uso, ahora: number): Record<string, number> {
  const salida: Record<string, number> = {}
  for (const [id, u] of Object.entries(uso)) salida[id] = cuentaA(u, ahora)
  return salida
}

/** Las `n` abiertas más recientemente (solo de las que puede ver, si se da la lista) */
export function ordenarRecientes(uso: Uso, n: number, visibles?: readonly string[]): string[] {
  const permitidas = visibles ? new Set(visibles) : null
  return Object.entries(uso)
    .filter(([id, u]) => Number.isFinite(u.t) && (!permitidas || permitidas.has(id)))
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, Math.max(0, n))
    .map(([id]) => id)
}

/** Las `n` más usadas de las que puede ver; a igual puntuación, la que se abrió más tarde */
export function ordenarMasUsadas(uso: Uso, ahora: number, n: number, visibles: readonly string[]): string[] {
  const puntos = puntuar(uso, ahora)
  return visibles
    .filter((id) => (puntos[id] ?? 0) > 0)
    .sort((a, b) => (puntos[b] ?? 0) - (puntos[a] ?? 0) || (uso[b]?.t ?? 0) - (uso[a]?.t ?? 0))
    .slice(0, Math.max(0, n))
}

/** Un valor leído del almacenamiento convertido en uso (lo roto se ignora) */
export function leerUsoDe(texto: string | null): Uso {
  if (!texto) return {}
  try {
    const crudo: unknown = JSON.parse(texto)
    if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return {}
    const salida: Record<string, UsoDeUnaApp> = {}
    for (const [id, v] of Object.entries(crudo as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const { n, t } = v as { n?: unknown; t?: unknown }
      if (typeof n === 'number' && typeof t === 'number' && Number.isFinite(n) && Number.isFinite(t) && n > 0) salida[id] = { n, t }
    }
    return salida
  } catch {
    return {}
  }
}

/** Una lista de ids leída del almacenamiento (lo roto se ignora; sin repetidos) */
export function leerIdsDe(texto: string | null, max = Number.POSITIVE_INFINITY): string[] {
  if (!texto) return []
  try {
    const crudo: unknown = JSON.parse(texto)
    if (!Array.isArray(crudo)) return []
    const salida: string[] = []
    for (const x of crudo) if (typeof x === 'string' && x !== '' && !salida.includes(x)) salida.push(x)
    return salida.slice(0, max)
  } catch {
    return []
  }
}

/** Las fijadas después de fijar `id`: va al final y, si ya están todas, sale la más antigua */
export function conFijada(fijadas: readonly string[], id: string): string[] {
  const sin = fijadas.filter((x) => x !== id)
  return [...sin, id].slice(-MAX_FIJADAS)
}

/** Las fijadas con `id` movida `paso` sitios (−1 = a la izquierda) */
export function conFijadaMovida(fijadas: readonly string[], id: string, paso: number): string[] {
  const i = fijadas.indexOf(id)
  const j = i + paso
  if (i < 0 || j < 0 || j >= fijadas.length) return [...fijadas]
  const salida = [...fijadas]
  ;[salida[i], salida[j]] = [salida[j], salida[i]]
  return salida
}

/* ------------------------------ Almacenamiento del navegador ------------------------------ */

function leer(clave: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(clave)
  } catch {
    return null
  }
}

function escribir(clave: string, valor: string): void {
  try {
    window.localStorage.setItem(clave, valor)
  } catch {
    // sin almacenamiento: se queda sin recordar, nada más
  }
}

function avisar(): void {
  try {
    window.dispatchEvent(new Event(EVENTO_USO_CAMBIA))
  } catch {
    /* fuera del navegador */
  }
}

export function leerUso(): Uso {
  return leerUsoDe(leer(CLAVE_USO))
}

/** Apunta que se ha abierto `id` (la llama la barra lateral al cambiar de aplicación) */
export function registrarApertura(id: string, ahora = Date.now()): void {
  if (typeof window === 'undefined' || !id) return
  escribir(CLAVE_USO, JSON.stringify(sumarApertura(leerUso(), id, ahora)))
  avisar()
}

export function recientes(n: number, visibles?: readonly string[]): string[] {
  return ordenarRecientes(leerUso(), n, visibles)
}

export function masUsadas(n: number, visibles: readonly string[], ahora = Date.now()): string[] {
  return ordenarMasUsadas(leerUso(), ahora, n, visibles)
}

export function fijadas(): string[] {
  return leerIdsDe(leer(CLAVE_FIJADAS), MAX_FIJADAS)
}

export function fijar(id: string): string[] {
  const nuevas = conFijada(fijadas(), id)
  escribir(CLAVE_FIJADAS, JSON.stringify(nuevas))
  avisar()
  return nuevas
}

export function soltar(id: string): string[] {
  const nuevas = fijadas().filter((x) => x !== id)
  escribir(CLAVE_FIJADAS, JSON.stringify(nuevas))
  avisar()
  return nuevas
}

export function moverFijada(id: string, paso: number): string[] {
  const nuevas = conFijadaMovida(fijadas(), id, paso)
  escribir(CLAVE_FIJADAS, JSON.stringify(nuevas))
  avisar()
  return nuevas
}

export function soloFijadas(): boolean {
  return leer(CLAVE_SOLO_FIJADAS) === '1'
}

export function ponerSoloFijadas(valor: boolean): void {
  escribir(CLAVE_SOLO_FIJADAS, valor ? '1' : '0')
  avisar()
}
