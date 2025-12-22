/**
 * Calculadora de métricas para Sales Auditor
 * Procesa datos de Helium 10 y genera métricas diferenciadas por modelo de negocio
 */

import { ParsedXrayData, ParsedCerebroData, BusinessModel } from '@/lib/parsers/helium'
import { parseEuroNumber, getVal } from '@/lib/utils/csv-parser'

export interface ProductMetrics {
  asin: string
  title: string
  price: number
  revenue: number
  estimatedShare?: number // Solo para ARBITRAGE
  sales: number
  reviews: number
  activeSellers: number
  organicRank?: number
  sponsoredRank?: number
  searchVolume?: number
}

export interface ComputedMetrics {
  total_opportunity_value: number
  risk_score: number
  top_products: ProductMetrics[]
  ghost_products: ProductMetrics[]
  model_specific_metrics: {
    // Para ARBITRAGE
    avg_sellers_per_listing?: number
    saturated_niches?: number
    buy_box_gaps?: number
    // Para PRIVATE_LABEL
    seo_gap_volume?: number
    ad_dependency_score?: number
    invisible_traffic_keywords?: number
  }
}

/**
 * Calcula métricas para modelo ARBITRAGE
 */
function calculateArbitrageMetrics(
  xrayData: ParsedXrayData,
  cerebroData: ParsedCerebroData | null
): ComputedMetrics {
  const products: ProductMetrics[] = xrayData.top10Products.map((row) => {
    const asinSales = parseEuroNumber(getVal(row, ['ASIN Sales', 'Sales', 'Monthly Sales', /sales/i]))
    const asinRevenue = parseEuroNumber(getVal(row, ['ASIN Revenue', 'Revenue', 'Monthly Revenue', /revenue/i]))
    const activeSellers = parseEuroNumber(getVal(row, ['Active Sellers', 'Sellers', 'Active', /active.*seller/i]))
    
    // Revenue Real Estimado: ASIN Revenue / (Active Sellers / 2)
    // Asumimos que solo la mitad de vendedores son competitivos
    const estimatedShare = activeSellers > 0 
      ? asinRevenue / (activeSellers / 2)
      : asinRevenue

    return {
      asin: getVal(row, ['ASIN', 'asin', /asin/i]) || '',
      title: getVal(row, ['Title', 'Product Title', 'Name', /title|name/i]) || '',
      price: parseEuroNumber(getVal(row, ['Price US$', 'Price', 'Price USD', /price/i])),
      revenue: asinRevenue,
      estimatedShare,
      sales: asinSales,
      reviews: parseEuroNumber(getVal(row, ['Reviews', 'Review Count', /review/i])),
      activeSellers,
    }
  })

  // Calcular promedio de vendedores por listing
  const avgSellersPerListing = products.length > 0
    ? products.reduce((sum, p) => sum + p.activeSellers, 0) / products.length
    : 0

  // Detectar nichos saturados (> 20 vendedores)
  const saturatedNiches = products.filter(p => p.activeSellers > 20).length

  // Buy Box Gaps: Productos con precio inestable o muchos vendedores
  // Consideramos "gap" si hay > 5 vendedores activos (competencia alta)
  const buyBoxGaps = products.filter(p => p.activeSellers > 5).length

  // Calcular oportunidad total (diferencia entre revenue total y estimated share)
  const totalRevenue = products.reduce((sum, p) => sum + p.revenue, 0)
  const totalEstimatedShare = products.reduce((sum, p) => sum + (p.estimatedShare || 0), 0)
  const totalOpportunityValue = totalRevenue - totalEstimatedShare

  // Risk Score basado en saturación y falta de reviews
  // Más vendedores = más riesgo, menos reviews = más riesgo
  const avgReviews = products.length > 0
    ? products.reduce((sum, p) => sum + p.reviews, 0) / products.length
    : 0

  const saturationRisk = Math.min(100, (avgSellersPerListing / 20) * 100) // 20+ sellers = 100% risk
  const reviewRisk = avgReviews < 50 ? 100 : Math.max(0, 100 - (avgReviews / 10)) // <50 reviews = alto riesgo
  const riskScore = Math.round((saturationRisk * 0.6 + reviewRisk * 0.4))

  // Top productos (por estimated share) - Mostrar top 20
  const topProducts = [...products]
    .sort((a, b) => (b.estimatedShare || 0) - (a.estimatedShare || 0))
    .slice(0, 20)

  // Ghost products (peores: bajo estimated share pero alto revenue potencial)
  // Productos que consumen recursos pero no generan suficiente share - Mostrar top 20
  const ghostProducts = [...products]
    .filter(p => p.revenue > 0 && (p.estimatedShare || 0) < p.revenue * 0.3)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 20)

  return {
    total_opportunity_value: Math.max(0, totalOpportunityValue),
    risk_score: Math.min(100, Math.max(0, riskScore)),
    top_products: topProducts,
    ghost_products: ghostProducts,
    model_specific_metrics: {
      avg_sellers_per_listing: Math.round(avgSellersPerListing * 100) / 100,
      saturated_niches: saturatedNiches,
      buy_box_gaps: buyBoxGaps,
    },
  }
}

/**
 * Calcula métricas para modelo PRIVATE LABEL
 */
function calculatePrivateLabelMetrics(
  xrayData: ParsedXrayData,
  cerebroData: ParsedCerebroData | null
): ComputedMetrics {
  const products: ProductMetrics[] = xrayData.top10Products.map((row) => {
    const asinSales = parseEuroNumber(getVal(row, ['ASIN Sales', 'Sales', 'Monthly Sales', /sales/i]))
    const asinRevenue = parseEuroNumber(getVal(row, ['ASIN Revenue', 'Revenue', 'Monthly Revenue', /revenue/i]))
    
    // Para Private Label, usamos 100% del revenue
    return {
      asin: getVal(row, ['ASIN', 'asin', /asin/i]) || '',
      title: getVal(row, ['Title', 'Product Title', 'Name', /title|name/i]) || '',
      price: parseEuroNumber(getVal(row, ['Price US$', 'Price', 'Price USD', /price/i])),
      revenue: asinRevenue,
      sales: asinSales,
      reviews: parseEuroNumber(getVal(row, ['Reviews', 'Review Count', /review/i])),
      activeSellers: parseEuroNumber(getVal(row, ['Active Sellers', 'Sellers', 'Active', /active.*seller/i])),
    }
  })

  // SEO Gap: Suma Search Volume de keywords donde Organic Rank > 10 y < 60
  let seoGapVolume = 0
  let invisibleTrafficKeywords = 0
  let adDependencyScore = 0
  let totalSponsoredRank = 0
  let totalOrganicRank = 0
  let rankComparisons = 0

  if (cerebroData) {
    cerebroData.topKeywords.forEach((keyword) => {
      const organicRank = parseEuroNumber(getVal(keyword, ['Organic Rank', 'Rank', 'Organic', /organic.*rank|rank/i]))
      const sponsoredRank = parseEuroNumber(getVal(keyword, ['Sponsored Rank', 'PPC Rank', 'Sponsored', /sponsored.*rank|ppc/i]))
      const searchVolume = keyword.searchVolume

      // SEO Gap: Tráfico invisible (rank entre 10 y 60)
      if (organicRank > 10 && organicRank < 60 && searchVolume > 0) {
        seoGapVolume += searchVolume
        invisibleTrafficKeywords++
      }

      // Ad Dependency: Comparar Sponsored vs Organic
      if (sponsoredRank > 0 && organicRank > 0) {
        totalSponsoredRank += sponsoredRank
        totalOrganicRank += organicRank
        rankComparisons++

        // Si Sponsored es mejor (menor número) que Organic, hay dependencia de ads
        if (sponsoredRank < organicRank) {
          adDependencyScore += (organicRank - sponsoredRank) / organicRank
        }
      }
    })

    // Normalizar ad dependency score (0-100)
    adDependencyScore = rankComparisons > 0
      ? Math.min(100, Math.round((adDependencyScore / rankComparisons) * 100))
      : 0
  }

  // Calcular oportunidad total (basado en SEO Gap)
  // Estimamos que cada 1000 búsquedas = $X en revenue potencial
  // Asumimos conversión del 2% y AOV promedio
  const avgPrice = products.length > 0
    ? products.reduce((sum, p) => sum + p.price, 0) / products.length
    : 0
  
  const estimatedConversionRate = 0.02 // 2%
  const totalOpportunityValue = seoGapVolume * estimatedConversionRate * avgPrice

  // Risk Score basado en falta de reviews y dependencia de ads
  const avgReviews = products.length > 0
    ? products.reduce((sum, p) => sum + p.reviews, 0) / products.length
    : 0

  const reviewRisk = avgReviews < 50 ? 100 : Math.max(0, 100 - (avgReviews / 10))
  const adRisk = adDependencyScore // Ya está en escala 0-100
  const riskScore = Math.round((reviewRisk * 0.5 + adRisk * 0.5))

  // Top productos (por revenue) - Mostrar top 20
  const topProducts = [...products]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 20)

  // Ghost products: Productos con bajo revenue pero alto potencial (bajo reviews pero buen precio)
  // Productos que no están aprovechando su potencial - Mostrar top 20
  const ghostProducts = [...products]
    .filter(p => p.revenue < avgPrice * 10 && p.reviews < 50)
    .sort((a, b) => (b.price * b.sales) - (a.price * a.sales))
    .slice(0, 20)

  return {
    total_opportunity_value: Math.max(0, totalOpportunityValue),
    risk_score: Math.min(100, Math.max(0, riskScore)),
    top_products: topProducts,
    ghost_products: ghostProducts,
    model_specific_metrics: {
      seo_gap_volume: Math.round(seoGapVolume),
      ad_dependency_score: adDependencyScore,
      invisible_traffic_keywords: invisibleTrafficKeywords,
    },
  }
}

/**
 * Calcula métricas generales (cuando el modelo es UNKNOWN)
 */
function calculateUnknownMetrics(
  xrayData: ParsedXrayData,
  cerebroData: ParsedCerebroData | null
): ComputedMetrics {
  const products: ProductMetrics[] = xrayData.top10Products.map((row) => {
    const asinSales = parseEuroNumber(getVal(row, ['ASIN Sales', 'Sales', 'Monthly Sales', /sales/i]))
    const asinRevenue = parseEuroNumber(getVal(row, ['ASIN Revenue', 'Revenue', 'Monthly Revenue', /revenue/i]))
    
    return {
      asin: getVal(row, ['ASIN', 'asin', /asin/i]) || '',
      title: getVal(row, ['Title', 'Product Title', 'Name', /title|name/i]) || '',
      price: parseEuroNumber(getVal(row, ['Price US$', 'Price', 'Price USD', /price/i])),
      revenue: asinRevenue,
      sales: asinSales,
      reviews: parseEuroNumber(getVal(row, ['Reviews', 'Review Count', /review/i])),
      activeSellers: parseEuroNumber(getVal(row, ['Active Sellers', 'Sellers', 'Active', /active.*seller/i])),
    }
  })

  const totalOpportunityValue = 0 // No calculamos oportunidad sin conocer el modelo
  const avgReviews = products.length > 0
    ? products.reduce((sum, p) => sum + p.reviews, 0) / products.length
    : 0

  const reviewRisk = avgReviews < 50 ? 100 : Math.max(0, 100 - (avgReviews / 10))
  const riskScore = reviewRisk

  const topProducts = [...products]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 20)

  const ghostProducts = [...products]
    .filter(p => p.revenue < 100)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 20)

  return {
    total_opportunity_value: totalOpportunityValue,
    risk_score: Math.min(100, Math.max(0, riskScore)),
    top_products: topProducts,
    ghost_products: ghostProducts,
    model_specific_metrics: {},
  }
}

/**
 * Función principal: Calcula métricas basadas en el modelo de negocio
 */
export function calculateMetrics(
  xrayData: ParsedXrayData,
  cerebroData: ParsedCerebroData | null,
  businessModel: BusinessModel
): ComputedMetrics {
  switch (businessModel) {
    case 'ARBITRAGE':
      return calculateArbitrageMetrics(xrayData, cerebroData)
    
    case 'PRIVATE_LABEL':
      return calculatePrivateLabelMetrics(xrayData, cerebroData)
    
    case 'UNKNOWN':
    default:
      return calculateUnknownMetrics(xrayData, cerebroData)
  }
}

/**
 * Formatea las métricas para presentación
 */
export function formatMetrics(metrics: ComputedMetrics): {
  opportunity: string
  risk: string
  riskLevel: 'low' | 'medium' | 'high'
} {
  const opportunity = new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(metrics.total_opportunity_value)

  const risk = `${metrics.risk_score}/100`
  
  const riskLevel: 'low' | 'medium' | 'high' = 
    metrics.risk_score < 40 ? 'low' :
    metrics.risk_score < 70 ? 'medium' :
    'high'

  return {
    opportunity,
    risk,
    riskLevel,
  }
}

