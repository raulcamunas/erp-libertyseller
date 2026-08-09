import { SupabaseClient } from '@supabase/supabase-js'
import { calendar_v3 } from '@googleapis/calendar'
import { incrementalSync, getCalendarId } from '@/lib/google-calendar'
import { fetchAll, trocear } from '@/lib/supabase/paginacion'

/**
 * Título de la cita en Google Calendar. El nombre del lead es la parte
 * dinámica: "Consultoría Estratégica Amazon · Liberty Seller · {lead}".
 */
export function buildAppointmentSummary(leadName: string): string {
  return `Consultoría Estratégica Amazon · Liberty Seller · ${leadName}`
}

/**
 * Descripción del evento en Google Calendar. El lead ve este texto en
 * la invitación, así que es contenido de cara al cliente, sin datos
 * internos (quién agendó, teléfono, notas del equipo).
 */
export function buildAppointmentDescription(): string {
  return (
    'Durante la sesión analizaremos el rendimiento general, identificaremos ' +
    'oportunidades de mejora y definiremos acciones estratégicas con el ' +
    'objetivo de presentarte una propuesta de colaboración alineada con tus ' +
    'necesidades comerciales.'
  )
}

/**
 * Aplica una lista de eventos de Google Calendar sobre la tabla
 * `appointments`. Usado tanto por el import inicial (full sync) como
 * por el webhook incremental, para no duplicar la lógica.
 *
 * - Evento con erpAppointmentId o google_event_id ya conocido → se
 *   actualiza la cita gestionada por el ERP (reagendado/cancelado desde
 *   Google se refleja aquí).
 * - Evento sin vínculo al ERP → se importa como "externo" (solo lectura,
 *   sirve para no agendar encima de un hueco ya ocupado).
 */
export async function applyGoogleEventsToErp(
  svc: SupabaseClient,
  events: calendar_v3.Schema$Event[]
): Promise<{ updated: number; imported: number; cancelled: number }> {
  let updated = 0
  let imported = 0
  let cancelled = 0

  // UNA CONSULTA EN VEZ DE UNA POR EVENTO.
  //
  // Antes, cada vuelta del bucle preguntaba «¿existe ya esta cita?» con su
  // propio SELECT (un `.eq('google_event_id', ...).maybeSingle()`). Medido
  // contra la base real: 40 eventos = 2582 ms, o sea 64,5 ms por evento, y la
  // ventana de la carga completa tiene hoy 98 citas con google_event_id.
  // Los mismos 98 en una sola consulta con `.in()` tardan 69 ms.
  //
  // Se trocea de 100 en 100 porque el `.in()` viaja en la URL: con listas
  // largas revienta por tamaño de cabecera (UND_ERR_HEADERS_OVERFLOW) antes de
  // llegar a la base. Con ids de Google (~42 caracteres) 100 caben de sobra.
  //
  // El resultado es EXACTAMENTE el mismo que el de los 98 SELECT sueltos:
  // mismo filtro, misma tabla, y el Map se consulta con la misma clave.
  const idsEventos = events.map((e) => e.id).filter((id): id is string => !!id)
  const existentes = new Map<string, string>()
  for (const trozo of trocear(idsEventos)) {
    const { data, error } = await svc
      .from('appointments')
      .select('id, google_event_id')
      .in('google_event_id', trozo)
    if (error) throw new Error(`Supabase (lookup): ${error.message}`)
    for (const fila of data ?? []) {
      if (!fila.google_event_id) continue
      const clave = fila.google_event_id as string
      // EL AVISO DE DUPLICADO QUE EL `.in()` SE HABÍA LLEVADO POR DELANTE.
      //
      // La consulta de antes era `.eq('google_event_id', ev.id).maybeSingle()`,
      // y maybeSingle() DA ERROR si vuelve más de una fila: dos citas con el
      // mismo id de Google reventaban la sincronización de forma ruidosa. Un
      // Map no: el segundo `set` pisa al primero y no se entera nadie, así que
      // se actualizaría una de las dos y la otra se quedaría huérfana para
      // siempre.
      //
      // Hoy no puede pasar —5853 filas y 5853 google_event_id distintos— y este
      // `console.error` no cambia el flujo: se sigue quedando con el último,
      // igual que sin él. Está para que el día que aparezca un duplicado quede
      // rastro, porque `appointments.google_event_id` NO tiene índice UNIQUE
      // todavía (crearlo es cambio de esquema y está en la lista de decisiones).
      if (existentes.has(clave)) {
        console.error(
          '[agenda] google_event_id duplicado en appointments:',
          clave,
          '->',
          existentes.get(clave),
          'y',
          fila.id
        )
      }
      existentes.set(clave, fila.id as string)
    }
  }

  for (const ev of events) {
    if (!ev.id) continue

    if (ev.status === 'cancelled') {
      // Un hueco importado que desaparece de Google deja de existir: se
      // borra, no se marca. Si se quedara marcado seguiría ocupando sitio
      // en el calendario sin motivo.
      const { data: removed, error: deleteError } = await svc
        .from('appointments')
        .delete()
        .eq('google_event_id', ev.id)
        .eq('is_external', true)
        .select('id')
      if (deleteError) throw new Error(`Supabase (cancel externo): ${deleteError.message}`)
      if (removed) cancelled += removed.length

      // Una cita del ERP anulada desde Google sí se conserva, marcada como
      // cancelada: detrás hay notas, grabación y comentarios del equipo.
      const { data: marked, error } = await svc
        .from('appointments')
        .update({
          status: 'cancelled',
          updated_source: 'google',
          last_synced_at: new Date().toISOString(),
        })
        .eq('google_event_id', ev.id)
        .eq('is_external', false)
        .select('id')
      if (error) throw new Error(`Supabase (cancel): ${error.message}`)
      if (marked) cancelled += marked.length
      continue
    }

    const start = ev.start?.dateTime
    const end = ev.end?.dateTime
    // Eventos de todo el día (sin dateTime) no se representan en el calendario semanal
    if (!start || !end) continue

    const erpId = ev.extendedProperties?.private?.erpAppointmentId

    const targetId = existentes.get(ev.id) ?? erpId ?? null

    if (targetId) {
      const { error: updateError } = await svc
        .from('appointments')
        .update({
          start_time: start,
          end_time: end,
          google_event_id: ev.id,
          google_html_link: ev.htmlLink ?? null,
          google_meet_link: ev.hangoutLink ?? null,
          updated_source: 'google',
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', targetId)
      if (updateError) throw new Error(`Supabase (update): ${updateError.message}`)
      // El evento queda vinculado a esta cita: se anota para que, si el mismo
      // google_event_id volviera a aparecer en la misma tanda, se trate como
      // existente igual que hacía el SELECT por evento que había antes.
      existentes.set(ev.id, targetId)
      updated++
      continue
    }

    // Evento creado directamente en Google, sin vínculo al ERP:
    // se importa como externo (solo lectura). Por privacidad no se
    // guarda el título ni la descripción reales del evento — solo se
    // marca el hueco como ocupado. El Map de arriba ya confirmó que no
    // existía ninguna cita con este google_event_id.
    const { data: insertada, error: insertError } = await svc
      .from('appointments')
      .insert({
        comercial_id: null,
        lead_name: 'Hueco no disponible',
        notes: null,
        start_time: start,
        end_time: end,
        status: 'scheduled',
        is_external: true,
        google_event_id: ev.id,
        google_calendar_id: ev.organizer?.email ?? null,
        google_html_link: ev.htmlLink ?? null,
        google_meet_link: ev.hangoutLink ?? null,
        updated_source: 'google',
        sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
      })
      // Se pide el id de vuelta solo para poder anotarlo en el Map. Sin esto,
      // un mismo google_event_id repetido dentro de la misma tanda insertaría
      // dos huecos, cuando antes el SELECT por evento lo habría encontrado.
      .select('id')
      .single()
    if (insertError) throw new Error(`Supabase (insert): ${insertError.message}`)
    if (insertada?.id) existentes.set(ev.id, insertada.id as string)
    imported++
  }

  return { updated, imported, cancelled }
}

/**
 * Ciclo completo de sincronización: lee el syncToken guardado, pide a
 * Google los cambios desde entonces (o una carga inicial si no hay
 * token todavía), los aplica al ERP y guarda el nuevo token. Usado por
 * el webhook de Google y por el cron de sync periódico — así el
 * calendario del ERP nunca se queda desactualizado sin depender de que
 * nadie pulse un botón.
 */
/** Cada cuánto se rehace la carga completa, además del sync incremental */
const FULL_SYNC_EVERY_MS = 4 * 60 * 60 * 1000

/** Ventana de la carga completa: una semana atrás y cuatro meses vista */
const FULL_SYNC_PAST_DAYS = 7
const FULL_SYNC_FUTURE_DAYS = 120

export async function runSyncCycle(svc: SupabaseClient, options?: { force?: boolean }) {
  const calendarId = getCalendarId()

  const { data: syncRow } = await svc
    .from('google_calendar_sync')
    .select('sync_token, last_full_sync_at')
    .eq('calendar_id', calendarId)
    .maybeSingle()

  // El sync incremental solo trae CAMBIOS. Las series recurrentes van
  // generando instancias nuevas según pasa el tiempo, y eso para Google no
  // es un cambio: nunca llegarían. Por eso, cada pocas horas se tira el
  // token y se recarga la ventana entera, ya desplazada.
  const lastFull = syncRow?.last_full_sync_at
    ? new Date(syncRow.last_full_sync_at).getTime()
    : 0
  const fullSyncDue =
    options?.force || !syncRow?.sync_token || Date.now() - lastFull > FULL_SYNC_EVERY_MS

  const now = Date.now()
  const range = {
    timeMin: new Date(now - FULL_SYNC_PAST_DAYS * 86400000).toISOString(),
    timeMax: new Date(now + FULL_SYNC_FUTURE_DAYS * 86400000).toISOString(),
  }

  let didFullSync = fullSyncDue
  let result = fullSyncDue
    ? await incrementalSync(null, range)
    : await incrementalSync(syncRow!.sync_token)

  if (result.needsFullSync) {
    // El token había caducado (410): se recarga entera
    didFullSync = true
    result = await incrementalSync(null, range)
  }

  const stats = await applyGoogleEventsToErp(svc, result.events)

  let pruned = 0
  if (didFullSync) {
    pruned = await pruneMissingExternalEvents(svc, result.events, range)
  }

  // SE COMPRUEBA EL ERROR A PROPÓSITO. supabase-js no lanza cuando una
  // escritura falla, así que este upsert se podía perder entero sin dejar una
  // sola línea en el log. Y es el que guarda el syncToken: si se pierde, la
  // siguiente pasada no sabe por dónde iba y se rehace la carga completa —
  // cada 3 minutos, que es lo que marca el cron. Registrar no cambia lo que
  // devuelve la función ni lo que ve nadie en la agenda.
  const { error: errorToken } = await svc.from('google_calendar_sync').upsert({
    calendar_id: calendarId,
    ...(result.nextSyncToken ? { sync_token: result.nextSyncToken } : {}),
    ...(didFullSync ? { last_full_sync_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  })
  if (errorToken) {
    console.error(
      `[agenda] no se pudo guardar el syncToken de ${calendarId}; la próxima pasada repetirá la carga completa:`,
      errorToken
    )
  }

  return { ...stats, pruned, fullSync: didFullSync }
}

/**
 * Borra los huecos externos que ya no existen en Google. Sin esto, un
 * evento borrado en Google fuera de la ventana de cambios se queda
 * bloqueando la agenda para siempre.
 *
 * Solo toca eventos importados (`is_external`): las citas gestionadas por
 * el ERP no se borran nunca desde aquí.
 */
async function pruneMissingExternalEvents(
  svc: SupabaseClient,
  events: calendar_v3.Schema$Event[],
  range: { timeMin: string; timeMax: string }
): Promise<number> {
  const alive = new Set(
    events.filter((e) => e.status !== 'cancelled' && e.id).map((e) => e.id as string)
  )

  // PAGINADO. `appointments` tiene hoy 5853 filas y PostgREST corta a 1000 sin
  // dar error, así que un select suelto aquí devolvía como mucho 1000 huecos.
  // Los que caen fuera del corte NO se comparan contra Google, o sea que un
  // evento borrado en Google se queda bloqueando la agenda para siempre —
  // justo lo que esta función existe para evitar. Hoy la ventana -7/+120 días
  // tiene 96 huecos y devuelve los mismos 96.
  const externals = await fetchAll<{ id: string; google_event_id: string | null }>(
    (desde, hasta) =>
      svc
        .from('appointments')
        .select('id, google_event_id')
        .eq('is_external', true)
        .not('google_event_id', 'is', null)
        .gte('start_time', range.timeMin)
        .lt('start_time', range.timeMax)
        // Orden por columna única: sin él, qué filas trae cada tramo lo decide
        // el planificador y paginar repetiría unas y se saltaría otras.
        .order('id', { ascending: true })
        .range(desde, hasta)
  )

  if (externals.length === 0) return 0

  const stale = externals
    .filter((a) => !alive.has(a.google_event_id as string))
    .map((a) => a.id as string)

  if (stale.length === 0) return 0

  const { error: deleteError } = await svc.from('appointments').delete().in('id', stale)
  if (deleteError) throw new Error(`Supabase (prune delete): ${deleteError.message}`)

  return stale.length
}
