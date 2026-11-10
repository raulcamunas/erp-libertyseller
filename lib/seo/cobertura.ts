/**
 * SEO · ¿ESTÁ ESTA BÚSQUEDA EN LA FICHA? PURO.
 *
 * Una búsqueda que vende tiene que aparecer en la ficha del producto para que Amazon la asocie: idealmente en el título, si no en los bullets o en las palabras clave ocultas (backend). Aquí se
 * comprueba, palabra a palabra, si TODAS las palabras con contenido de la búsqueda están en cada parte de la ficha.
 *
 * Tolerancias, para no dar por ausente lo que sí está: sin tildes ni mayúsculas, y con el plural sencillo del español y del inglés (jamonero/jamoneros, cuchillo/cuchillos, box/boxes). Las palabras
 * vacías («de», «para», «the»…) no cuentan: no hace falta que estén.
 */

const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'o', 'u', 'con', 'sin', 'para', 'por', 'en', 'un', 'una', 'unos', 'unas', 'a', 'al', 'the', 'of', 'and', 'for', 'with', 'to', 'in', 'on', 'an', 'or', 'et', 'le', 'les', 'des', 'du', 'pour', 'avec', 'der', 'die', 'das', 'und', 'mit', 'für', 'il', 'lo', 'gli', 'per'])

export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
}

/** La raíz sencilla de una palabra: quita el plural (-es, -s) para que «cuchillos» y «cuchillo» casen */
export function raiz(palabra: string): string {
  if (palabra.length > 4 && palabra.endsWith('es')) return palabra.slice(0, -2)
  if (palabra.length > 3 && palabra.endsWith('s')) return palabra.slice(0, -1)
  return palabra
}

/** Las palabras con contenido de un texto, ya en raíz */
export function palabras(texto: string): string[] {
  return normalizar(texto)
    .split(' ')
    .filter((p) => p && !VACIAS.has(p))
    .map(raiz)
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

/** ¿Están todas las palabras de la búsqueda en cada parte de la ficha? */
export function coberturaDe(consulta: string, ficha: TextosDeFicha): Cobertura {
  const buscadas = palabras(consulta)
  const conjunto = (t: string | null | undefined) => new Set(palabras(t ?? ''))
  const enTitulo = conjunto(ficha.titulo)
  const enBullets = conjunto(ficha.bullets.join(' '))
  const enBackend = conjunto(ficha.backend)
  const enDescripcion = conjunto(ficha.descripcion)
  const todas = (s: Set<string>) => buscadas.length > 0 && buscadas.every((p) => s.has(p))
  const enAlgunSitio = new Set([...enTitulo, ...enBullets, ...enBackend, ...enDescripcion])
  return { titulo: todas(enTitulo), bullets: todas(enBullets), backend: todas(enBackend), faltan: buscadas.filter((p) => !enAlgunSitio.has(p)) }
}

/** Los bytes que ocupa el backend: Amazon limita las palabras clave ocultas a 250 bytes (las tildes y la ñ cuentan doble) */
export function bytesDe(texto: string | null | undefined): number {
  return new TextEncoder().encode(texto ?? '').length
}

export const LIMITE_BACKEND_BYTES = 250
export const LIMITE_TITULO_CARACTERES = 200
