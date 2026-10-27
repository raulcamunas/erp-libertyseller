/**
 * UN MENSAJE DE LA API DE GMAIL, LEÍDO COMO EL CORREO DE GEMINI QUE ES.
 * =====================================================================
 * `users.messages.get?format=full` devuelve un árbol de partes MIME (multipart/alternative -> text/plain + text/html, a veces anidado en multipart/related o mixed) con los
 * cuerpos en base64url, más las cabeceras en una lista. Esto lo aplana a lo que lee correo.ts: asunto, remitente, hora de llegada, texto y HTML.
 *
 * Es puro: no toca la red. La petición a Gmail vive en google.ts.
 */

import type { CorreoDeGemini } from './correo'

export interface ParteDeGmail {
  mimeType?: string
  headers?: Array<{ name?: string; value?: string }>
  body?: { data?: string; size?: number; attachmentId?: string }
  parts?: ParteDeGmail[]
}

export interface MensajeDeGmail {
  id?: string
  /** Milisegundos desde 1970, como texto: cuándo llegó el mensaje a la bandeja */
  internalDate?: string
  payload?: ParteDeGmail
}

/** Gmail codifica en base64url (con «-» y «_», sin relleno) */
export function decodificarBase64Url(datos: string): string {
  return Buffer.from(datos.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

/** El valor de una cabecera, sin mirar mayúsculas; '' si no está */
export function cabecera(parte: ParteDeGmail | undefined, nombre: string): string {
  const n = nombre.toLowerCase()
  return parte?.headers?.find((h) => h.name?.toLowerCase() === n)?.value ?? ''
}

/**
 * Las cabeceras con tildes pueden venir como «palabras codificadas» (RFC 2047): `=?UTF-8?B?...?=` (base64) o `=?UTF-8?Q?...?=` (quoted-printable). La API de Gmail suele
 * entregarlas ya decodificadas, pero un asunto con «·» y «ó» es justo el caso en que no conviene fiarse.
 */
export function decodificarCabecera(valor: string): string {
  if (!valor.includes('=?')) return valor
  // Las palabras codificadas contiguas se unen sin el espacio que las separa
  const sinEspacios = valor.replace(/(\?=)\s+(?==\?)/g, '$1')
  return sinEspacios.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_todo, charset: string, codificacion: string, texto: string) => {
    try {
      const c = /^utf-?8$/i.test(charset) ? 'utf8' : /^(iso-8859-1|latin1|us-ascii)$/i.test(charset) ? 'latin1' : 'utf8'
      if (codificacion.toLowerCase() === 'b') return Buffer.from(texto, 'base64').toString(c)
      const bytes = texto.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
      return Buffer.from(bytes, 'latin1').toString(c)
    } catch {
      return _todo
    }
  })
}

/** El texto plano y el HTML de un mensaje, buscando en todas las partes (anidadas o no). Lo que no se encuentra queda en '' */
export function cuerpoDeGmail(payload: ParteDeGmail | undefined): { texto: string; html: string } {
  const texto: string[] = []
  const html: string[] = []
  const recorrer = (parte: ParteDeGmail | undefined) => {
    if (!parte) return
    const tipo = (parte.mimeType ?? '').toLowerCase()
    const datos = parte.body?.data
    // Un adjunto (attachmentId) no lleva el cuerpo aquí, y un mensaje de un solo trozo lleva el suyo directamente en el payload
    if (datos && tipo === 'text/plain') texto.push(decodificarBase64Url(datos))
    else if (datos && tipo === 'text/html') html.push(decodificarBase64Url(datos))
    for (const hija of parte.parts ?? []) recorrer(hija)
  }
  recorrer(payload)
  return { texto: texto.join('\n').trim(), html: html.join('\n').trim() }
}

/** Un mensaje de la API -> el correo que lee correo.ts. null si no trae contenido (sin payload) */
export function correoDeGmail(mensaje: MensajeDeGmail): CorreoDeGemini | null {
  if (!mensaje.id || !mensaje.payload) return null
  const { texto, html } = cuerpoDeGmail(mensaje.payload)
  const recibido = Number(mensaje.internalDate)
  return {
    id: mensaje.id,
    asunto: decodificarCabecera(cabecera(mensaje.payload, 'Subject')).replace(/\s+/g, ' ').trim(),
    remitente: decodificarCabecera(cabecera(mensaje.payload, 'From')),
    recibidoMs: Number.isFinite(recibido) && recibido > 0 ? recibido : NaN,
    texto,
    html,
  }
}
