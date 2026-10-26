import { diaCorto, diaDeMadrid, diaHabilDesde, diasEntre, esDia } from '@/lib/correo/secuencias/fechas'
import { COLD_STATUS_LABELS, type ColdLeadStatus } from '@/lib/types/cold-leads'
import { ESTADOS_QUE_SE_PUEDEN_TOCAR, MAX_DIAS_DE_RELLAMADA, diaConAnio, fechaCuadraConLaFrase, fraseDiceCuando, fraseEstaEnElTexto } from '@/lib/rellamada/reglas'
import type { PeticionDeRellamada } from './tipos'

/**
 * «LLÁMAME EL JUEVES»: QUÉ SE HACE EN LA FICHA DEL LEAD CUANDO UN CLIENTE LO PIDE EN UNA LLAMADA.
 * ================================================================================================
 * PURO: no toca la base ni la red. Se comprueba con rellamada.prueba.ts. La IA que resume la llamada (resumen.ts) dice qué día pidió el cliente y con
 * qué palabras; aquí se decide si eso se pone de verdad como la rellamada del lead. La fecha que da la IA NO se da por buena sin más:
 *
 *   · Sus palabras tienen que estar en la transcripción (una frase inventada no programa nada) y tienen que decir cuándo («perfecto, gracias» no apoya una fecha).
 *   · El día no puede ser anterior a la llamada ni estar a más de 400 días, y si el cliente nombró un día de la semana, la fecha tiene que caer en él.
 *   · Se pasa a un día hábil (lunes a viernes sin festivos) y, si cuando se procesa la llamada ese día ya pasó, a hoy.
 *
 * Y no se pisa a nadie: un lead de otra persona, uno con cita o ya descartado, o uno que ya tiene OTRA rellamada puesta para más adelante (la habrá puesto el
 * comercial al colgar) no se tocan; se deja una nota para que los mire una persona. Un lead «En seguimiento» solo recibe la fecha: su estado es de quien lo lleva.
 *
 * Lo que no se puede comprobar (la frase no está, la fecha no vale) no deja ni nota: la ficha ya tiene el resumen y el siguiente paso de la llamada.
 */

export interface LeadParaRellamada {
  status: string
  /** El comercial al que está asignado, si lo hay */
  assignedTo: string | null
  /** El día de «Rellamar el», si lo tiene (AAAA-MM-DD) */
  nextCallDate: string | null
}

export interface EntradaDeRellamada {
  peticion: PeticionDeRellamada
  /** La transcripción entera de la llamada */
  transcripcion: string
  /** Cuándo fue la llamada (ISO) */
  fechaDeLaLlamada: string
  /** Hoy en Madrid (AAAA-MM-DD) */
  hoy: string
  festivos: readonly string[]
  /** null = el lead ya no existe */
  lead: LeadParaRellamada | null
  /** Quien hizo o recibió la llamada */
  comercialId: string
}

export type MotivoDeNoPoner = 'frase_no_esta' | 'frase_sin_fecha' | 'fecha_no_valida' | 'dia_no_cuadra' | 'sin_lead' | 'otra_persona' | 'estado' | 'ya_tiene' | 'ya_estaba'

export type DecisionDeRellamada =
  | { poner: true; fecha: string; soloFecha: boolean; nota: string }
  | { poner: false; motivo: MotivoDeNoPoner; nota: string | null }

const etiquetaDeEstado = (estado: string): string => COLD_STATUS_LABELS[estado as ColdLeadStatus] ?? estado

const no = (motivo: MotivoDeNoPoner, nota: string | null = null): DecisionDeRellamada => ({ poner: false, motivo, nota })

/** «el cliente dijo «llámame el jueves» (a las 10:00)» */
function loQueDijo(p: PeticionDeRellamada): string {
  return `«${p.frase.slice(0, 160)}»${p.hora ? ` (a las ${p.hora})` : ''}`
}

export function decidirRellamadaDeLlamada(e: EntradaDeRellamada): DecisionDeRellamada {
  const { peticion: p } = e
  const llamada = Date.parse(e.fechaDeLaLlamada)
  if (!Number.isFinite(llamada)) return no('fecha_no_valida')
  const diaDeLaLlamada = diaDeMadrid(llamada)

  // 1. Sus palabras están en la llamada
  if (!fraseEstaEnElTexto(p.frase, e.transcripcion)) return no('frase_no_esta')
  if (!fraseDiceCuando(p.frase)) return no('frase_sin_fecha')

  // 2. El día vale
  if (!esDia(p.fecha) || p.fecha < diaDeLaLlamada || diasEntre(diaDeLaLlamada, p.fecha) > MAX_DIAS_DE_RELLAMADA) return no('fecha_no_valida')

  if (!e.lead) return no('sin_lead')
  const lead = e.lead
  const dicho = loQueDijo(p)
  const cuandoFue = diaCorto(diaDeLaLlamada)

  // 3. Si nombró un día de la semana, la fecha cae en él. Si no, la IA se ha equivocado de día: se avisa en vez de programar a ciegas
  if (!fechaCuadraConLaFrase(p.fecha, p.frase)) {
    return no('dia_no_cuadra', `En la llamada del ${cuandoFue} parece que pidió que le llamen, pero no se ha podido fijar el día (${dicho}). No se ha puesto ninguna rellamada: mira la transcripción y ponla tú.`)
  }

  // 4. Un día hábil, y nunca uno que ya pasó
  const fecha = diaHabilDesde(p.fecha < e.hoy ? e.hoy : p.fecha, e.festivos)
  const cuando = diaConAnio(fecha, e.hoy)

  // 5. Qué lead es
  if (lead.assignedTo !== null && lead.assignedTo !== e.comercialId) {
    return no('otra_persona', `En una llamada del ${cuandoFue} el cliente pidió que le llamen el ${cuando} (${dicho}), pero el lead es de otra persona: no se ha tocado.`)
  }
  if (lead.status === 'no_interesa' || lead.status === 'cita_cualificada') {
    return no('estado', `En la llamada del ${cuandoFue} el cliente pidió que le llamen el ${cuando} (${dicho}), pero el lead está en «${etiquetaDeEstado(lead.status)}»: no se ha cambiado.`)
  }
  if (lead.nextCallDate !== null && lead.nextCallDate === fecha && lead.status === 'programado') return no('ya_estaba')
  if (lead.nextCallDate !== null && lead.nextCallDate > e.hoy && lead.nextCallDate !== fecha) {
    return no('ya_tiene', `En la llamada del ${cuandoFue} el cliente pidió que le llamen el ${cuando} (${dicho}), pero el lead ya tenía una rellamada para el ${diaConAnio(lead.nextCallDate, e.hoy)}: no se ha cambiado.`)
  }

  // Si ya lo lleva una persona («En seguimiento») solo se pone la fecha: el estado es suyo
  const soloFecha = !ESTADOS_QUE_SE_PUEDEN_TOCAR.includes(lead.status)
  return {
    poner: true,
    fecha,
    soloFecha,
    nota: `Rellamada puesta para el ${cuando}${soloFecha ? `; el lead sigue en «${etiquetaDeEstado(lead.status)}», solo se ha puesto la fecha` : ''}. En la llamada del ${cuandoFue} el cliente dijo ${dicho}. La ha puesto el ERP solo, a partir de la transcripción: si no es así, cámbiala.`,
  }
}
