import OpenAI from 'openai'
import { esfuerzoDeIa, modeloDeIa, razona } from '@/lib/ia/modelo'
import { HERRAMIENTAS, INSTRUCCIONES } from '@/lib/mcp/herramientas'
import { costeDeTexto } from '@/lib/transcripcion/precios'
import { ErrorDeChat, type QuienEscribe } from './servidor'

/**
 * «PREGUNTAR AL ERP» DESDE EL CHAT (solo administradores). Reutiliza las MISMAS herramientas de solo lectura del conector del ERP (lib/mcp/herramientas.ts: clientes, catálogo, citas,
 * Cold Calling, rendimiento, correo…): la IA decide cuáles consultar, las ejecuta aquí con los permisos de un administrador y contesta con lo que encuentra. Nada de lo que se pregunta ni
 * de lo que se contesta se guarda; solo se envía al canal si la persona lo pide. No cambia nada del ERP: ninguna de esas herramientas escribe.
 */

const MAX_VUELTAS = 6
const MAX_TURNOS = 12
const MAX_TEXTO_DE_HERRAMIENTA = 14_000
const ESPERA_MS = 3_000
const POR_HORA = 20

const usos = new Map<string, number[]>()

export interface TurnoDelAsistente {
  rol: 'user' | 'assistant'
  texto: string
}

export interface RespuestaDelAsistente {
  respuesta: string
  /** Las herramientas que ha consultado, para que se vea de dónde sale lo que dice */
  herramientas: string[]
  costeUsd: number
}

function turnosValidos(entrada: unknown): TurnoDelAsistente[] {
  if (!Array.isArray(entrada)) return []
  return entrada
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object')
    .map((t) => ({ rol: t.rol === 'assistant' ? ('assistant' as const) : ('user' as const), texto: typeof t.texto === 'string' ? t.texto.trim().slice(0, 2000) : '' }))
    .filter((t) => t.texto)
    .slice(-MAX_TURNOS)
}

const SISTEMA =
  'Eres el asistente de datos del ERP de Liberty Seller (una agencia de Amazon), dentro del chat interno. Quien te pregunta es administrador. Contesta en español de España, breve (unas 10 líneas como mucho), con las cifras concretas que salgan de las herramientas. ' +
  'Usa las herramientas para consultar; si una falla o no hay datos, dilo tal cual: NUNCA inventes una cifra. Si la pregunta es ambigua (qué cliente, qué fechas), elige lo más razonable y di qué has asumido. ' +
  'Formato: texto sencillo, negritas con **doble asterisco** y listas con «- ». Son datos internos: da lo necesario, sin volcar listas enormes. Solo lees: no puedes cambiar nada del ERP.\n\n' +
  INSTRUCCIONES

export async function preguntarAlErp(quien: QuienEscribe, entrada: { mensajes: unknown }): Promise<RespuestaDelAsistente> {
  if (!quien.esAdmin) throw new ErrorDeChat('El asistente del ERP es solo para administradores.', 403)
  const turnos = turnosValidos(entrada.mensajes)
  if (turnos.length === 0 || turnos[turnos.length - 1].rol !== 'user') throw new ErrorDeChat('Escribe una pregunta.')
  const clave = process.env.OPENAI_API_KEY?.trim()
  if (!clave) throw new ErrorDeChat('Falta la clave de OpenAI en el servidor (OPENAI_API_KEY).', 409)

  const ahora = Date.now()
  const previos = (usos.get(quien.userId) ?? []).filter((t) => ahora - t < 3_600_000)
  if (previos.length > 0 && ahora - previos[previos.length - 1] < ESPERA_MS) throw new ErrorDeChat('Espera un momento antes de preguntar otra vez.', 429)
  if (previos.length >= POR_HORA) throw new ErrorDeChat('Has hecho muchas preguntas en la última hora. Inténtalo más tarde.', 429)
  previos.push(ahora)
  usos.set(quien.userId, previos)

  const modelo = modeloDeIa()
  const herramientas = HERRAMIENTAS.map((h) => ({ type: 'function' as const, function: { name: h.nombre, description: h.descripcion.slice(0, 1200), parameters: h.esquema } }))
  const usuario = { id: quien.userId, email: null, rol: 'admin', clienteOAuth: 'chat' }
  const openai = new OpenAI({ apiKey: clave, maxRetries: 1 })
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), 110_000)
  const consultadas = new Set<string>()
  let coste = 0

  type Mensaje = { role: string; content?: string | null; tool_calls?: unknown; tool_call_id?: string }
  const mensajes: Mensaje[] = [{ role: 'system', content: SISTEMA }, ...turnos.map((t) => ({ role: t.rol, content: t.texto }))]

  const llamar = async (conHerramientas: boolean) => {
    const c = (await openai.chat.completions.create(
      {
        model: modelo,
        max_completion_tokens: 2500,
        ...(razona(modelo) ? { reasoning_effort: esfuerzoDeIa('low') } : { temperature: 0.2 }),
        messages: mensajes,
        ...(conHerramientas ? { tools: herramientas } : {}),
      } as never,
      { signal: control.signal }
    )) as unknown as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    if (c.usage) coste += costeDeTexto(modelo, c.usage.prompt_tokens ?? 0, c.usage.completion_tokens ?? 0)
    return c.choices?.[0]?.message
  }

  try {
    let respuesta: string | null = null
    for (let vuelta = 0; vuelta < MAX_VUELTAS && respuesta === null; vuelta++) {
      const m = await llamar(true)
      if (!m) break
      if (m.tool_calls && m.tool_calls.length > 0) {
        mensajes.push({ role: 'assistant', content: m.content ?? null, tool_calls: m.tool_calls })
        for (const llamada of m.tool_calls) {
          const h = HERRAMIENTAS.find((x) => x.nombre === llamada.function.name)
          let texto: string
          if (!h) texto = `La herramienta «${llamada.function.name}» no existe.`
          else {
            consultadas.add(h.nombre)
            try {
              let args: Record<string, unknown> = {}
              try {
                args = JSON.parse(llamada.function.arguments || '{}') as Record<string, unknown>
              } catch {
                args = {}
              }
              const r = await h.ejecutar(args, { usuario })
              texto = r.texto
            } catch (e) {
              texto = `Error al consultar: ${e instanceof Error ? e.message : 'desconocido'}`
            }
          }
          mensajes.push({ role: 'tool', tool_call_id: llamada.id, content: texto.length > MAX_TEXTO_DE_HERRAMIENTA ? `${texto.slice(0, MAX_TEXTO_DE_HERRAMIENTA)}…(recortado)` : texto })
        }
      } else respuesta = m.content?.trim() || null
    }
    // Si se acabaron las vueltas, se le pide que conteste con lo que ya tiene
    if (respuesta === null) {
      mensajes.push({ role: 'user', content: 'Contesta ya con lo que has encontrado, aunque sea parcial, y di qué falta.' })
      respuesta = (await llamar(false))?.content?.trim() || null
    }
    console.info('[chat-erp]', { herramientas: [...consultadas], modelo, costeUsd: coste })
    if (!respuesta) throw new ErrorDeChat('La IA no ha podido contestar. Inténtalo otra vez.', 502)
    return { respuesta, herramientas: [...consultadas], costeUsd: coste }
  } catch (e) {
    if (e instanceof ErrorDeChat) throw e
    const x = e as { status?: number; code?: string; name?: string }
    console.error('Chat: fallo del asistente del ERP:', x?.status ?? x?.code ?? x?.name ?? 'sin respuesta')
    throw new ErrorDeChat('La IA no ha contestado a tiempo. Inténtalo otra vez en un momento.', 502)
  } finally {
    clearTimeout(reloj)
  }
}
