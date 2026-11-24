import { repartirFbm, sumarFbmASerie, type VentaFbm } from '@/lib/fba/fbm-plan'
import type { SerieSku } from '@/lib/fba/plan-tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(d)}`}`)
}
const dia = (n: number) => new Date(Date.UTC(2026, 10, 24) + n * 86_400_000).toISOString().slice(0, 10)

console.log('\n=== Las ventas FBM van al SKU FBA de su ASIN; las que no casan, a «sin FBA» ===')
{
  const ventas: VentaFbm[] = [
    { fecha: dia(-1), sku: '633372-41', asin: 'B01', unidades: 4 },
    { fecha: dia(-2), sku: '633372-41', asin: 'B01', unidades: 2 },
    { fecha: dia(-3), sku: 'OTRO-FBM', asin: 'B99', unidades: 5 },
    { fecha: dia(-40), sku: 'OTRO-FBM', asin: 'B99', unidades: 1 },
    { fecha: dia(-200), sku: 'VIEJO', asin: 'B77', unidades: 9 },
  ]
  const asin = new Map<string, string | null>([['FBA633372-41', 'B01'], ['FBA633372-41-B', 'B01'], ['FBA-X', 'B50']])
  const r = repartirFbm(ventas, ['FBA633372-41-B', 'FBA633372-41', 'FBA-X'], asin, dia(-1))
  ok('al SKU FBA del mismo ASIN (al primero por orden si hay dos: sin contar dos veces)', r.porSku.get('FBA633372-41')?.get(dia(-1)) === 4 && !r.porSku.has('FBA633372-41-B'), [...r.porSku.keys()])
  ok('un ASIN sin SKU FBA en el plan sale aparte, con sus 30 y 90 días', r.sinFba.length === 1 && r.sinFba[0].asin === 'B99' && r.sinFba[0].ventas30 === 5 && r.sinFba[0].ventas90 === 6, r.sinFba)
  ok('lo de hace más de 90 días no entra en «sin FBA»', !r.sinFba.some((x) => x.asin === 'B77'))
}

console.log('\n=== La serie: los días sin stock FBA cuentan si vendía por FBM ===')
{
  // 30 días: con stock FBA los 10 primeros (1/día), luego agotado en FBA; vende 4/día por FBM desde el día 15
  const n = 30
  const fechas = Array.from({ length: n }, (_, i) => dia(i - n))
  const serie: SerieSku = {
    fechas, ventas: fechas.map((_, i) => (i < 10 ? 1 : 0)), stockInicio: fechas.map(() => 0),
    conStock: fechas.map((_, i) => (i === n - 1 ? null : i < 10)), fiable: true, anclajeEstimado: false,
  }
  const fbm = new Map<string, number>()
  for (let i = 15; i < n; i++) fbm.set(fechas[i], 4)
  const { serie: s, sumadas } = sumarFbmASerie(serie, fbm, fechas[0])
  ok('un día agotado en FBA con venta FBM cuenta como día de venta', s.conStock[20] === true && s.ventas[20] === 4, { c: s.conStock[20], v: s.ventas[20] })
  ok('y los 7 días antes de la primera venta FBM también (la oferta del cliente ya estaba)', s.conStock[8 + 0] === true && s.conStock[10] === true && s.conStock[14] === true, s.conStock.slice(8, 16))
  ok('un día sin libro (atraso) no se toca', s.conStock[n - 1] === null && s.ventas[n - 1] === 0)
  ok('se suman las unidades FBM de los días con libro', sumadas === 4 * (n - 1 - 15), sumadas)
  ok('no toca la serie de entrada', serie.conStock[20] === false && serie.ventas[20] === 0)
  const antes = sumarFbmASerie(serie, fbm, fechas[25])
  ok('antes de que haya pedidos leídos, nada cambia', antes.serie.conStock[20] === false, antes.serie.conStock[20])
  ok('sin ventas FBM, la misma serie', sumarFbmASerie(serie, undefined, fechas[0]).serie === serie)
}
console.log(fallos === 0 ? '\nTODO OK\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
