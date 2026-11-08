import OpenAI from 'openai'
import { esfuerzoDeIa, modeloDeIa, razona } from '@/lib/ia/modelo'
import { createServiceClient } from '@/lib/supabase/service'
import { costeDeTexto } from '@/lib/transcripcion/precios'
import { motivoDeRechazo, nombreLimpio, rutaDeArchivo } from './archivos'
import { limpiarEstado, type EstadoChat } from './estado'
import { limpiarCuerpo, textoPlano } from './mensajes'
import { fechaValida } from './recordatorios'
import { adjuntosValidos, ALMACEN_DE_ARCHIVOS, armarMensajes, canalDe, canalesVisibles, enviarMensaje, ErrorDeChat, esNumeroDeMensaje, esUuid, exigirMiembro, mensajeDe, miembrosDe, personasDelChat, type FilaMensaje, type QuienEscribe } from './servidor'
import { emitir } from './tiempo-real'
import type { AdjuntoChat, ItemDeBandeja, ProgramadoChat, RecordatorioChat, ResultadoDeBusqueda, ResumenDeCanal } from './tipos'

/**
 * LO QUE VA ENCIMA DEL CHAT: archivos, búsqueda, el resumen con IA, guardados y fijados, recordatorios, mensajes programados y el estado de cada persona. Mismo criterio que servidor.ts:
 * todo pasa por aquí con la clave de servicio y se comprueba quién puede ver cada canal. Lo que depende de la migración 286 contesta con un aviso claro si todavía no está lanzada.
 */

const db = () => createServiceClient()
const FALTA_286 = 'Falta lanzar la migración 286 en Supabase para esta función del chat.'
const falta286 = (e: { code?: string; message?: string } | null | undefined) => Boolean(e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === '42703' || e.code === 'PGRST204' || /does not exist|schema cache/i.test(e.message ?? '')))
function fallo(e: { code?: string; message?: string }, que: string): never {
  if (falta286(e)) throw new ErrorDeChat(FALTA_286, 409)
  console.error(`Chat: ${que}:`, e.message)
  throw new ErrorDeChat('No se ha podido completar la operación. Inténtalo otra vez.', 500)
}

/* ------------------------------------------------------------------ */
/* Archivos                                                            */
/* ------------------------------------------------------------------ */

const TIPOS_DE_IMAGEN: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50,
  'image/gif': (b) => b[0] === 0x47 && b[1] === 0x49,
  'image/webp': (b) => b[0] === 0x52 && b[8] === 0x57,
}

/** Sube un archivo al almacén privado. Devuelve lo que hay que mandar con el mensaje (la ruta) y un enlace para verlo ya */
export async function subirArchivo(quien: QuienEscribe, fichero: File): Promise<AdjuntoChat> {
  const nombre = nombreLimpio(fichero.name)
  const motivo = motivoDeRechazo(nombre, fichero.size)
  if (motivo) throw new ErrorDeChat(motivo)
  const bytes = new Uint8Array(await fichero.arrayBuffer())
  // Una imagen tiene que serlo de verdad: se mira la cabecera del fichero, no solo lo que dice el navegador
  const comprueba = TIPOS_DE_IMAGEN[fichero.type]
  if (comprueba && !comprueba(bytes)) throw new ErrorDeChat('El fichero no es una imagen válida.')
  const ruta = rutaDeArchivo(quien.userId, crypto.randomUUID(), nombre)
  const tipo = fichero.type || 'application/octet-stream'
  const { error } = await db().storage.from(ALMACEN_DE_ARCHIVOS).upload(ruta, bytes, { contentType: tipo, upsert: false })
  if (error) {
    if (/bucket/i.test(error.message) && /not found/i.test(error.message)) throw new ErrorDeChat(FALTA_286, 409)
    console.error('Chat: no se ha podido subir el archivo:', error.message)
    throw new ErrorDeChat('No se ha podido subir el archivo.', 500)
  }
  const { data } = await db().storage.from(ALMACEN_DE_ARCHIVOS).createSignedUrl(ruta, 12 * 3600)
  return { nombre, ruta, url: data?.signedUrl ?? '', tipo, tamano: fichero.size }
}

/* ------------------------------------------------------------------ */
/* Búsqueda                                                            */
/* ------------------------------------------------------------------ */

/** Lo que se escribe en el buscador a un patrón de LIKE sin comodines propios */
const patron = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`

export async function buscarMensajes(quien: QuienEscribe, entrada: { q: unknown; canalId?: unknown }): Promise<{ resultados: ResultadoDeBusqueda[] }> {
  const q = typeof entrada.q === 'string' ? entrada.q.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
  if (q.length < 2) return { resultados: [] }
  const visibles = await canalesVisibles(quien)
  let ids = visibles.map((c) => c.id)
  if (esUuid(entrada.canalId)) ids = ids.filter((id) => id === entrada.canalId)
  if (ids.length === 0) return { resultados: [] }
  const { data, error } = await db().from('chat_mensajes').select('id, canal_id, autor_id, cuerpo, hilo_de, creado_en').in('canal_id', ids).is('borrado_en', null).ilike('cuerpo', patron(q)).order('id', { ascending: false }).limit(30)
  if (error) fallo(error, 'buscar')
  const personas = await personasDelChat()
  const nombreDe = (id: string) => personas.find((p) => p.id === id)?.nombre.split(' ')[0] ?? 'alguien'
  return { resultados: ((data ?? []) as Array<{ id: number; canal_id: string; autor_id: string | null; cuerpo: string; hilo_de: number | null; creado_en: string }>).map((m) => ({ id: m.id, canalId: m.canal_id, autor_id: m.autor_id, cuerpo: textoPlano(m.cuerpo, nombreDe, 220), hilo_de: m.hilo_de, creado_en: m.creado_en })) }
}

/* ------------------------------------------------------------------ */
/* Guardados, fijados y bandejas                                       */
/* ------------------------------------------------------------------ */

export async function guardarMensaje(quien: QuienEscribe, id: unknown, valor: unknown): Promise<{ guardado: boolean }> {
  const fila = await mensajeDe(id)
  const canal = await canalDe(fila.canal_id)
  const visibles = await canalesVisibles(quien)
  if (!visibles.some((c) => c.id === canal.id)) throw new ErrorDeChat('Ese mensaje no existe.', 404)
  const service = db()
  const { error } = valor === true ? await service.from('chat_guardados').upsert({ usuario_id: quien.userId, mensaje_id: fila.id }, { onConflict: 'usuario_id,mensaje_id', ignoreDuplicates: true }) : await service.from('chat_guardados').delete().eq('usuario_id', quien.userId).eq('mensaje_id', fila.id)
  if (error) fallo(error, 'guardar el mensaje')
  return { guardado: valor === true }
}

export async function fijarMensaje(quien: QuienEscribe, id: unknown, valor: unknown) {
  const fila = await mensajeDe(id)
  if (fila.borrado_en) throw new ErrorDeChat('Ese mensaje está borrado.', 409)
  const canal = await canalDe(fila.canal_id)
  const miembros = await exigirMiembro(quien, canal)
  const { data, error } = await db()
    .from('chat_mensajes')
    .update(valor === true ? { fijado_en: new Date().toISOString(), fijado_por: quien.userId } : { fijado_en: null, fijado_por: null })
    .eq('id', fila.id)
    .select('*')
    .single()
  if (error) fallo(error, 'fijar el mensaje')
  const mensaje = (await armarMensajes([data as FilaMensaje]))[0]
  void emitir(miembros.map((m) => m.usuario_id), { tipo: 'editado', mensaje })
  void emitir(miembros.map((m) => m.usuario_id), { tipo: 'canales' })
  return { mensaje }
}

export async function bandeja(quien: QuienEscribe, tipo: unknown, canalId?: unknown): Promise<{ items: ItemDeBandeja[] }> {
  const service = db()
  const visibles = await canalesVisibles(quien)
  const ids = new Set(visibles.map((c) => c.id))
  let filas: FilaMensaje[] = []
  if (tipo === 'menciones') {
    if (ids.size === 0) return { items: [] }
    const { data, error } = await service.from('chat_mensajes').select('*').in('canal_id', [...ids]).contains('menciones', [quien.userId]).is('borrado_en', null).order('id', { ascending: false }).limit(50)
    if (error) fallo(error, 'leer las menciones')
    filas = (data ?? []) as FilaMensaje[]
  } else if (tipo === 'guardados') {
    const { data: guardados, error } = await service.from('chat_guardados').select('mensaje_id').eq('usuario_id', quien.userId).order('creado_en', { ascending: false }).limit(100)
    if (error) fallo(error, 'leer los guardados')
    const orden = ((guardados ?? []) as Array<{ mensaje_id: number }>).map((g) => g.mensaje_id)
    if (orden.length === 0) return { items: [] }
    const { data } = await service.from('chat_mensajes').select('*').in('id', orden).is('borrado_en', null)
    const porId = new Map(((data ?? []) as FilaMensaje[]).map((m) => [m.id, m]))
    filas = orden.map((i) => porId.get(i)).filter((m): m is FilaMensaje => Boolean(m))
  } else if (tipo === 'fijados') {
    if (!esUuid(canalId) || !ids.has(canalId)) throw new ErrorDeChat('Ese canal no existe.', 404)
    const { data, error } = await service.from('chat_mensajes').select('*').eq('canal_id', canalId).not('fijado_en', 'is', null).is('borrado_en', null).order('fijado_en', { ascending: false }).limit(50)
    if (error) fallo(error, 'leer los fijados')
    filas = (data ?? []) as FilaMensaje[]
  } else throw new ErrorDeChat('Esa lista no existe.')
  const permitidas = filas.filter((f) => ids.has(f.canal_id))
  const mensajes = await armarMensajes(permitidas)
  return { items: mensajes.map((m) => ({ mensaje: m, canalId: m.canal_id })) }
}

/* ------------------------------------------------------------------ */
/* «Ponme al día» con IA                                               */
/* ------------------------------------------------------------------ */

const ESQUEMA_DEL_RESUMEN = {
  type: 'object',
  additionalProperties: false,
  required: ['resumen', 'decisiones', 'pendientes', 'preguntas'],
  properties: {
    resumen: { type: 'string' },
    decisiones: { type: 'array', items: { type: 'string' } },
    pendientes: { type: 'array', items: { type: 'string' } },
    preguntas: { type: 'array', items: { type: 'string' } },
  },
} as const

const ultimoResumen = new Map<string, { en: number; veces: number[] }>()
const ESPERA_ENTRE_RESUMENES_MS = 15_000
const MAX_RESUMENES_POR_HORA = 20
const MAX_MENSAJES_A_RESUMIR = 200
const MAX_CARACTERES_A_RESUMIR = 28_000

export async function resumirCanal(quien: QuienEscribe, canalId: unknown): Promise<ResumenDeCanal> {
  const ahora = Date.now()
  const previo = ultimoResumen.get(quien.userId) ?? { en: 0, veces: [] }
  previo.veces = previo.veces.filter((t) => ahora - t < 3_600_000)
  if (ahora - previo.en < ESPERA_ENTRE_RESUMENES_MS) throw new ErrorDeChat('Espera unos segundos antes de pedir otro resumen.', 429)
  if (previo.veces.length >= MAX_RESUMENES_POR_HORA) throw new ErrorDeChat('Has pedido muchos resúmenes en la última hora. Inténtalo más tarde.', 429)
  const clave = process.env.OPENAI_API_KEY?.trim()
  if (!clave) throw new ErrorDeChat('Falta la clave de OpenAI en el servidor (OPENAI_API_KEY).', 409)

  const canal = await canalDe(canalId)
  const miembros = await miembrosDe(canal.id)
  if (canal.tipo !== 'canal' && !miembros.some((m) => m.usuario_id === quien.userId)) throw new ErrorDeChat('Ese canal no existe.', 404)
  const propio = miembros.find((m) => m.usuario_id === quien.userId)
  const service = db()
  // Lo que no has leído; si no hay nada nuevo, las últimas 24 horas
  const { data: lectura } = await service.from('chat_miembros').select('ultimo_leido_en').eq('canal_id', canal.id).eq('usuario_id', quien.userId).maybeSingle()
  const ultimaLectura = (lectura as { ultimo_leido_en?: string } | null)?.ultimo_leido_en
  const hace24h = new Date(ahora - 24 * 3_600_000).toISOString()
  const desde = propio && ultimaLectura && ultimaLectura > hace24h ? ultimaLectura : hace24h
  const { data, error } = await service.from('chat_mensajes').select('id, autor_id, cuerpo, creado_en, hilo_de').eq('canal_id', canal.id).is('borrado_en', null).gt('creado_en', desde).order('id', { ascending: false }).limit(MAX_MENSAJES_A_RESUMIR)
  if (error) fallo(error, 'leer los mensajes para el resumen')
  const filas = ((data ?? []) as Array<{ id: number; autor_id: string | null; cuerpo: string; creado_en: string; hilo_de: number | null }>).reverse()
  if (filas.length === 0) throw new ErrorDeChat('No hay mensajes nuevos que resumir.', 404)

  const personas = await personasDelChat()
  const nombreDe = (id: string | null) => (id ? personas.find((p) => p.id === id)?.nombre ?? 'Alguien' : 'Alguien')
  const hora = (iso: string) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  let transcripcion = filas.map((f) => `[${hora(f.creado_en)}] ${nombreDe(f.autor_id)}${f.hilo_de ? ' (en un hilo)' : ''}: ${textoPlano(f.cuerpo, (id) => nombreDe(id).split(' ')[0], 600)}`).join('\n')
  if (transcripcion.length > MAX_CARACTERES_A_RESUMIR) transcripcion = `…\n${transcripcion.slice(-MAX_CARACTERES_A_RESUMIR)}`

  const modelo = modeloDeIa()
  previo.en = ahora
  previo.veces.push(ahora)
  ultimoResumen.set(quien.userId, previo)
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), 60_000)
  try {
    const openai = new OpenAI({ apiKey: clave, maxRetries: 1 })
    const completion = (await openai.chat.completions.create(
      {
        model: modelo,
        max_completion_tokens: 3000,
        ...(razona(modelo) ? { reasoning_effort: esfuerzoDeIa('low') } : { temperature: 0.2 }),
        response_format: { type: 'json_schema', json_schema: { name: 'resumen_del_canal', strict: true, schema: ESQUEMA_DEL_RESUMEN as unknown as Record<string, unknown> } },
        messages: [
          {
            role: 'system',
            content:
              'Eres el asistente del chat interno de una agencia de Amazon. Te paso la conversación de un canal y haces un resumen breve, claro y útil para quien llega tarde. Escribe en español de España, sin adornos. ' +
              '«resumen»: 2 a 4 frases con lo importante. «decisiones»: lo que se ha acordado o decidido (vacío si nada). «pendientes»: tareas o compromisos abiertos, con el nombre de quien debe hacerlos si se sabe. ' +
              '«preguntas»: preguntas o peticiones que siguen sin respuesta, sobre todo las dirigidas a la persona que pide el resumen (vacío si nada). No inventes nada que no esté en la conversación. Cada punto, una frase corta.',
          },
          { role: 'user', content: `Pide el resumen: ${quien.nombre}\nCanal: ${canal.tipo === 'directo' ? 'mensaje directo' : `#${canal.nombre}`}\n\nConversación:\n${transcripcion}` },
        ],
      } as never,
      { signal: control.signal }
    )) as unknown as { choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    const contenido = completion.choices?.[0]?.message?.content
    if (!contenido || completion.choices?.[0]?.message?.refusal) throw new ErrorDeChat('La IA no ha podido resumir esta conversación.', 502)
    let r: { resumen?: unknown; decisiones?: unknown; pendientes?: unknown; preguntas?: unknown }
    try {
      r = JSON.parse(contenido)
    } catch {
      throw new ErrorDeChat('La IA ha devuelto algo que no se entiende. Inténtalo otra vez.', 502)
    }
    const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, 300)).slice(0, 12) : [])
    const coste = completion.usage ? costeDeTexto(modelo, completion.usage.prompt_tokens ?? 0, completion.usage.completion_tokens ?? 0) : 0
    console.info('[chat-resumen]', { mensajes: filas.length, modelo, costeUsd: coste })
    return { resumen: typeof r.resumen === 'string' ? r.resumen.trim().slice(0, 1200) : '', decisiones: lista(r.decisiones), pendientes: lista(r.pendientes), preguntas: lista(r.preguntas), mensajes: filas.length, desde }
  } catch (e) {
    if (e instanceof ErrorDeChat) throw e
    const x = e as { status?: number; code?: string }
    console.error('Chat: fallo de la IA al resumir:', x?.status ?? x?.code ?? 'sin respuesta')
    throw new ErrorDeChat('La IA no ha contestado. Inténtalo otra vez en un momento.', 502)
  } finally {
    clearTimeout(reloj)
  }
}

/* ------------------------------------------------------------------ */
/* Recordatorios                                                       */
/* ------------------------------------------------------------------ */

export async function crearRecordatorio(quien: QuienEscribe, entrada: { mensajeId?: unknown; canalId?: unknown; texto?: unknown; avisarEn: unknown }): Promise<RecordatorioChat> {
  const fecha = fechaValida(entrada.avisarEn, Date.now())
  if (!fecha.ok) throw new ErrorDeChat(fecha.motivo)
  let canalId: string | null = esUuid(entrada.canalId) ? entrada.canalId : null
  let mensajeId: number | null = null
  let texto = typeof entrada.texto === 'string' ? entrada.texto.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
  if (entrada.mensajeId !== undefined && entrada.mensajeId !== null) {
    const fila = await mensajeDe(entrada.mensajeId)
    const visibles = await canalesVisibles(quien)
    if (!visibles.some((c) => c.id === fila.canal_id) || fila.borrado_en) throw new ErrorDeChat('Ese mensaje no existe.', 404)
    mensajeId = fila.id
    canalId = fila.canal_id
    if (!texto) {
      const personas = await personasDelChat()
      texto = textoPlano(fila.cuerpo, (id) => personas.find((p) => p.id === id)?.nombre.split(' ')[0] ?? 'alguien', 200) || 'Mensaje con archivos'
    }
  }
  if (!texto && !mensajeId) throw new ErrorDeChat('Escribe de qué quieres que te avise.')
  const { data, error } = await db().from('chat_recordatorios').insert({ usuario_id: quien.userId, mensaje_id: mensajeId, canal_id: canalId, texto, avisar_en: new Date(fecha.en).toISOString() }).select('id, texto, canal_id, mensaje_id, avisar_en, enviado_en').single()
  if (error) fallo(error, 'crear el recordatorio')
  return data as RecordatorioChat
}

export async function listarRecordatorios(quien: QuienEscribe): Promise<{ pendientes: RecordatorioChat[]; enviados: RecordatorioChat[] }> {
  const service = db()
  const columnas = 'id, texto, canal_id, mensaje_id, avisar_en, enviado_en'
  const [pendientes, enviados] = await Promise.all([
    service.from('chat_recordatorios').select(columnas).eq('usuario_id', quien.userId).is('enviado_en', null).order('avisar_en', { ascending: true }).limit(100),
    service.from('chat_recordatorios').select(columnas).eq('usuario_id', quien.userId).not('enviado_en', 'is', null).order('avisar_en', { ascending: false }).limit(10),
  ])
  if (pendientes.error) fallo(pendientes.error, 'leer los recordatorios')
  return { pendientes: (pendientes.data ?? []) as RecordatorioChat[], enviados: (enviados.data ?? []) as RecordatorioChat[] }
}

export async function borrarRecordatorio(quien: QuienEscribe, id: unknown): Promise<{ ok: true }> {
  if (!esUuid(id)) throw new ErrorDeChat('Falta el recordatorio.')
  const { error } = await db().from('chat_recordatorios').delete().eq('id', id).eq('usuario_id', quien.userId)
  if (error) fallo(error, 'borrar el recordatorio')
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Mensajes programados                                                */
/* ------------------------------------------------------------------ */

export async function programarMensaje(quien: QuienEscribe, entrada: { canalId: unknown; cuerpo: unknown; hiloDe?: unknown; respondeA?: unknown; adjuntos?: unknown; enviarEn: unknown }): Promise<ProgramadoChat> {
  const fecha = fechaValida(entrada.enviarEn, Date.now())
  if (!fecha.ok) throw new ErrorDeChat(fecha.motivo)
  const cuerpo = limpiarCuerpo(entrada.cuerpo)
  const adjuntos = adjuntosValidos(entrada.adjuntos, quien.userId)
  if (!cuerpo && adjuntos.length === 0) throw new ErrorDeChat('Escribe algo antes de programarlo.')
  const canal = await canalDe(entrada.canalId)
  await exigirMiembro(quien, canal)
  const hiloDe = entrada.hiloDe === undefined || entrada.hiloDe === null ? null : Number(entrada.hiloDe)
  const respondeA = entrada.respondeA === undefined || entrada.respondeA === null ? null : Number(entrada.respondeA)
  if ((hiloDe !== null && !esNumeroDeMensaje(hiloDe)) || (respondeA !== null && !esNumeroDeMensaje(respondeA))) throw new ErrorDeChat('Ese mensaje no es válido.')
  const { data, error } = await db().from('chat_programados').insert({ canal_id: canal.id, autor_id: quien.userId, cuerpo, hilo_de: hiloDe, responde_a: respondeA, adjuntos, enviar_en: new Date(fecha.en).toISOString() }).select('id, canal_id, cuerpo, enviar_en, estado, error, adjuntos').single()
  if (error) fallo(error, 'programar el mensaje')
  return data as ProgramadoChat
}

export async function listarProgramados(quien: QuienEscribe): Promise<{ pendientes: ProgramadoChat[]; recientes: ProgramadoChat[] }> {
  const service = db()
  const columnas = 'id, canal_id, cuerpo, enviar_en, estado, error, adjuntos'
  const [pendientes, recientes] = await Promise.all([
    service.from('chat_programados').select(columnas).eq('autor_id', quien.userId).eq('estado', 'pendiente').order('enviar_en', { ascending: true }).limit(100),
    service.from('chat_programados').select(columnas).eq('autor_id', quien.userId).in('estado', ['enviado', 'error']).order('enviar_en', { ascending: false }).limit(10),
  ])
  if (pendientes.error) fallo(pendientes.error, 'leer los mensajes programados')
  return { pendientes: (pendientes.data ?? []) as ProgramadoChat[], recientes: (recientes.data ?? []) as ProgramadoChat[] }
}

export async function cancelarProgramado(quien: QuienEscribe, id: unknown): Promise<{ ok: true }> {
  if (!esUuid(id)) throw new ErrorDeChat('Falta el mensaje programado.')
  const { error } = await db().from('chat_programados').update({ estado: 'cancelado' }).eq('id', id).eq('autor_id', quien.userId).eq('estado', 'pendiente')
  if (error) fallo(error, 'cancelar el mensaje programado')
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* El estado de cada persona                                           */
/* ------------------------------------------------------------------ */

export async function ponerEstado(quien: QuienEscribe, entrada: { emoji: unknown; texto: unknown; duracion: unknown }): Promise<{ estado: EstadoChat | null }> {
  const estado = limpiarEstado(entrada.emoji, entrada.texto, entrada.duracion, Date.now())
  const service = db()
  const { error } = estado ? await service.from('chat_estados').upsert({ usuario_id: quien.userId, emoji: estado.emoji, texto: estado.texto, hasta: estado.hasta, actualizado_en: new Date().toISOString() }, { onConflict: 'usuario_id' }) : await service.from('chat_estados').delete().eq('usuario_id', quien.userId)
  if (error) fallo(error, 'guardar el estado')
  void emitir((await personasDelChat()).map((p) => p.id), { tipo: 'estado', usuario: quien.userId, estado })
  return { estado }
}

/* ------------------------------------------------------------------ */
/* El proceso automático (cada minuto)                                 */
/* ------------------------------------------------------------------ */

export interface ResumenDeLaPasadaDelChat {
  recordatorios: number
  programados: number
  errores: number
  resumen: string
}

export async function pasadaDeChat(): Promise<ResumenDeLaPasadaDelChat> {
  const service = db()
  const ahora = new Date().toISOString()
  let recordatorios = 0
  let programados = 0
  let errores = 0

  // 1. Los recordatorios que ya tocan: cada uno se «reclama» antes de avisar, para que si dos pasadas se solapan no salga dos veces
  const { data: debidos, error: errorRec } = await service.from('chat_recordatorios').select('id, usuario_id, mensaje_id, canal_id, texto').is('enviado_en', null).lte('avisar_en', ahora).order('avisar_en').limit(100)
  if (errorRec) return { recordatorios: 0, programados: 0, errores: 0, resumen: falta286(errorRec) ? 'falta la migración 286' : `error: ${errorRec.message}` }
  for (const r of (debidos ?? []) as Array<{ id: string; usuario_id: string; mensaje_id: number | null; canal_id: string | null; texto: string }>) {
    const { data: reclamado } = await service.from('chat_recordatorios').update({ enviado_en: ahora }).eq('id', r.id).is('enviado_en', null).select('id')
    if (!reclamado || reclamado.length === 0) continue
    const { error } = await service.from('notifications').upsert({ user_id: r.usuario_id, type: 'mention', title: '⏰ Recordatorio', message: r.texto || 'Tenías un recordatorio del chat', clave: `chat-rec:${r.id}`, datos: { app: 'chat', canalId: r.canal_id, mensajeId: r.mensaje_id, tipo: 'recordatorio' }, read: false }, { onConflict: 'user_id,clave', ignoreDuplicates: true })
    if (error) errores++
    else recordatorios++
  }

  // 2. Los mensajes programados que ya tocan: salen como si su autor los escribiera ahora
  const { data: pendientes } = await service.from('chat_programados').select('id, canal_id, autor_id, cuerpo, hilo_de, responde_a, adjuntos').eq('estado', 'pendiente').lte('enviar_en', ahora).order('enviar_en').limit(50)
  if ((pendientes ?? []).length > 0) {
    const personas = await personasDelChat()
    for (const p of (pendientes ?? []) as Array<{ id: string; canal_id: string; autor_id: string; cuerpo: string; hilo_de: number | null; responde_a: number | null; adjuntos: AdjuntoChat[] }>) {
      const { data: reclamado } = await service.from('chat_programados').update({ estado: 'enviado', enviado_en: ahora }).eq('id', p.id).eq('estado', 'pendiente').select('id')
      if (!reclamado || reclamado.length === 0) continue
      const autor = personas.find((x) => x.id === p.autor_id)
      try {
        await enviarMensaje({ userId: p.autor_id, nombre: autor?.nombre ?? 'Alguien del equipo', esAdmin: false }, { canalId: p.canal_id, cuerpo: p.cuerpo, hiloDe: p.hilo_de ?? undefined, respondeA: p.responde_a ?? undefined, adjuntos: p.adjuntos })
        programados++
      } catch (e) {
        errores++
        const motivo = e instanceof ErrorDeChat ? e.message : 'Error inesperado'
        await service.from('chat_programados').update({ estado: 'error', error: motivo.slice(0, 300) }).eq('id', p.id)
        await service.from('notifications').upsert({ user_id: p.autor_id, type: 'mention', title: 'No se ha podido enviar un mensaje programado', message: `${motivo} · «${textoPlano(p.cuerpo, () => 'alguien', 80)}»`, clave: `chat-prog-error:${p.id}`, datos: { app: 'chat', canalId: p.canal_id, tipo: 'recordatorio' }, read: false }, { onConflict: 'user_id,clave', ignoreDuplicates: true })
      }
    }
  }

  const partes = [recordatorios > 0 && `${recordatorios} recordatorios`, programados > 0 && `${programados} mensajes programados`, errores > 0 && `${errores} errores`].filter(Boolean)
  return { recordatorios, programados, errores, resumen: partes.length > 0 ? partes.join(' · ') : 'nada que hacer' }
}

