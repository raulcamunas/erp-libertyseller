/**
 * LAS VISTAS PREVIAS QUE ASOMAN ENCIMA DE LA PASTILLA «CHAT» — módulo del navegador, sin React (como lib/avisos/pila.ts).
 * =========================================================================================================================
 * Cuando alguien te habla en el chat (un directo, una mención, una respuesta) y no lo tienes a la vista, encima de la pastilla de abajo a la derecha asoma una tarjeta con quién es y el
 * principio del mensaje, para poder decidir si abrirlo. La publica la campana (components/layout/NotificationsBell.tsx), que es quien recibe el aviso en tiempo real, y la pinta
 * components/chat/VistasPreviasDelChat.tsx. Se comprueba con vista-previa.prueba.ts.
 *
 * También guarda si la pastilla está a la vista: si no lo está (el dock está abierto, la pantalla es estrecha o estás en el propio chat), la campana usa el aviso lateral de siempre.
 */

export interface VistaPrevia {
  /** Estable por lo que avisa (la clave del aviso): publicar dos veces lo mismo no lo enseña dos veces */
  clave: string
  /** Quién habla (y dónde, si no es un directo) */
  titulo: string
  /** El principio del mensaje */
  texto: string
  /** A qué canal lleva al pulsarla */
  canalId: string | null
}

/** Cuántas se ven a la vez: si llegan más, las más antiguas se retiran */
export const MAX_VISTAS = 3

let vistas: readonly VistaPrevia[] = []
let pastilla = false
const oyentes = new Set<() => void>()

const avisar = () => {
  for (const o of [...oyentes]) o()
}

export function publicarVistaPrevia(v: VistaPrevia): void {
  if (vistas.some((x) => x.clave === v.clave)) return
  vistas = [...vistas, v].slice(-MAX_VISTAS)
  avisar()
}

export function quitarVistaPrevia(clave: string): void {
  if (!vistas.some((x) => x.clave === clave)) return
  vistas = vistas.filter((x) => x.clave !== clave)
  avisar()
}

/** Las que hay ahora, de la más antigua a la más nueva. La MISMA referencia mientras no cambie nada (lo que pide useSyncExternalStore) */
export const leerVistasPrevias = (): readonly VistaPrevia[] => vistas

export function suscribirVistasPrevias(o: () => void): () => void {
  oyentes.add(o)
  return () => {
    oyentes.delete(o)
  }
}

export function vaciarVistasPrevias(): void {
  if (vistas.length === 0) return
  vistas = []
  avisar()
}

/** El dock dice si la pastilla está a la vista; al quitarse, las tarjetas que quedaran se retiran (no deben esperar a que vuelva) */
export function ponerPastillaDelChatVisible(v: boolean): void {
  pastilla = v
  if (!v) vaciarVistasPrevias()
}
export const pastillaDelChatVisible = (): boolean => pastilla

/** La inicial para el círculo de la tarjeta: la primera letra del nombre, en mayúscula («Daniela en #general» → D) */
export function inicialDe(titulo: string): string {
  const limpio = titulo.trim().replace(/^[^\p{L}\p{N}]+/u, '')
  return (limpio.charAt(0) || '·').toLocaleUpperCase('es')
}
