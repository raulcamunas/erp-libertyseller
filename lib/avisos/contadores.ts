/**
 * LOS NÚMEROS QUE VAN JUNTO A UNA APLICACIÓN EN EL MENÚ, y que no son de la aplicación que se está viendo.
 *
 * Hoy dos: cuántas conversaciones de correo tienen algo sin leer y cuánto hay sin leer en el chat. Lo publican el lector de correo nuevo (cada minuto, esté donde esté la
 * persona) y la propia pantalla de Correo (al instante, en cuanto lee algo); lo pinta el menú lateral. Módulo del navegador, sin React:
 * suscribirse y leer es lo que necesita `useSyncExternalStore`.
 */

let correoSinLeer = 0
const oyentes = new Set<() => void>()

export function ponerCorreoSinLeer(n: number): void {
  const nuevo = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  if (nuevo === correoSinLeer) return
  correoSinLeer = nuevo
  for (const oyente of [...oyentes]) oyente()
}

export const leerCorreoSinLeer = (): number => correoSinLeer

export function suscribirContadores(oyente: () => void): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

export interface ChatSinLeer {
  /** Mensajes sin leer en canales y directos con avisos activados */
  mensajes: number
  /** Menciones sin leer (cuentan aunque el canal esté silenciado) */
  menciones: number
}

const SIN_CHAT: ChatSinLeer = { mensajes: 0, menciones: 0 }
let chatSinLeer: ChatSinLeer = SIN_CHAT

const entero = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

/** Lo publica el dock del chat (o la propia aplicación) cada vez que cambia. El objeto se guarda tal cual mientras no cambia: es lo que `useSyncExternalStore` necesita para no repintar de más */
export function ponerChatSinLeer(mensajes: number, menciones: number): void {
  const m = entero(mensajes)
  const n = entero(menciones)
  if (m === chatSinLeer.mensajes && n === chatSinLeer.menciones) return
  chatSinLeer = m === 0 && n === 0 ? SIN_CHAT : { mensajes: m, menciones: n }
  for (const oyente of [...oyentes]) oyente()
}

export const leerChatSinLeer = (): ChatSinLeer => chatSinLeer
