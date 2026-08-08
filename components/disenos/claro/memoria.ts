/**
 * MEMORIA DE LA PROPUESTA «CLARO Y NÍTIDO».
 *
 * Los números de aquí NO están estimados: los ratios salen de aplicar WCAG 2.1
 * a los pares reales de esta paleta, y las alturas de fila y el cromo están
 * medidos en navegador contra el marcado de estos mismos componentes.
 * La pantalla «Ficha» de la propuesta los pinta desde este fichero, así que si
 * un color cambia y el número no, se ve.
 */

export const IDEA =
  'El ERP pasa a fondo papel con tinta oscura, tres niveles de texto en vez de dieciséis y ' +
  'el naranja partido en dos usos —relleno intacto, texto oscurecido—, para que quepa un ' +
  '37 % más de filas leyendo con letra más grande.'

export const MODO_PRINCIPAL = 'claro'

/* ------------------------------------------------------------------ */
/* Escala tipográfica                                                  */
/* ------------------------------------------------------------------ */

export interface NivelTexto {
  nombre: string
  px: number
  grosor: number
  para: string
}

/** Cinco tamaños y tres grosores, contra los 28 tamaños y 4 grosores de hoy. */
export const TIPOGRAFIA: NivelTexto[] = [
  { nombre: 'Título', px: 20, grosor: 600, para: 'El h1 de la pantalla. Uno solo, y no vuelve a aparecer. Hoy son 36 px.' },
  { nombre: 'Cifra', px: 17, grosor: 600, para: 'El número de un indicador. Siempre tabular.' },
  { nombre: 'Cuerpo', px: 13, grosor: 400, para: 'EL DATO: celdas de tabla, valores, campos. Hoy este texto es de 11 o 12 px.' },
  { nombre: 'Apoyo', px: 12, grosor: 400, para: 'Contexto: descripciones, notas al pie, ayudas, botones.' },
  { nombre: 'Etiqueta', px: 11, grosor: 600, para: 'Cabecera de columna y etiqueta de campo, en versales. Hoy son 10 px al 35-40 % de opacidad.' },
]

/** Los tres niveles de tinta. Ni uno más: no caben cuatro grises distinguibles. */
export const NIVELES_TINTA = [
  { nivel: 'Tinta 1', claro: '#17140F', oscuro: '#F7F3ED', para: 'El dato. Nombres, cifras, lo que se viene a leer.' },
  { nivel: 'Tinta 2', claro: '#554E45', oscuro: '#B7AEA2', para: 'Contexto: notas, descripciones, etiquetas de campo, valores secundarios.' },
  { nivel: 'Tinta 3', claro: '#6B6357', oscuro: '#A0978B', para: 'Metadatos: cabeceras de columna, ayudas, marcadores de posición, «no hay dato».' },
]

/* ------------------------------------------------------------------ */
/* Paleta                                                              */
/* ------------------------------------------------------------------ */

export interface Token {
  nombre: string
  claro: string
  oscuro: string
  para: string
}

export const PALETA: Token[] = [
  { nombre: 'lienzo', claro: '#F2EEE7', oscuro: '#131110', para: 'El fondo de la página. Papel cálido, no blanco puro: el blanco a pantalla completa y a ocho horas es un foco.' },
  { nombre: 'papel', claro: '#FFFFFF', oscuro: '#1C1917', para: 'La superficie de trabajo: tablas, cajas, menú, barra superior.' },
  { nombre: 'papel2', claro: '#FAF7F2', oscuro: '#232019', para: 'Cabecera de tabla, fila bajo el ratón y (solo en oscuro) el rayado.' },
  { nombre: 'selec', claro: '#EFE7DA', oscuro: '#33291C', para: 'La fila seleccionada. Neutro a propósito: el naranja ya significa otra cosa.' },
  { nombre: 'marca', claro: '#FF6600', oscuro: '#FF6600', para: 'EL NARANJA, INTACTO. Solo como RELLENO y como gráfico: botón principal, raíl del módulo activo, contador vivo.' },
  { nombre: 'marca-texto', claro: '#A84300', oscuro: '#FF9552', para: 'El naranja cuando es TEXTO o icono. Mismo tono (24°) y misma saturación, otra luminosidad.' },
  { nombre: 'sobre-marca', claro: '#17140F', oscuro: '#17140F', para: 'La etiqueta que va encima del relleno naranja. Oscura, nunca blanca.' },
  { nombre: 'lavado', claro: '#FFE2CC', oscuro: '#3A2410', para: 'Fondo naranja muy suave del módulo activo del menú. Es decoración: contra el papel da 1,24:1, así que no cuenta como canal. Ya no se usa como halo de foco, donde tampoco se veía.' },
  { nombre: 'regla', claro: '#E6DFD3', oscuro: '#292521', para: 'La línea entre filas.' },
  { nombre: 'regla5', claro: '#D6CDBD', oscuro: '#38322B', para: 'La línea reforzada de cada cinco filas: ancla para el ojo sin ruido de rayado.' },
  { nombre: 'borde', claro: '#D8D0C1', oscuro: '#35302A', para: 'El borde estructural de cajas, tablas y controles. Aquí no hay sombras.' },
  { nombre: 'aviso', claro: '#7E5C00', oscuro: '#F2C33C', para: 'Ojo con esto: frenos apagados, columna que casa solo por el principio.' },
  { nombre: 'error', claro: '#AB211A', oscuro: '#FF9089', para: 'Roto: columna que no se encuentra, envío rechazado.' },
  { nombre: 'ok', claro: '#0E6B39', oscuro: '#54DC91', para: 'Confirmado: campo guardado, columna que casa exacta, envío aceptado.' },
]

/* ------------------------------------------------------------------ */
/* Contrastes medidos                                                  */
/* ------------------------------------------------------------------ */

export interface Medida {
  par: string
  claro: number
  oscuro: number
  umbral: number
  /** Lo que da hoy la misma combinación, si existe */
  hoyClaro?: number
  hoyOscuro?: number
}

/**
 * Umbral 4,5 para texto normal (todo el texto de esta propuesta lo es: el mayor
 * de una celda son 13 px) y 3,0 para gráficos que llevan significado.
 * «claro» y «oscuro» son el PEOR caso de las cuatro superficies del modo:
 * papel, lienzo, papel2 y fila seleccionada.
 */
export const CONTRASTES: Medida[] = [
  { par: 'Tinta 1 — el dato', claro: 14.97, oscuro: 12.88, umbral: 4.5 },
  { par: 'Tinta 2 — notas y etiquetas de campo', claro: 6.68, oscuro: 6.50, umbral: 4.5, hoyClaro: 4.06, hoyOscuro: 2.86 },
  { par: 'Tinta 3 — cabecera de columna', claro: 4.82, oscuro: 4.95, umbral: 4.5, hoyClaro: 4.06, hoyOscuro: 3.38 },
  { par: 'Naranja de TEXTO sobre fondo claro', claro: 4.93, oscuro: 6.56, umbral: 4.5, hoyClaro: 2.57, hoyOscuro: 6.62 },
  { par: 'Etiqueta del botón principal sobre #FF6600', claro: 6.26, oscuro: 6.26, umbral: 4.5, hoyClaro: 2.94, hoyOscuro: 2.94 },
  { par: 'Módulo activo del menú', claro: 4.90, oscuro: 6.72, umbral: 4.5, hoyClaro: 2.43, hoyOscuro: 6.62 },
  { par: 'Aviso (texto sobre su fondo)', claro: 5.57, oscuro: 9.14, umbral: 4.5, hoyClaro: 3.86, hoyOscuro: 10.12 },
  { par: 'Error (texto sobre su fondo)', claro: 5.86, oscuro: 7.42, umbral: 4.5, hoyClaro: 4.42, hoyOscuro: 8.36 },
  { par: 'Correcto (texto sobre su fondo)', claro: 5.62, oscuro: 8.73, umbral: 4.5, hoyClaro: 3.78, hoyOscuro: 10.01 },
]

/**
 * El peor caso de cada estado de Cold Calling: raíl (gráfico, 3:1) y texto (4,5:1).
 *
 * OJO CON LA SUPERFICIE, que es donde es fácil equivocarse y donde estuvo mal:
 * el raíl NO vive sobre el lienzo de la página, vive dentro de la celda congelada
 * (`td[data-fija="si"]`, estilos.ts:363), cuyo fondo es papel, papel2 al pasar por
 * encima o selec en la fila elegida. El peor de esos tres es SIEMPRE la fila
 * seleccionada, y es el que va aquí. Medir contra el lienzo daba entre 0,24 y 0,26
 * de más en cada estado, o sea que la ficha se estaba adjudicando un margen que no
 * tenía.
 *
 * El texto sí se mide contra las mismas tres superficies, y esos números no
 * cambian.
 *
 * `railClaro`/`railOscuro` en null quiere decir que ese estado NO PINTA RAÍL:
 * «Sin contactar» lo lleva transparente a propósito (estilos.ts:385), porque
 * todavía no ha pasado nada y no pintar es la forma más honesta de decirlo. En
 * oscuro su gris daría 2,95:1 contra la fila seleccionada; no se declara un ratio
 * de algo que no se dibuja.
 */
export const CONTRASTES_ESTADO: {
  estado: string
  railClaro: number | null
  textoClaro: number
  railOscuro: number | null
  textoOscuro: number
}[] = [
  { estado: 'Sin contactar', railClaro: null, textoClaro: 6.13, railOscuro: null, textoOscuro: 6.53 },
  { estado: 'No contesta', railClaro: 3.08, textoClaro: 5.01, railOscuro: 7.43, textoOscuro: 8.58 },
  { estado: 'Rellamada programada', railClaro: 3.81, textoClaro: 5.89, railOscuro: 5.87, textoOscuro: 8.18 },
  { estado: 'Info enviada', railClaro: 4.27, textoClaro: 6.08, railOscuro: 4.12, textoOscuro: 6.60 },
  { estado: 'En seguimiento', railClaro: 3.90, textoClaro: 5.71, railOscuro: 5.08, textoOscuro: 7.08 },
  { estado: 'Cita cualificada', railClaro: 3.73, textoClaro: 5.38, railOscuro: 6.25, textoOscuro: 8.15 },
  { estado: 'No le interesa', railClaro: 4.30, textoClaro: 5.77, railOscuro: 3.78, textoOscuro: 6.51 },
]

/* ------------------------------------------------------------------ */
/* Densidad medida                                                     */
/* ------------------------------------------------------------------ */

export interface Densidad {
  viewport: number
  equivale: string
  hoy: number
  propuesta: number
}

/**
 * Filas visibles sin scroll en Cold Calling, vista tabla.
 *
 * MEDIDO EN NAVEGADOR contra una réplica del marcado de estos componentes, no
 * estimado: mismo CSS (se lee del propio estilos.ts), mismas columnas, mismos
 * controles dentro de las celdas. Las cifras de «hoy» son las del informe de
 * diagnóstico, medidas igual.
 *
 * Propuesta: fila de 32 px exactos y 213 px de cromo a 1920 de ancho. A 1440 de
 * ancho la barra de filtros pasa a dos líneas y el cromo sube a 245 px — por eso
 * el portátil gana cinco filas y no siete.
 */
export const FILAS_COLD_CALLING: Densidad[] = [
  { viewport: 1080, equivale: 'monitor 1080 a pantalla completa (1920 de ancho)', hoy: 19, propuesta: 26 },
  { viewport: 940, equivale: 'monitor 1920×1080 con Chrome y la barra de macOS', hoy: 15, propuesta: 21 },
  { viewport: 900, equivale: '1920 de ancho', hoy: 14, propuesta: 20 },
  { viewport: 780, equivale: 'portátil 1440×900 con Chrome (los filtros pasan a dos líneas)', hoy: 10, propuesta: 15 },
]

/**
 * Módulos visibles sin scroll en la pantalla de inicio.
 *
 * El lanzador tiene 17 entradas, no 18: «Inicio» se queda solo en el menú.
 * Una tarjeta que lleva a la pantalla en la que ya estás es ruido. Hoy son 18
 * tarjetas de 202 px; aquí son 17 filas de 38 px, y caben todas siempre.
 */
export const APPS_VISIBLES: Densidad[] = [
  { viewport: 1080, equivale: 'monitor 1080 a pantalla completa', hoy: 14, propuesta: 17 },
  { viewport: 940, equivale: 'monitor con Chrome', hoy: 12, propuesta: 17 },
  { viewport: 780, equivale: 'portátil 1440×900 con Chrome', hoy: 8, propuesta: 17 },
]

/** Todo esto está medido en navegador, no calculado a mano. */
export const MEDIDO_EN_NAVEGADOR = {
  altoFila: 32,
  altoFilaHoy: 35.5,
  altoCabeceraTabla: 30.9,
  /** Barra superior + cabecera + filtros + pie, a 1920 de ancho */
  cromoColdCalling: 213.4,
  /** A 1440 de ancho, con los filtros en dos líneas */
  cromoColdCalling1440: 245.4,
  cromoHoy: 396.5,
  altoAppInicio: 38,
  altoTarjetaHoy: 202,
  /** Alto del contenido del lanzador con los 17 módulos y las 4 agujas */
  altoInicio: 525,
  /** Los 18 módulos del menú: nunca scrollea, ni en un portátil */
  altoMenuConLos18Modulos: 522,
  altoMenuHoy: 1049,
}

/* ------------------------------------------------------------------ */
/* Balance honesto                                                     */
/* ------------------------------------------------------------------ */

export const GANAS: string[] = [
  'Siete filas más de tabla en un monitor de 1080 (26 contra 19) y cinco más en un portátil (15 contra 10), y encima con el dato a 13 px en vez de a 11 o 12.',
  'Todo el texto de la propuesta pasa 4,5:1 en los dos modos. Hoy fallan 682 usos en oscuro (31 %) y 804 en claro (37 %).',
  'El botón principal del ERP pasa de 2,94:1 a 6,26:1 sin tocar el #FF6600: cambia la etiqueta, no el naranja.',
  'En tema claro se vuelve a ver en qué módulo estás: 4,90:1 contra los 2,43:1 de hoy.',
  'Tres niveles de tinta en vez de dieciséis, y cinco tamaños de letra en vez de veintiocho.',
  'Los 18 módulos caben en el menú sin que el propio menú scrollee: 522 px contra 1.049. Hoy, en un portátil, se ven once de dieciocho.',
  'Cada estado tiene icono propio, palabra y color, en ese orden. Hay un interruptor «sin color» para comprobarlo.',
  'Los dos modos están declarados enteros y por separado: no hay capa de traducción que deje una superficie sin definir, como le pasa hoy a glass-card.',
]

export const PIERDES: string[] = [
  'Se va el cristal. Nada de backdrop-filter, ni el fondo animado, ni las tarjetas de 24 px de radio. La primera impresión es más sobria; quien enseñe el ERP en una reunión pierde el efecto y gana una tabla que se lee.',
  'El naranja aparece muchísimo menos: de 720 apariciones a unas pocas por pantalla. Al principio va a parecer que la marca se ha diluido. Es exactamente el objetivo, pero hay que decirlo antes de que lo diga otro.',
  'El naranja de TEXTO sobre claro (#A84300) es un naranja quemado, y al lado del #FF6600 se ve apagado. No hay alternativa: el tono de marca a plena luminosidad no llega a 4,5:1 sobre blanco ni acercándose.',
  'Los colores aprendidos del Excel de Cold Calling se conservan en oscuro tal cual, pero en claro hay que oscurecerlos para que se vean sobre papel. El amarillo #EAB308 baja a #A87C00 y a esa luminosidad parece más ocre que amarillo.',
  'La fila deja de teñirse entera. Quien venga del Excel y barra la lista por manchas de color va a echarlo de menos la primera semana; el raíl de 3 px hace el mismo trabajo con menos ruido, pero es un hábito que hay que cambiar.',
  'La barra superior cuesta 48 px fijos que hoy no se pagan. Se recuperan de sobra al quitar el bloque de título de cada pantalla, pero es cromo nuevo.',
  'Tres niveles de tinta obligan a decidir. Hoy, cuando algo tiene que pesar un poco menos, se baja la opacidad y listo; aquí hay que elegir entre tamaño, grosor o nivel, y a veces no habrá un hueco cómodo.',
  'Adoptarlo de verdad es reescribir 3.118 declaraciones de color de texto y 720 de naranja. Esto es una maqueta de tres pantallas: el coste real está en las otras quince.',
]
