import {
  acumulado,
  cicloAnterior,
  corteEquivalente,
  costeAnteriorHasta,
  decidirGuardado,
  diaDeCobro,
  formatoHoras,
  horasValidas,
  leerHoras,
  progresoDelCiclo,
  resumenDelEquipo,
  semanasDelCiclo,
  sumarHoras,
} from '@/lib/payroll/horas'
import type { PayrollRate, WorkHourEntry } from '@/lib/types/payroll'

let fallos = 0
let comprobaciones = 0
function igual(nombre: string, real: unknown, esperado: unknown) {
  comprobaciones += 1
  const a = JSON.stringify(real)
  const b = JSON.stringify(esperado)
  const bien = a === b
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${nombre}${bien ? '' : ` → ${a}, esperaba ${b}`}`)
}

console.log('Leer lo escrito')
igual('«7,5» con coma son 7,5 horas (antes daba NaN → 0 → borraba el día)', leerHoras('7,5'), { tipo: 'horas', horas: 7.5 })
igual('«7.5» con punto también', leerHoras('7.5'), { tipo: 'horas', horas: 7.5 })
igual('«7h» y «7 horas»', [leerHoras('7h'), leerHoras(' 7 horas ')], [{ tipo: 'horas', horas: 7 }, { tipo: 'horas', horas: 7 }])
igual('«7:30» es siete y media', leerHoras('7:30'), { tipo: 'horas', horas: 7.5 })
igual('«,5» es media hora', leerHoras(',5'), { tipo: 'horas', horas: 0.5 })
igual('vacío es vacío', leerHoras('  '), { tipo: 'vacio' })
igual('«siete» no se entiende', leerHoras('siete').tipo, 'invalido')
igual('«7,5,5» no se entiende', leerHoras('7,5,5').tipo, 'invalido')
igual('negativo no vale', leerHoras('-2').tipo, 'invalido')
igual('más de 24 no vale', leerHoras('30').tipo, 'invalido')
igual('«7:75» no vale', leerHoras('7:75').tipo, 'invalido')
igual('se redondea a dos decimales', leerHoras('7:20'), { tipo: 'horas', horas: 7.33 })

console.log('El − / +')
igual('7,5 + media = 8', sumarHoras('7,5', 0.5, 0), { texto: '8', aviso: null })
igual('7,5 − media = 7 (antes partía de 0)', sumarHoras('7,5', -0.5, 0), { texto: '7', aviso: null })
igual('vacío + media = 0,5', sumarHoras('', 0.5, 6), { texto: '0,5', aviso: null })
igual('ilegible: sigue desde lo guardado y avisa', sumarHoras('abc', 0.5, 6).texto, '6,5')
igual('y el aviso existe', sumarHoras('abc', 0.5, 6).aviso !== null, true)
igual('no baja de 0', sumarHoras('0', -0.5, 0).texto, '0')
igual('no pasa de 24', sumarHoras('24', 0.5, 0).texto, '24')

console.log('Guardar')
igual('«7,5» guarda 7,5', decidirGuardado('7,5', true), { accion: 'guardar', horas: 7.5 })
igual('ilegible con fila: ERROR, nunca borrar', decidirGuardado('7,,5', true).accion, 'error')
igual('vacío con fila: borrar', decidirGuardado('', true), { accion: 'borrar' })
igual('0 con fila: borrar', decidirGuardado('0', true), { accion: 'borrar' })
igual('0 sin fila: nada', decidirGuardado('0', false), { accion: 'nada' })
igual('NaN no pasa el cinturón', horasValidas(Number.NaN), false)
igual('25 tampoco', horasValidas(25), false)
igual('null (borrar) sí', horasValidas(null), true)
igual('formato con coma', formatoHoras(7.5), '7,5')

console.log('Fechas del ciclo')
igual('el ciclo de noviembre se cobra el 15 de diciembre', diaDeCobro('2026-11-15'), '2026-12-15')
igual('el de diciembre, el 15 de enero', diaDeCobro('2026-12-15'), '2027-01-15')
igual('ciclo anterior de enero', cicloAnterior('2027-01-15'), '2026-12-15')
const dias = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']
igual('semanas de lunes a domingo (el 15 es domingo)', semanasDelCiclo(dias).map((s) => s.length), [1, 7, 1])
igual('acumulado', acumulado([2, 3, 0, 4]), [2, 5, 5, 9])
igual('corte equivalente', corteEquivalente(['a', 'b', 'c'], 2), 'b')
igual('corte sin días transcurridos', corteEquivalente(['a', 'b'], 0), null)

const horasDe = (d: string) => ({ '2026-11-16': 8, '2026-11-17': 0, '2026-11-21': 3 } as Record<string, number>)[d] ?? 0
igual('progreso a 18 nov', progresoDelCiclo(dias, '2026-11-18', horasDe), {
  total: 9,
  transcurridos: 4,
  laborablesHastaHoy: 3,
  laborablesConHoras: 1,
  diasConHoras: 2,
  laborablesTotales: 6,
})

console.log('Equipo y comparativa (con el motor de la nómina)')
const tarifa: PayrollRate = { id: 't', period_start: '2026-11-01', user_id: null, hourly_rate: 4, commission_per_appointment: 25, commission_per_semi_qualified: 10, created_at: '', updated_at: '' }
const h = (user: string, dia: string, horas: number): WorkHourEntry => ({ id: `${user}${dia}`, user_id: user, work_date: dia, hours: horas, note: null, created_at: '', updated_at: '' })
const datos = {
  hours: [h('ana', '2026-11-16', 8), h('ana', '2026-11-18', 6), h('luis', '2026-11-16', 5)],
  rates: [tarifa],
  qualified: [{ comercial_id: 'ana', status: 'qualified', start_time: '2026-11-17T10:00:00Z' }, { comercial_id: 'ana', status: 'semi_qualified', start_time: '2026-11-18T10:00:00Z' }],
  manual: [],
}
const equipo = resumenDelEquipo([{ id: 'ana', nombre: 'Ana' }, { id: 'luis', nombre: 'Luis' }], datos, '2026-11-15', dias, '2026-11-18')
igual('Ana: 14 h, 2 días, 2 citas, 14×4 + 25 + 10', [equipo[0].horas, equipo[0].dias, equipo[0].citas, equipo[0].total], [14, 2, 2, 91])
igual('Ana ha apuntado hoy', [equipo[0].horasHoy, equipo[0].sinApuntarHoy], [6, false])
igual('Luis no ha apuntado hoy (miércoles)', equipo[1].sinApuntarHoy, true)
igual('en sábado no se avisa', resumenDelEquipo([{ id: 'luis', nombre: 'Luis' }], datos, '2026-11-15', dias, '2026-11-21')[0].sinApuntarHoy, false)
igual('hasta el 17: 8 h y la cualificada', costeAnteriorHasta('ana', datos, '2026-11-15', '2026-11-17')?.total, 8 * 4 + 25)
igual('sin corte, sin comparativa', costeAnteriorHasta('ana', datos, '2026-11-15', null), null)

console.log(`\n${comprobaciones - fallos}/${comprobaciones} bien`)
if (fallos > 0) process.exit(1)
