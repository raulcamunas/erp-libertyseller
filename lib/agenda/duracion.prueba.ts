import { DURACION_CITA_MINUTOS, DURACION_CITA_MS, finDeUnaHora, finQueSeGuarda, tieneDuracionFija } from './duracion'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const minutosEntre = (a: string, b: string): number => (new Date(b).getTime() - new Date(a).getTime()) / 60_000

console.log('\n=== a quién se le impone la hora ===')
{
  ok('una hora, y en milisegundos lo mismo', DURACION_CITA_MINUTOS === 60 && DURACION_CITA_MS === 3_600_000)
  ok('un comercial (employee) la tiene fija', tieneDuracionFija('employee'))
  ok('un cliente, también', tieneDuracionFija('cliente'))
  ok('un administrador no', !tieneDuracionFija('admin'))
  ok('un socio (partner) tampoco', !tieneDuracionFija('partner'))
  ok('si no se sabe el rol, se impone (la regla de la mayoría)', tieneDuracionFija(null) && tieneDuracionFija(undefined) && tieneDuracionFija(''))
}

console.log('\n=== una cita nueva de un comercial dura SIEMPRE una hora ===')
{
  const inicio = '2026-10-28T09:00:00.000Z'
  const sinFin = finQueSeGuarda({ rol: 'employee', inicio, fin: undefined })
  ok('sin hora de fin: el inicio más una hora', sinFin === '2026-10-28T10:00:00.000Z', String(sinFin))
  ok('con una de media hora: la ignora y pone una hora', finQueSeGuarda({ rol: 'employee', inicio, fin: '2026-10-28T09:30:00.000Z' }) === '2026-10-28T10:00:00.000Z')
  ok('con una de quince minutos: igual', finQueSeGuarda({ rol: 'employee', inicio, fin: '2026-10-28T09:15:00.000Z' }) === '2026-10-28T10:00:00.000Z')
  ok('con una de dos horas: también una hora (la duración es fija, no un mínimo)', finQueSeGuarda({ rol: 'employee', inicio, fin: '2026-10-28T11:00:00.000Z' }) === '2026-10-28T10:00:00.000Z')
  ok('con el fin ANTES del inicio (un navegador manipulado): una hora', finQueSeGuarda({ rol: 'employee', inicio, fin: '2026-10-28T08:00:00.000Z' }) === '2026-10-28T10:00:00.000Z')
  ok('con un fin que no es una fecha: una hora', finQueSeGuarda({ rol: 'employee', inicio, fin: 'mañana' }) === '2026-10-28T10:00:00.000Z')
  ok('el resultado dura 60 minutos exactos', minutosEntre(inicio, finQueSeGuarda({ rol: 'employee', inicio, fin: '2026-10-28T09:05:00.000Z' }) as string) === 60)
  ok('sin inicio válido no se puede decidir (la ruta contesta 400)', finQueSeGuarda({ rol: 'employee', inicio: 'nunca', fin: undefined }) === null && finQueSeGuarda({ rol: 'employee', inicio: undefined, fin: '2026-10-28T10:00:00.000Z' }) === null && finQueSeGuarda({ rol: 'employee', inicio: '', fin: null }) === null)
  ok('en otra zona horaria el inicio es el mismo instante: el fin, una hora después', finQueSeGuarda({ rol: 'employee', inicio: '2026-10-28T10:00:00+01:00', fin: undefined }) === '2026-10-28T10:00:00.000Z')
  ok('a las 23:30 el fin pasa a la medianoche siguiente (una hora de reloj, no «hasta las 23:59»)', finQueSeGuarda({ rol: 'employee', inicio: '2026-10-28T23:30:00.000Z', fin: undefined }) === '2026-10-29T00:30:00.000Z')
  ok('el día que se cambia la hora sigue siendo una hora de reloj', minutosEntre('2026-10-25T00:30:00.000Z', finQueSeGuarda({ rol: 'employee', inicio: '2026-10-25T00:30:00.000Z', fin: undefined }) as string) === 60)
  ok('sin rol (el perfil no se pudo leer) también se impone', finQueSeGuarda({ rol: null, inicio, fin: '2026-10-28T09:30:00.000Z' }) === '2026-10-28T10:00:00.000Z')
}

console.log('\n=== un administrador o un socio pone la hora de fin que quiera ===')
{
  const inicio = '2026-10-28T09:00:00.000Z'
  for (const rol of ['admin', 'partner']) {
    ok(`${rol}: la de media hora se queda en media hora`, finQueSeGuarda({ rol, inicio, fin: '2026-10-28T09:30:00.000Z' }) === '2026-10-28T09:30:00.000Z')
    ok(`${rol}: la de dos horas, en dos horas`, finQueSeGuarda({ rol, inicio, fin: '2026-10-28T11:00:00.000Z' }) === '2026-10-28T11:00:00.000Z')
    ok(`${rol}: sin fin en una cita nueva no hay nada que guardar (como siempre)`, finQueSeGuarda({ rol, inicio, fin: undefined }) === null)
    ok(`${rol}: al editar sin mandar fin se queda el de antes`, finQueSeGuarda({ rol, inicio, fin: undefined, anterior: { inicio, fin: '2026-10-28T09:45:00.000Z' } }) === '2026-10-28T09:45:00.000Z')
  }
}

console.log('\n=== al editar una cita de un comercial ===')
{
  const inicio = '2026-10-28T09:00:00.000Z'
  const antigua = { inicio, fin: '2026-10-28T09:30:00.000Z' } // de cuando duraban media hora
  const normal = { inicio, fin: '2026-10-28T10:00:00.000Z' }

  ok('apuntar una nota (misma hora de siempre) en una antigua de media hora NO la alarga: sigue como estaba', finQueSeGuarda({ rol: 'employee', inicio, fin: antigua.fin, anterior: antigua }) === antigua.fin)
  ok('marcarla como cualificada (la ruta solo recibe el estado) tampoco', finQueSeGuarda({ rol: 'employee', inicio: undefined, fin: undefined, anterior: antigua }) === antigua.fin)
  ok('la ficha vuelve a mandar la hora con segundos distintos: no cuenta como cambio (al minuto)', finQueSeGuarda({ rol: 'employee', inicio: '2026-10-28T09:00:20.000Z', fin: '2026-10-28T09:30:40.000Z', anterior: antigua }) === antigua.fin)
  ok('y lo que se devuelve es EXACTAMENTE lo que había guardado (no se reformatea)', finQueSeGuarda({ rol: 'employee', inicio, fin: '2026-10-28T09:30:00Z', anterior: { inicio, fin: '2026-10-28T09:30:00+00:00' } }) === '2026-10-28T09:30:00+00:00')

  ok('mover una antigua a otro día: pasa a una hora', finQueSeGuarda({ rol: 'employee', inicio: '2026-10-29T15:00:00.000Z', fin: '2026-10-29T15:30:00.000Z', anterior: antigua }) === '2026-10-29T16:00:00.000Z')
  ok('mover una de una hora: sigue siendo de una hora', finQueSeGuarda({ rol: 'employee', inicio: '2026-10-29T15:00:00.000Z', fin: '2026-10-29T16:00:00.000Z', anterior: normal }) === '2026-10-29T16:00:00.000Z')
  ok('arrastrarla a otra hora (el calendario manda el nuevo inicio y el nuevo fin)', finQueSeGuarda({ rol: 'employee', inicio: '2026-10-28T14:30:00.000Z', fin: '2026-10-28T15:30:00.000Z', anterior: normal }) === '2026-10-28T15:30:00.000Z')
  ok('acortar una de una hora a media: no se puede, vuelve a una hora', finQueSeGuarda({ rol: 'employee', inicio, fin: '2026-10-28T09:30:00.000Z', anterior: normal }) === '2026-10-28T10:00:00.000Z')
  ok('acortar solo mandando el fin (sin inicio): una hora desde el inicio de siempre', finQueSeGuarda({ rol: 'employee', inicio: undefined, fin: '2026-10-28T09:15:00.000Z', anterior: normal }) === '2026-10-28T10:00:00.000Z')
  ok('acortar una que ya era de media hora a quince minutos: tampoco, pasa a una hora', finQueSeGuarda({ rol: 'employee', inicio, fin: '2026-10-28T09:15:00.000Z', anterior: antigua }) === '2026-10-28T10:00:00.000Z')
  ok('alargar la hora de inicio sola (la de fin sin tocar): una hora desde el inicio nuevo', finQueSeGuarda({ rol: 'employee', inicio: '2026-10-28T09:30:00.000Z', fin: antigua.fin, anterior: antigua }) === '2026-10-28T10:30:00.000Z')
  ok('un inicio nuevo que no es una fecha: no se puede decidir', finQueSeGuarda({ rol: 'employee', inicio: 'pronto', fin: antigua.fin, anterior: antigua }) === null)
}

console.log('\n=== la hora de fin que propone la pantalla ===')
{
  ok('una hora después del inicio', finDeUnaHora('2026-10-28T09:00:00.000Z')?.toISOString() === '2026-10-28T10:00:00.000Z')
  ok('con una fecha ya hecha', finDeUnaHora(new Date('2026-10-28T09:00:00.000Z'))?.toISOString() === '2026-10-28T10:00:00.000Z')
  ok('con los milisegundos de un instante', finDeUnaHora(Date.parse('2026-10-28T09:00:00.000Z'))?.toISOString() === '2026-10-28T10:00:00.000Z')
  ok('con algo que no es una fecha, nada', finDeUnaHora('nunca') === null && finDeUnaHora(null) === null && finDeUnaHora(undefined) === null && finDeUnaHora(new Date('x')) === null)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
