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
  { remesaId: 'r1', sku: 'XXXXX', unidades: 3, recibidas: null },
  { remesaId: 'r2', sku: 'XXXXX', unidades: 3, recibidas: null },
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
  const r = repartirSku('XXXXX', [{ remesaId: 'r1', sku: 'XXXXX', unidades: 30, recibidas: null }], new Map([['r1', { id: 'r1', fechaEnvio: '2026-09-01' }]]), movs, { hoy: '2026-09-18', diasDeVelocidad: 30 })
  comprobar('quedan 20', r.quedan, 20)
  comprobar('velocidad 0,33/dia', r.velocidad, 0.33)
  comprobar('cobertura 60 dias', r.diasDeCobertura, 60)
}

console.log('\n=== 9. La llegada confirmada manda sobre la fecha de envio ===')
{
  const rem = new Map<string, Remesa>([['r1', { id: 'r1', fechaEnvio: '2026-09-01', fechaLlegada: '2026-09-12' }]])
  const r = repartirSku('XXXXX', [{ remesaId: 'r1', sku: 'XXXXX', unidades: 3, recibidas: null }], rem, [venta('2026-09-05', 2)], { hoy: '2026-09-18' })
  comprobar('la venta del dia 5 no consume una remesa que llego el 12', r.quedan, 3)
  comprobar('queda sin atribuir', r.sinAtribuir, 2)
}


/* ------------------------------------------------------------------ */
/* Se reparte sobre lo RECIBIDO, no sobre lo declarado                  */
/* ------------------------------------------------------------------ */

console.log('\n=== 10. LO QUE AMAZON RECIBIO MANDA SOBRE LO QUE SE DECLARO ===')
{
  // recepcionContada: Amazon ya ha contado, asi que lo recibido manda
  const rem = new Map<string, Remesa>([
    ['r1', { id: 'r1', fechaEnvio: '2026-09-01', recepcionContada: true }],
  ])
  const vendidas80 = [venta('2026-09-05', 80)]

  // Se mandan 100, Amazon recibe 95 —una caja perdida— y se venden 80: quedan 15.
  // Contando sobre las 100 declaradas saldrian 20, y esas cinco de mas son un
  // fantasma que no se agota nunca y tapa el dia en que la referencia se queda
  // sin stock, que es para lo que sirve esta pantalla.
  const conRecibidas = repartirSku(
    'XXXXX', [{ remesaId: 'r1', sku: 'XXXXX', unidades: 100, recibidas: 95 }], rem, vendidas80,
    { hoy: '2026-10-01' }
  )
  comprobar('quedan 15 y no 20', conRecibidas.quedan, 15)
  comprobar('las enviadas que cuentan son 95', conRecibidas.lineas[0].enviadas, 95)

  // Mientras Amazon no contesta (null) se usa lo declarado, NO cero: un envio en
  // transito no ha recibido nada todavia, y tomarlo al pie de la letra diria
  // «agotada» de una remesa que va de camino.
  const sinRespuesta = repartirSku(
    'XXXXX', [{ remesaId: 'r1', sku: 'XXXXX', unidades: 100, recibidas: null }], rem, vendidas80,
    { hoy: '2026-10-01' }
  )
  comprobar('sin respuesta de Amazon, quedan 20', sinRespuesta.quedan, 20)

  // Y si Amazon recibio MENOS de lo vendido, la referencia esta agotada y lo que
  // sobra queda sin atribuir; nunca en negativo.
  const corto = repartirSku(
    'XXXXX', [{ remesaId: 'r1', sku: 'XXXXX', unidades: 100, recibidas: 70 }], rem, vendidas80,
    { hoy: '2026-10-01' }
  )
  comprobar('recibidas 70 y vendidas 80: quedan 0, no -10', corto.quedan, 0)
  comprobar('  y las 10 de mas quedan sin atribuir', corto.sinAtribuir, 10)
  comprobar('  y la linea queda marcada como agotada', corto.lineas[0].agotadaEl !== null, true)
}


/* ------------------------------------------------------------------ */
/* El CERO de un envio en transito NO es «no queda nada»                */
/* ------------------------------------------------------------------ */

console.log('\n=== 11. UN ENVIO EN CAMINO NO ESTA AGOTADO ===')
{
  // La pasada nocturna pregunta por los envios vivos —WORKING, SHIPPED— y Amazon
  // contesta QuantityReceived = 0: no ha llegado el momento de contar. Ese cero
  // se guarda en unidades_recibidas de verdad. Si el reparto lo toma al pie de
  // la letra, una remesa que va en el camion sale AGOTADA.
  const enCamino = new Map<string, Remesa>([
    ['r1', { id: 'r1', fechaEnvio: '2026-09-01', recepcionContada: false }],
  ])
  const r = repartirSku(
    'XXXXX', [{ remesaId: 'r1', sku: 'XXXXX', unidades: 100, recibidas: 0 }], enCamino, [],
    { hoy: '2026-09-18' }
  )
  comprobar('en transito con recibidas=0: quedan las 100 declaradas', r.quedan, 100)
  comprobar('  y NO sale agotada', r.lineas[0].agotadaEl, null)

  // En cuanto Amazon empieza a contar, manda lo recibido. Mismo cero, otra lectura.
  const recibiendo = new Map<string, Remesa>([
    ['r1', { id: 'r1', fechaEnvio: '2026-09-01', recepcionContada: true }],
  ])
  const r2 = repartirSku(
    'XXXXX', [{ remesaId: 'r1', sku: 'XXXXX', unidades: 100, recibidas: 0 }], recibiendo, [],
    { hoy: '2026-09-18' }
  )
  comprobar('ya recibiendo y Amazon dice 0: quedan 0', r2.quedan, 0)

  const r3 = repartirSku(
    'XXXXX', [{ remesaId: 'r1', sku: 'XXXXX', unidades: 100, recibidas: 95 }], recibiendo,
    [venta('2026-09-05', 80)], { hoy: '2026-09-18' }
  )
  comprobar('ya recibiendo, 95 de 100 y vendidas 80: quedan 15', r3.quedan, 15)
}

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} COMPROBACIONES FALLIDAS\n`)
process.exit(fallos === 0 ? 0 : 1)
