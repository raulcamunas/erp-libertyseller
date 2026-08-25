/**
 * EL MOTOR DE PRECIOS, CONTRASTADO CONTRA EL EXCEL DEL CLIENTE.
 *
 * El Excel «Entrais - Precio objetivo por margen» tiene 6.921 filas ya
 * calculadas por sus propias fórmulas. Este script mete esas mismas filas por
 * `calcularPrecio()` y compara resultado a resultado.
 *
 * No es una prueba de que el motor sea correcto: es una prueba de que el motor y
 * la hoja dicen LO MISMO. Si difieren, uno de los dos está mal y hay que mirarlo
 * ANTES de que esto ponga precios en la tienda de un cliente. Si coinciden en
 * las 6.921, el día que alguien toque la fórmula lo va a saber en el acto.
 *
 * Las columnas del Excel que se contrastan:
 *
 *   W   margen aplicado        (propio > tramo > global)
 *   X   tarifa % aplicada      (la real, o el 15% por defecto)
 *   Y   precio objetivo        sin redondear
 *   Z   precio redondeado      el que se publicaría
 *   AB  margen real            con el precio redondeado
 *   AE  aviso
 *
 *   npx tsx scripts/check-precios-entrais.ts "<ruta al .xlsx>"
 */

import * as XLSX from 'xlsx'
import {
  CONFIG_POR_DEFECTO,
  calcularPrecio,
  type ConfigPrecios,
  type EntradaPrecio,
  type MotivoAviso,
} from '@/lib/entrais/precios'

const ruta =
  process.argv[2] ??
  '/Users/raulcamunas/Downloads/Entrais - Precio objetivo por margen_1 (2).xlsx'

/** Los parámetros tal cual están en las hojas «Parámetros» y «Tramos de margen» */
const CFG: ConfigPrecios = {
  ...CONFIG_POR_DEFECTO,
  margenGlobal: 0.07,
  usarTramos: true,
  decidirTramoPor: 'coste',
  tramos: [
    { desde: 0, margen: 0.15 },
    { desde: 30, margen: 0.12 },
    { desde: 90, margen: 0.1 },
    { desde: 300, margen: 0.08 },
    { desde: 500, margen: 0.07 },
    { desde: 1000, margen: 0.06 },
    { desde: 2000, margen: 0.05 },
    { desde: 5000, margen: 0.05 },
    { desde: 20000, margen: 0.05 },
    { desde: 50000, margen: 0.05 },
  ],
  ivaVenta: 0.21,
  porte: 4,
  tasaDigital: 0.03,
  tarifaPorDefecto: 0.15,
  redondeo: 'centimo',
  // La hoja no contempla la Buy Box: para contrastar hay que apagarlo.
  margenSuelo: null,
}

/** El aviso del Excel, traducido al enum del motor */
function avisoDelExcel(texto: unknown): MotivoAviso | null {
  const t = String(texto ?? '')
  if (t.startsWith('Margen inalcanzable')) return 'imposible'
  if (t.startsWith('Precio de proveedor = 0')) return 'precio_proveedor_cero'
  if (t.startsWith('Tarifa estimada')) return 'tarifa_estimada'
  if (t.startsWith('Sin PVP actual')) return 'sin_pvp_actual'
  if (t.startsWith('Subida grande')) return 'subida_grande'
  if (t.startsWith('Puede bajar')) return 'puede_bajar'
  if (t === 'OK') return 'ok'
  return null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function main() {
  const wb = XLSX.readFile(ruta)
  const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Productos'], {
    defval: null,
  })
  console.log(`Excel: ${filas.length} filas\n`)

  const k = Object.keys(filas[0])
  const col = (frag: string) => k.find((x) => x.replace(/\s+/g, ' ').includes(frag)) ?? frag

  const cSku = col('SKU')
  const cPrecio = col('PRECIO')
  const cCanon = 'CANON'
  const cPvp = col('PVP en Amazon')
  const cTarifaPct = col('Tarifa de referencia %')
  const cMargenPropio = col('Margen objetivo')
  const cW = col('Margen aplicado')
  const cX = col('Tarifa % aplicada')
  const cY = col('PRECIO DE VENTA OBJETIVO')
  const cZ = col('Precio objetivo')
  const cAB = col('margen real')
  const cAE = 'Aviso'

  let comparadas = 0
  const desvios = { margen: 0, tarifa: 0, objetivo: 0, redondeado: 0, margenReal: 0, aviso: 0 }
  const ejemplos: string[] = []

  for (const f of filas) {
    const precioProveedor = num(f[cPrecio])
    if (precioProveedor === null) continue

    const entrada: EntradaPrecio = {
      sku: String(f[cSku] ?? ''),
      precioProveedor,
      canon: num(f[cCanon]) ?? 0,
      tarifaReal: num(f[cTarifaPct]),
      pvpActual: num(f[cPvp]),
      margenPropio: num(f[cMargenPropio]),
    }

    const r = calcularPrecio(entrada, CFG)
    comparadas++

    const esperado = {
      margen: num(f[cW]),
      tarifa: num(f[cX]),
      objetivo: num(f[cY]),
      redondeado: num(f[cZ]),
      margenReal: num(f[cAB]),
      aviso: avisoDelExcel(f[cAE]),
    }

    const cerca = (a: number | null, b: number | null, tol: number) =>
      a === null || b === null ? a === b : Math.abs(a - b) <= tol

    if (!cerca(r.margenAplicado, esperado.margen, 1e-9)) desvios.margen++
    if (!cerca(r.tarifaAplicada, esperado.tarifa, 1e-9)) desvios.tarifa++
    if (!cerca(r.precioObjetivo, esperado.objetivo, 0.005)) desvios.objetivo++
    if (!cerca(r.margenReal, esperado.margenReal, 1e-6)) desvios.margenReal++
    if (esperado.aviso !== null && r.aviso !== esperado.aviso) desvios.aviso++

    if (!cerca(r.precio, esperado.redondeado, 0.005)) {
      desvios.redondeado++
      if (ejemplos.length < 8) {
        ejemplos.push(
          `   SKU ${entrada.sku}: motor ${r.precio} · excel ${esperado.redondeado} ` +
            `(coste ${r.coste.toFixed(2)}, margen ${r.margenAplicado}, tarifa ${r.tarifaAplicada.toFixed(4)})`
        )
      }
    }
  }

  console.log(`Filas comparadas: ${comparadas}\n`)
  const filasTabla: [string, number][] = [
    ['Margen aplicado (col W)', desvios.margen],
    ['Tarifa aplicada (col X)', desvios.tarifa],
    ['Precio objetivo (col Y)', desvios.objetivo],
    ['Precio redondeado (col Z)', desvios.redondeado],
    ['Margen real (col AB)', desvios.margenReal],
    ['Aviso (col AE)', desvios.aviso],
  ]
  for (const [nombre, n] of filasTabla) {
    console.log(`${n === 0 ? '  OK  ' : ' FALLA'} ${nombre.padEnd(28)} ${n} desvíos`)
  }
  if (ejemplos.length > 0) {
    console.log('\nEjemplos de precio distinto:')
    ejemplos.forEach((e) => console.log(e))
  }

  const total = Object.values(desvios).reduce((a, b) => a + b, 0)
  console.log(
    total === 0
      ? '\nEl motor y el Excel dicen exactamente lo mismo en las ' + comparadas + ' filas.'
      : `\n${total} desvíos en total.`
  )
  process.exit(total === 0 ? 0 : 1)
}

void main()
