/**
 * LAS REGLAS DE NEGOCIO: lo que de verdad distingue a un cliente de otro una
 * vez que el fichero ya se sabe leer.
 *
 * Se aplican DESPUÉS de leer y ANTES de cruzar, y ese orden no es casual: el
 * cruce traduce referencias a SKU y no tiene por qué enterarse de que a este
 * cliente se le guardan dos unidades de cada cosa. Cuando las reglas van
 * después, el mismo artículo acaba con dos verdades distintas —la que dice el
 * fichero y la que se publica— y a la hora de explicar un envío raro no hay
 * forma de saber cuál miró el proceso.
 *
 * TODO LO DE AQUÍ ES PURO. Ni Supabase, ni fetch, ni Date.now(): los datos y la
 * fecha entran por parámetro. Una función que mira el reloj por su cuenta no se
 * puede comprobar, y estas son justo las que deciden cuántas unidades se
 * publican en la tienda de otro.
 */

import { normalizeHeader } from './engine'
import type { LineaLeida } from './lector'
import {
  type StockPriceMode,
  type StockReadProfile,
  exactCode,
  formatInt,
  normalizeCode,
} from '@/lib/types/stock-sync'

// =====================================================
// Las reglas
// =====================================================

export interface ReglasNegocio {
  /**
   * Unidades que NO se venden en Amazon. Se guardan para la tienda física,
   * para pedidos ya comprometidos o simplemente como colchón contra el desfase
   * entre lo que dice el ERP y lo que hay en la estantería.
   */
  reservaUnidades: number
  /**
   * Por debajo de N unidades (ya descontada la reserva) se publica 0.
   *
   * No es lo mismo que la reserva y por eso son dos números: la reserva es
   * «guarda 2 siempre», el umbral es «con menos de 3 no compensa arriesgarse a
   * una rotura de stock, que en Amazon se paga con la métrica de cuenta».
   */
  stockMinimo: number
  /**
   * TOPE DE UNIDADES POR PRODUCTO. null = sin tope.
   *
   * «Aunque tenga 115 en el almacén, en Amazon publica 15 y ni una más». Lo
   * pidió un cliente por escrito y es una política suya, no un cálculo: no
   * quiere exponer todo su stock en Amazon.
   *
   * Es un TECHO, no una cantidad fija: un artículo con 8 unidades publica 8, no
   * 15. Y no es lo mismo que la reserva —esa APARTA unidades y baja el número
   * siempre—; el tope solo actúa cuando hay de sobra.
   */
  maxUnidades: number | null

  precioModo: StockPriceMode
  /** Tanto por ciento sobre el coste: 35 => coste * 1,35 */
  margenPorcentaje: number | null
  /**
   * Tanto por ciento de IVA a añadir al calcular por margen. null = el coste ya
   * lo lleva. Amazon publica el precio CON impuestos: si el cliente da el coste
   * sin IVA y aquí no se dice, se publica un 21% barato.
   */
  ivaPorcentaje: number | null
  /** Suelo y techo de cordura. Fuera de rango se descarta la LÍNEA, no se corrige el precio */
  precioMinimo: number | null
  precioMaximo: number | null

  /** Familias enteras que no se tocan. Se comparan sin tildes ni mayúsculas */
  familiasExcluidas: string[]
  /** Referencias sueltas que no se tocan */
  referenciasExcluidas: string[]

  enviarStock: boolean
  enviarPrecio: boolean
}

/** Por qué una línea del fichero no llega al cruce */
export type MotivoDescarte =
  | 'familia_excluida'
  | 'referencia_excluida'
  | 'sin_precio'
  | 'precio_fuera_de_rango'

export const MOTIVO_DESCARTE_LABELS: Record<MotivoDescarte, string> = {
  familia_excluida: 'Su familia está excluida en el perfil del cliente',
  referencia_excluida: 'La referencia está excluida en el perfil del cliente',
  sin_precio:
    'Este cliente manda precio y esta línea no trae ninguno que se pueda leer (ni el de respaldo)',
  precio_fuera_de_rango: 'El precio calculado se sale del suelo o del techo del perfil',
}

/**
 * Una línea ya pasada por las reglas.
 *
 * SIGUE SIENDO UNA StockLine, con los cuatro campos que consume crossStock en
 * su sitio y en su forma: `stock` ya lleva aplicadas la reserva y el umbral,
 * que es exactamente el número que tiene que viajar al cruce. El original se
 * conserva en `stockLeido` para poder explicar la diferencia sin volver a abrir
 * el fichero.
 */
export interface LineaAplicada extends LineaLeida {
  /** Lo que decía el fichero, antes de reserva y umbral */
  stockLeido: number
  /** Precio ya resuelto y redondeado a dos decimales. null = esta línea no manda precio */
  precioFinal: number | null
}

export interface LineaDescartada {
  articulo: string
  descripcion: string
  fila: number
  motivo: MotivoDescarte
}

export interface ResultadoReglas {
  /** Lo que sigue hacia el cruce. Se le pasa tal cual a crossStock() */
  lineas: LineaAplicada[]
  descartadas: LineaDescartada[]
  /**
   * Líneas que SÍ mandan su stock pero se quedan sin precio.
   *
   * Están aparte de `descartadas` a propósito: una línea que solo pierde el
   * precio sigue viva y sigue publicando sus unidades, así que contarla entre
   * las descartadas haría que la pantalla la pintara como si no llegara al
   * cruce, que es justo lo que dejó de pasar.
   */
  sinPrecio: LineaDescartada[]
  /** Cuántas descartó cada motivo. Va al registro de la ejecución */
  porMotivo: Record<MotivoDescarte, number>
  /** Cuántas líneas se quedaron en 0 por el umbral aunque el fichero traía unidades */
  cortadasPorUmbral: number
  /** Cuántas perdieron unidades por la reserva */
  tocadasPorReserva: number
  /** Cuántas se han recortado al tope de unidades por producto */
  recortadasPorTope: number
  avisos: string[]
  /** Momento en que se aplicaron, tal cual lo dio quien llamó */
  aplicadoEn: string
}

// =====================================================
// Las piezas, una a una y comprobables por separado
// =====================================================

/**
 * Unidades que se publican a partir de las que dice el fichero.
 *
 * El orden es reserva y luego umbral, no al revés: la reserva es física
 * («estas dos no están para vender»), así que lo primero es saber cuántas
 * quedan de verdad; el umbral es una política sobre ese resto («con tan pocas
 * no salgo a vender»). Al revés, un artículo con 3 unidades y reserva 2 pasaría
 * un umbral de 3 y publicaría 1, que es justo lo que el umbral quería evitar.
 */
export function stockPublicable(
  stockLeido: number,
  reglas: Pick<ReglasNegocio, 'reservaUnidades' | 'stockMinimo' | 'maxUnidades'>
): number {
  const disponible = trasReserva(stockLeido, reglas.reservaUnidades)
  if (disponible < Math.max(0, reglas.stockMinimo)) return 0
  return conTope(disponible, reglas.maxUnidades)
}

/**
 * El tope de unidades por producto, y va EL ÚLTIMO de los tres. No es un
 * detalle de orden.
 *
 * Con reserva 2, tope 15 y 115 unidades en el fichero:
 *
 *   correcto (tope al final):  115 − 2 = 113 → tope → 15
 *   al revés (tope primero):   115 → 15 → −2  → 13   ← MAL
 *
 * La reserva son unidades que se apartan DEL ALMACÉN, y con 115 en el almacén
 * esas dos ya están cubiertas de sobra por las 100 que no se publican. Restarla
 * después del tope la cobra dos veces y publica menos de lo que el cliente ha
 * pedido, sin que nada lo delate: 13 y 15 son los dos números plausibles.
 *
 * Y va después del umbral por lo mismo: el umbral decide SI se sale a vender
 * mirando lo que hay de verdad; el tope solo decide CUÁNTO se enseña.
 */
export function conTope(unidades: number, maxUnidades: number | null): number {
  if (maxUnidades == null) return unidades
  const tope = Math.max(0, Math.floor(maxUnidades))
  return Math.min(unidades, tope)
}

/**
 * Lo que queda después de apartar la reserva, nunca negativo.
 *
 * Está fuera de stockPublicable() para poder saber, al contar, si una línea se
 * quedó en 0 por la reserva o por el umbral. Con una sola función habría que
 * repetir la resta al medir, y una métrica que repite una fórmula acaba
 * midiendo otra cosa el día que la fórmula cambia.
 */
export function trasReserva(stockLeido: number, reservaUnidades: number): number {
  return Math.max(0, stockLeido - Math.max(0, reservaUnidades))
}

/**
 * El precio que se publicaría para una línea, o el motivo por el que no hay.
 *
 * Con precioModo 'ninguno' devuelve null SIN motivo: no tener precio no es un
 * problema cuando el cliente no manda precio, y descartar ahí la línea dejaría
 * de publicar el stock, que es lo que sí manda.
 *
 * Con 'columna' se mira la columna principal y solo si viene vacía la de
 * respaldo. «Vacía» incluye el 0: una celda de precio a 0 es en la práctica una
 * celda sin rellenar leída como número, y publicar 0,00 € en Amazon es de las
 * pocas cosas de este módulo que no tienen arreglo a posteriori.
 */
export function precioPublicable(
  linea: Pick<LineaLeida, 'precio' | 'precioRespaldo' | 'coste'>,
  reglas: Pick<
    ReglasNegocio,
    'precioModo' | 'margenPorcentaje' | 'ivaPorcentaje' | 'precioMinimo' | 'precioMaximo'
  >
): { precio: number | null; motivo: MotivoDescarte | null } {
  let bruto: number | null = null

  if (reglas.precioModo === 'ninguno') return { precio: null, motivo: null }

  if (reglas.precioModo === 'columna') {
    bruto = linea.precio ?? linea.precioRespaldo
  } else {
    // 'margen'
    if (linea.coste !== null && reglas.margenPorcentaje !== null) {
      const conMargen = linea.coste * (1 + reglas.margenPorcentaje / 100)
      const iva = reglas.ivaPorcentaje ?? 0
      bruto = conMargen * (1 + iva / 100)
    }
  }

  if (bruto === null) return { precio: null, motivo: 'sin_precio' }

  /**
   * SE REDONDEA PRIMERO Y SE COMPRUEBA DESPUÉS, y el orden es todo el asunto.
   *
   * Amazon acepta dos decimales, así que lo que decide si esto es un precio o
   * no es el número REDONDEADO, no el bruto. Comprobando antes, cualquier
   * importe entre 0 y 0,005 —una celda con 0,004, o un margen de -99,99 sobre
   * el coste— pasaba el «mayor que cero» y salía de aquí valiendo exactamente
   * 0, sin motivo de descarte y sin que ningún freno lo mirara: el de variación
   * de precio se salta los listings que aún no tienen precio publicado, que son
   * justo estos. Publicar 0,00 € en Amazon es de las pocas cosas de este módulo
   * que no tienen arreglo a posteriori.
   */
  const precio = redondear2(bruto)
  if (!Number.isFinite(precio) || precio <= 0) {
    return { precio: null, motivo: 'sin_precio' }
  }

  // Fuera de rango se DESCARTA la línea en vez de ajustarla al suelo o al
  // techo. Recortar un precio disparatado lo convierte en un precio plausible
  // y lo publica: el error deja de verse justo cuando más falta hace verlo.
  if (reglas.precioMinimo !== null && precio < reglas.precioMinimo) {
    return { precio, motivo: 'precio_fuera_de_rango' }
  }
  if (reglas.precioMaximo !== null && precio > reglas.precioMaximo) {
    return { precio, motivo: 'precio_fuera_de_rango' }
  }

  return { precio, motivo: null }
}

/**
 * Si esta línea está excluida, y por qué.
 *
 * Las referencias se comparan por su forma exacta Y por la normalizada, y la
 * generosidad es deliberada: quien escribe una exclusión la teclea como se
 * acuerda («50119247») mientras el fichero la trae con relleno
 * («0050119247»). Excluir un artículo de más deja un listing con el stock de
 * ayer, que se arregla mañana; no excluir el que el cliente dijo que no se
 * tocara publica lo que pidió que no se publicara.
 *
 * Las familias se comparan sin tildes, sin mayúsculas y sin puntuación, con la
 * misma función que compara cabeceras: «Material de obra», «MATERIAL DE OBRA» y
 * «material  de  obra» son la misma familia y nadie debería tener que saber
 * cuál escribió el cliente en su ERP.
 */
export function motivoExclusion(
  linea: Pick<LineaLeida, 'articulo' | 'articuloNorm' | 'familia'>,
  excluidas: { referencias: ReadonlySet<string>; familias: ReadonlySet<string> }
): MotivoDescarte | null {
  if (excluidas.referencias.size > 0) {
    if (excluidas.referencias.has(linea.articulo)) return 'referencia_excluida'
    if (linea.articuloNorm && excluidas.referencias.has(linea.articuloNorm)) {
      return 'referencia_excluida'
    }
  }

  if (excluidas.familias.size > 0 && linea.familia) {
    if (excluidas.familias.has(normalizeHeader(linea.familia))) return 'familia_excluida'
  }

  return null
}

/**
 * Los conjuntos de exclusión, precalculados una vez.
 *
 * Se hace aparte para que aplicarReglas() no reconstruya dos Set por cada una
 * de las 21.000 líneas, y para poder comprobar la normalización por su cuenta.
 * De cada referencia se guardan LAS DOS formas, por lo dicho en
 * motivoExclusion().
 */
export function conjuntosExclusion(reglas: Pick<ReglasNegocio, 'familiasExcluidas' | 'referenciasExcluidas'>): {
  referencias: ReadonlySet<string>
  familias: ReadonlySet<string>
} {
  const referencias = new Set<string>()
  for (const raw of reglas.referenciasExcluidas) {
    const exacta = exactCode(raw)
    if (exacta) referencias.add(exacta)
    const norm = normalizeCode(raw)
    if (norm) referencias.add(norm)
  }

  const familias = new Set<string>()
  for (const raw of reglas.familiasExcluidas) {
    const f = normalizeHeader(raw)
    if (f) familias.add(f)
  }

  return { referencias, familias }
}

/** Dos decimales, que es lo que acepta Amazon. Sin esto, 12,3 * 1,21 sale 14,882999999999999 */
export function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// =====================================================
// Aplicarlas todas
// =====================================================

/**
 * Pasa las líneas leídas por todas las reglas del cliente.
 *
 * `ahora` entra por parámetro y no se llama a Date.now() aquí dentro: así la
 * misma entrada da siempre la misma salida y se puede comprobar sin trucos.
 */
export function aplicarReglas(
  lineas: LineaLeida[],
  reglas: ReglasNegocio,
  ahora: Date
): ResultadoReglas {
  const excluidas = conjuntosExclusion(reglas)

  const out: LineaAplicada[] = []
  const descartadas: LineaDescartada[] = []
  const sinPrecio: LineaDescartada[] = []
  const porMotivo: Record<MotivoDescarte, number> = {
    familia_excluida: 0,
    referencia_excluida: 0,
    sin_precio: 0,
    precio_fuera_de_rango: 0,
  }
  const avisos: string[] = []
  let cortadasPorUmbral = 0
  let tocadasPorReserva = 0
  let recortadasPorTope = 0

  for (const linea of lineas) {
    const exclusion = motivoExclusion(linea, excluidas)
    if (exclusion) {
      porMotivo[exclusion]++
      descartadas.push({
        articulo: linea.articulo,
        descripcion: linea.descripcion,
        fila: linea.fila,
        motivo: exclusion,
      })
      continue
    }

    const { precio, motivo } = precioPublicable(linea, reglas)

    /**
     * UNA LÍNEA SIN PRECIO LEGIBLE PIERDE EL PRECIO, NO EL STOCK.
     *
     * Antes esto era un `continue`: la línea entera se caía, así que su
     * cantidad tampoco se enviaba. Y el caso NO es raro — es lo que hace
     * cualquier ERP al descatalogar un artículo: primero se borra la tarifa. El
     * resultado era el peor posible: el artículo se quedaba en Amazon con las
     * unidades del envío anterior, vendiendo lo que ya no hay, y encima
     * aparecía en la lista de huérfanos con el motivo «su artículo no viene en
     * el fichero», que era falso — sí venía, lo tiró la regla del precio— así
     * que quien revisaba no tenía forma de llegar a la causa.
     *
     * Solo se descarta entera cuando este perfil no manda stock: ahí la línea
     * de verdad no tiene nada que aportar.
     */
    if (motivo && reglas.enviarPrecio) {
      porMotivo[motivo]++
      const apunte = {
        articulo: linea.articulo,
        descripcion: linea.descripcion,
        fila: linea.fila,
        motivo,
      }

      if (!reglas.enviarStock) {
        descartadas.push(apunte)
        continue
      }
      sinPrecio.push(apunte)
    }

    const stock = stockPublicable(linea.stock, reglas)
    // Se cuentan por separado y no en un if/else: una línea puede perder
    // unidades por la reserva Y quedarse además a cero por el umbral, y
    // atribuirlo todo a lo primero que se comprueba deja la mitad del efecto
    // sin explicar cuando alguien pregunta por qué se ha publicado tan poco.
    const disponible = trasReserva(linea.stock, reglas.reservaUnidades)
    if (disponible < linea.stock) tocadasPorReserva++
    if (disponible > 0 && stock === 0) cortadasPorUmbral++
    // El tope solo cuenta cuando ha recortado de verdad. Una línea que se queda
    // a cero por el umbral no es «recortada por el tope» aunque el tope exista.
    if (stock > 0 && stock < disponible) recortadasPorTope++

    out.push({
      ...linea,
      stockLeido: linea.stock,
      stock,
      precioFinal: motivo ? null : precio,
    })
  }

  /**
   * El tope se DICE cuando actúa, y no solo se cuenta.
   *
   * Es la regla más fácil de dejarse puesta sin querer —un número en una casilla
   * que recorta el catálogo entero— y la más difícil de detectar mirando el
   * resultado: 15 unidades publicadas es un número perfectamente normal. Sin
   * este aviso, un tope tecleado por error en el cliente equivocado no se nota
   * hasta que alguien compara con el almacén.
   */
  if (recortadasPorTope > 0 && reglas.maxUnidades != null) {
    avisos.push(
      `${formatInt(recortadasPorTope)} ${recortadasPorTope === 1 ? 'artículo tenía' : 'artículos tenían'} ` +
        `más de ${formatInt(reglas.maxUnidades)} unidades y se ${recortadasPorTope === 1 ? 'publica' : 'publican'} ` +
        `con ${formatInt(reglas.maxUnidades)}, que es el tope por producto de este cliente.`
    )
  }

  if (out.length === 0 && lineas.length > 0) {
    avisos.push(
      `Las reglas han descartado las ${formatInt(lineas.length)} líneas del fichero. ` +
        'Revisa las exclusiones y el modo de precio del perfil antes de dar nada por bueno.'
    )
  }

  if (reglas.enviarPrecio && reglas.precioModo === 'ninguno') {
    avisos.push(
      'El perfil dice que se manda precio pero no dice de dónde sacarlo. No se enviará ningún precio.'
    )
  }

  const conUnidades = out.filter((l) => l.stock > 0).length
  if (out.length > 0 && conUnidades === 0) {
    avisos.push(
      'Después de aplicar las reglas no queda ni una línea con unidades. ' +
        'Comprueba la reserva y el umbral mínimo antes de mandar nada.'
    )
  }

  if (sinPrecio.length > 0) {
    avisos.push(
      `${formatInt(sinPrecio.length)} ${sinPrecio.length === 1 ? 'línea manda' : 'líneas mandan'} su stock ` +
        'pero no su precio: no traen ninguno que se pueda leer (ni el de respaldo). ' +
        'Es lo normal en un artículo que el cliente acaba de descatalogar, y conviene mirarlo si son muchas.'
    )
  }

  return {
    lineas: out,
    descartadas,
    sinPrecio,
    porMotivo,
    cortadasPorUmbral,
    tocadasPorReserva,
    recortadasPorTope,
    avisos,
    aplicadoEn: ahora.toISOString(),
  }
}

// =====================================================
// De la fila de la base de datos a las reglas
// =====================================================

/**
 * Traduce el perfil guardado a las reglas que consumen las funciones puras.
 *
 * Existe para que nada de lo de arriba tenga que saber cómo se llaman las
 * columnas de Postgres: el día que una columna se renombre, se toca aquí y
 * nada más.
 */
export function reglasDesdeFila(fila: StockReadProfile): ReglasNegocio {
  return {
    reservaUnidades: fila.reserva_unidades ?? 0,
    stockMinimo: fila.stock_minimo ?? 0,
    // null = sin tope, y por eso NO lleva `?? 0`: un 0 aquí significaría
    // «publica cero unidades de todo», que es la diferencia entre no tener la
    // regla puesta y retirar el catálogo entero de la venta.
    maxUnidades: numeroONull(fila.max_unidades),
    precioModo: fila.precio_modo,
    margenPorcentaje: numeroONull(fila.margen_porcentaje),
    ivaPorcentaje: numeroONull(fila.iva_porcentaje),
    precioMinimo: numeroONull(fila.precio_minimo),
    precioMaximo: numeroONull(fila.precio_maximo),
    familiasExcluidas: fila.familias_excluidas ?? [],
    referenciasExcluidas: fila.referencias_excluidas ?? [],
    enviarStock: fila.enviar_stock,
    enviarPrecio: fila.enviar_precio,
  }
}

/**
 * Los NUMERIC de Postgres llegan por PostgREST como número o como cadena según
 * la precisión. Dejar pasar una cadena aquí haría que `coste * (1 + margen/100)`
 * concatenara texto en vez de multiplicar, y el precio saldría absurdo sin dar
 * ningún error.
 */
function numeroONull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
