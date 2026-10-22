import { diaConSemana, diaLargo, diaLocal, diasEntre, etiquetaDeVencimiento, haceCuanto, sumarDias, vencimientoDe } from '@/lib/cold-calling/fechas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LOS DÍAS Y LOS «HACE CUÁNTO».
 *
 * Lo que se vigila: que «hoy» sea el día del calendario de quien mira y no el de UTC, que sumar días no se rompa con los
 * cambios de hora (el 25 de octubre dura 25 horas y el 29 de marzo 23) y que cada rellamada diga con claridad si está
 * atrasada, es de hoy o de más adelante.
 */

console.log('\n=== hoy y los días ===')
{
  ok('el día de una fecha local', diaLocal(new Date(2026, 9, 22, 23, 59)) === '2026-10-22' && diaLocal(new Date(2026, 0, 5, 0, 0)) === '2026-01-05')
  ok('sumar un día', sumarDias('2026-10-22', 1) === '2026-10-23' && sumarDias('2026-10-31', 1) === '2026-11-01' && sumarDias('2026-12-31', 1) === '2027-01-01')
  ok('restar días', sumarDias('2026-03-01', -1) === '2026-02-28' && sumarDias('2026-10-22', -22) === '2026-09-30')
  ok('sumar días a través del cambio de hora de octubre', sumarDias('2026-10-24', 1) === '2026-10-25' && sumarDias('2026-10-25', 1) === '2026-10-26')
  ok('y del de marzo', sumarDias('2026-03-28', 1) === '2026-03-29' && sumarDias('2026-03-29', 1) === '2026-03-30')
  ok('un día que no es una fecha se deja como está', sumarDias('mañana', 1) === 'mañana')
  ok('días entre dos fechas', diasEntre('2026-10-22', '2026-10-25') === 3 && diasEntre('2026-10-25', '2026-10-22') === -3 && diasEntre('2026-10-22', '2026-10-22') === 0)
  ok('contados en el calendario aunque cambie la hora entre medias', diasEntre('2026-10-24', '2026-10-26') === 2 && diasEntre('2026-03-28', '2026-03-30') === 2)
  ok('de un año a otro', diasEntre('2026-12-30', '2027-01-02') === 3)
}

console.log('\n=== cómo se escribe un día ===')
{
  ok('«12 de agosto»', diaLargo('2026-08-12') === '12 de agosto' && diaLargo('2026-01-01') === '1 de enero')
  ok('con el día de la semana', diaConSemana('2026-10-22') === 'jueves 22 de octubre', diaConSemana('2026-10-22'))
  ok('lo que no es un día se deja como llegó', diaLargo('nunca') === 'nunca' && diaConSemana('nunca') === 'nunca')
}

console.log('\n=== cómo está una rellamada ===')
{
  const hoy = '2026-10-22'
  ok('sin fecha: nada que decir', vencimientoDe(null, hoy) === null && etiquetaDeVencimiento(null, hoy) === '' && vencimientoDe('', hoy) === null)
  ok('de hoy', vencimientoDe('2026-10-22', hoy)?.tipo === 'hoy' && etiquetaDeVencimiento('2026-10-22', hoy) === 'hoy')
  ok('de mañana', vencimientoDe('2026-10-23', hoy)?.tipo === 'manana' && etiquetaDeVencimiento('2026-10-23', hoy) === 'mañana')
  ok('atrasada, con los días que lleva así', etiquetaDeVencimiento('2026-10-19', hoy) === 'atrasada 3 d' && (vencimientoDe('2026-10-19', hoy) as { dias: number }).dias === 3)
  ok('ayer es atrasada 1 d', etiquetaDeVencimiento('2026-10-21', hoy) === 'atrasada 1 d')
  ok('más adelante, con su fecha', etiquetaDeVencimiento('2026-11-12', hoy) === '12 nov' && vencimientoDe('2026-11-12', hoy)?.tipo === 'futura')
  ok('una fecha que no es una fecha no dice nada', etiquetaDeVencimiento('pronto', hoy) === '')
  ok('sin «hoy» (el servidor no sabe el calendario de quien mira) no se inventa nada', vencimientoDe('2026-10-22', '') === null && etiquetaDeVencimiento('2026-10-22', '') === '')
}

console.log('\n=== hace cuánto ===')
{
  const ahora = Date.parse('2026-10-22T12:00:00.000Z')
  const antes = (ms: number) => new Date(ahora - ms).toISOString()
  const min = 60_000
  ok('hace nada', haceCuanto(antes(20_000), ahora) === 'ahora')
  ok('minutos', haceCuanto(antes(12 * min), ahora) === 'hace 12 min' && haceCuanto(antes(59 * min), ahora) === 'hace 59 min')
  ok('horas', haceCuanto(antes(60 * min), ahora) === 'hace 1 h' && haceCuanto(antes(3 * 60 * min + 20 * min), ahora) === 'hace 3 h' && haceCuanto(antes(23 * 60 * min), ahora) === 'hace 23 h')
  ok('días', haceCuanto(antes(24 * 60 * min), ahora) === 'hace 1 d' && haceCuanto(antes(13 * 24 * 60 * min), ahora) === 'hace 13 d')
  ok('pasadas dos semanas, la fecha', haceCuanto(antes(20 * 24 * 60 * min), ahora) === '2 oct', haceCuanto(antes(20 * 24 * 60 * min), ahora))
  ok('de otro año, con el año', haceCuanto('2025-03-04T10:00:00.000Z', ahora) === '4 mar 2025', haceCuanto('2025-03-04T10:00:00.000Z', ahora))
  ok('acepta un número o una fecha', haceCuanto(ahora - 5 * 60 * min, ahora) === 'hace 5 h' && haceCuanto(new Date(ahora - 2 * 60 * min), ahora) === 'hace 2 h')
  ok('un instante en el futuro (el reloj de otro ordenador) no rompe nada', haceCuanto(new Date(ahora + 5 * min).toISOString(), ahora) === 'ahora')
  ok('un texto que no es una fecha, nada', haceCuanto('ayer', ahora) === '')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
