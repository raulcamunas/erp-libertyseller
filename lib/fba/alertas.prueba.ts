import {
  CONFIG_ALERTAS_POR_DEFECTO,
  calcularAlertas,
  contarPorSeveridad,
  factorEstacional,
  planearAlertas,
  plazoValido,
  type AlertaFba,
  type ConfigAlertas,
  type EntradaAlertas,
  type EnvioParaAlertas,
  type FilaDeAlerta,
} from '@/lib/fba/alertas'
import { sumarDiasInv, type InventarioCliente, type ResumenInventario, type SkuInventario } from '@/lib/fba/inventario'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LAS ALERTAS, CON NÚMEROS QUE SE PUEDEN SEGUIR A MANO.
 * El «hoy» es fijo para que nada dependa del día en que se corre la prueba.
 */

const HOY = '2026-11-02'

function sku(sobre: Partial<SkuInventario> & { sku: string }): SkuInventario {
  const base: SkuInventario = {
    sku: sobre.sku,
    asin: null,
    fnsku: null,
    nombre: `Producto ${sobre.sku}`,
    precio: 20,
    moneda: 'EUR',
    enAmazon: 0,
    vendibles: 0,
    entrante: 0,
    noDisponibles: 0,
    // Vende de verdad: 30 en un mes, 1 al día
    vendidas: { d7: 7, d14: 14, d30: 30, d60: 60, d90: 90 },
    devueltas: { d30: 0, d90: 0 },
    tasaDevolucion90: null,
    ritmo7: 1,
    ritmo30: 1,
    ritmo90: 1,
    ritmoPlan: 1,
    tendencia: null,
    muestraCorta: false,
    serie90: null,
    ultimaVenta: HOY,
    diasSinVenta: 0,
    primeraEntrada: null,
    lotes: [],
    edadMediaDias: null,
    edadMaxDias: null,
    porTramo: { t0: 0, t91: 0, t181: 0, t271: 0, t366: 0 },
    anteriorALaLectura: 0,
    diasMedioDeVenta: null,
    retiradas: 0,
    mermas: 0,
    descuadre: 0,
    cobertura: null,
    seAgotaEl: null,
    valorStock: null,
    valorVentas30: null,
    estado: 'ok',
    alertas: [],
  }
  return { ...base, ...sobre }
}

function resumenVacio(): ResumenInventario {
  return {
    unidadesEnAmazon: 0,
    vendibles: 0,
    entrante: 0,
    noDisponibles: 0,
    valorStock: 0,
    sinPrecio: 0,
    vendidas30: 0,
    valorVentas30: 0,
    ritmo30: 0,
    coberturaMedia: null,
    vendidas90: 0,
    devueltas90: 0,
    tasaDevolucion90: null,
    referencias: 0,
    agotadas: 0,
    urgentes: 0,
    paradas: 0,
    paradasUnidades: 0,
    paradasValor: 0,
    exceso: 0,
    edadMediaDias: null,
    porTramo: { t0: 0, t91: 0, t181: 0, t271: 0, t366: 0 },
    valorPorTramo: { t0: 0, t91: 0, t181: 0, t271: 0, t366: 0 },
    anteriorALaLectura: 0,
    unidadesAntiguas: 0,
    conNoVendibles: 0,
    enviosEnCamino: 0,
  }
}

function inventario(skus: SkuInventario[], sobre: Partial<InventarioCliente> = {}, resumen: Partial<ResumenInventario> = {}): InventarioCliente {
  return {
    hoy: HOY,
    leidoHasta: HOY,
    libroDesde: '2025-06-01',
    diasDeLibro: 520,
    libro: 'ok',
    skus,
    resumen: { ...resumenVacio(), ...resumen },
    porDia: [],
    avisos: [],
    ...sobre,
  }
}

const CONFIG: ConfigAlertas = { plazoDias: 45, plazoConfigurado: true, antelacionDias: 14, plazoPorSku: {} }

function calcular(skus: SkuInventario[], sobre: Partial<EntradaAlertas> = {}, inv: Partial<InventarioCliente> = {}, resumen: Partial<ResumenInventario> = {}): AlertaFba[] {
  return calcularAlertas({ hoy: HOY, inventario: inventario(skus, inv, resumen), envios: [], config: CONFIG, ...sobre })
}
const una = (alertas: AlertaFba[], clave: string) => alertas.find((a) => a.clave === clave)

console.log('\n=== rotura de stock: el plazo manda ===')
{
  // Ritmo 1/día y plazo 45: 20 días de stock -> aun pidiendo hoy llega tarde, y es crítica (20 <= 22,5)
  const a = una(calcular([sku({ sku: 'A', vendibles: 20 })]), 'reposicion:A')
  ok('20 días de stock y plazo 45: reponer ya, crítica', a?.tipo === 'reponer_ya' && a.severidad === 'critica', JSON.stringify(a))
  ok('dice cuántos días se quedará sin producto (45 − 20 = 25)', a?.detalle.includes('25 días sin producto') === true, a?.detalle)
  ok('y las ventas en riesgo: 25 d × 1 ud × 20 € = 500 €', a?.detalle.includes('500 €') === true && a.impacto === 500, a?.detalle)

  const b = una(calcular([sku({ sku: 'B', vendibles: 30 })]), 'reposicion:B')
  ok('30 días: reponer ya pero solo alta (no es la mitad del plazo)', b?.tipo === 'reponer_ya' && b.severidad === 'alta', JSON.stringify(b))

  const c = una(calcular([sku({ sku: 'C', vendibles: 50 })]), 'reposicion:C')
  ok('50 días: todavía llega a tiempo, pero queda poco margen -> reponer pronto, media', c?.tipo === 'reponer_pronto' && c.severidad === 'media', JSON.stringify(c))
  ok('dice cuántos días quedan para pedir (50 − 45 = 5)', c?.detalle.includes('próximos 5 días') === true, c?.detalle)

  const d = una(calcular([sku({ sku: 'D', vendibles: 70 })]), 'reposicion:D')
  ok('70 días con plazo 45 + 14 de antelación: sin alerta', d === undefined)

  const e = una(calcular([sku({ sku: 'E', vendibles: 0, entrante: 0 })]), 'reposicion:E')
  ok('agotado y nada de camino: agotado, crítica', e?.tipo === 'agotado' && e.severidad === 'critica', JSON.stringify(e))
  const f = una(calcular([sku({ sku: 'F', vendibles: 0, entrante: 40 })]), 'reposicion:F')
  ok('agotado pero con un envío de camino: agotado, alta', f?.tipo === 'agotado' && f.severidad === 'alta' && f.detalle.includes('40 de camino'), JSON.stringify(f))

  const g = una(calcular([sku({ sku: 'G', vendibles: 5, entrante: 100 })]), 'reposicion:G')
  ok('se agota en 5 días y lo que viene aún no está: rotura próxima, alta', g?.tipo === 'rotura_proxima' && g.severidad === 'alta', JSON.stringify(g))

  const h = una(calcular([sku({ sku: 'H', vendibles: 10, entrante: 25 })]), 'reposicion:H')
  ok('lo de camino cuenta: 35 días en total sigue siendo llegar tarde', h?.tipo === 'reponer_ya' && h.detalle.includes('contando las 25 que vienen de camino'), JSON.stringify(h))

  const i = una(calcular([sku({ sku: 'I', vendibles: 0, vendidas: { d7: 0, d14: 0, d30: 1, d60: 1, d90: 2 }, ritmoPlan: 0.03 })]), 'reposicion:I')
  ok('una referencia que casi no vende no da alertas de rotura', i === undefined)

  const j = una(calcular([sku({ sku: 'J', vendibles: 30 })], { config: { ...CONFIG, plazoPorSku: { J: 10 } } }), 'reposicion:J')
  ok('con un plazo propio de 10 días, 30 días de stock sobran', j === undefined)

  const k = una(calcular([sku({ sku: 'K', vendibles: 30 })], { config: { ...CONFIG_ALERTAS_POR_DEFECTO } }), 'reposicion:K')
  ok('sin plazo configurado se avisa de que se ha usado el de partida', k?.detalle.includes('sin configurar') === true && k.datos.plazoConfigurado === false, k?.detalle)
}

console.log('\n=== rotura de stock: la estacionalidad solo sube el ritmo ===')
{
  const base = sumarDiasInv(HOY, -365)
  const ventas: Record<string, number> = {}
  // El mes de antes del día de hace un año: 1 al día. Y lo que viene (59 días): 3 al día
  for (let i = 1; i <= 30; i += 1) ventas[sumarDiasInv(base, -i)] = 1
  for (let i = 0; i < 59; i += 1) ventas[sumarDiasInv(base, i)] = 3
  const f = factorEstacional(ventas, HOY, 59)
  ok('el año pasado se vendía el triple en estas fechas: sube pero con tope de 2,5', f === 2.5, String(f))

  const poco: Record<string, number> = { [sumarDiasInv(base, -3)]: 1, [sumarDiasInv(base, 5)]: 4 }
  ok('con 5 unidades de muestra no se cree: factor 1', factorEstacional(poco, HOY, 59) === 1)

  const baja: Record<string, number> = {}
  for (let i = 1; i <= 30; i += 1) baja[sumarDiasInv(base, -i)] = 3
  for (let i = 0; i < 59; i += 1) baja[sumarDiasInv(base, i)] = 1
  ok('si el año pasado bajaba, NO se baja el ritmo: factor 1', factorEstacional(baja, HOY, 59) === 1)
  ok('sin datos del año pasado, factor 1', factorEstacional(undefined, HOY, 59) === 1)

  // 100 días de stock: sin estacionalidad no hay alerta; con ritmo ×2,5 son 40 y llega tarde
  const sin = una(calcular([sku({ sku: 'S', vendibles: 100 })]), 'reposicion:S')
  const con = una(calcular([sku({ sku: 'S', vendibles: 100 })], { ventasAnoPasado: { S: ventas } }), 'reposicion:S')
  ok('sin estacionalidad, 100 días de stock está bien', sin === undefined)
  ok('con ella, 100 / 2,5 = 40 días: reponer ya, y se explica', con?.tipo === 'reponer_ya' && con.detalle.includes('×2,5'), JSON.stringify(con))
}

console.log('\n=== envíos ===')
{
  const envio = (sobre: Partial<EnvioParaAlertas> & { id: string }): EnvioParaAlertas => ({
    nombre: `Envío ${sobre.id}`,
    fechaEnvio: '2026-09-01',
    llegadaAt: null,
    estadoAmazon: 'IN_TRANSIT',
    estado: 'enviada',
    referenciaEnvio: `FBA${sobre.id}`,
    lineas: [{ sku: 'A', unidades: 100, recibidas: 0 }],
    ultimoCambioAt: null,
    ...sobre,
  })
  const hace = (d: number) => `${sumarDiasInv(HOY, -d)}T10:00:00Z`
  const con = (e: EnvioParaAlertas) => calcular([], { envios: [e] }, { libro: 'sin_leer', leidoHasta: null, libroDesde: null })

  ok('en tránsito 3 días: nada', con(envio({ id: '1', ultimoCambioAt: hace(3) })).length === 0)
  const t1 = una(con(envio({ id: '2', ultimoCambioAt: hace(20) })), 'envio:2:atascado')
  ok('en tránsito 20 días sin cambio: parado, alta', t1?.tipo === 'envio_atascado' && t1.severidad === 'alta' && t1.detalle.includes('20 días'), JSON.stringify(t1))
  const t2 = una(con(envio({ id: '3', ultimoCambioAt: hace(30) })), 'envio:3:atascado')
  ok('30 días: crítica', t2?.severidad === 'critica')
  const p1 = una(con(envio({ id: '4', estadoAmazon: 'WORKING', ultimoCambioAt: hace(6) })), 'envio:4:atascado')
  ok('preparándose 6 días: media', p1?.severidad === 'media')
  const p2 = una(con(envio({ id: '5', estadoAmazon: 'WORKING', ultimoCambioAt: hace(11) })), 'envio:5:atascado')
  ok('preparándose 11 días: alta', p2?.severidad === 'alta')
  const r1 = una(con(envio({ id: '6', estadoAmazon: 'CHECKED_IN', ultimoCambioAt: hace(11) })), 'envio:6:atascado')
  ok('registrado 11 días sin empezar a recibir: crítica', r1?.severidad === 'critica')
  const sinHistorial = una(con(envio({ id: '7', estadoAmazon: 'RECEIVING', fechaEnvio: sumarDiasInv(HOY, -40), ultimoCambioAt: null })), 'envio:7:atascado')
  ok('sin historial cuenta desde la fecha de envío y lo dice', sinHistorial?.severidad === 'critica' && sinHistorial.detalle.includes('no hay historial'), sinHistorial?.detalle)
  ok('una propuesta (aún no enviada) no se mira', con(envio({ id: '8', estado: 'borrador', ultimoCambioAt: hace(90) })).length === 0)

  const c1 = una(con(envio({ id: '9', estadoAmazon: 'CLOSED', lineas: [{ sku: 'A', unidades: 100, recibidas: 80 }], ultimoCambioAt: hace(10) })), 'envio:9:incompleto')
  ok('cerrado con 80 de 100: recibido de menos, alta (20 %)', c1?.tipo === 'envio_incompleto' && c1.severidad === 'alta' && c1.detalle.includes('faltan 20'), JSON.stringify(c1))
  const c2 = una(con(envio({ id: '10', estadoAmazon: 'CLOSED', lineas: [{ sku: 'A', unidades: 1000, recibidas: 970 }] })), 'envio:10:incompleto')
  ok('30 de 1.000 (3 %): media', c2?.severidad === 'media', JSON.stringify(c2))
  ok('faltar 1 unidad no es una alerta', con(envio({ id: '11', estadoAmazon: 'CLOSED', lineas: [{ sku: 'A', unidades: 100, recibidas: 99 }] })).length === 0)
  ok('sin unidades recibidas conocidas no se afirma nada', con(envio({ id: '12', estadoAmazon: 'CLOSED', lineas: [{ sku: 'A', unidades: 100, recibidas: null }] })).length === 0)
  ok('cerrado y completo: nada', con(envio({ id: '13', estadoAmazon: 'CLOSED', lineas: [{ sku: 'A', unidades: 100, recibidas: 100 }] })).length === 0)
  ok('los envíos se miran aunque no se haya leído el libro mayor', t1 !== undefined)
}

console.log('\n=== cuadre con Amazon ===')
{
  const d1 = una(calcular([sku({ sku: 'A', vendibles: 300, primeraEntrada: '2025-09-01', anteriorALaLectura: 30 })]), 'descuadre:A')
  ok('30 unidades más de las que explican las entradas (10 % de lo vendible): descuadre, media', d1?.tipo === 'descuadre' && d1.severidad === 'media', JSON.stringify(d1))
  const d2 = una(calcular([sku({ sku: 'B', vendibles: 100, primeraEntrada: '2025-09-01', anteriorALaLectura: 74 })]), 'descuadre:B')
  ok('74 sobre 100: alta', d2?.severidad === 'alta')
  ok('sin primera entrada en el libro (producto anterior al libro): nada', una(calcular([sku({ sku: 'C', vendibles: 100, primeraEntrada: null, anteriorALaLectura: 74 })]), 'descuadre:C') === undefined)
  ok('producto que ya estaba cuando empezó el libro: nada', una(calcular([sku({ sku: 'D', vendibles: 100, primeraEntrada: '2025-06-10', anteriorALaLectura: 74 })]), 'descuadre:D') === undefined)
  ok('libro corto: nada, no se afirma', una(calcular([sku({ sku: 'E', vendibles: 100, primeraEntrada: '2026-09-01', anteriorALaLectura: 74 })], {}, { libro: 'corto' }), 'descuadre:E') === undefined)
  ok('4 unidades de diferencia no son alerta', una(calcular([sku({ sku: 'F', vendibles: 100, primeraEntrada: '2025-09-01', anteriorALaLectura: 4 })]), 'descuadre:F') === undefined)

  const p = una(calcular([sku({ sku: 'A', vendibles: 100 }), sku({ sku: 'B', vendibles: 100 })], { ajustesRecientes: [{ sku: 'A', neto: -3 }, { sku: 'B', neto: -4 }, { sku: 'C', neto: 2 }] }), 'perdidas')
  ok('ajustes negativos que suman 7: un solo aviso, media; los positivos no cuentan', p?.tipo === 'perdidas' && p.severidad === 'media' && p.datos.unidades === 7, JSON.stringify(p))
  ok('con 4 no hay aviso', una(calcular([], { ajustesRecientes: [{ sku: 'A', neto: -4 }] }), 'perdidas') === undefined)

  const nv = una(calcular([sku({ sku: 'A', enAmazon: 40, vendibles: 30, noDisponibles: 10 })]), 'no_vendibles')
  ok('10 unidades no vendibles (25 %): aviso informativo', nv?.tipo === 'no_vendibles' && nv.severidad === 'info', JSON.stringify(nv))

  const sc = una(calcular([sku({ sku: 'A', vendibles: 80 })], { noComprables: ['A', 'ZZ'] }), 'sin_comprar:A')
  ok('stock y ventas pero el listing no es comprable: alta', sc?.tipo === 'sin_comprar' && sc.severidad === 'alta', JSON.stringify(sc))
  ok('un SKU que no está en el inventario no da aviso', una(calcular([sku({ sku: 'A', vendibles: 80 })], { noComprables: ['ZZ'] }), 'sin_comprar:ZZ') === undefined)
  ok('sin stock tampoco: ya sale como agotado', una(calcular([sku({ sku: 'A', vendibles: 0 })], { noComprables: ['A'] }), 'sin_comprar:A') === undefined)
}

console.log('\n=== stock parado y antiguo ===')
{
  const pa = una(calcular([sku({ sku: 'A', estado: 'parado', enAmazon: 60, vendibles: 60, valorStock: 1200, vendidas: { d7: 0, d14: 0, d30: 0, d60: 0, d90: 0 }, ritmoPlan: 0 })]), 'parado')
  ok('60 unidades paradas: media, con valor y coste mensual', pa?.tipo === 'stock_parado' && pa.severidad === 'media' && pa.detalle.includes('1200 €') && pa.detalle.includes('€ al mes'), JSON.stringify(pa))
  const pb = una(calcular([sku({ sku: 'A', estado: 'parado', enAmazon: 10, vendibles: 10, ritmoPlan: 0, vendidas: { d7: 0, d14: 0, d30: 0, d60: 0, d90: 0 } })]), 'parado')
  ok('10 unidades paradas: solo informativo', pb?.severidad === 'info')

  const an = una(calcular([sku({ sku: 'A', porTramo: { t0: 0, t91: 0, t181: 0, t271: 0, t366: 5 }, enAmazon: 5 })], {}, {}, { porTramo: { t0: 0, t91: 0, t181: 0, t271: 0, t366: 5 }, unidadesAntiguas: 5 }), 'antiguo')
  ok('unidades de más de un año: alta', an?.tipo === 'stock_antiguo' && an.severidad === 'alta' && an.detalle.includes('más de un año'), JSON.stringify(an))
  const lote = { desde: '2026-02-05', referencia: null, nombreEnvio: null, recibidas: 12, quedan: 12, edadDias: 260 }
  const por = una(calcular([sku({ sku: 'A', lotes: [lote], enAmazon: 12 })]), 'antiguo')
  ok('12 unidades que cumplen 270 días en un mes: aviso a tiempo, info', por?.severidad === 'info' && por.detalle.includes('cumplen 270 días'), JSON.stringify(por))
  ok('sin nada antiguo, nada', una(calcular([sku({ sku: 'A', vendibles: 100 })]), 'antiguo') === undefined)
}

console.log('\n=== ventas ===')
{
  const c = una(calcular([sku({ sku: 'A', vendibles: 500, vendidas: { d7: 3, d14: 7, d30: 20, d60: 60, d90: 90 } })]), 'caida:A')
  ok('vende 0,5 al día cuando antes vendía 1: caída de ventas', c?.tipo === 'caida_ventas' && c.detalle.includes('50 % menos'), JSON.stringify(c))
  ok('sin stock no se acusa a las ventas', una(calcular([sku({ sku: 'A', vendibles: 0, vendidas: { d7: 0, d14: 7, d30: 20, d60: 60, d90: 90 } })]), 'caida:A') === undefined)
  const p = una(calcular([sku({ sku: 'A', vendibles: 500, vendidas: { d7: 14, d14: 20, d30: 30, d60: 50, d90: 70 } })]), 'pico:A')
  ok('esta semana vende 2/día frente a 1/día del mes: pico', p?.tipo === 'pico_ventas', JSON.stringify(p))
  ok('con poca muestra no hay pico', una(calcular([sku({ sku: 'A', vendibles: 500, vendidas: { d7: 4, d14: 5, d30: 6, d60: 10, d90: 20 } })]), 'pico:A') === undefined)
}

console.log('\n=== sin libro mayor: no se inventa nada de ventas ===')
{
  const a = calcular([sku({ sku: 'A', vendibles: 0 })], {}, { libro: 'sin_leer', leidoHasta: null, libroDesde: null })
  ok('sin libro leído no hay alertas de stock', a.length === 0, JSON.stringify(a.map((x) => x.clave)))
}

console.log('\n=== el orden y los recuentos ===')
{
  const alertas = calcular([
    sku({ sku: 'A', vendibles: 30 }),
    sku({ sku: 'B', vendibles: 50 }),
    sku({ sku: 'C', vendibles: 0 }),
    sku({ sku: 'D', vendibles: 20, precio: 100 }),
  ])
  const orden = alertas.map((a) => a.clave).join(',')
  ok('crítica con más dinero en juego primero, luego la otra crítica, las altas y las medias', orden === 'reposicion:D,reposicion:C,reposicion:A,reposicion:B', orden)
  const c = contarPorSeveridad(alertas)
  ok('recuento por gravedad', c.critica === 2 && c.alta === 1 && c.media === 1 && c.info === 0, JSON.stringify(c))
}

console.log('\n=== los límites del plazo ===')
{
  ok('un plazo razonable pasa', plazoValido('45') === 45)
  ok('con coma y decimales se redondea', plazoValido('45,6') === 46)
  ok('0 y negativos se suben al mínimo', plazoValido(0) === 1 && plazoValido(-5) === 1)
  ok('más de un año se baja a 365', plazoValido(9999) === 365)
  ok('un texto no es un plazo', plazoValido('pronto') === null && plazoValido(null) === null)
}

console.log('\n=== reconciliar con lo guardado ===')
{
  const alerta = (clave: string, severidad: AlertaFba['severidad']): AlertaFba => ({
    clave,
    tipo: 'reponer_ya',
    severidad,
    sku: null,
    remesaId: null,
    titulo: clave,
    detalle: '',
    impacto: 0,
    datos: {},
  })
  const fila = (clave: string, sobre: Partial<FilaDeAlerta> = {}): FilaDeAlerta => ({
    clave,
    estado: 'abierta',
    severidad: 'alta',
    silenciadaHasta: null,
    severidadAvisada: 'alta',
    ...sobre,
  })

  const guardadas = [fila('a'), fila('b'), fila('c', { estado: 'resuelta' }), fila('d', { estado: 'silenciada', silenciadaHasta: '2026-11-10' }), fila('e', { estado: 'silenciada', silenciadaHasta: '2026-10-30' }), fila('f', { severidadAvisada: null })]
  const calculadas = [alerta('a', 'alta'), alerta('c', 'alta'), alerta('d', 'critica'), alerta('e', 'alta'), alerta('f', 'media'), alerta('nueva', 'critica'), alerta('nueva-media', 'media'), alerta('a', 'alta')]
  const plan = planearAlertas(guardadas, calculadas, HOY)

  const aviso = (c: string) => plan.avisar.some((a) => a.clave === c)
  ok('una alerta que sigue igual no vuelve a avisar', !aviso('a'))
  ok('una resuelta que reaparece avisa otra vez', aviso('c') && plan.escribir.find((x) => x.alerta.clave === 'c')?.reabierta === true)
  ok('una silenciada hasta el 10 sigue silenciada y no avisa aunque empeore', !aviso('d') && plan.escribir.find((x) => x.alerta.clave === 'd')?.estado === 'silenciada')
  ok('una silenciada cuya fecha pasó vuelve a abrirse', plan.escribir.find((x) => x.alerta.clave === 'e')?.estado === 'abierta')
  ok('la que nunca se avisó y es media no avisa (la campana es para lo grave)', !aviso('f') && !aviso('nueva-media'))
  ok('una nueva crítica avisa', aviso('nueva'))
  ok('las repetidas en lo calculado se escriben una vez', plan.escribir.filter((x) => x.alerta.clave === 'a').length === 1)
  ok('lo que dejó de pasar (b) se da por resuelto; lo ya resuelto no', plan.resolver.join() === 'b', plan.resolver.join())
  const parcial = planearAlertas(guardadas, calculadas, HOY, false)
  ok('con una lectura incompleta NO se resuelve nada', parcial.resolver.length === 0)

  const sube = planearAlertas([fila('x', { severidad: 'alta', severidadAvisada: 'alta' })], [alerta('x', 'critica')], HOY)
  ok('si una alerta ya avisada empeora (alta -> crítica) vuelve a avisar', sube.avisar.length === 1)
  const baja = planearAlertas([fila('x', { severidad: 'critica', severidadAvisada: 'critica' })], [alerta('x', 'alta')], HOY)
  ok('si mejora, no', baja.avisar.length === 0)
}

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
