import { anchoEnModulos, code128B } from '@/lib/fba/code128'
import { FORMATOS, hojaDeEtiquetas, type EtiquetaProducto } from '@/lib/fba/etiquetas'

let fallos = 0
const ok = (n: string, bien: boolean, detalle = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !detalle ? '' : ` -> ${detalle}`}`)
}

/**
 * ETIQUETAS DE PRODUCTO: QUE EL SKU SALGA Y QUE QUEPA.
 *
 * Lo que de verdad importa comprobar aqui no es que el PDF se genere —eso lo
 * dice cualquier llamada— sino que el renglon del SKU CABE en las tres hojas de
 * FORMATOS. La etiqueta mas apretada es el rollo termico de 57x32 mm, y ahi es
 * donde el titulo tiene que ceder lineas para dejarle sitio.
 *
 * Los numeros se recalculan igual que en dibujar(): si alguien toca los saltos o
 * el alto del codigo, esta prueba lo dice antes de que salgan 400 pegatinas con
 * el SKU pisando el borde.
 */
const SALTO_SKU = 3.6
const SALTO_TITULO = 2.6
const SALTO_CONDICION = 2.4
const MARGEN_ABAJO = 1.2

console.log('\n=== la geometria de cada hoja ===')
for (const f of FORMATOS) {
  const alto = f.etiqueta.alto
  const altoBarra = Math.max(8, alto * 0.45)
  const yFnsku = 2.5 + altoBarra + 3.2
  const ySku = yFnsku + SALTO_SKU
  const yCondicion = alto - MARGEN_ABAJO
  const hueco = yCondicion - SALTO_CONDICION - ySku
  const lineas = Math.max(1, Math.floor(hueco / SALTO_TITULO))

  console.log(`\n  ${f.nombre}`)
  console.log(`    codigo    ${(2.5).toFixed(1)} -> ${(2.5 + altoBarra).toFixed(1)} mm`)
  console.log(`    FNSKU     ${yFnsku.toFixed(1)} mm`)
  console.log(`    SKU       ${ySku.toFixed(1)} mm`)
  console.log(`    titulo    ${lineas} linea(s)`)
  console.log(`    condicion ${yCondicion.toFixed(1)} mm  (etiqueta de ${alto} mm)`)

  ok(`${f.id}: el SKU no se sale por abajo`, ySku < yCondicion, `SKU en ${ySku.toFixed(1)}, fondo en ${yCondicion.toFixed(1)}`)
  ok(`${f.id}: cabe al menos una linea de titulo`, lineas >= 1)
  ok(`${f.id}: la condicion no se sale del recuadro`,
     ySku + SALTO_TITULO * lineas + SALTO_CONDICION <= yCondicion + 0.01,
     `condicion en ${(ySku + SALTO_TITULO * lineas + SALTO_CONDICION).toFixed(1)}, suelo en ${yCondicion.toFixed(1)}`)
  // El minimo de Amazon para una item label es 25,4 x 50,8 mm
  ok(`${f.id}: cumple el minimo de Amazon (25,4 x 50,8 mm)`,
     Math.min(f.etiqueta.ancho, f.etiqueta.alto) >= 25.4 && Math.max(f.etiqueta.ancho, f.etiqueta.alto) >= 50.8,
     `${f.etiqueta.ancho} x ${f.etiqueta.alto}`)
}

console.log('\n=== el codigo de barras se puede leer en las tres hojas ===')
const ZONA_MUDA = 6.35
const MODULO_MINIMO = 0.19
// Un FNSKU de verdad, 10 caracteres
const mods = code128B('X002OWACXP')!
const nModulos = anchoEnModulos(mods)
for (const f of FORMATOS) {
  const m = (f.etiqueta.ancho - ZONA_MUDA * 2) / nModulos
  console.log(`\n  ${f.nombre}`)
  console.log(`    modulo ${m.toFixed(3)} mm (${(m / 0.0254).toFixed(1)} milesimas de pulgada)`)
  console.log(`    Code 128 pide zona muda >= ${(m * 10).toFixed(2)} mm, hay ${ZONA_MUDA} mm`)
  ok(`${f.id}: el modulo llega al minimo imprimible`, m >= MODULO_MINIMO, `${m.toFixed(3)} mm`)
  ok(`${f.id}: la zona muda llega a 10 modulos`, ZONA_MUDA >= m * 10, `pide ${(m * 10).toFixed(2)} mm`)
}

console.log('\n=== se genera con datos reales de Cobo Family ===')
const reales: EtiquetaProducto[] = [
  {
    fnsku: 'X002OWACXP',
    sku: '602A BEIG/39',
    titulo: 'COZSERIES Zapatillas de Casa Mujer | Calzado Anatomico Verano Primavera Hecho en Espana | Suela de Goma Antideslizante | Plantilla Acolchada',
    unidades: 3,
  },
  { fnsku: 'X002G25SB9', sku: 'AD-XR024 MORADO 36/37', titulo: 'CoboFamily Zapatillas Casa Mujer Calido Espuma de Memoria Invierno Pantuflas Suela TPR Antideslizante (Morado024, 36/37)', unidades: 2 },
  { fnsku: 'X002H49OGB', sku: '30E BURDEOS 35', titulo: 'Zapatos Mujer Invierno Casa Calientes Suapel', unidades: 1 },
  // el caso feo: un SKU larguisimo
  { fnsku: 'X002G2B0WF', sku: 'SSFWF22001-MORADO-OSCURO-CON-DETALLE/38-39', titulo: 'Sandalias', unidades: 1 },
  // y el que NO se debe imprimir
  { fnsku: '', sku: '999 SIN FNSKU/40', titulo: 'Este no tiene FNSKU', unidades: 5 },
]

for (const f of FORMATOS) {
  const r = hojaDeEtiquetas(reales, f.id)
  const esperadas = 3 + 2 + 1 + 1
  ok(`${f.id}: imprime ${esperadas} etiquetas`, r.etiquetas === esperadas, `salieron ${r.etiquetas}`)
  ok(`${f.id}: descarta la que no tiene FNSKU`, r.descartadas.length === 1, JSON.stringify(r.descartadas))
  ok(`${f.id}: el descarte dice el SKU y no el titulo`,
     r.descartadas[0]?.motivo.startsWith('999 SIN FNSKU/40'), r.descartadas[0]?.motivo)
  ok(`${f.id}: el PDF tiene contenido`, r.pdf.byteLength > 1000, `${r.pdf.byteLength} bytes`)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
