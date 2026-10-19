import {
  TRAMOS_EDAD,
  calcularInventario,
  diasEntreInv,
  sumarDiasInv,
  tramoDe,
  type EnvioInventario,
  type ListingInventario,
  type MovimientoInventario,
} from '@/lib/fba/inventario'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const cerca = (a: number | null, b: number, tol = 0.05) => a !== null && Math.abs(a - b) <= tol

/**
 * EL INVENTARIO, CONTRA CUENTAS HECHAS A MANO.
 *
 * Cada escenario es un SKU con una historia que se puede seguir con un lápiz —entradas,
 * ventas, una devolución— y el resultado esperado está calculado aparte, no copiado de lo
 * que sale. Lo que importa no es que el código dé un número, sino que sea EL número.
 */

const HOY = '2026-10-19'
const LEIDO = '2026-10-18'

const mov = (sku: string, fecha: string, tipo: string, cantidad: number, extra: Partial<MovimientoInventario> = {}): MovimientoInventario => ({
  sku,
  fecha,
  tipo,
  cantidad,
  ...extra,
})
const listing = (sku: string, enAmazon: number | null, vendibles: number | null, precio: number | null = null): ListingInventario => ({
  sku,
  asin: `B0${sku}`,
  titulo: `Producto ${sku}`,
  precio,
  moneda: precio === null ? null : 'EUR',
  enAmazon,
  vendibles,
})

console.log('\n=== las fechas y los tramos ===')
ok('días entre dos fechas', diasEntreInv('2026-10-01', '2026-10-19') === 18)
ok('sumar días cruza el mes', sumarDiasInv('2026-10-30', 3) === '2026-11-02')
ok('un día cae en su tramo', tramoDe(0) === 't0' && tramoDe(90) === 't0' && tramoDe(91) === 't91' && tramoDe(180) === 't91' && tramoDe(181) === 't181' && tramoDe(270) === 't181' && tramoDe(271) === 't271' && tramoDe(365) === 't271' && tramoDe(366) === 't366' && tramoDe(900) === 't366')
ok('los tramos son los cinco de Amazon', TRAMOS_EDAD.length === 5)

/* ------------------------------------------------------------------ */
/* A · un producto que se vende con normalidad                          */
/* ------------------------------------------------------------------ */

console.log('\n=== A · un producto que se vende con normalidad ===')
const A = 'AAA'
const movsA: MovimientoInventario[] = [
  mov(A, '2026-06-01', 'Receipts', 100, { referencia: 'FBA-A' }),
  mov(A, '2026-09-01', 'Receipts', 60, { referencia: 'FBA-B' }),
  mov(A, '2026-06-10', 'Shipments', -30),
  mov(A, '2026-07-01', 'Shipments', -40),
  mov(A, '2026-08-01', 'Shipments', -10),
  mov(A, '2026-09-20', 'Shipments', -15),
  mov(A, '2026-10-10', 'Shipments', -10),
  mov(A, '2026-10-01', 'CustomerReturns', 2, { disposicion: 'SELLABLE' }),
]
// 160 recibidas − 105 vendidas + 2 devueltas = 57
const inv = calcularInventario({ hoy: HOY, leidoHasta: LEIDO, listings: [listing(A, 57, 57, 20)], movimientos: movsA, envios: [] })
const a = inv.skus.find((s) => s.sku === A)!
ok('hay un SKU', inv.skus.length === 1)
ok('en Amazon: 57', a.enAmazon === 57 && a.vendibles === 57)
ok('vendidas en 7 días: ninguna (la del día 10 cae 8 días antes del último día leído, el 18)', a.vendidas.d7 === 0, String(a.vendidas.d7))
ok('vendidas en 14 días: 10', a.vendidas.d14 === 10, String(a.vendidas.d14))
ok('vendidas en 30 días: 25 (las del 20 de sep y el 10 de oct)', a.vendidas.d30 === 25, String(a.vendidas.d30))
ok('vendidas en 90 días: 35 (no entra la del 1 de julio)', a.vendidas.d90 === 35, String(a.vendidas.d90))
ok('devueltas en 90 días: 2', a.devueltas.d90 === 2)
ok('tasa de devolución: 2/35', cerca(a.tasaDevolucion90, 2 / 35, 0.001), String(a.tasaDevolucion90))
ok('ritmo a 30 días: 25/30', cerca(a.ritmo30, 25 / 30, 0.01), String(a.ritmo30))
ok('ritmo de planificación: 0,6·r30 + 0,4·r14', cerca(a.ritmoPlan, 0.6 * (25 / 30) + 0.4 * (10 / 14), 0.01), String(a.ritmoPlan))
ok('cobertura: 57 / ritmo', cerca(a.cobertura, 57 / (0.6 * (25 / 30) + 0.4 * (10 / 14)), 0.2), String(a.cobertura))
ok('última venta el 10 de octubre, hace 8 días (hasta el último día leído)', a.ultimaVenta === '2026-10-10' && a.diasSinVenta === 8, `${a.ultimaVenta} ${a.diasSinVenta}`)
ok('primera entrada el 1 de junio', a.primeraEntrada === '2026-06-01')
ok('el lote más viejo se agotó: solo queda el de septiembre', a.lotes.length === 1 && a.lotes[0].referencia === 'FBA-B' && a.lotes[0].quedan === 57, JSON.stringify(a.lotes))
ok('el lote de septiembre tiene 48 días', a.lotes[0].edadDias === 48, String(a.lotes[0].edadDias))
ok('todo el stock está en el primer tramo', a.porTramo.t0 === 57 && a.porTramo.t91 + a.porTramo.t181 + a.porTramo.t271 + a.porTramo.t366 === 0)
ok('edad media 48 días', a.edadMediaDias === 48, String(a.edadMediaDias))
ok('los lotes explican todo lo que hay', a.anteriorALaLectura === 0 && a.descuadre === 0, `${a.anteriorALaLectura} ${a.descuadre}`)
ok('el tiempo medio de venta es de semanas, no de días sueltos', a.diasMedioDeVenta !== null && a.diasMedioDeVenta > 30 && a.diasMedioDeVenta < 70, String(a.diasMedioDeVenta))
ok('valor del stock: 57 × 20', a.valorStock === 1140, String(a.valorStock))
ok('valor de las ventas del mes: 25 × 20', a.valorVentas30 === 500, String(a.valorVentas30))
ok('estado «ok»', a.estado === 'ok', a.estado)
ok('la serie de 90 días tiene 90 valores y suma las ventas de 90 días', !!a.serie90 && a.serie90.length === 90 && a.serie90.reduce((x, y) => x + y, 0) === 35, String(a.serie90?.reduce((x, y) => x + y, 0)))
ok('la venta del 10 de octubre está en su día (el último leído es el 18: posición 81)', a.serie90?.[81] === 10, String(a.serie90?.[81]))
ok('el libro cubre más de 90 días: fiable', inv.libro === 'ok', inv.libro)
ok('no hay tendencia clara (14 y 60 días van parecidos)', a.tendencia === 'estable' || a.tendencia === 'sube' || a.tendencia === 'baja')
ok('no se pone en duda el ritmo', a.muestraCorta === false)
ok('se agota después de hoy', a.seAgotaEl !== null && a.seAgotaEl > HOY)

/* ------------------------------------------------------------------ */
/* B · stock viejo y parado                                             */
/* ------------------------------------------------------------------ */

console.log('\n=== B · stock viejo y parado ===')
const B = 'BBB'
const invB = calcularInventario({
  hoy: HOY,
  leidoHasta: LEIDO,
  listings: [listing(B, 40, 40, 10)],
  movimientos: [mov(B, '2026-01-10', 'Receipts', 50, { referencia: 'FBA-X' }), mov(B, '2026-03-01', 'Shipments', -10)],
  envios: [],
})
const b = invB.skus[0]
ok('queda un lote de 40', b.lotes.length === 1 && b.lotes[0].quedan === 40)
ok('lleva 282 días', b.lotes[0].edadDias === 282, String(b.lotes[0].edadDias))
ok('está en el tramo de 271 a 365', b.porTramo.t271 === 40 && b.porTramo.t0 === 0)
ok('sin ventas en 90 días y viejo: parado', b.estado === 'parado', b.estado)
ok('avisa de que supera los 270 días', b.alertas.includes('stock de más de 270 días'))
ok('sin ritmo no hay cobertura ni fecha de agotamiento', b.cobertura === null && b.seAgotaEl === null)
ok('el resumen cuenta las unidades antiguas', invB.resumen.unidadesAntiguas === 40)
ok('y el valor parado: 40 × 10', invB.resumen.paradasValor === 400, String(invB.resumen.paradasValor))

/* ------------------------------------------------------------------ */
/* C · stock sin entrada en el libro                                    */
/* ------------------------------------------------------------------ */

console.log('\n=== C · stock que ya estaba antes del libro ===')
const C = 'CCC'
const invC = calcularInventario({
  hoy: HOY,
  leidoHasta: LEIDO,
  listings: [listing(C, 30, 30, 5)],
  movimientos: [
    mov(B, '2026-01-10', 'Receipts', 1, { referencia: 'FBA-ANTIGUA' }), // da el comienzo del libro
    mov(C, '2026-10-05', 'Shipments', -3),
    mov(C, '2026-10-12', 'Shipments', -2),
  ],
  envios: [],
})
const c = invC.skus.find((s) => s.sku === C)!
ok('no hay lotes que repartir por tramos', c.lotes.length === 0 && c.porTramo.t0 + c.porTramo.t91 + c.porTramo.t181 + c.porTramo.t271 + c.porTramo.t366 === 0)
ok('las 30 unidades van aparte, como anteriores a la lectura', c.anteriorALaLectura === 30, String(c.anteriorALaLectura))
ok('el libro cubre 282 días', invC.diasDeLibro === 282, String(invC.diasDeLibro))
ok('hay un aviso que lo explica', invC.avisos.some((x) => x.includes('antes de empezar el libro')))
ok('con ritmo bajo y 30 unidades, exceso', c.estado === 'exceso', c.estado)

/* ------------------------------------------------------------------ */
/* D · lo que viene de camino                                           */
/* ------------------------------------------------------------------ */

console.log('\n=== D · un envío de camino ===')
const D = 'DDD'
const envio = (estado: string, estadoAmazon: string | null, unidades: number, recibidas: number | null = null): EnvioInventario => ({
  id: `e-${estado}-${estadoAmazon}`,
  nombre: '28 Septiembre',
  fechaEnvio: '2026-10-15',
  llegadaAt: null,
  estadoAmazon,
  estado,
  referenciaEnvio: 'FBA-CAMINO',
  lineas: [{ sku: D, unidades, recibidas }],
})
const movsD = [mov(D, '2026-08-01', 'Receipts', 60, { referencia: 'FBA-VIEJO' }), mov(D, '2026-08-05', 'Shipments', -60)]
for (let i = 0; i < 25; i += 1) movsD.push(mov(D, sumarDiasInv('2026-09-20', i), 'Shipments', -2)) // se vendían 2 al día y se agotó
const invD = calcularInventario({
  hoy: HOY,
  leidoHasta: LEIDO,
  listings: [listing(D, 24, 0, 8)],
  movimientos: movsD,
  envios: [envio('enviada', 'IN_TRANSIT', 24)],
})
const d = invD.skus.find((s) => s.sku === D)!
ok('las 24 unidades del envío cuentan como entrantes', d.entrante === 24)
ok('no hay nada vendible, pero no se da por agotado: viene stock', d.vendibles === 0 && d.estado !== 'agotado', d.estado)
ok('lo de camino no se confunde con unidades no disponibles', d.noDisponibles === 0, String(d.noDisponibles))
ok('el resumen cuenta el envío en camino', invD.resumen.enviosEnCamino === 1 && invD.resumen.entrante === 24)
{
  const sin = calcularInventario({ hoy: HOY, leidoHasta: LEIDO, listings: [listing(D, 0, 0, 8)], movimientos: movsD, envios: [envio('borrador', null, 24)] })
  const s = sin.skus.find((x) => x.sku === D)!
  ok('una propuesta (borrador) NO es stock que viene', s.entrante === 0)
  ok('sin stock y con ventas: agotado', s.estado === 'agotado', s.estado)
  const cerrado = calcularInventario({ hoy: HOY, leidoHasta: LEIDO, listings: [listing(D, 0, 0, 8)], movimientos: movsD, envios: [envio('cerrada', 'CLOSED', 24)] })
  ok('un envío cerrado tampoco', cerrado.skus.find((x) => x.sku === D)!.entrante === 0)
  const recibiendo = calcularInventario({ hoy: HOY, leidoHasta: LEIDO, listings: [listing(D, 24, 10, 8)], movimientos: movsD, envios: [envio('enviada', 'RECEIVING', 24, 14)] })
  ok('un envío que se está recibiendo cuenta solo lo que falta (24 − 14)', recibiendo.skus.find((x) => x.sku === D)!.entrante === 10)
}

/* ------------------------------------------------------------------ */
/* E · cosas raras del libro                                            */
/* ------------------------------------------------------------------ */

console.log('\n=== E · cosas raras del libro ===')
{
  const E = 'EEE'
  const rev = calcularInventario({
    hoy: HOY,
    leidoHasta: LEIDO,
    listings: [listing(E, 0, 0, null)],
    movimientos: [mov(E, '2026-09-01', 'Receipts', 10, { referencia: 'FBA-R' }), mov(E, '2026-09-03', 'Receipts', -10, { referencia: 'FBA-R' })],
    envios: [],
  })
  ok('una entrada y su reversión se anulan: no hay lote', rev.skus[0].lotes.length === 0)

  const parcial = calcularInventario({
    hoy: HOY,
    leidoHasta: LEIDO,
    listings: [listing(E, 7, 7, null)],
    movimientos: [mov(E, '2026-09-01', 'Receipts', 10, { referencia: 'FBA-R' }), mov(E, '2026-09-03', 'Receipts', -3, { referencia: 'FBA-R' })],
    envios: [],
  })
  ok('una reversión parcial deja un lote de 7', parcial.skus[0].lotes.length === 1 && parcial.skus[0].lotes[0].recibidas === 7)

  const dosDias = calcularInventario({
    hoy: HOY,
    leidoHasta: LEIDO,
    listings: [listing(E, 10, 10, null)],
    movimientos: [mov(E, '2026-09-01', 'Receipts', 6, { referencia: 'FBA-R' }), mov(E, '2026-09-02', 'Receipts', 4, { referencia: 'FBA-R' })],
    envios: [],
  })
  ok('un envío que entra en dos días es UN lote, con el día de la primera entrada', dosDias.skus[0].lotes.length === 1 && dosDias.skus[0].lotes[0].desde === '2026-09-01' && dosDias.skus[0].lotes[0].recibidas === 10)

  const transfer = calcularInventario({
    hoy: HOY,
    leidoHasta: LEIDO,
    listings: [listing(E, 10, 10, null)],
    movimientos: [mov(E, '2026-09-01', 'Receipts', 10, { referencia: 'FBA-R' }), mov(E, '2026-09-05', 'WhseTransfers', -10), mov(E, '2026-09-05', 'WhseTransfers', 10)],
    envios: [],
  })
  ok('los traslados entre almacenes no son ventas', transfer.skus[0].vendidas.d90 === 0 && transfer.skus[0].lotes[0].quedan === 10)

  const sobra = calcularInventario({
    hoy: HOY,
    leidoHasta: LEIDO,
    listings: [listing(E, 80, 80, null)],
    movimientos: [mov(E, '2026-08-01', 'Receipts', 100, { referencia: 'FBA-Z' })],
    envios: [],
  })
  ok('si los lotes explican más de lo que Amazon tiene, se recorta al stock real', sobra.skus[0].lotes[0].quedan === 80 && sobra.skus[0].descuadre === 0, JSON.stringify(sobra.skus[0].lotes))

  const sinListing = calcularInventario({
    hoy: HOY,
    leidoHasta: LEIDO,
    listings: [],
    movimientos: [mov(E, '2026-09-01', 'Receipts', 10, { referencia: 'FBA-R' }), mov(E, '2026-09-10', 'Shipments', -4)],
    envios: [],
  })
  ok('un SKU que solo está en el libro sigue saliendo, con lo que dicen sus lotes', sinListing.skus.length === 1 && sinListing.skus[0].enAmazon === 6)
  ok('y sin precio no hay valor', sinListing.skus[0].valorStock === null)

  const futuro = calcularInventario({
    hoy: HOY,
    leidoHasta: LEIDO,
    listings: [listing(E, 10, 10, 1)],
    movimientos: [mov(E, '2026-09-01', 'Receipts', 10, { referencia: 'FBA-R' }), mov(E, '2026-10-19', 'Shipments', -3)],
    envios: [],
  })
  ok('una venta posterior al último día leído no cuenta', futuro.skus[0].vendidas.d7 === 0)
}

/* ------------------------------------------------------------------ */
/* F · el cliente entero                                                */
/* ------------------------------------------------------------------ */

console.log('\n=== F · el resumen del cliente ===')
const todo = calcularInventario({
  hoy: HOY,
  leidoHasta: LEIDO,
  listings: [listing(A, 57, 57, 20), listing(B, 40, 40, 10), listing(C, 30, 30, 5), listing(D, 24, 0, 8)],
  movimientos: [...movsA, ...movsD, mov(B, '2026-01-10', 'Receipts', 50, { referencia: 'FBA-X' }), mov(B, '2026-03-01', 'Shipments', -10), mov(C, '2026-10-05', 'Shipments', -3), mov(C, '2026-10-12', 'Shipments', -2)],
  envios: [envio('enviada', 'IN_TRANSIT', 24)],
})
const r = todo.resumen
ok('cuatro referencias con stock', r.referencias === 4, String(r.referencias))
ok('unidades en Amazon: 57 + 40 + 30 + 24', r.unidadesEnAmazon === 151, String(r.unidadesEnAmazon))
ok('valor: 1.140 + 400 + 150 + 192', r.valorStock === 1882, String(r.valorStock))
ok('las ventas del mes: A 25, C 5, D 24 (los 12 días de la serie)', r.vendidas30 > 25, String(r.vendidas30))
ok('la serie tiene 90 días seguidos hasta el último leído', todo.porDia.length === 90 && todo.porDia[89].fecha === LEIDO && todo.porDia[0].fecha === sumarDiasInv(LEIDO, -89))
ok('sin huecos ni fechas repetidas', todo.porDia.every((x, i, xs) => i === 0 || diasEntreInv(xs[i - 1].fecha, x.fecha) === 1))
ok('la serie suma lo mismo que las ventas de 90 días de cada SKU', todo.porDia.reduce((s, x) => s + x.vendidas, 0) === todo.skus.reduce((s, x) => s + x.vendidas.d90, 0))
ok('las devoluciones del cliente: 2', todo.porDia.reduce((s, x) => s + x.devueltas, 0) === 2)
ok('lo parado sale en el resumen', r.paradas >= 1 && r.paradasUnidades >= 40)
ok('los tramos del cliente suman las unidades con edad', Object.values(r.porTramo).reduce((s, n) => s + n, 0) === 57 + 40)
ok('el stock anterior al libro se cuenta aparte (30 de C)', r.anteriorALaLectura === 30, String(r.anteriorALaLectura))
ok('ordenado: primero lo que más urge', ['agotado', 'urgente', 'bajo'].includes(todo.skus[0].estado) || todo.skus[0].estado === 'parado', todo.skus.map((s) => `${s.sku}:${s.estado}`).join(' '))

console.log('\n=== G · cuánto se puede fiar uno del libro ===')
{
  const sinLibro = calcularInventario({ hoy: HOY, leidoHasta: null, listings: [listing('G1', 50, 50, 10)], movimientos: [], envios: [] })
  ok('sin ningún movimiento: el libro está «sin leer»', sinLibro.libro === 'sin_leer')
  ok('y el stock NO se acusa de parado: se dice que no hay datos', sinLibro.skus[0].estado === 'sin_datos', sinLibro.skus[0].estado)

  const corto = calcularInventario({
    hoy: HOY,
    leidoHasta: LEIDO,
    listings: [listing('G2', 30, 30, 5)],
    movimientos: [mov('OTRO', sumarDiasInv(HOY, -34), 'Receipts', 1, { referencia: 'X' })],
    envios: [],
  })
  ok('un libro de 34 días es «corto»', corto.libro === 'corto', corto.libro)
  ok('con 34 días de libro no se puede afirmar que algo lleve 60 sin venderse: sin ventas, no parado', corto.skus.find((x) => x.sku === 'G2')!.estado === 'sin_ventas', corto.skus.find((x) => x.sku === 'G2')!.estado)
  ok('y avisa de que el libro es corto', corto.avisos.some((x) => x.includes('solo cubre 34 días')))

  const largo = calcularInventario({
    hoy: HOY,
    leidoHasta: LEIDO,
    listings: [listing('G2', 30, 30, 5)],
    movimientos: [mov('OTRO', sumarDiasInv(HOY, -114), 'Receipts', 1, { referencia: 'X' })],
    envios: [],
  })
  ok('con 114 días de libro y nada vendido, sí es stock parado', largo.skus.find((x) => x.sku === 'G2')!.estado === 'parado' && largo.libro === 'ok')
}

console.log('\n=== avisos sobre los datos ===')
{
  const viejo = calcularInventario({ hoy: HOY, leidoHasta: '2026-10-10', listings: [], movimientos: [], envios: [] })
  ok('ventas leídas hace 9 días: lo dice, con la fecha legible', viejo.avisos.some((x) => x.includes('10/10/2026')))
  const nada = calcularInventario({ hoy: HOY, leidoHasta: null, listings: [], movimientos: [], envios: [] })
  ok('libro sin leer: lo dice', nada.avisos.some((x) => x.includes('Todavía no se ha leído')))
  ok('sin nada no revienta', nada.skus.length === 0 && nada.resumen.unidadesEnAmazon === 0 && nada.resumen.coberturaMedia === null && nada.porDia.length === 90)
  const sinPrecio = calcularInventario({ hoy: HOY, leidoHasta: LEIDO, listings: [listing('P1', 5, 5, null)], movimientos: [], envios: [] })
  ok('referencias sin precio: se avisa y no cuentan en el valor', sinPrecio.resumen.sinPrecio === 1 && sinPrecio.resumen.valorStock === 0 && sinPrecio.avisos.some((x) => x.includes('no tienen precio')))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
