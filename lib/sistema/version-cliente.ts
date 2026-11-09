/**
 * AVISO DE «HAY UNA VERSIÓN NUEVA» — LA DECISIÓN, PURA. El navegador sabe con qué versión se pintó la pantalla (`inicial`), pregunta cuál es la de ahora (`actual`, null si la pregunta falló) y recuerda
 * cuál descartó el usuario con la «x» (`descartada`). Se comprueba en version.prueba.ts.
 */

/**
 * ESTE FICHERO LO USA EL NAVEGADOR: no puede importar nada que toque el sistema de ficheros (`version.ts` usa node:fs y node:path y reventaría la construcción). La constante vive aquí y `version.ts` (servidor) la importa.
 */
export const VERSION_DE_DESARROLLO = 'desarrollo'

export type DecisionDeAviso = 'ninguno' | 'mostrar'

export function decidirAviso(p: { inicial: string; actual: string | null; descartada: string | null }): DecisionDeAviso {
  const { inicial, actual, descartada } = p
  // Sin saber la de ahora (la pregunta falló, el servidor se está reiniciando), no se dice nada
  if (!actual) return 'ninguno'
  // En desarrollo no hay versiones
  if (inicial === VERSION_DE_DESARROLLO || actual === VERSION_DE_DESARROLLO) return 'ninguno'
  if (actual === inicial) return 'ninguno'
  // La «x» descarta ESA versión: la siguiente despliegue vuelve a avisar
  if (actual === descartada) return 'ninguno'
  return 'mostrar'
}

/** Lo que contesta /api/version, validado */
export function idDeRespuesta(cuerpo: unknown): string | null {
  const id = (cuerpo as { id?: unknown } | null)?.id
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null
}

/** Cada cuánto se pregunta con la pestaña a la vista */
export const PREGUNTAR_VERSION_CADA_MS = 60_000
