import { mencionaFacturacion } from '@/lib/correo/ia-ejemplos'
import { PARECIDO_MAXIMO, parecido } from '@/lib/correo/secuencias/revision'

/**
 * COMPROBAR EL MENSAJE DE WHATSAPP QUE HA ESCRITO LA IA — PURO Y PEQUEÑO.
 * =======================================================================
 * Las reglas con las que se da por bueno un mensaje. Viven aparte del encargo a la IA (ia-prompt.ts, con sus textos largos) para que la ficha las pueda
 * aplicar en el navegador mientras la persona edita el mensaje, sin llevarse los prompts en el paquete. El servidor las vuelve a aplicar siempre: esto, en
 * la pantalla, solo sirve para avisar antes de abrir WhatsApp. Se comprueba con ia-revision.prueba.ts.
 */

const palabrasDe = (texto: string): number => texto.trim().split(/\s+/).filter(Boolean).length

export type ProblemaDeWhatsapp = 'dinero' | 'hueco' | 'largo' | 'corto' | 'enlace' | 'repite'

/** Un WhatsApp se lee en diez segundos: la IA apunta a 25-60 palabras y hasta 90 se deja pasar. El mando «Cuánto escribe» (ia-perfil.ts) cambia el tope: `opciones.maxPalabras` */
export const PALABRAS_MAXIMAS_DE_WHATSAPP = 90
export const PALABRAS_MINIMAS_DE_WHATSAPP = 8
/** Un mensaje más largo no cabe en el enlace de WhatsApp con comodidad (el mismo tope que los mensajes guardados, lib/whatsapp/mensajes.ts) */
export const MAX_CARACTERES_DE_WHATSAPP = 1000

const HAY_HUECO = /\{\{|\[[^\]\n]{1,60}\]|<[\p{L} ]{2,30}>/u
const HAY_ENLACE = /https?:\/\/|\bwww\.|\b[a-z0-9-]{2,}\.(?:com|es|net|org|eu|io|shop|store)\b/i

/**
 * Qué le pasa a un mensaje que no puede abrirse tal cual.
 *   · dinero: habla de facturación, ventas o una cifra de dinero (la regla que no admite excepciones)
 *   · hueco:  deja algo por rellenar entre corchetes, llaves o ángulos
 *   · largo / corto: un WhatsApp en frío tiene que leerse de un vistazo
 *   · enlace: lleva una dirección web (un enlace en un primer mensaje es lo primero que castiga WhatsApp)
 *   · repite: es casi el mismo texto que un WhatsApp que ya se le escribió a este lead (`anteriores`)
 */
export function revisarMensajeDeWhatsapp(texto: string, anteriores: readonly string[] = [], opciones: { maxPalabras?: number } = {}): ProblemaDeWhatsapp[] {
  const problemas: ProblemaDeWhatsapp[] = []
  if (mencionaFacturacion(texto)) problemas.push('dinero')
  if (HAY_HUECO.test(texto)) problemas.push('hueco')
  const palabras = palabrasDe(texto)
  if (palabras > (opciones.maxPalabras ?? PALABRAS_MAXIMAS_DE_WHATSAPP) || texto.length > MAX_CARACTERES_DE_WHATSAPP) problemas.push('largo')
  if (palabras < PALABRAS_MINIMAS_DE_WHATSAPP) problemas.push('corto')
  if (HAY_ENLACE.test(texto)) problemas.push('enlace')
  if (anteriores.some((a) => a.trim() !== '' && parecido(texto, a) >= PARECIDO_MAXIMO)) problemas.push('repite')
  return problemas
}

/** Lo que se le dice a quien edita el mensaje cuando sigue habiendo un problema: pensado para leerse en la pantalla */
export const AVISO_DE_PROBLEMA: Record<ProblemaDeWhatsapp, string> = {
  dinero: 'Habla de dinero o de facturación: quítalo antes de enviar.',
  hueco: 'Deja un hueco por rellenar: complétalo antes de abrir WhatsApp.',
  largo: 'Es largo para un WhatsApp: conviene acortarlo.',
  corto: 'Es muy corto: casi no dice nada.',
  enlace: 'Lleva un enlace o una dirección web: mejor quitarlo.',
  repite: 'Se parece mucho a un WhatsApp que ya se le escribió: cámbialo.',
}

/** Los problemas que impiden abrir WhatsApp (un hueco en un mensaje que va a un cliente es un error seguro; el resto es decisión de quien lo manda) */
export const PROBLEMAS_QUE_BLOQUEAN: ReadonlySet<ProblemaDeWhatsapp> = new Set(['hueco'])

/**
 * Limpia lo que la IA suele colar aunque se le pida que no: negritas de markdown (de WhatsApp, con un asterisco, o de las de dos), comillas alrededor de todo
 * el mensaje y una despedida de correo («Un saludo,») en la última línea. Lo demás se deja como lo escribió.
 */
export function limpiarMensajeDeWhatsapp(crudo: string): string {
  let t = crudo
    .replace(/\r\n?/g, '\n')
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/(^|[\s(¿¡])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/gm, '$1$2')
    .replace(/(^|\s)__(.+?)__(?=\s|$)/g, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  t = t.replace(/^["«“'‘]([\s\S]*)["»”'’]$/, '$1').trim()
  t = t.replace(/\n+(?:un saludo|saludos|un abrazo|atentamente|cordialmente|gracias y un saludo)[,.! ]*$/i, '').trim()
  return t
}

/** El mensaje, tal como se manda a WhatsApp: sin espacios de más y con los saltos de línea de siempre */
export function mensajeListoParaWhatsapp(texto: string): string {
  return texto
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
