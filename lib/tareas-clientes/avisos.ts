/**
 * A QUIÉN SE AVISA DE LO QUE PASA EN UNA TAREA — PURO.
 *
 * Quien hace el cambio nunca se avisa a sí mismo. Las menciones avisan siempre; lo demás, solo a quien lleva la tarea o la creó. Que una tarea cambie de columna NO avisa a
 * nadie (quedaría en el historial y la campana se llenaría): avisan los comentarios, las menciones y las asignaciones.
 *
 * Hoy lo lee la campana del ERP; mañana el mismo `tc_actividad` alimentará Slack y el panel del cliente sin tocar nada de esto.
 */

export interface DatosDeAvisoDeComentario {
  actorId: string
  responsables: readonly string[]
  creadoPor: string | null
  menciones: readonly string[]
}

export interface Destinatario {
  userId: string
  tipo: 'comment' | 'mention'
}

/** Quién recibe el aviso de un comentario: los mencionados como mención y, como comentario, quien lleva la tarea o la creó */
export function destinatariosDeComentario(d: DatosDeAvisoDeComentario): Destinatario[] {
  const salida = new Map<string, Destinatario>()
  for (const id of d.menciones) if (id !== d.actorId) salida.set(id, { userId: id, tipo: 'mention' })
  for (const id of [...d.responsables, ...(d.creadoPor ? [d.creadoPor] : [])]) {
    if (id !== d.actorId && !salida.has(id)) salida.set(id, { userId: id, tipo: 'comment' })
  }
  return [...salida.values()]
}

/** A quién avisa una asignación: a quien se acaba de añadir, menos a quien lo hizo */
export function destinatariosDeAsignacion(antes: readonly string[], despues: readonly string[], actorId: string): string[] {
  const yaEstaban = new Set(antes)
  return despues.filter((id) => !yaEstaban.has(id) && id !== actorId)
}

/** Las menciones de un comentario: las personas cuyo @nombre aparece escrito, de entre las que se pueden mencionar */
export function mencionesEnTexto(texto: string, personas: ReadonlyArray<{ id: string; nombre: string }>): string[] {
  const salida: string[] = []
  let bajo = texto.toLowerCase()
  // Primero los nombres más largos, y lo que ya se ha reconocido se tapa: «@Maria Fernanda» no cuenta también como «@Maria»
  for (const p of [...personas].sort((a, b) => b.nombre.length - a.nombre.length)) {
    const nombre = p.nombre.trim().toLowerCase()
    if (!nombre) continue
    const buscado = `@${nombre}`
    let desde = 0
    while (true) {
      const i = bajo.indexOf(buscado, desde)
      if (i < 0) break
      const siguiente = bajo[i + buscado.length]
      desde = i + buscado.length
      if (siguiente && /[\p{L}\p{N}]/u.test(siguiente)) continue
      if (!salida.includes(p.id)) salida.push(p.id)
      bajo = `${bajo.slice(0, i)}${'\u0000'.repeat(buscado.length)}${bajo.slice(i + buscado.length)}`
    }
  }
  return salida
}

/** El texto corto de un aviso: sin saltos de línea y a un largo que quepa en la campana */
export function resumen(texto: string, largo = 140): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  return limpio.length > largo ? `${limpio.slice(0, largo - 1)}…` : limpio
}
