import { costesFifo, moverTarifasMensuales, rangoDeMensuales } from './ajustes-filas'
import type { FilaPanel } from './panel'

let fallos = 0
const ok = (que: string, c: boolean, detalle = '') => {
  console.log(`  ${c ? 'OK   ' : 'FALLA'} ${que}${c ? '' : ` -> ${detalle}`}`)
  if (!c) fallos++
}
const casi = (a: number, b: number) => Math.abs(a - b) < 0.011
const fila = (dia: string, extra: Partial<FilaPanel> = {}): FilaPanel => ({ dia, mkt: 'A1RKKUPIHCS9HS', sku: '', asin: null, unidades: 0, pedidos: 0, ventas: 0, promo: 0, referral: 0, fba: 0, otras: 0, estimadas: 0, reembolsos: 0, reembolsado: 0, comisionReembolso: 0, ajustes: 0, publicidad: 0, ventasPpc: 0, unidadesPpc: 0, ...extra })
const suma = (fs: FilaPanel[], desde: string, hasta: string) => fs.filter((f) => f.dia >= desde && f.dia <= hasta).reduce((x, f) => x + f.otras, 0)

console.log('=== tarifas mensuales ===')
{
  // Amazon cobra el 10 de noviembre el almacenamiento de octubre (−300) y el 27 la suscripción (−39)
  const nov = [fila('2026-11-10', { otras: -300, almacenamiento: -300 }), fila('2026-11-27', { otras: -39, suscripcion: -39 })]
  ok('el rango de lectura empieza el mes anterior', rangoDeMensuales('2026-11-01', '2026-11-30').desde === '2026-10-01')
  const tal = moverTarifasMensuales(nov, nov, { almacenamiento: 'cobro', amortizar: false }, '2026-11-01', '2026-11-30', 'X')
  ok('sin opciones, igual', casi(suma(tal, '2026-11-01', '2026-11-30'), -339) && tal.length === 2)
  // Viendo octubre con «al mes al que corresponde»: el almacenamiento cobrado en noviembre cae el 31 de octubre
  const oct = moverTarifasMensuales([], nov, { almacenamiento: 'corresponde', amortizar: false }, '2026-10-01', '2026-10-31', 'X')
  ok('octubre recibe el almacenamiento cobrado en noviembre', casi(suma(oct, '2026-10-01', '2026-10-31'), -300) && oct[0]?.dia === '2026-10-31', JSON.stringify(oct))
  const nov2 = moverTarifasMensuales(nov, nov, { almacenamiento: 'corresponde', amortizar: false }, '2026-11-01', '2026-11-30', 'X')
  ok('y noviembre ya no lo tiene (la suscripción sí)', casi(suma(nov2, '2026-11-01', '2026-11-30'), -39))
  // Amortizar: la suscripción de noviembre, 39/30 al día
  const am = moverTarifasMensuales(nov, nov, { almacenamiento: 'cobro', amortizar: true }, '2026-11-01', '2026-11-10', 'X')
  ok('amortizada: 10 días de noviembre = 10/30 de todo', casi(suma(am, '2026-11-01', '2026-11-10'), (-339 * 10) / 30), String(suma(am, '2026-11-01', '2026-11-10')))
  const amEntero = moverTarifasMensuales(nov, nov, { almacenamiento: 'cobro', amortizar: true }, '2026-11-01', '2026-11-30', 'X')
  ok('el mes entero suma lo mismo que lo cobrado', casi(suma(amEntero, '2026-11-01', '2026-11-30'), -339))
}

console.log('=== COGS FIFO ===')
{
  const lotes = [
    { sku: 'A', fecha: '2026-10-01', unidades: 3, coste: 10 },
    { sku: 'A', fecha: '2026-10-15', unidades: 3, coste: 12 },
  ]
  const ventas = [
    { sku: 'A', dia: '2026-10-05', unidades: 2 },
    { sku: 'A', dia: '2026-10-20', unidades: 2 },
    { sku: 'A', dia: '2026-10-25', unidades: 4 },
  ]
  const c = costesFifo(lotes, ventas, 'ultimo', {})
  ok('2 del primer lote a 10', casi(c.get('A|2026-10-05') ?? -1, 10))
  ok('1 a 10 (queda del primero) y 1 a 12', casi(c.get('A|2026-10-20') ?? -1, 11))
  ok('2 a 12 y 2 sobrevendidas al último lote (12)', casi(c.get('A|2026-10-25') ?? -1, 12))
  const cero = costesFifo(lotes, ventas, 'cero', {})
  ok('sobrevendidas a cero', casi(cero.get('A|2026-10-25') ?? -1, 6))
  const fijo = costesFifo(lotes, ventas, 'fijo', { A: 20 })
  ok('sobrevendidas al COGS fijo', casi(fijo.get('A|2026-10-25') ?? -1, 16))
  const antes = costesFifo([{ sku: 'A', fecha: '2026-10-10', unidades: 5, coste: 8 }], [{ sku: 'A', dia: '2026-10-01', unidades: 1 }], 'cero', {})
  ok('un lote no sirve para ventas anteriores a su fecha', casi(antes.get('A|2026-10-01') ?? -1, 0))
  ok('los SKU sin lotes no salen', !costesFifo(lotes, [{ sku: 'B', dia: '2026-10-05', unidades: 1 }], 'ultimo', {}).has('B|2026-10-05'))
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTODO BIEN')
if (fallos) process.exit(1)
