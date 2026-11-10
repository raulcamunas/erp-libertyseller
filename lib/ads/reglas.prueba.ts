import { partesDeNombre, proponerCambios, type TerminoDeBusqueda } from './reglas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** REGLAS DEL SOP. Lo que duele si falla: negativizar lo que vendía, promover sin historial, o tocar campañas ajenas a la nomenclatura */

const U = { comprasParaExacta: 2, clicsMinimosNegativizar: 15, muestraMinimaClics: 12 }
const O = { acosObjetivoPct: 32.8, gastoMaximoSinVenta: 17.04 }
const nombre = (rol: string) => `B0B4LLL91M | 650 GATO GRIS/37 FBA | ZAPATILLAS CASA MUJER | ${rol}`
const t = (o: Partial<TerminoDeBusqueda> & { termino: string }): TerminoDeBusqueda => ({ campaignId: 'c1', campaignName: nombre('AUTO RADAR'), clics: 20, gasto: 5, compras: 0, ventas: 0, ...o })

console.log('\n=== partes del nombre ===')
{
  const p = partesDeNombre(nombre('MANUAL EXACTA / DOMINIO'))
  ok('ASIN, SKU, resumen y rol', p?.asin === 'B0B4LLL91M' && p?.sku === '650 GATO GRIS/37 FBA' && p?.resumen === 'ZAPATILLAS CASA MUJER' && p?.rol === 'MANUAL EXACTA / DOMINIO', JSON.stringify(p))
  ok('nombre viejo sin nomenclatura → null', partesDeNombre('Campaña auto zapatillas') === null)
  ok('rol inventado → null', partesDeNombre('A | B | C | OTRA COSA') === null)
  ok('el rol se lee aunque lleve espacios o minúsculas', partesDeNombre('A | B | C | auto  radar')?.rol === 'AUTO RADAR')
}

console.log('\n=== negativizar ===')
{
  const r = proponerCambios([t({ termino: 'sombrero fedora', clics: 30, gasto: 20 })], U, O)
  ok('30 clics, 20 gastados y 0 compras → negativizar', r.length === 1 && r[0].tipo === 'negativizar', JSON.stringify(r))
  ok('lleva su motivo con las cifras', /20 gastados en 30 clics/.test(r[0]?.motivo ?? ''), r[0]?.motivo)
  ok('gasto por debajo del tope → nada', proponerCambios([t({ termino: 'a', clics: 30, gasto: 10 })], U, O).length === 0)
  ok('gasto alto pero pocos clics (14 < 15) → nada', proponerCambios([t({ termino: 'a', clics: 14, gasto: 30 })], U, O).length === 0)
  ok('con alguna compra NUNCA se negativiza', proponerCambios([t({ termino: 'a', clics: 40, gasto: 40, compras: 1, ventas: 25 })], U, O).length === 0)
  ok('exactamente en el tope sí (≥)', proponerCambios([t({ termino: 'a', clics: 15, gasto: 17.04 })], U, O).length === 1)
}

console.log('\n=== muestra mínima ===')
{
  ok('11 clics (< 12) → ninguna propuesta aunque gaste mucho', proponerCambios([t({ termino: 'a', clics: 11, gasto: 50 })], U, O).length === 0)
  ok('con 2 compras pero 11 clics → tampoco promueve', proponerCambios([t({ termino: 'a', clics: 11, gasto: 6, compras: 2, ventas: 52 })], U, O).length === 0)
}

console.log('\n=== promover ===')
{
  const r = proponerCambios([t({ termino: 'zapatillas cuña mujer', clics: 40, gasto: 9, compras: 2, ventas: 52 })], U, O)
  ok('AUTO con 2 compras y ACoS 17,3 % ≤ 32,8 % → a MANUAL AMPLIA', r.length === 1 && r[0].tipo === 'promover' && r[0].haciaRol === 'MANUAL AMPLIA', JSON.stringify(r))
  ok('se negativiza también en la campaña de origen', r[0]?.negativizarEnOrigen === true)
  ok('AMPLIA → EXACTA / DOMINIO', proponerCambios([t({ termino: 'x', campaignName: nombre('MANUAL AMPLIA'), clics: 40, gasto: 9, compras: 3, ventas: 70 })], U, O)[0]?.haciaRol === 'MANUAL EXACTA / DOMINIO')
  ok('ACoS por encima del objetivo → no promueve', proponerCambios([t({ termino: 'x', clics: 40, gasto: 30, compras: 2, ventas: 52 })], U, O).filter((p) => p.tipo === 'promover').length === 0)
  ok('1 compra (< 2) → no promueve', proponerCambios([t({ termino: 'x', clics: 40, gasto: 5, compras: 1, ventas: 26 })], U, O).length === 0)
  ok('desde EXACTA / DOMINIO, ESTABILIDAD o ATAQUE no se promueve (no son escalón)', ['MANUAL EXACTA / DOMINIO', 'MANUAL EXACTA / ESTABILIDAD', 'ATAQUE ASIN'].every((rol) => proponerCambios([t({ termino: 'x', campaignName: nombre(rol), clics: 40, gasto: 9, compras: 3, ventas: 80 })], U, O).length === 0))
}

console.log('\n=== lo que se deja en paz ===')
{
  ok('campaña fuera de la nomenclatura → el motor no la toca', proponerCambios([t({ termino: 'x', campaignName: 'Auto antigua', clics: 99, gasto: 99 })], U, O).length === 0)
  const dup = proponerCambios([t({ termino: 'Fedora', clics: 30, gasto: 20 }), t({ termino: ' fedora ', clics: 30, gasto: 20 })], U, O)
  ok('el mismo término dos veces en la misma campaña → una propuesta', dup.length === 1)
  const dosCampanas = proponerCambios([t({ termino: 'fedora', clics: 30, gasto: 20 }), t({ termino: 'fedora', campaignId: 'c2', campaignName: nombre('MANUAL AMPLIA'), clics: 30, gasto: 20 })], U, O)
  ok('el mismo término en dos campañas distintas → una por campaña', dosCampanas.length === 2)
}

console.log('\n=== orden ===')
{
  const r = proponerCambios(
    [t({ termino: 'pierde poco', clics: 20, gasto: 18 }), t({ termino: 'pierde mucho', clics: 60, gasto: 45 }), t({ termino: 'gana', clics: 40, gasto: 9, compras: 2, ventas: 52 })],
    U,
    O
  )
  ok('primero promover, luego negativizar por gasto descendente', r.map((p) => p.termino).join(',') === 'gana,pierde mucho,pierde poco', r.map((p) => p.termino).join(','))
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
