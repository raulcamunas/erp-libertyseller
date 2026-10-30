import { diaCorto, esDia, sumarDias } from '@/lib/correo/secuencias/fechas'
import { proximoDiaHabil } from '@/lib/festivos/festivos'
import { lugarDelLead, type LeadConLugar } from '@/lib/festivos/lead'
import type { Lugar } from '@/lib/festivos/tipos'
import { COLD_STATUS_LABELS, type ColdLeadStatus } from '@/lib/types/cold-leads'
import { DIAS_HASTA_LA_SEGUNDA_VUELTA } from './ciclo-avance'
import { ESTADOS_DE_RITMO, enCiclo, type EstadoSoloDelCiclo, type FaseDelCiclo } from './ciclo'

/**
 * LAS FASES DEL CICLO LAS PULSA LA PERSONA: LA REGLA DE CADA PULSACIÓN.
 * ======================================================================
 * PURO. Se comprueba con ciclo-manual.prueba.ts. Lo usan la ficha y la tabla de Cold Calling; aquí no se toca ninguna base de datos.
 *
 * A partir del 30 oct 2026 el ciclo se trabaja a mano, sin correos automáticos (ya no hay secuencia que marque el ritmo):
 *   1. El comercial llama. Si no contestan, manda el correo y el WhatsApp a mano.
 *   2. Pulsa «Fase 2»: el lead queda en Fase 2 y su rellamada es DENTRO DE 2 DÍAS LABORABLES (contados desde el día en que se pulsa).
 *   3. Ese día el lead sale con «hoy» en Fase 2: llama, vuelve a mandar correo y WhatsApp y pulsa «Fase 3» (+3 días laborables desde que se pulsa: 5 desde la primera llamada).
 *   4. Ese día, en Fase 3, hace lo mismo y, si no contestan, pulsa «No responde» (rellamada a los 60 días, como siempre).
 * Si un día no da tiempo, el lead se queda donde está y sale como «atrasada N d», más arriba cuanto más atrasada (lib/cold-calling/cartera.ts, `ordenDeLaVista`). La jornada es limpiar Fase 2 y Fase 3
 * y después pasar a leads nuevos.
 *
 * LABORABLE = de lunes a viernes y no festivo en el sitio del lead (lib/festivos/). Un lead sin ubicar solo salta los fines de semana: no se inventa. Pulsar en fin de semana cuenta desde el
 * siguiente día laborable, como si se hubiera pulsado el viernes por la noche.
 *
 * LO QUE NO TOCA: el estado del lead, salvo que estuviera fuera del ritmo (En seguimiento, Rellamada programada, Info enviada): si la persona pulsa una fase es que vuelve a trabajarlo en frío, y
 * pasa a «No contesta». Un lead CERRADO (Cita agendada, No le interesa) no se pasa de fase: ya está resuelto.
 */

/** Cuántos días laborables pasan, desde el día en que se pulsa, hasta la rellamada de cada fase */
export const DIAS_LABORABLES_DE_FASE_2 = 2
export const DIAS_LABORABLES_DE_FASE_3 = 3

/** La fase que se guarda al pulsar cada caja */
export const FASE_DE_LA_CAJA: Readonly<Record<EstadoSoloDelCiclo, FaseDelCiclo>> = { fase_2: 'f2', fase_3: 'f3', no_responde: 'sin_respuesta' }

/** Los estados con los que no se puede pulsar una fase: el lead ya está resuelto (con cita o descartado) */
export const ESTADOS_QUE_NO_ADMITEN_FASE: readonly ColdLeadStatus[] = ['cita_cualificada', 'no_interesa']

/** El día que resulta de contar `n` días laborables a partir de `desde` (sin contarlo): lunes a viernes, saltando los festivos del lugar */
export function sumarDiasLaborables(desde: string, n: number, lugar: Lugar | null | undefined): string {
  let dia = desde
  for (let i = 0; i < n; i++) dia = proximoDiaHabil(dia, lugar)
  return dia
}

/** El día en que se vuelve a llamar a un lead de «No responde»: el primer día laborable desde que se cumplen los 60 días (igual que cuando lo pone el avance automático) */
export const diaDeVueltaDeNoResponde = (hoy: string, lugar: Lugar | null | undefined): string => proximoDiaHabil(sumarDias(sumarDias(hoy, DIAS_HASTA_LA_SEGUNDA_VUELTA), -1), lugar)

/** La rellamada que queda al pulsar una caja de fase un día */
export function rellamadaAlPulsar(caja: EstadoSoloDelCiclo, hoy: string, lugar: Lugar | null | undefined): string {
  if (caja === 'fase_2') return sumarDiasLaborables(hoy, DIAS_LABORABLES_DE_FASE_2, lugar)
  if (caja === 'fase_3') return sumarDiasLaborables(hoy, DIAS_LABORABLES_DE_FASE_3, lugar)
  return diaDeVueltaDeNoResponde(hoy, lugar)
}

export interface LeadParaPulsarFase extends LeadConLugar {
  status: ColdLeadStatus
  ciclo_vuelta?: number | null
  ciclo_fase?: FaseDelCiclo | null
  /** La rellamada de antes: no cuenta para la nueva (se cuenta desde el día de hoy), pero un lead entero encaja */
  next_call_date?: string | null
}

export interface CambioAlPulsarFase {
  campos: { ciclo_fase: FaseDelCiclo; next_call_date: string; status?: ColdLeadStatus }
  /** Lo que se apunta en el historial del lead: quién lo pasó, cuándo vuelve a salir y por qué */
  nota: string
  /** El día en que vuelve a salir (el mismo que `campos.next_call_date`), para decírselo a la persona al pulsar */
  rellamada: string
}

/**
 * Por qué NO se puede pulsar una fase en este lead, o null si se puede (o si no es del ciclo: ahí las cajas de fase no existen). La ficha lo pone de título de las cajas apagadas.
 */
export function motivoQueBloqueaLaFase(lead: Pick<LeadParaPulsarFase, 'status' | 'ciclo_vuelta'>): string | null {
  if (!enCiclo(lead)) return null
  if (lead.status === 'cita_cualificada') return 'Este lead ya tiene una cita agendada: no se pasa de fase.'
  if (lead.status === 'no_interesa') return 'Este lead está marcado «No le interesa»: no se pasa de fase.'
  return null
}

/**
 * QUÉ PASA AL PULSAR «FASE 2», «FASE 3» O «NO RESPONDE» EN UN LEAD. `quien` es el nombre de la persona que pulsa. null si no se puede: el lead no es del ciclo, está cerrado o el día de hoy no es
 * un día de verdad (la pantalla todavía no sabe en qué calendario está).
 */
export function cambioAlPulsarFase(lead: LeadParaPulsarFase, caja: EstadoSoloDelCiclo, hoy: string, quien: string): CambioAlPulsarFase | null {
  if (!esDia(hoy) || !enCiclo(lead) || motivoQueBloqueaLaFase(lead) !== null) return null
  const lugar = lugarDelLead(lead)
  const rellamada = rellamadaAlPulsar(caja, hoy, lugar)
  // Si estaba fuera del ritmo (alguien había hablado con él) y se pulsa una fase, vuelve a trabajarse en frío: «No contesta», que es lo que de verdad es. Y «Sin contactar» que pasa a «No responde»,
  // también (es lo que hace el avance automático al acabar el ritmo)
  const fueraDelRitmo = !ESTADOS_DE_RITMO.includes(lead.status)
  const pasaANoContesta = fueraDelRitmo || (caja === 'no_responde' && lead.status === 'pendiente')
  const campos: CambioAlPulsarFase['campos'] = { ciclo_fase: FASE_DE_LA_CAJA[caja], next_call_date: rellamada, ...(pasaANoContesta ? { status: 'no_contesta' as const } : {}) }
  const persona = quien.trim() || 'Un comercial'
  const frase =
    caja === 'fase_2'
      ? `pasa el lead a Fase 2. Rellamada el ${diaCorto(rellamada)} (+${DIAS_LABORABLES_DE_FASE_2} días laborables).`
      : caja === 'fase_3'
        ? `pasa el lead a Fase 3. Rellamada el ${diaCorto(rellamada)} (+${DIAS_LABORABLES_DE_FASE_3} días laborables).`
        : `pasa el lead a «No responde». Se vuelve a llamar el ${diaCorto(rellamada)}, a los dos meses.`
  const vuelta = fueraDelRitmo ? ` Estaba en «${COLD_STATUS_LABELS[lead.status]}»: vuelve al ritmo como «No contesta».` : ''
  return { campos, nota: `Ciclo comercial · ${persona} ${frase}${vuelta}`, rellamada }
}
