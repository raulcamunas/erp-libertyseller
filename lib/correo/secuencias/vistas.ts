import type { DatosBasicosDeLead, EventoLeido, RespuestaLeida, ResumenDelFlujo } from './almacen'
import { CLASES_DE_RESPUESTA, ETIQUETA_DE_CLASE, TONO_DE_CLASE, type AccionConUnaRespuesta, type ClaseDeRespuesta, type Confianza } from './clases'
import type { SalientesPorHora } from './capacidad'
import { diaCorto, diaDeMadrid, diaRelativo, esDiaHabil, partesDeMadrid, siguienteDiaHabil } from './fechas'
import type { EstadoDeInscripcion, EstadoDePaso, InscripcionDelMotor, PasoDelMotor } from './tipos'

/**
 * LO QUE ENSEÑA LA PANTALLA DE SECUENCIAS — formas y constructores PUROS. Se comprueban con vistas.prueba.ts.
 * ==========================================================================================================
 * El servidor lee filas (almacen.ts) y aquí se convierten en lo que pinta la pantalla: el reparto del día por buzón, los próximos días, la cola de
 * leads con su línea de tiempo, el embudo. Los tipos de este fichero son el CONTRATO entre las rutas y los componentes; las fechas viajan siempre
 * como milisegundos y los días como «2026-10-28» en hora de Madrid, y el navegador las pinta con lib/correo/secuencias/fechas.ts.
 */

/** Qué grupo de la cola se pide (también lo usa el navegador, por eso vive aquí y no en servidor.ts) */
export type GrupoDeColaCliente = 'vivas' | 'terminadas' | 'todas'

/* ------------------------------------------------------------------ */
/* Etiquetas                                                           */
/* ------------------------------------------------------------------ */

export type TonoDeEstado = 'marcha' | 'espera' | 'bien' | 'mal' | 'neutro'

export const ETIQUETA_DE_ESTADO: Record<EstadoDeInscripcion, { texto: string; tono: TonoDeEstado }> = {
  activa: { texto: 'En marcha', tono: 'marcha' },
  pausada: { texto: 'En pausa', tono: 'espera' },
  respondida: { texto: 'Ha contestado', tono: 'bien' },
  parada: { texto: 'Parada', tono: 'mal' },
  completada: { texto: 'Completada', tono: 'neutro' },
  sin_respuesta: { texto: 'Sin respuesta', tono: 'neutro' },
  cancelada: { texto: 'Cancelada', tono: 'neutro' },
}

export const ETIQUETA_DE_PASO: Record<EstadoDePaso, string> = {
  pendiente: 'Programado',
  enviando: 'Enviando',
  enviado: 'Enviado',
  pausado: 'Detenido',
  saltado: 'Saltado',
  cancelado: 'Cancelado',
  fallido: 'Falló',
}

/** Por qué se cortó una secuencia, en una frase corta (los códigos los pone el motor) */
export const ETIQUETA_DE_CODIGO: Record<string, string> = {
  respuesta: 'El lead contestó',
  rebote: 'El correo rebotó',
  direccion_mala: 'Dirección que ya rebotó',
  lead_borrado: 'El lead ya no existe',
  lead_reasignado: 'El lead pasó a otro comercial',
  lead_no_interesa: 'El lead pasó a «No interesa»',
  lead_cita: 'El lead tiene una cita',
  lead_en_seguimiento: 'El lead está en seguimiento',
  conversacion_por_telefono: 'Se habló con él por teléfono',
  correo_manual: 'El comercial le escribió a mano',
  completada: 'Salieron todos los correos',
  sin_respuesta: 'Nadie contestó',
  cancelada_por_persona: 'Cancelada a mano',
  sustituida: 'Sustituida por una nueva',
  pausada_por_persona: 'Pausada a mano',
  pausada_por_revision: 'La IA la pausó al leer la ficha',
  revision_sin_ia: 'La IA no pudo leer la ficha',
  envio_fallido: 'El envío falló',
  envio_dudoso: 'Un envío se cortó a medias',
}

/* ------------------------------------------------------------------ */
/* Hoy: un carril por buzón                                            */
/* ------------------------------------------------------------------ */

export type EstadoDeSalida = 'enviado' | 'enviando' | 'programado' | 'aplazado' | 'ensayo' | 'pausado' | 'fallido'

export interface PuntoDeHoy {
  pasoId: string
  inscripcionId: string
  orden: number
  /** Cuántos seguimientos tiene la secuencia (para pintar «1 de 2») */
  de: number
  estado: EstadoDeSalida
  /** El instante: cuándo salió, o cuándo está programado */
  en: number
  lead: string
  destinatario: string
}

export interface BuzonParaVista {
  id: string
  direccion: string
  nombre: string | null
  propietario: { id: string; nombre: string }
  esMio: boolean
}

export interface CarrilDeHoy {
  buzonId: string
  direccion: string
  propietario: string
  esMio: boolean
  /** Correos que la persona ha mandado a mano, por hora de Madrid (0 a 23) */
  manual: number[]
  puntos: PuntoDeHoy[]
  enviadosHoy: number
  programadosHoy: number
  manualHoy: number
  topeHoy: number
}

export interface TableroDeHoy {
  dia: string
  desdeMin: number
  hastaMin: number
  carriles: CarrilDeHoy[]
}

/** El estado con que se enseña un correo en el reparto del día */
export function estadoDeSalida(p: Pick<PasoDelMotor, 'estado' | 'decision'>): EstadoDeSalida | null {
  switch (p.estado) {
    case 'enviado':
      return 'enviado'
    case 'enviando':
      return 'enviando'
    case 'pausado':
      return 'pausado'
    case 'fallido':
      return 'fallido'
    case 'pendiente':
      return p.decision?.accion === 'ensayo' ? 'ensayo' : p.decision?.accion === 'aplazar' ? 'aplazado' : 'programado'
    default:
      return null
  }
}

export function armarHoy(e: {
  dia: string
  ventana: { desdeMin: number; hastaMin: number }
  buzones: readonly BuzonParaVista[]
  pasos: readonly PasoDelMotor[]
  inscripciones: ReadonlyMap<string, InscripcionDelMotor>
  totalDeSeguimientos: ReadonlyMap<string, number>
  leads: ReadonlyMap<string, DatosBasicosDeLead>
  salientes: readonly SalientesPorHora[]
  topes: ReadonlyMap<string, number>
}): TableroDeHoy {
  const carriles = e.buzones.map((b): CarrilDeHoy => {
    const manual = Array<number>(24).fill(0)
    let manualHoy = 0
    for (const s of e.salientes) {
      if (s.buzonId !== b.id || s.dia !== e.dia) continue
      const a_mano = Math.max(0, s.total - s.automaticos)
      manual[Math.min(23, Math.max(0, s.hora))] += a_mano
      manualHoy += a_mano
    }
    const puntos: PuntoDeHoy[] = []
    for (const p of e.pasos) {
      if (p.buzonId !== b.id) continue
      const estado = estadoDeSalida(p)
      const en = p.estado === 'enviado' ? (p.enviadoAt ?? p.programadoAt) : p.programadoAt
      if (!estado || en === null || diaDeMadrid(en) !== e.dia) continue
      const ins = e.inscripciones.get(p.inscripcionId)
      puntos.push({
        pasoId: p.id,
        inscripcionId: p.inscripcionId,
        orden: p.orden,
        de: e.totalDeSeguimientos.get(p.inscripcionId) ?? 1,
        estado,
        en,
        lead: ins ? (e.leads.get(ins.leadId)?.nombre ?? 'Lead') : 'Lead',
        destinatario: ins?.destinatario ?? '',
      })
    }
    puntos.sort((a, c) => a.en - c.en)
    return {
      buzonId: b.id,
      direccion: b.direccion,
      propietario: b.propietario.nombre,
      esMio: b.esMio,
      manual,
      puntos,
      enviadosHoy: puntos.filter((x) => x.estado === 'enviado').length,
      programadosHoy: puntos.filter((x) => x.estado !== 'enviado').length,
      manualHoy,
      topeHoy: e.topes.get(b.id) ?? 0,
    }
  })
  return { dia: e.dia, desdeMin: e.ventana.desdeMin, hastaMin: e.ventana.hastaMin, carriles }
}

/* ------------------------------------------------------------------ */
/* Los próximos días                                                   */
/* ------------------------------------------------------------------ */

export interface DiaProximo {
  dia: string
  etiqueta: string
  esHoy: boolean
  porBuzon: Array<{ buzonId: string; n: number; tope: number; libre: number }>
  total: number
}

/** Los próximos `dias` días hábiles (hoy incluido si lo es) con cuántos correos hay programados por buzón, y cuánto cabe todavía */
export function armarProximos(e: {
  ahora: number
  dias: number
  festivos: readonly string[]
  buzonIds: readonly string[]
  pasos: readonly Pick<PasoDelMotor, 'buzonId' | 'programadoAt' | 'estado'>[]
  tope: (buzonId: string, dia: string) => number
  libre: (buzonId: string, dia: string) => number
}): DiaProximo[] {
  const hoy = diaDeMadrid(e.ahora)
  const festivos = new Set(e.festivos)
  let dia = esDiaHabil(hoy, festivos) ? hoy : siguienteDiaHabil(hoy, festivos)
  const salida: DiaProximo[] = []
  for (let i = 0; i < e.dias; i++, dia = siguienteDiaHabil(dia, festivos)) {
    const porBuzon = e.buzonIds.map((buzonId) => {
      const n = e.pasos.filter((p) => p.buzonId === buzonId && p.programadoAt !== null && ['pendiente', 'enviando', 'enviado', 'pausado'].includes(p.estado) && diaDeMadrid(p.programadoAt) === dia).length
      return { buzonId, n, tope: e.tope(buzonId, dia), libre: e.libre(buzonId, dia) }
    })
    const relativo = diaRelativo(dia, e.ahora)
    salida.push({ dia, etiqueta: relativo === diaCorto(dia) ? relativo : `${relativo} · ${diaCorto(dia)}`, esHoy: dia === hoy, porBuzon, total: porBuzon.reduce((s, b) => s + b.n, 0) })
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* La cola                                                             */
/* ------------------------------------------------------------------ */

export interface PasoDeCola {
  id: string
  orden: number
  estado: EstadoDePaso
  etiqueta: string
  diasHabiles: number
  programadoAt: number | null
  enviadoAt: number | null
  asunto: string
  motivo: string | null
  adaptado: boolean
  ensayo: boolean
  /** Por qué espera, si el motor lo ha aplazado */
  esperando: string | null
}

export interface ItemDeCola {
  id: string
  leadId: string
  lead: { nombre: string; empresa: string | null; status: string | null }
  destinatario: string
  buzonId: string
  propietario: string
  propio: boolean
  estado: EstadoDeInscripcion
  etiquetaDeEstado: string
  tono: TonoDeEstado
  motivo: string | null
  codigo: string | null
  creadaAt: number
  primerEnvioAt: number
  paradaAt: number | null
  pasos: PasoDeCola[]
  /** El próximo correo que saldrá */
  siguiente: { orden: number; en: number | null } | null
  /** Cuándo, si nadie contesta, el lead pasa a «No contesta» */
  cierre: number | null
  /** De 0 a 1: cuántos de los correos de la secuencia han salido */
  progreso: number
}

export function pasoDeCola(p: PasoDelMotor): PasoDeCola {
  const d = p.decision
  return {
    id: p.id,
    orden: p.orden,
    estado: p.estado,
    etiqueta: d?.accion === 'ensayo' && p.estado === 'pendiente' ? 'Ensayo' : ETIQUETA_DE_PASO[p.estado],
    diasHabiles: p.diasHabiles,
    programadoAt: p.programadoAt,
    enviadoAt: p.enviadoAt,
    asunto: p.asunto,
    motivo: p.motivo,
    adaptado: p.textoEnviado !== null && p.estado === 'enviado',
    ensayo: d?.accion === 'ensayo' && p.estado === 'pendiente',
    esperando: p.estado === 'pendiente' && d?.accion === 'aplazar' ? (d.motivo ?? null) : null,
  }
}

export function armarItemDeCola(e: {
  ins: InscripcionDelMotor
  pasos: readonly PasoDelMotor[]
  lead: DatosBasicosDeLead | undefined
  propietario: string
  propio: boolean
}): ItemDeCola {
  const pasos = [...e.pasos].sort((a, b) => a.orden - b.orden).map(pasoDeCola)
  const etiqueta = ETIQUETA_DE_ESTADO[e.ins.estado]
  const salieron = pasos.filter((p) => p.estado === 'enviado').length
  const abiertos = pasos.filter((p) => ['pendiente', 'enviando', 'pausado'].includes(p.estado))
  const vivo = e.ins.estado === 'activa' || e.ins.estado === 'pausada'
  const siguiente = vivo && abiertos.length > 0 ? abiertos.reduce((a, b) => (a.orden <= b.orden ? a : b)) : null
  return {
    id: e.ins.id,
    leadId: e.ins.leadId,
    lead: { nombre: e.lead?.nombre ?? 'Lead', empresa: e.lead?.empresa ?? null, status: e.lead?.status ?? null },
    destinatario: e.ins.destinatario,
    buzonId: e.ins.buzonId,
    propietario: e.propietario,
    propio: e.propio,
    estado: e.ins.estado,
    etiquetaDeEstado: etiqueta.texto,
    tono: etiqueta.tono,
    motivo: e.ins.motivo,
    codigo: e.ins.codigo,
    creadaAt: e.ins.creadaAt,
    primerEnvioAt: e.ins.primerEnvioAt,
    paradaAt: e.ins.paradaAt,
    pasos,
    siguiente: siguiente ? { orden: siguiente.orden, en: siguiente.programadoAt } : null,
    cierre: e.ins.estado === 'completada' ? e.ins.noInteresaEn : null,
    progreso: pasos.length === 0 ? 0 : salieron / pasos.length,
  }
}

/* ------------------------------------------------------------------ */
/* El detalle de una secuencia                                         */
/* ------------------------------------------------------------------ */

export interface PasoDeDetalle extends PasoDeCola {
  texto: string
  textoEnviado: string | null
  messageId: string | null
  intentos: number
  /** Lo que dijo la IA al leer la ficha antes de enviar o, si `escrito`, al escribir el seguimiento con todo el historial del lead */
  revision: { decision: string; motivo: string; escrito?: boolean } | null
  /** En ensayo: el texto que habría enviado la IA al escribir el seguimiento con el historial (el borrador no se toca) */
  textoDeEnsayo: string | null
}

export interface EventoDeDetalle {
  id: number
  tipo: string
  detalle: string | null
  en: number
  pasoId: string | null
}

export interface DetalleDeSecuencia {
  secuencia: ItemDeCola
  pasos: PasoDeDetalle[]
  eventos: EventoDeDetalle[]
  permisos: { puedeAdministrar: boolean; puedeEditar: boolean }
  /** Lo que la IA entendió de la respuesta del lead, si ha contestado y se ha leído */
  respuesta: RespuestaParaLaPantalla | null
}

export function armarDetalle(e: { item: ItemDeCola; pasos: readonly PasoDelMotor[]; eventos: readonly EventoLeido[]; permisos: DetalleDeSecuencia['permisos']; respuesta?: RespuestaParaLaPantalla | null }): DetalleDeSecuencia {
  const porId = new Map(e.pasos.map((p) => [p.id, p]))
  return {
    secuencia: e.item,
    pasos: e.item.pasos.map((p) => {
      const fuente = porId.get(p.id)
      return { ...p, texto: fuente?.texto ?? '', textoEnviado: fuente?.textoEnviado ?? null, messageId: fuente?.messageId ?? null, intentos: fuente?.intentos ?? 0, revision: fuente?.decision?.revision ?? null, textoDeEnsayo: fuente?.decision?.ensayo?.texto ?? null }
    }),
    eventos: e.eventos.map((x) => ({ id: x.id, tipo: x.tipo, detalle: x.detalle, en: x.en, pasoId: x.pasoId })),
    permisos: e.permisos,
    respuesta: e.respuesta ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Las respuestas de los leads leídas por la IA                        */
/* ------------------------------------------------------------------ */

export interface RespuestaParaLaPantalla {
  mensajeId: string
  leadId: string
  lead: string
  buzonId: string
  propietario: string
  inscripcionId: string | null
  clase: ClaseDeRespuesta
  etiqueta: string
  tono: 'bien' | 'mal' | 'espera' | 'neutro'
  confianza: Confianza
  resumen: string
  evidencia: string
  /** El día de la rellamada que pidió («más adelante») */
  fechaPedida: string | null
  accion: AccionConUnaRespuesta
  /** Se ha hecho de verdad (envío real); false = es lo que se habría hecho (ensayo) o no se atrevió */
  aplicada: boolean
  modo: 'ensayo' | 'real'
  nota: string | null
  /** Cuándo entró la respuesta */
  en: number
}

export interface ResumenDeRespuestas {
  /** Cuántos días hacia atrás se cuenta */
  dias: number
  /** Las leídas en ese tiempo */
  total: number
  /** Cuántas de cada clase, de más a menos */
  porClase: Array<{ clase: ClaseDeRespuesta; etiqueta: string; tono: RespuestaParaLaPantalla['tono']; n: number }>
  /** Esperando su turno (o el siguiente intento) y las que la IA no pudo leer tras varios intentos */
  pendientes: number
  fallidas: number
  /** Las últimas, de la más reciente a la más antigua */
  recientes: RespuestaParaLaPantalla[]
}

export function respuestaParaLaPantalla(r: RespuestaLeida, leads: ReadonlyMap<string, DatosBasicosDeLead>, propietarios: ReadonlyMap<string, string>): RespuestaParaLaPantalla {
  return {
    mensajeId: r.mensajeId,
    leadId: r.leadId,
    lead: leads.get(r.leadId)?.nombre ?? 'Un lead',
    buzonId: r.buzonId,
    propietario: propietarios.get(r.buzonId) ?? '',
    inscripcionId: r.inscripcionId,
    clase: r.clase,
    etiqueta: ETIQUETA_DE_CLASE[r.clase],
    tono: TONO_DE_CLASE[r.clase],
    confianza: r.confianza,
    resumen: r.resumen,
    evidencia: r.evidencia,
    fechaPedida: r.fechaPedida,
    accion: r.accion,
    aplicada: r.aplicada,
    modo: r.modo,
    nota: r.nota,
    en: r.recibidaAt,
  }
}

export function armarRespuestas(e: {
  dias: number
  recientes: readonly RespuestaLeida[]
  conteo: { porClase: Record<string, number>; pendientes: number; fallidas: number }
  leads: ReadonlyMap<string, DatosBasicosDeLead>
  propietarios: ReadonlyMap<string, string>
}): ResumenDeRespuestas {
  const porClase = CLASES_DE_RESPUESTA.map((clase) => ({ clase, etiqueta: ETIQUETA_DE_CLASE[clase], tono: TONO_DE_CLASE[clase], n: e.conteo.porClase[clase] ?? 0 }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n)
  return {
    dias: e.dias,
    total: porClase.reduce((suma, c) => suma + c.n, 0),
    porClase,
    pendientes: e.conteo.pendientes,
    fallidas: e.conteo.fallidas,
    recientes: e.recientes.map((r) => respuestaParaLaPantalla(r, e.leads, e.propietarios)),
  }
}

/** «lun 11 ene» y, si no es del año en que entró la respuesta, «lun 11 ene 2027» */
function diaDeRellamada(dia: string, entro: number): string {
  return dia.slice(0, 4) === diaDeMadrid(entro).slice(0, 4) ? diaCorto(dia) : `${diaCorto(dia)} ${dia.slice(0, 4)}`
}

/** La frase con la que la pantalla cuenta qué se ha hecho (o se habría hecho) con una respuesta */
export function queSeHizo(r: Pick<RespuestaParaLaPantalla, 'accion' | 'aplicada' | 'modo' | 'fechaPedida' | 'nota' | 'en'>): string {
  const ensayo = r.modo === 'ensayo'
  const hecho = !ensayo && r.aplicada
  switch (r.accion) {
    case 'cerrar':
      return hecho ? 'Pasado a «No le interesa»' : ensayo ? 'Lo pasaría a «No le interesa»' : 'No se ha podido pasar a «No le interesa»'
    case 'rellamar': {
      const para = r.fechaPedida ? ` para el ${diaDeRellamada(r.fechaPedida, r.en)}` : ''
      return hecho ? `Rellamada puesta${para}` : ensayo ? `Pondría la rellamada${para}` : 'No se ha podido poner la rellamada'
    }
    case 'revisar':
      return ensayo ? 'Dejaría una nota para que lo mire una persona' : 'Nota en el lead para que lo mire una persona'
    case 'ninguna':
      return r.nota ? (ensayo ? 'Lo anotaría en el lead' : 'Anotado en el lead') : 'No hace falta hacer nada'
  }
}

/* ------------------------------------------------------------------ */
/* El embudo                                                           */
/* ------------------------------------------------------------------ */

export interface EscalonDelEmbudo {
  /** 0 = el primer correo, 1 y 2 = los seguimientos */
  paso: number
  etiqueta: string
  enviados: number
  respuestas: number
}

export interface Flujo {
  /** Cuántos días hacia atrás se cuenta */
  dias: number
  total: number
  vivas: number
  respondidas: number
  /** De las que ya han terminado, qué parte contestó (null si aún no ha terminado ninguna) */
  tasaDeRespuesta: number | null
  porEstado: Record<string, number>
  motivosDeCorte: Array<{ codigo: string; etiqueta: string; n: number }>
  embudo: EscalonDelEmbudo[]
}

export function armarFlujo(r: ResumenDelFlujo, dias: number): Flujo {
  const n = (v: number | undefined) => v ?? 0
  const vivas = n(r.porEstado.activa) + n(r.porEstado.pausada)
  const terminadas = r.total - vivas
  const respondidas = n(r.porEstado.respondida)
  const ordenes = [...new Set([...Object.keys(r.enviados), ...Object.keys(r.respuestas), '0'])].map(Number).sort((a, b) => a - b)
  return {
    dias,
    total: r.total,
    vivas,
    respondidas,
    tasaDeRespuesta: terminadas > 0 ? respondidas / terminadas : null,
    porEstado: r.porEstado,
    motivosDeCorte: Object.entries(r.porCodigo)
      .filter(([codigo]) => codigo !== 'completada' && codigo !== 'sin_respuesta')
      .map(([codigo, cuantos]) => ({ codigo, etiqueta: ETIQUETA_DE_CODIGO[codigo] ?? codigo, n: cuantos }))
      .sort((a, b) => b.n - a.n),
    embudo: ordenes.map((paso) => ({ paso, etiqueta: paso === 0 ? 'Primer correo' : `Seguimiento ${paso}`, enviados: n(r.enviados[String(paso)]), respuestas: n(r.respuestas[String(paso)]) })),
  }
}

/** El mínimo de leads terminados para fiarse de una tasa (con menos es solo ruido) */
export const MINIMO_PARA_UNA_TASA = 20

/* ------------------------------------------------------------------ */
/* La actividad                                                        */
/* ------------------------------------------------------------------ */

export interface ActividadReciente {
  id: number
  tipo: string
  detalle: string | null
  en: number
  buzonId: string | null
  inscripcionId: string | null
  lead: string | null
}

export function armarActividad(eventos: readonly EventoLeido[], inscripciones: ReadonlyMap<string, InscripcionDelMotor>, leads: ReadonlyMap<string, DatosBasicosDeLead>): ActividadReciente[] {
  return eventos.map((x) => {
    const ins = x.inscripcionId ? inscripciones.get(x.inscripcionId) : undefined
    return { id: x.id, tipo: x.tipo, detalle: x.detalle, en: x.en, buzonId: x.buzonId, inscripcionId: x.inscripcionId, lead: ins ? (leads.get(ins.leadId)?.nombre ?? null) : null }
  })
}

/** «hace 5 min», «hace 2 h», «ayer 10:42»: para el rastro y los puntos de la línea de tiempo. `ahora` y el instante van en ms */
export function hace(ahora: number, en: number): string {
  const s = Math.max(0, Math.round((ahora - en) / 1000))
  if (s < 45) return 'ahora mismo'
  if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`
  if (s < 86_400 && diaDeMadrid(ahora) === diaDeMadrid(en)) return `hace ${Math.round(s / 3600)} h`
  const p = partesDeMadrid(en)
  return `${diaRelativo(p.dia, ahora)} ${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`
}
