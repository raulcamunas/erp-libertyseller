/**
 * SEO · ¿ESTÁ ESTA BÚSQUEDA EN LA FICHA? PURO.
 *
 * Una búsqueda que vende tiene que aparecer en la ficha del producto para que Amazon la asocie: idealmente en el título, si no en los bullets o en las palabras clave ocultas (backend). Aquí se
 * comprueba, palabra a palabra, si TODAS las palabras con contenido de la búsqueda están en cada parte de la ficha.
 *
 * Tolerancias, para no dar por ausente lo que sí está: sin tildes ni mayúsculas, y con el plural sencillo del español y del inglés (jamonero/jamoneros, cuchillo/cuchillos, box/boxes). Las palabras
 * vacías («de», «para», «the»…) no cuentan: no hace falta que estén.
 */

// Palabras vacías: no hace falta que estén en la ficha. Se añadieron las más comunes del español de las viñetas («que», «su», «es»…): sin ellas salían como palabra «nueva» al comparar
// una propuesta con la ficha
const VACIAS = new Set(['que', 'su', 'sus', 'es', 'se', 'tu', 'tus', 'muy', 'mas', 'como', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'nos', 'les', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'o', 'u', 'con', 'sin', 'para', 'por', 'en', 'un', 'una', 'unos', 'unas', 'a', 'al', 'the', 'of', 'and', 'for', 'with', 'to', 'in', 'on', 'an', 'or', 'et', 'le', 'les', 'des', 'du', 'pour', 'avec', 'der', 'die', 'das', 'und', 'mit', 'für', 'il', 'lo', 'gli', 'per'])

export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
}

/**
 * La raíz sencilla de una palabra, para que el singular y el plural casen: quita una «s» final (no la de «ss»: glass) y después una «e» final.
 *
 * Por qué así y no «quitar -es»: en español el plural de lo que acaba en vocal es +s (cable → cables, llave → llaves, soporte → soportes) y el de lo que acaba en consonante es +es (jamón →
 * jamones). Quitando solo «-es» salía «cabl» para «cables» y «cable» para «cable»: no casaban y la pantalla decía que faltaba una palabra que SÍ estaba en la ficha. Quitando «s» y luego «e» las
 * dos formas acaban igual (cabl/cabl, jamon/jamon, box/box). Es una clave interna: a la persona se le enseña siempre la palabra tal cual (ver `tokens`).
 */
export function raiz(palabra: string): string {
  let p = palabra
  if (p.length > 3 && p.endsWith('s') && !p.endsWith('ss')) p = p.slice(0, -1)
  if (p.length > 3 && p.endsWith('e')) p = p.slice(0, -1)
  return p
}

/** Las palabras con contenido de un texto, ya en raíz */
export function palabras(texto: string): string[] {
  return tokens(texto).map((t) => t.raiz)
}

/** Las palabras con contenido, con su forma legible (sin tildes ni mayúsculas) y su raíz: la raíz para comparar, la forma para enseñarla */
export function tokens(texto: string): Array<{ forma: string; raiz: string }> {
  return normalizar(texto)
    .split(' ')
    .filter((p) => p && !VACIAS.has(p))
    .map((forma) => ({ forma, raiz: raiz(forma) }))
}

export interface Cobertura {
  titulo: boolean
  bullets: boolean
  backend: boolean
  /** Lo que falta de la búsqueda en TODA la ficha (vacío = está entera en algún sitio) */
  faltan: string[]
}

export interface TextosDeFicha {
  titulo: string | null
  bullets: readonly string[]
  descripcion: string | null
  backend: string | null
}

/** ¿Están todas las palabras de la búsqueda en cada parte de la ficha? Lo que falta se devuelve con su forma legible («cables», no la raíz «cabl») */
export function coberturaDe(consulta: string, ficha: TextosDeFicha): Cobertura {
  const buscadas = tokens(consulta)
  const conjunto = (t: string | null | undefined) => new Set(palabras(t ?? ''))
  const enTitulo = conjunto(ficha.titulo)
  const enBullets = conjunto(ficha.bullets.join(' '))
  const enBackend = conjunto(ficha.backend)
  const enDescripcion = conjunto(ficha.descripcion)
  const todas = (s: Set<string>) => buscadas.length > 0 && buscadas.every((p) => s.has(p.raiz))
  const enAlgunSitio = new Set([...enTitulo, ...enBullets, ...enBackend, ...enDescripcion])
  const faltan = [...new Map(buscadas.filter((p) => !enAlgunSitio.has(p.raiz)).map((p) => [p.raiz, p.forma])).values()]
  return { titulo: todas(enTitulo), bullets: todas(enBullets), backend: todas(enBackend), faltan }
}

/** Los bytes que ocupa un texto en UTF-8: Amazon mide el backend y las viñetas en bytes (las tildes y la ñ cuentan doble) */
export function bytesDe(texto: string | null | undefined): number {
  return new TextEncoder().encode(texto ?? '').length
}

/** Los caracteres de un texto como los cuenta una persona (una tilde o un emoji es uno), que es como Amazon mide el título y los Item Highlights */
export function caracteresDe(texto: string | null | undefined): number {
  return [...(texto ?? '')].length
}

/*
 * LOS LÍMITES DE 2026 (SOP de la agencia, skill «seo-listing-amazon»). Antes aquí ponía 200 caracteres de título y 250 bytes de backend, que eran las reglas viejas: con ellas la pantalla daba por
 * buenos títulos que Amazon ya reescribe con su IA.
 *   · Título: 75 caracteres en todas las categorías salvo media (libros, música, vídeo). Fuera de norma, Amazon lo reescribe y se pierde el control del posicionamiento.
 *   · Item Highlights: 125 caracteres; se indexa igual que el título.
 *   · Viñetas (bullets): 1.000 bytes sumando las cinco (unos 200 cada una).
 *   · Backend: 249 bytes; UN byte de más y Amazon ignora el campo entero.
 */
export const LIMITE_TITULO_CARACTERES = 75
export const LIMITE_HIGHLIGHTS_CARACTERES = 125
export const LIMITE_BULLETS_BYTES = 1000
export const LIMITE_BACKEND_BYTES = 249
