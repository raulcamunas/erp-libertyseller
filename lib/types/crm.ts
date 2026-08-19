import { AppointmentWithPeople, CalendarPerson } from './appointments'

export type CrmStage =
  | 'nuevo'
  | 'seguimiento'
  | 'propuesta_enviada'
  | 'revision_propuesta'
  | 'negociacion'
  | 'ganado'
  | 'perdido'

export type CrmInteractionKind =
  | 'llamada'
  | 'email'
  | 'whatsapp'
  | 'reunion'
  | 'propuesta'
  | 'nota'

export type CrmDocumentKind = 'propuesta' | 'contrato' | 'otro'

export interface CrmClient {
  id: string
  /** null en fichas dadas de alta a mano, sin cita de origen */
  appointment_id: string | null
  stage: CrmStage
  owner_id: string | null

  /** Datos de contacto propios: solo se usan en las altas manuales.
   *  Si la ficha viene de una cita, los datos buenos son los de la cita. */
  lead_name: string | null
  lead_email: string | null
  lead_phone: string | null
  lead_company: string | null
  revenue_amount: number | null
  amazon_link: string | null

  contact_role: string | null
  website: string | null
  country: string | null
  marketplaces: string | null

  setup_budget: number | null
  maintenance_budget: number | null

  next_action: string | null
  next_action_date: string | null
  notes: string | null

  /** Se sella solo al pasar a "Cliente cerrado"; null en cualquier otro estado */
  closed_at: string | null

  /** Respuestas del guion de la reunión, por clave de pregunta. Ver PREGUNTAS_REUNION */
  preguntas: Record<string, string>

  created_at: string
  updated_at: string
}

/** Ficha del CRM con la cita de origen y el responsable ya resueltos */
export interface CrmClientWithDetails extends CrmClient {
  appointment?: AppointmentWithPeople | null
  owner?: CalendarPerson | null
}

export interface CrmInteraction {
  id: string
  client_id: string
  author_id: string | null
  kind: CrmInteractionKind
  body: string
  occurred_at: string
  created_at: string
  author?: CalendarPerson | null
}

export interface CrmDocument {
  id: string
  client_id: string
  uploaded_by: string | null
  kind: CrmDocumentKind
  file_url: string
  file_path: string | null
  filename: string
  file_size: number | null
  created_at: string
}

/** Orden del pipeline, de arriba abajo en el embudo */
export const CRM_STAGES: CrmStage[] = [
  'nuevo',
  'seguimiento',
  'propuesta_enviada',
  'revision_propuesta',
  'negociacion',
  'ganado',
  'perdido',
]

export const CRM_STAGE_LABELS: Record<CrmStage, string> = {
  nuevo: 'Nuevo',
  seguimiento: 'En seguimiento',
  propuesta_enviada: 'Propuesta enviada',
  revision_propuesta: 'Revisión de propuesta',
  negociacion: 'Negociación',
  ganado: 'Cliente cerrado',
  perdido: 'Perdido',
}

export const CRM_STAGE_COLORS: Record<CrmStage, string> = {
  nuevo: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  seguimiento: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  propuesta_enviada: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  revision_propuesta: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  negociacion: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  ganado: 'bg-green-500/20 text-green-300 border-green-500/30',
  perdido: 'bg-red-500/20 text-red-300 border-red-500/30',
}

/** Punto de color sólido para la lista de la izquierda */
export const CRM_STAGE_DOTS: Record<CrmStage, string> = {
  nuevo: '#3B82F6',
  seguimiento: '#EAB308',
  propuesta_enviada: '#A855F7',
  revision_propuesta: '#F97316',
  negociacion: '#06B6D4',
  ganado: '#22C55E',
  perdido: '#EF4444',
}

/**
 * Datos de contacto de una ficha, vengan de la cita o del alta manual.
 * La cita manda cuando existe: es la fuente de verdad de la agenda.
 */
export function crmContact(client: CrmClientWithDetails) {
  const a = client.appointment
  return {
    name: a?.lead_name ?? client.lead_name ?? null,
    email: a?.lead_email ?? client.lead_email ?? null,
    phone: a?.lead_phone ?? client.lead_phone ?? null,
    company: a?.lead_company ?? client.lead_company ?? null,
    revenue: a?.revenue_amount ?? client.revenue_amount ?? null,
    amazonLink: a?.amazon_link ?? client.amazon_link ?? null,
    /** Fecha de la reunión de cualificación, o null si es alta manual */
    meetingAt: a?.start_time ?? null,
  }
}

export const CRM_INTERACTION_LABELS: Record<CrmInteractionKind, string> = {
  llamada: 'Llamada',
  email: 'Email',
  whatsapp: 'WhatsApp',
  reunion: 'Reunión',
  propuesta: 'Propuesta',
  nota: 'Nota',
}


/* ------------------------------------------------------------------ */
/* El guion de la reunión                                              */
/* ------------------------------------------------------------------ */

/**
 * LAS PREGUNTAS DE LA REUNIÓN, QUE VIVEN AQUÍ Y NO EN LA BASE.
 *
 * Son dos guiones distintos porque son dos conversaciones distintas: a quien ya
 * vende en Amazon se le pregunta por lo que tiene, y a quien no, por lo que
 * quiere. Mezclarlas en una sola lista obliga a quien está en la reunión a ir
 * saltándose la mitad de las filas, que es como se acaba sin rellenar ninguna.
 *
 * Las respuestas se guardan en `crm_clients.preguntas` por CLAVE, no por
 * posición. Es lo que permite reordenar el guion, reescribir una pregunta o
 * jubilarla sin que lo ya contestado se descoloque ni se pierda: una respuesta
 * cuya pregunta ya no está sigue en la base, simplemente deja de pintarse.
 *
 * Y las claves llevan prefijo del bloque (`si_`/`no_`) porque hay preguntas casi
 * iguales en los dos —categorías, propuesta de valor, marca de referencia— y sin
 * prefijo la respuesta de un guion aparecería en el otro.
 *
 * Las dos últimas de cada bloque son las de cierre, y por eso van marcadas: no
 * son para documentar al cliente, son para saber si hay trato. En el documento
 * original están en verde.
 */
export interface PreguntaReunion {
  clave: string
  texto: string
  /** true en las preguntas de cierre: las que dicen si esto va a alguna parte */
  cierre?: boolean
}

export interface BloquePreguntas {
  id: 'vende' | 'no_vende'
  titulo: string
  pista: string
  preguntas: PreguntaReunion[]
}

export const PREGUNTAS_REUNION: BloquePreguntas[] = [
  {
    id: 'vende',
    titulo: 'Si venden en Amazon',
    pista: 'Se pregunta por lo que ya tienen',
    preguntas: [
      { clave: 'si_tiempo', texto: '¿Cuánto tiempo llevan vendiendo en Amazon?' },
      { clave: 'si_referencias', texto: '¿Cuántas referencias gestionan actualmente?' },
      {
        clave: 'si_mas_referencias',
        texto: '¿Tienen pensado añadir más referencias? ¿Cuántas en los próximos 3 meses?',
      },
      { clave: 'si_categorias', texto: '¿Qué categorías de productos venden actualmente?' },
      { clave: 'si_paises', texto: '¿En qué países venden y cuáles les gustaría potenciar?' },
      {
        clave: 'si_presupuesto_ads',
        texto: '¿Cuánto presupuesto están invirtiendo en Amazon Ads mensualmente? ¿Por país?',
      },
      {
        clave: 'si_herramientas',
        texto: '¿Qué herramientas usan para controlar su inventario, márgenes y ventas?',
      },
      { clave: 'si_objetivo', texto: '¿Cuál es el objetivo en 6 meses dentro de Amazon? ¿Y en 12 meses?' },
      {
        clave: 'si_parametros',
        texto: '¿Qué parámetros clave son importantes para ellos? ¿ROAS, ROI, margen, facturación, reseñas?',
      },
      {
        clave: 'si_diferenciacion',
        texto: '¿Cómo se diferencian sus productos de los de la competencia? Su propuesta de valor',
      },
      { clave: 'si_competencia', texto: '¿Cuál es la marca que tienen como referencia o competencia?' },
      {
        clave: 'si_como_sentiria',
        texto:
          '¿Si tuvieran un equipo o gestor del canal de Amazon que les ayudara a lograr los objetivos en el próximo año, cómo les haría sentir?',
        cierre: true,
      },
      {
        clave: 'si_compromiso',
        texto:
          '¿Estaríais dispuestos a comprometeros a mínimo 6 meses vista para lograr estos resultados si la agencia lo hiciera con vuestros resultados y satisfacción?',
        cierre: true,
      },
    ],
  },
  {
    id: 'no_vende',
    titulo: 'Si NO venden en Amazon',
    pista: 'Se pregunta por lo que quieren montar',
    preguntas: [
      { clave: 'no_fecha', texto: '¿Cuándo es la fecha aproximada para la que les gustaría estar en Amazon?' },
      {
        clave: 'no_referencias',
        texto:
          '¿Cuántas referencias quieren empezar trabajando en la plataforma? ¿Y el total que quieren tener subidas en 6 meses?',
      },
      { clave: 'no_categorias', texto: '¿Qué categorías de productos venden actualmente?' },
      {
        clave: 'no_presupuesto_ads',
        texto: '¿Cuánto presupuesto pueden orientar solo para la promoción de Amazon Ads?',
      },
      {
        clave: 'no_mercados',
        texto: '¿En qué mercados quieren empezar a vender? ¿Solo local, Europa, EEUU, otro marketplace?',
      },
      { clave: 'no_objetivo', texto: '¿Cuál es el objetivo en los primeros 6 meses vendiendo en Amazon?' },
      {
        clave: 'no_parametros',
        texto: '¿Qué parámetros clave son importantes para vosotros? ¿ROAS, ROI, margen, facturación, reseñas?',
      },
      {
        clave: 'no_diferenciacion',
        texto: '¿Cómo se diferencian sus productos de los de la competencia? Su propuesta de valor',
      },
      {
        clave: 'no_logistica',
        texto: '¿Qué tipo de logística van a usar? ¿FBA, FBM? ¿Cuál es la visión estratégica de su elección?',
      },
      { clave: 'no_competencia', texto: '¿Cuál es la marca que tienen como referencia o competencia?' },
      {
        clave: 'no_como_sentiria',
        texto:
          '¿Si tuvieran un equipo o gestor del canal de Amazon que les ayudara a lograr los objetivos en el próximo año, cómo les haría sentir?',
        cierre: true,
      },
      {
        clave: 'no_compromiso',
        texto:
          '¿Estaríais dispuestos a comprometeros a mínimo 6 meses vista para lograr estos resultados si la agencia lo hiciera con vuestros resultados y satisfacción?',
        cierre: true,
      },
    ],
  },
]

/** Cuántas preguntas de un bloque tienen algo escrito. Para el contador del título */
export function contestadas(
  bloque: BloquePreguntas,
  respuestas: Record<string, string> | null | undefined
): number {
  if (!respuestas) return 0
  return bloque.preguntas.filter((p) => (respuestas[p.clave] ?? '').trim() !== '').length
}
