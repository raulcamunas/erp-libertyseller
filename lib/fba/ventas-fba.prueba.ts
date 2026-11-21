import { ventasFba, lunesDe, porSemanaDe, sumarDias, type MovimientoVenta } from '@/lib/fba/ventas-fba'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * VENTAS FBA (spec §6.3 y §11 D36; caso 61).
 */

const HOY = '2026-11-15'
const venta = (sku: string, fecha: string, ud: number, pais?: string | null): MovimientoVenta =>
  ({ sku, fecha, tipo: 'Shipments', disposicion: 'SELLABLE', cantidad: -ud, ...(pais !== undefined ? { pais } : {}) })
const mov = (sku: string, fecha: string, tipo: string, cantidad: number): MovimientoVenta => ({ sku, fecha, tipo, disposicion: 'SELLABLE', cantidad })

console.log('\n=== solo cuentan los Shipments ===')
{
  const movs = [
    venta('A', '2026-11-15', 2),
    venta('A', '2026-11-10', 3),
    mov('A', '2026-11-12', 'CustomerReturns', 1),
    mov('A', '2026-11-12', 'Receipts', 120),
    mov('A', '2026-11-12', 'Adjustments', -4),
    mov('A', '2026-11-12', 'VendorReturns', -6),
    venta('B', '2026-11-14', 1),
  ]
  const v = ventasFba(movs, new Map([['A', 10], ['B', 25]]), HOY, 7, '2025-01-01')
  ok('periodo de 7 días del 9 al 15 nov', v.desde === '2026-11-09' && v.hasta === HOY && v.porDia.length === 7, `${v.desde}..${v.hasta}`)
  ok('6 unidades (ni recepciones, ni ajustes, ni retiradas)', v.totales.unidades === 6, String(v.totales.unidades))
  ok('€ a precio actual: 5×10 + 1×25 = 75', v.totales.euros === 75, String(v.totales.euros))
  ok('devoluciones aparte: 1', v.totales.devoluciones === 1)
  ok('ud/día = 6/7', Math.abs(v.totales.udDia - 0.86) < 0.01, String(v.totales.udDia))
  ok('el día 15 tiene 2 ud y 20 €', v.porDia[6].unidades === 2 && v.porDia[6].euros === 20, JSON.stringify(v.porDia[6]))
  ok('sin 365 no hay agregado semanal', v.porSemana === null)
  ok('moneda por defecto EUR', v.moneda === 'EUR')
}

console.log('\n=== periodo anterior y variación ===')
{
  const movs = [venta('A', '2026-11-15', 12), venta('A', '2026-11-03', 8), venta('A', '2026-10-20', 99)]
  const v = ventasFba(movs, new Map([['A', 5]]), HOY, 7, '2025-01-01')
  ok('anterior: 7 días del 2 al 8 nov', v.anterior.length === 7 && v.anterior[0].fecha === '2026-11-02' && v.anterior[6].fecha === '2026-11-08')
  ok('anterior suma 8 (lo del 20 oct no entra en ninguno)', v.anterior.reduce((a, d) => a + d.unidades, 0) === 8)
  ok('completo', v.anteriorCompleto === true)
  ok('variación de unidades +50 %', v.totales.variacionUnidades === 0.5, String(v.totales.variacionUnidades))
  ok('variación de € +50 %', v.totales.variacionEuros === 0.5, String(v.totales.variacionEuros))

  const corto = ventasFba(movs, new Map([['A', 5]]), HOY, 7, '2026-11-05')
  ok('libro desde el 5 nov → anterior incompleto y sin variación', corto.anteriorCompleto === false && corto.totales.variacionUnidades === null && corto.totales.variacionEuros === null)

  const sinAnt = ventasFba([venta('A', '2026-11-15', 3)], new Map(), HOY, 7, '2025-01-01')
  ok('anterior a cero → sin variación (no «+∞»)', sinAnt.totales.variacionUnidades === null)
  ok('sin libro → anterior incompleto', ventasFba([], new Map(), HOY, 7, null).anteriorCompleto === false)
}

console.log('\n=== sin precio: € null, no 0 ===')
{
  const v = ventasFba([venta('A', '2026-11-14', 4)], new Map([['A', null]]), HOY, 7, '2025-01-01')
  ok('total € null', v.totales.euros === null)
  ok('€ por día null', v.porDia.every((d) => d.euros === null))
  ok('variación de € null', v.totales.variacionEuros === null)
  const parcial = ventasFba([venta('A', '2026-11-14', 4), venta('B', '2026-11-14', 1)], new Map([['A', null], ['B', 30]]), HOY, 7, '2025-01-01')
  ok('con precio solo en una: suma la que lo tiene', parcial.totales.euros === 30)
  ok('…y en el top, € null para la que no tiene', parcial.top.find((t) => t.sku === 'A')?.euros === null)
}

console.log('\n=== libro atrasado: el periodo acaba en lo leído ===')
{
  const v = ventasFba([venta('A', '2026-11-06', 1)], new Map(), HOY, 30, '2025-01-01', { leidoHasta: '2026-11-06' })
  ok('hasta el 6 nov y 30 días desde el 8 oct', v.hasta === '2026-11-06' && v.desde === '2026-10-08', `${v.desde}..${v.hasta}`)
  const al = ventasFba([], new Map(), HOY, 30, '2025-01-01', { leidoHasta: '2026-11-20' })
  // A6.3: leído hasta hoy (o después) → el periodo acaba AYER, el último día completo
  ok('un leidoHasta de hoy o posterior acaba en ayer (hoy va a medias)', al.hasta === '2026-11-14')
}

console.log('\n=== top 20 con serie de 30 días ===')
{
  const movs: MovimientoVenta[] = []
  for (let i = 0; i < 25; i++) movs.push(venta(`S${String(i).padStart(2, '0')}`, '2026-11-10', i + 1))
  movs.push(venta('S24', '2026-10-20', 5)) // dentro de los 30 días de la chispa, fuera de los 7 del periodo
  const v = ventasFba(movs, new Map(), HOY, 7, '2025-01-01', { nombres: new Map([['S24', 'Zapatilla 24']]) })
  ok('20 referencias', v.top.length === 20, String(v.top.length))
  ok('la primera es la que más vende (S24, 25 ud)', v.top[0].sku === 'S24' && v.top[0].unidades === 25 && v.top[0].nombre === 'Zapatilla 24')
  ok('serie30 de 30 días que acaba en hasta', v.top[0].serie30.length === 30 && v.top[0].serie30[29] === 0 && v.top[0].serie30[24] === 25, '30 días del 17 oct al 15 nov: el 10 nov es el índice 24')
  ok('la chispa ve la venta del 20 oct', v.top[0].serie30[3] === 5, JSON.stringify(v.top[0].serie30))
  ok('ud/día del top = 25/7', Math.abs(v.top[0].udDia - 3.57) < 0.01, String(v.top[0].udDia))
  ok('la venta fuera del periodo no suma al total', v.totales.unidades === (25 * 26) / 2)
}

console.log('\n=== salidas por almacén ===')
{
  const v = ventasFba([venta('A', '2026-11-14', 5, 'ES'), venta('A', '2026-11-13', 2, 'de'), venta('B', '2026-11-13', 1, null), venta('B', '2026-11-13', 4, 'ES')], new Map(), HOY, 7, '2025-01-01')
  ok('ES 9, DE 2, sin país 1, ordenado', JSON.stringify(v.salidasPorAlmacen) === JSON.stringify([{ pais: 'ES', unidades: 9 }, { pais: 'DE', unidades: 2 }, { pais: 'Sin país', unidades: 1 }]), JSON.stringify(v.salidasPorAlmacen))
  const sin = ventasFba([venta('A', '2026-11-14', 5)], new Map(), HOY, 7, '2025-01-01')
  ok('el agregado diario sin país → lista vacía (no «Sin país» con todo)', sin.salidasPorAlmacen.length === 0)
}

console.log('\n=== caso 61: 365 días ===')
{
  const movs: MovimientoVenta[] = []
  for (let i = 0; i < 540; i += 3) movs.push(venta('A', sumarDias(HOY, -i), 1))
  const leidoDesde = sumarDias(HOY, -540)
  const v = ventasFba(movs, new Map([['A', 2]]), HOY, 365, leidoDesde)
  ok('libro desde hace 540 → anteriorCompleto = false', v.anteriorCompleto === false)
  ok('…y la variación no se enseña', v.totales.variacionUnidades === null && v.totales.variacionEuros === null)
  ok('porDia con 365 días', v.porDia.length === 365)
  ok('agregado semanal por lunes', !!v.porSemana && v.porSemana.every((s) => lunesDe(s.semana) === s.semana) && v.porSemana.length >= 52 && v.porSemana.length <= 54, String(v.porSemana?.length))
  ok('el semanal suma lo mismo que el diario', v.porSemana!.reduce((a, s) => a + s.unidades, 0) === v.totales.unidades)
  ok('€ semanales', v.porSemana!.reduce((a, s) => a + (s.euros ?? 0), 0) === v.totales.euros)
  const largo = ventasFba(movs, new Map(), HOY, 365, sumarDias(HOY, -730))
  ok('con libro desde hace 730 → completo', largo.anteriorCompleto === true)
}

console.log('\n=== utilidades ===')
{
  ok('lunes del domingo 15 nov 2026 = 9 nov', lunesDe('2026-11-15') === '2026-11-09')
  ok('lunes de un lunes = él mismo', lunesDe('2026-11-09') === '2026-11-09')
  const s = porSemanaDe([{ fecha: '2026-11-08', unidades: 1, euros: null }, { fecha: '2026-11-09', unidades: 2, euros: 4 }, { fecha: '2026-11-15', unidades: 3, euros: null }])
  ok('porSemanaDe agrupa y conserva € null donde no hay', s.length === 2 && s[0].euros === null && s[1].unidades === 5 && s[1].euros === 4, JSON.stringify(s))
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
if (fallos) process.exit(1)
