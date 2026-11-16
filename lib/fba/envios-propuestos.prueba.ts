import { agruparEnvios, claveDeEnvio, reconciliarEnvios, semanaIso } from './envios-propuestos'
import { ajustarPorModelo } from './planificador'
import type {
  AjustesReposicion, Confianza, EnvioGuardadoMinimo, EnvioPropuestoCalculado, EstadoEnvioPropuesto, LineaPlan,
  PlazoEtapas, Prioridad, RitmoSku,
} from './plan-tipos'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * ENVÍOS PROPUESTOS. Lo que duele si falla: mandar dos veces lo mismo, partir un viaje en
 * envíos de 8 unidades, pasar de la capacidad de Amazon, o pisar lo que el equipo ya habló
 * con el cliente. No se importa el planificador: `recalcular` es falso y predecible.
 */

const HOY = '2026-11-15'

function sumar(f: string, d: number): string {
  const [a, m, dd] = f.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, dd) + d * 86_400_000).toISOString().slice(0, 10)
}

function ritmo(d: number, confianza: Confianza = 'alta'): RitmoSku {
  return {
    base: d, previsto: d, factorEstacional: 1, perfilSemanal: null, origenPerfil: null, picoAnoPasado: null,
    r14: d, r30: d, r60: d, r90: d, diasConStock90: 90, ventas90: d * 90, ventas30: d * 30, ventas180: d * 180,
    tendencia: 'estable', confianza, origen: 'sku', ultimoPeriodoHasta: null,
    pedidoGrande: false, serieDeStockFiable: true, anclajeEstimado: false,
    tasaDevolucionVendible: 0, mermaDiaria: 0, consumoNeto: d, explicacion: `${d} ud/día`,
  }
}

function linea(sku: string, salirAntesDe: string, cantidad: number, extra: Partial<LineaPlan> = {}, d = 1): LineaPlan {
  return {
    sku, asin: null, fnsku: null, nombre: sku, modelo: null, talla: null, precio: 20, moneda: 'EUR',
    vendibles: 10, deCamino: 0, comprometido: 0, reservadas: 0, entranteSinRemesa: 0, dudoso: 0,
    ritmo: ritmo(d), coberturaDias: 10, coberturaConLoQueViene: 10,
    fechaRotura: sumar(salirAntesDe, 24), fechaPrimerHueco: null,
    aLaVentaObjetivo: sumar(salirAntesDe, 17), salirAntesDe, decidirAntesDe: sumar(salirAntesDe, -7),
    vaTarde: false, diasSinStockInevitables: 0, coberturaEfectiva: 45,
    necesidad: cantidad, tope: cantidad * 2, cantidad, caja: null, cajas: null,
    eurosEnRiesgo: cantidad * 20, eurosSiVaTarde: null,
    prioridad: 'este_mes', fuera: null, avisos: [], adelantada: false, aLaVentaUrgente: null,
    porque: `${sku}: manda ${cantidad} ud`, ajusteIa: null,
    ...extra,
  }
}

const AJUSTES: AjustesReposicion = {
  coberturaObjetivo: 45, coberturaMaxima: 90, multiploCaja: null, minLinea: 3, minEnvio: 30, ventanaAgrupacion: 7,
  capacidadUnidades: null, topeEstacional: 1.8, campanaHasta: null, transporteUrgenteDias: null,
  activo: true, avisarChat: true, origen: { minEnvio: 'partida', ventanaAgrupacion: 'partida' },
}
const PLAZO: PlazoEtapas = {
  preparacion: 7, transporte: 6, recepcion: 4, margen: 7,
  origen: { preparacion: 'partida', transporte: 'medido', recepcion: 'medido', margen: 'partida' },
  hastaLaVenta: 17, sinConfirmar: true, transporteUrgente: null,
}

/** Recalcular falso: salir antes ⇒ llega antes ⇒ hace falta D × días menos. Las «aún no toca» dan `recalculoFijo`. */
const recalculoFijo = new Map<string, number>()
let llamadasRecalcular = 0
const recalcular = (l: LineaPlan, nuevaSalida: string): LineaPlan => {
  llamadasRecalcular++
  const dias = Math.round((Date.parse(l.salirAntesDe!) - Date.parse(nuevaSalida)) / 86_400_000)
  const fijo = recalculoFijo.get(l.sku)
  const cantidad = fijo !== undefined ? fijo : Math.max(0, l.cantidad - Math.round((l.ritmo.previsto ?? 0) * dias))
  return { ...l, cantidad, salirAntesDe: nuevaSalida, decidirAntesDe: sumar(nuevaSalida, -7), eurosEnRiesgo: cantidad * 20 }
}

const agrupar = (lineas: LineaPlan[], ajustes: Partial<AjustesReposicion> = {}, ocupado = 0, conexion: string | null = 'conn1') =>
  agruparEnvios(lineas, 'cli1', conexion, HOY, { ...AJUSTES, ...ajustes }, PLAZO, recalcular, ocupado)

console.log('\n=== clave y semana ISO ===')
{
  ok('2 dic 2026 → W49', claveDeEnvio('cli1', 'conn1', '2026-12-02') === 'env:cli1:conn1:2026-W49', claveDeEnvio('cli1', 'conn1', '2026-12-02'))
  ok('29 dic 2025 (lunes) es la W01 de 2026', JSON.stringify(semanaIso('2025-12-29')) === '{"ano":2026,"semana":1}', JSON.stringify(semanaIso('2025-12-29')))
  ok('1 ene 2027 (viernes) es la W53 de 2026', JSON.stringify(semanaIso('2027-01-01')) === '{"ano":2026,"semana":53}', JSON.stringify(semanaIso('2027-01-01')))
  ok('4 ene siempre es W01', [2021, 2024, 2026, 2027, 2030].every((a) => semanaIso(`${a}-01-04`).semana === 1))
  ok('lunes y domingo de la misma semana, misma clave', claveDeEnvio('c', 'x', '2026-11-30') === claveDeEnvio('c', 'x', '2026-12-06') && claveDeEnvio('c', 'x', '2026-12-06') !== claveDeEnvio('c', 'x', '2026-12-07'))
  ok('sin conexión → «sin-conexion»', claveDeEnvio('c', null, '2026-12-02') === 'env:c:sin-conexion:2026-W49')
}

console.log('\n=== 28 · agrupar ===')
{
  const envios = agrupar([
    linea('A', '2026-12-02', 40),
    linea('B', '2026-12-05', 50),
    linea('C', '2026-12-12', 45),
  ])
  ok('dos envíos', envios.length === 2, String(envios.length))
  const [e1, e2] = envios
  ok('el 1.º sale el 2 dic con A y B', e1.salirAntesDe === '2026-12-02' && e1.lineas.map((l) => l.sku).sort().join() === 'A,B')
  const b = e1.lineas.find((l) => l.sku === 'B')!
  ok('B se recalcula al 2 dic (3 días antes ⇒ 3 ud menos)', b.cantidad === 47 && b.salirAntesDe === '2026-12-02', String(b.cantidad))
  ok('B dentro de la ventana no es «adelantada»', !b.adelantada)
  ok('C va en el 2.º envío', e2.salirAntesDe === '2026-12-12' && e2.lineas[0].sku === 'C')
  ok('aLaVenta = salida + transporte + recepción', e1.aLaVenta === '2026-12-12')
  ok('decidir = la más temprana de sus líneas', e1.decidirAntesDe === '2026-11-25', e1.decidirAntesDe)
  ok('unidades = Σ', e1.unidades === 87)
  ok('€ en riesgo = Σ', e1.eurosEnRiesgo === 87 * 20, String(e1.eurosEnRiesgo))
  ok('sin caja ⇒ cajas aproximadas a 40', e1.cajasAproximadas && e1.cajasEstimadas === 3, String(e1.cajasEstimadas))
  ok('clave con la semana de la salida', e1.clave === 'env:cli1:conn1:2026-W49' && e2.clave === 'env:cli1:conn1:2026-W50')

  const fundidos = agrupar([
    linea('A', '2026-12-02', 40),
    linea('B', '2026-12-05', 50),
    linea('C', '2026-12-12', 20),
  ])
  ok('C pequeño (20 < 30) y no urgente ⇒ se funde en el anterior', fundidos.length === 1, String(fundidos.length))
  const c = fundidos[0].lineas.find((l) => l.sku === 'C')!
  ok('…como adelantada y recalculada al 2 dic', c.adelantada && c.avisos.includes('adelantada') && c.cantidad === 10 && fundidos[0].salirAntesDe === '2026-12-02', `${c.cantidad} ${c.adelantada}`)

  const urgente = agrupar([
    linea('A', '2026-11-17', 10, { prioridad: 'urgente' }),
    linea('C', '2026-12-12', 80),
  ])
  ok('envío pequeño pero urgente: se queda solo', urgente.length === 2 && urgente[0].unidades === 10)
  ok('…con el aviso «Envío pequeño»', urgente[0].porque.some((p) => p.startsWith('Envío pequeño')), urgente[0].porque.join(' | '))
  ok('…y prioridad urgente', urgente[0].prioridad === 'urgente')

  const lejos = agrupar([linea('A', '2026-11-25', 10), linea('C', '2027-02-01', 80)])
  ok('un pequeño no se funde con uno que sale dos meses después', lejos.length === 2 && lejos[0].porque.some((p) => p.startsWith('Envío pequeño')))

  const solo = agrupar([linea('A', '2026-12-02', 12)])
  ok('el único envío, aunque pequeño, sale', solo.length === 1 && solo[0].unidades === 12)

  const fuera = agrupar([linea('A', '2026-12-02', 40), linea('X', '2026-12-03', 30, { fuera: 'stock_de_sobra' }), linea('Y', '2026-12-03', 0)])
  ok('las líneas fuera o con cantidad 0 no entran', fuera.length === 1 && fuera[0].lineas.length === 1)

  ok('nada que proponer ⇒ ningún envío', agrupar([linea('X', '2026-12-03', 30, { fuera: 'parado' })]).length === 0)

  const corta = agrupar([linea('A', '2026-12-02', 40), linea('B', '2026-12-05', 40)], { ventanaAgrupacion: 3, minEnvio: 10 })
  ok('ventana medida (3 días): el 5 dic va aparte… pero misma semana ⇒ un solo envío (la clave no se repite)', corta.length === 1 && new Set(corta.map((e) => e.clave)).size === corta.length)
  const corta2 = agrupar([linea('A', '2026-12-02', 40), linea('B', '2026-12-08', 40)], { ventanaAgrupacion: 3, minEnvio: 10 })
  ok('ventana 3: el 8 dic (otra semana) va en otro envío', corta2.length === 2)
  const larga = agrupar([linea('A', '2026-12-02', 40), linea('B', '2026-12-20', 40)], { ventanaAgrupacion: 20 })
  ok('ventana medida (20 días): todo junto', larga.length === 1)
  const minimo = agrupar([linea('A', '2026-12-02', 40), linea('C', '2026-12-12', 45)], { minEnvio: 50 })
  ok('mínimo medido (50): el de 45 se funde', minimo.length === 1)
}

console.log('\n=== 29 · adelantar para aprovechar el viaje ===')
{
  recalculoFijo.set('M', 24)
  const envios = agrupar([
    linea('A', '2026-12-02', 60),
    linea('M', '2026-12-20', 0, { fuera: 'aun_no_toca', prioridad: 'mas_adelante' }),
  ])
  const m = envios[0].lineas.find((l) => l.sku === 'M')
  ok('la «aún no toca» del 20 dic entra en el envío del 2 dic', !!m)
  ok('…marcada adelantada, sin motivo de fuera y con la cantidad recalculada', !!m && m.adelantada && m.fuera === null && m.cantidad === 24 && m.avisos.includes('adelantada'))
  ok('…y no cambia la prioridad del envío', envios[0].prioridad === 'este_mes')

  recalculoFijo.set('M', 4)
  const poco = agrupar([linea('A', '2026-12-02', 60), linea('M', '2026-12-20', 0, { fuera: 'aun_no_toca', prioridad: 'mas_adelante' })])
  ok('si recalculada no llega al mínimo útil (7 = una semana) no entra', !poco[0].lineas.some((l) => l.sku === 'M'))

  recalculoFijo.set('M', 24)
  const dev = agrupar([linea('A', '2026-12-02', 60), linea('M', '2026-12-20', 0, { fuera: 'aun_no_toca', prioridad: 'mas_adelante', avisos: ['devoluciones_altas'] })])
  ok('con devoluciones altas nunca se adelanta', !dev[0].lineas.some((l) => l.sku === 'M'))

  const tarde = agrupar([linea('A', '2026-12-02', 60), linea('M', '2027-01-10', 0, { fuera: 'aun_no_toca', prioridad: 'mas_adelante' })])
  ok('a más de 21 días no se adelanta', !tarde[0].lineas.some((l) => l.sku === 'M'))

  const otra = agrupar([linea('A', '2026-12-02', 60), linea('M', '2026-12-20', 0, { fuera: 'parado' })])
  ok('una línea parada no se adelanta', !otra[0].lineas.some((l) => l.sku === 'M'))
  recalculoFijo.clear()
}

console.log('\n=== 30 · capacidad ===')
{
  const envios = agrupar([
    linea('U', '2026-11-20', 150, { prioridad: 'urgente' }),
    linea('E', '2026-11-22', 150, { prioridad: 'este_mes' }),
  ], { capacidadUnidades: 1000 }, 900)
  const u = envios.flatMap((e) => e.lineas).find((l) => l.sku === 'U')
  const e = envios.flatMap((x) => x.lineas).find((l) => l.sku === 'E')
  ok('la urgente se lleva el hueco entero (100)', u?.cantidad === 100 && !!u?.avisos.includes('recortada_capacidad'), String(u?.cantidad))
  ok('la de este mes se queda fuera', !e)
  ok('total ≤ hueco', envios.reduce((s, x) => s + x.unidades, 0) <= 100)
  ok('frase con lo que deja Amazon', envios[0].porque.includes('Amazon te deja 100 ud más; se han priorizado las urgentes'), envios[0].porque.join(' | '))

  const conCaja = agrupar([linea('U', '2026-11-20', 150, { prioridad: 'urgente', caja: { unidades: 12, origen: 'sku' } })], { capacidadUnidades: 1000 }, 900)
  ok('lo recortado baja al múltiplo de la caja (100 → 96)', conCaja[0].lineas[0].cantidad === 96 && conCaja[0].cajasEstimadas === 8 && !conCaja[0].cajasAproximadas, String(conCaja[0].lineas[0].cantidad))

  const holgado = agrupar([linea('U', '2026-11-20', 150)], { capacidadUnidades: 1000 }, 100)
  ok('con hueco de sobra no se recorta nada', holgado[0].lineas[0].cantidad === 150 && !holgado[0].lineas[0].avisos.includes('recortada_capacidad'))

  const euros = agrupar([
    linea('P', '2026-11-20', 80, { prioridad: 'esta_semana', eurosEnRiesgo: 100 }),
    linea('Q', '2026-11-20', 80, { prioridad: 'esta_semana', eurosEnRiesgo: 900 }),
  ], { capacidadUnidades: 100 }, 0)
  const q = euros[0].lineas.find((l) => l.sku === 'Q')!
  const p = euros[0].lineas.find((l) => l.sku === 'P')!
  ok('misma prioridad: primero la de más € en juego', q.cantidad === 80 && p.cantidad === 20, `${q.cantidad} ${p.cantidad}`)
}

console.log('\n=== cifras por envío ===')
{
  const usd = agrupar([linea('A', '2026-12-02', 40, { moneda: 'USD' })])
  ok('lleva la moneda de sus líneas', usd[0].moneda === 'USD')
  ok('lleva la conexión', usd[0].connectionId === 'conn1')
  const sinPrecio = agrupar([linea('A', '2026-12-02', 40, { eurosEnRiesgo: null, precio: null })])
  ok('sin precio ⇒ € null', sinPrecio[0].eurosEnRiesgo === null)
  const conf = agrupar([
    linea('A', '2026-12-02', 90),
    linea('B', '2026-12-02', 10, { ritmo: ritmo(1, 'baja') }),
  ])
  ok('una línea baja con el 10 % no hunde la confianza', conf[0].confianza === 'alta', conf[0].confianza)
  const conf2 = agrupar([linea('A', '2026-12-02', 70), linea('B', '2026-12-02', 30, { ritmo: ritmo(1, 'baja') })])
  ok('con el 30 % sí: baja', conf2[0].confianza === 'baja', conf2[0].confianza)
  const muchas = agrupar(['A', 'B', 'C', 'D', 'E'].map((s, i) => linea(s, '2026-12-02', 10 + i)))
  ok('porqué: 3 frases y «y 2 referencias más»', muchas[0].porque.length === 4 && muchas[0].porque[3] === 'y 2 referencias más', muchas[0].porque.join(' | '))
  ok('porqué empieza por la de más € (E)', muchas[0].porque[0].startsWith('E:'))
  const tarde = agrupar([linea('T', '2026-11-22', 40, { prioridad: 'tarde', decidirAntesDe: HOY, vaTarde: true })])
  ok('prioridad = la más alta', tarde[0].prioridad === 'tarde')
  const pasado = agrupar([linea('T', '2026-11-16', 40, { decidirAntesDe: '2026-11-09' })])
  ok('decidir nunca antes de hoy', pasado[0].decidirAntesDe === HOY)
  const prov = agrupar([linea('A', '2026-12-02', 40, { avisos: ['provisional'] })])
  ok('provisional si alguna línea lo es', prov[0].provisional)
  const mezcla = agrupar([linea('A', '2026-12-02', 24, { caja: { unidades: 12, origen: 'sku' } }), linea('B', '2026-12-02', 50)])
  ok('cajas mezcladas: 2 exactas + ceil(50/40) = 4, aproximadas', mezcla[0].cajasEstimadas === 4 && mezcla[0].cajasAproximadas)
}

/* ------------------------------ Reconciliar ------------------------------ */

function calculado(salida: string, lineas: Array<[string, number]>, prioridad: Prioridad = 'este_mes'): EnvioPropuestoCalculado {
  const ls = lineas.map(([s, n]) => linea(s, salida, n, { prioridad }))
  return {
    clave: claveDeEnvio('cli1', 'conn1', salida), clienteId: 'cli1', connectionId: 'conn1', moneda: 'EUR',
    salirAntesDe: salida, decidirAntesDe: sumar(salida, -7), aLaVenta: sumar(salida, 10),
    prioridad, confianza: 'alta', lineas: ls, unidades: ls.reduce((s, l) => s + l.cantidad, 0),
    cajasEstimadas: null, cajasAproximadas: true, eurosEnRiesgo: null, porque: [], provisional: false,
  }
}
function guardado(id: string, estado: EstadoEnvioPropuesto, salida: string, lineas: Array<[string, number]>, extra: Partial<EnvioGuardadoMinimo> = {}): EnvioGuardadoMinimo {
  return {
    id, clave: claveDeEnvio('cli1', 'conn1', salida), estado, prioridad: 'este_mes', salirAntesDe: salida,
    unidades: lineas.reduce((s, [, n]) => s + n, 0), skus: lineas.map(([s]) => s),
    remesaId: null, estadoCambiadoAt: '2026-11-10T09:00:00Z',
    lineas: lineas.map(([sku, cantidad]) => ({ sku, cantidad })),
    ...extra,
  }
}
const COMPLETO = { completo: true }
const W49 = '2026-12-02'
const W48 = '2026-11-25'

console.log('\n=== 32 · reconciliar «nuevo» ===')
{
  const r = reconciliarEnvios([guardado('g1', 'nuevo', W49, [['A', 40], ['B', 50]])], [], [calculado(W49, [['A', 60], ['B', 50]])], HOY, COMPLETO)
  ok('se actualiza la misma fila', r.actualizar.length === 1 && r.actualizar[0].id === 'g1' && r.insertar.length === 0 && r.caducar.length === 0)
  ok('en «nuevo» se reescribe todo (soloLineas false)', r.actualizar[0].soloLineas === false)
  ok('90 → 110 ud (> 10 %) ⇒ al historial', r.actualizar[0].anotarHistorial === true)
  const c = r.actualizar[0].cambios
  ok('cambios desde ayer: 90 → 110 y la frase de A', !!c && c.unidadesAntes === 90 && c.unidadesAhora === 110 && c.frases.includes('Sube de 90 a 110 ud') && c.frases.includes('A: de 40 a 60 ud'), JSON.stringify(c?.frases))

  const poco = reconciliarEnvios([guardado('g1', 'nuevo', W49, [['A', 100]])], [], [calculado(W49, [['A', 105]])], HOY, COMPLETO)
  ok('100 → 105 (5 %) y misma prioridad ⇒ sin historial', poco.actualizar[0].anotarHistorial === false)
  const prio = reconciliarEnvios([guardado('g1', 'nuevo', W49, [['A', 100]])], [], [calculado(W49, [['A', 100]], 'urgente')], HOY, COMPLETO)
  ok('cambia la prioridad ⇒ historial y frase', prio.actualizar[0].anotarHistorial && !!prio.actualizar[0].cambios?.frases.some((f) => f.startsWith('Prioridad')))
  const igual = reconciliarEnvios([guardado('g1', 'nuevo', W49, [['A', 100]])], [], [calculado(W49, [['A', 100]])], HOY, COMPLETO)
  ok('sin cambios ⇒ cambios null y sin historial', igual.actualizar[0].cambios === null && !igual.actualizar[0].anotarHistorial)
  const entraSale = reconciliarEnvios([guardado('g1', 'nuevo', W49, [['A', 100], ['B', 10]])], [], [calculado(W49, [['A', 100], ['C', 12]])], HOY, COMPLETO)
  const f = entraSale.actualizar[0].cambios?.frases ?? []
  ok('frases de referencia que entra y que sale', f.includes('Entra C (12 ud)') && f.includes('Sale B (tenía 10 ud)'), f.join(' | '))
}

console.log('\n=== 33 · reconciliar «hablado» ===')
{
  const r = reconciliarEnvios([guardado('g1', 'hablado', W49, [['A', 412]])], [], [calculado(W49, [['A', 430]], 'esta_semana')], HOY, COMPLETO)
  ok('se actualiza solo lineas (las aceptadas no se tocan)', r.actualizar.length === 1 && r.actualizar[0].soloLineas === true)
  ok('la diferencia queda en cambios (412 → 430)', r.actualizar[0].cambios?.unidadesAntes === 412 && r.actualizar[0].cambios?.unidadesAhora === 430)
  ok('la prioridad nueva va en el calculado', r.actualizar[0].calculado.prioridad === 'esta_semana')
  const esp = reconciliarEnvios([guardado('g1', 'esperando_cliente', W49, [['A', 412]])], [], [calculado(W49, [['A', 430]])], HOY, COMPLETO)
  ok('esperando_cliente igual: soloLineas', esp.actualizar[0].soloLineas === true)
}

console.log('\n=== 33 bis · hablado que cambia de semana ===')
{
  const r = reconciliarEnvios([guardado('g1', 'hablado', W48, [['A', 40], ['B', 40], ['C', 10]])], [], [calculado(W49, [['A', 45], ['B', 40]])], HOY, COMPLETO)
  ok('se reutiliza la fila hablada (solapamiento ≥ 50 %)', r.actualizar.length === 1 && r.actualizar[0].id === 'g1')
  ok('…solo lineas', r.actualizar[0].soloLineas === true)
  ok('…y no se crea otra', r.insertar.length === 0 && r.marcarPlanYaNoLoPide.length === 0)
  ok('la salida que cambia sale en las frases', !!r.actualizar[0].cambios?.frases.includes('La salida pasa del 25 nov al 2 dic'), JSON.stringify(r.actualizar[0].cambios?.frases))
}

console.log('\n=== 34 · reconciliar caducado ===')
{
  const r = reconciliarEnvios([
    guardado('g1', 'nuevo', W49, [['A', 40]]),
    guardado('g2', 'hablado', W48, [['B', 40]]),
    guardado('g3', 'en_preparacion', W48, [['C', 40]], { remesaId: 'r1' }),
  ], [], [], HOY, COMPLETO)
  ok('el «nuevo» que el plan ya no pide caduca', r.caducar.length === 1 && r.caducar[0].id === 'g1' && r.caducar[0].motivo === 'el plan ya no lo pide')
  ok('el hablado no caduca: se marca para que decida una persona', r.marcarPlanYaNoLoPide.join() === 'g2')
  ok('el que está en preparación no se toca', !r.caducar.some((c) => c.id === 'g3') && !r.marcarPlanYaNoLoPide.includes('g3') && r.huerfanosAHablado.length === 0)
}

console.log('\n=== 35 · cambio de semana ===')
{
  const r = reconciliarEnvios([guardado('g1', 'nuevo', W48, [['A', 40], ['B', 40]])], [], [calculado(W49, [['A', 40], ['B', 40]])], HOY, COMPLETO)
  ok('se reutiliza la fila (ni inserta ni caduca)', r.actualizar.length === 1 && r.actualizar[0].id === 'g1' && r.insertar.length === 0 && r.caducar.length === 0)
  ok('…con la clave nueva en el calculado y todo reescrito', r.actualizar[0].calculado.clave.endsWith('2026-W49') && r.actualizar[0].soloLineas === false)
  const poco = reconciliarEnvios([guardado('g1', 'nuevo', W48, [['A', 40], ['B', 40], ['C', 40]])], [], [calculado(W49, [['D', 40], ['E', 40], ['A', 40]])], HOY, COMPLETO)
  ok('con solapamiento < 50 % no se reutiliza: inserta y caduca', poco.insertar.length === 1 && poco.caducar.length === 1)
  const dos = reconciliarEnvios([
    guardado('g1', 'nuevo', W48, [['A', 40]]),
    guardado('g2', 'nuevo', '2026-11-18', [['A', 40]]),
  ], [], [calculado(W49, [['A', 40]])], HOY, COMPLETO)
  ok('con dos candidatas gana la de salida más cercana', dos.actualizar[0]?.id === 'g1' && dos.caducar.map((c) => c.id).join() === 'g2')
}

console.log('\n=== 31 bis · cuarentena ===')
{
  const desc = guardado('d1', 'descartado', W49, [['A', 40]], { estadoCambiadoAt: '2026-11-10T09:00:00Z', prioridad: 'este_mes' })
  const r = reconciliarEnvios([], [desc], [calculado(W49, [['A', 40]], 'este_mes')], HOY, COMPLETO)
  ok('descartado hace 5 días y el plan vuelve a pedir la W49 ⇒ no se inserta', r.insertar.length === 0)
  const sube = reconciliarEnvios([], [desc], [calculado(W49, [['A', 40]], 'urgente')], HOY, COMPLETO)
  ok('si la prioridad sube (urgente) vuelve', sube.insertar.length === 1)
  const viejo = reconciliarEnvios([], [{ ...desc, estadoCambiadoAt: '2026-10-20T09:00:00Z' }], [calculado(W49, [['A', 40]])], HOY, COMPLETO)
  ok('descartado hace más de 14 días ⇒ se inserta', viejo.insertar.length === 1)
  const otra = reconciliarEnvios([], [desc], [calculado('2026-12-09', [['A', 40]])], HOY, COMPLETO)
  ok('otra semana ⇒ se inserta (la cuarentena es por clave)', otra.insertar.length === 1)
}

console.log('\n=== 35 bis · clave nueva igual a una caducada ===')
{
  const cad = guardado('c1', 'caducado', W49, [['A', 40]], { estadoCambiadoAt: '2026-11-13T09:00:00Z' })
  const r = reconciliarEnvios([], [cad], [calculado(W49, [['A', 40]])], HOY, COMPLETO)
  ok('se inserta (el índice es parcial: solo entre activos)', r.insertar.length === 1 && r.actualizar.length === 0)
}

console.log('\n=== 51 · libro sin leer (pasada incompleta) ===')
{
  const tres = [guardado('g1', 'nuevo', W48, [['A', 40]]), guardado('g2', 'nuevo', W49, [['B', 40]]), guardado('g3', 'nuevo', '2026-12-09', [['C', 40]])]
  const r = reconciliarEnvios(tres, [], [], HOY, { completo: false })
  ok('3 en «nuevo» ⇒ caducar = []', r.caducar.length === 0 && r.marcarPlanYaNoLoPide.length === 0)
  const nuevo = reconciliarEnvios(tres, [], [calculado('2027-01-06', [['Z', 40]])], HOY, { completo: false })
  ok('tampoco inserta', nuevo.insertar.length === 0)
  const prio = reconciliarEnvios(tres, [], [calculado(W49, [['B', 10]], 'urgente'), calculado(W48, [['A', 999]])], HOY, { completo: false })
  ok('solo actualiza lo que cambia de prioridad (y como soloLineas)', prio.actualizar.length === 1 && prio.actualizar[0].id === 'g2' && prio.actualizar[0].soloLineas)
}

console.log('\n=== huérfanos y en preparación ===')
{
  const r = reconciliarEnvios([guardado('h1', 'en_preparacion', W49, [['A', 40]])], [], [calculado(W49, [['A', 50]])], HOY, COMPLETO)
  ok('en_preparacion sin remesa ⇒ a hablado', r.huerfanosAHablado.join() === 'h1')
  ok('…y se trata como hablado (soloLineas)', r.actualizar.length === 1 && r.actualizar[0].soloLineas)
  const sinPlan = reconciliarEnvios([guardado('h1', 'en_preparacion', W49, [['A', 40]])], [], [], HOY, COMPLETO)
  ok('huérfano que el plan ya no pide ⇒ marcado, no caducado', sinPlan.marcarPlanYaNoLoPide.join() === 'h1' && sinPlan.caducar.length === 0)
  const huerfanoSinDatos = reconciliarEnvios([guardado('h1', 'en_preparacion', W49, [['A', 40]])], [], [], HOY, { completo: false })
  ok('el arreglo del huérfano se hace aunque la pasada sea incompleta', huerfanoSinDatos.huerfanosAHablado.join() === 'h1')
  const conRemesa = reconciliarEnvios([guardado('p1', 'en_preparacion', W49, [['A', 40]], { remesaId: 'r1' })], [], [calculado(W49, [['A', 50]])], HOY, COMPLETO)
  ok('con remesa no se toca ni se inserta otro con su clave', conRemesa.actualizar.length === 0 && conRemesa.insertar.length === 0 && conRemesa.huerfanosAHablado.length === 0)
  const enviado = reconciliarEnvios([guardado('e1', 'enviado', W49, [['A', 40]])], [], [], HOY, COMPLETO)
  ok('los no activos (enviado) no se tocan', enviado.caducar.length === 0 && enviado.marcarPlanYaNoLoPide.length === 0)
}

console.log('\n=== nunca toca version ===')
{
  const r = reconciliarEnvios([guardado('g1', 'nuevo', W49, [['A', 40]])], [], [calculado(W49, [['A', 80]]), calculado('2026-12-16', [['B', 40]])], HOY, COMPLETO)
  ok('el resultado no lleva «version»', !JSON.stringify(r).includes('"version"'))
  ok('puro: misma entrada, misma salida', JSON.stringify(r) === JSON.stringify(reconciliarEnvios([guardado('g1', 'nuevo', W49, [['A', 40]])], [], [calculado(W49, [['A', 80]]), calculado('2026-12-16', [['B', 40]])], HOY, COMPLETO)))
}

console.log('\n=== un hablado no se cuenta a sí mismo como «el plan ya no lo pide» ===')
{
  // Se habló A (40 ud); en la pasada siguiente A cuenta como llegada y el plan ya no la pide
  const g = guardado('h1', 'hablado', W49, [['A', 40]])
  const solo = reconciliarEnvios([g], [], [], HOY, { completo: true, habladosQueCuentan: new Set(['h1']) })
  ok('sin pareja y contando como llegada: NO se marca plan_ya_no_lo_pide', solo.marcarPlanYaNoLoPide.length === 0)
  const antes = reconciliarEnvios([g], [], [], HOY, COMPLETO)
  ok('(sin decir que cuenta, sí se marcaría)', antes.marcarPlanYaNoLoPide.includes('h1'))
  // Otra referencia de la misma semana lo empareja por clave: la diferencia no dice «Sale A»
  const conOtra = reconciliarEnvios([g], [], [calculado(W49, [['B', 12]])], HOY, { completo: true, habladosQueCuentan: new Set(['h1']) })
  const u = conOtra.actualizar[0]
  ok('se empareja por clave y solo cambian las líneas', !!u && u.id === 'h1' && u.soloLineas)
  ok('la diferencia no se inventa que A sale', !(u?.cambios?.frases ?? []).some((f) => /Sale A/.test(f)), (u?.cambios?.frases ?? []).join(' | '))
}

console.log('\n=== el modelo se vuelve a cuadrar dentro del envío (tras recalcular las tallas) ===')
{
  // Dos tallas del mismo modelo, salidas a 5 días: la segunda se recalcula a la salida de la primera y vuelve suelta.
  // Aquí sí se usa el ajustarPorModelo de verdad (es lo que pasa plan-cliente.ts).
  const caja = { unidades: 6, origen: 'deducida' as const }
  const a = linea('M-40', '2026-11-22', 6, { modelo: 'M', talla: '40', caja, tope: 30 }, 0.5)
  const b = linea('M-41', '2026-11-27', 6, { modelo: 'M', talla: '41', caja, tope: 30 }, 0.5)
  const sin = agruparEnvios([a, b], 'cli1', 'conn1', HOY, AJUSTES, PLAZO, recalcular, 0)
  const totalSin = sin.flatMap((e) => e.lineas).filter((l) => l.modelo === 'M').reduce((t, l) => t + l.cantidad, 0)
  ok('(sin ajustar, la talla recalculada rompe la caja del modelo)', totalSin % 6 !== 0, String(totalSin))
  const con = agruparEnvios([a, b], 'cli1', 'conn1', HOY, AJUSTES, PLAZO, recalcular, 0, (ls) => ajustarPorModelo(ls, AJUSTES))
  const lineasM = con.flatMap((e) => e.lineas).filter((l) => l.modelo === 'M')
  const total = lineasM.reduce((t, l) => t + l.cantidad, 0)
  ok('con el ajuste el modelo va en múltiplo de la caja y por encima del mínimo', total > 0 && total % 6 === 0 && total >= Math.max(AJUSTES.minLinea, Math.ceil(1 * 7)), `${total} · ${lineasM.map((l) => `${l.sku}=${l.cantidad}`).join(', ')}`)
  ok('las dos tallas siguen en el envío', lineasM.length === 2, String(lineasM.length))
}

console.log('\n=== una línea que con la salida anterior ya no hace falta no entra en ese envío ===')
{
  recalculoFijo.set('B0', 0)
  const apartadas = new Map<string, string>()
  const r = agruparEnvios([
    linea('A0', '2026-11-22', 40),
    linea('B0', '2026-11-25', 20, { porque: 'Vende 1 ud/día. Mandando 20 ud antes del 25 nov cubres hasta el 20 dic.' }),
  ], 'cli1', 'conn1', HOY, AJUSTES, PLAZO, recalcular, 0, undefined, apartadas)
  const todas = r.flatMap((e) => e.lineas.map((l) => ({ l, e })))
  ok('B0 (recalculada a 0) no va en el envío del 22 nov', !todas.some(({ l }) => l.sku === 'B0'), todas.map(({ l, e }) => `${l.sku}@${e.salirAntesDe}`).join(', '))
  ok('…y queda apartada con su frase', apartadas.has('B0'), [...apartadas.keys()].join())
  ok('…que dice cuándo toca (su propia salida), no «saldrá en el suyo»', /antes del 25 nov/.test(apartadas.get('B0') ?? '') && !/el suyo/.test(apartadas.get('B0') ?? ''), apartadas.get('B0'))
  const urg = agruparEnvios([
    linea('A0', '2026-11-22', 40),
    linea('B0', '2026-11-25', 20, { prioridad: 'urgente', porque: 'Vende 1 ud/día. Mandando 20 ud antes del 25 nov cubres hasta el 20 dic.' }),
  ], 'cli1', 'conn1', HOY, AJUSTES, PLAZO, recalcular, 0)
  const b = urg.flatMap((e) => e.lineas).find((l) => l.sku === 'B0')
  ok('si corre prisa se queda, con la salida del envío', !!b && b.salirAntesDe === '2026-11-22' && b.cantidad === 20, b ? `${b.salirAntesDe} ${b.cantidad}` : 'no está')
  ok('…y la frase con esa fecha', !!b && /antes del 22 nov/.test(b.porque) && !/25 nov/.test(b.porque), b?.porque ?? '')
  recalculoFijo.delete('B0')
  // Toda línea de un envío sale como muy tarde con el envío y su frase no nombra otra salida
  const mezcla = agruparEnvios([
    linea('P1', '2026-11-22', 40), linea('P2', '2026-11-26', 25), linea('P3', '2026-12-04', 12), linea('P4', '2026-12-20', 60),
  ], 'cli1', 'conn1', HOY, AJUSTES, PLAZO, recalcular, 0)
  const malas = mezcla.flatMap((e) => e.lineas.filter((l) => !l.salirAntesDe || l.salirAntesDe > e.salirAntesDe).map((l) => `${l.sku} ${l.salirAntesDe} > ${e.salirAntesDe}`))
  ok('toda línea: salirAntesDe ≤ la salida de su envío', malas.length === 0, malas.join(', '))
}

console.log('\n=== un envío pequeño sin prisa ni euros en juego no se propone (Creative Toys, W52) ===')
{
  const apartadas = new Map<string, string>()
  const r = agruparEnvios([
    linea('GRANDE', '2026-11-22', 454),
    linea('7Z-MSKZ-DKI2', '2026-12-22', 12, { eurosEnRiesgo: 0 }),
  ], 'cli1', 'conn1', HOY, { ...AJUSTES, minEnvio: 134 }, PLAZO, recalcular, 0, undefined, apartadas)
  ok('el plan da un solo envío', r.length === 1 && r[0].lineas.every((l) => l.sku === 'GRANDE'), r.map((e) => `${e.salirAntesDe}:${e.unidades}`).join(', '))
  ok('la de 12 ud queda apartada (aún no toca)', apartadas.has('7Z-MSKZ-DKI2'))
  ok('…con la frase de que no compensa un envío aparte', /no compensa un envío aparte/.test(apartadas.get('7Z-MSKZ-DKI2') ?? ''), apartadas.get('7Z-MSKZ-DKI2'))
}

console.log('\n=== lo que está en preparación no se traga un envío nuevo de otra semana ===')
{
  const W47 = '2026-11-18'
  const W50 = '2026-12-09'
  const prep = guardado('p47', 'en_preparacion', W47, [['A', 40], ['B', 30]], { remesaId: 'r47' })
  const r = reconciliarEnvios([prep], [], [calculado(W50, [['A', 20], ['B', 20]], 'urgente')], HOY, COMPLETO)
  ok('el urgente de la W50 se inserta', r.insertar.length === 1 && r.actualizar.length === 0, JSON.stringify({ i: r.insertar.length, a: r.actualizar.length }))
}

console.log('\n=== convertir y la pasada: una fila recién reclamada no es huérfana ===')
{
  const recien = guardado('c1', 'en_preparacion', W49, [['A', 40]], { estadoCambiadoAt: '2026-11-15T10:00:00Z' })
  const r = reconciliarEnvios([recien], [], [calculado(W49, [['A', 50]])], HOY, { completo: true, ahora: '2026-11-15T10:00:30Z' })
  ok('a los 30 s no pasa a hablado', r.huerfanosAHablado.length === 0 && r.actualizar.length === 0, JSON.stringify(r.huerfanosAHablado))
  const viejo = reconciliarEnvios([recien], [], [calculado(W49, [['A', 50]])], HOY, { completo: true, ahora: '2026-11-15T10:20:00Z' })
  ok('a los 20 min sí', viejo.huerfanosAHablado.join() === 'c1')
}

console.log(`\n${comprobaciones - fallos}/${comprobaciones} bien${fallos ? ` · ${fallos} FALLAN` : ''} (recalcular llamado ${llamadasRecalcular} veces)`)
if (fallos) process.exit(1)
