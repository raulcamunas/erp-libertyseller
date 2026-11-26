/**
 * VENTAS · EL EMOTICONO DE CADA CLIENTE (el mismo que tiene en Tareas: tc_clientes.icono). SOLO SERVIDOR.
 *
 * Se casa por el nombre (sin mayúsculas, acentos, espacios ni «LLC», «S.L.», «España»…: «Jamones Tapas Party» ↔ «Tapas Party», «Cobofamily» ↔ «Cobo Family»).
 * Si un cliente no está en Tareas, la IA elige un emoticono a partir de su nombre (una llamada mínima, guardada en memoria mientras el servidor sigue vivo).
 * Si tampoco, null: la pantalla enseña las iniciales.
 */

import OpenAI from 'openai'
import { createServiceClient } from '@/lib/supabase/service'
import { parametrosDeIa } from '@/lib/ia/modelo'

const SOBRAN = new Set(['llc', 'sl', 'sa', 'slu', 'inc', 'ltd', 'gmbh', 'espana', 'spain', 'es', 'eu', 'the', 'ventures', 'global', 'marketplace', 'store'])
export function normalizarNombre(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((p) => p && !SOBRAN.has(p))
    .join('')
}

/** ¿Es el mismo cliente? Igual, o uno contiene al otro (con un mínimo de letras para no casar «es» con todo) */
export function mismoCliente(a: string, b: string): boolean {
  const x = normalizarNombre(a)
  const y = normalizarNombre(b)
  if (!x || !y) return false
  if (x === y) return true
  const [corto, largo] = x.length <= y.length ? [x, y] : [y, x]
  return corto.length >= 4 && largo.includes(corto)
}

const deLaIa = new Map<string, string | null>()

async function emojiPorIa(nombre: string): Promise<string | null> {
  if (deLaIa.has(nombre)) return deLaIa.get(nombre) ?? null
  const clave = process.env.OPENAI_API_KEY
  if (!clave) return null
  try {
    const cliente = new OpenAI({ apiKey: clave, maxRetries: 0, timeout: 8_000 })
    const r = await cliente.chat.completions.create({
      ...parametrosDeIa({ maxSalida: 400, esfuerzo: 'none' }),
      messages: [
        { role: 'system', content: 'Devuelves UN solo emoji (nada más, sin texto) que represente a una tienda de Amazon por su nombre y lo que probablemente vende.' },
        { role: 'user', content: nombre },
      ],
    })
    const texto = (r.choices?.[0]?.message?.content ?? '').trim()
    const emoji = [...texto].filter((c) => /\p{Extended_Pictographic}|‍|️|[\u{1F3FB}-\u{1F3FF}]|[\u{1F1E6}-\u{1F1FF}]/u.test(c)).join('').slice(0, 16) || null
    deLaIa.set(nombre, emoji)
    return emoji
  } catch {
    deLaIa.set(nombre, null)
    return null
  }
}

/** El emoticono de cada nombre de cliente (clave: el nombre que se pasa) */
export async function emojisDeClientes(nombres: string[]): Promise<Map<string, string | null>> {
  const salida = new Map<string, string | null>()
  const { data } = await createServiceClient().from('tc_clientes').select('nombre, icono')
  const tareas = ((data ?? []) as Array<{ nombre: string; icono: string | null }>).filter((t) => t.icono)
  for (const n of nombres) {
    const t = tareas.find((x) => normalizarNombre(x.nombre) === normalizarNombre(n)) ?? tareas.find((x) => mismoCliente(x.nombre, n))
    salida.set(n, t?.icono ?? (await emojiPorIa(n)))
  }
  return salida
}
