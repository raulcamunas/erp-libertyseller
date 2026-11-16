import type { AvisoDeCorreo } from './avisos'
import type { DatosDeAviso, MotivoDeAsignacion, TipoDeAvisoDeCorreo } from './campana-tipos'
import { ETIQUETA_DE_CLASE, type ClaseDeRespuesta } from './secuencias/clases'
import { diaCorto } from './secuencias/fechas'
import type { MotivoDeRebote } from './verificacion/rebotes'

/**
 * LOS TEXTOS DE LOS AVISOS DE CORREO DE LA CAMPANA — PURO. Se comprueba con campana.prueba.ts.
 * =============================================================================================
 * Cada función recibe lo que ha pasado y devuelve el aviso tal y como se escribe en `notifications`: a quién, de qué tipo, con qué clave (para no
 * repetirlo), qué dice y de dónde es. No toca la base: quien la toca es campana-servidor.ts.
 *
 * LA CLAVE. Un correo concreto avisa una sola vez (`msg:<id del mensaje>`), pase lo que pase y lo lean cuantos procesos lo lean. Y un aviso se puede
 * MEJORAR: el correo de un lead que contesta avisa primero como «Correo nuevo de Fulano» y, cuando el motor de secuencias lo ha leído con la IA, se
 * vuelve a escribir con la misma clave y pasa a decir «Fulano está interesado». Es el mismo aviso con más información, no uno segundo: se marca con
 * `enriquecer`. Lo demás (un seguimiento pausado, un envío fallido) lleva una clave con la hora: cada vez que pasa es un aviso distinto.
 *
 * SOLO SE AVISA DE LO QUE LA PERSONA TIENE QUE ATENDER y no ha provocado ella: un correo que llega, un correo que rebota, un seguimiento que se ha
 * quedado esperando a que lo mire, una respuesta que pide algo. Lo que hace la propia persona (llamar al lead, escribirle) no se le avisa.
 */

export interface AvisoParaLaCampana {
  /** A quién se avisa: el dueño del buzón o de la secuencia, quien lo tiene asignado o lo sigue en «Mis correos». Nunca quien solo supervisa */
  userId: string
  tipo: TipoDeAvisoDeCorreo
  clave: string
  titulo: string
  mensaje: string
  datos: DatosDeAviso
  /** true: si ya hay un aviso con esta clave, se cambia su texto (es una versión mejor del mismo aviso). false u omitido: se deja el que había */
  enriquecer?: boolean
}

export const claveDeMensaje = (mensajeId: string): string => `msg:${mensajeId}`

const MAX_TITULO = 100
const MAX_MENSAJE = 260

const limpiar = (t: string): string => t.replace(/\s+/g, ' ').trim()
const recortar = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t)
/** Una frase acabada en punto: el motivo que cuenta el motor a veces trae el punto y a veces no */
const conPunto = (t: string): string => {
  const l = limpiar(t)
  return l === '' || /[.!?…»)]$/.test(l) ? l : `${l}.`
}

/** Los datos sin lo que no hay: no se guarda `{ "hiloId": null }` */
function datos(d: Record<string, string | null | undefined>): DatosDeAviso {
  const salida: Record<string, string> = {}
  for (const [k, v] of Object.entries(d)) if (typeof v === 'string' && v !== '') salida[k] = v
  return salida as DatosDeAviso
}

function armar(a: AvisoParaLaCampana): AvisoParaLaCampana {
  return { ...a, titulo: recortar(limpiar(a.titulo), MAX_TITULO), mensaje: recortar(limpiar(a.mensaje), MAX_MENSAJE) }
}

/* ------------------------------------------------------------------ */
/* Lo que llega al buzón                                               */
/* ------------------------------------------------------------------ */

export interface DetalleDeRebote {
  /** La dirección a la que no se pudo entregar, si el aviso la dice con claridad */
  direccion: string | null
  motivo: MotivoDeRebote
}

const PORQUE_REBOTA: Record<MotivoDeRebote, string> = {
  inexistente: 'esa dirección no existe o no admite correo',
  rechazo_de_politica: 'el servidor de destino lo ha rechazado (spam o política), no por la dirección',
  pasajero: 'el buzón de destino está lleno o su servidor falla ahora mismo',
  desconocido: 'el servidor no ha dicho por qué',
}

/**
 * Cómo se avisa a quien no es el dueño del buzón:
 *   · `sinContenidoEn`  la dirección del buzón: el aviso dice «Correo nuevo en <dirección>» SIN remitente, asunto ni vista previa (quien solo lo sigue, o quien lo
 *                       tiene asignado si su rastro no se pudo escribir). El contenido se ve al abrirlo, y ahí queda anotado.
 *   · `enviadoDesde`    para un REBOTE: la dirección del buzón desde la que esta persona (que no es la dueña) envió el correo que ha rebotado.
 */
export interface ComoAvisar {
  sinContenidoEn?: string
  enviadoDesde?: string
}

/** Un correo de una persona que acaba de llegar (o el aviso de que un correo nuestro no se pudo entregar) */
export function avisoDeCorreoNuevo(userId: string, c: AvisoDeCorreo, rebote: DetalleDeRebote | null = null, como: ComoAvisar = {}): AvisoParaLaCampana {
  if (c.rebote) {
    const porque = PORQUE_REBOTA[rebote?.motivo ?? 'desconocido']
    const direccion = rebote?.direccion ?? null
    const desde = como.enviadoDesde?.trim()
    return armar({
      userId,
      tipo: 'correo_rebote',
      clave: claveDeMensaje(c.id),
      titulo: desde ? `Un correo que enviaste desde ${desde} no se ha entregado` : 'Un correo tuyo no se ha entregado',
      mensaje: `${direccion ? `El correo a ${direccion}` : desde ? 'El correo' : 'Un correo tuyo'} ha rebotado: ${porque}.${rebote?.motivo === 'inexistente' ? ' Busca otra dirección.' : ''}`,
      datos: datos({ buzonId: c.buzonId, hiloId: c.hiloId, mensajeId: c.id, direccion }),
    })
  }
  const en = como.sinContenidoEn?.trim()
  if (en) {
    return armar({
      userId,
      tipo: 'correo_nuevo',
      clave: claveDeMensaje(c.id),
      titulo: `Correo nuevo en ${recortar(en, 80)}`,
      mensaje: 'Ábrelo en Correo para leerlo.',
      datos: datos({ buzonId: c.buzonId, hiloId: c.hiloId, mensajeId: c.id }),
    })
  }
  const asunto = c.asunto.trim() || '(sin asunto)'
  return armar({
    userId,
    tipo: 'correo_nuevo',
    clave: claveDeMensaje(c.id),
    titulo: `Correo nuevo de ${recortar(limpiar(c.de), 60)}`,
    mensaje: c.vistaPrevia.trim() ? `${asunto} — ${c.vistaPrevia}` : asunto,
    datos: datos({ buzonId: c.buzonId, hiloId: c.hiloId, mensajeId: c.id }),
  })
}

/* ------------------------------------------------------------------ */
/* Lo que pasa con un seguimiento                                      */
/* ------------------------------------------------------------------ */

interface BaseDeSecuencia {
  userId: string
  buzonId: string
  inscripcionId: string
  leadId?: string | null
  /** Cómo se llama el lead (la tienda o la empresa) */
  lead: string
}

/** Un seguimiento se ha quedado esperando a que una persona decida (la IA lo ha pausado, o algo no ha podido resolverse solo) */
export function avisoDeSeguimientoPausado(p: BaseDeSecuencia & { motivo: string; cuando: number }): AvisoParaLaCampana {
  return armar({
    userId: p.userId,
    tipo: 'secuencia_pausada',
    clave: `pausa:${p.inscripcionId}:${p.cuando}`,
    titulo: `Seguimiento pausado: ${p.lead}`,
    mensaje: `${conPunto(p.motivo)} Decide qué hacer en Correo → Secuencias.`,
    datos: datos({ buzonId: p.buzonId, inscripcionId: p.inscripcionId, leadId: p.leadId }),
  })
}

/** Un seguimiento no ha podido enviarse tras varios intentos (o se cortó a medias y no consta que saliera) */
export function avisoDeEnvioFallido(p: BaseDeSecuencia & { motivo: string; cuando: number }): AvisoParaLaCampana {
  return armar({
    userId: p.userId,
    tipo: 'secuencia_pausada',
    clave: `fallo:${p.inscripcionId}:${p.cuando}`,
    titulo: `No se ha podido enviar el seguimiento a ${p.lead}`,
    mensaje: `${conPunto(p.motivo)} Míralo en Correo → Secuencias.`,
    datos: datos({ buzonId: p.buzonId, inscripcionId: p.inscripcionId, leadId: p.leadId }),
  })
}

/** El servidor de correo ha rechazado el mensaje al enviarlo: la dirección no sirve y la secuencia se ha parado */
export function avisoDeSeguimientoRechazado(p: BaseDeSecuencia & { direccion: string; cuando: number }): AvisoParaLaCampana {
  return armar({
    userId: p.userId,
    tipo: 'secuencia_parada',
    clave: `rechazo:${p.inscripcionId}:${p.cuando}`,
    titulo: `Se ha parado el seguimiento a ${p.lead}`,
    mensaje: `El servidor de correo ha rechazado el mensaje a ${p.direccion}: esa dirección no existe o no admite correo. Busca otra dirección.`,
    datos: datos({ buzonId: p.buzonId, inscripcionId: p.inscripcionId, leadId: p.leadId, direccion: p.direccion }),
  })
}

/**
 * La secuencia se ha parado por algo que la persona no ha hecho y tiene que saber: el lead ha dejado de ser suyo (se ha reasignado o se ha borrado), o la
 * dirección a la que escribía ya rebotó antes. El motivo es la frase que el motor apunta en el rastro de la secuencia.
 */
export function avisoDeSeguimientoParado(p: BaseDeSecuencia & { motivo: string; cuando: number }): AvisoParaLaCampana {
  return armar({
    userId: p.userId,
    tipo: 'secuencia_parada',
    clave: `parada:${p.inscripcionId}:${p.cuando}`,
    titulo: `Se ha parado el seguimiento a ${p.lead}`,
    mensaje: conPunto(p.motivo),
    datos: datos({ buzonId: p.buzonId, inscripcionId: p.inscripcionId, leadId: p.leadId }),
  })
}

/** Otra persona (un administrador) ha pausado o cancelado el seguimiento de esta */
export function avisoDeAccionDeOtro(p: BaseDeSecuencia & { quien: string; accion: 'pausar' | 'cancelar'; cuando: number }): AvisoParaLaCampana {
  const pausar = p.accion === 'pausar'
  return armar({
    userId: p.userId,
    tipo: 'secuencia_parada',
    clave: `${pausar ? 'pausado' : 'cancelado'}_por_otro:${p.inscripcionId}:${p.cuando}`,
    titulo: `${p.quien} ha ${pausar ? 'pausado' : 'cancelado'} el seguimiento a ${p.lead}`,
    mensaje: pausar ? 'No saldrá ningún correo más hasta que se reanude. Lo ves en Correo → Secuencias.' : 'No saldrá ningún seguimiento más. Lo ves en Correo → Secuencias.',
    datos: datos({ buzonId: p.buzonId, inscripcionId: p.inscripcionId, leadId: p.leadId }),
  })
}

/**
 * El correo de un seguimiento ha rebotado y la secuencia se ha parado. Mejora el aviso del rebote (el que escribió la lectura del buzón con la
 * dirección y el motivo) añadiendo de qué lead es y que su seguimiento ya no saldrá.
 */
export function avisoDeReboteDeSecuencia(p: BaseDeSecuencia & { mensajeId: string; hiloId?: string | null; direccion: string; motivo: MotivoDeRebote }): AvisoParaLaCampana {
  const detalle =
    p.motivo === 'inexistente' || p.motivo === 'desconocido'
      ? `El correo a ${p.direccion} ha rebotado: esa dirección no existe o no admite correo. Su seguimiento se ha parado: busca otra dirección.`
      : `El servidor de ${p.lead} ha rechazado el correo a ${p.direccion} (spam o política), no por la dirección. Su seguimiento se ha parado.`
  return armar({
    userId: p.userId,
    tipo: 'correo_rebote',
    clave: claveDeMensaje(p.mensajeId),
    titulo: `Ha rebotado el correo a ${p.lead}`,
    mensaje: detalle,
    datos: datos({ buzonId: p.buzonId, hiloId: p.hiloId, mensajeId: p.mensajeId, inscripcionId: p.inscripcionId, leadId: p.leadId, direccion: p.direccion }),
    enriquecer: true,
  })
}

/* ------------------------------------------------------------------ */
/* Lo que contesta un lead, leído con la IA                            */
/* ------------------------------------------------------------------ */

const TITULO_DE_RESPUESTA: Partial<Record<ClaseDeRespuesta, (lead: string) => string>> = {
  interesado: (l) => `${l} está interesado`,
  pide_info: (l) => `${l} pide información`,
  mas_tarde: (l) => `${l} pide que le escribas más adelante`,
  derivacion: (l) => `${l} te deriva a otra persona`,
  no_interesa: (l) => `${l} dice que no le interesa`,
  baja: (l) => `${l} pide que no le escribas más`,
}

/** Qué se ha hecho en su ficha por esta respuesta, si se ha hecho algo */
export type LoHechoConLaRespuesta = { tipo: 'cerrado' } | { tipo: 'rellamada'; fecha: string } | { tipo: 'revisar' } | null

/**
 * Lo que ha contestado un lead, leído con la IA. Solo avisa de lo que se puede atender (quiere avanzar, pide información, te deriva, pide esperar o
 * dice que no): un «fuera de oficina» o un «otra cosa» no tienen aviso propio y devuelven null (el aviso de correo nuevo ya cubrió el correo).
 * Mejora el aviso de ese correo (misma clave) con lo que la IA ha entendido.
 */
export function avisoDeRespuestaDeLead(
  p: Omit<BaseDeSecuencia, 'inscripcionId'> & { inscripcionId?: string | null; mensajeId: string; hiloId?: string | null; clase: ClaseDeRespuesta; resumen: string; hecho: LoHechoConLaRespuesta }
): AvisoParaLaCampana | null {
  const titulo = TITULO_DE_RESPUESTA[p.clase]
  if (!titulo) return null
  const resumen = conPunto(p.resumen || ETIQUETA_DE_CLASE[p.clase])
  let siguiente: string
  switch (p.clase) {
    case 'interesado':
      siguiente = p.hecho?.tipo === 'rellamada' ? `Queda una rellamada puesta para el ${diaCorto(p.hecho.fecha)}.` : 'Contéstale o llámale cuanto antes.'
      break
    case 'pide_info':
      siguiente = p.hecho?.tipo === 'rellamada' ? `Contéstale con lo que pide. Queda una rellamada puesta para el ${diaCorto(p.hecho.fecha)}.` : 'Contéstale con lo que pide.'
      break
    case 'mas_tarde':
      siguiente = p.hecho?.tipo === 'rellamada' ? `Queda una rellamada puesta para el ${diaCorto(p.hecho.fecha)}.` : 'Ponle una rellamada para entonces.'
      break
    case 'derivacion':
      siguiente = 'Escribe a la persona que te indica.'
      break
    case 'no_interesa':
      siguiente = p.hecho?.tipo === 'cerrado' ? 'El lead pasa a «No interesa».' : 'Mira si hay que cerrarlo.'
      break
    default:
      siguiente = p.hecho?.tipo === 'cerrado' ? 'El lead pasa a «No interesa».' : 'No le escribas más.'
  }
  const aviso = p.hecho?.tipo === 'revisar' ? ' Revisa su ficha.' : ''
  return armar({
    userId: p.userId,
    tipo: 'respuesta_lead',
    clave: claveDeMensaje(p.mensajeId),
    titulo: titulo(p.lead),
    mensaje: `${resumen} ${siguiente}${aviso}`,
    datos: datos({ buzonId: p.buzonId, hiloId: p.hiloId, mensajeId: p.mensajeId, inscripcionId: p.inscripcionId, leadId: p.leadId, clase: p.clase }),
    enriquecer: true,
  })
}

/* ------------------------------------------------------------------ */
/* Asignaciones (migración 318)                                        */
/* ------------------------------------------------------------------ */

/** El instante de una asignación como número (va en la clave): quitar y volver a asignar es otra asignación y vuelve a avisar. Una fecha que no se entiende cuenta como 0 */
const epochDe = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

function datosDeAsignacion(d: { buzonId: string; hiloId?: string | null; porId: string; porNombre: string; motivo: MotivoDeAsignacion }): DatosDeAviso {
  return datos({ buzonId: d.buzonId, hiloId: d.hiloId ?? null, porId: d.porId, porNombre: d.porNombre, motivo: d.motivo })
}

/**
 * Alguien te ha encargado una conversación («Encárgate tú»). No se avisa a quien se la asigna a sí misma: devuelve null.
 * Clave `asig:hilo:<hiloId>:<epoch de asignado_at>`.
 */
export function avisoDeAsignacionDeHilo(p: {
  /** La persona encargada */
  userId: string
  buzonId: string
  hiloId: string
  porId: string
  porNombre: string
  /** El asunto de la conversación (quien la recibe ya lee ese buzón: se ha comprobado antes de asignar) */
  asunto?: string | null
  nota?: string | null
  asignadoAt: string
}): AvisoParaLaCampana | null {
  if (!p.userId || p.userId === p.porId) return null
  const asunto = limpiar(p.asunto ?? '') || '(sin asunto)'
  const nota = limpiar(p.nota ?? '')
  return armar({
    userId: p.userId,
    tipo: 'correo_asignado',
    clave: `asig:hilo:${p.hiloId}:${epochDe(p.asignadoAt)}`,
    titulo: `${limpiar(p.porNombre) || 'Alguien'} te ha encargado una conversación`,
    mensaje: nota ? `${asunto} — «${nota}»` : asunto,
    datos: datosDeAsignacion({ buzonId: p.buzonId, hiloId: p.hiloId, porId: p.porId, porNombre: p.porNombre, motivo: 'hilo' }),
  })
}

/**
 * Un administrador ha asignado un buzón a una persona. Dos avisos posibles:
 *   · `para: 'persona'`  a quien se lo asignan: «Raúl te ha asignado daniela@… (puedes responder)». Clave `asig:buzon:<buzonId>:<personaId>:<epoch>`.
 *   · `para: 'dueno'`    al dueño del buzón: «Raúl ha dado a Patricia acceso para responder desde tu buzón». La misma clave con `:dueno`.
 * No se avisa a quien lo ha hecho él mismo (un administrador que se lo asigna a sí mismo, o que es el dueño): devuelve null.
 */
export function avisoDeAsignacionDeBuzon(p: {
  para: 'persona' | 'dueno'
  buzonId: string
  /** La dirección del buzón */
  direccion: string
  duenoId: string
  personaId: string
  personaNombre: string
  porId: string
  porNombre: string
  puedeResponder: boolean
  asignadoAt: string
}): AvisoParaLaCampana | null {
  const userId = p.para === 'persona' ? p.personaId : p.duenoId
  if (!userId || userId === p.porId) return null
  if (p.para === 'dueno' && p.duenoId === p.personaId) return null
  const por = limpiar(p.porNombre) || 'Un administrador'
  const persona = limpiar(p.personaNombre) || 'una persona'
  const clave = `asig:buzon:${p.buzonId}:${p.personaId}:${epochDe(p.asignadoAt)}${p.para === 'dueno' ? ':dueno' : ''}`
  if (p.para === 'persona') {
    return armar({
      userId,
      tipo: 'correo_asignado',
      clave,
      titulo: `${por} te ha asignado ${p.direccion}${p.puedeResponder ? ' (puedes responder)' : ''}`,
      mensaje: p.puedeResponder
        ? 'Lo tienes en «Mis correos»: te avisa de lo que llega y puedes contestar desde él. Lo que leas y envíes queda anotado.'
        : 'Lo tienes en «Mis correos»: te avisa de lo que llega. Solo lectura: lo que leas queda anotado.',
      datos: datosDeAsignacion({ buzonId: p.buzonId, porId: p.porId, porNombre: p.porNombre, motivo: 'buzon' }),
    })
  }
  return armar({
    userId,
    tipo: 'correo_asignado',
    clave,
    titulo: p.puedeResponder ? `${por} ha dado a ${persona} acceso para responder desde tu buzón` : `${por} ha dado a ${persona} acceso a tu buzón`,
    mensaje: p.puedeResponder
      ? `${persona} lee ${p.direccion} y puede enviar desde él. Cada correo que envíe queda anotado con su nombre.`
      : `${persona} lee ${p.direccion} y le avisa de lo que llega, sin poder enviar desde él.`,
    datos: datosDeAsignacion({ buzonId: p.buzonId, porId: p.porId, porNombre: p.porNombre, motivo: 'buzon_dueno' }),
  })
}

/** Quita los avisos repetidos de una tanda (misma persona y misma clave): el último gana. Una base no deja repetir una clave dentro de un mismo upsert */
export function sinRepetidos(avisos: readonly AvisoParaLaCampana[]): AvisoParaLaCampana[] {
  const porClave = new Map<string, AvisoParaLaCampana>()
  for (const a of avisos) porClave.set(`${a.userId}\u0000${a.clave}`, a)
  return [...porClave.values()]
}
