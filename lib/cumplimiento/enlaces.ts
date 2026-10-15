import { marketplaceById } from '@/lib/types/amazon'

/**
 * ENLACES A AMAZON DESDE UNA FILA DE CUMPLIMIENTO.
 * Puro: solo construye direcciones. Sin red.
 *
 * El dominio de cada país NO es el código en minúsculas: Reino Unido es
 * `co.uk`, Bélgica `com.be`, Estados Unidos `com`. Un código que no esté aquí
 * devuelve null y la pantalla no pinta el enlace, en vez de mandar a una
 * dirección inventada.
 */
const DOMINIO: Record<string, string> = {
  ES: 'es',
  FR: 'fr',
  IT: 'it',
  DE: 'de',
  GB: 'co.uk',
  NL: 'nl',
  SE: 'se',
  PL: 'pl',
  BE: 'com.be',
  TR: 'com.tr',
  AE: 'ae',
  SA: 'sa',
  EG: 'eg',
  IN: 'in',
  US: 'com',
  CA: 'ca',
  MX: 'com.mx',
  BR: 'com.br',
}

function dominio(mercado: string): string | null {
  const pais = marketplaceById(mercado)?.countryCode
  return pais ? (DOMINIO[pais] ?? null) : null
}

/** La ficha pública del producto en Amazon */
export function urlProducto(mercado: string, asin: string | null): string | null {
  const d = dominio(mercado)
  if (!d || !asin || !/^[A-Z0-9]{10}$/.test(asin)) return null
  return `https://www.amazon.${d}/dp/${asin}`
}

/**
 * El listing en «Gestionar todo el inventario» de Seller Central, buscado por SKU.
 * Hay que tener la sesión abierta con la cuenta del cliente: es un atajo, no un
 * acceso.
 */
export function urlInventario(mercado: string, sku: string): string | null {
  const d = dominio(mercado)
  if (!d || !sku) return null
  return (
    `https://sellercentral.amazon.${d}/myinventory/inventory?fulfilledBy=all&page=1&pageSize=25` +
    `&searchField=all&searchTerm=${encodeURIComponent(sku)}&status=all`
  )
}
