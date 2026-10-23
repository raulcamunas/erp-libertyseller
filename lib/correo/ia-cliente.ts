import { textoSinFirma } from './plantillas'

/**
 * LO QUE EL CUADRO DE CORREO NECESITA PARA PONER UN BORRADOR DE LA IA — NAVEGADOR.
 * PURO. Se comprueba con ia-cliente.prueba.ts.
 */

/** Lo que devuelve /api/correo/redactar-ia */
export interface RespuestaDeRedactar {
  ok: boolean
  /** El id del registro del borrador; null si la migración 242 no está lanzada. Se manda de vuelta al enviar */
  id: string | null
  /** La versión de la IA que lo escribió (no se enseña): se devuelve al redactar de nuevo el mismo correo para mantenerla */
  versionId: string | null
  asunto: string
  texto: string
  angulo: string
  /** Cuántos correos del equipo con respuesta se le enseñaron a la IA */
  ejemplos: number
  aviso: string | null
}

/** Atajos para pedir cambios al borrador con un clic: se añaden a las indicaciones */
export const SUGERENCIAS_DE_CAMBIO: readonly string[] = ['Más corto', 'Más directo', 'Más cercano', 'Menciona que le he llamado', 'Que suene a seguimiento']

/**
 * El mensaje con el borrador puesto: el cuerpo nuevo y debajo la firma del buzón, como cuando se abre el mensaje en blanco. Lo que había
 * escrito encima de la firma se sustituye; la firma siempre queda la del buzón (sin duplicarla aunque el borrador anterior ya la tuviera).
 */
export function ponerBorradorIa(firma: string | null | undefined, cuerpoNuevo: string): string {
  const f = (firma ?? '').trim()
  const cuerpo = cuerpoNuevo.replace(/\s+$/, '').replace(/^\s+/, '')
  return f ? `${cuerpo}\n\n${f}` : cuerpo
}

/** Lo que hay escrito en el mensaje sin la firma, recortado: el cuerpo que la IA toma como base si se le pide cambiarlo */
export function cuerpoEscrito(texto: string, firma: string | null | undefined): string {
  return textoSinFirma(texto, firma).trim()
}

/** ¿Hay algo escrito por una persona (o por la IA antes) encima de la firma? Con eso la IA parte de ello en vez de empezar de cero */
export function hayCuerpoEscrito(texto: string, firma: string | null | undefined): boolean {
  return cuerpoEscrito(texto, firma).length >= 20
}

/** Suma una sugerencia a lo que se había escrito en las indicaciones, sin repetirla */
export function sumarIndicacion(indicaciones: string, sugerencia: string): string {
  const actual = indicaciones.trim()
  if (actual.toLowerCase().includes(sugerencia.toLowerCase())) return actual
  return actual === '' ? sugerencia : `${actual.replace(/[.,;]+$/, '')}. ${sugerencia}`
}
