/**
 * EL APUNTE QUE QUEDA EN EL HISTORIAL DE UN LEAD CUANDO SE LE ENVÍA UN CORREO.
 * PURO. Se comprueba con apunte.prueba.ts.
 *
 * Antes quedaba solo el asunto («Correo enviado: «Hola»»). Ahora queda el correo entero: a quién, con qué asunto y qué se dijo, como
 * cuando el comercial lo pegaba a mano en una nota. Así quien abre el lead mañana (o la supervisora) ve qué se le escribió sin ir a Correo,
 * y la IA, al redactar un seguimiento, parte de lo que ya se le dijo (lib/correo/ia-contexto.ts lee estos apuntes).
 *
 * La firma NO va: la pone el buzón en cada correo y repetirla en cada apunte es ruido. Quien llama se la quita antes (textoSinFirma).
 */

/** Más largo que esto se corta con «…». Un correo de venta ocupa unos 1.000 caracteres: es un tope contra un pegado enorme, no contra un correo normal */
export const MAX_APUNTE = 8000

export function cuerpoDelApunte(datos: { para?: string | null; asunto: string; texto?: string | null }): string {
  const para = (datos.para ?? '').replace(/\s+/g, ' ').trim()
  const asunto = datos.asunto.replace(/\s+/g, ' ').trim() || 'sin asunto'
  const texto = (datos.texto ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const cabecera = `Correo enviado${para ? ` a ${para}` : ''}\nAsunto: ${asunto}`
  const entero = texto ? `${cabecera}\n\n${texto}` : cabecera
  return entero.length > MAX_APUNTE ? `${entero.slice(0, MAX_APUNTE - 1).trimEnd()}…` : entero
}
