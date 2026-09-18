import { repartirSku, type Movimiento, type Remesa, type LineaRemesa } from '@/lib/fba/fifo'

let fallos = 0
function comprobar(nombre: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado)
  if (!ok) fallos++
  console.log(`  ${ok ? 'OK  ' : 'FALLA'} ${nombre}${ok ? '' : `\n        esperado ${JSON.stringify(esperado)}\n        real     ${JSON.stringify(real)}`}`)
}

const remesas = new Map<string, Remesa>([
  ['r1', { id: 'r1', fechaEnvio: '2026-09-01' }],
  ['r2', { id: 'r2', fechaEnvio: '2026-09-10' }],
])
const lineas: LineaRemesa[] = [
  { remesaId: 'r1', sku: 'XXXXX', unidades: 3 },
  { remesaId: 'r2', sku: 'XXXXX', unidades: 3 },
]
const venta = (fecha: string, n: number): Movimiento => ({ sku: 'XXXXX', fecha, tipo: 'Shipments', cantidad: -n })

console.log('\n=== 1. EL EJEMPLO DE RAUL: 3 + 3, vendidas 5 -> r1 a 0, r2 con 1 ===')
{
  const r = repartirSku('XXXXX', lineas, remesas, [venta('2026-09-15', 5)], { hoy: '2026-09-18' })
  comprobar('r1 quedan 0', r.lineas[0].quedan, 0)
  comprobar('r2 quedan 1', r.lineas[1].quedan, 1)
  comprobar('total quedan 1', r.quedan, 1)
  comprobar('sin atribuir 0', r.sinAtribuir, 0)
}

console.log('\n=== 2. WhseTransfers NO consume (el 22% de los movimientos) ===')
{
  const movs: Movimiento[] = [
    { sku: 'XXXXX', fecha: '2026-09-15', tipo: 'WhseTransfers', cantidad: -6 },
    { sku: 'XXXXX', fecha: '2026-09-15', tipo: 'Receipts', cantidad: 3 },
  ]
  const r = repartirSku('XXXXX', lineas, remesas, movs, { hoy: '2026-09-18' })
  comprobar('no se ha consumido nada', r.quedan, 6)
}

console.log('\n=== 3. Adjustments SI consume (la merma) ===')
{
  const movs = [venta('2026-09-15', 4), { sku: 'XXXXX', fecha: '2026-09-16', tipo: 'Adjustments', cantidad: -1 } as Movimiento]
  const r = repartirSku('XXXXX', lineas, remesas, movs, { hoy: '2026-09-18' })
  comprobar('quedan 1 (6 - 4 - 1)', r.quedan, 1)
}

console.log('\n=== 4. Una venta ANTES del primer envio no consume: queda sin atribuir ===')
{
  const r = repartirSku('XXXXX', lineas, remesas, [venta('2026-08-20', 2)], { hoy: '2026-09-18' })
  comprobar('no toca las remesas', r.quedan, 6)
  comprobar('2 sin atribuir', r.sinAtribuir, 2)
}

console.log('\n=== 5. Una venta entre r1 y r2 solo puede salir de r1 ===')
{
  const r = repartirSku('XXXXX', lineas, remesas, [venta('2026-09-05', 2)], { hoy: '2026-09-18' })
  comprobar('r1 quedan 1', r.lineas[0].quedan, 1)
  comprobar('r2 intacta', r.lineas[1].quedan, 3)
}

console.log('\n=== 6. La devolucion deshace el consumo MAS RECIENTE, no el mas antiguo ===')
{
  const movs: Movimiento[] = [venta('2026-09-15', 5), { sku: 'XXXXX', fecha: '2026-09-16', tipo: 'CustomerReturns', cantidad: 1, disposicion: 'SELLABLE' }]
  const r = repartirSku('XXXXX', lineas, remesas, movs, { hoy: '2026-09-18' })
  comprobar('r1 sigue agotada', r.lineas[0].quedan, 0)
  comprobar('r2 sube a 2', r.lineas[1].quedan, 2)
}

console.log('\n=== 7. Una devolucion inservible cuenta aparte ===')
{
  const movs: Movimiento[] = [venta('2026-09-15', 5), { sku: 'XXXXX', fecha: '2026-09-16', tipo: 'CustomerReturns', cantidad: 1, disposicion: 'DEFECTIVE' }]
  const r = repartirSku('XXXXX', lineas, remesas, movs, { hoy: '2026-09-18' })
  comprobar('r2 no vendibles = 1', r.lineas[1].devueltasNoVendibles, 1)
  comprobar('r2 quedan 2 en el lote', r.lineas[1].quedan, 2)
  comprobar('r2 vendibles solo 1', r.lineas[1].quedanVendibles, 1)
}

console.log('\n=== 8. Velocidad y fecha de agotamiento ===')
{
  const movs = Array.from({ length: 10 }, (_, i) => venta(`2026-09-${String(i + 5).padStart(2, '0')}`, 1))
  const r = repartirSku('XXXXX', [{ remesaId: 'r1', sku: 'XXXXX', unidades: 30 }], new Map([['r1', { id: 'r1', fechaEnvio: '2026-09-01' }]]), movs, { hoy: '2026-09-18', diasDeVelocidad: 30 })
  comprobar('quedan 20', r.quedan, 20)
  comprobar('velocidad 0,33/dia', r.velocidad, 0.33)
  comprobar('cobertura 60 dias', r.diasDeCobertura, 60)
}

console.log('\n=== 9. La llegada confirmada manda sobre la fecha de envio ===')
{
  const rem = new Map<string, Remesa>([['r1', { id: 'r1', fechaEnvio: '2026-09-01', fechaLlegada: '2026-09-12' }]])
  const r = repartirSku('XXXXX', [{ remesaId: 'r1', sku: 'XXXXX', unidades: 3 }], rem, [venta('2026-09-05', 2)], { hoy: '2026-09-18' })
  comprobar('la venta del dia 5 no consume una remesa que llego el 12', r.quedan, 3)
  comprobar('queda sin atribuir', r.sinAtribuir, 2)
}

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} COMPROBACIONES FALLIDAS\n`)
process.exit(fallos === 0 ? 0 : 1)
