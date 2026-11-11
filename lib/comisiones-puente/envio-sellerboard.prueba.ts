import * as XLSX from 'xlsx'
import { envioDeSellerboard } from '@/lib/comisiones-puente/envio-sellerboard'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const libro = (filas: unknown[][], tipo: 'xlsx' | 'csv' = 'xlsx'): Uint8Array => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'TDSheet')
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: tipo }))
}

console.log('\n=== el envío del Tablero de productos de Sellerboard ===')
{
  const r = envioDeSellerboard(
    libro([
      ['Product', 'ASIN', 'SKU', 'Units', 'Sales', 'Shipping', 'Net profit'],
      ['Tubo T8', 'B0AAAAAAA1', 'S-1', 35, 525.65, -289.08, 12.62],
      ['Halógeno', 'B0AAAAAAA2', 'S-2', 24, 357.38, -129.28, -32.77],
      ['Sin ventas', 'B0AAAAAAA3', 'S-3', null, null, null, null],
      ['Sin envío', 'B0AAAAAAA4', 'S-4', 1, 10, 0, 3],
    ])
  )
  ok('suma la columna Shipping y la da en positivo', r.total === 418.36, String(r.total))
  ok('cuenta solo las filas con envío', r.filasConEnvio === 2, String(r.filasConEnvio))
  ok('dice cómo se llamaba la columna', r.columna === 'Shipping')
}
{
  const r = envioDeSellerboard(
    libro([
      ['Product', 'ASIN', 'SKU', 'Shipping'],
      ['A', 'B0AAAAAAA1', 'S-1', -10],
      ['B', 'B0AAAAAAA2', 'S-2', -5.5],
      ['Total', null, null, -15.5],
    ])
  )
  ok('una fila de totales sin ASIN ni SKU no se suma dos veces', r.total === 15.5, String(r.total))
}
{
  const r = envioDeSellerboard(libro([['Producto', 'ASIN', 'SKU', 'Envío'], ['A', 'B0AAAAAAA1', 'S-1', '-1.941,06']], 'csv'))
  ok('vale el CSV en español con «Envío» y coma decimal', r.total === 1941.06, String(r.total))
}
{
  let mensaje = ''
  try {
    envioDeSellerboard(libro([['Product', 'ASIN', 'Sales'], ['A', 'B0AAAAAAA1', 10]]))
  } catch (e) {
    mensaje = e instanceof Error ? e.message : ''
  }
  ok('sin columna de envío no se inventa un cero: da error', mensaje.includes('Shipping'), mensaje)
}

console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
