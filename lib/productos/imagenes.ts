import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'

/**
 * LA IMAGEN PRINCIPAL DE UN PRODUCTO, EN EL TAMAÑO QUE SE PIDA. PURO.
 *
 * Las imágenes de Amazon (m.media-amazon.com/images/I/<id>.jpg) se piden en otro tamaño metiendo «._SL<lado>_» antes de la extensión: así una miniatura de 64 px no descarga la de 1.500.
 */
export function imagenEnTamano(url: string | null | undefined, lado: number): string | null {
  if (!url) return null
  const limpio = url.replace(/\._[^/]*_(?=\.[a-z]+$)/i, '')
  return limpio.replace(/\.(jpg|jpeg|png|gif|webp)$/i, `._SL${Math.round(lado)}_.$1`)
}

export const esAsinValido = (a: string) => /^[A-Z0-9]{10}$/.test(a)


/** El marketplaceId de un país de Amazon Ads ('UK' es Gran Bretaña) */
export function mktDePais(pais: string | null | undefined): string | null {
  if (!pais) return null
  const c = pais.toUpperCase() === 'UK' ? 'GB' : pais.toUpperCase()
  return AMAZON_MARKETPLACES.find((m) => m.countryCode === c)?.id ?? null
}
