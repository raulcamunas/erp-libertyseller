/**
 * Parser especializado para archivos CSV de Helium 10
 * Maneja formato europeo y detección de modelo de negocio
 */

import { parseCSV, parseNum, getVal, parseEuroNumber } from '@/lib/utils/csv-parser'

export type BusinessModel = 'PRIVATE_LABEL' | 'ARBITRAGE' | 'UNKNOWN'

export interface XrayRow {
  [key: string]: any
}

export interface CerebroRow {
  [key: string]: any
}

export interface ParsedXrayData {
  rows: XrayRow[]
  top10Products: XrayRow[] // Nombre mantenido por compatibilidad, pero ahora puede contener hasta 100 productos
  avgActiveSellers: number
  businessModel: BusinessModel
  avgPrice: number
  avgFees: number
  avgSales: number
  avgReviews: number
}

export interface ParsedCerebroData {
  rows: CerebroRow[]
  topKeywords: Array<{
    keyword: string
    searchVolume: number
    [key: string]: any
  }>
}

/**
 * Parsea el archivo Xray de Helium 10
 */
export function parseHeliumXray(csvContent: string): ParsedXrayData {
  const rows = parseCSV(csvContent)
  
  if (rows.length === 0) {
    return {
      rows: [],
      top10Products: [],
      avgActiveSellers: 0,
      businessModel: 'UNKNOWN',
      avgPrice: 0,
      avgFees: 0,
      avgSales: 0,
      avgReviews: 0,
    }
  }

  // Procesar y ordenar productos por ventas (ASIN Sales)
  const processedProducts = rows
    .map(row => ({
      ...row,
      asinSales: parseEuroNumber(getVal(row, ['ASIN Sales', 'Sales', 'Monthly Sales', /sales/i])),
      price: parseEuroNumber(getVal(row, ['Price US$', 'Price', 'Price USD', /price/i])),
      fees: parseEuroNumber(getVal(row, ['Fees US$', 'FBA Fees', 'Fees', /fee/i])),
      reviews: parseEuroNumber(getVal(row, ['Reviews', 'Review Count', /review/i])),
      activeSellers: parseEuroNumber(getVal(row, ['Active Sellers', 'Sellers', 'Active', /active.*seller/i])),
    }))
    .filter(p => p.asinSales > 0) // Solo productos con ventas
    .sort((a, b) => b.asinSales - a.asinSales) // Ordenar por ventas descendente

  // Analizar todos los productos con ventas (o hasta 100 para no sobrecargar)
  const maxProducts = Math.min(processedProducts.length, 100)
  const topProducts = processedProducts.slice(0, maxProducts)
  
  // Para detección de modelo, usar TOP 10
  const top10ForModel = processedProducts.slice(0, 10)

  // Calcular promedio de vendedores activos en TOP 10 (para detección de modelo)
  const avgActiveSellers = top10ForModel.length > 0
    ? top10ForModel.reduce((sum, p) => sum + p.activeSellers, 0) / top10ForModel.length
    : 0

  // Detectar modelo de negocio basado en vendedores activos
  // Si promedio > 2 -> ARBITRAGE, si <= 2 -> PRIVATE_LABEL
  const businessModel: BusinessModel = 
    avgActiveSellers > 2 ? 'ARBITRAGE' : 
    avgActiveSellers > 0 ? 'PRIVATE_LABEL' : 
    'UNKNOWN'

  // Calcular promedios de todos los productos analizados
  const avgPrice = topProducts.length > 0
    ? topProducts.reduce((sum, p) => sum + p.price, 0) / topProducts.length
    : 0

  const avgFees = topProducts.length > 0
    ? topProducts.reduce((sum, p) => sum + p.fees, 0) / topProducts.length
    : 0

  const avgSales = topProducts.length > 0
    ? topProducts.reduce((sum, p) => sum + p.asinSales, 0) / topProducts.length
    : 0

  const avgReviews = topProducts.length > 0
    ? topProducts.reduce((sum, p) => sum + p.reviews, 0) / topProducts.length
    : 0

  return {
    rows,
    top10Products: topProducts, // Ahora contiene todos los productos analizados (hasta 100)
    avgActiveSellers,
    businessModel,
    avgPrice,
    avgFees,
    avgSales,
    avgReviews,
  }
}

/**
 * Parsea el archivo Cerebro de Helium 10
 */
export function parseHeliumCerebro(csvContent: string): ParsedCerebroData {
  const rows = parseCSV(csvContent)
  
  if (rows.length === 0) {
    return {
      rows: [],
      topKeywords: [],
    }
  }

  // Extraer keywords con volumen de búsqueda
  const topKeywords = rows
    .map(row => ({
      keyword: getVal(row, ['Keyword', 'Search Term', 'Term', /keyword|term/i]) || '',
      searchVolume: parseEuroNumber(getVal(row, ['Search Volume', 'Volume', 'Searches', /volume|search/i])),
      ...row,
    }))
    .filter(k => k.keyword && k.searchVolume > 0)
    .sort((a, b) => b.searchVolume - a.searchVolume) // Ordenar por volumen descendente
    .slice(0, 20) // Top 20 keywords

  return {
    rows,
    topKeywords,
  }
}

/**
 * Genera un token público único para compartir reportes
 */
export function generatePublicToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const length = 8
  let token = 'aud_'
  
  for (let i = 0; i < length; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  
  return token
}

