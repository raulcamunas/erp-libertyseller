import {
  curvaHoraria,
  fusionarDiaDeUso,
  gastoDeHoy,
  gastoMaximoPosible,
  horaDeCuenta,
  horaLocal,
  inicioDelDiaLocal,
  leerRespuestaDeUso,
  lotesDeCampanas,
  minutoLocalDe,
  proyectarHoy,
  RUTA_USO,
  TIPO_USO,
  zonaDePais,
} from './uso-calculo'
import type { DiaDeUso, HoraDeCuenta } from './tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || d === '' ? '' : ` -> ${typeof d === 'string' ? d : JSON.stringify(d)}`}`)
}
const ms = (iso: string) => Date.parse(iso)
const cerca = (a: number, b: number, eps = 0.001) => Math.abs(a - b) <= eps

console.log('\n=== constantes y lotes ===')
ok('tipo de la API de uso', TIPO_USO === 'application/vnd.spcampaignbudgetusage.v1+json')
ok('ruta de la API de uso', RUTA_USO === '/sp/campaigns/budget/usage')
{
  const ids = Array.from({ length: 250 }, (_, i) => `c${i}`)
  const l = lotesDeCampanas(ids)
  ok('250 ids → lotes de 100, 100 y 50', l.length === 3 && l[0].length === 100 && l[1].length === 100 && l[2].length === 50, l.map((x) => x.length))
  ok('sin repetidos ni vacíos', lotesDeCampanas(['a', 'a', '', 'b']).flat().join(',') === 'a,b')
  ok('tamaño a medida', lotesDeCampanas(['a', 'b', 'c'], 2).length === 2)
  ok('sin ids → sin lotes', lotesDeCampanas([]).length === 0)
}

console.log('\n=== respuesta de la API (207) ===')
{
  const r = leerRespuestaDeUso({
    success: [
      { campaignId: '111', budgetUsagePercent: 45.5, budget: 20, usageUpdatedTimestamp: '2026-11-15T12:38:00Z', index: 0 },
      { campaignId: 222, budgetUsagePercent: '130.2', budget: '15.5', usageUpdatedTimestamp: '2026-11-15T12:30:00.000Z', index: 1 },
      { campaignId: '333', budgetUsagePercent: 450, budget: 10, usageUpdatedTimestamp: '2026-11-15T12:30:00Z', index: 2 },
      { campaignId: '444', budgetUsagePercent: -3, index: 3 },
    ],
    error: [{ index: 4, campaignId: '555', code: 'INVALID_ARGUMENT', details: 'Campaign not found' }],
  })
  const u = (id: string) => r.usos.find((x) => x.campaignId === id)
  ok('4 lecturas y 1 error', r.usos.length === 4 && r.errores.length === 1, r)
  ok('no es todo error', r.todoError === false)
  ok('uso y presupuesto de la RESPUESTA', u('111')?.usoPct === 45.5 && u('111')?.presupuesto === 20, u('111'))
  ok('marca de tiempo de Amazon', u('111')?.actualizadoAt === '2026-11-15T12:38:00.000Z', u('111'))
  ok('números en texto y id numérico', u('222')?.usoPct === 130.2 && u('222')?.presupuesto === 15.5, u('222'))
  ok('uso acotado a 200', u('333')?.usoPct === 200, u('333'))
  ok('uso negativo → 0; sin budget → null; sin marca → null', u('444')?.usoPct === 0 && u('444')?.presupuesto === null && u('444')?.actualizadoAt === null, u('444'))
  ok('error con campaña, código y detalle', r.errores[0].campaignId === '555' && r.errores[0].codigo === 'INVALID_ARGUMENT' && r.errores[0].detalle === 'Campaign not found', r.errores)
}
{
  const r = leerRespuestaDeUso({ success: [], error: [{ index: 0, campaignId: '1', code: 'UNAUTHORIZED', details: [{ message: 'x' }] }] })
  ok('207 todo error → todoError', r.todoError === true && r.usos.length === 0 && r.errores.length === 1, r)
  ok('detalle que no es texto se pasa a texto', r.errores[0].detalle.includes('x'))
}
ok('respuesta vacía → todoError', leerRespuestaDeUso(null).todoError === true)
ok('sin lecturas ni errores → no es error', leerRespuestaDeUso({ success: [], error: [] }).todoError === false)
ok('respuesta en texto JSON', leerRespuestaDeUso('{"success":[{"campaignId":"9","budgetUsagePercent":"12,5"}]}').usos[0]?.usoPct === 12.5)

console.log('\n=== zonas ===')
ok('manda la zona del perfil', zonaDePais('ES', 'Europe/Madrid') === 'Europe/Madrid')
ok('zona inválida → la del país', zonaDePais('US', 'Marte/Olympus') === 'America/Los_Angeles')
ok('sin zona: ES → Europe/Paris (la de Amazon Ads)', zonaDePais('ES', null) === 'Europe/Paris')
ok('sin zona: UK → Londres', zonaDePais('uk', '') === 'Europe/London')
ok('nada → Madrid', zonaDePais(null, undefined) === 'Europe/Madrid')

console.log('\n=== hora local: Madrid con cambio de horario ===')
{
  const a = horaLocal(ms('2026-03-29T00:30:00Z'), 'Europe/Madrid')
  ok('29/3 00:30 UTC → 01:30 (invierno)', a.fecha === '2026-03-29' && a.hora === 1 && a.minutos === 30, a)
  const b = horaLocal(ms('2026-03-29T01:30:00Z'), 'Europe/Madrid')
  ok('29/3 01:30 UTC → 03:30 (verano)', b.hora === 3 && b.minutos === 30, b)
  ok('domingo = 0', b.diaSemana === 0, b)
  ok('marzo tiene 31 días y mes 2026-03', b.diasDelMes === 31 && b.mes === '2026-03' && b.dia === 29, b)
  ok('medianoche del 29/3 = 23:00 UTC del 28', inicioDelDiaLocal('2026-03-29', 'Europe/Madrid') === '2026-03-28T23:00:00.000Z', inicioDelDiaLocal('2026-03-29', 'Europe/Madrid'))
  ok('medianoche del 30/3 = 22:00 UTC del 29', inicioDelDiaLocal('2026-03-30', 'Europe/Madrid') === '2026-03-29T22:00:00.000Z', inicioDelDiaLocal('2026-03-30', 'Europe/Madrid'))
  ok('medianoche del 25/10 = 22:00 UTC del 24', inicioDelDiaLocal('2026-10-25', 'Europe/Madrid') === '2026-10-24T22:00:00.000Z', inicioDelDiaLocal('2026-10-25', 'Europe/Madrid'))
  ok('medianoche del 26/10 = 23:00 UTC del 25', inicioDelDiaLocal('2026-10-26', 'Europe/Madrid') === '2026-10-25T23:00:00.000Z', inicioDelDiaLocal('2026-10-26', 'Europe/Madrid'))
  const c = horaLocal(ms('2026-11-15T23:30:00Z'), 'Europe/Madrid')
  ok('15/11 23:30 UTC ya es 16/11 en Madrid', c.fecha === '2026-11-16' && c.hora === 0 && c.diaSemana === 1, c)
  const f = horaLocal(ms('2028-02-29T12:00:00Z'), 'Europe/Madrid')
  ok('febrero bisiesto: 29 días', f.diasDelMes === 29, f)
}

console.log('\n=== hora local: Nueva York con cambio de horario ===')
{
  const z = 'America/New_York'
  ok('medianoche del 8/3 (aún EST) = 05:00 UTC', inicioDelDiaLocal('2026-03-08', z) === '2026-03-08T05:00:00.000Z', inicioDelDiaLocal('2026-03-08', z))
  ok('medianoche del 9/3 (EDT) = 04:00 UTC', inicioDelDiaLocal('2026-03-09', z) === '2026-03-09T04:00:00.000Z', inicioDelDiaLocal('2026-03-09', z))
  ok('medianoche del 2/11 (EST) = 05:00 UTC', inicioDelDiaLocal('2026-11-02', z) === '2026-11-02T05:00:00.000Z', inicioDelDiaLocal('2026-11-02', z))
  const a = horaLocal(ms('2026-11-01T05:30:00Z'), z)
  const b = horaLocal(ms('2026-11-01T06:30:00Z'), z)
  ok('1/11: la 01:30 ocurre dos veces', a.hora === 1 && b.hora === 1 && a.fecha === '2026-11-01' && b.fecha === '2026-11-01', [a, b])
  const c = horaLocal(ms('2026-11-15T03:00:00Z'), z)
  ok('15/11 03:00 UTC es aún el sábado 14 a las 22:00', c.fecha === '2026-11-14' && c.hora === 22 && c.diaSemana === 6, c)
  ok('minuto del día de NY', minutoLocalDe('2026-11-15T03:00:00Z', z, '2026-11-14') === 22 * 60)
  ok('minuto de otra fecha local → null', minutoLocalDe('2026-11-15T03:00:00Z', z, '2026-11-15') === null)
  ok('marca que no se entiende → null', minutoLocalDe('ayer', z, '2026-11-14') === null && minutoLocalDe(null, z, '2026-11-14') === null)
}

console.log('\n=== hora local: Ciudad de México (sin horario de verano) ===')
{
  const z = 'America/Mexico_City'
  const a = horaLocal(ms('2026-07-01T05:30:00Z'), z)
  ok('1/7 05:30 UTC → 30/6 23:30', a.fecha === '2026-06-30' && a.hora === 23 && a.minutos === 30 && a.diasDelMes === 30 && a.mes === '2026-06', a)
  ok('medianoche en julio = 06:00 UTC', inicioDelDiaLocal('2026-07-01', z) === '2026-07-01T06:00:00.000Z', inicioDelDiaLocal('2026-07-01', z))
  ok('medianoche en enero = 06:00 UTC', inicioDelDiaLocal('2026-01-15', z) === '2026-01-15T06:00:00.000Z', inicioDelDiaLocal('2026-01-15', z))
}

console.log('\n=== fusión de lecturas del mismo día ===')
{
  const z = 'Europe/Madrid'
  // 11:00 en Madrid: va al 60 % de 20 €
  const d1 = fusionarDiaDeUso(null, { campaignId: 'c1', usoPct: 60, presupuesto: 20, actualizadoAt: '2026-11-15T09:58:00Z', porEstado: false, estadoCampana: 'ENABLED' }, ms('2026-11-15T10:00:00Z'), z)
  ok('primera lectura: fecha local, gasto 12, sin agotar', d1.fechaLocal === '2026-11-15' && d1.gastoEstimado === 12 && d1.agotadaMin === null && d1.presupuestoPrimera === 20 && d1.fuente === 'api', d1)
  // 13:40: al 97 % de 25 € (alguien subió el presupuesto)
  const d2 = fusionarDiaDeUso(d1, { campaignId: 'c1', usoPct: 97, presupuesto: 25, actualizadoAt: '2026-11-15T12:38:00Z', porEstado: false, estadoCampana: 'ENABLED' }, ms('2026-11-15T12:40:00Z'), z)
  ok('segunda: agotada a las 13:38 (por la marca de Amazon)', d2.agotadaMin === 13 * 60 + 38, d2)
  ok('segunda: presupuesto último 25, primero 20', d2.presupuesto === 25 && d2.presupuestoPrimera === 20, d2)
  ok('segunda: uso máx 97 y gasto 24,25', d2.usoMaxPct === 97 && d2.gastoEstimado === 24.25, d2)
  // 16:00: le subieron el presupuesto y el uso baja al 50 %
  const d3 = fusionarDiaDeUso(d2, { campaignId: 'c1', usoPct: 50, presupuesto: 50, actualizadoAt: '2026-11-15T14:58:00Z', porEstado: false, estadoCampana: 'ENABLED' }, ms('2026-11-15T15:00:00Z'), z)
  ok('tercera: el minuto agotado no se borra y el máximo se queda', d3.agotadaMin === 818 && d3.usoMaxPct === 97 && d3.usoPct === 50, d3)
  // La API falla y la campaña sale «sin presupuesto» por el estado
  const d4 = fusionarDiaDeUso(d3, { campaignId: 'c1', usoPct: null, presupuesto: null, actualizadoAt: null, porEstado: true, estadoCampana: 'ENABLED' }, ms('2026-11-15T17:00:00Z'), z)
  ok('por estado: marca agotada, no toca el minuto ni el uso', d4.agotadaPorEstado && d4.agotadaMin === 818 && d4.usoPct === 50 && d4.gastoEstimado === 25 && d4.fuente === 'estado', d4)
  // Solo por estado desde el principio: sin minuto
  const e1 = fusionarDiaDeUso(null, { campaignId: 'c2', usoPct: null, presupuesto: 10, actualizadoAt: null, porEstado: true, estadoCampana: 'ENABLED' }, ms('2026-11-15T10:00:00Z'), z)
  ok('agotada solo por estado → sin minuto', e1.agotadaPorEstado && e1.agotadaMin === null && e1.fuente === 'estado' && e1.gastoEstimado === null, e1)
  // Lectura con uso de AYER (marca del día anterior) a las 00:10
  const s1 = fusionarDiaDeUso(null, { campaignId: 'c3', usoPct: 120, presupuesto: 10, actualizadoAt: '2026-11-15T22:55:00Z', porEstado: false, estadoCampana: 'ENABLED' }, ms('2026-11-15T23:10:00Z'), z)
  ok('uso de ayer no cuenta para hoy', s1.fechaLocal === '2026-11-16' && s1.usoPct === null && s1.agotadaMin === null && s1.gastoEstimado === null, s1)
  // Una fila de ayer no se arrastra
  const n1 = fusionarDiaDeUso(d4, { campaignId: 'c1', usoPct: 5, presupuesto: 50, actualizadoAt: '2026-11-16T07:00:00Z', porEstado: false, estadoCampana: 'ENABLED' }, ms('2026-11-16T07:05:00Z'), z)
  ok('día nuevo: empieza de cero', n1.fechaLocal === '2026-11-16' && n1.usoMaxPct === 5 && n1.agotadaMin === null && !n1.agotadaPorEstado && n1.presupuestoPrimera === 50, n1)
  // Uso por encima de 200 se acota
  const t1 = fusionarDiaDeUso(null, { campaignId: 'c4', usoPct: 300, presupuesto: 10, actualizadoAt: null, porEstado: false, estadoCampana: 'ENABLED' }, ms('2026-11-15T10:30:00Z'), z)
  ok('sin marca de Amazon: minuto de la lectura; uso acotado a 200', t1.usoPct === 200 && t1.gastoEstimado === 20 && t1.agotadaMin === 11 * 60 + 30, t1)

  console.log('\n=== gasto de hoy, máximo posible y hora de la cuenta ===')
  const pausada: DiaDeUso = { ...e1, campaignId: 'c5', presupuesto: 30, gastoEstimado: 7, estadoCampana: 'PAUSED' }
  const ayer: DiaDeUso = { ...d1, fechaLocal: '2026-11-14', gastoEstimado: 99 }
  const dias = [d4, e1, pausada, ayer]
  ok('gasto de hoy = Σ gasto estimado (la pausada también)', gastoDeHoy(dias, '2026-11-15') === 32, gastoDeHoy(dias, '2026-11-15'))
  ok('máximo posible = Σ presupuesto ENABLED × 1,25', gastoMaximoPosible(dias, '2026-11-15') === 75, gastoMaximoPosible(dias, '2026-11-15'))
  const hc = horaDeCuenta(dias, '2026-11-15', 17)
  ok('hora de la cuenta', hc.fechaLocal === '2026-11-15' && hc.hora === 17 && hc.gastoAcum === 32 && hc.sumaPresupuestos === 60, hc)
  ok('hora sin filas → 0 y sin presupuestos', horaDeCuenta(dias, '2026-11-20', 3).gastoAcum === 0 && horaDeCuenta(dias, '2026-11-20', 3).sumaPresupuestos === null)
}

console.log('\n=== curva del día y proyección ===')
{
  // 14 días con una forma conocida: f(h) = ((h + 1) / 24)², total distinto cada día
  const forma = (h: number) => ((h + 1) / 24) ** 2
  const horas: HoraDeCuenta[] = []
  for (let d = 1; d <= 14; d++) {
    const fecha = `2026-11-${String(d).padStart(2, '0')}`
    for (let h = 0; h < 24; h++) horas.push({ fechaLocal: fecha, hora: h, gastoAcum: Math.round(100 * d * forma(h) * 100) / 100, sumaPresupuestos: 100 })
  }
  // 3 días más antiguos con otra forma (no deben entrar: solo los 14 últimos)
  for (let d = 1; d <= 3; d++) for (let h = 0; h < 24; h++) horas.push({ fechaLocal: `2026-10-${String(d).padStart(2, '0')}`, hora: h, gastoAcum: h === 0 ? 50 : 50, sumaPresupuestos: 100 })
  // Un día sin gasto (no cuenta) y uno sin la fila de las 23 (no cuenta)
  for (let h = 0; h < 24; h++) horas.push({ fechaLocal: '2026-10-20', hora: h, gastoAcum: 0.2, sumaPresupuestos: 100 })
  for (let h = 0; h < 20; h++) horas.push({ fechaLocal: '2026-10-21', hora: h, gastoAcum: 80, sumaPresupuestos: 100 })
  const c = curvaHoraria(horas)
  ok('24 valores, acaba en 1', c.length === 24 && c[23] === 1, c)
  ok('sigue la forma de los 14 días (12:00 → 0,293)', cerca(c[12], forma(12), 0.002), c[12])
  ok('nunca baja', c.every((x, i) => i === 0 || x >= c[i - 1]))
  // Huecos: una hora sin lectura toma la anterior
  const conHueco = horas.filter((h) => !(h.fechaLocal === '2026-11-14' && h.hora === 12))
  ok('un hueco no la rompe', cerca(curvaHoraria(conHueco)[12], forma(12), 0.01), curvaHoraria(conHueco)[12])

  const tres = horas.filter((h) => h.fechaLocal >= '2026-11-12')
  const l = curvaHoraria(tres)
  ok('con 3 días → lineal', cerca(l[12], 13 / 24) && cerca(l[0], 1 / 24) && l[23] === 1, l)
  ok('sin datos → lineal', cerca(curvaHoraria([])[5], 6 / 24))

  ok('a las 13:00 con 52 € y curva lineal → 96 €', proyectarHoy(52, 13, 0, l) === 96, proyectarHoy(52, 13, 0, l))
  ok('a las 13:30 interpola media hora', cerca(proyectarHoy(54, 13, 30, l), 54 / (13.5 / 24), 0.01), proyectarHoy(54, 13, 30, l))
  ok('a las 13:00 con la curva real (0,293 llevado)', cerca(proyectarHoy(29.34, 13, 0, c), 29.34 / c[12], 0.01), proyectarHoy(29.34, 13, 0, c))
  ok('a medianoche la fracción mínima es 0,1', proyectarHoy(2, 0, 0, l) === 20, proyectarHoy(2, 0, 0, l))
  ok('minuto del día en vez del de la hora (780 a las 13) → igual', proyectarHoy(52, 13, 780, l) === 96, proyectarHoy(52, 13, 780, l))
}

if (fallos) {
  console.log(`\n${fallos} prueba(s) FALLAN`)
  process.exit(1)
}
console.log('\nTodas las pruebas pasan')
