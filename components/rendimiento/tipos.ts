/**
 * LAS FORMAS QUE SE PASAN ENTRE LAS PIEZAS DEL PANEL «MI RENDIMIENTO».
 * Solo tipos y dos constantes: nada que importe Supabase ni el servidor.
 */

/** Una llamada tal como se lee de la base. Cumple LlamadaParaMetricas (lib/rendimiento/metricas.ts) */
export interface LlamadaGuardada {
  id: string
  fecha: string
  direccion: string
  duracion_s: number
  estado: string
  motivo_perdida: string | null
  numero: string | null
  numero_anonimo: boolean
  lead_id: string | null
  grabacion_id: string | null
  grabacion_hasta: string | null
}

/** Lo justo de una nota de Cold Calling para contar conversaciones, correos y respuestas */
export interface NotaDelDia {
  kind: string
  es_respuesta: boolean | null
  occurred_at: string
  /** El cliente: varias notas del mismo cliente el mismo día son UNA conversación */
  lead_id: string | null
}

/** El estado de la cuenta de Rinkel de una persona (rinkel_vinculos). La clave NO está aquí: no sale de la base */
export interface VinculoVisible {
  user_id: string
  rinkel_usuario: string | null
  rinkel_numero: string | null
  vinculado_at: string
  ultimo_sync_at: string | null
  ultimo_intento_at: string | null
  ultimo_error: string | null
  historico_completo: boolean
  rinkel_total: number | null
}

export interface Miembro {
  id: string
  nombre: string
  /** Tiene la clave de Rinkel vinculada */
  vinculado: boolean
  /** Es del equipo que se mide —comercial (profiles.is_comercial) o manager comercial (profiles.puesto)—: solo ellos salen en el resumen del equipo */
  comercial: boolean
}

export const CAMPOS_DE_LLAMADA =
  'id, fecha, direccion, duracion_s, estado, motivo_perdida, numero, numero_anonimo, lead_id, grabacion_id, grabacion_hasta'

export const CAMPOS_DEL_VINCULO =
  'user_id, rinkel_usuario, rinkel_numero, vinculado_at, ultimo_sync_at, ultimo_intento_at, ultimo_error, historico_completo, rinkel_total'
