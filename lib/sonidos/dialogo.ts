/**
 * SI EL SELECTOR DE SONIDOS ESTÁ ABIERTO — módulo del navegador, sin React. Lo abren desde varios sitios (la campana, la apariencia del chat, los ajustes de audio de la junta) y lo pinta UN solo
 * componente en el layout (components/sonidos/DialogoDeSonidos.tsx): así no se cierra cuando el panel desde el que se abrió se cierra al pulsar fuera.
 */

let abierto = false
const oyentes = new Set<() => void>()
const avisar = () => {
  for (const o of [...oyentes]) o()
}

export const dialogoDeSonidosAbierto = (): boolean => abierto
export function ponerDialogoDeSonidos(valor: boolean): void {
  if (abierto === valor) return
  abierto = valor
  avisar()
}
export const abrirDialogoDeSonidos = (): void => ponerDialogoDeSonidos(true)
export function suscribirDialogoDeSonidos(o: () => void): () => void {
  oyentes.add(o)
  return () => {
    oyentes.delete(o)
  }
}
