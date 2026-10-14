/**
 * LA BASE DE DATOS COMO CSV, EN EL FORMATO DE LA HOJA.
 * PURA: sin pantalla ni red.
 *
 * Las mismas columnas y el mismo orden que la hoja de la que salió (REF, Nombre y
 * color, EAN, Talla, COD ART, FBASKU, FNSKU, ASIN, CONTINUIDAD, PRECIO), más una de
 * notas. Así lo que se descarga se puede pegar de vuelta en la hoja, o volver a
 * subir a la base de datos, sin traducir nada.
 */

import Papa from 'papaparse'
import { compararNatural, compararTalla } from './normalizar'
import type { FilaCatalogo } from './tipos'

export const CABECERA_CSV = ['REF', 'Nombre y color', 'EAN', 'Talla', 'COD ART', 'FBASKU', 'FNSKU', 'ASIN', 'CONTINUIDAD', 'PRECIO', 'NOTA'] as const

/** 74.95 -> «74,95»: la hoja está en español */
function precioEs(n: number | null): string {
  return n === null ? '' : n.toFixed(2).replace('.', ',')
}

export function filasACsv(filas: readonly FilaCatalogo[]): string {
  const ordenadas = [...filas].sort(
    (a, b) => compararNatural(a.ref, b.ref) || compararNatural(a.nombre, b.nombre) || compararTalla(a.talla, b.talla)
  )
  const datos = ordenadas.map((f) => [
    f.ref,
    f.nombre,
    f.ean ?? '',
    f.talla,
    f.codArt ?? '',
    f.fbasku ?? '',
    f.fnsku ?? '',
    f.asin ?? '',
    f.continuidad ? 'Si' : 'No',
    precioEs(f.precio),
    f.nota ?? '',
  ])
  return Papa.unparse({ fields: [...CABECERA_CSV], data: datos }, { newline: '\r\n' })
}
