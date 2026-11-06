import { construirInforme as construir, dinero as dineroConNbsp, fechaCorta, modoDe, nombreCorto, porcentaje } from '@/lib/comisiones-puente/informe-cliente'

/** El formato usa el espacio duro entre la cifra y el € (para que no se parta en dos líneas): en las pruebas se compara con espacio normal */
const sinDuro = (t: string) => t.replace(/\u00a0/g, ' ')
const dinero = (v: number, m?: string) => sinDuro(dineroConNbsp(v, m))
const construirInforme = (e: Parameters<typeof construir>[0]) => JSON.parse(sinDuro(JSON.stringify(construir(e)))) as ReturnType<typeof construir>

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL INFORME DEL CLIENTE, UN ESCENARIO POR CONCEPTO.
 *
 * Los números están hechos para que se puedan comprobar con un lápiz. Lo que se vigila es que cada cliente salga con SUS
 * columnas, que los totales del pie cuadren con el resumen, y que no aparezca un «=» donde la cuenta no cuadra.
 */

console.log('\n=== formato ===')
ok('cuatro cifras con punto de miles', dinero(3145.29) === '3.145,29 €', dinero(3145.29))
ok('cinco cifras', dinero(18628.54) === '18.628,54 €', dinero(18628.54))
ok('negativo', dinero(-12.5) === '-12,50 €', dinero(-12.5))
ok('libras', dinero(136.38, 'GBP') === '136,38 £', dinero(136.38, 'GBP'))
ok('porcentaje', porcentaje(0.075) === '7,5 %' && porcentaje(0.05) === '5 %')
ok('fecha de Amazon', fechaCorta('20-Sept-2026 UTC') === '20/09/2026' && fechaCorta('21-Aug-2026 UTC') === '21/08/2026', fechaCorta('21-Aug-2026 UTC'))
ok('nombre corto', nombreCorto('Producto X, 5 piezas, negro') === 'Producto X' && nombreCorto('') === '—')

/* ------------------------------------------------------------------ */
console.log('\n=== % sobre la base neta con IVA aparte (Lenobotics) ===')
{
  const filas = [
    { asin: 'A1', productTitle: 'Uno', grossSales: 1000, refunds: 100, netBase: 700, commission: 21, commissionRate: 0.03 },
    { asin: 'A2', productTitle: 'Dos', grossSales: 500, refunds: 0, netBase: 400, commission: 4, commissionRate: 0.01 },
  ]
  const d = { summary: { totalSales: 1500, totalRefunds: 100, realTurnover: 1400, totalIva: 300, netBase: 1100, totalCommission: 25, averageCommissionRate: 25 / 1100, totalOrders: 2 }, rows: filas }
  const i = construirInforme({ cliente: 'Lenobotics', periodo: 'Octubre 2026', data: d })
  ok('modo estándar', i.modo === 'estandar' && modoDe(d) === 'estandar')
  ok('la cadena incluye el IVA porque cuadra (1.400 − 300 = 1.100)', i.calculo.pasos.some((p) => p.texto === 'IVA'), JSON.stringify(i.calculo.pasos.map((p) => p.texto)))
  ok('varias tasas: se explica producto a producto', (i.calculo.nota ?? '').includes('3 %') && (i.calculo.nota ?? '').includes('1 %'))
  ok('el total del pie cuadra con la comisión', i.detalle?.total?.[6] === '25,00 €', i.detalle?.total?.join(';'))
  ok('cada fila tiene tantas celdas como columnas', i.detalle!.filas.every((f) => f.length === i.detalle!.columnas.length))
  ok('ordenado por comisión, la mayor primero', i.detalle!.filas[0][0] === 'Uno')
}
{
  // Una base que NO cuadra con ventas − devoluciones ni con el IVA: no se escribe ningún «=» inventado
  const d = { summary: { totalSales: 1000, totalRefunds: 100, totalIva: 0, netBase: 500, totalCommission: 25, averageCommissionRate: 0.05, totalOrders: 1 }, rows: [{ asin: 'A', productTitle: 'P', grossSales: 1000, refunds: 100, netBase: 500, commission: 25, commissionRate: 0.05 }] }
  const i = construirInforme({ cliente: 'X', periodo: 'Octubre 2026', data: d })
  ok('si no cuadra, solo se enseña la base, sin cadena', i.calculo.pasos[0].texto === 'Base neta (sin IVA)', i.calculo.pasos.map((p) => p.texto).join('|'))
}

/* ------------------------------------------------------------------ */
console.log('\n=== líneas de Amazon con dos monedas (Ham Master) ===')
{
  const linea = (o: Record<string, unknown>) => ({ transactionTypeLabel: 'Venta', date: '28-Sept-2026 UTC', orderId: 'X', asin: 'A', productTitle: 'P', grossSales: 0, refunds: 0, commissionRate: 0.05, iva: 0, ...o })
  const filas = [
    linea({ currency: 'EUR', baseProductNet: 100, baseShippingNet: 0, promoNet: 0, netLine: 100, netBase: 100, commission: 5, taxAmount: 21 }),
    linea({ currency: 'GBP', baseProductNet: 40, baseShippingNet: 0, promoNet: 0, netLine: 40, netBase: 40, commission: 2, taxAmount: 0 }),
  ]
  const d = {
    summary: {
      totalSales: 140, totalRefunds: 0, netBase: 140, totalIva: 21, totalCommission: 7, averageCommissionRate: 0.05, totalOrders: 2,
      byCurrency: {
        EUR: { currency: 'EUR', unitsGross: 1, unitsNet: 1, netBase: 100, iva: 21, totalInclusive: 121, commission: 5 },
        GBP: { currency: 'GBP', unitsGross: 1, unitsNet: 1, netBase: 40, iva: 0, totalInclusive: 40, commission: 2 },
      },
    },
    rows: filas,
  }
  const i = construirInforme({ cliente: 'Ham Master', periodo: 'Octubre 2026', data: d })
  ok('modo líneas', i.modo === 'lineas')
  ok('resumen por moneda con las dos monedas', i.tablas[0]?.filas.length === 2 && i.tablas[0].filas[1][0] === 'GBP')
  ok('avisa de que los totales mezclan monedas', i.avisos.some((a) => a.includes('EUR, GBP')))
  ok('con dos monedas no hay fila de totales que las mezcle', i.detalle!.total === undefined)
  ok('la fecha sale legible', i.detalle!.filas[0][0] === '28/09/2026', i.detalle!.filas[0][0])
  ok('las libras llevan su símbolo', i.detalle!.filas[1][4] === '40,00 £', i.detalle!.filas[1][4])
}

/* ------------------------------------------------------------------ */
console.log('\n=== Shoplamp: excedente sobre la base acordada ===')
{
  const filas = [
    { transactionTypeLabel: 'Venta', currency: 'EUR', date: '01-Oct-2026 UTC', orderId: 'O1', baseProductNet: 3000, baseShippingNet: 0, promoNet: 0, netLine: 3000, netBase: 3000, taxAmount: 630, commission: 150, commissionRate: 0.05, grossSales: 3000, refunds: 0 },
    { transactionTypeLabel: 'Venta', currency: 'EUR', date: '02-Oct-2026 UTC', orderId: 'O2', baseProductNet: 1500, baseShippingNet: 0, promoNet: 0, netLine: 1500, netBase: 1500, taxAmount: 315, commission: 75, commissionRate: 0.05, grossSales: 1500, refunds: 0 },
  ]
  const d = { summary: { totalSales: 4500, totalRefunds: 0, netBase: 4500, totalIva: 945, baselineAmount: 3500, excessAmount: 1000, totalCommission: 50, averageCommissionRate: 0.05, totalOrders: 2, byCurrency: { EUR: { currency: 'EUR', unitsGross: 2, unitsNet: 2, netBase: 4500, iva: 945, totalInclusive: 5445, commission: 50 } } }, rows: filas }
  const i = construirInforme({ cliente: 'SHOPLAMP', periodo: 'Octubre 2026', data: d })
  ok('modo baseline', i.modo === 'baseline')
  ok('la fórmula sale de los números (4.500 − 3.500 = 1.000 × 5 % = 50)', i.calculo.pasos.map((p) => p.valor).join('|') === '4.500,00 €|− 3.500,00 €|1.000,00 €|5 %|50,00 €', i.calculo.pasos.map((p) => p.valor).join('|'))
  ok('NO hay columna de comisión por línea (daría 225 € en vez de 50 €)', !i.detalle!.columnas.some((c) => c.id === 'comision') && i.detalle!.filas.every((f) => f.length === i.detalle!.columnas.length))
  ok('la tabla por moneda tampoco la lleva', !i.tablas[0].columnas.some((c) => c.id === 'comision') && i.tablas[0].filas[0].length === i.tablas[0].columnas.length)
  ok('el pie del detalle suma la base', i.detalle!.total!.includes('4.500,00 €'), i.detalle!.total!.join(';'))
  const sin = construirInforme({ cliente: 'S', periodo: 'M', data: { ...d, summary: { ...d.summary, netBase: 3000, excessAmount: 0, totalCommission: 0 } } })
  ok('si no se llega a la base acordada se dice', (sin.calculo.nota ?? '').includes('no supera'))
}

/* ------------------------------------------------------------------ */
console.log('\n=== excedente sobre el año anterior (ShoesF, Garrachón) ===')
{
  // Los pedidos repiten el año anterior de SU referencia: 100 € de la referencia A en cada uno de sus dos pedidos
  const filas = [
    { asin: 'SKU-A', rowNumber: 1, previousYearNetBase: 100, currentYearNetBase: 60, netBase: 60, grossSales: 60, refunds: 0, commissionRate: 0, commission: 0 },
    { asin: 'SKU-A', rowNumber: 2, previousYearNetBase: 100, currentYearNetBase: 90, netBase: 90, grossSales: 90, refunds: 0, commissionRate: 0, commission: 0 },
    { asin: 'SKU-B', rowNumber: 3, previousYearNetBase: 0, currentYearNetBase: 50, netBase: 50, grossSales: 50, refunds: 0, commissionRate: 0, commission: 0 },
  ]
  const d = {
    summary: {
      totalSales: 200, totalRefunds: 0, netBase: 200, totalIva: 0, previousYearNetBase: 160, currentYearNetBase: 200, excessAmount: 40, commissionRateUsed: 0.03, averageCommissionRate: 0.03, totalCommission: 1.2, totalOrders: 3,
      calculationBreakdown: {
        previousYear: { netBase: 160, grossProduct: 170, grossShipping: 0, refundsProduct: 10, refundsShipping: 0 },
        currentYear: { netBase: 200, grossProduct: 205, grossShipping: 0, refundsProduct: 5, refundsShipping: 0 },
      },
      byJurisdiction: { SPAIN: { jurisdiction: 'SPAIN', previousYearNetBase: 160, currentYearNetBase: 200, excessAmount: 40 } },
    },
    rows: filas,
  }
  const i = construirInforme({ cliente: 'ShoesF', periodo: 'Diciembre 2025', data: d })
  ok('modo comparación anual', i.modo === 'comparacion_anual')
  ok('una fila por referencia, no por pedido (2 + la que solo vendió el año pasado)', i.detalle!.filas.length === 3, String(i.detalle!.filas.length))
  const a = i.detalle!.filas.find((f) => f[0] === 'SKU-A')!
  ok('SKU-A: año anterior una vez (100) y año actual sumando sus pedidos (150)', a[1] === '100,00 €' && a[2] === '150,00 €', a.join(';'))
  ok('lo que solo vendió el año anterior cuadra la columna (60 €)', i.detalle!.filas[2][0].startsWith('Referencias que solo vendieron') && i.detalle!.filas[2][1] === '60,00 €', i.detalle!.filas[2].join(';'))
  ok('el pie suma lo mismo que la base de arriba', i.detalle!.total!.join(';') === 'Total;160,00 €;200,00 €;40,00 €', i.detalle!.total!.join(';'))
  ok('la comisión es el 3 % del excedente', i.principal.valor === '1,20 €' && i.calculo.pasos[2].valor === '40,00 €')
  ok('de dónde sale cada base: 4 conceptos y su base neta', i.tablas[0].filas.length === 4 && i.tablas[0].total![1] === '160,00 €')
  ok('no se enseña qué tipos de transacción se suman o ignoran', !JSON.stringify(i).toLowerCase().includes('shipment') && !JSON.stringify(i).includes('Transaction'))
}

/* ------------------------------------------------------------------ */
console.log('\n=== sobre el beneficio (Creative Toys, DIRU) ===')
{
  const filas = [{ asin: 'B1', productTitle: 'Juego', quantity: 2, grossSales: 100, refunds: 0, costOfGoods: 20, amazonFees: 30, adsSpend: 0, netProfit: 40, netBase: 40, margin: 0.4, commission: 3, commissionRate: 0.075 }]
  const d = { summary: { modoCalculo: 'beneficio', totalSales: 100, totalRefunds: 0, totalCostOfGoods: 20, totalAmazonFees: 30, totalAds: 0, totalBenefits: 40, netBase: 40, totalCommission: 3, commissionRateUsed: 0.075, averageCommissionRate: 0.075, totalOrders: 1 }, rows: filas }
  const i = construirInforme({ cliente: 'Creative Toys', periodo: 'Noviembre 2026', data: d })
  ok('modo beneficio', i.modo === 'beneficio')
  ok('cifras: ventas, devoluciones, costes y beneficio neto', i.cifras.map((c) => c.rotulo).join('|') === 'Ventas|Devoluciones|Costes|Beneficio neto', i.cifras.map((c) => c.rotulo).join('|'))
  ok('costes = producto + Amazon + publicidad', i.cifras[2].valor === '− 50,00 €')
  ok('columnas del detalle con coste, tarifas, publicidad y margen', i.detalle!.columnas.map((c) => c.titulo).join('|') === 'Producto|ASIN|Uds.|Ventas|Coste producto|Tarifas Amazon|Publicidad|Beneficio|Margen|Comisión')
  ok('la comisión es el % del beneficio', i.principal.detalle === '7,5 % del beneficio' && i.calculo.pasos[0].valor === '40,00 €')
  const simple = construirInforme({ cliente: 'DIRU', periodo: 'Abril 2026', data: { summary: { totalSales: 100, totalRefunds: 0, totalBenefits: 40, netBase: 40, totalCommission: 18, averageCommissionRate: 0.45, totalOrders: 1 }, rows: [{ asin: 'B', productTitle: 'P', grossSales: 100, refunds: 0, netBase: 40, commission: 18, commissionRate: 0.45 }] } })
  ok('DIRU/SAUSI: «Beneficio», no «Base neta sin IVA»', simple.modo === 'beneficio_simple' && simple.cifras[3].rotulo === 'Beneficio' && simple.detalle!.columnas[4].titulo === 'Beneficio')

  // El informe de pedidos de Sellerboard: una línea por venta, y una devolución suelta que no trae ni título ni unidades
  const venta = (asin: string, productTitle: string, beneficio: number) => ({ asin, productTitle, quantity: 1, grossSales: 30, refunds: 0, costOfGoods: 5, amazonFees: 10, adsSpend: 0, netProfit: beneficio, netBase: beneficio, margin: beneficio / 30, commission: beneficio * 0.1, commissionRate: 0.1 })
  const lineas = [
    venta('B2', 'Trivial Terror - Juego de mesa / Price: 30', 15),
    venta('B1', 'Trivial Harry Potter | Mundo mágico, Cultura COG: 2,63 / Price: 30', 10),
    venta('B1', 'Trivial Harry Potter | Mundo mágico, Cultura COG: 2,63 / Price: 30', 10),
    venta('B1', 'Otro título / Price: 0', 10),
    { asin: 'B1', grossSales: 0, refunds: 5, costOfGoods: 0, amazonFees: 0, adsSpend: 0, netProfit: -4, netBase: -4, commission: -0.4, commissionRate: 0.1 },
  ]
  const g = construirInforme({ cliente: 'Creative Toys', periodo: 'Noviembre 2026', data: { summary: { modoCalculo: 'beneficio', totalSales: 120, totalRefunds: 5, totalCostOfGoods: 20, totalAmazonFees: 40, totalAds: 0, totalBenefits: 41, netBase: 41, totalCommission: 4.1, commissionRateUsed: 0.1, totalOrders: 5 }, rows: lineas } })
  ok('una fila por producto, no por venta', g.detalle!.filas.length === 2 && g.detalle!.subtitulo === '2 productos', g.detalle!.subtitulo)
  ok('el de más comisión primero, con todo sumado', g.detalle!.filas[0].join('|') === 'Trivial Harry Potter|B1|3|90,00 €|− 15,00 €|− 30,00 €|—|26,00 €|28,89 %|2,60 €', g.detalle!.filas[0].join('|'))
  ok('el pie sigue dando lo mismo que el resumen', g.detalle!.total!.join('|') === 'Total||4|120,00 €|− 20,00 €|− 40,00 €|0,00 €|41,00 €||4,10 €', g.detalle!.total!.join('|'))
  ok('«Ventas» cuenta unidades, no líneas', g.cifras[0].nota === '4 unidades', g.cifras[0].nota)
  ok('buscador sin pedido ni fecha', g.detalle!.buscador === 'Buscar por producto o ASIN…')
  ok('nombre sin la cola de Sellerboard', nombreCorto('Juego COG: 3,25 / Price: 19,99') === 'Juego' && nombreCorto('Juego / Price: 34,99') === 'Juego' && nombreCorto('/ Price: 0') === '—')
}

/* ------------------------------------------------------------------ */
console.log('\n=== partido por marcas (Keslem) ===')
{
  const d = {
    modo: 'por_marca' as const, marca: 'KESLEM', catalogoReferencias: 1000, totalComision: 62.62,
    bloques: [
      { etiqueta: 'Marca propia (KESLEM)', anterior: 131.28, actual: -7.79, excedente: -139.07, tasa: 0.04, comision: 0 },
      { etiqueta: 'Terceros (arbitraje)', anterior: 7670.63, actual: 10801.85, excedente: 3131.22, tasa: 0.02, comision: 62.62 },
    ],
    sinUbicar: { anterior: 789.27, actual: 0, total: 9 },
  }
  const i = construirInforme({ cliente: 'Keslem', periodo: 'Septiembre 2026', data: d })
  ok('modo por marca, sin detalle de líneas', i.modo === 'por_marca' && i.detalle === null)
  ok('el total es la suma de los bloques', i.principal.valor === '62,62 €' && i.tablas[0].total![5] === '62,62 €')
  ok('un bloque en negativo no resta (sale 0 de excedente en la fórmula)', i.calculo.pasos[0].valor === '0,00 €')
  ok('lo que no se ha podido asignar se dice sin instrucciones internas', i.avisos[0].includes('9 referencias') && !i.avisos[0].toLowerCase().includes('sube el informe'))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
