import {
  CARRILES,
  cuentaDeLaLinea,
  desgloseDeLlamadas,
  eventosDeLinea,
  horaDeMinuto,
  llamadasDeLaLinea,
  minutoDeLaHora,
  pausasDe,
  resumenDeLinea,
  textoDeMinutos,
  traduccionDeLlamadas,
  ventanaDeHoras,
  type EventoDeLinea,
  type LlamadaParaLinea,
} from '@/lib/rendimiento/linea'
import { cuentaDeLlamadas, resumenDeLlamadas, type LlamadaParaMetricas } from '@/lib/rendimiento/metricas'
import type { CitaDeActividad, NotaDeActividad } from '@/lib/rendimiento/actividad'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const j = (x: unknown) => JSON.stringify(x)

/**
 * LA LÍNEA DEL DÍA.
 *
 * Octubre en Madrid es UTC+2: 08:12Z son las 10:12 de allí.
 */
const llamada = (hora: string, estado: string, duracion: number, extra: Partial<LlamadaParaLinea> = {}): LlamadaParaLinea => ({
  id: `l${hora}${estado}${duracion}`,
  fecha: `2026-10-21T${String(Number(hora.slice(0, 2)) - 2).padStart(2, '0')}${hora.slice(2)}:00Z`,
  direccion: 'outbound',
  estado,
  duracion_s: duracion,
  lead_id: null,
  numero: '+34600112233',
  ...extra,
})
const nota = (kind: string, hora: string, extra: Partial<NotaDeActividad> = {}): NotaDeActividad => ({
  id: `n${hora}${kind}`,
  kind,
  es_respuesta: false,
  body: `comentario de ${kind}`,
  occurred_at: `2026-10-21T${String(Number(hora.slice(0, 2)) - 2).padStart(2, '0')}${hora.slice(2)}:00Z`,
  lead_id: 'lead-1',
  ...extra,
})
const sinNombres = () => null
const evento = (minuto: number, carril: EventoDeLinea['carril'] = 'llamadas'): EventoDeLinea => ({ id: `e${minuto}${carril}`, carril, minuto, hora: horaDeMinuto(minuto), titulo: '', detalle: '', estilo: 'normal' })

console.log('\n=== las llamadas, por lo que pasó en ellas ===')
{
  const e = eventosDeLinea({
    llamadas: [
      llamada('10:00', 'ANSWERED', 95),
      llamada('10:10', 'ANSWERED', 25),
      llamada('10:20', 'ANSWERED', 7),
      llamada('10:30', 'MISSED', 18),
      llamada('10:40', 'ANSWERED', 40, { direccion: 'inbound' }),
      llamada('10:50', 'MISSED', 0, { direccion: 'inbound' }),
      llamada('11:00', 'ANSWERED', 5, { direccion: 'inbound' }),
      llamada('11:10', 'ANSWERED', 130, { direccion: 'inbound' }),
    ],
    notas: [],
    citas: [],
    cliente: sinNombres,
  })
  const por = (hora: string) => e.find((x) => x.hora === hora)!
  ok('95 s: una conversación', por('10:00').estilo === 'conversacion' && por('10:00').titulo === 'Conversación (1:35)')
  ok('25 s: contestada', por('10:10').estilo === 'contestada' && por('10:10').titulo === 'Contestada (0:25)')
  ok('7 s «contestada» por Rinkel: un contestador', por('10:20').estilo === 'contestador' && por('10:20').titulo === 'Contestador (0:07)')
  ok('no contestada', por('10:30').estilo === 'sinContestar' && por('10:30').titulo === 'Sin contestar')
  ok('recibida y contestada', por('10:40').estilo === 'recibida' && por('10:40').titulo === 'Recibida (0:40)')
  ok('recibida y perdida, y una recibida que colgó a los 5 s también', por('10:50').estilo === 'perdida' && por('11:00').estilo === 'perdida')
  ok('una conversación recibida', por('11:10').estilo === 'conversacion' && por('11:10').titulo === 'Conversación recibida (2:10)')
  ok('todas en el carril de llamadas, con la hora de Madrid', e.every((x) => x.carril === 'llamadas') && por('10:00').minuto === 600)
  ok('sin nombre de cliente se ve el teléfono legible', por('10:00').detalle === '+34 600 11 22 33')

  const oculto = eventosDeLinea({ llamadas: [llamada('12:00', 'MISSED', 0, { numero: null })], notas: [], citas: [], cliente: sinNombres })
  ok('y sin teléfono, «número oculto»', oculto[0].detalle === 'número oculto')
  const conNombre = eventosDeLinea({ llamadas: [llamada('12:00', 'ANSWERED', 70, { lead_id: 'lead-9' })], notas: [], citas: [], cliente: (id) => (id === 'lead-9' ? 'Tienda Aurora' : null) })
  ok('con el cliente conocido, su nombre', conNombre[0].detalle === 'Tienda Aurora')
}

console.log('\n=== las notas van a su carril ===')
{
  const e = eventosDeLinea({
    llamadas: [],
    notas: [
      nota('whatsapp', '10:00'),
      nota('email', '10:10'),
      nota('whatsapp', '10:20', { es_respuesta: true, body: 'me interesa' }),
      nota('email', '10:30', { es_respuesta: true }),
      nota('linkedin', '10:40'),
      nota('llamada', '10:50'),
      nota('nota', '11:00'),
    ],
    citas: [],
    cliente: (id) => (id === 'lead-1' ? 'Casa del Hogar' : null),
  })
  const carriles = e.map((x) => x.carril).join()
  ok('WhatsApp, correo, respuesta, respuesta, y las otras tres', carriles === 'whatsapp,correos,respuestas,respuestas,otras,otras,otras', carriles)
  ok('una respuesta se llama «Respuesta de…» y dice el canal', e[2].titulo === 'Respuesta de Casa del Hogar (WhatsApp)' && e[3].titulo === 'Respuesta de Casa del Hogar (Correo)')
  ok('un envío dice el canal y el cliente', e[0].titulo === 'WhatsApp · Casa del Hogar' && e[1].titulo === 'Correo · Casa del Hogar')
  ok('y el comentario es el detalle', e[2].detalle === 'me interesa')
  const largo = eventosDeLinea({ llamadas: [], notas: [nota('whatsapp', '10:00', { body: 'x'.repeat(400) })], citas: [], cliente: sinNombres })
  ok('un comentario largo se recorta con puntos suspensivos', largo[0].detalle.length === 160 && largo[0].detalle.endsWith('…'))
  const sin = eventosDeLinea({ llamadas: [], notas: [nota('whatsapp', '10:00', { body: null })], citas: [], cliente: sinNombres })
  ok('un cliente sin nombre cargado no rompe nada', sin[0].titulo === 'WhatsApp · un cliente' && sin[0].detalle === '')
}

console.log('\n=== las citas y el orden ===')
{
  const cita: CitaDeActividad = { id: 'c1', lead_name: 'Marta Ruiz', lead_company: 'Hogar Total SL', start_time: '2026-10-27T09:00:00Z', status: 'scheduled', created_at: '2026-10-21T10:30:00Z' }
  const e = eventosDeLinea({ llamadas: [llamada('12:30', 'ANSWERED', 120)], notas: [nota('whatsapp', '12:30')], citas: [cita], cliente: sinNombres })
  const c = e.find((x) => x.carril === 'citas')!
  ok('la cita sale en la hora en que se agendó, con su cliente y su empresa', c.hora === '12:30' && c.titulo === 'Cita agendada: Marta Ruiz (Hogar Total SL)')
  // El 27 ya es horario de invierno: 09:00Z son las 10:00 de Madrid (el cambio de hora fue el 25)
  ok('y dice para cuándo es', c.detalle === 'Es para el martes 27 de octubre a las 10:00', c.detalle)
  ok('a la misma hora, el orden es el de los carriles: llamada, WhatsApp, cita', e.map((x) => x.carril).join() === 'llamadas,whatsapp,citas')
  const desordenadas = eventosDeLinea({ llamadas: [llamada('15:00', 'MISSED', 0), llamada('09:30', 'MISSED', 0)], notas: [nota('email', '12:00')], citas: [], cliente: sinNombres })
  ok('por hora', desordenadas.map((x) => x.hora).join() === '09:30,12:00,15:00')
  ok('hay seis carriles y cada uno con su nombre', CARRILES.length === 6 && CARRILES.every((x) => x.etiqueta.length > 0))
}

console.log('\n=== los huecos ===')
{
  const eventos = [600, 610, 700, 705, 800].map((m) => evento(m))
  const p = pausasDe(eventos)
  ok('entre 10:10 y 11:40 (90 min) y entre 11:45 y 13:20 (95 min)', p.length === 2 && p[0].desde === 610 && p[0].hasta === 700 && p[0].minutos === 90 && p[1].minutos === 95, j(p))
  ok('ninguno está en curso', p.every((x) => !x.enCurso))
  ok('un hueco de 29 minutos no se señala y uno de 30 sí', pausasDe([evento(600), evento(629)]).length === 0 && pausasDe([evento(600), evento(630)]).length === 1)
  ok('con otro mínimo', pausasDe(eventos, { minimo: 92 }).length === 1)
  const hoy = pausasDe(eventos, { ahora: 900 })
  ok('hoy, lo que lleva sin actividad hasta ahora (100 min) es un hueco en curso', hoy.length === 3 && hoy[2].enCurso && hoy[2].desde === 800 && hoy[2].hasta === 900 && hoy[2].minutos === 100, j(hoy))
  ok('si hace poco que hubo actividad, no', pausasDe(eventos, { ahora: 815 }).length === 2)
  ok('sin actividad no hay huecos, ni siquiera hoy', pausasDe([], { ahora: 900 }).length === 0)
  ok('varias cosas en el mismo minuto no son un hueco', pausasDe([evento(600), evento(600, 'whatsapp'), evento(601)]).length === 0)
}

console.log('\n=== el resumen del día ===')
{
  const eventos = [evento(582, 'llamadas'), evento(600, 'llamadas'), evento(610, 'whatsapp'), evento(700, 'correos'), evento(705, 'respuestas'), evento(1131, 'citas')]
  const pausas = pausasDe(eventos, { ahora: 1200 })
  const r = resumenDeLinea(eventos, pausas)
  ok('primera y última actividad: 09:42 y 18:51', r.primera === '09:42' && r.ultima === '18:51')
  ok('el tramo activo son 549 minutos', r.tramoActivo === 549)
  ok('la pausa más larga: de 11:45 a 18:51 (426 min)', r.pausaMasLarga?.minutos === 426 && r.pausaMasLarga.desde === 705, j(r.pausaMasLarga))
  ok('los minutos de pausa no cuentan el hueco en curso: 90 + 426 = 516', r.minutosDePausa === 516, String(r.minutosDePausa))
  ok('por carril', r.porCarril.llamadas === 2 && r.porCarril.whatsapp === 1 && r.porCarril.correos === 1 && r.porCarril.respuestas === 1 && r.porCarril.citas === 1 && r.porCarril.otras === 0 && r.total === 6)
  const vacio = resumenDeLinea([], [])
  ok('un día sin nada', vacio.primera === null && vacio.total === 0 && vacio.pausaMasLarga === null && vacio.tramoActivo === 0)
}

console.log('\n=== las horas que abarca el dibujo ===')
{
  ok('por defecto, de 9 a 19', j(ventanaDeHoras([])) === j({ desde: 540, hasta: 1140 }))
  ok('una actividad a las 07:40 amplía por delante, a las 07:00', ventanaDeHoras([evento(460)]).desde === 420)
  ok('una a las 20:10 amplía por detrás, hasta las 21:00', ventanaDeHoras([evento(1210)]).hasta === 1260)
  ok('lo que cae dentro del horario no cambia nada', j(ventanaDeHoras([evento(700), evento(1000)])) === j({ desde: 540, hasta: 1140 }))
  ok('nunca pasa de medianoche', ventanaDeHoras([evento(1439)]).hasta === 1440)
  ok('minutos y horas', minutoDeLaHora('12:14') === 734 && horaDeMinuto(734) === '12:14' && horaDeMinuto(65) === '01:05')
  ok('cuánto es un hueco', textoDeMinutos(47) === '47 min' && textoDeMinutos(60) === '1 h 00 min' && textoDeMinutos(426) === '7 h 06 min')
}

console.log('\n=== las llamadas se cuentan como la tabla: clientes, intentos y recibidas ===')
{
  // El caso de Maoli: más rayas que llamadas porque a algunos clientes se les llamó varias veces y entraron unas cuantas
  const dia = [
    llamada('10:00', 'MISSED', 0, { id: 'a1', lead_id: 'lead-a', numero: '+34611000001' }),
    llamada('11:00', 'MISSED', 0, { id: 'a2', lead_id: 'lead-a', numero: '+34611000001' }),
    llamada('12:00', 'ANSWERED', 75, { id: 'a3', lead_id: 'lead-a', numero: '+34611000001' }),
    llamada('10:30', 'MISSED', 0, { id: 'b1', lead_id: 'lead-b', numero: '+34611000002' }),
    // Sin lead: el cliente es el número, y el mismo número dos veces es un solo cliente
    llamada('10:40', 'MISSED', 0, { id: 'n1', lead_id: null, numero: '+34611000003' }),
    llamada('13:00', 'MISSED', 0, { id: 'n2', lead_id: null, numero: '+34611000003' }),
    // Número oculto y sin lead: cada llamada es su propio cliente (no se pueden agrupar)
    llamada('10:50', 'MISSED', 0, { id: 'o1', lead_id: null, numero: null }),
    llamada('13:10', 'MISSED', 0, { id: 'o2', lead_id: null, numero: null }),
    // Las que entran
    llamada('11:30', 'ANSWERED', 40, { id: 'r1', direccion: 'inbound', lead_id: 'lead-a' }),
    llamada('11:45', 'MISSED', 0, { id: 'r2', direccion: 'inbound', lead_id: null, numero: '+34611000009' }),
  ]
  const e = eventosDeLinea({ llamadas: dia, notas: [], citas: [], cliente: sinNombres })
  const r = resumenDeLinea(e, [])
  ok('hay una raya por cada llamada, las que salen y las que entran', r.porCarril.llamadas === 10 && e.filter((x) => x.carril === 'llamadas').length === 10)
  ok('«llamadas» cuenta CLIENTES distintos: a (3 veces), b, el número repetido y los dos ocultos = 5', r.llamadas.clientes === 5, j(r.llamadas))
  ok('los intentos son las salientes sin agrupar: 3 + 1 + 2 + 2 = 8', r.llamadas.intentos === 8, j(r.llamadas))
  ok('las recibidas, aparte: 2', r.llamadas.recibidas === 2, j(r.llamadas))
  ok('cuadra: intentos + recibidas = las rayas', r.llamadas.intentos + r.llamadas.recibidas === r.porCarril.llamadas)
  ok('una recibida de un lead al que también se llamó NO suma un cliente más', r.llamadas.clientes === 5)

  // LA PARIDAD CON LA TABLA: lo que cuenta resumenDeLlamadas (el de las tarjetas y el calendario) tiene que salir igual
  const paraMetricas: LlamadaParaMetricas[] = dia.map((l) => ({ ...l, grabacion_id: null }))
  const t = resumenDeLlamadas(paraMetricas)
  ok('igual que resumenDeLlamadas: realizadas = clientes, intentos, recibidas', t.realizadas === r.llamadas.clientes && t.intentos === r.llamadas.intentos && t.recibidas === r.llamadas.recibidas, j({ t: [t.realizadas, t.intentos, t.recibidas], r: r.llamadas }))

  ok('el desglose lo dice con palabras', desgloseDeLlamadas(r.llamadas) === '8 intentos a 5 clientes · 2 recibidas', desgloseDeLlamadas(r.llamadas))
  ok('y en corto, para la columna estrecha, sin repetir los clientes', desgloseDeLlamadas(r.llamadas, { corto: true }) === '8 intentos · 2 recibidas', desgloseDeLlamadas(r.llamadas, { corto: true }))
}

console.log('\n=== el desglose solo habla cuando hay algo que explicar ===')
{
  ok('cada llamada a un cliente distinto y ninguna recibida: nada que explicar', desgloseDeLlamadas({ clientes: 7, intentos: 7, recibidas: 0 }) === '')
  ok('sin llamadas: nada', desgloseDeLlamadas({ clientes: 0, intentos: 0, recibidas: 0 }) === '')
  ok('solo recibidas', desgloseDeLlamadas({ clientes: 3, intentos: 3, recibidas: 1 }) === '1 recibida')
  ok('solo repetidas', desgloseDeLlamadas({ clientes: 4, intentos: 9, recibidas: 0 }) === '9 intentos a 4 clientes')
  ok('el singular', desgloseDeLlamadas({ clientes: 1, intentos: 2, recibidas: 1 }) === '2 intentos a 1 cliente · 1 recibida')
  ok('el plural de recibidas', desgloseDeLlamadas({ clientes: 5, intentos: 5, recibidas: 3 }) === '3 recibidas')
}

console.log('\n=== de la lista a las cifras: lo que se dice para que no parezcan contradecirse ===')
{
  // Las llamadas del día de la captura del 30 de octubre (leads inventados): 12 intentos a 10 clientes y 6 intentos contestados de 5 clientes
  const dia = [
    llamada('10:16', 'ANSWERED', 135, { lead_id: 'l1' }),
    llamada('10:45', 'MISSED', 36, { lead_id: 'l2' }),
    llamada('10:48', 'ANSWERED', 16, { lead_id: 'l3' }),
    llamada('10:56', 'ANSWERED', 13, { lead_id: 'l4', numero: '+34600000041' }),
    llamada('10:56', 'ANSWERED', 10, { lead_id: 'l4', numero: '+34900000042' }),
    llamada('11:15', 'MISSED', 1, { lead_id: 'l5' }),
    llamada('11:21', 'ANSWERED', 8, { lead_id: 'l6' }),
    llamada('11:21', 'ANSWERED', 6, { lead_id: 'l6' }),
    llamada('11:25', 'ANSWERED', 8, { lead_id: 'l7' }),
    llamada('11:28', 'ANSWERED', 52, { lead_id: 'l8' }),
    llamada('11:30', 'ANSWERED', 394, { lead_id: 'l9' }),
    llamada('12:21', 'MISSED', 3, { lead_id: 'l10' }),
  ]
  const deLaLinea = cuentaDeLaLinea(eventosDeLinea({ llamadas: dia, notas: [], citas: [], cliente: sinNombres }))
  const deLaLista = cuentaDeLlamadas(dia.map((l) => ({ ...l, grabacion_id: null })))
  ok('la línea y la lista cuentan exactamente lo mismo', j(deLaLinea) === j(deLaLista), j({ linea: deLaLinea, lista: deLaLista }))
  ok('12 intentos a 10 clientes; 6 intentos contestados de 5 clientes; ninguna recibida', j(deLaLinea) === j({ intentos: 12, clientes: 10, intentosContestados: 6, clientesContestados: 5, recibidas: 0 }), j(deLaLinea))
  ok(
    'se dice en dos partes, con los nombres de las tarjetas',
    j(traduccionDeLlamadas(deLaLinea)) === j([{ de: '12 intentos', a: '10 llamadas hechas' }, { de: '6 intentos contestados', a: '5 contestadas' }]),
    j(traduccionDeLlamadas(deLaLinea))
  )

  // Solo hay que decir lo que no cuadra
  ok('todo cuadra: nada que decir', traduccionDeLlamadas({ intentos: 7, clientes: 7, intentosContestados: 3, clientesContestados: 3, recibidas: 0 }).length === 0)
  ok('sin llamadas: nada que decir', traduccionDeLlamadas({ intentos: 0, clientes: 0, intentosContestados: 0, clientesContestados: 0, recibidas: 0 }).length === 0)
  ok(
    'repetidas sin ninguna contestada de más: solo la primera parte',
    j(traduccionDeLlamadas({ intentos: 9, clientes: 4, intentosContestados: 2, clientesContestados: 2, recibidas: 0 })) === j([{ de: '9 intentos', a: '4 llamadas hechas' }]),
    j(traduccionDeLlamadas({ intentos: 9, clientes: 4, intentosContestados: 2, clientesContestados: 2, recibidas: 0 }))
  )
  ok(
    'las recibidas van aparte y se dicen en singular o plural',
    j(traduccionDeLlamadas({ intentos: 5, clientes: 5, intentosContestados: 2, clientesContestados: 2, recibidas: 1 })) === j([{ de: '1 recibida', a: 'no es una llamada hecha' }]) &&
      j(traduccionDeLlamadas({ intentos: 5, clientes: 5, intentosContestados: 2, clientesContestados: 2, recibidas: 3 })) === j([{ de: '3 recibidas', a: 'no son llamadas hechas' }])
  )
  ok(
    'el singular de la derecha: 2 intentos a 1 cliente que contestó en los dos',
    j(traduccionDeLlamadas({ intentos: 2, clientes: 1, intentosContestados: 2, clientesContestados: 1, recibidas: 0 })) ===
      j([{ de: '2 intentos', a: '1 llamada hecha' }, { de: '2 intentos contestados', a: '1 contestada' }])
  )
  ok(
    'con las tres cosas a la vez, en el mismo orden de siempre',
    traduccionDeLlamadas({ intentos: 12, clientes: 10, intentosContestados: 6, clientesContestados: 5, recibidas: 4 }).map((p) => p.de).join(' | ') === '12 intentos | 6 intentos contestados | 4 recibidas'
  )

  // Una recibida contestada no es un intento contestado
  const conRecibida = cuentaDeLaLinea(
    eventosDeLinea({ llamadas: [llamada('10:00', 'MISSED', 0, { lead_id: 'a' }), llamada('10:10', 'ANSWERED', 80, { lead_id: 'a', direccion: 'inbound' })], notas: [], citas: [], cliente: sinNombres })
  )
  ok('una recibida contestada no suma a los intentos contestados ni a los clientes contestados', j(conRecibida) === j({ intentos: 1, clientes: 1, intentosContestados: 0, clientesContestados: 0, recibidas: 1 }), j(conRecibida))
  const raras = cuentaDeLaLinea(eventosDeLinea({ llamadas: [llamada('10:00', 'ANSWERED', 30, { direccion: 'internal' })], notas: [], citas: [], cliente: sinNombres }))
  ok('una dirección que no es ni salida ni entrada no se cuenta en nada', j(raras) === j({ intentos: 0, clientes: 0, intentosContestados: 0, clientesContestados: 0, recibidas: 0 }), j(raras))
}

console.log('\n=== lo que no es una llamada de Rinkel, y los días ===')
{
  // Un evento que ya no trae sentido ni cliente (como los de las pruebas de arriba) cuenta como antes: un intento a un cliente propio
  const sueltos = llamadasDeLaLinea([evento(600), evento(610), evento(620, 'whatsapp')])
  ok('sin sentido ni cliente, cada raya es un intento a un cliente propio', j(sueltos) === j({ clientes: 2, intentos: 2, recibidas: 0 }), j(sueltos))
  const raro = eventosDeLinea({ llamadas: [llamada('10:00', 'ANSWERED', 30, { direccion: 'internal' })], notas: [], citas: [], cliente: sinNombres })
  ok('una dirección que no es ni salida ni entrada se dibuja pero no se cuenta (como en las tarjetas)', raro.length === 1 && j(llamadasDeLaLinea(raro)) === j({ clientes: 0, intentos: 0, recibidas: 0 }), j(llamadasDeLaLinea(raro)))
  // El cliente lleva el día delante: el mismo lead en dos días son dos, igual que en el calendario del mes
  const dosDias = eventosDeLinea({
    llamadas: [
      { ...llamada('10:00', 'MISSED', 0, { id: 'd1', lead_id: 'lead-x' }) },
      { ...llamada('10:00', 'MISSED', 0, { id: 'd2', lead_id: 'lead-x' }), fecha: '2026-10-22T08:00:00Z' },
    ],
    notas: [],
    citas: [],
    cliente: sinNombres,
  })
  ok('el mismo lead en dos días distintos cuenta en los dos', llamadasDeLaLinea(dosDias).clientes === 2 && llamadasDeLaLinea(dosDias).intentos === 2)
  ok('un día sin llamadas: todo a cero', j(resumenDeLinea([], []).llamadas) === j({ clientes: 0, intentos: 0, recibidas: 0 }))
}

console.log('\n=== la línea y las tarjetas no pueden contradecirse (al azar) ===')
{
  // Una semilla fija: 40 días de mentira con leads repetidos, números repetidos, ocultos, entrantes y de todo. En cada uno, lo que dice la línea tiene que ser
  // exactamente lo que dice resumenDeLlamadas, que es de donde salen las cifras de las tarjetas y del calendario
  let semilla = 20261026
  const azar = () => {
    semilla = (semilla * 1664525 + 1013904223) >>> 0
    return semilla / 0x100000000
  }
  let dias = 0
  let distintos = 0
  let mismasCuentas = 0
  for (let d = 0; d < 40; d++) {
    const n = 1 + Math.floor(azar() * 90)
    const llamadas: LlamadaParaLinea[] = []
    for (let i = 0; i < n; i++) {
      const hora = 7 + Math.floor(azar() * 11)
      const minuto = Math.floor(azar() * 60)
      const sentido = azar() < 0.12 ? 'inbound' : 'outbound'
      const conLead = azar() < 0.6
      const conNumero = azar() < 0.85
      llamadas.push({
        id: `d${d}-${i}`,
        // Todo dentro del mismo día de Madrid (en octubre, UTC+2)
        fecha: `2026-10-21T${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}:00Z`,
        direccion: sentido,
        estado: azar() < 0.5 ? 'ANSWERED' : 'MISSED',
        duracion_s: Math.floor(azar() * 120),
        lead_id: conLead ? `lead-${Math.floor(azar() * 12)}` : null,
        numero: conNumero ? `+3461100${String(Math.floor(azar() * 9)).padStart(4, '0')}` : null,
      })
    }
    const eventos = eventosDeLinea({ llamadas, notas: [], citas: [], cliente: sinNombres })
    const r = resumenDeLinea(eventos, []).llamadas
    const paraMetricas = llamadas.map((l) => ({ ...l, grabacion_id: null }))
    const t = resumenDeLlamadas(paraMetricas)
    dias++
    if (t.realizadas === r.clientes && t.intentos === r.intentos && t.recibidas === r.recibidas && r.clientes <= r.intentos) distintos++
    // Y los cinco números con los que se explica la diferencia (los contestados incluidos) salen igual de la lista que de la línea
    if (j(cuentaDeLaLinea(eventos)) === j(cuentaDeLlamadas(paraMetricas))) mismasCuentas++
  }
  ok(`en ${dias} días al azar, la línea y las tarjetas dicen lo mismo (clientes, intentos y recibidas)`, distintos === dias, `${distintos} de ${dias}`)
  ok(`y la línea y la lista cuentan igual los intentos y clientes contestados (${dias} días)`, mismasCuentas === dias, `${mismasCuentas} de ${dias}`)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
