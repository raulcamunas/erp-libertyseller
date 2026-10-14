/**
 * QUÉ LE FALTA A UNA REFERENCIA, Y QUÉ ESTÁ MAL ESCRITO.
 * PURA: sin pantalla ni red.
 *
 * Dos clases de problema, y no se mezclan:
 *
 *   FALTA   un dato que la hoja no trae. Una talla sin FNSKU no tiene etiquetas, una
 *           sin FBASKU no se puede mandar. Es lo que la pantalla cuenta como
 *           «incompletas» y deja filtrar.
 *   AVISO   un dato que está pero no tiene la forma de lo que dice ser: un EAN con
 *           el dígito de control mal, un FNSKU sin la X, un FBASKU que acaba en -41
 *           en la talla 40. NO se corrige —no se sabe cuál de los dos está mal—, se
 *           señala.
 *
 * El dígito de control del EAN se mide contra los 418 de la hoja de ShoesF: pasan
 * los 418. Con cero falsos positivos en datos reales, atrapa el error de teclear
 * uno a mano, que es para lo que está.
 */

import type { DatosFila } from './tipos'

export type GravedadAviso = 'falta' | 'aviso'

export interface AvisoFila {
  campo: 'ean' | 'fnsku' | 'asin' | 'fbasku'
  gravedad: GravedadAviso
  texto: string
}

type Campos = Pick<DatosFila, 'ean' | 'fnsku' | 'asin' | 'fbasku' | 'talla'>

/** Dígito de control GS1 (EAN-8, UPC-12, EAN-13 y GTIN-14) */
export function eanValido(ean: string): boolean {
  if (!/^\d+$/.test(ean) || ![8, 12, 13, 14].includes(ean.length)) return false
  const cifras = ean.split('').map(Number)
  const control = cifras.pop() as number
  const suma = cifras.reverse().reduce((s, c, i) => s + c * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (suma % 10)) % 10 === control
}

/** Los avisos de una fila, los que faltan primero */
export function avisosDeFila(f: Campos): AvisoFila[] {
  const avisos: AvisoFila[] = []

  if (!f.fbasku) {
    avisos.push({ campo: 'fbasku', gravedad: 'falta', texto: 'Sin FBASKU: no se puede mandar a Amazon' })
  }
  if (!f.fnsku) {
    avisos.push({ campo: 'fnsku', gravedad: 'falta', texto: 'Sin FNSKU: no se pueden imprimir sus etiquetas' })
  }
  if (!f.ean) {
    avisos.push({ campo: 'ean', gravedad: 'falta', texto: 'Sin EAN' })
  }
  if (!f.asin) {
    avisos.push({ campo: 'asin', gravedad: 'falta', texto: 'Sin ASIN' })
  }

  if (f.ean) {
    if (!/^\d+$/.test(f.ean)) {
      avisos.push({ campo: 'ean', gravedad: 'aviso', texto: `El EAN «${f.ean}» no son solo cifras` })
    } else if (![8, 12, 13, 14].includes(f.ean.length)) {
      avisos.push({ campo: 'ean', gravedad: 'aviso', texto: `El EAN tiene ${f.ean.length} cifras y debería tener 13` })
    } else if (!eanValido(f.ean)) {
      avisos.push({ campo: 'ean', gravedad: 'aviso', texto: 'El dígito de control del EAN no cuadra: hay una cifra mal' })
    }
  }

  // El FNSKU empieza por X00; los que son iguales a su ASIN (etiqueta de fábrica) empiezan por B0
  if (f.fnsku && !/^(X00[0-9A-Z]{7}|B0[0-9A-Z]{8})$/.test(f.fnsku)) {
    avisos.push({ campo: 'fnsku', gravedad: 'aviso', texto: `El FNSKU «${f.fnsku}» no tiene el formato de Amazon (X00 y siete caracteres)` })
  }

  if (f.asin && !/^[0-9A-Z]{10}$/.test(f.asin)) {
    avisos.push({ campo: 'asin', gravedad: 'aviso', texto: `El ASIN «${f.asin}» no tiene 10 caracteres` })
  }

  // «FBA209065-41» en la talla 40: uno de los dos está mal. El sufijo puede ir seguido
  // de guiones (FBA366246-39--), que son parte del SKU de verdad y se ignoran aquí.
  if (f.fbasku && f.talla) {
    const sufijo = /-(\d+(?:[.,]\d+)?)-*$/.exec(f.fbasku)
    const talla = f.talla.replace(',', '.')
    if (sufijo && /^\d+(?:\.\d+)?$/.test(talla) && sufijo[1].replace(',', '.') !== talla) {
      avisos.push({
        campo: 'fbasku',
        gravedad: 'aviso',
        texto: `El FBASKU acaba en -${sufijo[1]} pero la talla es ${f.talla}`,
      })
    }
  }

  return avisos
}

/** ¿Tiene todo lo que hace falta para mandarla y etiquetarla? */
export function estaCompleta(f: Campos): boolean {
  return !avisosDeFila(f).some((a) => a.gravedad === 'falta')
}

/** Sin FBASKU no hay línea de remesa posible */
export function sePuedeMandar(f: Pick<DatosFila, 'fbasku'>): boolean {
  return !!f.fbasku
}
