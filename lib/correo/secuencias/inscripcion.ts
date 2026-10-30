import { direccionesDeLead } from '../ia-servidor'
import type { AlmacenDeSecuencias } from './almacen'
import { MENSAJE_LEAD_ANTIGUO, MENSAJE_SIN_LECTURA, leadAdmiteAutomatizacion } from './antiguos'
import { diaCorto, diaDeMadrid, horaDeMadrid, sumarDiasHabiles } from './fechas'
import { planificarPendientes } from './motor'
import { dominioDeDireccion, esDominioLibre } from './reglas'
import { analizarDireccion } from '../verificacion/direccion'
import { fraseDeDireccionMala } from '../verificacion/pago'
import { revisarSeguimiento } from './seguimientos'

/**
 * EL ALTA DE UNA SECUENCIA: LO QUE PASA CUANDO UN COMERCIAL ENVÍA EL PRIMER CORREO CON SEGUIMIENTOS.
 * ==================================================================================================
 * SOLO SERVIDOR. Se comprueba con inscripcion.prueba.ts, con una base en memoria.
 *
 * El primer correo ya ha salido (lo envía la persona, como siempre) cuando se llama aquí. Esto comprueba que se puede programar lo demás, lo
 * apunta y reparte las horas EN EL ACTO, de modo que el comercial ve la fecha y la hora exactas de cada seguimiento al enviar y no cuando
 * el motor lo recoja.
 *
 * Lo que se comprueba aquí es lo que la IA no puede garantizar y un navegador puede falsear, porque estos correos saldrán solos a nombre de
 * la persona:
 *   · el motor y la secuencia base existen (si no, el correo se envía igual y simplemente no hay seguimientos);
 *   · el buzón participa, el lead es de quien envía y no está ya cerrado (No interesa, Cita, En seguimiento);
 *   · el lead no es de antes de las automatizaciones (antiguos.ts): a un lead ya trabajado antes del 24 oct 2026 que no está en el ciclo no se le programa NADA, y sin ningún aviso:
 *     el correo que acaba de enviar la persona es un correo normal;
 *   · la dirección es una de las del lead (nadie programa seguimientos a una dirección cualquiera);
 *   · ningún seguimiento habla de dinero ni deja huecos por rellenar (las reglas fijas de los correos).
 */

export interface PeticionDeInscripcion {
  leadId: string
  buzonId: string
  userId: string
  destinatario: string
  primerCorreo: {
    asunto: string
    /** Sin la firma */
    texto: string
    messageId: string | null
    hiloId: string | null
    enviadoAt: number
  }
  /** Los textos de los seguimientos, en orden, sin la firma */
  seguimientos: ReadonlyArray<{ texto: string; asunto?: string }>
  iaModelo: string | null
}

/** `lead_antiguo` NO es un fallo: el lead se trabajó antes de las automatizaciones y no lleva seguimientos. Quien envía no recibe ningún aviso por ello (ver app/api/correo/enviar/route.ts) */
export type MotivoDeRechazo = 'direccion_mala' | 'no_disponible' | 'buzon_no_participa' | 'lead_no_vale' | 'lead_antiguo' | 'direccion_no_es_del_lead' | 'texto_no_vale' | 'demasiados_seguimientos' | 'sin_seguimientos' | 'error'

export interface PasoProgramado {
  orden: number
  diasHabiles: number
  asunto: string
  texto: string
  /** Cuándo saldrá, si ya tiene hora */
  programadoAt: number | null
  dia: string | null
  etiqueta: string
}

export type ResultadoDeInscribir =
  | { ok: true; inscripcionId: string; pasos: PasoProgramado[]; aviso: string | null; sustituida: boolean }
  | { ok: false; motivo: MotivoDeRechazo; mensaje: string }

/** Los estados del lead en los que no tiene sentido programar seguimientos: ya lo lleva una persona o ya no quiere. El cuadro de escribir enseña la misma frase antes de enviar (servidor.ts) */
export const LEAD_CERRADO: Record<string, string> = {
  no_interesa: 'Este lead está marcado «No interesa»: no se programan seguimientos.',
  cita_cualificada: 'Este lead ya tiene una cita agendada: no se programan seguimientos.',
  seguimiento: 'Este lead está «En seguimiento»: lo lleva una persona, no se programan seguimientos automáticos.',
}

/** «Re: asunto» sin repetir el «Re:» */
export function asuntoDeSeguimiento(asuntoBase: string): string {
  const limpio = asuntoBase.replace(/\s+/g, ' ').trim()
  return /^(re|rv)\s*:/i.test(limpio) ? limpio : `Re: ${limpio}`
}

const rechazar = (motivo: MotivoDeRechazo, mensaje: string): ResultadoDeInscribir => ({ ok: false, motivo, mensaje })

export async function inscribir(deps: { almacen: AlmacenDeSecuencias; ahora?: () => number }, p: PeticionDeInscripcion): Promise<ResultadoDeInscribir> {
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()

  const lectura = await almacen.leerAjustes()
  const base = lectura ? await almacen.secuenciaBase() : null
  if (!lectura || !base) return rechazar('no_disponible', 'Las secuencias de seguimiento no están disponibles todavía.')
  const { ajustes } = lectura

  if (p.seguimientos.length === 0) return rechazar('sin_seguimientos', 'No hay ningún seguimiento que programar.')
  if (p.seguimientos.length > base.pasos.length) return rechazar('demasiados_seguimientos', `Esta secuencia tiene ${base.pasos.length} seguimientos como máximo.`)

  const buzones = await almacen.buzones()
  const buzon = buzones.find((b) => b.id === p.buzonId)
  if (!buzon) return rechazar('error', 'No se encuentra el buzón.')
  if (!buzon.participa) return rechazar('buzon_no_participa', 'Este buzón no participa en las secuencias automáticas.')
  if (buzon.userId !== p.userId) return rechazar('error', 'Solo la persona dueña del buzón puede programar seguimientos desde él.')

  const lead = await almacen.leadParaMotor(p.leadId)
  if (!lead) return rechazar('lead_no_vale', 'No se encuentra el lead.')
  if (lead.assigned_to !== null && lead.assigned_to !== p.userId) return rechazar('lead_no_vale', 'Este lead es de otra persona: los seguimientos tienen que salir de su comercial.')
  // Un lead de antes de las automatizaciones sigue a mano. Se mira ANTES que su estado: un antiguo «En seguimiento» (lo lleva su comercial, como siempre) no merece ningún aviso.
  // Si no se puede comprobar, no se programa: estos correos salen solos y no se retiran
  const veredicto = await leadAdmiteAutomatizacion(almacen, p.leadId)
  if (!veredicto.admite) return veredicto.porque === 'antiguo' ? rechazar('lead_antiguo', MENSAJE_LEAD_ANTIGUO) : rechazar('error', MENSAJE_SIN_LECTURA)
  const cerrado = LEAD_CERRADO[lead.status]
  if (cerrado) return rechazar('lead_no_vale', cerrado)

  const destino = p.destinatario.trim().toLowerCase()
  if (!direccionesDeLead(lead as unknown as Record<string, unknown>).includes(destino)) return rechazar('direccion_no_es_del_lead', 'Esa dirección no es una de las del lead: los seguimientos solo se programan a sus direcciones.')

  // Una dirección mal escrita, desechable o que ya rebotó antes: no se le programan seguimientos
  const analisis = analizarDireccion(destino)
  const mala = analisis.problemas.find((x) => x.gravedad === 'mala')
  if (mala) return rechazar('direccion_mala', `No se programan seguimientos: ${mala.texto}`)
  const rebotada = (await almacen.direccionesMalas([destino])).get(destino)
  if (rebotada) return rechazar('direccion_mala', fraseDeDireccionMala(rebotada, 'alta'))

  // Las reglas fijas de los correos, otra vez: lo que llega del navegador puede haberlo editado una persona
  const textos = p.seguimientos.map((s) => s.texto.replace(/\r\n?/g, '\n').trim())
  let aviso: string | null = null
  for (let i = 0; i < textos.length; i++) {
    const problemas = revisarSeguimiento(textos[i], [p.primerCorreo.texto, ...textos.slice(0, i)])
    if (problemas.includes('dinero')) return rechazar('texto_no_vale', `El seguimiento ${i + 1} habla de dinero o de facturación: quítalo para poder programarlo.`)
    if (problemas.includes('hueco')) return rechazar('texto_no_vale', `El seguimiento ${i + 1} deja un hueco por rellenar ([…], {{…}} o <…>): complétalo para poder programarlo.`)
    if (problemas.includes('corto')) return rechazar('texto_no_vale', `El seguimiento ${i + 1} es demasiado corto.`)
    if (problemas.includes('largo')) aviso = `El seguimiento ${i + 1} es largo: conviene acortarlo.`
    else if (problemas.includes('repite') && aviso === null) aviso = `El seguimiento ${i + 1} se parece mucho a otro correo de la secuencia.`
  }

  const diaDelPrimero = diaDeMadrid(p.primerCorreo.enviadoAt)
  const dominio = dominioDeDireccion(destino)
  const asuntoBase = p.primerCorreo.asunto.replace(/\s+/g, ' ').trim()
  const creada = await almacen.crearInscripcion(
    {
      secuenciaId: base.id,
      leadId: p.leadId,
      buzonId: p.buzonId,
      userId: p.userId,
      hiloId: p.primerCorreo.hiloId,
      messageIdInicial: p.primerCorreo.messageId,
      destinatario: destino,
      asuntoBase,
      primerEnvioAt: p.primerCorreo.enviadoAt,
      iaModelo: p.iaModelo,
      dominio: esDominioLibre(dominio) ? '' : dominio,
      primerCorreo: { asunto: asuntoBase, texto: p.primerCorreo.texto },
      seguimientos: textos.map((texto, i) => ({
        orden: i + 1,
        diasHabiles: base.pasos[i].dias,
        objetivoDia: sumarDiasHabiles(diaDelPrimero, base.pasos[i].dias, ajustes.festivos),
        asunto: (p.seguimientos[i].asunto ?? '').trim() || asuntoDeSeguimiento(asuntoBase),
        texto,
      })),
    },
    ahora
  )
  if (!creada.ok) return rechazar('error', 'Este lead ya tiene una secuencia en marcha.')

  await almacen.apuntarEvento(
    { inscripcionId: creada.inscripcion.id, buzonId: p.buzonId, tipo: 'inscrita', detalle: `Programados ${textos.length === 1 ? 'un seguimiento' : `${textos.length} seguimientos`} a ${destino}${creada.sustituida ? '. Sustituyen a los de la secuencia anterior de este lead' : ''}.` },
    ahora
  )

  // Las horas, ahora mismo: así el comercial ve cuándo saldrá cada uno
  await planificarPendientes({ almacen }, ajustes, buzones, ahora)
  const pasos = (await almacen.pasosDe(creada.inscripcion.id)).filter((x) => x.orden > 0)
  return {
    ok: true,
    inscripcionId: creada.inscripcion.id,
    aviso,
    sustituida: creada.sustituida !== null,
    pasos: pasos.map((x) => ({
      orden: x.orden,
      diasHabiles: x.diasHabiles,
      asunto: x.asunto,
      texto: x.texto,
      programadoAt: x.programadoAt,
      dia: x.programadoAt !== null ? diaDeMadrid(x.programadoAt) : x.objetivoDia,
      etiqueta: x.programadoAt !== null ? `${diaCorto(diaDeMadrid(x.programadoAt))} a las ${horaDeMadrid(x.programadoAt)}` : x.objetivoDia ? `${diaCorto(x.objetivoDia)} (sin hora todavía)` : 'sin fecha todavía',
    })),
  }
}
