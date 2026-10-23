import { esPersonaDeFuera, esRechazo } from './ia-ejemplos'

/**
 * QUÉ VERSIÓN DE LA IA CONSIGUE MÁS RESPUESTAS.
 * =============================================
 * PURO: no toca la base ni la red. Se comprueba con ia-resultados.prueba.ts.
 *
 * Un envío «responde» si, DESPUÉS de enviarse, entra en su conversación un correo de una PERSONA DE FUERA (ni automático, ni de un buzón del
 * equipo, ni un no-reply: `esPersonaDeFuera`). Y es una respuesta «con interés» si alguno de esos correos no es un «no» (`esRechazo`).
 * La apertura NO se mide: sin un píxel de seguimiento no hay forma, y el píxel perjudica la entrega.
 *
 * LAS TASAS SON BAJAS Y LOS NÚMEROS, PEQUEÑOS. Con un 2-3 % de respuesta, que una versión saque 4 de 60 y otra 2 de 60 no demuestra nada:
 * es lo que sale por azar. Por eso cada tasa lleva su INTERVALO (Wilson, 95 %) y el veredicto solo dice que una versión gana cuando su
 * intervalo queda por encima del de la segunda; si no, dice que todavía no se sabe y que hacen falta más envíos. Es preferible que la
 * pantalla diga «no se sabe» muchas semanas a que se cambie el correo de todo el equipo por una casualidad.
 */

/** Los envíos que hacen falta por versión antes de comparar nada */
export const MINIMO_PARA_COMPARAR = 30

export interface MensajeEntrante {
  hiloId: string
  fecha: string
  deDireccion: string
  automatico: boolean
  texto: string
}

export interface DesenlaceDeUnEnvio {
  /** Contestó una persona de fuera (incluye un «no, gracias») */
  respondio: boolean
  /** Contestó alguien y no fue un «no» */
  interesada: boolean
}

/** Qué pasó con un correo que se envió en `enviadoAt`, a la vista de lo que ha entrado después en su conversación */
export function desenlaceDeEnvio(enviadoAt: string, entrantes: readonly MensajeEntrante[], dominiosPropios: ReadonlySet<string>): DesenlaceDeUnEnvio {
  const desde = Date.parse(enviadoAt)
  const respuestas = entrantes.filter((m) => Date.parse(m.fecha) > desde && esPersonaDeFuera(m, dominiosPropios))
  return { respondio: respuestas.length > 0, interesada: respuestas.some((m) => !esRechazo(m.texto)) }
}

/** El intervalo de Wilson al 95 % de una proporción: entre qué valores cae la tasa real. null si no hay envíos */
export function intervaloDeWilson(exitos: number, total: number, z = 1.96): [number, number] | null {
  if (total <= 0) return null
  const p = Math.min(Math.max(exitos / total, 0), 1)
  const z2 = z * z
  const denominador = 1 + z2 / total
  const centro = (p + z2 / (2 * total)) / denominador
  const margen = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominador
  return [Math.max(0, centro - margen), Math.min(1, centro + margen)]
}

export interface ResumenDeGrupo {
  enviados: number
  respondieron: number
  interesadas: number
  tasaRespuesta: number | null
  tasaInteres: number | null
  intervaloInteres: [number, number] | null
  /** Cuánto cambió el comercial lo que escribió la IA, de media y en %. null si no hay ningún envío con texto final */
  cambiosMedios: number | null
}

export function resumirGrupo(envios: ReadonlyArray<{ desenlace: DesenlaceDeUnEnvio; cambios?: number | null }>): ResumenDeGrupo {
  const enviados = envios.length
  const respondieron = envios.filter((e) => e.desenlace.respondio).length
  const interesadas = envios.filter((e) => e.desenlace.interesada).length
  const conCambios = envios.map((e) => e.cambios).filter((c): c is number => typeof c === 'number')
  return {
    enviados,
    respondieron,
    interesadas,
    tasaRespuesta: enviados > 0 ? respondieron / enviados : null,
    tasaInteres: enviados > 0 ? interesadas / enviados : null,
    intervaloInteres: intervaloDeWilson(interesadas, enviados),
    cambiosMedios: conCambios.length > 0 ? Math.round(conCambios.reduce((s, c) => s + c, 0) / conCambios.length) : null,
  }
}

export interface Veredicto {
  tipo: 'sin-datos' | 'sin-diferencia' | 'lider'
  /** La versión que gana, si gana */
  id?: string
  texto: string
}

/**
 * ¿Hay una versión claramente mejor? Compara las respuestas CON INTERÉS de las versiones que ya tienen `MINIMO_PARA_COMPARAR` envíos. Gana
 * la de mayor tasa solo si el extremo de abajo de su intervalo supera el de arriba del de la segunda.
 */
export function veredicto(grupos: ReadonlyArray<{ id: string; nombre: string; enviados: number; interesadas: number }>): Veredicto {
  const maduros = grupos.filter((g) => g.enviados >= MINIMO_PARA_COMPARAR)
  if (maduros.length < 2) {
    const masEnviados = grupos.reduce((m, g) => Math.max(m, g.enviados), 0)
    return {
      tipo: 'sin-datos',
      texto: `Todavía hay pocos envíos para comparar: hacen falta al menos ${MINIMO_PARA_COMPARAR} por versión y la que más lleva tiene ${masEnviados}.`,
    }
  }
  const ordenados = [...maduros].sort((a, b) => b.interesadas / b.enviados - a.interesadas / a.enviados)
  const primero = ordenados[0]
  const segundo = ordenados[1]
  const iPrimero = intervaloDeWilson(primero.interesadas, primero.enviados)!
  const iSegundo = intervaloDeWilson(segundo.interesadas, segundo.enviados)!
  if (primero.interesadas / primero.enviados > segundo.interesadas / segundo.enviados && iPrimero[0] > iSegundo[1]) {
    return { tipo: 'lider', id: primero.id, texto: `«${primero.nombre}» gana con claridad: consigue más respuestas con interés que «${segundo.nombre}» y la diferencia no es casualidad.` }
  }
  return {
    tipo: 'sin-diferencia',
    texto: 'Ninguna versión ha demostrado ser mejor todavía. Con tasas tan bajas hacen falta cientos de envíos por versión para notar una diferencia: sigue el reparto unas semanas más.',
  }
}
