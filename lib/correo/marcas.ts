import { tonoEstable } from '@/components/ui-ls/utilidades'
import type { TonoEstado } from '@/lib/estilo/denso'

/**
 * LA MARCA DE CADA BUZÓN: SU COLOR Y SU NOMBRE CORTO.
 * ===================================================
 * PURO (sin React). Se comprueba con marcas.prueba.ts.
 *
 * Cada buzón tiene un color de la paleta de gráficos (--viz-1..6) que sale siempre igual para la misma dirección, en cualquier pantalla y en
 * los dos temas: el punto de 8 px de la barra, el filo de 3 px de la bandeja unificada, el minipunto del avatar y el anillo del avatar del
 * buzón. El reparto lo hace `tonoEstable` del kit (el mismo que colorea los avatares) y aquí se pasa de sus 8 tonos a los 6 huecos de la paleta.
 */

/** Los dominios de la empresa: un buzón de aquí se enseña sin dominio («stock@») */
export const DOMINIOS_PROPIOS: readonly string[] = ['libertyseller.es', 'libertyseller.com']

/** De los 8 tonos del kit a los 6 huecos de la paleta (1 azul, 2 naranja, 3 aqua, 4 violeta, 5 magenta, 6 ámbar). Si el kit añade un tono, aquí no compila */
const HUECO_DE_TONO: Record<TonoEstado, 1 | 2 | 3 | 4 | 5 | 6> = {
  azul: 1,
  naranja: 2,
  rojo: 2,
  cian: 3,
  verde: 3,
  violeta: 4,
  magenta: 5,
  ambar: 6,
  // tonoEstable no lo da nunca para un avatar; está para que la tabla cubra todos los tonos
  gris: 1,
}

const limpia = (direccion: string | null | undefined) => (direccion ?? '').trim().toLowerCase()

/** El hueco de la paleta (1 a 6) de un buzón. Estable: la misma dirección (sin mirar mayúsculas ni espacios) da siempre el mismo */
export function huecoDeBuzon(direccion: string | null | undefined): 1 | 2 | 3 | 4 | 5 | 6 {
  return HUECO_DE_TONO[tonoEstable(limpia(direccion))] ?? 1
}

/** El color de un buzón, listo para `style`: 'var(--viz-3)' */
export function colorDeBuzon(direccion: string | null | undefined): string {
  return `var(--viz-${huecoDeBuzon(direccion)})`
}

/**
 * La dirección para la barra, lo más corta que se entienda: «stock@» si es de la empresa y la dirección entera si no («ana@gmail.com»).
 * `dominioPropio` cambia qué cuenta como de la empresa (uno o varios dominios); sin él, DOMINIOS_PROPIOS.
 */
export function direccionCorta(direccion: string | null | undefined, dominioPropio?: string | readonly string[]): string {
  const d = (direccion ?? '').trim()
  const arroba = d.lastIndexOf('@')
  if (arroba <= 0 || arroba === d.length - 1) return d
  const propios = (dominioPropio === undefined ? DOMINIOS_PROPIOS : typeof dominioPropio === 'string' ? [dominioPropio] : dominioPropio).map((x) => x.trim().toLowerCase().replace(/^@/, ''))
  const dominio = d.slice(arroba + 1).toLowerCase()
  return propios.includes(dominio) ? d.slice(0, arroba + 1) : d
}

/**
 * La inicial de un buzón para el carril (donde no cabe el nombre): la primera letra o cifra de su dirección corta, en mayúscula
 * («stock@» → «S», «ángela@» → «Á»). Sin ninguna, «@».
 */
export function inicialDeBuzon(direccion: string | null | undefined): string {
  const letra = direccionCorta(direccion).match(/[\p{L}\p{N}]/u)?.[0]
  return letra ? letra.toLocaleUpperCase('es') : '@'
}
