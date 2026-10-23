import {
  diaCorto,
  diaDeLaSemana,
  diaDeMadrid,
  diaHabilDesde,
  diaRelativo,
  diasEntre,
  diasHabilesEntre,
  esDia,
  esDiaHabil,
  horaDeMadrid,
  horaDeMinutos,
  instanteDeMadrid,
  partesDeMadrid,
  siguienteDiaHabil,
  sumarDias,
  sumarDiasHabiles,
} from '@/lib/correo/secuencias/fechas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== de un instante a la hora de Madrid ===')
{
  const verano = partesDeMadrid(Date.UTC(2026, 9, 23, 7, 0, 0))
  ok('en octubre de 2026 (verano) las 7:00 UTC son las 9:00 de Madrid', verano.dia === '2026-10-23' && verano.hora === 9 && verano.minutos === 540, JSON.stringify(verano))
  ok('y el día de la semana es viernes', verano.diaDeLaSemana === 5)
  const invierno = partesDeMadrid(Date.UTC(2026, 9, 26, 8, 0, 0))
  ok('después del cambio de hora (25 de octubre) las 8:00 UTC son las 9:00', invierno.dia === '2026-10-26' && invierno.hora === 9, JSON.stringify(invierno))
  ok('las 23:30 UTC ya son del día siguiente en Madrid', diaDeMadrid(Date.UTC(2026, 6, 1, 23, 30)) === '2026-07-02')
  ok('el cambio de año: 31 dic 23:30 UTC es 1 de enero en Madrid', diaDeMadrid(Date.UTC(2026, 11, 31, 23, 30)) === '2027-01-01')
}

console.log('\n=== de una hora de Madrid a un instante ===')
{
  ok('9:00 del 23 de octubre = 7:00 UTC', instanteDeMadrid('2026-10-23', 540) === Date.UTC(2026, 9, 23, 7, 0))
  ok('9:00 del 26 de octubre (ya en invierno) = 8:00 UTC', instanteDeMadrid('2026-10-26', 540) === Date.UTC(2026, 9, 26, 8, 0))
  ok('el domingo del cambio de otoño, 9:00 = 8:00 UTC (hora de invierno)', instanteDeMadrid('2026-10-25', 540) === Date.UTC(2026, 9, 25, 8, 0))
  ok('el domingo del cambio de primavera de 2027, 9:00 = 7:00 UTC (hora de verano)', instanteDeMadrid('2027-03-28', 540) === Date.UTC(2027, 2, 28, 7, 0))
  ok('el día del cambio de otoño dura 25 horas', instanteDeMadrid('2026-10-26', 0) - instanteDeMadrid('2026-10-25', 0) === 25 * 3600_000)
  ok('el de primavera, 23', instanteDeMadrid('2027-03-29', 0) - instanteDeMadrid('2027-03-28', 0) === 23 * 3600_000)
  let sinFallo = true
  let hecho = 0
  for (let d = '2026-01-01'; d < '2027-12-31'; d = sumarDias(d, 1)) {
    for (const minutos of [0, 61, 300, 540, 899, 1080, 1439]) {
      // Las 2:00 a 2:59 del día de primavera no existen: se saltan
      if (d === '2027-03-28' && minutos >= 120 && minutos < 180) continue
      const p = partesDeMadrid(instanteDeMadrid(d, minutos))
      hecho++
      if (p.dia !== d || p.minutos !== minutos) sinFallo = false
    }
  }
  ok(`ida y vuelta de ${hecho} horas a lo largo de dos años, incluidos los dos cambios de hora`, sinFallo)
  const hueco = instanteDeMadrid('2027-03-28', 150)
  ok('una hora que no existe (2:30 de primavera) no revienta y cae cerca', Number.isFinite(hueco) && Math.abs(hueco - Date.UTC(2027, 2, 28, 1, 30)) <= 3600_000)
}

console.log('\n=== días ===')
{
  ok('un día válido', esDia('2026-10-23') && esDia('2028-02-29'))
  ok('uno que no existe, no', !esDia('2026-02-30') && !esDia('2026-13-01') && !esDia('2026-1-1') && !esDia('') && !esDia(null) && !esDia(20261023))
  ok('el 23 de octubre de 2026 es viernes', diaDeLaSemana('2026-10-23') === 5)
  ok('sumar días de calendario, también a través del fin de año', sumarDias('2026-12-30', 3) === '2027-01-02' && sumarDias('2026-03-01', -1) === '2026-02-28')
  ok('días entre dos fechas', diasEntre('2026-10-23', '2026-10-30') === 7 && diasEntre('2026-10-30', '2026-10-23') === -7 && diasEntre('2026-10-23', '2026-10-23') === 0)
}

console.log('\n=== días hábiles ===')
{
  ok('lunes a viernes sí, sábado y domingo no', esDiaHabil('2026-10-23') && !esDiaHabil('2026-10-24') && !esDiaHabil('2026-10-25') && esDiaHabil('2026-10-26'))
  ok('un festivo no lo es, ni con lista ni con Set', !esDiaHabil('2026-12-08', ['2026-12-08']) && !esDiaHabil('2026-12-08', new Set(['2026-12-08'])) && esDiaHabil('2026-12-08'))
  ok('desde un sábado, el lunes', diaHabilDesde('2026-10-24') === '2026-10-26' && diaHabilDesde('2026-10-26') === '2026-10-26')
  ok('el siguiente hábil de un viernes es el lunes', siguienteDiaHabil('2026-10-23') === '2026-10-26')
  ok('3 días hábiles después del viernes 23 de octubre: miércoles 28', sumarDiasHabiles('2026-10-23', 3) === '2026-10-28')
  ok('7 días hábiles después: martes 3 de noviembre', sumarDiasHabiles('2026-10-23', 7) === '2026-11-03')
  ok('0 días hábiles desde un sábado: el lunes', sumarDiasHabiles('2026-10-24', 0) === '2026-10-26')
  ok('un festivo entre medias se salta', sumarDiasHabiles('2026-12-04', 2, ['2026-12-08']) === '2026-12-09' && sumarDiasHabiles('2026-12-04', 2) === '2026-12-08')
  ok('días hábiles entre dos días (cuenta el primero, no el último)', diasHabilesEntre('2026-10-23', '2026-10-30') === 5 && diasHabilesEntre('2026-10-23', '2026-10-26') === 1 && diasHabilesEntre('2026-10-30', '2026-10-23') === 0)
}

console.log('\n=== para enseñarlo ===')
{
  ok('día corto', diaCorto('2026-10-28') === 'mié 28 oct' && diaCorto('2027-01-01') === 'vie 1 ene')
  ok('hora de Madrid', horaDeMadrid(Date.UTC(2026, 9, 23, 7, 42)) === '09:42' && horaDeMadrid(Date.UTC(2026, 9, 26, 17, 5)) === '18:05')
  ok('horas desde la medianoche', horaDeMinutos(540) === '9:00' && horaDeMinutos(1080) === '18:00' && horaDeMinutos(965) === '16:05')
  const ahora = Date.UTC(2026, 9, 23, 10, 0)
  ok('hoy, mañana, ayer o el día corto', diaRelativo('2026-10-23', ahora) === 'hoy' && diaRelativo('2026-10-24', ahora) === 'mañana' && diaRelativo('2026-10-22', ahora) === 'ayer' && diaRelativo('2026-10-28', ahora) === 'mié 28 oct')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
