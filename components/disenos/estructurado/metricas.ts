import { DENSIDAD, type Densidad } from './tokens'

/**
 * LA DENSIDAD, CONTADA.
 *
 * «Cuántas filas caben sin hacer scroll» es una métrica de producto en un equipo que
 * mira tablas de miles de filas ocho horas al día, no un detalle de maquetación. Aquí
 * está el presupuesto de píxeles de cada pantalla, sumando pieza por pieza, para que
 * el número que sale en el README se pueda comprobar y no haya que creérselo.
 *
 * Los números de HOY están medidos en el informe de diagnóstico, en navegador y sobre
 * una réplica del marcado real.
 */

/** Cromo de HOY, medido (informe §4.2) */
export const HOY = {
  coldCalling: { cromo: 396.5, fila: 35.5 },
  catalogo: { cromo: 525, fila: 33 },
}

/**
 * Cromo de la PROPUESTA, pieza por pieza.
 *
 * La barra superior de 48 px se paga UNA vez para todo el ERP y sustituye a algo que
 * hoy se paga en cada pantalla: el título de 36 px más su subtítulo, entre 76 y 79 px
 * por pantalla. O sea que el armazón nuevo, con contexto, migas y buscador, sale más
 * barato en alto que el título que hoy no dice nada que no diga ya la barra lateral.
 */
export const PROPUESTA = {
  barraSuperior: 48,
  /** padding del área de contenido, arriba y abajo */
  paddingMain: 12 * 2,
  /** tira de cifras (sustituye a cuatro tarjetas de 57,5 px) */
  cifras: 30,
  /** barra de herramientas: buscador, chips de estado, orden */
  herramientas: 28,
  /** pie: «Ver más (N restantes)» */
  pie: 26,
  /** tres huecos de 8 px entre las cuatro piezas del área de contenido */
  huecos: 8 * 3,
  /** el borde de la caja de la tabla, arriba y abajo */
  bordesTabla: 2,
  cabeceraTabla: 26,
}

export const CROMO_PROPUESTA =
  PROPUESTA.barraSuperior +
  PROPUESTA.paddingMain +
  PROPUESTA.cifras +
  PROPUESTA.herramientas +
  PROPUESTA.pie +
  PROPUESTA.huecos +
  PROPUESTA.bordesTabla +
  PROPUESTA.cabeceraTabla

/** Filas visibles sin scroll con la propuesta */
export function filasPropuesta(altoVentana: number, densidad: Densidad): number {
  return Math.max(0, Math.floor((altoVentana - CROMO_PROPUESTA) / DENSIDAD[densidad].fila))
}

/** Filas visibles sin scroll con el ERP de hoy */
export function filasHoy(altoVentana: number, pantalla: keyof typeof HOY): number {
  const p = HOY[pantalla]
  return Math.max(0, Math.floor((altoVentana - p.cromo) / p.fila))
}

/** Las alturas de ventana del informe: sobremesa, sobremesa con Chrome, portátil */
export const VENTANAS = [
  { alto: 1080, que: 'Monitor 1080 a pantalla completa' },
  { alto: 940, que: 'Monitor 1920×1080 con Chrome y la barra de macOS' },
  { alto: 780, que: 'Portátil 1440×900 con Chrome' },
]

/** La tabla que se publica en el README, calculada aquí y no a mano */
export function tablaDensidad() {
  return VENTANAS.map((v) => ({
    ...v,
    coldHoy: filasHoy(v.alto, 'coldCalling'),
    catalogoHoy: filasHoy(v.alto, 'catalogo'),
    compacta: filasPropuesta(v.alto, 'compacta'),
    normal: filasPropuesta(v.alto, 'normal'),
    comoda: filasPropuesta(v.alto, 'comoda'),
  }))
}
