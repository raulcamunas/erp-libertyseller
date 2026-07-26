import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  isGoogleConfigured,
  createGoogleEvent,
  getCalendarId,
} from '@/lib/google-calendar'
import { buildAppointmentSummary } from '@/lib/appointments-sync'
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

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as CreateAppointmentPayload

  if (!body.lead_name?.trim() || !body.start_time || !body.end_time) {
    return NextResponse.json(
      { error: 'Faltan campos obligatorios (lead_name, start_time, end_time)' },
      { status: 400 }
    )
  }

  // 1) Insertar en Supabase (RLS: comercial_id = usuario actual)
  const { data: inserted, error } = await supabase
    .from('appointments')
    .insert({
      comercial_id: user.id,
      assigned_closer_id: body.assigned_closer_id ?? null,
      lead_name: body.lead_name.trim(),
      lead_email: body.lead_email ?? null,
      lead_phone: body.lead_phone ?? null,
      lead_company: body.lead_company ?? null,
      lead_source: body.lead_source ?? 'manual',
      lead_ref_id: body.lead_ref_id ?? null,
      start_time: body.start_time,
      end_time: body.end_time,
      status: body.status ?? 'scheduled',
      title: body.title ?? null,
      notes: body.notes ?? null,
      updated_source: 'erp',
      sync_status: isGoogleConfigured() ? 'pending' : 'local',
    })
    .select(SELECT_WITH_PEOPLE)
    .single()

  if (error) {
    console.error('Error insertando cita:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 2) Empujar a Google Calendar (si está configurado)
  if (isGoogleConfigured()) {
    try {
      // Solo se invita al lead real. Los emails de los comerciales
      // (jose@, yamila@...) son logins internos del ERP, no buzones
      // reales de Workspace: invitarlos hacía rebotar el correo a
      // business@. Los comerciales ya ven la cita en el calendario
      // compartido, no necesitan invitación.
      const gEvent = await createGoogleEvent({
        summary: buildAppointmentSummary(inserted.lead_name),
        description:
          `Agendada por: ${inserted.comercial?.full_name || inserted.comercial?.email || ''}\n` +
          (inserted.assigned_closer
            ? `Closer asignado: ${inserted.assigned_closer.full_name || inserted.assigned_closer.email}\n`
            : '') +
          (inserted.lead_phone ? `Tel: ${inserted.lead_phone}\n` : '') +
          (inserted.notes ? `\n${inserted.notes}` : ''),
        start: inserted.start_time,
        end: inserted.end_time,
        attendeeEmails: [inserted.lead_email].filter(Boolean) as string[],
        erpAppointmentId: inserted.id,
        colorId: googleColorId(inserted.comercial_id!),
        addMeet: true,
      })

      const { data: synced } = await supabase
        .from('appointments')
        .update({
          google_event_id: gEvent.id,
          google_calendar_id: getCalendarId(),
          google_html_link: gEvent.htmlLink,
          google_meet_link: gEvent.hangoutLink ?? null,
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', inserted.id)
        .select(SELECT_WITH_PEOPLE)
        .single()

      return NextResponse.json(synced ?? inserted)
    } catch (err) {
      console.error('Error creando evento en Google:', err)
      await supabase
        .from('appointments')
        .update({
          sync_status: 'error',
          sync_error: (err as Error).message,
        })
        .eq('id', inserted.id)
      // La cita existe en el ERP aunque falle Google; devolvemos igual
      return NextResponse.json(inserted)
    }
  }

  return NextResponse.json(inserted)
}
