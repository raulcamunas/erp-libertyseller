import { randomUUID } from 'node:crypto'
import { contextoParaIa, hace, textoParaIa, type CorreoParaIa, type LlamadaParaIa, type NotaParaIa } from '../ia-contexto'
import { dominioDe } from '../direcciones'
import { extraerDireccionesFallidas, motivoDeRebote } from '../verificacion/rebotes'
import { textoSinFirma } from '../plantillas'
import {
  avisoDeEnvioFallido,
  avisoDeReboteDeSecuencia,
  avisoDeSeguimientoParado,
  avisoDeSeguimientoPausado,
  avisoDeSeguimientoRechazado,
  type AvisoParaLaCampana,
} from '../campana'
import type { AlmacenDeSecuencias, LeadDelMotor, NotaLeida, LlamadaLeida } from './almacen'
import { avisarAlDueno, nombreEnElAviso } from './avisar'
import { constructorDeCapacidad } from './capacidad'
import { decidirSalida, evaluarParada, type Decision, type HechosDeParada, type HechosDeSalida, type NotaParaControl } from './control'
import { diaCorto, diaDeMadrid, horaDeMadrid, instanteDeMadrid, siguienteDiaHabil, sumarDiasHabiles } from './fechas'
import type { ResultadoDeClasificacionConIa, ResultadoDeRedaccionConIa, ResultadoDeRevisionConIa } from './ia'
import { leerRespuestasDeLosLeads } from './leer-respuestas'
import { planificar, type Asignacion } from './planificador'
import { DOMINIOS_LIBRES, dominioDeDireccion, esDominioLibre, topeDelBuzonEnElDia, type AjustesDelMotor } from './reglas'
import { lecturaDelBuzon, type EntranteParaControl } from './respuestas'
import { construirEncargoDeRedaccion, construirEncargoDeRevision, type NotaParaRevisar } from './seguimientos'
import { ESTADOS_DE_PASO_ABIERTOS, type BuzonDelMotor, type DecisionGuardada, type InscripcionDelMotor, type PasoDelMotor, type TipoDeEvento } from './tipos'

/**
 * EL MOTOR DE SECUENCIAS: UNA PASADA CADA MINUTO.
 * ================================================
 * SOLO SERVIDOR. Lo que hace es poco y se repite: mirar si alguien ha contestado, ocuparse de lo que toca, y mandar lo que ya llega a su hora.
 * Se comprueba con motor.prueba.ts, con una base en memoria, una IA y un correo de mentira, y con un reloj inventado.
 *
 * Una pasada (`ejecutarPasada`) hace, en este orden, y cada fase por separado (si una falla, las demás siguen):
 *
 *   1. VIGILAR. Cruza lo que ha entrado en los buzones desde la última vez con las secuencias vivas: si el lead (o alguien de su empresa) ha
 *      contestado, o su dirección ha rebotado, la secuencia se corta en el acto. No espera a que le toque el siguiente envío.
 *      A continuación, LEER LAS RESPUESTAS (leer-respuestas.ts): la IA clasifica lo que han contestado los leads y se actúa en su ficha («No le
 *      interesa», la rellamada de un «llámame el jueves», una nota). Esto NO espera a que el motor esté encendido ni sale del ensayo: con el motor
 *      APAGADO la pasada hace solo esto (el ensayo y el interruptor son de los ENVÍOS, no de lo que ya ha contestado un cliente).
 *   2. MANTENER. Sella desde cuándo cuenta la rampa de cada buzón, aplica el freno si un buzón rebota demasiado, pasa a «No contesta» a quien no
 *      contestó a ninguno de los correos, devuelve a la cola lo que el ensayo había aparcado, reparte de nuevo lo que se pasó de hora, da hora a lo
 *      que no la tiene y, una vez al día, limpia lo viejo.
 *   3. ENVIAR. Reserva los seguimientos cuya hora ha llegado (la base garantiza que dos pasadas no cogen el mismo) y, uno a uno, decide con
 *      `decidirSalida` (control.ts): enviar, aplazar o parar. Antes de enviar se vuelve a leer el buzón.
 *
 * NADA SE ENVÍA SIN QUE ESTO SE CUMPLA (y todo queda apuntado en el rastro de la secuencia):
 *   · El motor está encendido y NO en ensayo (en ensayo se decide y se apunta, pero no sale nada).
 *   · El lead no ha contestado, no ha rebotado, sigue siendo de ese comercial y no está en «No interesa», «Cita» ni «En seguimiento»; nadie ha
 *     hablado con él por teléfono ni el comercial le ha escrito por su cuenta (control.ts).
 *   · Es día hábil y hora de la ventana, el buzón no está en pausa ni desconectado, y se ha leído hace menos de 5 minutos.
 *   · No se ha pasado el tope del día (la rampa) ni el de la hora, y no ha salido otro correo del buzón (3 min) ni del sistema (45 s) hace nada.
 *   · Si desde el último correo se escribió algo nuevo en la ficha, la IA lo lee y decide enviar, adaptar o pausar (ante la duda, pausa).
 *
 * UN ENVÍO QUE SE CORTA A MEDIAS NO SE REPITE A CIEGAS. Antes de enviar se apunta el Message-ID con el que va a salir. Si el contenedor muere
 * justo ahí, la reserva caduca a los 10 minutos y la siguiente pasada busca ese Message-ID en el buzón: si está, el correo salió y se da por
 * enviado; si no está, no se sabe, y se deja la secuencia en pausa para que lo mire una persona (un duplicado cuesta más que un seguimiento
 * de menos).
 */

/* ------------------------------------------------------------------ */
/* Lo que el motor necesita de fuera                                   */
/* ------------------------------------------------------------------ */

export interface EnvioDeSeguimiento {
  buzonId: string
  para: string
  asunto: string
  /** El cuerpo ya con la firma del buzón */
  texto: string
  /** Message-ID (sin < >) del correo al que se contesta y cadena de References: así queda en el mismo hilo */
  enRespuestaA: string | null
  referencias: string[]
  /** Con esto se forma el Message-ID del correo (`${id}@dominio`): se apunta ANTES de enviar */
  id: string
}

export type CodigoDeFalloDeEnvio = 'credenciales' | 'rechazado' | 'limite' | 'base' | 'red' | 'otro'

export type ResultadoDelEnvio = { ok: true; messageId: string; fecha: number; copiadoAEnviados: boolean } | { ok: false; codigo: CodigoDeFalloDeEnvio; mensaje: string }

export interface DependenciasDelMotor {
  almacen: AlmacenDeSecuencias
  ahora?: () => number
  /** Lee el buzón del servidor de correo (lo nuevo de Entrada y Enviados). Puede fallar: el motor decide con lo que haya */
  sincronizar: (buzonId: string) => Promise<void>
  enviar: (e: EnvioDeSeguimiento) => Promise<ResultadoDelEnvio>
  /** La IA que lee lo nuevo de la ficha (ia.ts) */
  revisar: (mensajes: { system: string; usuario: string }, original: string) => Promise<ResultadoDeRevisionConIa>
  /** La IA que lee lo que contesta un lead (ia.ts). Sin ella no se leen las respuestas (el resto del motor sigue igual) */
  clasificar?: (mensajes: { system: string; usuario: string }) => Promise<ResultadoDeClasificacionConIa>
  /** La IA que escribe cada seguimiento justo antes de enviarlo, con todo el historial del lead (ia.ts). Sin ella, o con el ajuste apagado, sale el texto programado */
  redactar?: (mensajes: { system: string; usuario: string }, anteriores: readonly string[]) => Promise<ResultadoDeRedaccionConIa>
  /**
   * El servicio de verificación de direcciones (MillionVerifier), para los seguimientos que se programaron ANTES de tenerlo: justo antes de enviar, se mira si la
   * dirección existe (una vez; lo comprobado se guarda y no se paga otra vez). Devuelve null si no hay nada que decir (apagado, buena, no se pudo comprobar). Si dice
   * `parar`, la secuencia se corta como con una dirección que ya rebotó. Que falle o no esté no cambia nada: el seguimiento sigue su camino
   */
  verificarDireccion?: (direccion: string) => Promise<{ nivel: 'buena' | 'dudosa' | 'mala'; motivo: string; parar: boolean; porQue: 'mala' | 'dudosa' } | null>
  /**
   * Escribe un aviso en la campana de la persona a la que le toca atender algo (un seguimiento pausado, un envío fallido, un rebote, una respuesta que pide algo).
   * Sin ella (las pruebas que no lo miran, la demostración) el motor hace lo mismo y simplemente no avisa. Que falle no afecta a la pasada (`avisarAlDueno`)
   */
  avisar?: (aviso: AvisoParaLaCampana) => Promise<void>
  nuevoId?: () => string
}

export interface OpcionesDePasada {
  /** Cuántos seguimientos se reservan como mucho en una pasada */
  envios?: number
  /** Tiempo máximo de la pasada; con menos que esto no se empieza otro envío */
  presupuestoMs?: number
}

export interface ResumenDePasada {
  /** Si se ha saltado la pasada entera, por qué */
  saltado: string | null
  vigilados: number
  respondidas: number
  rebotes: number
  frenos: number
  noInteresa: number
  reprogramados: number
  planificados: number
  sinHueco: number
  reservados: number
  enviados: number
  aplazados: number
  parados: number
  pausados: number
  fallidos: number
  ensayados: number
  /** Seguimientos que la IA ha escrito de nuevo justo antes de enviarlos (o de ensayarlos) con el historial del lead */
  redactados: number
  /** Respuestas de leads leídas con IA, y de ellas cuántas han cerrado un lead, puesto una rellamada o se han dado por falladas */
  respuestasLeidas: number
  respuestasCerradas: number
  respuestasConRellamada: number
  respuestasFallidas: number
  errores: string[]
  resumen: string
}

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Un seguimiento reservado cuya hora se pasó hace más de esto sin que nadie lo cogiera se reparte de nuevo (el motor estaba parado, o el buzón en pausa) */
export const MARGEN_DE_ATRASO_MS = 20 * 60_000
/** Los pasos que el ensayo aparca quedan con un «siguiente intento» así de lejos; al salir del ensayo se reconocen por ello */
export const APARCADO_DE_ENSAYO_MS = 30 * 86_400_000
const UMBRAL_DE_APARCADO_MS = 20 * 86_400_000
/** Si la última lectura del buzón es más vieja que esto, se lee otra vez antes de decidir */
export const LECTURA_PREVIA_MS = 90_000
export const MAX_INTENTOS = 5
const REINTENTOS_MS = [10, 30, 120, 360].map((m) => m * 60_000)
const REINTENTOS_DE_IA_MS = [5, 15, 45].map((m) => m * 60_000)
const ENVIOS_POR_PASADA = 4
const PRESUPUESTO_POR_DEFECTO_MS = 200_000
const PURGA_CADA_MS = 24 * 3_600_000
const PURGA_DE_MAS_DE_DIAS = 180
/**
 * Los estados del lead desde los que, si nadie contesta a ninguno de los correos, el ERP lo pasa a «No contesta» (un lead que ya está en «No contesta»
 * se queda como está). Hasta el 26 oct 2026 pasaba a «No interesa»; «No contesta» es lo que ocurre de verdad: no ha dicho que no, no ha dicho nada
 * (la columna `no_interesa_en` y los nombres `noInteresa…` son de entonces: se dejan para no tocar la base)
 */
export const ESTADOS_QUE_PASAN_A_NO_CONTESTA: readonly string[] = ['pendiente', 'email_enviado']
/** Las aplazadas que no se apuntan en el rastro: son la vida normal del motor (huecos entre envíos, esperar a leer el buzón) y llenarían el historial */
const APLAZOS_SIN_EVENTO: ReadonlySet<string> = new Set(['envio_reciente_del_buzon', 'envio_reciente_del_sistema', 'sin_lectura_reciente', 'tope_de_la_hora'])

/* ------------------------------------------------------------------ */
/* Ayudas                                                              */
/* ------------------------------------------------------------------ */

const iso = (ms: number): string => new Date(ms).toISOString()
const horaFechada = (ms: number): string => `${diaCorto(diaDeMadrid(ms))} ${horaDeMadrid(ms)}`

/** El siguiente día hábil, a la hora en que empieza la ventana de envío */
function inicioDelSiguienteDiaHabil(ahora: number, ajustes: Pick<AjustesDelMotor, 'ventanaDesdeMin' | 'festivos'>): number {
  return instanteDeMadrid(siguienteDiaHabil(diaDeMadrid(ahora), ajustes.festivos), ajustes.ventanaDesdeMin)
}

/** Cuándo, si nadie contesta, el ERP pasa el lead a «No contesta»: unos días hábiles después del último correo, a media mañana */
export function fechaDeCierre(ultimoEnvioAt: number, ajustes: Pick<AjustesDelMotor, 'diasHastaNoInteresa' | 'ventanaDesdeMin' | 'festivos'>): number {
  return instanteDeMadrid(sumarDiasHabiles(diaDeMadrid(ultimoEnvioAt), ajustes.diasHastaNoInteresa, ajustes.festivos), ajustes.ventanaDesdeMin + 30)
}

/** Lo que se le cuenta al comercial en la ficha cuando un correo rebota, según el porqué */
function notaDeRebote(destinatario: string, porQue: ReturnType<typeof motivoDeRebote>): string {
  if (porQue === 'rechazo_de_politica') {
    return `El servidor de ${destinatario} ha rechazado el correo (lo ha tomado por spam o lo bloquea por política): la dirección puede ser correcta. La secuencia se ha parado.`
  }
  return `El correo a ${destinatario} ha rebotado: el servidor dice que esa dirección no existe o no admite correo. La secuencia se ha parado; conviene buscar otra dirección.`
}

const CLASE_DE_NOTA: Record<string, string> = { llamada: 'llamada', email: 'correo', whatsapp: 'WhatsApp', linkedin: 'LinkedIn', nota: 'nota' }

const motivoCorto = (m: string): string => m.replace(/\s+/g, ' ').trim().slice(0, 300)

function resumenVacio(): ResumenDePasada {
  return { saltado: null, vigilados: 0, respondidas: 0, rebotes: 0, frenos: 0, noInteresa: 0, reprogramados: 0, planificados: 0, sinHueco: 0, reservados: 0, enviados: 0, aplazados: 0, parados: 0, pausados: 0, fallidos: 0, ensayados: 0, redactados: 0, respuestasLeidas: 0, respuestasCerradas: 0, respuestasConRellamada: 0, respuestasFallidas: 0, errores: [], resumen: '' }
}

function redactarResumen(r: ResumenDePasada): string {
  const partes: string[] = []
  const si = (n: number, texto: string) => {
    if (n > 0) partes.push(`${n} ${texto}`)
  }
  si(r.enviados, r.enviados === 1 ? 'enviado' : 'enviados')
  si(r.ensayados, 'en ensayo')
  si(r.redactados, r.redactados === 1 ? 'escrito con el historial' : 'escritos con el historial')
  si(r.aplazados, r.aplazados === 1 ? 'aplazado' : 'aplazados')
  si(r.respondidas, r.respondidas === 1 ? 'respuesta' : 'respuestas')
  si(r.respuestasLeidas, r.respuestasLeidas === 1 ? 'respuesta leída con IA' : 'respuestas leídas con IA')
  si(r.respuestasCerradas, r.respuestasCerradas === 1 ? 'lead cerrado por su respuesta' : 'leads cerrados por su respuesta')
  si(r.respuestasConRellamada, r.respuestasConRellamada === 1 ? 'rellamada puesta' : 'rellamadas puestas')
  si(r.respuestasFallidas, r.respuestasFallidas === 1 ? 'respuesta sin poder leer' : 'respuestas sin poder leer')
  si(r.rebotes, r.rebotes === 1 ? 'rebote' : 'rebotes')
  si(r.parados, r.parados === 1 ? 'parada' : 'paradas')
  si(r.pausados, r.pausados === 1 ? 'pausada' : 'pausadas')
  si(r.fallidos, r.fallidos === 1 ? 'fallido' : 'fallidos')
  si(r.noInteresa, 'pasados a «No contesta»')
  si(r.planificados, r.planificados === 1 ? 'con hora nueva' : 'con hora nueva')
  si(r.reprogramados, 'repartidos de nuevo')
  si(r.frenos, r.frenos === 1 ? 'freno' : 'frenos')
  si(r.errores.length, r.errores.length === 1 ? 'con aviso' : 'con avisos')
  // Apagado y sin nada que contar: se dice por qué. Apagado pero habiendo leído respuestas: se cuenta lo leído
  if (r.saltado) return partes.length > 0 ? `Motor apagado (no envía) · ${partes.join(' · ')}` : `Saltada: ${r.saltado}`
  return partes.length > 0 ? partes.join(' · ') : 'Sin novedades'
}

/** Lo que se ve en el rastro de una fase que falló: una frase fija, nunca el texto de la excepción */
function apuntarErrorDeFase(r: ResumenDePasada, fase: string, error: unknown): void {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null
  console.error(`[secuencias] fallo en la fase «${fase}»`, { mensaje: error instanceof Error ? error.message : 'sin mensaje', codigo: e?.code ?? e?.cause?.code ?? null })
  r.errores.push(`falló la fase «${fase}»`)
}

/* ------------------------------------------------------------------ */
/* La pasada                                                           */
/* ------------------------------------------------------------------ */

export async function ejecutarPasada(deps: DependenciasDelMotor, opciones: OpcionesDePasada = {}): Promise<ResumenDePasada> {
  const ahora = deps.ahora ?? Date.now
  const inicio = ahora()
  const r = resumenVacio()
  const { almacen } = deps

  const lectura = await almacen.leerAjustes()
  if (!lectura) {
    r.saltado = 'falta lanzar la migración 245_correo_secuencias.sql'
    r.resumen = redactarResumen(r)
    return r
  }
  const { ajustes } = lectura
  if (!ajustes.activa) {
    // Apagado no se vigila, ni se reparte, ni se envía nada. Pero lo que contesta un lead no espera a que se encienda el envío: un «llámame el jueves» tiene
    // que dejar la rellamada puesta igual
    r.saltado = 'el motor está apagado (se enciende en Correo → Secuencias → Ajustes)'
    try {
      await leerRespuestasDeLosLeads(deps, ajustes, lectura.respuestasAt, r, (e) => apuntarErrorDeFase(r, 'respuestas', e))
    } catch (e) {
      apuntarErrorDeFase(r, 'respuestas', e)
    }
    r.resumen = redactarResumen(r)
    return r
  }

  let buzones: BuzonDelMotor[] = []
  try {
    buzones = await almacen.buzones()
  } catch (e) {
    apuntarErrorDeFase(r, 'buzones', e)
    r.resumen = redactarResumen(r)
    return r
  }

  try {
    await vigilar(deps, lectura.vigilanciaAt, buzones, r)
  } catch (e) {
    apuntarErrorDeFase(r, 'vigilar', e)
  }
  try {
    await leerRespuestasDeLosLeads(deps, ajustes, lectura.respuestasAt, r, (e) => apuntarErrorDeFase(r, 'respuestas', e))
  } catch (e) {
    apuntarErrorDeFase(r, 'respuestas', e)
  }
  try {
    await mantener(deps, ajustes, lectura.purgadoAt, buzones, r)
    // Los cambios de rampa y de pausa se ven en las fases siguientes
    buzones = await almacen.buzones()
  } catch (e) {
    apuntarErrorDeFase(r, 'mantener', e)
  }
  try {
    await enviarLoQueToca(deps, ajustes, buzones, r, { envios: opciones.envios ?? ENVIOS_POR_PASADA, hastaMs: inicio + (opciones.presupuestoMs ?? PRESUPUESTO_POR_DEFECTO_MS) })
  } catch (e) {
    apuntarErrorDeFase(r, 'enviar', e)
  }

  r.resumen = redactarResumen(r)
  return r
}

/* ------------------------------------------------------------------ */
/* 1. Vigilar                                                          */
/* ------------------------------------------------------------------ */

async function vigilar(deps: DependenciasDelMotor, vigilanciaAt: number | null, buzones: readonly BuzonDelMotor[], r: ResumenDePasada): Promise<void> {
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()
  // Se solapa un poco con la vez anterior (el proceso es idempotente); la primera vez se mira un cuarto de hora atrás; nunca más de tres días
  const desde = vigilanciaAt === null ? ahora - 15 * 60_000 : Math.max(vigilanciaAt - 2 * 60_000, ahora - 3 * 86_400_000)
  const parejas = await almacen.vigilar(desde, [...DOMINIOS_LIBRES])

  const porSecuencia = new Map<string, { destinatario: string; hiloId: string | null; primerEnvioAt: number; buzonId: string; mensajes: EntranteParaControl[] }>()
  for (const p of parejas) {
    const g = porSecuencia.get(p.inscripcionId) ?? { destinatario: p.destinatario, hiloId: p.hiloId, primerEnvioAt: p.primerEnvioAt, buzonId: p.buzonId, mensajes: [] }
    g.mensajes.push(p.mensaje)
    porSecuencia.set(p.inscripcionId, g)
  }
  r.vigilados = porSecuencia.size

  for (const [inscripcionId, g] of porSecuencia) {
    const clase = lecturaDelBuzon(g.mensajes, { destinatario: g.destinatario, hiloId: g.hiloId, primerEnvioAt: g.primerEnvioAt })
    if (!clase) continue
    if (clase.clase === 'respuesta') {
      await cortarSecuencia(deps, inscripcionId, g.buzonId, { estado: 'respondida', codigo: 'respuesta', motivo: 'El lead ha contestado.', paradaAt: clase.mensaje.fecha }, 'respuesta')
      r.respondidas++
    } else if (clase.clase === 'rebote_duro') {
      const porQue = motivoDeRebote(clase.mensaje.texto)
      const inexistente = porQue === 'inexistente' || porQue === 'desconocido'
      await cortarSecuencia(
        deps,
        inscripcionId,
        g.buzonId,
        { estado: 'parada', codigo: 'rebote', motivo: inexistente ? 'El correo ha rebotado: esa dirección no existe o no admite correo.' : 'El servidor del lead ha rechazado el correo (spam o política), no por la dirección.', paradaAt: clase.mensaje.fecha },
        'rebote',
        {
          notaEnElLead: notaDeRebote(g.destinatario, porQue),
          direccion: inexistente ? { destinatario: g.destinatario, motivo: 'el servidor dijo que no existe', origen: 'rebote', cuando: clase.mensaje.fecha } : undefined,
        }
      )
      r.rebotes++
      // El aviso de ese rebote que escribió la lectura del buzón gana de qué lead es y que su seguimiento se ha parado
      await avisarAlDueno(deps, async () => {
        const ins = await almacen.inscripcion(inscripcionId)
        if (!ins) return null
        const lead = await nombreEnElAviso(deps, ins.leadId, g.destinatario)
        return avisoDeReboteDeSecuencia({ userId: ins.userId, buzonId: g.buzonId, inscripcionId, leadId: ins.leadId, lead, mensajeId: clase.mensaje.id, hiloId: clase.mensaje.hiloId, direccion: g.destinatario, motivo: porQue })
      })
    }
  }

  // Los rebotes de correos que NO eran de una secuencia (un primer correo a mano que rebotó) también enseñan: la dirección no se vuelve a usar
  const dominiosPropios = new Set(buzones.map((b) => dominioDe(b.direccion)))
  for (const aviso of await almacen.rebotesRecientes(desde)) {
    if (motivoDeRebote(aviso.texto) !== 'inexistente') continue
    for (const direccion of extraerDireccionesFallidas(aviso.texto, dominiosPropios)) {
      await almacen.marcarDireccionMala(direccion, 'el servidor dijo que no existe', 'rebote', aviso.creadoAt, ahora)
      // …y se cuenta en la ficha de los leads que tienen esa dirección, aunque el correo no fuera de ninguna secuencia
      await apuntarReboteEnLosLeads(deps, direccion, aviso.creadoAt)
    }
  }

  // Solo se avanza la marca si todo ha ido bien: si algo falla, la próxima pasada vuelve a mirar el mismo tramo
  await almacen.guardarAjustes({ vigilancia_at: iso(ahora) }, null, ahora)
}

/**
 * Un correo a esta dirección ha rebotado porque no existe: se cuenta en la ficha de los leads que la tienen, para que el comercial lo sepa y busque otra.
 * Una sola vez por rebote: si la secuencia del lead ya lo contó (con las mismas primeras palabras), o se vuelve a mirar el mismo aviso en la pasada
 * siguiente (las ventanas se solapan), no se repite.
 */
async function apuntarReboteEnLosLeads(deps: DependenciasDelMotor, direccion: string, cuando: number): Promise<void> {
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()
  const comienzo = `El correo a ${direccion} ha rebotado`
  for (const lead of await almacen.leadsPorDireccion(direccion)) {
    if (await almacen.hayNotaDelSistema(lead.id, comienzo, ahora - 3 * 86_400_000)) continue
    await almacen.apuntarNotaEnLead({ leadId: lead.id, cuerpo: `${comienzo}: el servidor dice que esa dirección no existe o no admite correo. Conviene buscar otra dirección.`, clase: 'nota', ocurrioAt: cuando })
  }
}

/** Corta una secuencia: la deja en el estado que toque, cancela lo que quedaba por salir y lo apunta en el rastro (y, si se pide, en la ficha del lead) */
async function cortarSecuencia(
  deps: DependenciasDelMotor,
  inscripcionId: string,
  buzonId: string,
  cambio: { estado: 'respondida' | 'parada'; codigo: string; motivo: string; paradaAt: number | null },
  evento: TipoDeEvento,
  extras: { notaEnElLead?: string; pasoId?: string | null; direccion?: { destinatario: string; motivo: string; origen: 'rebote' | 'rechazo_smtp'; cuando: number } } = {}
): Promise<void> {
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()
  // Si el rebote dice que la dirección no existe, se recuerda para no volver a escribirle nunca (ni desde otra secuencia ni a mano)
  if (extras.direccion) await almacen.marcarDireccionMala(extras.direccion.destinatario, extras.direccion.motivo, extras.direccion.origen, extras.direccion.cuando, ahora)
  await almacen.cambiarInscripcion(inscripcionId, { estado: cambio.estado, motivo: cambio.motivo, codigo: cambio.codigo, paradaAt: cambio.paradaAt ?? ahora }, ahora)
  await almacen.cerrarPasosAbiertos(inscripcionId, 'cancelado', cambio.motivo, ahora)
  await almacen.apuntarEvento({ inscripcionId, pasoId: extras.pasoId ?? null, buzonId, tipo: evento, detalle: cambio.motivo }, ahora)
  if (extras.notaEnElLead) {
    const ins = await almacen.inscripcion(inscripcionId)
    if (ins) await almacen.apuntarNotaEnLead({ leadId: ins.leadId, cuerpo: extras.notaEnElLead, clase: 'nota', ocurrioAt: ahora })
  }
}

/* ------------------------------------------------------------------ */
/* 2. Mantener                                                         */
/* ------------------------------------------------------------------ */

async function mantener(deps: DependenciasDelMotor, ajustes: AjustesDelMotor, purgadoAt: number | null, buzones: BuzonDelMotor[], r: ResumenDePasada): Promise<void> {
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()
  const hoy = diaDeMadrid(ahora)

  // 1. La rampa de cada buzón empieza a contar el día en que el motor lo usa por primera vez
  for (const b of buzones) {
    if (b.participa && b.rampaInicio === null) await almacen.ajustarBuzon(b.id, { rampaInicio: hoy }, ahora)
  }

  // 2. El freno
  await aplicarFrenos(deps, ajustes, buzones, r, ahora)

  // 3. Cerrar a quien no contestó a nada
  await cerrarLasQueNoContestaron(deps, ajustes, r, ahora)

  // 4. Al salir del ensayo, lo aparcado vuelve a la cola sin hora, para repartirse de nuevo
  if (!ajustes.modoEnsayo) await almacen.liberarEnsayados(ahora, ahora + UMBRAL_DE_APARCADO_MS)

  // 5. Lo que se pasó de hora sin que nadie lo cogiera se reparte otra vez
  const atrasados = await almacen.pasosAtrasados(ahora, MARGEN_DE_ATRASO_MS)
  if (atrasados.length > 0) {
    await almacen.quitarHoras(atrasados.map((a) => a.id), ahora)
    r.reprogramados += atrasados.length
    for (const a of atrasados.slice(0, 50)) {
      await almacen.apuntarEvento({ inscripcionId: a.inscripcionId, pasoId: a.id, tipo: 'reprogramado', detalle: 'Se le pasó la hora (el motor estaba parado o el buzón en pausa): se vuelve a repartir.' }, ahora)
    }
  }

  // 6. Dar hora a lo que no la tiene
  const plan = await planificarPendientes(deps, ajustes, buzones, ahora)
  r.planificados += plan.planificados
  r.sinHueco += plan.sinHueco

  // 7. Una limpieza al día
  if (purgadoAt === null || ahora - purgadoAt > PURGA_CADA_MS) {
    await almacen.purgar(PURGA_DE_MAS_DE_DIAS)
    await almacen.guardarAjustes({ purgado_at: iso(ahora) }, null, ahora)
  }
}

/** Si un buzón rebota más de lo normal, se pausa hasta el siguiente día hábil. Se cuenta desde hace 24 h, o desde que acabó su última pausa */
async function aplicarFrenos(deps: DependenciasDelMotor, ajustes: AjustesDelMotor, buzones: BuzonDelMotor[], r: ResumenDePasada, ahora: number): Promise<void> {
  const { almacen } = deps
  const grupos = new Map<number, BuzonDelMotor[]>()
  for (const b of buzones) {
    if (!b.participa) continue
    const desde = Math.max(ahora - 24 * 3_600_000, b.pausadoHasta !== null && b.pausadoHasta <= ahora ? b.pausadoHasta : 0)
    grupos.set(desde, [...(grupos.get(desde) ?? []), b])
  }
  for (const [desde, grupo] of grupos) {
    const salud = await almacen.saludDeBuzones(desde)
    for (const b of grupo) {
      const s = salud.find((x) => x.buzonId === b.id)
      if (!s || s.enviados < ajustes.frenoMinimoEnvios) continue
      if (b.pausadoHasta !== null && b.pausadoHasta > ahora) continue
      if (s.rebotes * 100 <= ajustes.frenoRebotesPct * s.enviados) continue
      const hasta = inicioDelSiguienteDiaHabil(ahora, ajustes)
      const porcentaje = Math.round((s.rebotes * 1000) / s.enviados) / 10
      const motivo = `Freno por rebotes: ${s.rebotes} de ${s.enviados} correos (${porcentaje} %) desde ${horaFechada(desde)}.`
      await almacen.ajustarBuzon(b.id, { pausadoHasta: hasta, motivoPausa: motivo }, ahora)
      await almacen.apuntarEvento({ buzonId: b.id, tipo: 'freno', detalle: `${motivo} El buzón queda en pausa hasta ${horaFechada(hasta)}.` }, ahora)
      r.frenos++
    }
  }
}

/** Reúne lo que hace falta para decidir si una secuencia hay que cortarla: el buzón, el lead, las llamadas y lo que ha entrado */
async function hechosDeParada(deps: DependenciasDelMotor, ins: InscripcionDelMotor, pasos: readonly PasoDelMotor[], ultimoEnvioAt: number): Promise<{ hechos: HechosDeParada; lead: LeadDelMotor | null; notas: NotaLeida[]; llamadas: LlamadaLeida[]; manuales: number[]; entrantes: EntranteParaControl[] }> {
  const { almacen } = deps
  const dominio = dominioDeDireccion(ins.destinatario)
  const propios = [ins.messageIdInicial, ...pasos.map((p) => p.messageId)].filter((x): x is string => !!x)
  const [lead, notas, llamadas, entrantes, manuales, malas] = await Promise.all([
    almacen.leadParaMotor(ins.leadId),
    almacen.notasDelLead(ins.leadId),
    almacen.llamadasDelLead(ins.leadId),
    almacen.entrantesDe({ buzonId: ins.buzonId, desde: ins.primerEnvioAt, hiloId: ins.hiloId, direccion: ins.destinatario, dominio: esDominioLibre(dominio) ? '' : dominio }),
    almacen.correosManualesA({ buzonId: ins.buzonId, destinatario: ins.destinatario, desde: ultimoEnvioAt, propios }),
    almacen.direccionesMalas([ins.destinatario]),
  ])
  const hechos: HechosDeParada = {
    inscripcion: { destinatario: ins.destinatario, hiloId: ins.hiloId, primerEnvioAt: ins.primerEnvioAt, ultimoEnvioAt, userId: ins.userId },
    lead: lead ? { status: lead.status, asignadoA: lead.assigned_to } : null,
    entrantes,
    entrantesIgnorados: new Set(pasos.flatMap((p) => p.decision?.ignorar ?? [])),
    correosManuales: manuales,
    llamadas: llamadas.map((l) => ({ fecha: Date.parse(l.fecha), duracionS: l.duracion_s, estado: l.estado, tipoDeConversacion: l.tipo })),
    direccionMala: malas.get(ins.destinatario.toLowerCase()) ?? null,
  }
  return { hechos, lead, notas, llamadas, manuales, entrantes }
}

function ultimoEnvioDe(ins: InscripcionDelMotor, pasos: readonly PasoDelMotor[], antesDelOrden = Infinity): number {
  return Math.max(ins.primerEnvioAt, ...pasos.filter((p) => p.orden < antesDelOrden && p.estado === 'enviado').map((p) => p.enviadoAt ?? 0))
}

/** Las secuencias completadas a las que ya les toca el cierre: si nada ha cambiado, el lead pasa a «No contesta» */
async function cerrarLasQueNoContestaron(deps: DependenciasDelMotor, ajustes: AjustesDelMotor, r: ResumenDePasada, ahora: number): Promise<void> {
  const { almacen } = deps
  const lista = await almacen.inscripcionesParaNoInteresa(ahora, 50)
  for (const ins of lista) {
    const pasos = await almacen.pasosDe(ins.id)
    const { hechos, lead } = await hechosDeParada(deps, ins, pasos, ultimoEnvioDe(ins, pasos))
    const { parada } = evaluarParada(hechos)
    if (parada) {
      await almacen.cambiarInscripcion(ins.id, { estado: parada.estado, motivo: parada.motivo, codigo: parada.codigo, paradaAt: parada.mensajeFecha ?? ahora, noInteresaEn: null }, ahora)
      await almacen.apuntarEvento({ inscripcionId: ins.id, buzonId: ins.buzonId, tipo: parada.codigo === 'respuesta' ? 'respuesta' : 'parada', detalle: `Al llegar el cierre: ${parada.motivo}` }, ahora)
      if (parada.estado === 'respondida') r.respondidas++
      else r.parados++
      continue
    }
    if (lead && (lead.status === 'no_contesta' || ESTADOS_QUE_PASAN_A_NO_CONTESTA.includes(lead.status))) {
      // Un lead que ya está en «No contesta» es justo lo que se quería: no hay estado que cambiar, pero la secuencia se cierra igual
      const yaEstaba = lead.status === 'no_contesta'
      const cambiado = yaEstaba || (await almacen.cambiarEstadoDelLead(lead.id, 'no_contesta', ESTADOS_QUE_PASAN_A_NO_CONTESTA, ahora))
      if (cambiado) {
        const motivo = `Han salido los ${pasos.filter((p) => p.orden >= 0 && p.estado === 'enviado').length} correos de la secuencia y no ha contestado a ninguno.`
        await almacen.cambiarInscripcion(ins.id, { estado: 'sin_respuesta', motivo, codigo: 'sin_respuesta', paradaAt: ahora, noInteresaEn: null }, ahora)
        if (!yaEstaba) {
          await almacen.apuntarNotaEnLead({
            leadId: lead.id,
            cuerpo: `Pasado a «No contesta» automáticamente: ${motivo} Si más adelante contesta o quieres retomarlo, cambia el estado a mano.`,
            clase: 'nota',
            ocurrioAt: ahora,
          })
          r.noInteresa++
        }
        // El tipo de evento sigue llamándose `no_interesa` (la base lo exige); lo que se lee es el texto
        await almacen.apuntarEvento({ inscripcionId: ins.id, buzonId: ins.buzonId, tipo: 'no_interesa', detalle: yaEstaba ? `El lead ya estaba en «No contesta»: ${motivo}` : `El lead pasa a «No contesta»: ${motivo}` }, ahora)
        continue
      }
    }
    // Ya estaba en otro estado (o cambió justo ahora): no se toca nada y no se vuelve a mirar
    await almacen.cambiarInscripcion(ins.id, { noInteresaEn: null, motivo: `No se pasa a «No contesta»: el lead está en «${lead?.status ?? 'otro estado'}».` }, ahora)
    await almacen.apuntarEvento({ inscripcionId: ins.id, buzonId: ins.buzonId, tipo: 'completada', detalle: `No se pasa a «No contesta»: el lead está en «${lead?.status ?? 'otro estado'}».` }, ahora)
  }
}

/* ------------------------------------------------------------------ */
/* Repartir las horas                                                  */
/* ------------------------------------------------------------------ */

export interface ResultadoDePlan {
  planificados: number
  sinHueco: number
  asignaciones: Asignacion[]
}

/**
 * Da hora a los seguimientos que no la tienen, mirando TODOS los buzones a la vez: nunca dos a la vez, tiempo entre dos del mismo buzón, media
 * hora entre dos a la misma empresa, y la rampa de cada buzón (menos lo que la persona manda a mano). La usa también el alta de una secuencia,
 * para enseñar al comercial la hora exacta en cuanto envía. Los buzones que no participan se quedan sin hora hasta que vuelvan a participar.
 */
export async function planificarPendientes(deps: Pick<DependenciasDelMotor, 'almacen'>, ajustes: AjustesDelMotor, buzones: readonly BuzonDelMotor[], ahora: number): Promise<ResultadoDePlan> {
  const { almacen } = deps
  const pendientes = await almacen.pasosSinHora()
  const participantes = new Map(buzones.filter((b) => b.participa).map((b) => [b.id, b]))
  const aPlanificar = pendientes.filter((p) => participantes.has(p.buzonId))
  if (aPlanificar.length === 0) return { planificados: 0, sinHueco: 0, asignaciones: [] }

  const hoy = diaDeMadrid(ahora)
  const [ocupacion, salientes] = await Promise.all([almacen.ocupacion(instanteDeMadrid(hoy, 0)), almacen.salientesPorHora(ahora - 14 * 86_400_000, [...participantes.keys()])])
  const capacidad = constructorDeCapacidad({
    buzones: new Map([...participantes].map(([id, b]) => [id, { rampaInicio: b.rampaInicio ?? hoy, topeFijo: b.topeDiario }])),
    rampa: ajustes.rampa,
    festivos: ajustes.festivos,
    salientes,
    programados: ocupacion.filter((o) => !o.enviado).map((o) => ({ buzonId: o.buzonId, en: o.en })),
    ahora,
  })
  const plan = planificar({
    pasos: aPlanificar.map((p) => ({ id: p.pasoId, buzonId: p.buzonId, desde: p.desde ?? hoy, dominio: p.dominio })),
    buzones: new Map([...participantes].map(([id, b]) => [id, { llamadasDesdeMin: b.llamadasDesdeMin, llamadasHastaMin: b.llamadasHastaMin }])),
    ocupados: ocupacion.map((o) => ({ en: o.en, buzonId: o.buzonId, dominio: o.dominio })),
    capacidad,
    ahora,
    ajustes,
    semilla: Number(hoy.replace(/-/g, '')),
    horizonteDias: 30,
  })
  const hechas = await almacen.fijarHoras(plan.asignaciones, ahora)
  const porPaso = new Map(aPlanificar.map((p) => [p.pasoId, p]))
  for (const a of plan.asignaciones) {
    const p = porPaso.get(a.pasoId)
    if (p) await almacen.apuntarEvento({ inscripcionId: p.inscripcionId, pasoId: p.pasoId, buzonId: p.buzonId, tipo: 'programado', detalle: `Seguimiento ${p.orden} programado para el ${diaCorto(a.dia)} a las ${horaDeMadrid(a.programadoAt)}.` }, ahora)
  }
  return { planificados: hechas, sinHueco: plan.sinHueco.length, asignaciones: plan.asignaciones }
}

/* ------------------------------------------------------------------ */
/* 3. Enviar lo que toca                                               */
/* ------------------------------------------------------------------ */

async function enviarLoQueToca(deps: DependenciasDelMotor, ajustes: AjustesDelMotor, buzones: BuzonDelMotor[], r: ResumenDePasada, limites: { envios: number; hastaMs: number }): Promise<void> {
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()
  const reservados = await almacen.reclamarPasos(ahora, limites.envios)
  r.reservados = reservados.length
  const mapa = new Map(buzones.map((b) => [b.id, b]))

  for (const paso of reservados) {
    if ((deps.ahora ?? Date.now)() >= limites.hastaMs) {
      // Sin tiempo: se devuelve sin gastar el intento, para la pasada siguiente
      await almacen.soltarPaso(paso.id, { intentos: Math.max(0, paso.intentos - 1) }, (deps.ahora ?? Date.now)())
      continue
    }
    try {
      await procesarPaso(deps, ajustes, mapa, paso, r)
    } catch (e) {
      // Algo inesperado (la base no contestó, por ejemplo): el paso no se queda colgado, se devuelve con espera. Si el envío había empezado,
      // el Message-ID ya está apuntado y la próxima vez se comprobará si salió
      const ahoraDespues = (deps.ahora ?? Date.now)()
      console.error('[secuencias] fallo al procesar un seguimiento', { mensaje: e instanceof Error ? e.message : 'sin mensaje', codigo: (e as { cause?: { code?: unknown } } | null)?.cause?.code ?? null })
      r.errores.push('falló un seguimiento')
      try {
        await almacen.soltarPaso(paso.id, { siguienteIntentoAt: ahoraDespues + (REINTENTOS_MS[Math.min(paso.intentos - 1, REINTENTOS_MS.length - 1)] ?? REINTENTOS_MS[0]) }, ahoraDespues)
      } catch {
        // Si ni eso se puede, la reserva caduca sola a los 10 minutos
      }
    }
  }
}

/** Todo lo que hay que saber de un seguimiento para decidir y para enviarlo */
async function procesarPaso(deps: DependenciasDelMotor, ajustes: AjustesDelMotor, buzones: Map<string, BuzonDelMotor>, paso: PasoDelMotor, r: ResumenDePasada): Promise<void> {
  const { almacen } = deps
  const reloj = deps.ahora ?? Date.now

  const ins = await almacen.inscripcion(paso.inscripcionId)
  if (!ins || ins.estado !== 'activa') {
    // Alguien la ha pausado o cortado mientras tanto: el paso no se toca (la acción de la persona ya se ocupó de él) salvo devolverlo si sigue reservado
    await almacen.soltarPaso(paso.id, { intentos: Math.max(0, paso.intentos - 1) }, reloj())
    return
  }
  const pasos = await almacen.pasosDe(ins.id)
  let buzon = buzones.get(paso.buzonId) ?? null
  if (!buzon) {
    await pausarPorProblema(deps, ins, paso, 'El buzón de esta secuencia ya no existe.', 'buzon_inexistente', r)
    return
  }

  /* ---- un envío que se cortó a medias ---- */
  if (paso.messageId) {
    await recuperarEnvioCortado(deps, ajustes, buzon, ins, pasos, paso, r)
    return
  }

  /* ---- leer el buzón justo antes de decidir ---- */
  buzon = await leerBuzonSiHaceFalta(deps, buzones, buzon)

  const { hechos, lead, notas, llamadas } = await reunirHechos(deps, ajustes, buzon, ins, pasos, paso)
  const decision = decidirSalida(hechos)

  if (decision.accion === 'parar') {
    await cortarSecuencia(
      deps,
      ins.id,
      ins.buzonId,
      { estado: decision.estado, codigo: decision.codigo, motivo: decision.motivo, paradaAt: decision.mensajeFecha ?? null },
      decision.codigo === 'respuesta' ? 'respuesta' : decision.codigo === 'rebote' ? 'rebote' : 'parada',
      {
        pasoId: paso.id,
        notaEnElLead: decision.codigo === 'rebote' ? notaDeRebote(ins.destinatario, decision.motivoDelRebote ?? 'inexistente') : undefined,
        direccion: decision.direccionMala ? { destinatario: ins.destinatario, motivo: 'el servidor dijo que no existe', origen: 'rebote', cuando: decision.mensajeFecha ?? reloj() } : undefined,
      }
    )
    if (decision.estado === 'respondida') r.respondidas++
    else if (decision.codigo === 'rebote') r.rebotes++
    else r.parados++
    // Si la contesta el lead, ya avisó el correo nuevo; si la corta lo que ha hecho la propia persona (llamar, escribirle), no hay nada que avisarle.
    // Se avisa de lo que no ha provocado: un rebote, una dirección que ya rebotó, o un lead que ya no es suyo
    await avisarAlDueno(deps, async () => {
      const lead = await nombreEnElAviso(deps, ins.leadId, ins.destinatario)
      const base = { userId: ins.userId, buzonId: ins.buzonId, inscripcionId: ins.id, leadId: ins.leadId, lead }
      if (decision.codigo === 'rebote' && decision.mensajeId) return avisoDeReboteDeSecuencia({ ...base, mensajeId: decision.mensajeId, hiloId: ins.hiloId, direccion: ins.destinatario, motivo: decision.motivoDelRebote ?? 'inexistente' })
      if (decision.codigo === 'rebote' || decision.codigo === 'direccion_mala' || decision.codigo === 'lead_reasignado' || decision.codigo === 'lead_borrado') return avisoDeSeguimientoParado({ ...base, motivo: decision.motivo, cuando: reloj() })
      return null
    })
    return
  }

  if (decision.accion === 'aplazar') {
    await aplazarPaso(deps, ins, paso, decision, r)
    return
  }

  /* ---- toca enviar ---- */
  let textoFinal = paso.texto
  let revision: DecisionGuardada['revision'] | undefined
  let revisadoConIa = false
  let escrito = false
  const sinHacer = (): ResultadoDeRevisionConIa | null => null

  if (ajustes.redactarAlEnviar && ajustes.redactarAlEnviarDisponible && deps.redactar) {
    // La IA escribe el seguimiento de nuevo con todo lo que consta del lead ahora mismo (y puede decir que mejor lo mire una persona)
    const w = await redactarAlEnviar(deps, buzon, ins, pasos, paso, decision, lead, notas, llamadas, r)
    if (w.tipo === 'terminado') return
    if (w.tipo === 'texto') {
      revisadoConIa = true
      escrito = true
      revision = w.revision
      if (w.revision.decision === 'pausar' && !ajustes.modoEnsayo) {
        await pausarPorRevision(deps, ins, paso, w.revision.motivo, r, true)
        return
      }
      if (w.revision.decision === 'adaptar') {
        textoFinal = w.texto
        r.redactados++
      }
    }
    // Si la IA no ha podido y no hay nada nuevo en la ficha, sale el texto que se programó
  } else if (decision.revisarConIa) {
    revisadoConIa = true
    const encargo = construirEncargoDeRevision({
      contexto: contextoParaIa({ lead: lead ?? ({} as LeadDelMotor), notas: notasParaIa(notas), llamadas: llamadasParaIa(llamadas), correos: correosEnviados(ins, pasos), ahora: reloj() }),
      seguimiento: { numero: paso.orden, de: pasos.filter((p) => p.orden > 0).length, asunto: paso.asunto, texto: paso.texto },
      enviadosAntes: pasos.filter((p) => p.estado === 'enviado' && p.orden < paso.orden).map((p) => ({ hace: hace(iso(p.enviadoAt ?? ins.primerEnvioAt), reloj()), texto: p.textoEnviado ?? p.texto })),
      notasNuevas: decision.notasNuevas.map((n) => notaParaRevisar(n, reloj())),
    })
    const respuesta = (await deps.revisar(encargo, paso.texto)) ?? sinHacer()
    if (!respuesta?.revision) {
      // La IA no ha podido: se espera y se reintenta, y si no hay manera lo mira una persona
      const intento = paso.intentos
      if (intento >= REINTENTOS_DE_IA_MS.length + 1) {
        await pausarPorProblema(deps, ins, paso, 'La IA no ha podido leer lo nuevo de la ficha antes de enviar: lo tiene que mirar una persona.', 'revision_sin_ia', r)
      } else {
        const espera = REINTENTOS_DE_IA_MS[Math.min(intento - 1, REINTENTOS_DE_IA_MS.length - 1)]
        await almacen.soltarPaso(paso.id, { siguienteIntentoAt: reloj() + espera, motivo: 'Esperando a que la IA pueda leer lo nuevo de la ficha.' }, reloj())
        r.aplazados++
      }
      return
    }
    revision = { decision: respuesta.revision.decision, motivo: respuesta.revision.motivo }
    if (respuesta.revision.decision === 'pausar' && !ajustes.modoEnsayo) {
      await pausarPorRevision(deps, ins, paso, respuesta.revision.motivo, r)
      return
    }
    if (respuesta.revision.decision === 'adaptar') textoFinal = respuesta.revision.texto
  }

  if (ajustes.modoEnsayo) {
    await anotarEnsayo(deps, ins, paso, decision, textoFinal !== paso.texto, revision, textoFinal, r)
    return
  }

  await enviarSeguimiento(deps, ajustes, buzon, ins, pasos, paso, textoFinal, { adaptado: textoFinal !== paso.texto, revisadoConIa, revision, motivo: decision.motivo, escrito }, r)
}

/**
 * La IA escribe el seguimiento justo antes de enviarlo, con todo lo que consta del lead (llamadas con lo que se habló, notas, lo enviado). Devuelve:
 *   · `texto`: lo escrito (decisión «adaptar») o la orden de pausar con su motivo («pausar»).
 *   · `borrador`: la IA no ha podido tras varios intentos y NO hay nada nuevo en la ficha: sale el texto que se programó, como siempre.
 *   · `terminado`: el paso ya está resuelto (a la espera de que la IA pueda, o en pausa porque lo tiene que mirar una persona).
 */
type ResultadoDeRedactar = { tipo: 'texto'; texto: string; revision: NonNullable<DecisionGuardada['revision']> } | { tipo: 'borrador' } | { tipo: 'terminado' }

async function redactarAlEnviar(
  deps: DependenciasDelMotor,
  buzon: BuzonDelMotor,
  ins: InscripcionDelMotor,
  pasos: readonly PasoDelMotor[],
  paso: PasoDelMotor,
  decision: Extract<Decision, { accion: 'enviar' }>,
  lead: LeadDelMotor | null,
  notas: readonly NotaLeida[],
  llamadas: readonly LlamadaLeida[],
  r: ResumenDePasada
): Promise<ResultadoDeRedactar> {
  const { almacen } = deps
  const reloj = deps.ahora ?? Date.now
  const enviadosAntes = pasos.filter((p) => p.estado === 'enviado' && p.orden < paso.orden)
  const encargo = construirEncargoDeRedaccion({
    contexto: contextoParaIa({ lead: lead ?? ({} as LeadDelMotor), notas: notasParaIa(notas), llamadas: llamadasParaIa(llamadas), correos: correosEnviados(ins, pasos), ahora: reloj() }),
    seguimiento: { numero: paso.orden, de: pasos.filter((p) => p.orden > 0).length, asunto: paso.asunto, borrador: paso.texto },
    enviadosAntes: enviadosAntes.map((p) => ({ hace: hace(iso(p.enviadoAt ?? ins.primerEnvioAt), reloj()), texto: p.textoEnviado ?? p.texto })),
    notasNuevas: decision.notasNuevas.map((n) => notaParaRevisar(n, reloj())),
    miNombre: buzon.nombre,
    tieneFirma: (buzon.firma ?? '').trim() !== '',
  })
  const resultado = await deps.redactar!(encargo, enviadosAntes.map((p) => p.textoEnviado ?? p.texto))
  if (resultado.redaccion) {
    const { decision: queDice, motivo, texto } = resultado.redaccion
    return queDice === 'pausar' ? { tipo: 'texto', texto: paso.texto, revision: { decision: 'pausar', motivo, escrito: true } } : { tipo: 'texto', texto, revision: { decision: 'adaptar', motivo, escrito: true } }
  }

  // La IA no ha podido: se espera y se reintenta (5, 15 y 45 minutos)
  const intento = paso.intentos
  if (intento >= REINTENTOS_DE_IA_MS.length + 1) {
    // Sin nada nuevo en la ficha, el texto programado sigue valiendo; con algo nuevo que no se ha podido leer, lo mira una persona
    if (!decision.revisarConIa) return { tipo: 'borrador' }
    await pausarPorProblema(deps, ins, paso, 'La IA no ha podido escribir el seguimiento con lo nuevo de la ficha: lo tiene que mirar una persona.', 'revision_sin_ia', r)
    return { tipo: 'terminado' }
  }
  const espera = REINTENTOS_DE_IA_MS[Math.min(intento - 1, REINTENTOS_DE_IA_MS.length - 1)]
  await almacen.soltarPaso(paso.id, { siguienteIntentoAt: reloj() + espera, motivo: 'Esperando a que la IA pueda escribir el seguimiento.' }, reloj())
  r.aplazados++
  return { tipo: 'terminado' }
}

/* ---- lo que se le cuenta a la IA y se lee del lead ---- */

function notasParaIa(notas: readonly NotaLeida[]): NotaParaIa[] {
  return notas.map((n) => ({ kind: n.kind, body: n.body, occurred_at: n.occurred_at, es_respuesta: n.es_respuesta }))
}

function llamadasParaIa(llamadas: readonly LlamadaLeida[]): LlamadaParaIa[] {
  return llamadas.map((l) => ({ fecha: l.fecha, direccion: l.direccion, duracion_s: l.duracion_s, estado: l.estado, tipo: l.tipo, resumen: l.resumen, siguiente_paso: l.siguientePaso, interes: l.interes }))
}

/** Los correos de esta secuencia que ya han salido, para que la IA sepa qué se le ha dicho */
function correosEnviados(ins: InscripcionDelMotor, pasos: readonly PasoDelMotor[]): CorreoParaIa[] {
  return pasos
    .filter((p) => p.estado === 'enviado')
    .map((p) => ({ direccion: 'saliente' as const, fecha: iso(p.enviadoAt ?? ins.primerEnvioAt), asunto: p.asunto, texto: p.textoEnviado ?? p.texto }))
}

function notaParaRevisar(n: NotaParaControl, ahora: number): NotaParaRevisar {
  return { clase: CLASE_DE_NOTA[n.tipo] ?? 'nota', hace: hace(iso(n.fecha), ahora), esDelCliente: n.esRespuesta, texto: textoParaIa(n.cuerpo, 400) }
}

async function leerBuzonSiHaceFalta(deps: DependenciasDelMotor, buzones: Map<string, BuzonDelMotor>, buzon: BuzonDelMotor): Promise<BuzonDelMotor> {
  const ahora = (deps.ahora ?? Date.now)()
  if (!buzon.conectado || buzon.credencialesInvalidas) return buzon
  if (buzon.ultimoSyncAt !== null && ahora - buzon.ultimoSyncAt <= LECTURA_PREVIA_MS) return buzon
  try {
    await deps.sincronizar(buzon.id)
  } catch (e) {
    console.error('[secuencias] no se ha podido leer el buzón antes de enviar', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
  }
  const fresco = await deps.almacen.buzonPorId(buzon.id)
  if (fresco) {
    buzones.set(buzon.id, fresco)
    return fresco
  }
  return buzon
}

async function reunirHechos(
  deps: DependenciasDelMotor,
  ajustes: AjustesDelMotor,
  buzon: BuzonDelMotor,
  ins: InscripcionDelMotor,
  pasos: readonly PasoDelMotor[],
  paso: PasoDelMotor
): Promise<{ hechos: HechosDeSalida; lead: LeadDelMotor | null; notas: NotaLeida[]; llamadas: LlamadaLeida[] }> {
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()
  const ultimoEnvioAt = ultimoEnvioDe(ins, pasos, paso.orden)
  const [base, carga, ultimoDelSistema] = await Promise.all([hechosDeParada(deps, ins, pasos, ultimoEnvioAt), almacen.cargaDelBuzon(buzon.id, ahora), almacen.ultimoEnvioDelSistema(ahora)])
  // ¿Esa dirección existe? Solo si la memoria de rebotes no la había dado ya por mala. Lo que falle aquí NO para el seguimiento: sale como siempre
  if (!base.hechos.direccionMala && deps.verificarDireccion) {
    try {
      const v = await deps.verificarDireccion(ins.destinatario)
      if (v?.parar) base.hechos.direccionMala = { motivo: v.motivo, veces: 1, origen: v.porQue === 'mala' ? 'verificador' : 'verificador_dudosa' }
    } catch (e) {
      console.error('[secuencias] no se ha podido comprobar la dirección de un seguimiento', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
    }
  }
  const topeHoy = topeDelBuzonEnElDia({ rampa: ajustes.rampa, rampaInicio: buzon.rampaInicio, topeFijo: buzon.topeDiario, dia: diaDeMadrid(ahora), festivos: ajustes.festivos })
  const hechos: HechosDeSalida = {
    ...base.hechos,
    ahora,
    ajustes: { ventanaDesdeMin: ajustes.ventanaDesdeMin, ventanaHastaMin: ajustes.ventanaHastaMin, huecoGlobalS: ajustes.huecoGlobalS, huecoBuzonS: ajustes.huecoBuzonS, topeHora: ajustes.topeHora, festivos: ajustes.festivos },
    buzon: { participa: buzon.participa, pausadoHasta: buzon.pausadoHasta, conectado: buzon.conectado, credencialesInvalidas: buzon.credencialesInvalidas, ultimoSyncAt: buzon.ultimoSyncAt },
    carga: { enviadosHoy: carga.enviadosHoy, topeHoy, enviadosUltimaHora: carga.enviadosUltimaHora, ultimoEnvioDelBuzonAt: carga.ultimoEnvioAt, ultimoEnvioDelSistemaAt: ultimoDelSistema },
    notas: base.notas.map((n) => ({ fecha: Date.parse(n.created_at), tipo: n.kind, esRespuesta: n.es_respuesta, cuerpo: n.body })),
  }
  return { hechos, lead: base.lead, notas: base.notas, llamadas: base.llamadas }
}

/* ---- aplazar ---- */

async function aplazarPaso(deps: DependenciasDelMotor, ins: InscripcionDelMotor, paso: PasoDelMotor, d: Extract<Decision, { accion: 'aplazar' }>, r: ResumenDePasada): Promise<void> {
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()
  const ignorar = [...new Set([...(paso.decision?.ignorar ?? []), ...(d.ignorar ?? [])])]
  const decision: DecisionGuardada = { en: ahora, accion: 'aplazar', codigo: d.codigo, motivo: d.motivo, ...(ignorar.length > 0 ? { ignorar } : {}) }
  // Aplazar no es intentar: el intento que gastó la reserva se devuelve
  const intentos = Math.max(0, paso.intentos - 1)

  if (d.cuando.tipo === 'en') {
    await almacen.soltarPaso(paso.id, { siguienteIntentoAt: ahora + d.cuando.ms, intentos, motivo: d.motivo, decision }, ahora)
  } else {
    // Se vuelve a repartir: desde hoy, o desde dentro de unos días hábiles
    const festivos = (await almacen.leerAjustes())?.ajustes.festivos ?? []
    const desde = d.cuando.dias === 0 ? diaDeMadrid(ahora) : sumarDiasHabiles(diaDeMadrid(ahora), d.cuando.dias, festivos)
    await almacen.soltarPaso(paso.id, { programadoAt: null, siguienteIntentoAt: null, intentos, motivo: d.motivo, decision, objetivoDia: desde }, ahora)
  }
  r.aplazados++
  if (!APLAZOS_SIN_EVENTO.has(d.codigo) && paso.decision?.codigo !== d.codigo) {
    await almacen.apuntarEvento({ inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: d.codigo === 'fuera_de_oficina' ? 'fuera_de_oficina' : 'aplazado', detalle: d.motivo }, ahora)
  }
}

/* ---- pausar ---- */

/** Deja la secuencia en pausa a la espera de una persona, con el motivo, y el paso en «pausado» */
async function pausarPorProblema(deps: DependenciasDelMotor, ins: InscripcionDelMotor, paso: PasoDelMotor, motivo: string, codigo: string, r: ResumenDePasada): Promise<void> {
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()
  await almacen.marcarPaso(paso.id, 'pausado', { motivo, decision: { en: ahora, accion: 'pausar', codigo, motivo } }, ahora)
  await almacen.cambiarInscripcion(ins.id, { estado: 'pausada', motivo, codigo }, ahora)
  await almacen.apuntarEvento({ inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: 'pausado', detalle: motivo }, ahora)
  r.pausados++
  await avisarDePausa(deps, ins, motivo, ahora)
}

/** Un seguimiento se ha quedado esperando a que su dueño decida: se lo dice la campana */
async function avisarDePausa(deps: DependenciasDelMotor, ins: InscripcionDelMotor, motivo: string, cuando: number): Promise<void> {
  await avisarAlDueno(deps, async () => avisoDeSeguimientoPausado({ userId: ins.userId, buzonId: ins.buzonId, inscripcionId: ins.id, leadId: ins.leadId, lead: await nombreEnElAviso(deps, ins.leadId, ins.destinatario), motivo, cuando }))
}

async function pausarPorRevision(deps: DependenciasDelMotor, ins: InscripcionDelMotor, paso: PasoDelMotor, motivoDeLaIa: string, r: ResumenDePasada, escrito = false): Promise<void> {
  const motivo = `La IA ha pausado este seguimiento: ${motivoCorto(motivoDeLaIa)}`
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()
  await almacen.marcarPaso(paso.id, 'pausado', { motivo, decision: { en: ahora, accion: 'pausar', codigo: 'revision', motivo, revisadoConIa: true, revision: { decision: 'pausar', motivo: motivoDeLaIa, ...(escrito ? { escrito: true } : {}) } } }, ahora)
  await almacen.cambiarInscripcion(ins.id, { estado: 'pausada', motivo, codigo: 'pausada_por_revision' }, ahora)
  await almacen.apuntarEvento({ inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: 'pausado', detalle: motivo }, ahora)
  r.pausados++
  await avisarDePausa(deps, ins, motivo, ahora)
}

/* ---- ensayo ---- */

/** En ensayo no sale nada: se apunta lo que habría pasado y el paso se aparca lejos, hasta que se salga del ensayo */
async function anotarEnsayo(deps: DependenciasDelMotor, ins: InscripcionDelMotor, paso: PasoDelMotor, d: Extract<Decision, { accion: 'enviar' }>, adaptado: boolean, revision: DecisionGuardada['revision'] | undefined, textoFinal: string, r: ResumenDePasada): Promise<void> {
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()
  const escrito = revision?.escrito === true
  const que =
    revision?.decision === 'pausar'
      ? `habría dejado la secuencia en pausa (${motivoCorto(revision.motivo)})`
      : escrito && adaptado
        ? 'habría enviado el seguimiento escrito de nuevo con lo que consta del lead'
        : adaptado
          ? 'habría enviado el seguimiento adaptado a lo nuevo de la ficha'
          : 'habría enviado el seguimiento'
  // Con un seguimiento escrito de nuevo, el ensayo guarda el texto: es lo que deja ver qué enviaría la IA antes de pasar a envío real
  const ensayo = { accion: revision?.decision === 'pausar' ? 'pausar' : 'enviar', motivo: que, en: ahora, ...(escrito && adaptado ? { texto: textoFinal.slice(0, 2500) } : {}) }
  const decision: DecisionGuardada = { en: ahora, accion: 'ensayo', motivo: d.motivo, revisadoConIa: d.revisarConIa || escrito, ...(revision ? { revision } : {}), ensayo }
  await almacen.soltarPaso(paso.id, { siguienteIntentoAt: ahora + APARCADO_DE_ENSAYO_MS, intentos: Math.max(0, paso.intentos - 1), decision }, ahora)
  await almacen.apuntarEvento({ inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: 'ensayo', detalle: `Ensayo: ${que}.` }, ahora)
  r.ensayados++
}

/* ---- enviar ---- */

async function enviarSeguimiento(
  deps: DependenciasDelMotor,
  ajustes: AjustesDelMotor,
  buzon: BuzonDelMotor,
  ins: InscripcionDelMotor,
  pasos: readonly PasoDelMotor[],
  paso: PasoDelMotor,
  texto: string,
  como: { adaptado: boolean; revisadoConIa: boolean; revision: DecisionGuardada['revision'] | undefined; motivo: string; escrito?: boolean },
  r: ResumenDePasada
): Promise<void> {
  const { almacen } = deps
  const reloj = deps.ahora ?? Date.now

  const firma = (buzon.firma ?? '').trim()
  const cuerpo = textoSinFirma(texto, firma).trim()
  const completo = firma ? `${cuerpo}\n\n${firma}` : cuerpo

  // El hilo: se contesta al último correo que salió de esta secuencia, con la cadena entera de References
  const anteriores = [ins.messageIdInicial, ...pasos.filter((p) => p.orden < paso.orden && p.estado === 'enviado').map((p) => p.messageId)].filter((x): x is string => !!x)
  const referencias = [...new Set(anteriores)]
  const id = deps.nuevoId?.() ?? randomUUID()
  const messageId = `${id}@${dominioDe(buzon.direccion)}`.toLowerCase()

  // Se apunta ANTES de enviar. Si no se puede (el paso ya no está reservado: una persona lo ha cancelado) no se envía
  if (!(await almacen.guardarMessageId(paso.id, messageId, reloj()))) return

  const resultado = await deps.enviar({ buzonId: buzon.id, para: ins.destinatario, asunto: paso.asunto, texto: completo, enRespuestaA: referencias[referencias.length - 1] ?? null, referencias, id })

  if (resultado.ok || resultado.codigo === 'base') {
    const ahora = reloj()
    const enviadoAt = resultado.ok ? resultado.fecha : ahora
    const decision: DecisionGuardada = {
      en: ahora,
      accion: como.adaptado ? 'adaptar' : 'enviar',
      motivo: como.motivo,
      ...(como.revisadoConIa ? { revisadoConIa: true } : {}),
      ...(como.revision ? { revision: como.revision } : {}),
      ...(paso.decision?.ignorar ? { ignorar: paso.decision.ignorar } : {}),
    }
    await almacen.marcarPaso(paso.id, 'enviado', { enviadoAt, messageId, textoEnviado: como.adaptado ? cuerpo : null, decision, motivo: null }, ahora)
    r.enviados++
    const total = pasos.filter((p) => p.orden > 0).length
    await almacen.apuntarEvento(
      { inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: 'enviado', detalle: `Seguimiento ${paso.orden} de ${total} enviado a las ${horaDeMadrid(enviadoAt)}${como.adaptado ? (como.escrito ? ', escrito por la IA justo antes con lo que consta del lead' : ', adaptado por la IA a lo nuevo de la ficha') : ''}${!resultado.ok ? '. Salió, pero no se pudo guardar una copia en el ERP: míralo en la carpeta Enviados del webmail' : ''}.` },
      ahora
    )
    if (como.adaptado) await almacen.apuntarEvento({ inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: 'adaptado', detalle: como.revision?.motivo ?? (como.escrito ? 'Escrito por la IA con lo que consta del lead.' : 'Adaptado por la IA.') }, ahora)
    await almacen.apuntarNotaEnLead({
      leadId: ins.leadId,
      cuerpo: `Seguimiento automático ${paso.orden} de ${total} · correo enviado a ${ins.destinatario}\nAsunto: ${paso.asunto}\n\n${cuerpo}`.slice(0, 8000),
      clase: 'email',
      ocurrioAt: enviadoAt,
    })
    await cerrarSiHaTerminado(deps, ajustes, ins.id, r)
    return
  }

  await manejarFalloDeEnvio(deps, ajustes, buzon, ins, paso, resultado, r)
}

async function manejarFalloDeEnvio(deps: DependenciasDelMotor, ajustes: AjustesDelMotor, buzon: BuzonDelMotor, ins: InscripcionDelMotor, paso: PasoDelMotor, fallo: Extract<ResultadoDelEnvio, { ok: false }>, r: ResumenDePasada): Promise<void> {
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()
  // Un fallo limpio: el correo NO salió, así que el Message-ID apuntado se borra (si no, el siguiente intento se tomaría por un envío cortado a medias)
  const detalle = (frase: string) => `${frase}${fallo.mensaje ? ` (${motivoCorto(fallo.mensaje)})` : ''}`

  if (fallo.codigo === 'rechazado') {
    // El servidor de ese destinatario no admite ni el mensaje: es una dirección mala
    await almacen.soltarPaso(paso.id, { messageId: null }, ahora)
    await cortarSecuencia(
      deps,
      ins.id,
      ins.buzonId,
      { estado: 'parada', codigo: 'rebote', motivo: 'El servidor ha rechazado el mensaje: esa dirección no existe o no admite correo.', paradaAt: ahora },
      'rebote',
      {
        pasoId: paso.id,
        notaEnElLead: `El correo a ${ins.destinatario} ha sido rechazado por el servidor de correo: esa dirección no existe o no admite correo. La secuencia se ha parado; conviene buscar otra dirección.`,
        direccion: { destinatario: ins.destinatario, motivo: 'el servidor rechazó el mensaje al enviarlo', origen: 'rechazo_smtp', cuando: ahora },
      }
    )
    r.rebotes++
    await avisarAlDueno(deps, async () => avisoDeSeguimientoRechazado({ userId: ins.userId, buzonId: ins.buzonId, inscripcionId: ins.id, leadId: ins.leadId, lead: await nombreEnElAviso(deps, ins.leadId, ins.destinatario), direccion: ins.destinatario, cuando: ahora }))
    return
  }

  if (fallo.codigo === 'limite') {
    // El proveedor ha puesto un límite de envíos: el buzón descansa hasta el siguiente día hábil
    const hasta = inicioDelSiguienteDiaHabil(ahora, ajustes)
    const motivo = 'El proveedor del correo ha puesto un límite de envíos: el buzón descansa hasta el siguiente día hábil.'
    await almacen.ajustarBuzon(buzon.id, { pausadoHasta: hasta, motivoPausa: motivo }, ahora)
    await almacen.apuntarEvento({ buzonId: buzon.id, tipo: 'freno', detalle: `${motivo} Reanuda ${horaFechada(hasta)}.` }, ahora)
    await almacen.soltarPaso(paso.id, { messageId: null, programadoAt: null, siguienteIntentoAt: null, intentos: Math.max(0, paso.intentos - 1), objetivoDia: diaDeMadrid(hasta), motivo }, ahora)
    r.frenos++
    return
  }

  if (fallo.codigo === 'credenciales') {
    const espera = 2 * 3_600_000
    await almacen.soltarPaso(paso.id, { messageId: null, siguienteIntentoAt: ahora + espera, intentos: Math.max(0, paso.intentos - 1), motivo: 'El buzón ha rechazado la contraseña: hay que volver a escribirla en Correo.' }, ahora)
    await almacen.apuntarEvento({ inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: 'error', detalle: detalle('El servidor de correo ha rechazado la contraseña del buzón') }, ahora)
    r.aplazados++
    return
  }

  // Red, fallo del servidor… se reintenta con esperas cada vez mayores; y si no hay manera, lo mira una persona
  if (paso.intentos >= MAX_INTENTOS) {
    await almacen.marcarPaso(paso.id, 'fallido', { motivo: `No se ha podido enviar tras ${paso.intentos} intentos.`, messageId: null, decision: { en: ahora, accion: 'pausar', codigo: 'envio_fallido', motivo: detalle('No se ha podido enviar') } }, ahora)
    await almacen.cambiarInscripcion(ins.id, { estado: 'pausada', motivo: `El seguimiento ${paso.orden} no ha podido enviarse tras ${paso.intentos} intentos.`, codigo: 'envio_fallido' }, ahora)
    await almacen.apuntarEvento({ inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: 'error', detalle: detalle(`No se ha podido enviar el seguimiento ${paso.orden} tras ${paso.intentos} intentos`) }, ahora)
    r.fallidos++
    await avisarAlDueno(deps, async () => avisoDeEnvioFallido({ userId: ins.userId, buzonId: ins.buzonId, inscripcionId: ins.id, leadId: ins.leadId, lead: await nombreEnElAviso(deps, ins.leadId, ins.destinatario), motivo: `El seguimiento ${paso.orden} no ha podido enviarse tras ${paso.intentos} intentos`, cuando: ahora }))
    return
  }
  const espera = REINTENTOS_MS[Math.min(paso.intentos - 1, REINTENTOS_MS.length - 1)]
  await almacen.soltarPaso(paso.id, { messageId: null, siguienteIntentoAt: ahora + espera, motivo: 'El envío ha fallado: se vuelve a intentar.' }, ahora)
  await almacen.apuntarEvento({ inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: 'error', detalle: detalle(`El envío ha fallado (intento ${paso.intentos} de ${MAX_INTENTOS}); se reintenta en ${Math.round(espera / 60_000)} min`) }, ahora)
  r.aplazados++
}

/** Una secuencia con todos sus correos cerrados está completada: se apunta cuándo, si nadie contesta, el lead pasa a «No contesta» */
export async function cerrarSiHaTerminado(deps: Pick<DependenciasDelMotor, 'almacen' | 'ahora'>, ajustes: Pick<AjustesDelMotor, 'diasHastaNoInteresa' | 'ventanaDesdeMin' | 'festivos'>, inscripcionId: string, r?: ResumenDePasada): Promise<boolean> {
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()
  const ins = await almacen.inscripcion(inscripcionId)
  // Una secuencia pausada o cortada no se completa sola: ya tiene su estado
  if (!ins || ins.estado !== 'activa') return false
  const pasos = await almacen.pasosDe(inscripcionId)
  const seguimientos = pasos.filter((p) => p.orden > 0)
  if (seguimientos.some((p) => ESTADOS_DE_PASO_ABIERTOS.includes(p.estado))) return false

  const salieronTodos = seguimientos.length > 0 && seguimientos.every((p) => p.estado === 'enviado')
  const noInteresaEn = salieronTodos ? fechaDeCierre(ultimoEnvioDe(ins, pasos), ajustes) : null
  const motivo = salieronTodos ? `Han salido los ${seguimientos.length + 1} correos y no ha contestado.` : 'La secuencia ha terminado.'
  await almacen.cambiarInscripcion(inscripcionId, { estado: 'completada', motivo, codigo: 'completada', noInteresaEn }, ahora)
  await almacen.apuntarEvento(
    { inscripcionId, buzonId: ins.buzonId, tipo: 'completada', detalle: salieronTodos && noInteresaEn !== null ? `${motivo} Si no contesta, pasa a «No contesta» el ${horaFechada(noInteresaEn)}.` : motivo },
    ahora
  )
  void r
  return true
}

/* ---- recuperar un envío cortado ---- */

async function recuperarEnvioCortado(deps: DependenciasDelMotor, ajustes: AjustesDelMotor, buzon: BuzonDelMotor, ins: InscripcionDelMotor, pasos: readonly PasoDelMotor[], paso: PasoDelMotor, r: ResumenDePasada): Promise<void> {
  const { almacen } = deps
  const reloj = deps.ahora ?? Date.now
  const messageId = paso.messageId as string

  // Para ver si salió hay que tener el buzón al día: la copia en Enviados entra con la lectura
  try {
    await deps.sincronizar(buzon.id)
  } catch {
    // Sin poder leer el buzón no se puede saber: se espera y se vuelve a mirar. El Message-ID se conserva
    await almacen.soltarPaso(paso.id, { siguienteIntentoAt: reloj() + REINTENTOS_MS[0], intentos: Math.max(0, paso.intentos - 1), motivo: 'Comprobando si el envío anterior llegó a salir.' }, reloj())
    r.aplazados++
    return
  }

  const salio = await almacen.mensajeEnviado(buzon.id, messageId)
  const ahora = reloj()
  if (salio) {
    await almacen.marcarPaso(paso.id, 'enviado', { enviadoAt: salio.fecha, messageId, decision: { en: ahora, accion: 'enviar', motivo: 'Recuperado: el envío se cortó a medias, pero el correo salió.' }, motivo: null }, ahora)
    const total = pasos.filter((p) => p.orden > 0).length
    await almacen.apuntarEvento({ inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: 'recuperado', detalle: `El envío del seguimiento ${paso.orden} se cortó a medias, pero el correo salió a las ${horaDeMadrid(salio.fecha)}.` }, ahora)
    await almacen.apuntarNotaEnLead({
      leadId: ins.leadId,
      cuerpo: `Seguimiento automático ${paso.orden} de ${total} · correo enviado a ${ins.destinatario}\nAsunto: ${paso.asunto}\n\n${(paso.textoEnviado ?? paso.texto).trim()}`.slice(0, 8000),
      clase: 'email',
      ocurrioAt: salio.fecha,
    })
    r.enviados++
    await cerrarSiHaTerminado(deps, ajustes, ins.id, r)
    return
  }

  // No consta que saliera: no se repite a ciegas
  const motivo = 'Se cortó a mitad de un envío y no consta que el correo saliera. Mira la carpeta Enviados del buzón: si no está, pulsa «Reintentar».'
  await almacen.marcarPaso(paso.id, 'fallido', { motivo, messageId: null, decision: { en: ahora, accion: 'pausar', codigo: 'envio_dudoso', motivo } }, ahora)
  await almacen.cambiarInscripcion(ins.id, { estado: 'pausada', motivo, codigo: 'envio_dudoso' }, ahora)
  await almacen.apuntarEvento({ inscripcionId: ins.id, pasoId: paso.id, buzonId: ins.buzonId, tipo: 'error', detalle: motivo }, ahora)
  r.fallidos++
  await avisarAlDueno(deps, async () => avisoDeEnvioFallido({ userId: ins.userId, buzonId: ins.buzonId, inscripcionId: ins.id, leadId: ins.leadId, lead: await nombreEnElAviso(deps, ins.leadId, ins.destinatario), motivo, cuando: ahora }))
}
