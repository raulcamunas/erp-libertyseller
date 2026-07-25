import { calendar, calendar_v3, auth as googleAuth } from '@googleapis/calendar'

/**
 * Cliente de Google Calendar autenticado con la service account
 * (delegación de dominio sobre Google Workspace). Suplanta al usuario
 * GOOGLE_IMPERSONATE_SUBJECT para leer/escribir en su calendario.
 */
function getCalendarClient(): calendar_v3.Calendar {
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const subject = process.env.GOOGLE_IMPERSONATE_SUBJECT

  if (!clientEmail || !privateKey || !subject) {
    throw new Error(
      'Faltan variables de Google: GOOGLE_SA_CLIENT_EMAIL, GOOGLE_SA_PRIVATE_KEY o GOOGLE_IMPERSONATE_SUBJECT'
    )
  }

  const authClient = new googleAuth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar'],
    subject, // impersonación (domain-wide delegation)
  })

  return calendar({ version: 'v3', auth: authClient })
}

export function getCalendarId(): string {
  const id = process.env.GOOGLE_CALENDAR_ID
  if (!id) throw new Error('Falta GOOGLE_CALENDAR_ID')
  return id
}

export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SA_CLIENT_EMAIL &&
      process.env.GOOGLE_SA_PRIVATE_KEY &&
      process.env.GOOGLE_IMPERSONATE_SUBJECT &&
      process.env.GOOGLE_CALENDAR_ID
  )
}

export interface GoogleEventInput {
  summary: string
  description?: string
  start: string // ISO
  end: string // ISO
  attendeeEmails?: string[]
  /** id interno de la cita en el ERP, guardado en extendedProperties */
  erpAppointmentId?: string
  /** colorId de Google (1-11) para diferenciar por comercial */
  colorId?: string
  /** genera un enlace de Google Meet para la reunión */
  addMeet?: boolean
}

function toEventBody(input: GoogleEventInput): calendar_v3.Schema$Event {
  return {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.start },
    end: { dateTime: input.end },
    attendees: input.attendeeEmails
      ?.filter(Boolean)
      .map((email) => ({ email })),
    colorId: input.colorId,
    extendedProperties: input.erpAppointmentId
      ? { private: { erpAppointmentId: input.erpAppointmentId } }
      : undefined,
    conferenceData: input.addMeet
      ? {
          createRequest: {
            requestId: input.erpAppointmentId || `meet-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        }
      : undefined,
  }
}

export async function createGoogleEvent(
  input: GoogleEventInput
): Promise<calendar_v3.Schema$Event> {
  const cal = getCalendarClient()
  const res = await cal.events.insert({
    calendarId: getCalendarId(),
    requestBody: toEventBody(input),
    sendUpdates: 'all', // invita al lead/closer por email
    conferenceDataVersion: input.addMeet ? 1 : undefined,
  })
  return res.data
}

export async function updateGoogleEvent(
  eventId: string,
  input: GoogleEventInput
): Promise<calendar_v3.Schema$Event> {
  const cal = getCalendarClient()
  const res = await cal.events.patch({
    calendarId: getCalendarId(),
    eventId,
    requestBody: toEventBody(input),
    sendUpdates: 'all',
    conferenceDataVersion: input.addMeet ? 1 : undefined,
  })
  return res.data
}

export async function deleteGoogleEvent(eventId: string): Promise<void> {
  const cal = getCalendarClient()
  try {
    await cal.events.delete({
      calendarId: getCalendarId(),
      eventId,
      sendUpdates: 'all',
    })
  } catch (err: unknown) {
    // 404/410 => ya no existe en Google, lo tratamos como éxito
    const code = (err as { code?: number })?.code
    if (code !== 404 && code !== 410) throw err
  }
}

export interface IncrementalSyncResult {
  events: calendar_v3.Schema$Event[]
  nextSyncToken: string | null
  /** true si el syncToken caducó (410) y hay que hacer full sync */
  needsFullSync: boolean
}

/**
 * Lista cambios desde el último syncToken. Si no hay token, hace una
 * carga inicial acotada por `timeMin`/`timeMax` (por defecto: desde hoy
 * hasta dentro de 90 días) y devuelve el nextSyncToken.
 *
 * Sin un timeMax, calendarios con páginas de "Horario de reservas"
 * (que generan huecos disponibles muchos meses hacia el futuro) pueden
 * devolver miles de eventos y colgar la petición. Google además no
 * permite combinar syncToken con timeMin/timeMax, así que solo se
 * aplican en la carga inicial.
 */
export async function incrementalSync(
  syncToken: string | null,
  range?: { timeMin?: string; timeMax?: string }
): Promise<IncrementalSyncResult> {
  const cal = getCalendarClient()
  const events: calendar_v3.Schema$Event[] = []
  let pageToken: string | undefined
  let nextSyncToken: string | null = null

  const timeMin = range?.timeMin ?? new Date().toISOString()
  const timeMax =
    range?.timeMax ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()

  try {
    do {
      const res = await cal.events.list({
        calendarId: getCalendarId(),
        singleEvents: true,
        showDeleted: true,
        maxResults: 250,
        pageToken,
        ...(syncToken ? { syncToken } : { timeMin, timeMax }),
      })
      events.push(...(res.data.items || []))
      pageToken = res.data.nextPageToken || undefined
      if (res.data.nextSyncToken) nextSyncToken = res.data.nextSyncToken
    } while (pageToken)

    return { events, nextSyncToken, needsFullSync: false }
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code
    if (code === 410) {
      // syncToken caducado: hay que reiniciar
      return { events: [], nextSyncToken: null, needsFullSync: true }
    }
    throw err
  }
}

/**
 * Registra un canal de push para recibir notificaciones cuando el
 * calendario cambie. Google llamará a webhookUrl.
 */
export async function startWatch(webhookUrl: string, channelId: string) {
  const cal = getCalendarClient()
  const res = await cal.events.watch({
    calendarId: getCalendarId(),
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: webhookUrl,
    },
  })
  return res.data // { resourceId, expiration, ... }
}

export async function stopWatch(channelId: string, resourceId: string) {
  const cal = getCalendarClient()
  await cal.channels.stop({ requestBody: { id: channelId, resourceId } })
}
