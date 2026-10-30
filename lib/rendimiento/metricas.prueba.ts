import {
  SEGUNDOS_DE_CONVERSACION,
  SEGUNDOS_MINIMOS_PARA_CONTESTADA,
  actividadDeNotas,
  agruparPorDia,
  citasAgendadasEl,
  clienteDeLaLlamada,
  cuentaDeLlamadas,
  duracionCorta,
  esContestador,
  estaContestada,
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
  ok('realizadas son las salientes (cada una a un cliente distinto): 7', r.realizadas === 7 && r.intentos === 7, String(r.realizadas))
  ok('recibidas son las entrantes: 2', r.recibidas === 2)
  ok('contestadas: de las SALIENTES, 5 (90, 25, 142, 60 y 59 s)', r.contestadas === 5, String(r.contestadas))
  ok('la tasa de contacto es contestadas entre realizadas', Math.abs(r.tasaDeContacto - 5 / 7) < 1e-9)
  ok('el tiempo hablado suma las contestadas de los dos sentidos: 90+25+142+60+59+120 = 496 s', r.segundosHablados === 496, String(r.segundosHablados))
  ok(`una conversación dura ${SEGUNDOS_DE_CONVERSACION} s o más: 90, 142, 60 y 120 (la de 59 s no)`, r.conversaciones === 4, String(r.conversaciones))
  ok('con grabación: las contestadas', r.conGrabacion === 6, String(r.conGrabacion))
  ok('números distintos a los que se llamó (solo realizadas)', r.numerosDistintos === 7, String(r.numerosDistintos))
  ok('la primera y la última', r.primera === '2026-10-21T08:24:00Z' && r.ultima === '2026-10-21T11:10:00Z', `${r.primera} · ${r.ultima}`)
}

console.log('\n=== un contestador automático no cuenta como contestada ===')
{
  ok(`el mínimo es de ${SEGUNDOS_MINIMOS_PARA_CONTESTADA} segundos`, SEGUNDOS_MINIMOS_PARA_CONTESTADA === 10)
  ok('menos de 10 s no es contestada: 0, 3, 7 y 9 s', [0, 3, 7, 9].every((d) => !estaContestada({ estado: 'ANSWERED', duracion_s: d })))
  ok('10 s ya sí, y 11, 60 y 600', [10, 11, 60, 600].every((d) => estaContestada({ estado: 'ANSWERED', duracion_s: d })))
  ok('una perdida nunca lo es, dure lo que dure', !estaContestada({ estado: 'MISSED', duracion_s: 90 }) && !estaContestada({ estado: 'MISSED', duracion_s: 0 }))
  ok('y es contestador la que Rinkel da por contestada y dura menos de 10 s, nada más', esContestador({ estado: 'ANSWERED', duracion_s: 7 }) && !esContestador({ estado: 'ANSWERED', duracion_s: 10 }) && !esContestador({ estado: 'MISSED', duracion_s: 3 }))

  const r = resumenDeLlamadas([
    llamada('10:00', 'ANSWERED', 7),
    llamada('10:05', 'ANSWERED', 3),
    llamada('10:10', 'ANSWERED', 9),
    llamada('10:15', 'ANSWERED', 10),
    llamada('10:20', 'ANSWERED', 95),
    llamada('10:25', 'MISSED', 20),
  ])
  ok('se hicieron 6', r.realizadas === 6)
  ok('contestadas: solo las de 10 s o más (2), no las tres de contestador', r.contestadas === 2, String(r.contestadas))
  ok('el porcentaje de contacto: 2 de 6', Math.abs(r.tasaDeContacto - 2 / 6) < 1e-9, String(r.tasaDeContacto))
  ok('el tiempo hablado no suma los contestadores: 10 + 95 = 105 s', r.segundosHablados === 105, String(r.segundosHablados))
  ok('una conversación sigue siendo de 60 s o más: 1', r.conversaciones === 1)

  const entrantes = resumenDeLlamadas([llamada('11:00', 'ANSWERED', 5, { direccion: 'inbound' }), llamada('11:05', 'ANSWERED', 40, { direccion: 'inbound' })])
  ok('también en las recibidas: colgar a los 5 s no suma tiempo hablado', entrantes.recibidas === 2 && entrantes.segundosHablados === 40, String(entrantes.segundosHablados))

  const soloContestadores = resumenDeLlamadas([llamada('12:00', 'ANSWERED', 4), llamada('12:05', 'ANSWERED', 6)])
  ok('un día de solo contestadores: 0 contestadas y 0 % de contacto, sin romper nada', soloContestadores.contestadas === 0 && soloContestadores.tasaDeContacto === 0 && soloContestadores.segundosHablados === 0)
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
  ok('3 intentos a 1 número distinto: 1 llamada hecha (un cliente cuenta una vez al día)', r.realizadas === 1 && r.intentos === 3 && r.numerosDistintos === 1, JSON.stringify([r.realizadas, r.intentos]))
  ok('un número oculto no cuenta como número distinto, y cada llamada oculta es la suya', resumenDeLlamadas([llamada('10:00', 'MISSED', 0, { numero: null }), llamada('10:10', 'MISSED', 0, { numero: null })]).numerosDistintos === 0 && resumenDeLlamadas([llamada('10:00', 'MISSED', 0, { numero: null }), llamada('10:10', 'MISSED', 0, { numero: null })]).realizadas === 2)
}

console.log('\n=== un cliente, una llamada al día ===')
{
  const mismo = '+34600112233'
  // El caso de Raúl: tres llamadas a un cliente que no contesta, la tercera contesta y hablan un minuto -> UNA interacción
  const tres = resumenDeLlamadas([
    llamada('10:00', 'MISSED', 0, { numero: mismo }),
    llamada('12:30', 'MISSED', 0, { numero: mismo }),
    llamada('17:00', 'ANSWERED', 61, { numero: mismo }),
  ])
  ok('llamó 3 veces, la tercera contestada y de un minuto: 1 llamada hecha, 1 contestada, 1 conversación', tres.realizadas === 1 && tres.contestadas === 1 && tres.conversaciones === 1, JSON.stringify(tres))
  ok('pero se sabe que fueron 3 intentos, y el tiempo al teléfono es el real (61 s)', tres.intentos === 3 && tres.total === 3 && tres.segundosHablados === 61)
  ok('el 100 % de contacto: se llamó a un cliente y contestó (no un 33 % por los dos intentos fallidos)', tres.tasaDeContacto === 1)

  const sinContestar = resumenDeLlamadas([llamada('10:00', 'MISSED', 0, { numero: mismo }), llamada('11:00', 'ANSWERED', 4, { numero: mismo }), llamada('12:00', 'MISSED', 0, { numero: mismo })])
  ok('tres intentos sin que nadie conteste (uno fue un contestador): 1 llamada, 0 contestadas', sinContestar.realizadas === 1 && sinContestar.contestadas === 0 && sinContestar.intentos === 3 && sinContestar.tasaDeContacto === 0)

  // El cliente es el lead, no el teléfono
  const dosTelefonos = resumenDeLlamadas([llamada('10:00', 'MISSED', 0, { numero: '+34600000001', lead_id: 'lead-A' }), llamada('10:30', 'ANSWERED', 70, { numero: '+34900000002', lead_id: 'lead-A' })])
  ok('un lead con dos teléfonos es UN cliente', dosTelefonos.realizadas === 1 && dosTelefonos.contestadas === 1 && dosTelefonos.numerosDistintos === 2)
  const dosLeads = resumenDeLlamadas([llamada('10:00', 'MISSED', 0, { numero: mismo, lead_id: 'lead-A' }), llamada('10:30', 'MISSED', 0, { numero: mismo, lead_id: 'lead-B' })])
  ok('dos leads distintos con el mismo teléfono son dos clientes', dosLeads.realizadas === 2)
  const sinLead = resumenDeLlamadas([llamada('10:00', 'MISSED', 0, { numero: mismo, lead_id: null }), llamada('10:30', 'ANSWERED', 80, { numero: mismo, lead_id: null })])
  ok('sin lead, el cliente es el número', sinLead.realizadas === 1 && sinLead.contestadas === 1)
  const ocultos = resumenDeLlamadas([llamada('10:00', 'MISSED', 0, { numero: null, id: 'a' }), llamada('10:10', 'MISSED', 0, { numero: null, id: 'b' }), llamada('10:20', 'MISSED', 0, { numero: null })])
  ok('con el número oculto y sin lead no se sabe quién es: cada llamada es la suya', ocultos.realizadas === 3)

  // Conversaciones: el mismo cliente en dos llamadas largas es UNA conversación, pero el tiempo se suma entero
  const dosLargas = resumenDeLlamadas([llamada('10:00', 'ANSWERED', 70, { numero: mismo }), llamada('10:20', 'ANSWERED', 65, { numero: mismo })])
  ok('dos llamadas largas al mismo cliente: 1 conversación y 135 s hablados', dosLargas.conversaciones === 1 && dosLargas.segundosHablados === 135 && dosLargas.contestadas === 1)

  // Entrantes: se cuentan una a una; y una conversación entrante cuenta para el mismo cliente
  const ida = resumenDeLlamadas([llamada('10:00', 'MISSED', 0, { numero: mismo }), llamada('10:05', 'ANSWERED', 100, { numero: mismo, direccion: 'inbound' })])
  ok('el cliente devuelve la llamada: 1 hecha, 1 recibida, y la conversación es suya', ida.realizadas === 1 && ida.contestadas === 0 && ida.recibidas === 1 && ida.conversaciones === 1)

  // Otro día vuelve a contar (una rellamada)
  const cliente = (hora: string, fecha: string) => ({ ...llamada(hora, 'MISSED', 0, { numero: mismo }), fecha })
  const dosDias = [cliente('10:00', '2026-10-21T08:00:00Z'), cliente('10:30', '2026-10-21T08:30:00Z'), cliente('10:00', '2026-10-22T08:00:00Z')]
  ok('el mismo cliente el 21 (dos veces) y el 22 (una): al pedir los dos días a la vez son 2 llamadas hechas y 3 intentos', resumenDeLlamadas(dosDias).realizadas === 2 && resumenDeLlamadas(dosDias).intentos === 3)
  const mes = mesDeLlamadas(2026, 10, dosDias)
  ok('en el calendario: 1 el día 21, 1 el día 22, y el mes suma 2 (no 3)', mes.celdas.find((c) => c.dia === '2026-10-21')!.resumen.realizadas === 1 && mes.celdas.find((c) => c.dia === '2026-10-22')!.resumen.realizadas === 1 && mes.total.realizadas === 2 && mes.total.intentos === 3)
  const mediaNoche = [cliente('10:00', '2026-10-21T21:30:00Z'), cliente('10:00', '2026-10-21T22:30:00Z')]
  ok('el día es el de Madrid: 23:30 del 21 y 00:30 del 22 son dos días, dos llamadas', resumenDeLlamadas(mediaNoche).realizadas === 2 && clienteDeLaLlamada(mediaNoche[0], 0) !== clienteDeLaLlamada(mediaNoche[1], 1))

  // Sin la migración 252 la base cuenta cada llamada: el calendario puede hacer lo mismo para no contradecir a las tarjetas
  const sinAgrupar = resumenDeLlamadas(tres.total === 3 ? [llamada('10:00', 'MISSED', 0, { numero: mismo }), llamada('12:30', 'MISSED', 0, { numero: mismo }), llamada('17:00', 'ANSWERED', 61, { numero: mismo })] : [], { porCliente: false })
  ok('con porCliente: false vuelve a contar cada llamada (3, una contestada)', sinAgrupar.realizadas === 3 && sinAgrupar.contestadas === 1 && sinAgrupar.intentos === 3)
  ok('y el calendario también', mesDeLlamadas(2026, 10, dosDias, { porCliente: false }).total.realizadas === 3)
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

console.log('\n=== conversaciones: un cliente son varias interacciones pero UNA conversación al día ===')
{
  type N = { kind: string; es_respuesta: boolean | null; occurred_at: string; lead_id?: string | null }
  const nota = (kind: string, lead: string | null, hora: string, respuesta: boolean | null = false, dia = '21'): N => ({
    kind,
    es_respuesta: respuesta,
    lead_id: lead,
    // La hora es UTC, así que 08:00Z son las 10:00 de Madrid (verano, UTC+2)
    occurred_at: `2026-10-${dia}T${hora}:00Z`,
  })
  const dia21 = (notas: N[]) => actividadDeNotas(notas, '2026-10-21')

  // El caso que se pidió: siete interacciones de WhatsApp con el mismo cliente el mismo día = 1 conversación
  const siete = Array.from({ length: 7 }, (_, i) => nota('whatsapp', 'lead-A', `${String(8 + i).padStart(2, '0')}:00`))
  const a7 = dia21(siete)
  ok('7 interacciones de WhatsApp con el mismo cliente: 1 conversación', a7.whatsapp === 1, String(a7.whatsapp))
  ok('y se sigue sabiendo que se apuntaron 7', a7.whatsappApuntes === 7)

  const mezcla = dia21([
    nota('whatsapp', 'lead-A', '08:00'),
    nota('whatsapp', 'lead-A', '08:10'),
    nota('whatsapp', 'lead-A', '09:00', true),
    nota('whatsapp', 'lead-A', '09:05', true),
    nota('whatsapp', 'lead-A', '09:10', true),
    nota('whatsapp', 'lead-A', '09:20', true),
    nota('whatsapp', 'lead-A', '09:30', true),
  ])
  ok('enviados y recibidos del mismo cliente, todo documentado: 1 conversación', mezcla.whatsapp === 1 && mezcla.whatsappApuntes === 7, JSON.stringify(mezcla))
  ok('y ese cliente cuenta UNA respuesta, no cinco', mezcla.respuestas === 1, String(mezcla.respuestas))

  const soloRecibidos = dia21([nota('whatsapp', 'lead-B', '08:00', true), nota('whatsapp', 'lead-B', '08:05', true), nota('whatsapp', 'lead-B', '08:09', true)])
  ok('varios WhatsApp que RECIBE y documenta: 1 conversación y 1 respuesta', soloRecibidos.whatsapp === 1 && soloRecibidos.respuestas === 1)

  const tres = dia21([nota('whatsapp', 'lead-A', '08:00'), nota('whatsapp', 'lead-B', '08:00'), nota('whatsapp', 'lead-C', '08:00'), nota('whatsapp', 'lead-A', '09:00')])
  ok('tres clientes distintos son tres conversaciones, y un cuarto apunte al primero no suma', tres.whatsapp === 3 && tres.whatsappApuntes === 4)

  const correos = dia21([nota('email', 'lead-A', '08:00'), nota('email', 'lead-A', '08:30'), nota('email', 'lead-B', '09:00')])
  ok('los correos, igual: 2 conversaciones de 3 apuntes', correos.correos === 2 && correos.correosApuntes === 3)

  const dosCanales = dia21([nota('whatsapp', 'lead-A', '08:00'), nota('email', 'lead-A', '08:10')])
  ok('el mismo cliente por WhatsApp y por correo el mismo día: una conversación en cada canal', dosCanales.whatsapp === 1 && dosCanales.correos === 1)

  const respuestasEnDosCanales = dia21([nota('whatsapp', 'lead-A', '08:00', true), nota('email', 'lead-A', '08:10', true), nota('email', 'lead-B', '08:20', true)])
  ok('un cliente que contesta por dos canales es UNA respuesta: 2 respuestas de 2 clientes', respuestasEnDosCanales.respuestas === 2, String(respuestasEnDosCanales.respuestas))

  const variosDias = [nota('whatsapp', 'lead-A', '08:00'), nota('whatsapp', 'lead-A', '09:00'), nota('whatsapp', 'lead-A', '08:00', false, '22'), nota('whatsapp', 'lead-A', '08:00', false, '20')]
  ok('el mismo cliente en días distintos cuenta una vez CADA día', actividadDeNotas(variosDias, '2026-10-21').whatsapp === 1 && actividadDeNotas(variosDias, '2026-10-22').whatsapp === 1 && actividadDeNotas(variosDias, '2026-10-20').whatsapp === 1)
  const medianoche = [nota('whatsapp', 'lead-A', '21:30'), nota('whatsapp', 'lead-A', '22:30')]
  ok('el día es el de Madrid: las 23:30 son del 21 y las 00:30 son del 22', actividadDeNotas(medianoche, '2026-10-21').whatsapp === 1 && actividadDeNotas(medianoche, '2026-10-22').whatsapp === 1 && actividadDeNotas(medianoche, '2026-10-21').whatsappApuntes === 1)

  const sinLead = dia21([nota('whatsapp', null, '08:00'), nota('whatsapp', null, '08:10'), { kind: 'whatsapp', es_respuesta: false, occurred_at: '2026-10-21T08:20:00Z' }])
  ok('una nota sin cliente no se pierde ni se funde con otra: cuenta como la suya', sinLead.whatsapp === 3)

  const otros = dia21([
    nota('llamada', 'lead-A', '07:00'),
    nota('llamada', 'lead-A', '07:10'),
    nota('llamada', 'lead-B', '07:20', true),
    nota('linkedin', 'lead-A', '07:30'),
    nota('linkedin', 'lead-A', '07:40'),
    nota('nota', 'lead-A', '07:50'),
  ])
  ok('llamadas anotadas: 2 clientes distintos', otros.llamadasAnotadas === 2)
  ok('LinkedIn: 1 conversación, y una nota de texto no cuenta en nada', otros.linkedin === 1 && otros.whatsapp === 0 && otros.correos === 0)
  ok('una respuesta marcada en una llamada anotada cuenta como respuesta de ese cliente', otros.respuestas === 1)

  ok('un día sin notas: todo a cero', JSON.stringify(actividadDeNotas([], '2026-10-21')) === '{"whatsapp":0,"whatsappApuntes":0,"correos":0,"correosApuntes":0,"respuestas":0,"llamadasAnotadas":0,"linkedin":0}')
}

console.log('\n=== citas ===')
{
  const citas = [{ created_at: '2026-10-21T08:00:00Z' }, { created_at: '2026-10-21T16:00:00Z' }, { created_at: '2026-10-20T08:00:00Z' }, { created_at: '2026-10-21T22:30:00Z' }]
  ok('se cuentan por el día en que se agendaron, en hora de Madrid: 2', citasAgendadasEl(citas, '2026-10-21') === 2)
  ok('una creada a las 00:30 del 22 es del 22', citasAgendadasEl(citas, '2026-10-22') === 1)
  ok('ninguna', citasAgendadasEl([], '2026-10-21') === 0)
}

console.log('\n=== la lista y las cifras: 12 intentos son 10 llamadas hechas (el día de la captura del 30 de octubre) ===')
{
  // Las llamadas reales de aquel día, con los leads inventados. Dos clientes explican toda la diferencia
  const dia = [
    llamada('10:16', 'ANSWERED', 135, { lead_id: 'l1' }),
    llamada('10:45', 'MISSED', 36, { lead_id: 'l2' }),
    llamada('10:48', 'ANSWERED', 16, { lead_id: 'l3' }),
    // Un cliente con dos teléfonos: se llamó a los dos y contestaron los dos
    llamada('10:56', 'ANSWERED', 13, { lead_id: 'l4', numero: '+34600000041' }),
    llamada('10:56', 'ANSWERED', 10, { lead_id: 'l4', numero: '+34900000042' }),
    llamada('11:15', 'MISSED', 1, { lead_id: 'l5' }),
    // Otro, dos intentos seguidos al mismo teléfono: los dos fueron un contestador
    llamada('11:21', 'ANSWERED', 8, { lead_id: 'l6', numero: '+34600000061' }),
    llamada('11:21', 'ANSWERED', 6, { lead_id: 'l6', numero: '+34600000061' }),
    llamada('11:25', 'ANSWERED', 8, { lead_id: 'l7' }),
    llamada('11:28', 'ANSWERED', 52, { lead_id: 'l8' }),
    llamada('11:30', 'ANSWERED', 394, { lead_id: 'l9' }),
    llamada('12:21', 'MISSED', 3, { lead_id: 'l10' }),
  ]
  const c = cuentaDeLlamadas(dia)
  const r = resumenDeLlamadas(dia)
  ok('12 intentos a 10 clientes', c.intentos === 12 && c.clientes === 10, JSON.stringify(c))
  ok('6 intentos contestados, de 5 clientes: el que tiene dos teléfonos contesta dos veces y cuenta una', c.intentosContestados === 6 && c.clientesContestados === 5, JSON.stringify(c))
  ok('ninguna recibida', c.recibidas === 0)
  ok('las tarjetas dicen lo mismo que la cuenta: 10 llamadas hechas, 5 contestadas, 50 % de contacto', r.realizadas === c.clientes && r.contestadas === c.clientesContestados && r.tasaDeContacto === 0.5)
  ok('11 teléfonos marcados para 10 clientes: uno de ellos tiene dos y a otro se le llamó dos veces al mismo', r.numerosDistintos === 11 && r.numerosDistintos > r.realizadas, String(r.numerosDistintos))
  ok('los tres contestadores (de 8, 6 y 8 s: Rinkel los da por contestados) no suman ni a los intentos contestados ni a los clientes', dia.filter((l) => l.duracion_s < SEGUNDOS_MINIMOS_PARA_CONTESTADA && l.estado === 'ANSWERED').length === 3 && c.intentosContestados === 6 && c.clientesContestados === 5)

  const conRecibidas = cuentaDeLlamadas([...dia, llamada('13:00', 'ANSWERED', 90, { lead_id: 'l1', direccion: 'inbound' }), llamada('13:05', 'MISSED', 0, { lead_id: 'l11', direccion: 'inbound' })])
  ok('una recibida no es un intento ni un cliente al que se llamó, ni un intento contestado', conRecibidas.intentos === 12 && conRecibidas.clientes === 10 && conRecibidas.intentosContestados === 6 && conRecibidas.recibidas === 2, JSON.stringify(conRecibidas))

  const vacio = cuentaDeLlamadas([])
  ok('sin llamadas, todo a cero', vacio.intentos === 0 && vacio.clientes === 0 && vacio.intentosContestados === 0 && vacio.clientesContestados === 0 && vacio.recibidas === 0)

  const unaSola = cuentaDeLlamadas([llamada('10:00', 'ANSWERED', 40, { lead_id: 'l1' })])
  ok('una llamada a un cliente: todo coincide, nada que traducir', unaSola.intentos === unaSola.clientes && unaSola.intentosContestados === unaSola.clientesContestados)
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
