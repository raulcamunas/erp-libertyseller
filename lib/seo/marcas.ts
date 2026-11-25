/**
 * SEO · LAS MARCAS DE LA COMPETENCIA. PURO (se prueba sin base de datos).
 *
 * Una búsqueda que lleva la marca de otro («zapatillas skechers mujer», «hey dude mujer») no se puede trabajar en la ficha: no va en el título, ni en las viñetas, ni en el backend. En publicidad,
 * como mucho, en una campaña de ataque de marca. La lista de marcas es por cuenta y país y se llena sola (lib/seo/marcas-servidor.ts) de:
 *   · las marcas de los competidores que se siguen (sus fotos del catálogo);
 *   · las marcas de los 3 productos que se llevan los clics en cada búsqueda (informe de términos más buscados de Brand Analytics);
 *   · la IA, que repasa las búsquedas del producto;
 *   · y lo que ponga una persona a mano (que también puede decir «esto no es una marca»).
 *
 * Se casa por PALABRAS ENTERAS y SEGUIDAS, sin tildes ni mayúsculas: «hey dude» casa con «hey dude mujer» pero no con «dude»; «skechers» no casa con «skech». Nunca son marca:
 *   · las genéricas («generic», «genérico», «sin marca»…), ni lo que no tiene letras;
 *   · la marca propia (la del cliente, sacada del título de sus fichas);
 *   · en las que vienen solas (no a mano), una palabra que es de las más repetidas en las búsquedas del propio producto («casa», «zapatillas»): una marca que se llame como el producto
 *     borraría todas sus búsquedas.
 */

export type OrigenDeMarca = 'rival' | 'clics' | 'ia' | 'manual'

export interface MarcaGuardada {
  /** Normalizada: minúsculas, sin tildes, palabras separadas por un espacio */
  clave: string
  /** Como se enseña («Skechers») */
  texto: string
  origen: OrigenDeMarca
  /** false = una persona ha dicho que NO es una marca de la competencia (no se vuelve a añadir sola) */
  activa: boolean
}

const GENERICAS = new Set(['generic', 'generico', 'generica', 'genericos', 'sin marca', 'no brand', 'unbranded', 'n a', 'na', 'none', 'otros', 'otras', 'varios', 'unknown', 'desconocida', 'desconocido', 'amazon', 'amazon basics', 'amazonbasics'])

export function claveDeMarca(texto: string | null | undefined): string {
  return (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** ¿Puede ser una marca? Ni genérica, ni sin letras, ni de una o dos letras sueltas */
export function esMarcaValida(clave: string): boolean {
  if (!clave || GENERICAS.has(clave)) return false
  if (!/[a-zñ]/.test(clave)) return false
  if (clave.replace(/\s/g, '').length < 3) return false
  return clave.split(' ').length <= 4
}

/**
 * Las marcas que de verdad se usan para descartar búsquedas: activas, válidas, sin la propia y, las que no se pusieron a mano, sin las que se llaman como una palabra común del producto.
 * @param propias las marcas del cliente (claves)
 * @param comunes palabras más repetidas en las búsquedas del producto (normalizadas)
 */
export function marcasEnUso(marcas: readonly MarcaGuardada[], propias: readonly string[] = [], comunes: ReadonlySet<string> = new Set()): MarcaGuardada[] {
  const suyas = new Set(propias.map(claveDeMarca).filter(Boolean))
  return marcas.filter((m) => {
    if (!m.activa || !esMarcaValida(m.clave) || suyas.has(m.clave)) return false
    if (m.origen !== 'manual' && m.clave.split(' ').every((p) => comunes.has(p))) return false
    return true
  })
}

/** La marca ajena que lleva una búsqueda (la más larga si casan varias), o null */
export function marcaEnBusqueda(consulta: string, marcas: readonly Pick<MarcaGuardada, 'clave' | 'texto'>[]): Pick<MarcaGuardada, 'clave' | 'texto'> | null {
  const q = ` ${claveDeMarca(consulta)} `
  let mejor: Pick<MarcaGuardada, 'clave' | 'texto'> | null = null
  for (const m of marcas) {
    if (!m.clave) continue
    if (q.includes(` ${m.clave} `) && (!mejor || m.clave.length > mejor.clave.length)) mejor = m
  }
  return mejor
}

/** La marca propia a partir del título («Cozseries Zapatillas…» → «cozseries»): la primera palabra, si no es genérica */
export function marcaDelTitulo(titulo: string | null | undefined): string | null {
  const primera = claveDeMarca(titulo).split(' ')[0] ?? ''
  return esMarcaValida(primera) ? primera : null
}
