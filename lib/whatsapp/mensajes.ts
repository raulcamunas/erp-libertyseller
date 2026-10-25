import { normalizarTelefono } from '@/lib/cold-calling/contactos'
import { camposSinRellenar, rellenarPlantilla } from '@/lib/correo/plantillas'

/**
 * LOS MENSAJES DE WHATSAPP DE LA FICHA DE UN LEAD — PURO.
 * =======================================================
 * No toca la base ni la red. Se comprueba con mensajes.prueba.ts.
 *
 * El botón «WhatsApp» de la ficha abre el chat del móvil del lead con un mensaje ya escrito, y deja apuntado en su historial que se le ha
 * escrito. Aquí vive todo lo que se decide sin pantalla:
 *
 *   · QUÉ MENSAJE: hay tres SITUACIONES (primer contacto, te he llamado y no contesta, después de hablar) y de cada una puede haber varios
 *     mensajes. La situación sale del estado del lead; entre los mensajes de esa situación se reparten los leads (por una cuenta estable sobre
 *     su identificador: el mismo lead siempre sale con el mismo, y los distintos se reparten), para no mandar siempre el mismo texto palabra
 *     por palabra, que es lo primero que castiga WhatsApp. Sin ninguno guardado, vale el que viene de serie.
 *   · A QUÉ NÚMERO: solo móviles. Un fijo español (8xx, 9xx) no tiene WhatsApp; de otro país no se puede saber y se ofrece.
 *   · EL ENLACE: WhatsApp Web (lo habitual en un ordenador) o `wa.me` (el móvil y la aplicación de escritorio).
 *   · EL APUNTE del historial, que dice «abierto con este mensaje» y no «enviado»: el ERP no puede saber si luego se le da a enviar.
 *
 * Los campos entre llaves ({{empresa}}, {{mi_nombre}}) se rellenan con las mismas reglas que las plantillas de correo (lib/correo/plantillas.ts):
 * lo que no se sabe se queda escrito con sus llaves, y un mensaje con un campo sin rellenar NO SE ABRE.
 */

export const SITUACIONES_DE_WHATSAPP = ['primer_contacto', 'no_contesta', 'tras_hablar'] as const
export type SituacionDeWhatsapp = (typeof SITUACIONES_DE_WHATSAPP)[number]

export const ETIQUETA_DE_SITUACION: Record<SituacionDeWhatsapp, string> = {
  primer_contacto: 'Primer contacto',
  no_contesta: 'Te he llamado y no contesta',
  tras_hablar: 'Después de hablar',
}

export const AYUDA_DE_SITUACION: Record<SituacionDeWhatsapp, string> = {
  primer_contacto: 'Para un lead al que todavía no se ha hablado',
  no_contesta: 'Para después de llamar sin que cojan el teléfono',
  tras_hablar: 'Para después de una llamada en la que sí se habló',
}

export const esSituacionDeWhatsapp = (v: unknown): v is SituacionDeWhatsapp => typeof v === 'string' && (SITUACIONES_DE_WHATSAPP as readonly string[]).includes(v)

/** Un mensaje más largo no cabe en el enlace de WhatsApp con comodidad (y es demasiado para un primer mensaje) */
export const MAX_DE_MENSAJE = 1000

/** Los campos que se rellenan solos en un mensaje de WhatsApp. {{nombre}} NO está: el decisor viene del registro como «APELLIDOS NOMBRE» */
export const CAMPOS_DE_WHATSAPP: ReadonlyArray<{ etiqueta: string; ayuda: string }> = [
  { etiqueta: '{{empresa}}', ayuda: 'La tienda o empresa del lead' },
  { etiqueta: '{{mi_nombre}}', ayuda: 'Tu nombre de pila' },
]

/** Un mensaje: de la base (con `id`) o el de serie de una situación (`id` null) */
export interface MensajeDeWhatsapp {
  id: string | null
  /** null = del equipo (o el de serie) */
  user_id: string | null
  situacion: SituacionDeWhatsapp
  texto: string
}

/**
 * Los mensajes de serie: lo que se ofrece mientras nadie haya guardado los suyos. Sin dinero, sin cifras y sin prometer nada (la misma regla
 * que los correos), y cortos: un WhatsApp no es un correo.
 */
export const MENSAJE_DE_SERIE: Record<SituacionDeWhatsapp, string> = {
  primer_contacto: 'Hola, soy {{mi_nombre}} de Liberty Seller. Ayudamos a tiendas como {{empresa}} a vender más en Amazon sin cargar a vuestro equipo con el trabajo. ¿Tienes un minuto para que te lo cuente?',
  no_contesta: 'Hola, soy {{mi_nombre}} de Liberty Seller. Te he llamado hace un momento por {{empresa}} y no he podido hablar contigo. Es sobre cómo vender en Amazon sin cargar a vuestro equipo. ¿Cuándo te viene bien que te llame?',
  tras_hablar: 'Hola, soy {{mi_nombre}} de Liberty Seller. Gracias por atenderme hace un rato. Te escribo por aquí por si te resulta más cómodo para seguir con lo de Amazon para {{empresa}}. ¿Qué día te viene bien?',
}

/* ------------------------------------------------------------------ */
/* Qué mensaje                                                         */
/* ------------------------------------------------------------------ */

/**
 * La situación en que está un lead, por su estado. «No contesta» es lo que deja Rinkel solo tras una llamada sin respuesta; los estados que
 * vienen de haber hablado (rellamada programada, info enviada, seguimiento, cita) piden un mensaje de después de hablar; el resto es un
 * primer contacto.
 */
export function situacionDelLead(estado: string | null | undefined): SituacionDeWhatsapp {
  if (estado === 'no_contesta') return 'no_contesta'
  if (estado === 'programado' || estado === 'email_enviado' || estado === 'seguimiento' || estado === 'cita_cualificada') return 'tras_hablar'
  return 'primer_contacto'
}

/** A un lead que ha dicho que no se le deja de escribir: el botón no se ofrece */
export const LEAD_SIN_WHATSAPP: ReadonlySet<string> = new Set(['no_interesa'])

/**
 * Los mensajes que se ofrecen en una situación: los guardados (en el orden en que vienen) o, si no hay ninguno, el de serie. Un mensaje
 * guardado en blanco no cuenta.
 */
export function mensajesDeLaSituacion(situacion: SituacionDeWhatsapp, guardados: readonly MensajeDeWhatsapp[] | null | undefined): MensajeDeWhatsapp[] {
  const mios = (guardados ?? []).filter((m) => m.situacion === situacion && m.texto.trim() !== '')
  if (mios.length > 0) return mios
  return [{ id: null, user_id: null, situacion, texto: MENSAJE_DE_SERIE[situacion] }]
}

/** Una cuenta estable sobre un texto (la de siempre, djb2): el mismo texto da siempre el mismo número */
export function cuentaDe(texto: string): number {
  let h = 5381
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) >>> 0
  return h
}

/** El mensaje que toca a este lead: el mismo siempre, y repartidos entre los de la situación. `semilla` es lo que identifica al lead */
export function elegirMensaje(mensajes: readonly MensajeDeWhatsapp[], semilla: string): MensajeDeWhatsapp {
  if (mensajes.length === 0) throw new Error('No hay mensajes entre los que elegir')
  return mensajes[cuentaDe(semilla) % mensajes.length]
}

/** El nombre de pila de quien escribe: «Maoli García» → «Maoli», «MAOLI» → «Maoli». Vacío si no hay nada que aprovechar */
export function nombreDePila(nombreCompleto: string | null | undefined, correo?: string | null): string {
  const primero = (nombreCompleto ?? '').trim().split(/\s+/)[0] ?? ''
  const base = primero || (correo ?? '').split('@')[0].split(/[._-]/)[0] || ''
  if (base === '') return ''
  return base.charAt(0).toLocaleUpperCase('es') + base.slice(1).toLocaleLowerCase('es')
}

const PARECE_UN_DOMINIO = /^(?:https?:\/\/)?(?:www\.)?[^\s/]+\.[a-z]{2,}(?:\/\S*)?$/i
/** La forma legal al final de un nombre de empresa: «SL», «S.L.», «S.L.U.», «SA», «SLL», «SC», «CB»… */
const FORMA_LEGAL = /^(?:s\.?l\.?u?\.?|s\.?a\.?u?\.?|s\.?l\.?l\.?|s\.?c\.?p?\.?|c\.?b\.?)$/i
const PALABRAS_PEQUENAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'a', 'al', 'por', 'para', 'con'])

/** «MUNDO DEL PAPEL PINTADO SL» → «Mundo del Papel Pintado». Un nombre que ya trae minúsculas se respeta tal cual */
function nombreDeRegistro(crudo: string): string {
  const palabras = crudo.replace(/[,;]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (palabras.length > 1 && FORMA_LEGAL.test(palabras[palabras.length - 1])) palabras.pop()
  const limpio = palabras.join(' ')
  if (/[a-záéíóúñü]/.test(limpio)) return limpio
  return palabras.map((p, i) => (i > 0 && PALABRAS_PEQUENAS.has(p.toLowerCase()) ? p.toLowerCase() : p.charAt(0).toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es'))).join(' ')
}

/**
 * Cómo se llama el lead dentro de un mensaje. El nombre de la tienda en Cold Calling suele ser su dirección web («www.elmundodelpapelpintado.com»)
 * y «te he llamado por www.elmundo…» suena a robot: en ese caso se usa el nombre de la empresa del registro, arreglado («MUNDO DEL PAPEL PINTADO SL»
 * → «Mundo del Papel Pintado»). Sin empresa, la propia web sin «www.». Quien envía puede retocar el mensaje en WhatsApp antes de pulsar enviar.
 */
export function nombreParaElMensaje(tienda: string | null | undefined, empresa: string | null | undefined): string {
  const t = (tienda ?? '').trim()
  const e = (empresa ?? '').trim()
  if (t !== '' && !PARECE_UN_DOMINIO.test(t)) return t
  if (e !== '') return nombreDeRegistro(e)
  return t.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '')
}

/** Rellena los campos que se saben. Devuelve el texto y los campos que han quedado sin rellenar (con sus llaves) */
export function rellenarMensaje(texto: string, datos: { empresa?: string | null; miNombre?: string | null }): { texto: string; sinRellenar: string[] } {
  const relleno = rellenarPlantilla(texto, { empresa: datos.empresa, mi_nombre: datos.miNombre })
  return { texto: relleno.trim(), sinRellenar: camposSinRellenar(relleno) }
}

/* ------------------------------------------------------------------ */
/* A qué número, y el enlace                                           */
/* ------------------------------------------------------------------ */

/**
 * El número tal como lo pide WhatsApp: con el prefijo del país y solo cifras («34612345678»). null si no es un teléfono o es un fijo español
 * (los números que empiezan por 8 o 9 no tienen WhatsApp: solo se ofrece con los móviles, 6 y 7). De otro país no se puede saber: se ofrece.
 */
export function numeroDeWhatsapp(telefono: string): string | null {
  const normal = normalizarTelefono(telefono)
  if (!normal) return null
  const cifras = normal.slice(1)
  if (cifras.startsWith('34') && !/^34[67]\d{8}$/.test(cifras)) return null
  return cifras
}

/** Los teléfonos de la ficha a los que se puede escribir por WhatsApp, sin repetir el mismo número escrito de otra forma */
export function numerosDeWhatsapp(telefonos: readonly string[]): Array<{ telefono: string; numero: string }> {
  const vistos = new Set<string>()
  const salida: Array<{ telefono: string; numero: string }> = []
  for (const telefono of telefonos) {
    const numero = numeroDeWhatsapp(telefono)
    if (!numero || vistos.has(numero)) continue
    vistos.add(numero)
    salida.push({ telefono, numero })
  }
  return salida
}

/** WhatsApp Web (el ordenador de siempre) o `wa.me` (el móvil y la aplicación de escritorio) */
export type ViaDeWhatsapp = 'web' | 'app'

export const esViaDeWhatsapp = (v: unknown): v is ViaDeWhatsapp => v === 'web' || v === 'app'

export function enlaceDeWhatsapp(e: { numero: string; texto: string; via: ViaDeWhatsapp }): string {
  const texto = encodeURIComponent(e.texto)
  return e.via === 'web' ? `https://web.whatsapp.com/send?phone=${e.numero}&text=${texto}` : `https://wa.me/${e.numero}?text=${texto}`
}

/* ------------------------------------------------------------------ */
/* El apunte del historial                                             */
/* ------------------------------------------------------------------ */

/**
 * Lo que queda escrito en el historial del lead. Dice «abierto con este mensaje»: el ERP no puede saber si luego se pulsa enviar, y un apunte que
 * afirmara lo contrario mentiría de vez en cuando. Con el mensaje ENTERO: quien abre el lead mañana (o la IA, al escribirle un correo) ve qué
 * se le dijo sin ir a ningún sitio.
 */
export function cuerpoDelApunteDeWhatsapp(d: { numero: string; texto: string }): string {
  const texto = d.texto
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return `WhatsApp abierto con este mensaje (+${d.numero}):\n${texto}`
}

/**
 * Lo contrario de `cuerpoDelApunteDeWhatsapp`: el mensaje que se abrió, sin la cabecera con el número. La IA lo usa para no repetirle a un lead lo que ya se
 * le escribió. Un apunte que no tiene esa forma (uno escrito a mano) se devuelve entero.
 */
export function textoDelApunteDeWhatsapp(cuerpo: string): string {
  const m = /^WhatsApp abierto con este mensaje \(\+?[\d\s]*\):\n([\s\S]*)$/.exec(cuerpo.replace(/\r\n?/g, '\n').trim())
  return (m ? m[1] : cuerpo).trim()
}
