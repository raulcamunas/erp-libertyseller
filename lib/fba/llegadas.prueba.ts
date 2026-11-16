import { caminoEsDudoso, esEnvioDudoso, llegadaPrevistaDeCamino, llegadasDeSku, transporteParaDudoso, type EntradaLlegadas } from './llegadas'
import type { PlazoEtapas } from './plan-tipos'

let fallos = 0
const ok = (n: string, real: unknown, esp: unknown) => {
  const bien = JSON.stringify(real) === JSON.stringify(esp)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${n}${bien ? '' : ` -> esperado ${JSON.stringify(esp)}, real ${JSON.stringify(real)}`}`)
}

const HOY = '2026-11-15'
const plazo = (o: Partial<PlazoEtapas> = {}): PlazoEtapas => ({
  preparacion: 7, transporte: 16, recepcion: 4, margen: 7,
  origen: { preparacion: 'partida', transporte: 'medido', recepcion: 'medido', margen: 'partida' },
  hastaLaVenta: 27, sinConfirmar: true, transporteUrgente: null,
  ...o,
})
const entrada = (o: Partial<EntradaLlegadas> = {}): EntradaLlegadas => ({
  sku: 'X', hoy: HOY, plazo: plazo(), caminoErp: [], entranteAmazon: 0, comprometido: [], hablados: [], transporteMediano: 16,
  ...o,
})

console.log('\n=== ENVÍO DUDOSO (esEnvioDudoso) ===')
ok('56 días, 0 recibidas, transporte 16 → dudoso (umbral 40)', esEnvioDudoso(56, 0, 16), true)
ok('35 días, 0 recibidas, transporte 16 → no (umbral 40)', esEnvioDudoso(35, 0, 16), false)
ok('56 días con algo recibido → no', esEnvioDudoso(56, 3, 16), false)
ok('sin transporte medido: umbral 30 → 31 días dudoso', esEnvioDudoso(31, 0, null), true)
ok('sin transporte medido: 30 días justos → no', esEnvioDudoso(30, 0, null), false)
ok('Portico transporte 60: 100 días → no (umbral 150)', esEnvioDudoso(100, 0, 60), false)

console.log('\n=== 23 bis · FBA15MH74MQB (Creative Toys): salió el 20 sep, IN_TRANSIT a 15 nov, 0 de 300 ===')
{
  const r = llegadasDeSku(entrada({
    sku: 'WM01550',
    caminoErp: [{ remesaId: 'r-sep', nombre: 'FBA15MH74MQB', fechaEnvio: '2026-09-20', estadoAmazon: 'IN_TRANSIT', pendiente: 120, recibidas: 0, enRecepcion: false }],
    entranteAmazon: 120,
  }))
  ok('una llegada, marcada dudosa', r.llegadas.map((l) => [l.origen, l.unidades, l.dudoso]), [['camino', 120, true]])
  ok('la llegada no es del pasado: hoy + recepción', r.llegadas[0].fecha, '2026-11-19')
  ok('guarda la fecha de salida para la frase', r.llegadas[0].fechaEnvio, '2026-09-20')
  ok('descartada como dudosa desde el 20 sep', r.descartadas, [{ unidades: 120, motivo: 'dudoso', nombre: 'FBA15MH74MQB', desde: '2026-09-20' }])
  ok('dudoso 120', r.dudoso, 120)
  ok('de camino 0 (lo dudoso no cuenta)', r.deCamino, 0)
  ok('el inbound de Amazon (que incluye ese envío) no sale como sin remesa', r.entranteSinRemesa, 0)
}

console.log('\n=== WM40297: 20 de camino real + 120 dudosas, Amazon da 140 entrantes ===')
{
  const r = llegadasDeSku(entrada({
    caminoErp: [
      { remesaId: 'r-sep', nombre: 'FBA15MH74MQB', fechaEnvio: '2026-09-20', estadoAmazon: 'IN_TRANSIT', pendiente: 120, recibidas: 0, enRecepcion: false },
      { remesaId: 'r-nov', nombre: 'Envío 10 nov', fechaEnvio: '2026-11-10', estadoAmazon: 'RECEIVING', pendiente: 20, recibidas: 40, enRecepcion: true },
    ],
    entranteAmazon: 140,
  }))
  ok('de camino 20, dudoso 120', [r.deCamino, r.dudoso], [20, 120])
  ok('la de recepción llega hoy + 4', r.llegadas.find((l) => l.remesaId === 'r-nov')?.fecha, '2026-11-19')
  ok('sin entrante sin remesa', r.entranteSinRemesa, 0)
}

console.log('\n=== 41 · Entrante sin remesa: 600 inbound en Amazon, 0 en el ERP (T7-0CG9-DSP7) ===')
{
  const r = llegadasDeSku(entrada({ sku: 'T7-0CG9-DSP7', entranteAmazon: 600 }))
  ok('de camino 600', r.deCamino, 600)
  ok('entrante sin remesa 600', r.entranteSinRemesa, 600)
  ok('llega hoy + transporte + recepción (16 + 4)', r.llegadas.map((l) => [l.origen, l.unidades, l.fecha, l.dudoso]), [['amazon_sin_remesa', 600, '2026-12-05', false]])
}
{
  const r = llegadasDeSku(entrada({
    sku: 'WM50531', entranteAmazon: 228,
    caminoErp: [{ remesaId: 'r1', nombre: 'Envío 8 nov', fechaEnvio: '2026-11-08', estadoAmazon: 'IN_TRANSIT', pendiente: 6, recibidas: 0, enRecepcion: false }],
  }))
  ok('WM50531: 228 en Amazon y 6 en el ERP → de camino 228, sin remesa 222', [r.deCamino, r.entranteSinRemesa], [228, 222])
  ok('la del ERP llega el 8 nov + 16 = 24 nov', r.llegadas.find((l) => l.origen === 'camino')?.fecha, '2026-11-24')
}
{
  const r = llegadasDeSku(entrada({
    entranteAmazon: 10,
    caminoErp: [{ remesaId: 'r1', nombre: null, fechaEnvio: '2026-11-08', estadoAmazon: 'SHIPPED', pendiente: 30, recibidas: 0, enRecepcion: false }],
  }))
  ok('ERP 30 y Amazon 10 → de camino 30 (máximo), sin remesa 0', [r.deCamino, r.entranteSinRemesa], [30, 0])
}

console.log('\n=== Llegada de camino con la fecha teórica pasada ===')
{
  const r = llegadasDeSku(entrada({
    caminoErp: [{ remesaId: 'r1', nombre: null, fechaEnvio: '2026-10-25', estadoAmazon: 'IN_TRANSIT', pendiente: 50, recibidas: 0, enRecepcion: false }],
  }))
  // 25 oct + 16 = 10 nov ya pasó → hoy + recepción; 21 días < 40: no es dudoso
  ok('max(10 nov, 19 nov) = 19 nov y no dudoso', [r.llegadas[0].fecha, r.llegadas[0].dudoso, r.deCamino], ['2026-11-19', false, 50])
}

console.log('\n=== Cobo: «Reposición de octubre» encajando desde el 30 oct ===')
{
  const r = llegadasDeSku(entrada({
    sku: '262 BURDEO/37 FBA',
    plazo: plazo({ preparacion: 7, transporte: 3, recepcion: 4 }),
    transporteMediano: 3,
    comprometido: [{ remesaId: 'd789', nombre: 'Reposición de octubre', estado: 'encajando', fechaEnvio: '2026-10-30', diasParada: 19, unidades: 12 }],
  }))
  // la fecha prevista (30 oct) ya pasó: sale como pronto hoy + ceil(7 × 0,5) = 19 nov; llega + 3 + 4 = 26 nov
  ok('llega desde hoy, no desde el 30 oct', r.llegadas.map((l) => [l.origen, l.unidades, l.fecha]), [['comprometido', 12, '2026-11-26']])
  ok('encajando cuenta aunque lleve 19 días parada', r.descartadas, [])
  ok('el comprometido no es «de camino»', r.deCamino, 0)
}
{
  const r = llegadasDeSku(entrada({
    comprometido: [{ remesaId: 'r2', nombre: 'Diciembre', estado: 'aprobada', fechaEnvio: '2026-12-01', diasParada: 2, unidades: 40 }],
  }))
  ok('aprobada con fecha futura: sale el 1 dic y llega + 20', r.llegadas[0].fecha, '2026-12-21')
}

console.log('\n=== 22 bis · Borrador parado 30 días ===')
{
  const r = llegadasDeSku(entrada({
    comprometido: [
      { remesaId: 'b1', nombre: 'Propuesta octubre', estado: 'borrador', fechaEnvio: '2026-10-20', diasParada: 30, unidades: 120 },
      { remesaId: 'b2', nombre: 'Propuesta nueva', estado: 'borrador', fechaEnvio: null, diasParada: 3, unidades: 15 },
    ],
  }))
  ok('el parado no llega; el nuevo sí (hoy + 7 + 16 + 4)', r.llegadas.map((l) => [l.remesaId, l.fecha]), [['b2', '2026-12-12']])
  ok('el parado sale como descartado desde el 16 oct', r.descartadas, [{ unidades: 120, motivo: 'propuesta_parada', nombre: 'Propuesta octubre', desde: '2026-10-16' }])
  ok('21 días justos ya no cuenta', llegadasDeSku(entrada({ comprometido: [{ remesaId: 'b', nombre: null, estado: 'borrador', fechaEnvio: null, diasParada: 21, unidades: 5 }] })).llegadas.length, 0)
  ok('lista parada 30 días sí cuenta', llegadasDeSku(entrada({ comprometido: [{ remesaId: 'l', nombre: null, estado: 'lista', fechaEnvio: null, diasParada: 30, unidades: 5 }] })).llegadas.length, 1)
}

console.log('\n=== Envíos hablados ===')
{
  const r = llegadasDeSku(entrada({
    hablados: [
      { envioPropuestoId: 'e1', salirAntesDe: '2026-12-01', unidades: 80 },
      { envioPropuestoId: 'e2', salirAntesDe: '2026-11-10', unidades: 20 },
      { envioPropuestoId: 'e3', salirAntesDe: '2026-12-01', unidades: 0 },
    ],
  }))
  ok('cuentan como envio_hablado, ordenados por fecha', r.llegadas.map((l) => [l.envioPropuestoId, l.origen, l.fecha]), [
    ['e2', 'envio_hablado', '2026-12-12'], // salir antes del 10 nov ya pasó: hoy + 7, + 20
    ['e1', 'envio_hablado', '2026-12-21'],
  ])
}

console.log('\n=== Portico (transporte 60 por plazo, sin medir) ===')
{
  const r = llegadasDeSku(entrada({
    plazo: plazo({ transporte: 60, recepcion: 7 }), transporteMediano: null,
    caminoErp: [{ remesaId: 'p1', nombre: null, fechaEnvio: '2026-10-01', estadoAmazon: 'IN_TRANSIT', pendiente: 100, recibidas: 0, enRecepcion: false }],
  }))
  ok('45 días con transporte de 60 no es dudoso; llega el 30 nov', [r.llegadas[0].dudoso, r.llegadas[0].fecha], [false, '2026-11-30'])
}

console.log('\n=== Remesa «lista» con el envío ya creado en Amazon (inboundWorking): no se cuenta dos veces ===')
{
  const r = llegadasDeSku(entrada({
    entranteAmazon: 120,
    comprometido: [{ remesaId: 'rl', nombre: 'Remesa 20 nov', estado: 'lista', fechaEnvio: null, diasParada: 1, unidades: 120 }],
  }))
  ok('entrante sin remesa 0', r.entranteSinRemesa, 0)
  ok('una sola llegada (la comprometida)', r.llegadas.map((l) => [l.origen, l.unidades]), [['comprometido', 120]])
  ok('de camino 0 (aún no ha salido)', r.deCamino, 0)
  const e = llegadasDeSku(entrada({
    entranteAmazon: 150,
    comprometido: [{ remesaId: 're', nombre: null, estado: 'encajando', fechaEnvio: null, diasParada: 0, unidades: 120 }],
  }))
  ok('encajando 120 con 150 entrantes: 30 sin remesa', [e.entranteSinRemesa, e.deCamino], [30, 30])
  const b = llegadasDeSku(entrada({
    entranteAmazon: 50,
    comprometido: [{ remesaId: 'rb', nombre: null, estado: 'borrador', fechaEnvio: null, diasParada: 1, unidades: 50 }],
  }))
  ok('un borrador no tiene envío en Amazon: el entrante sigue sin remesa', b.entranteSinRemesa, 50)
}

console.log('\nRegla única de «dudoso» y de la llegada (plan, «Hoy», Resumen global y detalle del envío)')
{
  ok('transporte para dudoso: el medido manda', transporteParaDudoso(10, 45), 10)
  ok('sin medida: el del plazo (manual o de partida)', transporteParaDudoso(null, 45), 45)
  ok('sin nada: null (umbral 30)', transporteParaDudoso(null, null), null)
  ok('Portico: 35 días sin recibir con transporte manual 45 → no dudoso', caminoEsDudoso({ fechaEnvio: '2026-10-11', recibidas: 0 }, HOY, null, 45), false)
  ok('el mismo con transporte medido 10 → dudoso', caminoEsDudoso({ fechaEnvio: '2026-10-11', recibidas: 0 }, HOY, 10, 45), true)
  ok('RECEIVING: hoy + recepción', llegadaPrevistaDeCamino({ estadoAmazon: 'receiving', fechaEnvio: '2026-10-01' }, HOY, { transporte: 45, recepcion: 5 }), '2026-11-20')
  ok('IN_TRANSIT: salida + transporte', llegadaPrevistaDeCamino({ estadoAmazon: 'IN_TRANSIT', fechaEnvio: '2026-10-11' }, HOY, { transporte: 45, recepcion: 5 }), '2026-11-25')
  ok('sin salida: hoy + transporte + recepción', llegadaPrevistaDeCamino({ estadoAmazon: 'WORKING', fechaEnvio: null }, HOY, { transporte: 10, recepcion: 5 }), '2026-11-30')
}

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
if (fallos > 0) process.exit(1)
