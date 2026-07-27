import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  isGoogleConfigured,
  createGoogleEvent,
  updateGoogleEvent,
  deleteGoogleEvent,
  getCalendarId,
} from '@/lib/google-calendar'
import { buildAppointmentSummary, buildAppointmentDescription } from '@/lib/appointments-sync'
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

  // Estado previo completo: hace falta para dos cosas.
  // 1) Saber si esto es un reagendado real (cambia start/end) o solo un
  //    cambio interno, para decidir si avisar al lead por email.
  // 2) MUY IMPORTANTE: un caller (p.ej. el drag-and-drop, que solo
  //    quiere mover la hora) puede mandar un payload parcial. Cualquier
  //    campo que NO venga en el body se conserva tal cual estaba —
  //    nunca se sobreescribe con null solo porque no llegó. Antes esto
  //    borraba facturación/fecha de llamada/link Amazon al arrastrar
  //    una cita para reagendarla.
  const { data: before, error: beforeError } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', params.id)
    .single()

  if (beforeError || !before) {
    return NextResponse.json({ error: 'Cita no encontrada' }, { status: 404 })
  }

  // 1) Actualizar en Supabase (RLS: solo propias o admin)
  const { data: updated, error } = await supabase
    .from('appointments')
    .update({
      assigned_closer_id:
        body.assigned_closer_id !== undefined
          ? body.assigned_closer_id
          : before.assigned_closer_id,
      lead_name: body.lead_name !== undefined ? body.lead_name?.trim() : before.lead_name,
      lead_email: body.lead_email !== undefined ? body.lead_email : before.lead_email,
      lead_phone: body.lead_phone !== undefined ? body.lead_phone : before.lead_phone,
      lead_company: body.lead_company !== undefined ? body.lead_company : before.lead_company,
      start_time: body.start_time ?? before.start_time,
      end_time: body.end_time ?? before.end_time,
      status: body.status ?? before.status,
      title: body.title !== undefined ? body.title : before.title,
      notes: body.notes !== undefined ? body.notes : before.notes,
      revenue_amount:
        body.revenue_amount !== undefined ? body.revenue_amount : before.revenue_amount,
      call_date: body.call_date !== undefined ? body.call_date : before.call_date,
      amazon_link: body.amazon_link !== undefined ? body.amazon_link : before.amazon_link,
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
      // Solo se invita al lead real; los emails internos de los
      // comerciales no son buzones reales de Workspace (ver route.ts).
      let gEventId = updated.google_event_id as string | null
      let htmlLink = updated.google_html_link as string | null
      let meetLink = updated.google_meet_link as string | null

      // Solo se avisa al lead si de verdad cambió la fecha/hora (un
      // reagendado real). Cambios internos (notas, estado, facturación,
      // closer asignado...) no le incumben y no deben notificarle.
      const timeChanged =
        !before ||
        new Date(before.start_time).getTime() !== new Date(updated.start_time).getTime() ||
        new Date(before.end_time).getTime() !== new Date(updated.end_time).getTime()

      const eventInput = {
        summary: buildAppointmentSummary(updated.lead_name),
        description: buildAppointmentDescription(),
        start: updated.start_time,
        end: updated.end_time,
        attendeeEmails: [updated.lead_email].filter(Boolean) as string[],
        erpAppointmentId: updated.id,
        colorId: googleColorId(updated.comercial_id!),
        // El Meet solo se pide si todavía no existe uno: volver a
        // pedirlo en cada edición hace que Google lo regenere.
        addMeet: !gEventId,
        sendUpdates: (timeChanged ? 'all' : 'none') as 'all' | 'none',
      }

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
      // Cancelar sí debe avisar al lead: a diferencia de un cambio
      // interno, aquí la reunión deja de existir.
      await deleteGoogleEvent(appt.google_event_id, 'all')
    } catch (err) {
      console.error('Error eliminando evento en Google:', err)
    }
  }

  return NextResponse.json({ ok: true })
}
