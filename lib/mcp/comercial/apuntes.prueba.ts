import { sumarDias } from '@/lib/rendimiento/dia'
import { CITA_EXTERNA, CITA_HECHA, CITA_PROXIMA, FANTASMA, L_SOL, MAOLI, crearDatos, fallaCon, usar } from './datos-de-pruebas'
import { CARACTERES_POR_APUNTE, agendaCitas, coldNotas, etiquetaDeCita, tarjetaDeApunte, tarjetaDeCita, type ApunteConLead, type CitaLeida } from './apuntes'
import type { Persona } from './comun'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

async function main() {
  console.log('\n=== la tarjeta de un apunte ===')
  {
    const personas = new Map<string, Persona>([[MAOLI, { id: MAOLI, nombre: 'Maoli Pérez', email: null }]])
    const leads = new Map([[L_SOL, { nombre: 'Lámparas Sol', empresa: 'Lámparas Sol SL' }]])
    const base: ApunteConLead = { id: 'n', lead_id: L_SOL, author_id: MAOLI, kind: 'email', es_respuesta: false, body: 'Hola', occurred_at: '2026-10-27T10:00:00.000Z' }
    const t = tarjetaDeApunte(base, { personas, leads }) as any
    ok('canal con su nombre, autor, cliente con empresa y hora de Madrid', t.canal === 'Email' && t.comercial === 'Maoli Pérez' && t.cliente === 'Lámparas Sol (Lámparas Sol SL)' && t.cuando === '2026-10-27 11:00')
    ok('un texto corto no se marca como recortado', t.texto === 'Hola' && t.texto_recortado === null)
    const largo = tarjetaDeApunte({ ...base, body: 'x'.repeat(2000) }, { personas, leads }) as any
    ok('un texto largo se recorta y dice cuánto había', largo.texto.length === CARACTERES_POR_APUNTE && /de 2000 caracteres/.test(largo.texto_recortado))
    const raro = tarjetaDeApunte({ ...base, author_id: FANTASMA, lead_id: 'otro', body: null, es_respuesta: null }, { personas, leads }) as any
    ok('un autor y un lead que ya no están, y un apunte sin texto, no rompen', raro.comercial === 'Alguien que ya no está' && raro.cliente === 'un lead que ya no está' && raro.texto === '(sin texto)' && raro.respuesta_del_cliente === false)
    ok('sin autor, null', (tarjetaDeApunte({ ...base, author_id: null }, { personas, leads }) as any).comercial === null)
  }

  console.log('\n=== cold_notas ===')
  {
    const d = crearDatos()
    const r = await usar(coldNotas, d.ctx)
    ok('sin lead ni fechas: la última semana (7 apuntes; el de hace 20 días no)', r.total === 7 && r.apuntes.length === 7)
    ok('del más reciente al más antiguo', r.apuntes.every((x: any, i: number) => i === 0 || r.apuntes[i - 1].cuando >= x.cuando))
    ok('cada apunte: canal, comercial, cliente, texto y si es respuesta', r.apuntes.some((x: any) => x.canal === 'WhatsApp' && x.respuesta_del_cliente === true && x.cliente.startsWith('Lámparas Sol') && x.comercial === 'Maoli Pérez'))
    ok('el texto largo se recorta y lo dice', r.apuntes.some((x: any) => x.texto_recortado && /900 de/.test(x.texto_recortado)))

    ok('por comercial', (await usar(coldNotas, d.ctx, { comercial: 'maoli' })).total === 5 && (await usar(coldNotas, d.ctx, { comercial: 'fernanda' })).total === 2)
    ok('por canal', (await usar(coldNotas, d.ctx, { canal: 'whatsapp' })).total === 2 && (await usar(coldNotas, d.ctx, { canal: 'linkedin' })).total === 1)
    ok('solo las respuestas de clientes', (await usar(coldNotas, d.ctx, { solo_respuestas: true })).total === 1)
    ok('por texto', (await usar(coldNotas, d.ctx, { texto: 'catálogo' })).total === 1)

    const sol = await usar(coldNotas, d.ctx, { lead: 'Lámparas Sol' })
    ok('con un lead y sin fechas: TODO su historial (5, el de hace 20 días incluido)', sol.total === 5 && sol.periodo === 'todo el historial del lead')
    ok('y el que ya no tiene autor lo dice', sol.apuntes.some((x: any) => x.comercial === 'Alguien que ya no está'))
    ok('con lead y fechas, solo esas', (await usar(coldNotas, d.ctx, { lead: L_SOL, desde: sumarDias(d.hoy, -5) })).total === 4)
    ok('por días: con 30 días entra el viejo', (await usar(coldNotas, d.ctx, { desde: sumarDias(d.hoy, -30) })).total === 8)
    ok('el periodo se dice', typeof r.periodo === 'object' && r.periodo.hasta === d.hoy)

    const p0 = await usar(coldNotas, d.ctx, { limite: 3 })
    const p2 = await usar(coldNotas, d.ctx, { limite: 3, pagina: 2 })
    ok('paginación con el total real', p0.apuntes.length === 3 && p0.hay_mas && p2.apuntes.length === 1 && !p2.hay_mas && p0.total === 7)

    ok('un canal inválido, error', /llamada/.test((await fallaCon(coldNotas, d.ctx, { canal: 'telegrama' })) ?? ''))
    ok('un rango de más de 92 días, error', /92/.test((await fallaCon(coldNotas, d.ctx, { desde: sumarDias(d.hoy, -200) })) ?? ''))
    ok('un lead que no existe, error', /No hay ningún lead/.test((await fallaCon(coldNotas, d.ctx, { lead: 'zzzzzz' })) ?? ''))
    const sin = crearDatos({ sinTablas: ['cold_lead_notes'] })
    ok('sin la tabla, dice que falta una migración', /migración/.test((await fallaCon(coldNotas, sin.ctx)) ?? ''))
  }

  console.log('\n=== la tarjeta de una cita ===')
  {
    const personas = new Map<string, Persona>([[MAOLI, { id: MAOLI, nombre: 'Maoli Pérez', email: null }]])
    const base: CitaLeida = { id: 'c', comercial_id: MAOLI, assigned_closer_id: null, lead_name: 'Carlos', lead_email: null, lead_phone: null, lead_company: 'Carlos', start_time: '2026-10-28T09:00:00.000Z', end_time: null, status: 'qualified', title: null, notes: null, created_at: '2026-10-27T10:00:00.000Z', revenue_amount: '9000', google_meet_link: null, transcription_summary: null }
    const t = tarjetaDeCita(base, personas) as any
    ok('estado con el nombre de la Agenda, no la clave de la base', t.estado === 'Cita Cualificada' && etiquetaDeCita('no_show') === 'No asistió' && etiquetaDeCita('rescheduled') === 'Re-agendada')
    ok('una empresa igual al nombre no se repite; la facturación llega como número', t.empresa === null && t.facturacion_declarada === 9000)
    ok('quien la atiende, si no hay, null', t.atiende === null && t.agendada_por === 'Maoli Pérez')
    ok('un estado que no se conoce sale tal cual', etiquetaDeCita('invento') === 'invento')
  }

  console.log('\n=== agenda_citas ===')
  {
    const d = crearDatos()
    const r = await usar(agendaCitas, d.ctx)
    ok('sin fechas: desde hace 7 días hasta dentro de 21; sin los eventos externos', r.total === 2 && r.citas.every((c: any) => c.cita_id !== CITA_EXTERNA))
    ok('por reunión, la más próxima al final', r.citas[0].cita_id === CITA_HECHA && r.citas[1].cita_id === CITA_PROXIMA)
    const prox = r.citas[1]
    ok('la próxima: cliente, empresa, correo, quién la agendó y quién la atiende', prox.cliente === 'Carlos Sol' && prox.empresa === 'Lámparas Sol SL' && prox.correo === 'info@lamparassol.es' && prox.agendada_por === 'Maoli Pérez' && prox.atiende === 'Raúl Camuñas')
    ok('estado, notas, facturación y enlace', prox.estado === 'Agendada' && prox.notas === 'Primera reunión' && prox.facturacion_declarada === 12000 && prox.enlace_de_la_reunion === 'https://meet.example/abc')
    ok('la hecha trae el resumen de la reunión', r.citas[0].estado === 'Cita Cualificada' && /noviembre/.test(r.citas[0].resumen_de_la_reunion))
    ok('totales por estado', r.por_estado['Agendada'] === 1 && r.por_estado['Cita Cualificada'] === 1)

    ok('por quien la agendó', (await usar(agendaCitas, d.ctx, { comercial: 'maoli' })).total === 1)
    ok('por quien la atiende (puede no ser comercial)', (await usar(agendaCitas, d.ctx, { atiende: 'raul' })).citas[0].cita_id === CITA_PROXIMA)
    ok('por estado', (await usar(agendaCitas, d.ctx, { estado: 'cualificada' })).citas[0].cita_id === CITA_HECHA && (await usar(agendaCitas, d.ctx, { estado: 'cancelada' })).total === 0)
    const agendadas = await usar(agendaCitas, d.ctx, { por: 'agendada', desde: d.dia, hasta: d.dia })
    ok('por el día en que se agendó', agendadas.total === 1 && agendadas.citas[0].cita_id === CITA_PROXIMA && agendadas.periodo.por === 'día en que se agendó')
    ok('con solo «desde»: 30 días desde ahí', (await usar(agendaCitas, d.ctx, { desde: d.hoy })).periodo.hasta === sumarDias(d.hoy, 30))
    ok('con solo «hasta»: los 30 anteriores', (await usar(agendaCitas, d.ctx, { hasta: d.hoy })).periodo.desde === sumarDias(d.hoy, -30))
    ok('las dos fechas, tal cual', (await usar(agendaCitas, d.ctx, { desde: sumarDias(d.hoy, -10), hasta: sumarDias(d.hoy, 10) })).total === 2)
    const p0 = await usar(agendaCitas, d.ctx, { limite: 1 })
    ok('paginación', p0.citas.length === 1 && p0.hay_mas && p0.total === 2)

    ok('un estado inválido, error con las opciones', /cualificada/.test((await fallaCon(agendaCitas, d.ctx, { estado: 'completed' })) ?? ''))
    ok('un comercial que no existe, error', /Maoli Pérez/.test((await fallaCon(agendaCitas, d.ctx, { comercial: 'pepito' })) ?? ''))
    ok('un rango de más de 92 días, error', /92/.test((await fallaCon(agendaCitas, d.ctx, { desde: sumarDias(d.hoy, -200), hasta: d.hoy })) ?? ''))
    const sin = crearDatos({ sinTablas: ['appointments'] })
    ok('sin la tabla, dice que falta una migración', /migración/.test((await fallaCon(agendaCitas, sin.ctx)) ?? ''))
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
