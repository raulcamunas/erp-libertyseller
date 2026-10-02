/**
 * EL MANIFIESTO: qué referencias y cuántas unidades van en el envío.
 * ==================================================================
 *
 * Es el primero de los dos ficheros que se suben a Seller Central en «Enviar a
 * Amazon». Dice QUÉ se manda; el de embalaje (lib/fba/embalaje.ts) dice en qué
 * caja va cada cosa.
 *
 * Hasta hoy se rellenaba a mano, copiando el SKU y las unidades de un CSV a la
 * plantilla. Son dos columnas y cuarenta filas, pero es a mano cada envío.
 *
 *
 * ============ LA PLANTILLA LA SUBE EL CLIENTE, NO VIVE AQUÍ ============
 *
 * Igual que en lib/stock-sync/amazon-template.ts, y por el mismo motivo: la
 * plantilla se descarga del Seller Central de UNA cuenta, y Amazon publica
 * versiones nuevas. Una empotrada en el repositorio le pondría a todos los
 * clientes la del primero y caducaría sin avisar. Cada envío se rellena sobre la
 * que acaba de bajarse el cliente.
 *
 *
 * ============ LO QUE SE ESCRIBE, Y DÓNDE SE BUSCA ============
 *
 *   B de «Default prep owner»     = Seller
 *   B de «Default labeling owner» = Seller
 *   A, desde la fila siguiente a «Merchant SKU» = el SKU
 *   B, en esa misma fila                       = las unidades
 *
 * Las columnas C y D —prep y labeling owner por fila— se dejan VACÍAS a
 * propósito: solo se rellenan cuando difieren del valor por defecto, y aquí
 * coinciden. Rellenarlas «por claridad» es ruido que Amazon tiene que procesar.
 *
 * NINGUNA DE ESAS FILAS SE DA POR SABIDA. La cabecera está hoy en la fila 8 en
 * las diecinueve plantillas que hay descargadas, pero se busca por el texto
 * «Merchant SKU» y si no aparece, esto NO ESCRIBE NADA y lo dice. Es la misma
 * regla que en la hoja de embalaje, donde está medido que las filas se mueven.
 */

import {
  LibroError,
  abrir,
  actualizarDimension,
  buscarFila,
  buscarHoja,
  cadenasCompartidas,
  celdaXml,
  cerrar,
  decode,
  encode,
  escribirCeldas,
  estiloDe,
  filaXml,
  hojasDe,
  reemplazarFilasTras,
  type Plantilla,
} from './libro'

export interface LineaManifiesto {
  sku: string
  unidades: number
}

export interface ResultadoManifiesto {
  xlsx: Uint8Array
  /** Cuántas líneas han entrado en el fichero */
  lineas: number
  /** La suma de unidades. Tiene que cuadrar con lo que diga la remesa */
  unidades: number
  /** Las que NO han entrado y por qué. Nunca se callan */
  descartadas: Array<{ sku: string; motivo: string }>
}

/** Quién prepara y quién etiqueta. El vendedor, en los dos casos */
const DUENO = 'Seller'

export function rellenarManifiesto(
  plantilla: Plantilla,
  lineas: LineaManifiesto[]
): ResultadoManifiesto {
  const etiqueta = 'La plantilla del manifiesto'
  const paquete = abrir(plantilla, etiqueta)

  // El nombre de la hoja viene en el idioma del Seller Central del que se bajó.
  // En las diecinueve descargas que hay es «Create workflow – template» incluso
  // en cuentas españolas, pero no se da por hecho: si el prefijo no casa, más
  // abajo se busca la hoja por su contenido.
  const hoja =
    buscarHoja(paquete, ['Create workflow – template', 'Create workflow', 'Plantilla']) ??
    hojaConLaCabecera(paquete)

  if (!hoja) {
    throw new LibroError(
      `${etiqueta} no tiene la hoja con la cabecera «Merchant SKU». Comprueba que es el fichero ` +
        'ManifestFileUpload_Template que se descarga en «Enviar a Amazon» y no otro.'
    )
  }

  const compartidas = cadenasCompartidas(paquete)
  let xml = decode(paquete[hoja.ruta])

  const filaCabecera = buscarFila(xml, compartidas, {
    columnas: ['A'],
    contiene: ['merchant sku'],
    hasta: 60,
  })
  if (filaCabecera === null) {
    throw new LibroError(
      `${etiqueta} no tiene la cabecera «Merchant SKU» en la hoja «${hoja.nombre}». No se escribe ` +
        'nada: con la cabecera en otro sitio, las referencias caerían en filas equivocadas.'
    )
  }

  // ---------- Los dos «Seller» ----------
  //
  // Se buscan por su etiqueta y no por B3/B4. Si Amazon mueve el bloque —ya
  // mueve el de la hoja de embalaje con el número de referencias— escribir en
  // B3 a ciegas machacaría otra cosa.
  const filaPrep = buscarFila(xml, compartidas, {
    columnas: ['A'],
    contiene: ['default prep owner', 'preparacion por defecto'],
    hasta: filaCabecera,
  })
  const filaEtiquetado = buscarFila(xml, compartidas, {
    columnas: ['A'],
    contiene: ['default labeling owner', 'etiquetado por defecto'],
    hasta: filaCabecera,
  })
  if (filaPrep === null || filaEtiquetado === null) {
    throw new LibroError(
      `${etiqueta} no trae las filas de «Default prep owner» y «Default labeling owner». Sin ellas ` +
        'Amazon no sabe quién prepara ni quién etiqueta, y el envío se queda a medias al subirlo.'
    )
  }

  xml = escribirCeldas(xml, [
    { ref: `B${filaPrep}`, valor: { tipo: 'texto', valor: DUENO } },
    { ref: `B${filaEtiquetado}`, valor: { tipo: 'texto', valor: DUENO } },
  ])

  // ---------- Las referencias ----------
  const descartadas: ResultadoManifiesto['descartadas'] = []
  const buenas: LineaManifiesto[] = []

  for (const l of lineas) {
    const sku = (l.sku ?? '').trim()
    if (!sku) {
      descartadas.push({ sku: '(sin SKU)', motivo: 'la línea no tiene SKU' })
      continue
    }
    // Solo cantidades >= 1: una línea a cero no es «mandar cero», es no mandarla.
    // Amazon rechaza la carga entera si se cuela una.
    if (!Number.isInteger(l.unidades) || l.unidades < 1) {
      descartadas.push({ sku, motivo: `unidades = ${l.unidades}: solo entran cantidades enteras de 1 en adelante` })
      continue
    }
    buenas.push({ sku, unidades: l.unidades })
  }

  if (buenas.length === 0) {
    throw new LibroError(
      'No hay ni una referencia con unidades que mandar. Un manifiesto vacío no sirve de nada: ' +
        'revisa las cantidades del envío antes de generarlo.'
    )
  }

  // El estilo de la primera fila de datos de la plantilla, si la trae de
  // ejemplo: así las filas nuevas salen con el mismo formato que las demás en
  // vez de en blanco en medio de una hoja con bordes.
  const estiloSku = estiloDe(xml, `A${filaCabecera + 1}`)
  const estiloCantidad = estiloDe(xml, `B${filaCabecera + 1}`)
  const alturaFila = filaXml(xml, filaCabecera + 1).match(/\sht="([\d.]+)"/)?.[1]

  const filas = buenas
    .map((l, i) => {
      const n = filaCabecera + 1 + i
      const ht = alturaFila ? ` ht="${alturaFila}" customHeight="1"` : ''
      return (
        `<row r="${n}"${ht}>` +
        celdaXml(`A${n}`, { tipo: 'texto', valor: l.sku }, estiloSku) +
        celdaXml(`B${n}`, { tipo: 'numero', valor: l.unidades }, estiloCantidad) +
        `</row>`
      )
    })
    .join('')

  xml = reemplazarFilasTras(xml, filaCabecera, filas)
  xml = actualizarDimension(xml, 'D', filaCabecera + buenas.length)

  paquete[hoja.ruta] = encode(xml)

  return {
    xlsx: cerrar(paquete),
    lineas: buenas.length,
    unidades: buenas.reduce((s, l) => s + l.unidades, 0),
    descartadas,
  }
}

/**
 * El plan B para encontrar la hoja: la que tenga «Merchant SKU» en su columna A.
 *
 * Existe porque los nombres de las hojas están traducidos al idioma de la cuenta
 * y la hoja de instrucciones prohíbe renombrarlas, así que si el prefijo no casa
 * el usuario no podría arreglarlo por su cuenta. La cabecera, en cambio, es la
 * misma en todas las descargas que hay.
 *
 * Se salta la hoja de EJEMPLO, que tiene la misma cabecera y datos de mentira
 * dentro: rellenar esa dejaría el fichero con el ejemplo de Amazon y el envío de
 * verdad en una hoja que nadie lee.
 */
function hojaConLaCabecera(paquete: Record<string, Uint8Array>) {
  const compartidas = cadenasCompartidas(paquete)
  const candidatas = []
  for (const h of hojasDe(paquete)) {
    if (/example|ejemplo|exemple|beispiel/i.test(h.nombre)) continue
    const xml = decode(paquete[h.ruta])
    if (!xml) continue
    if (buscarFila(xml, compartidas, { columnas: ['A'], contiene: ['merchant sku'], hasta: 60 }) !== null) {
      candidatas.push(h)
    }
  }
  return candidatas[0] ?? null
}
