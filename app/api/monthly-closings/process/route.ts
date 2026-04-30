import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseCSV, getVal, parseNum } from '@/lib/utils/csv-parser'

const INCLUDED_TYPES = new Set(['SHIPMENT', 'RETURN', 'REFUND'])

type JurisdictionAgg = {
  jurisdiction: string
  grossProduct: number
  grossShipping: number
  refundsProduct: number
  refundsShipping: number
  grossSales: number
  refunds: number
  netBase: number
}

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  GERMANY: 'DE',
  SPAIN: 'ES',
  ITALY: 'IT',
  FRANCE: 'FR',
  PORTUGAL: 'PT',
  NETHERLANDS: 'NL',
  BELGIUM: 'BE',
  SWEDEN: 'SE',
  POLAND: 'PL',
  AUSTRIA: 'AT',
  IRELAND: 'IE',
  CZECH_REPUBLIC: 'CZ',
  'CZECH REPUBLIC': 'CZ',
  SLOVAKIA: 'SK',
  HUNGARY: 'HU',
  ROMANIA: 'RO',
  BULGARIA: 'BG',
  CROATIA: 'HR',
  SLOVENIA: 'SI',
  LUXEMBOURG: 'LU',
  DENMARK: 'DK',
  FINLAND: 'FI',
  GREECE: 'GR',
  CYPRUS: 'CY',
  MALTA: 'MT',
  LITHUANIA: 'LT',
  LATVIA: 'LV',
  ESTONIA: 'EE',
}

const normalizeCountryCode = (value: string): string => {
  const v = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')

  if (!v) return 'N/A'
  if (/^[A-Z]{2}$/.test(v)) return v
  const underscored = v.replace(/\s+/g, '_')
  return COUNTRY_NAME_TO_CODE[v] || COUNTRY_NAME_TO_CODE[underscored] || v
}

const emptyAgg = (jurisdiction: string): JurisdictionAgg => ({
  jurisdiction,
  grossProduct: 0,
  grossShipping: 0,
  refundsProduct: 0,
  refundsShipping: 0,
  grossSales: 0,
  refunds: 0,
  netBase: 0,
})

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const formData = await req.formData()
    const clientId = String(formData.get('clientId') || '')
    const month = Number(formData.get('month') || 0)
    const year = Number(formData.get('year') || 0)
    const file = formData.get('file') as File | null

    if (!clientId) {
      return NextResponse.json({ error: 'Falta clientId' }, { status: 400 })
    }
    if (!file) {
      return NextResponse.json({ error: 'Falta el archivo CSV' }, { status: 400 })
    }
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Mes inválido' }, { status: 400 })
    }
    if (!Number.isFinite(year) || year < 2000) {
      return NextResponse.json({ error: 'Año inválido' }, { status: 400 })
    }

    // Verificar acceso por cliente: admin o member/creator
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = (profile?.role || 'employee') as 'admin' | 'employee' | 'partner'

    if (role !== 'admin') {
      const { data: client, error: clientError } = await supabase
        .from('client_canvas')
        .select('id, created_by')
        .eq('id', clientId)
        .single()

      if (clientError || !client) {
        return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
      }

      const isCreator = client.created_by === user.id

      const { data: membership, error: membershipError } = await supabase
        .from('client_members')
        .select('id')
        .eq('client_id', clientId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (membershipError) {
        console.error('Error checking membership:', membershipError)
      }

      if (!membership && !isCreator) {
        return NextResponse.json({ error: 'Sin acceso a este cliente' }, { status: 403 })
      }
    }

    const csvText = await file.text()
    const rows = parseCSV(csvText)

    const byJurisdiction = new Map<string, JurisdictionAgg>()
    const excludedTypes = new Set<string>()
    let includedCount = 0

    for (const row of rows) {
      const transactionType = String(
        getVal(row, ['Transaction Type', 'transaction_type', /Transaction.*Type/i]) || ''
      )
        .toUpperCase()
        .trim()

      if (!transactionType) continue

      if (!INCLUDED_TYPES.has(transactionType)) {
        excludedTypes.add(transactionType)
        continue
      }

      const marketplaceId = String(getVal(row, ['Marketplace ID', 'marketplace_id', /Marketplace.*ID/i]) || '')
        .trim()
        .toUpperCase()
      const shipToCountry = String(getVal(row, ['Ship To Country', 'ship_to_country', /Ship\s*To\s*Country/i]) || '')
        .trim()
        .toUpperCase()
      const jurisdictionName = String(
        getVal(row, ['Jurisdiction Name', 'jurisdiction_name', /Jurisdiction.*Name/i]) || ''
      )
        .trim()
        .toUpperCase()

      const jurisdictionRaw = marketplaceId || shipToCountry || jurisdictionName || 'N/A'
      const jurisdiction = normalizeCountryCode(jurisdictionRaw)

      const ourPrice = parseNum(
        getVal(row, ['OUR_PRICE Tax Exclusive Selling Price', /OUR_PRICE.*Tax Exclusive Selling Price/i])
      )
      const shippingPrice = parseNum(
        getVal(row, ['SHIPPING Tax Exclusive Selling Price', /SHIPPING.*Tax Exclusive Selling Price/i])
      )

      const ourAbs = Math.abs(ourPrice)
      const shippingAbs = Math.abs(shippingPrice)
      const lineAbs = Math.abs(ourPrice + shippingPrice)

      const agg = byJurisdiction.get(jurisdiction) || emptyAgg(jurisdiction)

      if (transactionType === 'SHIPMENT') {
        agg.grossProduct += ourAbs
        agg.grossShipping += shippingAbs
        agg.grossSales += lineAbs
        agg.netBase += lineAbs
        includedCount++
      } else {
        // RETURN/REFUND
        agg.refundsProduct += ourAbs
        agg.refundsShipping += shippingAbs
        agg.refunds += lineAbs
        agg.netBase -= lineAbs
        includedCount++
      }

      byJurisdiction.set(jurisdiction, agg)
    }

    const jurisdictionRows = Array.from(byJurisdiction.values()).sort((a, b) => b.netBase - a.netBase)

    const totals = jurisdictionRows.reduce<JurisdictionAgg>(
      (acc, r) => {
        acc.grossProduct += r.grossProduct
        acc.grossShipping += r.grossShipping
        acc.refundsProduct += r.refundsProduct
        acc.refundsShipping += r.refundsShipping
        acc.grossSales += r.grossSales
        acc.refunds += r.refunds
        acc.netBase += r.netBase
        return acc
      },
      emptyAgg('TOTAL')
    )

    return NextResponse.json({
      data: {
        byJurisdiction: jurisdictionRows,
        totals,
        meta: {
          month,
          year,
          includedTransactionTypes: Array.from(INCLUDED_TYPES),
          excludedTransactionTypes: Array.from(excludedTypes).sort(),
          rowsProcessed: includedCount,
        },
      },
    })
  } catch (err: any) {
    console.error('[monthly-closings/process] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error interno procesando el CSV' },
      { status: 500 }
    )
  }
}
