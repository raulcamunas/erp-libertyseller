import { textoSinFirma } from './plantillas'

/**
 * EL «DE:» DE REDACTAR (rediseño Correo Pro, spec 1.8). Puro: lo usa components/correo/Redactar.tsx y lo prueba redactar-de.prueba.ts.
 *
 * - Desde qué buzones se puede enviar: los que llegan en `buzonesParaEnviar` con puedeResponder, conectados y sin la contraseña rechazada. El buzón con
 *   el que se abrió el mensaje va siempre (primero): así, sin la lista (CorreoRapido, el análisis de Keepa), todo sigue como antes.
 * - Al cambiar de buzón, la firma del texto se cambia por la del nuevo, pero SOLO si sigue tal cual al final del texto: si la persona la ha tocado, no
 *   se pisa lo que ha escrito.
 * - El «De:» solo se puede cambiar en un mensaje nuevo: al contestar o reenviar, el mensaje original es de un buzón concreto (la ruta de enviar exige
 *   que `respondeA` sea del mismo buzón).
 */

export interface BuzonDeEnvio {
  id: string
  puedeResponder: boolean
  conectado: boolean
  credencialesInvalidas: boolean
}

/** ¿Se puede enviar desde aquí ahora mismo? */
export function sePuedeEnviarDesde(b: BuzonDeEnvio): boolean {
  return b.puedeResponder && b.conectado && !b.credencialesInvalidas
}

/** Las opciones del «De:», sin repetidos y con el buzón de partida delante (aunque no cumpla: es el de hoy y el que decide quien abre el mensaje) */
export function buzonesDeEnvio<T extends BuzonDeEnvio>(inicial: T, lista: readonly T[] | undefined): T[] {
  const vistos = new Set<string>([inicial.id])
  const salida: T[] = [inicial]
  for (const b of lista ?? []) {
    if (vistos.has(b.id) || !sePuedeEnviarDesde(b)) continue
    vistos.add(b.id)
    salida.push(b)
  }
  return salida
}

/** ¿Se enseña el selector «De:»? Con 2 o más opciones y solo en un mensaje nuevo */
export function hayQueElegirDe(opciones: number, modo: string): boolean {
  return opciones >= 2 && modo === 'nuevo'
}

/**
 * Cambia la firma del final del texto por la del buzón nuevo. `cambiada` = false si la firma vieja no estaba intacta al final (se ha editado): el
 * texto se devuelve igual y quien llama avisa. Sin firma vieja, la nueva se pone debajo de lo escrito, con la misma forma que `borradorDe` («\n\nfirma»).
 */
export function cambiarFirma(texto: string, vieja: string | null | undefined, nueva: string | null | undefined): { texto: string; cambiada: boolean } {
  const f0 = (vieja ?? '').trim()
  const f1 = (nueva ?? '').trim()
  if (f0 === f1) return { texto, cambiada: true }
  const recortado = texto.replace(/\s+$/, '')
  if (f0 && !recortado.endsWith(f0)) return { texto, cambiada: false }
  const cuerpo = f0 ? textoSinFirma(texto, f0) : recortado
  if (!f1) return { texto: cuerpo, cambiada: true }
  return { texto: `${cuerpo}\n\n${f1}`, cambiada: true }
}
