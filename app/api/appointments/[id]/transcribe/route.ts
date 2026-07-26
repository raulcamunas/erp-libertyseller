import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import OpenAI, { toFile } from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Límite de Whisper: 25MB por archivo
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

const SUMMARY_SYSTEM_PROMPT = `Eres un asistente que ayuda a un equipo comercial de Liberty Seller
(agencia de gestión de cuentas de Amazon) a repasar sus llamadas de venta.
Se te da la transcripción de una llamada de consultoría estratégica con un
lead. Devuelve un resumen breve y accionable en español, en este formato
exacto (usa estos títulos tal cual, en negrita markdown):

**Resumen:** 2-3 frases con lo esencial de la llamada.
**Puntos clave:** lista de 3-5 puntos (necesidades del lead, dolor, contexto de su negocio).
**Objeciones:** dudas o pegas que puso el lead (o "Ninguna detectada").
**Próximos pasos:** qué se acordó o qué habría que hacer a continuación.

Sé conciso, concreto y no inventes datos que no estén en la transcripción.`

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'Falta OPENAI_API_KEY en el servidor' },
      { status: 500 }
    )
  }

  const { data: appt, error: fetchError } = await supabase
    .from('appointments')
    .select('id, recording_url, recording_filename')
    .eq('id', params.id)
    .single()

  if (fetchError || !appt) {
    return NextResponse.json({ error: 'Cita no encontrada' }, { status: 404 })
  }
  if (!appt.recording_url) {
    return NextResponse.json({ error: 'Esta cita no tiene grabación' }, { status: 400 })
  }

  // Marcar como "procesando" para que la UI muestre el estado en vivo
  await supabase
    .from('appointments')
    .update({ transcription_status: 'processing', transcription_error: null })
    .eq('id', params.id)

  try {
    const audioRes = await fetch(appt.recording_url)
    if (!audioRes.ok) throw new Error('No se pudo descargar el audio')

    const contentLength = Number(audioRes.headers.get('content-length') || 0)
    if (contentLength && contentLength > MAX_AUDIO_BYTES) {
      throw new Error('El audio supera los 25MB, el límite de Whisper para transcribir')
    }

    const buffer = Buffer.from(await audioRes.arrayBuffer())
    if (buffer.byteLength > MAX_AUDIO_BYTES) {
      throw new Error('El audio supera los 25MB, el límite de Whisper para transcribir')
    }

    const file = await toFile(buffer, appt.recording_filename || 'grabacion.mp3')

    const transcriptionRes = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'es',
    })
    const transcription = transcriptionRes.text?.trim() || ''

    if (!transcription) throw new Error('La transcripción salió vacía')

    const summaryRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: transcription },
      ],
      temperature: 0.4,
    })
    const summary = summaryRes.choices[0]?.message?.content?.trim() || ''

    const { data: updated, error: saveError } = await supabase
      .from('appointments')
      .update({
        transcription,
        transcription_summary: summary,
        transcription_status: 'done',
        transcription_error: null,
      })
      .eq('id', params.id)
      .select('transcription, transcription_summary, transcription_status')
      .single()

    if (saveError) throw new Error(saveError.message)

    return NextResponse.json({ ok: true, ...updated })
  } catch (err) {
    console.error('Error transcribiendo llamada:', err)
    const message = (err as Error).message || 'Error desconocido transcribiendo la llamada'
    await supabase
      .from('appointments')
      .update({ transcription_status: 'error', transcription_error: message })
      .eq('id', params.id)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
