import {
  CARRILES,
  eventosDeLinea,
  horaDeMinuto,
  minutoDeLaHora,
  pausasDe,
  resumenDeLinea,
  textoDeMinutos,
  ventanaDeHoras,
  type EventoDeLinea,
  type LlamadaParaLinea,
} from '@/lib/rendimiento/linea'
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

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
