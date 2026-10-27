import { etiquetaDeEstadoDeCita } from '@/lib/rendimiento/actividad'
import { hoyMadrid, sumarDias } from '@/lib/rendimiento/dia'
import { APPOINTMENT_STATUS_LABELS, type AppointmentStatus } from '@/lib/types/appointments'
import { aTexto, booleano, opcion, texto } from '../argumentos'
import type { ContextoMcp } from '../contexto'
import { type Herramienta } from '../protocolo'
import { ajustarAlTamano, comprobar, datosDePagina, diaArg, equipoComercial, elegirPersona, fechaHora, fetchAll, fallo, instantesDe, nombresDeLeads, paginaArg, patronDeBusqueda, personasPorId, rangoArg, recortar, recortarLargo, servicioDe, type Persona } from './comun'
import { comercialArg, etiquetaDeCanal, leadsDeFiltro, type ApunteLeido } from './leads'

/**
 * COLD CALLING PARA CLAUDE, TERCERA PARTE: LO QUE SE HA APUNTADO CON LOS LEADS Y LAS CITAS QUE SALEN DE ELLO.
 * SOLO SERVIDOR; lo puro se prueba en apuntes.prueba.ts con una base en memoria.
 *
 * Un APUNTE es lo que el comercial deja escrito en la ficha de un lead: una llamada, un correo, un WhatsApp, un mensaje de LinkedIn o una nota suelta, y
 * si el texto es lo que ha contestado el cliente (`es_respuesta`). De ahí salen, entre otras, las cifras de WhatsApp, correos y respuestas de Mi rendimiento.
 * Una CITA es lo que se agenda en la Agenda del ERP (también las agenda un comercial para que las atienda otra persona, el «closer»).
 */

/* ------------------------------------------------------------------ */
/* cold_notas                                                          */
/* ------------------------------------------------------------------ */

const CANALES = ['todos', 'llamada', 'email', 'whatsapp', 'linkedin', 'nota'] as const

export interface ApunteConLead extends ApunteLeido {
  lead_id: string
}

export const CARACTERES_POR_APUNTE = 900

export function tarjetaDeApunte(a: ApunteConLead, e: { personas: ReadonlyMap<string, Persona>; leads: ReadonlyMap<string, { nombre: string; empresa: string | null }> }): Record<string, unknown> {
  const l = e.leads.get(a.lead_id)
  const cuerpo = recortarLargo(a.body, CARACTERES_POR_APUNTE)
  return {
    apunte_id: a.id,
    cuando: fechaHora(a.occurred_at),
    canal: etiquetaDeCanal(a.kind),
    comercial: a.author_id ? (e.personas.get(a.author_id)?.nombre ?? 'Alguien que ya no está') : null,
    cliente: l ? (l.empresa && l.empresa !== l.nombre ? `${l.nombre} (${l.empresa})` : l.nombre) : 'un lead que ya no está',
    lead_id: a.lead_id,
    respuesta_del_cliente: a.es_respuesta === true,
    texto: cuerpo.texto ?? '(sin texto)',
    texto_recortado: cuerpo.recortado ? `se enseñan ${CARACTERES_POR_APUNTE} de ${cuerpo.caracteres} caracteres` : null,
  }
}

export const coldNotas: Herramienta<ContextoMcp> = {
  nombre: 'cold_notas',
  titulo: 'Cold Calling: los apuntes con los leads',
  descripcion:
    'Lo que el equipo ha apuntado en las fichas de Cold Calling: llamadas, correos, WhatsApp, LinkedIn y notas, con el texto de cada apunte, quién lo escribió, a qué lead y si es una respuesta del cliente. Es el ' +
    'historial de contactos del proceso de ventas. Filtra por comercial, por lead, por canal, por días, por texto y por «solo respuestas de clientes». Con un lead concreto y sin fechas devuelve todo su historial; ' +
    'sin lead ni fechas, los últimos 7 días. Del más reciente al más antiguo, con total y paginación.',
  esquema: {
    type: 'object',
    properties: {
      comercial: { type: 'string', description: 'Quién escribió el apunte: nombre (o parte), correo o id.' },
      lead: { type: 'string', description: 'El lead: su id, o parte de su nombre, empresa, correo o teléfono.' },
      canal: { type: 'string', enum: [...CANALES], description: 'llamada · email · whatsapp · linkedin · nota · todos (por defecto).' },
      solo_respuestas: { type: 'boolean', description: 'true = solo los apuntes que recogen lo que contestó el cliente.' },
      texto: { type: 'string', description: 'Parte del texto del apunte.' },
      desde: { type: 'string', description: 'Primer día (AAAA-MM-DD, «hoy» o «ayer»).' },
      hasta: { type: 'string', description: 'Último día, incluido. Máximo 92 días de rango.' },
      limite: { type: 'integer', description: 'Apuntes por página. Por defecto 25, hasta 60.' },
      pagina: { type: 'integer', description: 'Empieza en 0.' },
    },
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const s = servicioDe(ctx)
    const hoy = hoyMadrid()
    const persona = await comercialArg(s, args)
    const leadTexto = texto(args, 'lead', { max: 120 })
    const leadIds = leadTexto ? await leadsDeFiltro(s, leadTexto) : null
    const canal = opcion<(typeof CANALES)[number]>(args, 'canal', CANALES, 'todos')
    const soloRespuestas = booleano(args, 'solo_respuestas', false)
    const busqueda = texto(args, 'texto', { max: 80 })
    const p = paginaArg(args, { limite: 25, max: 60 })

    // Con un lead y sin fechas se quiere SU historial entero; si no, la semana
    const sinFechas = args.desde === undefined && args.hasta === undefined
    const rango = leadIds && sinFechas ? null : sinFechas ? { desde: sumarDias(hoy, -6), hasta: hoy } : rangoArg(args, { maxDias: 92, hoy })
    const instantes = rango ? instantesDe(rango) : null

    let q = s.from('cold_lead_notes').select('id, lead_id, author_id, kind, es_respuesta, body, occurred_at', { count: 'exact' })
    if (persona) q = q.eq('author_id', persona.id)
    if (leadIds) q = q.in('lead_id', leadIds)
    if (canal !== 'todos') q = q.eq('kind', canal)
    if (soloRespuestas) q = q.eq('es_respuesta', true)
    if (busqueda) q = q.ilike('body', patronDeBusqueda(busqueda))
    if (instantes) q = q.gte('occurred_at', instantes.desde).lt('occurred_at', instantes.hasta)
    const { data, count } = comprobar(await q.order('occurred_at', { ascending: false }).order('id', { ascending: true }).range(p.desde, p.hasta), 'cold_lead_notes')
    const apuntes = (data ?? []) as ApunteConLead[]

    const [personas, leads] = await Promise.all([personasPorId(s, apuntes.map((a) => a.author_id).filter((x): x is string => !!x)), nombresDeLeads(s, apuntes.map((a) => a.lead_id))])
    const nombres = new Map([...leads.entries()].map(([id, l]) => [id, { nombre: l.nombre, empresa: l.empresa }]))
    return {
      texto: aTexto(
        ajustarAlTamano(
        {
          periodo: rango ?? 'todo el historial del lead',
          filtro: { comercial: persona?.nombre ?? null, lead: leadTexto ?? null, canal, solo_respuestas: soloRespuestas || null, texto: busqueda ?? null },
          ...datosDePagina(p, count ?? apuntes.length, apuntes.length),
          apuntes: apuntes.map((a) => tarjetaDeApunte(a, { personas, leads: nombres })),
        },
        'apuntes',
        27_000
        ),
        30_000
      ),
    }
  },
}

/* ------------------------------------------------------------------ */
/* agenda_citas                                                        */
/* ------------------------------------------------------------------ */

/** Los estados de una cita en la Agenda (el tipo `appointment_status` de la base, tras las migraciones 076 y 093) con el nombre con que se piden */
const ESTADOS_DE_CITA = ['agendada', 'confirmada', 're_agendada', 'cualificada', 'no_cualificada', 'no_asistio', 'cancelada'] as const
const ESTADO_EN_LA_BASE: Record<(typeof ESTADOS_DE_CITA)[number], AppointmentStatus> = {
  agendada: 'scheduled',
  confirmada: 'confirmed',
  re_agendada: 'rescheduled',
  cualificada: 'qualified',
  no_cualificada: 'not_qualified',
  no_asistio: 'no_show',
  cancelada: 'cancelled',
}

/** Cómo se llama el estado de una cita en la Agenda; uno que no se conozca sale tal cual */
export const etiquetaDeCita = (estado: string): string => APPOINTMENT_STATUS_LABELS[estado as AppointmentStatus] ?? etiquetaDeEstadoDeCita(estado)

export interface CitaLeida {
  id: string
  comercial_id: string | null
  assigned_closer_id: string | null
  lead_name: string
  lead_email: string | null
  lead_phone: string | null
  lead_company: string | null
  start_time: string
  end_time: string | null
  status: string
  title: string | null
  notes: string | null
  created_at: string
  revenue_amount: number | string | null
  google_meet_link: string | null
  transcription_summary: string | null
}

const CAMPOS_DE_CITA =
  'id, comercial_id, assigned_closer_id, lead_name, lead_email, lead_phone, lead_company, start_time, end_time, status, title, notes, created_at, revenue_amount, google_meet_link, transcription_summary'

export function tarjetaDeCita(c: CitaLeida, personas: ReadonlyMap<string, Persona>): Record<string, unknown> {
  const facturacion = c.revenue_amount === null || c.revenue_amount === '' ? null : Number(c.revenue_amount)
  return {
    cita_id: c.id,
    cliente: c.lead_name,
    empresa: c.lead_company && c.lead_company !== c.lead_name ? c.lead_company : null,
    correo: c.lead_email,
    telefono: c.lead_phone,
    reunion: fechaHora(c.start_time),
    termina: fechaHora(c.end_time),
    estado: etiquetaDeCita(c.status),
    agendada_por: c.comercial_id ? (personas.get(c.comercial_id)?.nombre ?? 'Alguien que ya no está') : null,
    atiende: c.assigned_closer_id ? (personas.get(c.assigned_closer_id)?.nombre ?? 'Alguien que ya no está') : null,
    agendada: fechaHora(c.created_at),
    titulo: recortar(c.title, 160),
    notas: recortar(c.notes, 500),
    facturacion_declarada: facturacion !== null && Number.isFinite(facturacion) ? facturacion : null,
    enlace_de_la_reunion: c.google_meet_link,
    resumen_de_la_reunion: recortar(c.transcription_summary, 600),
  }
}

export const agendaCitas: Herramienta<ContextoMcp> = {
  nombre: 'agenda_citas',
  titulo: 'Agenda: las citas comerciales',
  descripcion:
    'Las citas de la Agenda del ERP (las reuniones que agenda el equipo comercial con leads): cuándo es la reunión, con quién, quién la agendó y quién la atiende, su estado (agendada, confirmada, re-agendada, cualificada, no cualificada, ' +
    'no asistió, cancelada), las notas y, si la reunión se grabó, su resumen. Filtra por el comercial que la agendó, por quien la atiende, por estado y por días, ya sea del día de la reunión o del día en que se agendó. ' +
    'Sin fechas, desde hace 7 días hasta dentro de 21; con solo `desde`, 30 días desde ese día; con solo `hasta`, los 30 anteriores. No incluye los eventos que vienen de Google Calendar y no son citas del ERP.',
  esquema: {
    type: 'object',
    properties: {
      comercial: { type: 'string', description: 'Quién agendó la cita: nombre (o parte), correo o id.' },
      atiende: { type: 'string', description: 'Quién atiende la reunión (el closer): nombre (o parte), correo o id.' },
      estado: { type: 'string', enum: [...ESTADOS_DE_CITA], description: 'agendada · confirmada · re_agendada · cualificada (cita cualificada) · no_cualificada · no_asistio · cancelada.' },
      por: { type: 'string', enum: ['reunion', 'agendada'], description: 'Qué día miran desde/hasta: el de la reunión (por defecto) o el día en que se agendó.' },
      desde: { type: 'string', description: 'Primer día (AAAA-MM-DD, «hoy» o «ayer»).' },
      hasta: { type: 'string', description: 'Último día, incluido. Máximo 92 días de rango.' },
      limite: { type: 'integer', description: 'Citas por página. Por defecto 25, hasta 60.' },
      pagina: { type: 'integer', description: 'Empieza en 0.' },
    },
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const s = servicioDe(ctx)
    const hoy = hoyMadrid()
    const equipo = await equipoComercial(s)
    const quien = texto(args, 'comercial', { max: 120 })
    const closer = texto(args, 'atiende', { max: 120 })
    const agendo: Persona | null = quien ? elegirPersona(equipo, quien) : null
    const atiende: Persona | null = closer ? elegirPersona(await todasLasPersonas(s), closer, 'miembro del equipo') : null
    const estado = opcion<(typeof ESTADOS_DE_CITA)[number] | ''>(args, 'estado', ['', ...ESTADOS_DE_CITA], '')
    const por = opcion<'reunion' | 'agendada'>(args, 'por', ['reunion', 'agendada'], 'reunion')
    const p = paginaArg(args, { limite: 25, max: 60 })
    const d = diaArg(args, 'desde', { hoy })
    const h = diaArg(args, 'hasta', { hoy })
    // Las citas miran hacia delante: sin fechas, la semana pasada y las tres próximas; con una sola fecha, 30 días desde ella (o hasta ella)
    const rango = d === undefined && h === undefined ? { desde: sumarDias(hoy, -7), hasta: sumarDias(hoy, 21) } : d !== undefined && h === undefined ? { desde: d, hasta: sumarDias(d, 30) } : d === undefined && h !== undefined ? { desde: sumarDias(h, -30), hasta: h } : rangoArg(args, { maxDias: 92, hoy })
    const { desde, hasta } = instantesDe(rango)
    const columna = por === 'reunion' ? 'start_time' : 'created_at'

    const citas = await fetchAll<CitaLeida>((de, a) => {
      let q = s.from('appointments').select(CAMPOS_DE_CITA).eq('is_external', false).gte(columna, desde).lt(columna, hasta)
      if (agendo) q = q.eq('comercial_id', agendo.id)
      if (atiende) q = q.eq('assigned_closer_id', atiende.id)
      if (estado) q = q.eq('status', ESTADO_EN_LA_BASE[estado])
      return q.order(columna, { ascending: por === 'reunion' }).order('id', { ascending: true }).range(de, a)
    }).catch((e) => fallo(e, 'appointments'))

    const pagina = citas.slice(p.desde, p.hasta + 1)
    const personas = await personasPorId(s, pagina.flatMap((c) => [c.comercial_id, c.assigned_closer_id]).filter((x): x is string => !!x))
    const porEstado: Record<string, number> = {}
    for (const c of citas) porEstado[etiquetaDeCita(c.status)] = (porEstado[etiquetaDeCita(c.status)] ?? 0) + 1
    return {
      texto: aTexto(
        ajustarAlTamano(
        {
          periodo: { por: por === 'reunion' ? 'día de la reunión' : 'día en que se agendó', desde: rango.desde, hasta: rango.hasta },
          filtro: { comercial: agendo?.nombre ?? null, atiende: atiende?.nombre ?? null, estado: estado || null },
          por_estado: porEstado,
          ...datosDePagina(p, citas.length, pagina.length),
          citas: pagina.map((c) => tarjetaDeCita(c, personas)),
        },
        'citas',
        27_000
        ),
        30_000
      ),
    }
  },
}

/** Cualquier persona con perfil (quien atiende una cita puede no ser comercial). Pocas decenas */
async function todasLasPersonas(s: ReturnType<typeof servicioDe>): Promise<Persona[]> {
  const filas = await fetchAll<{ id: string; full_name: string | null; email: string | null; role: string | null }>((de, a) =>
    s.from('profiles').select('id, full_name, email, role').in('role', ['admin', 'employee', 'partner']).order('full_name', { ascending: true }).order('id', { ascending: true }).range(de, a)
  ).catch((e) => fallo(e, 'perfiles'))
  return filas.map((p) => ({ id: p.id, nombre: p.full_name?.trim() || p.email || 'Sin nombre', email: p.email }))
}

export const HERRAMIENTAS_DE_APUNTES: readonly Herramienta<ContextoMcp>[] = [coldNotas, agendaCitas]
