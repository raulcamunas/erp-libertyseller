/**
 * LA CARGA DE LA BASE DE DATOS Y QUÉ TRABAJO DE FONDO SE APLAZA CUANDO VA JUSTA.
 * ==============================================================================
 * Casi todo PURO: el reloj entra por parámetro y el único estado es un buzón de muestras en memoria. Se comprueba con presion.prueba.ts. Lo usa `tocaAhora` (lib/sistema/cron.ts), que
 * es por donde pasa cada ruta de cron antes de trabajar.
 *
 * POR QUÉ EXISTE. La base de datos del ERP es pequeña (una Nano de Supabase: 0,5 GB de memoria y 5 MB/s de disco una vez agotado el presupuesto de disco), y el 29 de octubre de 2026 se
 * quedó sin aire: con el disco agotado cada consulta tardaba segundos, y los procesos de fondo SEGUÍAN lanzándose cada minuto encima, así que la base no tenía forma de recuperarse (el
 * presupuesto de disco solo se rellena cuando lo que se le pide baja del nivel base). Tres procesos de Amazon son el 66 % de todo el trabajo automático de un día —el catálogo se relee
 * entero cada 15 minutos, y un solo barrido dura seis—, y ninguno miraba cómo estaba la base antes de empezar.
 *
 * QUÉ HACE. Cada vez que una ruta de cron pregunta «¿me toca?», la consulta que ya hacía se cronometra (no se añade ninguna). Con las últimas muestras de los últimos tres minutos se saca
 * un NIVEL DE PRESIÓN, y según la PRIORIDAD de cada proceso se decide si corre o espera:
 *
 *   · «esencial» (leer las llamadas, el correo y la agenda, mandar los seguimientos, los precios): corre SIEMPRE. Son ligeros y es lo que no se puede dejar de hacer.
 *   · «normal» (notas de Gemini, el ciclo comercial, la verificación de stock…): espera solo con presión CRÍTICA.
 *   · «baja» (leer el catálogo de Amazon, los trabajos de plataforma, el auditor de stock…): espera con presión ALTA o CRÍTICA. Para que no se quede sin correr horas (una vez cada
 *     tanto un catálogo que no se relee es un problema), con presión ALTA —nunca crítica— corre igualmente si lleva más de `ayunoMaxMin` sin hacerlo.
 *
 * Y UNA PESADA A LA VEZ. Los procesos que duran minutos (el catálogo, el auditor, los trabajos, el cumplimiento) no empiezan si hay otro de ellos en marcha: antes podían coincidir los
 * cuatro y sumar su carga justo en los peores minutos. Esperan al siguiente minuto, nada más.
 *
 * ANTE LA DUDA, SE EJECUTA. Sin muestras (el contenedor acaba de arrancar) la presión es normal, y todo lo que falle al medir deja correr: el guardián de que las cosas corran no puede ser
 * lo que las pare. Lo único que se aplaza es trabajo que se recupera solo en la pasada siguiente.
 */

export type NivelDePresion = 'normal' | 'alta' | 'critica'
export type PrioridadDeTarea = 'esencial' | 'normal' | 'baja'

export interface Muestra {
  /** Cuándo se midió, en ms */
  at: number
  /** Lo que tardó la consulta del guardián, en ms */
  ms: number
  /** Si falló o se agotó el tiempo (la base no contestó) */
  fallo: boolean
}

/** Solo cuentan las muestras de los últimos tres minutos: cuando la base se recupera, la presión baja sola al hacerse viejas */
export const VENTANA_DE_MUESTRAS_MS = 3 * 60_000
/** Una consulta pequeña del guardián que tarda esto o más es «lenta»: normalmente son décimas de segundo */
export const UMBRAL_LENTO_MS = 2_500
/** … y esto o más, «muy lenta» */
export const UMBRAL_MUY_LENTO_MS = 6_000
/** El guardián no espera a la base más de esto: pasado el tiempo, la muestra cuenta como fallo */
export const TIEMPO_MAXIMO_DE_MUESTRA_MS = 8_000
const MAX_MUESTRAS = 80

/**
 * El nivel de presión que dicen unas muestras. Hacen falta VARIAS muestras malas, no una: un bache suelto de una consulta no cambia nada. Con unas 15 muestras por minuto (cada ruta de
 * cron hace una al entrar), tres lentas en tres minutos son un bache de verdad.
 */
export function nivelDePresion(muestras: readonly Muestra[], ahora: number): NivelDePresion {
  const vivas = muestras.filter((m) => ahora - m.at <= VENTANA_DE_MUESTRAS_MS)
  const n = vivas.length
  if (n === 0) return 'normal'
  const fallos = vivas.filter((m) => m.fallo).length
  const lentas = vivas.filter((m) => m.fallo || m.ms >= UMBRAL_LENTO_MS).length
  const muyLentas = vivas.filter((m) => m.fallo || m.ms >= UMBRAL_MUY_LENTO_MS).length
  if (fallos >= 2 || muyLentas >= 3 || (n >= 4 && muyLentas * 2 >= n)) return 'critica'
  if (fallos >= 1 || lentas >= 3 || (n >= 4 && lentas * 2 >= n)) return 'alta'
  return 'normal'
}

export interface Veredicto {
  corre: boolean
  /** Para el registro del contenedor y la pantalla de Sistema. Null cuando corre */
  motivo: string | null
}

/**
 * ¿Corre este proceso con esta presión? `sinCorrerMin` son los minutos desde que arrancó por última vez; `ayunoMaxMin`, a partir de cuántos un proceso de prioridad baja corre aunque la
 * presión sea alta (con la crítica, nunca).
 */
export function decidirPorPresion(prioridad: PrioridadDeTarea, nivel: NivelDePresion, sinCorrerMin: number, ayunoMaxMin: number): Veredicto {
  if (prioridad === 'esencial' || nivel === 'normal') return { corre: true, motivo: null }
  if (nivel === 'critica') return { corre: false, motivo: 'la base de datos casi no contesta (presión crítica): se aplaza' }
  // Presión alta: solo se aplaza lo de prioridad baja, y no más de `ayunoMaxMin`
  if (prioridad === 'baja' && sinCorrerMin < ayunoMaxMin) return { corre: false, motivo: 'la base de datos va lenta (presión alta): se aplaza' }
  return { corre: true, motivo: null }
}

/**
 * Si hay otro proceso pesado en marcha, su nombre; si no, null. `enMarcha` guarda cuándo arrancó cada uno. Uno que lleva más de `topeMs` sin terminar se da por muerto (el contenedor
 * se reinició o se quedó colgado) y no bloquea a nadie: este freno no puede dejar a los demás sin correr por una pasada que ya no existe.
 */
export function otraPesadaEnMarcha(enMarcha: ReadonlyMap<string, number>, tarea: string, esPesada: (tarea: string) => boolean, ahora: number, topeMs: number): string | null {
  for (const [otra, desde] of enMarcha) {
    if (otra !== tarea && esPesada(otra) && ahora - desde < topeMs) return otra
  }
  return null
}

/* ------------------------------------------------------------------ */
/* El buzón de muestras (en memoria: el servidor es un solo proceso)   */
/* ------------------------------------------------------------------ */

const buzon: Muestra[] = []

/** Apunta cuánto tardó la consulta del guardián. Se queda con las últimas y tira las viejas */
export function anotarMuestra(ms: number, fallo: boolean, ahora: number = Date.now()): void {
  buzon.push({ at: ahora, ms: Math.max(0, Math.round(ms)), fallo })
  const corte = ahora - VENTANA_DE_MUESTRAS_MS
  while (buzon.length > 0 && (buzon[0].at < corte || buzon.length > MAX_MUESTRAS)) buzon.shift()
}

export interface EstadoDePresion {
  nivel: NivelDePresion
  /** Muestras vivas (de los últimos tres minutos) */
  muestras: number
  fallos: number
  /** La mediana de lo que tardó la consulta del guardián, o null sin muestras */
  medianaMs: number | null
}

export function estadoDeLaPresion(ahora: number = Date.now()): EstadoDePresion {
  const vivas = buzon.filter((m) => ahora - m.at <= VENTANA_DE_MUESTRAS_MS)
  const ordenadas = vivas.map((m) => m.ms).sort((a, b) => a - b)
  return {
    nivel: nivelDePresion(buzon, ahora),
    muestras: vivas.length,
    fallos: vivas.filter((m) => m.fallo).length,
    medianaMs: ordenadas.length > 0 ? ordenadas[Math.floor(ordenadas.length / 2)] : null,
  }
}

/** Para las pruebas */
export function vaciarMuestras(): void {
  buzon.length = 0
}
