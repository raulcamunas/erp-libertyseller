/**
 * LOS AJUSTES DE TU VOZ — PURO. Lo que cada persona decide de su micrófono y se guarda en su navegador (nadie más lo ve): cuánto sube o baja el volumen, y una PUERTA DE RUIDO que deja pasar
 * la voz y corta lo que esté por debajo de un nivel (teclado, ventilador, la tele de fondo). La sensibilidad es de 0 a 100: 0 = muy sensible (se corta solo el silencio casi total), 100 = poco sensible
 * (hay que hablar fuerte para que se te oiga). Los niveles se miden en decibelios respecto al máximo (0 dB = lo más alto posible; la voz normal anda entre −40 y −15, el ruido de fondo, por debajo de −55).
 * El procesado de verdad (lib/chat/voz-procesador.ts) usa estas funciones; aquí no hay audio. Se comprueba en voz-ajustes.prueba.ts.
 */

export interface AjustesDeVoz {
  /** El volumen de tu micrófono, de 0 a 200 (100 = sin tocar) */
  volumen: number
  /** Si se corta lo que esté por debajo del umbral */
  puerta: boolean
  /** La sensibilidad de la puerta, de 0 (muy sensible) a 100 (poco sensible) */
  umbral: number
}

export const AJUSTES_DE_VOZ_POR_DEFECTO: AjustesDeVoz = { volumen: 100, puerta: false, umbral: 45 }
export const CLAVE_DE_VOZ = 'chat:voz'

export const DB_MINIMO = -90
export const DB_MAXIMO = -20
/** Cuánto sigue abierta la puerta tras la última vez que se superó el umbral: sin esto se cortarían las pausas entre palabras y el final de las frases */
export const RETENCION_DE_PUERTA_MS = 250

const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const numero = (v: unknown, porDefecto: number, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? limitar(Math.round(v), min, max) : porDefecto)

/** Lo leído del almacenamiento, limpio: lo que falte, esté roto o fuera de rango vuelve al valor de siempre o se recorta */
export function limpiarAjustesDeVoz(bruto: unknown): AjustesDeVoz {
  const d = AJUSTES_DE_VOZ_POR_DEFECTO
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return { ...d }
  const b = bruto as Record<string, unknown>
  return { volumen: numero(b.volumen, d.volumen, 0, 200), puerta: typeof b.puerta === 'boolean' ? b.puerta : d.puerta, umbral: numero(b.umbral, d.umbral, 0, 100) }
}

export function leerAjustesDeVoz(texto: string | null | undefined): AjustesDeVoz {
  if (!texto) return { ...AJUSTES_DE_VOZ_POR_DEFECTO }
  try {
    return limpiarAjustesDeVoz(JSON.parse(texto))
  } catch {
    return { ...AJUSTES_DE_VOZ_POR_DEFECTO }
  }
}

/** De la sensibilidad (0–100) al nivel de decibelios por debajo del cual se corta */
export const umbralADb = (umbral: number): number => DB_MINIMO + (limitar(umbral, 0, 100) / 100) * (DB_MAXIMO - DB_MINIMO)
/** Y al revés: de un nivel en decibelios a la posición en el deslizador (para dibujar la marca en el medidor) */
export const dbAUmbral = (db: number): number => ((limitar(db, DB_MINIMO, DB_MAXIMO) - DB_MINIMO) / (DB_MAXIMO - DB_MINIMO)) * 100

/** El nivel de una señal en decibelios (de −100 a 0) a partir de su valor eficaz (0 a 1) */
export function nivelEnDb(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 1e-5) return -100
  return limitar(20 * Math.log10(rms), -100, 0)
}

/** El nivel de decibelios como posición en un medidor de 0 (vacío) a 100 (lleno), de −90 dB a 0 dB */
export const dbAMedidor = (db: number): number => ((limitar(db, DB_MINIMO, 0) - DB_MINIMO) / (0 - DB_MINIMO)) * 100

/** La ganancia de la señal (1 = sin tocar) para un volumen de 0 a 200 */
export const ganancia = (volumen: number): number => limitar(volumen, 0, 200) / 100

/** ¿Hace falta meter el procesador en el micrófono? Solo si se ha tocado el volumen o se usa la puerta: con los valores de fábrica, el audio va directo y sin tocar */
export const necesitaProcesador = (a: AjustesDeVoz): boolean => a.volumen !== 100 || a.puerta

/**
 * La puerta de ruido: abre al instante en cuanto el nivel llega al umbral, y cierra cuando lleva más de `retencionMs` por debajo. Devuelve si queda abierta y cuándo fue la última vez que se superó.
 */
export function decidirPuerta(p: { nivelDb: number; umbralDb: number; abierta: boolean; ultimoSobreMs: number; ahoraMs: number; retencionMs?: number }): { abierta: boolean; ultimoSobreMs: number } {
  const retencion = p.retencionMs ?? RETENCION_DE_PUERTA_MS
  if (p.nivelDb >= p.umbralDb) return { abierta: true, ultimoSobreMs: p.ahoraMs }
  if (p.abierta && p.ahoraMs - p.ultimoSobreMs <= retencion) return { abierta: true, ultimoSobreMs: p.ultimoSobreMs }
  return { abierta: false, ultimoSobreMs: p.ultimoSobreMs }
}
