import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  isGoogleConfigured,
  createGoogleEvent,
  updateGoogleEvent,
  deleteGoogleEvent,
  getCalendarId,
} from '@/lib/google-calendar'
import { CreateAppointmentPayload } from '@/lib/types/appointments'

const SELECT_WITH_PEOPLE = `
  *,
  comercial:profiles!appointments_comercial_id_fkey(id, full_name, email, role, calendar_color),
  assigned_closer:profiles!appointments_assigned_closer_id_fkey(id, full_name, email, role, calendar_color)
`

function googleColorId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  return String((Math.abs(hash) % 11) + 1)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as Partial<CreateAppointmentPayload>

  // 1) Actualizar en Supabase (RLS: solo propias o admin)
  const { data: updated, error } = await supabase
    .from('appointments')
    .update({
      assigned_closer_id: body.assigned_closer_id ?? null,
      lead_name: body.lead_name?.trim(),
      lead_email: body.lead_email ?? null,
      lead_phone: body.lead_phone ?? null,
      lead_company: body.lead_company ?? null,
      start_time: body.start_time,
      end_time: body.end_time,
      status: body.status,
      title: body.title ?? null,
      notes: body.notes ?? null,
      updated_source: 'erp',
      sync_status: isGoogleConfigured() ? 'pending' : 'local',
    })
    .eq('id', params.id)
    .select(SELECT_WITH_PEOPLE)
    .single()

  if (error) {
    console.error('Error actualizando cita:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 2) Sincronizar con Google
  if (isGoogleConfigured()) {
    try {
      const closerEmail = updated.assigned_closer?.email as string | undefined
      const eventInput = {
        summary: updated.lead_company
          ? `${updated.lead_name} · ${updated.lead_company}`
          : updated.lead_name,
        description:
          `Agendada por: ${updated.comercial?.full_name || updated.comercial?.email || ''}\n` +
          (updated.lead_phone ? `Tel: ${updated.lead_phone}\n` : '') +
          (updated.notes ? `\n${updated.notes}` : ''),
        start: updated.start_time,
        end: updated.end_time,
        attendeeEmails: [updated.lead_email, closerEmail].filter(Boolean) as string[],
        erpAppointmentId: updated.id,
        colorId: googleColorId(updated.comercial_id!),
        addMeet: true,
      }

      let gEventId = updated.google_event_id as string | null
      let htmlLink = updated.google_html_link as string | null
      let meetLink = updated.google_meet_link as string | null

      if (gEventId) {
        const gEvent = await updateGoogleEvent(gEventId, eventInput)
        htmlLink = gEvent.htmlLink ?? htmlLink
        meetLink = gEvent.hangoutLink ?? meetLink
      } else {
        const gEvent = await createGoogleEvent(eventInput)
        gEventId = gEvent.id ?? null
        htmlLink = gEvent.htmlLink ?? null
        meetLink = gEvent.hangoutLink ?? null
      }

      const { data: synced } = await supabase
        .from('appointments')
        .update({
          google_event_id: gEventId,
          google_calendar_id: getCalendarId(),
          google_html_link: htmlLink,
          google_meet_link: meetLink,
          sync_status: 'synced',
          sync_error: null,
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', updated.id)
        .select(SELECT_WITH_PEOPLE)
        .single()

      return NextResponse.json(synced ?? updated)
    } catch (err) {
      console.error('Error sincronizando con Google:', err)
      await supabase
        .from('appointments')
        .update({ sync_status: 'error', sync_error: (err as Error).message })
        .eq('id', updated.id)
      return NextResponse.json(updated)
    }
  }

  return NextResponse.json(updated)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Leemos primero para saber el google_event_id (y que RLS valide acceso)
  const { data: appt } = await supabase
    .from('appointments')
    .select('id, google_event_id')
    .eq('id', params.id)
    .single()

  const { error } = await supabase
    .from('appointments')
    .delete()
    .eq('id', params.id)

  if (error) {
    console.error('Error eliminando cita:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (isGoogleConfigured() && appt?.google_event_id) {
    try {
      await deleteGoogleEvent(appt.google_event_id)
    } catch (err) {
      console.error('Error eliminando evento en Google:', err)
    }
  }

  return NextResponse.json({ ok: true })
}
