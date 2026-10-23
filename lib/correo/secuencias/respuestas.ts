import { esDeLaMismaEmpresa } from './reglas'

/**
 * ¿QUÉ HA LLEGADO AL BUZÓN QUE TENGA QUE VER CON UNA SECUENCIA?
 * =============================================================
 * PURO: no toca la base ni la red. Se comprueba con respuestas.prueba.ts.
 *
 * Una secuencia se corta cuando el lead CONTESTA, y se retrasa o se corta si lo que llega es una máquina. De cada mensaje que entró en el buzón
 * desde el primer correo se decide cuál de estas cosas es:
 *
 *   · respuesta         una persona de esa empresa (la misma dirección, o otra del mismo dominio si no es un proveedor libre como gmail) o
 *                       cualquiera que conteste dentro del mismo hilo. LA SECUENCIA SE PARA.
 *   · rebote_duro       el servidor del lead dice que esa dirección no existe o no admite correo. Se para y la dirección queda marcada como mala.
 *   · rebote_blando     un fallo pasajero (buzón lleno, servidor caído, «lo seguimos intentando»). No se para: se espera.
 *   · fuera_de_oficina  la respuesta automática de esa empresa («estoy de vacaciones»). No es una respuesta: se espera unos días.
 *   · automatico_otro / ajeno   cualquier otra cosa: se ignora.
 *
 * La marca de «automático» la pone la lectura del buzón (lib/correo/automatico.ts) mirando las cabeceras de los propios programas de envío.
 */

export interface EntranteParaControl {
  id: string
  hiloId: string | null
  deDireccion: string
  asunto: string
  /** El principio del texto (basta con unos miles de caracteres) */
  texto: string
  fecha: number
  automatico: boolean
}

export type ClaseDeEntrante = 'respuesta' | 'rebote_duro' | 'rebote_blando' | 'fuera_de_oficina' | 'automatico_otro' | 'ajeno'

export interface DatosDeLaSecuencia {
  destinatario: string
  hiloId: string | null
  primerEnvioAt: number
}

const REMITENTE_DE_REBOTES = /^(?:mailer-daemon|postmaster|mail-daemon|maildelivery|mail\.delivery|bounces?|no-?reply-?bounce)(?:[._+-]|\d|$)/i
const ASUNTO_DE_REBOTE = /undeliver|delivery status|delivery failure|returned mail|failure notice|mail delivery (?:failed|subsystem)|no se (?:ha )?pod(?:ido|ia) entregar|mensaje no entregado|error de entrega|devuelto|rechazado/i
const ASUNTO_DE_RETRASO = /\bdelay(?:ed)?\b|retras|aplaz|still trying|will (?:continue to )?retry|seguiremos intentando|lo seguimos intentando/i
const DIRECCION_INEXISTENTE =
  /user unknown|unknown user|no such user|mailbox (?:not found|unavailable|does not exist)|recipient (?:address )?rejected|address rejected|invalid (?:recipient|address)|does not exist|doesn'?t exist|no existe|usuario desconocido|direcci[oó]n (?:no existe|inexistente)|account (?:is )?(?:disabled|inactive)|domain (?:not found|does not exist)|host or domain name not found|nxdomain/i
const ESTADO_5 = /\b5\.\d{1,3}\.\d{1,3}\b/
const ESTADO_4 = /\b4\.\d{1,3}\.\d{1,3}\b/
const FALLO_PASAJERO = /mailbox full|over quota|quota exceeded|buz[oó]n lleno|temporar|try again|intente(?:lo)? m[aá]s tarde|greylist|too many (?:connections|messages)/i

export function clasificarEntrante(m: EntranteParaControl, s: DatosDeLaSecuencia): ClaseDeEntrante {
  if (m.fecha < s.primerEnvioAt) return 'ajeno'
  const de = m.deDireccion.trim().toLowerCase()
  const destino = s.destinatario.trim().toLowerCase()

  if (m.automatico) {
    const local = de.split('@')[0] ?? ''
    const esDeRebotes = REMITENTE_DE_REBOTES.test(local) || ASUNTO_DE_REBOTE.test(m.asunto)
    if (esDeRebotes) {
      // Solo si habla de ESTE destinatario (o cuelga del hilo de este correo): la bandeja de un comercial recibe rebotes de todos sus correos
      const habla = `${m.asunto}\n${m.texto}`.toLowerCase().includes(destino) || (s.hiloId !== null && m.hiloId === s.hiloId)
      if (!habla) return 'automatico_otro'
      if (ASUNTO_DE_RETRASO.test(m.asunto)) return 'rebote_blando'
      if (ESTADO_5.test(m.texto) || DIRECCION_INEXISTENTE.test(m.texto)) return FALLO_PASAJERO.test(m.texto) && !DIRECCION_INEXISTENTE.test(m.texto) ? 'rebote_blando' : 'rebote_duro'
      if (ESTADO_4.test(m.texto) || FALLO_PASAJERO.test(m.texto)) return 'rebote_blando'
      // Un rebote sin código ni explicación: se da por duro (un aviso de «no entregado» casi siempre lo es)
      return 'rebote_duro'
    }
    return esDeLaMismaEmpresa(de, destino) ? 'fuera_de_oficina' : 'automatico_otro'
  }

  if (esDeLaMismaEmpresa(de, destino)) return 'respuesta'
  if (s.hiloId !== null && m.hiloId === s.hiloId) return 'respuesta'
  return 'ajeno'
}

/** De todo lo que ha entrado, lo más importante primero: una respuesta manda sobre un rebote, y un rebote sobre un fuera de oficina */
export function lecturaDelBuzon(entrantes: readonly EntranteParaControl[], s: DatosDeLaSecuencia): { clase: ClaseDeEntrante; mensaje: EntranteParaControl } | null {
  const orden: ClaseDeEntrante[] = ['respuesta', 'rebote_duro', 'rebote_blando', 'fuera_de_oficina']
  const clasificados = entrantes.map((m) => ({ clase: clasificarEntrante(m, s), mensaje: m }))
  for (const clase of orden) {
    const hallados = clasificados.filter((c) => c.clase === clase).sort((a, b) => a.mensaje.fecha - b.mensaje.fecha)
    if (hallados.length > 0) return hallados[0]
  }
  return null
}
