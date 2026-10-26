/**
 * LO QUE COBRA OPENAI POR CADA MODELO QUE USA EL ERP, Y CUÁNTO CUESTA UNA LLAMADA — PURO.
 * ========================================================================================
 * Se comprueba con precios.prueba.ts. Los precios son los de la página oficial de OpenAI (developers.openai.com/api/docs/pricing, tarifa estándar con contexto corto, leída
 * el 25 oct 2026), en dólares por MILLÓN de tokens. Si OpenAI los cambia, se cambian aquí: es el único sitio. Sirven para decir «esto cuesta unos 0,02 céntimos», que es lo que
 * enseñan las pantallas de calibrar; la factura de verdad es la de OpenAI (Sistema → «Gasto en IA»).
 *
 * LA CACHÉ. OpenAI cobra mucho menos (de un décimo a un cuarto) los tokens de entrada que ya vio hace poco con el mismo principio: casi todo el encargo de la IA (las
 * instrucciones) es igual de un mensaje a otro, así que con el equipo trabajando la mayor parte de la entrada va en caché. Una llamada se calcula con los tokens de entrada
 * (todos), los que iban en caché y los de salida (que incluyen lo que el modelo «piensa»).
 */

export interface PrecioDeModelo {
  /** Dólares por millón de tokens de entrada */
  entrada: number
  /** Dólares por millón de tokens de entrada que estaban en caché. null = el modelo no tiene tarifa de caché */
  cache: number | null
  /** Dólares por millón de tokens de salida */
  salida: number
}

export const PRECIOS_OFICIALES: Readonly<Record<string, PrecioDeModelo>> = {
  'gpt-6-astra': { entrada: 10, cache: 1, salida: 50 },
  'gpt-6.1-sol': { entrada: 2, cache: 0.1, salida: 10 },
  'gpt-6-sol': { entrada: 2, cache: 0.2, salida: 10 },
  'gpt-6-luna': { entrada: 0.1, cache: 0.01, salida: 0.5 },
  'gpt-5.6-sol': { entrada: 4, cache: 0.4, salida: 20 },
  'gpt-5.6-terra': { entrada: 2, cache: 0.2, salida: 12 },
  'gpt-5.6-luna': { entrada: 0.2, cache: 0.02, salida: 1.2 },
  'gpt-5.5': { entrada: 5, cache: 0.5, salida: 30 },
  'gpt-5.4': { entrada: 2.5, cache: 0.25, salida: 15 },
  'gpt-5.4-mini': { entrada: 0.75, cache: 0.075, salida: 4.5 },
  'gpt-5.4-nano': { entrada: 0.2, cache: 0.02, salida: 1.25 },
  'gpt-5-mini': { entrada: 0.25, cache: 0.025, salida: 2 },
  'gpt-5-nano': { entrada: 0.05, cache: 0.005, salida: 0.4 },
  'gpt-4.1': { entrada: 2, cache: 0.5, salida: 8 },
  'gpt-4.1-mini': { entrada: 0.4, cache: 0.1, salida: 1.6 },
  'gpt-4o': { entrada: 2.5, cache: 1.25, salida: 10 },
  'gpt-4o-mini': { entrada: 0.15, cache: 0.075, salida: 0.6 },
}

/** `gpt-5.6-terra-2026-03-01` y `gpt-5.6-terra` son el mismo modelo a efectos de precio */
export const sinFechaDeVersion = (modelo: string): string => modelo.trim().toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, '')

export function precioDe(modelo: string): PrecioDeModelo | null {
  return PRECIOS_OFICIALES[sinFechaDeVersion(modelo)] ?? null
}

export interface UsoDeTokens {
  /** Todos los tokens de entrada (incluidos los que iban en caché) */
  entrada: number
  salida: number
  /** De los de entrada, cuántos iban en caché. Sin dato, ninguno */
  cache?: number
}

/**
 * Dólares que ha costado una llamada, o null si no se conoce el precio del modelo o no hay tokens (antes que inventar). Con `cache` los tokens que iban en caché se cobran a la tarifa
 * de caché; sin ella, todos a tarifa completa (el peor caso).
 */
export function costeDeUso(modelo: string, uso: UsoDeTokens | null | undefined): number | null {
  const p = precioDe(modelo)
  if (!p || !uso) return null
  const enCache = Math.min(Math.max(uso.cache ?? 0, 0), uso.entrada)
  const tarifaDeCache = p.cache ?? p.entrada
  return ((uso.entrada - enCache) * p.entrada + enCache * tarifaDeCache + uso.salida * p.salida) / 1_000_000
}

/** Lo que costaría la misma llamada sin nada en caché (la primera tras un rato sin usar): el techo */
export const costeSinCache = (modelo: string, uso: UsoDeTokens | null | undefined): number | null => (uso ? costeDeUso(modelo, { entrada: uso.entrada, salida: uso.salida }) : null)

/** Un número de dólares, dicho para quien calibra: «0,014 céntimos», «0,24 céntimos», «1,2 céntimos», «3 céntimos» */
export function enCentimos(dolares: number | null | undefined): string {
  if (dolares === null || dolares === undefined || !Number.isFinite(dolares)) return 'coste desconocido'
  const c = dolares * 100
  const cifras = c < 0.1 ? 3 : c < 1 ? 2 : c < 10 ? 1 : 0
  return `${c.toLocaleString('es-ES', { minimumFractionDigits: cifras, maximumFractionDigits: cifras })} céntimos`
}

/* ------------------------------------------------------------------ */
/* Los modelos que se pueden elegir al calibrar                        */
/* ------------------------------------------------------------------ */

export interface ModeloElegible {
  id: string
  nombre: string
  /** Una frase para quien elige: para qué sirve */
  detalle: string
}

/**
 * Los modelos que ofrecen las pantallas de calibrar, del más barato al más capaz. Solo los que se han probado de verdad con el encargo de la IA del ERP (ver los comentarios de
 * lib/whatsapp/ia-generar.ts): un modelo que la API rechaza con la configuración elegida haría que la IA dejara de contestar a todo el equipo, y por eso la pantalla pide probar la
 * versión antes de publicarla.
 */
export const MODELOS_ELEGIBLES: readonly ModeloElegible[] = [
  { id: 'gpt-6-luna', nombre: 'luna', detalle: 'El más barato y rápido. Sin razonar escribe casi igual de bien que los caros.' },
  { id: 'gpt-6-sol', nombre: 'sol', detalle: 'Intermedio: la generación nueva, con la tarifa de terra.' },
  { id: 'gpt-5.6-terra', nombre: 'terra', detalle: 'El de «Redactar con IA» del correo: algo más natural en el trato, bastante más caro.' },
  { id: 'gpt-6-astra', nombre: 'astra', detalle: 'El más capaz y el más caro. Solo para ver hasta dónde llega.' },
]
