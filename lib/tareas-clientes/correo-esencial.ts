/**
 * LO IMPORTANTE DE UN CORREO DE UN CASO — PURO. En la pestaña «Cumplimiento» no se enseña el correo tal cual (el diseño de Amazon, la cabecera del reenvío, la encuesta, la firma y
 * el pie legal), sino solo lo que dice: los párrafos del mensaje, con las líneas cortadas a 76 caracteres vueltas a unir. Se comprueba en correo-esencial.prueba.ts.
 *
 *   · Quita la cabecera de un reenvío («---------- Forwarded message ---------», De/Date/Subject/To) y se queda con quién lo mandó de verdad (Amazon, no quien lo reenvió)
 *   · Quita lo citado (líneas con «>») y corta en lo que ya no es el mensaje: la encuesta («To help us…», «Were you satisfied…»), la despedida («Atentamente», «Best regards»…),
 *     el pie («Copyright…») y la respuesta anterior («El … escribió:», «On … wrote:»)
 *   · Quita los enlaces sueltos (<https://…>) y une las líneas de cada párrafo (las listas con guion o número se dejan en su línea)
 * Sin IA: es instantáneo, gratis y siempre dice lo mismo. Si lo limpiado se queda vacío, devuelve el texto entero (mejor de más que nada).
 */

import { htmlATextoBasico } from '@/lib/correo/html'

export interface CorreoEsencial {
  /** Los párrafos de lo que dice el correo */
  parrafos: string[]
  /** Quién lo mandó de verdad, si era un reenvío («Asistencia al Vendedor de Amazon <merch.service05@amazon.es>») */
  remitenteOriginal: string | null
}

const REENVIO = /^\s*-{2,}\s*(forwarded message|mensaje reenviado|original message|mensaje original|message transféré|messaggio inoltrato)\s*-{2,}\s*$/i
const CABECERA = /^\s*(de|from|date|fecha|enviado|sent|subject|asunto|to|para|cc|cco|bcc)\s*:/i
const REMITENTE = /^\s*(de|from)\s*:\s*(.+)$/i

/** Donde se acaba el mensaje: la encuesta, la despedida, el pie o la respuesta anterior */
const FIN = [
  /^to help us (continually )?improve/i,
  /^were you satisfied/i,
  /^was this (email|response|answer) helpful/i,
  /^¿(le|te) (ha )?(resultado|sido|resultó|fue) útil/i,
  /^¿(está|estás|quedó) satisfech/i,
  /^(atentamente|saludos cordiales|un saludo|cordialmente|reciba un cordial saludo|best regards|kind regards|warm regards|regards|sincerely|thank you,?$|thanks,?$|gracias,?$|muchas gracias,?$)\b/i,
  /^copyright\b/i,
  /^(el|on) .{6,160} (escribió|wrote):\s*$/i,
  /^-- ?$/,
  /^_{5,}$/,
]

const ENLACE_SUELTO = /^\s*<?https?:\/\/\S+>?[,.]?\s*$/i
const LISTA = /^\s*([-•*·–]\s|\d{1,2}[.)]\s)/

/** Del texto plano o, si el correo no lo trae, del HTML */
export function textoDelCorreo(texto: string | null | undefined, html: string | null | undefined): string {
  const t = (texto ?? '').trim()
  if (t) return t
  return html ? htmlATextoBasico(html) : ''
}

export function correoEsencial(texto: string | null | undefined, html?: string | null): CorreoEsencial {
  const bruto = textoDelCorreo(texto, html).replace(/\r\n?/g, '\n')
  const lineas = bruto.split('\n')
  const salida: string[] = []
  let remitenteOriginal: string | null = null

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]
    const t = linea.trim()

    // La cabecera de un reenvío: hasta la primera línea en blanco (el asunto puede venir partido en dos líneas)
    if (REENVIO.test(t)) {
      let j = i + 1
      while (j < lineas.length && lineas[j].trim() !== '') {
        const r = REMITENTE.exec(lineas[j])
        if (r && !remitenteOriginal) remitenteOriginal = r[2].trim()
        j++
      }
      // Lo que se escribió encima del reenvío se queda; lo de debajo es el mensaje reenviado
      i = j
      continue
    }
    // Una cabecera de respuesta suelta (Outlook: «De: … Enviado: … Para: … Asunto: …») tras el mensaje: lo de debajo ya es otro correo
    if (CABECERA.test(t) && salida.some((l) => l.trim()) && /^\s*(de|from)\s*:/i.test(t) && lineas.slice(i + 1, i + 5).some((l) => /^\s*(enviado|sent|date|fecha)\s*:/i.test(l))) break
    if (t.startsWith('>')) continue
    if (FIN.some((r) => r.test(t)) && salida.some((l) => l.trim())) break
    if (ENLACE_SUELTO.test(t)) continue
    salida.push(linea.replace(/<https?:\/\/[^>\s]+>/gi, '').replace(/[ \t]+$/g, ''))
  }

  const parrafos = aParrafos(salida)
  if (parrafos.length > 0) return { parrafos, remitenteOriginal }
  const entero = aParrafos(bruto.split('\n'))
  return { parrafos: entero, remitenteOriginal }
}

/** Une las líneas de cada párrafo (separados por una línea en blanco); las de una lista se quedan cada una en la suya */
function aParrafos(lineas: readonly string[]): string[] {
  const parrafos: string[] = []
  let actual: string[] = []
  const cerrar = () => {
    const p = actual.join('\n').replace(/[ \t]+/g, ' ').trim()
    if (p) parrafos.push(p)
    actual = []
  }
  for (const l of lineas) {
    const t = l.trim()
    if (!t) {
      cerrar()
      continue
    }
    // Una línea de lista empieza la suya; las demás siguen la anterior (también la continuación de un punto de la lista)
    if (actual.length === 0 || LISTA.test(t)) actual.push(t)
    else actual[actual.length - 1] += ` ${t}`
  }
  cerrar()
  return parrafos
}

/** El asunto sin los «Fwd:», «RE:», «RV:» del principio */
export function asuntoLimpio(asunto: string | null | undefined): string {
  let a = (asunto ?? '').trim()
  for (let k = 0; k < 6; k++) {
    const sin = a.replace(/^(fwd?|rv|re|res|aw|wg|tr)\s*:\s*/i, '')
    if (sin === a) break
    a = sin
  }
  return a
}

/** El nombre de «Nombre <dirección>» (o la dirección, si no hay nombre) */
export function nombreDelRemitente(de: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(de)
  if (!m) return de.trim()
  return m[1].trim() || m[2].trim()
}
