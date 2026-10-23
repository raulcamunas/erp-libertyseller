/**
 * CIFRAS COMPACTAS PARA LA LISTA DE LEADS.
 *
 * La lista tiene dos líneas por lead y en el móvil poco más de 400 px de ancho: la cifra de dinero tiene que caber en unos 50 px.
 *
 * La de una tienda online son DÓLARES ESTIMADOS por el modelo de tráfico de Store Leads, no facturación observada: por eso va siempre con
 * el símbolo del dólar y nunca con el del euro (ver formatVentasEstimadas en lib/types/cold-leads.ts), y la lista le pone delante una «≈».
 * PURO: se comprueba con cifras.prueba.ts.
 */

/** «850 $», «24 k$», «1,2 M$». null si no hay cifra o no es positiva (una tienda sin estimación no enseña nada, ni un guion) */
export function ventasCompactas(usd: number | string | null | undefined): string | null {
  if (usd == null || usd === '') return null
  const n = Number(usd)
  if (!Number.isFinite(n) || n <= 0) return null
  const miles = Math.round(n / 1_000)
  // 999.600 se redondea a «1000 k$», que es «1 M$»: se mira ya redondeado para no enseñar una cifra de cuatro cifras en miles
  if (miles >= 1_000) return `${(n / 1_000_000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} M$`
  if (n >= 1_000) return `${miles.toLocaleString('es-ES')} k$`
  return `${Math.round(n)} $`
}
