/**
 * SI LA VENTANA «AJUSTES DE VOZ» ESTÁ ABIERTA — módulo del navegador, sin React. La abren desde varios sitios (la barra del chat, los ajustes de audio de la junta) y la pinta UN solo componente en el
 * layout (components/chat/DialogoDeAjustesDeVoz.tsx): así no se cierra cuando el panel desde el que se abrió se cierra al pulsar fuera.
 */

let abierto = false
const oyentes = new Set<() => void>()
const avisar = () => {
  for (const o of [...oyentes]) o()
}

export const dialogoDeVozAbierto = (): boolean => abierto
export function ponerDialogoDeVoz(valor: boolean): void {
  if (abierto === valor) return
  abierto = valor
  avisar()
}
export const abrirDialogoDeVoz = (): void => ponerDialogoDeVoz(true)
export function suscribirDialogoDeVoz(o: () => void): () => void {
  oyentes.add(o)
  return () => {
    oyentes.delete(o)
  }
}
