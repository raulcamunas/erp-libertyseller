/**
 * CUÁNTOS WHATSAPP CON IA PUEDE PEDIR UNA PERSONA — SOLO SERVIDOR.
 * =================================================================
 * Cada mensaje cuesta una fracción de céntimo de IA, pero un bucle o un dedo nervioso sobre «Otra versión» podría pedir cientos. Esto pone un tope por
 * persona: LIMITE_POR_HORA en la última hora y LIMITE_POR_DIA en las últimas 24.
 *
 * Se cuenta EN LA MEMORIA DEL PROCESO, no en la base (no hace falta ninguna migración): si el servidor se reinicia se empieza de cero y, si hubiera
 * varias instancias, cada una cuenta las suyas. Sirve para frenar un uso desbocado, no es contabilidad: el gasto real lo enseña Sistema → «Gasto en IA».
 * Se comprueba con ia-limite.prueba.ts.
 */

export const LIMITE_POR_HORA = 60
export const LIMITE_POR_DIA = 300
const HORA_MS = 3_600_000
const DIA_MS = 86_400_000

export type Peticiones = Map<string, number[]>
const delProceso: Peticiones = new Map()

export type Permiso = { permitido: true } | { permitido: false; motivo: string }

export interface Limites {
  porHora: number
  porDia: number
}

export const LIMITES_DE_LOS_COMERCIALES: Limites = { porHora: LIMITE_POR_HORA, porDia: LIMITE_POR_DIA }

/**
 * Las pruebas de la pantalla de calibrar: quien calibra lanza lotes de casos (diez a la vez, varias veces), así que tiene más hueco que un comercial. Van aparte y con su propia
 * cuenta (`delLaboratorio`), para que probar no le quite a nadie los mensajes del día.
 */
export const LIMITES_DEL_LABORATORIO: Limites = { porHora: 200, porDia: 800 }
export const delLaboratorio: Peticiones = new Map()

/**
 * Apunta `cantidad` peticiones de esta persona y dice si se le deja, o por qué no. Una petición rechazada NO se apunta (y un lote no cabe a medias: o entra entero o no entra).
 * Con `peticiones` y `limites` distintos se lleva otra cuenta (la del laboratorio).
 */
export function pedirPermiso(userId: string, ahora = Date.now(), peticiones: Peticiones = delProceso, limites: Limites = LIMITES_DE_LOS_COMERCIALES, cantidad = 1): Permiso {
  const recientes = (peticiones.get(userId) ?? []).filter((t) => ahora - t < DIA_MS)
  const ultimaHora = recientes.filter((t) => ahora - t < HORA_MS).length
  if (ultimaHora + cantidad > limites.porHora) {
    peticiones.set(userId, recientes)
    return { permitido: false, motivo: `Has pedido ${limites.porHora} mensajes en la última hora: espera un rato para pedir más.` }
  }
  if (recientes.length + cantidad > limites.porDia) {
    peticiones.set(userId, recientes)
    return { permitido: false, motivo: `Has llegado al límite de ${limites.porDia} mensajes con IA de hoy.` }
  }
  for (let i = 0; i < cantidad; i++) recientes.push(ahora)
  peticiones.set(userId, recientes)

  // Para que el mapa no crezca con gente que ya no pide
  if (peticiones.size > 200) {
    for (const [id, tiempos] of peticiones) if (tiempos.every((t) => ahora - t >= DIA_MS)) peticiones.delete(id)
  }
  return { permitido: true }
}
