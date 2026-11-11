import { proponerPresupuestos, proponerPujas, type SegmentacionParaReglas } from './reglas-pujas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const seg = (id: string, puja: number, m: Partial<SegmentacionParaReglas['metricas']>, activa = true): SegmentacionParaReglas => ({
  id,
  tipo: 'keyword',
  texto: `kw ${id}`,
  campaignId: 'c1',
  campaignName: 'B0X | SKU | RES | MANUAL AMPLIA',
  adGroupId: 'g1',
  puja,
  activa,
  metricas: { impresiones: 1000, clics: 0, gasto: 0, ventas: 0, pedidos: 0, ...m },
})
const P = { acosObjetivoPct: 30, cpaObjetivo: 9, cambioPujaPct: 15, muestraMinimaClics: 12 }

console.log('\n=== pujas ===')
{
  const r = proponerPujas([seg('a', 0.5, { clics: 40, gasto: 10, ventas: 60, pedidos: 3 })], P)
  ok('ACoS 16,7 % < 70 % del objetivo con 3 pedidos → sube un 15 %', r.length === 1 && r[0].direccion === 'subir' && r[0].pujaNueva === 0.58, JSON.stringify(r))
}
{
  const r = proponerPujas([seg('b', 0.6, { clics: 30, gasto: 20, ventas: 40, pedidos: 2 })], P)
  // ACoS 50 % → a objetivo 0,6 × 30/50 = 0,36, pero como mucho −15 % → 0,51
  ok('ACoS 50 % → baja, pero como mucho el 15 % de golpe (0,60 → 0,51)', r.length === 1 && r[0].direccion === 'bajar' && r[0].pujaNueva === 0.51, JSON.stringify(r))
}
{
  const r = proponerPujas([seg('c', 1, { clics: 30, gasto: 14, ventas: 40, pedidos: 2 })], P)
  // ACoS 35 % → 1 × 30/35 = 0,857 (menos que −15 %): justo a la puja del objetivo
  ok('ACoS 35 % (un poco por encima) → baja justo a la puja del objetivo (0,86)', r.length === 1 && r[0].pujaNueva === 0.86, JSON.stringify(r))
  ok('ACoS 33 % (dentro del margen del 15 %) → nada', proponerPujas([seg('c2', 0.6, { clics: 30, gasto: 12, ventas: 36, pedidos: 2 })], P).length === 0)
}
{
  const r = proponerPujas([seg('d', 0.4, { clics: 25, gasto: 10, ventas: 0, pedidos: 0 })], P)
  ok('10 € sin venta ≥ CPA objetivo (9) → baja un 15 % (0,40 → 0,34)', r.length === 1 && r[0].pujaNueva === 0.34 && /sin ninguna venta/.test(r[0].motivo), JSON.stringify(r))
}
ok('sin muestra suficiente (8 clics) → nada', proponerPujas([seg('e', 0.5, { clics: 8, gasto: 10, ventas: 0 })], P).length === 0)
ok('pausada → nada', proponerPujas([seg('f', 0.5, { clics: 40, gasto: 10, ventas: 60, pedidos: 3 }, false)], P).length === 0)
ok('ACoS en objetivo (25 %) → nada', proponerPujas([seg('g', 0.5, { clics: 40, gasto: 10, ventas: 40, pedidos: 2 })], P).length === 0)
ok('cambio de menos de 2 céntimos → nada', proponerPujas([seg('h', 0.1, { clics: 40, gasto: 10, ventas: 70, pedidos: 3 })], { ...P, cambioPujaPct: 10 }).length === 0)
ok('nunca por debajo de 0,02', proponerPujas([seg('i', 0.02, { clics: 40, gasto: 10, ventas: 0 })], P).every((x) => x.pujaNueva >= 0.02))

console.log('\n=== presupuesto ===')
{
  const r = proponerPresupuestos([{ campaignId: 'c', campaignName: 'x', presupuesto: 10, activa: true, gasto7: 66.5, diasConDatos: 7, ventas7: 300 }], { acosObjetivoPct: 30, subidaPct: 20 })
  ok('gasta el 95 % con ACoS 22 % → sube un 20 % (10 → 12)', r.length === 1 && r[0].presupuestoNuevo === 12 && r[0].metricas.usoPct === 95, JSON.stringify(r))
}
ok('gasta el 60 % → nada', proponerPresupuestos([{ campaignId: 'c', campaignName: 'x', presupuesto: 10, activa: true, gasto7: 42, diasConDatos: 7, ventas7: 300 }], { acosObjetivoPct: 30, subidaPct: 20 }).length === 0)
ok('se queda corta pero con ACoS por encima del objetivo → nada', proponerPresupuestos([{ campaignId: 'c', campaignName: 'x', presupuesto: 10, activa: true, gasto7: 70, diasConDatos: 7, ventas7: 100 }], { acosObjetivoPct: 30, subidaPct: 20 }).length === 0)
ok('con menos de 5 días de datos → nada', proponerPresupuestos([{ campaignId: 'c', campaignName: 'x', presupuesto: 10, activa: true, gasto7: 40, diasConDatos: 4, ventas7: 300 }], { acosObjetivoPct: 30, subidaPct: 20 }).length === 0)

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
