/**
 * LA MÚSICA DE YOUTUBE EN UNA SALA DE VOZ — PURO. Todos los de la sala escuchan lo mismo a la vez: cada uno la reproduce en SU navegador con el reproductor oficial de YouTube (no pasa por la llamada,
 * así que no hay eco ni se come el micrófono), y lo que los une es un estado compartido —la cola, qué pista suena, si está en pausa y por dónde va— que viaja en los metadatos de la sala de LiveKit.
 * Aquí viven las reglas que no dependen de la red: entender un enlace, y el REDUCTOR que calcula el estado nuevo tras cada acción (añadir, pausar, rebobinar, saltar, quitar…). El servidor lo aplica y los
 * navegadores lo reciben; todos usan estas mismas funciones. Se comprueba en musica.prueba.ts.
 */

export interface PistaDeMusica {
  /** Identificador de ESTA entrada de la cola (la misma canción puede estar dos veces) */
  id: string
  /** El id del vídeo de YouTube (11 caracteres) */
  videoId: string
  titulo: string
  autor: string
  /** Quién la añadió (id de perfil) */
  anadidaPor: string
}

export interface EstadoDeMusica {
  cola: PistaDeMusica[]
  /** Qué pista de la cola suena (-1 = ninguna) */
  indice: number
  reproduciendo: boolean
  /** Por dónde iba la pista (ms) en el instante `t` */
  posMs: number
  /** Cuándo se calculó `posMs`, en hora del servidor (ms desde 1970) */
  t: number
  /** Sube con cada cambio (para ignorar lo atrasado) */
  v: number
}

export const MAX_COLA = 100
export const MAX_TITULO = 120
/** Con la pista más allá de este tiempo, «anterior» la reinicia en vez de ir a la anterior (como en cualquier reproductor) */
export const REINICIO_AL_VOLVER_MS = 3000

export const MUSICA_VACIA: EstadoDeMusica = { cola: [], indice: -1, reproduciendo: false, posMs: 0, t: 0, v: 0 }

const ID_DE_VIDEO = /^[A-Za-z0-9_-]{11}$/
const ID_DE_LISTA = /^[A-Za-z0-9_-]{10,60}$/
export const esIdDeVideo = (v: unknown): v is string => typeof v === 'string' && ID_DE_VIDEO.test(v)

export interface EnlaceDeYouTube {
  videoId: string | null
  listaId: string | null
  /** El enlace es la página de una lista (youtube.com/playlist?list=…) y no un vídeo suelto */
  esPaginaDeLista: boolean
}

/**
 * Lo que hay en un enlace de YouTube: un vídeo (`watch?v=`, `youtu.be/`, `shorts/`, `embed/`, `live/`, YouTube Music) y/o una lista (`list=`). null si no es de YouTube. Las listas «mix» (RD…) no se pueden expandir
 * y se tratan como el vídeo suelto.
 */
export function leerEnlaceDeYouTube(texto: string): EnlaceDeYouTube | null {
  const bruto = texto.trim()
  if (!bruto || bruto.length > 500) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(bruto) ? bruto : `https://${bruto}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '')
  let videoId: string | null = null
  if (host === 'youtu.be') videoId = url.pathname.split('/')[1] ?? null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const partes = url.pathname.split('/').filter(Boolean)
    if (url.pathname === '/watch') videoId = url.searchParams.get('v')
    else if (['shorts', 'embed', 'live', 'v'].includes(partes[0] ?? '')) videoId = partes[1] ?? null
  } else return null
  const lista = url.searchParams.get('list')
  const listaId = lista && ID_DE_LISTA.test(lista) && !/^RD/i.test(lista) ? lista : null
  const video = videoId && ID_DE_VIDEO.test(videoId) ? videoId : null
  if (!video && !listaId) return null
  return { videoId: video, listaId, esPaginaDeLista: !video && listaId !== null }
}

/** Lo que llega de los metadatos de la sala (o de la red), limpio: lo que no se entiende es «sin música» */
export function normalizarEstadoDeMusica(bruto: unknown): EstadoDeMusica {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return { ...MUSICA_VACIA, cola: [] }
  const b = bruto as Record<string, unknown>
  const cola: PistaDeMusica[] = []
  for (const x of Array.isArray(b.cola) ? b.cola.slice(0, MAX_COLA) : []) {
    const p = x as Record<string, unknown> | null
    if (!p || typeof p.id !== 'string' || !esIdDeVideo(p.videoId)) continue
    cola.push({ id: p.id.slice(0, 40), videoId: p.videoId, titulo: String(p.titulo ?? '').slice(0, MAX_TITULO), autor: String(p.autor ?? '').slice(0, 80), anadidaPor: String(p.anadidaPor ?? '').slice(0, 40) })
  }
  const num = (v: unknown, defecto: number) => (typeof v === 'number' && Number.isFinite(v) ? v : defecto)
  const indice = Math.trunc(num(b.indice, -1))
  return {
    cola,
    indice: cola.length === 0 ? -1 : Math.min(Math.max(indice, -1), cola.length - 1),
    reproduciendo: b.reproduciendo === true && cola.length > 0,
    posMs: Math.max(0, num(b.posMs, 0)),
    t: Math.max(0, num(b.t, 0)),
    v: Math.max(0, Math.trunc(num(b.v, 0))),
  }
}

/** Por dónde va la pista ahora (ms): la posición guardada más lo que ha pasado desde entonces si está sonando. `ahoraMs` es la hora del servidor */
export function posicionActual(e: EstadoDeMusica, ahoraMs: number): number {
  if (e.indice < 0) return 0
  return Math.max(0, e.posMs + (e.reproduciendo ? Math.max(0, ahoraMs - e.t) : 0))
}

export type AccionDeMusica =
  | { tipo: 'anadir'; pistas: PistaDeMusica[] }
  /** `desde`: la pista que ha terminado (varios navegadores avisan a la vez; solo cuenta el primero) */
  | { tipo: 'siguiente'; desde?: string }
  | { tipo: 'anterior' }
  | { tipo: 'pausar' }
  | { tipo: 'reanudar' }
  | { tipo: 'buscar'; posMs: number }
  /** Adelantar o rebobinar (ms, con signo) */
  | { tipo: 'saltar'; ms: number }
  | { tipo: 'irA'; indice: number }
  | { tipo: 'quitar'; id: string }
  | { tipo: 'vaciar' }

/** El estado nuevo tras una acción. Lo que no tiene sentido (saltar a una pista que no existe, quitar la que no está…) no cambia nada */
export function aplicarAccionDeMusica(e: EstadoDeMusica, a: AccionDeMusica, ahoraMs: number): EstadoDeMusica {
  const ahora = posicionActual(e, ahoraMs)
  const nuevo = (cambios: Partial<EstadoDeMusica>): EstadoDeMusica => ({ ...e, t: ahoraMs, v: e.v + 1, ...cambios })
  switch (a.tipo) {
    case 'anadir': {
      const pistas = a.pistas.filter((p) => esIdDeVideo(p.videoId)).slice(0, Math.max(0, MAX_COLA - e.cola.length))
      if (pistas.length === 0) return e
      const cola = [...e.cola, ...pistas]
      // Con la cola vacía (o acabada) lo que se añade empieza a sonar
      const acabada = e.indice < 0 || (!e.reproduciendo && e.indice === e.cola.length - 1 && ahora === 0)
      return acabada ? nuevo({ cola, indice: e.indice < 0 ? 0 : e.cola.length, reproduciendo: true, posMs: 0 }) : nuevo({ cola })
    }
    case 'siguiente': {
      if (e.indice < 0) return e
      if (a.desde !== undefined && e.cola[e.indice]?.id !== a.desde) return e
      if (e.indice + 1 < e.cola.length) return nuevo({ indice: e.indice + 1, reproduciendo: true, posMs: 0 })
      // Se acabó la cola: se queda parada en la última, al principio
      return nuevo({ reproduciendo: false, posMs: 0 })
    }
    case 'anterior': {
      if (e.indice < 0) return e
      if (ahora > REINICIO_AL_VOLVER_MS || e.indice === 0) return nuevo({ posMs: 0 })
      return nuevo({ indice: e.indice - 1, reproduciendo: true, posMs: 0 })
    }
    case 'pausar':
      return e.indice < 0 || !e.reproduciendo ? e : nuevo({ reproduciendo: false, posMs: ahora })
    case 'reanudar':
      return e.indice < 0 || e.reproduciendo ? e : nuevo({ reproduciendo: true, posMs: ahora })
    case 'buscar':
      return e.indice < 0 || !Number.isFinite(a.posMs) ? e : nuevo({ posMs: Math.max(0, a.posMs) })
    case 'saltar':
      return e.indice < 0 || !Number.isFinite(a.ms) ? e : nuevo({ posMs: Math.max(0, ahora + a.ms) })
    case 'irA':
      return !Number.isInteger(a.indice) || a.indice < 0 || a.indice >= e.cola.length ? e : nuevo({ indice: a.indice, reproduciendo: true, posMs: 0 })
    case 'quitar': {
      const i = e.cola.findIndex((p) => p.id === a.id)
      if (i < 0) return e
      const cola = e.cola.filter((_, k) => k !== i)
      if (cola.length === 0) return nuevo({ cola, indice: -1, reproduciendo: false, posMs: 0 })
      if (i < e.indice) return nuevo({ cola, indice: e.indice - 1, posMs: ahora })
      if (i === e.indice) return nuevo({ cola, indice: Math.min(i, cola.length - 1), posMs: 0 })
      return nuevo({ cola, posMs: ahora })
    }
    case 'vaciar':
      return e.cola.length === 0 ? e : nuevo({ cola: [], indice: -1, reproduciendo: false, posMs: 0 })
  }
}

/** Un texto de duración para la barra: «3:07» o «1:02:15» */
export function textoDeDuracion(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
