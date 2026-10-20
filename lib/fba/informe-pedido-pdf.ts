import { jsPDF } from 'jspdf'
import { LOGO_ALTO_PX, LOGO_ANCHO_PX, logoPng } from './excel/logo-marca'
import { COLOR } from './excel/marca'
import type { InformeDePedido, ProductoDeInforme } from './informe-pedido'
import { fuentesDeMarca } from './pdf/fuentes-marca'
import { fechaCorta, fechaLarga, limpio } from './propuesta-excel'

/**
 * EL INFORME DE UN PEDIDO EN PDF, CON LA MARCA DE LIBERTY SELLER.
 * ===============================================================
 * Entra el informe ya calculado (lib/fba/informe-pedido.ts) y salen los bytes del PDF. No toca la
 * base ni la red. Se comprueba con informe-pedido-pdf.prueba.ts, que además lo abre con poppler.
 *
 * Es el documento que se le manda al cliente para decirle cómo va su pedido a día de hoy: cuánto
 * se envió, cuánto ha recibido Amazon, cuánto se ha vendido y a qué ritmo, y cuánto queda y para
 * cuántos días. Tiene el mismo aire que los Excel que ya entregamos (lib/fba/excel/marca.ts): la
 * franja naranja y la banda oscura con el logo, las tarjetas de cifras en crema con filo naranja,
 * las tablas con la cabecera oscura, Sora en los titulares y Inter en el cuerpo.
 *
 *
 * ============ POR QUÉ jsPDF ============
 *
 * Es la que ya usan las facturas (lib/facturacion/pdf.ts) y las etiquetas: funciona en Node sin un
 * navegador detrás. Lo que no hace es recortar las tipografías, y por eso las tres que se usan van
 * recortadas de antemano (lib/fba/pdf/fuentes-marca.ts): el PDF pesa unos 100 KB en vez de medio mega.
 *
 *
 * ============ DE ARRIBA ABAJO ============
 *
 *   portada       banda con el logo, el nombre del pedido, el cliente y las fechas
 *   cifras        siete tarjetas: lo enviado, lo recibido, lo vendido, lo que queda, el ritmo, para
 *                 cuántos días llega y cuánto lleva en el almacén
 *   recorrido     por dónde ha pasado el envío en Amazon (si está enlazado)
 *   en resumen    el pedido contado en cuatro frases
 *   01            en qué ha quedado cada unidad: vendidas, retiradas, en el almacén, sin llegar
 *   02            ventas día a día (con su media de 7 días) y el stock que va quedando
 *   03            lo que Amazon no ha recibido, si falta algo
 *   04            referencia a referencia, con la cabecera repetida en cada página
 *   notas         lo que hay que saber para leer bien las cifras
 *
 * Cada gráfico tiene SU escala: ventas por día y stock que queda no comparten eje —dos medidas
 * distintas en un mismo eje engañan—, por eso van uno al lado del otro y no uno sobre otro.
 */

/* ------------------------------------------------------------------ */
/* Geometría y color                                                   */
/* ------------------------------------------------------------------ */

const ANCHO = 210
const ALTO = 297
const MARGEN = 14
const UTIL = ANCHO - MARGEN * 2
/** Hasta dónde llega el contenido: por debajo va el pie */
const TOPE = ALTO - 20

type Rgb = [number, number, number]
const rgb = (hex: string): Rgb => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]

const C = {
  banda: rgb(COLOR.banda),
  naranja: rgb(COLOR.naranja),
  naranjaClaro: rgb(COLOR.naranjaClaro),
  crema: rgb(COLOR.crema),
  aviso: rgb(COLOR.aviso),
  tinta: rgb(COLOR.tinta),
  etiqueta: rgb(COLOR.etiqueta),
  discreto: rgb(COLOR.discreto),
  apagado: rgb(COLOR.apagado),
  claro: rgb(COLOR.claro),
  raya: rgb(COLOR.raya),
  blanco: rgb(COLOR.blanco),
  // Los mismos del Excel de antigüedad: del verde de lo sano al rojo de lo urgente
  rojo: rgb('D44444'),
  ambar: rgb('E0B43A'),
}

/** Cómo se pinta la etiqueta de rotación de cada producto: fondo y texto */
const CHIP: Record<string, { fondo: Rgb; texto: Rgb }> = {
  Agotado: { fondo: rgb('141414'), texto: rgb('FFFFFF') },
  Rápida: { fondo: rgb('FBE3E0'), texto: rgb('B03030') },
  Media: { fondo: rgb('FBF0D2'), texto: rgb('8A6410') },
  Lenta: { fondo: rgb('E3ECF7'), texto: rgb('2F5F9E') },
  'Sin ventas': { fondo: rgb('ECE8E2'), texto: rgb('5E5852') },
  'En camino': { fondo: rgb('E3ECF7'), texto: rgb('2F5F9E') },
}

/** Los colores de cada parte de «en qué ha quedado cada unidad» */
const COLOR_PARTE: Record<string, Rgb> = {
  vendidas: rgb(COLOR.naranja),
  retiradas: rgb(COLOR.apagado),
  quedan: rgb(COLOR.tinta),
  faltan: rgb('D44444'),
}

/* ------------------------------------------------------------------ */
/* Texto: solo lo que las fuentes tienen                               */
/* ------------------------------------------------------------------ */

/**
 * Las fuentes llevan ASCII, Latin-1, comillas y rayas, «€», «…» y «•» (ver fuentes-marca.ts). Un
 * título de Amazon trae de todo —«™», emojis, flechas—, y un glifo que falta sale como un hueco o
 * como un cuadrado en mitad del nombre. Lo que no está se cambia por su parecido o se quita.
 */
const dentroDelRecorte = (cp: number) =>
  (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || cp === 0x2013 || cp === 0x2014 || (cp >= 0x2018 && cp <= 0x201d) || cp === 0x2022 || cp === 0x2026 || cp === 0x20ac

export function soportado(texto: string): string {
  let salida = ''
  for (const ch of texto.normalize('NFC')) {
    const cp = ch.codePointAt(0) as number
    if (dentroDelRecorte(cp)) salida += ch
    else if (cp === 0x2192) salida += '->'
    else if (cp === 0x2248) salida += '~'
    else if (cp === 0x2212) salida += '-'
    else if (cp < 0x20 || cp === 0x2028 || cp === 0x2029) salida += ' '
    // «™», emojis, letras de otros alfabetos…: sin glifo, se quitan
  }
  return salida.replace(/\s+/g, ' ').trim()
}

const n0 = (x: number) => x.toLocaleString('es-ES')
const n1 = (x: number) => x.toLocaleString('es-ES', { maximumFractionDigits: 1 })

/* ------------------------------------------------------------------ */
/* El lienzo: jsPDF con las fuentes y unos cuantos gestos              */
/* ------------------------------------------------------------------ */

type Fuente = 'titulo' | 'cuerpo' | 'enfasis'

class Lienzo {
  readonly doc: jsPDF
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

  /** Pone la tipografía, el tamaño (en puntos) y el color del texto que viene */
  fuente(f: Fuente, tam: number, color: Rgb = C.tinta): void {
    if (f === 'titulo') this.doc.setFont('Sora', 'bold')
    else if (f === 'enfasis') this.doc.setFont('Inter', 'bold')
    else this.doc.setFont('Inter', 'normal')
    this.doc.setFontSize(tam)
    this.doc.setTextColor(...color)
  }

  ancho(texto: string): number {
    return this.doc.getTextWidth(texto)
  }

  /** Un texto en una línea. `espaciado` separa las letras (para los rótulos en mayúsculas) */
  texto(s: string, x: number, y: number, o: { f: Fuente; tam: number; color?: Rgb; align?: 'left' | 'right' | 'center'; espaciado?: number }): void {
    this.fuente(o.f, o.tam, o.color)
    const t = soportado(s)
    const e = o.espaciado ?? 0
    if (e === 0) {
      this.doc.text(t, x, y, { align: o.align ?? 'left' })
      return
    }
    // jsPDF no cuenta bien el espaciado al alinear a derecha o al centro: se calcula aquí
    const ancho = this.ancho(t) + e * Math.max(0, t.length - 1)
    const x0 = o.align === 'right' ? x - ancho : o.align === 'center' ? x - ancho / 2 : x
    this.doc.text(t, x0, y, { charSpace: e })
  }

  /** Parte un texto en líneas que quepan en `ancho` mm con la tipografía puesta */
  lineas(s: string, ancho: number): string[] {
    return this.doc.splitTextToSize(soportado(s), ancho) as string[]
  }

  /** Recorta con «…» para que quepa en `ancho` mm con la tipografía puesta */
  recortar(s: string, ancho: number): string {
    const t = soportado(s)
    if (this.ancho(t) <= ancho) return t
    let r = t
    while (r.length > 1 && this.ancho(`${r}…`) > ancho) r = r.slice(0, -1)
    return `${r.trimEnd()}…`
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb): void {
    this.doc.setFillColor(...color)
    this.doc.rect(x, y, w, h, 'F')
  }

  redondeado(x: number, y: number, w: number, h: number, r: number, color: Rgb): void {
    this.doc.setFillColor(...color)
    this.doc.roundedRect(x, y, w, h, r, r, 'F')
  }

  linea(x1: number, y1: number, x2: number, y2: number, color: Rgb, grosor: number, discontinua = false): void {
    this.doc.setDrawColor(...color)
    this.doc.setLineWidth(grosor)
    this.doc.setLineDashPattern(discontinua ? [0.8, 0.8] : [], 0)
    this.doc.line(x1, y1, x2, y2)
    this.doc.setLineDashPattern([], 0)
  }

  logo(x: number, y: number, ancho: number): void {
    this.doc.addImage(logoPng(), 'PNG', x, y, ancho, (ancho * LOGO_ALTO_PX) / LOGO_ANCHO_PX)
  }

  /** Si lo que viene no cabe en lo que queda de página, abre otra */
  necesito(alto: number, nueva: () => void): void {
    if (this.y + alto > TOPE) nueva()
  }
}

/* ------------------------------------------------------------------ */
/* Las piezas                                                          */
/* ------------------------------------------------------------------ */

interface Tarjeta {
  rotulo: string
  valor: string
  unidad?: string
  sub: string
  /** Pinta la cifra en rojo o ámbar */
  aviso?: 'rojo' | 'ambar'
}

function tarjetasDe(i: InformeDePedido): { fila1: Tarjeta[]; fila2: Tarjeta[] } {
  const c = i.cifras
  const enCamino = i.recepcion === 'en_camino'
  const sobre = i.recepcion === 'contada' ? 'recibido' : 'enviado'
  const noVentas = c.vendidas - c.ventasReales

  const recibidas: Tarjeta =
    i.recepcion === 'contada'
      ? { rotulo: 'RECIBIDAS', valor: n0(c.recibidas ?? 0), sub: c.faltan > 0 ? `faltan ${n0(c.faltan)}` : `${c.pctRecibido} % de lo enviado`, aviso: c.faltan > 0 ? 'ambar' : undefined }
      : { rotulo: 'RECIBIDAS', valor: '—', sub: enCamino ? 'va de camino' : 'sin confirmar por Amazon' }

  const dias = i.diasDeVida
  const durar = c.cobertura !== null ? Math.max(1, Math.round(c.cobertura)) : null

  return {
    fila1: [
      { rotulo: 'ENVIADAS', valor: n0(c.enviadas), sub: `${n0(c.referencias)} referencia${c.referencias === 1 ? '' : 's'}` },
      recibidas,
      enCamino
        ? { rotulo: 'VENDIDAS', valor: '—', sub: 'todavía no ha llegado' }
        : { rotulo: 'VENDIDAS', valor: n0(c.vendidas), sub: `${c.pctVendido} % de lo ${sobre}${noVentas > 0 ? ` · ${n0(noVentas)} no son ventas` : ''}` },
      enCamino
        ? { rotulo: 'EN EL ALMACÉN', valor: '—', sub: 'cuando llegue' }
        : { rotulo: 'EN EL ALMACÉN', valor: n0(c.quedan), sub: `${c.pctQuedan} %${c.agotadas > 0 ? ` · ${n0(c.agotadas)} agotada${c.agotadas === 1 ? '' : 's'}` : ''}` },
    ],
    fila2: [
      enCamino
        ? { rotulo: 'VELOCIDAD DE VENTA', valor: '—', sub: 'sin ventas todavía' }
        : { rotulo: 'VELOCIDAD DE VENTA', valor: n1(c.udDia7), unidad: 'ud/día', sub: `última semana · ${n1(c.udDiaTotal)} de media desde que ${i.llegada ? 'llegó' : 'se envió'}` },
      enCamino
        ? { rotulo: 'EL STOCK DURA', valor: '—', sub: 'sin ventas todavía' }
        : c.quedan <= 0
          ? { rotulo: 'EL STOCK DURA', valor: 'Agotado', sub: 'no queda nada de este pedido' }
          : durar === null
            ? { rotulo: 'EL STOCK DURA', valor: '—', sub: 'sin ventas esta semana' }
            : durar > 365
              ? { rotulo: 'EL STOCK DURA', valor: '+365', unidad: 'días', sub: 'más de un año al ritmo de la última semana' }
              : {
                  rotulo: 'EL STOCK DURA',
                  valor: n0(durar),
                  unidad: durar === 1 ? 'día' : 'días',
                  sub: c.seAgotaEl ? `se agota hacia el ${fechaCorta(c.seAgotaEl)}` : '',
                  aviso: durar < 7 ? 'rojo' : durar < 14 ? 'ambar' : undefined,
                },
      enCamino || dias === null
        ? { rotulo: 'EN EL ALMACÉN DESDE', valor: '—', sub: 'todavía no ha llegado' }
        : {
            rotulo: 'EN EL ALMACÉN DESDE',
            valor: n0(dias),
            unidad: dias === 1 ? 'día' : 'días',
            sub: i.llegada ? `llegó el ${fechaLarga(i.llegada)}` : `desde el envío, el ${fechaLarga(i.fechaEnvio)}`,
          },
    ],
  }
}

function dibujarTarjeta(l: Lienzo, x: number, y: number, w: number, h: number, t: Tarjeta): void {
  l.rect(x, y, w, h, C.crema)
  l.rect(x, y, w, 0.8, C.naranja)
  l.texto(t.rotulo, x + 4, y + 6.6, { f: 'enfasis', tam: 6.1, color: C.etiqueta, espaciado: 0.22 })

  const color = t.aviso === 'rojo' ? C.rojo : t.aviso === 'ambar' ? rgb('B98A12') : C.tinta
  const tam = t.valor.length > 7 ? 15 : 21
  l.texto(t.valor, x + 4, y + 15.4, { f: 'titulo', tam, color })
  if (t.unidad) {
    l.fuente('titulo', tam, color)
    const ancho = l.ancho(soportado(t.valor))
    l.texto(t.unidad, x + 4 + ancho + 1.6, y + 15.4, { f: 'cuerpo', tam: 8.2, color: C.etiqueta })
  }
  if (t.sub) {
    l.fuente('cuerpo', 7)
    const partes = l.lineas(t.sub, w - 8).slice(0, 2)
    partes.forEach((p, k) => l.texto(p, x + 4, y + 20.4 + k * 3.3, { f: 'cuerpo', tam: 7, color: C.etiqueta }))
  }
}

/** La banda de la primera página: devuelve dónde acaba */
function portada(l: Lienzo, i: InformeDePedido): number {
  l.rect(0, 0, ANCHO, 3, C.naranja)

  // El título parte en dos líneas como mucho; si hay más, la segunda acaba en «…» en vez de perder el resto sin avisar
  l.fuente('titulo', 20)
  const todas = l.lineas(i.titulo, UTIL)
  const titulo = todas.slice(0, 2)
  if (todas.length > 2) titulo[1] = l.recortar(`${titulo[1]} ${todas.slice(2).join(' ')}`, UTIL - 2)
  const sub: string[] = []
  if (i.referenciaEnvio) sub.push(i.referenciaEnvio)
  sub.push(`Enviado el ${fechaLarga(i.fechaEnvio)}`)
  if (i.llegada) sub.push(`Llegó el ${fechaLarga(i.llegada)}`)
  if (i.destinos.length > 0) sub.push(`Destino ${i.destinos.slice(0, 3).join(', ')}${i.destinos.length > 3 ? '…' : ''}`)
  sub.push(`Estado en Amazon: ${i.estadoTexto}`)
  l.fuente('cuerpo', 8.2)
  const subLineas = l.lineas(sub.join('  ·  '), UTIL).slice(0, 2)

  const alto = 36 + titulo.length * 8.6 + subLineas.length * 4.2
  l.rect(0, 3, ANCHO, alto, C.banda)

  l.logo(MARGEN, 10.5, 44)
  l.texto('INFORME DE PEDIDO', ANCHO - MARGEN, 13.6, { f: 'titulo', tam: 7.2, color: C.naranja, align: 'right', espaciado: 0.35 })
  l.texto(`a ${fechaLarga(i.hoy)}`, ANCHO - MARGEN, 18.4, { f: 'cuerpo', tam: 8, color: C.apagado, align: 'right' })
  // El informe es «a día de hoy», pero las ventas llegan de Amazon con retraso: se dice hasta cuándo están
  if (i.ventasHasta && i.recepcion !== 'en_camino') l.texto(`ventas leídas hasta el ${fechaLarga(i.ventasHasta)}`, ANCHO - MARGEN, 22.4, { f: 'cuerpo', tam: 7, color: C.apagado, align: 'right' })

  let y = 30.5
  for (const t of titulo) {
    l.texto(t, MARGEN, y, { f: 'titulo', tam: 20, color: C.blanco })
    y += 8.6
  }
  l.fuente('titulo', 12.5)
  l.texto(l.recortar(i.cliente, UTIL), MARGEN, y + 0.8, { f: 'titulo', tam: 12.5, color: C.naranja })
  y += 8.2
  for (const t of subLineas) {
    l.texto(t, MARGEN, y, { f: 'cuerpo', tam: 8.2, color: C.claro })
    y += 4.2
  }
  return 3 + alto
}

/** La cabecera pequeña de las páginas que siguen */
function cabeceraCorta(l: Lienzo, i: InformeDePedido): number {
  l.rect(0, 0, ANCHO, 2, C.naranja)
  l.rect(0, 2, ANCHO, 11, C.banda)
  l.logo(MARGEN, 5.2, 27)
  l.texto(`${i.titulo}  ·  ${i.cliente}`, ANCHO - MARGEN, 8.9, { f: 'cuerpo', tam: 7.6, color: C.claro, align: 'right' })
  return 21
}

/** «01  EN QUÉ HA QUEDADO CADA UNIDAD» y la raya naranja debajo */
function seccion(l: Lienzo, numero: string, kicker: string, titulo: string): void {
  const y = l.y
  l.texto(numero, MARGEN, y + 3.6, { f: 'titulo', tam: 8, color: C.discreto })
  l.texto(kicker, MARGEN + 7, y + 3.6, { f: 'enfasis', tam: 6.8, color: C.etiqueta, espaciado: 0.3 })
  l.texto(titulo, MARGEN, y + 11, { f: 'titulo', tam: 13, color: C.tinta })
  l.rect(MARGEN, y + 14, UTIL, 0.9, C.naranja)
  l.y = y + 19
}

/** Un recuadro crema con filo naranja y texto en párrafos. Devuelve su alto */
function recuadro(l: Lienzo, titulo: string, parrafos: string[], opciones: { x?: number; ancho?: number; tam?: number } = {}): number {
  const x = opciones.x ?? MARGEN
  const ancho = opciones.ancho ?? UTIL
  const tam = opciones.tam ?? 8.8
  const interlineado = tam * 0.5
  const dentro = ancho - 12
  l.fuente('cuerpo', tam)
  const bloques = parrafos.map((p) => l.lineas(p, dentro))
  // El primer renglón cae a 11,6 mm del borde; el resto, a su interlineado y a 2 mm entre párrafos; y 4,5 mm de aire debajo del último
  const renglones = bloques.reduce((s, b) => s + b.length, 0)
  const alto = 11.6 + (renglones - 1) * interlineado + (bloques.length - 1) * 2 + 4.5
  l.rect(x, l.y, ancho, alto, C.aviso)
  l.rect(x, l.y, 1.2, alto, C.naranja)
  l.texto(titulo, x + 6, l.y + 6.2, { f: 'titulo', tam: 6.8, color: C.naranja, espaciado: 0.3 })
  let y = l.y + 11.6
  for (const b of bloques) {
    for (const linea of b) {
      l.texto(linea, x + 6, y, { f: 'cuerpo', tam, color: C.tinta })
      y += interlineado
    }
    y += 2
  }
  return alto
}

/** El recorrido del envío en Amazon: seis pasos en una línea, con el día en que se vio cada uno */
function recorrido(l: Lienzo, i: InformeDePedido): void {
  if (i.pasos.length === 0) return
  const y = l.y
  const n = i.pasos.length
  const paso = (UTIL - 14) / (n - 1)
  const x0 = MARGEN + 7
  const yLinea = y + 4.2
  // La línea de fondo y, encima, la parte ya recorrida
  l.linea(x0, yLinea, x0 + paso * (n - 1), yLinea, C.raya, 0.6)
  const ultimoHecho = i.pasos.reduce((m, p, k) => (p.hecho ? k : m), -1)
  if (ultimoHecho > 0) l.linea(x0, yLinea, x0 + paso * ultimoHecho, yLinea, C.naranja, 0.6)
  i.pasos.forEach((p, k) => {
    const x = x0 + paso * k
    l.doc.setFillColor(...(p.hecho ? C.naranja : C.blanco))
    l.doc.setDrawColor(...(p.hecho ? C.naranja : C.apagado))
    l.doc.setLineWidth(0.4)
    l.doc.circle(x, yLinea, 1.7, 'FD')
    l.texto(p.texto, x, yLinea + 6.2, { f: p.hecho ? 'enfasis' : 'cuerpo', tam: 6.8, color: p.hecho ? C.tinta : C.discreto, align: 'center' })
    if (p.fecha) l.texto(fechaCorta(p.fecha), x, yLinea + 9.6, { f: 'cuerpo', tam: 6.2, color: C.discreto, align: 'center' })
  })
  l.y = y + 17
}

/** En qué ha quedado cada unidad: una barra partida y su leyenda */
function embudo(l: Lienzo, i: InformeDePedido): void {
  if (i.recepcion === 'en_camino') {
    const alto = 11
    l.rect(MARGEN, l.y, UTIL, alto, C.crema)
    l.texto(`Las ${n0(i.cifras.enviadas)} unidades van de camino: todavía no hay nada vendido ni en el almacén.`, MARGEN + 4, l.y + 6.9, { f: 'cuerpo', tam: 8.4, color: C.etiqueta })
    l.y += alto + 4
    return
  }
  // Las partes que valen la pena enseñar: «no han llegado» solo si Amazon ha contado, y las retiradas solo si las hay
  const partes = i.embudo.filter((p) => (p.id === 'faltan' ? i.recepcion === 'contada' : p.id === 'retiradas' ? p.unidades > 0 : true))
  const total = partes.reduce((s, p) => s + p.unidades, 0)
  const alto = 8
  const hueco = 0.6
  let x = MARGEN
  const visibles = partes.filter((p) => p.unidades > 0)
  const util = UTIL - hueco * Math.max(0, visibles.length - 1)
  l.rect(MARGEN, l.y, UTIL, alto, C.raya)
  visibles.forEach((p) => {
    const w = Math.max(0.9, (p.unidades / Math.max(1, total)) * util)
    l.rect(x, l.y, w, alto, COLOR_PARTE[p.id])
    x += w + hueco
  })
  // La leyenda: tantas columnas como partes
  const col = UTIL / partes.length
  partes.forEach((p, k) => {
    const cx = MARGEN + col * k
    const cy = l.y + alto + 7
    l.rect(cx, cy - 2.6, 2.6, 2.6, COLOR_PARTE[p.id])
    l.texto(p.texto, cx + 4, cy - 0.2, { f: 'enfasis', tam: 7.2, color: C.etiqueta })
    l.texto(n0(p.unidades), cx, cy + 6.4, { f: 'titulo', tam: 12.5, color: C.tinta })
    l.fuente('titulo', 12.5)
    l.texto(`${p.pct} %`, cx + l.ancho(n0(p.unidades)) + 2.2, cy + 6.4, { f: 'cuerpo', tam: 7.6, color: C.discreto })
  })
  l.y += alto + 7 + 12
}

/** Un número redondo por encima del máximo para que la escala termine en algo legible */
function techo(max: number): number {
  if (max <= 0) return 1
  const e = Math.pow(10, Math.floor(Math.log10(max)))
  const m = max / e
  const paso = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10
  return paso * e
}

/** Los dos gráficos: ventas por día (con la media de siete) y stock que queda. Cada uno con su escala */
function graficos(l: Lienzo, i: InformeDePedido): void {
  const serie = i.serie
  const anchoPanel = (UTIL - 8) / 2
  const alto = 52
  const yTop = l.y
  const plotH = 30
  const margenIz = 8

  const etiquetasX = (x0: number, w: number, y: number) => {
    const n = serie.length
    const marcas = n <= 2 ? [0, n - 1] : n <= 6 ? serie.map((_, k) => k) : [0, Math.round((n - 1) / 2), n - 1]
    for (const k of [...new Set(marcas)]) {
      const x = n === 1 ? x0 + w / 2 : x0 + (w * (k + 0.5)) / n
      const f = fechaCorta(serie[k].fecha).slice(0, 5)
      l.texto(f, x, y, { f: 'cuerpo', tam: 6.2, color: C.discreto, align: k === 0 && n > 2 ? 'left' : k === n - 1 && n > 2 ? 'right' : 'center' })
    }
  }

  /* ---------- ventas por día ---------- */
  {
    const x = MARGEN
    l.texto('Ventas por día', x, yTop + 3.4, { f: 'enfasis', tam: 7.8, color: C.tinta })
    l.texto('unidades', x + anchoPanel, yTop + 3.4, { f: 'cuerpo', tam: 6.6, color: C.discreto, align: 'right' })
    const px = x + margenIz
    const pw = anchoPanel - margenIz
    const py = yTop + 8
    const diarias = serie.map((d) => Math.max(0, d.vendidas))
    const media = diarias.map((_, k) => {
      const desde = Math.max(0, k - 6)
      const trozo = diarias.slice(desde, k + 1)
      return trozo.reduce((s, v) => s + v, 0) / trozo.length
    })
    const max = techo(Math.max(1, ...diarias, ...media))
    for (const f of [0, 0.5, 1]) {
      const yy = py + plotH - plotH * f
      l.linea(px, yy, px + pw, yy, C.raya, 0.2)
      l.texto(n0(Math.round(max * f * 10) / 10), px - 1.6, yy + 0.8, { f: 'cuerpo', tam: 6.2, color: C.discreto, align: 'right' })
    }
    const n = serie.length
    const paso = pw / Math.max(1, n)
    const grosor = Math.min(3.2, Math.max(0.5, paso * 0.72))
    diarias.forEach((v, k) => {
      if (v <= 0) return
      const h = Math.max(0.35, (v / max) * plotH)
      l.rect(px + paso * k + (paso - grosor) / 2, py + plotH - h, grosor, h, C.naranja)
    })
    // La media de siete días: la velocidad de verdad, sin los altibajos de cada día
    if (n >= 2) {
      l.doc.setDrawColor(...C.tinta)
      l.doc.setLineWidth(0.45)
      for (let k = 1; k < n; k += 1) {
        l.doc.line(px + paso * (k - 1) + paso / 2, py + plotH - (media[k - 1] / max) * plotH, px + paso * k + paso / 2, py + plotH - (media[k] / max) * plotH)
      }
    }
    l.linea(px, py + plotH, px + pw, py + plotH, C.apagado, 0.3)
    etiquetasX(px, pw, py + plotH + 4)
    // Leyenda
    const ly = yTop + alto - 1.5
    l.rect(px, ly - 2.1, 2.4, 2.4, C.naranja)
    l.texto('ventas del día', px + 3.6, ly, { f: 'cuerpo', tam: 6.6, color: C.etiqueta })
    l.linea(px + 26, ly - 0.9, px + 30, ly - 0.9, C.tinta, 0.45)
    l.texto('media de 7 días', px + 31.4, ly, { f: 'cuerpo', tam: 6.6, color: C.etiqueta })
    if (diarias.every((v) => v === 0)) l.texto('Sin ventas todavía', px + pw / 2, py + plotH / 2 + 1, { f: 'cuerpo', tam: 8, color: C.discreto, align: 'center' })
  }

  /* ---------- stock que queda ---------- */
  {
    const x = MARGEN + anchoPanel + 8
    l.texto('Stock que queda del pedido', x, yTop + 3.4, { f: 'enfasis', tam: 7.8, color: C.tinta })
    l.texto('unidades', x + anchoPanel, yTop + 3.4, { f: 'cuerpo', tam: 6.6, color: C.discreto, align: 'right' })
    const px = x + margenIz
    const pw = anchoPanel - margenIz
    const py = yTop + 8
    const quedan = serie.map((d) => d.quedan)
    const max = techo(Math.max(1, ...quedan))
    for (const f of [0, 0.5, 1]) {
      const yy = py + plotH - plotH * f
      l.linea(px, yy, px + pw, yy, C.raya, 0.2)
      l.texto(n0(Math.round(max * f * 10) / 10), px - 1.6, yy + 0.8, { f: 'cuerpo', tam: 6.2, color: C.discreto, align: 'right' })
    }
    const n = serie.length
    const paso = pw / Math.max(1, n)
    const pos = (k: number): [number, number] => [px + paso * k + paso / 2, py + plotH - (quedan[k] / max) * plotH]
    if (n >= 2) {
      // El área bajo la línea, en crema, y la línea encima
      const doc = l.doc
      doc.setFillColor(...C.crema)
      const puntos = quedan.map((_, k) => pos(k))
      const trazo: Array<[number, number]> = []
      for (let k = 1; k < puntos.length; k += 1) trazo.push([puntos[k][0] - puntos[k - 1][0], puntos[k][1] - puntos[k - 1][1]])
      doc.lines(
        [...trazo, [0, py + plotH - puntos[puntos.length - 1][1]], [-(puntos[puntos.length - 1][0] - puntos[0][0]), 0]],
        puntos[0][0],
        puntos[0][1],
        [1, 1],
        'F',
        true
      )
      doc.setDrawColor(...C.tinta)
      doc.setLineWidth(0.5)
      for (let k = 1; k < n; k += 1) doc.line(puntos[k - 1][0], puntos[k - 1][1], puntos[k][0], puntos[k][1])
    }
    // El punto de hoy y cuánto queda, escrito al lado
    const [ux, uy] = pos(n - 1)
    l.doc.setFillColor(...C.tinta)
    l.doc.circle(ux, uy, 0.9, 'F')
    const etiqueta = n0(quedan[n - 1])
    l.texto(etiqueta, Math.min(ux, px + pw - 1), Math.max(py + 2.4, uy - 2.2), { f: 'titulo', tam: 8, color: C.tinta, align: 'right' })
    l.linea(px, py + plotH, px + pw, py + plotH, C.apagado, 0.3)
    etiquetasX(px, pw, py + plotH + 4)
    const ly = yTop + alto - 1.5
    l.rect(px, ly - 2.1, 2.4, 2.4, C.tinta)
    l.texto('lo que queda en el almacén al acabar cada día', px + 3.6, ly, { f: 'cuerpo', tam: 6.6, color: C.etiqueta })
  }
  l.y = yTop + alto + 5
}

/* ------------------------------------------------------------------ */
/* Las tablas                                                          */
/* ------------------------------------------------------------------ */

interface Columna {
  titulo: string
  ancho: number
  derecha?: boolean
}

/** Los títulos pueden llevar «\n»: dos líneas, para lo que no cabe en una columna estrecha («DÍAS DE / STOCK») */
function cabeceraDeTabla(l: Lienzo, columnas: Columna[]): void {
  const dos = columnas.some((c) => c.titulo.includes('\n'))
  const alto = dos ? 9.6 : 7.6
  l.rect(MARGEN, l.y, UTIL, alto, C.banda)
  l.rect(MARGEN, l.y, UTIL, 0.6, C.naranja)
  let x = MARGEN
  for (const c of columnas) {
    const pad = 2.2
    const lineas = c.titulo.split('\n')
    lineas.forEach((t, k) => {
      const y = lineas.length === 2 ? l.y + 4.3 + k * 2.9 : l.y + (dos ? 5.9 : 5)
      if (c.derecha) l.texto(t, x + c.ancho - pad, y, { f: 'titulo', tam: 5.9, color: C.blanco, align: 'right', espaciado: 0.1 })
      else l.texto(t, x + pad, y, { f: 'titulo', tam: 5.9, color: C.blanco, espaciado: 0.1 })
    })
    x += c.ancho
  }
  l.y += alto
}

function chip(l: Lienzo, x: number, y: number, texto: string): void {
  const est = CHIP[texto] ?? CHIP['Sin ventas']
  const ancho = 15.4
  l.redondeado(x, y, ancho, 4.4, 2.2, est.fondo)
  l.texto(texto, x + ancho / 2, y + 3.05, { f: 'titulo', tam: 5.6, color: est.texto, align: 'center' })
}

function tablaDeProductos(l: Lienzo, i: InformeDePedido, nuevaPagina: () => void): void {
  const sobre = i.recepcion === 'contada'
  const enCamino = i.recepcion === 'en_camino'
  const columnas: Columna[] = [
    { titulo: 'PRODUCTO', ancho: 63 },
    { titulo: 'ENV.', ancho: 12, derecha: true },
    { titulo: 'REC.', ancho: 12, derecha: true },
    { titulo: 'VEND.', ancho: 14, derecha: true },
    { titulo: 'QUEDAN', ancho: 15, derecha: true },
    { titulo: '% VENDIDO', ancho: 24, derecha: true },
    { titulo: 'UD/DÍA\n7 DÍAS', ancho: 14, derecha: true },
    { titulo: 'DÍAS DE\nSTOCK', ancho: 11, derecha: true },
    { titulo: 'ROTACIÓN', ancho: 17 },
  ]
  const x = (k: number) => MARGEN + columnas.slice(0, k).reduce((s, c) => s + c.ancho, 0)
  const alturaFila = 8.6

  l.necesito(9.6 + alturaFila * 3, nuevaPagina)
  cabeceraDeTabla(l, columnas)

  i.productos.forEach((p: ProductoDeInforme, k) => {
    if (l.y + alturaFila > TOPE) {
      nuevaPagina()
      cabeceraDeTabla(l, columnas)
    }
    const y = l.y
    if (k % 2 === 0) l.rect(MARGEN, y, UTIL, alturaFila, C.crema)
    l.linea(MARGEN, y + alturaFila, MARGEN + UTIL, y + alturaFila, C.raya, 0.15)

    // El producto: el SKU arriba —es lo que lo distingue; los títulos de Amazon empiezan todos igual— y,
    // debajo, el nombre recortado. La variante (talla, color) va junto al SKU
    l.fuente('enfasis', 7.4)
    const sku = l.recortar(p.sku, columnas[0].ancho - 4.4)
    l.texto(sku, x(0) + 2.2, y + 3.7, { f: 'enfasis', tam: 7.4, color: C.tinta })
    if (p.variante) {
      l.fuente('enfasis', 7.4)
      const usado = l.ancho(sku)
      l.fuente('cuerpo', 6.8)
      l.texto(l.recortar(`·  ${p.variante}`, Math.max(0, columnas[0].ancho - 4.4 - usado - 2)), x(0) + 2.2 + usado + 2, y + 3.7, { f: 'cuerpo', tam: 6.8, color: C.etiqueta })
    }
    l.fuente('cuerpo', 6.4)
    l.texto(l.recortar(p.nombre?.trim() || '—', columnas[0].ancho - 4.4), x(0) + 2.2, y + 7, { f: 'cuerpo', tam: 6.4, color: C.discreto })

    const cy = y + 5.5
    const num = (texto: string, col: number, o: { f?: Fuente; color?: Rgb } = {}) => l.texto(texto, x(col) + columnas[col].ancho - 2.2, cy, { f: o.f ?? 'cuerpo', tam: 7.5, color: o.color ?? C.tinta, align: 'right' })
    num(n0(p.enviadas), 1, { color: C.etiqueta })
    num(sobre && p.recibidas !== null ? n0(p.recibidas) : '—', 2, { color: sobre && p.recibidas !== null && p.recibidas < p.enviadas ? C.rojo : C.etiqueta, f: sobre && p.recibidas !== null && p.recibidas < p.enviadas ? 'enfasis' : 'cuerpo' })
    num(enCamino ? '—' : n0(p.vendidas), 3)
    num(n0(p.quedan), 4, { f: 'enfasis' })
    // El porcentaje vendido, con su barrita
    const bx = x(5) + 2.4
    l.rect(bx, cy - 1.7, 10, 1.7, C.raya)
    if (!enCamino) l.rect(bx, cy - 1.7, Math.max(0, Math.min(10, (p.pct / 100) * 10)), 1.7, C.naranja)
    l.texto(enCamino ? '—' : `${n0(Math.round(p.pct))} %`, x(5) + columnas[5].ancho - 2.2, cy, { f: 'cuerpo', tam: 7.5, color: enCamino ? C.etiqueta : C.tinta, align: 'right' })
    num(p.udDia7 > 0 ? n1(p.udDia7) : '—', 6, { color: C.etiqueta })
    num(p.quedan > 0 && p.cobertura !== null ? n0(Math.max(1, Math.round(p.cobertura))) : '—', 7, { color: p.cobertura !== null && p.cobertura < 7 && p.quedan > 0 ? C.rojo : C.etiqueta })
    chip(l, x(8) + 0.4, y + 2.1, enCamino ? 'En camino' : p.rotacion)
    l.y += alturaFila
  })
  l.y += 4
}

function tablaDeLoQueNoLlego(l: Lienzo, i: InformeDePedido): void {
  const columnas: Columna[] = [
    { titulo: 'PRODUCTO', ancho: 110 },
    { titulo: 'ENVIADAS', ancho: 24, derecha: true },
    { titulo: 'RECIBIDAS', ancho: 24, derecha: true },
    { titulo: 'FALTAN', ancho: 24, derecha: true },
  ]
  const x = (k: number) => MARGEN + columnas.slice(0, k).reduce((s, c) => s + c.ancho, 0)
  const alturaFila = 7
  const maximo = 12
  cabeceraDeTabla(l, columnas)
  i.noLlegaron.slice(0, maximo).forEach((p, k) => {
    const y = l.y
    if (k % 2 === 0) l.rect(MARGEN, y, UTIL, alturaFila, C.crema)
    l.linea(MARGEN, y + alturaFila, MARGEN + UTIL, y + alturaFila, C.raya, 0.15)
    l.fuente('enfasis', 7.4)
    const sku = l.recortar(p.sku, 46)
    l.texto(sku, x(0) + 2.2, y + 4.4, { f: 'enfasis', tam: 7.4, color: C.tinta })
    l.fuente('cuerpo', 6.6)
    l.texto(l.recortar([p.variante, p.nombre?.trim()].filter(Boolean).join('  ·  ') || '—', 58), x(0) + 52, y + 4.4, { f: 'cuerpo', tam: 6.6, color: C.discreto })
    l.texto(n0(p.enviadas), x(1) + columnas[1].ancho - 2.2, y + 4.4, { f: 'cuerpo', tam: 7.5, color: C.etiqueta, align: 'right' })
    l.texto(n0(p.recibidas), x(2) + columnas[2].ancho - 2.2, y + 4.4, { f: 'cuerpo', tam: 7.5, color: C.etiqueta, align: 'right' })
    l.texto(n0(p.faltan), x(3) + columnas[3].ancho - 2.2, y + 4.4, { f: 'enfasis', tam: 7.5, color: C.rojo, align: 'right' })
    l.y += alturaFila
  })
  if (i.noLlegaron.length > maximo) {
    const resto = i.noLlegaron.slice(maximo)
    l.texto(`…y ${n0(resto.length)} referencia${resto.length === 1 ? '' : 's'} más (${n0(resto.reduce((s, p) => s + p.faltan, 0))} unidades)`, MARGEN + 2.2, l.y + 5, { f: 'cuerpo', tam: 7, color: C.discreto })
    l.y += 7
  }
  l.y += 4
}

/* ------------------------------------------------------------------ */
/* El documento                                                        */
/* ------------------------------------------------------------------ */

export interface PdfDeInforme {
  pdf: Uint8Array
  paginas: number
  /** Ya limpio y en ASCII: sirve tal cual para la cabecera Content-Disposition */
  nombreFichero: string
}

export function pdfDeInforme(i: InformeDePedido): PdfDeInforme {
  const l = new Lienzo()
  const doc = l.doc
  doc.setProperties({
    title: `Informe de pedido · ${i.titulo} · ${i.cliente}`,
    subject: `Cómo está el pedido a ${fechaLarga(i.hoy)}`,
    author: 'Liberty Seller',
    creator: 'Liberty Seller Hub',
  })

  const nuevaPagina = () => {
    doc.addPage()
    l.y = cabeceraCorta(l, i)
  }

  /* ---------- portada y cifras ---------- */
  l.y = portada(l, i) + 7
  const { fila1, fila2 } = tarjetasDe(i)
  const hueco = 3
  const alto = 25.5
  const w1 = (UTIL - hueco * 3) / 4
  fila1.forEach((t, k) => dibujarTarjeta(l, MARGEN + (w1 + hueco) * k, l.y, w1, alto, t))
  l.y += alto + hueco
  const w2 = (UTIL - hueco * 2) / 3
  fila2.forEach((t, k) => dibujarTarjeta(l, MARGEN + (w2 + hueco) * k, l.y, w2, alto, t))
  l.y += alto + 7

  /* ---------- el recorrido y el resumen ---------- */
  if (i.pasos.length > 0) recorrido(l, i)
  l.y += recuadro(l, 'EN RESUMEN', i.resumen) + 8

  /* ---------- las secciones, numeradas según salgan ---------- */
  let numero = 0
  const siguiente = () => String(++numero).padStart(2, '0')

  const seccionDeUnidades = () => {
    l.necesito(52, nuevaPagina)
    seccion(l, siguiente(), 'DEL ENVÍO AL ALMACÉN', 'En qué ha quedado cada unidad')
    embudo(l, i)
  }
  const seccionDeVentas = () => {
    l.necesito(19 + 58, nuevaPagina)
    seccion(l, siguiente(), 'VELOCIDAD DE VENTA', 'Ventas día a día y stock que queda')
    graficos(l, i)
  }

  // Lo que más dice del pedido cabe en la primera página: si ya hay ventas, los gráficos van primero y
  // lo de las unidades —que repiten las tarjetas— pasa a la segunda; sin ventas, sobra sitio para empezar por las unidades
  if (i.serie.length > 0) {
    seccionDeVentas()
    seccionDeUnidades()
  } else {
    seccionDeUnidades()
  }

  /* ---------- lo que no ha llegado ---------- */
  if (i.noLlegaron.length > 0) {
    l.necesito(19 + 9.6 + 7 * Math.min(4, i.noLlegaron.length), nuevaPagina)
    seccion(l, siguiente(), 'LO QUE AMAZON NO HA RECIBIDO', `Faltan ${n0(i.cifras.faltan)} unidades en ${n0(i.noLlegaron.length)} referencia${i.noLlegaron.length === 1 ? '' : 's'}`)
    tablaDeLoQueNoLlego(l, i)
  }

  /* ---------- referencia a referencia ---------- */
  if (i.productos.length > 0) {
    l.necesito(19 + 9.6 + 8.6 * 3, nuevaPagina)
    seccion(l, siguiente(), 'DETALLE', 'Referencia a referencia')
    tablaDeProductos(l, i, nuevaPagina)
  }

  /* ---------- lo que hay que saber ---------- */
  if (i.avisos.length > 0) {
    l.fuente('cuerpo', 8)
    const estimado = 11.6 + i.avisos.reduce((s, a) => s + l.lineas(a, UTIL - 12).length * 4, 0) + i.avisos.length * 2 + 4.5
    l.necesito(estimado + 4, nuevaPagina)
    l.y += recuadro(l, 'A TENER EN CUENTA', i.avisos, { tam: 8 }) + 4
  }

  /* ---------- el pie de cada página, ya sabiendo cuántas son ---------- */
  const paginas = doc.getNumberOfPages()
  for (let p = 1; p <= paginas; p += 1) {
    doc.setPage(p)
    l.linea(MARGEN, ALTO - 13, ANCHO - MARGEN, ALTO - 13, C.raya, 0.25)
    l.texto(`Liberty Seller  ·  Informe generado el ${fechaLarga(i.hoy)}`, MARGEN, ALTO - 8.4, { f: 'cuerpo', tam: 6.8, color: C.discreto })
    l.texto(`Página ${p} de ${paginas}`, ANCHO - MARGEN, ALTO - 8.4, { f: 'cuerpo', tam: 6.8, color: C.discreto, align: 'right' })
  }

  const nombreFichero = `informe-pedido-${limpio(i.cliente) || 'cliente'}-${limpio(i.titulo, 32) || 'pedido'}-${i.hoy}.pdf`
  return { pdf: new Uint8Array(doc.output('arraybuffer')), paginas, nombreFichero }
}
