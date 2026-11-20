/**
 * AMAZON ADS · EL RASTRO DE LAS LLAMADAS QUE ESCRIBEN Y EL MODO ENSAYO. SOLO SERVIDOR.
 *
 * Quien aplica un cambio (el motor, un cambio a mano) abre un «rastro» con `conRastro()`. Mientras dura, `llamarAds` (datos.ts) apunta aquí cada llamada:
 * método, ruta, cuerpo, código HTTP, request id de Amazon y la respuesta (recortada). Así el log guarda la petición y la respuesta de verdad sin cambiar la firma
 * de las veinte funciones de escritura.
 *
 * EN ENSAYO, las llamadas que ESCRIBEN no salen: `llamarAds` devuelve una respuesta simulada con la forma de la v3 (todo «success») y apunta lo que habría
 * mandado. Las LECTURAS sí salen (leer la puja actual, los grupos…): un ensayo valida contra la cuenta real todo lo que se puede validar sin tocarla.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export interface LlamadaAds {
  metodo: string
  ruta: string
  cuerpo: unknown
  status: number | null
  requestId: string | null
  respuesta: unknown
  simulada: boolean
  ms: number
}

interface Rastro {
  ensayo: boolean
  llamadas: LlamadaAds[]
  /** Cuántas llamadas ya se han llevado al log (cada entrada se queda con las suyas, no con todas las anteriores) */
  anotadas: number
  /** La propuesta del motor que se está aplicando, si la hay: cada entrada del log de este rastro la lleva */
  propuestaId: string | null
  /** Quién aplica: 'agente' = el agente PPC (las entradas «automaticas» de este rastro se apuntan como suyas) */
  origen: 'agente' | null
}

const almacen = new AsyncLocalStorage<Rastro>()

/** Ejecuta `faena` apuntando cada llamada a Amazon. Con `ensayo: true`, las escrituras no salen */
export async function conRastro<T>(opciones: { ensayo?: boolean; propuestaId?: string | null; origen?: 'agente' | null }, faena: () => Promise<T>): Promise<{ salida: T; llamadas: LlamadaAds[] }> {
  const rastro: Rastro = { ensayo: Boolean(opciones.ensayo), llamadas: [], anotadas: 0, propuestaId: opciones.propuestaId ?? null, origen: opciones.origen ?? null }
  const salida = await almacen.run(rastro, faena)
  return { salida, llamadas: rastro.llamadas }
}

/** Ejecuta `faena` dentro del rastro abierto o, si no hay ninguno, en uno nuevo (para los cambios a mano: cada uno deja su petición y su respuesta en el log) */
export async function enRastro<T>(faena: () => Promise<T>): Promise<T> {
  if (almacen.getStore()) return faena()
  return (await conRastro({}, faena)).salida
}

/** Las llamadas que todavía no se han llevado al log, y las marca como llevadas */
export function tomarLlamadasNuevas(): LlamadaAds[] {
  const r = almacen.getStore()
  if (!r) return []
  const nuevas = r.llamadas.slice(r.anotadas)
  r.anotadas = r.llamadas.length
  return nuevas
}

export function propuestaDelRastro(): string | null {
  return almacen.getStore()?.propuestaId ?? null
}

/** 'agente' si el rastro abierto es del agente PPC */
export function origenDelRastro(): 'agente' | null {
  return almacen.getStore()?.origen ?? null
}

/** Las llamadas apuntadas hasta ahora en el rastro abierto (para el log de un fallo a mitad) */
export function llamadasDelRastro(): LlamadaAds[] {
  return almacen.getStore()?.llamadas ?? []
}

export function enEnsayo(): boolean {
  return almacen.getStore()?.ensayo === true
}

export function apuntarLlamada(l: LlamadaAds): void {
  const r = almacen.getStore()
  if (r) r.llamadas.push(l)
}

/**
 * PURO. ¿Esta llamada escribe en la cuenta? Las búsquedas de la v3 son POST a …/list, pedir un informe no cambia nada de la cuenta, y leer el uso del presupuesto
 * (POST /sp/campaigns/budget/usage, el agente PPC) tampoco.
 */
export function esEscritura(metodo: string, ruta: string): boolean {
  const m = metodo.toUpperCase()
  if (m === 'GET' || m === 'HEAD') return false
  if (/\/list$/.test(ruta)) return false
  if (/\/budget\/usage$/.test(ruta)) return false
  if (ruta.startsWith('/reporting/') || ruta.startsWith('/v2/profiles')) return false
  return true
}

/** Intentos de una llamada a Amazon Ads como mucho (el primero y dos reintentos) */
export const INTENTOS_ADS = 3
/** Lo que se espera, sumando todos los reintentos de UNA llamada: la pasada del agente dura 240 s y no puede irse en esperas */
export const ESPERA_REINTENTOS_MAX_MS = 8_000
/** Un Retry-After de Amazon se respeta hasta esto; si pide más, se espera esto y el siguiente intento dirá */
const RETRY_AFTER_MAX_MS = 5_000

/**
 * PURO. ¿Se repite una llamada a Amazon Ads que ha fallado? `estado` = el código HTTP, o null si no hubo respuesta (red caída).
 *   429                  sí, en CUALQUIER método: Amazon lo rechaza antes de aplicar nada, así que repetir una escritura no la duplica.
 *   5xx o red caída      solo si NO escribe (una lectura o un …/list): una escritura que falla así PUEDE haber llegado, y repetirla a ciegas la duplicaría o
 *                        pisaría lo que haya; la siguiente pasada relee Amazon antes de repetirla.
 *   tiempo agotado       no: ya se han esperado los ESPERA_JSON_MS enteros y otro intento se comería la pasada (`porTiempo`).
 *   lo demás (4xx)       no: es de los datos o de la autorización, y repetir da lo mismo.
 */
export function debeReintentarAds(metodo: string, ruta: string, estado: number | null, porTiempo = false): boolean {
  if (estado === 429) return true
  if (esEscritura(metodo, ruta)) return false
  if (estado === null) return !porTiempo
  return estado >= 500
}

/**
 * PURO. Cuánto esperar antes del intento `intento + 1` (`intento` empieza en 1): lo que diga Retry-After (segundos o fecha HTTP), con tope de 5 s; si no lo dice,
 * 1 s y luego 2 s, con un poco de azar (`azar` en [0, 1)) para que dos llamadas que chocaron no vuelvan a chocar a la vez
 */
export function esperaDeReintento(intento: number, retryAfter: string | null, ahora: number, azar: number): number {
  if (retryAfter) {
    const seg = Number(retryAfter)
    const ms = Number.isFinite(seg) ? seg * 1000 : Date.parse(retryAfter) - ahora
    if (Number.isFinite(ms) && ms >= 0) return Math.min(RETRY_AFTER_MAX_MS, Math.round(ms))
  }
  const base = intento <= 1 ? 1_000 : 2_000
  return Math.round(base + base * 0.25 * Math.min(Math.max(azar, 0), 1))
}

/** Las listas de la v3 y el nombre de su id, para la respuesta simulada */
const LISTAS: Array<[string, string]> = [
  ['campaigns', 'campaignId'],
  ['adGroups', 'adGroupId'],
  ['productAds', 'adId'],
  ['keywords', 'keywordId'],
  ['negativeKeywords', 'negativeKeywordId'],
  ['campaignNegativeKeywords', 'campaignNegativeKeywordId'],
  ['targetingClauses', 'targetId'],
  ['negativeTargetingClauses', 'targetId'],
  ['campaignNegativeTargetingClauses', 'targetId'],
]

/** PURO. Una respuesta de éxito con la forma de la v3 (multi-status): una entrada por elemento pedido, con un id «ENSAYO-…» */
export function respuestaSimulada(cuerpo: unknown): Record<string, unknown> {
  const pedido = (cuerpo ?? {}) as Record<string, unknown>
  const salida: Record<string, unknown> = {}
  for (const [lista, campoId] of LISTAS) {
    const elementos = Array.isArray(pedido[lista]) ? (pedido[lista] as unknown[]).length : 1
    salida[lista] = {
      success: Array.from({ length: Math.max(1, elementos) }, (_, index) => ({ index, [campoId]: `ENSAYO-${index + 1}` })),
      error: [],
    }
  }
  return salida
}

/** PURO. Recorta una respuesta para guardarla en el log (jsonb): como mucho ~4 KB */
export function recortarParaLog(v: unknown, max = 4000): unknown {
  if (v == null) return null
  const texto = typeof v === 'string' ? v : JSON.stringify(v)
  if (texto.length <= max) {
    if (typeof v === 'string') {
      try {
        return JSON.parse(v)
      } catch {
        return { texto: v }
      }
    }
    return v
  }
  return { recortado: true, texto: texto.slice(0, max) }
}
