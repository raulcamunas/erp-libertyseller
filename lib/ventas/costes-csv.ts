/**
 * VENTAS · LEER UN CSV DE COSTES (COGS) PARA IMPORTARLO EN «PRODUCTOS». PURO (vale en el navegador). Se comprueba con costes-csv.prueba.ts.
 *
 * Acepta el export de «Productos» de Sellerboard (columnas "SKU" y "Cost", todo entre comillas, separado por «;», decimales con coma) y cualquier CSV con
 * columnas SKU y COGS/Coste/Cost (o, sin cabecera, SKU en la primera y coste en la segunda). Las filas sin coste se saltan.
 */

/** Parte una línea de CSV respetando las comillas ("a;b" es un solo campo; "" dentro es una comilla) */
export function partirLinea(linea: string, sep: string): string[] {
  const out: string[] = []
  let campo = ''
  let dentro = false
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (dentro) {
      if (c === '"' && linea[i + 1] === '"') {
        campo += '"'
        i++
      } else if (c === '"') dentro = false
      else campo += c
    } else if (c === '"' && campo.trim() === '') dentro = true // Solo abre comillas al EMPEZAR el campo: «Tablet 11" 2.5K» es una pulgada, no una comilla
    else if (c === sep) {
      out.push(campo)
      campo = ''
    } else campo += c
  }
  out.push(campo)
  return out.map((x) => x.trim())
}

export function aNumeroCoste(t: string | undefined): number | null {
  const x = (t ?? '').trim().replace(/\s|€/g, '')
  if (x === '') return null
  // «1.234,56» → 1234.56 · «3,25» → 3.25 · «3.25» → 3.25
  const normal = x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x
  const n = Number(normal)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

export function leerCostesCsv(texto: string): { costes: Array<{ sku: string; coste: number }>; error: string | null } {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lineas.length === 0) return { costes: [], error: 'El fichero está vacío.' }
  const primera = lineas[0]
  const sep = primera.includes(';') ? ';' : primera.includes('\t') ? '\t' : ','
  const cab = partirLinea(primera, sep).map((c) => c.toLowerCase())
  const iSku = cab.findIndex((c) => c === 'sku')
  const iCoste = cab.findIndex((c) => ['cogs', 'coste', 'cost', 'costo', 'coste por unidad'].includes(c))
  const conCabecera = iSku >= 0 && iCoste >= 0
  if (!conCabecera && cab.some((c) => c === 'sku')) return { costes: [], error: 'El fichero tiene columna SKU pero no una de coste (COGS, Coste o Cost).' }
  const porSku = new Map<string, number>()
  for (const l of lineas.slice(conCabecera ? 1 : 0)) {
    const c = partirLinea(l, sep)
    const sku = c[conCabecera ? iSku : 0] ?? ''
    const n = aNumeroCoste(c[conCabecera ? iCoste : 1])
    if (sku && n != null && !Number.isNaN(n)) porSku.set(sku, Math.round(n * 100) / 100)
  }
  const costes = [...porSku.entries()].map(([sku, coste]) => ({ sku, coste }))
  return { costes, error: costes.length ? null : 'El fichero no trae ninguna fila con SKU y coste.' }
}
