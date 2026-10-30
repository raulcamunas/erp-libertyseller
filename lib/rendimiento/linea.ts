import { ETIQUETA_DE_CANAL, canalDe, type CitaDeActividad, type NotaDeActividad } from './actividad'
import { etiquetaDeDia, diaMadrid, horaMadrid } from './dia'
import { SEGUNDOS_DE_CONVERSACION, clienteDeLaLlamada, duracionCorta, esContestador, estaContestada, type CuentaDeLlamadas } from './metricas'
import { telefonoLegible } from './telefonos'

/**
 * LA LÍNEA DEL DÍA: QUÉ HIZO UNA PERSONA Y A QUÉ HORA.
 * ====================================================
 * PURO. Se comprueba con linea.prueba.ts. Lo usan el navegador y las pruebas.
 *
 * Pone en un solo eje de horas todo lo que dejó rastro: las llamadas de Rinkel, los WhatsApp y los correos que
 * apuntó en Cold Calling, las respuestas de los clientes y las citas que agendó. De ahí se ve cuándo empezó,
 * cuándo acabó, qué hizo en cada tramo y dónde hubo un hueco largo sin ninguna actividad.
 *
 * Cada cosa va en su CARRIL (una fila del dibujo). Una nota marcada como respuesta del cliente va al carril de
 * respuestas, no al de su canal: es lo que el cliente hizo, no lo que hizo el comercial.
 *
 * Todas las horas son las de Madrid y se miden en MINUTOS desde las 00:00, que es lo que necesita el dibujo.
 */

export type Carril = 'llamadas' | 'whatsapp' | 'correos' | 'respuestas' | 'citas' | 'otras'

export const CARRILES: ReadonlyArray<{ id: Carril; etiqueta: string }> = [
  { id: 'llamadas', etiqueta: 'Llamadas' },
  { id: 'whatsapp', etiqueta: 'WhatsApp' },
  { id: 'correos', etiqueta: 'Correos' },
  { id: 'respuestas', etiqueta: 'Respuestas' },
  { id: 'citas', etiqueta: 'Citas' },
  { id: 'otras', etiqueta: 'Otras notas' },
]

const ORDEN_DE_CARRIL = new Map(CARRILES.map((c, i) => [c.id, i]))

/** Cómo se pinta: las llamadas por lo que pasó en ellas, el resto de una sola manera */
export type Estilo = 'conversacion' | 'contestada' | 'contestador' | 'sinContestar' | 'recibida' | 'perdida' | 'normal'

export interface EventoDeLinea {
  id: string
  carril: Carril
  /** Minutos desde las 00:00 de Madrid */
  minuto: number
  /** «12:14» */
  hora: string
  titulo: string
  detalle: string
  estilo: Estilo
  /**
   * SOLO EN LAS LLAMADAS. Quién es el cliente, con LA MISMA CLAVE que usa la tabla de arriba (`clienteDeLaLlamada`: el lead, si no el número, si no la propia
   * llamada, con el día delante). Es lo que permite decir «30 intentos a 25 clientes» en la línea sin que se contradiga con la cifra de «Llamadas» de la tabla.
   */
  cliente?: string
  /**
   * SOLO EN LAS LLAMADAS. Si salió (un intento), entró (una recibida) u otra cosa (ni una ni otra: se dibuja pero no se cuenta, como en las tarjetas). Un evento
   * sin esto cuenta como un intento a un cliente propio, como se contaba antes de agrupar
   */
  sentido?: 'salida' | 'entrada' | 'otra'
}

export interface LlamadaParaLinea {
  id: string
  fecha: string
  direccion: string
  estado: string
  duracion_s: number
  lead_id: string | null
  numero: string | null
}

export const minutoDeLaHora = (hora: string): number => {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

export const horaDeMinuto = (minuto: number): string => `${String(Math.floor(minuto / 60)).padStart(2, '0')}:${String(minuto % 60).padStart(2, '0')}`

/** «47 min», «1 h 05 min» */
export function textoDeMinutos(minutos: number): string {
  const m = Math.max(0, Math.round(minutos))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

const recortar = (texto: string, max: number) => (texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto)

function eventoDeLlamada(l: LlamadaParaLinea, cliente: (leadId: string) => string | null): EventoDeLinea {
  const salida = l.direccion !== 'inbound'
  const quien = (l.lead_id ? cliente(l.lead_id) : null) ?? (l.numero ? telefonoLegible(l.numero) : 'número oculto')
  const duracion = duracionCorta(l.duracion_s)
  let estilo: Estilo
  let titulo: string
  if (estaContestada(l)) {
    if (l.duracion_s >= SEGUNDOS_DE_CONVERSACION) {
      estilo = 'conversacion'
      titulo = `${salida ? 'Conversación' : 'Conversación recibida'} (${duracion})`
    } else if (salida) {
      estilo = 'contestada'
      titulo = `Contestada (${duracion})`
    } else {
      estilo = 'recibida'
      titulo = `Recibida (${duracion})`
    }
  } else if (esContestador(l)) {
    estilo = salida ? 'contestador' : 'perdida'
    titulo = salida ? `Contestador (${duracion})` : 'Perdida'
  } else {
    estilo = salida ? 'sinContestar' : 'perdida'
    titulo = salida ? 'Sin contestar' : 'Perdida'
  }
  const hora = horaMadrid(l.fecha)
  // Salió / entró con la misma definición que las cifras (resumenDeLlamadas): cualquier otra dirección no se cuenta ni como intento ni como recibida
  const sentido = l.direccion === 'outbound' ? 'salida' : l.direccion === 'inbound' ? 'entrada' : 'otra'
  return { id: `llamada-${l.id}`, carril: 'llamadas', minuto: minutoDeLaHora(hora), hora, titulo, detalle: quien, estilo, cliente: clienteDeLaLlamada(l, 0), sentido }
}

function eventoDeNota(n: NotaDeActividad, cliente: (leadId: string) => string | null): EventoDeLinea {
  const canal = canalDe(n.kind)
  const quien = cliente(n.lead_id) ?? 'un cliente'
  const respuesta = n.es_respuesta === true
  const carril: Carril = respuesta ? 'respuestas' : canal === 'whatsapp' ? 'whatsapp' : canal === 'correo' ? 'correos' : 'otras'
  const hora = horaMadrid(n.occurred_at)
  return {
    id: `nota-${n.id}`,
    carril,
    minuto: minutoDeLaHora(hora),
    hora,
    titulo: respuesta ? `Respuesta de ${quien} (${ETIQUETA_DE_CANAL[canal]})` : `${ETIQUETA_DE_CANAL[canal]} · ${quien}`,
    detalle: recortar((n.body ?? '').trim(), 160),
    estilo: 'normal',
  }
}

function eventoDeCita(c: CitaDeActividad): EventoDeLinea {
  const hora = horaMadrid(c.created_at)
  return {
    id: `cita-${c.id}`,
    carril: 'citas',
    minuto: minutoDeLaHora(hora),
    hora,
    titulo: `Cita agendada: ${c.lead_name}${c.lead_company ? ` (${c.lead_company})` : ''}`,
    detalle: `Es para el ${etiquetaDeDia(diaMadrid(c.start_time))} a las ${horaMadrid(c.start_time)}`,
    estilo: 'normal',
  }
}

/** Todo lo que hizo una persona en un día, en orden. Quien llama pasa solo lo de ese día */
export function eventosDeLinea(datos: {
  llamadas: readonly LlamadaParaLinea[]
  notas: readonly NotaDeActividad[]
  citas: readonly CitaDeActividad[]
  /** El nombre de un cliente, si se sabe */
  cliente: (leadId: string) => string | null
}): EventoDeLinea[] {
  const eventos = [
    ...datos.llamadas.map((l) => eventoDeLlamada(l, datos.cliente)),
    ...datos.notas.map((n) => eventoDeNota(n, datos.cliente)),
    ...datos.citas.map(eventoDeCita),
  ]
  return eventos.sort((a, b) => a.minuto - b.minuto || (ORDEN_DE_CARRIL.get(a.carril) ?? 0) - (ORDEN_DE_CARRIL.get(b.carril) ?? 0) || a.id.localeCompare(b.id))
}

/* ------------------------------------------------------------------ */
/* Los huecos                                                          */
/* ------------------------------------------------------------------ */

export interface Pausa {
  /** Minuto de la última actividad antes del hueco */
  desde: number
  /** Minuto de la siguiente actividad, o el de ahora si el hueco sigue abierto */
  hasta: number
  minutos: number
  /** El hueco no ha acabado: es lo que lleva sin actividad hasta ahora mismo */
  enCurso: boolean
}

/** Cuánto sin actividad se considera una pausa digna de señalar */
export const MINUTOS_DE_PAUSA = 30

/**
 * Los huecos de `minimo` minutos o más entre una actividad y la siguiente. Si es el día de hoy y se pasa `ahora`,
 * también el hueco que lleva abierto desde la última actividad hasta este momento.
 */
export function pausasDe(eventos: readonly EventoDeLinea[], opciones: { minimo?: number; ahora?: number | null } = {}): Pausa[] {
  const minimo = opciones.minimo ?? MINUTOS_DE_PAUSA
  const minutos = [...new Set(eventos.map((e) => e.minuto))].sort((a, b) => a - b)
  const pausas: Pausa[] = []
  for (let i = 0; i < minutos.length - 1; i += 1) {
    const hueco = minutos[i + 1] - minutos[i]
    if (hueco >= minimo) pausas.push({ desde: minutos[i], hasta: minutos[i + 1], minutos: hueco, enCurso: false })
  }
  const ahora = opciones.ahora
  if (ahora !== null && ahora !== undefined && minutos.length > 0) {
    const ultimo = minutos[minutos.length - 1]
    if (ahora - ultimo >= minimo) pausas.push({ desde: ultimo, hasta: ahora, minutos: ahora - ultimo, enCurso: true })
  }
  return pausas
}

/**
 * LAS LLAMADAS DE LA LÍNEA, CONTADAS COMO LA TABLA. La línea dibuja una raya por llamada (es una línea de tiempo: importa CUÁNDO se marcó), pero la cifra de
 * «llamadas» de todo el panel cuenta CLIENTES: a un cliente al que se llama tres veces en el día se le cuenta una. Las tres cosas, con la misma regla que
 * `resumenDeLlamadas` (metricas.ts), para poder decir «30 intentos a 25 clientes y 4 recibidas» y que cuadre con ella.
 */
export interface LlamadasDeLinea {
  /** A cuántos clientes distintos se llamó: ES la cifra de «Llamadas» de la tabla y de las tarjetas */
  clientes: number
  /** Las llamadas que salieron, sin agrupar: de ellas salen los `clientes` */
  intentos: number
  /** Las que entraron: no cuentan como llamadas hechas, pero también dejan una raya en la línea */
  recibidas: number
}

export interface ResumenDeLinea {
  primera: string | null
  ultima: string | null
  /** De la primera a la última actividad */
  tramoActivo: number
  pausaMasLarga: Pausa | null
  /** Suma de los huecos señalados que ya han acabado */
  minutosDePausa: number
  /** Eventos por carril: lo que se DIBUJA (una raya por llamada, un punto por apunte). Para las llamadas, la cifra que se enseña es `llamadas.clientes` */
  porCarril: Record<Carril, number>
  llamadas: LlamadasDeLinea
  total: number
}

/**
 * Las cinco cifras de las llamadas de una lista de eventos, con la misma regla que `cuentaDeLlamadas` (metricas.ts). La línea no ve las llamadas sueltas, solo
 * sus eventos: de cada uno sabe a qué cliente fue, si salió o entró y cómo acabó. Una salida contestada es la que se dibuja como conversación o como contestada
 * (`estaContestada`: Rinkel la dio por contestada y duró lo bastante para no ser un contestador).
 */
export function cuentaDeLaLinea(eventos: readonly EventoDeLinea[]): CuentaDeLlamadas {
  const clientes = new Set<string>()
  const contestados = new Set<string>()
  let intentos = 0
  let intentosContestados = 0
  let recibidas = 0
  for (const e of eventos) {
    if (e.carril !== 'llamadas') continue
    if (e.sentido === 'entrada') recibidas += 1
    // Sin sentido (un evento que no viene de una llamada de Rinkel): cuenta como un intento a un cliente propio, como se contaba antes de agrupar
    else if (e.sentido !== 'otra') {
      intentos += 1
      const cliente = e.cliente ?? e.id
      clientes.add(cliente)
      if (e.estilo === 'conversacion' || e.estilo === 'contestada') {
        intentosContestados += 1
        contestados.add(cliente)
      }
    }
  }
  return { intentos, clientes: clientes.size, intentosContestados, clientesContestados: contestados.size, recibidas }
}

/** Las llamadas de una lista de eventos, contadas como cuenta la tabla (ver LlamadasDeLinea) */
export function llamadasDeLaLinea(eventos: readonly EventoDeLinea[]): LlamadasDeLinea {
  const c = cuentaDeLaLinea(eventos)
  return { clientes: c.clientes, intentos: c.intentos, recibidas: c.recibidas }
}

/** Una equivalencia entre lo que enseña la lista (o las rayas) y lo que dicen las cifras */
export interface ParteDeTraduccion {
  /** Lo que se ve en la lista: «12 intentos» */
  de: string
  /** En qué se queda en las cifras: «10 llamadas hechas» */
  a: string
}

/**
 * Lo que hay que decir para que la lista y las rayas no parezcan contradecir a las cifras: «12 intentos → 10 llamadas hechas · 6 intentos contestados → 5
 * contestadas · 4 recibidas → no son llamadas hechas». Cada parte solo sale si hay algo que explicar, así que un día sin repetidas ni recibidas no lleva ninguna.
 *
 * Los nombres de la derecha son los de las tarjetas («Llamadas hechas», «contestadas») para que se reconozca la cifra. Los de la izquierda siempre van en plural: si
 * un intento y un cliente difieren hay al menos dos intentos.
 */
export function traduccionDeLlamadas(c: CuentaDeLlamadas): ParteDeTraduccion[] {
  const partes: ParteDeTraduccion[] = []
  if (c.intentos !== c.clientes) partes.push({ de: `${c.intentos} intentos`, a: `${c.clientes} ${c.clientes === 1 ? 'llamada hecha' : 'llamadas hechas'}` })
  if (c.intentosContestados !== c.clientesContestados) {
    partes.push({ de: `${c.intentosContestados} intentos contestados`, a: `${c.clientesContestados} ${c.clientesContestados === 1 ? 'contestada' : 'contestadas'}` })
  }
  if (c.recibidas > 0) partes.push({ de: `${c.recibidas} ${c.recibidas === 1 ? 'recibida' : 'recibidas'}`, a: c.recibidas === 1 ? 'no es una llamada hecha' : 'no son llamadas hechas' })
  return partes
}

/**
 * Lo que hay que decir para que las rayas de las llamadas y la cifra de «llamadas» no parezcan contradecirse: «30 intentos a 25 clientes · 4 recibidas».
 * Vacío si no hay nada que explicar (cada llamada fue a un cliente distinto y no hubo ninguna recibida). `corto` omite «a N clientes» (ya está en la cifra
 * de al lado) para las columnas estrechas: «30 intentos · 4 recibidas».
 */
export function desgloseDeLlamadas(l: LlamadasDeLinea, opciones: { corto?: boolean } = {}): string {
  const partes: string[] = []
  if (l.intentos !== l.clientes) {
    const intentos = `${l.intentos} ${l.intentos === 1 ? 'intento' : 'intentos'}`
    partes.push(opciones.corto ? intentos : `${intentos} a ${l.clientes} ${l.clientes === 1 ? 'cliente' : 'clientes'}`)
  }
  if (l.recibidas > 0) partes.push(`${l.recibidas} ${l.recibidas === 1 ? 'recibida' : 'recibidas'}`)
  return partes.join(' · ')
}

export function resumenDeLinea(eventos: readonly EventoDeLinea[], pausas: readonly Pausa[]): ResumenDeLinea {
  const porCarril: Record<Carril, number> = { llamadas: 0, whatsapp: 0, correos: 0, respuestas: 0, citas: 0, otras: 0 }
  for (const e of eventos) porCarril[e.carril] += 1
  const llamadas = llamadasDeLaLinea(eventos)
  if (eventos.length === 0) return { primera: null, ultima: null, tramoActivo: 0, pausaMasLarga: null, minutosDePausa: 0, porCarril, llamadas, total: 0 }
  const primera = eventos[0]
  const ultima = eventos[eventos.length - 1]
  const pausaMasLarga = pausas.reduce<Pausa | null>((m, p) => (m === null || p.minutos > m.minutos ? p : m), null)
  return {
    primera: primera.hora,
    ultima: ultima.hora,
    tramoActivo: ultima.minuto - primera.minuto,
    pausaMasLarga,
    minutosDePausa: pausas.filter((p) => !p.enCurso).reduce((s, p) => s + p.minutos, 0),
    porCarril,
    llamadas,
    total: eventos.length,
  }
}

/**
 * Las horas que abarca el dibujo: de 9:00 a 19:00 como mínimo, y más si hay actividad fuera de ese horario,
 * redondeado a horas enteras para que las marcas del eje caigan en las horas en punto.
 */
export function ventanaDeHoras(eventos: readonly EventoDeLinea[], opciones: { desde?: number; hasta?: number } = {}): { desde: number; hasta: number } {
  const base = { desde: opciones.desde ?? 9 * 60, hasta: opciones.hasta ?? 19 * 60 }
  const minutos = eventos.map((e) => e.minuto)
  const desde = Math.min(base.desde, ...minutos)
  const hasta = Math.max(base.hasta, ...minutos.map((m) => m + 1))
  return { desde: Math.floor(desde / 60) * 60, hasta: Math.min(24 * 60, Math.ceil(hasta / 60) * 60) }
}
