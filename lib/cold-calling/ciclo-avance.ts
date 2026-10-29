import { diaDeMadrid, sumarDias } from '@/lib/correo/secuencias/fechas'
import { proximoDiaHabil } from '@/lib/festivos/festivos'
import { lugarDelLead } from '@/lib/festivos/lead'
import type { CodigoCcaa } from '@/lib/ubicacion/zonas'
import type { ColdLeadStatus } from '@/lib/types/cold-leads'
import { ESTADOS_DE_RITMO, type FaseDelCiclo } from './ciclo'

/**
 * HACER AVANZAR LAS FASES DEL CICLO: LA REGLA.
 * =============================================
 * PURO. Se comprueba con ciclo-avance.prueba.ts. Lo usa el proceso automático «Ciclo comercial» (ciclo-servidor.ts), que le pasa cada lead del ciclo con su secuencia de correos y el día de hoy,
 * y aplica lo que esta función decide. Aquí no se toca ninguna base de datos.
 *
 * EL RITMO ES EL DE LOS CORREOS. La rellamada de cada fase se pone el MISMO DÍA que sale el siguiente correo de la secuencia (el motor ya los programa a los 3 y 7 días hábiles), y las fases
 * avanzan por FECHA, no por lo que haga cada llamada: cuando el correo de una fase ha salido y su día ha pasado, el lead pasa a la siguiente. Así no depende de que se haya llamado de un
 * teléfono que Rinkel no vea, y un lead que no se llama a tiempo no se queda parado: aparece como rellamada atrasada, que es lo que tiene que pasar.
 *
 *   Fase 1 («Sin contactar», sin fase puesta) ─ el comercial manda el primer correo con seguimientos ─▶ FASE 2, rellamada el día del seguimiento 1
 *   FASE 2 ─ el seguimiento 1 salió y su día pasó ─▶ FASE 3, rellamada el día del seguimiento 2
 *   FASE 3 ─ el último seguimiento salió y su día pasó ─▶ NO RESPONDE, rellamada a los 60 días
 *   NO RESPONDE ─ llega su día ─▶ vuelve a Fase 1 (2.ª vuelta, `ciclo_vuelta` + 1), y de ahí otra vez al ritmo
 *
 * LO QUE NO HACE, A PROPÓSITO:
 *   · Nunca pasa un lead a «En seguimiento», «Cita agendada» o «No le interesa». Si alguien ha hablado con él (por teléfono, por WhatsApp o por correo), lo pasa la persona. Lo único que se hace
 *     solo es QUITARLE LA FASE cuando su estado ya no es del ritmo (ver más abajo), para que no siga saliendo como «Fase 2» alguien con quien ya se habló.
 *   · No avanza una secuencia que ya no está en marcha (respondió, la paró una conversación, la canceló alguien): un lead que contestó NO es un «No responde». Se queda donde está hasta que la
 *     persona decida.
 *   · No toca el estado del lead salvo al pasar a «No responde», y solo si era «Sin contactar» (que pase a «No contesta», que es lo que de verdad es).
 *   · No reinicia solo a un lead de «No responde» si en estos dos meses contestó o lo paró alguien (la secuencia está «respondida», «parada», «pausada» o «cancelada»): lo decide quien lo lleva.
 *   · No concluye que se acabaron los correos si queda uno por salir que todavía no tiene día: espera a que lo tenga.
 *
 * LAS FECHAS SALTAN LOS FESTIVOS DEL LEAD. El correo sale el día que toca para todos (un correo no se retrasa por un festivo), pero la LLAMADA se pasa al siguiente día hábil si ese día es festivo
 * en el sitio del lead (lib/festivos/); un lead sin ubicar no se retrasa nunca: no se inventa.
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
  /** Qué se ha decidido y por qué, para los números de Sistema y las pruebas */
  motivo: 'fase_2' | 'fase_3' | 'sin_respuesta' | 'otra_vuelta' | 'sale_del_ritmo'
}

/** Un paso que ya no cambiará solo y que cuenta como «cumplido» para pasar de fase: salió, o el motor lo saltó o falló. Uno cancelado no: lo paró una persona */
const PASO_CUMPLIDO = ['enviado', 'saltado', 'fallido']
const PASO_ABIERTO = ['pendiente', 'enviando', 'pausado']
/** Los estados de una secuencia en los que el lead sigue sin haber contestado: en marcha, completada (salieron todos los correos) o cerrada sin respuesta */
const SECUENCIA_SIN_RESPUESTA = ['activa', 'completada', 'sin_respuesta']

const diaDe = (instante: string | null): string | null => {
  if (!instante) return null
  const ms = Date.parse(instante)
  return Number.isNaN(ms) ? null : diaDeMadrid(ms)
}

/** El día en que se llama: el del correo si es hábil para el lead, y si no el siguiente que lo sea */
const diaDeLlamada = (dia: string, lead: Pick<LeadParaElCiclo, 'ccaa' | 'municipio_ine'>): string => proximoDiaHabil(sumarDias(dia, -1), lugarDelLead(lead))

export function decidirAvance(lead: LeadParaElCiclo, secuencia: SecuenciaParaElCiclo | null, hoy: string): CambioDelCiclo | null {
  // Alguien ya ha hablado con él o lo ha decidido (el estado ya no es del ritmo): fuera de las fases, y nada más
  if (!ESTADOS_DE_RITMO.includes(lead.status)) {
    return lead.ciclo_fase !== null ? { campos: { ciclo_fase: null }, motivo: 'sale_del_ritmo' } : null
  }

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
  /** ¿Salió (o se dio por cumplido) y su día ya pasó? El día es el de enviarse o, si no llegó a salir, el que tenía programado */
  const cumplido = (p: PasoParaElCiclo | undefined): boolean => {
    if (!p || !PASO_CUMPLIDO.includes(p.estado)) return false
    const dia = diaDe(p.enviado_at) ?? diaDe(p.programado_at)
    return dia !== null && hoy > dia
  }
  const finDeCiclo = (): CambioDelCiclo => ({
    campos: {
      ciclo_fase: 'sin_respuesta',
      next_call_date: diaDeLlamada(sumarDias(hoy, DIAS_HASTA_LA_SEGUNDA_VUELTA), lead),
      // Pasó por todo el ritmo sin que nadie contestara: «No contesta» es lo que es. Si ya lo está, no se toca
      ...(lead.status === 'pendiente' ? { status: 'no_contesta' as const } : {}),
    },
    motivo: 'sin_respuesta',
  })

  switch (lead.ciclo_fase) {
    case null: {
      // Fase 1: ¿ha mandado ya el comercial el primer correo con seguimientos?
      const proximo = enMarcha ? siguiente(0) : null
      if (!proximo?.hay || proximo.dia === null) return null
      return { campos: { ciclo_fase: 'f2', next_call_date: diaDeLlamada(proximo.dia, lead) }, motivo: 'fase_2' }
    }

    case 'f2': {
      if (!sinRespuesta || seguimientos.length === 0) return null
      const primero = seguimientos[0]
      if (!cumplido(primero)) return null
      const proximo = siguiente(primero.orden)
      if (!proximo.hay) return finDeCiclo()
      if (proximo.dia === null) return null
      return { campos: { ciclo_fase: 'f3', next_call_date: diaDeLlamada(proximo.dia, lead) }, motivo: 'fase_3' }
    }

    case 'f3': {
      if (!sinRespuesta || seguimientos.length === 0) return null
      return cumplido(seguimientos[seguimientos.length - 1]) ? finDeCiclo() : null
    }

    case 'sin_respuesta':
      if (lead.next_call_date === null || hoy < lead.next_call_date) return null
      // Si en estos dos meses el lead contestó (o una conversación o una persona paró la secuencia), no se reinicia solo: lo decide quien lo lleva. Un lead que ya no tiene secuencia vuelve
      if (secuencia !== null && !SECUENCIA_SIN_RESPUESTA.includes(secuencia.estado)) return null
      // Tope de vueltas (el CHECK de la 264): la 21 no se podría guardar y pararía el proceso entero
      if (lead.ciclo_vuelta >= MAX_DE_VUELTAS) return null
      // Llegó su día: vuelve a «Sin contactar» y a empezar. La fecha se queda: es la de la llamada de hoy
      return { campos: { ciclo_fase: null, ciclo_vuelta: lead.ciclo_vuelta + 1 }, motivo: 'otra_vuelta' }

    default:
      return null
  }
}
