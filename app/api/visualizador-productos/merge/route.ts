import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { parseCSV, getVal, parseNum } from '@/lib/utils/csv-parser'

function normalizeEan(raw: any): string {
  if (raw === null || raw === undefined) return ''
  const s = String(raw).trim()
  if (!s) return ''

  // Cuando viene como float/científico, intentamos convertirlo a entero sin decimales.
  // Ej: 3.661434e+12
  if (/e\+?/i.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n)) return String(Math.trunc(n))
  }

  // Eliminar espacios
  const digits = s.replace(/\D/g, '')
  return digits
}

function parseKeepaPriceEuro(s: any): number {
  if (s === null || s === undefined) return 0
  const str = String(s).trim()
  if (!str) return 0
  // Maneja valores tipo "€ 17.95" o "17,95" etc.
  const cleaned = str
    .replace(/€/g, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '.')
    .replace(/,/g, '.')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

function readXlsxFirstSheetRows(buffer: ArrayBuffer): any[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const json = XLSX.utils.sheet_to_json(ws, { defval: null })
  return json as any[]
}

function readXlsxAsRowsWithHeaderRowIndex(buffer: ArrayBuffer, headerRowIndex0: number): any[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]

  const matrix: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[][]
  const header = (matrix[headerRowIndex0] || []).map((h) => (h === null || h === undefined ? '' : String(h).trim()))

  const rows: any[] = []
  for (let i = headerRowIndex0 + 1; i < matrix.length; i++) {
    const line = matrix[i]
    if (!line || line.every((v) => v === null || v === undefined || String(v).trim() === '')) continue

    const obj: Record<string, any> = {}
    for (let c = 0; c < header.length; c++) {
      const key = header[c] || `col_${c}`
      obj[key] = line[c]
    }
    rows.push(obj)
  }

  return rows
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    const keepaFile = formData.get('keepa_file') as File | null
    const filtradoFile = formData.get('filtrado_file') as File | null
    const compraFile = formData.get('compra_file') as File | null

    if (!keepaFile || !filtradoFile || !compraFile) {
      return NextResponse.json({ error: 'Faltan archivos requeridos' }, { status: 400 })
    }

    // ===== Keepa CSV =====
    const keepaText = await keepaFile.text()
    const keepaRows = parseCSV(keepaText)

    // Map Keepa por EAN (Imported by Code)
    const keepaByEan = new Map<string, any>()
    for (const r of keepaRows) {
      const ean = normalizeEan(getVal(r, ['Imported by Code', /imported by code/i]))
      if (!ean) continue
      if (!keepaByEan.has(ean)) keepaByEan.set(ean, r)
    }

    // ===== Filtrado XLSX =====
    const filtradoBuf = await filtradoFile.arrayBuffer()
    const filtradoRows = readXlsxFirstSheetRows(filtradoBuf)

    const filtradoByEan = new Map<string, any>()
    for (const r of filtradoRows) {
      const ean = normalizeEan(r['EAN'] ?? r['ean'])
      if (!ean) continue
      if (!filtradoByEan.has(ean)) filtradoByEan.set(ean, r)
    }

    // ===== Compra XLSX (TARIFA) =====
    const compraBuf = await compraFile.arrayBuffer()
    // En tu archivo, las cabeceras reales están en la fila 0 (según el output) y contienen EAN/PUC/PVL 26...
    // pero en el dump se ve que esa fila aparece como primera fila de datos. Para ser robustos,
    // buscamos una fila que contenga exactamente "EAN" en alguna celda.

    const wb = XLSX.read(compraBuf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const matrix: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[][]

    let headerRowIndex0 = 0
    for (let i = 0; i < Math.min(matrix.length, 20); i++) {
      const row = matrix[i] || []
      const hasEan = row.some((v) => String(v || '').trim().toUpperCase() === 'EAN')
      if (hasEan) {
        headerRowIndex0 = i
        break
      }
    }

    const compraRows = readXlsxAsRowsWithHeaderRowIndex(compraBuf, headerRowIndex0)

    const compraByEan = new Map<string, any>()
    for (const r of compraRows) {
      const ean = normalizeEan(r['EAN'] ?? r['ean'])
      if (!ean) continue
      if (!compraByEan.has(ean)) compraByEan.set(ean, r)
    }

    // ===== Merge keys =====
    const eans = new Set<string>([...keepaByEan.keys(), ...filtradoByEan.keys(), ...compraByEan.keys()])

    const merged = Array.from(eans)
      .map((ean) => {
        const keepa = keepaByEan.get(ean)
        const filtrado = filtradoByEan.get(ean)
        const compra = compraByEan.get(ean)

        const asin = (filtrado?.ASIN ?? filtrado?.asin ?? getVal(keepa || {}, ['ASIN', /asin/i]) ?? '').toString().trim() || undefined
        const producto = (filtrado?.Título ?? filtrado?.Titulo ?? filtrado?.title ?? filtrado?.['Título'] ?? getVal(keepa || {}, ['Título', 'Titulo', /t[ií]tulo/i]) ?? '').toString().trim() || undefined

        const precioVenta = (() => {
          // Filtrado tiene "Precio" como número (por pandas). Keepa tiene Caja de Compra: Actual como string "€ xx".
          const fromFiltrado = parseNum(filtrado?.Precio)
          if (fromFiltrado) return fromFiltrado
          const keepaBuyBox = getVal(keepa || {}, ['Caja de Compra: Actual', /caja de compra: actual/i])
          const n = parseKeepaPriceEuro(keepaBuyBox)
          return n || 0
        })()

        const precioCompra = (() => {
          // En tarifa: PUC es el coste unitario. Viene como número.
          const n = parseNum(compra?.PUC ?? compra?.puc)
          return n || 0
        })()

        const fbaPickPack = (() => {
          const v = getVal(keepa || {}, ['Tarifa FBA Pick&Pack', /pick\s*&\s*pack/i])
          return parseKeepaPriceEuro(v)
        })()

        const referralFeePercent = (() => {
          const v = getVal(keepa || {}, ['% de comisión de referencia', /comisi[oó]n de referencia/i])
          const n = parseNum(String(v || '').replace('%', ''))
          return n || 0
        })()

        const referralFeeAmount = (() => {
          const v = getVal(keepa || {}, ['Comisión de referencia basada en el precio actual de la Buy Box', /comisi[oó]n de referencia basada/i])
          return parseKeepaPriceEuro(v)
        })()

        const totalFees = (fbaPickPack || 0) + (referralFeeAmount || 0)
        const totalCostes = (precioCompra || 0) + totalFees
        const beneficio = precioVenta ? precioVenta - totalCostes : 0
        const margenPercent = precioVenta ? (beneficio / precioVenta) * 100 : 0

        return {
          ean,
          asin,
          producto,
          precio_venta: precioVenta || undefined,
          precio_compra: precioCompra || undefined,
          fba_pick_pack: fbaPickPack || undefined,
          referral_fee_percent: referralFeePercent || undefined,
          referral_fee_amount: referralFeeAmount || undefined,
          total_fees: totalFees || undefined,
          total_costes: totalCostes || undefined,
          beneficio: Number.isFinite(beneficio) ? beneficio : undefined,
          margen_percent: Number.isFinite(margenPercent) ? margenPercent : undefined,
          source: {
            keepa: Boolean(keepa),
            filtrado: Boolean(filtrado),
            compra: Boolean(compra),
          },
        }
      })
      .filter((r) => r.ean)

    // Orden: primero los que tienen los 3
    merged.sort((a, b) => {
      const aScore = (a.source?.keepa ? 1 : 0) + (a.source?.filtrado ? 1 : 0) + (a.source?.compra ? 1 : 0)
      const bScore = (b.source?.keepa ? 1 : 0) + (b.source?.filtrado ? 1 : 0) + (b.source?.compra ? 1 : 0)
      if (bScore !== aScore) return bScore - aScore
      return (b.beneficio ?? 0) - (a.beneficio ?? 0)
    })

    return NextResponse.json({
      rows: merged,
      meta: {
        keepa_rows: keepaRows.length,
        filtrado_rows: filtradoRows.length,
        compra_rows: compraRows.length,
        merged_rows: merged.length,
        compra_header_row_index0: headerRowIndex0,
      },
    })
  } catch (error: any) {
    console.error('Error visualizador-productos/merge:', error)
    return NextResponse.json({ error: error?.message || 'Error interno' }, { status: 500 })
  }
}
