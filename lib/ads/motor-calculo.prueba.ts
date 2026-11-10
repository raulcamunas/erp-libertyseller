import { decidirSiSePuedeAplicar, planificarPropuestas, type EntradaDeAplicar } from './motor-calculo'
import type { FilaDeTermino } from './terminos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const U = { comprasParaExacta: 2, clicsMinimosNegativizar: 15, muestraMinimaClics: 12 }
const OBJ = { acosObjetivoPct: 32.8, gastoMaximoSinVenta: 17.04 }
const nom = (asin: string, rol: string) => `${asin} | SKU | JAMON | ${rol}`
const t = (o: Partial<FilaDeTermino> & { termino: string }): FilaDeTermino => ({ campaignId: 'c1', campaignName: nom('B0AAAAAAA1', 'AUTO RADAR'), adGroupId: 'g1', keyword: null, matchType: null, impresiones: 1000, clics: 30, gasto: 5, ventas: 0, compras: 0, ...o })
const base = { umbrales: U, destino: () => null, yaHay: () => false }

console.log('\n=== por producto, con su objetivo ===')
{
  const objetivos = new Map([['B0AAAAAAA1', OBJ]])
  const r = planificarPropuestas({ ...base, objetivos, terminos: [t({ termino: 'fedora', gasto: 20 })] })
  ok('un término que gasta sin vender → negativizar, con el grupo de anuncios de origen', r.nuevas.length === 1 && r.nuevas[0].tipo === 'negativizar' && r.nuevas[0].adGroupId === 'g1' && r.nuevas[0].asin === 'B0AAAAAAA1', JSON.stringify(r.nuevas[0]))
  ok('lleva las métricas con las que se decidió', r.nuevas[0].metricas.clics === 30 && r.nuevas[0].metricas.gasto === 20)
}

console.log('\n=== sin coste no se propone ===')
{
  const r = planificarPropuestas({ ...base, objetivos: new Map([['B0AAAAAAA1', null]]), terminos: [t({ termino: 'fedora', gasto: 20 })] })
  ok('producto sin coste → ninguna propuesta y queda anotado', r.nuevas.length === 0 && r.sinCoste.join() === 'B0AAAAAAA1')
  const r2 = planificarPropuestas({ ...base, objetivos: new Map(), terminos: [t({ termino: 'fedora', gasto: 20 })] })
  ok('producto que ni existe en la lista → igual', r2.nuevas.length === 0 && r2.sinCoste.length === 1)
}

console.log('\n=== promover resuelve su destino ===')
{
  const objetivos = new Map([['B0AAAAAAA1', OBJ]])
  const prom = t({ termino: 'jamonero madera', clics: 40, gasto: 9, compras: 2, ventas: 52 })
  const destino = (asin: string, rol: string) => (asin === 'B0AAAAAAA1' && rol === 'MANUAL AMPLIA' ? { campaignId: 'c9', nombre: nom(asin, rol), adGroupId: 'g9' } : null)
  const r = planificarPropuestas({ ...base, objetivos, terminos: [prom], destino: destino as never })
  ok('sube a la AMPLIA del mismo producto, con su campaña y grupo', r.nuevas[0].haciaCampaignId === 'c9' && r.nuevas[0].haciaAdGroupId === 'g9' && r.nuevas[0].negativizarEnOrigen === true, JSON.stringify(r.nuevas[0]))
  const sin = planificarPropuestas({ ...base, objetivos, terminos: [prom] })
  ok('si no existe la campaña destino, la propuesta sale igual pero sin destino (no se podrá aplicar)', sin.nuevas.length === 1 && sin.nuevas[0].haciaCampaignId === null)
}

console.log('\n=== cuarentena y duplicados ===')
{
  const objetivos = new Map([['B0AAAAAAA1', OBJ]])
  const r = planificarPropuestas({ ...base, objetivos, terminos: [t({ termino: 'fedora', gasto: 20 })], yaHay: (c, term, tipo) => c === 'c1' && term === 'fedora' && tipo === 'negativizar' })
  ok('si ya se propuso o se resolvió hace poco, no se repite', r.nuevas.length === 0 && r.repetidas === 1)
}

console.log('\n=== lo que no se toca ===')
{
  const r = planificarPropuestas({ ...base, objetivos: new Map([['B0AAAAAAA1', OBJ]]), terminos: [t({ termino: 'x', campaignName: 'Campaña antigua B0AAAAAAA1', gasto: 99 })] })
  ok('campaña fuera de la nomenclatura: ni se evalúa', r.nuevas.length === 0 && r.evaluados === 0)
  const dos = planificarPropuestas({
    ...base,
    objetivos: new Map([['B0AAAAAAA1', OBJ], ['B0BBBBBBB2', null]]),
    terminos: [t({ termino: 'a', gasto: 20 }), t({ termino: 'b', gasto: 20, campaignId: 'c2', campaignName: nom('B0BBBBBBB2', 'AUTO RADAR') })],
  })
  ok('cada producto con lo suyo: uno propone y el otro, sin coste, se anota', dos.nuevas.length === 1 && dos.sinCoste.join() === 'B0BBBBBBB2')
}
console.log('\n=== los candados de aplicar ===')
{
  const buena: EntradaDeAplicar = { modo: 'aprueba', automatica: false, tipo: 'negativizar', estado: 'pendiente', fichaFirmada: true, campaignNombre: 'B0AAAAAAA1 | SKU | JAMON | AUTO RADAR', haciaRol: null, haciaCampaignId: null, haciaAdGroupId: null, aplicadasHoy: 0, topeDiario: 40 }
  const motivo = (e: Partial<EntradaDeAplicar>) => { const r = decidirSiSePuedeAplicar({ ...buena, ...e }); return r.ok ? 'OK' : r.motivo }
  ok('todo en regla → se puede', motivo({}) === 'OK')
  ok('apagado → no', motivo({ modo: 'apagado' }) !== 'OK')
  ok('«solo sugiere» → no se aplica nada', /sugiere/.test(motivo({ modo: 'sugiere' })))
  ok('sin la ficha firmada → no, ni con aprobación', /firmada/.test(motivo({ fichaFirmada: false })))
  ok('campaña fuera de la nomenclatura → no', /nomenclatura/.test(motivo({ campaignNombre: 'Campaña antigua' })))
  ok('propuesta ya aplicada o descartada → no', /ya está aplicada/.test(motivo({ estado: 'aplicada' })) && /ya está descartada/.test(motivo({ estado: 'descartada' })))
  ok('una propuesta en error se puede reintentar', motivo({ estado: 'error' }) === 'OK')
  ok('promover sin campaña destino → no, y dice cuál falta', /AMPLIA/.test(motivo({ tipo: 'promover', haciaRol: 'MANUAL AMPLIA' })))
  ok('promover con destino y grupo → sí', motivo({ tipo: 'promover', haciaRol: 'MANUAL AMPLIA', haciaCampaignId: 'c', haciaAdGroupId: 'g' }) === 'OK')
  ok('tope diario alcanzado → no', /Tope diario/.test(motivo({ aplicadasHoy: 40 })))
  ok('un cambio por debajo del tope sí', motivo({ aplicadasHoy: 39 }) === 'OK')
  // el piloto automático
  ok('el piloto automático negativiza en autopiloto', motivo({ modo: 'autopiloto', automatica: true, topeDiario: 5 }) === 'OK')
  ok('el piloto automático NUNCA promueve, aunque todo lo demás esté bien', /solo negativiza/.test(motivo({ modo: 'autopiloto', automatica: true, tipo: 'promover', haciaRol: 'MANUAL AMPLIA', haciaCampaignId: 'c', haciaAdGroupId: 'g' })))
  ok('en modo «aprueba» no hay piloto automático', /autopiloto/.test(motivo({ modo: 'aprueba', automatica: true })))
  ok('el piloto automático respeta su tope de 5', /Tope diario.*piloto/.test(motivo({ modo: 'autopiloto', automatica: true, aplicadasHoy: 5, topeDiario: 5 })))
  ok('en autopiloto una persona también puede aplicar a mano (promover incluido)', motivo({ modo: 'autopiloto', automatica: false, tipo: 'promover', haciaRol: 'MANUAL AMPLIA', haciaCampaignId: 'c', haciaAdGroupId: 'g' }) === 'OK')
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
