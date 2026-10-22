import { diaMadrid, diasDelMes, indiceDeSemana } from './dia'

/**
 * LAS CIFRAS DEL PANEL DE RENDIMIENTO.
 * ====================================
 * PURO. Se comprueba con metricas.prueba.ts. Lo usan el servidor y el navegador.
 *
 * Las mismas cinco cifras que el comercial apuntaba a mano en el recap de cada día —llamadas
 * hechas, WhatsApp, correos, respuestas de clientes y citas—, pero calculadas de donde ya queda
 * todo escrito: las llamadas, de Rinkel; los mensajes, los correos y las respuestas, de las notas
 * de Cold Calling; las citas, de la Agenda.
 *
 * LOS DÍAS SON LOS DE MADRID (ver dia.ts), y una cifra nunca se calcula sobre el texto ISO.
 */

/**
 * Cuánto tiene que durar una llamada contestada para contarla como CONVERSACIÓN.
 *
 * «Contestada» no basta: en las llamadas reales de una mañana, la mitad de las que Rinkel da por
 * contestadas duran menos de 32 segundos (buzones de voz, quien descuelga y cuelga, un «ahora no
 * puedo»). Un minuto es lo que separa «alguien cogió» de «se habló». Es una convención de lectura, no
 * un dato de Rinkel, y por eso está aquí con nombre y no suelta por el código.
 */
export const SEGUNDOS_DE_CONVERSACION = 60

/* ------------------------------------------------------------------ */
/* Llamadas                                                            */
/* ------------------------------------------------------------------ */

export interface LlamadaParaMetricas {
  fecha: string
  direccion: string
  estado: string
  duracion_s: number
  numero: string | null
  grabacion_id: string | null
}

export interface ResumenDeLlamadas {
  /** Todas las del día, entrantes o salientes */
  total: number
  /** Las que hizo el comercial: es «llamadas hechas hoy» */
  realizadas: number
  recibidas: number
  /** De las realizadas, a cuántas respondieron */
  contestadas: number
  /** Contestadas / realizadas, de 0 a 1 */
  tasaDeContacto: number
  /** Lo que se estuvo al teléfono: la suma de las contestadas, entrantes y salientes */
  segundosHablados: number
  /** Las contestadas (de cualquier sentido) que pasaron de SEGUNDOS_DE_CONVERSACION */
  conversaciones: number
  /** A cuántos números distintos se llamó (las realizadas) */
  numerosDistintos: number
  conGrabacion: number
  /** El instante de la primera y de la última, para decir «de 10:24 a 14:01» */
  primera: string | null
  ultima: string | null
}

const VACIO: ResumenDeLlamadas = {
  total: 0,
  realizadas: 0,
  recibidas: 0,
  contestadas: 0,
  tasaDeContacto: 0,
  segundosHablados: 0,
  conversaciones: 0,
  numerosDistintos: 0,
  conGrabacion: 0,
  primera: null,
  ultima: null,
}

export function resumenDeLlamadas(llamadas: readonly LlamadaParaMetricas[]): ResumenDeLlamadas {
  if (llamadas.length === 0) return { ...VACIO }
  let realizadas = 0
  let recibidas = 0
  let contestadas = 0
  let segundos = 0
  let conversaciones = 0
  let conGrabacion = 0
  const numeros = new Set<string>()
  let primera = llamadas[0].fecha
  let ultima = llamadas[0].fecha

  for (const l of llamadas) {
    const salio = l.direccion === 'outbound'
    const entro = l.direccion === 'inbound'
    const respondida = l.estado === 'ANSWERED'
    if (salio) {
      realizadas += 1
      if (respondida) contestadas += 1
      if (l.numero) numeros.add(l.numero)
    }
    if (entro) recibidas += 1
    if (respondida) {
      segundos += l.duracion_s
      if (l.duracion_s >= SEGUNDOS_DE_CONVERSACION) conversaciones += 1
    }
    if (l.grabacion_id) conGrabacion += 1
    if (l.fecha < primera) primera = l.fecha
    if (l.fecha > ultima) ultima = l.fecha
  }

  return {
    total: llamadas.length,
    realizadas,
    recibidas,
    contestadas,
    tasaDeContacto: realizadas === 0 ? 0 : contestadas / realizadas,
    segundosHablados: segundos,
    conversaciones,
    numerosDistintos: numeros.size,
    conGrabacion,
    primera,
    ultima,
  }
}

/** Las llamadas agrupadas por día de Madrid. Los días sin llamadas no aparecen */
export function agruparPorDia<T extends LlamadaParaMetricas>(llamadas: readonly T[]): Map<string, T[]> {
  const porDia = new Map<string, T[]>()
  for (const l of llamadas) {
    const dia = diaMadrid(l.fecha)
    const lista = porDia.get(dia)
    if (lista) lista.push(l)
    else porDia.set(dia, [l])
  }
  return porDia
}

/* ------------------------------------------------------------------ */
/* El calendario del mes                                               */
/* ------------------------------------------------------------------ */

export interface CeldaDelMes {
  dia: string
  resumen: ResumenDeLlamadas
}

export interface MesDeLlamadas {
  /** Casillas en blanco antes del día 1, con la semana empezando en lunes */
  huecos: number
  celdas: CeldaDelMes[]
  /** Lo más que se llamó en un día de este mes: sirve para graduar el color */
  maximoRealizadas: number
  /** Suma del mes */
  total: ResumenDeLlamadas
}

export function mesDeLlamadas(anio: number, mes: number, llamadas: readonly LlamadaParaMetricas[]): MesDeLlamadas {
  const dias = diasDelMes(anio, mes)
  const porDia = agruparPorDia(llamadas)
  const celdas = dias.map((dia) => ({ dia, resumen: resumenDeLlamadas(porDia.get(dia) ?? []) }))
  // Solo se suman las llamadas que caen EN el mes: el rango que se pidió a la base puede traer de más por los bordes
  const delMes = new Set(dias)
  const enElMes = llamadas.filter((l) => delMes.has(diaMadrid(l.fecha)))
  return {
    huecos: indiceDeSemana(dias[0]),
    celdas,
    maximoRealizadas: celdas.reduce((m, c) => Math.max(m, c.resumen.realizadas), 0),
    total: resumenDeLlamadas(enElMes),
  }
}

/**
 * Qué intensidad de color le toca a un día, de 0 a 4. 0 = sin llamadas.
 *
 * Se gradúa contra el máximo del mes y no con umbrales fijos: así un mes flojo también se lee (el día
 * de más actividad siempre es el más oscuro) y uno muy cargado no pinta todo igual.
 */
export function intensidad(realizadas: number, maximo: number): 0 | 1 | 2 | 3 | 4 {
  if (realizadas <= 0 || maximo <= 0) return 0
  const proporcion = realizadas / maximo
  if (proporcion > 0.75) return 4
  if (proporcion > 0.5) return 3
  if (proporcion > 0.25) return 2
  return 1
}

/* ------------------------------------------------------------------ */
/* Mensajes, correos, respuestas y citas                               */
/* ------------------------------------------------------------------ */

export interface NotaParaMetricas {
  kind: string
  es_respuesta: boolean | null
  occurred_at: string
  /**
   * El lead (el cliente) al que se apuntó la interacción. Lo que cuenta es CUÁNTOS CLIENTES DISTINTOS, no cuántas
   * notas. Si faltara (la columna es obligatoria, así que no debería), cada nota cuenta como un cliente propio
   * para no perderla.
   */
  lead_id?: string | null
}

export interface ActividadDeNotas {
  /**
   * CONVERSACIONES de WhatsApp: clientes DISTINTOS con los que se habló por WhatsApp ese día. Siete interacciones
   * apuntadas con el mismo cliente son UNA conversación, y da igual si son mensajes que mandó el comercial o que
   * recibió del cliente: es la conversación con esa persona ese día.
   */
  whatsapp: number
  /** Interacciones de WhatsApp apuntadas ese día, sin agrupar. De ellas salen las conversaciones de arriba */
  whatsappApuntes: number
  /** CONVERSACIONES por correo, con la misma regla */
  correos: number
  correosApuntes: number
  /** Clientes distintos que han contestado ese día (lo que el comercial marca como respuesta), por el canal que sea */
  respuestas: number
  /** Clientes distintos a los que el comercial dejó anotada una llamada (no son las de Rinkel: no todas se anotan) */
  llamadasAnotadas: number
  /** Conversaciones de LinkedIn, con la misma regla. Se guardan; el panel todavía no las enseña */
  linkedin: number
}

/**
 * Qué hizo un comercial un día, según las notas de Cold Calling.
 *
 * LA UNIDAD ES LA CONVERSACIÓN, NO LA NOTA. Lo que importa a quien mira el rendimiento es con cuántos clientes
 * se habló, no cuántas veces se pulsó «Registrar»: apuntar siete WhatsApp de una misma charla no es siete
 * conversaciones. Se cuenta un cliente por canal y por día, y el día es el de Madrid.
 *
 * `es_respuesta` suma a «respuestas» (clientes que contestaron) y NO resta nada a la conversación del canal: un
 * cliente que escribe por WhatsApp y al que se le contesta es una conversación de WhatsApp, y además es una
 * respuesta. Las notas de texto libre (`nota`) no cuentan en ninguna: son comentarios, no contactos.
 */
export function actividadDeNotas(notas: readonly NotaParaMetricas[], dia: string): ActividadDeNotas {
  const porCanal = {
    whatsapp: new Set<string>(),
    email: new Set<string>(),
    llamada: new Set<string>(),
    linkedin: new Set<string>(),
  }
  const respondieron = new Set<string>()
  let whatsappApuntes = 0
  let correosApuntes = 0

  notas.forEach((n, i) => {
    if (diaMadrid(n.occurred_at) !== dia) return
    const cliente = n.lead_id ?? `sin-lead-${i}`
    if (n.es_respuesta === true) respondieron.add(cliente)
    if (n.kind === 'whatsapp') {
      porCanal.whatsapp.add(cliente)
      whatsappApuntes += 1
    } else if (n.kind === 'email') {
      porCanal.email.add(cliente)
      correosApuntes += 1
    } else if (n.kind === 'llamada') porCanal.llamada.add(cliente)
    else if (n.kind === 'linkedin') porCanal.linkedin.add(cliente)
  })

  return {
    whatsapp: porCanal.whatsapp.size,
    whatsappApuntes,
    correos: porCanal.email.size,
    correosApuntes,
    respuestas: respondieron.size,
    llamadasAnotadas: porCanal.llamada.size,
    linkedin: porCanal.linkedin.size,
  }
}

/** Cuántas citas se agendaron ese día (por el día en que se CREARON, no por el día de la cita) */
export function citasAgendadasEl(citas: ReadonlyArray<{ created_at: string }>, dia: string): number {
  return citas.filter((c) => diaMadrid(c.created_at) === dia).length
}

/* ------------------------------------------------------------------ */
/* Cómo se leen las duraciones                                         */
/* ------------------------------------------------------------------ */

/** La duración de una llamada: «0:36», «2:22» */
export function duracionCorta(segundos: number): string {
  const s = Math.max(0, Math.round(segundos))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Lo hablado en total: «24 min», «1 h 05 min», «45 s», «0 min» */
export function tiempoHablado(segundos: number): string {
  const s = Math.max(0, Math.round(segundos))
  if (s < 60) return s === 0 ? '0 min' : `${s} s`
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}
