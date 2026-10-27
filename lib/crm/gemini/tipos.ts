/**
 * LAS NOTAS DE GEMINI DE UNA REUNIÓN CON UN CLIENTE: QUÉ SON Y QUÉ FORMA TIENEN.
 * ==============================================================================
 * Al acabar una reunión de Google Meet con las notas de Gemini encendidas, Google manda UN CORREO a business@ (de gemini-notes@google.com) y deja un DOCUMENTO «Notas de
 * Gemini» en Drive. Las dos cosas dicen lo mismo con distinto nivel de detalle:
 *
 *   · el CORREO trae el resumen, unos temas y los «pasos siguientes recomendados», y el enlace al documento. No dice con quién se habló ni cuándo empezó la reunión.
 *   · el DOCUMENTO (con dos pestañas: «Notas» y «Transcripción») trae además las decisiones, el detalle largo de cada tema y la transcripción entera con quién dice cada frase,
 *     más el correo del invitado y el enlace al evento del calendario —que es lo que permite casar la nota con la cita del ERP sin adivinar.
 *
 * Esto de aquí son las formas comunes: lo que se lee (NotaLeida), lo que se guarda (FilaDeNota) y lo que la IA saca (AnalisisDeReunion).
 */

import type { CrmStage } from '@/lib/types/crm'

export interface TemaDeNota {
  titulo: string
  texto: string
}

export interface PasoDeNota {
  /** Quién lo hace: «Liberty Seller», el nombre del invitado, «El grupo»… null si Gemini no lo dijo */
  quien: string | null
  que: string
  detalle: string | null
}

/** Lo que se ha podido leer de un correo y/o un documento de Gemini, antes de saber a qué cliente pertenece */
export interface NotaLeida {
  gmailMessageId: string | null
  driveFileId: string | null
  /** El id del evento de Google Calendar (el de `appointments.google_event_id`), si el documento lo enlaza */
  googleEventId: string | null
  /** «Consultoría Estratégica Amazon · Liberty Seller · Ana Pérez» */
  titulo: string
  /** ISO. Cuándo EMPEZÓ la reunión si se sabe (el título del documento lo dice), si no, cuándo llegó el correo */
  fechaReunion: string | null
  invitados: string[]
  resumen: string | null
  temas: TemaDeNota[]
  proximosPasos: PasoDeNota[]
  detalle: string | null
  transcripcion: string | null
  /** true si se leyó el documento (con detalle y transcripción) */
  completa: boolean
}

/**
 * pendiente: casada con un cliente, falta el análisis · procesada: analizada · sin_cita: reunión con un cliente que no se pudo casar con ninguna cita ·
 * error: el análisis falló y no se reintenta · ignorada: reunión interna del equipo (solo se apunta el id del correo y el título, nunca el contenido)
 */
export type EstadoDeNota = 'pendiente' | 'procesada' | 'sin_cita' | 'error' | 'ignorada'
export type MetodoDeCita = 'evento' | 'invitado' | 'nombre' | 'manual'

/** Una nota tal como se guarda (crm_notas_reunion). Para la lista se piden solo las columnas cortas: el detalle y la transcripción se piden al abrirlas */
export interface FilaDeNota {
  id: string
  client_id: string | null
  appointment_id: string | null
  estado: EstadoDeNota
  fuente: string
  gmail_message_id: string | null
  drive_file_id: string | null
  google_event_id: string | null
  titulo: string
  fecha_reunion: string | null
  invitados: string[]
  resumen: string | null
  temas: TemaDeNota[]
  proximos_pasos: PasoDeNota[]
  completa: boolean
  metodo_cita: MetodoDeCita | null
  analisis: AnalisisDeReunion | null
  analisis_modelo: string | null
  analisis_en: string | null
  analisis_intentos: number
  error: string | null
  creada_en: string
  actualizada_en: string
}

/** Las columnas que se piden para pintar la nota (sin el detalle ni la transcripción, que pesan decenas de miles de caracteres) */
export const COLUMNAS_DE_NOTA =
  'id, client_id, appointment_id, estado, fuente, gmail_message_id, drive_file_id, google_event_id, titulo, fecha_reunion, invitados, resumen, temas, proximos_pasos, completa, metodo_cita, analisis, analisis_modelo, analisis_en, analisis_intentos, error, creada_en, actualizada_en'

/* ------------------------------------------------------------------ */
/* El desglose de la IA                                                */
/* ------------------------------------------------------------------ */

export type ModeloDeNegocio = 'marca_propia' | 'arbitraje' | 'dropshipping' | 'mixto' | 'otro' | 'no_claro'
export type InteresDelCliente = 'alto' | 'medio' | 'bajo' | 'ninguno' | 'no_claro'

/**
 * LO QUE LA IA SACA DE UNA REUNIÓN. La forma sigue lo que la guía de propuestas de Liberty Seller pide extraer de una llamada de consultoría (quién es el cliente, su negocio,
 * facturación, mercados, los tres o cuatro dolores, las oportunidades, el alcance, los pasos acordados), más lo que hace falta para trabajar la ficha (interés, objeciones,
 * respuestas del guion) y para la propuesta que vendrá después (lo que se propondría y por qué). NO lleva importes de la propuesta: los precios los decide una persona; aquí solo
 * se recoge lo que se DIJO en la reunión sobre dinero.
 */
export interface AnalisisDeReunion {
  version: 1
  /** Dos a cuatro frases: quién es, qué quiere y cómo acabó la reunión */
  resumen: string
  cliente: {
    empresa: string | null
    contacto: string | null
    cargo: string | null
    modelo_de_negocio: ModeloDeNegocio
    sector: string | null
    producto: string | null
  }
  negocio: {
    /** Lo que vende y cómo, en una o dos frases */
    descripcion: string
    n_productos: string | null
    facturacion_actual: string | null
    canales: string[]
    mercados_activos: string[]
    mercados_objetivo: string[]
    situacion_en_amazon: string
  }
  objetivos: string[]
  /** Los problemas detectados, de tres a cuatro: alimentan el diagnóstico de la propuesta */
  dolores: Array<{ titulo: string; detalle: string }>
  oportunidades: string[]
  objeciones: string[]
  interes: { nivel: InteresDelCliente; motivo: string }
  decisiones: string[]
  /** Lo que se dijo de dinero, tal cual y sin interpretar: «700 € al mes durante tres meses», «un 40 % de los beneficios» */
  cifras_dichas: Array<{ concepto: string; valor: string }>
  alcance: { incluye: string[]; no_incluye: string[] }
  proximos_pasos: Array<{ quien: string; que: string; cuando: string | null }>
  preguntas_abiertas: string[]
  /** Respuestas del guion de la reunión que se pueden deducir de lo hablado: la clave es la de PREGUNTAS_REUNION (lib/types/crm.ts) */
  respuestas_guion: Array<{ clave: string; respuesta: string }>
  /**
   * LO QUE SE PROPONDRÍA. Sigue las páginas de la propuesta de Liberty Seller (guía propuesta-amazon-liberty-seller): los servicios de la portada (tres o cuatro), el diagnóstico
   * (los dolores de arriba y tres datos clave), el plan en dos fases —SETUP los meses 1–3 y CRECIMIENTO del mes 4 en adelante, cuatro pasos cada una— y los riesgos. Sin importes:
   * el setup, la cuota base y el % variable los pone una persona.
   */
  propuesta: {
    enfoque: string
    servicios: Array<{ nombre: string; motivo: string; prioridad: 'alta' | 'media' | 'baja' }>
    datos_clave: Array<{ valor: string; etiqueta: string }>
    fase_setup: Array<{ titulo: string; detalle: string }>
    fase_crecimiento: Array<{ titulo: string; detalle: string }>
    riesgos: string[]
  }
  /** Frases del cliente que valen la pena releer, con el minuto si se sabe */
  frases_clave: Array<{ minuto: string | null; quien: string; texto: string }>
  /** La fase del embudo que parece corresponder a lo hablado: solo una SUGERENCIA, la fase la cambia una persona */
  fase_sugerida: CrmStage | null
}
