/**
 * EL CORREO DE LAS NOTAS DE GEMINI, LEÍDO.
 * =========================================
 * Cada reunión de Meet con las notas de Gemini encendidas acaba en un correo de gemini-notes@google.com a business@. Visto con correos reales (27 oct 2026) tiene este aspecto:
 *
 *   Asunto:  «Notas: Consultoría Estratégica Amazon · Liberty Seller · Ana Pérez 20 oct 2026»       (o «Notas: Reunión del 23 oct 2026 a las 12:03 PM CEST» si la reunión no tenía título)
 *   Cuerpo:  «Notas de <título>» · «Abrir notas de la reunión» (el enlace al documento, solo en el HTML) · «Resumen» + una frase + temas («<título del tema>» y su párrafo) ·
 *            «Pasos siguientes recomendados» + líneas «[Quién] Tarea: detalle» · «Registros de la reunión» y el pie de Google.
 *
 * El correo NO dice con quién se habló ni cuándo empezó la reunión; eso (y el detalle largo y la transcripción) está en el documento de Drive, al que lleva el enlace de aquí
 * (documento.ts). Lo que sí da es lo bastante para tener una nota útil el mismo minuto que acaba la reunión, y para casarla con la cita por el nombre del título.
 *
 * EL CUERPO EN TEXTO PLANO VIENE PARTIDO A UNAS 80 COLUMNAS: una frase larga ocupa varias líneas. Los PÁRRAFOS se separan por una línea en blanco, así que se trabaja por párrafos y
 * se unen sus líneas con un espacio; dentro de un tema, la primera línea es su título (cortos: nunca se parten) y el resto es su texto.
 *
 * SOLO SE QUIEREN LAS REUNIONES CON CLIENTES. Gemini también toma notas de las reuniones internas del equipo («Reunión Semanal | Comerciales», «Onboarding de Jhanna»), y esas no
 * tienen nada que hacer en el CRM de un cliente (ni conviene que su texto salga de Gmail). `esReunionConCliente` lo decide por el título que ponen las citas del ERP.
 *
 * Es puro: no toca la red ni la base.
 */

import type { NotaLeida, PasoDeNota, TemaDeNota } from './tipos'

export interface CorreoDeGemini {
  id: string
  asunto: string
  /** «gemini-notes@google.com», con o sin nombre delante */
  remitente: string
  /** Cuándo llegó (ms desde 1970): la reunión acaba un poco antes */
  recibidoMs: number
  texto: string
  html: string
}

export const REMITENTE_DE_GEMINI = 'gemini-notes@google.com'

export function esCorreoDeGemini(remitente: string): boolean {
  return remitente.toLowerCase().includes(REMITENTE_DE_GEMINI)
}

/**
 * El título que ponen las citas del ERP a su evento de Google Calendar (buildAppointmentSummary en lib/appointments-sync.ts): «Consultoría Estratégica Amazon · Liberty Seller ·
 * <nombre del lead>». Gemini lo copia en el asunto y en el documento. Se acepta con o sin tildes y con cualquier punto medio.
 */
export const PREFIJO_DE_LA_CITA = /Consultor[ií]a\s+Estrat[eé]gica\s+Amazon\s*[·•|\-–]\s*Liberty\s+Seller\s*[·•|\-–]\s*/i

export function esReunionConCliente(titulo: string): boolean {
  return PREFIJO_DE_LA_CITA.test(titulo)
}

/**
 * Una reunión SIN título: Meet le pone «Reunión del 23 oct 2026 a las 12:03 PM CEST». Puede ser una llamada con un cliente que se montó a mano, o una interna cualquiera: el título no
 * lo dice, y solo se sabe leyendo el documento (si enlaza una cita del ERP o trae el correo de un lead). Las reuniones con título que no son de cliente («Reunión Semanal |
 * Comerciales», «Onboarding de Jhanna») se descartan SIN abrir el documento.
 */
export function esReunionSinTitulo(titulo: string): boolean {
  return /^(?:reuni[oó]n|meeting)\s+(?:del|on)\s+\d{1,2}\s+\S+\.?\s+\d{4}\s+(?:a las|at)\s+\d{1,2}:\d{2}/i.test(titulo.trim())
}

/** «Ana Pérez» a partir del título de la cita (sin el prefijo, sin «(Socio único)» y sin espacios de más) */
export function nombreDelTitulo(titulo: string): string {
  return titulo.replace(PREFIJO_DE_LA_CITA, '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
}

const MESES = '(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic|jan|apr|aug|dec)'

/** El asunto sin «Notas: » delante y sin la fecha corta («20 oct 2026») que Google le pega detrás */
export function tituloDeLaReunion(asunto: string): string {
  return asunto
    .replace(/^\s*(?:notas|notes)\s*:\s*/i, '')
    .replace(new RegExp(`\\s+\\d{1,2}\\s+${MESES}\\.?\\s+\\d{4}\\s*$`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** El id del documento «Notas de Gemini» que enlaza el HTML del correo («Abrir notas de la reunión»). null si no hay HTML o no hay enlace */
export function docIdDelCorreo(html: string): string | null {
  const m = /docs\.google\.com\/document\/d\/([A-Za-z0-9_-]{10,})/.exec(html)
  return m ? m[1] : null
}

const SECCION_RESUMEN = /^(?:resumen|summary)$/i
const SECCION_PASOS = /^(?:pasos siguientes(?: recomendados)?|pr[oó]ximos pasos|(?:suggested )?next steps)$/i
const PIE = /^(?:registros de la reuni[oó]n|meeting records|¿te ha resultado|was this (?:email|content)|google llc)/i

const unir = (lineas: string[]): string => lineas.map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()

/** «[Liberty Seller] Consultar tarifas: Preguntar al equipo…» -> quién, tarea y detalle. Sin corchetes ni dos puntos se queda todo en la tarea */
export function leerPaso(texto: string): PasoDeNota | null {
  const t = texto.replace(/\s+/g, ' ').trim()
  if (!t) return null
  const completo = /^\[([^\]]+)\]\s*([^:]+?)\s*:\s+(.+)$/.exec(t)
  if (completo) return { quien: completo[1].trim(), que: completo[2].trim(), detalle: completo[3].trim() }
  const sinDetalle = /^\[([^\]]+)\]\s*(.+)$/.exec(t)
  if (sinDetalle) return { quien: sinDetalle[1].trim(), que: sinDetalle[2].trim().replace(/:$/, ''), detalle: null }
  return { quien: null, que: t, detalle: null }
}

export interface CuerpoLeido {
  resumen: string | null
  temas: TemaDeNota[]
  proximosPasos: PasoDeNota[]
}

/** El texto plano (ya partido en párrafos) -> resumen, temas y pasos. Tolera que falte cualquiera de las secciones */
export function leerCuerpo(texto: string): CuerpoLeido {
  const bloques = texto
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)

  let modo: 'fuera' | 'resumen' | 'pasos' = 'fuera'
  let resumen: string | null = null
  const temas: TemaDeNota[] = []
  const proximosPasos: PasoDeNota[] = []

  for (const bloque of bloques) {
    const lineas = bloque.split('\n')
    // Un encabezado es un bloque de una sola línea que dice exactamente su nombre
    if (lineas.length === 1 && SECCION_RESUMEN.test(bloque)) {
      modo = 'resumen'
      continue
    }
    if (lineas.length === 1 && SECCION_PASOS.test(bloque)) {
      modo = 'pasos'
      continue
    }
    // Desde el pie no hay nada que leer
    if (PIE.test(bloque)) break

    if (modo === 'resumen') {
      if (resumen === null) {
        resumen = unir(lineas)
      } else if (lineas.length > 1) {
        const titulo = lineas[0].trim()
        const cuerpo = unir(lineas.slice(1))
        if (titulo && cuerpo) temas.push({ titulo, texto: cuerpo })
      } else {
        // Un párrafo suelto de una línea continúa el resumen en vez de perderse
        resumen = `${resumen} ${unir(lineas)}`
      }
    } else if (modo === 'pasos') {
      const paso = leerPaso(unir(lineas))
      if (paso) proximosPasos.push(paso)
    }
  }
  return { resumen, temas, proximosPasos }
}

const ENTIDADES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#47;': '/', '&#61;': '=', '&#45;': '-' }

/** Para un correo sin versión en texto plano: el HTML -> texto con los párrafos separados por una línea en blanco */
export function htmlATexto(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|h[1-6]|table)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? e)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Un correo de Gemini -> la nota que se puede sacar de él. null si no es de Gemini o no trae ni título.
 *
 * NO decide si es una reunión con un cliente (eso lo hace esReunionConCliente sobre el título, y la sincronización): aquí solo se lee.
 */
export function leerCorreoDeGemini(correo: CorreoDeGemini): NotaLeida | null {
  if (!esCorreoDeGemini(correo.remitente)) return null
  const titulo = tituloDeLaReunion(correo.asunto)
  if (!titulo) return null
  const texto = correo.texto.trim() ? correo.texto : htmlATexto(correo.html)
  const cuerpo = leerCuerpo(texto)
  return {
    gmailMessageId: correo.id,
    driveFileId: docIdDelCorreo(correo.html),
    googleEventId: null,
    titulo,
    fechaReunion: Number.isFinite(correo.recibidoMs) ? new Date(correo.recibidoMs).toISOString() : null,
    invitados: [],
    resumen: cuerpo.resumen,
    temas: cuerpo.temas,
    proximosPasos: cuerpo.proximosPasos,
    detalle: null,
    transcripcion: null,
    completa: false,
  }
}
