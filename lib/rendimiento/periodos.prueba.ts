import {
  contieneHoy,
  diasDelRango,
  empiezaEnElFuturo,
  esLaborable,
  etiquetaDePeriodo,
  etiquetaDeRango,
  laborablesEn,
  laborablesTranscurridos,
  lunesDe,
  moverPeriodo,
  periodoDeTexto,
  rangoDe,
  recortarA,
  sumarLaborables,
} from '@/lib/rendimiento/periodos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const j = (x: unknown) => JSON.stringify(x)

/**
 * LOS PERIODOS: UN DÍA, UNA SEMANA, UN MES.
 *
 * Calendario de referencia, octubre de 2026: el 1 es jueves, el 19 es lunes, el 21 miércoles, el 22 jueves (hoy en
 * casi todas las pruebas) y el 25 domingo. El 25 de octubre es además el día del cambio de hora.
 */
const HOY = '2026-10-22'

console.log('\n=== qué días tiene cada periodo ===')
{
  ok('un día es solo él', j(rangoDe({ tipo: 'dia', ancla: '2026-10-21' })) === j({ desde: '2026-10-21', hasta: '2026-10-21' }))
  for (const ancla of ['2026-10-19', '2026-10-21', '2026-10-25']) {
    ok(`la semana de cualquier día (${ancla}) va del lunes 19 al domingo 25`, j(rangoDe({ tipo: 'semana', ancla })) === j({ desde: '2026-10-19', hasta: '2026-10-25' }))
  }
  ok('una semana que cruza de mes: la del 26 de octubre llega al 1 de noviembre', j(rangoDe({ tipo: 'semana', ancla: '2026-10-28' })) === j({ desde: '2026-10-26', hasta: '2026-11-01' }))
  ok('octubre: del 1 al 31', j(rangoDe({ tipo: 'mes', ancla: '2026-10-17' })) === j({ desde: '2026-10-01', hasta: '2026-10-31' }))
  ok('febrero de 2026 acaba el 28 y el de 2028 el 29', rangoDe({ tipo: 'mes', ancla: '2026-02-10' }).hasta === '2026-02-28' && rangoDe({ tipo: 'mes', ancla: '2028-02-10' }).hasta === '2028-02-29')
  ok('el lunes de una semana', lunesDe('2026-10-25') === '2026-10-19' && lunesDe('2026-10-19') === '2026-10-19' && lunesDe('2026-10-22') === '2026-10-19')
  ok('los días de un rango, con los dos extremos', j(diasDelRango({ desde: '2026-10-30', hasta: '2026-11-02' })) === j(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']))
  let lanza = false
  try {
    diasDelRango({ desde: '2025-01-01', hasta: '2026-10-22' })
  } catch {
    lanza = true
  }
  ok('un rango de años se rechaza en vez de recorrerlo', lanza)
}

console.log('\n=== recortar a hoy y contar laborables ===')
{
  ok('una semana en curso se corta en hoy', j(recortarA({ desde: '2026-10-19', hasta: '2026-10-25' }, HOY)) === j({ desde: '2026-10-19', hasta: '2026-10-22' }))
  ok('una ya pasada se queda como está', j(recortarA({ desde: '2026-10-12', hasta: '2026-10-18' }, HOY)) === j({ desde: '2026-10-12', hasta: '2026-10-18' }))
  ok('una que empieza mañana no tiene nada', recortarA({ desde: '2026-10-26', hasta: '2026-11-01' }, HOY) === null)
  ok('una semana tiene 5 laborables, un fin de semana ninguno', laborablesEn({ desde: '2026-10-19', hasta: '2026-10-25' }) === 5 && laborablesEn({ desde: '2026-10-24', hasta: '2026-10-25' }) === 0)
  ok('octubre de 2026 tiene 22 laborables', laborablesEn(rangoDe({ tipo: 'mes', ancla: HOY })) === 22)
  const semana = rangoDe({ tipo: 'semana', ancla: HOY })
  ok('la semana en curso lleva 4 el jueves, 5 el sábado y 0 si todavía no ha empezado', laborablesTranscurridos(semana, '2026-10-22') === 4 && laborablesTranscurridos(semana, '2026-10-24') === 5 && laborablesTranscurridos(semana, '2026-10-18') === 0)
  ok('lunes a viernes son laborables y sábado y domingo no', ['2026-10-19', '2026-10-23'].every(esLaborable) && !esLaborable('2026-10-24') && !esLaborable('2026-10-25'))
}

console.log('\n=== moverse de un periodo a otro ===')
{
  ok('un día: del viernes al lunes y del lunes al viernes, saltando el fin de semana', sumarLaborables('2026-10-23', 1) === '2026-10-26' && sumarLaborables('2026-10-26', -1) === '2026-10-23')
  ok('desde un domingo, hacia atrás cae en el viernes, y desde un sábado, hacia delante en el lunes', sumarLaborables('2026-10-25', -1) === '2026-10-23' && sumarLaborables('2026-10-24', 1) === '2026-10-26')
  ok('cinco laborables son una semana', sumarLaborables('2026-10-22', 5) === '2026-10-29' && sumarLaborables('2026-10-22', -5) === '2026-10-15')
  ok('moverPeriodo de un día', j(moverPeriodo({ tipo: 'dia', ancla: '2026-10-26' }, -1)) === j({ tipo: 'dia', ancla: '2026-10-23' }))
  ok('una semana: el lunes de la anterior y el de la siguiente', j(moverPeriodo({ tipo: 'semana', ancla: '2026-10-22' }, -1)) === j({ tipo: 'semana', ancla: '2026-10-12' }) && j(moverPeriodo({ tipo: 'semana', ancla: '2026-10-22' }, 1)) === j({ tipo: 'semana', ancla: '2026-10-26' }))
  ok('un mes: el día 1 del anterior', j(moverPeriodo({ tipo: 'mes', ancla: '2026-10-22' }, -1)) === j({ tipo: 'mes', ancla: '2026-09-01' }))
  ok('y el cambio de año, hacia atrás y hacia delante', j(moverPeriodo({ tipo: 'mes', ancla: '2026-01-15' }, -1)) === j({ tipo: 'mes', ancla: '2025-12-01' }) && j(moverPeriodo({ tipo: 'mes', ancla: '2025-12-15' }, 1)) === j({ tipo: 'mes', ancla: '2026-01-01' }))
  ok('una semana que pasa de año', j(moverPeriodo({ tipo: 'semana', ancla: '2026-12-30' }, 1)) === j({ tipo: 'semana', ancla: '2027-01-04' }))
  ok('no se puede avanzar a un periodo que empieza después de hoy', empiezaEnElFuturo({ tipo: 'semana', ancla: '2026-10-26' }, HOY) && !empiezaEnElFuturo({ tipo: 'semana', ancla: '2026-10-22' }, HOY) && empiezaEnElFuturo({ tipo: 'dia', ancla: '2026-10-23' }, HOY) && !empiezaEnElFuturo({ tipo: 'mes', ancla: '2026-10-01' }, HOY))
  ok('contieneHoy', contieneHoy({ tipo: 'semana', ancla: '2026-10-19' }, HOY) && !contieneHoy({ tipo: 'semana', ancla: '2026-10-12' }, HOY) && contieneHoy({ tipo: 'dia', ancla: HOY }, HOY))
}

console.log('\n=== cómo se llama cada uno en la barra ===')
{
  ok('hoy y ayer se dicen así', etiquetaDePeriodo({ tipo: 'dia', ancla: HOY }, HOY) === 'Hoy · jueves 22 de octubre' && etiquetaDePeriodo({ tipo: 'dia', ancla: '2026-10-21' }, HOY) === 'Ayer · miércoles 21 de octubre')
  ok('otro día lleva su nombre con mayúscula', etiquetaDePeriodo({ tipo: 'dia', ancla: '2026-10-14' }, HOY) === 'Miércoles 14 de octubre')
  ok('la semana en curso, la pasada y una más antigua', etiquetaDePeriodo({ tipo: 'semana', ancla: HOY }, HOY) === 'Esta semana · 19–25 oct' && etiquetaDePeriodo({ tipo: 'semana', ancla: '2026-10-14' }, HOY) === 'Semana pasada · 12–18 oct' && etiquetaDePeriodo({ tipo: 'semana', ancla: '2026-10-07' }, HOY) === 'Semana · 5–11 oct')
  ok('una semana a caballo entre dos meses', etiquetaDePeriodo({ tipo: 'semana', ancla: '2026-10-28' }, '2026-11-05') === 'Semana pasada · 26 oct – 1 nov')
  ok('el mes en curso, el pasado y uno antiguo', etiquetaDePeriodo({ tipo: 'mes', ancla: HOY }, HOY) === 'Este mes · Octubre 2026' && etiquetaDePeriodo({ tipo: 'mes', ancla: '2026-09-10' }, HOY) === 'Mes pasado · Septiembre 2026' && etiquetaDePeriodo({ tipo: 'mes', ancla: '2026-07-10' }, HOY) === 'Julio 2026')
  ok('el mes pasado en enero es diciembre del año anterior', etiquetaDePeriodo({ tipo: 'mes', ancla: '2025-12-10' }, '2026-01-12') === 'Mes pasado · Diciembre 2025')
  ok('etiqueta de un rango, de un día y de uno que cambia de mes', etiquetaDeRango({ desde: '2026-10-19', hasta: '2026-10-25' }) === '19–25 oct' && etiquetaDeRango({ desde: '2026-10-22', hasta: '2026-10-22' }) === '22 oct' && etiquetaDeRango({ desde: '2026-10-26', hasta: '2026-11-01' }) === '26 oct – 1 nov')
}

console.log('\n=== lo que llega en la dirección no se adivina ===')
{
  ok('un periodo válido se respeta', j(periodoDeTexto('semana', '2026-10-14', HOY)) === j({ tipo: 'semana', ancla: '2026-10-14' }))
  ok('un tipo que no existe es un día', periodoDeTexto('año', '2026-10-14', HOY).tipo === 'dia')
  ok('una fecha mal escrita, o inexistente, es hoy', periodoDeTexto('dia', '2026-02-31', HOY).ancla === HOY && periodoDeTexto('dia', 'ayer', HOY).ancla === HOY && periodoDeTexto('dia', undefined, HOY).ancla === HOY && periodoDeTexto('dia', 5, HOY).ancla === HOY)
  ok('y una del futuro también', periodoDeTexto('semana', '2026-12-01', HOY).ancla === HOY)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
