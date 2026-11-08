/**
 * EL TEXTO DE LOS MENSAJES — PURO.
 *
 * Lo que se guarda es texto plano con un formato mínimo: `**negrita**`, `_cursiva_`, `` `código` ``, bloques con ``` y las menciones como `<@id-de-la-persona>` (así un cambio de nombre
 * no rompe lo ya escrito). Aquí se limpia lo que llega, se sacan las menciones y se parte el texto en trozos para pintarlo sin tocar HTML (nada de lo escrito se interpreta como HTML).
 */

export const CUERPO_MAX = 8000

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const RE_MENCION = new RegExp(`<@(${UUID})>`, 'gi')
/** Una mención a una persona o a todo el canal («@todos») */
const RE_MENCION_O_TODOS = new RegExp(`<@(${UUID}|todos)>`, 'gi')

export const tokenDeMencion = (id: string): string => `<@${id}>`

/** ¿Avisa a todo el canal? (`@todos`) */
export const mencionaATodos = (cuerpo: string): boolean => /<@todos>/i.test(cuerpo)

/** El texto tal como se guarda: saltos de línea normales, sin espacios ni líneas vacías de más. Vacío si no es texto */
export function limpiarCuerpo(entrada: unknown): string {
  if (typeof entrada !== 'string') return ''
  return entrada
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

export const cuerpoValido = (cuerpo: string): boolean => cuerpo.length <= CUERPO_MAX

/** Las personas mencionadas, sin repetir y en el orden en que salen */
export function extraerMenciones(cuerpo: string): string[] {
  const vistos = new Set<string>()
  for (const m of cuerpo.matchAll(RE_MENCION)) vistos.add(m[1].toLowerCase())
  return [...vistos]
}

export type Trozo =
  | { t: 'texto'; v: string }
  | { t: 'negrita'; v: string }
  | { t: 'cursiva'; v: string }
  | { t: 'codigo'; v: string }
  | { t: 'bloque'; v: string }
  | { t: 'mencion'; id: string }
  | { t: 'enlace'; v: string; url: string }

// El orden importa: lo más largo y específico primero
const RE_TROZOS = new RegExp(
  [
    '```([\\s\\S]+?)```', // 1 bloque
    '`([^`\\n]+)`', // 2 código
    `<@(${UUID}|todos)>`, // 3 mención
    '(https?:\\/\\/[^\\s<>]+)', // 4 enlace
    '\\*\\*([^*\\n]+)\\*\\*', // 5 negrita
    '(?<![\\p{L}\\p{N}_])_([^_\\n]+)_(?![\\p{L}\\p{N}_])', // 6 cursiva
  ].join('|'),
  'giu',
)

/** Un enlace pegado al final de una frase no lleva el punto ni la coma */
function recortarEnlace(url: string): { url: string; resto: string } {
  const m = /[.,;:!?)\]]+$/.exec(url)
  return m ? { url: url.slice(0, -m[0].length), resto: m[0] } : { url, resto: '' }
}

export function partirCuerpo(cuerpo: string): Trozo[] {
  const salida: Trozo[] = []
  const texto = (v: string) => {
    if (!v) return
    const ultimo = salida[salida.length - 1]
    if (ultimo?.t === 'texto') ultimo.v += v
    else salida.push({ t: 'texto', v })
  }
  let cursor = 0
  for (const m of cuerpo.matchAll(RE_TROZOS)) {
    const inicio = m.index ?? 0
    texto(cuerpo.slice(cursor, inicio))
    if (m[1] !== undefined) salida.push({ t: 'bloque', v: m[1].replace(/^\n+|\n+$/g, '') })
    else if (m[2] !== undefined) salida.push({ t: 'codigo', v: m[2] })
    else if (m[3] !== undefined) salida.push({ t: 'mencion', id: m[3].toLowerCase() })
    else if (m[4] !== undefined) {
      const { url, resto } = recortarEnlace(m[4])
      salida.push({ t: 'enlace', v: url, url })
      texto(resto)
    } else if (m[5] !== undefined) salida.push({ t: 'negrita', v: m[5] })
    else if (m[6] !== undefined) salida.push({ t: 'cursiva', v: m[6] })
    cursor = inicio + m[0].length
  }
  texto(cuerpo.slice(cursor))
  return salida
}

/** El mensaje como una frase corta, sin formato: para la vista previa de la barra, los avisos y las notificaciones */
export function textoPlano(cuerpo: string, nombreDe: (id: string) => string, max = 90): string {
  const plano = partirCuerpo(cuerpo)
    .map((t) => {
      switch (t.t) {
        case 'mencion':
          return t.id === 'todos' ? '@todos' : `@${nombreDe(t.id)}`
        case 'bloque':
          return '[código]'
        default:
          return t.v
      }
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return plano.length > max ? `${plano.slice(0, max - 1)}…` : plano
}

/** Un enlace que se puede abrir: solo http(s) */
export const esEnlaceSeguro = (url: string): boolean => /^https?:\/\//i.test(url)

export interface Mencionado {
  id: string
  nombre: string
}

/**
 * Para escribir y para editar se ve «@Ana», no el identificador. `aTextoEditable` cambia cada `<@id>` por `@Nombre` y devuelve a quién se mencionaba; `desdeTextoEditable` hace el camino
 * de vuelta: cada `@Nombre` de los mencionados que siga en el texto vuelve a ser `<@id>`. Los nombres más largos primero, para que «@Ana María» no se quede en «@Ana».
 */
export function aTextoEditable(cuerpo: string, nombreDe: (id: string) => string): { texto: string; mencionados: Mencionado[] } {
  const mencionados = new Map<string, Mencionado>()
  const texto = cuerpo.replace(RE_MENCION_O_TODOS, (_, id: string) => {
    const nombre = id.toLowerCase() === 'todos' ? 'todos' : nombreDe(id.toLowerCase())
    mencionados.set(id.toLowerCase(), { id: id.toLowerCase(), nombre })
    return `@${nombre}`
  })
  return { texto, mencionados: [...mencionados.values()] }
}

const escaparRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function desdeTextoEditable(texto: string, mencionados: readonly Mencionado[]): string {
  let salida = texto
  for (const m of [...mencionados].sort((a, b) => b.nombre.length - a.nombre.length)) {
    salida = salida.replace(new RegExp(`@${escaparRe(m.nombre)}(?![\\p{L}\\p{N}_])`, 'gu'), tokenDeMencion(m.id))
  }
  return salida
}
