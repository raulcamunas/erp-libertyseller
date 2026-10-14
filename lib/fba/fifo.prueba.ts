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

console.log('\n=== 3. Un ajuste que RESTA es una merma: consume ===')
{
  const movs = [venta('2026-09-15', 4), { sku: 'XXXXX', fecha: '2026-09-16', tipo: 'Adjustments', cantidad: -1 } as Movimiento]
  const r = repartirSku('XXXXX', lineas, remesas, movs, { hoy: '2026-09-18' })
  comprobar('quedan 1 (6 - 4 - 1)', r.quedan, 1)
  comprobar('y esa unidad cuenta como merma, no como venta', r.lineas.map((l) => l.mermas), [0, 1])
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

console.log('\n=== 4. LO VENDIDO DÍA A DÍA DE CADA REMESA ===')
{
  const movs: Movimiento[] = [
    venta('2026-09-12', 2),
    venta('2026-09-13', 3), // r1 solo tenía 3: se agota con 1 de este día y el resto cae en r2
    { sku: 'XXXXX', fecha: '2026-09-14', tipo: 'CustomerReturns', cantidad: 1 },
  ]
  const r = repartirSku('XXXXX', lineas, remesas, movs, { hoy: '2026-09-18' })
  comprobar('r1 vendió 2 el día 12 y 1 el día 13', r.lineas[0].porDia, { '2026-09-12': 2, '2026-09-13': 1 })
  comprobar('r2 vendió 2 el día 13 menos la devolución del 14', r.lineas[1].porDia, { '2026-09-13': 2, '2026-09-14': -1 })
  comprobar('la suma de días es lo consumido (r2)', Object.values(r.lineas[1].porDia).reduce((x, y) => x + y, 0), r.lineas[1].consumidas)
  comprobar('sin ventas no hay días', repartirSku('XXXXX', lineas, remesas, [], { hoy: '2026-09-18' }).lineas[0].porDia, {})
}

/* ------------------------------------------------------------------ */
/* Los ajustes van con su signo                                         */
/* ------------------------------------------------------------------ */

const ajuste = (fecha: string, cantidad: number, disposicion: string, motivo = ''): Movimiento =>
  ({ sku: 'XXXXX', fecha, tipo: 'Adjustments', cantidad, disposicion, motivo } as Movimiento)
const devolucion = (fecha: string, n: number, disposicion: string): Movimiento => ({ sku: 'XXXXX', fecha, tipo: 'CustomerReturns', cantidad: n, disposicion })
const retirada = (fecha: string, n: number, disposicion: string): Movimiento => ({ sku: 'XXXXX', fecha, tipo: 'VendorReturns', cantidad: -n, disposicion })

console.log('\n=== 12. UN AJUSTE QUE SUMA NO CONSUME: es una unidad que aparece ===')
{
  // Antes se leían todos con valor absoluto: una unidad ENCONTRADA restaba otra más.
  // En los datos reales 25 de los 49 ajustes suman.
  const movs = [venta('2026-09-15', 4), ajuste('2026-09-16', 1, 'SELLABLE', 'F')]
  const r = repartirSku('XXXXX', lineas, remesas, movs, { hoy: '2026-09-18' })
  comprobar('6 - 4 + 1 = 3', r.quedan, 3)
  comprobar('no se ha perdido nada: 0 mermas', r.lineas.map((l) => l.mermas), [0, 0])
}

console.log('\n=== 13. UNA MERMA ENCONTRADA DESPUÉS SE COMPENSA, no se queda como pérdida ===')
{
  const movs = [ajuste('2026-09-15', -2, 'SELLABLE', 'M'), ajuste('2026-09-20', 1, 'SELLABLE', 'F')]
  const r = repartirSku('XXXXX', lineas, remesas, movs, { hoy: '2026-09-25' })
  comprobar('6 - 2 + 1 = 5', r.quedan, 5)
  comprobar('queda 1 merma neta', r.lineas.map((l) => l.mermas), [1, 0])
}

console.log('\n=== 14. UNA PAREJA DE AJUSTES QUE SE ANULAN NO TOCA NADA (da igual el orden) ===')
{
  // O -1 y F +1 el mismo día: Amazon descuenta y repone la misma unidad.
  const a = repartirSku('XXXXX', lineas, remesas, [ajuste('2026-09-15', -1, 'SELLABLE', 'O'), ajuste('2026-09-15', 1, 'SELLABLE', 'F')], { hoy: '2026-09-18' })
  const b = repartirSku('XXXXX', lineas, remesas, [ajuste('2026-09-15', 1, 'SELLABLE', 'F'), ajuste('2026-09-15', -1, 'SELLABLE', 'O')], { hoy: '2026-09-18' })
  comprobar('quedan 6 en un orden', a.quedan, 6)
  comprobar('quedan 6 en el otro', b.quedan, 6)
  comprobar('y ni una merma', [...a.lineas, ...b.lineas].map((l) => l.mermas), [0, 0, 0, 0])
}

console.log('\n=== 15. UN CAMBIO DE ESTADO (Q y P) mueve unidades entre vendibles e inservibles, sin cambiar el total ===')
{
  // Una devolución llega DEFECTIVE; después Amazon la reclasifica como vendible:
  // Q resta de DEFECTIVE y P suma a SELLABLE.
  const base = [venta('2026-09-15', 5), devolucion('2026-09-16', 1, 'DEFECTIVE')]
  const antes = repartirSku('XXXXX', lineas, remesas, base, { hoy: '2026-09-20' })
  comprobar('antes: quedan 2 y solo 1 vendible', [antes.lineas[1].quedan, antes.lineas[1].quedanVendibles], [2, 1])

  const q = ajuste('2026-09-17', -1, 'DEFECTIVE', 'Q')
  const p = ajuste('2026-09-17', 1, 'SELLABLE', 'P')
  for (const [nombre, orden] of [['Q y luego P', [q, p]], ['P y luego Q', [p, q]]] as const) {
    const r = repartirSku('XXXXX', lineas, remesas, [...base, ...orden], { hoy: '2026-09-20' })
    comprobar(`${nombre}: el total no cambia (2)`, r.lineas[1].quedan, 2)
    comprobar(`${nombre}: pero ahora las 2 se pueden vender`, r.lineas[1].quedanVendibles, 2)
    comprobar(`${nombre}: ni merma ni retirada`, [r.lineas[1].mermas, r.lineas[1].retiradas], [0, 0])
  }

  // Y al revés: una vendible que se daña (Q resta de SELLABLE, P suma a DEFECTIVE)
  const r2 = repartirSku('XXXXX', lineas, remesas, [ajuste('2026-09-15', -1, 'SELLABLE', 'Q'), ajuste('2026-09-15', 1, 'DEFECTIVE', 'P')], { hoy: '2026-09-18' })
  comprobar('vendible que se daña: el total sigue en 6', r2.quedan, 6)
  comprobar('  pero se pueden vender 5', r2.quedanVendibles, 5)
}

console.log('\n=== 16. RETIRAR UNA DEVOLUCIÓN DAÑADA NO LA RESTA DOS VECES ===')
{
  // Se vende, vuelve dañada, y se retira del almacén. Antes seguía marcada como
  // inservible aunque ya no estuviera, y las vendibles salían una unidad por debajo.
  const movs = [venta('2026-09-15', 5), devolucion('2026-09-16', 1, 'DEFECTIVE'), retirada('2026-09-18', 1, 'DEFECTIVE')]
  const r = repartirSku('XXXXX', lineas, remesas, movs, { hoy: '2026-09-20' })
  comprobar('quedan 1 en r2 (3 enviadas - 1 vendida - 1 retirada)', r.lineas[1].quedan, 1)
  comprobar('y esa 1 se puede vender', r.lineas[1].quedanVendibles, 1)
  comprobar('ya no queda ninguna inservible', r.lineas[1].devueltasNoVendibles, 0)
  comprobar('la retirada cuenta como retirada', r.lineas[1].retiradas, 1)
}

console.log('\n=== 17. UNA VENTA NO SE LLEVA UNA UNIDAD INSERVIBLE ===')
{
  const una = new Map<string, Remesa>([['r1', { id: 'r1', fechaEnvio: '2026-09-01' }]])
  const l1: LineaRemesa[] = [{ remesaId: 'r1', sku: 'XXXXX', unidades: 3, recibidas: null }]
  // Las 3 se venden, vuelve 1 dañada: queda 1 en el almacén pero no se puede vender.
  const movs = [venta('2026-09-10', 3), devolucion('2026-09-11', 1, 'DEFECTIVE'), venta('2026-09-12', 1)]
  const r = repartirSku('XXXXX', l1, una, movs, { hoy: '2026-09-20' })
  comprobar('la dañada sigue en el almacén', r.quedan, 1)
  comprobar('no se puede vender', r.quedanVendibles, 0)
  comprobar('la venta del 12 no ha cabido en ningún sitio: sin atribuir', r.sinAtribuir, 1)
  comprobar('la remesa está agotada para vender', r.lineas[0].agotadaEl !== null, true)
}

console.log('\n=== 18. LOS DÍAS DE STOCK CUENTAN SOLO LO QUE SE PUEDE VENDER ===')
{
  const una = new Map<string, Remesa>([['r1', { id: 'r1', fechaEnvio: '2026-09-01' }]])
  const l1: LineaRemesa[] = [{ remesaId: 'r1', sku: 'XXXXX', unidades: 30, recibidas: null }]
  // 10 ventas en 30 días (0,33/día), y una devolución dañada: 21 en el almacén, 20 vendibles.
  const ventas = Array.from({ length: 10 }, (_, i) => venta(`2026-09-${String(i + 5).padStart(2, '0')}`, 1))
  const r = repartirSku('XXXXX', l1, una, [...ventas, devolucion('2026-09-16', 1, 'CUSTOMER_DAMAGED')], { hoy: '2026-09-18', diasDeVelocidad: 30 })
  comprobar('quedan 21 y vendibles 20', [r.quedan, r.quedanVendibles], [21, 20])
  comprobar('cobertura sobre las 20 vendibles: 60 días, no 63', r.diasDeCobertura, 60)
}

console.log('\n=== 19. TODO LO QUE NO SEA SELLABLE ES INSERVIBLE, no solo tres estados ===')
{
  for (const d of ['DEFECTIVE', 'CUSTOMER_DAMAGED', 'CARRIER_DAMAGED', 'WAREHOUSE_DAMAGED', 'EXPIRED']) {
    const r = repartirSku('XXXXX', lineas, remesas, [venta('2026-09-15', 5), devolucion('2026-09-16', 1, d)], { hoy: '2026-09-18' })
    comprobar(`${d} no es vendible`, r.lineas[1].quedanVendibles, 1)
  }
  const sinDato = repartirSku('XXXXX', lineas, remesas, [venta('2026-09-15', 5), { sku: 'XXXXX', fecha: '2026-09-16', tipo: 'CustomerReturns', cantidad: 1 } as Movimiento], { hoy: '2026-09-18' })
  comprobar('sin disposición se da por vendible', sinDato.lineas[1].quedanVendibles, 2)
}

console.log('\n=== 20. VENTAS, RETIRADAS Y MERMAS SE CUENTAN POR SEPARADO ===')
{
  const una = new Map<string, Remesa>([['r1', { id: 'r1', fechaEnvio: '2026-09-01' }]])
  const l1: LineaRemesa[] = [{ remesaId: 'r1', sku: 'XXXXX', unidades: 10, recibidas: null }]
  const movs = [venta('2026-09-05', 4), retirada('2026-09-06', 2, 'SELLABLE'), ajuste('2026-09-07', -1, 'SELLABLE', 'M')]
  const r = repartirSku('XXXXX', l1, una, movs, { hoy: '2026-09-18' })
  comprobar('salen 7 en total', r.lineas[0].consumidas, 7)
  comprobar('2 retiradas y 1 merma (el resto, 4, son ventas)', [r.lineas[0].retiradas, r.lineas[0].mermas], [2, 1])
  comprobar('quedan 3', r.quedan, 3)
}

console.log('\n=== 21. LA VELOCIDAD NO SE INFLA CON AJUSTES QUE SUMAN ===')
{
  const una = new Map<string, Remesa>([['r1', { id: 'r1', fechaEnvio: '2026-08-01' }]])
  const l1: LineaRemesa[] = [{ remesaId: 'r1', sku: 'XXXXX', unidades: 100, recibidas: null }]
  // 30 ventas en 30 días: 1 por día. Diez unidades encontradas no son ventas.
  const ventas = Array.from({ length: 30 }, (_, i) => venta(`2026-09-${String(i + 1).padStart(2, '0')}`, 1))
  const r = repartirSku('XXXXX', l1, una, [...ventas, ajuste('2026-09-10', 10, 'SELLABLE', 'F')], { hoy: '2026-09-30', diasDeVelocidad: 30 })
  comprobar('velocidad 1/día, no 1,33', r.velocidad, 1)
}

console.log('\n=== 22. UNA UNIDAD ENCONTRADA COMPENSA ANTES LA VENTA QUE NO TENÍA LOTE ===')
{
  // Caso real (FBA047768-42, mayo): entra 1, se vende 1, el mismo día que otra venta sin stock
  // Amazon apunta un ajuste +1 que la repone. Antes se deshacía la venta del lote y quedaba
  // una unidad que no existe.
  const una = new Map<string, Remesa>([['r1', { id: 'r1', fechaEnvio: '2026-09-01' }]])
  const l1: LineaRemesa[] = [{ remesaId: 'r1', sku: 'XXXXX', unidades: 1, recibidas: null }]
  const movs = [venta('2026-09-10', 1), venta('2026-09-15', 1), ajuste('2026-09-15', 1, 'SELLABLE', 'F')]
  const r = repartirSku('XXXXX', l1, una, movs, { hoy: '2026-09-20' })
  comprobar('quedan 0: no sobra nada en la remesa', r.quedan, 0)
  comprobar('y no queda nada sin atribuir', r.sinAtribuir, 0)
}

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} COMPROBACIONES FALLIDAS\n`)
process.exit(fallos === 0 ? 0 : 1)
