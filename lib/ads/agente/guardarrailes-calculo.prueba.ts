import {
  acuerdoIaPersona,
  clasificarErrorDeAmazon,
  claseDeCambio,
  claseDeTope,
  decisionDeTermino,
  esRara,
  evaluarFreno,
  evaluarFrenos,
  decisionDeReanudar,
  ventasParaFreno,
  formaReducida,
  limitarPuja,
  limitarSubidaDePresupuesto,
  faltaEnSumas,
  topesDeSuma,
  ordenDeAplicar,
  presupuestoUtil,
  quedaTope,
  topesDelDia,
  topesValidos,
  sinSubidasDePresupuesto,
  subidasACaducar,
  clasificarSubidasPendientes,
  datosDelError,
  FRENOS_AUTOMATICOS,
} from './guardarrailes-calculo'
import { textoDeReintento } from '../motor-calculo'
import { TOPES_DE_PARTIDA, limitesDePuja, motivoSinPujaMaxEnMoneda, pujaParaAmazon, type EtiquetaDeTermino } from './tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const J = JSON.stringify

/** GUARDARRAÍLES DEL AGENTE PPC: clases, topes y rampa, puja, presupuesto, rareza, forma reducida, orden, errores de Amazon, freno y términos */

console.log('\n=== clase de cambio ===')
{
  const c = (tipo: string, a: number | null, n: number | null, pedidos = 0) => claseDeCambio({ tipo, valorActual: a, valorNuevo: n, metricas: { pedidos } })
  ok('negativizar', c('negativizar', null, null) === 'negativizar')
  ok('promover', c('promover', null, null) === 'promover')
  ok('pausar', c('pausar', null, null) === 'pausar')
  ok('pausar-campana → pausar_campana', c('pausar-campana', null, null) === 'pausar_campana')
  ok('puja 0,30 → 0,35 = puja_subir', c('puja', 0.3, 0.35) === 'puja_subir')
  ok('puja 0,30 → 0,25 con 2 pedidos = puja_bajar', c('puja', 0.3, 0.25, 2) === 'puja_bajar')
  ok('puja 0,30 → 0,25 sin pedidos = puja_bajar_sin_pedidos', c('puja', 0.3, 0.25, 0) === 'puja_bajar_sin_pedidos')
  ok('puja sin valores = puja_subir (la más vigilada)', c('puja', null, 0.3) === 'puja_subir')
  ok('presupuesto 10 → 12 = presupuesto_subir', c('presupuesto', 10, 12) === 'presupuesto_subir')
  ok('presupuesto 10 → 8 = presupuesto_bajar', c('presupuesto', 10, 8) === 'presupuesto_bajar')
  ok('tipo desconocido = puja_subir', c('otra', null, null) === 'puja_subir')
  ok('claseDeTope: sin pedidos comparte con puja_bajar', claseDeTope('puja_bajar_sin_pedidos') === 'puja_bajar' && claseDeTope('pausar') === 'pausar')
}

console.log('\n=== topes válidos ===')
{
  ok('basura → los de partida', J(topesValidos('x')) === J(TOPES_DE_PARTIDA) && J(topesValidos(null)) === J(TOPES_DE_PARTIDA) && J(topesValidos([1])) === J(TOPES_DE_PARTIDA))
  const t = topesValidos({ negativizar: 300, puja_subir: -4, pausar: '12', promover: 2.6, presupuesto_subir: 'abc', otro: 5 })
  ok('300 → 200, −4 → 0, «12» → 12, 2,6 → 3', t.negativizar === 200 && t.puja_subir === 0 && t.pausar === 12 && t.promover === 3, J(t))
  ok('lo que falta o no es número → partida', t.presupuesto_subir === TOPES_DE_PARTIDA.presupuesto_subir && t.puja_bajar === 20 && !('otro' in t), J(t))
}

console.log('\n=== topes del día (rampa) ===')
{
  const T = TOPES_DE_PARTIDA
  const d = (diaRampa: number | null, extra: Partial<{ enEnsayo: boolean; cuentaPequena: boolean; erroresRecientes: boolean }> = {}) =>
    topesDelDia(T, { enEnsayo: false, diaRampa, cuentaPequena: false, erroresRecientes: false, ...extra })

  const e = d(0, { enEnsayo: true })
  ok('en ensayo: topes completos', J(e.topes) === J(T) && e.factor === 1 && !e.soloBajadas && !e.sinPresupuestoSubir, J(e))
  if (!FRENOS_AUTOMATICOS) {
    // Sin rampa, sin recorte por errores y sin límite por cuenta pequeña (20 nov 2026, Raúl): cuentan solo los topes configurados, desde el primer día
    for (const dia of [0, 1, 3, 6, null]) {
      const r = d(dia)
      ok(`día ${dia ?? 'sin fecha'}: topes completos, sube y sube presupuestos`, r.factor === 1 && !r.soloBajadas && !r.sinPresupuestoSubir && J(r.topes) === J(T), J(r))
    }
    ok('con errores recientes: topes completos', d(6, { erroresRecientes: true }).factor === 1 && J(d(6, { erroresRecientes: true }).topes) === J(T))
    const peq = d(10, { cuentaPequena: true })
    ok('cuenta pequeña: sin recorte (puja_subir y presupuesto_subir los configurados)', peq.topes.puja_subir === T.puja_subir && peq.topes.presupuesto_subir === T.presupuesto_subir && !peq.sinPresupuestoSubir, J(peq))
    ok('un tope 0 sigue en 0', topesDelDia({ ...T, pausar: 0 }, { enEnsayo: false, diaRampa: 0, cuentaPequena: false, erroresRecientes: false }).topes.pausar === 0)
    const r0 = d(0)
    ok('quedaTope: 14 de 15 → sí', quedaTope('negativizar', { negativizar: T.negativizar - 1 }, r0.topes))
    ok('quedaTope: 15 de 15 → no', !quedaTope('negativizar', { negativizar: T.negativizar }, r0.topes))
    ok('quedaTope: sin pedidos cuenta en puja_bajar', !quedaTope('puja_bajar_sin_pedidos', { puja_bajar: T.puja_bajar }, r0.topes))
    ok('quedaTope: subida el día 0 → sí (sin rampa)', quedaTope('puja_subir', {}, r0.topes))
  } else {

    const r0 = d(0)
    ok('día 0: factor 0,25 y solo bajadas', r0.factor === 0.25 && r0.soloBajadas && r0.sinPresupuestoSubir)
    ok('día 0: negativizar 15 → 4, puja_bajar 20 → 5, pausar_campana 3 → 1', r0.topes.negativizar === 4 && r0.topes.puja_bajar === 5 && r0.topes.pausar_campana === 1, J(r0.topes))
    ok('día 0: subidas a 0 (puja_subir, promover, presupuesto_subir)', r0.topes.puja_subir === 0 && r0.topes.promover === 0 && r0.topes.presupuesto_subir === 0, J(r0.topes))

    const r1 = d(1)
    ok('día 1: factor 0,5, sube pujas (8 → 4), sin presupuesto_subir', r1.factor === 0.5 && !r1.soloBajadas && r1.sinPresupuestoSubir && r1.topes.puja_subir === 4 && r1.topes.presupuesto_subir === 0, J(r1))
    ok('día 1: promover 5 → 3 (hacia arriba)', r1.topes.promover === 3)
    const r2 = d(2)
    ok('día 2: sigue al 50 %', r2.factor === 0.5 && r2.sinPresupuestoSubir)

    const r3 = d(3)
    ok('día 3: factor 0,75, presupuesto_subir 3 → 3 (2,25 hacia arriba)', r3.factor === 0.75 && !r3.sinPresupuestoSubir && r3.topes.presupuesto_subir === 3 && r3.topes.negativizar === 12, J(r3))

    const r6 = d(6)
    ok('día 6: topes completos', r6.factor === 1 && J(r6.topes) === J(T), J(r6))
    ok('día 30: topes completos', d(30).factor === 1)
    ok('sin fecha de rampa: completos', d(null).factor === 1 && J(d(null).topes) === J(T))

    const err6 = d(6, { erroresRecientes: true })
    ok('día 6 con errores recientes: máx 0,75 (negativizar 12)', err6.factor === 0.75 && err6.topes.negativizar === 12, J(err6))
    const err0 = d(0, { erroresRecientes: true })
    ok('día 0 con errores: sigue 0,25', err0.factor === 0.25)
    ok('en ensayo con errores: completos (no escribe)', d(0, { enEnsayo: true, erroresRecientes: true }).factor === 1)

    const peq = d(10, { cuentaPequena: true })
    ok('cuenta pequeña: puja_subir ≤ 3, presupuesto_subir 0', peq.topes.puja_subir === 3 && peq.topes.presupuesto_subir === 0 && peq.sinPresupuestoSubir, J(peq))
    ok('cuenta pequeña en ensayo: igual', topesDelDia(T, { enEnsayo: true, diaRampa: null, cuentaPequena: true, erroresRecientes: false }).topes.presupuesto_subir === 0)
    ok('un tope 0 sigue en 0 (no sube al mínimo 1)', topesDelDia({ ...T, pausar: 0 }, { enEnsayo: false, diaRampa: 0, cuentaPequena: false, erroresRecientes: false }).topes.pausar === 0)

    ok('quedaTope: 3 de 4 → sí', quedaTope('negativizar', { negativizar: 3 }, r0.topes))
    ok('quedaTope: 4 de 4 → no', !quedaTope('negativizar', { negativizar: 4 }, r0.topes))
    ok('quedaTope: sin pedidos cuenta en puja_bajar', !quedaTope('puja_bajar_sin_pedidos', { puja_bajar: 5 }, r0.topes))
    ok('quedaTope: subida el día 0 → no', !quedaTope('puja_subir', {}, r0.topes))
  }
}

console.log('\n=== puja ===')
{
  const a = limitarPuja(1, 1.1, 3)
  ok('1,00 → 1,10: sin recortar', a.valor === 1.1 && !a.recortada && !a.descartar, J(a))
  const b = limitarPuja(1, 1.6, 3)
  ok('1,00 → 1,60: recortada a 1,25', b.valor === 1.25 && b.recortada && !b.descartar, J(b))
  const c = limitarPuja(1, 0.4, 3)
  ok('1,00 → 0,40: recortada a 0,75', c.valor === 0.75 && c.recortada && !c.descartar, J(c))
  const r = limitarPuja(0.3, 0.5, 3)
  ok('0,30 → 0,50: 0,37 (redondeo hacia dentro, nunca +25,x %)', r.valor === 0.37 && r.valor / 0.3 - 1 <= 0.25, J(r))
  const m = limitarPuja(1, 1.2, 1.1)
  ok('puja máxima 1,10: 1,00 → 1,20 queda en 1,10', m.valor === 1.1 && m.recortada && !m.descartar, J(m))
  const x = limitarPuja(1, 1.2, 0.9)
  ok('puja máxima por debajo de la actual: la subida se descarta', x.descartar, J(x))
  const igual = limitarPuja(1, 1.2, 1)
  ok('puja máxima = actual: se descarta (ya no sube)', igual.descartar, J(igual))
  const bajaMax = limitarPuja(2, 1.8, 1)
  ok('una bajada no la toca la puja máxima (±25 % manda)', bajaMax.valor === 1.8 && !bajaMax.descartar, J(bajaMax))
  const minimo = limitarPuja(0.02, 0.01, 3)
  ok('nunca < 0,02: 0,02 → 0,01 se descarta (no baja)', minimo.valor === 0.02 && minimo.descartar, J(minimo))
  const min2 = limitarPuja(0.025, 0.01, 3)
  ok('0,025 → 0,01: queda en 0,02', min2.valor === 0.02 && !min2.descartar, J(min2))
  ok('actual 0 o desconocida: se descarta', limitarPuja(0, 0.5, 3).descartar && limitarPuja(NaN, 0.5, 3).descartar)
  ok('sin puja máxima: solo ±25 %', limitarPuja(4, 6, null).valor === 5)
}

console.log('\n=== presupuestos ===')
{
  ok('presupuesto útil: 50 con máx 14 d de 20 → 26', presupuestoUtil(50, 20) === 26)
  ok('presupuesto útil: 20 con máx 14 d de 30 → 20', presupuestoUtil(20, 30) === 20)
  ok('presupuesto útil: sin 14 días → entero', presupuestoUtil(20, null) === 20)

  // techo 1.216 → 40 al día × 1,1 = 44 (tope de la suma REAL); × 1,3 = 57,2 (tope de la suma ÚTIL)
  const base = { actual: 10, nuevo: 12, sumaUtil: 30, sumaActual: 30, techoMes: 1216, suma7: 30 }
  const t = topesDeSuma(base)
  ok('topes: útil 57,2, real 44, semana 39', !!t && Math.abs(t.topeUtil - 57.2) < 1e-9 && Math.abs(t.topeBruto - 44) < 1e-9 && Math.abs(t.topeSemana - 39) < 1e-9, J(t))
  ok('… la suma al encender (60) sube el tope real', topesDeSuma({ ...base, sumaInicio: 60 })?.topeBruto === 60)
  ok('… sin techo, sin topes', topesDeSuma({ ...base, techoMes: null }) === null)
  const a = limitarSubidaDePresupuesto(base)
  ok('cabe entera: 10 → 12', a.valor === 12 && a.hueco === 0 && a.motivo === null, J(a))
  const b = limitarSubidaDePresupuesto({ ...base, nuevo: 20, sumaUtil: 52.2, suma7: null })
  ok('tope útil: caben 5 de 10 → 15 y hueco 5', b.valor === 15 && b.hueco === 5 && /útiles/.test(b.motivo ?? ''), J(b))
  const c = limitarSubidaDePresupuesto({ ...base, sumaUtil: 57 })
  ok('caben 0,20 (< 5 % de 10) → null y hueco 2 (todo)', c.valor === null && c.hueco === 2, J(c))
  const s = limitarSubidaDePresupuesto({ ...base, nuevo: 20, sumaUtil: 20, sumaActual: 36, suma7: 30 })
  ok('topeSemana: 1,3 × 30 = 39 − 36 → caben 3: 13 y hueco 7', s.valor === 13 && s.hueco === 7 && /hace 7 días/.test(s.motivo ?? ''), J(s))
  // La suma REAL también cuenta (no solo la útil): campañas sobredimensionadas cuentan poco en la útil, pero su presupuesto puede gastarse
  const bruta = limitarSubidaDePresupuesto({ ...base, sumaUtil: 30, sumaActual: 43, suma7: null })
  ok('suma real 43 de 44: caben 1 → 11', bruta.valor === 11 && bruta.hueco === 1 && /de hoy \(43\).*44/.test(bruta.motivo ?? ''), J(bruta))
  const llena = limitarSubidaDePresupuesto({ ...base, nuevo: 14, suma7: null, sumaActual: 500, sumaUtil: 30 })
  ok('suma real 500 (útil 30) sin suma al encender → no sube nada', llena.valor === null && llena.hueco === 4, J(llena))
  const deInicio = limitarSubidaDePresupuesto({ ...base, nuevo: 14, suma7: null, sumaActual: 500, sumaUtil: 30, sumaInicio: 600 })
  ok('… la misma con 600 al encender: cabe (el agente no pasa de lo que tenía la persona)', deInicio.valor === 14, J(deInicio))
  const sinTecho = limitarSubidaDePresupuesto({ ...base, techoMes: null })
  ok('sin techo → nada sube', sinTecho.valor === null && sinTecho.hueco === 0 && !!sinTecho.motivo, J(sinTecho))
  const bajada = limitarSubidaDePresupuesto({ ...base, nuevo: 8 })
  ok('una bajada pasa tal cual', bajada.valor === 8 && bajada.hueco === 0)
  // Lo que falta para financiar: si la suma real ya pasa del tope, hay que bajar lo que sobra Y el Δ
  const f = faltaEnSumas({ actual: 20, nuevo: 24, sumaUtil: 30, sumaActual: 50, techoMes: 1216, suma7: null })
  ok('falta en la suma real: 4 + (50 − 44) = 10; en la útil 0', f.semana === 10 && f.suma === 0, J(f))
  ok('… con 50 al encender, solo los 4', faltaEnSumas({ actual: 20, nuevo: 24, sumaUtil: 30, sumaActual: 50, techoMes: 1216, suma7: null, sumaInicio: 50 }).semana === 4)
}

console.log('\n=== rareza ===')
{
  const P = (o: Partial<Parameters<typeof esRara>[0]>) => ({ tipo: 'puja', termino: 'jamon serrano', esAsin: false, valorActual: 1, valorNuevo: 0.8, metricas: { gasto: 5, pedidos: 0 }, campaignId: 'c1', ...o })
  const C = { gastoProducto30: 200, stock: 100, coberturaDias: 30, campanasConUbicacionAlta: ['c9'] as const }
  if (!FRENOS_AUTOMATICOS) {
    // Sin «raras» (20 nov 2026, Raúl): nada espera a la IA por raro; todos los casos que antes lo eran ahora no lo son
    const antes = [
      P({ tipo: 'pausar', metricas: { gasto: 25, pedidos: 0 } }),
      P({ metricas: { gasto: 5, pedidos: 5 } }),
      P({ tipo: 'promover', termino: 'jamon' }),
      P({ tipo: 'negativizar', termino: 'b0abcdefgh', esAsin: true }),
      P({ tipo: 'presupuesto', valorActual: 10, valorNuevo: 14 }),
      P({ valorActual: 1, valorNuevo: 1.1, campaignId: 'c9' }),
    ]
    ok('sin frenos automáticos: nada es raro', antes.every((x) => !esRara(x, C).rara && esRara(x, C).porque === null))
    ok('… ni con stock desconocido', !esRara(P({ tipo: 'presupuesto', valorActual: 10, valorNuevo: 12 }), { ...C, stock: null, coberturaDias: null }).rara)
  } else {
    ok('(a) pausar con 25 de 200 (12,5 %) → rara', esRara(P({ tipo: 'pausar', metricas: { gasto: 25, pedidos: 0 } }), C).rara)
    ok('(a) pausar con 10 de 200 (5 %) → no', !esRara(P({ tipo: 'pausar', metricas: { gasto: 10, pedidos: 0 } }), C).rara)
    ok('(b) bajada con 5 pedidos → rara', esRara(P({ metricas: { gasto: 5, pedidos: 5 } }), C).rara)
    ok('(b) bajada con 4 pedidos → no', !esRara(P({ metricas: { gasto: 5, pedidos: 4 } }), C).rara)
    ok('(c) promover una palabra → rara', esRara(P({ tipo: 'promover', termino: 'jamon' }), C).rara)
    ok('(c) promover dos palabras → no', !esRara(P({ tipo: 'promover', termino: 'jamon serrano' }), C).rara)
    ok('(c) promover un ASIN → no', !esRara(P({ tipo: 'promover', termino: 'b0abcdefgh', esAsin: true }), C).rara)
    ok('(d) negativizar un ASIN → rara', esRara(P({ tipo: 'negativizar', termino: 'b0abcdefgh', esAsin: true }), C).rara)
    ok('(d) negativizar un término → no', !esRara(P({ tipo: 'negativizar' }), C).rara)
    ok('(e) presupuesto sube con 10 días de cobertura → rara', esRara(P({ tipo: 'presupuesto', valorActual: 10, valorNuevo: 12 }), { ...C, coberturaDias: 10 }).rara)
    ok('(e) presupuesto sube con stock desconocido → rara', esRara(P({ tipo: 'presupuesto', valorActual: 10, valorNuevo: 12 }), { ...C, stock: null, coberturaDias: null }).rara)
    ok('(e) presupuesto sube +20 % con 30 días → no', !esRara(P({ tipo: 'presupuesto', valorActual: 10, valorNuevo: 12 }), C).rara)
    ok('(e) presupuesto que BAJA con poca cobertura → no', !esRara(P({ tipo: 'presupuesto', valorActual: 10, valorNuevo: 8 }), { ...C, coberturaDias: 3 }).rara)
    ok('(f) presupuesto +40 % → rara', esRara(P({ tipo: 'presupuesto', valorActual: 10, valorNuevo: 14 }), C).rara)
    ok('(f) presupuesto −40 % → rara', esRara(P({ tipo: 'presupuesto', valorActual: 10, valorNuevo: 6 }), C).rara)
    ok('(f) presupuesto +30 % justo → no', !esRara(P({ tipo: 'presupuesto', valorActual: 10, valorNuevo: 13 }), C).rara)
    ok('(g) puja sube en campaña con ubicación alta → rara', esRara(P({ valorActual: 1, valorNuevo: 1.1, campaignId: 'c9' }), C).rara)
    ok('(g) puja sube en otra campaña → no', !esRara(P({ valorActual: 1, valorNuevo: 1.1 }), C).rara)
    ok('pausar-campana nunca es rara', !esRara(P({ tipo: 'pausar-campana', metricas: { gasto: 999, pedidos: 50 } }), C).rara)
    const dos = esRara(P({ tipo: 'presupuesto', valorActual: 10, valorNuevo: 15 }), { ...C, coberturaDias: 5 })
    ok('varios porqués se juntan', dos.rara && (dos.porque ?? '').includes(' · '), J(dos))
  }
}

console.log('\n=== forma reducida ===')
{
  const f = (tipo: string, a: number | null, n: number | null, pedidos = 0) => formaReducida({ tipo, valorActual: a, valorNuevo: n, metricas: { pedidos } })
  const p = f('pausar', 0.8, null)
  ok('pausa → bajada de puja del 25 % (0,80 → 0,60)', p?.tipo === 'puja' && p.valorNuevo === 0.6, J(p))
  const p2 = f('pausar', null, null)
  ok('pausa sin puja conocida → puja con valor null (se lee en Amazon)', p2?.tipo === 'puja' && p2.valorNuevo === null, J(p2))
  const b = f('puja', 1, 0.6, 7)
  ok('bajada −40 % con 7 pedidos → −10 % (0,90)', b?.valorNuevo === 0.9, J(b))
  const b2 = f('puja', 1, 0.95, 7)
  ok('bajada −5 % con 7 pedidos → igual', b2?.valorNuevo === 0.95, J(b2))
  const s = f('presupuesto', 10, 20)
  ok('presupuesto +100 % → +30 % (13)', s?.tipo === 'presupuesto' && s.valorNuevo === 13, J(s))
  const s2 = f('presupuesto', 10, 5)
  ok('presupuesto −50 % → −30 % (7)', s2?.valorNuevo === 7, J(s2))
  ok('presupuesto +20 % → sin forma reducida', f('presupuesto', 10, 12) === null)
  ok('negativizar → sin forma reducida (tal cual)', f('negativizar', null, null) === null)
  ok('promover → sin forma reducida', f('promover', null, null) === null)
}

console.log('\n=== orden de aplicar ===')
{
  const orden = (['presupuesto_subir', 'promover', 'puja_subir', 'presupuesto_bajar', 'puja_bajar_sin_pedidos', 'pausar', 'negativizar', 'pausar_campana'] as const)
    .map((c) => ({ c, o: ordenDeAplicar(c) }))
    .sort((a, b) => a.o - b.o)
    .map((x) => x.c)
  ok('pausar_campana, negativizar, pausar, bajar puja, bajar presupuesto, subir puja, promover, subir presupuesto',
    J(orden) === J(['pausar_campana', 'negativizar', 'pausar', 'puja_bajar_sin_pedidos', 'presupuesto_bajar', 'puja_subir', 'promover', 'presupuesto_subir']), J(orden))
  ok('donantes antes que las demás bajadas de presupuesto', ordenDeAplicar('presupuesto_bajar', 'donante') < ordenDeAplicar('presupuesto_bajar', 'R4'))
  ok('donantes antes que la subida que financian', ordenDeAplicar('presupuesto_bajar', 'donante') < ordenDeAplicar('presupuesto_subir', 'R1_financiada'))
}

console.log('\n=== errores de Amazon ===')
{
  ok('429 = transporte', clasificarErrorDeAmazon(429, 'THROTTLED', null) === 'transporte')
  ok('500 y 503 = transporte', clasificarErrorDeAmazon(500, null, null) === 'transporte' && clasificarErrorDeAmazon(503, null, null) === 'transporte')
  ok('sin respuesta por tiempo agotado = transporte', clasificarErrorDeAmazon(null, null, 'The operation was aborted due to timeout') === 'transporte')
  ok('sin respuesta y sin nada = transporte', clasificarErrorDeAmazon(null, null, null) === 'transporte')
  ok('401 = autorización', clasificarErrorDeAmazon(401, null, null) === 'autorizacion')
  ok('403 = autorización', clasificarErrorDeAmazon(403, 'ACCESS_DENIED', null) === 'autorizacion')
  ok('400 = validación', clasificarErrorDeAmazon(400, null, 'bad') === 'validacion')
  ok('422 = validación', clasificarErrorDeAmazon(422, null, null) === 'validacion')
  ok('207 con DUPLICATE = validación', clasificarErrorDeAmazon(207, 'DUPLICATE_VALUE', null) === 'validacion')
  ok('207 con INVALID_ARGUMENT = validación', clasificarErrorDeAmazon(207, 'INVALID_ARGUMENT', null) === 'validacion')
  // A13: un error interno de Amazon dentro de un 207 es pasajero (se reintenta), no un acceso revocado
  ok('207 con INTERNAL_ERROR = transporte', clasificarErrorDeAmazon(207, 'INTERNAL_ERROR', null) === 'transporte')
  // A13: los errores por elemento de la v3 llegan en camelCase
  const de207 = (tipo: string, razon = '') => `Amazon no ha creado el elemento (keywords): ${tipo}${razon ? ` (${razon})` : ''}: algo`
  ok('207 throttledError = transporte', clasificarErrorDeAmazon(207, null, de207('throttledError')) === 'transporte')
  ok('207 internalServerError = transporte', clasificarErrorDeAmazon(207, null, de207('internalServerError')) === 'transporte')
  ok('207 rangeError = validación', clasificarErrorDeAmazon(207, null, de207('rangeError', 'TOO_LOW')) === 'validacion')
  ok('207 entityStateError = validación', clasificarErrorDeAmazon(207, null, de207('entityStateError', 'ARCHIVED_ENTITY')) === 'validacion')
  ok('207 entityNotFoundError = validación', clasificarErrorDeAmazon(207, null, de207('entityNotFoundError')) === 'validacion')
  ok('207 duplicateValueError = validación', clasificarErrorDeAmazon(207, null, de207('duplicateValueError')) === 'validacion')
  ok('207 parentEntityError / missingValueError / entityQuotaError = validación', ['parentEntityError', 'missingValueError', 'entityQuotaError', 'malformedValueError'].every((t) => clasificarErrorDeAmazon(207, null, de207(t)) === 'validacion'))
  ok('207 desconocido = transporte (se relee antes de repetir)', clasificarErrorDeAmazon(207, null, de207('otherError')) === 'transporte')
  ok('207 de permisos = autorización', clasificarErrorDeAmazon(207, null, de207('unauthorizedError')) === 'autorizacion')
  ok('207 con respuesta ilegible = transporte', clasificarErrorDeAmazon(200, null, 'Amazon Ads ha contestado 200 a /sp/keywords con una respuesta ilegible de Amazon (no es JSON)') === 'transporte')
  ok('403 sin código = autorización', clasificarErrorDeAmazon(403, null, null) === 'autorizacion')
  ok('«La autorización ya no vale» sin HTTP = autorización', clasificarErrorDeAmazon(null, null, 'La autorización ya no vale: el cliente la ha revocado desde su cuenta de Amazon') === 'autorizacion')
  ok('datosDelError lee el 503 de Login with Amazon', datosDelError('Login with Amazon ha contestado 503 al renovar el token (503): sin detalle').httpStatus === 503)
  ok('datosDelError: un 207 sin «contestado» es 207', datosDelError(de207('rangeError')).httpStatus === 207)
  ok('obsoleta sin estado HTTP = validación', clasificarErrorDeAmazon(null, 'OBSOLETA', 'el valor cambió en Amazon') === 'validacion')
}

console.log('\n=== freno ===')
{
  const ahora = Date.parse('2026-11-20T12:00:00Z')
  const base: Parameters<typeof evaluarFreno>[0] = {
    minutoLocal: 13 * 60,
    gastoHoy: 0,
    proyeccionHoy: 0,
    maximoPosible: 0,
    media7: 90,
    sumaPresupuestosHoy: 100,
    suma7: 100,
    evento: null,
    gasto7Cerrado: 630,
    ventas7Cerrado: 2800,
    acosObjetivoMedio: 25,
    cpaObjetivoMedio: 8,
    acos7Inicio: 24,
    erroresQueCuentan: [],
    ahora,
    horasDesdeRendimiento: 10,
    horasDesdeTerminos: 20,
    horasRetrasoObjetivosDiario: 12,
    horasDesdeStock: 3,
    ventasDiaRecientes: 300,
    ventasDiaAnteriores: 300,
    gasto3: 270,
    ignorar: null,
  }
  ok('cuenta normal → no frena', evaluarFreno(base) === null, J(evaluarFreno(base)))
  if (!FRENOS_AUTOMATICOS) {
    // Sin frenos automáticos (20 nov 2026, Raúl: «que no frene nunca»): nada frena, aunque se cumplan a la vez el gasto disparado, el ACoS, los errores,
    // los datos viejos y las ventas caídas. Los datos viejos y la conexión rota los cubren ahora guardas técnicas que no frenan (guardaDeEscritura)
    const h = (horas: number) => new Date(ahora - horas * 3600_000).toISOString()
    const todoMal = {
      ...base,
      gastoHoy: 120,
      proyeccionHoy: 240,
      maximoPosible: 250,
      sumaPresupuestosHoy: 200,
      suma7: 100,
      gasto7Cerrado: 630,
      ventas7Cerrado: 1400,
      erroresQueCuentan: [{ at: h(1), ok: false }, { at: h(2), ok: false }, { at: h(3), ok: false }],
      horasDesdeRendimiento: 40,
      horasDesdeTerminos: 40,
      horasDesdeStock: 50,
      ventasDiaRecientes: 120,
    }
    ok('sin frenos automáticos: con todo mal a la vez, evaluarFrenos no devuelve nada', evaluarFrenos(todoMal).length === 0, J(evaluarFrenos(todoMal)))
    ok('… y evaluarFreno tampoco', evaluarFreno(todoMal) === null)
    ok('reanudar siempre puede (no queda ningún motivo vigente)', J(decisionDeReanudar(evaluarFrenos(todoMal), false)) === J({ reanudar: true, ignorar: null }))
    const vf = ventasParaFreno(4 * 300, 4 * 300 + 23 * 300)
    ok('ventasParaFreno: medias diarias de 7 y de los 23 anteriores (la sigue usando el panel)', vf.ventasDiaRecientes === 171.43 && vf.ventasDiaAnteriores === 300, J(vf))
    ok('ventasParaFreno sin dato → null', ventasParaFreno(null, 9000).ventasDiaRecientes === null && ventasParaFreno(100, 100).ventasDiaAnteriores === null)
    ok('decisionDeReanudar con dos motivos (lógica pura) → no', !decisionDeReanudar([{ motivo: 'manual', detalle: 'a' }, { motivo: 'datos_viejos', detalle: 'b' }], true).reanudar)
  } else {

    // 5 campañas de 20 €/día (100 €) agotadas a las 13:00; la media de 7 días es 90 €. A las 13:00 la curva dice 50 % → proyección 200, pero el máximo posible es 125
    const agotadas = { ...base, gastoHoy: 100, proyeccionHoy: 200, maximoPosible: 125 }
    ok('5 campañas agotadas a las 13:00 con el presupuesto de siempre NO frenan', evaluarFreno(agotadas) === null, J(evaluarFreno(agotadas)))

    const disparado = { ...base, gastoHoy: 120, proyeccionHoy: 240, maximoPosible: 250, sumaPresupuestosHoy: 200, suma7: 150 }
    const fr = evaluarFreno(disparado)
    ok('gasto disparado: min(240, 250) > 1,6 × 90 → frena', fr?.motivo === 'gasto_disparado', J(fr))
    ok('… antes de las 10:00 locales no', evaluarFreno({ ...disparado, minutoLocal: 9 * 60 }) === null)
    ok('… con media 7 d < 5 no', evaluarFreno({ ...disparado, media7: 4, gasto3: 0, gastoHoy: 30, proyeccionHoy: 60, maximoPosible: 60, sumaPresupuestosHoy: 100, suma7: 100 })?.motivo !== 'gasto_disparado')
    ok('… con gasto de hoy < 20 no', evaluarFreno({ ...disparado, media7: 10, gasto3: 21, gastoHoy: 15 }) === null)
    ok('… durante un evento (2,5×: 220 < 225) no', evaluarFreno({ ...disparado, proyeccionHoy: 220, evento: 'durante' }) === null)

    const suma = evaluarFreno({ ...base, sumaPresupuestosHoy: 170, suma7: 100 })
    ok('suma de presupuestos × 1,7 frena', suma?.motivo === 'gasto_disparado', J(suma))
    ok('suma de presupuestos × 2,4 en evento no frena', evaluarFreno({ ...base, sumaPresupuestosHoy: 240, suma7: 100, evento: 'previo' }) === null)
    ok('evento con gasto 2,4× la media no frena', evaluarFreno({ ...base, evento: 'durante', gastoHoy: 150, proyeccionHoy: 216, maximoPosible: 300 }) === null)
    ok('evento con gasto 2,6× la media sí frena', evaluarFreno({ ...base, evento: 'durante', gastoHoy: 150, proyeccionHoy: 234, maximoPosible: 300 })?.motivo === 'gasto_disparado')
    ok('en la fase posterior el freno vuelve a 1,6×', evaluarFreno({ ...disparado, evento: 'posterior' })?.motivo === 'gasto_disparado')

    // ACoS de la cuenta: objetivo medio 25 → umbral 37,5
    const malo = evaluarFreno({ ...base, gasto7Cerrado: 630, ventas7Cerrado: 1400 })
    ok('ACoS 7 d 45 % (> 1,5 × 25) y peor que al encender → frena', malo?.motivo === 'acos_cuenta', J(malo))
    ok('cuenta que ya iba al 45 % al encender y sigue igual → no frena', evaluarFreno({ ...base, gasto7Cerrado: 630, ventas7Cerrado: 1400, acos7Inicio: 45 }) === null)
    ok('cuenta que iba al 40 % y empeora a 45 % (< 1,25 × 40 = 50) → no frena', evaluarFreno({ ...base, gasto7Cerrado: 630, ventas7Cerrado: 1400, acos7Inicio: 40 }) === null)
    ok('… y a 55 % (> 50) → frena', evaluarFreno({ ...base, gasto7Cerrado: 660, ventas7Cerrado: 1200, acos7Inicio: 40 })?.motivo === 'acos_cuenta')
    // La tolerancia con el arranque malo dura 7 días de activo: después, ACoS 7 d > 1,5 × objetivo frena aunque al encender ya fuera igual
    ok('cuenta al 45 % desde el encendido, 3 días activa → no frena (tolerancia)', evaluarFreno({ ...base, gasto7Cerrado: 630, ventas7Cerrado: 1400, acos7Inicio: 45, diasActivo: 3 }) === null)
    ok('… 8 días activa y sigue al 45 % (> 1,5 × 25 = 37,5) → frena', evaluarFreno({ ...base, gasto7Cerrado: 630, ventas7Cerrado: 1400, acos7Inicio: 45, diasActivo: 8 })?.motivo === 'acos_cuenta')
    ok('… 8 días activa y MEJORA al 40 % (sigue > 37,5) → frena igual', evaluarFreno({ ...base, gasto7Cerrado: 560, ventas7Cerrado: 1400, acos7Inicio: 45, diasActivo: 8 })?.motivo === 'acos_cuenta')
    ok('… 8 días activa al 35 % (< 37,5) → no frena', evaluarFreno({ ...base, gasto7Cerrado: 490, ventas7Cerrado: 1400, acos7Inicio: 45, diasActivo: 8 }) === null)
    ok('… en ensayo (diasActivo null) sigue la tolerancia', evaluarFreno({ ...base, gasto7Cerrado: 630, ventas7Cerrado: 1400, acos7Inicio: 45, diasActivo: null }) === null)
    ok('sin ventas con gasto 7 d de 30 (≥ max(15, 24)) → frena', evaluarFreno({ ...base, gasto7Cerrado: 30, ventas7Cerrado: 0 })?.motivo === 'acos_cuenta')
    ok('sin ventas con gasto 7 d de 20 (< 24 = 3 × CPA) → no', evaluarFreno({ ...base, gasto7Cerrado: 20, ventas7Cerrado: 0 }) === null)
    ok('sin objetivo medio → no', evaluarFreno({ ...base, ventas7Cerrado: 1400, acosObjetivoMedio: null }) === null)

    // Errores
    const h = (horas: number) => new Date(ahora - horas * 3600_000).toISOString()
    ok('3 errores seguidos → frena', evaluarFreno({ ...base, erroresQueCuentan: [{ at: h(1), ok: false }, { at: h(2), ok: false }, { at: h(3), ok: false }, { at: h(4), ok: true }] })?.motivo === 'errores_amazon')
    ok('2 errores y un éxito en medio → no', evaluarFreno({ ...base, erroresQueCuentan: [{ at: h(1), ok: false }, { at: h(2), ok: true }, { at: h(3), ok: false }, { at: h(4), ok: false }] }) === null)
    const cinco = [1, 3, 5, 7, 9].map((x) => ({ at: h(x), ok: false })).concat([2, 4, 6, 8].map((x) => ({ at: h(x), ok: true })))
    ok('5 errores en 24 h (no seguidos) → frena', evaluarFreno({ ...base, erroresQueCuentan: cinco })?.motivo === 'errores_amazon')
    const viejos = [1, 3, 30, 31, 32].map((x) => ({ at: h(x), ok: false })).concat([2, 29].map((x) => ({ at: h(x), ok: true })))
    ok('5 errores pero solo 2 en 24 h → no', evaluarFreno({ ...base, erroresQueCuentan: viejos }) === null)

    // Datos viejos
    ok('rendimiento de hace 40 h → datos_viejos', evaluarFreno({ ...base, horasDesdeRendimiento: 40 })?.motivo === 'datos_viejos')
    ok('términos de hace 37 h → datos_viejos', evaluarFreno({ ...base, horasDesdeTerminos: 37 })?.motivo === 'datos_viejos')
    ok('objetivos diarios con 40 h de retraso → datos_viejos', evaluarFreno({ ...base, horasRetrasoObjetivosDiario: 40 })?.motivo === 'datos_viejos')
    ok('stock de hace 50 h → datos_viejos', evaluarFreno({ ...base, horasDesdeStock: 50 })?.motivo === 'datos_viejos')
    ok('stock de hace 40 h → no (el límite es 48)', evaluarFreno({ ...base, horasDesdeStock: 40 }) === null)
    ok('sin datos (null) → no frena', evaluarFreno({ ...base, horasDesdeRendimiento: null, horasDesdeTerminos: null, horasRetrasoObjetivosDiario: null, horasDesdeStock: null }) === null)

    // Ventas caídas: media diaria de 7 días cerrados frente a la de los 23 anteriores (umbral 0,7), con el gasto de 3 días cerrados de verdad
    const caidas = evaluarFreno({ ...base, ventasDiaRecientes: 120 })
    ok('ventas totales 120/día frente a 300 con gasto normal → ventas_caidas', caidas?.motivo === 'ventas_caidas' && /Buy Box/.test(caidas.detalle), J(caidas))
    ok('… el detalle nombra la ventana real (7 días y 23 anteriores), no «3 días»', !!caidas && /7 días cerrados/.test(caidas.detalle) && /23 anteriores/.test(caidas.detalle) && !/^3 días/.test(caidas.detalle), J(caidas))
    ok('… con el gasto de 3 días también caído (no es la ficha) → no', evaluarFreno({ ...base, ventasDiaRecientes: 120, gasto3: 150 }) === null)
    ok('… a 220/día (> 0,7 × 300 = 210) → no', evaluarFreno({ ...base, ventasDiaRecientes: 220 }) === null)
    ok('… a 200/día (< 210) → frena', evaluarFreno({ ...base, ventasDiaRecientes: 200 })?.motivo === 'ventas_caidas')
    // Ficha suprimida hace 3 días: 4 días normales (300) + 3 a cero en la ventana de 7; los 23 anteriores a 300
    const vf = ventasParaFreno(4 * 300, 4 * 300 + 23 * 300)
    ok('ventasParaFreno: medias diarias de 7 y de los 23 anteriores', vf.ventasDiaRecientes === 171.43 && vf.ventasDiaAnteriores === 300, J(vf))
    ok('ficha suprimida hace 3 días (0,57 de lo normal) → frena ya (con 0,5 llegaba 1–2 días tarde)', evaluarFreno({ ...base, ...vf })?.motivo === 'ventas_caidas')
    ok('ventasParaFreno sin dato → null', ventasParaFreno(null, 9000).ventasDiaRecientes === null && ventasParaFreno(100, 100).ventasDiaAnteriores === null)

    // Ignorado
    const ign = { ...base, ventasDiaRecientes: 120, ignorar: { motivo: 'ventas_caidas' as const, hasta: new Date(ahora + 3600_000).toISOString() } }
    ok('motivo ignorado hasta dentro de 1 h → no frena', evaluarFreno(ign) === null)
    ok('ignorado caducado → frena', evaluarFreno({ ...ign, ignorar: { motivo: 'ventas_caidas', hasta: new Date(ahora - 1000).toISOString() } })?.motivo === 'ventas_caidas')
    ok('ignorar un motivo no tapa otro', evaluarFreno({ ...ign, horasDesdeRendimiento: 40 })?.motivo === 'datos_viejos')

    // Reanudar: TODOS los motivos vigentes, no solo el primero
    const dos = { ...base, sumaPresupuestosHoy: 170, suma7: 100, horasDesdeRendimiento: 40 }
    const todos = evaluarFrenos(dos)
    ok('evaluarFrenos devuelve los dos (gasto disparado y datos viejos), en orden', todos.length === 2 && todos[0].motivo === 'gasto_disparado' && todos[1].motivo === 'datos_viejos', J(todos))
    ok('evaluarFreno sigue siendo el primero', evaluarFreno(dos)?.motivo === 'gasto_disparado')
    const ignGasto = { motivo: 'gasto_disparado' as const, hasta: new Date(ahora + 3600_000).toISOString() }
    ok('con el gasto ignorado, queda datos_viejos', evaluarFrenos({ ...dos, ignorar: ignGasto }).map((f) => f.motivo).join() === 'datos_viejos')
    ok('reanudar sin motivos → sí, sin ignorar', J(decisionDeReanudar([], false)) === J({ reanudar: true, ignorar: null }))
    const uno = decisionDeReanudar(evaluarFrenos({ ...base, horasDesdeRendimiento: 40 }), false)
    ok('reanudar con un motivo sin pedir ignorarlo → no, y ofrece ignorarlo', !uno.reanudar && uno.puedeIgnorar && uno.motivo === 'datos_viejos', J(uno))
    const unoIgn = decisionDeReanudar(evaluarFrenos({ ...base, horasDesdeRendimiento: 40 }), true)
    ok('reanudar con un motivo pidiendo ignorarlo → sí, ignora ese', unoIgn.reanudar && unoIgn.ignorar === 'datos_viejos', J(unoIgn))
    const dosIgn = decisionDeReanudar(todos, true)
    ok('reanudar con DOS motivos aunque pida ignorar → no (solo se ignora uno; el otro dejaría escribir)', !dosIgn.reanudar && !dosIgn.puedeIgnorar && /2 motivos/.test(dosIgn.error), J(dosIgn))
  }
}

console.log('\n=== términos REVISAR ===')
{
  const V = { pedidosHistoricos: 0, validacionOk: true }
  ok('término con pedidos → retener (aunque la IA diga otro producto)', decisionDeTermino({ etiqueta: 'otro_producto', confianza: 0.99 }, 1, { ...V, pedidosHistoricos: 1 }) === 'retener')
  ok('validación sin 50 → retener', decisionDeTermino({ etiqueta: 'otro_producto', confianza: 0.92 }, 1, { ...V, validacionOk: false }) === 'retener')
  ok('otro_producto 0,92 → aplicar', decisionDeTermino({ etiqueta: 'otro_producto', confianza: 0.92 }, 1, V) === 'aplicar')
  ok('intencion_mala 0,85 → aplicar', decisionDeTermino({ etiqueta: 'intencion_mala', confianza: 0.85 }, 1, V) === 'aplicar')
  ok('otro_producto 0,80 con 5 h → esperar', decisionDeTermino({ etiqueta: 'otro_producto', confianza: 0.8 }, 5, V) === 'esperar')
  ok('otro_producto 0,80 con 31 h → retener', decisionDeTermino({ etiqueta: 'otro_producto', confianza: 0.8 }, 31, V) === 'retener')
  ok('relevante 0,90 → descartar', decisionDeTermino({ etiqueta: 'relevante', confianza: 0.9 }, 1, V) === 'descartar')
  ok('marca_ajena 0,95 con 31 h → retener', decisionDeTermino({ etiqueta: 'marca_ajena', confianza: 0.95 }, 31, V) === 'retener')
  ok('dudoso con 2 h → esperar', decisionDeTermino({ etiqueta: 'dudoso', confianza: 0.95 }, 2, V) === 'esperar')
  ok('sin etiqueta y < 30 h → esperar', decisionDeTermino(null, 10, V) === 'esperar')
  ok('sin etiqueta y > 30 h → retener', decisionDeTermino(null, 31, V) === 'retener')

  const filas = (n: number, acuerdo: number) => Array.from({ length: n }, (_, i) => (i < acuerdo
    ? { etiqueta: (i % 2 ? 'otro_producto' : 'relevante') as EtiquetaDeTermino, resultado: (i % 2 ? 'aplicada' : 'descartada') as 'aplicada' | 'descartada' }
    : { etiqueta: 'otro_producto' as EtiquetaDeTermino, resultado: 'descartada' as const }))
  const a = acuerdoIaPersona(filas(50, 40))
  ok('50 resueltas con 40 de acuerdo (80 %) → validada', a.resueltas === 50 && a.deAcuerdo === 40 && a.ok, J(a))
  ok('50 con 39 de acuerdo → no', !acuerdoIaPersona(filas(50, 39)).ok)
  ok('49 con 49 de acuerdo → no (faltan muestras)', !acuerdoIaPersona(filas(49, 49)).ok)
  ok('intencion_mala aplicada = de acuerdo; relevante aplicada = no', acuerdoIaPersona([{ etiqueta: 'intencion_mala', resultado: 'aplicada' }, { etiqueta: 'relevante', resultado: 'aplicada' }]).deAcuerdo === 1)
  ok('sin filas → 0 y no validada', J(acuerdoIaPersona([])) === J({ resueltas: 0, deAcuerdo: 0, ok: false }))
}

console.log('\n=== al frenar o reanudar: nada que suba ===')
{
  const ps = [
    { id: 'r1', tipo: 'presupuesto', valorActual: 20, valorNuevo: 24 },
    { id: 'r4', tipo: 'presupuesto', valorActual: 50, valorNuevo: 15 },
    { id: 'st', tipo: 'pausar-campana', valorActual: null, valorNuevo: null },
  ]
  const q = sinSubidasDePresupuesto(ps).map((p) => p.id)
  ok('el freno salta en la pasada: la R1 no se inserta; la bajada y la pausa sí', q.join(',') === 'r4,st', q.join(','))
  const filas = [
    { id: 'pujaSube', tipo: 'puja', origen: 'motor', valor_actual: 1, valor_nuevo: 1.2 },
    { id: 'pujaBaja', tipo: 'puja', origen: 'motor', valor_actual: 1, valor_nuevo: 0.8 },
    { id: 'presMotorBaja', tipo: 'presupuesto', origen: 'motor', valor_actual: 30, valor_nuevo: 20 },
    { id: 'presAgenteSube', tipo: 'presupuesto', origen: 'agente', valor_actual: 20, valor_nuevo: 24 },
    { id: 'presAgenteBaja', tipo: 'presupuesto', origen: 'agente', valor_actual: 50, valor_nuevo: 15 },
    { id: 'promover', tipo: 'promover', origen: 'motor', valor_actual: null, valor_nuevo: null },
    { id: 'pujaSinValor', tipo: 'puja', origen: 'motor', valor_actual: null, valor_nuevo: 1 },
    { id: 'neg', tipo: 'negativizar', origen: 'motor', valor_actual: null, valor_nuevo: null },
  ]
  const c = new Set(subidasACaducar(filas))
  ok('caducan: puja que sube, presupuesto que sube, presupuesto del motor, promover y la puja sin valores', ['pujaSube', 'presMotorBaja', 'presAgenteSube', 'promover', 'pujaSinValor'].every((id) => c.has(id)), [...c].join(','))
  ok('se quedan: bajada de puja, bajada de presupuesto del agente y negativas', !c.has('pujaBaja') && !c.has('presAgenteBaja') && !c.has('neg'), [...c].join(','))

  // Una subida que falló por la red y volvió a pendiente (puede estar YA escrita en Amazon): nunca se caduca, se retiene para una persona
  const conReintento = [
    { id: 'pujaReintento', tipo: 'puja', origen: 'motor', valor_actual: 1, valor_nuevo: 1.2, error: textoDeReintento('Amazon Ads ha contestado 503 a PUT /sp/keywords', 1.2) },
    { id: 'presReintento', tipo: 'presupuesto', origen: 'agente', valor_actual: 20, valor_nuevo: 24, error: textoDeReintento('fetch failed', 24) },
    { id: 'pujaNormal', tipo: 'puja', origen: 'motor', valor_actual: 1, valor_nuevo: 1.2, error: null },
    { id: 'bajadaReintento', tipo: 'puja', origen: 'motor', valor_actual: 1, valor_nuevo: 0.8, error: textoDeReintento('timeout', 0.8) },
  ]
  const k = clasificarSubidasPendientes(conReintento)
  ok('una subida pendiente con error de reintento NO se caduca', !k.caducar.includes('pujaReintento') && !k.caducar.includes('presReintento'), J(k))
  ok('… se retiene para una persona', k.retener.includes('pujaReintento') && k.retener.includes('presReintento') && k.retener.length === 2, J(k))
  ok('una subida sin reintento se caduca como siempre', k.caducar.includes('pujaNormal'), J(k))
  ok('una bajada en reintento ni se caduca ni se retiene (se queda y se reintenta)', !k.caducar.includes('bajadaReintento') && !k.retener.includes('bajadaReintento'), J(k))
  ok('subidasACaducar tampoco las caduca', !subidasACaducar(conReintento).includes('pujaReintento'))
}

console.log('\n=== límites de puja por moneda (A32) ===')
{
  ok('EUR → 0,02 / 2', J(limitesDePuja('EUR')) === J({ minima: 0.02, decimales: 2 }))
  ok('MXN → 0,10 / 2 (y en minúsculas)', J(limitesDePuja('mxn')) === J({ minima: 0.1, decimales: 2 }))
  ok('moneda sin tabla → null', limitesDePuja('SEK') === null && limitesDePuja(null) === null)
  ok('pujaParaAmazon: redondea a céntimos y nunca baja del mínimo de la moneda', pujaParaAmazon(0.575, 'EUR') === 0.58 && pujaParaAmazon(0.05, 'MXN') === 0.1 && pujaParaAmazon(0.01, 'EUR') === 0.02)
  ok('pujaParaAmazon sin moneda o sin tabla: 0,02 y céntimos de siempre', pujaParaAmazon(0.011) === 0.02 && pujaParaAmazon(1.234, 'SEK') === 1.23)
  ok('limitarPuja: el suelo es el mínimo de la moneda (MXN 0,10)', limitarPuja(0.12, 0.05, null, 'MXN').valor === 0.1, J(limitarPuja(0.12, 0.05, null, 'MXN')))
  ok('limitarPuja sin moneda: el 0,02 de siempre', limitarPuja(0.025, 0.01, null).valor === 0.02)
  ok('encender en EUR sin puja máxima: se puede', motivoSinPujaMaxEnMoneda('EUR', null) === null)
  ok('encender en MXN sin puja máxima: no', /fija la puja máxima en MXN/.test(motivoSinPujaMaxEnMoneda('MXN', null) ?? ''))
  ok('encender en SEK con puja máxima: se puede', motivoSinPujaMaxEnMoneda('SEK', 12) === null)
  ok('moneda desconocida (null): no bloquea', motivoSinPujaMaxEnMoneda(null, null) === null)
}

console.log(fallos ? `\n${fallos} FALLOS\n` : '\nTodo bien\n')
if (fallos) process.exit(1)
