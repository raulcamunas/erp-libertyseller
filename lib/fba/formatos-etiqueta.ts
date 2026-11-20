/**
 * LAS HOJAS DE ETIQUETAS, SIN NADA DE PDF.
 * Pura: la usa la pantalla para ofrecer el desplegable de hojas sin arrastrar
 * jsPDF (unos 300 KB) al navegador. etiquetas.ts la vuelve a exportar.
 */

/** Hojas de etiquetas que se usan en Europa. Medidas en milímetros */
export interface FormatoHoja {
  id: string
  nombre: string
  /** Ancho y alto de la página */
  pagina: { ancho: number; alto: number }
  /** Cuántas etiquetas por fila y por columna */
  rejilla: { columnas: number; filas: number }
  /** Tamaño de cada etiqueta */
  etiqueta: { ancho: number; alto: number }
  /** Desde el borde de la página hasta la primera etiqueta */
  margen: { izquierda: number; arriba: number }
  /** Separación entre etiquetas */
  hueco: { horizontal: number; vertical: number }
}

export const FORMATOS: FormatoHoja[] = [
  {
    // El formato más común en España para esto. Cumple el mínimo de Amazon
    // (63,5 × 38,1 mm está por encima de 25 × 51 mm) con holgura.
    id: 'a4-21',
    nombre: 'A4 · 21 etiquetas (63,5 × 38,1 mm)',
    pagina: { ancho: 210, alto: 297 },
    rejilla: { columnas: 3, filas: 7 },
    etiqueta: { ancho: 63.5, alto: 38.1 },
    margen: { izquierda: 7.25, arriba: 15.15 },
    hueco: { horizontal: 2.5, vertical: 0 },
  },
  {
    id: 'a4-24',
    nombre: 'A4 · 24 etiquetas (70 × 37 mm)',
    pagina: { ancho: 210, alto: 297 },
    rejilla: { columnas: 3, filas: 8 },
    etiqueta: { ancho: 70, alto: 37 },
    margen: { izquierda: 0, arriba: 0.5 },
    hueco: { horizontal: 0, vertical: 0 },
  },
  {
    /**
     * EL MÁS DENSO QUE CABE EN UN A4, Y 4 COLUMNAS NO CABEN.
     *
     * Se pidió 4 × 10 = 40. No se puede, y el motivo es aritmética del código de
     * barras, no una limitación nuestra:
     *
     *   Un FNSKU de 10 caracteres en Code 128 son 145 módulos (arranque 11 +
     *   10 × 11 + control 11 + parada 13). Amazon exige que el módulo más
     *   estrecho mida 13,33 mils = 0,339 mm, así que las barras necesitan
     *   145 × 0,339 = 49,1 mm, más 6,35 mm de zona muda a cada lado:
     *
     *       ANCHO MÍNIMO DE ETIQUETA = 61,8 mm
     *
     *   Con 4 columnas en un A4 la etiqueta se queda en 48,5 mm: el módulo sale
     *   a 9,7 mils, un 27 % por debajo del mínimo. Imprimiría precioso y el
     *   escáner del almacén fallaría de forma intermitente. Y además incumple el
     *   mínimo de 51 mm de ancho de la propia especificación de «item label».
     *
     * Con 3 columnas la etiqueta mide 70 mm —módulo de 15,6 mils, holgado— y
     * caben 10 filas de 29,7. Eso son 30 por hoja: un 25 % más que el formato de
     * 24 y lo máximo que permite el código de barras.
     *
     * A 29,7 mm de alto solo entra UNA línea de título, y el alto de la barra se
     * recorta para que entre: ver el `Math.min` de dibujar().
     */
    id: 'a4-30',
    nombre: 'A4 · 30 etiquetas (70 × 29,7 mm)',
    pagina: { ancho: 210, alto: 297 },
    rejilla: { columnas: 3, filas: 10 },
    etiqueta: { ancho: 70, alto: 29.7 },
    margen: { izquierda: 0, arriba: 0 },
    hueco: { horizontal: 0, vertical: 0 },
  },
  {
    /**
     * LA HOJA DE 40 DE SELLER CENTRAL (4 × 10, 52,5 × 29,7 mm, sin márgenes). La usa ShoesF.
     *
     * El comentario de 'a4-30' explica por qué 4 columnas quedan por debajo del módulo de 13,33 mils de la
     * especificación. Amazon, sin embargo, ofrece esta hoja en Seller Central y sus almacenes la leen: es la que
     * el cliente ya pega. Aquí el módulo sale a 0,27 mm (10,8 mils) con la zona muda entera, por encima de lo
     * que la impresora resuelve (MODULO_MINIMO en etiquetas.ts).
     */
    id: 'a4-40',
    nombre: 'A4 · 40 etiquetas (52,5 × 29,7 mm), la de Amazon',
    pagina: { ancho: 210, alto: 297 },
    rejilla: { columnas: 4, filas: 10 },
    etiqueta: { ancho: 52.5, alto: 29.7 },
    margen: { izquierda: 0, arriba: 0 },
    hueco: { horizontal: 0, vertical: 0 },
  },
  {
    // Impresora térmica de rollo: una etiqueta por página
    id: 'termica-57x32',
    nombre: 'Térmica · rollo 57 × 32 mm',
    pagina: { ancho: 57, alto: 32 },
    rejilla: { columnas: 1, filas: 1 },
    etiqueta: { ancho: 57, alto: 32 },
    margen: { izquierda: 0, arriba: 0 },
    hueco: { horizontal: 0, vertical: 0 },
  },
]

/** Las hojas de las etiquetas de CAJA de Amazon (getLabels). La térmica es la de 10 × 15 cm */
export const HOJAS_CAJA = [
  { id: 'a4_2', texto: 'A4 · 2 por hoja' },
  { id: 'a4_4', texto: 'A4 · 4 por hoja' },
  { id: 'termica', texto: 'Térmica 10 × 15' },
  { id: 'folio', texto: 'Folio' },
] as const
export type HojaCaja = (typeof HOJAS_CAJA)[number]['id']

export const esFormatoProducto = (v: unknown): v is string => typeof v === 'string' && FORMATOS.some((f) => f.id === v)
export const esHojaCaja = (v: unknown): v is HojaCaja => typeof v === 'string' && HOJAS_CAJA.some((h) => h.id === v)

/** Lo que tiene fijado un cliente. null en cada una = la de siempre */
export interface PreferenciasEtiquetas {
  producto: string | null
  caja: HojaCaja | null
}
