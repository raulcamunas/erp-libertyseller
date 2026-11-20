/**
 * Pruebas de las piezas PURAS de aplicar-servidor.ts (la decisión sobre cada propuesta, el orden, el guardarraíl del presupuesto y la clase de los errores).
 *   npx tsx lib/ads/agente/aplicar-servidor.prueba.ts
 */
import {
  datosDelError,
  decidirPropuesta,
  decisionDeReintento,
  decisionDeReactivarCampana,
  mesEnRecorte,
  horasDesde,
  limitarPresupuestoAhora,
  moverSumas,
  ordenarParaAplicar,
  propuestaDeMarca,
  tipoDeFallo,
  type CuentaParaDecidir,
  type DecisionDelAgente,
  type ProductoParaDecidir,
  type PropuestaParaDecidir,
  lecturaDeHoyCompleta,
  type SumasDePresupuesto,
  vigilarReciente,
} from './aplicar-servidor'
import { cvrComoFraccion, cvrDeMetricas } from './efectos-servidor'
import { muestraMinima } from './efectos-calculo'
import { clavesEnCuarentena, textoDeReintento } from '../motor-calculo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.parse('2026-12-10T12:00:00Z')
const hace = (h: number) => new Date(AHORA - h * 3_600_000).toISOString()

const prop = (x: Partial<PropuestaParaDecidir> = {}): PropuestaParaDecidir => ({
  id: 'p1',
  tipo: 'puja',
  asin: 'B0TEST0001',
  termino: 'jamon serrano',
  campaignId: 'c1',
  campaignNombre: 'B0TEST0001 | SKU1 | JAMON | MANUAL AMPLIA',
  haciaCampaignNombre: null,
  motivo: 'Regla de puja',
  // `agente: true`: la marca de filtrarSubidaDelAgente (sin ella, una subida de puja se caduca)
  metricas: { clics: 40, gasto: 20, pedidos: 2, ventas: 80, agente: true },
  objetivoTipo: 'keyword',
  valorActual: 1,
  valorNuevo: 1.15,
  iaDecision: null,
  iaMotivo: null,
  creadaAt: hace(2),
  ...x,
})

const CUENTA: CuentaParaDecidir = {
  ahora: AHORA,
  rampa: { soloBajadas: false, sinPresupuestoSubir: false },
  cuentaPequena: false,
  ritmoRecorte: false,
  techoNulo: false,
  eventoPosterior: null,
  topePuja: 3,
}

const PROD: ProductoParaDecidir = {
  postura: 'mantener',
  soloDefensivo: false,
  marca: 'Hammaster',
  fase: 'normal',
  gasto30: 500,
  stock: 300,
  coberturaDias: 40,
  acosObjetivoPct: 25,
  precio: 40,
}

const SIN = { termino: null, pujaLeida: null, campanasConUbicacionAlta: [] as string[] }
const esAplicar = (d: DecisionDelAgente): d is Extract<DecisionDelAgente, { accion: 'aplicar' }> => d.accion === 'aplicar'

console.log('\n=== una subida de puja normal ===')
{
  const d = decidirPropuesta(prop(), CUENTA, PROD, SIN)
  ok('se aplica como puja_subir', esAplicar(d) && d.clase === 'puja_subir', JSON.stringify(d))
  ok('sin cambio de valor', esAplicar(d) && d.valorNuevo === null && d.nota === null)
}

console.log('\n=== subidas frenadas: pasajeras se caducan (postura, stock, ritmo, techo, evento), de persona se retienen (defensivo, marca) ===')
{
  const r = (c: Partial<CuentaParaDecidir>, p: Partial<ProductoParaDecidir> = {}, x: Partial<PropuestaParaDecidir> = {}) => decidirPropuesta(prop(x), { ...CUENTA, ...c }, { ...PROD, ...p }, SIN)
  ok('postura recortar → caducar (pasajero: no bloquea la segmentación 14 días)', r({}, { postura: 'recortar' }).accion === 'caducar')
  ok('ritmo recorte → caducar', r({ ritmoRecorte: true }).accion === 'caducar')
  const sinStock = r({}, { postura: 'crecer', stock: 0, coberturaDias: 0 })
  ok('stock 0 con postura guardada «crecer» → puja_subir caducada', sinStock.accion === 'caducar' && /sin stock/.test((sinStock as { motivo: string }).motivo), JSON.stringify(sinStock))
  ok('cobertura 3 días con postura «crecer» → caducar', r({}, { postura: 'crecer', stock: 10, coberturaDias: 3 }).accion === 'caducar')
  ok('stock 0: una bajada sí se aplica', r({}, { postura: 'crecer', stock: 0, coberturaDias: 0 }, { valorNuevo: 0.9 }).accion === 'aplicar')
  ok('solo defensivo → retener', r({}, { soloDefensivo: true }).accion === 'retener')
  ok('término de marca → retener', r({}, {}, { termino: 'jamon hammaster' }).accion === 'retener')
  ok('campaña DEFENSA → retener', r({}, {}, { campaignNombre: 'B0TEST0001 | SKU1 | JAMON | DEFENSA' }).accion === 'retener')
  ok('techo nulo → caducar', r({ techoNulo: true }).accion === 'caducar')
  ok('7 días tras un evento → caducar', r({ eventoPosterior: 'Black Friday + Cyber Monday' }).accion === 'caducar')
  const m = r({ ritmoRecorte: true, techoNulo: true })
  ok('el motivo dice todas las razones', m.accion === 'caducar' && /recorte/.test(m.motivo) && /techo/.test(m.motivo), JSON.stringify(m))
  const mixta = r({ ritmoRecorte: true }, { soloDefensivo: true })
  ok('pasajera + de persona (defensivo) → retener, con las dos razones', mixta.accion === 'retener' && /recorte/.test(mixta.motivo) && /defensivo/.test(mixta.motivo), JSON.stringify(mixta))
  ok('una subida que viene de un reintento y se caducaría → se retiene (puede estar en Amazon)', decisionDeReintento(textoDeReintento('Amazon Ads ha contestado 503', 1.15), r({}, { postura: 'recortar' })).accion === 'retener')
  ok('rampa en solo bajadas → ESPERA (no retiene)', r({ rampa: { soloBajadas: true, sinPresupuestoSubir: true } }).accion === 'esperar')
  ok('una bajada con postura recortar se aplica', r({}, { postura: 'recortar' }, { valorNuevo: 0.9 }).accion === 'aplicar')
  ok('una bajada en rampa de solo bajadas se aplica', r({ rampa: { soloBajadas: true, sinPresupuestoSubir: true } }, {}, { valorNuevo: 0.9 }).accion === 'aplicar')
}

console.log('\n=== una subida caducada por «recortar» vuelve cuando el producto pasa a «crecer» ===')
{
  // Día 1: el producto está en «recortar» → la subida se caduca (no se retiene: no se queda pendiente bloqueando la segmentación)
  const dia1 = decidirPropuesta(prop(), CUENTA, { ...PROD, postura: 'recortar' }, SIN)
  ok('con «recortar» la subida se caduca', dia1.accion === 'caducar' && /recortar/.test(dia1.motivo), JSON.stringify(dia1))
  // La fila queda «caducada»: la cuarentena de la generación no la cuenta (si siguiera pendiente-retenida, sí, y bloquearía 14 días)
  const desde = new Date(AHORA - 14 * 86_400_000).toISOString()
  const caducada = [{ campaign_id: 'c1', termino: 'jamon serrano', tipo: 'puja', estado: 'caducada', resuelta_at: new Date(AHORA).toISOString() }]
  const retenida = [{ campaign_id: 'c1', termino: 'jamon serrano', tipo: 'puja', estado: 'pendiente', resuelta_at: null }]
  ok('la caducada no está en la cuarentena: la generación siguiente la vuelve a proponer', clavesEnCuarentena(caducada, desde).size === 0)
  ok('(una retenida pendiente sí lo estaría)', clavesEnCuarentena(retenida, desde).size === 1)
  // Día 2: la misma subida, propuesta de nuevo con el producto en «crecer» → se aplica
  const dia2 = decidirPropuesta(prop({ id: 'p1b' }), CUENTA, { ...PROD, postura: 'crecer' }, SIN)
  ok('con «crecer» la nueva propuesta se aplica', dia2.accion === 'aplicar', JSON.stringify(dia2))
}

console.log('\n=== pausas por stock: solo con el producto a 0 y la decisión reciente ===')
{
  const pausaStock = (x: Partial<PropuestaParaDecidir> = {}) =>
    prop({ tipo: 'pausar-campana', termino: 'B0TEST0001 | SKU1 | JAMON | MANUAL AMPLIA', objetivoTipo: null, valorActual: null, valorNuevo: null, metricas: { clics: 0, gasto: 0, pedidos: 0, ventas: 0, stock: 0, origenAgente: 'stock' }, ...x })
  const a = decidirPropuesta(pausaStock(), CUENTA, { ...PROD, stock: 12, coberturaDias: 5 }, SIN)
  ok('pausa de campaña por stock con stock > 0 → caducar', a.accion === 'caducar' && /stock/.test(a.motivo), JSON.stringify(a))
  const b = decidirPropuesta(pausaStock({ tipo: 'pausar', objetivoTipo: 'anuncio' }), CUENTA, { ...PROD, stock: 3, coberturaDias: 1 }, SIN)
  ok('pausa de anuncio por stock con stock > 0 → caducar', b.accion === 'caducar', JSON.stringify(b))
  const c = decidirPropuesta(pausaStock({ creadaAt: hace(13) }), CUENTA, { ...PROD, stock: 0, coberturaDias: 0 }, SIN)
  ok('pausa por stock de hace 13 h (aún a 0) → caducar (vigilar la vuelve a proponer)', c.accion === 'caducar', JSON.stringify(c))
  const d = decidirPropuesta(pausaStock(), CUENTA, { ...PROD, stock: 0, coberturaDias: 0 }, SIN)
  ok('pausa por stock reciente con stock 0 → aplicar', d.accion === 'aplicar', JSON.stringify(d))
  const e = decidirPropuesta(pausaStock(), CUENTA, null, SIN)
  ok('pausa por stock reciente sin datos del producto → aplicar (la decisión de vigilar ya miró el listado)', e.accion === 'aplicar', JSON.stringify(e))
  const f = decisionDeReintento(textoDeReintento('fetch failed', null), decidirPropuesta(pausaStock(), CUENTA, { ...PROD, stock: 12 }, SIN))
  ok('pausa por stock que falló por la red y ya hay stock → se retiene (puede estar pausada en Amazon)', f.accion === 'retener', JSON.stringify(f))
}

console.log('\n=== presupuestos ===')
{
  const pres = (x: Partial<PropuestaParaDecidir> = {}) =>
    prop({ tipo: 'presupuesto', termino: 'B0TEST0001 | SKU1 | JAMON | MANUAL AMPLIA', objetivoTipo: null, valorActual: 20, valorNuevo: 24, metricas: { clics: 0, gasto: 0, pedidos: 0, ventas: 0, regla: 'R1' }, ...x })
  ok('subida de presupuesto sin restricciones → aplicar', decidirPropuesta(pres(), CUENTA, PROD, SIN).accion === 'aplicar')
  ok('en días 2–3 de la rampa la subida de presupuesto espera', decidirPropuesta(pres(), { ...CUENTA, rampa: { soloBajadas: false, sinPresupuestoSubir: true } }, PROD, SIN).accion === 'esperar')
  ok('cuenta pequeña → caducar la subida de presupuesto', decidirPropuesta(pres(), { ...CUENTA, cuentaPequena: true }, PROD, SIN).accion === 'caducar')
  const donante = decidirPropuesta(pres({ valorNuevo: 15, metricas: { clics: 0, gasto: 5, pedidos: 0, ventas: 0, regla: 'donante' } }), CUENTA, PROD, SIN)
  const r4 = decidirPropuesta(pres({ id: 'p2', valorNuevo: 15, metricas: { clics: 0, gasto: 50, pedidos: 0, ventas: 0, regla: 'R4' } }), CUENTA, PROD, SIN)
  ok('la bajada de un donante va antes que otra bajada', esAplicar(donante) && esAplicar(r4) && donante.orden < r4.orden)
  const s: SumasDePresupuesto = { sumaUtil: 30, sumaActual: 40, suma7: 40, techoMes: 1216, sumaInicio: 60, campanas: new Map([['c1', { presupuesto: 20, max14: null }]]) }
  // tope útil = 1216 / 30,4 × 1,1 × 1,3 = 57,2 → margen 27,2; tope real = max(44, 60 al encender) → margen 20; topeSemana = 52 → margen 12
  const sinInicio = limitarPresupuestoAhora(20, 35, { ...s, sumaInicio: null })
  ok('sin la suma al encender, la suma REAL no pasa de techo ÷ 30,4 × 1,1 = 44: +4 (24)', 'valor' in sinInicio && sinInicio.valor === 24 && /de hoy/.test(sinInicio.nota ?? ''), JSON.stringify(sinInicio))
  const g = limitarPresupuestoAhora(20, 24, s)
  ok('cabe entera', 'valor' in g && g.valor === 24 && g.nota === null, JSON.stringify(g))
  const g2 = limitarPresupuestoAhora(20, 35, s)
  ok('se recorta a lo que cabe (+12, lo que deja la semana)', 'valor' in g2 && g2.valor === 32 && !!g2.nota, JSON.stringify(g2))
  const g3 = limitarPresupuestoAhora(20, 24, { ...s, techoMes: null })
  ok('sin techo no sube', 'retener' in g3)
  moverSumas(s, 'c1', 20, 32)
  ok('aplicar mueve las sumas', s.sumaActual === 52 && s.sumaUtil === 42, JSON.stringify({ a: s.sumaActual, u: s.sumaUtil }))
  const g4 = limitarPresupuestoAhora(20, 24, s)
  ok('y la siguiente subida ya no cabe', 'retener' in g4, JSON.stringify(g4))
  // Una subida por encima de 1,3 × su máximo de 14 días cuenta entera en la suma útil (dos subidas no usan el mismo hueco)
  const s2: SumasDePresupuesto = { sumaUtil: 30, sumaActual: 40, suma7: null, techoMes: 1216, campanas: new Map([['c2', { presupuesto: 20, max14: 10 }]]) }
  moverSumas(s2, 'c2', 20, 26)
  ok('subida sobre 1,3 × máximo: la suma útil sube lo mismo que el presupuesto (+6)', s2.sumaUtil === 36, JSON.stringify(s2.sumaUtil))
  moverSumas(s2, 'c2', 26, 20)
  ok('… y una bajada libera solo lo útil (0: seguía por encima de 13)', s2.sumaUtil === 36, JSON.stringify(s2.sumaUtil))

  // Sin lectura de presupuestos de hoy (tras la medianoche local, o vigilar sin campañas): falla cerrado, nunca con sumas a 0
  const vacia: SumasDePresupuesto = { sumaUtil: 0, sumaActual: 0, suma7: 40, techoMes: 1216, campanas: new Map() }
  const g5 = limitarPresupuestoAhora(20, 24, vacia, 'c1')
  ok('sumas vacías → espera (no aplica con todo el techo «libre»)', 'esperar' in g5, JSON.stringify(g5))
  const g6 = limitarPresupuestoAhora(20, 24, { ...vacia, sumaActual: 40, sumaUtil: 30, campanas: new Map([['otra', { presupuesto: 40, max14: null }]]) }, 'c1')
  ok('la campaña no está en la lectura de hoy → espera', 'esperar' in g6, JSON.stringify(g6))
  const fila = (campaignId: string, fechaLocal: string) => ({ campaignId, fechaLocal, presupuesto: 20 }) as unknown as Parameters<typeof lecturaDeHoyCompleta>[0][number]
  ok('lectura de hoy completa (2 de 2 de ayer)', lecturaDeHoyCompleta([fila('a', '2026-12-09'), fila('b', '2026-12-09'), fila('a', '2026-12-10'), fila('b', '2026-12-10')], '2026-12-10'))
  ok('sin filas de hoy (tras la medianoche) → incompleta', !lecturaDeHoyCompleta([fila('a', '2026-12-09'), fila('b', '2026-12-09')], '2026-12-10'))
  ok('menos campañas hoy que ayer → incompleta', !lecturaDeHoyCompleta([fila('a', '2026-12-09'), fila('b', '2026-12-09'), fila('a', '2026-12-10')], '2026-12-10'))
}

console.log('\n=== fallar cerrado sin valores, y sin el gasto de hoy ===')
{
  const pres = (x: Partial<PropuestaParaDecidir> = {}) =>
    prop({ tipo: 'presupuesto', termino: 'B0TEST0001 | SKU1 | JAMON | MANUAL AMPLIA', objetivoTipo: null, valorActual: 20, valorNuevo: 24, metricas: { clics: 0, gasto: 0, pedidos: 0, ventas: 0, regla: 'R1' }, ...x })
  ok('puja sin valor actual → retener (no se salta ±25 % ni la puja máxima)', decidirPropuesta(prop({ valorActual: null, valorNuevo: 2.5, motivo: 'x · Forma reducida: …' }), CUENTA, PROD, SIN).accion === 'retener')
  ok('puja sin valor nuevo → retener', decidirPropuesta(prop({ valorNuevo: null }), CUENTA, PROD, SIN).accion === 'retener')
  ok('presupuesto sin valor actual → retener', decidirPropuesta(pres({ valorActual: null }), CUENTA, PROD, SIN).accion === 'retener')
  const f = decidirPropuesta(prop({ tipo: 'pausar', valorActual: null, valorNuevo: null, metricas: { clics: 60, gasto: 100, pedidos: 0, ventas: 0 }, iaDecision: 'aplicar' }), CUENTA, PROD, { ...SIN, pujaLeida: 0.8 })
  ok('la forma reducida de una pausa guarda la puja leída como valor actual (0,80)', esAplicar(f) && f.tipoNuevo === 'puja' && f.valorActualNuevo === 0.8, JSON.stringify(f))
  const sinGasto = { ...CUENTA, gastoDesconocido: true }
  ok('sin el gasto de hoy (falla la API de uso) una subida de puja ESPERA', decidirPropuesta(prop(), sinGasto, PROD, SIN).accion === 'esperar')
  ok('… y una subida de presupuesto también', decidirPropuesta(pres(), sinGasto, PROD, SIN).accion === 'esperar')
  ok('… pero una bajada se aplica', decidirPropuesta(prop({ valorNuevo: 0.9 }), sinGasto, PROD, SIN).accion === 'aplicar')
}

console.log('\n=== vigilar reciente y CVR de la medición ===')
{
  ok('vigilar bueno hace 20 min → aplica', vigilarReciente(hace(20 / 60), AHORA))
  ok('vigilar bueno hace 50 min → no aplica', !vigilarReciente(hace(50 / 60), AHORA))
  ok('sin sello (recién reanudado o encendido) → no aplica', !vigilarReciente(null, AHORA))
  ok('nunca un vigilar bueno → no aplica', !vigilarReciente(null, AHORA))
  const cvr = cvrDeMetricas({ cvrPct: 0.8 })
  ok('cvrPct 0,8 (%) → 0,008', cvr === 0.008, String(cvr))
  ok('… muestra mínima 250 clics (no 12)', muestraMinima(0, cvr ?? 0) === 250, String(muestraMinima(0, cvr ?? 0)))
  ok('cvrComoFraccion ya no adivina: 8 → null', cvrComoFraccion(8) === null && cvrComoFraccion(0.08) === 0.08)
}

console.log('\n=== guardarraíl de la puja ===')
{
  const d = decidirPropuesta(prop({ valorNuevo: 2 }), CUENTA, PROD, SIN)
  ok('+100 % se recorta a +25 %', esAplicar(d) && d.valorNuevo === 1.25 && /Guardarraíl/.test(d.nota ?? ''), JSON.stringify(d))
  // puja máxima: 40 € × 10 % CVR × 25 % × 1,2 = 1,20
  const d2 = decidirPropuesta(prop({ valorNuevo: 1.25, metricas: { clics: 40, gasto: 20, pedidos: 4, ventas: 160, cvrPct: 10, agente: true } }), CUENTA, PROD, SIN)
  ok('y a la puja máxima (1,20)', esAplicar(d2) && d2.valorNuevo === 1.2, JSON.stringify(d2))
  const d3 = decidirPropuesta(prop({ valorActual: 1.3, valorNuevo: 1.5, metricas: { clics: 40, gasto: 20, pedidos: 4, ventas: 160, cvrPct: 10, agente: true } }), CUENTA, PROD, SIN)
  ok('una subida que ya pasa de la puja máxima se retiene', d3.accion === 'retener', JSON.stringify(d3))
  const d4 = decidirPropuesta(prop({ valorNuevo: 0.5 }), CUENTA, PROD, SIN)
  ok('una bajada del 50 % se queda en −25 %', esAplicar(d4) && d4.clase.startsWith('puja_bajar') && d4.valorNuevo === 0.75, JSON.stringify(d4))
}

console.log('\n=== términos REVISAR ===')
{
  const rev = (x: Partial<PropuestaParaDecidir> = {}) => prop({ tipo: 'negativizar', termino: 'soporte jamonero', valorActual: null, valorNuevo: null, motivo: 'REVISAR: no comparte ninguna palabra', metricas: { clics: 8, gasto: 4, pedidos: 0, ventas: 0, revisar: true }, ...x })
  const V = { pedidosHistoricos: 0, validacionOk: true }
  const a = decidirPropuesta(rev(), CUENTA, PROD, { ...SIN, termino: { etiqueta: { etiqueta: 'otro_producto', confianza: 0.92 }, ...V } })
  ok('otro producto seguro → aplicar en exacta, aprobada por la IA', esAplicar(a) && a.concordanciaExacta && a.iaAprueba && a.clase === 'negativizar', JSON.stringify(a))
  const b = decidirPropuesta(rev(), CUENTA, PROD, { ...SIN, termino: { etiqueta: { etiqueta: 'relevante', confianza: 0.95 }, ...V } })
  ok('relevante seguro → descartar', b.accion === 'descartar')
  const c = decidirPropuesta(rev(), CUENTA, PROD, { ...SIN, termino: { etiqueta: { etiqueta: 'otro_producto', confianza: 0.99 }, pedidosHistoricos: 2, validacionOk: true } })
  ok('ha vendido → retener (lo decide una persona)', c.accion === 'retener' && /Ha vendido/.test(c.motivo))
  const d = decidirPropuesta(rev(), CUENTA, PROD, { ...SIN, termino: { etiqueta: { etiqueta: 'otro_producto', confianza: 0.92 }, pedidosHistoricos: 0, validacionOk: false } })
  ok('IA sin validar → retener con «La IA dice: otro producto (0,92)»', d.accion === 'retener' && d.motivo.startsWith('La IA dice: otro producto (0,92)'), JSON.stringify(d))
  ok('sin etiqueta y < 30 h → esperar', decidirPropuesta(rev(), CUENTA, PROD, { ...SIN, termino: { etiqueta: null, ...V } }).accion === 'esperar')
  ok('sin etiqueta y > 30 h → retener', decidirPropuesta(rev({ creadaAt: hace(31) }), CUENTA, PROD, { ...SIN, termino: { etiqueta: null, ...V } }).accion === 'retener')
  // Falla la lectura de pedidos históricos (null): nunca se negativiza, aunque la IA esté segura
  const e = decidirPropuesta(rev(), CUENTA, PROD, { ...SIN, termino: { etiqueta: { etiqueta: 'otro_producto', confianza: 0.99 }, pedidosHistoricos: null, validacionOk: true } })
  ok('sin poder comprobar si ha vendido → esperar (no aplica la negativa)', e.accion === 'esperar' && /comprobar si el término ha vendido/.test(e.motivo), JSON.stringify(e))
  const f = decidirPropuesta(rev({ creadaAt: hace(31) }), CUENTA, PROD, { ...SIN, termino: { etiqueta: { etiqueta: 'intencion_mala', confianza: 0.99 }, pedidosHistoricos: null, validacionOk: true } })
  ok('y si sigue sin poderse en 30 h → retener', f.accion === 'retener' && /comprobar si el término ha vendido/.test(f.motivo), JSON.stringify(f))
}

console.log('\n=== promover: la puja de partida nunca pasa de la puja máxima ===')
{
  const prom = (metricas: Record<string, unknown>) => prop({ tipo: 'promover', termino: 'jamon iberico', valorActual: null, valorNuevo: null, motivo: 'Cosecha', haciaCampaignNombre: 'B0TEST0001 | SKU1 | JAMON | MANUAL EXACTA', metricas })
  // CPC histórico 4 € (40 € / 10 clics); el tope fijo es 3 y por rentabilidad 40 € × 10 % × 25 % × X
  const a = decidirPropuesta(prom({ clics: 10, gasto: 40, pedidos: 1, ventas: 40, cvrPct: 10 }), CUENTA, PROD, SIN)
  ok('CPC de 4 € → aplicar con pujaMaxima ≤ 3', esAplicar(a) && a.clase === 'promover' && a.pujaMaxima != null && a.pujaMaxima <= 3 && a.pujaMaxima > 0, JSON.stringify(a))
  ok('y lo dice en la nota', esAplicar(a) && /puja máxima/.test(a.nota ?? ''), JSON.stringify(a))
  const b = decidirPropuesta(prom({ clics: 10, gasto: 40, pedidos: 1, ventas: 40 }), { ...CUENTA, topePuja: 1.5 }, PROD, SIN)
  ok('sin CVR: la puja máxima es el tope fijo de la cuenta (1,5)', esAplicar(b) && b.pujaMaxima === 1.5, JSON.stringify(b))
  const c = decidirPropuesta(prom({ clics: 10, gasto: 5, pedidos: 1, ventas: 40 }), CUENTA, PROD, SIN)
  ok('CPC bajo (0,50) → aplicar sin nota de recorte, con su pujaMaxima', esAplicar(c) && c.pujaMaxima != null && !/puja máxima/.test(c.nota ?? ''), JSON.stringify(c))
  const d = decidirPropuesta(prom({ clics: 'x', gasto: 5 }), CUENTA, PROD, SIN)
  ok('sin poder calcular la puja de partida → retener', d.accion === 'retener', JSON.stringify(d))
}

console.log('\n=== raras ===')
{
  // Pausa de algo que gasta el 20 % del producto
  const pausa = (x: Partial<PropuestaParaDecidir> = {}) => prop({ tipo: 'pausar', valorActual: null, valorNuevo: null, metricas: { clics: 60, gasto: 100, pedidos: 0, ventas: 0 }, ...x })
  ok('rara sin decisión de la IA y < 30 h → esperar', decidirPropuesta(pausa(), CUENTA, PROD, SIN).accion === 'esperar')
  ok('rara sin decisión y > 30 h → retener', decidirPropuesta(pausa({ creadaAt: hace(31) }), CUENTA, PROD, SIN).accion === 'retener')
  ok('rara que la IA retiene → retener', decidirPropuesta(pausa({ iaDecision: 'retener', iaMotivo: 'vende' }), CUENTA, PROD, SIN).accion === 'retener')
  const f = decidirPropuesta(pausa({ iaDecision: 'aplicar' }), CUENTA, PROD, { ...SIN, pujaLeida: 0.8 })
  ok('pausa aprobada → bajada de puja del 25 % (0,80 → 0,60)', esAplicar(f) && f.tipoNuevo === 'puja' && f.valorNuevo === 0.6 && f.raraAplicada && f.clase.startsWith('puja_bajar'), JSON.stringify(f))
  ok('sin poder leer la puja → retener', decidirPropuesta(pausa({ iaDecision: 'aplicar' }), CUENTA, PROD, SIN).accion === 'retener')
  const ya = decidirPropuesta(prop({ valorActual: 0.8, valorNuevo: 0.6, motivo: 'x · Forma reducida: en vez de pausar…', metricas: { clics: 60, gasto: 100, pedidos: 6, ventas: 100 } }), CUENTA, PROD, SIN)
  ok('una forma reducida ya hecha no se vuelve a reducir', esAplicar(ya) && ya.valorNuevo === null, JSON.stringify(ya))
  const baja = decidirPropuesta(prop({ valorActual: 1, valorNuevo: 0.75, metricas: { clics: 60, gasto: 30, pedidos: 6, ventas: 150 }, iaDecision: 'aplicar' }), CUENTA, PROD, SIN)
  ok('bajada con 6 pedidos aprobada → como mucho −10 %', esAplicar(baja) && baja.valorNuevo === 0.9 && baja.raraAplicada, JSON.stringify(baja))
  const stock = decidirPropuesta(prop({ tipo: 'pausar', objetivoTipo: 'anuncio', valorActual: null, valorNuevo: null, metricas: { clics: 0, gasto: 900, pedidos: 0, ventas: 0 } }), CUENTA, { ...PROD, stock: 0, coberturaDias: 0 }, SIN)
  ok('una pausa de anuncio por stock no es rara', esAplicar(stock) && stock.clase === 'pausar')
  const camp = decidirPropuesta(prop({ tipo: 'pausar-campana', valorActual: null, valorNuevo: null }), CUENTA, { ...PROD, stock: 0, coberturaDias: 0 }, SIN)
  ok('pausar campaña va la primera', esAplicar(camp) && camp.clase === 'pausar_campana' && camp.orden === 10)
}

console.log('\n=== orden, marca, horas ===')
{
  const o = ordenarParaAplicar([
    { id: 'subir', orden: 60, gasto: 50 },
    { id: 'neg-poco', orden: 20, gasto: 1 },
    { id: 'neg-mucho', orden: 20, gasto: 9 },
    { id: 'pausa', orden: 10, gasto: 0 },
  ])
  ok('por clase y, dentro, más gasto primero', o.map((x) => x.id).join(',') === 'pausa,neg-mucho,neg-poco,subir', o.map((x) => x.id).join(','))
  ok('campaña de destino de marca', propuestaDeMarca({ termino: 'x', campaignNombre: 'a', haciaCampaignNombre: 'B0X | S | R | MARCA' }, null))
  ok('sin marca y sin rol → no', !propuestaDeMarca({ termino: 'jamon', campaignNombre: 'B0X | S | R | MANUAL AMPLIA', haciaCampaignNombre: null }, null))
  ok('horas desde la creación', Math.round(horasDesde(hace(5), AHORA)) === 5)
}

console.log('\n=== subidas sin los frenos del agente o de otro día: se caducan ===')
{
  const pres = (x: Partial<PropuestaParaDecidir> = {}) =>
    prop({ tipo: 'presupuesto', termino: 'B0TEST0001 | SKU1 | JAMON | MANUAL AMPLIA', objetivoTipo: null, valorActual: 20, valorNuevo: 24, metricas: { clics: 0, gasto: 0, pedidos: 0, ventas: 0, regla: 'R1' }, origen: 'agente', ...x })
  const sinMarca = decidirPropuesta(prop({ metricas: { clics: 40, gasto: 20, pedidos: 2, ventas: 80 } }), CUENTA, PROD, SIN)
  ok('subida de puja sin la marca del agente (motor en «aprueba» durante el freno) → caducar', sinMarca.accion === 'caducar', JSON.stringify(sinMarca))
  ok('una BAJADA de puja sin la marca sí sigue', decidirPropuesta(prop({ valorNuevo: 0.85, metricas: { clics: 40, gasto: 20, pedidos: 2, ventas: 80 } }), CUENTA, PROD, SIN).accion === 'aplicar')
  ok('subida de presupuesto del MOTOR (no del agente) → caducar', decidirPropuesta(pres({ origen: 'motor', metricas: { clics: 0, gasto: 0, pedidos: 0, ventas: 0 } }), CUENTA, PROD, SIN).accion === 'caducar')
  const inicioHoy = Date.parse('2026-12-10T00:00:00+01:00')
  const C2 = { ...CUENTA, inicioDelDiaLocal: inicioHoy }
  ok('R1 creada hoy → aplicar', decidirPropuesta(pres({ creadaAt: hace(2) }), C2, PROD, SIN).accion === 'aplicar')
  const vieja = decidirPropuesta(pres({ creadaAt: hace(30) }), C2, PROD, SIN)
  ok('R1 creada ayer (se agotaba entonces, no se sabe hoy) → caducar', vieja.accion === 'caducar' && /otro día/.test(vieja.motivo), JSON.stringify(vieja))
  ok('R1_financiada de ayer → caducar', decidirPropuesta(pres({ creadaAt: hace(30), metricas: { clics: 0, gasto: 0, pedidos: 0, ventas: 0, regla: 'R1_financiada' } }), C2, PROD, SIN).accion === 'caducar')
  ok('R1 de ayer que se quedó esperando por gastoDesconocido → caducar (no se aplica otro día)', decidirPropuesta(pres({ creadaAt: hace(30) }), { ...C2, gastoDesconocido: true }, PROD, SIN).accion === 'caducar')
  ok('una bajada R4 de ayer no caduca', decidirPropuesta(pres({ creadaAt: hace(30), valorNuevo: 15, metricas: { clics: 0, gasto: 5, pedidos: 0, ventas: 0, regla: 'R4' } }), C2, PROD, SIN).accion === 'aplicar')
}

console.log('\n=== errores de Amazon ===')
{
  ok('429 → transporte', tipoDeFallo('Amazon Ads ha contestado 429 a /sp/keywords: Too Many Requests') === 'transporte')
  ok('503 → transporte', tipoDeFallo('Amazon Ads ha contestado 503 a /sp/keywords: ') === 'transporte')
  ok('401 → autorización', tipoDeFallo('Amazon Ads ha contestado 401 a /sp/keywords: Unauthorized') === 'autorizacion')
  ok('400 → validación', tipoDeFallo('Amazon Ads ha contestado 400 a /sp/keywords: bad') === 'validacion')
  ok('207 con DUPLICATE → validación', tipoDeFallo('Amazon no ha creado el elemento (keywords): DUPLICATE_VALUE') === 'validacion')
  ok('207 con otro error → cuenta (autorización)', tipoDeFallo('Amazon no ha creado el elemento (campaigns): INTERNAL_ERROR') === 'autorizacion')
  ok('red caída → transporte', tipoDeFallo('fetch failed') === 'transporte')
  ok('un candado del ERP → validación (no cuenta)', tipoDeFallo('La cuenta no está en modo agente: el agente PPC no aplica nada.') === 'validacion')
  ok('obsoleta → validación', tipoDeFallo('En Amazon ya no está el valor que puso el motor') === 'validacion')
  const e = datosDelError('Amazon Ads ha contestado 422 a /x: {"code":"INVALID_ARGUMENT"}')
  ok('lee el código HTTP y el de Amazon', e.httpStatus === 422 && e.codigo === 'INVALID_ARGUMENT', JSON.stringify(e))
}

console.log('\n=== reactivar una campaña pausada por stock: cabe en la suma de la cuenta ===')
{
  // Techo diario 100 (techo 2.763,64 ÷ 30,4 × 1,1) y suma al encender 100. X (30 €) se pausó por stock (fuera de la suma) y R1 subió Y en 30: la suma vuelve a 100
  const techoMes = Math.round(((100 * 30.4) / 1.1) * 100) / 100
  const llena: SumasDePresupuesto = { sumaUtil: 100, sumaActual: 100, suma7: 100, techoMes, sumaInicio: 100, campanas: new Map([['Y', { presupuesto: 60, max14: null }], ['Z', { presupuesto: 40, max14: null }]]) }
  const r1 = decisionDeReactivarCampana({ campaignId: 'X', presupuesto: 30, enRecorte: false, sumas: llena })
  ok('el hueco lo ocupó R1: reactivar X dejaría la suma en 130 (> 100) → no', 'no' in r1 && /no cabe/.test(r1.no), JSON.stringify(r1))
  const conHueco: SumasDePresupuesto = { ...llena, sumaUtil: 70, sumaActual: 70, campanas: new Map([['Y', { presupuesto: 30, max14: null }], ['Z', { presupuesto: 40, max14: null }]]) }
  ok('sin subidas mientras estuvo pausada (suma 70) → cabe entera, sí', 'ok' in decisionDeReactivarCampana({ campaignId: 'X', presupuesto: 30, enRecorte: false, sumas: conHueco }))
  const parte = decisionDeReactivarCampana({ campaignId: 'X', presupuesto: 30, enRecorte: false, sumas: { ...conHueco, sumaUtil: 85, sumaActual: 85 } })
  ok('cabe solo una parte (15 de 30) → no (no se reactiva a medias)', 'no' in parte, JSON.stringify(parte))
  ok('mes en «recorte» → no, aunque quepa', 'no' in decisionDeReactivarCampana({ campaignId: 'X', presupuesto: 30, enRecorte: true, sumas: conHueco }))
  ok('sin lectura de hoy → no (falla cerrado)', 'no' in decisionDeReactivarCampana({ campaignId: 'X', presupuesto: 30, enRecorte: false, sumas: null }))
  ok('sin presupuesto conocido → no', 'no' in decisionDeReactivarCampana({ campaignId: 'X', presupuesto: null, enRecorte: false, sumas: conHueco }))
  ok('sin techo → no', 'no' in decisionDeReactivarCampana({ campaignId: 'X', presupuesto: 30, enRecorte: false, sumas: { ...conHueco, techoMes: null } }))
  ok('ya cuenta en la suma de hoy → sí (no añade nada)', 'ok' in decisionDeReactivarCampana({ campaignId: 'Y', presupuesto: 60, enRecorte: false, sumas: llena }))
  // El ritmo
  const local = { mes: '2026-12', dia: 10 }
  ok('recorte de este mes → en recorte', mesEnRecorte({ ritmo: 'recorte', ritmoFecha: '2026-12-08', ritmoMesAnterior: null }, local))
  ok('recorte de un mes pasado (sin recalcular) → no', !mesEnRecorte({ ritmo: 'recorte', ritmoFecha: '2026-11-28', ritmoMesAnterior: null }, local))
  ok('mes anterior en recorte, día 2 → en recorte', mesEnRecorte({ ritmo: 'normal', ritmoFecha: '2026-12-02', ritmoMesAnterior: 'recorte' }, { mes: '2026-12', dia: 2 }))
  ok('normal → no', !mesEnRecorte({ ritmo: 'normal', ritmoFecha: '2026-12-08', ritmoMesAnterior: 'normal' }, local))
}

console.log('\n=== REVISAR sin etiqueta de la IA: no se negativiza a ciegas ===')
{
  const rev = (x: Partial<PropuestaParaDecidir> = {}) => prop({ tipo: 'negativizar', termino: 'soporte jamonero', valorActual: null, valorNuevo: null, motivo: 'REVISAR: no comparte ninguna palabra', metricas: { clics: 8, gasto: 4, pedidos: 0, ventas: 0, revisar: true }, ...x })
  const V = { pedidosHistoricos: 0, validacionOk: true }
  const a = decidirPropuesta(rev({ creadaAt: hace(31) }), CUENTA, PROD, { ...SIN, termino: { etiqueta: null, ...V } })
  ok('sin etiqueta y > 30 h → caducar (antes: aplicar «aprobada por la IA»)', a.accion === 'caducar' && /Sin etiqueta de la IA/.test(a.motivo), JSON.stringify(a))
  ok('sin etiqueta y < 30 h → esperar', decidirPropuesta(rev(), CUENTA, PROD, { ...SIN, termino: { etiqueta: null, ...V } }).accion === 'esperar')
  const b = decidirPropuesta(rev({ creadaAt: hace(31) }), CUENTA, PROD, { ...SIN, termino: { etiqueta: null, ...V, etiquetaError: true } })
  ok('falla la LECTURA de la etiqueta y > 30 h → esperar (no caduca ni aplica)', b.accion === 'esperar' && /leer la etiqueta/.test(b.motivo), JSON.stringify(b))
  const c = decidirPropuesta(rev({ creadaAt: hace(31) }), CUENTA, PROD, { ...SIN, termino: { etiqueta: { etiqueta: 'otro_producto', confianza: 0.9 }, ...V } })
  ok('otro producto 0,9 → aplicar con iaAprueba', esAplicar(c) && c.iaAprueba && c.concordanciaExacta, JSON.stringify(c))
  const d = decidirPropuesta(rev({ creadaAt: hace(31) }), CUENTA, PROD, { ...SIN, termino: { etiqueta: null, pedidosHistoricos: 3, validacionOk: true } })
  ok('sin etiqueta pero ha vendido → se sigue descartando', d.accion === 'descartar' && /Ha vendido/.test(d.motivo), JSON.stringify(d))
}

console.log('\n=== stock sin leer o viejo: las subidas esperan; lo demás sigue ===')
{
  const sinLeer = { ...CUENTA, stockSinLeer: true }
  const a = decidirPropuesta(prop(), sinLeer, { ...PROD, stock: null, coberturaDias: null }, SIN)
  ok('falla la lectura del stock → la subida de puja ESPERA', a.accion === 'esperar' && /leer el stock/.test(a.motivo), JSON.stringify(a))
  ok('… y la de presupuesto también', decidirPropuesta(prop({ tipo: 'presupuesto', valorActual: 20, valorNuevo: 24, metricas: { clics: 0, gasto: 5, pedidos: 0, ventas: 0, regla: 'R1' } }), sinLeer, { ...PROD, stock: null }, SIN).accion === 'esperar')
  ok('… pero una bajada se aplica', decidirPropuesta(prop({ valorNuevo: 0.9 }), sinLeer, { ...PROD, stock: null }, SIN).accion === 'aplicar')
  const b = decidirPropuesta(prop(), CUENTA, { ...PROD, stockViejo: true }, SIN)
  ok('stock viejo → la subida espera', b.accion === 'esperar' && /stock se leyó/.test(b.motivo), JSON.stringify(b))
  ok('stock viejo → una bajada se aplica', decidirPropuesta(prop({ valorNuevo: 0.9 }), CUENTA, { ...PROD, stockViejo: true }, SIN).accion === 'aplicar')
  ok('postura «recortar» guardada con el stock sin leer → la subida se caduca igual', decidirPropuesta(prop(), sinLeer, { ...PROD, postura: 'recortar', stock: null }, SIN).accion === 'caducar')
}

if (fallos) {
  console.log(`\n${fallos} FALLO(S)`)
  process.exit(1)
}
console.log('\nTODO BIEN')
