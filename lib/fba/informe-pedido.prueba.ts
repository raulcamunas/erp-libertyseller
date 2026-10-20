import type { LineaDePanel, RemesaDePanel } from '@/lib/fba/datos'
import { informeDePedido, recepcionDe, textoDeEstado } from '@/lib/fba/informe-pedido'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL INFORME DE UN PEDIDO: LAS CIFRAS Y LAS FRASES.
 *
 * Lo que importa comprobar es que (1) las cifras sean las de la pantalla, (2) un envío que va de
 * camino no se cuente como «perdido» aunque la base guarde ceros de recibidas, y (3) lo que se le
 * dice al cliente en palabras diga lo mismo que las cifras: ni una unidad más ni una menos.
 */

const HOY = '2026-10-20'

function linea(sobre: Partial<LineaDePanel> & { sku: string; enviadas: number }): LineaDePanel {
  return {
    recibidas: sobre.enviadas,
    nombre: `Producto ${sobre.sku}`,
    variante: null,
    asin: null,
    referencia: null,
    fnsku: null,
    ean: null,
    consumidas: 0,
    devueltas: 0,
    quedan: sobre.enviadas - (sobre.consumidas ?? 0),
    quedanVendibles: sobre.enviadas - (sobre.consumidas ?? 0),
    retiradas: 0,
    mermas: 0,
    agotadaEl: null,
    porDia: {},
    ...sobre,
  }
}

function remesa(lineas: LineaDePanel[], sobre: Partial<RemesaDePanel> = {}): RemesaDePanel {
  const porDia = new Map<string, number>()
  for (const l of lineas) for (const [f, v] of Object.entries(l.porDia)) porDia.set(f, (porDia.get(f) ?? 0) + v)
  return {
    id: 'r1',
    nombre: 'Reposición de octubre',
    fechaEnvio: '2026-10-05',
    llegadaAt: '2026-10-10T09:00:00Z',
    referenciaEnvio: 'FBA15ABC',
    nota: null,
    estadoAmazon: 'CLOSED',
    seguimientoAt: null,
    seguimientoError: null,
    estado: 'cerrada',
    aprobadaAt: null,
    creadaAt: null,
    actualizadaAt: null,
    version: 1,
    reabiertaAt: null,
    ultimaImpresion: null,
    analisisIa: null,
    envios: [{ shipmentId: 'FBA15ABC', confirmationId: null, nombre: null, destino: 'BCN1', estado: null, transportista: null, esDeAmazon: null, coste: null, moneda: null, saleDesde: null, saleHasta: null, entregaDesde: null, entregaHasta: null }],
    unidadesQueNoLlegaron: 0,
    lineas,
    eventos: [],
    ventasPorDia: [...porDia.entries()].sort().map(([fecha, vendidas]) => ({ fecha, vendidas })),
    cuentaDesde: (sobre.llegadaAt === undefined ? '2026-10-10T09:00:00Z' : (sobre.llegadaAt ?? sobre.fechaEnvio ?? '2026-10-05')).slice(0, 10),
    enviadas: lineas.reduce((s, l) => s + l.enviadas, 0),
    quedan: lineas.reduce((s, l) => s + l.quedan, 0),
    consumidoPct: 0,
    agotadaEl: null,
    ...sobre,
  }
}

// Días 15 a 20 de octubre: A vende cada día, B se agota el 17 y C no vende
const ventasA = { '2026-10-14': 4, '2026-10-15': 5, '2026-10-16': 5, '2026-10-17': 4, '2026-10-18': 6, '2026-10-19': 3, '2026-10-20': 3 } // 30 en total (incluye 3 no ventas)
const ventasB = { '2026-10-12': 10, '2026-10-14': 15, '2026-10-17': 15 } // 40
const A = linea({ sku: 'A-1', enviadas: 50, recibidas: 48, consumidas: 30, devueltas: 3, retiradas: 2, mermas: 1, quedan: 18, porDia: ventasA, variante: 'Talla 39' })
const B = linea({ sku: 'B-2', enviadas: 40, consumidas: 40, quedan: 0, agotadaEl: '2026-10-17', porDia: ventasB })
const C = linea({ sku: 'C-3', enviadas: 30, consumidas: 0, quedan: 30 })

console.log('\n=== un pedido cerrado: llegó casi todo, se vende y queda stock ===')
{
  const r = remesa([A, B, C], { agotadaEl: null })
  const i = informeDePedido({ cliente: 'ShoesF', remesa: r, skus: [], hoy: HOY })
  const c = i.cifras
  ok('Amazon ha contado: recepción «contada»', i.recepcion === 'contada' && i.estadoTexto === 'Cerrado')
  ok('enviadas 120, recibidas 118, faltan 2', c.enviadas === 120 && c.recibidas === 118 && c.faltan === 2, `${c.enviadas}/${c.recibidas}/${c.faltan}`)
  ok('vendidas 70 como en la pantalla (incluye 2 retiradas y 1 merma)', c.vendidas === 70 && c.retiradas === 2 && c.mermas === 1 && c.ventasReales === 67, `${c.vendidas}/${c.ventasReales}`)
  ok('quedan 48 y una referencia agotada', c.quedan === 48 && c.agotadas === 1, `${c.quedan}/${c.agotadas}`)
  ok('la base del reparto es lo recibido: 70 + 48 = 118', c.base === 118, String(c.base))
  ok('porcentajes: 98 % recibido, 59 % vendido, 41 % queda', c.pctRecibido === 98 && c.pctVendido === 59 && c.pctQuedan === 41, `${c.pctRecibido}/${c.pctVendido}/${c.pctQuedan}`)
  ok('el embudo suma lo enviado: 67 + 3 + 48 + 2 = 120', i.embudo.map((p) => p.unidades).join() === '67,3,48,2' && i.embudo.reduce((s, p) => s + p.unidades, 0) === 120, i.embudo.map((p) => p.unidades).join())
  ok('el embudo reparte el 100 % (con redondeos, entre 99 y 101)', (() => { const s = i.embudo.reduce((a, p) => a + p.pct, 0); return s >= 99 && s <= 101 })(), i.embudo.map((p) => p.pct).join())
  ok('lo que no llegó es la A: faltan 2 de 50', i.noLlegaron.length === 1 && i.noLlegaron[0].sku === 'A-1' && i.noLlegaron[0].faltan === 2 && i.noLlegaron[0].recibidas === 48, JSON.stringify(i.noLlegaron))
  ok('lo más vendido arriba: B (40), A (30), C (0)', i.productos.map((p) => p.sku).join() === 'B-2,A-1,C-3', i.productos.map((p) => p.sku).join())
  ok('cada producto trae cómo rota', i.productos[0].rotacion === 'Agotado' && i.productos[2].rotacion === 'Sin ventas', i.productos.map((p) => p.rotacion).join())
  ok('la serie va de la llegada a hoy sin huecos: 11 días', i.serie.length === 11 && i.serie[0].fecha === '2026-10-10' && i.serie[10].fecha === HOY, `${i.serie.length}`)
  ok('lleva 11 días de vida desde que llegó', i.diasDeVida === 10, String(i.diasDeVida))
  ok('el título es el nombre del pedido y el destino sale', i.titulo === 'Reposición de octubre' && i.destinos.join() === 'BCN1')
  ok('el recorrido en Amazon: todos los pasos hasta «Cerrado» hechos', i.pasos.length === 6 && i.pasos.every((p) => p.hecho), i.pasos.map((p) => p.hecho).join())

  console.log('\n  --- lo que se dice en palabras ---')
  i.resumen.forEach((f) => console.log(`    · ${f}`))
  ok('cuatro frases: envío, ventas, almacén y lo que hay que vigilar', i.resumen.length === 4, String(i.resumen.length))
  ok('1ª: lo enviado y lo que falta', i.resumen[0] === 'Se enviaron 120 unidades de 3 referencias el 5 de octubre de 2026. Amazon ha recibido 118: faltan 2.', i.resumen[0])
  ok('2ª: lo vendido, el porcentaje y el ritmo, y lo que no son ventas', /se han vendido 70 unidades, el 59 % de lo recibido: .* al día de media y .* en la última semana\. De ellas, 3 no son ventas \(2 retiradas del almacén y 1 merma\)\.$/.test(i.resumen[1]), i.resumen[1])
  ok('3ª: lo que queda y para cuánto', /^Quedan 48 unidades en el almacén; al ritmo de la última semana duran unos \d+ días \(se agotarían hacia el \d+ de \w+ de 2026\)\.$/.test(i.resumen[2]), i.resumen[2])
  ok('4ª: una agotada, una que se agota esta semana (la A: 18 a ~4 al día) y una sin ventas, sin repetir «referencia»', i.resumen[3] === '1 referencia está agotada, una se agotará en menos de una semana y una no se ha vendido en los últimos 30 días.', i.resumen[3])
  ok('los avisos explican las no ventas, las devueltas y el reparto por orden de llegada', i.avisos.length === 3 && /incluye 3 unidades que no son ventas/.test(i.avisos[0]) && /3 unidades devueltas/.test(i.avisos[1]) && /orden de llegada/.test(i.avisos[2]), i.avisos.map((a) => a.slice(0, 40)).join(' | '))
}

console.log('\n=== recibir de más en una referencia no compensa lo que falta en otra ===')
{
  // Como el envío real de Cobo: 80 enviadas, 78 recibidas y «faltan 4», porque dos referencias llegaron con una de más
  const L = [
    linea({ sku: 'P', enviadas: 10, recibidas: 8, consumidas: 2, quedan: 6 }),
    linea({ sku: 'Q', enviadas: 10, recibidas: 11, consumidas: 3, quedan: 8 }),
    linea({ sku: 'R', enviadas: 10, recibidas: 8, consumidas: 1, quedan: 7 }),
    linea({ sku: 'S', enviadas: 10, recibidas: 11, consumidas: 0, quedan: 11 }),
  ]
  const i = informeDePedido({ cliente: 'C', remesa: remesa(L), skus: [], hoy: HOY })
  ok('enviadas 40, recibidas 38, faltan 4 (2 + 2) y sobran 2 en 2 referencias', i.cifras.enviadas === 40 && i.cifras.recibidas === 38 && i.cifras.faltan === 4 && i.cifras.sobrantes === 2 && i.cifras.referenciasConDeMas === 2, JSON.stringify([i.cifras.enviadas, i.cifras.recibidas, i.cifras.faltan, i.cifras.sobrantes, i.cifras.referenciasConDeMas]))
  ok('lo explica: la resta (2) es menor que lo que falta (4)', i.avisos.some((a) => /En 2 referencias Amazon ha recibido más de lo que se envió \(2 unidades de más en total\): por eso la diferencia entre enviadas y recibidas \(2\) es menor que lo que falta \(4\)/.test(a)), i.avisos.map((a) => a.slice(0, 60)).join(' | '))
  ok('y la lista de lo que no llegó solo lleva las dos cortas', i.noLlegaron.map((x) => x.sku).join() === 'P,R')
  // Si lo de más iguala o supera a lo que falta, la resta es cero o negativa y se dice de otra manera
  const M = [linea({ sku: 'P', enviadas: 10, recibidas: 9, consumidas: 0, quedan: 9 }), linea({ sku: 'Q', enviadas: 10, recibidas: 12, consumidas: 0, quedan: 12 })]
  const iM = informeDePedido({ cliente: 'C', remesa: remesa(M), skus: [], hoy: HOY })
  ok('si en total llega lo mismo o más, lo dice sin una resta engañosa', iM.avisos.some((a) => /tantas unidades como se enviaron o más, pero no en las mismas referencias: faltan 1 en unas y le sobran 2 en otras/.test(a)), iM.avisos.join(' | ').slice(0, 200))
  // Sin recibir de más no hace falta explicar nada
  const sinMas = informeDePedido({ cliente: 'C', remesa: remesa([A, B, C]), skus: [], hoy: HOY })
  ok('sin referencias con de más no se explica nada', !sinMas.avisos.some((a) => /ha recibido más de lo que se envió/.test(a)))
}

console.log('\n=== hasta cuándo están leídas las ventas ===')
{
  const r = remesa([A, B, C])
  const fresco = informeDePedido({ cliente: 'C', remesa: r, skus: [], hoy: HOY, ventasHasta: '2026-10-19' })
  ok('con un día de retraso (lo normal) no se avisa, pero la fecha queda en el informe', fresco.ventasHasta === '2026-10-19' && !fresco.avisos.some((a) => /leídas hasta/.test(a)))
  const atrasado = informeDePedido({ cliente: 'C', remesa: r, skus: [], hoy: HOY, ventasHasta: '2026-10-15' })
  ok('con cinco días de retraso es lo PRIMERO que se avisa, con los días', /^Las ventas están leídas hasta el 15 de octubre de 2026, hace 5 días/.test(atrasado.avisos[0]), atrasado.avisos[0]?.slice(0, 120))
  const sin = informeDePedido({ cliente: 'C', remesa: r, skus: [], hoy: HOY })
  ok('sin fecha de lectura no se inventa ni se avisa', sin.ventasHasta === null && !sin.avisos.some((a) => /leídas hasta/.test(a)))
  const rara = informeDePedido({ cliente: 'C', remesa: r, skus: [], hoy: HOY, ventasHasta: 'ayer' })
  ok('una fecha que no lo es se descarta', rara.ventasHasta === null)
}

console.log('\n=== un pedido que va de camino: los ceros de Amazon no son «faltas» ===')
{
  // Lo que guarda la base mientras viaja: recibidas = 0 en todas las líneas
  const L = [linea({ sku: 'A-1', enviadas: 50, recibidas: 0, quedan: 50 }), linea({ sku: 'B-2', enviadas: 40, recibidas: 0, quedan: 40 })]
  const r = remesa(L, { estadoAmazon: 'IN_TRANSIT', llegadaAt: null, unidadesQueNoLlegaron: 90 })
  const i = informeDePedido({ cliente: 'ShoesF', remesa: r, skus: [], hoy: HOY })
  ok('recepción «en camino»', i.recepcion === 'en_camino' && i.estadoTexto === 'En tránsito')
  ok('no se sabe lo recibido y no falta nada (la pantalla diría «faltan 90»)', i.cifras.recibidas === null && i.cifras.faltan === 0 && i.noLlegaron.length === 0, JSON.stringify([i.cifras.recibidas, i.cifras.faltan]))
  ok('sin serie ni días de vida: todavía no hay nada que vender', i.serie.length === 0 && i.diasDeVida === null)
  ok('una sola frase y un solo aviso, sin inventar ventas', i.resumen.length === 1 && /Todavía no han llegado/.test(i.resumen[0]) && i.avisos.length === 1 && /todavía no ha llegado/.test(i.avisos[0]), `${i.resumen.length}/${i.avisos.length}`)
  ok('el recorrido muestra solo hasta «En tránsito»', i.pasos.map((p) => p.hecho).join() === 'true,true,false,false,false,false', i.pasos.map((p) => p.hecho).join())
}

console.log('\n=== un envío sin enlazar con Amazon ===')
{
  const L = [linea({ sku: 'A-1', enviadas: 50, recibidas: null, consumidas: 10, quedan: 40, porDia: { '2026-10-15': 10 } })]
  const r = remesa(L, { referenciaEnvio: null, estadoAmazon: null, llegadaAt: null })
  const i = informeDePedido({ cliente: 'Yo By Yolanda', remesa: r, skus: [], hoy: HOY })
  ok('recepción «sin confirmar» y estado «Sin enlazar con Amazon»', i.recepcion === 'sin_confirmar' && i.estadoTexto === 'Sin enlazar con Amazon' && i.referenciaEnvio === null)
  ok('se cuenta con lo enviado: base 50', i.cifras.base === 50 && i.cifras.recibidas === null && i.cifras.faltan === 0, String(i.cifras.base))
  ok('el resumen lo dice y cuenta desde el envío', /no ha confirmado cuántas ha recibido/.test(i.resumen[0]) && /Desde que se envió \(hace 15 días\)/.test(i.resumen[1]), i.resumen.slice(0, 2).join(' | '))
  ok('y avisa de que Amazon no lo ha confirmado', i.avisos.some((a) => /no ha confirmado qué ha recibido/.test(a)))
  ok('sin recorrido en Amazon que enseñar', i.pasos.length === 0)
}

console.log('\n=== casos de borde ===')
{
  // Todo vendido
  const todo = remesa([linea({ sku: 'X', enviadas: 20, consumidas: 20, quedan: 0, agotadaEl: '2026-10-18', porDia: { '2026-10-18': 20 } })], { agotadaEl: '2026-10-18' })
  const i1 = informeDePedido({ cliente: 'C', remesa: todo, skus: [], hoy: HOY })
  ok('agotado: lo dice con el día', i1.resumen.some((f) => f === 'El pedido está agotado desde el 18 de octubre de 2026.'), i1.resumen.join(' | '))
  ok('y la frase de vigilar con una sola alerta es corta: «1 referencia está agotada.»', i1.resumen[3] === '1 referencia está agotada.', i1.resumen[3])

  // Llegó y no se ha vendido nada
  const nada = remesa([linea({ sku: 'X', enviadas: 20, quedan: 20 })])
  const i2 = informeDePedido({ cliente: 'C', remesa: nada, skus: [], hoy: HOY })
  ok('sin ventas: «todavía no se ha vendido ninguna unidad»', /todavía no se ha vendido ninguna unidad\.$/.test(i2.resumen[1]) && /no se puede estimar cuánto durarán/.test(i2.resumen[2]), i2.resumen.slice(1).join(' | '))
  ok('y no se inventa un ritmo ni una fecha de agotamiento', i2.cifras.cobertura === null && i2.cifras.seAgotaEl === null && i2.cifras.udDia7 === 0)

  // Un ritmo ínfimo: miles de días de stock no se dicen en cifras
  const lento = remesa([linea({ sku: 'L', enviadas: 2001, consumidas: 1, quedan: 2000, porDia: { '2026-10-19': 1 } })])
  const iL = informeDePedido({ cliente: 'C', remesa: lento, skus: [], hoy: HOY })
  ok('con un ritmo ínfimo dice «duran más de un año», no «unos 14000 días»', iL.resumen.some((f) => /duran más de un año\.$/.test(f)) && !iL.resumen.some((f) => /días \(se agotarían/.test(f)), iL.resumen.join(' | '))

  // Singulares
  const uno = remesa([linea({ sku: 'X', enviadas: 1, consumidas: 1, quedan: 0, agotadaEl: '2026-10-19', porDia: { '2026-10-19': 1 } })], { nombre: null })
  const i3 = informeDePedido({ cliente: 'C', remesa: uno, skus: [], hoy: HOY })
  ok('singular: «1 unidad de 1 referencia» y «se han vendido 1 unidad»', /^Se enviaron 1 unidad de 1 referencia el /.test(i3.resumen[0]) && /se han vendido 1 unidad,/.test(i3.resumen[1]), i3.resumen.slice(0, 2).join(' | '))
  ok('sin nombre, el título lleva la fecha de envío', i3.titulo === 'Envío del 05/10/2026', i3.titulo)

  // Amazon recibió MÁS de lo declarado: no es una falta
  const mas = remesa([linea({ sku: 'X', enviadas: 20, recibidas: 22, consumidas: 2, quedan: 20, porDia: { '2026-10-19': 2 } })])
  const i4 = informeDePedido({ cliente: 'C', remesa: mas, skus: [], hoy: HOY })
  ok('recibir de más no es una falta, y la base es lo recibido', i4.cifras.faltan === 0 && i4.cifras.recibidas === 22 && i4.cifras.base === 22 && i4.noLlegaron.length === 0, JSON.stringify([i4.cifras.faltan, i4.cifras.recibidas]))
  ok('el porcentaje recibido puede pasar de 100 y no revienta', i4.cifras.pctRecibido === 110, String(i4.cifras.pctRecibido))

  // Un pedido vacío no revienta
  const vacio = remesa([])
  const i5 = informeDePedido({ cliente: 'C', remesa: vacio, skus: [], hoy: HOY })
  ok('sin líneas no revienta y no da NaN', i5.cifras.enviadas === 0 && i5.cifras.pctVendido === 0 && i5.embudo.every((p) => Number.isFinite(p.pct)) && i5.productos.length === 0)

  // Estados
  const estados: Array<[string | null, string]> = [['CLOSED', 'Cerrado'], ['RECEIVING', 'Recibiendo'], ['CHECKED_IN', 'Registrado'], ['DELIVERED', 'Entregado'], ['SHIPPED', 'En tránsito'], ['WORKING', 'Preparándose'], ['CANCELLED', 'Cancelado'], [null, 'Sin consultar']]
  ok('los estados con las mismas palabras que la pantalla', estados.every(([e, t]) => textoDeEstado({ referenciaEnvio: 'FBA1', estadoAmazon: e, seguimientoError: null }) === t), estados.map(([e]) => textoDeEstado({ referenciaEnvio: 'FBA1', estadoAmazon: e, seguimientoError: null })).join(','))
  ok('si Amazon no reconoce el envío, lo dice y no se cuenta como en camino', textoDeEstado({ referenciaEnvio: 'FBA1', estadoAmazon: 'WORKING', seguimientoError: 'No existe' }) === 'Amazon no lo reconoce' && recepcionDe({ referenciaEnvio: 'FBA1', estadoAmazon: 'WORKING', seguimientoError: 'No existe' }) === 'sin_confirmar')
  ok('un envío cancelado no es «en camino»', recepcionDe({ referenciaEnvio: 'FBA1', estadoAmazon: 'CANCELLED', seguimientoError: null }) === 'sin_confirmar')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
