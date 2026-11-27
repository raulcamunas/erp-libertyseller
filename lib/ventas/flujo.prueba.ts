import { construirFlujo, leerApuntesCsv, type PagoAmazon } from './flujo'

let fallos = 0
const ok = (que: string, c: boolean, detalle = '') => {
  console.log(`  ${c ? 'OK   ' : 'FALLA'} ${que}${c ? '' : ` -> ${detalle}`}`)
  if (!c) fallos++
}
const pago = (grupo: string, inicio: string, fin: string | null, importe: number, extra: Partial<PagoAmazon> = {}): PagoAmazon => ({ grupo, inicio, fin, fechaPago: fin, abierto: fin == null, importe, importeOriginal: importe, moneda: 'EUR', estadoPago: 'Succeeded', oculto: false, ...extra })

console.log('=== los periodos son las liquidaciones ===')
{
  const pagos = [
    pago('g1', '2026-10-01', '2026-10-14', 1000),
    pago('g1b', '2026-10-01', '2026-10-15', -0.86, { moneda: 'GBP', importeOriginal: -0.75 }),
    pago('g2', '2026-10-16', '2026-10-28', 2000),
    pago('g3', '2026-10-29', null, 500),
  ]
  const apuntes = [
    { id: 'm1', fecha: '2026-10-05', descripcion: 'Capital', tipo: 'inversion' as const, importe: 10000 },
    { id: 'm2', fecha: '2026-10-20', descripcion: 'Mercancía', tipo: 'compra' as const, importe: -3000 },
  ]
  const f = construirFlujo(pagos, apuntes, '2026-11-03', 2)
  // Tramos de 14 días anclados al 28/10 (fin del último pago): 01–14/10 · 15–28/10 · 29/10–11/11 (abierto, hoy dentro) · 2 de pronóstico
  ok('tramos de 14 días anclados al último pago', JSON.stringify(f.map((p) => [p.desde, p.hasta])) === JSON.stringify([['2026-10-01', '2026-10-14'], ['2026-10-15', '2026-10-28'], ['2026-10-29', '2026-11-11'], ['2026-11-12', '2026-11-25'], ['2026-11-26', '2026-12-09']]), JSON.stringify(f.map((p) => [p.desde, p.hasta])))
  ok('primer tramo: inversión y el pago del 14', f[0].porTipo.inversion === 10000 && f[0].porTipo.pago === 1000, JSON.stringify(f[0].porTipo))
  ok('el pago en libras (fin el 15) va al segundo y dice su importe', f[1].entradas.some((e) => e.descripcion.includes('-0,75 GBP')))
  ok('efectivo al final del segundo: 10000 + 999,14 + 2000 − 3000', f[1].efectivo === 9999.14, String(f[1].efectivo))
  ok('el abierto es pronóstico con su saldo', f[2].previsto && f[2].porTipo.pago === 500 && !f[1].previsto)
  ok('los siguientes llevan la media de los pagos (1000 y 1999,14)', f[3].porTipo.pago === 1499.57 && f[4].porTipo.pago === 1499.57, JSON.stringify(f[3].porTipo))
  ok('diferencia = suma del periodo', f[1].diferencia === -1000.86, String(f[1].diferencia))
  const sinPronostico = construirFlujo(pagos, apuntes, '2026-11-03', 0)
  ok('sin pronóstico solo queda el abierto', sinPronostico.length === 3, String(sinPronostico.length))
  const oculto = construirFlujo(pagos.map((p) => (p.grupo === 'g2' ? { ...p, oculto: true } : p)), [], '2026-11-03', 0)
  ok('un pago borrado no cuenta', !oculto.some((p) => p.entradas.some((e) => e.ref === 'g2')))
}

console.log('=== liquidaciones cada 2-3 días no se encadenan ===')
{
  const pagos = ['2026-01-02', '2026-01-04', '2026-01-06', '2026-01-08', '2026-01-10', '2026-01-12'].map((f, i) => pago(`c${i}`, f, f, 100))
  const f = construirFlujo(pagos, [], '2026-01-20', 0)
  ok('seis pagos en un tramo de 14 días: un periodo, no seis', f.filter((p) => !p.previsto).length === 1 && f[0].porTipo.pago === 600, JSON.stringify(f.map((p) => [p.desde, p.hasta, p.porTipo.pago])))
}

console.log('=== sin pagos todavía ===')
{
  const f = construirFlujo([], [{ id: 'x', fecha: '2026-11-01', descripcion: 'IVA 3T', tipo: 'iva', importe: -800 }], '2026-11-27', 1)
  ok('sale el periodo con el apunte', f.some((p) => p.porTipo.iva === -800) && f[f.length - 1].efectivo === -800)
}

console.log('=== importar apuntes ===')
{
  const r = leerApuntesCsv('Fecha;Descripción;Tipo;Importe\n31/10/2026;IVA 3T;IVA;-1.234,50\n2026-11-02;Préstamo;Inversiones;5000\nmal;x;y;z')
  ok('dos buenos y uno malo', r.apuntes.length === 2 && r.errores === 1, JSON.stringify(r))
  ok('fecha, tipo e importe', r.apuntes[0].fecha === '2026-10-31' && r.apuntes[0].tipo === 'iva' && r.apuntes[0].importe === -1234.5)
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTODO BIEN')
if (fallos) process.exit(1)
