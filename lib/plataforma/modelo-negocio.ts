/**
 * EL MODELO DE NEGOCIO DEL CLIENTE, Y QUÉ SE MIDE POR ELLO.
 *
 * Este fichero contesta a una sola pregunta: ¿le pedimos el BSR a este SKU?
 *
 * Parece un detalle de configuración y es lo que decide si la ventana nocturna
 * cabe o no. ShoesF tiene ~13.700 SKU y Keslem hasta 30.000, los dos de
 * reventa. Pedirles BSR a diario son ~44.000 llamadas a Catalog Items, que va a
 * 2 peticiones por segundo: unas SEIS HORAS cada noche midiendo el ranking de
 * productos que no son suyos.
 *
 *
 * POR QUÉ EL BSR NO VALE LO MISMO EN LOS DOS MODELOS
 * --------------------------------------------------
 * En MARCA PROPIA el ASIN es del cliente. El BSR es su termómetro: si su
 * producto sube o baja en su categoría, es cosa suya y hay que verlo.
 *
 * En ARBITRAJE el cliente es uno de quince vendedores sobre el ASIN de otro. El
 * BSR mide cómo se vende EL PRODUCTO, no cómo lo hace él. Puede mejorar mientras
 * el cliente pierde todas sus ventas por no tener la Buy Box, y al revés. Ahí lo
 * que decide es Buy Box y precio.
 *
 *
 * POR QUÉ EN ARBITRAJE NO SE APAGA DEL TODO
 * -----------------------------------------
 * Porque sin el rol de Análisis de marcas no tenemos datos de velocidad de
 * ventas, y el BSR es la ÚNICA señal de rotación que queda para decidir si un
 * FBM merece pasar a FBA (módulo A4). Apagarlo entero dejaría ese análisis sin
 * ninguna entrada.
 *
 * Lo que se quita es el barrido diario del catálogo completo. La medición
 * puntual de los SKU que alguien está evaluando se queda: eso son decenas o
 * cientos de llamadas, no cuarenta mil.
 *
 *
 * POR QUÉ NO BASTA CON EL CAMPO DEL CLIENTE
 * -----------------------------------------
 * Por «mix», que no es un caso raro: es lo normal en cuanto un revendedor saca
 * su propia marca. Ahí la pregunta no tiene respuesta a nivel de cliente y hay
 * que resolverla SKU a SKU con `es_marca_propia`. El modelo del cliente fija la
 * política; la columna del SKU la afina.
 */

/** Cómo vende el cliente. Lo ponemos nosotros: Amazon no lo sabe */
export type ModeloNegocio = 'marca_propia' | 'arbitraje' | 'mix'

/**
 * Cada cuánto se mide el BSR.
 *
 * `auto` es lo normal y se deduce del modelo. Los otros tres existen para la
 * excepción: un cliente de marca propia con veinte mil referencias heredadas, o
 * un revendedor que está preparando el lanzamiento de su marca.
 */
export type PoliticaBsr = 'auto' | 'diario' | 'bajo_demanda' | 'nunca'

/** Lo que sale de resolver: ya sin `auto`, que aquí no significa nada */
export type CadenciaBsr = 'diario' | 'bajo_demanda' | 'nunca'

export const MODELO_NEGOCIO_LABELS: Record<ModeloNegocio, string> = {
  marca_propia: 'Marca propia',
  arbitraje: 'Arbitraje / reventa',
  mix: 'Mixto',
}

export const MODELO_NEGOCIO_AYUDA: Record<ModeloNegocio, string> = {
  marca_propia:
    'Los ASIN son suyos. El BSR es su termómetro y se mide a diario. Suelen ser catálogos cortos.',
  arbitraje:
    'Revende marcas de terceros. El BSR es del producto, no suyo: lo que decide es la Buy Box. Se mide solo bajo demanda, que es lo que evita barrer decenas de miles de referencias cada noche.',
  mix: 'Las dos cosas. Se resuelve referencia a referencia según esté marcada como marca propia.',
}

export const POLITICA_BSR_LABELS: Record<PoliticaBsr, string> = {
  auto: 'Según el modelo de negocio',
  diario: 'Siempre, a diario',
  bajo_demanda: 'Solo lo que se esté evaluando',
  nunca: 'No medir el BSR',
}

/**
 * ¿Con qué cadencia se mide el BSR de ESTE SKU de ESTE cliente?
 *
 * Pura y con todo por parámetro: es la función que decide el gasto de la ventana
 * nocturna, así que tiene que poder probarse sin base de datos delante.
 *
 * El orden importa. La política explícita gana siempre —es la excepción que
 * alguien ha puesto a mano— y solo si es `auto` se mira el modelo. Dentro de
 * `auto`, `mix` es el único que baja al SKU.
 */
export function cadenciaBsr(params: {
  modelo: ModeloNegocio
  politica: PoliticaBsr
  /** Del SKU. Solo se mira cuando el modelo es `mix` */
  esMarcaPropia: boolean
}): CadenciaBsr {
  if (params.politica !== 'auto') return params.politica

  switch (params.modelo) {
    case 'marca_propia':
      return 'diario'
    case 'arbitraje':
      return 'bajo_demanda'
    case 'mix':
      // El único caso que baja al SKU, y el motivo de que esto no sea un
      // booleano en la ficha del cliente.
      return params.esMarcaPropia ? 'diario' : 'bajo_demanda'
  }
}

/**
 * ¿Entra este SKU en el barrido DIARIO de BSR?
 *
 * El de verdad: es la condición que se aplica sobre el conjunto activo antes de
 * gastar una sola llamada.
 */
export function entraEnBsrDiario(params: {
  modelo: ModeloNegocio
  politica: PoliticaBsr
  esMarcaPropia: boolean
}): boolean {
  return cadenciaBsr(params) === 'diario'
}

/**
 * Lo que se le dice al usuario cuando mira por qué un SKU no tiene BSR.
 *
 * Sin esto, «sin datos» se lee como «falla algo» cuando en realidad es una
 * decisión tomada a propósito y que le ahorra horas de cupo. Un hueco explicado
 * no es un hueco.
 */
export function porQueSinBsr(params: {
  modelo: ModeloNegocio
  politica: PoliticaBsr
  esMarcaPropia: boolean
}): string | null {
  const cadencia = cadenciaBsr(params)
  if (cadencia === 'diario') return null

  if (params.politica === 'nunca') {
    return 'Este cliente tiene el BSR desactivado a mano.'
  }
  if (params.politica === 'bajo_demanda') {
    return 'Este cliente mide el BSR solo bajo demanda. Pídelo desde la ficha del producto.'
  }
  if (params.modelo === 'arbitraje') {
    return (
      'Es un cliente de reventa: el BSR de este ASIN es del producto, no suyo, así que no se mide ' +
      'a diario. Se puede pedir puntualmente desde la ficha.'
    )
  }
  return (
    'Esta referencia no está marcada como marca propia, así que su BSR es el del producto de otro ' +
    'y no se mide a diario. Se puede pedir puntualmente desde la ficha.'
  )
}
