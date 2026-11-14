/**
 * Pruebas del calendario de vacaciones de toda la empresa: npx tsx lib/vacations/calendario.prueba.ts
 */
import {
  avisoDePedida,
  avisoDeResolucion,
  choquesDeEmpresa,
  claveDeAviso,
  colorDePersona,
  diasLaborables,
  errorDeRango,
  festivosDelLugar,
  festivosParaPintar,
  leerLugar,
  ocupacionPorDia,
  PALETA_PERSONAS,
  saldoAntesDespues,
  textoDeChoque,
  type AusenciaDeEquipo,
} from '@/lib/vacations/calendario'
import type { VacationEmployee, VacationRequest } from '@/lib/types/vacations'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const aus = (p: Partial<AusenciaDeEquipo> & Pick<AusenciaDeEquipo, 'id' | 'employee_id' | 'start_date' | 'end_date'>): AusenciaDeEquipo => ({
  nombre: p.employee_id === 'ana' ? 'Ana' : p.employee_id === 'luis' ? 'Luis' : 'Marta',
  color: '#8B5CF6',
  status: 'aprobada',
  solape_autorizado: false,
  ...p,
})

console.log('\n=== festivos ===')
ok('sin lugar no hay festivos', festivosDelLugar(null).length === 0)
ok('Madrid: el 12 de octubre y el 7 y 8 de diciembre de 2026', ['2026-10-12', '2026-12-07', '2026-12-08'].every((d) => festivosDelLugar({ ccaa: 'MD' }).includes(d)))
ok('Cataluña no tiene el 7 de diciembre', !festivosDelLugar({ ccaa: 'CT' }).includes('2026-12-07') && festivosDelLugar({ ccaa: 'CT' }).includes('2026-12-08'))
ok('ningún festivo en fin de semana', festivosDelLugar({ ccaa: 'MD' }).every((d) => ![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())))
ok('días laborables sin lugar: solo fines de semana', diasLaborables('2026-12-07', '2026-12-11', null) === 5)
ok('días laborables en Madrid: descuenta el 7 y el 8', diasLaborables('2026-12-07', '2026-12-11', { ccaa: 'MD' }) === 3, String(diasLaborables('2026-12-07', '2026-12-11', { ccaa: 'MD' })))
ok('días laborables en Cataluña: descuenta el 8', diasLaborables('2026-12-07', '2026-12-11', { ccaa: 'CT' }) === 4)
ok('del viernes al lunes son 2', diasLaborables('2026-11-13', '2026-11-16', null) === 2)
const pintar = festivosParaPintar(null, '2026-10-01', '2026-10-31')
ok('sin lugar se pintan los nacionales, informativos', pintar.get('2026-10-12')?.descuenta === false && pintar.size === 1, JSON.stringify([...pintar]))
ok('con lugar se pintan los suyos y descuentan', festivosParaPintar({ ccaa: 'MD' }, '2026-12-01', '2026-12-31').get('2026-12-07')?.descuenta === true)
ok('leerLugar acepta {ccaa, ine}', JSON.stringify(leerLugar({ ccaa: 'MD', ine: '28079' })) === JSON.stringify({ ccaa: 'MD', ine: '28079' }))
ok('leerLugar descarta lo raro', leerLugar({ ccaa: 'XX' }) === null && leerLugar('MD') === null && leerLugar(null) === null && leerLugar({ ccaa: 'MD', ine: 'abc' })?.ine === null)

console.log('\n=== choquesDeEmpresa ===')
const ana = aus({ id: 'r1', employee_id: 'ana', start_date: '2026-08-03', end_date: '2026-08-07' })
const c1 = choquesDeEmpresa({ employeeId: 'luis', startDate: '2026-08-06', endDate: '2026-08-12', ausencias: [ana] })
ok('máximo 1: choca el jueves y el viernes', c1.hay && c1.diasLlenos.join() === '2026-08-06,2026-08-07', c1.diasLlenos.join())
ok('dice con quién coincide y qué días', c1.coinciden.length === 1 && c1.coinciden[0].nombre === 'Ana' && c1.coinciden[0].dias.length === 2)
ok('máximo 2: coincide pero cabe', (() => { const r = choquesDeEmpresa({ employeeId: 'luis', startDate: '2026-08-06', endDate: '2026-08-12', ausencias: [ana], maxALaVez: 2 }); return !r.hay && r.coinciden.length === 1 })())
const marta = aus({ id: 'r2', employee_id: 'marta', start_date: '2026-08-07', end_date: '2026-08-07', status: 'pendiente' })
ok('máximo 2 con dos fuera: choca solo el viernes', choquesDeEmpresa({ employeeId: 'luis', startDate: '2026-08-03', endDate: '2026-08-07', ausencias: [ana, marta], maxALaVez: 2 }).diasLlenos.join() === '2026-08-07')
ok('al aprobar solo cuentan las aprobadas', !choquesDeEmpresa({ employeeId: 'luis', startDate: '2026-08-07', endDate: '2026-08-07', ausencias: [marta], estados: ['aprobada'] }).hay)
ok('al pedir cuentan también las pendientes', choquesDeEmpresa({ employeeId: 'luis', startDate: '2026-08-07', endDate: '2026-08-07', ausencias: [marta] }).hay)
ok('las propias no chocan', !choquesDeEmpresa({ employeeId: 'ana', startDate: '2026-08-03', endDate: '2026-08-07', ausencias: [ana] }).hay)
ok('excludeId: no choca consigo misma', !choquesDeEmpresa({ employeeId: 'luis', startDate: '2026-08-03', endDate: '2026-08-07', ausencias: [ana], excludeId: 'r1' }).hay)
ok('el fin de semana no choca', !choquesDeEmpresa({ employeeId: 'luis', startDate: '2026-08-08', endDate: '2026-08-09', ausencias: [aus({ id: 'r3', employee_id: 'ana', start_date: '2026-08-07', end_date: '2026-08-10' })] }).hay)
ok('un festivo de quien pide no choca', !choquesDeEmpresa({ employeeId: 'luis', startDate: '2026-10-12', endDate: '2026-10-12', ausencias: [aus({ id: 'r4', employee_id: 'ana', start_date: '2026-10-12', end_date: '2026-10-12' })], festivos: ['2026-10-12'] }).hay)
ok('dos peticiones de la misma persona son una persona', !choquesDeEmpresa({ employeeId: 'luis', startDate: '2026-08-04', endDate: '2026-08-04', ausencias: [ana, aus({ id: 'r5', employee_id: 'ana', start_date: '2026-08-04', end_date: '2026-08-04', status: 'pendiente' })], maxALaVez: 2 }).hay)
ok('rango del revés: nada', !choquesDeEmpresa({ employeeId: 'luis', startDate: '2026-08-07', endDate: '2026-08-01', ausencias: [ana] }).hay)
ok('texto del choque', (textoDeChoque(c1) ?? '').startsWith('Choca 2 días con Ana') && (textoDeChoque(c1) ?? '').includes('no pueden irse dos a la vez'), textoDeChoque(c1) ?? '')
ok('sin coincidencias no hay texto', textoDeChoque(choquesDeEmpresa({ employeeId: 'luis', startDate: '2026-09-01', endDate: '2026-09-02', ausencias: [ana] })) === null)

console.log('\n=== ocupacionPorDia ===')
const occ = ocupacionPorDia([ana, marta], '2026-08-01', '2026-08-31', { yo: 'luis', maxALaVez: 1 })
ok('sin fines de semana', !occ.has('2026-08-08') && !occ.has('2026-08-01'))
ok('lunes: Ana fuera, lleno para Luis', occ.get('2026-08-03')?.personas.length === 1 && occ.get('2026-08-03')?.lleno === true)
ok('viernes: aprobadas primero', occ.get('2026-08-07')?.personas.map((p) => p.nombre).join() === 'Ana,Marta')
ok('para Ana su propio día no está lleno', ocupacionPorDia([ana], '2026-08-03', '2026-08-03', { yo: 'ana' }).get('2026-08-03')?.lleno === false)
ok('una aprobada manda sobre la pendiente de la misma persona', ocupacionPorDia([aus({ id: 'p', employee_id: 'ana', start_date: '2026-08-03', end_date: '2026-08-03', status: 'pendiente' }), ana], '2026-08-03', '2026-08-03').get('2026-08-03')?.personas[0].status === 'aprobada')

console.log('\n=== saldo antes / después ===')
const emp: VacationEmployee = { id: 'e1', name: 'Ana', user_id: 'u1', started_on: '2025-01-01', ended_on: null, is_active: true, vacation_days_per_month: 1.83 }
const base = { reason: null, created_by: null, resolved_by: null, resolved_at: null, rejection_reason: null, cancelled_by: null, cancelled_at: null, late_notice: false, created_at: '', updated_at: '' }
const reqs: VacationRequest[] = [{ id: 'a', employee_id: 'e1', start_date: '2026-03-02', end_date: '2026-03-06', working_days: 5, status: 'aprobada', ...base }]
const s = saldoAntesDespues(emp, reqs, { start_date: '2026-12-14', end_date: '2026-12-18' }, '2026-11-14')
ok('un año, 5 días', s.length === 1 && s[0].anio === 2026 && s[0].dias === 5)
ok('después = antes − 5', Math.abs(s[0].antes - s[0].despues - 5) < 0.001, JSON.stringify(s))
const pend: VacationRequest = { id: 'p1', employee_id: 'e1', start_date: '2026-12-14', end_date: '2026-12-18', working_days: 5, status: 'pendiente', ...base }
const s2 = saldoAntesDespues(emp, [...reqs, pend], pend, '2026-11-14')
ok('la pendiente que se aprueba no se cuenta dos veces', Math.abs(s2[0].antes - s[0].antes) < 0.001 && Math.abs(s2[0].despues - s[0].despues) < 0.001)
const sm = saldoAntesDespues(emp, reqs, { start_date: '2026-12-07', end_date: '2026-12-11' }, '2026-11-14', festivosDelLugar({ ccaa: 'MD' }))
ok('con festivos de Madrid la semana del 7 de diciembre cuesta 3', sm[0].dias === 3, JSON.stringify(sm))
ok('cruza el año: dos tramos', saldoAntesDespues(emp, reqs, { start_date: '2026-12-28', end_date: '2027-01-05' }, '2026-11-14').length === 2)

console.log('\n=== colores, rangos y avisos ===')
ok('color de la ficha si es válido', colorDePersona('x', '#123ABC') === '#123ABC')
ok('color estable si no', colorDePersona('abc') === colorDePersona('abc') && (PALETA_PERSONAS as readonly string[]).includes(colorDePersona('abc', 'rojo')))
ok('rango bueno', errorDeRango('2026-01-01', '2026-12-31') === null)
ok('rango del revés', errorDeRango('2026-02-01', '2026-01-01') !== null)
ok('rango enorme', errorDeRango('2026-01-01', '2028-01-01') !== null)
ok('rango mal escrito', errorDeRango('2026-1-1', '2026-12-31') !== null && errorDeRango(undefined, null) !== null)
ok('clave del aviso', claveDeAviso('r1', 'pedida') === 'vac:r1:pedida')
const p = avisoDePedida({ nombre: 'Luis', start_date: '2026-08-06', end_date: '2026-08-12', dias: 5, choque: c1, fueraDePlazo: true })
ok('aviso de pedida', p.titulo === 'Luis pide vacaciones' && p.mensaje.includes('choca con Ana') && p.mensaje.includes('fuera de plazo'), p.mensaje)
ok('aviso de denegada con motivo', avisoDeResolucion({ evento: 'rechazada', start_date: '2026-08-06', end_date: '2026-08-12', motivo: 'Cierre de trimestre' }).mensaje.includes('Cierre de trimestre'))
ok('aviso de aprobada', avisoDeResolucion({ evento: 'aprobada', start_date: '2026-08-06', end_date: '2026-08-06' }).titulo === 'Vacaciones aprobadas')
ok('aviso de anulada', avisoDeResolucion({ evento: 'cancelada', start_date: '2026-08-06', end_date: '2026-08-06' }).mensaje.includes('vuelven a tu saldo'))

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
