import { lotesDeEnvios, MAX_PUNTOS_CURVA } from '@/lib/fba/lotes-envio'
import { recepcionContada, repartirSku, type LineaRemesa, type Movimiento, type Remesa } from '@/lib/fba/fifo'
import type { LineaDePanel, PanelRemesas, RemesaDePanel } from '@/lib/fba/datos'
import type { EstadoRemesa } from '@/lib/fba/flujo'
import type { LoteEnvio } from '@/lib/fba/plan-tipos'

let fallos = 0
function comprobar(nombre: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado)
  if (!ok) fallos++
  console.log(`  ${ok ? 'OK  ' : 'FALLA'} ${nombre}${ok ? '' : `\n        esperado ${JSON.stringify(esperado)}\n        real     ${JSON.stringify(real)}`}`)
}

/* ------------------------------------------------------------------ */
/* Un panel como el de panelDeCliente, con el reparto de verdad         */
/* ------------------------------------------------------------------ */

interface DefRemesa {
  id: string
  nombre?: string | null
  fechaEnvio: string
  llegada?: string | null
  estadoAmazon?: string | null
  estado?: EstadoRemesa
  referenciaEnvio?: string | null
  lineas: Array<{ sku: string; unidades: number; recibidas?: number | null; nombre?: string }>
}

const DIA = 86_400_000
const mas = (f: string, n: number) => new Date(Date.parse(`${f}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10)

/** n unidades al día durante `dias` días desde `desde` */
function ventas(sku: string, desde: string, dias: number, n = 1): Movimiento[] {
  return Array.from({ length: dias }, (_, i) => ({ sku, fecha: mas(desde, i), tipo: 'Shipments', cantidad: -n }))
}

/** Lo mismo que hace panelDeCliente: reparte con fifo.ts solo las enviadas/cerradas y monta RemesaDePanel */
function panel(defs: DefRemesa[], movs: Movimiento[], hoy: string, leidoHasta: string | null = hoy): PanelRemesas {
  const estadoDe = (d: DefRemesa) => d.estado ?? 'cerrada'
  const reales = defs.filter((d) => ['enviada', 'cerrada'].includes(estadoDe(d)))
  const remesasFifo = new Map<string, Remesa>(
    reales.map((d) => [d.id, { id: d.id, fechaEnvio: d.fechaEnvio, fechaLlegada: d.llegada ?? null, recepcionContada: recepcionContada(d.estadoAmazon ?? null) }])
  )
  const skus = [...new Set(reales.flatMap((d) => d.lineas.map((l) => l.sku)))]
  const rep = new Map<string, ReturnType<typeof repartirSku>['lineas'][number]>()
  for (const sku of skus) {
    const suyas: LineaRemesa[] = reales.flatMap((d) =>
      d.lineas.filter((l) => l.sku === sku).map((l) => ({ remesaId: d.id, sku, unidades: l.unidades, recibidas: l.recibidas ?? null }))
    )
    for (const l of repartirSku(sku, suyas, remesasFifo, movs, { hoy }).lineas) rep.set(`${l.remesaId}|${sku}`, l)
  }
  const remesas: RemesaDePanel[] = defs.map((d) => {
    const lineas: LineaDePanel[] = d.lineas.map((l) => {
      const r = rep.get(`${d.id}|${l.sku}`)
      return {
        sku: l.sku, recibidas: l.recibidas ?? null, nombre: l.nombre ?? null, variante: null, asin: null, referencia: null,
        fnsku: null, ean: null, enviadas: l.unidades,
        consumidas: r?.consumidas ?? 0, devueltas: r?.devueltas ?? 0, quedan: r?.quedan ?? l.unidades,
        quedanVendibles: r?.quedanVendibles ?? l.unidades, retiradas: r?.retiradas ?? 0, mermas: r?.mermas ?? 0,
        agotadaEl: r?.agotadaEl ?? null, porDia: r?.porDia ?? {},
      }
    })
    return {
      id: d.id, nombre: d.nombre ?? null, fechaEnvio: d.fechaEnvio, llegadaAt: d.llegada ? `${d.llegada}T10:00:00+00:00` : null,
      referenciaEnvio: d.referenciaEnvio ?? null, nota: null, estadoAmazon: d.estadoAmazon ?? null, seguimientoAt: null,
      seguimientoError: null, estado: estadoDe(d), aprobadaAt: null, creadaAt: null, actualizadaAt: null, version: 1,
      reabiertaAt: null, ultimaImpresion: null, analisisIa: null, propuesta: null, envios: [],
      unidadesQueNoLlegaron: 0, lineas, eventos: [], ventasPorDia: [], cuentaDesde: (d.llegada ?? d.fechaEnvio).slice(0, 10),
      enviadas: lineas.reduce((s, l) => s + l.enviadas, 0), quedan: lineas.reduce((s, l) => s + l.quedan, 0),
      consumidoPct: 0, agotadaEl: null,
    }
  })
  return { clienteId: 'c1', cajasDe: null, conectado: true, hoy, remesas, skus: [], leidoHasta, ultimoError: null }
}

const lote = (lotes: LoteEnvio[], id: string) => {
  const l = lotes.find((x) => x.remesaId === id)
  if (!l) throw new Error(`falta el lote ${id}`)
  return l
}

/* ------------------------------------------------------------------ */
/* El cliente de ejemplo                                               */
/* ------------------------------------------------------------------ */

const HOY = '2026-07-25'
const LEIDO = '2026-07-20'

const defs: DefRemesa[] = [
  // Agotada: 100 ud, llega el 8 jun, 10/día → agotada el 17 jun
  { id: 'agotada', nombre: 'Junio', fechaEnvio: '2026-06-01', llegada: '2026-06-08', estadoAmazon: 'CLOSED', referenciaEnvio: 'FBA1', lineas: [{ sku: 'A', unidades: 100, recibidas: 100 }] },
  // Viva: 60 ud, llega el 28 jun, 2/día del 1 al 20 jul → quedan 20
  { id: 'viva', fechaEnvio: '2026-06-20', llegada: '2026-06-28', estadoAmazon: 'CLOSED', lineas: [{ sku: 'A', unidades: 60, recibidas: 60 }] },
  // Sin llegada: va de camino
  { id: 'camino', fechaEnvio: '2026-07-15', estadoAmazon: 'IN_TRANSIT', estado: 'enviada', lineas: [{ sku: 'A', unidades: 50, recibidas: 0 }] },
  // Con retiradas: 40 ud, 20 vendidas, 10 retiradas de golpe, 10 vendidas → agotada
  { id: 'retiradas', fechaEnvio: '2026-04-24', llegada: '2026-05-01', estadoAmazon: 'CLOSED', lineas: [{ sku: 'B', unidades: 40, recibidas: 40 }] },
  // Cerrado con 37 de 162 recibidas y sin fecha de llegada: cuenta desde el envío
  { id: 'faltan', nombre: 'FBA15MJ18ZCC', fechaEnvio: '2026-05-10', estadoAmazon: 'CLOSED', lineas: [{ sku: 'C', unidades: 162, recibidas: 37 }] },
  // Unidades que no llegaron en una línea y de más en otra: lo de más no compensa
  { id: 'cortas', fechaEnvio: '2026-07-01', llegada: '2026-07-06', estadoAmazon: 'CLOSED', lineas: [{ sku: 'X', unidades: 50, recibidas: 48 }, { sku: 'Y', unidades: 30, recibidas: 32 }] },
  // Una propuesta (borrador): no es un lote
  { id: 'borrador', fechaEnvio: '2026-07-30', estado: 'borrador', lineas: [{ sku: 'A', unidades: 80 }] },
]

const movs: Movimiento[] = [
  ...ventas('A', '2026-06-08', 10, 10),
  ...ventas('A', '2026-07-01', 20, 2),
  ...ventas('B', '2026-05-01', 20, 1),
  { sku: 'B', fecha: '2026-05-21', tipo: 'VendorReturns', cantidad: -10, disposicion: 'SELLABLE' },
  ...ventas('B', '2026-05-22', 10, 1),
  ...ventas('C', '2026-05-10', 37, 1),
  ...ventas('X', '2026-07-06', 10, 1),
]

const ritmo = new Map<string, number>([['A', 2], ['X', 1], ['Y', 0.5]])
const { lotes, resumen } = lotesDeEnvios(panel(defs, movs, HOY, LEIDO), ritmo, HOY)

console.log('\n=== 0. Solo envíos (enviada|cerrada), del más reciente al más antiguo ===')
comprobar('sin el borrador', lotes.map((l) => l.remesaId), ['camino', 'cortas', 'viva', 'agotada', 'faltan', 'retiradas'])

console.log('\n=== 1. Agotada ===')
{
  const l = lote(lotes, 'agotada')
  comprobar('cabecera', [l.nombre, l.referenciaEnvio, l.fechaEnvio, l.fechaLlegada, l.diasTransito, l.estadoAmazon, l.referencias], ['Junio', 'FBA1', '2026-06-01', '2026-06-08', 7, 'CLOSED', 1])
  comprobar('embudo', l.embudo, { enviadas: 100, noLlegaron: 0, recibidas: 100, vendidas: 100, retiradasYMermas: 0, devueltasVendibles: 0, quedanVendibles: 0, noVendibles: 0 })
  comprobar('hitos d50 4, d80 7, d100 9', l.hitos, { d50: 4, d80: 7, d100: 9 })
  comprobar('duró 9 días, sin estimar', [l.duracionDias, l.duracionEstimada, l.agotaraElEstimado, l.estimado], [9, null, null, false])
  comprobar('curva de 10 puntos que acaba en 100', [l.curva.length, l.curva[0], l.curva[9]], [10, { dia: 0, pctVendido: 10 }, { dia: 9, pctVendido: 100 }])
  comprobar('no está vivo', [l.vivo, l.porSku[0].loteVivo, l.porSku[0].d100], [false, false, 9])
}

console.log('\n=== 2. Viva (con estimación al ritmo del planificador) ===')
{
  const l = lote(lotes, 'viva')
  comprobar('embudo', [l.embudo.vendidas, l.embudo.quedanVendibles], [40, 20])
  // 30 vendidas (50 %) el 15 jul = día 17 desde el 28 jun; el 80 % (48) no ha llegado
  comprobar('hitos', l.hitos, { d50: 17, d80: null, d100: null })
  // Quedan 20 a 2 ud/día desde el 20 jul (donde llega el libro) → 30 jul, 32 días desde la llegada
  comprobar('estimada', [l.duracionDias, l.duracionEstimada, l.agotaraElEstimado, l.estimado], [null, 32, '2026-07-30', true])
  comprobar('la curva llega hasta el libro (22 días + el 0)', [l.curva.length, l.curva[l.curva.length - 1]], [23, { dia: 22, pctVendido: 66.7 }])
  comprobar('vivo y lote vivo de A', [l.vivo, l.porSku[0].loteVivo, l.porSku[0].estimada], [true, true, 32])
}

console.log('\n=== 3. Sin llegada: va de camino ===')
{
  const l = lote(lotes, 'camino')
  comprobar('sin llegada ni tránsito', [l.fechaLlegada, l.diasTransito], [null, null])
  comprobar('ni hitos, ni curva, ni duración', [l.hitos, l.curva.length, l.duracionDias, l.duracionEstimada], [{ d50: null, d80: null, d100: null }, 0, null, null])
  comprobar('no está vivo ni es el lote vivo', [l.vivo, l.porSku[0].loteVivo], [false, false])
  comprobar('lo de camino no se cuenta como «no llegaron»', l.embudo.noLlegaron, 0)
}

console.log('\n=== 4. Con retiradas: no son ventas ===')
{
  const l = lote(lotes, 'retiradas')
  comprobar('vendidas 30 y retiradas 10 aparte', [l.embudo.vendidas, l.embudo.retiradasYMermas, l.embudo.quedanVendibles], [30, 10, 0])
  // Sobre lo que se podía vender (30): el 50 % (15) se vende el 15 may = día 14; la retirada del 21 no adelanta nada
  comprobar('hitos sobre lo vendible', l.hitos, { d50: 14, d80: 24, d100: 30 })
  comprobar('agotada en 30 días', [l.duracionDias, l.vivo], [30, false])
  comprobar('por SKU', [l.porSku[0].vendidas, l.porSku[0].retiradasYMermas, l.porSku[0].quedan], [30, 10, 0])
  // La curva no salta el día de la retirada
  comprobar('curva el día 20 (retirada) igual que el 19', l.curva[20].pctVendido, l.curva[19].pctVendido)
}

console.log('\n=== 5. CLOSED con 37 de 162 recibidas ===')
{
  const l = lote(lotes, 'faltan')
  comprobar('embudo', [l.embudo.enviadas, l.embudo.noLlegaron, l.embudo.recibidas, l.embudo.vendidas], [162, 125, 37, 37])
  comprobar('sin llegada: cuenta desde el envío y no hay tránsito', [l.fechaLlegada, l.diasTransito, l.duracionDias], [null, null, 36])
}

console.log('\n=== 6. Unidades que no llegaron (lo de más no compensa) ===')
{
  const l = lote(lotes, 'cortas')
  comprobar('no llegaron 2, recibidas 80', [l.embudo.noLlegaron, l.embudo.recibidas], [2, 80])
  comprobar('vendidas 10 y quedan 70', [l.embudo.vendidas, l.embudo.quedanVendibles], [10, 70])
  // X: 38 a 1/día → 38 días desde el 20 jul; Y: 32 a 0,5 → 64. Ponderada: (38·38 + 32·64)/70 ≈ 49,9 → 9 sep
  comprobar('estimada ponderada por unidades', [l.agotaraElEstimado, l.duracionEstimada], ['2026-09-08', 64])
  comprobar('por SKU: el más vendido arriba', l.porSku.map((s) => [s.sku, s.recibidas, s.estimada, s.loteVivo]), [['X', 48, 52, true], ['Y', 32, 78, true]])
}

console.log('\n=== 7. Resumen del cliente ===')
// Agotados en los últimos 12 meses: 9 (agotada), 30 (retiradas), 36 (faltan) → mediana 30
comprobar('duración mediana 30', resumen.duracionMediana, 30)
// Tránsitos: 7 (agotada), 8 (viva), 7 (retiradas), 5 (cortas) → 7
comprobar('tránsito mediano 7', resumen.transitoMediano, 7)
// Contados: 100 + 60 + 40 + 162 + 80 = 442 enviadas; no llegaron 125 + 2 = 127 → 28,7 %
comprobar('% que no llega (ponderado)', resumen.pctNoLlegadoMedio, 28.7)
comprobar('vivos: viva y cortas', resumen.vivos, 2)
comprobar(
  'velocidad comparada (+ más rápido)',
  resumen.velocidadComparada,
  [
    { remesaId: 'cortas', pct: -53 },
    { remesaId: 'viva', pct: -6 },
    { remesaId: 'agotada', pct: 233 },
    { remesaId: 'faltan', pct: -17 },
    { remesaId: 'retiradas', pct: 0 },
  ]
)

console.log('\n=== 8. FIFO: el lote nuevo espera a que se acabe el viejo ===')
{
  const p = panel(
    [
      { id: 'e1', fechaEnvio: '2026-05-25', llegada: '2026-06-01', estadoAmazon: 'CLOSED', lineas: [{ sku: 'E', unidades: 30, recibidas: 30 }] },
      { id: 'e2', fechaEnvio: '2026-06-25', llegada: '2026-07-01', estadoAmazon: 'CLOSED', lineas: [{ sku: 'E', unidades: 30, recibidas: 30 }] },
    ],
    ventas('E', '2026-06-01', 20, 1),
    '2026-07-20'
  )
  const { lotes: ls, resumen: rs } = lotesDeEnvios(p, new Map([['E', 1]]), '2026-07-20')
  const e1 = lote(ls, 'e1')
  const e2 = lote(ls, 'e2')
  comprobar('e1 es el lote vivo y e2 no', [e1.porSku[0].loteVivo, e2.porSku[0].loteVivo], [true, false])
  // e1: quedan 10 → 10 días; e2: 10 delante + 30 → 40 días desde el 20 jul
  comprobar('e1 se agotará el 30 jul', e1.agotaraElEstimado, '2026-07-30')
  comprobar('e2 detrás: 29 ago', e2.agotaraElEstimado, '2026-08-29')
  comprobar('los dos vivos (tienen stock y han llegado)', rs.vivos, 2)
  comprobar('sin agotados no hay mediana ni comparación', [rs.duracionMediana, rs.velocidadComparada.length], [null, 0])
}

console.log('\n=== 9. La curva no pasa de 180 puntos ===')
{
  const p = panel(
    [{ id: 'g', fechaEnvio: '2025-08-01', llegada: '2025-08-05', estadoAmazon: 'CLOSED', lineas: [{ sku: 'G', unidades: 400, recibidas: 400 }] }],
    ventas('G', '2025-08-05', 300, 1),
    '2026-06-01'
  )
  const g = lotesDeEnvios(p, new Map([['G', 1]]), '2026-06-01').lotes[0]
  comprobar('180 puntos', g.curva.length, MAX_PUNTOS_CURVA)
  comprobar('d50 a los 199 días (fuera de la curva, pero se calcula)', g.hitos.d50, 199)
  comprobar('quedan 100 a 1/día', [g.vivo, g.agotaraElEstimado], [true, '2026-09-09'])
}

console.log('\n=== 10. Sin ritmo no se estima ===')
{
  const l = lotesDeEnvios(panel(defs, movs, HOY, LEIDO), new Map(), HOY).lotes.find((x) => x.remesaId === 'viva')!
  comprobar('sin estimación', [l.duracionEstimada, l.agotaraElEstimado, l.estimado, l.vivo], [null, null, false, true])
}

console.log('\n=== 11. Libro atrasado: la fecha estimada nunca antes de hoy ===')
{
  const l = lotesDeEnvios(panel(defs, movs, '2026-08-20', LEIDO), ritmo, '2026-08-20').lotes.find((x) => x.remesaId === 'viva')!
  comprobar('como pronto hoy', l.agotaraElEstimado, '2026-08-20')
}

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `${fallos} FALLOS`}\n`)
if (fallos > 0) process.exit(1)
