import { jsPDF } from 'jspdf'
import { anchoEnModulos, code128B } from './code128'

/**
 * LAS ETIQUETAS DE PRODUCTO QUE VAN PEGADAS EN CADA UNIDAD.
 * ========================================================
 *
 * Amazon las llama «item labels» y son lo primero que hay que imprimir de un
 * envío: cada unidad física lleva una pegatina con su FNSKU. Sin ellas el
 * almacén no sabe de quién es el producto.
 *
 *
 * ============ ESTO NO SE LE PIDE A AMAZON ============
 *
 * La API tiene `getLabels`, pero eso son las etiquetas de CAJA y solo existen
 * cuando el envío ya está confirmado. Las de producto se pueden hacer con lo que
 * ya sabemos —el FNSKU, el título y la condición— y hacerlas aquí tiene tres
 * ventajas que no son pequeñas:
 *
 *   · Se imprimen en la fase de borrador, ANTES de crear nada en Amazon. Que es
 *     justo cuando el cliente está etiquetando la mercancía.
 *   · No gastan cupo de la API ni dependen de que Amazon conteste.
 *   · Si falta el FNSKU de una referencia, se ve aquí y no en el almacén.
 *
 *
 * ============ LO QUE EXIGE AMAZON ============
 *
 * Especificación de «item label»:
 *   · Código de barras CODE 128.
 *   · Entre 25×51 mm y 51×76 mm.
 *   · Tiene que llevar el FNSKU en texto, el título del producto y la condición.
 *   · Negro sobre blanco, sin brillo, 300 ppp o más.
 *
 * El título se recorta a lo que quepa: es informativo para quien pega, mientras
 * que lo que lee el escáner es el código. Recortarlo es correcto; encogerlo
 * hasta que no se lea, no.
 *
 *
 * ============ Y EL SKU, QUE LO PONEMOS NOSOTROS ============
 *
 * Amazon no imprime el SKU del vendedor en su etiqueta: pone el título y punto.
 * Y el título lo TRUNCA POR EL MEDIO, así que de «COZSERIES Zapatillas de Casa
 * Mujer | Calzado Anatómico Verano Hecho en España 600BURDEOS-38» acaba
 * saliendo «COZSERIES Zapatill…aña 600BURDEOS-38». Cuando el código interno no
 * está al final del título, quien empaqueta se queda con «COZSERIES Botines
 * de…a | Negro | Talla 38» y no sabe qué modelo tiene en la mano.
 *
 * El dato que lo resuelve ya existe y es NUESTRO: el SKU. En estos catálogos
 * lleva dentro el modelo, el color y la talla —«602A BEIG/39», «AD-XR024 MORADO
 * 36/37»—, o sea justo lo que el almacén necesita leer.
 *
 * VA COMO TEXTO, NUNCA COMO UN SEGUNDO CÓDIGO DE BARRAS. Amazon obliga a que en
 * la unidad solo haya UN código escaneable y a tapar todos los demás; imprimir
 * el SKU codificado al lado del FNSKU sería un incumplimiento de preparación, y
 * de los que se pagan. Texto legible: ni lo mira el escáner ni infringe nada.
 */

/** Hojas de etiquetas que se usan en Europa. Medidas en milímetros */
export interface FormatoHoja {
  id: string
  nombre: string
  /** Ancho y alto de la página */
  pagina: { ancho: number; alto: number }
  /** Cuántas etiquetas por fila y por columna */
  rejilla: { columnas: number; filas: number }
  /** Tamaño de cada etiqueta */
  etiqueta: { ancho: number; alto: number }
  /** Desde el borde de la página hasta la primera etiqueta */
  margen: { izquierda: number; arriba: number }
  /** Separación entre etiquetas */
  hueco: { horizontal: number; vertical: number }
}

export const FORMATOS: FormatoHoja[] = [
  {
    // El formato más común en España para esto. Cumple el mínimo de Amazon
    // (63,5 × 38,1 mm está por encima de 25 × 51 mm) con holgura.
    id: 'a4-21',
    nombre: 'A4 · 21 etiquetas (63,5 × 38,1 mm)',
    pagina: { ancho: 210, alto: 297 },
    rejilla: { columnas: 3, filas: 7 },
    etiqueta: { ancho: 63.5, alto: 38.1 },
    margen: { izquierda: 7.25, arriba: 15.15 },
    hueco: { horizontal: 2.5, vertical: 0 },
  },
  {
    id: 'a4-24',
    nombre: 'A4 · 24 etiquetas (70 × 37 mm)',
    pagina: { ancho: 210, alto: 297 },
    rejilla: { columnas: 3, filas: 8 },
    etiqueta: { ancho: 70, alto: 37 },
    margen: { izquierda: 0, arriba: 0.5 },
    hueco: { horizontal: 0, vertical: 0 },
  },
  {
    // Impresora térmica de rollo: una etiqueta por página
    id: 'termica-57x32',
    nombre: 'Térmica · rollo 57 × 32 mm',
    pagina: { ancho: 57, alto: 32 },
    rejilla: { columnas: 1, filas: 1 },
    etiqueta: { ancho: 57, alto: 32 },
    margen: { izquierda: 0, arriba: 0 },
    hueco: { horizontal: 0, vertical: 0 },
  },
]

export interface EtiquetaProducto {
  fnsku: string
  titulo: string
  /**
   * El SKU del vendedor, que es lo que de verdad identifica la referencia en el
   * almacén. Obligatorio a propósito y no opcional: si fuera `sku?`, el día que
   * alguien añada otra pantalla que imprima etiquetas se le olvidaría, no daría
   * ningún error, y el problema volvería sin que nadie supiera por qué.
   */
  sku: string
  /**
   * EL ASIN DE LA REFERENCIA, SI SE SABE. Sirve para UNA sola cosa y es
   * importante: descartar la etiqueta cuando el «FNSKU» es en realidad el ASIN.
   *
   * Amazon devuelve el ASIN en el campo del FNSKU cuando la referencia está en
   * el programa de CÓDIGO DE BARRAS DEL FABRICANTE: esos artículos viajan con su
   * EAN o UPC y NO LLEVAN etiqueta de Amazon. Imprimirles una con el ASIN dentro
   * es pegar un código que el almacén no espera.
   *
   * No es teórico: en el catálogo de Cobo Family hay 40 referencias así, todas
   * con fnsku == asin. Sin esta comprobación salían impresas y nadie lo veía.
   */
  asin?: string | null
  /** 'Nuevo' salvo que se diga otra cosa. Amazon lo exige en la etiqueta */
  condicion?: string
  /** Cuántas iguales hay que imprimir */
  unidades: number
}

export interface ResultadoEtiquetas {
  pdf: Uint8Array
  etiquetas: number
  paginas: number
  /** Las que no se han podido imprimir y por qué. NO se callan */
  descartadas: Array<{ fnsku: string; motivo: string }>
}

/** Separación entre renglones, en milímetros. Medido sobre las tres hojas de FORMATOS */
const SALTO_SKU = 3.6
const SALTO_TITULO = 2.6
const SALTO_CONDICION = 2.4
const MARGEN_ABAJO = 1.2

/**
 * QUIÉN LEE CADA RENGLÓN, QUE ES LO QUE FIJA LOS TAMAÑOS.
 *
 *   · el código de barras   -> lo lee el ESCÁNER de Amazon. Nadie más.
 *   · el FNSKU en texto     -> solo si el escáner falla y hay que teclearlo.
 *                              Es un dato de respaldo, así que va en redonda.
 *   · EL SKU                -> lo lee la PERSONA que está empaquetando, y es el
 *                              único renglón que le dice qué tiene en la mano.
 *                              Va en negrita y es el texto MÁS GRANDE de la
 *                              etiqueta, por encima del FNSKU.
 *   · el título             -> contexto. Con doscientos pares delante nadie lee
 *                              «Calzado Anatómico Verano Primavera».
 *
 * La primera versión ponía el FNSKU en negrita a 8 y el SKU a 7: al imprimir la
 * hoja se veía que el ojo iba al FNSKU —diez caracteres que no significan nada
 * para quien empaqueta— y el SKU se perdía entre el título. Por eso se invierte.
 */
/**
 * LA ZONA MUDA: el blanco a los lados del código, en milímetros.
 *
 * Estaba en 2 mm y SE QUEDABA CORTA en los tres formatos. No es una cuestión de
 * estética: el Code 128 exige un blanco de al menos DIEZ MÓDULOS a cada lado, y
 * es lo que usa el escáner para saber dónde empieza y acaba el código. Con 2 mm
 * hacían falta 4,1 mm en la hoja A4 de 21, 4,55 en la de 24 y 3,66 en el rollo
 * térmico. Un código así se imprime perfecto y a veces se lee y a veces no,
 * que es la peor avería posible: aparece en el almacén de Amazon, no aquí.
 *
 * 6,35 mm son las 0,25 pulgadas que pide Amazon en sus requisitos de etiquetado,
 * y de paso cumplen el mínimo del Code 128 con holgura en los tres formatos. El
 * código sale más estrecho —módulo de 12 a 15,6 milésimas de pulgada en vez de
 * 14 a 18— y sigue muy por encima de lo que lee cualquier escáner.
 *
 * No se fía de la cuenta: comprobarBarras() la rehace para cada etiqueta, así
 * que si mañana alguien añade un formato estrecho a FORMATOS se entera aquí.
 */
const ZONA_MUDA = 6.35

/**
 * EL BLANCO DE ARRIBA Y DE ABAJO DEL CÓDIGO. ES LA MISMA AVERÍA QUE LA DE AL
 * LADO, Y SE NOS PASÓ.
 *
 * `ZONA_MUDA` arregló los laterales y nadie miró en vertical. Medido sobre el
 * PDF que sale hoy: 2,50 mm por arriba y **1,18 mm por abajo**, contra los
 * 3,175 mm (0,125") que pide Amazon.
 *
 * El 1,18 de abajo no se ve leyendo el código, y por eso estaba: la línea
 * siguiente es `yBarra + altoBarra + 3.2`, que coloca la LÍNEA DE BASE del
 * FNSKU. Pero el texto crece HACIA ARRIBA desde ahí: una mayúscula de Helvetica
 * a 8 pt mide 2,024 mm, así que entre la última barra y la primera tinta del
 * texto quedan 3,2 − 2,024 = 1,176 mm. El número del código decía 3,2 y la
 * realidad eran 1,18.
 *
 * Y es exactamente la avería que el comentario de ZONA_MUDA describe: se imprime
 * perfecto, a veces se lee y a veces no, y sale en el almacén de Amazon.
 *
 * El sitio sale del CÓDIGO DE BARRAS, no del texto: medido, las barras se
 * llevaban el 45 % del alto siendo el doble de altas de lo que Amazon exige.
 */
const ZONA_MUDA_VERTICAL = 3.3

/** Lo que mide hacia arriba una mayúscula de Helvetica, por punto de cuerpo */
const ALTURA_MAYUSCULA = 0.717 / 2.835

/**
 * Lo más fino que puede ser un módulo y seguir leyéndose. 0,19 mm son 7,5
 * milésimas de pulgada, el mínimo de GS1 para distribución general. Por debajo
 * de eso no se imprime: se dice cuál y por qué.
 */
const MODULO_MINIMO = 0.19

/**
 * El blanco a los lados del TEXTO. No es la zona muda —eso es solo del código—,
 * es para que una impresora mal alineada no se coma la última letra del SKU.
 * El mismo para el SKU y para el título: antes el SKU llegaba 0,5 mm más cerca
 * del borde que el título y en la hoja impresa se notaba.
 */
const MARGEN_TEXTO = 2

const PT_FNSKU = 8
const PT_SKU = 9
const PT_TITULO = 6

/**
 * El SKU en una sola línea, encogiendo la letra antes que recortarla.
 *
 * ESTE ES EL DATO QUE SE VA A LEER, así que cortarlo por la mitad sería tirar la
 * etiqueta: «602A BEIG/3» no distingue un 39 de un 35, y el fallo es peor que no
 * poner nada porque parece información buena. Así que primero se prueba a 9 pt,
 * y si no cabe se baja de medio en medio hasta 5 pt, que es el suelo por debajo
 * del cual una impresora térmica ya no lo saca limpio.
 *
 * Solo si ni a 5 pt cabe —un SKU disparatado— se recorta, y entonces se recorta
 * POR DELANTE y con puntos suspensivos: en estos catálogos lo que identifica
 * está al final («… MORADO 36/37»), igual que en la etiqueta de Amazon.
 */
function ajustarSku(doc: jsPDF, sku: string, anchoUtil: number): { texto: string; tamano: number } {
  let tamano = PT_SKU
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(tamano)

  while (doc.getTextWidth(sku) > anchoUtil && tamano > 5) {
    tamano -= 0.5
    doc.setFontSize(tamano)
  }
  if (doc.getTextWidth(sku) <= anchoUtil) return { texto: sku, tamano }

  let recortado = sku
  while (recortado.length > 1 && doc.getTextWidth('…' + recortado) > anchoUtil) {
    recortado = recortado.slice(1)
  }
  return { texto: '…' + recortado, tamano }
}

/**
 * ¿Se va a poder leer este código?
 *
 * Dos condiciones, y las dos tienen que cumplirse:
 *   · el módulo no puede ser más fino que MODULO_MINIMO, o la impresora lo
 *     emborrona;
 *   · la zona muda tiene que llegar a diez módulos, que es lo que pide el
 *     Code 128 para reconocer el principio y el final.
 *
 * Con los tres formatos de FORMATOS las dos se cumplen de sobra. Existe para el
 * día que alguien añada una etiqueta estrecha: mejor que no salga y se diga, a
 * que salgan cuatrocientas pegatinas que el almacén no puede escanear.
 */
function barrasLegibles(anchoModulo: number): boolean {
  return anchoModulo >= MODULO_MINIMO && ZONA_MUDA >= anchoModulo * 10
}

/**
 * Dibuja una etiqueta en la posición dada.
 *
 * El código se escala para dejar la zona muda a cada lado —ver ZONA_MUDA—, que es
 * lo que el escáner necesita para saber dónde empieza el código; sin ella un
 * código perfectamente impreso unas veces se lee y otras no.
 *
 *
 * ============ EL ORDEN DE LOS RENGLONES NO ES CAPRICHOSO ============
 *
 *      ‖‖‖‖‖‖‖‖‖‖‖‖‖‖‖‖‖‖‖      código de barras (FNSKU)
 *          X002OWACXP           el FNSKU en texto, por si el escáner falla
 *         602A BEIG/39          EL SKU, en negrita  <- lo que lee quien empaqueta
 *   COZSERIES Zapatillas de     el título, las líneas que quepan
 *      Casa Mujer | Verano
 *            Nuevo              la condición, pegada al fondo
 *
 * El SKU va JUSTO DEBAJO DEL FNSKU y en negrita porque es el renglón que se
 * busca con la vista: quien tiene doscientos pares delante mira una cosa, y esa
 * cosa tiene que estar siempre en el mismo sitio y no perderse entre el título.
 *
 * El título baja a tercer renglón y se queda con lo que sobre. Es informativo
 * —el escáner lee el código y el humano lee el SKU—, así que es lo correcto que
 * ceda el sitio. Las líneas se calculan del hueco que quede, no son un número
 * fijo: en la hoja A4 de 21 caben tres y en el rollo térmico de 32 mm caben dos,
 * y con un `slice(0, 2)` a pelo la etiqueta grande desperdiciaba una línea.
 *
 * La condición se ancla ABAJO y no detrás del título, que es como estaba: si el
 * título ocupaba una sola línea, «Nuevo» subía y quedaba un hueco blanco raro, y
 * si ocupaba dos, se apretaba contra el borde. Amazon la exige, así que tiene
 * sitio propio.
 */
function dibujar(
  doc: jsPDF,
  x: number,
  y: number,
  ancho: number,
  alto: number,
  etiqueta: EtiquetaProducto
): boolean {
  const modulos = code128B(etiqueta.fnsku)
  if (!modulos) return false

  const anchoUtil = ancho - ZONA_MUDA * 2
  const anchoModulo = anchoUtil / anchoEnModulos(modulos)
  if (!barrasLegibles(anchoModulo)) return false
  const centro = x + ancho / 2

  // El alto del código. Baja del 45 % al 38 % del alto de la etiqueta: con el 45 %
  // las barras eran el doble de altas de lo que Amazon pide y los milímetros que
  // sobraban se los quitaban a la zona muda de arriba y de abajo, que es lo que
  // de verdad decide si un escáner lee. En la hoja A4 de 21 son 14,5 mm de barra,
  // muy por encima del mínimo.
  const altoBarra = Math.max(8, alto * 0.38)
  const yBarra = y + ZONA_MUDA_VERTICAL

  doc.setFillColor(0, 0, 0)
  let cursor = x + ZONA_MUDA
  for (const m of modulos) {
    const w = m.ancho * anchoModulo
    if (m.pinta) doc.rect(cursor, yBarra, w, altoBarra, 'F')
    cursor += w
  }

  // El FNSKU en texto, debajo del código: si el escáner falla se teclea
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(PT_FNSKU)
  // LA LÍNEA DE BASE, no el borde del texto. Hay que sumarle lo que la mayúscula
  // sube desde ahí, o la zona muda real se queda en la cuarta parte de lo que
  // dice el número. Ver ZONA_MUDA_VERTICAL.
  const yFnsku = yBarra + altoBarra + ZONA_MUDA_VERTICAL + PT_FNSKU * ALTURA_MAYUSCULA
  doc.text(etiqueta.fnsku, centro, yFnsku, { align: 'center' })

  // EL SKU. Negrita, el más grande, y encogido antes que recortado: ajustarSku().
  const ySku = yFnsku + SALTO_SKU
  const sku = ajustarSku(doc, etiqueta.sku, ancho - MARGEN_TEXTO * 2)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(sku.tamano)
  doc.text(sku.texto, centro, ySku, { align: 'center' })

  // El título, con las líneas que quepan por debajo del SKU dejando sitio a la
  // condición. El número de líneas se calcula, no es fijo: en la hoja A4 de 21
  // caben tres y en el rollo térmico de 32 mm cabe una.
  const suelo = y + alto - MARGEN_ABAJO
  const maxLineas = Math.max(1, Math.floor((suelo - SALTO_CONDICION - ySku) / SALTO_TITULO))

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(PT_TITULO)
  const lineas = (doc.splitTextToSize(etiqueta.titulo, ancho - MARGEN_TEXTO * 2) as string[]).slice(0, maxLineas)
  let yTexto = ySku
  for (const linea of lineas) {
    yTexto += SALTO_TITULO
    doc.text(linea, centro, yTexto, { align: 'center' })
  }

  // La condición va PEGADA AL TÍTULO, no anclada al fondo de la etiqueta.
  // Anclarla abajo dejaba un hueco blanco de medio centímetro en las
  // referencias de título corto y parecía que faltaba algo. El clamp es para que
  // un título de tres líneas no la empuje fuera del recuadro.
  doc.setFontSize(PT_TITULO)
  doc.text(etiqueta.condicion ?? 'Nuevo', centro, Math.min(yTexto + SALTO_CONDICION, suelo), {
    align: 'center',
  })

  return true
}

/**
 * La hoja entera.
 *
 * Una etiqueta por unidad: si hay 8 pares de la talla 43, salen 8 pegatinas
 * iguales. Es lo que se pega, una por zapato... por caja de zapatos.
 */
export function hojaDeEtiquetas(
  etiquetas: EtiquetaProducto[],
  formatoId = 'a4-21'
): ResultadoEtiquetas {
  const formato = FORMATOS.find((f) => f.id === formatoId) ?? FORMATOS[0]
  const doc = new jsPDF({
    unit: 'mm',
    format: [formato.pagina.ancho, formato.pagina.alto],
    orientation: formato.pagina.ancho > formato.pagina.alto ? 'landscape' : 'portrait',
  })

  const descartadas: Array<{ fnsku: string; motivo: string }> = []
  const porPagina = formato.rejilla.columnas * formato.rejilla.filas

  // Se aplana ANTES de paginar: una referencia de 8 unidades son 8 etiquetas, y
  // pueden partirse entre dos hojas sin problema.
  const planas: EtiquetaProducto[] = []
  for (const e of etiquetas) {
    if (!e.fnsku) {
      // Se nombra por el SKU y no por el título: el título de Amazon es larguísimo
      // y casi idéntico entre tallas, así que «no tenemos el FNSKU de COZSERIES
      // Zapatillas de Casa Mujer…» no dice CUÁL falta. El SKU sí.
      descartadas.push({ fnsku: '(sin FNSKU)', motivo: `${e.sku}: no tenemos su FNSKU` })
      continue
    }
    // EL ASIN NO ES UN FNSKU. Ver el comentario del campo `asin`.
    if (e.asin && e.fnsku.trim().toUpperCase() === e.asin.trim().toUpperCase()) {
      descartadas.push({
        fnsku: e.fnsku,
        motivo:
          `${e.sku}: Amazon da su ASIN como FNSKU, que es lo que hace cuando la referencia va ` +
          'con el CÓDIGO DEL FABRICANTE y no lleva etiqueta de Amazon. Esta se envía con su ' +
          'EAN/UPC tal cual; no hay que pegarle nada.',
      })
      continue
    }

    const modulos = code128B(e.fnsku)
    if (!modulos) {
      descartadas.push({
        fnsku: e.fnsku,
        motivo: `${e.sku}: su FNSKU tiene caracteres que Code 128 no admite`,
      })
      continue
    }
    // La legibilidad se comprueba AQUÍ y no dentro de dibujar(), aunque dibujar()
    // vuelva a mirarlo: aquí es donde está `descartadas`, y una etiqueta que no
    // sale tiene que decir por qué. Si se deja solo en dibujar(), devuelve false,
    // el contador no sube y nadie se entera de que faltan cien pegatinas.
    if (!barrasLegibles((formato.etiqueta.ancho - ZONA_MUDA * 2) / anchoEnModulos(modulos))) {
      descartadas.push({
        fnsku: e.fnsku,
        motivo:
          `${e.sku}: en «${formato.nombre}» el código saldría tan estrecho que no se leería. ` +
          `Usa una etiqueta más ancha.`,
      })
      continue
    }
    for (let i = 0; i < e.unidades; i++) planas.push(e)
  }

  let impresas = 0
  let paginas = 0

  for (let i = 0; i < planas.length; i++) {
    const enPagina = i % porPagina
    if (enPagina === 0) {
      if (i > 0) doc.addPage()
      paginas++
    }
    const columna = enPagina % formato.rejilla.columnas
    const fila = Math.floor(enPagina / formato.rejilla.columnas)

    const x = formato.margen.izquierda + columna * (formato.etiqueta.ancho + formato.hueco.horizontal)
    const y = formato.margen.arriba + fila * (formato.etiqueta.alto + formato.hueco.vertical)

    if (dibujar(doc, x, y, formato.etiqueta.ancho, formato.etiqueta.alto, planas[i])) impresas++
  }

  return {
    pdf: new Uint8Array(doc.output('arraybuffer')),
    etiquetas: impresas,
    paginas: Math.max(paginas, 0),
    descartadas,
  }
}
