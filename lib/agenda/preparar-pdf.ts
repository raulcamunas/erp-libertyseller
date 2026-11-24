import { jsPDF } from 'jspdf'
import { LOGO_ALTO_PX, LOGO_ANCHO_PX, logoPng } from '@/lib/fba/excel/logo-marca'
import { COLOR } from '@/lib/fba/excel/marca'
import { soportado } from '@/lib/fba/informe-pedido-pdf'
import { fuentesDeMarca } from '@/lib/fba/pdf/fuentes-marca'
import type { FichaCliente } from './preparar'

/**
 * LA HOJA DE LA REUNIÓN EN PDF — UNA SOLA HOJA A4, CON LA MARCA (24 nov 2026, Raúl). Se comprueba con preparar-pdf.prueba.ts.
 * ========================================================================================================================
 * Para imprimirla y tenerla delante en la llamada: la banda oscura con el logo y el cliente, su ficha y su cuenta de Amazon, el objetivo, los puntos
 * con casilla para ir tachando, las preguntas con su línea para la respuesta, las notas y, abajo, un recuadro con líneas para apuntar a mano.
 *
 * SIEMPRE CABE EN UNA HOJA: se maqueta en seco a varios tamaños de letra (del 100 % al 72 %) y se pinta con el primero que deja al menos 35 mm para
 * las notas a mano; si ni así, se recortan las listas por el final (el historial primero). Las mismas fuentes y el mismo logo que el informe de un
 * pedido (lib/fba/informe-pedido-pdf.ts). Uso interno: no lo ve el cliente.
 */

type Rgb = [number, number, number]
const rgb = (hex: string): Rgb => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
const C = {
  banda: rgb(COLOR.banda), naranja: rgb(COLOR.naranja), naranjaClaro: rgb(COLOR.naranjaClaro), crema: rgb(COLOR.crema), tinta: rgb(COLOR.tinta),
  etiqueta: rgb(COLOR.etiqueta), discreto: rgb(COLOR.discreto), apagado: rgb(COLOR.apagado), claro: rgb(COLOR.claro), raya: rgb(COLOR.raya), blanco: rgb(COLOR.blanco),
}

const ANCHO = 210
const ALTO = 297
const M = 12
const UTIL = ANCHO - 2 * M
const PIE = ALTO - 9
const MIN_NOTAS = 35
const ESCALAS = [1, 0.93, 0.86, 0.8, 0.75, 0.72]

export interface HojaDeReunion {
  ficha: FichaCliente
  objetivo: string
  puntos: string[]
  preguntas: string[]
  notas: string
  /** «24 nov 2026, 10:40» */
  preparadoEl: string
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «martes 25 de noviembre · 12:00–13:00» en hora de Madrid */
export function cuandoEs(inicio: string, fin: string): string {
  const z = 'Europe/Madrid'
  const partes = (iso: string) => {
    const f = new Intl.DateTimeFormat('es-ES', { timeZone: z, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
    const v = (t: string) => f.find((p) => p.type === t)?.value ?? ''
    return { dia: Number(v('day')), mes: Number(v('month')), hora: `${v('hour')}:${v('minute')}`, semana: new Date(new Date(iso).toLocaleString('en-US', { timeZone: z })).getDay() }
  }
  const a = partes(inicio)
  const b = partes(fin)
  return `${DIAS[a.semana]} ${a.dia} de ${MESES[a.mes - 1]} · ${a.hora}–${b.hora}`
}
const fechaCorta = (f: string) => `${Number(f.slice(8, 10))} ${MESES_CORTOS[Number(f.slice(5, 7)) - 1]}`

class Hoja {
  doc: jsPDF
  s = 1
  pintar = true
  y = 0
  constructor() {
    this.doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
    const f = fuentesDeMarca()
    this.doc.addFileToVFS('Sora-SemiBold.ttf', f.soraSemibold)
    this.doc.addFont('Sora-SemiBold.ttf', 'Sora', 'bold')
    this.doc.addFileToVFS('Inter-Regular.ttf', f.interRegular)
    this.doc.addFont('Inter-Regular.ttf', 'Inter', 'normal')
    this.doc.addFileToVFS('Inter-SemiBold.ttf', f.interSemibold)
    this.doc.addFont('Inter-SemiBold.ttf', 'Inter', 'bold')
  }
  fuente(f: 'titulo' | 'cuerpo' | 'enfasis', tam: number, color: Rgb = C.tinta) {
    if (f === 'titulo') this.doc.setFont('Sora', 'bold')
    else if (f === 'enfasis') this.doc.setFont('Inter', 'bold')
    else this.doc.setFont('Inter', 'normal')
    this.doc.setFontSize(tam * this.s)
    this.doc.setTextColor(...color)
  }
  /** Alto de una línea de `tam` puntos, en mm */
  lh(tam: number) {
    return tam * this.s * 0.3528 * 1.32
  }
  texto(t: string, x: number, y: number, o: { align?: 'left' | 'right'; espaciado?: number } = {}) {
    if (!this.pintar) return
    this.doc.text(soportado(t), x, y, { align: o.align ?? 'left', ...(o.espaciado ? { charSpace: o.espaciado } : {}) })
  }
  partir(t: string, ancho: number): string[] {
    return this.doc.splitTextToSize(soportado(t), ancho) as string[]
  }
  recortar(t: string, ancho: number): string {
    const s = soportado(t)
    if (this.doc.getTextWidth(s) <= ancho) return s
    let r = s
    while (r.length > 1 && this.doc.getTextWidth(`${r}…`) > ancho) r = r.slice(0, -1)
    return `${r.trimEnd()}…`
  }
  rect(x: number, y: number, w: number, h: number, c: Rgb) {
    if (!this.pintar) return
    this.doc.setFillColor(...c)
    this.doc.rect(x, y, w, h, 'F')
  }
  marco(x: number, y: number, w: number, h: number, c: Rgb, grosor = 0.25) {
    if (!this.pintar) return
    this.doc.setDrawColor(...c)
    this.doc.setLineWidth(grosor)
    this.doc.rect(x, y, w, h, 'S')
  }
  raya(x1: number, y1: number, x2: number, y2: number, c: Rgb, grosor = 0.2, discontinua = false) {
    if (!this.pintar) return
    this.doc.setDrawColor(...c)
    this.doc.setLineWidth(grosor)
    this.doc.setLineDashPattern(discontinua ? [0.7, 0.9] : [], 0)
    this.doc.line(x1, y1, x2, y2)
    this.doc.setLineDashPattern([], 0)
  }
  /** Rótulo de sección: número naranja + rótulo en versalitas, con su filete */
  seccion(num: string, rotulo: string, x: number, ancho: number) {
    this.fuente('titulo', 8.2, C.naranja)
    this.texto(num, x, this.y + this.lh(8.2) * 0.75)
    this.fuente('titulo', 8.2, C.tinta)
    this.texto(rotulo.toUpperCase(), x + 6.2, this.y + this.lh(8.2) * 0.75, { espaciado: 0.25 })
    this.y += this.lh(8.2) + 0.6
    this.raya(x, this.y, x + ancho, this.y, C.naranja, 0.35)
    this.y += 1.8
  }
  /** Un párrafo partido en líneas; devuelve el alto */
  parrafo(t: string, x: number, ancho: number, tam: number, f: 'cuerpo' | 'enfasis' = 'cuerpo', color: Rgb = C.tinta, maxLineas = 99) {
    this.fuente(f, tam, color)
    const ls = this.partir(t, ancho).slice(0, maxLineas)
    for (const l of ls) {
      this.y += this.lh(tam)
      this.texto(l, x, this.y - this.lh(tam) * 0.25)
    }
    return ls.length
  }
}

interface Limites {
  historial: number
  puntos: number
  preguntas: number
  oportunidades: number
}

/** Maqueta toda la hoja. Devuelve dónde acaba lo impreso (antes del recuadro de notas a mano) */
function maquetar(h: Hoja, d: HojaDeReunion, lim: Limites): number {
  const f = d.ficha
  /* ---------- banda ---------- */
  const altoBanda = 31
  h.rect(0, 0, ANCHO, altoBanda, C.banda)
  h.rect(0, 0, ANCHO, 1.6, C.naranja)
  if (h.pintar) h.doc.addImage(logoPng(), 'PNG', M, 7, 40, (40 * LOGO_ALTO_PX) / LOGO_ANCHO_PX)
  h.fuente('cuerpo', 7, C.apagado)
  h.texto('PREPARACIÓN DE REUNIÓN · USO INTERNO', ANCHO - M, 9.5, { align: 'right', espaciado: 0.3 })
  h.fuente('titulo', 15.5, C.blanco)
  h.texto(h.recortar(f.nombre, UTIL), M, 20.5)
  h.fuente('cuerpo', 8.5, C.claro)
  const vende = f.vendeEnAmazon === 'si' ? 'Vende en Amazon' : f.vendeEnAmazon === 'no' ? 'No vende en Amazon' : 'Amazon sin comprobar'
  const sub = [cuandoEs(f.inicio, f.fin), f.comercial ? `con ${f.comercial}` : null, vende, f.empresa && f.empresa !== f.nombre ? f.empresa : null].filter(Boolean).join('  ·  ')
  h.texto(h.recortar(sub, UTIL), M, 26.5)
  h.y = altoBanda + 5

  /* ---------- ficha | Amazon ---------- */
  const colIzq = 84
  const gap = 6
  const xDer = M + colIzq + gap
  const anchoDer = UTIL - colIzq - gap
  const y0 = h.y
  h.seccion('01', 'Ficha', M, colIzq)
  for (const dto of f.datos.slice(0, 14)) {
    h.fuente('cuerpo', 7, C.etiqueta)
    const yl = h.y + h.lh(7.6) * 0.75
    h.texto(dto.etiqueta, M, yl)
    h.fuente('enfasis', 7.6, C.tinta)
    h.texto(h.recortar(dto.valor, colIzq - 27), M + 27, yl)
    h.y += h.lh(7.6) + 0.35
  }
  const finIzq = h.y
  h.y = y0
  if (f.amazon) {
    h.seccion('02', 'Su cuenta de Amazon', xDer, anchoDer)
    // Cifras en fichas crema
    const cifras = f.amazon.cifras.slice(0, 6)
    if (cifras.length) {
      const porFila = 3
      const w = (anchoDer - (porFila - 1) * 2) / porFila
      const alto = h.lh(6.4) + h.lh(9.5) + 2
      cifras.forEach((c, i) => {
        const x = xDer + (i % porFila) * (w + 2)
        const y = h.y + Math.floor(i / porFila) * (alto + 2)
        h.rect(x, y, w, alto, C.crema)
        h.rect(x, y, 0.8, alto, C.naranja)
        h.fuente('cuerpo', 6.4, C.etiqueta)
        h.texto(c.etiqueta.toUpperCase(), x + 2.5, y + h.lh(6.4) * 0.95)
        h.fuente('titulo', 9.5, C.tinta)
        h.texto(h.recortar(c.valor, w - 4), x + 2.5, y + h.lh(6.4) + h.lh(9.5) * 0.85)
      })
      h.y += Math.ceil(cifras.length / porFila) * (alto + 2) + 0.5
    }
    if (f.amazon.resumen) h.parrafo(f.amazon.resumen, xDer, anchoDer, 7.4, 'cuerpo', C.tinta, 4)
    const ops = f.amazon.oportunidades.slice(0, lim.oportunidades)
    if (ops.length) {
      h.y += 1
      h.fuente('enfasis', 7.2, C.naranja)
      h.y += h.lh(7.2)
      h.texto('Dónde pierde ventas', xDer, h.y - h.lh(7.2) * 0.25)
      for (const o of ops) {
        h.fuente('cuerpo', 7.2, C.tinta)
        const ls = h.partir(o, anchoDer - 4).slice(0, 2)
        ls.forEach((l, i) => {
          h.y += h.lh(7.2)
          if (i === 0) h.texto('•', xDer + 0.5, h.y - h.lh(7.2) * 0.25)
          h.texto(l, xDer + 3.5, h.y - h.lh(7.2) * 0.25)
        })
      }
    }
  } else {
    h.seccion('02', 'Lo último con el cliente', xDer, anchoDer)
    pintarHistorial(h, f, xDer, anchoDer, lim.historial)
  }
  h.y = Math.max(finIzq, h.y) + 3

  /* ---------- objetivo ---------- */
  if (d.objetivo.trim()) {
    h.fuente('enfasis', 8.6, C.tinta)
    const ls = h.partir(d.objetivo, UTIL - 30)
    const alto = ls.length * h.lh(8.6) + 4
    h.rect(M, h.y, UTIL, alto, C.crema)
    h.rect(M, h.y, 1, alto, C.naranja)
    h.fuente('titulo', 7.2, C.naranja)
    h.texto('OBJETIVO', M + 4, h.y + 2 + h.lh(8.6) * 0.75, { espaciado: 0.25 })
    h.fuente('enfasis', 8.6, C.tinta)
    ls.forEach((l, i) => h.texto(l, M + 26, h.y + 2 + h.lh(8.6) * (i + 0.75)))
    h.y += alto + 3.5
  }

  /* ---------- puntos | preguntas ---------- */
  const yPP = h.y
  const anchoCol = (UTIL - gap) / 2
  h.seccion('03', 'Puntos a tratar', M, anchoCol)
  for (const p of d.puntos.slice(0, lim.puntos)) {
    h.fuente('cuerpo', 8, C.tinta)
    const ls = h.partir(p, anchoCol - 6).slice(0, 3)
    const yCaja = h.y + 0.9
    if (h.pintar) {
      h.doc.setDrawColor(...C.etiqueta)
      h.doc.setLineWidth(0.3)
      h.doc.rect(M, yCaja, 2.8 * Math.max(0.85, h.s), 2.8 * Math.max(0.85, h.s), 'S')
    }
    ls.forEach((l) => {
      h.y += h.lh(8)
      h.texto(l, M + 5, h.y - h.lh(8) * 0.25)
    })
    h.y += 1.4
  }
  const finPuntos = h.y
  h.y = yPP
  const xP = M + anchoCol + gap
  h.seccion('04', 'Preguntas', xP, anchoCol)
  d.preguntas.slice(0, lim.preguntas).forEach((q, i) => {
    h.fuente('enfasis', 7.8, C.naranja)
    h.texto(`${i + 1}`, xP, h.y + h.lh(7.8) * 0.75)
    h.fuente('cuerpo', 7.8, C.tinta)
    const ls = h.partir(q, anchoCol - 5).slice(0, 3)
    ls.forEach((l) => {
      h.y += h.lh(7.8)
      h.texto(l, xP + 4, h.y - h.lh(7.8) * 0.25)
    })
    // La línea para apuntar la respuesta
    h.y += 4.2 * Math.max(0.8, h.s)
    h.raya(xP + 4, h.y, xP + anchoCol, h.y, C.raya, 0.25, true)
    h.y += 1.6
  })
  h.y = Math.max(finPuntos, h.y) + 2.5

  /* ---------- notas preparadas ---------- */
  if (d.notas.trim()) {
    h.seccion('05', 'Notas', M, UTIL)
    for (const parrafo of d.notas.split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
      h.parrafo(parrafo, M, UTIL, 7.8, 'cuerpo', C.tinta, 6)
      h.y += 0.8
    }
    h.y += 1.5
  }

  /* ---------- lo último (si arriba iba Amazon) ---------- */
  if (f.amazon && f.historial.length && lim.historial > 0) {
    h.seccion(d.notas.trim() ? '06' : '05', 'Lo último con el cliente', M, UTIL)
    pintarHistorial(h, f, M, UTIL, lim.historial)
    h.y += 1.5
  }
  return h.y
}

function pintarHistorial(h: Hoja, f: FichaCliente, x: number, ancho: number, max: number) {
  const tipo: Record<string, string> = { llamada: 'Llamada', nota: 'Nota', reunion: 'Reunión', cita: 'Cita' }
  if (f.historial.length === 0 && f.notasDeLaCita) {
    h.parrafo(f.notasDeLaCita, x, ancho, 7.4, 'cuerpo', C.tinta, 5)
    return
  }
  for (const it of f.historial.slice(0, max)) {
    h.fuente('enfasis', 7, C.etiqueta)
    const etiqueta = `${fechaCorta(it.fecha)} · ${tipo[it.tipo] ?? it.tipo}`
    h.texto(etiqueta, x, h.y + h.lh(7.2) * 0.75)
    h.fuente('cuerpo', 7.2, C.tinta)
    const ls = h.partir(it.texto, ancho - 24).slice(0, 3)
    ls.forEach((l) => {
      h.y += h.lh(7.2)
      h.texto(l, x + 24, h.y - h.lh(7.2) * 0.25)
    })
    h.y += 1
  }
}

function notasAMano(h: Hoja, y: number, d: HojaDeReunion) {
  const alto = PIE - 3 - y
  h.marco(M, y, UTIL, alto, C.raya, 0.3)
  h.rect(M, y, UTIL, 6, C.crema)
  h.fuente('titulo', 7.2, C.naranja)
  h.texto('NOTAS DE LA LLAMADA', M + 3, y + 4.2, { espaciado: 0.25 })
  for (let yy = y + 12; yy < y + alto - 2; yy += 7) h.raya(M + 3, yy, M + UTIL - 3, yy, C.raya, 0.2)
  h.fuente('cuerpo', 6.4, C.discreto)
  h.texto(`Liberty Seller · uso interno · preparado el ${d.preparadoEl}`, M, PIE + 3)
  h.texto(soportado(d.ficha.nombre), ANCHO - M, PIE + 3, { align: 'right' })
}

/** Los bytes del PDF de una hoja */
export function hojaDeReunionPdf(d: HojaDeReunion): Uint8Array {
  const h = new Hoja()
  let lim: Limites = { historial: 4, puntos: 10, preguntas: 10, oportunidades: 4 }
  let elegida: number | null = null
  // 1) El tamaño de letra más grande con el que cabe todo y quedan 35 mm para las notas a mano
  h.pintar = false
  for (const s of ESCALAS) {
    h.s = s
    if (maquetar(h, d, lim) <= PIE - 3 - MIN_NOTAS) {
      elegida = s
      break
    }
  }
  // 2) Si ni con la letra más pequeña: se recorta por el final (el historial primero, luego las oportunidades, preguntas y puntos)
  if (elegida === null) {
    h.s = ESCALAS[ESCALAS.length - 1]
    const pasos: Array<keyof Limites> = ['historial', 'historial', 'oportunidades', 'historial', 'oportunidades', 'preguntas', 'puntos', 'preguntas', 'puntos', 'historial', 'preguntas', 'puntos']
    for (const k of pasos) {
      lim = { ...lim, [k]: Math.max(0, lim[k] - 1) }
      if (maquetar(h, d, lim) <= PIE - 3 - MIN_NOTAS) break
    }
    elegida = h.s
  }
  h.s = elegida
  h.pintar = true
  const y = maquetar(h, d, lim)
  notasAMano(h, Math.min(y + 1, PIE - 3 - 20), d)
  return new Uint8Array(h.doc.output('arraybuffer'))
}
