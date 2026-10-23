/**
 * QUÉ LLAMADAS SE TRANSCRIBEN, CUÁNTO SE ESPERA ENTRE INTENTOS Y QUÉ PISTAS SE LE DAN AL OÍDO DE LA IA.
 * =======================================================================================================
 * PURO: no toca la base ni la red. Se comprueba con reglas.prueba.ts.
 *
 * El gasto de transcribir es casi todo el AUDIO que se manda (unos 0,0045 $ por minuto), así que las reglas de aquí son las que lo
 * mantienen barato sin perder nada útil: solo se paga por lo que tiene una conversación dentro, y se paga una sola vez.
 *
 *   · Solo llamadas contestadas que duran lo suficiente (20 s por defecto): por debajo es un buzón de voz, un cuelgue o un «no está».
 *   · Solo con grabación disponible y enlazadas con un lead: sin lead no hay ficha donde dejar el resumen. Si el enlace llega más tarde
 *     (el lead se crea después de la llamada), la llamada entra entonces.
 *   · Una transcripción que ya se hizo NO se repite jamás, ni aunque falle el resumen que viene después: se guarda al instante.
 *   · Si lo transcrito es casi nada (silencio, ruido, un «¿sí?» y colgar), no se llama a la IA de texto.
 */

import type { InteresDeLlamada } from './tipos'

/** Por debajo de esto una llamada «contestada» no se transcribe. Se puede cambiar en la fila de ajustes (migración 244) */
export const SEGUNDOS_MINIMOS = 20

/** Con menos palabras que éstas no hay una conversación que resumir (un «¿diga? … no, perdone» y colgar) */
export const PALABRAS_MINIMAS = 12

/** Veces que se intenta una llamada antes de darla por perdida. El SQL (migración 244) usa el mismo número */
export const INTENTOS_MAXIMOS = 3

/** Lo que admite OpenAI por archivo son 25 MB; se deja un margen */
export const BYTES_MAXIMOS = 24 * 1024 * 1024

/**
 * LOS MODELOS. Se pueden cambiar en el servidor sin tocar código (TRANSCRIPCION_MODELO_VOZ y TRANSCRIPCION_MODELO_RESUMEN).
 *
 * VOZ: `gpt-transcribe` (0,0045 $/min). Los demás de OpenAI (whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe y la versión con
 * voces) se APAGAN el 26 feb 2027 según su página de retirada de modelos, y éste es el que recomiendan en su lugar: el mini es 1,35 $
 * al mes más barato con las llamadas de hoy, pero habría que rehacer esto en cuatro meses. Probado el 23 oct 2026 con una llamada
 * inventada de 73 s: lo transcribió entera en 5 s, sin errores salvo los nombres propios, que acierta si se le dan como palabras clave.
 * Con 45 s de puro ruido devuelve vacío (no se inventa texto). NO da marcas de tiempo ni quién habla: eso lo deduce el resumen.
 *
 * TEXTO: `gpt-6-luna` (0,10 / 0,50 $ por millón de tokens, el más barato de la familia): 0,0003 $ por resumen. Con los tres tipos de
 * llamada de la prueba (con interés, buzón de voz y rechazo) dio resultados tan buenos como `gpt-5.6-luna`, al doble de precio.
 */
export const MODELO_DE_VOZ_POR_DEFECTO = 'gpt-transcribe'
export const MODELO_DE_RESUMEN_POR_DEFECTO = 'gpt-6-luna'

/* ------------------------------------------------------------------ */
/* Cuándo reintentar                                                   */
/* ------------------------------------------------------------------ */

const ESPERAS_TRAS_FALLO_MS = [3 * 60_000, 20 * 60_000]

/**
 * Cuánto esperar antes de volver a intentar una llamada que ha fallado `intentosHechos` veces, o null si ya no se vuelve a intentar.
 * Escalonado (3 min, 20 min) porque lo normal es un tropiezo de Rinkel o de OpenAI que se arregla solo, y no se quiere ni martillear
 * al proveedor ni dejar una llamada sin resumen horas por un fallo de un minuto.
 */
export function esperaTrasFallo(intentosHechos: number): number | null {
  if (intentosHechos >= INTENTOS_MAXIMOS) return null
  return ESPERAS_TRAS_FALLO_MS[Math.max(0, intentosHechos - 1)] ?? ESPERAS_TRAS_FALLO_MS[ESPERAS_TRAS_FALLO_MS.length - 1]
}

/* ------------------------------------------------------------------ */
/* ¿Hay algo que resumir?                                              */
/* ------------------------------------------------------------------ */

export function palabrasDe(texto: string): number {
  const t = texto.trim()
  return t === '' ? 0 : t.split(/\s+/).length
}

/** ¿Lo transcrito es tan poco que no merece pagar un resumen? (Vacío, un saludo y colgar, un «¿sí? ¿diga?») */
export function sinContenido(transcripcion: string): boolean {
  return palabrasDe(transcripcion) < PALABRAS_MINIMAS
}

/* ------------------------------------------------------------------ */
/* Las pistas para el oído de la IA                                    */
/* ------------------------------------------------------------------ */

const sinSaltos = (s: string) => s.replace(/[<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim()

/** «Maoli García Pérez» -> «Maoli». Solo el nombre de pila va a la IA */
export function primerNombre(nombreCompleto: string | null | undefined): string | null {
  const limpio = sinSaltos(nombreCompleto ?? '')
  if (!limpio) return null
  return limpio.split(' ')[0] || null
}

export interface PistasDeVoz {
  /** Contexto en una frase: de qué va la llamada y quién habla. Ayuda a acertar jerga y nombres */
  prompt: string
  /** Palabras que se espera oír, en una sola línea separadas por comas: la marca, Amazon y el nombre de la tienda a la que se llama */
  palabras: string
}

/**
 * Lo que se le dice al oído de la IA sobre esta llamada. Con el nombre de la tienda como palabra clave acierta «Joe Black Pets» (sin
 * ella oyó «Yo Black Pets»), y con «Liberty Seller» acierta la marca (sin ella oyó «delivery seller»). Son pistas, no obligaciones: no
 * aparecen en el texto si no se dijeron (probado con 45 s de ruido).
 *
 * La API RECHAZA la petición entera si una palabra lleva `<`, `>` o un salto de línea: aquí se limpian todas.
 */
export function pistasDeLaLlamada(datos: { empresa: string | null; comercial: string | null }): PistasDeVoz {
  const empresa = sinSaltos((datos.empresa ?? '').replace(/,/g, ' ')).slice(0, 60)
  const comercial = primerNombre(datos.comercial)
  const palabras = ['Liberty Seller', 'Amazon', empresa].filter((p) => p !== '')
  const prompt = `Llamada de teléfono entre ${comercial ? `${comercial}, comercial` : 'un comercial'} de Liberty Seller, una agencia que ayuda a vender en Amazon, y ${empresa ? `la empresa ${empresa}` : 'una empresa'}.`
  return { prompt: prompt.slice(0, 300), palabras: [...new Set(palabras)].join(', ') }
}

/* ------------------------------------------------------------------ */
/* Lo que sale en pantalla                                             */
/* ------------------------------------------------------------------ */

export const COLOR_DE_INTERES: Record<InteresDeLlamada, 'verde' | 'ambar' | 'gris' | 'rojo'> = {
  alto: 'verde',
  medio: 'ambar',
  bajo: 'gris',
  ninguno: 'rojo',
  no_claro: 'gris',
}
