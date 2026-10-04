/**
 * Calendario de contenido. Ver supabase/migrations/217_calendario_contenido.sql
 * para por qué son dos tablas y no una.
 */

export type TipoPieza = 'video' | 'carrusel'
export type EstadoEncargo = 'programado' | 'publicado' | 'saltado'

export interface ContenidoPieza {
  id: string
  tipo: TipoPieza
  titulo: string
  slug: string
  texto_post: string
  angulo: string | null
  origen: string | null
  fichero_path: string | null
  fichero_nombre: string | null
  fichero_bytes: number | null
  fichero_mime: string | null
  creado_at: string
  creado_por: string | null
}

export interface ContenidoEncargo {
  id: string
  fecha: string
  pieza_id: string
  responsable_id: string
  estado: EstadoEncargo
  publicado_at: string | null
  nota: string | null
  creado_at: string
}

/** Lo que de verdad se pinta: el encargo con su pieza y su persona resueltas. */
export interface EncargoResuelto extends ContenidoEncargo {
  pieza: ContenidoPieza
  responsable: {id: string; full_name: string | null; email: string | null}
}

export const ETIQUETA_TIPO: Record<TipoPieza, string> = {
  video: 'Vídeo',
  carrusel: 'Carrusel',
}

export const ETIQUETA_ESTADO: Record<EstadoEncargo, string> = {
  programado: 'Programado',
  publicado: 'Publicado',
  saltado: 'Saltado',
}

/**
 * El lunes es el día 1. Date.getDay() devuelve 0 para el domingo, que en un
 * calendario español va al final de la semana, no al principio.
 */
export function lunesDe(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const diaDesdeLunes = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - diaDesdeLunes)
  return x
}

export function diasDeLaSemana(lunes: Date): Date[] {
  return Array.from({length: 7}, (_, i) => {
    const d = new Date(lunes)
    d.setDate(lunes.getDate() + i)
    return d
  })
}

/**
 * Fecha a 'YYYY-MM-DD' en hora LOCAL.
 *
 * No vale toISOString(): convierte a UTC antes de recortar, así que en horario de
 * verano peninsular (UTC+2) cualquier fecha a las 00:00 locales sale como el día
 * ANTERIOR. Un carrusel programado para el lunes aparecía el domingo.
 */
export function aFechaISO(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export const NOMBRE_DIA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

export const NOMBRE_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** «del 6 al 12 de octubre», o «del 29 de septiembre al 5 de octubre». */
export function rotuloSemana(lunes: Date): string {
  const domingo = new Date(lunes)
  domingo.setDate(lunes.getDate() + 6)
  const mesIgual = lunes.getMonth() === domingo.getMonth()
  const a = mesIgual ? `${lunes.getDate()}` : `${lunes.getDate()} de ${NOMBRE_MES[lunes.getMonth()]}`
  return `del ${a} al ${domingo.getDate()} de ${NOMBRE_MES[domingo.getMonth()]}`
}

export function pesoLegible(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
