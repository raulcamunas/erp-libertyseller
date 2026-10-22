import {
  diaMadrid,
  diasDelMes,
  esDia,
  etiquetaDeDia,
  etiquetaDeMes,
  horaMadrid,
  indiceDeSemana,
  inicioDelDia,
  mesDe,
  rangoDelDia,
  rangoDelMes,
  sumarDias,
  sumarMeses,
} from '@/lib/rendimiento/dia'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const iso = (d: Date) => d.toISOString()

/**
 * LOS DÍAS DEL PANEL, EN HORA DE MADRID.
 *
 * El fallo que se evita: sacar el día cortando el texto ISO. Una llamada a las 00:30 del 22 de
 * octubre (hora de Madrid) llega como «2026-10-21T22:30:00Z» y caería en el día 21.
 */

console.log('\n=== a qué día pertenece una llamada ===')
{
  ok('a las 14:01 de Madrid (12:01 UTC) sigue siendo el mismo día', diaMadrid('2026-10-21T12:01:26.352Z') === '2026-10-21')
  ok('00:30 del 22 en Madrid llega como 22:30Z del 21 y es del 22, no del 21', diaMadrid('2026-10-21T22:30:00Z') === '2026-10-22', diaMadrid('2026-10-21T22:30:00Z'))
  ok('23:59 del 21 en Madrid (21:59Z) es del 21', diaMadrid('2026-10-21T21:59:59Z') === '2026-10-21')
  ok('en invierno (UTC+1): 23:30 UTC del 15 de enero ya es 00:30 del 16', diaMadrid('2026-01-15T23:30:00Z') === '2026-01-16')
  ok('la hora se escribe como la ve el comercial', horaMadrid('2026-10-21T12:01:26.352Z') === '14:01' && horaMadrid('2026-01-15T23:30:00Z') === '00:30')
}

console.log('\n=== el principio y el final de un día ===')
{
  ok('en verano el día empieza a las 22:00Z del anterior', iso(inicioDelDia('2026-10-21')) === '2026-10-20T22:00:00.000Z', iso(inicioDelDia('2026-10-21')))
  ok('en invierno empieza a las 23:00Z del anterior', iso(inicioDelDia('2026-01-15')) === '2026-01-14T23:00:00.000Z', iso(inicioDelDia('2026-01-15')))
  const r = rangoDelDia('2026-10-21')
  ok('[desde, hasta) mide 24 h en un día normal', r.hasta.getTime() - r.desde.getTime() === 24 * 3_600_000)
  ok('y la llamada de las 00:30 del 22 cae FUERA del 21 y DENTRO del 22', new Date('2026-10-21T22:30:00Z') >= rangoDelDia('2026-10-22').desde && new Date('2026-10-21T22:30:00Z') < rangoDelDia('2026-10-21').hasta === false)
}

console.log('\n=== los cambios de hora ===')
{
  // 2026: el cambio de verano es el domingo 29 de marzo (a las 02:00 pasan a ser las 03:00) y el de invierno el 25 de octubre
  const corto = rangoDelDia('2026-03-29')
  const largo = rangoDelDia('2026-10-25')
  ok('el 29 de marzo dura 23 horas', corto.hasta.getTime() - corto.desde.getTime() === 23 * 3_600_000, `${(corto.hasta.getTime() - corto.desde.getTime()) / 3_600_000} h`)
  ok('el 25 de octubre dura 25 horas', largo.hasta.getTime() - largo.desde.getTime() === 25 * 3_600_000, `${(largo.hasta.getTime() - largo.desde.getTime()) / 3_600_000} h`)
  ok('el 29 de marzo empieza en horario de invierno (23:00Z del 28)', iso(corto.desde) === '2026-03-28T23:00:00.000Z', iso(corto.desde))
  ok('y el 30 de marzo ya en horario de verano (22:00Z del 29)', iso(inicioDelDia('2026-03-30')) === '2026-03-29T22:00:00.000Z', iso(inicioDelDia('2026-03-30')))
  ok('el 25 de octubre empieza en horario de verano (22:00Z del 24)', iso(largo.desde) === '2026-10-24T22:00:00.000Z', iso(largo.desde))
  ok('y el 26 de octubre ya en invierno (23:00Z del 25)', iso(inicioDelDia('2026-10-26')) === '2026-10-25T23:00:00.000Z', iso(inicioDelDia('2026-10-26')))
  ok('una llamada de la 01:30 del 25 de octubre (23:30Z del 24) es del 25', diaMadrid('2026-10-24T23:30:00Z') === '2026-10-25')
  // La repetida: a las 02:30 hay dos veces en el día de 25 horas; las dos son del 25
  ok('las dos 02:30 del 25 de octubre (00:30Z y 01:30Z) son del 25', diaMadrid('2026-10-25T00:30:00Z') === '2026-10-25' && diaMadrid('2026-10-25T01:30:00Z') === '2026-10-25')
}

console.log('\n=== aritmética de calendario ===')
{
  ok('un día después, también a fin de mes', sumarDias('2026-10-31', 1) === '2026-11-01' && sumarDias('2026-12-31', 1) === '2027-01-01')
  ok('un día antes, a principio de año', sumarDias('2026-01-01', -1) === '2025-12-31')
  ok('el 28 de febrero de un año bisiesto tiene siguiente', sumarDias('2028-02-28', 1) === '2028-02-29' && sumarDias('2026-02-28', 1) === '2026-03-01')
  ok('esDia distingue una fecha real de una inventada', esDia('2026-10-21') && !esDia('2026-02-31') && !esDia('2026-13-01') && !esDia('21/10/2026'))
  ok('sumar meses con desbordamiento de año', JSON.stringify(sumarMeses(2026, 12, 1)) === '{"anio":2027,"mes":1}' && JSON.stringify(sumarMeses(2026, 1, -1)) === '{"anio":2025,"mes":12}' && JSON.stringify(sumarMeses(2026, 10, 14)) === '{"anio":2027,"mes":12}')
  ok('el mes de un día', JSON.stringify(mesDe('2026-10-21')) === '{"anio":2026,"mes":10}')
}

console.log('\n=== el mes entero ===')
{
  ok('octubre de 2026 tiene 31 días', diasDelMes(2026, 10).length === 31 && diasDelMes(2026, 10)[0] === '2026-10-01' && diasDelMes(2026, 10)[30] === '2026-10-31')
  ok('febrero de 2026 tiene 28 y el de 2028, 29', diasDelMes(2026, 2).length === 28 && diasDelMes(2028, 2).length === 29)
  const mes = rangoDelMes(2026, 10)
  ok('octubre de 2026 mide 31 días y una hora (el cambio a invierno)', mes.hasta.getTime() - mes.desde.getTime() === (31 * 24 + 1) * 3_600_000, `${(mes.hasta.getTime() - mes.desde.getTime()) / 3_600_000} h`)
  ok('empieza el 30 de septiembre a las 22:00Z y acaba el 31 de octubre a las 23:00Z', iso(mes.desde) === '2026-09-30T22:00:00.000Z' && iso(mes.hasta) === '2026-10-31T23:00:00.000Z', `${iso(mes.desde)} · ${iso(mes.hasta)}`)
}

console.log('\n=== la semana empieza en lunes ===')
{
  ok('el 21 de octubre de 2026 es miércoles (2)', indiceDeSemana('2026-10-21') === 2)
  ok('el lunes es 0 y el domingo es 6', indiceDeSemana('2026-10-19') === 0 && indiceDeSemana('2026-10-25') === 6)
  ok('octubre de 2026 empieza en jueves (3)', indiceDeSemana('2026-10-01') === 3)
}

console.log('\n=== etiquetas ===')
{
  ok('mes', etiquetaDeMes(2026, 10) === 'octubre 2026')
  ok('día', etiquetaDeDia('2026-10-21') === 'miércoles 21 de octubre' && etiquetaDeDia('2026-10-21', true) === 'miércoles 21 de octubre de 2026')
  let lanza = false
  try {
    inicioDelDia('21/10/2026')
  } catch {
    lanza = true
  }
  ok('un día mal escrito no se adivina: se rechaza', lanza)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
