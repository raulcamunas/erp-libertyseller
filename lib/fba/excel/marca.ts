/**
 * LA MARCA DE LOS EXCEL DE LIBERTY SELLER.
 * ========================================
 * Constantes puras. Nada de lógica: quien arma un Excel las usa y ya.
 *
 * NO SON UNA PALETA INVENTADA. Salen de los Excel que el equipo ya entrega a los
 * clientes —el de «Qué mandar a logística de Amazon» y el de «Rendimiento por producto,
 * mes a mes»—, leídos celda a celda: la banda oscura de cabecera con la franja naranja
 * encima, los títulos en Sora, el cuerpo en Inter, las tarjetas de cifras en crema con
 * filo naranja y las tablas con la cabecera oscura. Un documento nuevo tiene que
 * parecer del mismo juego que los anteriores, y por eso los colores van aquí con el
 * valor medido y no con uno «parecido».
 *
 * Los colores van SIN almohadilla y SIN canal alfa («F26212»): el escritor los
 * convierte al ARGB que pide Excel.
 */

export const COLOR = {
  /** La banda de cabecera y la cabecera de las tablas */
  banda: '0E0E0E',
  /** El naranja de marca: franja, títulos destacados, filos */
  naranja: 'F26212',
  /** El naranja claro, para cifras sobre fondo oscuro */
  naranjaClaro: 'FF8A3D',
  /** El crema de las tarjetas de cifras y de las filas alternas */
  crema: 'F7F5F2',
  /** El fondo del recuadro de avisos */
  aviso: 'FBEFE8',
  /** Tinta: el texto de las celdas */
  tinta: '141414',
  /** Rótulos y texto secundario sobre claro */
  etiqueta: '5E5852',
  /** Pies y notas que no tienen que llamar la atención */
  discreto: '8C857C',
  /** El texto secundario sobre la banda oscura */
  apagado: 'B8AE9F',
  /** El texto de apoyo (subtítulos) sobre la banda oscura */
  claro: 'EDE6DC',
  /** La raya fina entre filas */
  raya: 'E5E1DB',
  blanco: 'FFFFFF',
} as const

export const FUENTE = {
  /** Títulos, rótulos de tabla y cifras */
  titulo: 'Sora',
  /** Todo lo demás */
  cuerpo: 'Inter',
} as const

/** El naranja de marca como color de pestaña */
export const COLOR_PESTANA = COLOR.naranja
