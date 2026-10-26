import { diaCorto, diaDeMadrid } from '@/lib/correo/secuencias/fechas'
import { esRechazo } from '@/lib/correo/ia-ejemplos'
import { COLD_STATUS_LABELS, type ColdLeadStatus } from '@/lib/types/cold-leads'
import { diaConAnio, fraseEstaEnElTexto, normalizar } from '@/lib/rellamada/reglas'
import type { LeadParaRellamada } from './rellamada'
import type { ResumenGenerado } from './tipos'

/**
 * «NO ME INTERESA»: QUÉ SE HACE EN LA FICHA DEL LEAD CUANDO UN CLIENTE LO DICE EN UNA LLAMADA.
 * ============================================================================================
 * PURO: no toca la base ni la red. Se comprueba con rechazo.prueba.ts. La IA que resume la llamada (resumen.ts) dice si el cliente rechazó CLARAMENTE y con qué
 * palabras; aquí se decide si eso pasa de verdad el lead a «No le interesa». Es lo mismo que ya hacen los correos con un «no» claro, con las mismas cautelas,
 * porque cerrar un lead lo saca de las rellamadas y de los seguimientos:
 *
 *   · La IA tiene que decir las DOS cosas: interés «ninguno» y las palabras del cliente. Y esas palabras tienen que estar en la transcripción y decir que no
 *     («no nos interesa», «no necesitamos nada»…): una frase inventada, o un «perfecto, gracias», no cierra nada.
 *   · Si el cliente pidió que se le vuelva a llamar un día, NO es un rechazo: manda la rellamada.
 *   · Solo se cierra un lead que NADIE está llevando: «Sin contactar», «No contesta», «Info enviada» y «Rellamada programada» cuando su día ya llegó o no tiene.
 *     Uno «En seguimiento» o con cita es de quien lo lleva; uno con una rellamada puesta para más adelante, también (quien lo programó pensó en esta llamada);
 *     y el de otra persona que quien llamó, tampoco: se deja una nota para que lo mire una persona.
 *   · CERRAR NO BORRA NADA: el día de «Rellamar el» se queda guardado (la agenda lo ignora mientras el lead esté en «No le interesa» y vuelve si se reabre) y la
 *     nota de la ficha dice qué palabras lo motivaron y cómo deshacerlo.
 *
 * Lo que no se puede comprobar (la IA dice «sin interés» pero sus palabras no están o no dicen que no) deja una nota en vez de callar: es justo el caso en que una
 * persona ve «Sin interés» en el resumen y espera que el lead haya pasado a «No le interesa».
 */

export interface EntradaDeRechazo {
  /** Lo que entendió la IA: el tipo, el interés, lo que pidió y, si lo hubo, el rechazo */
  resumen: Pick<ResumenGenerado, 'tipo' | 'interes' | 'rellamada' | 'rechazo'>
  /** La transcripción entera de la llamada */
  transcripcion: string
  /** Cuándo fue la llamada (ISO) */
  fechaDeLaLlamada: string
  /** Hoy en Madrid (AAAA-MM-DD) */
  hoy: string
  /** null = el lead ya no existe */
  lead: LeadParaRellamada | null
  /** Quien hizo o recibió la llamada */
  comercialId: string
}

export type MotivoDeNoCerrar =
  | 'sin_rechazo'
  | 'pidio_rellamada'
  | 'sin_lead'
  | 'ya_cerrado'
  | 'frase_no_esta'
  | 'frase_no_rechaza'
  | 'otra_persona'
  | 'estado'
  | 'tiene_rellamada'

export type DecisionDeRechazo =
  | { cerrar: true; nota: string }
  | { cerrar: false; motivo: MotivoDeNoCerrar; nota: string | null }

const etiquetaDeEstado = (estado: string): string => COLD_STATUS_LABELS[estado as ColdLeadStatus] ?? estado

const no = (motivo: MotivoDeNoCerrar, nota: string | null = null): DecisionDeRechazo => ({ cerrar: false, motivo, nota })

/** Una negación en las palabras del cliente: «no», «ni», «nunca», «jamás», «tampoco». Sin una, «perfecto, gracias» o «vale, vale» no pueden cerrar un lead */
const NEGACION = /(^| )(no|ni|nunca|jamas|tampoco)( |$)/

/** ¿Dicen esas palabras que no? Las frases de rechazo de siempre (las de los correos) o, al menos, una negación */
export function fraseRechaza(frase: string): boolean {
  return esRechazo(frase) || NEGACION.test(normalizar(frase))
}

export function decidirCierreDeLlamada(e: EntradaDeRechazo): DecisionDeRechazo {
  const { resumen } = e
  // 1. Lo que dijo la IA: una conversación, sin interés y con un «no» con palabras
  if (resumen.tipo !== 'conversacion' || resumen.interes !== 'ninguno') return no('sin_rechazo')
  // Pidió que se le vuelva a llamar: manda la rellamada («ahora no, llámame en enero» no es un adiós)
  if (resumen.rellamada) return no('pidio_rellamada')

  const llamada = Date.parse(e.fechaDeLaLlamada)
  const cuandoFue = Number.isFinite(llamada) ? diaCorto(diaDeMadrid(llamada)) : 'esa llamada'
  if (!e.lead) return no('sin_lead')
  const lead = e.lead
  if (lead.status === 'no_interesa') return no('ya_cerrado')

  // 2. Sus palabras: están en la llamada y dicen que no
  const frase = resumen.rechazo?.frase.trim() ?? ''
  if (frase === '' || !fraseEstaEnElTexto(frase, e.transcripcion)) {
    return no('frase_no_esta', `La IA entendió que en la llamada del ${cuandoFue} al cliente no le interesa, pero no se ha podido comprobar con sus palabras: no se ha cambiado el estado. Mira la transcripción y decide tú.`)
  }
  if (!fraseRechaza(frase)) {
    return no('frase_no_rechaza', `La IA entendió que en la llamada del ${cuandoFue} al cliente no le interesa («${frase.slice(0, 160)}»), pero esas palabras no dicen que no con claridad: no se ha cambiado el estado. Mira la transcripción y decide tú.`)
  }

  const dicho = `«${frase.slice(0, 160)}»`

  // 3. Qué lead es: si lo lleva una persona, o es de otra, no se pisa
  if (lead.assignedTo !== null && lead.assignedTo !== e.comercialId) {
    return no('otra_persona', `En la llamada del ${cuandoFue} el cliente dijo que no le interesa (${dicho}), pero el lead es de otra persona: no se ha tocado. Revísalo.`)
  }
  if (lead.status === 'seguimiento' || lead.status === 'cita_cualificada') {
    return no('estado', `En la llamada del ${cuandoFue} el cliente dijo que no le interesa (${dicho}), pero el lead está en «${etiquetaDeEstado(lead.status)}»: no se ha cambiado. Revísalo.`)
  }
  // «Rellamada programada» con el día por llegar: quien la puso la pensó para después de esta llamada
  if (lead.status === 'programado' && lead.nextCallDate !== null && lead.nextCallDate > e.hoy) {
    return no('tiene_rellamada', `En la llamada del ${cuandoFue} el cliente dijo que no le interesa (${dicho}), pero el lead tiene una rellamada puesta para el ${diaConAnio(lead.nextCallDate, e.hoy)}: no se ha cambiado. Revísalo.`)
  }

  // Un día de rellamada suelto (el lead sigue en «Sin contactar», «No contesta»…): se queda guardado, pero ya no cuenta mientras el lead esté cerrado
  const dia = lead.nextCallDate !== null && lead.nextCallDate > e.hoy ? ` Tenía puesto el día ${diaConAnio(lead.nextCallDate, e.hoy)} para rellamar: sigue guardado y vuelve a salir si lo reabres.` : ''
  return {
    cerrar: true,
    nota: `En la llamada del ${cuandoFue} el cliente dijo que no le interesa (${dicho}). Se ha pasado a «No le interesa» automáticamente, a partir de la transcripción: si no es así, cámbialo.${dia}`,
  }
}
