/**
 * LEER UNA TABLA PEGADA DESDE UNA HOJA DE CÁLCULO.
 * PURA: sin pantalla ni red. Se comprueba con pegado.prueba.ts.
 *
 * Vive aparte del diálogo que la usa para poder probarse sola: es la parte que, si
 * se equivoca de columna, mete unidades donde van tallas y no se nota hasta que los
 * números no cuadran.
 */

/**
 * LA TABLA PEGADA.
 *
 * El alta no es un formulario fila a fila y no es por comodidad: una remesa de
 * ShoesF trae 83 líneas. Teclearlas es exactamente lo que hizo que el Excel
 * dejara de actualizarse, y un formulario lento aquí acabaría igual.
 *
 * Así que se pega directamente desde la hoja de cálculo. Se acepta lo que salga
 * de copiar unas celdas de Excel —columnas separadas por tabulador— y también
 * comas y punto y coma, porque a veces se pega desde un CSV.
 *
 *
 * ============ LAS COLUMNAS SE ADIVINAN, PERO SE ENSEÑAN ============
 *
 * Se detecta si la primera fila es una cabecera y se casan los nombres que ya
 * usabais («FBASKU», «Unidades a enviar», «Talla»…). Pero el resultado se PINTA
 * antes de guardar: adivinar sin enseñar es como se acaba metiendo una columna
 * de tallas en el hueco de las unidades y no enterarse hasta que los números no
 * cuadran.
 */

export interface LineaPegada {
  sku: string
  unidades: number
  referencia: string | null
  nombre: string | null
  variante: string | null
  ean: string | null
  fnsku: string | null
  asin: string | null
}

/** Los nombres que ya se usaban en el Excel, más los evidentes */
const NOMBRES: Record<keyof LineaPegada, string[]> = {
  sku: ['fbasku', 'sku', 'msku', 'seller sku', 'sku amazon'],
  unidades: ['unidades a enviar', 'unidades', 'cantidad', 'uds', 'qty', 'quantity'],
  referencia: ['ref', 'referencia', 'modelo'],
  nombre: ['nombre y color', 'nombre', 'producto', 'titulo', 'título', 'descripcion', 'descripción'],
  variante: ['talla', 'variante', 'color', 'size'],
  ean: ['ean', 'codigo de barras', 'código de barras', 'barcode'],
  fnsku: ['fnsku'],
  asin: ['asin'],
}

function partirFilas(texto: string): string[][] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => (l.includes('\t') ? l.split('\t') : l.includes(';') ? l.split(';') : l.split(',')))
    .map((c) => c.map((x) => x.trim().replace(/^"|"$/g, '')))
}

function esCabecera(fila: string[]): boolean {
  const norm = fila.map((c) => c.toLowerCase())
  return Object.values(NOMBRES).some((alias) => norm.some((c) => alias.includes(c)))
}

function mapearColumnas(cabecera: string[]): Partial<Record<keyof LineaPegada, number>> {
  const norm = cabecera.map((c) => c.toLowerCase().trim())
  const mapa: Partial<Record<keyof LineaPegada, number>> = {}
  for (const [campo, alias] of Object.entries(NOMBRES) as Array<[keyof LineaPegada, string[]]>) {
    const i = norm.findIndex((c) => alias.includes(c))
    if (i >= 0) mapa[campo] = i
  }
  return mapa
}

export function interpretar(texto: string): { lineas: LineaPegada[]; avisos: string[] } {
  const filas = partirFilas(texto)
  const avisos: string[] = []
  if (filas.length === 0) return { lineas: [], avisos }

  const conCabecera = esCabecera(filas[0])
  const mapa = conCabecera
    ? mapearColumnas(filas[0])
    : // Sin cabecera se asume el orden mínimo: SKU y unidades. Es lo único
      // que se puede suponer sin equivocarse a lo grande.
      { sku: 0, unidades: 1 }
  const cuerpo = conCabecera ? filas.slice(1) : filas

  if (mapa.sku === undefined || mapa.unidades === undefined) {
    avisos.push(
      'No encuentro la columna del SKU o la de las unidades. Pega también la fila de títulos, ' +
        'o deja el SKU en la primera columna y las unidades en la segunda.'
    )
    return { lineas: [], avisos }
  }

  const lineas: LineaPegada[] = []
  const vistos = new Map<string, number>()

  for (const [i, c] of cuerpo.entries()) {
    const sku = (c[mapa.sku] ?? '').trim()
    if (!sku) continue

    // Las hojas de cálculo escriben 1.234 o 1,5. Se queda solo lo numérico.
    const bruto = (c[mapa.unidades] ?? '').replace(/[^\d-]/g, '')
    const unidades = Number(bruto)
    if (!Number.isInteger(unidades) || unidades <= 0) {
      avisos.push(`Fila ${i + 1} (${sku}): «${c[mapa.unidades] ?? ''}» no son unidades válidas`)
      continue
    }

    if (vistos.has(sku)) {
      // Se SUMAN en vez de rechazar: dos cajas del mismo modelo en una hoja es
      // lo normal, y hacer que el usuario las sume a mano es pedirle que haga
      // justo lo que esto viene a evitar.
      const idx = vistos.get(sku)!
      lineas[idx].unidades += unidades
      continue
    }

    const texto = (campo: keyof LineaPegada): string | null => {
      const i = mapa[campo]
      if (i === undefined) return null
      const v = (c[i] ?? '').trim()
      return v.length > 0 ? v : null
    }

    vistos.set(sku, lineas.length)
    lineas.push({
      sku,
      unidades,
      referencia: texto('referencia'),
      nombre: texto('nombre'),
      variante: texto('variante'),
      ean: texto('ean'),
      fnsku: texto('fnsku'),
      asin: texto('asin'),
    })
  }

  return { lineas, avisos }
}

