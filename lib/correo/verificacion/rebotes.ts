import { analizarDireccion } from './direccion'

/**
 * LEER UN AVISO DE REBOTE: ¿QUÉ DIRECCIÓN FALLÓ Y POR QUÉ? — PURO. Se comprueba con rebotes.prueba.ts.
 * ======================================================================================================
 * Un servidor de correo que no puede entregar un mensaje contesta con un aviso («Delivery Status Notification», «Undelivered Mail Returned to
 * Sender»…) escrito por una máquina, en el idioma que le dé la gana y con un formato que cambia de un proveedor a otro. Esto saca de él dos cosas:
 *
 *   · POR QUÉ: no todos los rebotes son «esa dirección no existe». Un código 5.1.x o frases como «user unknown» sí lo son: la dirección es mala y
 *     conviene no volver a escribirle nunca. Un 5.7.x («rejected as spam», «blocked») es el servidor del lead diciendo que NO NOS QUIERE A NOSOTROS:
 *     la dirección puede estar perfectamente, y marcarla como mala sería un error; lo que hay que mirar es la reputación del buzón (eso lo vigila el
 *     freno). Un 5.2.x («mailbox full») es temporal en la práctica.
 *   · A QUIÉN: la dirección que falló. Los avisos serios la traen en `Final-Recipient: rfc822; dirección`; los demás la nombran en el texto. Si no hay
 *     una sola dirección clara, no se adivina: ninguna es mejor que equivocarse y marcar la de otra persona.
 */

/** «No existe» de verdad: el servidor del destinatario dice que ese buzón o ese dominio no está */
const INEXISTENTE_POR_CODIGO = /\b5\.1\.(?:0|1|2|3|6|10)\b/
const INEXISTENTE_POR_FRASE =
  /user unknown|unknown user|no such user|no such recipient|mailbox (?:not found|unavailable|does not exist|doesn'?t exist)|recipient (?:address )?rejected|address rejected|invalid (?:recipient|address)|(?:address|user|account|mailbox) (?:couldn'?t|could not|cannot|can'?t) be found|does not exist|doesn'?t exist|no existe|usuario desconocido|direcci[oó]n (?:no existe|inexistente)|domain (?:not found|does not exist)|host or domain name not found|nxdomain|recipientnotfound|recipnotfound/i
/** El servidor nos rechaza a NOSOTROS (política, spam, reputación): la dirección del destinatario no tiene nada de malo */
const RECHAZO_DE_POLITICA = /\b5\.7\.\d{1,3}\b|rejected as spam|blocked|blacklist|blocklist|spamhaus|sender rejected|policy|reputation|not authorized|authentication required|denied/i
/** Un problema pasajero del buzón del destinatario */
const PROBLEMA_PASAJERO = /\b(?:5\.2\.[12]|4\.\d{1,3}\.\d{1,3})\b|mailbox full|over quota|quota exceeded|buz[oó]n lleno|try again later/i

export type MotivoDeRebote = 'inexistente' | 'rechazo_de_politica' | 'pasajero' | 'desconocido'

/** Por qué rebotó. `inexistente` es la única razón para marcar una dirección como mala */
export function motivoDeRebote(texto: string): MotivoDeRebote {
  const t = texto.slice(0, 20_000)
  if (INEXISTENTE_POR_CODIGO.test(t) || INEXISTENTE_POR_FRASE.test(t)) {
    // Un aviso que habla a la vez de «no existe» y de política suele ser un servidor que no distingue: se fía de lo más específico, el código
    if (RECHAZO_DE_POLITICA.test(t) && !INEXISTENTE_POR_CODIGO.test(t)) return 'rechazo_de_politica'
    return 'inexistente'
  }
  if (RECHAZO_DE_POLITICA.test(t)) return 'rechazo_de_politica'
  if (PROBLEMA_PASAJERO.test(t)) return 'pasajero'
  return 'desconocido'
}

const NO_SON_DESTINATARIOS = new Set(['mailer-daemon', 'postmaster', 'abuse', 'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'root', 'daemon', 'bounce', 'bounces'])
const DIRECCION = /[a-z0-9][a-z0-9._%+'-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}/gi

/**
 * La dirección (o direcciones) a las que no se pudo entregar. `dominiosPropios` son los dominios de los buzones del ERP: sus direcciones salen en el
 * aviso (como remitente del mensaje original) y no son las que fallaron.
 */
export function extraerDireccionesFallidas(texto: string, dominiosPropios: ReadonlySet<string>): string[] {
  const t = texto.slice(0, 20_000)
  const validas = (candidatas: Iterable<string>): string[] => {
    const salida = new Set<string>()
    for (const c of candidatas) {
      const a = analizarDireccion(c)
      if (a.direccion === '' || a.problemas.some((p) => p.gravedad === 'mala' && p.codigo !== 'no_responde' && p.codigo !== 'desechable' && p.codigo !== 'dominio_de_ejemplo')) continue
      if (NO_SON_DESTINATARIOS.has(a.local) || dominiosPropios.has(a.dominio)) continue
      salida.add(a.direccion)
    }
    return [...salida]
  }

  // 1. Los avisos bien hechos dicen a quién no pudieron entregar
  const explicitas: string[] = []
  for (const m of t.matchAll(/(?:final-recipient|original-recipient|x-failed-recipients)\s*:\s*(?:rfc822\s*;\s*)?<?([^\s<>;,]+@[^\s<>;,]+)>?/gi)) explicitas.push(m[1])
  const buenas = validas(explicitas)
  if (buenas.length > 0) return buenas

  // 2. Si no, las direcciones del texto: solo vale si queda UNA, sin contar las nuestras ni las de los servidores
  const unica = validas(t.match(DIRECCION) ?? [])
  return unica.length === 1 ? unica : []
}
