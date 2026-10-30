import { diaCorto, diaDeMadrid, sumarDias } from '@/lib/correo/secuencias/fechas'
import { proximoDiaHabil } from '@/lib/festivos/festivos'
import { lugarDelLead } from '@/lib/festivos/lead'
import type { CodigoCcaa } from '@/lib/ubicacion/zonas'
import { COLD_STATUS_LABELS, type ColdLeadStatus } from '@/lib/types/cold-leads'
import { ESTADOS_DE_RITMO, type FaseDelCiclo } from './ciclo'

/**
 * HACER AVANZAR LAS FASES DEL CICLO: LA REGLA.
 * =============================================
 * PURO. Se comprueba con ciclo-avance.prueba.ts. Lo usa el proceso automático «Ciclo comercial» (ciclo-servidor.ts), que le pasa cada lead del ciclo con su secuencia de correos, el día de hoy y
 * si ya se le ha llamado, y aplica lo que esta función decide. Aquí no se toca ninguna base de datos.
 *
 * A PARTIR DEL 30 OCT 2026 LAS FASES LAS PULSA LA PERSONA (lib/cold-calling/ciclo-manual.ts): llama, escribe el correo y el WhatsApp a mano y pulsa «Fase 2» (o «Fase 3», o «No responde»); la
 * rellamada sale de ese día (+2 y +3 días laborables). Los correos automáticos se pararon: el ritmo ya no sale de la secuencia. Por eso el proceso «Ciclo comercial» corre con
 * AVANCE_AUTOMATICO_DE_FASES = false y SOLO hace lo que no es del comercial: quitar la fase a quien ya salió del ritmo (la IA que cierra por «no me interesa» y la rellamada sola cambian el estado sin
 * pasar por la ficha) y devolver a Fase 1 a los de «No responde» cuando se cumple su plazo. Lo que sigue describe el avance AUTOMÁTICO (Fase 1 → 2 → 3 → «No responde» según la secuencia y las
 * llamadas), que se conserva y se comprueba pero está apagado: se enciende con `avanceAutomatico: true` o cambiando esa constante.
 *
 * LOS CORREOS Y LAS LLAMADAS VAN POR SEPARADO. Los correos de la secuencia salen solos a sus días (los 3 y 7 días hábiles) lo llame o no lo llame nadie. La RELLAMADA de cada fase se pone el mismo
 * día que sale el siguiente correo, y el lead PASA A LA SIGUIENTE FASE CUANDO SE HACE ESA LLAMADA, no cuando pasa el día: un lead al que todavía no se ha llamado se queda donde está, cada día más
 * atrasado, y sale antes en la lista cuanto más antiguo es. Así la lista se va acumulando con los días y se limpia llamando, que es lo que tiene que pasar. (Hasta el 29 oct 2026 pasaban de fase
 * por fecha: un lead al que no se llegaba a llamar saltaba a la fase siguiente en silencio y su llamada atrasada desaparecía.)
 *
 *   Fase 1 («Sin contactar», sin fase puesta) ─ el comercial manda el primer correo con seguimientos ─▶ FASE 2, rellamada el día del seguimiento 1
 *   FASE 2 ─ se hace la llamada (a partir del día de su rellamada) ─▶ FASE 3, rellamada el día del seguimiento 2
 *   FASE 3 ─ se hace la llamada (a partir del día de su rellamada) ─▶ NO RESPONDE, rellamada a los 60 días
 *   NO RESPONDE ─ llega su día ─▶ vuelve a Fase 1 (2.ª vuelta, `ciclo_vuelta` + 1), y de ahí otra vez al ritmo
 *
 * QUE NINGÚN LEAD SE QUEDE ATASCADO PARA SIEMPRE. Si nunca se le llama, la secuencia de correos acaba sola (el motor la cierra «sin respuesta» siete días hábiles después del último correo) y en ese
 * momento el lead pasa a «No responde» aunque no se le haya llamado: la lista atrasada tiene así un final y no crece sin fin. Una llamada se cuenta desde el DÍA de la rellamada (las que se hicieron
 * antes, en los dos toques de la Fase 1, no cuentan) y solo las SALIENTES; el enlace de cada llamada con su lead lo hace Rinkel (lib/rendimiento, migración 237).
 *
 * LO QUE NO HACE, A PROPÓSITO:
 *   · Nunca pasa un lead a «En seguimiento», «Cita agendada» o «No le interesa». Si alguien ha hablado con él (por teléfono, por WhatsApp o por correo), lo pasa la persona. Lo único que se hace
 *     solo es QUITARLE LA FASE cuando su estado ya no es del ritmo (ver más abajo), para que no siga saliendo como «Fase 2» alguien con quien ya se habló.
 *   · No avanza una secuencia que ya no está en marcha (respondió, la paró una conversación, la canceló alguien): un lead que contestó NO es un «No responde», llame quien llame. Se queda donde
 *     está hasta que la persona decida.
 *   · No toca el estado del lead salvo al pasar a «No responde», y solo si era «Sin contactar» (que pase a «No contesta», que es lo que de verdad es).
 *   · No reinicia solo a un lead de «No responde» si en estos dos meses contestó o lo paró alguien (la secuencia está «respondida», «parada», «pausada» o «cancelada»): lo decide quien lo lleva.
 *   · No concluye que se acabaron los correos si queda uno por salir que todavía no tiene día: espera a que lo tenga.
 *
 * LAS FECHAS SALTAN LOS FESTIVOS DEL LEAD. El correo sale el día que toca para todos (un correo no se retrasa por un festivo), pero la LLAMADA se pasa al siguiente día hábil si ese día es festivo
 * en el sitio del lead (lib/festivos/); un lead sin ubicar no se retrasa nunca: no se inventa.
 *
 * CADA CAMBIO LLEVA UNA NOTA para el historial del lead («Pasa a Fase 3…»): así se ve cuándo y por qué cambió de fase.
 */

/** Cuántos días se espera, después de la última rellamada sin respuesta, para volver a empezar. Dos meses, como se decidió */
export const DIAS_HASTA_LA_SEGUNDA_VUELTA = 60

/** Cuántas vueltas como máximo: es el tope del CHECK de la migración 264. Pasado esto el lead se queda en «No responde» y lo decide una persona */
export const MAX_DE_VUELTAS = 20

export interface PasoParaElCiclo {
  /** 0 = el primer correo (lo manda la persona); 1 en adelante, los seguimientos automáticos */
  orden: number
  estado: string
  programado_at: string | null
  enviado_at: string | null
}

export interface SecuenciaParaElCiclo {
  estado: string
  pasos: readonly PasoParaElCiclo[]
}

export interface LeadParaElCiclo {
  status: ColdLeadStatus
  ciclo_fase: FaseDelCiclo | null
  ciclo_vuelta: number
  next_call_date: string | null
  ccaa?: CodigoCcaa | null
  municipio_ine?: string | null
}

export interface CambioDelCiclo {
  campos: { ciclo_fase?: FaseDelCiclo | null; ciclo_vuelta?: number; next_call_date?: string | null; status?: ColdLeadStatus }
  /** Qué se ha decidido, para los números de Sistema y las pruebas */
  motivo: 'fase_2' | 'fase_3' | 'sin_respuesta' | 'otra_vuelta' | 'sale_del_ritmo'
  /** Lo que se apunta en el historial del lead: cuándo y por qué ha cambiado de fase */
  nota: string
}

/**
 * ¿AVANZAN LAS FASES SOLAS? NO, desde el 30 oct 2026: las pulsa la persona (lib/cold-calling/ciclo-manual.ts). Es lo que usa el proceso real (ciclo-servidor.ts); la función de abajo, por defecto, sigue
 * siendo la automática de siempre para que su regla y sus pruebas se conserven. Volver a encenderla es cambiar esta constante.
 */
export const AVANCE_AUTOMATICO_DE_FASES = false

export interface OpcionesDeAvance {
  /** ¿Hay una llamada SALIENTE a este lead desde el día de su rellamada (inclusive)? Lo calcula el proceso con las llamadas de Rinkel */
  llamadaHecha?: boolean
  /**
   * ¿Avanzan las fases solas (Fase 1 → 2 → 3 → «No responde», según la secuencia de correos y las llamadas)? Por defecto SÍ. Apagado, solo se hace lo que no es del comercial: quitar la fase a quien
   * ya salió del ritmo y devolver a Fase 1 a los de «No responde» cuando se cumple su plazo (no hace falta ni secuencia ni llamadas)
   */
  avanceAutomatico?: boolean
}

/** Un paso que ya no cambiará solo y que cuenta como «cumplido»: salió, o el motor lo saltó o falló. Uno cancelado no: lo paró una persona */
const PASO_ABIERTO = ['pendiente', 'enviando', 'pausado']
/** Los estados de una secuencia en los que el lead sigue sin haber contestado: en marcha, completada (salieron todos los correos) o cerrada sin respuesta */
const SECUENCIA_SIN_RESPUESTA = ['activa', 'completada', 'sin_respuesta']

const diaDe = (instante: string | null): string | null => {
  if (!instante) return null
  const ms = Date.parse(instante)
  return Number.isNaN(ms) ? null : diaDeMadrid(ms)
}

export function decidirAvance(lead: LeadParaElCiclo, secuencia: SecuenciaParaElCiclo | null, hoy: string, opciones: OpcionesDeAvance = {}): CambioDelCiclo | null {
  // Alguien ya ha hablado con él o lo ha decidido (el estado ya no es del ritmo): fuera de las fases, y nada más
  if (!ESTADOS_DE_RITMO.includes(lead.status)) {
    return lead.ciclo_fase !== null ? { campos: { ciclo_fase: null }, motivo: 'sale_del_ritmo', nota: `Ciclo comercial · Sale de las fases: el lead está en «${COLD_STATUS_LABELS[lead.status] ?? lead.status}».` } : null
  }

  const automatico = opciones.avanceAutomatico ?? true
  const lugar = lugarDelLead(lead)
  /** El día en que se llama: el del correo si es hábil para el lead, y si no el siguiente que lo sea */
  const diaDeLlamada = (dia: string): string => proximoDiaHabil(sumarDias(dia, -1), lugar)

  const seguimientos = [...(secuencia?.pasos ?? [])].filter((p) => p.orden >= 1).sort((a, b) => a.orden - b.orden)
  // Para EMPEZAR hace falta una secuencia viva con algún seguimiento por salir
  const enMarcha = secuencia?.estado === 'activa'
  // Para AVANZAR basta con que nadie la haya parado: el motor la da por «completada» en cuanto sale el último correo (y por «sin_respuesta» al cerrarla), y eso sigue siendo «no ha contestado».
  // «respondida», «parada», «pausada» y «cancelada» la congelan: ahí ha pasado algo que decide una persona
  const sinRespuesta = secuencia !== null && SECUENCIA_SIN_RESPUESTA.includes(secuencia.estado)
  /**
   * El próximo correo por salir después de ese. `hay: false` = no queda ninguno (fin del ritmo). `hay: true` con `dia: null` = queda uno que todavía no tiene día: NO es el fin, hay que esperar a que
   * lo tenga (si no, un seguimiento pendiente sin hora llevaría al lead a «No responde» con un correo todavía por salir).
   */
  const siguiente = (despuesDeOrden: number): { hay: boolean; dia: string | null } => {
    const paso = seguimientos.find((p) => p.orden > despuesDeOrden && PASO_ABIERTO.includes(p.estado))
    return paso ? { hay: true, dia: diaDe(paso.programado_at) } : { hay: false, dia: null }
  }
  const finDeCiclo = (porQue: string): CambioDelCiclo => {
    const volver = diaDeLlamada(sumarDias(hoy, DIAS_HASTA_LA_SEGUNDA_VUELTA))
    return {
      campos: {
        ciclo_fase: 'sin_respuesta',
        next_call_date: volver,
        // Pasó por todo el ritmo sin que nadie contestara: «No contesta» es lo que es. Si ya lo está, no se toca
        ...(lead.status === 'pendiente' ? { status: 'no_contesta' as const } : {}),
      },
      motivo: 'sin_respuesta',
      nota: `Ciclo comercial · ${porQue}: pasa a «No responde». Se vuelve a llamar el ${diaCorto(volver)}, a los dos meses.`,
    }
  }

  switch (lead.ciclo_fase) {
    case null: {
      // Con las fases a mano, de la Fase 1 a la 2 pasa cuando la persona pulsa «Fase 2»
      if (!automatico) return null
      // Fase 1: ¿ha mandado ya el comercial el primer correo con seguimientos?
      const proximo = enMarcha ? siguiente(0) : null
      if (!proximo?.hay || proximo.dia === null) return null
      const rellamada = diaDeLlamada(proximo.dia)
      return { campos: { ciclo_fase: 'f2', next_call_date: rellamada }, motivo: 'fase_2', nota: `Ciclo comercial · Pasa a Fase 2. Rellamada el ${diaCorto(rellamada)}, el día del siguiente correo.` }
    }

    case 'f2': {
      if (!automatico || !sinRespuesta || seguimientos.length === 0) return null
      // El ritmo de correos ya acabó sin respuesta (el motor cierra la secuencia siete días hábiles después del último): no se queda atrasado para siempre
      if (secuencia?.estado === 'sin_respuesta') return finDeCiclo('Acabó la secuencia de correos sin respuesta')
      if (!opciones.llamadaHecha) return null
      // Se ha hecho la llamada de la Fase 2: a la siguiente, con la rellamada el día del siguiente correo (o, si ese día ya pasó, el próximo hábil: no se llama dos veces el mismo día)
      const proximo = siguiente(seguimientos[0].orden)
      if (!proximo.hay) return finDeCiclo('Hecha la llamada de la Fase 2 y sin más correos por salir')
      if (proximo.dia === null) return null
      const del = diaDeLlamada(proximo.dia)
      const rellamada = del > hoy ? del : proximoDiaHabil(hoy, lugar)
      return { campos: { ciclo_fase: 'f3', next_call_date: rellamada }, motivo: 'fase_3', nota: `Ciclo comercial · Hecha la llamada de la Fase 2: pasa a Fase 3. Rellamada el ${diaCorto(rellamada)}.` }
    }

    case 'f3': {
      if (!automatico || !sinRespuesta || seguimientos.length === 0) return null
      if (secuencia?.estado === 'sin_respuesta') return finDeCiclo('Acabó la secuencia de correos sin respuesta')
      return opciones.llamadaHecha ? finDeCiclo('Hecha la llamada de la Fase 3') : null
    }

    case 'sin_respuesta': {
      if (lead.next_call_date === null || hoy < lead.next_call_date) return null
      // Si en estos dos meses el lead contestó (o una conversación o una persona paró la secuencia), no se reinicia solo: lo decide quien lo lleva. Un lead que ya no tiene secuencia vuelve
      if (secuencia !== null && !SECUENCIA_SIN_RESPUESTA.includes(secuencia.estado)) return null
      // Tope de vueltas (el CHECK de la 264): la 21 no se podría guardar y pararía el proceso entero
      if (lead.ciclo_vuelta >= MAX_DE_VUELTAS) return null
      // Llegó su día: vuelve a «Sin contactar» y a empezar. La fecha se queda: es la de la llamada de hoy
      return { campos: { ciclo_fase: null, ciclo_vuelta: lead.ciclo_vuelta + 1 }, motivo: 'otra_vuelta', nota: `Ciclo comercial · Han pasado los dos meses: vuelve a «Sin contactar» (vuelta ${lead.ciclo_vuelta + 1}).` }
    }

    default:
      return null
  }
}
