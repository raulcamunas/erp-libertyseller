/**
 * LO QUE EL RESTO DEL ERP NECESITA SABER DEL CHAT DE UN VISTAZO — módulo del navegador, sin React (para `useSyncExternalStore` y para la campana):
 *   · si el chat está a la vista (abierto en el dock o en su pantalla), para que la campana no duplique con un aviso lo que ya se ve en la barra;
 *   · si hay un proveedor del chat vivo, para que el recuento de la barra del ERP no se pregunte al servidor mientras el chat ya lo sabe.
 */

let abiertoEnElDock = false
let proveedorVivo = false

export function ponerChatAbiertoEnElDock(v: boolean): void {
  abiertoEnElDock = v
}
export function ponerProveedorDelChatVivo(v: boolean): void {
  proveedorVivo = v
}
export const proveedorDelChatVivo = (): boolean => proveedorVivo

/** ¿Se está viendo el chat ahora mismo? En su pantalla o con el dock abierto */
export function chatALaVista(ruta: string): boolean {
  return ruta.startsWith('/dashboard/chat') || abiertoEnElDock
}

/**
 * PEDIRLE AL CHAT QUE ABRA UN CANAL (desde fuera de él: la tarjeta que asoma encima de la pastilla). Si el chat ya está vivo se atiende al momento; si todavía no se ha montado (se monta la
 * primera vez que se abre), la petición espera y la recoge al arrancar (`tomarCanalPedido`).
 */
let canalPedido: string | null = null
let atiende: ((canalId: string) => void) | null = null

export function pedirCanalAlChat(canalId: string): void {
  if (atiende) atiende(canalId)
  else canalPedido = canalId
}

/** El chat vivo se registra para atender las peticiones. Devuelve cómo darse de baja */
export function atenderPeticionesDeCanal(f: (canalId: string) => void): () => void {
  atiende = f
  return () => {
    if (atiende === f) atiende = null
  }
}

/** Al arrancar, el chat recoge (una sola vez) el canal que le pidieron antes de existir */
export function tomarCanalPedido(): string | null {
  const c = canalPedido
  canalPedido = null
  return c
}

/** ¿Hay una junta de voz conectada ahora? La mira el cierre por inactividad (components/actividad/RegistroDeActividad.tsx): quien está en una junta está presente aunque no toque ni ratón ni teclado */
let juntaConectada = false
export function ponerJuntaConectada(v: boolean): void {
  juntaConectada = v
}
export const hayJuntaConectada = (): boolean => juntaConectada
