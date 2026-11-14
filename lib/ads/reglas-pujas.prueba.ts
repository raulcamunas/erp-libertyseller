import { proponerPausas, proponerPresupuestos, proponerPujas, pujaObjetivo, type SegmentacionParaReglas } from './reglas-pujas'
import { UMBRALES_DE_PARTIDA } from './umbrales'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** PUJAS, PAUSAS Y PRESUPUESTO. Con los umbrales de partida y un CVR del 10 % (1 pedido cada 10 clics) salvo que se diga otra cosa */

const seg = (id: string, puja: number, m: Partial<SegmentacionParaReglas['metricas']>, extra: Partial<SegmentacionParaReglas> = {}): SegmentacionParaReglas => ({
  id,
  tipo: 'keyword',
  texto: `kw ${id}`,
  campaignId: 'c1',
  campaignName: 'B0X | SKU | RES | MANUAL AMPLIA',
  adGroupId: 'g1',
  puja,
  activa: true,
  cvr: 0.1,
  metricas: { impresiones: 1000, clics: 0, gasto: 0, ventas: 0, pedidos: 0, ...m },
  ...extra,
})
const P = { acosObjetivoPct: 30, cpaObjetivo: 9, muestraMinimaClics: 12 }

console.log('\n=== puja objetivo (ventas por clic × ACoS objetivo) ===')
ok('30 € en ventas con 10 clics y objetivo 30 % → 0,90', pujaObjetivo({ clics: 10, ventas: 30 }, 30) === 0.9)
ok('sin ventas → null', pujaObjetivo({ clics: 10, ventas: 0 }, 30) === null)

console.log('\n=== subir ===')
{
  // 60 € en 40 clics → 1,50 por clic × 30 % = 0,45 de puja objetivo; está en 0,30
  const r = proponerPujas([seg('a', 0.3, { clics: 40, gasto: 8, ventas: 60, pedidos: 3 })], P)
  ok('ACoS 13 % < 0,7× objetivo con 3 pedidos → sube un 15 % (0,30 → 0,35)', r.length === 1 && r[0].direccion === 'subir' && r[0].pujaNueva === 0.35, JSON.stringify(r))
  const tope = proponerPujas([seg('a2', 0.42, { clics: 40, gasto: 8, ventas: 60, pedidos: 3 })], P)
  ok('… sin pasar de la puja objetivo (0,42 → 0,45, no 0,48)', tope[0]?.pujaNueva === 0.45, JSON.stringify(tope))
  ok('con 2 pedidos no sube (pide 3)', proponerPujas([seg('a3', 0.3, { clics: 40, gasto: 8, ventas: 60, pedidos: 2 })], P).length === 0)
  ok('si la puja ya pasa la objetivo, subir no gana nada → nada', proponerPujas([seg('a4', 0.6, { clics: 40, gasto: 8, ventas: 60, pedidos: 3 })], P).length === 0)
}

console.log('\n=== bajar con pedidos ===')
{
  // 40 € en 30 clics → 1,33 por clic × 30 % = 0,40; ACoS 50 %
  const r = proponerPujas([seg('b', 0.6, { clics: 30, gasto: 20, ventas: 40, pedidos: 2 })], P)
  ok('ACoS 50 % con 2 pedidos → baja hacia 0,40, pero como mucho un 25 % (0,60 → 0,45)', r.length === 1 && r[0].direccion === 'bajar' && r[0].pujaNueva === 0.45 && r[0].metricas.pujaObjetivo === 0.4, JSON.stringify(r))
  const c = proponerPujas([seg('c', 1, { clics: 30, gasto: 15, ventas: 40, pedidos: 2 })], P)
  ok('ACoS 37,5 % (> 1,2× = 36 %) → hacia la puja objetivo 0,40, con el tope del 25 %: 1,00 → 0,75', c[0]?.pujaNueva === 0.75, JSON.stringify(c))
  ok('ACoS 33 % (dentro del margen de 1,2×) → nada', proponerPujas([seg('c2', 0.6, { clics: 30, gasto: 12, ventas: 36, pedidos: 2 })], P).length === 0)
  ok('con 1 solo pedido el ACoS es ruido → no se baja por ACoS', proponerPujas([seg('c3', 0.6, { clics: 30, gasto: 20, ventas: 20, pedidos: 1 })], P).length === 0)
}

console.log('\n=== bajar sin pedidos ===')
{
  const r = proponerPujas([seg('d', 0.4, { clics: 15, gasto: 6, ventas: 0, pedidos: 0 })], P)
  ok('15 clics (≥ 1 ÷ CVR y ≥ muestra) sin pedidos → −15 % (0,40 → 0,34)', r.length === 1 && r[0].pujaNueva === 0.34 && /sin ningún pedido/.test(r[0].motivo), JSON.stringify(r))
  ok('11 clics (< muestra mínima 12) → nada', proponerPujas([seg('e', 0.5, { clics: 11, gasto: 10 })], P).length === 0)
  ok('CVR 4 %: 15 clics no bastan (hacen falta 25) → nada', proponerPujas([seg('e2', 0.5, { clics: 15, gasto: 10 }, { cvr: 0.04 })], P).length === 0)
}

console.log('\n=== lo que se deja en paz ===')
ok('pausada → nada', proponerPujas([seg('f', 0.5, { clics: 40, gasto: 10, ventas: 60, pedidos: 3 }, { activa: false })], P).length === 0)
ok('ACoS en objetivo (25 %) → nada', proponerPujas([seg('g', 0.5, { clics: 40, gasto: 10, ventas: 40, pedidos: 2 })], P).length === 0)
ok('cambio de menos de 2 céntimos → nada', proponerPujas([seg('h', 0.1, { clics: 40, gasto: 2, ventas: 70, pedidos: 3 })], { ...P, umbrales: { ...UMBRALES_DE_PARTIDA, subirPujaPct: 10 } }).length === 0)
ok('nunca por debajo de 0,02', proponerPujas([seg('i', 0.02, { clics: 40, gasto: 10, ventas: 0 })], P).every((x) => x.pujaNueva >= 0.02))

console.log('\n=== pausar ===')
{
  const r = proponerPausas([seg('p', 0.5, { clics: 30, gasto: 12 })], P)
  ok('30 clics sin pedido (3 ÷ CVR) → pausar', r.length === 1 && /se pausa/.test(r[0].motivo), JSON.stringify(r))
  ok('13,50 de gasto (1,5 × CPA 9) con 12 clics → pausar', proponerPausas([seg('p2', 0.5, { clics: 12, gasto: 13.5 })], P).length === 1)
  ok('mucho gasto pero 3 clics (< 1 ÷ CVR y < muestra) → no: dos clics caros no demuestran nada', proponerPausas([seg('p3', 2, { clics: 3, gasto: 30 })], P).length === 0)
  ok('con un pedido → no', proponerPausas([seg('p4', 0.5, { clics: 60, gasto: 30, pedidos: 1, ventas: 20 })], P).length === 0)
  ok('cláusula de la automática → nunca se pausa', proponerPausas([seg('p5', 0.5, { clics: 60, gasto: 30 }, { tipo: 'auto' })], P).length === 0)
  ok('semilla de EXACTA DOMINIO → no se pausa (se baja la puja)', proponerPausas([seg('p6', 0.5, { clics: 60, gasto: 30 }, { esSemilla: true })], P).length === 0)
}

console.log('\n=== presupuesto ===')
{
  const r = proponerPresupuestos([{ campaignId: 'c', campaignName: 'x', presupuesto: 10, activa: true, gasto7: 66.5, diasConDatos: 7, ventas7: 300 }], { acosObjetivoPct: 30, subidaPct: 20 })
  ok('gasta el 95 % con ACoS 22 % → sube un 20 % (10 → 12)', r.length === 1 && r[0].presupuestoNuevo === 12 && r[0].metricas.usoPct === 95, JSON.stringify(r))
}
ok('gasta el 60 % → nada', proponerPresupuestos([{ campaignId: 'c', campaignName: 'x', presupuesto: 10, activa: true, gasto7: 42, diasConDatos: 7, ventas7: 300 }], { acosObjetivoPct: 30, subidaPct: 20 }).length === 0)
ok('se queda corta perdiendo dinero → NO se toca el presupuesto (se arregla con pujas)', proponerPresupuestos([{ campaignId: 'c', campaignName: 'x', presupuesto: 10, activa: true, gasto7: 70, diasConDatos: 7, ventas7: 100 }], { acosObjetivoPct: 30, subidaPct: 20 }).length === 0)
ok('con menos de 5 días de datos → nada', proponerPresupuestos([{ campaignId: 'c', campaignName: 'x', presupuesto: 10, activa: true, gasto7: 40, diasConDatos: 4, ventas7: 300 }], { acosObjetivoPct: 30, subidaPct: 20 }).length === 0)
ok('el corte de «se queda corta» es configurable (80 %)', proponerPresupuestos([{ campaignId: 'c', campaignName: 'x', presupuesto: 10, activa: true, gasto7: 59.5, diasConDatos: 7, ventas7: 300 }], { acosObjetivoPct: 30, subidaPct: 20, umbrales: { ...UMBRALES_DE_PARTIDA, usoPresupuestoCortoPct: 80 } }).length === 1)

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
