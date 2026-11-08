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
