import { choquesCon, describirChoque, ESTADOS_QUE_LIBERAN_EL_HUECO, hayQueComprobarAlEditar, horaDeEspana, mensajeDeHuecoOcupado, ocupaSuHueco, puedeForzarHueco, seSolapan, type CitaQueOcupa } from './ocupado'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Una hora de España (octubre de 2026, ya con el horario de invierno: UTC+1) como instante UTC. «10:00» del viernes 30 = 09:00Z */
const viernes = (hhmm: string): string => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(2026, 9, 30, h - 1, m)).toISOString()
}
const cita = (id: string, de: string, a: string, extra: Partial<CitaQueOcupa> = {}): CitaQueOcupa => ({ id, start_time: viernes(de), end_time: viernes(a), status: 'scheduled', is_external: false, lead_name: 'Merce Lopez', ...extra })
const hueco = (id: string, de: string, a: string): CitaQueOcupa => cita(id, de, a, { is_external: true, lead_name: null })

console.log('\n=== cuándo dos tramos se solapan ===')
{
  ok('el mismo tramo se solapa', seSolapan(10, 11, 10, 11))
  ok('uno que empieza dentro del otro, también (por los dos lados)', seSolapan(10, 12, 11, 13) && seSolapan(11, 13, 10, 12))
  ok('uno metido entero dentro de otro', seSolapan(9, 14, 10, 11) && seSolapan(10, 11, 9, 14))
  ok('DOS REUNIONES SEGUIDAS NO SE SOLAPAN: una acaba a las 11 y la otra empieza a las 11', !seSolapan(10, 11, 11, 12) && !seSolapan(11, 12, 10, 11))
  ok('y dos separadas, menos', !seSolapan(8, 9, 10, 11) && !seSolapan(10, 11, 8, 9))
  ok('por un solo minuto sí', seSolapan(10 * 60, 11 * 60, 11 * 60 - 1, 12 * 60))
}

console.log('\n=== el ejemplo de Raúl: el viernes a las 10 hay algo en el calendario ===')
{
  const calendario = [hueco('g1', '10:00', '11:00')]
  ok('agendar el viernes a las 10 (10:00–11:00) choca con el hueco de Google', choquesCon(viernes('10:00'), viernes('11:00'), calendario).length === 1)
  ok('a las 09:30 (09:30–10:30) también: se mete media hora en el hueco', choquesCon(viernes('09:30'), viernes('10:30'), calendario).length === 1)
  ok('a las 10:30 (10:30–11:30) también', choquesCon(viernes('10:30'), viernes('11:30'), calendario).length === 1)
  ok('a las 09:00 (09:00–10:00) NO: acaba justo cuando empieza el hueco', choquesCon(viernes('09:00'), viernes('10:00'), calendario).length === 0)
  ok('a las 11:00 (11:00–12:00) NO: empieza justo cuando acaba', choquesCon(viernes('11:00'), viernes('12:00'), calendario).length === 0)
  ok('a las 12:00, libre', choquesCon(viernes('12:00'), viernes('13:00'), calendario).length === 0)
  const c = choquesCon(viernes('10:00'), viernes('11:00'), calendario)[0]
  ok('el choque dice que es un hueco de Google y no trae contacto', c.externo && c.con === null && c.id === 'g1')
}

console.log('\n=== choques con otras citas del ERP ===')
{
  const calendario = [cita('a', '09:00', '10:00', { lead_name: 'Merce Lopez' }), cita('b', '12:00', '13:00', { lead_name: 'Jose Luis' })]
  const r = choquesCon(viernes('09:30'), viernes('10:30'), calendario)
  ok('una cita encima de otra choca y dice con quién es', r.length === 1 && r[0].id === 'a' && r[0].con === 'Merce Lopez' && !r[0].externo, JSON.stringify(r))
  ok('la pareja que hay hoy en la base (08:30 y 09:00, de una hora) se habría bloqueado', choquesCon(viernes('09:00'), viernes('10:00'), [cita('x', '08:30', '09:30')]).length === 1)
  ok('una cita entre dos que ya hay choca con las dos, por orden de hora', choquesCon(viernes('09:30'), viernes('12:30'), calendario).map((x) => x.id).join() === 'a,b')
  ok('sin citas no choca con nada', choquesCon(viernes('10:00'), viernes('11:00'), []).length === 0)

  // Los estados: solo las canceladas dejan libre el hueco
  for (const estado of ['scheduled', 'confirmed', 'rescheduled', 'no_show', 'qualified', 'not_qualified']) {
    ok(`una cita ${estado} ocupa su hueco`, choquesCon(viernes('10:00'), viernes('11:00'), [cita('e', '10:00', '11:00', { status: estado })]).length === 1)
  }
  ok('una CANCELADA no lo ocupa (se puede volver a agendar ahí)', choquesCon(viernes('10:00'), viernes('11:00'), [cita('c', '10:00', '11:00', { status: 'cancelled' })]).length === 0)
  ok('una sin estado cuenta como agendada (ocupa)', choquesCon(viernes('10:00'), viernes('11:00'), [cita('s', '10:00', '11:00', { status: null })]).length === 1)
  ok('lo único que libera el hueco es cancelar', [...ESTADOS_QUE_LIBERAN_EL_HUECO].join() === 'cancelled' && !ocupaSuHueco({ status: 'cancelled' }) && ocupaSuHueco({ status: 'scheduled' }))
  ok('un hueco de Google cancelado tampoco ocupa', choquesCon(viernes('10:00'), viernes('11:00'), [{ ...hueco('g', '10:00', '11:00'), status: 'cancelled' }]).length === 0)
}

console.log('\n=== al mover una cita no choca consigo misma ===')
{
  const calendario = [cita('mia', '10:00', '11:00'), hueco('g', '12:00', '13:00')]
  ok('moverla media hora (10:30–11:30) solo la solapa a ella: se ignora', choquesCon(viernes('10:30'), viernes('11:30'), calendario, 'mia').length === 0)
  ok('sin decir cuál es la propia, sí chocaría', choquesCon(viernes('10:30'), viernes('11:30'), calendario).length === 1)
  ok('pero sigue chocando con lo demás', choquesCon(viernes('11:30'), viernes('12:30'), calendario, 'mia').map((x) => x.id).join() === 'g')
}

console.log('\n=== datos raros no revientan ni bloquean ===')
{
  const calendario = [cita('a', '10:00', '11:00')]
  ok('un inicio que no es una fecha no choca con nada', choquesCon('mañana', viernes('11:00'), calendario).length === 0 && choquesCon(null, viernes('11:00'), calendario).length === 0 && choquesCon(undefined, undefined, calendario).length === 0)
  ok('un fin anterior o igual al inicio, tampoco (eso lo valida otro)', choquesCon(viernes('11:00'), viernes('10:00'), calendario).length === 0 && choquesCon(viernes('10:00'), viernes('10:00'), calendario).length === 0)
  ok('una cita de la lista con fechas malas se salta', choquesCon(viernes('10:00'), viernes('11:00'), [{ id: 'x', start_time: 'x', end_time: 'y' }, ...calendario]).length === 1)
  ok('acepta fechas, textos y milisegundos', choquesCon(new Date(viernes('10:00')), new Date(viernes('11:00')).getTime(), calendario).length === 1)
}

console.log('\n=== quién puede agendar encima de un hueco ocupado ===')
{
  ok('un administrador y un socio, sí', puedeForzarHueco('admin') && puedeForzarHueco('partner'))
  ok('un comercial, no', !puedeForzarHueco('employee') && !puedeForzarHueco('comercial'))
  ok('si no se sabe el rol, no', !puedeForzarHueco(null) && !puedeForzarHueco(undefined) && !puedeForzarHueco(''))
}

console.log('\n=== al EDITAR una cita: cuándo hay que mirar el hueco ===')
{
  const base = { inicio: viernes('10:00'), fin: viernes('11:00'), estado: 'scheduled' }
  ok('apuntar una nota (misma hora) no vuelve a mirar: una cita que ya estaba encima de otra se puede seguir editando', !hayQueComprobarAlEditar(base, { ...base }))
  ok('cualificarla o marcar «no asistió» tampoco', !hayQueComprobarAlEditar(base, { ...base, estado: 'qualified' }) && !hayQueComprobarAlEditar(base, { ...base, estado: 'no_show' }))
  ok('la ficha vuelve a mandar la misma hora con segundos distintos: no es un cambio (al minuto)', !hayQueComprobarAlEditar(base, { inicio: new Date(Date.parse(base.inicio) + 20_000).toISOString(), fin: new Date(Date.parse(base.fin) + 40_000).toISOString(), estado: 'scheduled' }))
  ok('cambiarle la hora de inicio, sí', hayQueComprobarAlEditar(base, { ...base, inicio: viernes('12:00'), fin: viernes('13:00') }))
  ok('cambiarle solo la hora de fin (un administrador), también', hayQueComprobarAlEditar(base, { ...base, fin: viernes('12:00') }))
  ok('cambiarla de día, sí', hayQueComprobarAlEditar(base, { ...base, inicio: new Date(Date.parse(base.inicio) + 86_400_000).toISOString(), fin: new Date(Date.parse(base.fin) + 86_400_000).toISOString() }))
  ok('cancelarla NO se mira: libera el hueco, no lo ocupa (aunque cambie la hora)', !hayQueComprobarAlEditar(base, { ...base, estado: 'cancelled' }) && !hayQueComprobarAlEditar(base, { ...base, inicio: viernes('12:00'), fin: viernes('13:00'), estado: 'cancelled' }))
  ok('reactivar una cancelada (sin tocar la hora) SÍ se mira: vuelve a ocupar el hueco', hayQueComprobarAlEditar({ ...base, estado: 'cancelled' }, { ...base, estado: 'scheduled' }))
  ok('una cancelada que se edita y sigue cancelada, no', !hayQueComprobarAlEditar({ ...base, estado: 'cancelled' }, { ...base, estado: 'cancelled', inicio: viernes('12:00'), fin: viernes('13:00') }))
  ok('una hora nueva que no es una fecha no se mira (la ruta ya contesta 400)', !hayQueComprobarAlEditar(base, { inicio: 'nunca', fin: 'jamás', estado: 'scheduled' }))
  ok('si lo que había guardado no se entiende y hay hora nueva, se mira', hayQueComprobarAlEditar({ inicio: 'x', fin: 'y', estado: 'scheduled' }, base))
  ok('sin estado cuenta como agendada', hayQueComprobarAlEditar({ ...base, estado: null }, { ...base, inicio: viernes('12:00'), fin: viernes('13:00'), estado: undefined }))
}

console.log('\n=== lo que se le dice a quien agenda ===')
{
  ok('las horas van en España: 09:00Z del viernes 30 de octubre son las 10:00 (horario de invierno)', horaDeEspana(viernes('10:00')) === '10:00' && horaDeEspana('2026-10-30T09:00:00Z') === '10:00')
  ok('y en verano son +2: 08:00Z de julio = 10:00', horaDeEspana('2026-07-10T08:00:00Z') === '10:00')
  ok('el día que cambia la hora (25 de octubre) las 00:30Z son las 02:30 y la 01:30Z, las 02:30 ya de invierno', horaDeEspana('2026-10-25T00:30:00Z') === '02:30' && horaDeEspana('2026-10-25T01:30:00Z') === '02:30')

  const g = choquesCon(viernes('10:00'), viernes('11:00'), [hueco('g', '10:00', '11:00')])[0]
  const c = choquesCon(viernes('10:00'), viernes('11:00'), [cita('a', '10:30', '11:30', { lead_name: 'Merce Lopez' })])[0]
  ok('un hueco de Google: «un evento del calendario de 10:00 a 11:00»', describirChoque(g) === 'un evento del calendario de 10:00 a 11:00', describirChoque(g))
  ok('una cita: «la cita con «Merce Lopez» de 10:30 a 11:30»', describirChoque(c) === 'la cita con «Merce Lopez» de 10:30 a 11:30', describirChoque(c))
  ok('una cita sin nombre de contacto no dice «null»', describirChoque({ ...c, con: null }) === 'la cita con «otro contacto» de 10:30 a 11:30')
  ok('el aviso de uno', mensajeDeHuecoOcupado([g]) === 'Ese hueco ya está ocupado: un evento del calendario de 10:00 a 11:00. Elige otra hora.', mensajeDeHuecoOcupado([g]))
  ok('el de dos los junta con «y»', mensajeDeHuecoOcupado([g, c]) === 'Ese hueco ya está ocupado: un evento del calendario de 10:00 a 11:00 y la cita con «Merce Lopez» de 10:30 a 11:30. Elige otra hora.')
  ok('el de tres dice cuántos más hay', /\(y 1 más\)\. Elige otra hora\.$/.test(mensajeDeHuecoOcupado([g, c, c])) && /\(y 3 más\)/.test(mensajeDeHuecoOcupado([g, c, c, c, c])))
  ok('sin choques no hay aviso', mensajeDeHuecoOcupado([]) === '')
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
