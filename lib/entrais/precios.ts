/**
 * EL PRECIO AL QUE HAY QUE VENDER PARA GANAR LO QUE SE QUIERE GANAR
 * =================================================================
 * Función pura: entra un producto y una configuración, sale un precio. No toca
 * la base, no llama a Amazon, no lee el reloj. Por eso se puede comprobar
 * contra las 6.921 filas del Excel del cliente sin montar nada — y por eso hay
 * un script que lo hace (scripts/check-precios-entrais.ts).
 *
 * Eso no es ceremonia. Este cálculo decide a qué precio se publica el catálogo
 * entero de un cliente: si se equivoca por arriba no vende, y si se equivoca por
 * abajo vende perdiendo dinero en cada unidad y nadie lo nota hasta la
 * liquidación.
 *
 *
 * ============ A DÓNDE VA EL DINERO DE UNA VENTA ============
 *
 * Cuando alguien paga P en Amazon, ese P se reparte así:
 *
 *   · IVA           P no es tuyo entero: te queda P / 1,21
 *   · Tarifa de referencia   Amazon se lleva un % — y del P **CON IVA**
 *   · Tasa digital  un 3% ADICIONAL, calculado sobre la tarifa anterior
 *   · Coste         proveedor + canon + porte, SIN IVA (el de compra se deduce)
 *
 * Lo que sobra es el beneficio. Y el margen se mide sobre la base imponible
 * —P/1,21— no sobre lo que paga el comprador.
 *
 *
 * ============ LA FÓRMULA ============
 *
 * Se parte de la igualdad que se quiere cumplir:
 *
 *     P/1,21 − tarifa×P×1,03 − Coste  =  margen × P/1,21
 *
 * Se agrupa todo lo que lleva P:
 *
 *     P × [ (1−margen)/1,21 − tarifa×1,03 ]  =  Coste
 *
 * Y se despeja:
 *
 *     P  =  Coste / [ (1−margen)/1,21 − tarifa×1,03 ]
 *
 * EL CORCHETE PUEDE SALIR CERO O NEGATIVO, y ahí no hay precio que valga: por
 * mucho que subas, la tarifa y el margen se comen más de lo que entra. Con IVA
 * al 21% y tasa al 3% eso pasa cuando `margen + tarifa×1,2463 > 1`, o sea a
 * partir de un 82,6% largo entre los dos. No se devuelve un número enorme: se
 * devuelve «imposible», que es lo que es.
 */

/* ------------------------------------------------------------------ */
/* La configuración                                                    */
/* ------------------------------------------------------------------ */

/** Cómo se redondea el precio. Los tres redondean SIEMPRE hacia arriba */
export type Redondeo =
  /** Al céntimo. El margen sale clavado */
  | 'centimo'
  /** Terminar en ,99. Sube bastante el margen en lo barato */
  | 'noventa_y_nueve'
  /** A múltiplos de 0,05 */
  | 'cinco_centimos'

export interface TramoMargen {
  /** Desde qué valor aplica, incluido. El primero tiene que ser 0 */
  desde: number
  /** 0.15 = 15% */
  margen: number
}

export interface ConfigPrecios {
  /** Se usa cuando los tramos están apagados o el producto queda fuera de todos */
  margenGlobal: number
  usarTramos: boolean
  tramos: TramoMargen[]
  /**
   * Con qué valor se decide en qué tramo cae un producto.
   *
   * 'coste' es lo prudente: no depende de lo que haya publicado hoy en Amazon,
   * así que un producto sin listar cae en el mismo tramo que su gemelo listado.
   * 'pvp' usa el precio actual en Amazon y cae de vuelta al coste cuando no hay.
   */
  decidirTramoPor: 'coste' | 'pvp'

  /** 0.21 */
  ivaVenta: number
  /** Los 4 € del proveedor, sin IVA */
  porte: number
  /** 0.03 — se calcula SOBRE la tarifa de referencia, no sobre el precio */
  tasaDigital: number
  /** Para los que aún no están listados y no tienen tarifa real. 0.15 = prudente */
  tarifaPorDefecto: number

  redondeo: Redondeo

  /**
   * EL SUELO DE LA BUY BOX. null = no se persigue la oferta destacada.
   *
   * Si hay FOEP y publicar a ese precio deja un margen igual o mayor que esto,
   * se propone el FOEP en vez del precio objetivo: se renuncia a algo de margen
   * a cambio de la oferta destacada, que es la que vende. Por debajo de este
   * suelo no se baja ni por la Buy Box.
   */
  margenSuelo: number | null
}

export const CONFIG_POR_DEFECTO: ConfigPrecios = {
  margenGlobal: 0.07,
  usarTramos: true,
  tramos: [
    { desde: 0, margen: 0.15 },
    { desde: 30, margen: 0.12 },
    { desde: 90, margen: 0.1 },
    { desde: 300, margen: 0.08 },
    { desde: 500, margen: 0.07 },
    { desde: 1000, margen: 0.06 },
    { desde: 2000, margen: 0.05 },
  ],
  decidirTramoPor: 'coste',
  ivaVenta: 0.21,
  porte: 4,
  tasaDigital: 0.03,
  tarifaPorDefecto: 0.15,
  redondeo: 'centimo',
  margenSuelo: null,
}

/* ------------------------------------------------------------------ */
/* La entrada y la salida                                              */
/* ------------------------------------------------------------------ */

export interface EntradaPrecio {
  sku: string
  /** El del proveedor, sin IVA */
  precioProveedor: number
  /** Canon digital por unidad, sin IVA. Va aparte del precio */
  canon: number
  /** Tarifa de referencia REAL de Amazon, en tanto por uno. null = no la tenemos */
  tarifaReal: number | null
  /** Lo que está publicado hoy en Amazon, con IVA. null = no está listado */
  pvpActual: number | null
  /** Margen propio de este producto. Manda sobre el tramo. null = no tiene */
  margenPropio: number | null
  /** Precio al que se espera ganar la oferta destacada, con IVA. null = sin dato */
  foep?: number | null
  /**
   * QUIÉN TIENE HOY LA OFERTA DESTACADA. Es lo que decide si el FOEP significa
   * algo o no.
   *
   * 'de_otro'      → la tiene la competencia. El FOEP es el techo al que hay que
   *                  bajar para quitársela. Es el ÚNICO caso en el que se baja.
   * 'nuestra'      → ya es nuestra. Bajar al FOEP sería regalar margen por algo
   *                  que ya tenemos.
   * 'nadie'        → no hay competencia, o seríamos la primera oferta del
   *                  listing. No hay a quién ganarle: se publica al margen.
   * 'desconocido'  → no se baja. Regalar margen por una corazonada es peor que
   *                  no ganar una Buy Box que a lo mejor ya es nuestra.
   */
  buybox?: 'nuestra' | 'de_otro' | 'nadie' | 'desconocido'
}

export type MotivoAviso =
  | 'ok'
  | 'imposible'
  | 'precio_proveedor_cero'
  | 'tarifa_estimada'
  | 'sin_pvp_actual'
  | 'subida_grande'
  | 'puede_bajar'

export const AVISO_LABELS: Record<MotivoAviso, string> = {
  ok: 'OK',
  imposible: 'Margen inalcanzable: la tarifa y el margen se comen todo lo que entra',
  precio_proveedor_cero: 'El proveedor lo da a 0 €: revisar antes de publicar',
  tarifa_estimada: 'Tarifa estimada: el producto no está listado y no tenemos la real',
  sin_pvp_actual: 'Sin precio actual en Amazon con el que comparar',
  subida_grande: 'Subida de más del 20%: revisar antes de publicar',
  puede_bajar: 'Se puede bajar el precio: está más de un 5% por encima del objetivo',
}

/** De dónde ha salido el precio propuesto */
export type OrigenPrecio =
  /** Del margen objetivo */
  | 'margen'
  /** Del FOEP, porque daba margen suficiente y gana la oferta destacada */
  | 'buybox'

export interface ResultadoPrecio {
  sku: string
  /** proveedor + canon + porte, sin IVA */
  coste: number
  /** El que se ha aplicado, venga de donde venga */
  margenAplicado: number
  /** De dónde salió: 'propio' | 'tramo N' | 'global' */
  deDondeElMargen: string
  /** La que se ha usado. Si `tarifaEstimada`, es la de por defecto */
  tarifaAplicada: number
  tarifaEstimada: boolean

  /** null si es imposible */
  precioObjetivo: number | null
  /** El de arriba, redondeado. Es el que se publicaría */
  precio: number | null
  origen: OrigenPrecio

  /** Con el precio redondeado. null si no hay precio */
  beneficio: number | null
  /** El de verdad, que con redondeo hacia arriba nunca baja del objetivo */
  margenReal: number | null

  /** Contra el PVP actual. null si no está listado */
  difEuros: number | null
  difPorcentaje: number | null

  aviso: MotivoAviso
}

/* ------------------------------------------------------------------ */
/* El cálculo                                                          */
/* ------------------------------------------------------------------ */

/**
 * Redondeo SIEMPRE HACIA ARRIBA, en las tres modalidades.
 *
 * Hacia arriba y no al más cercano porque redondear a la baja se come el margen
 * objetivo: pides un 7% y publicas un 6,97%. Hacia arriba el margen real nunca
 * queda por debajo del que pediste — como mucho, por encima.
 *
 * El epsilon no es manía: `26.65 * 100` en coma flotante da 2664.9999999999995,
 * y `Math.ceil` de eso son 2665 —bien— pero un valor que ya sea exacto puede dar
 * 2665.0000000000005 y subir a 26,66 sin motivo. Se recorta esa basura antes.
 */
function haciaArriba(valor: number, paso: number): number {
  const veces = valor / paso
  const enteras = Math.ceil(veces - 1e-9)
  // Se vuelve a redondear al céntimo para que no salga 26.650000000000002
  return Math.round(enteras * paso * 100) / 100
}

function redondear(precio: number, modo: Redondeo): number {
  switch (modo) {
    case 'noventa_y_nueve':
      return Math.round((Math.ceil(precio - 1e-9) - 0.01) * 100) / 100
    case 'cinco_centimos':
      return haciaArriba(precio, 0.05)
    default:
      return haciaArriba(precio, 0.01)
  }
}

/**
 * Qué margen le toca a este producto.
 *
 * El orden importa y es el del Excel: el margen propio del producto manda sobre
 * el tramo, y el tramo manda sobre el global. Así se puede afinar una referencia
 * suelta sin tocar la escalera entera.
 */
function margenDe(
  entrada: EntradaPrecio,
  cfg: ConfigPrecios,
  valorDelTramo: number
): { margen: number; deDonde: string } {
  if (entrada.margenPropio !== null) {
    return { margen: entrada.margenPropio, deDonde: 'propio' }
  }
  if (!cfg.usarTramos || cfg.tramos.length === 0) {
    return { margen: cfg.margenGlobal, deDonde: 'global' }
  }
  // El último tramo cuyo «desde» no supera el valor. Los tramos vienen
  // ordenados; se recorre al revés para quedarse con el más alto que encaje.
  const ordenados = [...cfg.tramos].sort((a, b) => a.desde - b.desde)
  for (let i = ordenados.length - 1; i >= 0; i--) {
    if (valorDelTramo >= ordenados[i].desde) {
      return { margen: ordenados[i].margen, deDonde: `tramo ${i + 1}` }
    }
  }
  // Por debajo del primer tramo. No debería pasar —el primero empieza en 0—
  // pero si alguien lo cambia, el global es la red de seguridad.
  return { margen: cfg.margenGlobal, deDonde: 'global' }
}

/** El beneficio por unidad a un precio dado. Es la fórmula de arriba sin despejar */
export function beneficioA(
  precio: number,
  coste: number,
  tarifa: number,
  cfg: Pick<ConfigPrecios, 'ivaVenta' | 'tasaDigital'>
): number {
  return precio / (1 + cfg.ivaVenta) - precio * tarifa * (1 + cfg.tasaDigital) - coste
}

/** El margen sobre la base imponible a un precio dado */
export function margenA(
  precio: number,
  coste: number,
  tarifa: number,
  cfg: Pick<ConfigPrecios, 'ivaVenta' | 'tasaDigital'>
): number {
  const base = precio / (1 + cfg.ivaVenta)
  if (base <= 0) return 0
  return beneficioA(precio, coste, tarifa, cfg) / base
}

export function calcularPrecio(entrada: EntradaPrecio, cfg: ConfigPrecios): ResultadoPrecio {
  const coste = entrada.precioProveedor + entrada.canon + cfg.porte

  const tarifaEstimada = entrada.tarifaReal === null
  const tarifa = entrada.tarifaReal ?? cfg.tarifaPorDefecto

  // Con qué valor se decide el tramo. Ver ConfigPrecios.decidirTramoPor.
  const valorDelTramo =
    cfg.decidirTramoPor === 'pvp' && entrada.pvpActual !== null && entrada.pvpActual > 0
      ? entrada.pvpActual
      : coste

  const { margen, deDonde } = margenDe(entrada, cfg, valorDelTramo)

  const base: Omit<
    ResultadoPrecio,
    'precioObjetivo' | 'precio' | 'beneficio' | 'margenReal' | 'difEuros' | 'difPorcentaje' | 'aviso'
  > = {
    sku: entrada.sku,
    coste,
    margenAplicado: margen,
    deDondeElMargen: deDonde,
    tarifaAplicada: tarifa,
    tarifaEstimada,
    origen: 'margen',
  }

  const denominador = (1 - margen) / (1 + cfg.ivaVenta) - tarifa * (1 + cfg.tasaDigital)
  if (denominador <= 0) {
    return {
      ...base,
      precioObjetivo: null,
      precio: null,
      beneficio: null,
      margenReal: null,
      difEuros: null,
      difPorcentaje: null,
      aviso: 'imposible',
    }
  }

  const objetivo = coste / denominador
  let precio = redondear(objetivo, cfg.redondeo)
  let origen: OrigenPrecio = 'margen'

  /**
   * LA BUY BOX, SI SALE A CUENTA.
   *
   * Con el FOEP delante hay una decisión que hasta ahora se tomaba a ojo: bajar
   * a ese precio da menos margen por unidad, pero es el precio al que se espera
   * ganar la oferta destacada — y la oferta destacada es la que vende. Sin ella
   * el margen del 15% se aplica sobre cero ventas.
   *
   * Solo se baja si el margen que queda llega al SUELO que haya puesto el
   * cliente. Y solo se BAJA: si el FOEP está por encima del precio objetivo, no
   * se sube — subir por encima de lo que hace falta para ganar la Buy Box es
   * regalar ventas sin necesidad.
   *
   *
   * ============ Y SOLO SI HAY A QUIÉN GANARLE ============
   *
   * Esta es la parte que no es evidente. El FOEP no significa lo mismo según
   * quién tenga hoy la oferta destacada:
   *
   *   · La tiene OTRO   → el FOEP es el techo al que bajar para quitársela.
   *                       Aquí sí sale a cuenta cambiar margen por ventas.
   *   · Ya es NUESTRA   → bajar sería pagar por algo que ya tenemos.
   *   · No la tiene NADIE → no hay competencia; seríamos la primera oferta del
   *                       listing. Bajar es regalar margen a cambio de nada.
   *   · No se sabe      → no se baja. Perder una Buy Box que quizá ya es nuestra
   *                       es reversible; el margen regalado en cada venta, no.
   *
   * Sin esta comprobación, la regla ingenua «precio > FOEP → bajar» recorta el
   * precio JUSTO en las referencias que van bien — las que ya tienen la oferta
   * destacada porque nadie les hace sombra.
   */
  const hayAQuienGanarle = entrada.buybox === 'de_otro'
  if (hayAQuienGanarle && cfg.margenSuelo !== null && entrada.foep != null && entrada.foep > 0) {
    const candidato = redondear(entrada.foep, cfg.redondeo)
    if (candidato < precio && margenA(candidato, coste, tarifa, cfg) >= cfg.margenSuelo) {
      precio = candidato
      origen = 'buybox'
    }
  }

  const beneficio = beneficioA(precio, coste, tarifa, cfg)
  const margenReal = margenA(precio, coste, tarifa, cfg)

  const difEuros = entrada.pvpActual !== null ? precio - entrada.pvpActual : null
  const difPorcentaje =
    entrada.pvpActual !== null && entrada.pvpActual !== 0 ? precio / entrada.pvpActual - 1 : null

  return {
    ...base,
    origen,
    precioObjetivo: objetivo,
    precio,
    beneficio,
    margenReal,
    difEuros,
    difPorcentaje,
    aviso: avisoDe(entrada, tarifaEstimada, difPorcentaje),
  }
}

/**
 * El aviso, en el mismo orden de prioridad que la columna AE del Excel.
 *
 * El orden es lo que hace que sirva: un producto con precio de proveedor a 0 y
 * además sin listar tiene DOS problemas, y el que hay que enseñar es el primero.
 */
function avisoDe(
  entrada: EntradaPrecio,
  tarifaEstimada: boolean,
  difPorcentaje: number | null
): MotivoAviso {
  if (entrada.precioProveedor === 0) return 'precio_proveedor_cero'
  if (tarifaEstimada) return 'tarifa_estimada'
  if (difPorcentaje === null) return 'sin_pvp_actual'
  if (difPorcentaje > 0.2) return 'subida_grande'
  if (difPorcentaje < -0.05) return 'puede_bajar'
  return 'ok'
}
