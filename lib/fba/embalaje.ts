/**
 * EL EMBALAJE: qué unidades van en cada caja, y cuánto pesa y mide cada una.
 * =========================================================================
 *
 * Es el segundo fichero que se sube a Seller Central, después del manifiesto.
 * El manifiesto dice QUÉ se manda; este dice CÓMO va repartido.
 *
 * EL REPARTO NO SE CALCULA AQUÍ: ya está en la base, en fba_cajas y
 * fba_caja_contenido, puesto por quien ha encajado la mercancía. Esto solo lo
 * VUELCA a la plantilla de Amazon. Si algún día hay que repartir, se reparte en
 * la pantalla de encajado y no escondido dentro de un generador de Excel.
 *
 *
 * ============ LAS FILAS SE MUEVEN, Y ESTO ES LO IMPORTANTE DE TODO EL FICHERO ====
 *
 * La hoja la genera Amazon con UNA FILA POR SKU del envío. El bloque de abajo
 * —nombre de caja, peso, anchura, longitud, altura— baja con él. Medido sobre 32
 * plantillas reales de esta cuenta, sin una sola excepción:
 *
 *      1 referencia  -> peso en la fila  9      40 referencias -> fila 48
 *     23 referencias -> peso en la fila 31      50 referencias -> fila 58
 *     32 referencias -> peso en la fila 40      83 referencias -> fila 91
 *
 * La regla es `fila del peso = nSKU + 8`, pero AQUÍ NO SE USA ESA FÓRMULA: se
 * busca la fila por su etiqueta («Peso de la caja»). La fórmula es la prueba de
 * que las filas se mueven, no una forma de adivinarlas.
 *
 * El procedimiento que se sigue hoy a mano escribe en las filas 31 a 34 fijas, o
 * sea que solo funciona para envíos de exactamente 23 referencias. Con 50,
 * escribiría el peso y las medidas ENCIMA de las filas de tres SKU: no da ningún
 * error, el fichero se sube igual, y se descubre en el almacén de Amazon.
 *
 *
 * ============ NI KILOS NI CENTÍMETROS POR SUPUESTO ============
 *
 * Diez de las plantillas descargadas de esta cuenta vienen en LIBRAS Y PULGADAS
 * —la hoja Metadata lo declara en «Weight unit» y «Length unit», y la etiqueta de
 * la fila lo repite: «Peso de la caja (lb):»—. Meter 19,8 kg en un campo de
 * libras es la misma corrupción silenciosa que escribir en la fila equivocada.
 * Así que se lee la unidad y se convierte.
 *
 *
 * ============ LA FÓRMULA DEL TOTAL SOLO SUMA LAS PRIMERAS M3 COLUMNAS ============
 *
 * La columna «Cantidad en cajas» es `=SUM(M6:INDEX(M6:XFD6,1,M3))`: suma desde la
 * M hasta la columna número M3, y nada más. Una caja escrita más allá de ese
 * número NO entra en el total y desaparece sin avisar. Por eso M3 se escribe con
 * el número de cajas de verdad y se comprueba que caben.
 */

import {
  LibroError,
  abrir,
  buscarFila,
  buscarHoja,
  cadenasCompartidas,
  cerrar,
  colIndex,
  colLetter,
  decode,
  encode,
  escribirCeldas,
  leerCelda,
  type Paquete,
  type Plantilla,
  type Valor,
} from './libro'

/** Una caja física, tal y como está guardada en fba_cajas */
export interface CajaParaPlantilla {
  /** El número que le puso quien encajó. Ordena las columnas, no las elige */
  numero: number
  /** En kilos y centímetros SIEMPRE: la conversión a lo que pida la plantilla se hace aquí */
  pesoKg: number
  anchoCm: number
  largoCm: number
  altoCm: number
  /** Cuántas unidades de cada SKU lleva esta caja */
  contenido: Array<{ sku: string; unidades: number }>
}

export interface ResultadoEmbalaje {
  xlsx: Uint8Array
  cajas: number
  unidades: number
  /** Qué unidades no están declaradas en la plantilla de Amazon, o al revés */
  descuadres: Array<{ sku: string; previstas: number; encajadas: number }>
  /** Las cajas que pasan del tope que avisa Seller Central */
  pesadas: Array<{ numero: number; pesoKg: number }>
  /** En qué unidades estaba la plantilla, para poder decirlo en pantalla */
  unidadPeso: 'kg' | 'lb'
  unidadMedida: 'cm' | 'in'
}

/** Seller Central avisa (no bloquea) por encima de esto, y hay que marcarla como carga pesada */
const KG_CARGA_PESADA = 15

const LB_POR_KG = 2.2046226218
const PULGADAS_POR_CM = 0.3937007874

export function rellenarEmbalaje(
  plantilla: Plantilla,
  cajas: CajaParaPlantilla[]
): ResultadoEmbalaje {
  const etiqueta = 'La plantilla de embalaje'
  const paquete = abrir(plantilla, etiqueta)

  const hoja = buscarHoja(paquete, ['Información de embalaje', 'Box packing', 'Informations'])
  if (!hoja) {
    throw new LibroError(
      `${etiqueta} no tiene la hoja «Información de embalaje de la caja». Comprueba que es el ` +
        'fichero que descarga Seller Central en el paso de embalaje y no el del manifiesto.'
    )
  }

  const compartidas = cadenasCompartidas(paquete)
  let xml = decode(paquete[hoja.ruta])

  const geo = leerGeometria(xml, compartidas, etiqueta)
  const unidades = leerUnidades(paquete)

  // ---------- Las cajas con contenido, en orden ----------
  const conContenido = cajas
    .filter((c) => c.contenido.some((l) => l.unidades > 0))
    .sort((a, b) => a.numero - b.numero)

  if (conContenido.length === 0) {
    throw new LibroError(
      'No hay ni una caja con contenido. Una caja vacía no es una caja: revisa el encajado antes ' +
        'de generar el fichero.'
    )
  }

  if (conContenido.length > geo.maxCajas) {
    throw new LibroError(
      `El envío va en ${conContenido.length} cajas y esta plantilla solo tiene sitio para ` +
        `${geo.maxCajas}. Vuelve a generarla en Seller Central diciendo el número de cajas correcto: ` +
        'las que no caben no darían ningún error, simplemente no se sumarían al total.'
    )
  }

  // ---------- El cruce por SKU ----------
  //
  // POR NOMBRE Y NUNCA POR ORDEN. La plantilla trae sus SKU en el orden que
  // decide Amazon y nuestras cajas en el que decidió quien encajó; dar por hecho
  // que coinciden reparte las unidades de un modelo en las filas de otro.
  const filaDeSku = new Map<string, number>()
  for (let n = geo.primerSku; n <= geo.ultimoSku; n += 1) {
    const sku = leerCelda(xml, `A${n}`, compartidas).trim()
    if (sku) filaDeSku.set(sku, n)
  }

  const encajadasPorSku = new Map<string, number>()
  const celdas: Array<{ ref: string; valor: Valor }> = []
  const desconocidos = new Set<string>()
  let totalUnidades = 0

  conContenido.forEach((caja, i) => {
    const col = colLetter(colIndex(geo.primeraColumnaCaja) + i)

    for (const linea of caja.contenido) {
      if (linea.unidades <= 0) continue
      const fila = filaDeSku.get(linea.sku.trim())
      if (fila === undefined) {
        desconocidos.add(linea.sku)
        continue
      }
      celdas.push({ ref: `${col}${fila}`, valor: { tipo: 'numero', valor: linea.unidades } })
      encajadasPorSku.set(linea.sku.trim(), (encajadasPorSku.get(linea.sku.trim()) ?? 0) + linea.unidades)
      totalUnidades += linea.unidades
    }

    const peso = unidades.peso === 'lb' ? caja.pesoKg * LB_POR_KG : caja.pesoKg
    const medida = (cm: number) => (unidades.medida === 'in' ? cm * PULGADAS_POR_CM : cm)
    celdas.push({ ref: `${col}${geo.filaPeso}`, valor: { tipo: 'numero', valor: redondear(peso) } })
    celdas.push({ ref: `${col}${geo.filaAncho}`, valor: { tipo: 'numero', valor: redondear(medida(caja.anchoCm)) } })
    celdas.push({ ref: `${col}${geo.filaLargo}`, valor: { tipo: 'numero', valor: redondear(medida(caja.largoCm)) } })
    celdas.push({ ref: `${col}${geo.filaAlto}`, valor: { tipo: 'numero', valor: redondear(medida(caja.altoCm)) } })
  })

  if (desconocidos.size > 0) {
    throw new LibroError(
      `Hay ${desconocidos.size} referencia(s) encajada(s) que NO están en la plantilla de Amazon: ` +
        `${[...desconocidos].slice(0, 5).join(', ')}${desconocidos.size > 5 ? '…' : ''}. ` +
        'O la plantilla es de otro envío, o esas referencias se añadieron después de generarla. ' +
        'No se escribe nada: subirlo así mandaría unidades que Amazon no espera.'
    )
  }

  // ---------- El cuadre contra lo que Amazon dice que espera ----------
  //
  // La columna «Cantidad prevista» la rellena Amazon con lo que se declaró en el
  // manifiesto. Si no coincide con lo encajado, el fichero se sube igual y la
  // discrepancia aparece en recepción, días después y con la mercancía allí.
  const descuadres: ResultadoEmbalaje['descuadres'] = []
  for (const [sku, fila] of filaDeSku) {
    const previstas = Number(leerCelda(xml, `${geo.columnaPrevista}${fila}`, compartidas)) || 0
    const encajadas = encajadasPorSku.get(sku) ?? 0
    if (previstas !== encajadas) descuadres.push({ sku, previstas, encajadas })
  }

  // ---------- El número de cajas ----------
  celdas.push({ ref: `${geo.celdaNumeroCajas}`, valor: { tipo: 'numero', valor: conContenido.length } })

  xml = escribirCeldas(xml, celdas)
  paquete[hoja.ruta] = encode(xml)

  return {
    xlsx: cerrar(paquete),
    cajas: conContenido.length,
    unidades: totalUnidades,
    descuadres,
    pesadas: conContenido
      .filter((c) => c.pesoKg > KG_CARGA_PESADA)
      .map((c) => ({ numero: c.numero, pesoKg: c.pesoKg })),
    unidadPeso: unidades.peso,
    unidadMedida: unidades.medida,
  }
}

/** Dos decimales: ni Amazon ni una báscula dan más, y los flotantes largos ensucian la hoja */
function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

interface Geometria {
  primerSku: number
  ultimoSku: number
  filaPeso: number
  filaAncho: number
  filaLargo: number
  filaAlto: number
  primeraColumnaCaja: string
  maxCajas: number
  columnaPrevista: string
  celdaNumeroCajas: string
}

/**
 * DÓNDE ESTÁ CADA COSA EN ESTA PLANTILLA CONCRETA.
 *
 * Todo se busca; nada se da por sabido. Si falta cualquiera de las piezas, esto
 * LANZA y no se escribe un solo byte: un fichero rellenado a medias se sube
 * igual y el error aparece en el almacén.
 */
function leerGeometria(xml: string, compartidas: string[], etiqueta: string): Geometria {
  const fila = (textos: string[], desde = 1, hasta = 400) =>
    buscarFila(xml, compartidas, { columnas: ['A', 'B'], contiene: textos, desde, hasta })

  // EXACTO, y no «contiene»: la fila 3 pone «Total de SKU: 23 (69 unidades)» y
  // con «contiene» la cabecera se encontraría ahí, dos filas por encima de donde
  // está. El bloque de referencias empezaría en una fila vacía y el generador
  // diría que la plantilla no tiene ninguna.
  const filaCabecera = buscarFila(xml, compartidas, {
    columnas: ['A'],
    contiene: ['sku'],
    exacto: true,
    hasta: 20,
  })
  if (filaCabecera === null) {
    throw new LibroError(`${etiqueta} no tiene la cabecera «SKU». No es la hoja de embalaje.`)
  }

  const filaPeso = fila(['peso de la caja', 'box weight'])
  const filaAncho = fila(['anchura de la caja', 'box width'])
  const filaLargo = fila(['longitud de la caja', 'box length'])
  const filaAlto = fila(['altura de la caja', 'box height'])
  if (filaPeso === null || filaAncho === null || filaLargo === null || filaAlto === null) {
    throw new LibroError(
      `${etiqueta} no trae las filas de peso y medidas de las cajas. No se escribe nada: esas filas ` +
        'se mueven con el número de referencias del envío, y escribir a ciegas machacaría las ' +
        'unidades de varios SKU sin dar ningún error.'
    )
  }

  // El bloque de SKU va de la fila siguiente a la cabecera hasta la primera
  // vacía, y SIEMPRE por encima del bloque de cajas. La fila del nombre de la
  // caja va justo antes del peso y no es un SKU.
  const primerSku = filaCabecera + 1
  let ultimoSku = primerSku - 1
  for (let n = primerSku; n < filaPeso; n += 1) {
    if (!leerCelda(xml, `A${n}`, compartidas).trim()) break
    ultimoSku = n
  }
  if (ultimoSku < primerSku) {
    throw new LibroError(`${etiqueta} no tiene ninguna referencia en la columna SKU.`)
  }
  // Cinturón: si el bloque de SKU alcanzara al de cajas, es que la lectura ha
  // fallado y escribir destrozaría la hoja.
  if (ultimoSku >= filaPeso - 1) {
    throw new LibroError(
      `${etiqueta} tiene las referencias pegadas al bloque de cajas y eso no puede ser. No se ` +
        'escribe nada. Vuelve a descargarla de Seller Central.'
    )
  }

  // Hasta qué columna llegan las cajas: lo dice la propia hoja en la validación
  // de datos de las filas de medidas. Con 23 referencias son M..Z (14 cajas);
  // con 50, M..AE (19); con 83, M..AM (27). No es un número fijo.
  const sqrefs = [...xml.matchAll(/<dataValidation[^>]*sqref="([^"]+)"/g)].map((m) => m[1])
  const delBloque = sqrefs.find((s) => s.includes(`${filaPeso}:`) || s.includes(`:${filaAlto}`))
  const columnas = (delBloque ?? '')
    .split(/\s+/)
    .map((r) => r.match(/^([A-Z]+)/)?.[1])
    .filter((c): c is string => Boolean(c))
  if (columnas.length === 0) {
    throw new LibroError(
      `${etiqueta} no declara hasta qué columna llegan las cajas. No se escribe nada: pasarse de ` +
        'esa columna no da error, pero esas cajas no se suman al total y se pierden en silencio.'
    )
  }
  const indices = columnas.map(colIndex).sort((a, b) => a - b)
  const primeraColumnaCaja = colLetter(indices[0])
  const maxCajas = indices[indices.length - 1] - indices[0] + 1

  const columnaPrevista = columnaDeCabecera(xml, compartidas, filaCabecera, [
    'cantidad prevista',
    'expected quantity',
  ])
  if (!columnaPrevista) {
    throw new LibroError(
      `${etiqueta} no tiene la columna «Cantidad prevista». Sin ella no se puede comprobar que lo ` +
        'encajado cuadra con lo declarado, y ese descuadre aparece en recepción.'
    )
  }

  const filaCajas = fila(['número total de cajas', 'numero total de cajas', 'total number of boxes'], 1, filaCabecera) ??
    fila(['número total de cajas', 'numero total de cajas', 'total number of boxes'], 1, 20)
  const celdaNumeroCajas = `${primeraColumnaCaja}${filaCajas ?? 3}`

  return {
    primerSku,
    ultimoSku,
    filaPeso,
    filaAncho,
    filaLargo,
    filaAlto,
    primeraColumnaCaja,
    maxCajas,
    columnaPrevista,
    celdaNumeroCajas,
  }
}

/** La letra de la columna cuya cabecera diga uno de esos textos */
function columnaDeCabecera(
  xml: string,
  compartidas: string[],
  fila: number,
  textos: string[]
): string | null {
  const normal = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const buscados = textos.map(normal)
  for (let i = 1; i <= 30; i += 1) {
    const col = colLetter(i)
    const texto = normal(leerCelda(xml, `${col}${fila}`, compartidas))
    if (texto && buscados.some((b) => texto.includes(b))) return col
  }
  return null
}

/**
 * Kilos o libras, centímetros o pulgadas. Lo declara la hoja Metadata.
 *
 * Si no se puede leer se asume kg/cm, que es lo que trae la mayoría — pero se
 * asume SOLO porque la etiqueta de la fila lo repite («Peso de la caja (kg):»)
 * y quien genere el fichero lo va a ver antes de subirlo.
 */
function leerUnidades(paquete: Paquete): { peso: 'kg' | 'lb'; medida: 'cm' | 'in' } {
  const hoja = buscarHoja(paquete, ['Metadata'])
  if (!hoja) return { peso: 'kg', medida: 'cm' }
  const compartidas = cadenasCompartidas(paquete)
  const xml = decode(paquete[hoja.ruta])

  let peso: 'kg' | 'lb' = 'kg'
  let medida: 'cm' | 'in' = 'cm'
  for (let n = 1; n <= 12; n += 1) {
    const clave = leerCelda(xml, `A${n}`, compartidas).toLowerCase()
    const valor = leerCelda(xml, `B${n}`, compartidas).toLowerCase().trim()
    if (clave.includes('weight unit') && (valor === 'lb' || valor === 'lbs')) peso = 'lb'
    if (clave.includes('length unit') && (valor === 'in' || valor === 'inch')) medida = 'in'
  }
  return { peso, medida }
}
