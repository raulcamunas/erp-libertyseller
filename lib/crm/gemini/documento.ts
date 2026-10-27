/**
 * EL DOCUMENTO «NOTAS DE GEMINI» DE DRIVE, LEÍDO.
 * ================================================
 * El correo de Gemini da un resumen; el DOCUMENTO al que enlaza es la nota entera, con DOS PESTAÑAS:
 *
 *   «Notas»          el título de la reunión, «Invitado <correo>» (un chip de persona), «Archivos adjuntos» (un enlace al EVENTO del calendario y otro a las notas), y las secciones
 *                    «Resumen» (una frase y los temas, cada uno con su título en negrita), «Decisiones» (con «Requiere más debate»), «Próximos pasos» («[Quién] Tarea: detalle») y
 *                    «Detalles» (un párrafo largo por tema, con su título en negrita y separados por una raya).
 *   «Transcripción»  una cabecera por cada minuto («00:01:12») y debajo, una línea por intervención con el hablante en negrita («**Liberty Seller:** sí.»). Aquí SÍ se sabe quién habla.
 *
 * Y el NOMBRE del documento en Drive trae la hora de inicio de la reunión: «<título> - 2026/10/20 10:02 CEST - Notas de Gemini».
 *
 * De ahí salen las dos llaves que permiten casar la nota con la cita del ERP sin adivinar: el id del EVENTO (el enlace de calendario lleva `eid=<base64 de «idDelEvento calendario»>`, y
 * `idDelEvento` es lo que el ERP guarda en `appointments.google_event_id`) y el CORREO DEL INVITADO (el del lead, `appointments.lead_email`).
 *
 * LA API DE DOCS DEVUELVE UN ÁRBOL, no texto: pestañas -> contenido -> párrafos -> elementos (trozos de texto con su estilo, chips de persona, enlaces ricos). `aplanarDocumento` lo deja
 * en una lista de párrafos con lo que hace falta (estilo, texto, el principio en negrita, enlaces y correos) y `leerDocumento` lo lee. Se tolera todo lo que falte: un documento sin
 * transcripción, sin «Decisiones» o con una sola pestaña da una nota igual de buena con menos cosas.
 *
 * Es puro: no toca la red ni la base.
 */

import { fromMadrid } from '@/lib/timezone'
import { leerPaso } from './correo'
import type { NotaLeida, PasoDeNota, TemaDeNota } from './tipos'

/* ------------------------------------------------------------------ */
/* La forma que devuelve la API de Docs (solo lo que se usa)           */
/* ------------------------------------------------------------------ */

export interface ElementoDeDocs {
  textRun?: { content?: string; textStyle?: { bold?: boolean; link?: { url?: string } } }
  person?: { personProperties?: { email?: string; name?: string } }
  richLink?: { richLinkProperties?: { uri?: string; title?: string } }
}

export interface ParrafoDeDocs {
  elements?: ElementoDeDocs[]
  paragraphStyle?: { namedStyleType?: string }
  bullet?: { nestingLevel?: number }
}

export interface ContenidoDeDocs {
  paragraph?: ParrafoDeDocs
  table?: { tableRows?: Array<{ tableCells?: Array<{ content?: ContenidoDeDocs[] }> }> }
}

export interface PestanaDeDocs {
  tabProperties?: { title?: string }
  documentTab?: { body?: { content?: ContenidoDeDocs[] } }
  childTabs?: PestanaDeDocs[]
}

export interface DocumentoDeDocs {
  title?: string
  tabs?: PestanaDeDocs[]
  body?: { content?: ContenidoDeDocs[] }
}

/* ------------------------------------------------------------------ */
/* El árbol, aplanado                                                  */
/* ------------------------------------------------------------------ */

export type EstiloDeParrafo = 'titulo' | 'h1' | 'h2' | 'h3' | 'h4' | 'normal'

export interface ParrafoPlano {
  estilo: EstiloDeParrafo
  lista: boolean
  texto: string
  /** El principio del párrafo que va en negrita («Análisis de tienda actual»), sin los dos puntos finales. null si no empieza en negrita */
  negrita: string | null
  /** Lo que queda después de ese principio en negrita */
  resto: string
  /** Todo el párrafo va en negrita: un titular suelto (el texto del tema viene en el párrafo de debajo) */
  soloNegrita: boolean
  enlaces: string[]
  correos: string[]
}

export interface PestanaPlana {
  titulo: string
  parrafos: ParrafoPlano[]
}

const ESTILOS: Record<string, EstiloDeParrafo> = { TITLE: 'titulo', SUBTITLE: 'h1', HEADING_1: 'h1', HEADING_2: 'h2', HEADING_3: 'h3', HEADING_4: 'h4', HEADING_5: 'h4', HEADING_6: 'h4' }

function aplanarParrafo(p: ParrafoDeDocs): ParrafoPlano {
  let texto = ''
  let negrita = ''
  let enNegrita = true
  const enlaces: string[] = []
  const correos: string[] = []

  for (const el of p.elements ?? []) {
    if (el.textRun) {
      const contenido = (el.textRun.content ?? '').replace(/\u000b/g, '\n')
      texto += contenido
      const url = el.textRun.textStyle?.link?.url
      if (url) enlaces.push(url)
      // El principio en negrita: mientras los trozos sean negrita (los espacios y saltos no la rompen)
      if (enNegrita) {
        if (el.textRun.textStyle?.bold === true || contenido.trim() === '') negrita += contenido
        else enNegrita = false
      }
    } else if (el.person) {
      const correo = el.person.personProperties?.email
      const nombre = el.person.personProperties?.name
      if (correo) correos.push(correo.trim().toLowerCase())
      texto += correo ? `<${correo}>` : (nombre ?? '')
      enNegrita = false
    } else if (el.richLink) {
      const uri = el.richLink.richLinkProperties?.uri
      if (uri) enlaces.push(uri)
      texto += el.richLink.richLinkProperties?.title ?? ''
      enNegrita = false
    }
  }

  texto = texto.replace(/\s+$/g, '').replace(/^\s+/g, '')
  const lead = negrita.replace(/[\s:]+$/g, '').trim()
  // Un párrafo ENTERO en negrita no tiene «principio»: es un titular, y se queda como texto
  const entero = lead !== '' && texto.replace(/\s+/g, ' ') === lead.replace(/\s+/g, ' ')
  const tieneLead = lead !== '' && !entero
  return {
    estilo: ESTILOS[p.paragraphStyle?.namedStyleType ?? ''] ?? 'normal',
    lista: !!p.bullet,
    texto,
    negrita: tieneLead ? lead : null,
    resto: tieneLead ? texto.slice(texto.indexOf(lead) + lead.length).replace(/^[\s:]+/, '').trim() : texto,
    soloNegrita: entero,
    enlaces,
    correos,
  }
}

function aplanarContenido(contenido: ContenidoDeDocs[] | undefined, salida: ParrafoPlano[]): void {
  for (const c of contenido ?? []) {
    if (c.paragraph) salida.push(aplanarParrafo(c.paragraph))
    else if (c.table) {
      for (const fila of c.table.tableRows ?? []) for (const celda of fila.tableCells ?? []) aplanarContenido(celda.content, salida)
    }
  }
}

function aplanarPestanas(pestanas: PestanaDeDocs[] | undefined, salida: PestanaPlana[]): void {
  for (const t of pestanas ?? []) {
    const parrafos: ParrafoPlano[] = []
    aplanarContenido(t.documentTab?.body?.content, parrafos)
    salida.push({ titulo: t.tabProperties?.title ?? '', parrafos })
    aplanarPestanas(t.childTabs, salida)
  }
}

export function aplanarDocumento(doc: DocumentoDeDocs): { titulo: string; pestanas: PestanaPlana[] } {
  const pestanas: PestanaPlana[] = []
  if (doc.tabs && doc.tabs.length > 0) aplanarPestanas(doc.tabs, pestanas)
  else {
    const parrafos: ParrafoPlano[] = []
    aplanarContenido(doc.body?.content, parrafos)
    pestanas.push({ titulo: '', parrafos })
  }
  return { titulo: doc.title ?? '', pestanas }
}

/* ------------------------------------------------------------------ */
/* El nombre del documento: título y hora de inicio                    */
/* ------------------------------------------------------------------ */

export interface TituloDeDocumento {
  titulo: string
  /** ISO del inicio de la reunión; null si el nombre no lleva hora */
  inicio: string | null
}

/** «<título> - 2026/10/20 10:02 CEST - Notas de Gemini» -> el título y el instante de inicio. Sin ese formato, el nombre entero es el título */
export function leerTituloDeDocumento(nombre: string): TituloDeDocumento {
  const m = /^(.*?)\s+-\s+(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s+([A-Za-z0-9+\-:]+)\s+-\s+(?:notas de gemini|notes by gemini)\s*$/i.exec(nombre.trim())
  if (!m) return { titulo: nombre.replace(/\s+-\s+(?:notas de gemini|notes by gemini)\s*$/i, '').trim(), inicio: null }
  const [, titulo, a, mes, d, hh, mm, zona] = m
  const pared = `${a}-${mes}-${d}T${hh.padStart(2, '0')}:${mm}:00`
  let instante: Date
  const desfase = /^(?:GMT|UTC)([+-]\d{1,2})(?::?(\d{2}))?$/i.exec(zona)
  if (/^(?:GMT|UTC)$/i.test(zona)) instante = new Date(`${pared}Z`)
  else if (desfase) {
    const horas = Number(desfase[1])
    const minutos = Number(desfase[2] ?? 0) * (horas < 0 ? -1 : 1)
    instante = new Date(new Date(`${pared}Z`).getTime() - (horas * 60 + minutos) * 60_000)
  } else instante = fromMadrid(pared) // CET, CEST y cualquier otra abreviatura: la hora de España, que es la de la cuenta
  return { titulo: titulo.trim(), inicio: Number.isFinite(instante.getTime()) ? instante.toISOString() : null }
}

/* ------------------------------------------------------------------ */
/* Las llaves para casar con la cita                                   */
/* ------------------------------------------------------------------ */

/**
 * El id del evento de Google Calendar que lleva un enlace `https://calendar.google.com/calendar/event?eid=<base64>` (visto en un documento real). El base64 va SIN relleno y es
 * «idDelEvento calendario» (aquí, «… business@libertyseller.com»). null si no es un enlace de ese tipo o no sale un id con pinta de id.
 */
export function idDelEventoDeUnEnlace(url: string): string | null {
  let eid: string | null
  try {
    const u = new URL(url)
    if (!/(^|\.)google\.com$/i.test(u.hostname) || !u.pathname.includes('/calendar')) return null
    eid = u.searchParams.get('eid')
  } catch {
    return null
  }
  if (!eid) return null
  const decodificado = Buffer.from(eid.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  const id = decodificado.split(/\s+/)[0]?.trim()
  // Un id de Calendar son letras y cifras (los de una instancia de evento repetido añaden «_» y la fecha); si lo decodificado no lo parece, no es un id
  return id && /^[A-Za-z0-9_-]{5,}$/.test(id) ? id : null
}

/** Los correos del documento que no son del equipo: el del invitado (el lead). En minúsculas y sin repetir */
export function invitadosDe(correos: string[], dominiosPropios: readonly string[] = ['libertyseller.com']): string[] {
  const vistos = new Set<string>()
  for (const c of correos) {
    const correo = c.trim().toLowerCase().replace(/^<|>$/g, '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) continue
    if (dominiosPropios.some((d) => correo.endsWith(`@${d}`))) continue
    vistos.add(correo)
  }
  return [...vistos]
}

/* ------------------------------------------------------------------ */
/* Leer el documento                                                   */
/* ------------------------------------------------------------------ */

type Seccion = 'cabecera' | 'resumen' | 'decisiones' | 'pasos' | 'detalles' | 'otra'

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function seccionDe(titular: string): Seccion | null {
  const t = normalizar(titular)
  if (t === 'resumen' || t === 'summary') return 'resumen'
  if (t === 'decisiones' || t === 'decisions') return 'decisiones'
  if (t === 'proximos pasos' || t === 'pasos siguientes' || t === 'pasos siguientes recomendados' || t === 'next steps' || t === 'suggested next steps') return 'pasos'
  if (t === 'detalles' || t === 'details') return 'detalles'
  return null
}

const esTitular = (p: ParrafoPlano) => p.estilo !== 'normal' && !p.lista

/** Un párrafo del documento en una línea de texto con marcas ligeras: «## titular», «- elemento», «**negrita** resto». Las rayas de separación no se pintan */
function aLinea(p: ParrafoPlano): string | null {
  if (/^[-–—_=\s]{3,}$/.test(p.texto) || p.texto === '') return null
  if (esTitular(p)) return `## ${p.texto}`
  const cuerpo = p.negrita ? `**${p.negrita}** ${p.resto}`.trim() : p.soloNegrita ? `**${p.texto}**` : p.texto
  return p.lista ? `- ${cuerpo}` : cuerpo
}

const MAXIMO_DE_TRANSCRIPCION = 200_000

export function leerDocumento(doc: DocumentoDeDocs, driveFileId: string | null): NotaLeida | null {
  const { titulo: nombre, pestanas } = aplanarDocumento(doc)
  if (pestanas.length === 0 || pestanas.every((t) => t.parrafos.length === 0)) return null

  const deTranscripcion = pestanas.find((t) => /transcrip/.test(normalizar(t.titulo)))
  const deNotas = pestanas.find((t) => t !== deTranscripcion && /^(notas|notes)$/.test(normalizar(t.titulo))) ?? pestanas.find((t) => t !== deTranscripcion) ?? pestanas[0]

  const { titulo: tituloDelNombre, inicio } = leerTituloDeDocumento(nombre)

  // ── La pestaña de notas ──
  let seccion: Seccion = 'cabecera'
  const correos: string[] = []
  const enlaces: string[] = []
  let tituloH2: string | null = null
  let tituloPendiente: string | null = null
  let resumen: string | null = null
  const temas: TemaDeNota[] = []
  const proximosPasos: PasoDeNota[] = []
  const lineasDecisiones: string[] = []
  const lineasDetalle: string[] = []

  for (const p of deNotas.parrafos) {
    if (p.texto === '' && p.correos.length === 0 && p.enlaces.length === 0) continue

    // El cambio de sección: un titular que se llama como una de ellas. «Requiere más debate» cuelga de «Decisiones»
    const nueva = esTitular(p) ? seccionDe(p.texto) : null
    if (nueva) {
      seccion = nueva
      tituloPendiente = null
      continue
    }
    if (esTitular(p) && seccion === 'decisiones') {
      lineasDecisiones.push(`### ${p.texto}`)
      continue
    }

    if (seccion === 'cabecera') {
      correos.push(...p.correos)
      enlaces.push(...p.enlaces)
      // Un correo escrito a mano en el texto («Invitado ana@x.com» o «<ana@x.com>») también vale
      for (const m of p.texto.matchAll(/[^\s<>(),;:@]+@[^\s<>(),;:@]+\.[^\s<>(),;:@]+/g)) correos.push(m[0])
      if (!tituloH2 && (p.estilo === 'h2' || p.estilo === 'h1' || p.estilo === 'titulo') && !/^las notas$/i.test(normalizar(p.texto))) tituloH2 = p.texto
    } else if (seccion === 'resumen') {
      if (p.negrita) {
        temas.push({ titulo: p.negrita, texto: p.resto })
        tituloPendiente = null
      } else if (p.soloNegrita && !p.lista) {
        // El título del tema solo, en negrita: su texto es el párrafo de debajo
        tituloPendiente = p.texto
      } else if (tituloPendiente) {
        temas.push({ titulo: tituloPendiente, texto: p.texto })
        tituloPendiente = null
      } else if (!p.lista && resumen === null) resumen = p.texto
      else if (!p.lista) resumen = `${resumen ?? ''} ${p.texto}`.trim()
    } else if (seccion === 'decisiones') {
      const l = aLinea(p)
      if (l) lineasDecisiones.push(l)
    } else if (seccion === 'pasos') {
      const paso = leerPaso(p.texto)
      if (paso) proximosPasos.push(paso)
    } else if (seccion === 'detalles') {
      const l = aLinea(p)
      if (l) lineasDetalle.push(l)
    }
  }

  // ── La transcripción ──
  let transcripcion: string | null = null
  if (deTranscripcion) {
    const lineas: string[] = []
    for (const p of deTranscripcion.parrafos) {
      if (p.texto === '') continue
      // La primera cabecera repite el título del documento: no es una intervención
      if (p.estilo === 'titulo' || p.estilo === 'h1' || p.estilo === 'h2') continue
      if (p.estilo === 'h3' || p.estilo === 'h4') {
        // El minuto («00:01:12») o el cierre («La transcripción finalizó después de 00:38:00»)
        lineas.push(/^\d{1,2}:\d{2}(?::\d{2})?$/.test(p.texto) ? `[${p.texto}]` : p.texto)
        continue
      }
      lineas.push(p.negrita ? `${p.negrita}: ${p.resto}`.trim() : p.texto)
    }
    const t = lineas.join('\n').trim()
    transcripcion = t === '' ? null : t.length > MAXIMO_DE_TRANSCRIPCION ? `${t.slice(0, MAXIMO_DE_TRANSCRIPCION)}\n[…recortada…]` : t
  }

  const secciones: string[] = []
  if (lineasDecisiones.length > 0) secciones.push(`## Decisiones\n${lineasDecisiones.join('\n')}`)
  if (lineasDetalle.length > 0) secciones.push(`## Detalles\n${lineasDetalle.join('\n')}`)

  const eventos = enlaces.map(idDelEventoDeUnEnlace).filter((x): x is string => !!x)
  const titulo = tituloDelNombre || tituloH2 || ''
  if (!titulo) return null

  return {
    gmailMessageId: null,
    driveFileId,
    googleEventId: eventos[0] ?? null,
    titulo,
    fechaReunion: inicio,
    invitados: invitadosDe(correos),
    resumen,
    temas,
    proximosPasos,
    detalle: secciones.length > 0 ? secciones.join('\n\n') : null,
    transcripcion,
    completa: true,
  }
}

/**
 * Junta lo del correo con lo del documento. El documento manda en todo lo que trae (es la nota entera); del correo se conserva su id y, si el documento no sabe cuándo empezó,
 * la hora a la que llegó. Si el documento no se pudo leer, se queda el correo (nota incompleta).
 */
export function fusionarNotas(correo: NotaLeida, documento: NotaLeida | null): NotaLeida {
  if (!documento) return correo
  return {
    gmailMessageId: correo.gmailMessageId,
    driveFileId: documento.driveFileId ?? correo.driveFileId,
    googleEventId: documento.googleEventId ?? correo.googleEventId,
    titulo: documento.titulo || correo.titulo,
    fechaReunion: documento.fechaReunion ?? correo.fechaReunion,
    invitados: documento.invitados.length > 0 ? documento.invitados : correo.invitados,
    resumen: documento.resumen ?? correo.resumen,
    temas: documento.temas.length > 0 ? documento.temas : correo.temas,
    proximosPasos: documento.proximosPasos.length > 0 ? documento.proximosPasos : correo.proximosPasos,
    detalle: documento.detalle ?? correo.detalle,
    transcripcion: documento.transcripcion ?? correo.transcripcion,
    completa: true,
  }
}
