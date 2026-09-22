import { jsPDF } from 'jspdf'
import { anchoEnModulos, code128B } from './code128'

/**
 * LAS ETIQUETAS DE PRODUCTO QUE VAN PEGADAS EN CADA UNIDAD.
 * ========================================================
 *
 * Amazon las llama «item labels» y son lo primero que hay que imprimir de un
 * envío: cada unidad física lleva una pegatina con su FNSKU. Sin ellas el
 * almacén no sabe de quién es el producto.
 *
 *
 * ============ ESTO NO SE LE PIDE A AMAZON ============
 *
 * La API tiene `getLabels`, pero eso son las etiquetas de CAJA y solo existen
 * cuando el envío ya está confirmado. Las de producto se pueden hacer con lo que
 * ya sabemos —el FNSKU, el título y la condición— y hacerlas aquí tiene tres
 * ventajas que no son pequeñas:
 *
 *   · Se imprimen en la fase de borrador, ANTES de crear nada en Amazon. Que es
 *     justo cuando el cliente está etiquetando la mercancía.
 *   · No gastan cupo de la API ni dependen de que Amazon conteste.
 *   · Si falta el FNSKU de una referencia, se ve aquí y no en el almacén.
 *
 *
 * ============ LO QUE EXIGE AMAZON ============
 *
 * Especificación de «item label»:
 *   · Código de barras CODE 128.
 *   · Entre 25×51 mm y 51×76 mm.
 *   · Tiene que llevar el FNSKU en texto, el título del producto y la condición.
 *   · Negro sobre blanco, sin brillo, 300 ppp o más.
 *
 * El título se recorta a lo que quepa: es informativo para quien pega, mientras
 * que lo que lee el escáner es el código. Recortarlo es correcto; encogerlo
 * hasta que no se lea, no.
 */

/** Hojas de etiquetas que se usan en Europa. Medidas en milímetros */
export interface FormatoHoja {
  id: string
  nombre: string
  /** Ancho y alto de la página */
  pagina: { ancho: number; alto: number }
  /** Cuántas etiquetas por fila y por columna */
  rejilla: { columnas: number; filas: number }
  /** Tamaño de cada etiqueta */
  etiqueta: { ancho: number; alto: number }
  /** Desde el borde de la página hasta la primera etiqueta */
  margen: { izquierda: number; arriba: number }
  /** Separación entre etiquetas */
  hueco: { horizontal: number; vertical: number }
}

export const FORMATOS: FormatoHoja[] = [
  {
    // El formato más común en España para esto. Cumple el mínimo de Amazon
    // (63,5 × 38,1 mm está por encima de 25 × 51 mm) con holgura.
    id: 'a4-21',
    nombre: 'A4 · 21 etiquetas (63,5 × 38,1 mm)',
    pagina: { ancho: 210, alto: 297 },
    rejilla: { columnas: 3, filas: 7 },
    etiqueta: { ancho: 63.5, alto: 38.1 },
    margen: { izquierda: 7.25, arriba: 15.15 },
    hueco: { horizontal: 2.5, vertical: 0 },
  },
  {
    id: 'a4-24',
    nombre: 'A4 · 24 etiquetas (70 × 37 mm)',
    pagina: { ancho: 210, alto: 297 },
    rejilla: { columnas: 3, filas: 8 },
    etiqueta: { ancho: 70, alto: 37 },
    margen: { izquierda: 0, arriba: 0.5 },
    hueco: { horizontal: 0, vertical: 0 },
  },
  {
    // Impresora térmica de rollo: una etiqueta por página
    id: 'termica-57x32',
    nombre: 'Térmica · rollo 57 × 32 mm',
    pagina: { ancho: 57, alto: 32 },
    rejilla: { columnas: 1, filas: 1 },
    etiqueta: { ancho: 57, alto: 32 },
    margen: { izquierda: 0, arriba: 0 },
    hueco: { horizontal: 0, vertical: 0 },
  },
]

export interface EtiquetaProducto {
  fnsku: string
  titulo: string
  /** 'Nuevo' salvo que se diga otra cosa. Amazon lo exige en la etiqueta */
  condicion?: string
  /** Cuántas iguales hay que imprimir */
  unidades: number
}

export interface ResultadoEtiquetas {
  pdf: Uint8Array
  etiquetas: number
  paginas: number
  /** Las que no se han podido imprimir y por qué. NO se callan */
  descartadas: Array<{ fnsku: string; motivo: string }>
}

/**
 * Dibuja una etiqueta en la posición dada.
 *
 * El código de barras se escala para dejar una zona muda de 2 mm a cada lado: es
 * lo que el escáner necesita para saber dónde empieza el código, y sin ella un
 * código perfectamente impreso no se lee.
 */
function dibujar(
  doc: jsPDF,
  x: number,
  y: number,
  ancho: number,
  alto: number,
  etiqueta: EtiquetaProducto
): boolean {
  const modulos = code128B(etiqueta.fnsku)
  if (!modulos) return false

  const ZONA_MUDA = 2
  const anchoUtil = ancho - ZONA_MUDA * 2
  const anchoModulo = anchoUtil / anchoEnModulos(modulos)

  // El alto del código: la mitad de la etiqueta, dejando sitio al texto
  const altoBarra = Math.max(8, alto * 0.45)
  const yBarra = y + 2.5

  doc.setFillColor(0, 0, 0)
  let cursor = x + ZONA_MUDA
  for (const m of modulos) {
    const w = m.ancho * anchoModulo
    if (m.pinta) doc.rect(cursor, yBarra, w, altoBarra, 'F')
    cursor += w
  }

  // El FNSKU en texto, debajo del código: si el escáner falla se teclea
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text(etiqueta.fnsku, x + ancho / 2, yBarra + altoBarra + 3.2, { align: 'center' })

  // El título, recortado a lo que quepa. Dos líneas como mucho.
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  const lineas = doc.splitTextToSize(etiqueta.titulo, ancho - 4).slice(0, 2) as string[]
  let yTexto = yBarra + altoBarra + 6.6
  for (const linea of lineas) {
    doc.text(linea, x + ancho / 2, yTexto, { align: 'center' })
    yTexto += 2.6
  }

  // La condición: Amazon la exige y es lo que más se olvida
  doc.setFontSize(6)
  doc.text(etiqueta.condicion ?? 'Nuevo', x + ancho / 2, Math.min(yTexto + 0.4, y + alto - 1.5), {
    align: 'center',
  })

  return true
}

/**
 * La hoja entera.
 *
 * Una etiqueta por unidad: si hay 8 pares de la talla 43, salen 8 pegatinas
 * iguales. Es lo que se pega, una por zapato... por caja de zapatos.
 */
export function hojaDeEtiquetas(
  etiquetas: EtiquetaProducto[],
  formatoId = 'a4-21'
): ResultadoEtiquetas {
  const formato = FORMATOS.find((f) => f.id === formatoId) ?? FORMATOS[0]
  const doc = new jsPDF({
    unit: 'mm',
    format: [formato.pagina.ancho, formato.pagina.alto],
    orientation: formato.pagina.ancho > formato.pagina.alto ? 'landscape' : 'portrait',
  })

  const descartadas: Array<{ fnsku: string; motivo: string }> = []
  const porPagina = formato.rejilla.columnas * formato.rejilla.filas

  // Se aplana ANTES de paginar: una referencia de 8 unidades son 8 etiquetas, y
  // pueden partirse entre dos hojas sin problema.
  const planas: EtiquetaProducto[] = []
  for (const e of etiquetas) {
    if (!e.fnsku) {
      descartadas.push({ fnsku: '(sin FNSKU)', motivo: `${e.titulo}: no tenemos su FNSKU` })
      continue
    }
    if (!code128B(e.fnsku)) {
      descartadas.push({ fnsku: e.fnsku, motivo: 'tiene caracteres que Code 128 no admite' })
      continue
    }
    for (let i = 0; i < e.unidades; i++) planas.push(e)
  }

  let impresas = 0
  let paginas = 0

  for (let i = 0; i < planas.length; i++) {
    const enPagina = i % porPagina
    if (enPagina === 0) {
      if (i > 0) doc.addPage()
      paginas++
    }
    const columna = enPagina % formato.rejilla.columnas
    const fila = Math.floor(enPagina / formato.rejilla.columnas)

    const x = formato.margen.izquierda + columna * (formato.etiqueta.ancho + formato.hueco.horizontal)
    const y = formato.margen.arriba + fila * (formato.etiqueta.alto + formato.hueco.vertical)

    if (dibujar(doc, x, y, formato.etiqueta.ancho, formato.etiqueta.alto, planas[i])) impresas++
  }

  return {
    pdf: new Uint8Array(doc.output('arraybuffer')),
    etiquetas: impresas,
    paginas: Math.max(paginas, 0),
    descartadas,
  }
}
