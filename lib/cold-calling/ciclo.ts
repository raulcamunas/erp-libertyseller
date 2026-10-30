import { COLD_STATUS_HINTS, COLD_STATUS_LABELS, type ColdLead, type ColdLeadStatus } from '@/lib/types/cold-leads'

/**
 * EL CICLO COMERCIAL DEL LEAD NUEVO: LAS FASES Y SUS CAJAS.
 * ==========================================================
 * PURO. Se comprueba con ciclo.prueba.ts. Lo usan la cartera (cartera.ts), las pantallas de Cold Calling y el proceso que hace avanzar las fases (ciclo-avance.ts).
 *
 * QUÉ ES. Los leads que se pasan a una lista «de ciclo» (los que tienen `ciclo_vuelta`, migración 264) se trabajan con un ritmo fijo:
 *   · FASE 1 = «Sin contactar»: los dos toques de llamada. No tiene caja propia: es la de siempre.
 *   · FASE 2: nadie contestó, el comercial mandó el correo y el WhatsApp y pulsó «Fase 2»: el lead se rellama a los 2 días laborables.
 *   · FASE 3: lo mismo con la segunda rellamada: se rellama a los 3 días laborables de pulsar «Fase 3».
 *   · NO RESPONDE: pasó por las dos rellamadas sin contestar; se vuelve a llamar a los dos meses y entonces empieza otra vez (2.ª vuelta) en «Sin contactar».
 * Y fuera del ritmo, lo de siempre: En seguimiento, Cita agendada y No le interesa. Sacar a un lead de las fases es SIEMPRE cosa del comercial (puede haber hablado por teléfono o por
 * WhatsApp, que la máquina no ve): el sistema nunca pasa un lead a «En seguimiento» por su cuenta.
 *
 * A PARTIR DEL 30 OCT 2026 LAS FASES LAS PULSA LA PERSONA (lib/cold-calling/ciclo-manual.ts): llama, manda el correo y el WhatsApp a mano y pulsa «Fase 2»; el lead vuelve a salir dentro de 2 días
 * laborables («hoy» ese día), repite y pulsa «Fase 3» (+3 laborables), y si no contestan, «No responde» (60 días). Ya no hay correos automáticos que marquen el ritmo. Un lead al que no se llega ese día
 * se queda en su fase, cada día más atrasado, y sale antes en la lista. (El avance automático de lib/cold-calling/ciclo-avance.ts se conserva, apagado.)
 *
 * LA FASE NO ES UN ESTADO NUEVO. `status` sigue siendo uno de los siete de siempre y todo lo que lo lee (Rendimiento, el conector, la IA de los correos y de WhatsApp, el cierre por
 * «no me interesa», las secuencias) sigue entendiendo lo mismo: un lead que está en Fase 2 es un «No contesta» de verdad, y por eso su WhatsApp sale como el de quien no ha hablado y
 * no como el de «después de hablar». La fase es una etiqueta que se pone encima (`ciclo_fase`) y que cambia la persona al pulsar una fase o al sacar al lead del ritmo (y el proceso automático solo
 * para quitarla a quien ya salió del ritmo o para devolver a Fase 1 a los de «No responde» a los 60 días).
 * Lo que cambia es CÓMO SE AGRUPAN Y SE NOMBRAN esos estados en una lista de ciclo: las cajas de abajo.
 */

export type FaseDelCiclo = 'f2' | 'f3' | 'sin_respuesta'
export const FASES_DEL_CICLO: readonly FaseDelCiclo[] = ['f2', 'f3', 'sin_respuesta']

export const faseValida = (fase: unknown): fase is FaseDelCiclo => typeof fase === 'string' && (FASES_DEL_CICLO as readonly string[]).includes(fase)

/** Las siete cajas de una lista de ciclo, en el orden en que se pintan: las mismas siete que tiene el panel de siempre, para que la fila de chips mida lo mismo */
export type CajaDelCiclo = 'pendiente' | 'fase_2' | 'fase_3' | 'no_responde' | 'seguimiento' | 'cita_cualificada' | 'no_interesa'
export const CAJAS_DEL_CICLO: readonly CajaDelCiclo[] = ['pendiente', 'fase_2', 'fase_3', 'no_responde', 'seguimiento', 'cita_cualificada', 'no_interesa']

/** Las tres cajas que solo existen en una lista de ciclo */
export type EstadoSoloDelCiclo = 'fase_2' | 'fase_3' | 'no_responde'
export const ESTADOS_SOLO_DEL_CICLO: readonly EstadoSoloDelCiclo[] = ['fase_2', 'fase_3', 'no_responde']

/** Lo que se puede enseñar o filtrar como «estado»: los siete de siempre y las tres cajas que solo existen en el ciclo */
export type EstadoVisible = ColdLeadStatus | EstadoSoloDelCiclo

type DelCiclo = Pick<ColdLead, 'status'> & Partial<Pick<ColdLead, 'ciclo_fase' | 'ciclo_vuelta'>>

/** ¿Está este lead en el sistema del ciclo? `ciclo_vuelta` (1 = primera vuelta, 2 = la que vuelve a los dos meses…) solo la tienen los que se han pasado a él */
export const enCiclo = (lead: Partial<Pick<ColdLead, 'ciclo_vuelta'>>): boolean => lead.ciclo_vuelta != null

/**
 * Los estados con los que un lead SIGUE en el ritmo del ciclo: nadie ha hablado con él ni ha decidido nada. «No contesta» lo pone Rinkel solo al primer toque sin respuesta (migración 237),
 * y en el ciclo eso sigue siendo la Fase 1. Con cualquier otro estado el lead ha salido de las fases.
 */
export const ESTADOS_DE_RITMO: readonly ColdLeadStatus[] = ['pendiente', 'no_contesta']

/**
 * En qué caja está un lead de una lista de ciclo.
 *
 * Primero manda el estado: «En seguimiento», «Cita agendada» y «No le interesa» son lo que son, tenga la fase que tenga. «Rellamada programada» (el cliente pidió «llámame el jueves»,
 * a mano o porque lo dijo en una llamada o un correo) e «Info enviada» (el panel del ciclo no la tiene) cuentan como «En seguimiento»: alguien ha hablado con el lead. Solo con los
 * estados del ritmo —Sin contactar y No contesta— manda la fase: sin fase es la Fase 1, que es «Sin contactar».
 */
export function cajaDelCiclo(lead: DelCiclo): CajaDelCiclo {
  switch (lead.status) {
    case 'seguimiento':
    case 'cita_cualificada':
    case 'no_interesa':
      return lead.status
    case 'programado':
    case 'email_enviado':
      return 'seguimiento'
    default:
      return lead.ciclo_fase === 'f2' ? 'fase_2' : lead.ciclo_fase === 'f3' ? 'fase_3' : lead.ciclo_fase === 'sin_respuesta' ? 'no_responde' : 'pendiente'
  }
}

/** Lo que se pinta de un lead como su estado: su caja si está en el ciclo y su estado de siempre si no */
export const estadoVisible = (lead: DelCiclo & Partial<Pick<ColdLead, 'ciclo_vuelta'>>): EstadoVisible => (enCiclo(lead) ? cajaDelCiclo(lead) : lead.status)

/**
 * ¿Es esta una lista de ciclo? Cuando MÁS DE LA MITAD de lo que hay en ella está en el ciclo. No «alguno»: un lead movido a mano a otra lista conserva su marca, y con «alguno» una
 * sola tienda perdida cambiaría las cajas de una lista de 800 que no tiene nada que ver. (Con «la mitad», una lista de ciclo a la que se le añade algún lead suelto sigue siéndolo.)
 */
export const esListaDeCiclo = (total: number, enElCiclo: number): boolean => enElCiclo > 0 && enElCiclo * 2 > total

/* ------------------------------------------------------------------ */
/* Cómo se llaman                                                      */
/* ------------------------------------------------------------------ */

const ETIQUETAS_NUEVAS: Record<EstadoSoloDelCiclo, string> = { fase_2: 'Fase 2', fase_3: 'Fase 3', no_responde: 'No responde' }

const PISTAS_NUEVAS: Record<EstadoSoloDelCiclo, string> = {
  fase_2: 'Ya has llamado y escrito (correo y WhatsApp): el lead vuelve a salir dentro de 2 días laborables, con «hoy» ese día; si no llegas, con «atrasada N d» y más arriba cuanto más atrasada. Se pulsa a mano',
  fase_3: 'Segunda rellamada: ya has llamado y escrito otra vez. El lead vuelve a salir dentro de 3 días laborables (5 desde la primera llamada); si no llegas, se queda aquí, más atrasado cada día. Se pulsa a mano',
  no_responde: 'Ha pasado por las dos rellamadas sin contestar. Se vuelve a llamar a los dos meses, y entonces empieza otra vez. Se pulsa a mano',
}

const esNueva = (estado: EstadoVisible): estado is EstadoSoloDelCiclo => (ESTADOS_SOLO_DEL_CICLO as readonly string[]).includes(estado)

/** El nombre completo de un estado visible: «Fase 2», «Sin contactar»… */
export const etiquetaDeEstadoVisible = (estado: EstadoVisible): string => (esNueva(estado) ? ETIQUETAS_NUEVAS[estado] : COLD_STATUS_LABELS[estado])

/** Qué significa, para que nadie dude al elegir */
export const pistaDeEstadoVisible = (estado: EstadoVisible): string => (esNueva(estado) ? PISTAS_NUEVAS[estado] : COLD_STATUS_HINTS[estado])

/**
 * ¿Es una de las tres cajas de fase (Fase 2, Fase 3, No responde)? Las pulsa la persona (lib/cold-calling/ciclo-manual.ts): al pulsar una se guarda la fase y la rellamada, no un estado de los siete.
 * (Hasta el 29 oct 2026 las ponía el sistema y esta función se llamaba `lasPoneElSistema`.)
 */
export const esCajaDeFase = (estado: EstadoVisible): estado is EstadoSoloDelCiclo => esNueva(estado)

/** El estado de siempre al que corresponde elegir esa caja, o null si es una de las tres de fase (Fase 2, Fase 3, No responde): esas guardan una fase y una fecha, no un estado */
export const estadoAlElegirCaja = (caja: EstadoVisible): ColdLeadStatus | null => (esCajaDeFase(caja) ? null : (caja as ColdLeadStatus))

/* ------------------------------------------------------------------ */
/* Sacar a un lead de las fases                                        */
/* ------------------------------------------------------------------ */

/**
 * Lo que hay que guardar además del estado cuando una persona cambia el estado de un lead del ciclo: si el nuevo estado no es del ritmo (En seguimiento, Cita agendada, No le interesa,
 * Rellamada…), el lead sale de sus fases. Si vuelve a «Sin contactar», también: empieza de nuevo. Un lead que no es del ciclo no guarda nada de más.
 */
export function camposDeCicloAlCambiarEstado(lead: Partial<Pick<ColdLead, 'ciclo_vuelta' | 'ciclo_fase'>>, nuevo: ColdLeadStatus): { ciclo_fase?: null } {
  if (!enCiclo(lead) || lead.ciclo_fase == null) return {}
  return nuevo === 'no_contesta' ? {} : { ciclo_fase: null }
}
