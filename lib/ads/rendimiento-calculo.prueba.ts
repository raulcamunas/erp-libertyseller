import { diasDelRango, filasDeInforme, gastanSinVender, porCampana, repartoPorTipo, serieDiaria, tipoDeCampana, totalesDe, variacion } from './rendimiento-calculo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const crudas = [
  { date: '2026-11-01', campaignId: 1, campaignName: 'B0AAAAAAA1 | SKU1 | ZAPATO | AUTO RADAR', impressions: 1000, clicks: 20, cost: 10, sales7d: 50, purchases7d: 2, unitsSoldClicks7d: 2 },
  { date: '2026-11-02', campaignId: 1, campaignName: 'B0AAAAAAA1 | SKU1 | ZAPATO | AUTO RADAR', impressions: 800, clicks: 10, cost: 6, sales7d: 25, purchases7d: 1, unitsSoldClicks7d: 1 },
  { date: '2026-11-02', campaignId: 2, campaignName: 'Campaña antigua', impressions: 500, clicks: 30, cost: 20, sales7d: 0, purchases7d: 0, unitsSoldClicks7d: 0 },
  { date: 'mal', campaignId: 3, campaignName: 'x', cost: 99 },
  { date: '2026-11-03', campaignName: 'sin id', cost: 99 },
  { date: '2026-11-03', campaignId: '4', campaignName: 'Con texto', impressions: '100', clicks: '5', cost: '2.5', sales7d: '10', purchases7d: '1' },
]

console.log('\n=== filas del informe ===')
{
  const f = filasDeInforme(crudas)
  ok('descarta las filas sin fecha válida o sin campaña', f.length === 4, String(f.length))
  ok('los números llegan como texto y se leen igual', f[3].gasto === 2.5 && f[3].clics === 5 && f[3].ventas === 10)
  ok('un número que falta vale 0, no NaN', f[3].unidades === 0)
}

console.log('\n=== totales y fórmulas ===')
{
  const f = filasDeInforme(crudas)
  const t = totalesDe(f)
  ok('suma gasto 38,5, ventas 85, pedidos 4', Math.abs(t.gasto - 38.5) < 1e-9 && t.ventas === 85 && t.pedidos === 4, JSON.stringify(t))
  ok('ACoS = 38,5/85 y ROAS = 85/38,5', Math.abs((t.acos as number) - 38.5 / 85) < 1e-9 && Math.abs((t.roas as number) - 85 / 38.5) < 1e-9)
  ok('CTR = 65/2400 (clics/impresiones)', Math.abs((t.ctr as number) - 65 / 2400) < 1e-9, String(t.ctr))
  ok('CPC = 38,5/65', Math.abs((t.cpc as number) - 38.5 / 65) < 1e-9)
  const vacio = totalesDe([])
  ok('sin datos: todo a 0 y los ratios null (no 0)', vacio.gasto === 0 && vacio.acos === null && vacio.roas === null && vacio.ctr === null && vacio.cpc === null && vacio.cvr === null)
  const sinVentas = totalesDe([{ impresiones: 10, clics: 5, gasto: 3, ventas: 0, pedidos: 0, unidades: 0 }])
  ok('gasto sin ventas: ACoS null, ROAS 0', sinVentas.acos === null && sinVentas.roas === 0)
}

console.log('\n=== variación ===')
{
  ok('de 100 a 112 = +12 %', Math.abs((variacion(112, 100) as number) - 0.12) < 1e-9)
  ok('de 100 a 80 = −20 %', Math.abs((variacion(80, 100) as number) + 0.2) < 1e-9)
  ok('sin periodo anterior (0 o null) no se inventa nada', variacion(10, 0) === null && variacion(10, null) === null && variacion(null, 5) === null)
}

console.log('\n=== serie diaria ===')
{
  const dias = diasDelRango('2026-11-01', '2026-11-04')
  ok('el rango incluye los dos extremos', dias.join() === '2026-11-01,2026-11-02,2026-11-03,2026-11-04')
  const s = serieDiaria(filasDeInforme(crudas), dias)
  ok('un punto por día aunque no haya datos (el 4 a cero)', s.length === 4 && s[3].gasto === 0 && s[3].acos === null)
  ok('el día 2 suma las dos campañas: gasto 26', s[1].gasto === 26 && s[1].ventas === 25, JSON.stringify(s[1]))
  ok('una fila fuera del rango no se cuenta', serieDiaria(filasDeInforme(crudas), ['2026-11-01']).reduce((a, p) => a + p.gasto, 0) === 10)
  ok('el rango cruza el cambio de mes', diasDelRango('2026-10-30', '2026-11-02').join() === '2026-10-30,2026-10-31,2026-11-01,2026-11-02')
}

console.log('\n=== por campaña y por tipo ===')
{
  const c = porCampana(filasDeInforme(crudas))
  ok('ordenadas de más a menos gasto', c.map((x) => x.campaignId).join() === '2,1,4', c.map((x) => x.campaignId).join())
  ok('los totales de la campaña 1: 16 gastados, 75 vendidos', c.find((x) => x.campaignId === '1')?.gasto === 16 && c.find((x) => x.campaignId === '1')?.ventas === 75)
  ok('tipo por nomenclatura y «Otras» para lo antiguo', tipoDeCampana('B0AAAAAAA1 | SKU1 | ZAPATO | AUTO RADAR') === 'AUTO RADAR' && tipoDeCampana('Campaña antigua') === 'Otras')
  const r = repartoPorTipo(c)
  ok('reparto: «Otras» 20 de 38,5; las partes suman 1', r[0].tipo === 'Otras' && Math.abs(r.reduce((a, x) => a + x.parte, 0) - 1) < 1e-9, JSON.stringify(r.map((x) => [x.tipo, x.gasto])))
  ok('gastan sin vender: solo la antigua (20 sin pedidos)', gastanSinVender(c).map((x) => x.campaignId).join() === '2')
  ok('con el mínimo más alto no sale ninguna', gastanSinVender(c, 50).length === 0)
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
