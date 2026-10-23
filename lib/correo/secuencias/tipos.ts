/**
 * LOS TIPOS DE LAS SECUENCIAS DE CORREO — compartidos por el motor, el servidor y la pantalla.
 * ==============================================================================================
 * Solo tipos y constantes: no toca la base ni la red.
 *
 * Las FILAS son tal y como las devuelve la base (migración 245): las fechas llegan como texto ISO y se pasan a milisegundos al leerlas en
 * almacen.ts, de modo que el resto del motor trabaja siempre con números (instantes) y con días «2026-10-28» en hora de Madrid.
 */

export const ESTADOS_DE_INSCRIPCION = ['activa', 'pausada', 'respondida', 'parada', 'completada', 'sin_respuesta', 'cancelada'] as const
export type EstadoDeInscripcion = (typeof ESTADOS_DE_INSCRIPCION)[number]

export const ESTADOS_DE_PASO = ['pendiente', 'enviando', 'enviado', 'pausado', 'saltado', 'cancelado', 'fallido'] as const
export type EstadoDePaso = (typeof ESTADOS_DE_PASO)[number]

/** Una secuencia que sigue en marcha (el motor la trabaja) o pausada a la espera de una persona */
export const ESTADOS_VIVOS: readonly EstadoDeInscripcion[] = ['activa', 'pausada']
/** Un paso que todavía puede salir */
export const ESTADOS_DE_PASO_ABIERTOS: readonly EstadoDePaso[] = ['pendiente', 'enviando', 'pausado']
/** Un paso que ya no cambiará solo */
export const ESTADOS_DE_PASO_CERRADOS: readonly EstadoDePaso[] = ['enviado', 'saltado', 'cancelado', 'fallido']

/** Qué miró el control de salida y qué decidió, tal y como se guarda en `correo_secuencia_pasos.decision` (JSON pequeño) */
export interface DecisionGuardada {
  /** Cuándo se tomó, en ms */
  en?: number
  accion?: 'enviar' | 'aplazar' | 'parar' | 'adaptar' | 'pausar' | 'ensayo'
  codigo?: string
  motivo?: string
  /** Se miró la ficha con la IA antes de enviar */
  revisadoConIa?: boolean
  /** Lo que dijo el revisor */
  revision?: { decision: string; motivo: string }
  /** Mensajes entrantes que ya atrasaron este envío una vez (un «fuera de oficina» solo atrasa una) */
  ignorar?: string[]
  /** En modo ensayo: lo que habría pasado */
  ensayo?: { accion: string; motivo: string; en: number }
  modelo?: string
}

export interface FilaDeSecuencia {
  id: string
  nombre: string
  activa: boolean
  es_base: boolean
  pasos: unknown
}

export interface FilaDeInscripcion {
  id: string
  secuencia_id: string
  lead_id: string
  buzon_id: string
  user_id: string
  hilo_id: string | null
  message_id_inicial: string | null
  destinatario: string
  asunto_base: string
  estado: EstadoDeInscripcion
  motivo: string | null
  codigo: string | null
  primer_envio_at: string
  no_interesa_en: string | null
  parada_at: string | null
  ia_modelo: string | null
  creada_at: string
  actualizada_at: string
}

export interface FilaDePaso {
  id: string
  inscripcion_id: string
  buzon_id: string
  dominio: string
  orden: number
  estado: EstadoDePaso
  motivo: string | null
  asunto: string
  texto: string
  texto_enviado: string | null
  dias_habiles: number
  objetivo_dia: string | null
  programado_at: string | null
  enviado_at: string | null
  message_id: string | null
  intentos: number
  siguiente_intento_at: string | null
  reclamado_at: string | null
  decision: DecisionGuardada | null
  creado_at: string
  actualizado_at: string
}

export interface FilaDeEvento {
  id: number
  inscripcion_id: string | null
  paso_id: string | null
  buzon_id: string | null
  tipo: string
  detalle: string | null
  creado_at: string
}

/** Los tipos de evento que apunta el motor (la pantalla los pinta con su icono y su frase) */
export const TIPOS_DE_EVENTO = [
  'inscrita',
  'programado',
  'reprogramado',
  'enviado',
  'recuperado',
  'adaptado',
  'aplazado',
  'saltado',
  'pausado',
  'reanudado',
  'cancelada',
  'editado',
  'respuesta',
  'rebote',
  'fuera_de_oficina',
  'parada',
  'completada',
  'no_interesa',
  'ensayo',
  'freno',
  'error',
  'sin_hueco',
] as const
export type TipoDeEvento = (typeof TIPOS_DE_EVENTO)[number]

/** Un paso con sus fechas ya en milisegundos: lo que usa el motor */
export interface PasoDelMotor {
  id: string
  inscripcionId: string
  buzonId: string
  dominio: string
  orden: number
  estado: EstadoDePaso
  motivo: string | null
  asunto: string
  texto: string
  textoEnviado: string | null
  diasHabiles: number
  objetivoDia: string | null
  programadoAt: number | null
  enviadoAt: number | null
  messageId: string | null
  intentos: number
  siguienteIntentoAt: number | null
  reclamadoAt: number | null
  decision: DecisionGuardada | null
}

export interface InscripcionDelMotor {
  id: string
  secuenciaId: string
  leadId: string
  buzonId: string
  userId: string
  hiloId: string | null
  messageIdInicial: string | null
  destinatario: string
  asuntoBase: string
  estado: EstadoDeInscripcion
  motivo: string | null
  codigo: string | null
  primerEnvioAt: number
  noInteresaEn: number | null
  paradaAt: number | null
  iaModelo: string | null
  creadaAt: number
}

/** Un buzón tal y como lo ve el motor: lo del correo (dirección, firma, conexión) y lo propio de las secuencias */
export interface BuzonDelMotor {
  id: string
  userId: string
  direccion: string
  nombre: string | null
  firma: string | null
  conectado: boolean
  credencialesInvalidas: boolean
  ultimoSyncAt: number | null
  participa: boolean
  pausadoHasta: number | null
  motivoPausa: string | null
  rampaInicio: string | null
  topeDiario: number | null
  llamadasDesdeMin: number
  llamadasHastaMin: number
}

export interface FilaDeAjustesLeida {
  activa: boolean
  modoEnsayo: boolean
  vigilanciaAt: number | null
  purgadoAt: number | null
}
