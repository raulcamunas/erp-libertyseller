import type { RolUsuario } from '@/lib/types/users'

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'rescheduled'
  | 'no_show'
  | 'qualified'
  | 'not_qualified'
  /** La reunión no llegó a celebrarse: se anuló. Distinto de no cualificada. */
  | 'cancelled'

export type SyncStatus = 'pending' | 'synced' | 'error' | 'local'
export type TranscriptionStatus = 'none' | 'processing' | 'done' | 'error'

/**
 * ¿VENDE YA EN AMAZON?
 *
 * Las mismas tres palabras que cold_leads.vende_en_amazon (migración 204), y el
 * CHECK de la 214 las impone en la base. Si aquí se añadiera una cuarta sin
 * tocar la migración, la pantalla la ofrecería y el guardado fallaría con un
 * 23514 que no dice nada.
 */
export type VendeEnAmazon = 'sin_comprobar' | 'no_vende' | 'vende'

export const VENDE_EN_AMAZON_OPCIONES: VendeEnAmazon[] = ['vende', 'no_vende', 'sin_comprobar']

export const VENDE_EN_AMAZON_LABELS: Record<VendeEnAmazon, string> = {
  vende: 'Vende en Amazon',
  no_vende: 'No vende en Amazon',
  sin_comprobar: 'Sin comprobar',
}

export interface Appointment {
  id: string
  /** null en eventos externos importados de Google (no gestionados por el ERP) */
  comercial_id: string | null
  assigned_closer_id: string | null
  /** true = evento que ya existía en Google Calendar, solo lectura en el ERP */
  is_external: boolean

  lead_name: string
  lead_email: string | null
  lead_phone: string | null
  lead_company: string | null
  lead_source: string | null
  lead_ref_id: string | null

  start_time: string
  end_time: string

  status: AppointmentStatus

  title: string | null
  notes: string | null
  details: Record<string, unknown>

  /**
   * ¿VENDE YA EN AMAZON? Es la primera pregunta de la llamada.
   *
   * Mismo vocabulario que cold_leads.vende_en_amazon, letra por letra, para que
   * las dos tablas se crucen sin traducir: un lead de Cold Calling acaba siendo
   * una cita. 'sin_comprobar' no es lo mismo que 'no_vende' — es que nadie lo ha
   * preguntado, y es lo que hace que la ficha pueda pedir que se pregunte.
   */
  vende_en_amazon: VendeEnAmazon

  /** Datos comerciales del lead (rellenados tras la llamada) */
  revenue_amount: number | null
  call_date: string | null
  amazon_link: string | null

  /**
   * LOS DATOS DE SU TIENDA, que solo tienen sentido si NO vende en Amazon.
   *
   * Si ya vende, lo que se mira es su escaparate de Amazon y para eso está
   * `amazon_link`. Si no vende, no hay escaparate: la propuesta se prepara con lo
   * que tenga montado por su cuenta, y antes eso acababa escrito a mano en las
   * notas, donde no se puede ni filtrar ni contar.
   */
  razon_social: string | null
  cif: string | null
  sector: string | null
  ciudad: string | null
  plataforma: string | null
  n_productos: number | null
  anos_tienda: number | null
  web: string | null
  recording_url: string | null
  recording_filename: string | null
  transcription: string | null
  transcription_summary: string | null
  transcription_status: TranscriptionStatus
  transcription_error: string | null

  google_event_id: string | null
  google_meet_link: string | null
  sync_status: SyncStatus

  /**
   * FONTANERÍA DE LA SINCRONIZACIÓN CON GOOGLE, OPCIONALES A PROPÓSITO.
   *
   * Las escribe lib/appointments-sync.ts y no las lee NINGUNA pantalla
   * (comprobado por búsqueda en components/ y app/dashboard/: cero usos de
   * las cuatro). Por eso app/dashboard/agenda/page.tsx dejó de pedirlas: eran
   * 1719 kB de los 6566 kB que se mandaban al navegador en cada carga de la
   * agenda, solo en columnas que no mira nadie.
   *
   * Van con `?` para que el tipo no MIENTA: quien lee una cita traída por esa
   * página no las tiene. Las rutas que hacen `select('*')` sí las reciben, y
   * un opcional también describe bien ese caso. Si algún día hay que pintar
   * alguna, se vuelve a añadir al select de la agenda y ya está.
   *
   * OJO: `google_meet_link` NO está aquí y no debe moverse. Sí se pinta, en
   * AgendaCalendar.tsx:1005, AppointmentSheet.tsx:379 y
   * AppointmentConfirmation.tsx:183.
   */
  google_calendar_id?: string | null
  google_html_link?: string | null
  sync_error?: string | null
  last_synced_at?: string | null
  updated_source?: 'erp' | 'google'

  created_at: string
  updated_at: string
}

/** Perfil mínimo de un comercial/closer para pintar en el calendario */
export interface CalendarPerson {
  id: string
  full_name: string | null
  email: string | null
  role: RolUsuario
  calendar_color: string | null
}

/** Cita enriquecida con los datos de la persona que la agendó */
export interface AppointmentWithPeople extends Appointment {
  comercial?: CalendarPerson | null
  assigned_closer?: CalendarPerson | null
}

/**
 * LAS COLUMNAS QUE PIDE LA AGENDA, EN UN SOLO SITIO.
 *
 * Existe porque ya se habían separado: app/dashboard/agenda/page.tsx dejó de
 * pedir `*` a propósito —medido, 6566 kB -> 4847 kB al quitar cinco columnas de
 * fontanería de la sincronización con Google y el texto largo de las
 * transcripciones— y el botón «Resincronizar» de AgendaCalendar seguía
 * recargando con `select('*')`, o sea que en cuanto alguien lo pulsaba el
 * navegador se volvía a tragar los 6,5 MB y el estado quedaba además con
 * objetos de otra forma que los que había puesto el servidor.
 *
 * QUÉ NO SE PUEDE QUITAR DE AQUÍ: `google_meet_link`, que se pinta en
 * AgendaCalendar, AppointmentSheet y AppointmentConfirmation. Las cinco que no
 * están —google_html_link, google_calendar_id, last_synced_at, sync_error,
 * updated_source— las escribe lib/appointments-sync.ts y no las lee ninguna
 * pantalla (cero usos en components/ y app/dashboard/).
 *
 * El texto largo de la transcripción tampoco está: se pide aparte al
 * desplegarlo. El resumen sí, que es corto y se enseña en la ficha.
 */
export const COLUMNAS_AGENDA = `
  id, comercial_id, assigned_closer_id, is_external,
  lead_name, lead_email, lead_phone, lead_company, lead_source, lead_ref_id,
  start_time, end_time, status, title, notes, details,
  revenue_amount, call_date, amazon_link,
  recording_url, recording_filename,
  transcription_summary, transcription_status, transcription_error,
  google_event_id, google_meet_link, sync_status,
  created_at, updated_at,
  comercial:profiles!appointments_comercial_id_fkey(id, full_name, email, role, calendar_color),
  assigned_closer:profiles!appointments_assigned_closer_id_fkey(id, full_name, email, role, calendar_color)
`

/**
 * LAS COLUMNAS DE LA 214, APARTE, Y NO ES MANÍA.
 *
 * El código se despliega ANTES de que nadie lance la migración a mano en el
 * editor SQL de Supabase. Entre una cosa y otra, estas columnas no existen — y
 * un `select` que nombra una columna inexistente no degrada: PostgREST contesta
 * 400 y la agenda entera se queda en blanco para los seis comerciales que la
 * usan todos los días, por un campo que todavía no tiene ni un dato.
 *
 * Por eso van en su propia lista y se piden con `columnasAgenda()`, que prueba
 * con ellas y, si la base todavía no las tiene, repite sin ellas. En cuanto se
 * lance la 214 deja de reintentar sola. El día que las columnas sean viejas,
 * esto se junta en una lista y se borra la función; mientras tanto es lo que
 * permite desplegar y migrar en el orden que salga.
 */
const COLUMNAS_214 = `
  vende_en_amazon,
  razon_social, cif, sector, ciudad, plataforma, n_productos, anos_tienda, web
`

/** Con las columnas de la 214. Es lo que se pide primero. */
export const COLUMNAS_AGENDA_CON_TIENDA = `${COLUMNAS_AGENDA.trimEnd()},${COLUMNAS_214}`

/** ¿Es «esa columna no existe» y no otra cosa? */
export function faltaLa214(error: { code?: string } | null): boolean {
  // PGRST204: PostgREST no la tiene en su caché de esquema. 42703: Postgres dice
  // que la columna no existe. Cualquier otro código —un permiso, un timeout—
  // NO entra aquí: taparlo devolvería media agenda sin decir por qué.
  return error?.code === 'PGRST204' || error?.code === '42703'
}

export interface CreateAppointmentPayload {
  comercial_id?: string
  assigned_closer_id?: string | null
  lead_name: string
  lead_email?: string | null
  lead_phone?: string | null
  lead_company?: string | null
  lead_source?: string | null
  lead_ref_id?: string | null
  start_time: string
  end_time: string
  status?: AppointmentStatus
  title?: string | null
  notes?: string | null
  details?: Record<string, unknown>
  vende_en_amazon?: VendeEnAmazon
  revenue_amount?: number | null
  call_date?: string | null
  amazon_link?: string | null
  razon_social?: string | null
  cif?: string | null
  sector?: string | null
  ciudad?: string | null
  plataforma?: string | null
  n_productos?: number | null
  anos_tienda?: number | null
  web?: string | null
  recording_url?: string | null
  recording_filename?: string | null
}

/** Perfil mínimo del autor de un comentario */
export interface CommentAuthor {
  id: string
  full_name: string | null
  email: string | null
  calendar_color: string | null
}

export interface AppointmentComment {
  id: string
  appointment_id: string
  author_id: string
  body: string
  created_at: string
  author?: CommentAuthor | null
}

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  rescheduled: 'Re-agendada',
  no_show: 'No asistió',
  qualified: 'Cita Cualificada',
  not_qualified: 'Cita No Cualificada',
  cancelled: 'Cancelada',
}

export const APPOINTMENT_STATUS_COLORS: Record<AppointmentStatus, string> = {
  scheduled: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  confirmed: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  rescheduled: 'bg-sky-400/20 text-sky-300 border-sky-400/30',
  no_show: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  qualified: 'bg-green-500/20 text-green-300 border-green-500/30',
  not_qualified: 'bg-red-500/20 text-red-300 border-red-500/30',
  cancelled: 'bg-zinc-600/25 text-zinc-300 border-zinc-500/30',
}

/**
 * Paleta de colores por comercial (fallback si no tienen calendar_color).
 * Se asigna de forma estable a partir del id.
 */
export const AGENT_COLOR_PALETTE = [
  '#FF6600', // naranja Liberty
  '#3B82F6', // azul
  '#10B981', // verde
  '#A855F7', // morado
  '#EC4899', // rosa
  '#F59E0B', // ámbar
  '#06B6D4', // cian
  '#EF4444', // rojo
  '#8B5CF6', // violeta
  '#14B8A6', // teal
]

export function colorForAgent(id: string, explicit?: string | null): string {
  if (explicit) return explicit
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash)
  }
  const idx = Math.abs(hash) % AGENT_COLOR_PALETTE.length
  return AGENT_COLOR_PALETTE[idx]
}
