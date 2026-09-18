import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'
import { consultarInforme, descargarInforme } from '@/lib/plataforma/amazon/informes'

/**
 * LEER EL LIBRO MAYOR DE INVENTARIO DE UN CLIENTE.
 * ================================================
 * SOLO SERVIDOR. SOLO LEE: aquí no se le escribe nada a Amazon.
 *
 * GET_LEDGER_DETAIL_VIEW_DATA es una fila por movimiento: entradas, ventas,
 * devoluciones, mermas y traslados. Es lo que consume las remesas.
 *
 *
 * ============ POR QUÉ SE BORRA LA VENTANA ANTES DE ESCRIBIRLA ============
 *
 * Amazon NO da identificador de fila. Dos ventas de una unidad del mismo SKU, el
 * mismo día, en el mismo almacén, son dos filas idénticas y legítimas: no hay
 * clave natural con la que deduplicar, y una huella calculada las fundiría en
 * una, perdiendo una venta de verdad.
 *
 * Así que la pasada BORRA el tramo de fechas que va a releer y lo reescribe
 * entero. Repetir una pasada deja exactamente el mismo resultado, y una pasada
 * que se corta a medias se arregla sola en la siguiente.
 *
 *
 * ============ POR QUÉ SE RELEE HACIA ATRÁS ============
 *
 * Amazon corrige el libro mayor con retraso: una devolución de ayer puede
 * aparecer mañana, y una merma tarda en reconciliarse (por eso el informe trae
 * `Reconciled` y `Unreconciled Quantity`). Leer solo desde el último día visto
 * dejaría esas correcciones fuera para siempre.
 *
 * Por eso cada pasada relee SOLAPE_DIAS hacia atrás. Cuesta releer filas que ya
 * teníamos; lo que ahorra es un descuadre que nadie sabría explicar.
 */

/** Días que se releen siempre, por encima de lo que falte */
export const SOLAPE_DIAS = 14

/** La primera vez no hay nada: se trae un trimestre para tener contra qué cuadrar */
export const PRIMERA_LECTURA_DIAS = 90

/** Un informe tarda entre uno y quince minutos. Ver `esperarInforme` */
const ESPERA_ENTRE_SONDEOS_MS = 20_000
const SONDEOS_MAXIMOS = 30

export interface MovimientoLeido {
  sku: string
  asin: string | null
  fecha: string
  ocurridoAt: string | null
  tipo: string
  referencia: string | null
  cantidad: number
  disposicion: string | null
  motivo: string | null
  centro: string | null
  pais: string | null
}

export interface LecturaLedger {
  reportId: string
  desde: string
  hasta: string
  movimientos: MovimientoLeido[]
  /** Filas que llegaron y no se pudieron entender. Se cuentan, no se esconden */
  descartadas: number
}

function iso(fecha: Date): string {
  return `${fecha.toISOString().slice(0, 19)}Z`
}

function soloDia(fecha: Date): string {
  return fecha.toISOString().slice(0, 10)
}

/**
 * Las comillas se quitan SIEMPRE, en la cabecera y en las filas.
 *
 * Amazon entrecomilla las dos. Limpiar solo las filas deja el nombre de la
 * columna como «"Event Type"» —con las comillas dentro de la cadena—, no casa
 * con nada, y el resultado es un informe que se lee entero como vacío SIN DAR
 * NINGÚN ERROR. Ya pasó una vez.
 */
function limpiar(campo: string): string {
  return campo.trim().replace(/^"|"$/g, '')
}

function partir(linea: string): string[] {
  return (linea.includes('\t') ? linea.split('\t') : linea.split(',')).map(limpiar)
}

/**
 * Pide el informe y espera a que esté.
 *
 * `CANCELLED` NO es un error: Amazon cancela el informe cuando no hay ni un
 * movimiento en el rango pedido. Para un cliente con poco tráfico es lo normal,
 * y tratarlo como avería llenaría la pantalla de rojos que no significan nada.
 */
export async function leerLedger(
  creds: AmazonCredentials,
  marketplaceId: string,
  desde: Date,
  hasta: Date
): Promise<LecturaLedger | null> {
  const { data } = await spApiRequest<{ reportId?: string }>(creds, 'createReport', {
    method: 'POST',
    path: '/reports/2021-06-30/reports',
    body: {
      reportType: 'GET_LEDGER_DETAIL_VIEW_DATA',
      marketplaceIds: [marketplaceId],
      dataStartTime: iso(desde),
      dataEndTime: iso(hasta),
    },
    repeatable: false,
    maxAttempts: 1,
  })

  const reportId = data.reportId
  if (!reportId) return null

  let documentId: string | null = null
  for (let i = 0; i < SONDEOS_MAXIMOS; i++) {
    const estado = await consultarInforme(creds, reportId)
    if (estado.estado === 'DONE') {
      documentId = estado.documentId
      break
    }
    if (estado.estado === 'CANCELLED') {
      // Sin movimientos en el rango. Es un resultado, no un fallo.
      return { reportId, desde: soloDia(desde), hasta: soloDia(hasta), movimientos: [], descartadas: 0 }
    }
    if (estado.estado === 'FATAL') {
      throw new Error(`Amazon no ha podido generar el libro mayor (informe ${reportId})`)
    }
    await new Promise((r) => setTimeout(r, ESPERA_ENTRE_SONDEOS_MS))
  }

  if (!documentId) {
    throw new Error(
      `El libro mayor ${reportId} sigue generándose después de ${Math.round(
        (SONDEOS_MAXIMOS * ESPERA_ENTRE_SONDEOS_MS) / 60_000
      )} minutos`
    )
  }

  const doc = await descargarInforme(creds, documentId)
  const lineas = doc.texto.split('\n').filter((l) => l.trim().length > 0)
  if (lineas.length < 2) {
    return { reportId, desde: soloDia(desde), hasta: soloDia(hasta), movimientos: [], descartadas: 0 }
  }

  const columnas = partir(lineas[0])
  const col = (nombre: string) => columnas.findIndex((c) => c === nombre)

  const iFecha = col('Date')
  const iSku = col('MSKU')
  const iTipo = col('Event Type')
  const iCantidad = col('Quantity')

  // Sin una de estas cuatro el informe no sirve para nada, y es mejor decirlo
  // que escribir una tabla de nulos que luego nadie sabe por qué está vacía.
  if (iFecha < 0 || iSku < 0 || iTipo < 0 || iCantidad < 0) {
    throw new Error(
      `El libro mayor no trae las columnas esperadas. Ha devuelto: ${columnas.join(', ')}`
    )
  }

  const iAsin = col('ASIN')
  const iRef = col('Reference ID')
  const iDisp = col('Disposition')
  const iMotivo = col('Reason')
  const iCentro = col('Fulfillment Center')
  const iPais = col('Country')
  const iInstante = col('Date and Time')

  const filas = lineas.slice(1).map(partir)

  /**
   * EL FORMATO DE LA FECHA SE DEDUCE DEL FICHERO, NO SE SUPONE.
   *
   * Es el fallo más caro posible aquí: si «3/9/2026» se lee como 9 de marzo en
   * vez de 3 de septiembre, los movimientos caen en otro mes, el reparto FIFO
   * los atribuye a otra remesa, y NO HAY NINGÚN ERROR EN NINGUNA PARTE. Se
   * descubriría meses después por un descuadre que nadie sabría explicar.
   *
   * Así que se mira el fichero entero: si algún primer componente pasa de 12,
   * solo puede ser el día; si es el segundo, solo puede ser el mes. Con 259
   * filas de una semana normal siempre hay alguna que lo delata.
   *
   * Y cuando ninguna lo delata, se usa la columna «Date and Time», que lleva la
   * hora y el desplazamiento y no admite dos lecturas.
   */
  const orden = deducirOrdenDeFecha(filas.map((c) => c[iFecha] ?? ''))

  const movimientos: MovimientoLeido[] = []
  let descartadas = 0

  for (const c of filas) {
    const sku = c[iSku] ?? ''
    const cantidad = Number(c[iCantidad])

    // El instante manda sobre el día suelto: lleva zona horaria y no es ambiguo.
    const fecha =
      diaDeInstante(iInstante >= 0 ? c[iInstante] ?? null : null) ??
      normalizarFecha(c[iFecha] ?? '', orden)

    if (!sku || !fecha || !Number.isFinite(cantidad)) {
      descartadas++
      continue
    }

    const texto = (i: number): string | null => (i >= 0 && c[i] ? c[i] : null)

    movimientos.push({
      sku,
      asin: texto(iAsin),
      fecha,
      ocurridoAt: instante(texto(iInstante)),
      tipo: c[iTipo] || 'desconocido',
      referencia: texto(iRef),
      cantidad,
      disposicion: texto(iDisp),
      motivo: texto(iMotivo),
      centro: texto(iCentro),
      pais: texto(iPais),
    })
  }

  return { reportId, desde: soloDia(desde), hasta: soloDia(hasta), movimientos, descartadas }
}

/** Qué va primero en una fecha con barras */
export type OrdenFecha = 'mes-primero' | 'dia-primero'

/**
 * Mirando TODAS las fechas, ¿qué va delante, el mes o el día?
 *
 * Un componente por encima de 12 no puede ser un mes. Basta una fila así en todo
 * el fichero para saberlo con certeza. Si no hay ninguna —una semana corta, un
 * cliente con poco movimiento— se devuelve 'mes-primero', que es lo que Amazon
 * documenta, y la fecha real saldrá igualmente de «Date and Time», que es quien
 * manda.
 */
export function deducirOrdenDeFecha(textos: readonly string[]): OrdenFecha {
  for (const t of textos) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec((t ?? '').trim())
    if (!m) continue
    if (Number(m[1]) > 12) return 'dia-primero'
    if (Number(m[2]) > 12) return 'mes-primero'
  }
  return 'mes-primero'
}

/** El día de un instante completo. Es la lectura que no admite discusión */
export function diaDeInstante(texto: string | null): string | null {
  if (!texto) return null
  const t = Date.parse(texto.trim())
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null
}

/** 'YYYY-MM-DD' salga como salga */
export function normalizarFecha(texto: string, orden: OrdenFecha = 'mes-primero'): string | null {
  const t = texto.trim()
  if (!t) return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const barras = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t)
  if (barras) {
    const a = barras[1]
    const b = barras[2]
    const anio = barras[3]
    const mes = orden === 'mes-primero' ? a : b
    const dia = orden === 'mes-primero' ? b : a
    if (Number(mes) < 1 || Number(mes) > 12 || Number(dia) < 1 || Number(dia) > 31) return null
    return `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
  }

  return null
}

function instante(texto: string | null): string | null {
  if (!texto) return null
  const t = Date.parse(texto)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** Amazon guarda el libro mayor 18 meses. Más atrás no hay nada que pedir */
export const MAXIMO_HISTORICO_DIAS = 540

/**
 * Desde qué día hay que leer.
 *
 * LA PRIMERA VEZ SE VA A BUSCAR LA REMESA MÁS ANTIGUA, no 90 días fijos, y esto
 * es lo que decide si una migración de histórico sirve de algo:
 *
 * Al importar las diez remesas de ShoesF, cinco son de mayo —752 de las 1.279
 * unidades—. Con una ventana fija de 90 días la primera lectura empezaría el 20
 * de junio, o sea DESPUÉS de esos cinco envíos: no habría ni un movimiento que
 * los consumiera y el panel los pintaría intactos, como si no se hubiera vendido
 * un par de zapatillas desde mayo. El número sería falso y parecería cierto.
 *
 * Así que la primera vez manda la remesa más antigua, con el tope de lo que
 * Amazon conserva. Las siguientes pasadas ya van desde donde se quedaron.
 */
export function desdeCuandoLeer(
  leidoHasta: string | null,
  hoy: Date,
  remesaMasAntigua?: string | null
): Date {
  const limite = hoy.getTime() - MAXIMO_HISTORICO_DIAS * 86_400_000

  if (!leidoHasta) {
    const porDefecto = hoy.getTime() - PRIMERA_LECTURA_DIAS * 86_400_000
    if (!remesaMasAntigua) return new Date(Math.max(porDefecto, limite))
    // Un día antes de la remesa, para que su propia entrada quede dentro
    const desdeRemesa = Date.parse(`${remesaMasAntigua}T00:00:00Z`) - 86_400_000
    return new Date(Math.max(Math.min(porDefecto, desdeRemesa), limite))
  }

  const ultimo = Date.parse(`${leidoHasta}T00:00:00Z`)
  return new Date(Math.max(ultimo - SOLAPE_DIAS * 86_400_000, limite))
}
