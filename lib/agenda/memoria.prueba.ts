import { fusionarRangos, haceCuanto, iguales, semanasViejas, type Rango } from './memoria'
import { limitesDeSemanas, lunesDeLaClave } from './semanas'
import type { AppointmentWithPeople } from '@/lib/types/appointments'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Una hora de España (octubre de 2026, horario de invierno: UTC+1) del día 26 + `dia`, como instante UTC */
const a = (dia: number, hhmm: string): string => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(2026, 9, 26 + dia, h - 1, m)).toISOString()
}
const cita = (id: string, dia: number, hhmm: string, extra: Record<string, unknown> = {}): AppointmentWithPeople =>
  ({
    id,
    lead_name: `Lead ${id}`,
    start_time: a(dia, hhmm),
    end_time: a(dia, '23:00'),
    status: 'scheduled',
    is_external: false,
    comercial: { id: 'u1', full_name: 'Ana', email: 'ana@x.es', role: 'employee', calendar_color: null },
    details: { x: 1 },
    ...extra,
  }) as unknown as AppointmentWithPeople
const memoriaDe = (...citas: AppointmentWithPeople[]) => new Map(citas.map((c) => [c.id, c]))
const semana = (clave: string, semanas = 1): Rango => limitesDeSemanas(lunesDeLaClave(clave)!, semanas)

console.log('\n=== cuándo dos valores de la base son lo mismo ===')
{
  ok('lo idéntico', iguales(cita('a', 0, '10:00'), cita('a', 0, '10:00')))
  ok('un campo distinto', !iguales(cita('a', 0, '10:00'), cita('a', 0, '10:00', { status: 'cancelled' })))
  ok('un objeto de dentro distinto', !iguales(cita('a', 0, '10:00'), cita('a', 0, '10:00', { comercial: { id: 'u2', full_name: 'Ana', email: 'ana@x.es', role: 'employee', calendar_color: null } })))
  ok('un campo que falta en uno', !iguales({ a: 1, b: 2 }, { a: 1 }))
  ok('un `undefined` cuenta como si no estuviera (las columnas de la 214 que una lectura trae y otra no)', iguales({ a: 1, b: undefined }, { a: 1 }) && iguales({ a: 1 }, { a: 1, b: undefined }))
  ok('pero `null` no es lo mismo que no estar', !iguales({ a: 1, b: null }, { a: 1 }))
  ok('listas: mismo orden y mismo contenido', iguales([1, 2, { x: 3 }], [1, 2, { x: 3 }]) && !iguales([1, 2], [2, 1]) && !iguales([1], [1, 2]))
  ok('una lista no es un objeto', !iguales([], {}) && !iguales({}, []))
  ok('nulos y primitivos', iguales(null, null) && !iguales(null, 0) && !iguales('1', 1) && iguales('x', 'x') && !iguales(null, {}))
}

console.log('\n=== lo leído manda dentro de lo que se leyó ===')
{
  const lunes = semana('2026-10-26')
  const m = memoriaDe(cita('a', 0, '10:00'), cita('b', 1, '11:00'))

  const sinCambios = fusionarRangos(m, [lunes], [cita('a', 0, '10:00'), cita('b', 1, '11:00')])
  ok('si todo coincide devuelve LA MISMA memoria (no se repinta nada)', sinCambios === m)

  const cambiada = fusionarRangos(m, [lunes], [cita('a', 0, '10:00', { status: 'cancelled' }), cita('b', 1, '11:00')])
  ok('una cita que cambió se sustituye', (cambiada.get('a') as { status: string }).status === 'cancelled' && cambiada !== m)
  ok('y la que no cambió conserva el MISMO objeto (los bloques memorizados no se repintan)', cambiada.get('b') === m.get('b'))
  ok('la memoria de entrada no se toca', (m.get('a') as { status: string }).status === 'scheduled' && m.size === 2)

  const conNueva = fusionarRangos(m, [lunes], [cita('a', 0, '10:00'), cita('b', 1, '11:00'), cita('c', 2, '12:00')])
  ok('una cita nueva entra (la que se creó en la otra pestaña mientras esta dormía)', conNueva.size === 3 && conNueva.has('c'))

  const sinB = fusionarRangos(m, [lunes], [cita('a', 0, '10:00')])
  ok('una que estaba dentro del rango y ya no llega se quita (se borró en la otra pestaña)', sinB.size === 1 && !sinB.has('b') && sinB.get('a') === m.get('a'))

  const vacia = fusionarRangos(m, [lunes], [])
  ok('una semana que se lee vacía vacía lo que había en ella', vacia.size === 0)
}

console.log('\n=== lo que cae fuera de lo leído no se toca ===')
{
  const m = memoriaDe(cita('esta', 0, '10:00'), cita('proxima', 7, '10:00'), cita('anterior', -7, '10:00'))
  const r = fusionarRangos(m, [semana('2026-10-26')], [cita('esta', 0, '10:00')])
  ok('las citas de otras semanas se quedan aunque no lleguen', r.has('proxima') && r.has('anterior') && r.size === 3)
  ok('y siguen siendo el mismo objeto', r.get('proxima') === m.get('proxima') && r.get('anterior') === m.get('anterior'))

  const tres = fusionarRangos(m, [semana('2026-10-19', 3)], [cita('esta', 0, '10:00')])
  ok('con tres semanas leídas de golpe, las de en medio se limpian y se quitan las que ya no están', tres.size === 1 && tres.has('esta'))

  const dos = fusionarRangos(m, [semana('2026-10-19'), semana('2026-11-02')], [cita('anterior', -7, '10:00')])
  ok('con dos rangos sueltos, la semana del medio (que no se leyó) se respeta y la que sí se leyó y no trajo la cita la pierde', dos.has('esta') && dos.has('anterior') && !dos.has('proxima'))
}

console.log('\n=== lo que se acaba de arrastrar y el servidor aún no ha confirmado ===')
{
  const lunes = semana('2026-10-26')
  // En pantalla la cita ya está en su sitio nuevo (martes 12:00); la base todavía la tiene a las 10:00
  const enPantalla = cita('arrastrada', 1, '12:00')
  const m = memoriaDe(enPantalla, cita('otra', 2, '10:00'))
  const lecturaVieja = [cita('arrastrada', 1, '10:00'), cita('otra', 2, '10:00', { status: 'cancelled' })]
  const r = fusionarRangos(m, [lunes], lecturaVieja, new Set(['arrastrada']))
  ok('una lectura que trae la hora vieja NO la devuelve a su sitio', r.get('arrastrada') === enPantalla)
  ok('mientras las demás sí se ponen al día', (r.get('otra') as unknown as { status: string }).status === 'cancelled')
  const r2 = fusionarRangos(m, [lunes], [cita('otra', 2, '10:00')], new Set(['arrastrada']))
  ok('tampoco se quita si la lectura no la trae', r2.has('arrastrada'))
  const r3 = fusionarRangos(m, [lunes], lecturaVieja)
  ok('sin protegerla, sí se pisa (por eso existe la protección)', r3.get('arrastrada')!.start_time === a(1, '10:00'))
  ok('un conjunto vacío no cambia nada', fusionarRangos(m, [lunes], [enPantalla, m.get('otra')!], new Set()) === m)
}

console.log('\n=== los bordes de la semana ===')
{
  // El lunes 2 de noviembre a las 00:00 de Madrid (23:00Z del domingo) es de la semana de después
  const lunesSiguiente = cita('borde', 7, '00:00')
  const m = memoriaDe(lunesSiguiente)
  ok('una cita a las 00:00 del lunes siguiente NO está en la semana que se lee: no se quita', fusionarRangos(m, [semana('2026-10-26')], []).has('borde'))
  ok('pero sí en la siguiente: ahí sí se quita si no llega', !fusionarRangos(m, [semana('2026-11-02')], []).has('borde'))
  const domingoNoche = cita('domingo', 6, '23:30')
  ok('el domingo a las 23:30 de Madrid sigue siendo de esa semana', !fusionarRangos(memoriaDe(domingoNoche), [semana('2026-10-26')], []).has('domingo'))
}

console.log('\n=== una cita que se movió de semana ===')
{
  const m = memoriaDe(cita('mov', 1, '10:00'))
  const r = fusionarRangos(m, [semana('2026-10-26', 2)], [cita('mov', 8, '10:00')])
  ok('si llega con otra hora dentro de lo leído, se sustituye (no se duplica)', r.size === 1 && r.get('mov')!.start_time === a(8, '10:00'))
  const r2 = fusionarRangos(m, [semana('2026-10-26')], [])
  ok('si se movió fuera de lo leído, deja de estar en la semana en la que estaba', !r2.has('mov'))
}

console.log('\n=== qué semanas llevan tiempo sin confirmarse ===')
{
  const ahora = 1_000_000
  const conf = new Map([
    ['2026-10-19', ahora - 5_000],
    ['2026-10-26', ahora - 40_000],
    ['2026-11-02', 0],
  ])
  const r = semanasViejas(conf, ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'], ahora, 15_000)
  ok('las de más de 15 s y las que vienen del servidor (con 0) son viejas', r.join() === '2026-10-26,2026-11-02', r.join())
  ok('la reciente no, y la que no está en memoria tampoco (esa se pide entera)', !r.includes('2026-10-19') && !r.includes('2026-11-09'))
  ok('justo en el límite todavía vale', semanasViejas(new Map([['x', ahora - 15_000]]), ['x'], ahora, 15_000).length === 0)
}

console.log('\n=== hace cuánto ===')
{
  const t = 10_000_000
  ok('menos de un minuto se dice un minuto', haceCuanto(t - 5_000, t) === 'hace 1 min')
  ok('minutos', haceCuanto(t - 3 * 60_000 - 20_000, t) === 'hace 3 min')
  ok('horas', haceCuanto(t - 2 * 3_600_000 - 5 * 60_000, t) === 'hace 2 h')
  ok('días', haceCuanto(t - 50 * 3_600_000, t) === 'hace 2 d')
  ok('un reloj adelantado no da números raros', haceCuanto(t + 60_000, t) === 'hace 1 min')
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
