/**
 * LO QUE CADA PERSONA ELIGE SOBRE LOS AVISOS, en este navegador.
 *
 * Los avisos del equipo (hitos de llamadas, citas agendadas) se pueden SILENCIAR: son una celebración, no una obligación, y quien quiera
 * trabajar sin ellos no tiene por qué verlos. Silenciarlos NO quita los avisos de correo nuevo, que son trabajo (hay que contestar).
 *
 * Se guarda en el navegador (localStorage) y no en la base: es una comodidad de pantalla y no hay nada que auditar. Si el navegador no
 * deja guardar (ventana privada, datos bloqueados), vale para esta sesión y ya está.
 */

const CLAVE = 'avisos:equipo-silenciado'

let silenciado: boolean | null = null
const oyentes = new Set<() => void>()

function leerGuardado(): boolean {
  try {
    return window.localStorage.getItem(CLAVE) === '1'
  } catch {
    return false
  }
}

export function equipoSilenciado(): boolean {
  if (silenciado === null) silenciado = typeof window === 'undefined' ? false : leerGuardado()
  return silenciado
}

export function silenciarEquipo(valor: boolean): void {
  silenciado = valor
  try {
    if (valor) window.localStorage.setItem(CLAVE, '1')
    else window.localStorage.removeItem(CLAVE)
  } catch {
    // Sin almacenamiento: queda para esta sesión
  }
  for (const oyente of [...oyentes]) oyente()
}

export function suscribirPreferenciasDeAvisos(oyente: () => void): () => void {
  oyentes.add(oyente)
  // Otra pestaña lo cambia: esta se entera
  const alCambiar = (e: StorageEvent) => {
    if (e.key !== CLAVE) return
    silenciado = e.newValue === '1'
    oyente()
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', alCambiar)
  return () => {
    oyentes.delete(oyente)
    if (typeof window !== 'undefined') window.removeEventListener('storage', alCambiar)
  }
}
