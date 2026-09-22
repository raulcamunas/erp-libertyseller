/**
 * CODE 128, EL CÓDIGO DE BARRAS QUE EXIGE AMAZON EN LAS ETIQUETAS DE PRODUCTO.
 * ===========================================================================
 *
 * Se escribe aquí en vez de meter una librería por dos motivos:
 *
 *   1. Son ochenta líneas y el estándar no cambia desde 1981. Una dependencia
 *      más es una dependencia más que actualizar y auditar para siempre.
 *   2. Lo que devuelve es una lista de anchos de barra, no una imagen. Así el
 *      mismo cálculo sirve para el PDF de jsPDF y para cualquier otra cosa, sin
 *      pasar por un canvas ni por una imagen intermedia que pierda nitidez —y la
 *      nitidez es exactamente lo que hace que un escáner lea o no lea.
 *
 * Se usa el SUBCONJUNTO B: los FNSKU de Amazon son alfanuméricos en mayúsculas
 * (X002I7R3N3) y el C solo sirve para dígitos.
 */

/**
 * Los 107 patrones del estándar, uno por símbolo.
 *
 * Cada cadena son seis dígitos que se leen alternando: barra, hueco, barra,
 * hueco, barra, hueco. «212222» es barra de 2 módulos, hueco de 1, barra de 2…
 */
const PATRONES = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
]

const INICIO_B = 104
const PARADA = 106

/** Una barra o un hueco: cuántos módulos mide y si pinta */
export interface Modulo {
  ancho: number
  pinta: boolean
}

/**
 * De un texto a la lista de barras y huecos.
 *
 * Devuelve `null` si el texto lleva algo que el subconjunto B no sabe codificar
 * —una eñe, un acento, un carácter de control—. NO se sustituye ni se recorta en
 * silencio: un código de barras que se imprime pero no se lee es peor que uno
 * que no se imprime, porque el error se descubre en el almacén de Amazon.
 */
export function code128B(texto: string): Modulo[] | null {
  const valores: number[] = []

  for (const caracter of texto) {
    const punto = caracter.codePointAt(0)
    // El subconjunto B cubre del espacio (32) al DEL (126)
    if (punto === undefined || punto < 32 || punto > 126) return null
    valores.push(punto - 32)
  }

  if (valores.length === 0) return null

  // La suma de control: el inicio, más cada símbolo por su posición, módulo 103
  let suma = INICIO_B
  valores.forEach((v, i) => {
    suma += v * (i + 1)
  })
  const control = suma % 103

  const simbolos = [INICIO_B, ...valores, control, PARADA]

  const modulos: Modulo[] = []
  for (const simbolo of simbolos) {
    const patron = PATRONES[simbolo]
    for (let i = 0; i < patron.length; i++) {
      modulos.push({ ancho: Number(patron[i]), pinta: i % 2 === 0 })
    }
  }

  return modulos
}

/** Cuántos módulos de ancho ocupa el código entero. Sirve para escalarlo */
export function anchoEnModulos(modulos: Modulo[]): number {
  return modulos.reduce((s, m) => s + m.ancho, 0)
}
