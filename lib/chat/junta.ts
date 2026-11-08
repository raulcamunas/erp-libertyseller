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
}
