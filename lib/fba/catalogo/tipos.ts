/**
 * LA BASE DE DATOS DE REFERENCIAS DE UN CLIENTE: LOS TIPOS.
 * PURA: sin pantalla ni red.
 *
 * Es la hoja de cálculo que ShoesF usaba para montar sus envíos —REF, Nombre y color,
 * Talla, EAN, FNSKU, ASIN, FBASKU— pasada a una tabla que se puede editar, ampliar y
 * usar desde los desplegables de una propuesta. Una fila es una TALLA de un modelo:
 * lo que Amazon conoce como un SKU.
 *
 * El código de Amazon es `fbasku` aquí y `sku` en las líneas de una remesa. Es el
 * mismo valor —el «Merchant SKU» de la plantilla del manifiesto— y el cambio de
 * nombre se hace en UN sitio: `aElegido`, en indice.ts.
 */

export interface FilaCatalogo {
  id: string
  /** El código del modelo: 8412, F0047, 13451ST. Varios colores comparten el mismo */
  ref: string
  /** «Nombre y color» en la hoja: CUERO, P.N. COÑAC, BLACK 000 */
  nombre: string
  /** Texto y no número: hay «UNICA», «37/38» y «M». Se ordena con `compararTalla` */
  talla: string
  ean: string | null
  fnsku: string | null
  asin: string | null
  /** El SKU del vendedor. Sin él la talla no se puede mandar: la línea de la remesa lo exige */
  fbasku: string | null
  /** El código de artículo del cliente. Solo informativo; de él sale la propuesta de FBASKU */
  codArt: string | null
  /** «No» = el modelo se descataloga. Sigue saliendo en los desplegables, pero atenuado */
  continuidad: boolean
  precio: number | null
  nota: string | null
}

/** Lo que se escribe al dar de alta o corregir: la fila sin su id */
export type DatosFila = Omit<FilaCatalogo, 'id'>

/** Los campos que viajan entre pantalla, API y base, en el orden en que se enseñan */
export const CAMPOS_FILA: ReadonlyArray<keyof DatosFila> = [
  'ref',
  'nombre',
  'talla',
  'ean',
  'fnsku',
  'asin',
  'fbasku',
  'codArt',
  'continuidad',
  'precio',
  'nota',
]

/**
 * ¿Este cliente trabaja con base de datos de referencias?
 *
 * Hoy solo ShoesF. Se decide por el NOMBRE de la cuenta, sin tildes ni espacios
 * —«ShoesF», «Shoes F», «SHOESF S.L.»—, porque la pantalla de remesas solo conoce el
 * id y el nombre del cliente. Si mañana la usa otro, se añade aquí y en ningún otro
 * sitio: la tabla y la API ya guardan las filas por cliente.
 */
export function esClienteConCatalogo(nombre: string | null | undefined): boolean {
  if (!nombre) return false
  const limpio = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  return limpio.includes('shoesf')
}

/** El texto con el que se compara: sin mayúsculas, sin tildes y con un solo espacio */
export function claveTexto(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** La clave de un modelo (REF + color): lo que une las tallas en un mismo desplegable */
export function claveModelo(ref: string, nombre: string): string {
  return `${claveTexto(ref)}\u0001${claveTexto(nombre)}`
}

/** La clave de una talla concreta: REF + color + talla. Es única por cliente */
export function claveTalla(ref: string, nombre: string, talla: string): string {
  return `${claveModelo(ref, nombre)}\u0001${claveTexto(talla)}`
}
