import { ivaPorDefecto, margenDeProducto, objetivosDeProducto, pujaBaseSugerida } from './margen'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** MARGEN Y OBJETIVOS. Lo que duele si falla: un ACoS de equilibrio inflado (se gasta de más) o un 0 % inventado cuando falta un dato */

console.log('\n=== margen de un producto con IVA ===')
{
  // 24,20 € con IVA 21 % → neto 20. Coste 6, comisión 15 % de 24,20 = 3,63, FBA 3,5, otros 1 → margen 20 − 6 − 3,63 − 3,5 − 1 = 5,87
  const m = margenDeProducto({ precio: 24.2, ivaPct: 21, costeProducto: 6, comisionPct: 15, tarifaFba: 3.5, otrosCostes: 1 })
  ok('neto sin IVA = 20', m?.netoSinIva === 20, JSON.stringify(m))
  ok('comisión sobre el precio CON IVA = 3,63', m?.comision === 3.63, JSON.stringify(m))
  ok('margen = 5,87', m?.margen === 5.87, JSON.stringify(m))
  ok('ACoS de equilibrio = margen ÷ precio con IVA = 24,3 %', m?.acosEquilibrioPct === 24.3, JSON.stringify(m))
}

console.log('\n=== sin IVA (EE. UU.) ===')
{
  const m = margenDeProducto({ precio: 30, ivaPct: 0, costeProducto: 8, comisionPct: 15, tarifaFba: 5, otrosCostes: 0 })
  ok('margen = 30 − 8 − 4,5 − 5 = 12,5 y equilibrio 41,7 %', m?.margen === 12.5 && m?.acosEquilibrioPct === 41.7, JSON.stringify(m))
}

console.log('\n=== datos que faltan o no valen ===')
{
  const base = { ivaPct: 21, comisionPct: 15, tarifaFba: 0, otrosCostes: 0 }
  ok('sin precio → null', margenDeProducto({ ...base, precio: null, costeProducto: 5 }) === null)
  ok('sin coste → null (un 0 % se leería como dato)', margenDeProducto({ ...base, precio: 20, costeProducto: null }) === null)
  ok('precio 0 → null', margenDeProducto({ ...base, precio: 0, costeProducto: 5 }) === null)
  ok('coste negativo → null', margenDeProducto({ ...base, precio: 20, costeProducto: -1 }) === null)
  const pierde = margenDeProducto({ ...base, precio: 10, costeProducto: 9 })
  ok('si pierde dinero sin publicidad: margen negativo y equilibrio 0 (no negativo)', !!pierde && pierde.margen < 0 && pierde.acosEquilibrioPct === 0, JSON.stringify(pierde))
}

console.log('\n=== objetivos por fase ===')
{
  const m = margenDeProducto({ precio: 24.2, ivaPct: 21, costeProducto: 6, comisionPct: 15, tarifaFba: 3.5, otrosCostes: 1 })!
  const p = { acosLanzamientoX: 1.5, acosMaduroX: 0.7, gastoSinVentaX: 2 }
  const lan = objetivosDeProducto(m, 24.2, { ...p, fase: 'lanzamiento' })
  ok('lanzamiento: 24,3 × 1,5 = 36,5 %', lan?.acosObjetivoPct === 36.5, JSON.stringify(lan))
  ok('CPA objetivo = 24,20 × 36,5 % = 8,83', lan?.cpaObjetivo === 8.83, JSON.stringify(lan))
  ok('gasto máximo sin venta = 2 × CPA = 17,66', lan?.gastoMaximoSinVenta === 17.66, JSON.stringify(lan))
  const mad = objetivosDeProducto(m, 24.2, { ...p, fase: 'madurez' })
  ok('madurez: 24,3 × 0,7 = 17 %', mad?.acosObjetivoPct === 17, JSON.stringify(mad))
  const cre = objetivosDeProducto(m, 24.2, { ...p, fase: 'crecimiento' })
  ok('crecimiento: punto medio (1,1×) = 26,7 %', cre?.acosObjetivoPct === 26.7, JSON.stringify(cre))
  ok('con equilibrio 0 no hay objetivo', objetivosDeProducto({ ...m, acosEquilibrioPct: 0 }, 24.2, { ...p, fase: 'lanzamiento' }) === null)
}

console.log('\n=== puja base sugerida ===')
{
  ok('precio 24,20 × 36,5 % × 10 % = 0,88', pujaBaseSugerida(24.2, 36.5) === 0.88, String(pujaBaseSugerida(24.2, 36.5)))
  ok('nunca por debajo de 0,10', pujaBaseSugerida(2, 5) === 0.1)
  ok('sin datos → null', pujaBaseSugerida(null, 30) === null && pujaBaseSugerida(20, null) === null && pujaBaseSugerida(20, 0) === null)
}

console.log('\n=== IVA por país ===')
{
  ok('España 21, Reino Unido 20, EE. UU. 0, desconocido 21', ivaPorDefecto('ES') === 21 && ivaPorDefecto('UK') === 20 && ivaPorDefecto('US') === 0 && ivaPorDefecto('XX') === 21)
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
