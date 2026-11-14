import { decidirEnsayo, decidirSiSePuedeAplicar, inicioDelDiaEnEspana, motivoDeObsoleta, motorTieneTrabajo, pasoHizoAlgo, planificarPropuestas, proximoPasoDelMotor, sumarPorCampana, tocaGenerar, valorSigueIgual, type EntradaDeAplicar } from './motor-calculo'
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

console.log('\n=== sin ACoS objetivo no se propone ===')
{
  const r = planificarPropuestas({ ...base, objetivos: new Map([['B0AAAAAAA1', null]]), terminos: [t({ termino: 'fedora', gasto: 20 })] })
  ok('producto sin ACoS objetivo → ninguna propuesta y queda anotado', r.nuevas.length === 0 && r.sinObjetivo.join() === 'B0AAAAAAA1')
  const r2 = planificarPropuestas({ ...base, objetivos: new Map(), terminos: [t({ termino: 'fedora', gasto: 20 })] })
  ok('producto que ni existe en la lista → igual', r2.nuevas.length === 0 && r2.sinObjetivo.length === 1)
}

console.log('\n=== promover resuelve su destino ===')
{
  const objetivos = new Map([['B0AAAAAAA1', OBJ]])
  const prom = t({ termino: 'jamonero madera', clics: 40, gasto: 9, compras: 3, ventas: 78 })
  // Como hace motor.ts: se pide la ESTABILIDAD y, si el producto no la tiene, contesta la DOMINIO con su rol real
  const destino = (asin: string, rol: string) => (asin === 'B0AAAAAAA1' && rol === 'MANUAL EXACTA / ESTABILIDAD' ? { campaignId: 'c9', nombre: nom(asin, 'MANUAL EXACTA / DOMINIO'), adGroupId: 'g9', rol: 'MANUAL EXACTA / DOMINIO' } : null)
  const r = planificarPropuestas({ ...base, objetivos, terminos: [prom], destino: destino as never })
  ok('cosecha a la EXACTA del mismo producto (la DOMINIO si no hay ESTABILIDAD), con su campaña, grupo y la negativa en origen', r.nuevas[0].haciaCampaignId === 'c9' && r.nuevas[0].haciaAdGroupId === 'g9' && r.nuevas[0].haciaRol === 'MANUAL EXACTA / DOMINIO' && r.nuevas[0].negativizarEnOrigen === true, JSON.stringify(r.nuevas[0]))
  const ya = planificarPropuestas({ ...base, objetivos, terminos: [prom], destino: destino as never, yaEsta: (_a, _r, term) => term === 'jamonero madera' })
  ok('si el término YA está en la exacta, no se cosecha otra vez (y se cuenta)', ya.nuevas.length === 0 && ya.yaCosechadas === 1)
  const sin = planificarPropuestas({ ...base, objetivos, terminos: [prom] })
  ok('si no existe la campaña destino, la propuesta sale igual pero sin destino (no se podrá aplicar)', sin.nuevas.length === 1 && sin.nuevas[0].haciaCampaignId === null)
}

console.log('\n=== el mismo término en varios grupos se juzga sumado ===')
{
  const filas = [t({ termino: 'fedora', adGroupId: 'g1', clics: 16, gasto: 8 }), t({ termino: 'Fedora', adGroupId: 'g2', clics: 16, gasto: 12, keyword: 'fedora' })]
  const s = sumarPorCampana(filas)
  ok('una fila con 32 clics y 20 gastados, en el grupo donde más gastó', s.length === 1 && s[0].clics === 32 && s[0].gasto === 20 && s[0].adGroupId === 'g2', JSON.stringify(s))
  ok('si en algún grupo el término es su keyword, se marca', s[0].esSuSegmentacion === true)
  const r = planificarPropuestas({ ...base, objetivos: new Map([['B0AAAAAAA1', OBJ]]), terminos: [t({ termino: 'pamela', adGroupId: 'g1', clics: 16, gasto: 3 }), t({ termino: 'pamela', adGroupId: 'g2', clics: 16, gasto: 3 })] })
  ok('16 + 16 clics sin pedido (≥ 30) → se excluye; cada grupo por separado no llegaba', r.nuevas.length === 1 && r.nuevas[0].metricas.clics === 32, JSON.stringify(r.nuevas))
  ok('«jamón» y «jamon» NO se suman (son búsquedas y negativas distintas)', sumarPorCampana([t({ termino: 'jamón' }), t({ termino: 'jamon' })]).length === 2)
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
  ok('cada producto con lo suyo: uno propone y el otro, sin ACoS objetivo, se anota', dos.nuevas.length === 1 && dos.sinObjetivo.join() === 'B0BBBBBBB2')
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
  ok('el piloto automático no excluye un ASIN (lo aprueba una persona)', /ASIN/.test(motivo({ modo: 'autopiloto', automatica: true, topeDiario: 5, esAsin: true, adGroupId: 'g' })))
  ok('el piloto automático no aplica un término marcado para revisar', /revisar/.test(motivo({ modo: 'autopiloto', automatica: true, topeDiario: 5, revisar: true })))
  ok('una persona sí puede excluir un ASIN, si se sabe su grupo', motivo({ esAsin: true, adGroupId: 'g' }) === 'OK' && /grupo de anuncios/.test(motivo({ esAsin: true, adGroupId: null })))
  ok('una persona sí puede aplicar una pausa', motivo({ tipo: 'pausar' }) === 'OK')
  ok('en autopiloto una persona también puede aplicar a mano (promover incluido)', motivo({ modo: 'autopiloto', automatica: false, tipo: 'promover', haciaRol: 'MANUAL AMPLIA', haciaCampaignId: 'c', haciaAdGroupId: 'g' }) === 'OK')
}

console.log('\n=== ensayo: los candados de escribir son avisos, los demás mandan ===')
{
  const buena: EntradaDeAplicar = { modo: 'sugiere', automatica: false, tipo: 'negativizar', estado: 'pendiente', fichaFirmada: false, campaignNombre: 'B0AAAAAAA1 | SKU | JAMON | AUTO RADAR', haciaRol: null, haciaCampaignId: null, haciaAdGroupId: null, aplicadasHoy: 40, topeDiario: 40 }
  const r = decidirEnsayo(buena)
  ok('en «sugiere», sin firma y con el tope gastado se puede ensayar, con 3 avisos', r.ok && r.avisos.length === 3, JSON.stringify(r))
  const mala = decidirEnsayo({ ...buena, campaignNombre: 'Campaña cualquiera' })
  ok('sin la nomenclatura del SOP no se ensaya (no se aplicaría nunca)', !mala.ok && /nomenclatura/.test(mala.motivo))
  const aplicada = decidirEnsayo({ ...buena, estado: 'aplicada' })
  ok('una propuesta ya aplicada no se ensaya', !aplicada.ok)
  const limpia = decidirEnsayo({ ...buena, modo: 'aprueba', fichaFirmada: true, aplicadasHoy: 0 })
  ok('con todo en regla, sin avisos', limpia.ok && limpia.avisos.length === 0)
}

console.log('\n=== releer antes de aplicar: ¿sigue igual? ===')
{
  ok('mismo valor al céntimo → igual', valorSigueIgual(0.45, 0.45) && valorSigueIgual(0.45, 0.4500001))
  ok('otro valor → no', !valorSigueIgual(0.45, 0.5))
  ok('ya no existe en Amazon → no', !valorSigueIgual(0.45, null))
  ok('sin valor de partida guardado no se puede comprobar → se da por bueno', valorSigueIgual(null, 0.7))
  ok('el motivo dice el valor de ahora y el de partida', /0,50/.test(motivoDeObsoleta('puja', 0.45, 0.5)) && /0,45/.test(motivoDeObsoleta('puja', 0.45, 0.5)))
  ok('si ya no existe, lo dice', /ya no encuentra/.test(motivoDeObsoleta('presupuesto', 10, null)))
}

console.log('\n=== el proceso de fondo: ¿hay trabajo? ===')
{
  const base = { modo: 'sugiere', esperandoTerminos: false, tocaPedirTerminos: false, tocaGenerar: false, negativasPendientes: true, aplicadasHoyAuto: 0, topeAuto: 5 }
  ok('«sugiere» con negativas pendientes y nada más → SIN trabajo (antes abría fila cada 2 minutos)', !motorTieneTrabajo(base))
  ok('«aprueba» igual', !motorTieneTrabajo({ ...base, modo: 'aprueba' }))
  ok('autopiloto con pendientes y tope por gastar → trabajo', motorTieneTrabajo({ ...base, modo: 'autopiloto' }))
  ok('autopiloto con el tope gastado → sin trabajo', !motorTieneTrabajo({ ...base, modo: 'autopiloto', aplicadasHoyAuto: 5 }))
  ok('apagado nunca', !motorTieneTrabajo({ ...base, modo: 'apagado', esperandoTerminos: true }))
  ok('esperando el informe, toca pedirlo o toca generar → trabajo', motorTieneTrabajo({ ...base, esperandoTerminos: true }) && motorTieneTrabajo({ ...base, tocaPedirTerminos: true }) && motorTieneTrabajo({ ...base, tocaGenerar: true }))
  ok('informe más nuevo que la generación → toca generar', tocaGenerar('2026-11-14T10:00:00Z', '2026-11-13T10:00:00Z'))
  ok('generación posterior al informe → no', !tocaGenerar('2026-11-14T10:00:00Z', '2026-11-14T10:05:00Z'))
  ok('sin informe → no; con informe y sin generación nunca → sí', !tocaGenerar(null, null) && tocaGenerar('2026-11-14T10:00:00Z', null))
  const nada = { terminos: 'esperando', generado: false, nuevas: 0, aplicadas: 0, fallidas: 0, errores: [] as string[] }
  ok('«Amazon sigue preparando el informe» no merece fila en el registro', !pasoHizoAlgo(nada) && !pasoHizoAlgo({ ...nada, terminos: 'nada' }))
  ok('pedir, recoger, generar, aplicar o fallar sí', pasoHizoAlgo({ ...nada, terminos: 'pedido' }) && pasoHizoAlgo({ ...nada, generado: true }) && pasoHizoAlgo({ ...nada, aplicadas: 1 }) && pasoHizoAlgo({ ...nada, errores: ['x'] }))
}

console.log('\n=== el día empieza a medianoche de España ===')
{
  // 14 nov 2026 a las 00:30 en Madrid (invierno, UTC+1) = 13 nov 23:30 UTC
  const ahora = Date.parse('2026-11-13T23:30:00Z')
  ok('en invierno, a las 00:30 de Madrid el día empezó a las 23:00 UTC', inicioDelDiaEnEspana(ahora) === '2026-11-13T23:00:00.000Z', inicioDelDiaEnEspana(ahora))
  const verano = Date.parse('2026-07-10T12:00:00Z')
  ok('en verano (UTC+2), a las 14:00 de Madrid el día empezó a las 22:00 UTC del anterior', inicioDelDiaEnEspana(verano) === '2026-07-09T22:00:00.000Z', inicioDelDiaEnEspana(verano))
}

console.log('\n=== el próximo paso, en una frase ===')
{
  const b = { modo: 'sugiere', terminosAt: '2026-11-14T08:00:00Z', generadoAt: '2026-11-14T08:02:00Z', esperandoInforme: false, hayGeneradoAt: true, intervaloMs: 86_400_000, ahora: Date.parse('2026-11-14T12:00:00Z') }
  ok('apagado lo dice', /apagado/.test(proximoPasoDelMotor({ ...b, modo: 'apagado' }).texto))
  ok('esperando a Amazon lo dice', /preparando/.test(proximoPasoDelMotor({ ...b, esperandoInforme: true }).texto))
  ok('informe sin generar lo dice', /genera las propuestas/.test(proximoPasoDelMotor({ ...b, generadoAt: '2026-11-13T08:00:00Z' }).texto))
  ok('al día: la siguiente lectura a las 24 h del informe', proximoPasoDelMotor(b).cuando === '2026-11-15T08:00:00.000Z')
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
