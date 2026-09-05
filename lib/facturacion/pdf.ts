import { jsPDF } from 'jspdf'
import type { Emisor } from './tipos'
import type { InvoiceWithItems } from '@/lib/types/invoices'

/**
 * LA FACTURA EN PDF, GENERADA EN EL SERVIDOR.
 *
 * En el servidor y no en el navegador porque el PDF tiene que VIAJAR ADJUNTO
 * en el correo. Lo que había antes (`window.print()` desde la ficha de la
 * factura) produce un papel que solo existe en la pantalla de quien lo pulsa:
 * para mandárselo al cliente había que guardarlo a mano, buscarlo en Descargas
 * y arrastrarlo al correo. Ese es justo uno de los pasos que sobran.
 *
 *
 * ============ POR QUÉ jsPDF Y NO UN HTML A PDF ============
 *
 * Ya está en el proyecto y funciona en Node sin navegador detrás. Las
 * alternativas serias —Puppeteer, Playwright— arrastran un Chromium entero al
 * contenedor por un documento de una página con cuatro filas.
 *
 * Comprobado que las fuentes estándar de jsPDF codifican en WinAnsi, así que
 * «Camuñas», «Ángel» y «€» salen con su byte correcto (0xF1, 0xC1, 0x80). No
 * hace falta incrustar ninguna tipografía.
 */

/** Naranja de marca, en RGB para jsPDF */
const NARANJA: [number, number, number] = [255, 102, 0]
const TINTA: [number, number, number] = [17, 17, 17]
const GRIS: [number, number, number] = [120, 120, 128]
const LINEA: [number, number, number] = [232, 232, 236]

const MARGEN = 16
const ANCHO = 210
const UTIL = ANCHO - MARGEN * 2

function eur(n: number): string {
  return `${n.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`
}

function fecha(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function construirFacturaPdf(
  factura: InvoiceWithItems,
  emisor: Emisor,
  opciones: {
    reportUrl?: string | null
    /** Del cliente de Tesorería: la factura no los guarda */
    clienteNif?: string | null
    clienteDireccion?: string | null
  } = {}
): Buffer {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  // ---------- Cabecera ----------
  doc.setFillColor(...NARANJA)
  doc.rect(0, 0, ANCHO, 34, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text(emisor.legal_name || 'Liberty Seller Hub', MARGEN, 15)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const subtitulo = [emisor.tax_id, emisor.address].filter(Boolean).join(' · ')
  if (subtitulo) doc.text(subtitulo, MARGEN, 21.5)
  if (emisor.email) doc.text(emisor.email, MARGEN, 26.5)

  // Número de factura, a la derecha
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('FACTURA', ANCHO - MARGEN, 15, { align: 'right' })
  doc.setFontSize(14)
  doc.text(factura.invoice_number, ANCHO - MARGEN, 22, { align: 'right' })

  let y = 48

  // ---------- A quién ----------
  doc.setTextColor(...GRIS)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('FACTURAR A', MARGEN, y)
  doc.text('FECHAS', ANCHO - MARGEN, y, { align: 'right' })

  y += 6
  doc.setTextColor(...TINTA)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(factura.client_name, MARGEN, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GRIS)
  doc.text(`Emitida  ${fecha(factura.issue_date)}`, ANCHO - MARGEN, y, { align: 'right' })

  y += 5
  doc.text(`Vence  ${fecha(factura.due_date)}`, ANCHO - MARGEN, y, { align: 'right' })

  // Los datos fiscales del cliente van debajo de su nombre, cada uno en su
  // línea. Si no los tiene, no se pinta un hueco vacío.
  const datosCliente = [opciones.clienteNif, opciones.clienteDireccion, factura.client_email]
    .filter((v): v is string => Boolean(v && String(v).trim()))
  for (const linea of datosCliente) {
    doc.setTextColor(...GRIS)
    doc.setFontSize(9)
    doc.text(String(linea), MARGEN, y)
    y += 5
  }

  y = Math.max(y, 72)

  // ---------- Conceptos ----------
  y += 6
  doc.setDrawColor(...LINEA)
  doc.setLineWidth(0.3)

  doc.setFillColor(248, 248, 250)
  doc.rect(MARGEN, y - 5, UTIL, 8, 'F')

  doc.setTextColor(...GRIS)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('CONCEPTO', MARGEN + 3, y)
  doc.text('UD.', MARGEN + 116, y, { align: 'right' })
  doc.text('PRECIO', MARGEN + 145, y, { align: 'right' })
  doc.text('IMPORTE', MARGEN + UTIL - 3, y, { align: 'right' })

  y += 8
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)

  for (const item of factura.items) {
    // Un concepto largo se parte en varias líneas en vez de salirse de la
    // columna de precios y quedar escrito por encima.
    const trozos = doc.splitTextToSize(item.description, 108) as string[]

    doc.setTextColor(...TINTA)
    doc.text(trozos, MARGEN + 3, y)
    doc.setTextColor(...GRIS)
    doc.text(String(item.quantity), MARGEN + 116, y, { align: 'right' })
    doc.text(eur(item.unit_price), MARGEN + 145, y, { align: 'right' })
    doc.setTextColor(...TINTA)
    doc.setFont('helvetica', 'bold')
    doc.text(eur(item.amount), MARGEN + UTIL - 3, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')

    y += Math.max(trozos.length * 5, 5) + 3
    doc.line(MARGEN, y - 3, MARGEN + UTIL, y - 3)
  }

  // ---------- Totales ----------
  y += 4
  const xEtiqueta = MARGEN + 118
  const xValor = MARGEN + UTIL - 3

  doc.setTextColor(...GRIS)
  doc.setFontSize(9.5)
  doc.text('Subtotal', xEtiqueta, y)
  doc.text(eur(factura.subtotal), xValor, y, { align: 'right' })

  if (factura.vat_rate > 0) {
    y += 6
    doc.text(`IVA (${(factura.vat_rate * 100).toFixed(0)} %)`, xEtiqueta, y)
    doc.text(eur(factura.vat_amount), xValor, y, { align: 'right' })
  }

  y += 4
  doc.setFillColor(...NARANJA)
  doc.rect(xEtiqueta - 4, y, UTIL - 118 + 4, 12, 'F')
  y += 8
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('TOTAL', xEtiqueta, y)
  doc.text(eur(factura.total), xValor, y, { align: 'right' })

  y += 16

  // ---------- Cómo se paga ----------
  // Sin Wise ya no hay botón de pago: lo que cobra es la transferencia, así que
  // el IBAN tiene que ir en el papel. Una factura sin cuenta donde ingresar
  // obliga al cliente a escribir preguntando, y eso retrasa el cobro.
  if (emisor.iban) {
    doc.setFillColor(250, 250, 252)
    doc.rect(MARGEN, y - 5, UTIL, 22, 'F')
    doc.setTextColor(...GRIS)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.text('FORMA DE PAGO · TRANSFERENCIA BANCARIA', MARGEN + 4, y)

    doc.setTextColor(...TINTA)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.text(emisor.iban, MARGEN + 4, y + 7)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...GRIS)
    const banco = [emisor.bank_name, emisor.bic ? `BIC ${emisor.bic}` : null]
      .filter(Boolean)
      .join(' · ')
    const concepto = `Concepto: ${factura.invoice_number}`
    doc.text([banco, concepto].filter(Boolean).join('   |   '), MARGEN + 4, y + 12.5)
    y += 26
  }

  // ---------- Notas y desglose ----------
  if (factura.notes) {
    doc.setTextColor(...GRIS)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const notas = doc.splitTextToSize(factura.notes, UTIL) as string[]
    doc.text(notas, MARGEN, y)
    y += notas.length * 4.5 + 4
  }

  if (opciones.reportUrl) {
    doc.setTextColor(...NARANJA)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.textWithLink('Ver el desglose completo de comisiones', MARGEN, y, {
      url: opciones.reportUrl,
    })
    y += 6
  }

  // ---------- Pie ----------
  const pie = 285
  doc.setDrawColor(...LINEA)
  doc.line(MARGEN, pie - 6, ANCHO - MARGEN, pie - 6)
  doc.setTextColor(...GRIS)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  const lineasPie = [
    [emisor.legal_name, emisor.tax_id, emisor.address].filter(Boolean).join(' · '),
    emisor.footer_note || '',
  ].filter(Boolean)
  doc.text(lineasPie, MARGEN, pie)

  return Buffer.from(doc.output('arraybuffer'))
}

/** El nombre con el que llega el adjunto al cliente */
export function nombreDelFichero(factura: { invoice_number: string; client_name: string }): string {
  const limpio = factura.client_name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return `${factura.invoice_number}-${limpio}.pdf`
}
