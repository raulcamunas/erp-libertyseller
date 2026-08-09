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

/**
 * Los tres, en el orden en el que se ofrecen en pantalla.
 *
 * Existe para que ni el desplegable de la pestaña Cuentas ni la validación de la
 * ruta de API tengan que volver a escribir la lista: un cuarto modelo mañana se
 * añade aquí y aparece en los dos sitios. `Object.keys()` sobre el mapa de
 * etiquetas no vale — no garantiza el orden y devuelve `string[]`.
 */
export const MODELOS_NEGOCIO: readonly ModeloNegocio[] = [
  'marca_propia',
  'arbitraje',
  'mix',
] as const

export const POLITICAS_BSR: readonly PoliticaBsr[] = [
  'auto',
  'diario',
  'bajo_demanda',
  'nunca',
] as const

/**
 * ¿Es un modelo de verdad?
 *
 * Para la ruta de API: el cuerpo llega del navegador, y sin esto un
 * `{"modelo_negocio":"loquesea"}` viaja hasta el CHECK de Postgres y vuelve como
 * un error de restricción que no le dice nada a nadie.
 */
export function esModeloNegocio(valor: unknown): valor is ModeloNegocio {
  return typeof valor === 'string' && (MODELOS_NEGOCIO as readonly string[]).includes(valor)
}

export function esPoliticaBsr(valor: unknown): valor is PoliticaBsr {
  return typeof valor === 'string' && (POLITICAS_BSR as readonly string[]).includes(valor)
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

/* ------------------------------------------------------------------ */
/* Lo mismo, pero a nivel de CLIENTE                                   */
/* ------------------------------------------------------------------ */

/**
 * Lo que se puede contestar SIN mirar ninguna referencia.
 *
 * Es `CadenciaBsr` más un cuarto valor, y ese cuarto valor es el que hace falta:
 * en un cliente MIX con la política en automático, la pregunta «¿se le mide el
 * BSR?» NO TIENE RESPUESTA a nivel de cliente — depende de si cada referencia
 * está marcada como marca propia. Enseñar ahí «bajo demanda» o «a diario» sería
 * elegir una de las dos mitades y llamarla el todo.
 */
export type CadenciaCliente = CadenciaBsr | 'por_sku'

export const CADENCIA_CLIENTE_LABELS: Record<CadenciaCliente, string> = {
  diario: 'BSR a diario',
  bajo_demanda: 'Solo bajo demanda',
  nunca: 'No se mide',
  por_sku: 'Según cada referencia',
}

/**
 * QUÉ SE LE VA A MEDIR A ESTE CLIENTE, para poder enseñarlo al lado de los dos
 * desplegables que lo deciden.
 *
 * Se apoya en cadenciaBsr() y no repite sus reglas: el orden —la política
 * explícita gana, y solo si es `auto` se mira el modelo— vive en un sitio y
 * nada más. Lo único propio de aquí es el caso `mix`, que se para en seco
 * porque su respuesta está una capa más abajo.
 */
export function cadenciaBsrCliente(params: {
  modelo: ModeloNegocio
  politica: PoliticaBsr
}): CadenciaCliente {
  if (params.politica !== 'auto') return params.politica
  if (params.modelo === 'mix') return 'por_sku'
  // Ni marca propia ni arbitraje miran `esMarcaPropia` cuando la política es
  // automática, así que el valor que se pase aquí da igual: ver cadenciaBsr().
  return cadenciaBsr({ ...params, esMarcaPropia: false })
}

/**
 * ¿NADIE SE HA PRONUNCIADO TODAVÍA SOBRE ESTE CLIENTE?
 *
 * La columna `modelo_negocio` nace en 'mix' por defecto (migración 123), así que
 * su valor solo no distingue «este cliente es mixto» —una decisión— de «nadie ha
 * mirado esto» —un hueco—. Y la diferencia son horas de ventana nocturna:
 * mientras un catálogo de reventa siga en el valor por defecto, se le pide el
 * BSR a diario para nada.
 *
 * Lo que lo distingue es `modelo_negocio_at`, que solo se escribe cuando alguien
 * guarda desde la pantalla (migración 128). El parámetro admite `undefined`
 * ADEMÁS de `null` a propósito, y no es lo mismo:
 *
 *     undefined -> la columna no existe todavía en la base. Se cae al único
 *                  criterio que queda, que es el valor por defecto.
 *     null      -> la columna existe y está vacía: nadie se ha pronunciado.
 */
export function clienteSinClasificar(params: {
  modelo: ModeloNegocio
  clasificadoAt: string | null | undefined
}): boolean {
  if (params.clasificadoAt === undefined) return params.modelo === 'mix'
  return params.clasificadoAt === null
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
