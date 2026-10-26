import { AVISO_DE_PROBLEMA, PROBLEMAS_QUE_BLOQUEAN, mensajeListoParaWhatsapp, revisarMensajeDeWhatsapp, type ProblemaDeWhatsapp } from './ia-revision'
import { ETIQUETA_DE_SITUACION, MAX_DE_MENSAJE, type SituacionDeWhatsapp } from './mensajes'

/**
 * EL MENSAJE QUE SE ESTÁ ESCRIBIENDO EN EL BOTÓN DE WHATSAPP — PURO.
 * ==================================================================
 * Se comprueba con borrador.prueba.ts. El botón de WhatsApp de la ficha ya no abre WhatsApp de golpe: abre un cuadro donde el mensaje se ESCRIBE, se retoca
 * y se envía, y lo que se apunta en el historial del lead es exactamente lo que hay en ese cuadro al enviar. Lo que se cambie después dentro de WhatsApp no
 * llega al ERP, y por eso el texto se cierra aquí antes.
 *
 * El cuadro arranca con el mensaje SUGERIDO para el momento del lead (el de la lista, con sus campos rellenados) y se puede:
 *   · escribir encima, a mano;
 *   · cambiar por otro mensaje de la lista;
 *   · cambiar por uno que escriba la IA con el historial del lead (y retocar ese con los atajos «Más corto», «Más cercano»…).
 * Cualquier clic que REEMPLACE lo que hay (otro mensaje, la IA) guarda lo anterior para poder volver con «Deshacer»: una petición a la IA cuesta y un texto
 * escrito a mano no se recupera.
 *
 * UN BORRADOR ES DE UN LEAD EN UN MOMENTO (`clave` = «lead|momento»): lo guardado para otra clave no existe. Mientras NADA se ha tocado, `texto` es null y se ve
 * el sugerido, así que si los mensajes de la lista llegan tarde (se leen de la base) el cuadro se pone al día solo.
 */

export type OrigenDelTexto = 'sugerido' | 'plantilla' | 'ia'

/** Lo que cambia cuando un clic reemplaza el texto, y por tanto lo que «Deshacer» devuelve */
export interface Instantanea {
  /** null = nada tocado: en el cuadro está el sugerido */
  texto: string | null
  /** De dónde viene el texto que hay: el sugerido, uno elegido de la lista o uno escrito por la IA */
  origen: OrigenDelTexto
  /** La persona ha cambiado el texto a mano desde que llegó */
  editado: boolean
  /** En qué datos se apoya el mensaje de la IA, según ella (solo con origen `ia`) */
  base: string
  avisoDeLaIa: string | null
  /** Para qué momento se escribió el mensaje de la IA */
  situacionDeLaIa: SituacionDeWhatsapp | null
  /** Hasta cuántas palabras se deja pasar con la configuración con la que se escribió (la que diga el servidor); null = la de siempre */
  maxPalabras: number | null
}

export interface Borrador extends Instantanea {
  /** «lead|momento» para el que es todo esto */
  clave: string
  /** Se ha escrito algún mensaje con la IA en este borrador: se ofrecen los atajos para cambiarlo */
  hayIa: boolean
  /** Lo que había antes del último reemplazo, para volver */
  previo: Instantanea | null
}

export const borradorVacio = (clave: string): Borrador => ({
  clave,
  texto: null,
  origen: 'sugerido',
  editado: false,
  base: '',
  avisoDeLaIa: null,
  situacionDeLaIa: null,
  maxPalabras: null,
  hayIa: false,
  previo: null,
})

const instantanea = (b: Borrador): Instantanea => ({
  texto: b.texto,
  origen: b.origen,
  editado: b.editado,
  base: b.base,
  avisoDeLaIa: b.avisoDeLaIa,
  situacionDeLaIa: b.situacionDeLaIa,
  maxPalabras: b.maxPalabras,
})

/** Lo que se ve en el cuadro: lo que se haya puesto o, si no se ha tocado nada, el mensaje sugerido */
export const textoMostrado = (b: Borrador, sugerido: string): string => b.texto ?? sugerido

/** ¿Se ha cambiado algo respecto al mensaje sugerido? (para ofrecer volver a él) */
export const estaTocado = (b: Borrador): boolean => b.texto !== null

/* ------------------------------------------------------------------ */
/* Lo que pasa en el cuadro                                            */
/* ------------------------------------------------------------------ */

/** La persona escribe en el cuadro. No se puede deshacer con el botón: para eso está Ctrl+Z del propio cuadro */
export function alEscribir(b: Borrador, nuevo: string): Borrador {
  return { ...b, texto: nuevo.slice(0, MAX_DE_MENSAJE), editado: true }
}

/** La persona elige otro mensaje de la lista: pasa al cuadro (no se abre WhatsApp), y lo que había se puede recuperar */
export function alElegirDeLaLista(b: Borrador, texto: string): Borrador {
  return { ...b, previo: instantanea(b), texto: texto.slice(0, MAX_DE_MENSAJE), origen: 'plantilla', editado: false, base: '', avisoDeLaIa: null, situacionDeLaIa: null, maxPalabras: null }
}

/** Llega un mensaje escrito por la IA: reemplaza lo que hubiera, y lo que había se puede recuperar */
export function alLlegarDeLaIa(b: Borrador, r: { mensaje: string; base: string; aviso: string | null; maxPalabras: number | null }, situacion: SituacionDeWhatsapp): Borrador {
  return {
    ...b,
    previo: instantanea(b),
    texto: r.mensaje.slice(0, MAX_DE_MENSAJE),
    origen: 'ia',
    editado: false,
    base: r.base,
    avisoDeLaIa: r.aviso,
    situacionDeLaIa: situacion,
    maxPalabras: r.maxPalabras,
    hayIa: true,
  }
}

/** Vuelve a lo que había antes del último reemplazo. Sin nada que recuperar no hace nada */
export function alDeshacer(b: Borrador): Borrador {
  if (!b.previo) return b
  return { ...b, ...b.previo, previo: null }
}

/* ------------------------------------------------------------------ */
/* Qué se dice del texto que hay                                       */
/* ------------------------------------------------------------------ */

/** «Mensaje sugerido · Primer contacto», «Escrito con IA · Te he llamado y no contesta (retocado)», «Mensaje elegido de la lista» */
export function etiquetaDelOrigen(b: Borrador, situacionActual: SituacionDeWhatsapp): string {
  const base =
    b.origen === 'ia' ? `Escrito con IA · ${ETIQUETA_DE_SITUACION[b.situacionDeLaIa ?? situacionActual]}` : b.origen === 'plantilla' ? 'Mensaje elegido de la lista' : `Mensaje sugerido · ${ETIQUETA_DE_SITUACION[situacionActual]}`
  return b.editado ? `${base} (retocado)` : base
}

export interface RevisionDelBorrador {
  /** El texto ya limpio, tal como se abriría en WhatsApp y tal como se apunta en el historial */
  listo: string
  problemas: ProblemaDeWhatsapp[]
  /** Lo que conviene mirar antes de enviar: lo que dijo la IA (si la persona no lo ha cambiado) y lo que se ve al leer el texto tal como está ahora */
  avisos: string[]
  /** ¿Hay algo que impide enviar ahora mismo? (nada escrito, o un hueco por rellenar) */
  bloquea: boolean
  /** En qué datos se apoya el mensaje de la IA. Vacío si la persona ya lo ha cambiado: lo que decía la IA ya no vale tal cual */
  base: string
}

export function revisarBorrador(b: Borrador, sugerido: string): RevisionDelBorrador {
  const listo = mensajeListoParaWhatsapp(textoMostrado(b, sugerido))
  const problemas = listo === '' ? [] : revisarMensajeDeWhatsapp(listo, [], b.maxPalabras ? { maxPalabras: b.maxPalabras } : {})
  const todos = [...(b.editado || !b.avisoDeLaIa ? [] : [b.avisoDeLaIa]), ...problemas.map((p) => AVISO_DE_PROBLEMA[p])]
  return {
    listo,
    problemas,
    avisos: todos.filter((a, i) => todos.indexOf(a) === i),
    bloquea: listo === '' || problemas.some((p) => PROBLEMAS_QUE_BLOQUEAN.has(p)),
    base: b.editado ? '' : b.base,
  }
}
