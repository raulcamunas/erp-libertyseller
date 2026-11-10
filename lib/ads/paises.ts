/**
 * AMAZON ADS · EL NOMBRE DE UN PAÍS A PARTIR DEL CÓDIGO QUE DA AMAZON ADS. PURO.
 *
 * Ads dice «UK» donde SP-API dice «GB». Irlanda no está en la lista de mercados de SP-API del ERP (ahí no se vende), pero sí tiene cuenta de anunciante, y se nombra aquí.
 */

import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'

export function nombreDePais(codigo: string | null | undefined): string {
  if (!codigo) return '—'
  const c = codigo === 'UK' ? 'GB' : codigo
  return AMAZON_MARKETPLACES.find((m) => m.countryCode === c)?.label ?? (c === 'IE' ? 'Irlanda' : codigo)
}
