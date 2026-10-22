import { diaMadrid, horaMadrid } from './dia'

/**
 * LO QUE HA HECHO CADA PERSONA, CLIENTE A CLIENTE: LAS CONVERSACIONES Y LAS CITAS DE UN PERIODO.
 * ==============================================================================================
 * PURO. Se comprueba con actividad.prueba.ts. Lo usan el navegador y las pruebas.
 *
 * Las cifras del panel dicen CUÁNTAS conversaciones hubo; esto dice CON QUIÉN y qué se apuntó en cada momento.
 * Es la misma regla que las cifras (y que la función SQL rendimiento_resumen_diario): una conversación es un
 * cliente, en un canal, en un día, por muchas interacciones que se hayan apuntado. Aquí cada conversación lleva
 * dentro sus interacciones, con la hora y el comentario de cada una, para poder abrirla y leerlas.
 *
 *   · Una interacción marcada como respuesta del cliente forma parte de la conversación de su canal, y además la
 *     hace «con respuesta»: así el filtro de respuestas enseña a los clientes que contestaron y lo que contestaron.
 *   · Las citas no son conversaciones: son lo que se agendó, con cuándo se agendó y para cuándo es.
 *   · El día y la hora son los de Madrid (ver dia.ts).
 */

export type Canal = 'whatsapp' | 'correo' | 'linkedin' | 'llamada' | 'nota'

/** Del tipo de nota de Cold Calling (`kind`) al canal con el que se habla de ella */
export function canalDe(kind: string): Canal {
  switch (kind) {
    case 'whatsapp':
      return 'whatsapp'
    case 'email':
      return 'correo'
    case 'linkedin':
      return 'linkedin'
    case 'llamada':
      return 'llamada'
    default:
      return 'nota'
  }
}

export const ETIQUETA_DE_CANAL: Record<Canal, string> = {
  whatsapp: 'WhatsApp',
  correo: 'Correo',
  linkedin: 'LinkedIn',
  llamada: 'Llamada anotada',
  nota: 'Nota',
}

/** Una nota de Cold Calling tal como se lee de la base */
export interface NotaDeActividad {
  id: string
  kind: string
  es_respuesta: boolean | null
  body: string | null
  occurred_at: string
  lead_id: string
}

/** Una cita tal como se lee de la base */
export interface CitaDeActividad {
  id: string
  lead_name: string
  lead_company: string | null
  start_time: string
  status: string
  created_at: string
}

/** Lo que se sabe de un cliente (un lead de Cold Calling) para enseñarlo por su nombre */
export interface Cliente {
  nombre: string
  empresa: string | null
}

export interface Interaccion {
  id: string
  /** El instante, para ordenar */
  instante: string
  /** «12:14», hora de Madrid */
  hora: string
  /** El comentario que se apuntó */
  texto: string
  /** Lo que escribió o dijo el cliente, no lo que mandó el comercial */
  esRespuesta: boolean
}

export interface Conversacion {
  /** `${día}|${canal}|${cliente}`: identifica la conversación */
  clave: string
  dia: string
  canal: Canal
  leadId: string
  interacciones: Interaccion[]
  /** La hora de la primera y de la última interacción, «10:12» y «13:40» */
  desde: string
  hasta: string
  /** El cliente contestó en algún momento de la conversación */
  hayRespuesta: boolean
}

/**
 * Las notas agrupadas en conversaciones: un cliente, un canal, un día. Salen en el orden de su primera
 * interacción, y las interacciones de cada una, por hora.
 */
export function agruparConversaciones(notas: readonly NotaDeActividad[]): Conversacion[] {
  const ordenadas = [...notas].sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.id.localeCompare(b.id)))
  const grupos = new Map<string, Conversacion>()
  for (const n of ordenadas) {
    const dia = diaMadrid(n.occurred_at)
    const canal = canalDe(n.kind)
    const clave = `${dia}|${canal}|${n.lead_id}`
    const hora = horaMadrid(n.occurred_at)
    const interaccion: Interaccion = { id: n.id, instante: n.occurred_at, hora, texto: (n.body ?? '').trim(), esRespuesta: n.es_respuesta === true }
    const existente = grupos.get(clave)
    if (existente) {
      existente.interacciones.push(interaccion)
      existente.hasta = hora
      if (interaccion.esRespuesta) existente.hayRespuesta = true
    } else {
      grupos.set(clave, { clave, dia, canal, leadId: n.lead_id, interacciones: [interaccion], desde: hora, hasta: hora, hayRespuesta: interaccion.esRespuesta })
    }
  }
  return [...grupos.values()]
}

/** Cómo se llama cada estado de una cita en la Agenda (appointment_status). Uno que no se conozca sale tal cual */
const ETIQUETA_DE_ESTADO_DE_CITA: Record<string, string> = {
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  completed: 'Realizada',
  qualified: 'Cualificada',
  not_qualified: 'No cualificada',
  rescheduled: 'Re-agendada',
  cancelled: 'Cancelada',
  no_show: 'No se presentó',
}

export const etiquetaDeEstadoDeCita = (estado: string): string => ETIQUETA_DE_ESTADO_DE_CITA[estado] ?? estado

export interface CitaAgendada {
  id: string
  /** El día y la hora en que se agendó */
  dia: string
  hora: string
  cliente: string
  empresa: string | null
  /** Para cuándo es la cita */
  paraDia: string
  paraHora: string
  estado: string
}

/** Las citas, por el momento en que se agendaron */
export function citasAgendadas(citas: readonly CitaDeActividad[]): CitaAgendada[] {
  return [...citas]
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id.localeCompare(b.id)))
    .map((c) => ({
      id: c.id,
      dia: diaMadrid(c.created_at),
      hora: horaMadrid(c.created_at),
      cliente: c.lead_name,
      empresa: c.lead_company,
      paraDia: diaMadrid(c.start_time),
      paraHora: horaMadrid(c.start_time),
      estado: c.status,
    }))
}

/* ------------------------------------------------------------------ */
/* La lista que se enseña                                              */
/* ------------------------------------------------------------------ */

export type FiltroDeActividad = 'todo' | 'whatsapp' | 'correos' | 'respuestas' | 'citas' | 'otras'

export const FILTROS_DE_ACTIVIDAD: ReadonlyArray<{ id: FiltroDeActividad; etiqueta: string }> = [
  { id: 'todo', etiqueta: 'Todo' },
  { id: 'whatsapp', etiqueta: 'WhatsApp' },
  { id: 'correos', etiqueta: 'Correos' },
  { id: 'respuestas', etiqueta: 'Respuestas' },
  { id: 'citas', etiqueta: 'Citas' },
  { id: 'otras', etiqueta: 'Otras notas' },
]

export type ItemDeActividad =
  | { tipo: 'conversacion'; dia: string; hora: string; conversacion: Conversacion }
  | { tipo: 'cita'; dia: string; hora: string; cita: CitaAgendada }

function cumple(item: ItemDeActividad, filtro: FiltroDeActividad): boolean {
  if (filtro === 'todo') return true
  if (item.tipo === 'cita') return filtro === 'citas'
  const c = item.conversacion
  switch (filtro) {
    case 'whatsapp':
      return c.canal === 'whatsapp'
    case 'correos':
      return c.canal === 'correo'
    case 'respuestas':
      return c.hayRespuesta
    case 'otras':
      return c.canal === 'linkedin' || c.canal === 'llamada' || c.canal === 'nota'
    default:
      return false
  }
}

/** Todo lo que hubo, del primer momento al último, para filtrar y enseñar */
export function itemsDeActividad(conversaciones: readonly Conversacion[], citas: readonly CitaAgendada[]): ItemDeActividad[] {
  const items: ItemDeActividad[] = [
    ...conversaciones.map((c): ItemDeActividad => ({ tipo: 'conversacion', dia: c.dia, hora: c.desde, conversacion: c })),
    ...citas.map((c): ItemDeActividad => ({ tipo: 'cita', dia: c.dia, hora: c.hora, cita: c })),
  ]
  return items.sort((a, b) => (a.dia === b.dia ? a.hora.localeCompare(b.hora) : a.dia.localeCompare(b.dia)))
}

export function filtrarActividad(items: readonly ItemDeActividad[], filtro: FiltroDeActividad): ItemDeActividad[] {
  return items.filter((i) => cumple(i, filtro))
}

/**
 * Cuántos elementos tiene cada filtro, para los botones.
 *
 * «Respuestas» cuenta CLIENTES que contestaron cada día, que es lo que dice la tarjeta del panel: un cliente que
 * contestó por WhatsApp y por correo el mismo día es una respuesta, aunque salga en dos conversaciones de la lista.
 */
export function contarPorFiltro(items: readonly ItemDeActividad[]): Record<FiltroDeActividad, number> {
  const cuenta: Record<FiltroDeActividad, number> = { todo: items.length, whatsapp: 0, correos: 0, respuestas: 0, citas: 0, otras: 0 }
  for (const f of FILTROS_DE_ACTIVIDAD) {
    if (f.id !== 'todo' && f.id !== 'respuestas') cuenta[f.id] = items.filter((i) => cumple(i, f.id)).length
  }
  const clientesQueContestaron = new Set<string>()
  for (const i of items) if (i.tipo === 'conversacion' && i.conversacion.hayRespuesta) clientesQueContestaron.add(`${i.dia}|${i.conversacion.leadId}`)
  cuenta.respuestas = clientesQueContestaron.size
  return cuenta
}

export interface RespuestaDeCliente {
  id: string
  dia: string
  hora: string
  canal: Canal
  leadId: string
  /** Lo que se apuntó que contestó el cliente */
  texto: string
}

/** Cada vez que un cliente contestó, con lo que dijo, por día y hora: lo que se lee para ver qué respondieron */
export function respuestasDe(conversaciones: readonly Conversacion[]): RespuestaDeCliente[] {
  const respuestas: RespuestaDeCliente[] = []
  for (const c of conversaciones) {
    for (const i of c.interacciones) {
      if (i.esRespuesta) respuestas.push({ id: i.id, dia: c.dia, hora: i.hora, canal: c.canal, leadId: c.leadId, texto: i.texto })
    }
  }
  return respuestas.sort((a, b) => a.dia.localeCompare(b.dia) || a.hora.localeCompare(b.hora) || a.id.localeCompare(b.id))
}

/** Los identificadores de los clientes que salen en una lista, para ir a buscar sus nombres */
export function clientesDe(conversaciones: readonly Conversacion[]): string[] {
  return [...new Set(conversaciones.map((c) => c.leadId))]
}
