import {
  etiquetaDeEstadoDeCita,
  agruparConversaciones,
  canalDe,
  citasAgendadas,
  clientesDe,
  contarPorFiltro,
  respuestasDe,
  filtrarActividad,
  itemsDeActividad,
  type CitaDeActividad,
  type NotaDeActividad,
} from '@/lib/rendimiento/actividad'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const j = (x: unknown) => JSON.stringify(x)

/**
 * LAS CONVERSACIONES Y LAS CITAS, CLIENTE A CLIENTE.
 *
 * Octubre en Madrid es UTC+2: 08:12Z son las 10:12 de allí.
 */
let id = 0
const nota = (kind: string, lead: string, utc: string, extra: Partial<NotaDeActividad> = {}): NotaDeActividad => ({
  id: `n${(id += 1)}`,
  kind,
  es_respuesta: false,
  body: `comentario ${id}`,
  occurred_at: `2026-10-21T${utc}:00Z`,
  lead_id: lead,
  ...extra,
})

console.log('\n=== de la nota al canal ===')
{
  ok('cada tipo de nota tiene su canal', canalDe('whatsapp') === 'whatsapp' && canalDe('email') === 'correo' && canalDe('linkedin') === 'linkedin' && canalDe('llamada') === 'llamada' && canalDe('nota') === 'nota')
  ok('un tipo que no existe es una nota', canalDe('fax') === 'nota')
}

console.log('\n=== una conversación es un cliente, un canal y un día ===')
{
  const siete = Array.from({ length: 7 }, (_, i) => nota('whatsapp', 'lead-A', `${String(8 + i).padStart(2, '0')}:10`))
  const g = agruparConversaciones(siete)
  ok('7 apuntes de WhatsApp con el mismo cliente: 1 conversación con 7 interacciones', g.length === 1 && g[0].interacciones.length === 7, j(g.map((c) => c.interacciones.length)))
  ok('de la primera a la última: 10:10 a 16:10', g[0].desde === '10:10' && g[0].hasta === '16:10' && g[0].dia === '2026-10-21' && g[0].canal === 'whatsapp')
  ok('con su comentario y su hora cada una', g[0].interacciones[0].texto === 'comentario 1' && g[0].interacciones[0].hora === '10:10' && g[0].interacciones[6].hora === '16:10')
  ok('sin respuesta del cliente', !g[0].hayRespuesta)

  const conRespuesta = agruparConversaciones([
    nota('whatsapp', 'lead-A', '08:00'),
    nota('whatsapp', 'lead-A', '08:30', { es_respuesta: true, body: 'me interesa, llámame el jueves' }),
    nota('whatsapp', 'lead-A', '09:00'),
  ])
  ok('una respuesta del cliente forma parte de la misma conversación y la marca «con respuesta»', conRespuesta.length === 1 && conRespuesta[0].hayRespuesta && conRespuesta[0].interacciones.map((i) => i.esRespuesta).join() === 'false,true,false')
  ok('y su comentario se conserva', conRespuesta[0].interacciones[1].texto === 'me interesa, llámame el jueves')

  const varios = agruparConversaciones([nota('whatsapp', 'lead-A', '08:00'), nota('whatsapp', 'lead-B', '08:05'), nota('email', 'lead-A', '08:10')])
  ok('otro cliente y otro canal son otras conversaciones: 3', varios.length === 3)
  ok('salen por la hora de su primera interacción', varios.map((c) => c.leadId + c.canal).join() === 'lead-Awhatsapp,lead-Bwhatsapp,lead-Acorreo')

  const dias = agruparConversaciones([nota('whatsapp', 'lead-A', '08:00'), { ...nota('whatsapp', 'lead-A', '08:00'), occurred_at: '2026-10-22T08:00:00Z' }])
  ok('el mismo cliente en otro día es otra conversación', dias.length === 2 && dias[0].dia === '2026-10-21' && dias[1].dia === '2026-10-22')
  const medianoche = agruparConversaciones([nota('whatsapp', 'lead-A', '21:30'), nota('whatsapp', 'lead-A', '22:30')])
  ok('el día es el de Madrid: las 23:30 son del 21 y las 00:30 del 22', medianoche.length === 2 && medianoche[0].dia === '2026-10-21' && medianoche[1].dia === '2026-10-22' && medianoche[1].desde === '00:30')

  const desordenadas = agruparConversaciones([nota('email', 'lead-A', '10:00'), nota('email', 'lead-A', '08:00'), nota('email', 'lead-A', '09:00')])
  ok('las interacciones salen por hora aunque lleguen desordenadas', desordenadas[0].interacciones.map((i) => i.hora).join() === '10:00,11:00,12:00')
  ok('sin comentario no rompe nada', agruparConversaciones([nota('email', 'lead-A', '08:00', { body: null }), nota('email', 'lead-B', '08:00', { body: '   ' })]).every((c) => c.interacciones[0].texto === ''))
  ok('sin notas, nada', agruparConversaciones([]).length === 0)
  ok('los clientes de una lista, sin repetir', j(clientesDe(varios)) === j(['lead-A', 'lead-B']))
}

console.log('\n=== las citas ===')
{
  const citas: CitaDeActividad[] = [
    { id: 'c2', lead_name: 'Marta Ruiz', lead_company: 'Hogar Total SL', start_time: '2026-10-27T09:00:00Z', status: 'scheduled', created_at: '2026-10-21T10:30:00Z' },
    { id: 'c1', lead_name: 'Pablo Gil', lead_company: null, start_time: '2026-10-23T14:00:00Z', status: 'confirmed', created_at: '2026-10-21T08:15:00Z' },
  ]
  const a = citasAgendadas(citas)
  ok('salen por el momento en que se agendaron', a.map((c) => c.id).join() === 'c1,c2')
  ok('con la hora de Madrid de cuando se agendó', a[0].dia === '2026-10-21' && a[0].hora === '10:15' && a[1].hora === '12:30')
  // El 25 de octubre cambia la hora: el 23 Madrid va dos horas por delante de UTC y el 27, solo una
  ok('y para cuándo es, también en Madrid y con el cambio de hora de por medio (16:00 el 23, 10:00 el 27)', a[0].paraDia === '2026-10-23' && a[0].paraHora === '16:00' && a[1].paraDia === '2026-10-27' && a[1].paraHora === '10:00')
  ok('con el cliente y su empresa, y el estado', a[1].cliente === 'Marta Ruiz' && a[1].empresa === 'Hogar Total SL' && a[0].empresa === null && a[0].estado === 'confirmed')
}

console.log('\n=== lo que contestaron los clientes ===')
{
  const conv = agruparConversaciones([
    nota('whatsapp', 'lead-A', '08:00'),
    nota('whatsapp', 'lead-A', '08:30', { es_respuesta: true, body: 'me interesa' }),
    nota('email', 'lead-B', '07:00', { es_respuesta: true, body: 'mándame precios' }),
    nota('whatsapp', 'lead-A', '09:00', { es_respuesta: true, body: 'y el jueves?' }),
    { ...nota('whatsapp', 'lead-C', '08:00', { es_respuesta: true, body: 'ahora no' }), occurred_at: '2026-10-22T08:00:00Z' },
  ])
  const r = respuestasDe(conv)
  ok('cada vez que contestaron, con lo que dijeron, por día y hora (no por conversación)', r.map((x) => x.texto).join('|') === 'mándame precios|me interesa|y el jueves?|ahora no', r.map((x) => x.texto).join('|'))
  ok('con su canal, su cliente y su hora de Madrid', r[0].canal === 'correo' && r[0].leadId === 'lead-B' && r[0].hora === '09:00' && r[1].canal === 'whatsapp' && r[1].hora === '10:30' && r[3].dia === '2026-10-22')
  ok('lo que envió el comercial no es una respuesta', respuestasDe(agruparConversaciones([nota('whatsapp', 'lead-A', '08:00')])).length === 0 && respuestasDe([]).length === 0)
}

console.log('\n=== el estado de una cita ===')
{
  ok('los estados de la Agenda tienen su nombre', etiquetaDeEstadoDeCita('scheduled') === 'Agendada' && etiquetaDeEstadoDeCita('qualified') === 'Cualificada' && etiquetaDeEstadoDeCita('not_qualified') === 'No cualificada' && etiquetaDeEstadoDeCita('no_show') === 'No se presentó')
  ok('uno que no se conoce sale tal cual, sin romper nada', etiquetaDeEstadoDeCita('pendiente_de_algo') === 'pendiente_de_algo')
}

console.log('\n=== la lista que se enseña y sus filtros ===')
{
  const conversaciones = agruparConversaciones([
    nota('whatsapp', 'lead-A', '08:00'),
    nota('whatsapp', 'lead-B', '09:00', { es_respuesta: true }),
    nota('email', 'lead-C', '10:00'),
    nota('email', 'lead-D', '11:00', { es_respuesta: true }),
    nota('linkedin', 'lead-E', '12:00'),
    nota('llamada', 'lead-F', '12:30'),
    nota('nota', 'lead-G', '13:00'),
    { ...nota('whatsapp', 'lead-A', '08:00'), occurred_at: '2026-10-22T08:00:00Z' },
  ])
  const citas = citasAgendadas([{ id: 'c1', lead_name: 'Pablo Gil', lead_company: null, start_time: '2026-10-23T14:00:00Z', status: 'scheduled', created_at: '2026-10-21T08:15:00Z' }])
  const items = itemsDeActividad(conversaciones, citas)
  ok('todo junto: 8 conversaciones y 1 cita', items.length === 9)
  ok('por día y hora: lo del 21 primero y lo del 22 al final', items[0].dia === '2026-10-21' && items[items.length - 1].dia === '2026-10-22')
  ok('la cita se cuela por la hora a la que se agendó (10:15, entre el WhatsApp de las 10:00 y el de las 11:00)', items[1].tipo === 'cita' && items[0].tipo === 'conversacion' && items[2].tipo === 'conversacion', j(items.map((i) => `${i.dia} ${i.hora} ${i.tipo}`)))
  const cuenta = contarPorFiltro(items)
  ok('WhatsApp: 3 conversaciones (A el 21, B el 21, A el 22)', cuenta.whatsapp === 3, j(cuenta))
  ok('correos: 2', cuenta.correos === 2)
  ok('respuestas: las conversaciones donde el cliente contestó, del canal que sea (B y D)', cuenta.respuestas === 2)
  ok('citas: 1', cuenta.citas === 1)
  ok('otras notas: LinkedIn, llamada anotada y nota (3)', cuenta.otras === 3)
  ok('todo: 9', cuenta.todo === 9)
  const mismoCliente = itemsDeActividad(agruparConversaciones([nota('whatsapp', 'lead-X', '08:00', { es_respuesta: true }), nota('email', 'lead-X', '09:00', { es_respuesta: true })]), [])
  ok('un cliente que contesta por dos canales el mismo día sale en dos conversaciones pero cuenta UNA respuesta, como la tarjeta', filtrarActividad(mismoCliente, 'respuestas').length === 2 && contarPorFiltro(mismoCliente).respuestas === 1)
  ok('filtrar por respuestas enseña esas dos conversaciones', filtrarActividad(items, 'respuestas').every((i) => i.tipo === 'conversacion' && i.conversacion.hayRespuesta) && filtrarActividad(items, 'respuestas').length === 2)
  ok('filtrar por citas enseña solo citas', filtrarActividad(items, 'citas').every((i) => i.tipo === 'cita'))
  ok('filtrar por todo no quita nada', filtrarActividad(items, 'todo').length === items.length)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
