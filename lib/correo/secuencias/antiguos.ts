import type { AlmacenDeSecuencias } from './almacen'

/**
 * LOS LEADS ANTIGUOS NO LLEVAN SEGUIMIENTOS AUTOMÁTICOS.
 * =======================================================
 * SOLO SERVIDOR (lee la base a través del almacén). Se comprueba con antiguos.prueba.ts y con los escenarios del motor (motor.escenarios.ts).
 *
 * Hay tres clases de lead y solo dos admiten los correos que salen solos:
 *   · ANTIGUO. Se trabajó ANTES de que existieran las automatizaciones (24 oct 2026, a7919aa) y no está en una lista de ciclo. Su comercial lo sigue a mano, por correo, y así tiene
 *     que seguir: ni se le ofrecen seguimientos automáticos en el cuadro de escribir ni se le programan. Mandarle un correo a mano funciona exactamente igual que siempre.
 *   · NUEVO. Se empezó a trabajar desde el 24 oct: como hasta ahora.
 *   · DEL CICLO (el sistema 2.0, `cold_leads.ciclo_vuelta`). Siempre admite seguimientos, aunque tenga actividad anterior: el ciclo es justo el ritmo que los usa.
 *
 * «SE TRABAJÓ ANTES» = una llamada de Rinkel o un apunte de una PERSONA (llamada, correo, WhatsApp o LinkedIn) de antes del corte. Es EXACTAMENTE lo que se usó en el SQL con el que se
 * pausaron los seguimientos que ya estaban programados a leads antiguos (30 oct 2026): lo que se pausó y lo que ya no se programa es lo mismo (ver `leadTuvoContactoAntesDe` en almacen.ts).
 *
 * SI NO SE PUEDE COMPROBAR, NO SE PROGRAMA: estos correos salen solos a nombre de una persona y no se pueden retirar una vez enviados. Pero esto NUNCA rompe el envío del primer correo:
 * solo decide si hay seguimientos.
 */

/** El instante en que nacieron las automatizaciones: el 24 oct 2026 a las 00:00 UTC (el mismo corte que el SQL del 30 oct). Todo lo trabajado antes es «de antes» */
export const CORTE_DE_LAS_AUTOMATIZACIONES = '2026-10-24T00:00:00Z'
export const CORTE_EN_MS = Date.parse(CORTE_DE_LAS_AUTOMATIZACIONES)

export interface SituacionDelLead {
  /** Está en una lista de ciclo (el sistema 2.0) */
  enCiclo: boolean
  /** Tiene una llamada de Rinkel o un apunte de una persona anterior al corte */
  contactoAnterior: boolean
}

/** La regla: antiguo es quien se trabajó antes del corte y no está en el ciclo. Estar en el ciclo gana siempre */
export const esLeadAntiguo = (s: SituacionDelLead): boolean => !s.enCiclo && s.contactoAnterior

/** Por qué no admite: `antiguo` (se trabajó antes de las automatizaciones) o `sin_lectura` (no se ha podido comprobar, y ante la duda no se programa) */
export type VeredictoDeAutomatizacion = { admite: true } | { admite: false; porque: 'antiguo' | 'sin_lectura' }

export const MENSAJE_LEAD_ANTIGUO = 'Este lead se trabajó antes de las automatizaciones: no se programan seguimientos automáticos.'
export const MENSAJE_SIN_LECTURA = 'No se han podido comprobar los datos del lead: no se programan seguimientos.'

type LecturaDelAlmacen = Pick<AlmacenDeSecuencias, 'leadEstaEnElCiclo' | 'leadTuvoContactoAntesDe'>

/**
 * ¿Se pueden programar seguimientos automáticos a este lead? Nunca lanza: si la base no contesta, el veredicto es «no» (`sin_lectura`). A un lead del ciclo no se le mira el historial:
 * admite pase lo que pase en él.
 */
export async function leadAdmiteAutomatizacion(almacen: LecturaDelAlmacen, leadId: string): Promise<VeredictoDeAutomatizacion> {
  try {
    if (await almacen.leadEstaEnElCiclo(leadId)) return { admite: true }
    const contactoAnterior = await almacen.leadTuvoContactoAntesDe(leadId, CORTE_EN_MS)
    return esLeadAntiguo({ enCiclo: false, contactoAnterior }) ? { admite: false, porque: 'antiguo' } : { admite: true }
  } catch (error) {
    // Sin datos del lead en el registro: solo el código de la base
    console.error('[secuencias] no se ha podido comprobar si el lead es de antes de las automatizaciones', { codigo: (error as { cause?: { code?: string } } | null)?.cause?.code ?? null })
    return { admite: false, porque: 'sin_lectura' }
  }
}
