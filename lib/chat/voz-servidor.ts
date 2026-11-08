import { createServiceClient } from '@/lib/supabase/service'
import { costeDeVoz } from '@/lib/transcripcion/precios'
import { ALMACEN_DE_ARCHIVOS, armarMensajes, miembrosDe, type FilaMensaje } from './servidor'
import { emitir } from './tiempo-real'
import type { AdjuntoChat } from './tipos'

/**
 * LAS NOTAS DE VOZ, ESCRITAS. Cuando se envía un mensaje con una nota de voz, el servidor la transcribe por detrás (la persona no espera) y, al terminar, el texto aparece debajo del audio
 * para todos. Usa el modelo de voz más barato (unos 0,003 $ por minuto) con la misma clave de OpenAI que el resto del ERP. Si falla o no hay clave, la nota se queda sin texto y se oye igual.
 */

const MODELO = 'gpt-4o-mini-transcribe'
const MAX_BYTES = 10 * 1024 * 1024
const MAX_SEGUNDOS = 600
const POR_HORA = 60

const usos = new Map<string, number[]>()

async function transcribir(bytes: Uint8Array, nombre: string, tipo: string, clave: string): Promise<string> {
  const formulario = new FormData()
  formulario.append('file', new File([bytes as BlobPart], nombre, { type: tipo || 'audio/webm' }))
  formulario.append('model', MODELO)
  formulario.append('response_format', 'json')
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), 90_000)
  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${clave}` }, body: formulario, signal: control.signal })
    if (!r.ok) throw new Error(`OpenAI contestó ${r.status}`)
    const j = (await r.json()) as { text?: unknown }
    return typeof j.text === 'string' ? j.text.trim() : ''
  } finally {
    clearTimeout(reloj)
  }
}

export async function transcribirNotasDeVoz(mensajeId: number): Promise<void> {
  const clave = process.env.OPENAI_API_KEY?.trim()
  if (!clave) return
  const service = createServiceClient()
  const { data } = await service.from('chat_mensajes').select('*').eq('id', mensajeId).maybeSingle()
  const fila = data as FilaMensaje | null
  if (!fila || fila.borrado_en) return
  const ahora = Date.now()
  const propias = (usos.get(fila.autor_id ?? '') ?? []).filter((t) => ahora - t < 3_600_000)
  let cambiado = false
  const adjuntos: AdjuntoChat[] = []
  for (const a of fila.adjuntos ?? []) {
    if (!a.voz || a.transcripcion !== undefined || !a.ruta || a.tamano > MAX_BYTES || (a.duracion ?? 0) > MAX_SEGUNDOS || propias.length >= POR_HORA) {
      adjuntos.push(a)
      continue
    }
    try {
      const { data: archivo, error } = await service.storage.from(ALMACEN_DE_ARCHIVOS).download(a.ruta)
      if (error || !archivo) throw new Error(error?.message ?? 'sin archivo')
      const texto = await transcribir(new Uint8Array(await archivo.arrayBuffer()), a.nombre, a.tipo, clave)
      propias.push(Date.now())
      console.info('[chat-voz]', { segundos: a.duracion ?? null, modelo: MODELO, costeUsd: costeDeVoz(MODELO, a.duracion ?? 0) })
      adjuntos.push({ ...a, transcripcion: texto })
      cambiado = true
    } catch (e) {
      console.error('Chat: fallo al transcribir una nota de voz:', e instanceof Error ? e.message : e)
      adjuntos.push(a)
    }
  }
  usos.set(fila.autor_id ?? '', propias)
  if (!cambiado) return
  const { data: actualizado, error } = await service.from('chat_mensajes').update({ adjuntos }).eq('id', fila.id).select('*').single()
  if (error || !actualizado) return
  const mensaje = (await armarMensajes([actualizado as FilaMensaje]))[0]
  const miembros = await miembrosDe(fila.canal_id)
  void emitir(miembros.map((m) => m.usuario_id), { tipo: 'editado', mensaje })
}
