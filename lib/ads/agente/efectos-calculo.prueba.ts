import {
  debeDeshacer,
  debeDeshacerRara,
  elegirControl,
  estaMezclado,
  muestraMinima,
  resumenDeVeredictos,
  subidasVetadasPorEfectos,
  sumarVentana,
  valorDeDeshacerPresupuesto,
  ventanasDeEfecto,
  veredicto,
} from './efectos-calculo'
import type { ClaseDeCambio, MedicionDeEfecto, MetricasDeVentana } from './tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** MEDIR EFECTOS. Objetivo 25 %, CVR 10 % y muestra de la ficha 12 → M = 20 clics salvo que se diga otra cosa */

const v = (clics: number, gasto: number, ventas: number, pedidos: number, dias = 14): MetricasDeVentana => ({ clics, gasto, ventas, pedidos, dias })
const med = (antes: MetricasDeVentana, despues: MetricasDeVentana, extra: Partial<MedicionDeEfecto> = {}): MedicionDeEfecto => ({
  antes,
  despues,
  controlAntes: null,
  controlDespues: null,
  ventasTotalesAntes: null,
  ventasTotalesDespues: null,
  acosObjetivoPct: 25,
  cvr: 0.1,
  muestraMinimaClics: 12,
  cpaObjetivo: 10,
  mezclado: false,
  evento: null,
  fase: 'normal',
  ...extra,
})
const ver = (clase: ClaseDeCambio, m: MedicionDeEfecto) => veredicto(clase, m)
const es = (n: string, clase: ClaseDeCambio, m: MedicionDeEfecto, esperado: string) => {
  const r = ver(clase, m)
  ok(n, r.veredicto === esperado, JSON.stringify(r))
}

console.log('\n=== ventanas (aritmética UTC sobre la fecha LOCAL) ===')
{
  const w = ventanasDeEfecto('2026-11-15')
  ok('antes = [d−14, d−1]', w.antes[0] === '2026-11-01' && w.antes[1] === '2026-11-14', JSON.stringify(w.antes))
  ok('rápida = [d+1, d+3], se mide desde d+6', w.rapida[0] === '2026-11-16' && w.rapida[1] === '2026-11-18' && w.medirRapidaDesde === '2026-11-21', JSON.stringify(w))
  ok('provisional = [d+1, d+7], se mide desde d+10', w.provisional[0] === '2026-11-16' && w.provisional[1] === '2026-11-22' && w.medirProvisionalDesde === '2026-11-25')
  ok('final = [d+1, d+14], se mide desde d+17', w.despues[0] === '2026-11-16' && w.despues[1] === '2026-11-29' && w.medirFinalDesde === '2026-12-02')
  const fin = ventanasDeEfecto('2026-12-25')
  ok('cruza el año (25 dic → final hasta el 8 ene 2027)', fin.despues[1] === '2027-01-08' && fin.medirFinalDesde === '2027-01-11', JSON.stringify(fin.despues))
  const feb = ventanasDeEfecto('2028-03-01')
  ok('año bisiesto: antes de 1 mar 2028 empieza el 16 feb y acaba el 29 feb', feb.antes[0] === '2028-02-16' && feb.antes[1] === '2028-02-29', JSON.stringify(feb.antes))
  let lanza = false
  try { ventanasDeEfecto('2026-02-30') } catch { lanza = true }
  ok('una fecha imposible lanza', lanza)

  // Un cambio a las 03:30 UTC del 15 nov es el 14 nov en Nueva York (UTC−5) y en Ciudad de México (UTC−6)
  const fechaLocal = (iso: string, zona: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  const ny = fechaLocal('2026-11-15T03:30:00Z', 'America/New_York')
  const mx = fechaLocal('2026-11-15T03:30:00Z', 'America/Mexico_City')
  ok('Nueva York: 03:30 UTC del 15 nov es el día local 14', ny === '2026-11-14', ny)
  ok('Ciudad de México: 03:30 UTC del 15 nov es el día local 14', mx === '2026-11-14', mx)
  const wNy = ventanasDeEfecto(ny)
  ok('Nueva York: antes 31 oct → 13 nov, final 15 → 28 nov', wNy.antes[0] === '2026-10-31' && wNy.antes[1] === '2026-11-13' && wNy.despues[0] === '2026-11-15' && wNy.despues[1] === '2026-11-28', JSON.stringify(wNy))
  // Nueva York cambia de hora el 1 nov 2026 (y el 8 mar 2026): la aritmética UTC sobre la fecha no se mueve
  const wNyHorario = ventanasDeEfecto(fechaLocal('2026-11-02T04:30:00Z', 'America/New_York'))
  ok('Nueva York con cambio de hora (1 nov): d = 1 nov, antes desde el 18 oct, provisional hasta el 8 nov', wNyHorario.antes[0] === '2026-10-18' && wNyHorario.provisional[1] === '2026-11-08', JSON.stringify(wNyHorario))
  const wMarzo = ventanasDeEfecto(fechaLocal('2026-03-09T03:00:00Z', 'America/New_York'))
  ok('Nueva York 8 mar (cambio de hora): final hasta el 22 mar, medible desde el 25', wMarzo.despues[1] === '2026-03-22' && wMarzo.medirFinalDesde === '2026-03-25', JSON.stringify(wMarzo))
  const wMx = ventanasDeEfecto(fechaLocal('2026-12-01T05:00:00Z', 'America/Mexico_City'))
  ok('Ciudad de México: 05:00 UTC del 1 dic es el 30 nov → antes 16 → 29 nov, rápida hasta el 3 dic', wMx.antes[0] === '2026-11-16' && wMx.antes[1] === '2026-11-29' && wMx.rapida[1] === '2026-12-03', JSON.stringify(wMx))
}

console.log('\n=== sumar ventana ===')
{
  const filas = [
    { fecha: '2026-11-01', clics: 10, gasto: 5, ventas: 20, pedidos: 1 },
    { fecha: '2026-11-07', clics: 4, gasto: 2.333, ventas: 0, pedidos: 0 },
    { fecha: '2026-11-14', clics: 6, gasto: 3, ventas: 10, pedidos: 1 },
    { fecha: '2026-11-15', clics: 99, gasto: 99, ventas: 99, pedidos: 9 },
    { fecha: '2026-10-31', clics: 99, gasto: 99, ventas: 99, pedidos: 9 },
  ]
  const s = sumarVentana(filas, '2026-11-01', '2026-11-14')
  ok('suma solo las fechas de la ventana, bordes incluidos', s.clics === 20 && s.pedidos === 2 && s.ventas === 30 && s.gasto === 10.33, JSON.stringify(s))
  ok('días = días de calendario de la ventana (14), no días con fila (3)', s.dias === 14)
  ok('ventana sin filas → ceros', JSON.stringify(sumarVentana([], '2026-11-16', '2026-11-22')) === JSON.stringify({ clics: 0, gasto: 0, ventas: 0, pedidos: 0, dias: 7 }))
}

console.log('\n=== control y muestra ===')
{
  const c = (id: string, campaignId: string, asin: string | null, tipo: string | null, clicsAntes: number) => ({ id, campaignId, asin, tipo, clicsAntes })
  const tocado = { id: 's0', campaignId: 'c1', asin: 'B0A', tipo: 'keyword' }
  const cand = [
    c('s1', 'c1', 'B0A', 'keyword', 10), c('s2', 'c1', 'B0A', 'keyword', 8), c('s3', 'c1', 'B0A', 'keyword', 5),
    c('s4', 'c1', 'B0A', 'keyword', 4), c('s5', 'c1', 'B0A', 'asin', 30), c('s6', 'c2', 'B0A', 'keyword', 30), c('s0', 'c1', 'B0A', 'keyword', 50),
  ]
  const r1 = elegirControl(cand, tocado, new Set())
  ok('misma campaña y tipo con ≥ 5 clics (3) → esas', r1.map((x) => x.id).join() === 's1,s2,s3', r1.map((x) => x.id).join())
  const r2 = elegirControl(cand, tocado, new Set(['s1']))
  ok('si una está tocada quedan 2 → mismo ASIN', r2.map((x) => x.id).join() === 's2,s3,s5,s6', r2.map((x) => x.id).join())
  ok('menos de 3 del mismo ASIN → sin control', elegirControl(cand.slice(0, 2), tocado, new Set()).length === 0)
  const camp = { id: 'c1', campaignId: 'c1', asin: 'B0A', tipo: null }
  const campanas = [c('c2', 'c2', 'B0A', null, 50), c('c3', 'c3', 'B0B', null, 50), c('c4', 'c4', 'B0C', null, 50), c('c5', 'c5', 'B0A', null, 2)]
  ok('campaña: pocas del mismo ASIN → toda la cuenta', elegirControl(campanas, camp, new Set()).map((x) => x.id).join() === 'c2,c3,c4')
  ok('M = max(ficha, 12, ⌈2/CVR⌉): CVR 10 % → 20', muestraMinima(12, 0.1) === 20)
  ok('… CVR 30 % → 12', muestraMinima(5, 0.3) === 12)
  ok('… ficha 25 → 25', muestraMinima(25, 0.3) === 25)
  ok('… CVR 0 no rompe → 12', muestraMinima(0, 0) === 12)
}

console.log('\n=== mezclado ===')
{
  ok('otro cambio 14 días antes → mezclado', estaMezclado('2026-11-15', ['2026-11-01']))
  ok('otro cambio 14 días después → mezclado', estaMezclado('2026-11-15', ['2026-11-29']))
  ok('a 15 días → no', !estaMezclado('2026-11-15', ['2026-10-31', '2026-11-30']))
  ok('sin otros cambios → no', !estaMezclado('2026-11-15', []))
  const m = med(v(100, 25, 100, 10), v(60, 10, 100, 10, 7), { mezclado: true })
  es('la medición mezclada da «mezclado» aunque la tabla diría otra cosa', 'puja_subir', m, 'mezclado')
  ok('mezclado no se deshace', !debeDeshacer('puja_subir', med(v(100, 20, 100, 10), v(60, 60, 50, 3, 7), { mezclado: true })).deshacer)
}

console.log('\n=== evento ===')
{
  const r = ver('puja_subir', med(v(100, 20, 100, 10), v(100, 20, 200, 20), { evento: 'Black Friday', mezclado: true }))
  ok('una ventana que toca Black Friday → sin_muestra «evento: Black Friday» (antes que mezclado)', r.veredicto === 'sin_muestra' && r.detalle === 'evento: Black Friday', JSON.stringify(r))
  ok('con evento no se deshace', !debeDeshacer('puja_subir', med(v(100, 20, 100, 10), v(60, 60, 50, 3, 7), { evento: 'Navidad' })).deshacer)
}

console.log('\n=== tabla: puja_subir ===')
{
  // antes: 100 clics, 20 € de gasto, 100 € de ventas en 14 d (ACoS 20 %, 7,14 €/día)
  const A = v(100, 20, 100, 10)
  es('pocos clics antes → sin_muestra', 'puja_subir', med(v(10, 2, 10, 1), v(100, 25, 200, 20)), 'sin_muestra')
  es('pocos clics después → sin_muestra', 'puja_subir', med(A, v(19, 5, 50, 5)), 'sin_muestra')
  es('ventas ×2,4 por día y ACoS 25 % ≤ 27,5 → mejoró', 'puja_subir', med(A, v(120, 30, 120, 12, 7)), 'mejoro')
  es('ACoS 33 % > 32,5 → empeoró', 'puja_subir', med(A, v(120, 40, 120, 12, 7)), 'empeoro')
  es('R 0,9 < 0,95 con ACoS peor (22 % > 20 %) → empeoró', 'puja_subir', med(A, v(50, 10, 45, 5, 7)), 'empeoro')
  es('R 1,0 con ACoS 26 % → neutro', 'puja_subir', med(A, v(50, 13, 50, 5, 7)), 'neutro')
  // con un control que sube ×2,3: R = 2,4/2,3 ≈ 1,04 < 1,10 → no mejoró
  es('el control sube casi igual → neutro', 'puja_subir', med(A, v(120, 30, 120, 12, 7), { controlAntes: v(500, 100, 1000, 50), controlDespues: v(300, 60, 1150, 30, 7) }), 'neutro')
}

console.log('\n=== tabla: puja_bajar y sin pedidos ===')
{
  const A = v(100, 40, 100, 10) // ACoS 40 %
  es('ACoS 40 → 30 % con R 0,8 → mejoró', 'puja_bajar', med(A, v(60, 12, 40, 4, 7)), 'mejoro')
  es('R 0,5 < 0,6 con ACoS 40 % ≥ 38 → empeoró', 'puja_bajar', med(A, v(60, 10, 25, 3, 7)), 'empeoro')
  es('ACoS 40 → 38 % con R 0,9 → neutro', 'puja_bajar', med(A, v(60, 17.1, 45, 4, 7)), 'neutro')
  es('sin ventas antes y gasto/día −40 % → mejoró (sin pedidos)', 'puja_bajar_sin_pedidos', med(v(60, 28, 0, 0), v(30, 8.4, 0, 0, 7)), 'mejoro')
  es('sin ventas antes y gasto casi igual → neutro', 'puja_bajar_sin_pedidos', med(v(60, 28, 0, 0), v(30, 13, 0, 0, 7)), 'neutro')
  es('pocos clics → sin_muestra', 'puja_bajar', med(A, v(10, 2, 10, 1, 7)), 'sin_muestra')
}

console.log('\n=== tabla: pausar y negativizar (campaña) ===')
{
  const cA = v(300, 90, 300, 30)
  es('pausar: campaña con pocos clics antes → sin_muestra', 'pausar', med(v(40, 20, 0, 0), v(0, 0, 0, 0, 7), { campanaAntes: v(15, 5, 10, 1), campanaDespues: v(10, 3, 10, 1, 7) }), 'sin_muestra')
  es('pausar: ahorra y la campaña vende igual → mejoró', 'pausar', med(v(40, 20, 0, 0), v(0, 0, 0, 0, 7), { campanaAntes: cA, campanaDespues: v(140, 35, 150, 15, 7) }), 'mejoro')
  es('pausar: la campaña vende un 30 % menos → empeoró', 'pausar', med(v(40, 20, 0, 0), v(0, 0, 0, 0, 7), { campanaAntes: cA, campanaDespues: v(140, 35, 105, 10, 7) }), 'empeoro')
  es('pausar: la campaña vende un 20 % menos → neutro', 'pausar', med(v(40, 20, 0, 0), v(0, 0, 0, 0, 7), { campanaAntes: cA, campanaDespues: v(140, 35, 120, 12, 7) }), 'neutro')
  es('negativizar: campaña igual → mejoró', 'negativizar', med(v(20, 10, 0, 0), v(0, 0, 0, 0, 7), { campanaAntes: cA, campanaDespues: v(140, 35, 150, 15, 7) }), 'mejoro')
  es('negativizar: campaña −30 % → empeoró', 'negativizar', med(v(20, 10, 0, 0), v(0, 0, 0, 0, 7), { campanaAntes: cA, campanaDespues: v(140, 35, 105, 10, 7) }), 'empeoro')
  es('negativizar: campaña −15 % → neutro', 'negativizar', med(v(20, 10, 0, 0), v(0, 0, 0, 0, 7), { campanaAntes: cA, campanaDespues: v(140, 35, 127.5, 12, 7) }), 'neutro')
  es('negativizar: campaña con pocos clics → sin_muestra', 'negativizar', med(v(20, 10, 0, 0), v(0, 0, 0, 0, 7), { campanaAntes: v(10, 3, 0, 0), campanaDespues: v(5, 1, 0, 0, 7) }), 'sin_muestra')
}

console.log('\n=== tabla: promover ===')
{
  const A = v(0, 0, 0, 0)
  es('pocos clics en la nueva → sin_muestra', 'promover', med(A, v(10, 3, 20, 1, 7)), 'sin_muestra')
  es('1 pedido con ACoS 28 % ≤ 30 → mejoró', 'promover', med(A, v(25, 7, 25, 1, 7)), 'mejoro')
  es('0 pedidos con 25 clics → empeoró', 'promover', med(A, v(25, 7, 0, 0, 7)), 'empeoro')
  es('pedidos con ACoS 40 % → neutro', 'promover', med(A, v(25, 10, 25, 1, 7)), 'neutro')
}

console.log('\n=== tabla: presupuestos y pausar campaña ===')
{
  const A = v(300, 60, 300, 30) // ACoS 20 %
  es('presupuesto_subir: menos de 7 días después → sin_muestra', 'presupuesto_subir', med(A, v(100, 30, 150, 15, 5)), 'sin_muestra')
  es('presupuesto_subir: R 1,2 y ACoS 25 % → mejoró', 'presupuesto_subir', med(A, v(200, 45, 180, 18, 7)), 'mejoro')
  es('presupuesto_subir: ACoS 35 % → empeoró', 'presupuesto_subir', med(A, v(200, 63, 180, 18, 7)), 'empeoro')
  es('presupuesto_subir: R 1,0 y ACoS 24 % → neutro', 'presupuesto_subir', med(A, v(200, 36, 150, 15, 7)), 'neutro')
  es('presupuesto_bajar: menos de 7 días → sin_muestra', 'presupuesto_bajar', med(A, v(100, 20, 100, 10, 6)), 'sin_muestra')
  es('presupuesto_bajar: gasta menos y R 0,93 → mejoró', 'presupuesto_bajar', med(A, v(100, 20, 140, 14, 7)), 'mejoro')
  es('presupuesto_bajar: R 0,6 → empeoró', 'presupuesto_bajar', med(A, v(100, 20, 90, 9, 7)), 'empeoro')
  es('presupuesto_bajar: gasta más con R 1 → neutro', 'presupuesto_bajar', med(A, v(100, 35, 150, 15, 7)), 'neutro')
  es('pausar_campana: siempre neutro', 'pausar_campana', med(A, v(0, 0, 0, 0, 7)), 'neutro')
}

console.log('\n=== capa de negocio (ventas totales del ASIN) ===')
{
  const A = v(100, 20, 100, 10) // 1,43 €/día de gasto, 7,14 €/día de ventas Ads
  const D = v(120, 30, 120, 12, 7) // 4,29 €/día de gasto (+2,86), 17,14 €/día de ventas Ads → la tabla dice mejoró
  // gasto +2,86 €/día con objetivo 25 % → las totales deben subir ≥ 11,43 €/día
  const canibaliza = ver('puja_subir', med(A, D, { ventasTotalesAntes: { ventas: 1400, dias: 14 }, ventasTotalesDespues: { ventas: 707, dias: 7 } }))
  ok('subida con ventas Ads arriba pero totales casi iguales (+1 €/día) → neutro «canibaliza orgánico»', canibaliza.veredicto === 'neutro' && canibaliza.detalle.startsWith('canibaliza orgánico'), JSON.stringify(canibaliza))
  es('subida con totales +20 €/día → mejoró', 'puja_subir', med(A, D, { ventasTotalesAntes: { ventas: 1400, dias: 14 }, ventasTotalesDespues: { ventas: 840, dias: 7 } }), 'mejoro')
  es('presupuesto_subir que canibaliza → neutro', 'presupuesto_subir', med(v(300, 60, 300, 30), v(200, 45, 180, 18, 7), { ventasTotalesAntes: { ventas: 2800, dias: 14 }, ventasTotalesDespues: { ventas: 1400, dias: 7 } }), 'neutro')
  es('promover que canibaliza → neutro', 'promover', med(v(0, 0, 0, 0), v(25, 7, 25, 1, 7), { ventasTotalesAntes: { ventas: 1400, dias: 14 }, ventasTotalesDespues: { ventas: 700, dias: 7 } }), 'neutro')
  es('una subida que la tabla da por empeorada sigue empeorada', 'puja_subir', med(A, v(120, 40, 120, 12, 7), { ventasTotalesAntes: { ventas: 1400, dias: 14 }, ventasTotalesDespues: { ventas: 1400, dias: 7 } }), 'empeoro')

  // bajada: ventas Ads caen (R 0,5 → la tabla dice empeoró) pero las totales aguantan y se ahorra → mejoró
  const B = v(100, 40, 100, 10)
  const bajada = ver('puja_bajar', med(B, v(60, 10, 25, 3, 7), { ventasTotalesAntes: { ventas: 1400, dias: 14 }, ventasTotalesDespues: { ventas: 680, dias: 7 } }))
  ok('bajada de puja que ahorra y no baja totales (97 %) → mejoró aunque bajen las Ads', bajada.veredicto === 'mejoro' && bajada.detalle.startsWith('ahorra'), JSON.stringify(bajada))
  es('bajada que ahorra pero las totales caen al 90 % → la tabla manda (empeoró)', 'puja_bajar', med(B, v(60, 10, 25, 3, 7), { ventasTotalesAntes: { ventas: 1400, dias: 14 }, ventasTotalesDespues: { ventas: 630, dias: 7 } }), 'empeoro')
  es('presupuesto_bajar con R 0,6 pero totales iguales y ahorro → mejoró', 'presupuesto_bajar', med(v(300, 60, 300, 30), v(100, 20, 90, 9, 7), { ventasTotalesAntes: { ventas: 2800, dias: 14 }, ventasTotalesDespues: { ventas: 1400, dias: 7 } }), 'mejoro')
  es('negativizar con la campaña −30 % pero totales iguales y menos gasto de campaña → mejoró', 'negativizar', med(v(20, 10, 0, 0), v(0, 0, 0, 0, 7), { campanaAntes: v(300, 90, 300, 30), campanaDespues: v(140, 35, 105, 10, 7), ventasTotalesAntes: { ventas: 2800, dias: 14 }, ventasTotalesDespues: { ventas: 1400, dias: 7 } }), 'mejoro')
  es('pausar sin ventas totales → solo la tabla (empeoró)', 'pausar', med(v(40, 20, 0, 0), v(0, 0, 0, 0, 7), { campanaAntes: v(300, 90, 300, 30), campanaDespues: v(140, 35, 105, 10, 7) }), 'empeoro')
  es('bajada que NO ahorra (gasta más) con totales iguales → la tabla (neutro)', 'presupuesto_bajar', med(v(300, 60, 300, 30), v(100, 35, 150, 15, 7), { ventasTotalesAntes: { ventas: 2800, dias: 14 }, ventasTotalesDespues: { ventas: 1400, dias: 7 } }), 'neutro')
  es('sin muestra no la cambia el negocio', 'puja_bajar', med(B, v(5, 1, 0, 0, 7), { ventasTotalesAntes: { ventas: 1400, dias: 14 }, ventasTotalesDespues: { ventas: 1400, dias: 7 } }), 'sin_muestra')
}

console.log('\n=== deshacer automático ===')
{
  const A = v(100, 20, 100, 10)
  ok('puja_subir con ACoS 40 % > 32,5 → deshacer', debeDeshacer('puja_subir', med(A, v(60, 20, 50, 5, 7))).deshacer)
  ok('presupuesto_subir con ACoS 40 % → deshacer', debeDeshacer('presupuesto_subir', med(A, v(60, 20, 50, 5, 7))).deshacer)
  ok('sin ventas con gasto 25 ≥ 2 × CPA 10 → deshacer', debeDeshacer('puja_subir', med(A, v(60, 25, 0, 0, 7))).deshacer)
  ok('sin ventas con gasto 15 < 20 → no', !debeDeshacer('puja_subir', med(A, v(60, 15, 0, 0, 7))).deshacer)
  ok('pocos clics después → no', !debeDeshacer('puja_subir', med(A, v(15, 20, 50, 5, 7))).deshacer)
  ok('ACoS 30 % (≤ 32,5) → no', !debeDeshacer('puja_subir', med(A, v(60, 15, 50, 5, 7))).deshacer)
  ok('de lanzamiento → no', !debeDeshacer('puja_subir', med(A, v(60, 20, 50, 5, 7), { fase: 'lanzamiento' })).deshacer)
  ok('una bajada nunca se deshace sola', !debeDeshacer('puja_bajar', med(A, v(60, 20, 10, 1, 7))).deshacer)
  ok('una negativa nunca se deshace sola', !debeDeshacer('negativizar', med(A, v(60, 20, 10, 1, 7))).deshacer)
  const motivo = debeDeshacer('puja_subir', med(A, v(60, 20, 50, 5, 7))).motivo ?? ''
  ok('el motivo lleva el ACoS', motivo.includes('40 %'), motivo)

  // raras: rápida de 3 días; antes 7,14 €/día
  ok('rara: ventas a 3 €/día (×0,42 < 0,70) → deshacer', debeDeshacerRara(med(A, v(10, 3, 9, 1, 3))).deshacer)
  ok('rara: ventas a 6 €/día (×0,84) → no', !debeDeshacerRara(med(A, v(10, 3, 18, 2, 3))).deshacer)
  ok('rara: cae ×0,42 pero el control cae ×0,5 (límite 0,35) → no', !debeDeshacerRara(med(A, v(10, 3, 9, 1, 3), { controlAntes: v(500, 100, 1400, 50), controlDespues: v(100, 20, 150, 5, 3) })).deshacer)
  ok('rara: sin ventas antes → no', !debeDeshacerRara(med(v(30, 5, 0, 0), v(10, 3, 0, 0, 3), { controlAntes: v(500, 100, 1400, 50), controlDespues: v(100, 20, 900, 5, 3) })).deshacer)
  ok('rara mezclada → no', !debeDeshacerRara(med(A, v(10, 3, 0, 0, 3), { mezclado: true })).deshacer)

  ok('presupuesto: vuelve al anterior (20) si el guardarraíl deja 25', valorDeDeshacerPresupuesto(20, 25) === 20)
  ok('presupuesto: el guardarraíl deja 15 → 15', valorDeDeshacerPresupuesto(20, 15) === 15)
  ok('presupuesto: sin límite → el anterior', valorDeDeshacerPresupuesto(20.456, null) === 20.46)
  ok('presupuesto: nunca < 1', valorDeDeshacerPresupuesto(20, 0.4) === 1)
}

console.log('\n=== resumen de veredictos ===')
{
  const r = resumenDeVeredictos([
    { clase: 'puja_subir', veredicto: 'mejoro' },
    { clase: 'puja_subir', veredicto: 'mejoro' },
    { clase: 'puja_subir', veredicto: 'empeoro' },
    { clase: 'puja_subir', veredicto: 'mezclado' },
    { clase: 'puja_subir', veredicto: null },
    { clase: 'negativizar', veredicto: 'sin_muestra' },
    { clase: 'negativizar', veredicto: 'neutro' },
  ])
  ok('cuenta por clase, con mezclado y sin muestra', JSON.stringify(r.puja_subir) === JSON.stringify({ mejoro: 2, empeoro: 1, neutro: 0, sinMuestra: 0, mezclado: 1 }), JSON.stringify(r))
  ok('… negativizar', JSON.stringify(r.negativizar) === JSON.stringify({ mejoro: 0, empeoro: 0, neutro: 1, sinMuestra: 1, mezclado: 0 }))
  ok('… una clase sin filas no aparece', r.presupuesto_subir === undefined)
}

console.log('\n=== subida → deshecha → la misma subida no vuelve antes de N días ===')
{
  const f = (o: Partial<{ clase: string; objetivo_id: string | null; campaign_id: string | null; veredicto: string | null; deshecho_auto: boolean | null; aplicada_dia: string }>) => ({ clase: 'puja_subir', objetivo_id: 'k1', campaign_id: 'c1', veredicto: null, deshecho_auto: false, aplicada_dia: '2026-11-01', ...o })
  const v1 = subidasVetadasPorEfectos([f({ deshecho_auto: true }), f({ clase: 'presupuesto_subir', objetivo_id: null, campaign_id: 'c2', veredicto: 'empeoro' })], '2026-10-01')
  ok('puja subida y deshecha sola → vetada para subir', v1.objetivos.has('k1'))
  ok('presupuesto subido que empeoró → campaña vetada para R1', v1.campanas.has('c2') && !v1.campanas.has('c1'))
  const v2 = subidasVetadasPorEfectos([f({ veredicto: 'mejoro' }), f({ objetivo_id: 'k2', veredicto: 'mezclado' }), f({ clase: 'puja_bajar', objetivo_id: 'k3', veredicto: 'empeoro' })], '2026-10-01')
  ok('mejoró, mezclada (p. ej. deshecha por el freno) o una bajada que empeoró → no vetan subir', v2.objetivos.size === 0 && v2.campanas.size === 0)
  ok('pasada la ventana (aplicada antes de desdeDia) → ya no veta', subidasVetadasPorEfectos([f({ deshecho_auto: true, aplicada_dia: '2026-09-01' })], '2026-10-01').objetivos.size === 0)
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
if (fallos) process.exit(1)
