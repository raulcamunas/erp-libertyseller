/** Pruebas del panel «Informes» de Cold Calling: `npx tsx lib/analisis-amazon/panel.prueba.ts` */
import type { EventoDeBitacora } from './almacen'
import { construirPanel, diaMadrid, diasEntre, diasHastaAcabar, estadoDelProceso, finA, leerSaldo, leerTokens, serieDeSaldo, type EntradaDelPanel, type FilaDeCron, type FilaDeInforme } from './panel'
import { ORDEN_DE_COMERCIALES } from './turnos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const cerca = (a: number | null | undefined, b: number, eps = 1e-6) => a != null && Math.abs(a - b) < eps

const [A, M, D, J, N] = ORDEN_DE_COMERCIALES.map((c) => c.id)
const perfiles = [
  { id: A, full_name: 'Alejandro Gil' },
  { id: M, full_name: 'Maoli' },
  { id: D, full_name: 'Daniela' },
  { id: J, full_name: 'José' },
  { id: N, full_name: 'Naomi' },
  { id: 'y', full_name: 'Yarima' },
  { id: 'dd', full_name: 'Daniella ' },
]

console.log('\n=== fechas en Madrid ===')
ok('23:30 UTC del 13 nov es 14 nov en Madrid', diaMadrid('2026-11-13T23:30:00Z') === '2026-11-14')
ok('22:59 UTC del 13 nov sigue siendo 13', diaMadrid('2026-11-13T22:59:00Z') === '2026-11-13')
ok('verano: 22:30 UTC del 1 jul es 2 jul', diaMadrid('2026-07-01T22:30:00Z') === '2026-07-02')
ok('días entre', diasEntre('2026-11-13', '2026-11-16').join(',') === '2026-11-13,2026-11-14,2026-11-15,2026-11-16')

console.log('\n=== saldo en el resumen ===')
ok('lee saldo y umbral', JSON.stringify(leerSaldo('ningún informe nuevo · 13264 en cola (1320 de Amazon, 11944 sin Amazon) · esperando saldo de Keepa (198/280)')) === '{"tokens":198,"umbral":280}')
ok('saldo negativo', leerSaldo('esperando saldo de Keepa (-12/110)')?.tokens === -12)
ok('sin saldo → null', leerSaldo('1 informe (X) · 5 en cola') === null && leerSaldo(null) === null)
ok('tokens', leerTokens('1 informe (X) · 5 en cola · 123 tokens · esperando saldo de Keepa (2/110)') === 123 && leerTokens('nada') === 0)

console.log('\n=== estimaciones ===')
const ahora = Date.parse('2026-11-16T10:00:00Z')
ok('fin a 100/día con 250', finA(ahora, 250, 100) === new Date(ahora + 2.5 * 86_400_000).toISOString())
ok('sin ritmo → null', finA(ahora, 5, 0) === null)
ok('nada pendiente → ahora', finA(ahora, 0, 0) === new Date(ahora).toISOString())
const reparto = diasHastaAcabar(new Map([['a', 10], ['b', 30], ['c', 0]]), 20, 20)!
// a y b a 10/día cada uno: a acaba en 1 día; b tiene 20 más a 20/día → 2 días; el resto (20) uno más → 3
ok('llenado por niveles', cerca(reparto.por.get('a'), 1) && cerca(reparto.por.get('b'), 2) && reparto.por.get('c') === 0, JSON.stringify([...reparto.por]))
ok('los cinco y el resto', cerca(reparto.cinco, 2) && cerca(reparto.resto, 3))
ok('empate', (() => { const r = diasHastaAcabar(new Map([['a', 10], ['b', 10]]), 0, 10)!; return cerca(r.por.get('a'), 2) && cerca(r.por.get('b'), 2) })())
ok('sin ritmo → null', diasHastaAcabar(new Map([['a', 1]]), 0, 0) === null)

console.log('\n=== estado del proceso ===')
const pasada = (minHace: number, resumen: string | null, okk: boolean | null = true, error: string | null = null): FilaDeCron => ({
  iniciado_at: new Date(ahora - minHace * 60_000).toISOString(),
  terminado_at: okk === null ? null : new Date(ahora - minHace * 60_000 + 1000).toISOString(),
  ok: okk,
  resumen,
  error,
  duracion_ms: 1000,
})
const config = { activo: true, cadaMinutos: 1 }
const esperando = estadoDelProceso([pasada(2, 'x · 2 tokens'), pasada(1, 'ningún informe nuevo · esperando saldo de Keepa (198/280)')], config, { tokens: 217, ritmo: 21 }, false, 100, ahora)
ok('esperando saldo, con el saldo de ahora', esperando.estado === 'esperando_saldo' && esperando.saldo === 217 && esperando.umbral === 280 && esperando.minutosParaSiguiente === 3, JSON.stringify(esperando))
ok('motivo legible', esperando.motivo.includes('217 de 280') && esperando.motivo.includes('3 min'), esperando.motivo)
const sinKeepa = estadoDelProceso([pasada(1, 'esperando saldo de Keepa (198/280)')], config, null, false, 100, ahora)
ok('sin Keepa usa el saldo del resumen', sinKeepa.saldo === 198 && sinKeepa.minutosParaSiguiente === null)
ok('parado', estadoDelProceso([pasada(9, 'esperando saldo de Keepa (1/110)')], config, null, false, 100, ahora).estado === 'parado')
ok('sin pasadas = parado', estadoDelProceso([], config, null, false, 100, ahora).estado === 'parado')
ok('apagado manda', estadoDelProceso([pasada(1, 'x')], { activo: false, cadaMinutos: 1 }, null, false, 100, ahora).estado === 'apagado')
const falla = estadoDelProceso([pasada(3, 'esperando saldo de Keepa (1/110)'), pasada(1, null, false, 'Keepa ha contestado HTTP 500')], config, null, false, 100, ahora)
ok('falla con su error', falla.estado === 'falla' && falla.ultimoError?.texto.includes('HTTP 500') === true && falla.fallos24h === 1 && falla.pasadas24h === 2)
ok('colgada > 6 min = falla', estadoDelProceso([pasada(4, null, null)], { activo: true, cadaMinutos: 5 }, null, false, 100, ahora - 3 * 60_000).estado !== 'falla' && estadoDelProceso([pasada(4, null, null)], { activo: true, cadaMinutos: 5 }, null, false, 100, ahora + 3 * 60_000).estado === 'falla')
ok('en marcha = trabajando', estadoDelProceso([pasada(1, null, null)], config, null, true, 100, ahora).estado === 'trabajando')
ok('cola terminada', estadoDelProceso([pasada(1, 'cola terminada')], config, null, false, 0, ahora).estado === 'cola_terminada')
ok('tokens de 24 h', estadoDelProceso([pasada(2, '1 informe (X) · 4 en cola · 105 tokens'), pasada(1, '1 informe (Y) · 3 en cola · 250 tokens · esperando saldo de Keepa (1/110)')], config, null, false, 3, ahora).tokens24h === 355)

console.log('\n=== serie de saldo ===')
// ahora = 10:00 UTC: 9:48, 9:49 y 9:59 caen en el tramo de 9:30; 9:20 en el de 9:00; lo de hace 49 h fuera
const serie = serieDeSaldo(
  [
    pasada(12, 'esperando saldo de Keepa (10/110)'),
    pasada(11, 'esperando saldo de Keepa (31/280)'),
    pasada(1, 'esperando saldo de Keepa (52/110)'),
    pasada(40, 'esperando saldo de Keepa (200/280)'),
    pasada(39, '1 informe (X) · 4 en cola · 105 tokens'),
    pasada(60 * 49, 'esperando saldo de Keepa (5/110)'),
  ],
  ahora,
)
ok('tramos de 30 min con mínimo, máximo y media; fuera lo de hace > 48 h', serie.length === 2, JSON.stringify(serie))
ok('tramo de 9:00 con una pasada', serie[0]?.at === '2026-11-16T09:00:00.000Z' && serie[0].min === 200 && serie[0].max === 200 && serie[0].pasadas === 1, JSON.stringify(serie[0]))
ok('tramo de 9:30: 10–52, media 31', serie[1]?.at === '2026-11-16T09:30:00.000Z' && serie[1].min === 10 && serie[1].max === 52 && serie[1].media === 31 && serie[1].pasadas === 3, JSON.stringify(serie[1]))
const dosDias = Array.from({ length: 48 * 60 }, (_, i) => pasada(i + 1, `esperando saldo de Keepa (${(i * 21) % 280}/280)`))
ok('48 h cada minuto → ~96 puntos, no 576', serieDeSaldo(dosDias, ahora).length <= 97, String(serieDeSaldo(dosDias, ahora).length))

console.log('\n=== el panel ===')
let n = 0
const informe = (comercial: string | null, tipo: 'amazon' | 'sin', at: string, extra: Partial<FilaDeInforme> = {}): FilaDeInforme => ({
  id: `i${++n}`,
  lead_id: `L${n}`,
  seller_id: tipo === 'sin' ? 'SINAMAZON' : `S${n}`,
  version: 1,
  aperturas: 0,
  abierto_ultima_at: null,
  creado_en: at,
  lead: { store_name: `Tienda ${n}`, assigned_to: comercial },
  ...extra,
})
const informes: FilaDeInforme[] = [
  informe(A, 'amazon', '2026-11-13T09:00:00Z'),
  informe(D, 'sin', '2026-11-13T23:30:00Z', { aperturas: 3, abierto_ultima_at: '2026-11-15T10:00:00Z' }), // 14 nov en Madrid
  informe(J, 'amazon', '2026-11-14T10:00:00Z'),
  informe(A, 'sin', '2026-11-15T09:00:00Z'),
  informe(M, 'amazon', '2026-11-15T10:00:00Z'),
  informe('y', 'sin', '2026-11-16T08:30:00Z'),
  informe(A, 'amazon', '2026-11-16T09:30:00Z'),
]
const bitacora: EventoDeBitacora[] = [
  { at: '2026-11-16T09:00:00Z', tipo: 'sin', lead: 'Q2', tienda: 'Rota', comercialId: N, resultado: 'saltado', motivo: 'su web no contesta', tokens: 0 },
  { at: '2026-11-16T09:30:00Z', tipo: 'amazon', lead: informes[6].lead_id, tienda: 'Tienda 7', comercialId: A, resultado: 'hecho', tokens: 104 },
  { at: '2026-11-16T09:40:00Z', tipo: 'amazon', lead: 'Q3', tienda: 'Cae', comercialId: M, resultado: 'fallo', motivo: 'Keepa ha contestado HTTP 500 (intento 1)', tokens: 0 },
]
const entrada: EntradaDelPanel = {
  ahora,
  informes,
  envios: [
    { lead_id: informes[1].lead_id, occurred_at: '2026-11-15T11:00:00Z' },
    { lead_id: informes[1].lead_id, occurred_at: '2026-11-14T11:00:00Z' },
  ],
  cron: [pasada(1, 'ningún informe nuevo · esperando saldo de Keepa (90/110)')],
  config,
  cola: [
    { lead: informes[0].lead_id, seller: informes[0].seller_id, tienda: 'Tienda 1', comercial: 'Alejandro' }, // hecho
    { lead: 'Q1', seller: 'SQ1', tienda: 'Saltada', comercial: 'Daniela' }, // saltado por seller
    { lead: 'P1', seller: 'SP1', tienda: 'Pend A1', comercial: 'Alejandro' },
    { lead: 'P2', seller: 'SP2', tienda: 'Pend M1', comercial: 'Maoli' },
    { lead: 'P3', seller: 'SP3', tienda: 'Pend Dd', comercial: 'Daniella' }, // no es Daniela
  ],
  colaSin: [
    { lead: 'Q2', tienda: 'Rota', web: 'x', comercial: 'Naomi' }, // saltada
    { lead: 'P4', tienda: 'Pend N1', web: 'x', comercial: 'Naomi' },
    { lead: 'P5', tienda: 'Pend Y1', web: 'x', comercial: 'Yarima' },
    { lead: 'P6', tienda: 'Pend J1', web: 'x', comercialId: J },
  ],
  saltados: { SQ1: 'sin datos en Keepa', 'lead:Q2': 'su web no contesta', SFUERA: 'es cliente nuestro' },
  bitacora,
  perfiles,
  saldoAhora: { tokens: 95, ritmo: 21 },
  enMarcha: false,
}
const p = construirPanel(entrada)
ok('hoy (16 nov Madrid)', p.cifras.hoy.total === 2 && p.cifras.hoy.amazon === 1 && p.cifras.hoy.sin === 1, JSON.stringify(p.cifras.hoy))
ok('ayer (15 nov)', p.cifras.ayer.total === 2)
ok('ayer a la misma hora (hasta las 10:00 UTC del 15)', p.cifras.ayerALaMismaHora === 2)
ok('total y 7 días', p.cifras.total.total === 7 && p.cifras.ultimos7.total === 7)
ok('por día desde el primero, con el de las 23:30 UTC en el 14', p.porDia.map((d) => `${d.dia.slice(8)}:${d.amazon + d.sin}`).join(' ') === '13:1 14:2 15:2 16:2', JSON.stringify(p.porDia))
ok('saltados con fecha por día', p.porDia.find((d) => d.dia === '2026-11-16')?.saltados === 1)
ok('48 horas en el gráfico por hora', p.porHora.length === 48 && p.porHora.reduce((s, h) => s + h.amazon + h.sin, 0) === 4, `${p.porHora.length} ${p.porHora.reduce((s, h) => s + h.amazon + h.sin, 0)}`)
ok('ritmo por día: media de los 3 completos (1, 2, 2)', cerca(p.cifras.ritmoDia, 5 / 3))
ok('ritmo por hora en 24 h', cerca(p.cifras.ritmoHora, 2 / 24), String(p.cifras.ritmoHora))
ok('saltados por tipo', p.cifras.saltados.amazon === 2 && p.cifras.saltados.sin === 1)
ok('en cola sin hechos ni saltados', p.cifras.enCola.amazon === 3 && p.cifras.enCola.sin === 3 && p.cifras.enCola.deLosCinco === 4 && p.cifras.enCola.resto === 2, JSON.stringify(p.cifras.enCola))
ok('aperturas y envíos', p.cifras.aperturas.informes === 1 && p.cifras.aperturas.veces === 3 && p.cifras.enviadosPorCorreo === 1)

const de = (id: string | null) => p.comerciales.find((c) => c.id === id)
ok('los cinco primero y en su orden', p.comerciales.slice(0, 5).map((c) => c.nombre).join(',') === 'Alejandro,Maoli,Daniela,José,Naomi', p.comerciales.map((c) => c.nombre).join(','))
ok('hechos de Alejandro', de(A)?.hechos.amazon === 2 && de(A)?.hechos.sin === 1 && de(A)?.hechos.hoy === 1)
ok('pendientes por nombre y por id', de(A)?.pendientes.amazon === 1 && de(J)?.pendientes.sin === 1 && de(N)?.pendientes.sin === 1)
ok('«Daniella» no suma a Daniela', de(D)?.pendientes.amazon === 0 && de('dd')?.pendientes.amazon === 1)
ok('saltado por seller → su comercial', de(D)?.saltados === 1 && de(N)?.saltados === 1)
ok('fuera del turno: Yarima', de('y')?.enTurno === false && de('y')?.posicion === null && de('y')?.hechos.sin === 1)
ok('enviados del comercial', de(D)?.enviados === 1 && de(D)?.aperturas === 3)
ok('fin estimado de quien tiene pendientes', de(A)?.finEstimado != null && de(D)?.finEstimado === new Date(ahora).toISOString())

ok('siguiente: tras Alejandro, Maoli', p.turno.siguiente?.nombre === 'Maoli' && p.turno.siguiente?.tipo === 'amazon', JSON.stringify(p.turno.siguiente))
ok('próximos: se salta a Daniela (no le queda), luego José y Naomi', p.turno.proximos.slice(0, 4).map((x) => x.nombre).join(',') === 'Maoli,José,Naomi,Alejandro', p.turno.proximos.map((x) => x.nombre).join(','))
ok('el resto sale al final con su nombre', p.turno.proximos.some((x) => x.nombre.includes('(resto)')))
ok('cumplimiento solo desde la bitácora (Yarima → Alejandro: no tocaba a Alejandro)', p.turno.desde === '2026-11-16T09:00:00Z' && p.turno.cumplimiento === null, String(p.turno.cumplimiento))
ok('últimos, el más nuevo primero', p.turno.ultimos[0].comercialId === A && p.turno.ultimos.length === 7)
// El lead del último hecho se ha reasignado a Daniela: el turno sigue lo que dice la bitácora (se hizo en el hueco de Alejandro)
const reasignado = construirPanel({ ...entrada, informes: informes.map((f, i) => (i === 6 ? { ...f, lead: { store_name: f.lead?.store_name ?? null, assigned_to: D } } : f)) })
ok('reasignado: el último sigue siendo de Alejandro y el siguiente Maoli', reasignado.turno.ultimos[0].comercialId === A && reasignado.turno.siguiente?.nombre === 'Maoli', JSON.stringify(reasignado.turno.ultimos[0]))
const conDos = construirPanel({ ...entrada, bitacora: [...bitacora, { at: '2026-11-16T09:50:00Z', tipo: 'sin', lead: 'P9', tienda: 'X', comercialId: M, resultado: 'hecho', tokens: 200 }] })
ok('cumplimiento con el comercial de la bitácora (A → M = bien)', conDos.turno.cumplimiento === 1 && conDos.turno.ultimos[0].comercialId === M, String(conDos.turno.cumplimiento))

console.log('\n=== log ===')
ok('hechos + saltados + fallos', p.log.length === 7 + 3 + 1, String(p.log.length))
ok('ordenado por fecha, sin fecha al final', p.log[0].resultado === 'fallo' && p.log[p.log.length - 1].at === null)
const saltadaSeller = p.log.find((f) => f.tienda === 'Saltada')
ok('saltado de Amazon cruza seller → lead y comercial', saltadaSeller?.leadId === 'Q1' && saltadaSeller.comercial === 'Daniela' && saltadaSeller.at === null && saltadaSeller.motivo === 'sin datos en Keepa')
const rota = p.log.find((f) => f.tienda === 'Rota' && f.resultado === 'saltado')
ok('saltado con fecha de la bitácora', rota?.at === '2026-11-16T09:00:00Z' && rota.comercial === 'Naomi')
ok('saltado que ya no está en la cola', p.log.some((f) => f.tienda === 'Vendedor SFUERA' && f.leadId === null))
ok('tokens del hecho desde la bitácora', p.log.find((f) => f.leadId === informes[6].lead_id)?.tokens === 104)
ok('enviado: la primera fecha', p.log.find((f) => f.leadId === informes[1].lead_id)?.enviadoAt === '2026-11-14T11:00:00Z')
ok('nunca lleva token', !JSON.stringify(p).includes('token"'))

console.log('\n=== estado en el panel ===')
ok('esperando saldo con el de ahora', p.proceso.estado === 'esperando_saldo' && p.proceso.saldo === 95 && p.proceso.minutosParaSiguiente === 1)

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
process.exit(fallos ? 1 : 0)
