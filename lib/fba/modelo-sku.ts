/**
 * MODELO Y TALLA DESDE EL SKU (spec remesas-pro §11 D5.1). Puro.
 *
 * El reparto del ritmo por tallas necesita saber qué tallas son del mismo modelo.
 * ShoesF lo trae de su base de datos (`fba_catalogo`), pero Cobo no tiene catálogo y
 * ShoesF tiene referencias que venden y no están en él. Para esas, el modelo y la
 * talla salen del propio SKU con un patrón por cliente:
 *
 *   Cobo    «262 BURDEO/37 FBA»   → modelo «262 BURDEO», talla «37»
 *   ShoesF  «FBA035188-38»        → modelo «FBA035188», talla «38»
 *
 * El catálogo manda: si `fba_catalogo.fbasku` coincide con el SKU, se usa el modelo
 * del catálogo y esto no se llama. Una fila de catálogo con `fbasku` null no da modelo.
 *
 * Cada patrón tiene dos grupos: el primero es el modelo y el segundo la talla.
 */

export const PATRONES_DE_PARTIDA: Record<string, RegExp[]> = {
  // «262 BURDEO/37 FBA», «262 BURDEO / 37,5»
  cobo: [/^(.+?)\s*\/\s*(\d{2}(?:[.,]5)?)\b/],
  // «FBA<cod_art>-<talla>»: el modelo conserva el «FBA» para que se lea igual que el SKU
  shoesf: [/^(FBA\d+)-(\d{2}(?:[.,]5)?)$/i],
}

/** Nombre de cliente sin acentos, espacios ni mayúsculas: «Cobo Family» → «cobofamily» */
export function normalizarNombreCliente(nombre: string | null | undefined): string {
  return (nombre ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Los patrones de un cliente por su nombre («Cobo Family» → los de 'cobo'); [] si no tiene */
export function patronesDeCliente(nombre: string | null | undefined): RegExp[] {
  const n = normalizarNombreCliente(nombre)
  if (!n) return []
  const salida: RegExp[] = []
  for (const [clave, patrones] of Object.entries(PATRONES_DE_PARTIDA)) {
    if (n.includes(clave)) salida.push(...patrones)
  }
  return salida
}

/** La talla con punto decimal: «37,5» → «37.5» */
function normalizarTalla(t: string): string {
  return t.trim().replace(',', '.')
}

/**
 * El modelo y la talla de un SKU con el primer patrón que encaje; null si ninguno.
 * El modelo sale sin espacios sobrantes y la talla con punto decimal.
 */
export function modeloDesdeSku(sku: string, patrones: RegExp[]): { modelo: string; talla: string } | null {
  const s = (sku ?? '').trim()
  if (!s) return null
  for (const patron of patrones) {
    const m = patron.exec(s)
    if (!m) continue
    const modelo = (m[1] ?? '').trim().replace(/\s+/g, ' ')
    const talla = m[2] ?? ''
    if (!modelo || !talla) continue
    return { modelo, talla: normalizarTalla(talla) }
  }
  return null
}
