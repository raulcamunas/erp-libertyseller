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
}

const almacen = new AsyncLocalStorage<Rastro>()

/** Ejecuta `faena` apuntando cada llamada a Amazon. Con `ensayo: true`, las escrituras no salen */
export async function conRastro<T>(opciones: { ensayo?: boolean; propuestaId?: string | null }, faena: () => Promise<T>): Promise<{ salida: T; llamadas: LlamadaAds[] }> {
  const rastro: Rastro = { ensayo: Boolean(opciones.ensayo), llamadas: [], anotadas: 0, propuestaId: opciones.propuestaId ?? null }
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

/** PURO. ¿Esta llamada escribe en la cuenta? Las búsquedas de la v3 son POST a …/list, y pedir un informe no cambia nada de la cuenta */
export function esEscritura(metodo: string, ruta: string): boolean {
  const m = metodo.toUpperCase()
  if (m === 'GET' || m === 'HEAD') return false
  if (/\/list$/.test(ruta)) return false
  if (ruta.startsWith('/reporting/') || ruta.startsWith('/v2/profiles')) return false
  return true
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
