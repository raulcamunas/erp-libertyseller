import {
  ajustarPorModelo,
  diasEntre,
  esNoComprable,
  fechaCorta,
  planificarSku,
  plazoDelCliente,
  recalcularConLlegada,
  redondearACaja,
  semanaIso,
  simularStock,
  sumarDias,
} from './planificador'
import type { AjustesReposicion, EntradaSku, LlegadaPrevista, MedidasCliente, PlazoEtapas, RitmoSku } from './plan-tipos'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || d === '' ? '' : ` -> ${typeof d === 'string' ? d : JSON.stringify(d)}`}`)
}

/* ------------------------------ Fábricas ------------------------------ */

const HOY = '2026-11-15'

const ajustesBase = (c: Partial<AjustesReposicion> = {}): AjustesReposicion => ({
  coberturaObjetivo: 45, coberturaMaxima: 90, multiploCaja: null, minLinea: 3, minEnvio: 30, ventanaAgrupacion: 7,
  capacidadUnidades: null, topeEstacional: 1.8, campanaHasta: null, transporteUrgenteDias: null, activo: true, avisarChat: true,
  origen: { minEnvio: 'partida', ventanaAgrupacion: 'partida' }, ...c,
})

const medidasBase = (c: Partial<MedidasCliente> = {}): MedidasCliente => ({
  transporteMediano: null, recepcionP75: null, enviosMedidos: 0, cadenciaDias: null, tamanoTipico: null, ...c,
})

/** Plazo manual cerrado: prep 7, transporte 6, recepción 4, margen 7 → L = 17 */
const plazoBase = (c: Partial<PlazoEtapas> = {}): PlazoEtapas => {
  const p: PlazoEtapas = {
    preparacion: 7, transporte: 6, recepcion: 4, margen: 7,
    origen: { preparacion: 'manual', transporte: 'manual', recepcion: 'manual', margen: 'manual' },
    hastaLaVenta: 17, sinConfirmar: false, transporteUrgente: null, ...c,
  }
  p.hastaLaVenta = p.preparacion + p.transporte + p.recepcion
  return p
}

const ritmoBase = (d: number, c: Partial<RitmoSku> = {}): RitmoSku => ({
  base: d, previsto: d, factorEstacional: 1, perfilSemanal: null, origenPerfil: null, picoAnoPasado: null,
  r14: d, r30: d, r60: d, r90: d, diasConStock90: 90, ventas90: Math.round(d * 90), ventas30: Math.round(d * 30), ventas180: Math.round(d * 180),
  tendencia: 'estable', confianza: 'alta', origen: 'sku', ultimoPeriodoHasta: null,
  pedidoGrande: false, serieDeStockFiable: true, anclajeEstimado: false, tasaDevolucionVendible: 0, mermaDiaria: 0, consumoNeto: d,
  explicacion: `${d} ud/día`, ...c,
})

const entrada = (c: Partial<EntradaSku> & { d?: number } = {}): EntradaSku => {
  const { d = 2, ...resto } = c
  return {
    sku: 'SKU-1', asin: 'B000', fnsku: 'X000', nombre: 'Producto', modelo: null, talla: null, precio: 30, moneda: 'EUR',
    vendibles: 92, reservadas: 0, entranteAmazon: 0, llegadas: [], llegadasDescartadas: [],
    ritmo: ritmoBase(d), comprable: true, descatalogada: false, excluida: null,
    cajaSku: null, cajaDeducida: null, coberturaSku: null, diasSinVenta: 0, pctMasDe180: 0, tasaDevolucion90: 0,
    ventas90: Math.round(d * 90), enCuarentena: null, provisional: false, stockViejoDias: null, almacenCliente: null,
    ...resto,
  }
}

const llegada = (fecha: string, unidades: number, c: Partial<LlegadaPrevista> = {}): LlegadaPrevista => ({
  fecha, unidades, origen: 'camino', remesaId: 'r1', envioPropuestoId: null, nombre: 'Envío', dudoso: false, fechaEnvio: null, ...c,
})

const plan = (e: EntradaSku, p = plazoBase(), a = ajustesBase(), m = medidasBase(), hoy = HOY) => planificarSku(e, hoy, p, a, m)

/* ------------------------------ Utilidades ------------------------------ */

console.log('\n=== fechas ===')
ok('sumar días cruza el año', sumarDias('2026-12-20', 20) === '2027-01-09')
ok('días entre', diasEntre('2026-11-15', '2026-12-03') === 18)
ok('«3 dic»', fechaCorta('2026-12-03') === '3 dic')
ok('semana ISO: 1 ene 2027 es W53 de 2026; 4 ene 2027 W1; 23 nov 2026 W48', semanaIso('2027-01-01') === 53 && semanaIso('2027-01-04') === 1 && semanaIso('2026-11-23') === 48, [semanaIso('2027-01-01'), semanaIso('2027-01-04'), semanaIso('2026-11-23')])

/* ------------------------------ Plazo (37, 38, D10) ------------------------------ */

console.log('\n=== plazo por etapas ===')
{
  const p = plazoDelCliente({ diasPreparacion: 5, diasTransporte: 10, diasRecepcion: 3, diasMargen: 4, total: null }, medidasBase({ transporteMediano: 20, recepcionP75: 9, enviosMedidos: 5 }), HOY, { transporteUrgenteDias: null })
  ok('37 · plazo manual gana: origen manual en las 4', p.preparacion === 5 && p.transporte === 10 && p.recepcion === 3 && p.margen === 4 && Object.values(p.origen).every((o) => o === 'manual') && !p.sinConfirmar, p)
  ok('L = preparación + transporte + recepción', p.hastaLaVenta === 18)

  const m = plazoDelCliente(null, medidasBase({ transporteMediano: 6, recepcionP75: 10, enviosMedidos: 3 }), HOY, { transporteUrgenteDias: 9 })
  ok('D10 · transporte y recepción medidos (≥ 2 envíos); preparación y margen de partida 7', m.transporte === 6 && m.recepcion === 10 && m.origen.transporte === 'medido' && m.origen.recepcion === 'medido' && m.preparacion === 7 && m.margen === 7 && m.origen.margen === 'partida', m)
  ok('sinConfirmar mientras haya etapas de partida; transporte urgente pasa', m.sinConfirmar && m.transporteUrgente === 9)

  const q4 = plazoDelCliente(null, medidasBase({ transporteMediano: 6, recepcionP75: null, enviosMedidos: 3 }), HOY, { transporteUrgenteDias: null })
  ok('D10 · recepción sin medir en noviembre: 7 × 1,5 = 11 (partida)', q4.recepcion === 11 && q4.origen.recepcion === 'partida', q4)
  const verano = plazoDelCliente(null, null, '2026-06-10', { transporteUrgenteDias: null })
  ok('en junio la recepción de partida es 7; todo de partida 7/18/7/7', verano.recepcion === 7 && verano.transporte === 18 && verano.preparacion === 7 && verano.margen === 7 && verano.sinConfirmar, verano)

  const unSolo = plazoDelCliente(null, medidasBase({ transporteMediano: 6, recepcionP75: 4, enviosMedidos: 1 }), '2026-06-10', { transporteUrgenteDias: null })
  ok('con 1 envío medido no vale la medida', unSolo.origen.transporte === 'partida' && unSolo.transporte === 18)

  const total = plazoDelCliente({ diasPreparacion: null, diasTransporte: null, diasRecepcion: null, diasMargen: null, total: 45 }, null, HOY, { transporteUrgenteDias: null })
  ok('solo total → repartirTotal, manual', total.preparacion + total.transporte + total.recepcion + total.margen === 45 && total.origen.transporte === 'manual' && !total.sinConfirmar, total)

  const sku = plazoDelCliente({ diasPreparacion: 7, diasTransporte: 6, diasRecepcion: 4, diasMargen: 7, total: null }, null, HOY, { transporteUrgenteDias: null }, 60)
  ok('38 · plazo por SKU de 60: L + M = 60 repartido', sku.preparacion + sku.transporte + sku.recepcion + sku.margen === 60 && sku.transporte > 6, sku)
}

/* ------------------------------ esNoComprable (13) ------------------------------ */

console.log('\n=== no comprable (D1) ===')
{
  ok('13 · V > 0 sin BUYABLE → no comprable', esNoComprable({ vendibles: 10, listingStatus: ['DISCOVERABLE'], hayBuyableEnCliente: true, suprimido: false, activoManual: true }))
  ok('13 · V = 0 [DISCOVERABLE] → agotado, SÍ comprable', !esNoComprable({ vendibles: 0, listingStatus: ['DISCOVERABLE'], hayBuyableEnCliente: true, suprimido: false, activoManual: true }))
  ok('si ningún listing del cliente trae BUYABLE no se afirma', !esNoComprable({ vendibles: 10, listingStatus: ['DISCOVERABLE'], hayBuyableEnCliente: false, suprimido: false, activoManual: true }))
  ok('suprimido o activo_manual = false → no comprable', esNoComprable({ vendibles: 0, listingStatus: ['BUYABLE'], hayBuyableEnCliente: true, suprimido: true, activoManual: true }) && esNoComprable({ vendibles: 5, listingStatus: ['BUYABLE'], hayBuyableEnCliente: true, suprimido: false, activoManual: false }))
  ok('sin fila de listing no se afirma', !esNoComprable({ vendibles: 5, listingStatus: null, hayBuyableEnCliente: true, suprimido: false, activoManual: null }))
  ok('estado [] (Amazon no informa en ese mercado) es «sin dato»: no se afirma', !esNoComprable({ vendibles: 4, listingStatus: [], hayBuyableEnCliente: true, suprimido: false, activoManual: null }))

  const noComp = plan(entrada({ comprable: false, vendibles: 10 }))
  ok('13 · planificarSku con comprable=false → no_comprable', noComp.fuera === 'no_comprable' && noComp.cantidad === 0)
  const agotado = plan(entrada({ vendibles: 0, comprable: !esNoComprable({ vendibles: 0, listingStatus: ['DISCOVERABLE'], hayBuyableEnCliente: true, suprimido: false, activoManual: true }) }))
  ok('13 · V = 0 [DISCOVERABLE] con ventas → se propone', agotado.fuera === null && agotado.cantidad > 0, agotado)
}

/* ------------------------------ Simulación ------------------------------ */

console.log('\n=== simulación ===')
{
  const s = simularStock(10, [], () => 2, HOY, 30, 17)
  ok('10 ud a 2/día: primer hueco el día 5', s.fechaPrimerHueco === sumarDias(HOY, 5), s.fechaPrimerHueco)
  ok('sin llegadas, la rotura es ese mismo hueco aunque sea antes de H + L', s.fechaRotura === sumarDias(HOY, 5))
  ok('días sin stock 0..30 = 25', Math.round(s.diasSinStock(HOY, sumarDias(HOY, 30))) === 25)
  const dud = simularStock(10, [llegada(sumarDias(HOY, 3), 100, { dudoso: true })], () => 2, HOY, 30, 17)
  ok('las llegadas dudosas no cuentan', dud.fechaRotura === sumarDias(HOY, 5))
  const pasada = simularStock(0, [llegada('2026-11-01', 20)], () => 1, HOY, 40, 17)
  ok('una llegada con fecha pasada entra hoy', pasada.stockEn(HOY) === 20 && pasada.fechaPrimerHueco === sumarDias(HOY, 20), [pasada.stockEn(HOY), pasada.fechaPrimerHueco])
}

/* ------------------------------ Casos ------------------------------ */

console.log('\n=== 2 · stock de sobra / exceso (D16) ===')
{
  const l = plan(entrada({ vendibles: 454, d: 47 / 30 }))
  ok('V 454 a ~1,6/día (> 150 d) → exceso, cantidad 0', l.fuera === 'exceso' && l.cantidad === 0 && (l.coberturaDias ?? 0) > 150, [l.fuera, l.coberturaDias])
  ok('la frase dice lo que sobra y qué hacer', /sobran/.test(l.porque) && /promoción|retirada/.test(l.porque), l.porque)
  const s = plan(entrada({ vendibles: 60, d: 1, llegadas: [llegada(sumarDias(HOY, 10), 60)] }))
  ok('con lo que viene pasa de L + M + T → stock_de_sobra', s.fuera === 'stock_de_sobra', [s.fuera, s.fechaRotura])
}

console.log('\n=== 4 · estacionalidad navideña ===')
{
  const perfil = Array.from({ length: 54 }, () => 1)
  for (let w = 44; w <= 52; w++) perfil[w] = 2.3
  const plano = plan(entrada({ vendibles: 60, d: 1.5 }))
  const estacional = plan(entrada({ vendibles: 60, d: 1.5, ritmo: ritmoBase(1.5, { perfilSemanal: perfil, origenPerfil: 'sku', picoAnoPasado: 2.3, factorEstacional: 1.8 }) }))
  ok('con el pico la rotura llega antes', (estacional.fechaRotura ?? '9') < (plano.fechaRotura ?? '9'), [plano.fechaRotura, estacional.fechaRotura])
  ok('la prioridad sube', ['tarde', 'urgente', 'esta_semana', 'proximas_2', 'este_mes', 'mas_adelante'].indexOf(estacional.prioridad) < ['tarde', 'urgente', 'esta_semana', 'proximas_2', 'este_mes', 'mas_adelante'].indexOf(plano.prioridad), [plano.prioridad, estacional.prioridad])
  const sim = simularStock(1000, [], () => 0, HOY, 1, 1)
  ok('(control) simulación sin consumo no rompe', sim.fechaRotura === null)
  // El consumo diario usa 1,5 × min(2,3, 1,8) = 2,7: 60 ud duran ~22 días
  ok('el factor se topa a 1,8: 60 ud duran ~22 días (no 17 con ×2,3)', Math.abs(diasEntre(HOY, estacional.fechaPrimerHueco ?? HOY) - 22) <= 1, estacional.fechaPrimerHueco)
  ok('aviso tope_estacional y la frase del pico', estacional.avisos.includes('tope_estacional') && /×2,3/.test(estacional.porque) && /×1,8/.test(estacional.porque), estacional.porque)
}

console.log('\n=== 6 · agotado que vende ===')
{
  const l = plan(entrada({ vendibles: 0, d: 1, ritmo: ritmoBase(1, { ventas30: 6, confianza: 'media' }) }))
  ok('V 0 → tarde (17 días sin stock inevitables)', l.prioridad === 'tarde' && l.vaTarde && l.diasSinStockInevitables === 17, [l.prioridad, l.diasSinStockInevitables])
  ok('€ en riesgo > 0 y € si va tarde = 17 × 1 × 30', (l.eurosEnRiesgo ?? 0) > 0 && l.eurosSiVaTarde === 510, [l.eurosEnRiesgo, l.eurosSiVaTarde])
  ok('salir antes de = hoy + preparación; «Ya vas tarde»', l.salirAntesDe === sumarDias(HOY, 7) && /Ya vas tarde/.test(l.porque), l.porque)
  ok('se propone', l.fuera === null && l.cantidad > 0)
}

console.log('\n=== 11 · sin ventas · 12 · descatalogada · 14/15 · sin datos ===')
{
  const sv = plan(entrada({ vendibles: 30, ritmo: ritmoBase(0, { base: null, previsto: null, r14: null, r30: null, r60: null, r90: null, ventas90: 0, ventas30: 0, ventas180: 0, confianza: 'sin_datos' }), ventas90: 0 }))
  ok('11 · 0 en 90 d con V 30 → sin_ventas', sv.fuera === 'sin_ventas', sv.fuera)
  const desc = plan(entrada({ descatalogada: true }))
  ok('12 · descatalogada', desc.fuera === 'descatalogada' && desc.cantidad === 0)
  const excl = plan(entrada({ excluida: { motivo: 'la marca la deja' } }))
  ok('12 · excluida en fba_reposicion_sku → descatalogada', excl.fuera === 'descatalogada' && /la marca la deja/.test(excl.porque))
  const sd = plan(entrada({ ritmo: ritmoBase(0.2, { ventas90: 2, diasConStock90: 10, confianza: 'sin_datos' }) }))
  ok('14 · datos escasos → sin_datos, cantidad 0, «sin datos suficientes»', sd.fuera === 'sin_datos' && sd.cantidad === 0 && /[Ss]in datos suficientes/.test(sd.porque), sd.porque)
  const sinLeer = plan(entrada({ ritmo: ritmoBase(2, { confianza: 'sin_datos' }) }))
  ok('15 · libro sin leer (ritmo sin_datos) → sin_datos', sinLeer.fuera === 'sin_datos')
}

console.log('\n=== 16 · provisional ===')
{
  const prov = plan(entrada({ vendibles: 20, d: 2, provisional: true }))
  ok('16 · provisional: la prioridad máxima es este_mes', prov.prioridad === 'este_mes' && prov.avisos.includes('provisional'), prov.prioridad)
  const agot = plan(entrada({ vendibles: 0, d: 2, provisional: true }))
  ok('16 · salvo agotada con ventas recientes: sigue tarde', agot.prioridad === 'tarde', agot.prioridad)
}

console.log('\n=== 17 · cantidad ridícula · 18/19 · caja ===')
{
  // D = 0,3; con margen corto la necesidad ronda 2 ud
  const l = plan(entrada({ vendibles: 9, d: 0.3 }), plazoBase(), ajustesBase({ coberturaObjetivo: 8 }))
  ok('17 · D 0,3 con necesidad ~2 → cantidad_ridicula (mínimo 3)', l.fuera === 'cantidad_ridicula' && l.cantidad === 0, [l.fuera, l.necesidad, l.porque])
  ok('18 · 26 a caja 12 → 24; 31 → 36', redondearACaja(26, 12, false) === 24 && redondearACaja(31, 12, false) === 36)
  ok('19 · 5 a caja 12 con prisa → 12; sin prisa → 0', redondearACaja(5, 12, true) === 12 && redondearACaja(5, 12, false) === 0)
  ok('sin caja → redondeo normal', redondearACaja(26.4, null, false) === 26)

  const conCaja = plan(entrada({ vendibles: 20, d: 2, cajaSku: 12, cajaDeducida: 18 }), plazoBase(), ajustesBase({ multiploCaja: 10 }))
  ok('D13 · caja sku > deducida > cliente', conCaja.caja?.origen === 'sku' && conCaja.cantidad % 12 === 0 && conCaja.cajas === conCaja.cantidad / 12, [conCaja.caja, conCaja.cantidad])
  const ded = plan(entrada({ vendibles: 20, d: 2, cajaDeducida: 18 }), plazoBase(), ajustesBase({ multiploCaja: 10 }))
  ok('D13 · sin caja de la referencia manda la deducida', ded.caja?.origen === 'deducida' && ded.cantidad % 18 === 0, [ded.caja, ded.cantidad])
  const cli = plan(entrada({ vendibles: 20, d: 2 }), plazoBase(), ajustesBase({ multiploCaja: 10 }))
  ok('D13 · y si no, la del cliente', cli.caja?.origen === 'cliente' && cli.cantidad % 10 === 0)
}

console.log('\n=== 20 · antiguo · 21 · parado ===')
{
  const ant = plan(entrada({ vendibles: 150, d: 2, pctMasDe180: 40 }))
  ok('20 · 40 % > 180 días, cobertura 75 → antiguo', ant.fuera === 'antiguo' || ant.fuera === 'stock_de_sobra', [ant.fuera, ant.coberturaDias])
  const antMedio = plan(entrada({ vendibles: 130, d: 2, pctMasDe180: 0.4 }), plazoBase(), ajustesBase({ coberturaObjetivo: 60 }))
  ok('20 · con prioridad normal y cobertura 65 → fuera «antiguo»', antMedio.fuera === 'antiguo', [antMedio.fuera, antMedio.prioridad, antMedio.coberturaDias])
  // Tarde con cobertura 65 > 60: plazo largo (L = 71) que no llega antes de la rotura
  const urg = plan(entrada({ vendibles: 130, d: 2, pctMasDe180: 0.4 }), plazoBase({ transporte: 60, recepcion: 4 }))
  ok('20 · si es urgente/tarde no excluye: aviso antiguo y Tmax 45 (≤ 90 ud)', urg.fuera === null && urg.avisos.includes('antiguo') && (urg.prioridad === 'tarde' || urg.prioridad === 'urgente') && urg.cantidad > 0 && urg.cantidad <= 90, [urg.fuera, urg.prioridad, urg.coberturaDias, urg.cantidad])
  const par = plan(entrada({ vendibles: 80, diasSinVenta: 50 }))
  ok('21 · V 80 y 50 días sin vender → parado', par.fuera === 'parado')
}

console.log('\n=== 22 · comprometido · 23 · camino que llega tarde ===')
{
  // necesidad ~100 sin nada; con 100 comprometidas que llegan antes de la rotura no se pide otra vez
  const sin = plan(entrada({ vendibles: 40, d: 2 }))
  const con = plan(entrada({ vendibles: 40, d: 2, llegadas: [llegada(sumarDias(HOY, 12), 100, { origen: 'comprometido' })] }))
  ok('22 · sin nada se proponen ~100', sin.cantidad >= 80, sin.cantidad)
  ok('22 · con 100 comprometidas antes de la rotura: no se pide dos veces', con.cantidad === 0 || con.cantidad <= sin.cantidad - 90, [con.fuera, con.cantidad])
  ok('22 · comprometido contado', con.comprometido === 100)

  // V cubre 5 d, camino a los 20, L = 24 → 15 días sin stock inevitables
  const p24 = plazoBase({ preparacion: 7, transporte: 13, recepcion: 4 })
  const l = plan(entrada({ vendibles: 10, d: 2, precio: 10, llegadas: [llegada(sumarDias(HOY, 20), 300)] }), p24)
  // Ningún envío nuevo cierra ese hueco (lo de camino llega antes): queda como dato, no decide «tarde»
  ok('23 · días sin stock 15, pero NO tarde (ningún envío lo evita)', l.diasSinStockInevitables === 15 && l.prioridad !== 'tarde' && !l.vaTarde, [l.diasSinStockInevitables, l.prioridad])
  ok('23 · un envío nuevo no llega antes que el de camino: no se propone y la frase avisa del hueco', l.cantidad === 0 && /días sin stock desde el/.test(l.porque), [l.fuera, l.porque])
  ok('23 · € si va tarde = 15 × D × precio = 300', l.eurosSiVaTarde === 300, l.eurosSiVaTarde)
  ok('23 · el primer hueco es el día 5', l.fechaPrimerHueco === sumarDias(HOY, 5))
}

console.log('\n=== 24 · Portico (EE. UU.) ===')
{
  const p = plazoDelCliente(null, medidasBase({ transporteMediano: 60, recepcionP75: 4, enviosMedidos: 4, cadenciaDias: 30 }), HOY, { transporteUrgenteDias: 9 })
  ok('24 · L ≈ 71', p.hastaLaVenta === 71, p.hastaLaVenta)
  const m = medidasBase({ transporteMediano: 60, recepcionP75: 4, enviosMedidos: 4, cadenciaDias: 30 })
  const l = planificarSku(entrada({ vendibles: 40, d: 1, moneda: 'USD', precio: 25 }), HOY, p, ajustesBase({ transporteUrgenteDias: 9 }), m)
  ok('24 · Tef = max(45, 60 + 4 + 30) = 94', l.coberturaEfectiva === 94, l.coberturaEfectiva)
  ok('24 · tarde → salirAntesDe = hoy + preparación', l.prioridad === 'tarde' && l.salirAntesDe === sumarDias(HOY, p.preparacion), [l.prioridad, l.salirAntesDe])
  ok('24 · «Ya vas tarde: si sale esta semana llega el …»', /Ya vas tarde: si sale esta semana llega el \d+ \w{3}/.test(l.porque), l.porque)
  ok('24 · moneda USD y «$» en la frase', l.moneda === 'USD' && /\$/.test(l.porque), l.porque)
  ok('24 · alternativa en avión', l.aLaVentaUrgente === sumarDias(HOY, 7 + 9 + 4) && /En avión, 9 días/.test(l.porque), [l.aLaVentaUrgente])
  ok('24 · cubre Tef: cantidad ≈ 94 + 7 días', l.cantidad >= 95 && l.cantidad <= 105, l.cantidad)
}

console.log('\n=== 25 · sin precio · 26 · tendencia baja · 27 · temporada alta ===')
{
  const sp = plan(entrada({ precio: null, vendibles: 20 }))
  ok('25 · sin precio: € null y aviso', sp.eurosEnRiesgo === null && sp.eurosSiVaTarde === null && sp.avisos.includes('sin_precio'))
  const baja = plan(entrada({ vendibles: 20, ritmo: ritmoBase(2, { tendencia: 'baja' }) }))
  ok('26 · tendencia baja: T × 0,75 = 34', baja.coberturaEfectiva === 34, baja.coberturaEfectiva)
  const temp = plan(entrada({ vendibles: 5, d: 0.4 }))
  ok('27 · noviembre y D 0,4 → T = 30', temp.coberturaEfectiva === 30, temp.coberturaEfectiva)
  const junio = plan(entrada({ vendibles: 5, d: 0.4 }), plazoBase(), ajustesBase(), medidasBase(), '2026-06-10')
  ok('27 · en junio sigue 45', junio.coberturaEfectiva === 45)
}

console.log('\n=== 31 · cuarentena ===')
{
  // Rotura de modo que la prioridad salga «este_mes»
  const e = (pr: 'este_mes' | 'mas_adelante') => entrada({ vendibles: 100, d: 2, enCuarentena: { prioridad: pr } })
  const normal = plan(entrada({ vendibles: 100, d: 2 }))
  ok('(la referencia sale este_mes)', normal.prioridad === 'este_mes', [normal.prioridad, normal.decidirAntesDe])
  ok('31 · descartada con este_mes y hoy este_mes → en_cuarentena', plan(e('este_mes')).fuera === 'en_cuarentena')
  const urg = plan(entrada({ vendibles: 30, d: 2, enCuarentena: { prioridad: 'este_mes' } }))
  ok('31 · si hoy es más urgente → vuelve', urg.fuera === null && urg.prioridad !== 'este_mes', [urg.fuera, urg.prioridad])
}

console.log('\n=== 41 · entrante sin remesa ===')
{
  const l = plan(entrada({ vendibles: 50, d: 5, entranteAmazon: 600, llegadas: [llegada(sumarDias(HOY, 10), 600, { origen: 'amazon_sin_remesa', remesaId: null })] }))
  ok('41 · deCamino 600, entranteSinRemesa 600, aviso', l.deCamino === 600 && l.entranteSinRemesa === 600 && l.avisos.includes('entrante_sin_remesa'), [l.deCamino, l.avisos])
  ok('41 · no se propone', l.cantidad === 0 && l.fuera !== null, [l.fuera, l.cantidad])
  ok('41 · la frase dice que se importe', /importa el envío/.test(l.porque) || l.fuera === 'stock_de_sobra', l.porque)
}

console.log('\n=== 42 · llegada mañana con V = 0 (D4) ===')
{
  const l = plan(entrada({ vendibles: 0, d: 0.1, ritmo: ritmoBase(0.1, { confianza: 'media' }), llegadas: [llegada(sumarDias(HOY, 1), 4)] }))
  ok('42 · primer hueco hoy (informativo)', l.fechaPrimerHueco === HOY)
  ok('42 · nada tarde', !l.vaTarde && l.prioridad !== 'tarde', [l.prioridad, l.diasSinStockInevitables])
  ok('42 · rotura que decide ≈ día 41', Math.abs(diasEntre(HOY, l.fechaRotura ?? HOY) - 41) <= 1, l.fechaRotura)
  ok('42 · prioridad según esa rotura (41 − 7 − 17 = 17 días → este_mes)', l.prioridad === 'este_mes', [l.prioridad, l.decidirAntesDe])
}

console.log('\n=== 43 · estacionalidad por semana: enero no usa el pico ===')
{
  const perfil = Array.from({ length: 54 }, () => 1)
  perfil[48] = 5.8
  for (let w = 1; w <= 9; w++) perfil[w] = 0.2
  perfil[53] = 0.2
  const r = ritmoBase(2, { perfilSemanal: perfil, origenPerfil: 'sku', picoAnoPasado: 5.8 })
  // V que llega a mediados de diciembre; A cae a finales de dic y la ventana [A, A + T] es enero-febrero
  const l = plan(entrada({ vendibles: 70, d: 2, ritmo: r }))
  const plano = plan(entrada({ vendibles: 70, d: 2 }))
  ok('43 · la cantidad de enero es mucho menor que con el ritmo plano', l.cantidad > 0 && l.cantidad < plano.cantidad * 0.6, [l.cantidad, plano.cantidad, l.aLaVentaObjetivo])
  ok('43 · nunca usa el pico: cantidad < 1,8 × 2 × (T + M)', l.cantidad < 1.8 * 2 * 52)
  ok('43 · aviso tope_estacional (W48 ×5,8 → ×1,8)', l.avisos.includes('tope_estacional') && /×5,8/.test(l.porque), l.porque)
}

console.log('\n=== 44 · agotado largo ===')
{
  const l = plan(entrada({ vendibles: 0, ritmo: ritmoBase(1, { origen: 'ultimo_periodo', confianza: 'baja', ultimoPeriodoHasta: '2026-07-18', ventas90: 0, ventas30: 0, diasConStock90: 0 }) }))
  ok('44 · agotado_largo, no se propone solo', l.fuera === 'agotado_largo' && l.cantidad === 0)
  ok('44 · frase con «último periodo» y «¿Se repone?»', /último periodo con stock hasta el 18 jul/.test(l.porque) && /Se repone/.test(l.porque), l.porque)
}

console.log('\n=== 46 · mínimo por modelo · 47 · solo r14 ===')
{
  const tallas = ['37', '38', '39', '40', '41', '42'].map((t, i) =>
    plan(entrada({ sku: `M1-${t}`, modelo: 'M1', talla: t, vendibles: 0, d: 0.03 + i * 0.002, ritmo: ritmoBase(0.03 + i * 0.002, { origen: 'modelo', confianza: 'media' }) }), plazoBase(), ajustesBase({ coberturaObjetivo: 30 })))
  ok('46 · cada talla sale con 1-2 ud (sin mínimo por talla)', tallas.every((l) => l.fuera === null && l.cantidad >= 1 && l.cantidad <= 2), tallas.map((l) => [l.cantidad, l.fuera]))
  const ajustadas = ajustarPorModelo(tallas, ajustesBase())
  const total = ajustadas.reduce((s, l) => s + l.cantidad, 0)
  const dModelo = tallas.reduce((s, l) => s + (l.ritmo.previsto ?? 0), 0)
  ok('46 · el modelo suma ≥ max(3, 7 días del modelo) → se proponen todas', ajustadas.every((l) => l.fuera === null && l.cantidad >= 1) && total >= Math.max(3, Math.ceil(dModelo * 7)), [total, dModelo])

  const pocas = ajustarPorModelo(tallas.slice(0, 2).map((l) => ({ ...l, cantidad: 1 })), ajustesBase())
  ok('46 · un modelo con 2 ud en total (< 3) → todas cantidad_ridicula', pocas.every((l) => l.fuera === 'cantidad_ridicula' && l.cantidad === 0))

  const conCaja = ajustarPorModelo(tallas.map((l) => ({ ...l, caja: { unidades: 6, origen: 'cliente' as const } })), ajustesBase())
  const totalCaja = conCaja.reduce((s, l) => s + l.cantidad, 0)
  ok('el modelo se redondea a la caja (6) repartiendo por tallas', totalCaja % 6 === 0 && totalCaja > 0, [totalCaja, conCaja.map((l) => l.cantidad)])
  ok('las líneas sin modelo no se tocan', ajustarPorModelo([plan(entrada())], ajustesBase())[0].cantidad === plan(entrada()).cantidad)

  const r47 = ritmoBase(0.3, { r14: 2, r30: null, r60: null, r90: null, confianza: 'baja', origen: 'modelo' })
  const l47 = plan(entrada({ vendibles: 0, modelo: 'M2', talla: '40', ritmo: r47 }))
  ok('47 · solo r14 con modelo repartido 0,3 → cantidad ≤ min(60, 0,3 × T)', l47.cantidad > 0 && l47.cantidad <= Math.min(60, 0.3 * l47.coberturaEfectiva) && l47.avisos.includes('solo_r14'), [l47.cantidad, l47.coberturaEfectiva, l47.fuera])
  const sinModelo = plan(entrada({ vendibles: 0, ritmo: ritmoBase(2, { r14: 2, r30: null, r60: null, r90: null, confianza: 'baja' }) }))
  ok('47 · solo r14 y sin modelo → sin_datos', sinModelo.fuera === 'sin_datos')
}

console.log('\n=== 48 · consumo neto ===')
{
  const bruto = plan(entrada({ vendibles: 60, d: 2 }))
  const neto = plan(entrada({ vendibles: 60, d: 2, ritmo: ritmoBase(2, { tasaDevolucionVendible: 0.19 }) }))
  ok('48 · con 19 % de devolución vendible la rotura llega más tarde', (neto.fechaRotura ?? '') > (bruto.fechaRotura ?? ''), [bruto.fechaRotura, neto.fechaRotura])
  ok('48 · la frase explica las dos cifras', /netas/.test(neto.porque) && /19 %/.test(neto.porque), neto.porque)
  const tope = plan(entrada({ vendibles: 60, d: 2, ritmo: ritmoBase(2, { tasaDevolucionVendible: 0.6 }) }))
  const tope30 = plan(entrada({ vendibles: 60, d: 2, ritmo: ritmoBase(2, { tasaDevolucionVendible: 0.3 }) }))
  ok('48 · la tasa se topa a 0,3', tope.fechaRotura === tope30.fechaRotura)
  const merma = plan(entrada({ vendibles: 60, d: 2, ritmo: ritmoBase(2, { mermaDiaria: 0.3 }) }))
  ok('48 · la merma adelanta la rotura y avisa', (merma.fechaRotura ?? '') < (bruto.fechaRotura ?? '') && merma.avisos.includes('merma_alta'))
}

console.log('\n=== 53 · stock viejo ===')
{
  const l = plan(entrada({ vendibles: 20, stockViejoDias: 44 }))
  ok('53 · se usa, aviso stock_viejo y confianza un nivel menos', l.avisos.includes('stock_viejo') && l.ritmo.confianza === 'media' && l.fuera === null && /44 días/.test(l.porque), [l.ritmo.confianza, l.avisos])
}

console.log('\n=== D3 · llegadas dudosas y propuestas paradas ===')
{
  const l = plan(entrada({ vendibles: 20, d: 2, llegadas: [llegada(sumarDias(HOY, 2), 120, { dudoso: true, fechaEnvio: '2026-09-20' })] }))
  ok('lo dudoso no cuenta para la cobertura y se cuenta aparte', l.dudoso === 120 && l.deCamino === 0 && l.avisos.includes('envio_dudoso'), [l.dudoso, l.deCamino])
  ok('«Si llega el envío del 20 sep (120 ud)…»', /Si llega el envío del 20 sep \(120 ud\)/.test(l.porque), l.porque)
  const p = plan(entrada({ vendibles: 20, d: 2, llegadasDescartadas: [{ unidades: 120, motivo: 'propuesta_parada', nombre: 'Reposición', desde: '2026-10-02' }] }))
  ok('propuesta parada: aviso y frase', p.avisos.includes('comprometido_parado') && /parada \(«Reposición»\) desde el 2 oct; no se cuentan/.test(p.porque), p.porque)
}

console.log('\n=== D7 · campaña ===')
{
  const l = plan(entrada({ vendibles: 0, d: 2 }), plazoBase(), ajustesBase({ campanaHasta: '11-28' }))
  ok('llega después de la campaña → llega_tarde_campana', l.avisos.includes('llega_tarde_campana') && /campaña/.test(l.porque), l.porque)
  const a = plan(entrada({ vendibles: 0, d: 2 }), plazoBase(), ajustesBase({ campanaHasta: '12-18' }))
  ok('si llega antes, sin aviso', !a.avisos.includes('llega_tarde_campana'))
}

console.log('\n=== recalcularConLlegada ===')
{
  const e = entrada({ vendibles: 100, d: 2 })
  const ctx = { hoy: HOY, plazo: plazoBase(), ajustes: ajustesBase(), medidas: medidasBase() }
  const l = planificarSku(e, HOY, ctx.plazo, ctx.ajustes, ctx.medidas)
  const antes = sumarDias(l.salirAntesDe ?? HOY, -6)
  const r = recalcularConLlegada({ ...l, adelantada: true }, e, antes, ctx)
  ok('salir antes → llega antes y hace falta algo menos (o igual)', r.cantidad > 0 && r.cantidad <= l.cantidad + 1 && r.salirAntesDe === antes, [l.cantidad, r.cantidad, r.salirAntesDe])
  ok('conserva adelantada y añade el aviso', r.adelantada && r.avisos.includes('adelantada'))
  const lejos = entrada({ vendibles: 120, d: 2 })
  const ll = planificarSku(lejos, HOY, ctx.plazo, ctx.ajustes, ctx.medidas)
  const rr = recalcularConLlegada(ll, lejos, sumarDias(HOY, 3), ctx)
  ok('una «aún no toca» recalculada a una salida cercana tiene cantidad (no se excluye por fecha)', ll.fuera === 'aun_no_toca' && rr.fuera === null && rr.cantidad > 0, [ll.fuera, rr.fuera, rr.cantidad])
}

console.log('\n=== Frase con cifras y fechas ===')
{
  const l = plan(entrada({ vendibles: 60, d: 2 }))
  ok('«Vende 2 ud/día (últimos 14/30/90 días con stock), tiene 60 y nada de camino: se queda sin stock el …. Mandando N ud antes del … cubres hasta el …»',
    /^Vende 2 ud\/día \(últimos 14\/30\/90 días con stock\), tiene 60 y nada de camino: se queda sin stock el \d+ \w{3}\. Mandando \d+ ud antes del \d+ \w{3} cubres hasta el \d+ \w{3}\./.test(l.porque), l.porque)
}

console.log('\n=== D4 · un hueco que se cierra antes de que pueda llegar nada no es «tarde» ===')
{
  // V 0 a 0,1/día con 4 ud que llegan en 3 días: 3 días de hueco que ningún envío evita; la rotura de verdad, ~40 días después
  const l = plan(entrada({ vendibles: 0, d: 0.1, ritmo: ritmoBase(0.1, { confianza: 'baja' }), llegadas: [llegada(sumarDias(HOY, 3), 4)] }))
  ok('3 días de hueco antes de la llegada: quedan como dato', l.diasSinStockInevitables === 3, l.diasSinStockInevitables)
  ok('no sale «tarde» (la rotura que decide es posterior a H + L)', !l.vaTarde && l.prioridad !== 'tarde', [l.prioridad, l.fechaRotura])
  ok('la frase lo cuenta («… que ya no se evitan»)', /no se evitan/.test(l.porque), l.porque)
  // Y si de verdad va tarde, la frase dice la llegada de hoy + L
  const t = plan(entrada({ vendibles: 0, d: 2 }))
  ok('tarde: «si sale esta semana llega el» hoy + L', t.vaTarde && t.porque.includes(`llega el ${fechaCorta(sumarDias(HOY, plazoBase().hastaLaVenta))}`), t.porque)
}

console.log('\n=== agotado largo con algo de camino: no se pregunta «¿se repone?» ===')
{
  const r = ritmoBase(1, { origen: 'ultimo_periodo', confianza: 'baja', ultimoPeriodoHasta: '2026-07-18', ventas90: 0, ventas30: 0, diasConStock90: 0 })
  const l = plan(entrada({ vendibles: 0, ritmo: r, llegadas: [llegada(sumarDias(HOY, 3), 4, { nombre: 'FBA STA' })] }))
  ok('con 4 ud de camino no es agotado_largo', l.fuera !== 'agotado_largo' && l.cantidad === 0, l.fuera)
  ok('la frase dice lo que llega y no pregunta', /Llegan 4 ud el/.test(l.porque) && !/Se repone/.test(l.porque), l.porque)
  const d = plan(entrada({ vendibles: 0, ritmo: r, llegadas: [llegada(sumarDias(HOY, 3), 4, { dudoso: true })] }))
  ok('lo dudoso no cuenta: sigue preguntando', d.fuera === 'agotado_largo', d.fuera)
}

console.log('\n=== lo comprometido sale en la frase ===')
{
  const l = plan(entrada({ vendibles: 0, d: 1, llegadas: [llegada(sumarDias(HOY, 7), 3, { origen: 'comprometido', remesaId: 'r9', nombre: 'Reposición de octubre' })] }))
  ok('«tiene 0, nada de camino y 3 en «Reposición de octubre» (sin salir…)»', /tiene 0, nada de camino y 3 en «Reposición de octubre» \(sin salir, llegarían ~\d+ \w{3}\)/.test(l.porque), l.porque)
  // Ya no sugiere «añádelo ahí» (convertir crea otra remesa; el aviso de las remesas sin salir va en el envío): dice cuánto mandar y hasta cuándo cubre
  if (l.cantidad > 0) ok('y dice cuánto mandar y hasta cuándo cubre', /Mandando [\d.,]+ ud antes del .+ cubres/.test(l.porque) && !/añádelo ahí/.test(l.porque), l.porque)
}

console.log('\n=== ajustarPorModelo: la frase dice la cantidad final y no pasa del tope ===')
{
  const talla = (t: string, cantidad: number, tope: number) => ({
    ...plan(entrada({ sku: `M3-${t}`, modelo: 'M3', talla: t, vendibles: 0, d: 0.3, ritmo: ritmoBase(0.3, { origen: 'modelo', confianza: 'media' }) })),
    cantidad, tope, caja: { unidades: 8, origen: 'deducida' as const },
  })
  const dos = [talla('40', 3, 20), talla('41', 3, 20)]
  ok('(las tallas salen con su «Mandando»)', dos.every((l) => /Mandando \d+ ud/.test(l.porque)), dos[0].porque)
  const aj = ajustarPorModelo(dos, ajustesBase())
  const total = aj.reduce((s, l) => s + l.cantidad, 0)
  ok('6 ud en cajas de 8 → 8 (cabe en el tope de 40)', total === 8, aj.map((l) => l.cantidad))
  ok('cada frase lleva su cantidad final', aj.every((l) => l.porque.includes(`Mandando ${l.cantidad} ud`) && /cajas de 8/.test(l.porque)), aj.map((l) => l.porque))
  const justo = ajustarPorModelo([talla('40', 3, 3.5), talla('41', 3, 3.5)], ajustesBase())
  const totalJusto = justo.reduce((s, l) => s + l.cantidad, 0)
  ok('si la caja pasa del tope del modelo (7), no se sube a 8', totalJusto <= 7 && totalJusto > 0, justo.map((l) => [l.cantidad, l.fuera]))
}

console.log('\n=== Una sola cifra tras «Vende» (lo vendido); lo previsto, aparte ===')
{
  const perfil = Array.from({ length: 54 }, () => 1.8)
  const l = plan(entrada({ vendibles: 60, d: 1.5, ritmo: ritmoBase(1.5, { perfilSemanal: perfil, origenPerfil: 'sku', factorEstacional: 1.8 }) }))
  ok('tras «Vende» va el ritmo base (1,5), no el previsto', /^Vende 1[,.]5 ud\/día/.test(l.porque), l.porque)
  ok('el previsto (~2,7) sale como previsión', /se prevén ~2[,.]7 ud\/día las próximas 4 semanas/.test(l.porque), l.porque)
  ok('nunca «Vende 2,7»', !/Vende 2[,.]7/.test(l.porque), l.porque)
  ok('la línea lleva el mismo previsto para la pantalla', Math.abs((l.ritmoPrevisto ?? 0) - 2.7) < 0.01, l.ritmoPrevisto)
}

console.log('\n=== Exceso coherente con la simulación y con un mínimo ===')
{
  // CT93673: 20 ud, 6 ventas en 90 días
  const l = plan(entrada({ vendibles: 20, d: 6 / 90 }))
  ok('20 ud a 0,07/día → exceso', l.fuera === 'exceso', [l.fuera, l.porque])
  ok('el exceso no se rompe ni corre prisa', l.prioridad === 'mas_adelante' && !l.vaTarde && (l.fechaRotura === null || l.fechaRotura > sumarDias(HOY, 90)), [l.prioridad, l.fechaRotura])
  const poco = plan(entrada({ vendibles: 95, d: 1 }))
  ok('sobran ~5 ud (menos de 30 días de ventas y < 5 €/mes) → stock de sobra, sin consejo', poco.fuera === 'stock_de_sobra' && !/promoción|retirada/.test(poco.porque), [poco.fuera, poco.porque])
}

console.log('\n=== D8 · agotada hace poco (pocos días con stock en 90) no es «agotado largo» ===')
{
  // ShoesF FBA939229-38: stock hasta hace 10 días, 3 ventas en 30 días, menos de 12 días con stock en 30 → ninguna ventana
  const r = ritmoBase(0.2, { origen: 'ultimo_periodo', confianza: 'baja', ultimoPeriodoHasta: sumarDias(HOY, -10), r14: null, r30: null, r60: null, r90: null, ventas90: 3, ventas30: 3, ventas180: 5, diasConStock90: 11 })
  const l = plan(entrada({ vendibles: 0, ritmo: r, ventas90: 3 }))
  ok('se propone (no agotado_largo ni sin_datos)', l.fuera === null && l.cantidad > 0, [l.fuera, l.cantidad, l.porque])
  ok('la frase dice de dónde sale el ritmo, sin «mucho tiempo agotada»', /ritmo del periodo hasta el/.test(l.porque) && !/mucho tiempo agotada/.test(l.porque), l.porque)
  // Con algo de camino tampoco dice «tras mucho tiempo agotada»
  const c = plan(entrada({ vendibles: 0, ritmo: r, ventas90: 3, llegadas: [llegada(sumarDias(HOY, 8), 5)] }))
  ok('con 5 de camino no dice «tras mucho tiempo agotada»', !/mucho tiempo agotada/.test(c.porque) && c.fuera !== 'agotado_largo', [c.fuera, c.porque])
  // A los 77 días sí es agotado largo
  const v = plan(entrada({ vendibles: 0, ritmo: { ...r, ultimoPeriodoHasta: sumarDias(HOY, -77) }, ventas90: 3 }))
  ok('agotada hace 77 días → agotado_largo', v.fuera === 'agotado_largo', v.fuera)
  const j = plan(entrada({ vendibles: 0, ritmo: { ...r, ultimoPeriodoHasta: sumarDias(HOY, -76) }, ventas90: 3 }))
  ok('76 días justos aún se planifica', j.fuera !== 'agotado_largo', j.fuera)
}

console.log(`\n${comprobaciones - fallos}/${comprobaciones} bien${fallos ? ` · ${fallos} FALLAN` : ''}`)
if (fallos) process.exit(1)
