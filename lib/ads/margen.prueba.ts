import { ivaPorDefecto, margenDeProducto, objetivosDesdeAcos, pujaBaseSugerida } from './margen'

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

console.log('\n=== objetivos desde el ACoS que elige una persona ===')
{
  const o = objetivosDesdeAcos(24.2, 30, 2)
  ok('precio 24,20 y ACoS objetivo 30 % → CPA objetivo 7,26', o?.cpaObjetivo === 7.26, JSON.stringify(o))
  ok('gasto máximo sin venta = 2 × CPA = 14,52', o?.gastoMaximoSinVenta === 14.52)
  ok('el ACoS se devuelve tal cual lo fijó', o?.acosObjetivoPct === 30)
  ok('sin precio o sin ACoS objetivo → null (no se inventa nada)', objetivosDesdeAcos(null, 30, 2) === null && objetivosDesdeAcos(24.2, null, 2) === null && objetivosDesdeAcos(24.2, undefined, 2) === null)
  ok('valores que no valen → null', objetivosDesdeAcos(0, 30, 2) === null && objetivosDesdeAcos(24.2, 0, 2) === null && objetivosDesdeAcos(24.2, 101, 2) === null && objetivosDesdeAcos(24.2, 30, 0) === null)
  ok('ya NO depende del equilibrio: se puede fijar un objetivo mayor que él', objetivosDesdeAcos(24.2, 60, 2)?.cpaObjetivo === 14.52)
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
