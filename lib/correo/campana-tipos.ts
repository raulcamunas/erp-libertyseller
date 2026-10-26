/**
 * LOS AVISOS DE CORREO DE LA CAMPANA: SUS TIPOS Y A DÓNDE LLEVA CADA UNO — PURO Y PEQUEÑO.
 * ========================================================================================
 * Vive aparte de campana.ts (que compone los textos y arrastra el análisis de rebotes) para que la campana de la barra lateral, que corre en el
 * navegador, solo cargue esto. Se comprueba con campana.prueba.ts.
 *
 * Los avisos son filas de `notifications` (migración 040) con el tipo, una `clave` que impide repetirlos y unos `datos` con lo que hace falta para
 * llevarte al sitio al pulsarlos (migración 251).
 */

export const TIPOS_DE_AVISO_DE_CORREO = ['correo_nuevo', 'correo_rebote', 'secuencia_pausada', 'secuencia_parada', 'respuesta_lead'] as const
export type TipoDeAvisoDeCorreo = (typeof TIPOS_DE_AVISO_DE_CORREO)[number]

export const esTipoDeAvisoDeCorreo = (tipo: unknown): tipo is TipoDeAvisoDeCorreo => typeof tipo === 'string' && (TIPOS_DE_AVISO_DE_CORREO as readonly string[]).includes(tipo)

/** Lo que va en `notifications.datos`: de dónde es el aviso. Todo opcional: un aviso sin esto lleva a Correo y ya */
export interface DatosDeAviso {
  buzonId?: string
  hiloId?: string
  mensajeId?: string
  inscripcionId?: string
  leadId?: string
  /** La dirección a la que no se pudo entregar */
  direccion?: string
  /** Qué entendió la IA de una respuesta (interesado, pide_info…) */
  clase?: string
}

/** A dónde lleva un aviso al pulsarlo */
export type DestinoDeAviso =
  /** Correo, con esa conversación abierta */
  | { tipo: 'hilo'; buzonId: string; hiloId: string }
  /** Correo → Secuencias, con esa secuencia abierta */
  | { tipo: 'secuencia'; inscripcionId: string }
  /** Correo, sin más */
  | { tipo: 'correo' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const comoId = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null)

/**
 * A dónde lleva un aviso de correo. Los datos vienen de la base y no se dan por buenos: un identificador que no es un UUID no sirve y se cae a
 * lo más general (Correo). Un tipo que no es de correo no lleva a ningún sitio de aquí (null): lo gestiona quien lo conoce.
 */
export function destinoDeAvisoDeCorreo(tipo: string, datos: unknown): DestinoDeAviso | null {
  if (!esTipoDeAvisoDeCorreo(tipo)) return null
  const d = datos !== null && typeof datos === 'object' ? (datos as Record<string, unknown>) : {}
  const inscripcion = comoId(d.inscripcionId)
  const buzon = comoId(d.buzonId)
  const hilo = comoId(d.hiloId)
  // Los avisos de la secuencia llevan a la secuencia; los de un correo, a su conversación (también una respuesta que ya se ha leído con la IA)
  if ((tipo === 'secuencia_pausada' || tipo === 'secuencia_parada') && inscripcion) return { tipo: 'secuencia', inscripcionId: inscripcion }
  if (buzon && hilo) return { tipo: 'hilo', buzonId: buzon, hiloId: hilo }
  if (inscripcion) return { tipo: 'secuencia', inscripcionId: inscripcion }
  return { tipo: 'correo' }
}
