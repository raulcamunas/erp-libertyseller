/**
 * EL DOCK DEL CHAT — PURO. El chat está a mano en cualquier pantalla del ERP, siempre pequeño y ampliable:
 *
 *   · `cerrado`: solo una pastilla abajo a la derecha, con lo que hay sin leer.
 *   · `pequeno`: una ventana flotante (380 × 560) con el chat entero, lista y conversación.
 *   · `lateral`: un panel pegado al borde derecho que aparta la página (no la tapa): para trabajar con la tarea a un lado y la conversación al otro.
 *
 * Y el chat completo sigue siendo la aplicación de siempre. El modo elegido se recuerda en este navegador.
 */

export type ModoDelDock = 'cerrado' | 'pequeno' | 'lateral'

export const MODOS: readonly ModoDelDock[] = ['cerrado', 'pequeno', 'lateral']
export const CLAVE_DEL_DOCK = 'chat:dock'
export const ANCHO_LATERAL = 420
export const ANCHO_MINIMO_PARA_EL_DOCK = 1024
/** Con menos ventana que esto, un panel lateral no deja sitio a la página: se queda como ventana flotante */
export const ANCHO_MINIMO_PARA_APARTAR = 1180

export const leerModo = (valor: unknown): ModoDelDock => (typeof valor === 'string' && (MODOS as readonly string[]).includes(valor) ? (valor as ModoDelDock) : 'cerrado')

/** ¿Se ofrece el dock en esta pantalla? No en el propio chat (ya está entero) */
export function seOfreceElDock(ruta: string | null | undefined): boolean {
  if (!ruta) return false
  return !(ruta === '/dashboard/chat' || ruta.startsWith('/dashboard/chat/'))
}

/** Qué modo se pinta de verdad según el ancho de la ventana: un lateral en una ventana estrecha se pinta como flotante */
export function modoEfectivo(modo: ModoDelDock, anchoDeVentana: number): ModoDelDock {
  return modo === 'lateral' && anchoDeVentana < ANCHO_MINIMO_PARA_APARTAR ? 'pequeno' : modo
}

/** Lo que el dock aparta a la página por la derecha (px): solo el lateral */
export const anchoQueAparta = (modo: ModoDelDock, anchoDeVentana: number): number => (modoEfectivo(modo, anchoDeVentana) === 'lateral' ? ANCHO_LATERAL : 0)

/* ---------- El tamaño de la ventana flotante: cada persona la hace del tamaño que quiera arrastrando el borde de la izquierda, el de arriba o la esquina (12 nov 2026) ---------- */

export interface TamanoDelDock {
  ancho: number
  alto: number
}

export const TAMANO_POR_DEFECTO: TamanoDelDock = { ancho: 380, alto: 580 }
export const TAMANO_MINIMO: TamanoDelDock = { ancho: 320, alto: 380 }
export const CLAVE_DEL_TAMANO = 'chat:dock:tamano'
/** Lo que se deja libre alrededor (el margen de 18 px a cada lado) */
const AIRE = 36

/** El tamaño dentro de lo posible: ni más pequeño que el mínimo ni más grande que la ventana (menos el margen) */
export function limitarTamano(t: TamanoDelDock, ventana: TamanoDelDock): TamanoDelDock {
  const recortar = (v: number, min: number, max: number) => Math.round(Math.min(Math.max(v, min), Math.max(min, max)))
  return { ancho: recortar(t.ancho, TAMANO_MINIMO.ancho, ventana.ancho - AIRE), alto: recortar(t.alto, TAMANO_MINIMO.alto, ventana.alto - AIRE) }
}

/** Lo guardado en el navegador; lo roto vuelve al tamaño de siempre */
export function leerTamano(texto: string | null | undefined): TamanoDelDock {
  try {
    const b = JSON.parse(texto ?? '') as Partial<TamanoDelDock>
    const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d)
    return { ancho: n(b?.ancho, TAMANO_POR_DEFECTO.ancho), alto: n(b?.alto, TAMANO_POR_DEFECTO.alto) }
  } catch {
    return { ...TAMANO_POR_DEFECTO }
  }
}

export type BordeDelDock = 'izquierda' | 'arriba' | 'esquina'

/** El tamaño al arrastrar un borde: la ventana está pegada abajo a la derecha, así que crece hacia la izquierda y hacia arriba */
export function tamanoAlArrastrar(inicio: TamanoDelDock, borde: BordeDelDock, dx: number, dy: number, ventana: TamanoDelDock): TamanoDelDock {
  return limitarTamano({ ancho: borde === 'arriba' ? inicio.ancho : inicio.ancho - dx, alto: borde === 'izquierda' ? inicio.alto : inicio.alto - dy }, ventana)
}
