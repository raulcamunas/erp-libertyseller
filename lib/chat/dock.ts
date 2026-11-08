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
