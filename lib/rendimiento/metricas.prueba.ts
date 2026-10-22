import {
  SEGUNDOS_DE_CONVERSACION,
  actividadDeNotas,
  agruparPorDia,
  citasAgendadasEl,
  duracionCorta,
  intensidad,
  mesDeLlamadas,
  resumenDeLlamadas,
  tiempoHablado,
  type LlamadaParaMetricas,
} from '@/lib/rendimiento/metricas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LAS CIFRAS DEL PANEL.
 *
 * El caso de referencia es el 21 de octubre de 2026, que se midió contra el Excel de la centralita:
 * 52 llamadas salientes, 34 contestadas, 18 sin contestar, 24 min 20 s hablados, 9 de un minuto o más.
 */

let n = 0
const llamada = (hora: string, estado: 'ANSWERED' | 'MISSED', duracion: number, extra: Partial<LlamadaParaMetricas> = {}): LlamadaParaMetricas => ({
  // La hora es la de Madrid de ese día (verano: UTC+2)
  fecha: `2026-10-21T${String(Number(hora.slice(0, 2)) - 2).padStart(2, '0')}${hora.slice(2)}:00Z`,
  direccion: 'outbound',
  estado,
  duracion_s: duracion,
  numero: `+346220000${String((n += 1) % 100).padStart(2, '0')}`,
  grabacion_id: estado === 'ANSWERED' ? `rec-${n}` : null,
  ...extra,
})

console.log('\n=== un día de llamadas ===')
{
  const dia = [
    llamada('10:24', 'ANSWERED', 90),
    llamada('10:31', 'ANSWERED', 25),
    llamada('10:40', 'MISSED', 36),
    llamada('11:02', 'ANSWERED', 142),
    llamada('11:15', 'MISSED', 1),
    llamada('12:00', 'ANSWERED', 60),
    llamada('12:30', 'ANSWERED', 59),
    llamada('13:00', 'ANSWERED', 120, { direccion: 'inbound' }),
    llamada('13:10', 'MISSED', 0, { direccion: 'inbound' }),
  ]
  const r = resumenDeLlamadas(dia)
  ok('todas: 9', r.total === 9)
  ok('realizadas son las salientes: 7', r.realizadas === 7, String(r.realizadas))
  ok('recibidas son las entrantes: 2', r.recibidas === 2)
  ok('contestadas: de las SALIENTES, 5 (90, 25, 142, 60 y 59 s)', r.contestadas === 5, String(r.contestadas))
  ok('la tasa de contacto es contestadas entre realizadas', Math.abs(r.tasaDeContacto - 5 / 7) < 1e-9)
  ok('el tiempo hablado suma las contestadas de los dos sentidos: 90+25+142+60+59+120 = 496 s', r.segundosHablados === 496, String(r.segundosHablados))
  ok(`una conversación dura ${SEGUNDOS_DE_CONVERSACION} s o más: 90, 142, 60 y 120 (la de 59 s no)`, r.conversaciones === 4, String(r.conversaciones))
  ok('con grabación: las contestadas', r.conGrabacion === 6, String(r.conGrabacion))
  ok('números distintos a los que se llamó (solo realizadas)', r.numerosDistintos === 7, String(r.numerosDistintos))
  ok('la primera y la última', r.primera === '2026-10-21T08:24:00Z' && r.ultima === '2026-10-21T11:10:00Z', `${r.primera} · ${r.ultima}`)
}

console.log('\n=== un día sin llamadas ===')
{
  const r = resumenDeLlamadas([])
  ok('todo a cero y sin horas, sin dividir entre cero', r.total === 0 && r.realizadas === 0 && r.tasaDeContacto === 0 && r.primera === null && r.ultima === null)
  const dosVeces = resumenDeLlamadas([])
  dosVeces.total = 99
  ok('y un resumen vacío no comparte estado con otro', resumenDeLlamadas([]).total === 0)
}

console.log('\n=== el mismo número, llamado varias veces ===')
{
  const mismo = '+34600112233'
  const r = resumenDeLlamadas([llamada('10:00', 'MISSED', 0, { numero: mismo }), llamada('10:10', 'MISSED', 0, { numero: mismo }), llamada('10:20', 'ANSWERED', 40, { numero: mismo })])
  ok('3 llamadas realizadas a 1 número distinto', r.realizadas === 3 && r.numerosDistintos === 1)
  ok('un número oculto no cuenta como número distinto', resumenDeLlamadas([llamada('10:00', 'MISSED', 0, { numero: null }), llamada('10:10', 'MISSED', 0, { numero: null })]).numerosDistintos === 0)
}

console.log('\n=== una llamada de madrugada cae en SU día de Madrid ===')
{
  const l = [
    { ...llamada('10:00', 'ANSWERED', 10), fecha: '2026-10-21T22:30:00Z' }, // 00:30 del 22 en Madrid
    { ...llamada('10:00', 'ANSWERED', 10), fecha: '2026-10-21T21:59:00Z' }, // 23:59 del 21
  ]
  const p = agruparPorDia(l)
  ok('la de 00:30 es del 22 y la de 23:59 es del 21', p.get('2026-10-22')?.length === 1 && p.get('2026-10-21')?.length === 1)
  ok('los días sin llamadas no aparecen', !p.has('2026-10-20'))
}

console.log('\n=== el calendario del mes ===')
{
  const llamadas = [llamada('10:00', 'ANSWERED', 30), llamada('10:10', 'MISSED', 0), llamada('10:20', 'ANSWERED', 80)]
  const otroDia = { ...llamada('10:00', 'ANSWERED', 30), fecha: '2026-10-05T08:00:00Z' }
  const delMesAnterior = { ...llamada('10:00', 'ANSWERED', 30), fecha: '2026-09-29T08:00:00Z' }
  const mes = mesDeLlamadas(2026, 10, [...llamadas, otroDia, delMesAnterior])
  ok('31 celdas', mes.celdas.length === 31)
  ok('octubre de 2026 empieza en jueves: 3 huecos con la semana en lunes', mes.huecos === 3)
  const c21 = mes.celdas.find((c) => c.dia === '2026-10-21')!
  ok('el 21 tiene sus 3 llamadas', c21.resumen.realizadas === 3 && c21.resumen.contestadas === 2)
  ok('el 5 tiene la suya y el resto, cero', mes.celdas.find((c) => c.dia === '2026-10-05')!.resumen.realizadas === 1 && mes.celdas.find((c) => c.dia === '2026-10-06')!.resumen.realizadas === 0)
  ok('el máximo del mes es el día de más llamadas', mes.maximoRealizadas === 3)
  ok('el total del mes NO incluye una llamada de septiembre que se coló en el rango', mes.total.realizadas === 4, String(mes.total.realizadas))
  ok('un mes sin llamadas', mesDeLlamadas(2026, 11, []).maximoRealizadas === 0 && mesDeLlamadas(2026, 11, []).celdas.length === 30)
}

console.log('\n=== la intensidad del color ===')
{
  ok('sin llamadas, 0', intensidad(0, 50) === 0 && intensidad(5, 0) === 0)
  ok('se gradúa contra el máximo del mes', intensidad(50, 50) === 4 && intensidad(30, 50) === 3 && intensidad(20, 50) === 2 && intensidad(5, 50) === 1)
  ok('en un mes flojo el mejor día también es el más oscuro', intensidad(3, 3) === 4)
  ok('el borde: justo el 25 % es claro y justo el 75 % no llega a lo más oscuro', intensidad(25, 100) === 1 && intensidad(75, 100) === 3)
}

console.log('\n=== mensajes, correos, respuestas ===')
{
  const notas = [
    { kind: 'whatsapp', es_respuesta: false, occurred_at: '2026-10-21T10:00:00Z' },
    { kind: 'whatsapp', es_respuesta: null, occurred_at: '2026-10-21T11:00:00Z' },
    { kind: 'whatsapp', es_respuesta: true, occurred_at: '2026-10-21T12:00:00Z' },
    { kind: 'email', es_respuesta: false, occurred_at: '2026-10-21T10:30:00Z' },
    { kind: 'email', es_respuesta: false, occurred_at: '2026-10-21T10:40:00Z' },
    { kind: 'email', es_respuesta: true, occurred_at: '2026-10-21T10:50:00Z' },
    { kind: 'llamada', es_respuesta: false, occurred_at: '2026-10-21T09:00:00Z' },
    { kind: 'llamada', es_respuesta: true, occurred_at: '2026-10-21T09:10:00Z' },
    { kind: 'linkedin', es_respuesta: false, occurred_at: '2026-10-21T09:20:00Z' },
    { kind: 'nota', es_respuesta: false, occurred_at: '2026-10-21T09:30:00Z' },
    { kind: 'email', es_respuesta: false, occurred_at: '2026-10-20T10:30:00Z' },
    { kind: 'email', es_respuesta: false, occurred_at: '2026-10-21T22:30:00Z' }, // 00:30 del 22
  ]
  const a = actividadDeNotas(notas, '2026-10-21')
  ok('WhatsApp enviados: 2 (la respuesta marcada no cuenta como enviado)', a.whatsapp === 2, String(a.whatsapp))
  ok('correos enviados: 2 (la respuesta marcada no cuenta como enviado)', a.correos === 2, String(a.correos))
  ok('respuestas: 3, del canal que sean (whatsapp, email y llamada)', a.respuestas === 3, String(a.respuestas))
  ok('llamadas anotadas: 1', a.llamadasAnotadas === 1)
  ok('LinkedIn: 1, y una nota de texto no cuenta en nada', a.linkedin === 1)
  ok('un correo de ayer y uno de las 00:30 de mañana quedan fuera', a.correos === 2)
  ok('un día sin notas', JSON.stringify(actividadDeNotas([], '2026-10-21')) === '{"whatsapp":0,"correos":0,"respuestas":0,"llamadasAnotadas":0,"linkedin":0}')
}

console.log('\n=== citas ===')
{
  const citas = [{ created_at: '2026-10-21T08:00:00Z' }, { created_at: '2026-10-21T16:00:00Z' }, { created_at: '2026-10-20T08:00:00Z' }, { created_at: '2026-10-21T22:30:00Z' }]
  ok('se cuentan por el día en que se agendaron, en hora de Madrid: 2', citasAgendadasEl(citas, '2026-10-21') === 2)
  ok('una creada a las 00:30 del 22 es del 22', citasAgendadasEl(citas, '2026-10-22') === 1)
  ok('ninguna', citasAgendadasEl([], '2026-10-21') === 0)
}

console.log('\n=== cómo se leen las duraciones ===')
{
  ok('una llamada: 0:36, 2:22, 0:00, 10:05', duracionCorta(36) === '0:36' && duracionCorta(142) === '2:22' && duracionCorta(0) === '0:00' && duracionCorta(605) === '10:05')
  ok('un negativo no rompe nada', duracionCorta(-3) === '0:00')
  ok('lo hablado: segundos, minutos y horas', tiempoHablado(0) === '0 min' && tiempoHablado(45) === '45 s' && tiempoHablado(1460) === '24 min' && tiempoHablado(3900) === '1 h 05 min' && tiempoHablado(7200) === '2 h 00 min')
  ok('el 21 de octubre: 24 min 20 s son «24 min»', tiempoHablado(24 * 60 + 20) === '24 min')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
