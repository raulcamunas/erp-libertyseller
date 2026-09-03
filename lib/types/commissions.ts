export interface Client {
  id: string
  name: string
  base_commission_rate: number
  /** La palabra que identifica su marca propia en el título. Ver la migración 173 */
  marca_propia?: string | null
  /** La tasa de la marca propia. El resto va a base_commission_rate */
  tasa_marca_propia?: number | null
  created_at: string
  updated_at: string
}

export interface CommissionException {
  id: string
  client_id: string
  keyword: string
  special_rate: number
  created_at: string
}

export interface CommissionReport {
  id: string
  slug: string | null
  client_id: string
  period: string | null
  data: CommissionCalculationData
  status: 'draft' | 'final' | 'archived'
  created_at: string
  updated_at: string
}

export interface CommissionCalculationData {
  summary: {
    totalSales: number
    totalRefunds: number
    realTurnover: number
    totalIva: number // IVA total descontado
    netBase: number // Base sin IVA
    totalCommission: number
    averageCommissionRate: number
    totalOrders: number
    byCurrency?: Record<string, {
      currency: string
      unitsGross: number
      unitsNet: number
      netBase: number
      iva: number
      totalInclusive: number
      commission: number
    }>
    // Para ShoesF: comparación entre años
    previousYearNetBase?: number // Base neta año anterior
    currentYearNetBase?: number // Base neta año actual
    excessAmount?: number // Excedente (año actual - año anterior)
    // Para ShoesF: desglose y agregados
    commissionRateUsed?: number // Tasa final usada (puede ser override)
    byJurisdiction?: Record<
      string,
      {
        jurisdiction: string
        previousYearNetBase: number
        currentYearNetBase: number
        excessAmount: number
      }
    >
    calculationBreakdown?: {
      includedTransactionTypes: Record<string, number>
      excludedTransactionTypes: Record<string, number>
      previousYear: {
        grossSales: number
        refunds: number
        netBase: number
        grossProduct?: number
        grossShipping?: number
        refundsProduct?: number
        refundsShipping?: number
        baseProductNet?: number
        baseShippingNet?: number
      }
      currentYear: {
        grossSales: number
        refunds: number
        netBase: number
        grossProduct?: number
        grossShipping?: number
        refundsProduct?: number
        refundsShipping?: number
        baseProductNet?: number
        baseShippingNet?: number
      }
      formula: {
        excessAmount: number
        commissionRate: number
        totalCommission: number
      }
    }
    // Para SHOPLAMP: excedente sobre baseline fijo
    baselineAmount?: number // Baseline acordado (ej: 3500)
    // Para DIRU: beneficios totales
    totalBenefits?: number // Total de beneficios de la pestaña
  }
  // CSV original subido (para poder descargarlo tal cual en el reporte)
  originalCsv?: string
  rows: CommissionRow[]
  errors: string[]
}

export interface CommissionRow {
  productTitle: string
  asin: string
  orderId?: string
  date?: string
  quantity?: number
  currency?: string
  jurisdiction?: string
  grossSales: number
  refunds: number
  realTurnover: number
  iva: number // IVA calculado (21%)
  netBase: number // Base sin IVA
  commissionRate: number
  commission: number
  appliedException?: string
  rowNumber: number // Número de fila original
  // Para ShoesF: comparación entre años
  previousYearNetBase?: number // Base neta del año anterior para este producto
  currentYearNetBase?: number // Base neta del año actual para este producto
  // Para Ham Master y formato Amazon: detalle por línea (SHIPMENT/RETURN/REFUND)
  transactionTypeLabel?: 'Venta' | 'Devolución'
  baseProductNet?: number   // OUR_PRICE Tax Exclusive (sin IVA)
  baseShippingNet?: number   // SHIPPING Tax Exclusive (sin IVA)
  promoNet?: number
  taxAmount?: number
  netLine?: number
}

