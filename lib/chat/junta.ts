/**
 * LAS JUNTAS DEL CHAT (voz, vídeo y pantalla compartida) — PURO.
 *
 * El audio y el vídeo NO pasan por el servidor del ERP: viajan por LiveKit Cloud. El ERP solo decide quién puede entrar a cada sala y le da una llave de un solo uso (un token firmado con
 * la clave secreta, que nunca sale del servidor). Una sala por canal: `chat-<id del canal>`. Aquí viven las reglas que no dependen de la red.
 */

export const PREFIJO_DE_SALA = 'chat-'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export const salaDe = (canalId: string): string => `${PREFIJO_DE_SALA}${canalId}`

/** El canal al que pertenece una sala, o null si no es una sala del chat */
export function canalDeSala(sala: string): string | null {
  const m = new RegExp(`^${PREFIJO_DE_SALA}(${UUID})$`, 'i').exec(sala)
  return m ? m[1].toLowerCase() : null
}

export interface ConfiguracionDeJunta {
  /** La dirección para el navegador: wss://… */
  url: string
  /** La misma dirección para hablar con el servidor de LiveKit: https://… */
  urlHttp: string
  clave: string
  secreto: string
}

/**
 * Lo que hace falta para las juntas, leído de las variables de entorno (LIVEKIT_URL, LIVEKIT_API_KEY y LIVEKIT_API_SECRET). Sin las tres, las juntas no están disponibles y el chat sigue
 * igual. La dirección se acepta con wss://, ws://, https:// o http://, y sin barra final.
 */
export function configuracionDeJunta(env: Record<string, string | undefined>): ConfiguracionDeJunta | null {
  const bruta = (env.LIVEKIT_URL ?? '').trim().replace(/\/+$/, '')
  const clave = (env.LIVEKIT_API_KEY ?? '').trim()
  const secreto = (env.LIVEKIT_API_SECRET ?? '').trim()
  if (!bruta || !clave || !secreto) return null
  const m = /^(wss?|https?):\/\/([^\s/]+)$/i.exec(bruta)
  if (!m) return null
  const seguro = m[1].toLowerCase() === 'wss' || m[1].toLowerCase() === 'https'
  return { url: `${seguro ? 'wss' : 'ws'}://${m[2]}`, urlHttp: `${seguro ? 'https' : 'http'}://${m[2]}`, clave, secreto }
}

/** Cuánto vale la llave: lo que dura una junta larga; al caducar solo impide entrar de nuevo, no echa a quien ya está */
export const VIDA_DE_LA_LLAVE_S = 4 * 3600

export interface JuntaActiva {
  canalId: string
  participantes: number
  /** Los nombres de quien está dentro (ids de perfil → la pantalla pone el nombre) */
  personas: string[]
  /** La sala tiene candado: para entrar hay que llamar a la puerta y que alguien de dentro te deje (vive en los metadatos de la sala de LiveKit, así que se va sola cuando la sala se queda vacía) */
  bloqueada?: boolean
}

/** Lo que contesta el servidor al pedir entrar a una sala con candado sin que te hayan dejado (la pantalla lo reconoce y llama a la puerta) */
export const MENSAJE_DE_SALA_CON_CANDADO = 'Esta sala tiene candado: hay que pedir que te dejen entrar.'

/** Los metadatos de una sala: si tiene candado y a quién se ha dejado entrar. Lo que no se entiende es «sin candado» */
export function leerMetadatosDeSala(texto: string | null | undefined): { bloqueada: boolean; admitidos: string[] } {
  try {
    const m = JSON.parse(texto || '{}') as { bloqueada?: unknown; admitidos?: unknown }
    return { bloqueada: m.bloqueada === true, admitidos: Array.isArray(m.admitidos) ? m.admitidos.filter((x): x is string => typeof x === 'string').slice(0, 200) : [] }
  } catch {
    return { bloqueada: false, admitidos: [] }
  }
}

/**
 * Los metadatos de la sala llevan varias cosas (el candado y, si suena, la música): al cambiar una NO se puede pisar la otra. Mezcla los cambios con lo que ya había (un texto que no se entiende se
 * trata como vacío) y devuelve el texto nuevo. Un valor `undefined` en los cambios quita esa clave.
 */
export function fusionarMetadatosDeSala(actual: string | null | undefined, cambios: Record<string, unknown>): string {
  let base: Record<string, unknown> = {}
  try {
    const m = JSON.parse(actual || '{}')
    if (m && typeof m === 'object' && !Array.isArray(m)) base = m as Record<string, unknown>
  } catch {
    base = {}
  }
  const salida = { ...base, ...cambios }
  for (const k of Object.keys(salida)) if (salida[k] === undefined) delete salida[k]
  return JSON.stringify(salida)
}

/** ¿Puede entrar? Sin candado o sin nadie dentro, sí; con candado, solo quien ya está dentro o a quien han dejado entrar */
export function puedeEntrarASala(sala: { bloqueada: boolean; admitidos: readonly string[]; dentro: readonly string[] }, userId: string): boolean {
  if (!sala.bloqueada || sala.dentro.length === 0) return true
  return sala.dentro.includes(userId) || sala.admitidos.includes(userId)
}
