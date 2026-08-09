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
 * Genera un token público único para compartir reportes.
 *
 * QUÉ IMPIDE USAR crypto EN VEZ DE Math.random: que alguien adivine o enumere
 * los enlaces de auditoría de otros. `Math.random()` NO es criptográfico: es un
 * generador de secuencia predecible, así que a partir de unos cuantos tokens
 * observados —y los enlaces de auditoría se reparten a clientes potenciales por
 * definición— se puede reconstruir el estado del generador y calcular los
 * siguientes. Con 8 caracteres de [a-z0-9] el espacio es además pequeño
 * (36^8), o sea que también es enumerable a base de fuerza bruta.
 *
 * ESTO SOLO VALE CON LA PUERTA GRANDE CERRADA. Mientras la política de la
 * migración 052 estuvo puesta —`FOR SELECT TO anon USING (true)`— la tabla
 * audit_reports se pedía entera con la clave anónima y el token no protegía
 * nada: no había ni que adivinarlo. Eso lo quita
 * supabase/migrations/136_audit_reports_sin_lectura_anonima.sql, y a partir de
 * ahí el token pasa a ser la ÚNICA puerta del informe, así que su calidad es lo
 * único que queda. Si algún día vuelve a abrirse esa RLS, esto vuelve a ser
 * decorativo.
 *
 * NO CAMBIA NADA VISIBLE: se mantienen el prefijo `aud_` y la longitud de 8
 * caracteres del mismo alfabeto, así que los enlaces se ven igual. Y solo
 * afecta a los tokens NUEVOS: los ya repartidos siguen en la base y se leen
 * exactamente igual que antes.
 */
export function generatePublicToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const length = 8
  let token = 'aud_'

  // Web Crypto (`globalThis.crypto`), no el módulo 'crypto' de Node: existe
  // igual en Node 20 y en el navegador, así que este fichero se puede seguir
  // importando desde donde sea sin romper el empaquetado.
  //
  // Se descartan los bytes >= 252 antes del módulo. Sin ese descarte, 256 no es
  // múltiplo de 36 y los cuatro primeros caracteres del alfabeto saldrían algo
  // más a menudo que el resto: un sesgo pequeño, pero es sesgo, y es gratis
  // quitarlo. 252 = 36 * 7.
  const LIMITE = 252
  while (token.length < 'aud_'.length + length) {
    const bytes = new Uint8Array(length)
    globalThis.crypto.getRandomValues(bytes)
    for (const b of Array.from(bytes)) {
      if (b >= LIMITE) continue
      if (token.length >= 'aud_'.length + length) break
      token += chars.charAt(b % chars.length)
    }
  }

  return token
}

