import { esDiaHabil, partesDeMadrid } from './fechas'
import { motivoDeRebote } from '../verificacion/rebotes'
import { lecturaDelBuzon, type EntranteParaControl } from './respuestas'
import type { AjustesDelMotor } from './reglas'

/**
 * EL CONTROL DE SALIDA: ¿SALE ESTE SEGUIMIENTO AHORA, SE ESPERA O SE PARA TODO?
 * ===============================================================================
 * PURO: no toca la base ni la red. Se comprueba con control.prueba.ts.
 *
 * Es lo último que pasa antes de cada envío automático. Recibe los HECHOS (qué hay en el buzón, qué ha pasado con las llamadas y con el lead, qué se
 * ha escrito en la ficha, cuánto se ha enviado hoy) y devuelve UNA decisión. El motor (motor.ts) no decide nada por su cuenta: aplica esta.
 *
 * El orden importa y es el de «lo más grave primero»:
 *
 *   1. PARAR. Cosas que hacen que enviar sea un error, y que se saben aunque el buzón no se haya leído hace un rato: el lead ha contestado o su
 *      dirección rebota, ya no es de este comercial, ha pasado a «No interesa», «Cita» o «En seguimiento», o se habló con él por teléfono.
 *   2. APLAZAR. Cosas que no son un error pero ahora no toca: el buzón está en pausa o sin leer hace rato, es de noche o fin de semana, se ha llegado
 *      al tope de hoy o de esta hora, el buzón o el sistema han enviado algo hace nada, se acaba de llamar al lead, o su empresa está fuera de oficina.
 *   3. LO ESCRITO. Si desde el último correo alguien ha escrito algo en la ficha del lead, no se envía a ciegas: la IA lo lee y decide enviar, pausar o
 *      adaptar (ia.ts). Sin nada nuevo escrito, el seguimiento sale tal cual.
 *
 * Ante la duda, no se envía: un seguimiento que no sale cuesta poco; uno equivocado, la confianza de un cliente.
 */

export interface LlamadaParaControl {
  fecha: number
  duracionS: number
  /** ANSWERED, NOANSWER… tal como lo guarda rinkel_llamadas */
  estado: string
  /** Lo que la transcripción entendió de ella (conversacion, buzon_de_voz, sin_contenido) o null si aún no hay transcripción */
  tipoDeConversacion: string | null
}

export interface NotaParaControl {
  fecha: number
  /** llamada, email, whatsapp, linkedin, nota */
  tipo: string
  /** Lo que escribió el cliente, no lo que mandamos */
  esRespuesta: boolean
  cuerpo: string
}

/** Lo que hace falta saber para decidir si una secuencia hay que cortarla (aunque no toque enviar nada ahora) */
export interface HechosDeParada {
  inscripcion: {
    destinatario: string
    hiloId: string | null
    primerEnvioAt: number
    /** Cuándo salió el último correo de esta secuencia (el primero, o el seguimiento anterior) */
    ultimoEnvioAt: number
    userId: string
  }
  lead: { status: string; asignadoA: string | null } | null
  entrantes: readonly EntranteParaControl[]
  /**
   * Los mensajes entrantes que ya hicieron aplazar a ESTA secuencia una vez. Un «fuera de oficina» o un fallo pasajero atrasan el envío una sola
   * vez: el aviso sigue en el buzón para siempre y, sin esto, el seguimiento se atrasaría cada vez que le tocara salir.
   */
  entrantesIgnorados?: ReadonlySet<string>
  /** Cuándo ha escrito el comercial, por su cuenta y desde este buzón, a este destinatario (los correos de la propia secuencia no cuentan) */
  correosManuales?: readonly number[]
  llamadas: readonly LlamadaParaControl[]
  /** Esa dirección ya rebotó antes (la memoria de direcciones malas del ERP): no se le escribe más */
  direccionMala?: { motivo: string | null } | null
}

export interface HechosDeSalida extends HechosDeParada {
  ahora: number
  ajustes: Pick<AjustesDelMotor, 'ventanaDesdeMin' | 'ventanaHastaMin' | 'huecoGlobalS' | 'huecoBuzonS' | 'topeHora' | 'festivos'>
  buzon: {
    participa: boolean
    pausadoHasta: number | null
    conectado: boolean
    credencialesInvalidas: boolean
    ultimoSyncAt: number | null
  }
  carga: {
    enviadosHoy: number
    topeHoy: number
    enviadosUltimaHora: number
    ultimoEnvioDelBuzonAt: number | null
    ultimoEnvioDelSistemaAt: number | null
  }
  notas: readonly NotaParaControl[]
}

export type CodigoDeParada =
  | 'respuesta'
  | 'rebote'
  | 'lead_borrado'
  | 'lead_reasignado'
  | 'lead_no_interesa'
  | 'lead_cita'
  | 'lead_en_seguimiento'
  | 'conversacion_por_telefono'
  | 'correo_manual'
  | 'direccion_mala'

export type CodigoDeAplazo =
  | 'buzon_fuera_del_motor'
  | 'buzon_pausado'
  | 'buzon_sin_conexion'
  | 'sin_lectura_reciente'
  | 'fuera_de_ventana'
  | 'tope_del_dia'
  | 'tope_de_la_hora'
  | 'envio_reciente_del_buzon'
  | 'envio_reciente_del_sistema'
  | 'llamada_reciente'
  | 'fuera_de_oficina'
  | 'fallo_pasajero_del_destino'

export type CuandoAplazar = { tipo: 'en'; ms: number } | { tipo: 'replanificar'; dias: number }

export type Decision =
  | { accion: 'enviar'; revisarConIa: boolean; notasNuevas: NotaParaControl[]; motivo: string }
  | { accion: 'aplazar'; codigo: CodigoDeAplazo; cuando: CuandoAplazar; motivo: string; ignorar?: string[] }
  | { accion: 'parar'; estado: 'respondida' | 'parada'; codigo: CodigoDeParada; motivo: string; direccionMala?: boolean; mensajeId?: string; mensajeFecha?: number; motivoDelRebote?: 'inexistente' | 'rechazo_de_politica' | 'pasajero' | 'desconocido' }

/** Lo más viejo que puede ser la lectura del buzón para enviar sin riesgo de pisar una respuesta que acaba de llegar */
export const LECTURA_MAXIMA_MS = 5 * 60_000
/** Se espera esto si se acaba de llamar al lead (la llamada puede estar en curso o la nota por escribir) */
const ESPERA_TRAS_LLAMADA_MS = 60 * 60_000
const LLAMADA_RECIENTE_MS = 60 * 60_000
/** Una conversación por teléfono de menos de esto, sin transcripción, no se da por conversación */
const CONVERSACION_MINIMA_S = 60
const CONTESTADA_MINIMA_S = 20

/** Los estados del lead que cortan la secuencia, y por qué */
const ESTADOS_QUE_PARAN: ReadonlyMap<string, { codigo: CodigoDeParada; motivo: string }> = new Map([
  ['no_interesa', { codigo: 'lead_no_interesa', motivo: 'El lead está marcado «No interesa».' }],
  ['cita_cualificada', { codigo: 'lead_cita', motivo: 'El lead ya tiene una cita cualificada.' }],
  ['seguimiento', { codigo: 'lead_en_seguimiento', motivo: 'El lead está «En seguimiento»: lo lleva una persona.' }],
] as Array<[string, { codigo: CodigoDeParada; motivo: string }]>)

/** ¿Es una nota escrita por una persona sobre el lead? Los correos que salieron (apuntes de «email» que no son respuesta) no cuentan: son el registro de lo enviado */
export function esNotaEscrita(n: NotaParaControl): boolean {
  if (n.tipo === 'email' && !n.esRespuesta) return false
  return n.cuerpo.trim() !== ''
}

/** El resultado de mirar solo si hay que cortar la secuencia: la decisión de parar y lo que se leyó del buzón (para decidir después si hay que aplazar) */
export interface LecturaParaParar {
  parada: Extract<Decision, { accion: 'parar' }> | null
  lectura: ReturnType<typeof lecturaDelBuzon>
}

/** PARAR: las cosas que hacen que enviar sea un error. Se saben aunque el buzón no se haya leído hace un rato */
export function evaluarParada(h: HechosDeParada): LecturaParaParar {
  const parar = (d: Omit<Extract<Decision, { accion: 'parar' }>, 'accion'>): LecturaParaParar => ({ parada: { accion: 'parar', ...d }, lectura })

  const secuencia = { destinatario: h.inscripcion.destinatario, hiloId: h.inscripcion.hiloId, primerEnvioAt: h.inscripcion.primerEnvioAt }
  const ignorados = h.entrantesIgnorados
  const lectura = lecturaDelBuzon(ignorados && ignorados.size > 0 ? h.entrantes.filter((m) => !ignorados.has(m.id)) : h.entrantes, secuencia)

  if (h.lead === null) return parar({ estado: 'parada', codigo: 'lead_borrado', motivo: 'El lead ya no existe.' })

  if (lectura?.clase === 'respuesta') return parar({ estado: 'respondida', codigo: 'respuesta', motivo: 'El lead ha contestado.', mensajeId: lectura.mensaje.id, mensajeFecha: lectura.mensaje.fecha })
  if (lectura?.clase === 'rebote_duro') {
    // No todo rebote duro es «esa dirección no existe»: un 5.7.x («rechazado como spam») es el servidor del lead rechazándonos a NOSOTROS, y la dirección puede estar bien
    const motivoDelRebote = motivoDeRebote(lectura.mensaje.texto)
    const inexistente = motivoDelRebote === 'inexistente' || motivoDelRebote === 'desconocido'
    return parar({
      estado: 'parada',
      codigo: 'rebote',
      motivo: inexistente ? 'El correo ha rebotado: esa dirección no existe o no admite correo.' : 'El servidor del lead ha rechazado el correo (spam o política), no por la dirección.',
      direccionMala: inexistente,
      mensajeId: lectura.mensaje.id,
      mensajeFecha: lectura.mensaje.fecha,
      motivoDelRebote,
    })
  }
  if (h.direccionMala) {
    return parar({ estado: 'parada', codigo: 'direccion_mala', motivo: `Esa dirección ya había rebotado antes${h.direccionMala.motivo ? ` (${h.direccionMala.motivo})` : ''}: no se le escribe más.` })
  }

  if (h.lead.asignadoA !== null && h.lead.asignadoA !== h.inscripcion.userId) {
    return parar({ estado: 'parada', codigo: 'lead_reasignado', motivo: 'El lead ha pasado a otro comercial.' })
  }
  const quePara = ESTADOS_QUE_PARAN.get(h.lead.status)
  if (quePara) return parar({ estado: 'parada', codigo: quePara.codigo, motivo: quePara.motivo })

  // Si el comercial ya le ha escrito por su cuenta, el seguimiento automático sobra (y le pisaría): la conversación la lleva él
  if ((h.correosManuales ?? []).some((f) => f > h.inscripcion.ultimoEnvioAt)) {
    return parar({ estado: 'parada', codigo: 'correo_manual', motivo: 'El comercial ha escrito al lead por su cuenta después del último correo de la secuencia.' })
  }

  const conversacion = h.llamadas.find((l) => {
    if (l.fecha < h.inscripcion.primerEnvioAt || l.estado !== 'ANSWERED' || l.duracionS < CONTESTADA_MINIMA_S) return false
    if (l.tipoDeConversacion === 'conversacion') return true
    // Sin transcripción todavía: solo se da por conversación si duró lo bastante para serlo (un contestador salta en segundos)
    return l.tipoDeConversacion === null && l.duracionS >= CONVERSACION_MINIMA_S
  })
  if (conversacion) return parar({ estado: 'parada', codigo: 'conversacion_por_telefono', motivo: 'Se ha hablado con el lead por teléfono.' })

  return { parada: null, lectura }
}

export function decidirSalida(h: HechosDeSalida): Decision {
  const { ahora } = h

  /* ---------- 1. PARAR ---------- */
  const { parada, lectura } = evaluarParada(h)
  if (parada) return parada

  /* ---------- 2. APLAZAR ---------- */
  if (!h.buzon.participa) return aplazar('buzon_fuera_del_motor', { tipo: 'en', ms: 6 * 3600_000 }, 'Este buzón no participa en las secuencias.')
  if (h.buzon.pausadoHasta !== null && h.buzon.pausadoHasta > ahora) {
    return aplazar('buzon_pausado', { tipo: 'en', ms: Math.max(60_000, h.buzon.pausadoHasta - ahora) }, 'El buzón está en pausa.')
  }
  if (!h.buzon.conectado || h.buzon.credencialesInvalidas) return aplazar('buzon_sin_conexion', { tipo: 'en', ms: 2 * 3600_000 }, 'El buzón está desconectado o tiene la contraseña mal.')

  const hoy = partesDeMadrid(ahora)
  const festivos = new Set(h.ajustes.festivos)
  if (!esDiaHabil(hoy.dia, festivos) || hoy.minutos < h.ajustes.ventanaDesdeMin || hoy.minutos >= h.ajustes.ventanaHastaMin) {
    return aplazar('fuera_de_ventana', { tipo: 'replanificar', dias: 0 }, 'Fuera del horario de envío.')
  }

  // No se envía sin haber leído el buzón hace poco: una respuesta que acaba de llegar no se vería
  if (h.buzon.ultimoSyncAt === null || ahora - h.buzon.ultimoSyncAt > LECTURA_MAXIMA_MS) {
    return aplazar('sin_lectura_reciente', { tipo: 'en', ms: 2 * 60_000 }, 'El buzón no se ha leído hace menos de 5 minutos.')
  }

  if (lectura?.clase === 'fuera_de_oficina') return aplazar('fuera_de_oficina', { tipo: 'replanificar', dias: 2 }, 'Su empresa ha contestado con un aviso de «fuera de oficina».', [lectura.mensaje.id])
  if (lectura?.clase === 'rebote_blando') return aplazar('fallo_pasajero_del_destino', { tipo: 'replanificar', dias: 1 }, 'El servidor del lead ha fallado un momento (buzón lleno o servidor caído).', [lectura.mensaje.id])

  if (h.carga.enviadosHoy >= h.carga.topeHoy) return aplazar('tope_del_dia', { tipo: 'replanificar', dias: 1 }, `El buzón ya ha enviado hoy ${h.carga.enviadosHoy} de ${h.carga.topeHoy}.`)
  if (h.carga.enviadosUltimaHora >= h.ajustes.topeHora) return aplazar('tope_de_la_hora', { tipo: 'en', ms: 20 * 60_000 }, 'Demasiados correos en la última hora.')

  const huecoBuzon = h.ajustes.huecoBuzonS * 1000
  if (h.carga.ultimoEnvioDelBuzonAt !== null && ahora - h.carga.ultimoEnvioDelBuzonAt < huecoBuzon) {
    return aplazar('envio_reciente_del_buzon', { tipo: 'en', ms: huecoBuzon - (ahora - h.carga.ultimoEnvioDelBuzonAt) + 5_000 }, 'El buzón acaba de enviar otro correo.')
  }
  const huecoGlobal = h.ajustes.huecoGlobalS * 1000
  if (h.carga.ultimoEnvioDelSistemaAt !== null && ahora - h.carga.ultimoEnvioDelSistemaAt < huecoGlobal) {
    return aplazar('envio_reciente_del_sistema', { tipo: 'en', ms: huecoGlobal - (ahora - h.carga.ultimoEnvioDelSistemaAt) + 5_000 }, 'Acaba de salir otro correo del sistema.')
  }

  if (h.llamadas.some((l) => ahora - l.fecha >= 0 && ahora - l.fecha < LLAMADA_RECIENTE_MS)) {
    return aplazar('llamada_reciente', { tipo: 'en', ms: ESPERA_TRAS_LLAMADA_MS }, 'Se acaba de llamar al lead: se espera a que el comercial lo apunte.')
  }

  /* ---------- 3. LO ESCRITO ---------- */
  const notasNuevas = h.notas.filter((n) => n.fecha > h.inscripcion.ultimoEnvioAt && esNotaEscrita(n))
  if (notasNuevas.length > 0) {
    return { accion: 'enviar', revisarConIa: true, notasNuevas, motivo: `Hay ${notasNuevas.length === 1 ? 'una nota nueva' : `${notasNuevas.length} notas nuevas`} en la ficha desde el último correo: la IA decide.` }
  }
  return { accion: 'enviar', revisarConIa: false, notasNuevas: [], motivo: 'Nada nuevo escrito ni en el buzón: sale como está.' }
}

function aplazar(codigo: CodigoDeAplazo, cuando: CuandoAplazar, motivo: string, ignorar?: string[]): Decision {
  return ignorar ? { accion: 'aplazar', codigo, cuando, motivo, ignorar } : { accion: 'aplazar', codigo, cuando, motivo }
}
