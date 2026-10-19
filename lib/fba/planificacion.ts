/**
 * LA ANTIGÜEDAD DEL STOCK, TAL Y COMO LA CUENTA AMAZON.
 * =====================================================
 * PURO: no llama a Amazon ni a la base. Lee el texto del informe y reparte lo que trae.
 * Se comprueba con planificacion.prueba.ts. La llamada de verdad está en
 * lib/fba/planificacion-amazon.ts.
 *
 *
 * ============ DE DÓNDE SALE ============
 *
 * Del informe de planificación de inventario FBA (`GET_FBA_INVENTORY_PLANNING_DATA`): el mismo
 * que alimenta la pantalla «Planificación de inventario» de Seller Central. Una fila por SKU
 * con las unidades de cada tramo de antigüedad, lo que Amazon calcula que costará guardarlo el
 * mes que viene y el recargo por inventario antiguo.
 *
 * Es la edad REAL, la que usa Amazon para cobrar. La que calcula lib/fba/inventario.ts a partir
 * del libro mayor es una ESTIMACIÓN (FIFO), y se queda corta justo donde más importa: lo que
 * entró antes de que empiece el libro que tenemos, y las devoluciones que vuelven al stock
 * —Amazon las cuenta como recientes—, salen sin edad o con una edad que no es la suya.
 *
 *
 * ============ LAS COLUMNAS ============
 *
 * Los nombres salen de la documentación de Amazon (FBA Inventory reports attributes). Para
 * España los tramos son los que enseña Seller Central: 0-60, 61-90, 91-180, 181-330, 331-365,
 * 366-455 y más de 455. Amazon los trae en columnas más finas (0-30 y 31-60, por ejemplo) que
 * aquí se juntan. Las columnas de otros mercados (`inv-age-0-to-90-days`, `inv-age-365-plus-days`…)
 * se aceptan como respaldo y se marcan como APROXIMADAS: no se inventa un reparto que no viene.
 *
 * Y NO SE DA NADA POR SUPUESTO: si el informe no trae la columna del SKU o ninguna de
 * antigüedad, se dice con las columnas que sí ha traído, en vez de guardar una tabla de ceros
 * que nadie sabría explicar. Es el mismo criterio que la lectura del libro mayor.
 */

export const INFORME_PLANIFICACION = 'GET_FBA_INVENTORY_PLANNING_DATA'

/**
 * «Esa tabla o esa columna no existe» y no otra cosa: lo demás —un permiso, un timeout— no se tapa.
 * 42P01 y 42703 los dice Postgres; PGRST204 y PGRST205, PostgREST cuando no lo tiene en su caché de
 * esquema. Es lo que pasa mientras la migración 231 no está lanzada.
 */
export const faltaLaTabla = (error: { code?: string } | null | undefined): boolean =>
  error?.code === '42P01' || error?.code === '42703' || error?.code === 'PGRST204' || error?.code === 'PGRST205'

/** Los tramos que enseña Seller Central en España */
export const TRAMOS_AMAZON = [
  { id: 'a0', texto: '0-60 días', desde: 0, hasta: 60 },
  { id: 'a61', texto: '61-90', desde: 61, hasta: 90 },
  { id: 'a91', texto: '91-180', desde: 91, hasta: 180 },
  { id: 'a181', texto: '181-330', desde: 181, hasta: 330 },
  { id: 'a331', texto: '331-365', desde: 331, hasta: 365 },
  { id: 'a366', texto: '366-455', desde: 366, hasta: 455 },
  { id: 'a456', texto: 'Más de 455', desde: 456, hasta: Number.POSITIVE_INFINITY },
] as const

export type IdTramoAmazon = (typeof TRAMOS_AMAZON)[number]['id']
export type EdadAmazon = Record<IdTramoAmazon, number>

export const edadVacia = (): EdadAmazon => ({ a0: 0, a61: 0, a91: 0, a181: 0, a331: 0, a366: 0, a456: 0 })

/** Los tramos de más de 90 días: lo que Seller Central llama «antiguo» y empieza a costar */
export const TRAMOS_MAS_DE_90: IdTramoAmazon[] = ['a91', 'a181', 'a331', 'a366', 'a456']

export const unidadesDeMasDe90 = (e: EdadAmazon): number => TRAMOS_MAS_DE_90.reduce((s, id) => s + e[id], 0)
export const unidadesEnTotal = (e: EdadAmazon): number => TRAMOS_AMAZON.reduce((s, t) => s + e[t.id], 0)

/** El tramo más antiguo en el que hay alguna unidad. null si no hay ninguna */
export function tramoMasAntiguo(e: EdadAmazon): IdTramoAmazon | null {
  for (let i = TRAMOS_AMAZON.length - 1; i >= 0; i--) if (e[TRAMOS_AMAZON[i].id] > 0) return TRAMOS_AMAZON[i].id
  return null
}

/* ------------------------------------------------------------------ */
/* Lo que se lee de cada SKU                                           */
/* ------------------------------------------------------------------ */

export interface FilaPlanificacion {
  sku: string
  fnsku: string | null
  asin: string | null
  /** Unidades vendibles que Amazon dice tener */
  disponible: number
  noVendible: number
  /** Unidades por tramo de antigüedad */
  edad: EdadAmazon
  /** Lo que Amazon calcula que costará guardar este SKU el mes que viene. null = el informe no lo trae */
  costeMes: number | null
  /** De la suma anterior, lo que es recargo por inventario antiguo, por tramo */
  recargo: EdadAmazon
  moneda: string | null
  diasSuministro: number | null
  /** La acción que recomienda Amazon («Rebajar el precio», «Retirar»…) tal cual, si la trae */
  accion: string | null
}

export interface ResultadoLectura {
  filas: FilaPlanificacion[]
  /** El día de la foto de la antigüedad ('YYYY-MM-DD'), si el informe lo dice */
  fecha: string | null
  /** Las columnas de antigüedad que se han reconocido */
  columnasEdad: string[]
  /** Los tramos que vienen aproximados porque el informe es de un mercado con otros tramos */
  aproximada: boolean
  /** Filas sin SKU o sin sentido: se cuentan, no se esconden */
  descartadas: number
  /** Lo que el informe trae y aquí no se usa: para dejar rastro si Amazon cambia algo */
  columnas: string[]
}

/* ------------------------------------------------------------------ */
/* Leer el texto                                                       */
/* ------------------------------------------------------------------ */

/** «Inventory age snapshot date» → «inventory-age-snapshot-date». Sin comillas ni signos */
const normaliza = (s: string): string =>
  s
    .trim()
    .replace(/^"+|"+$/g, '')
    .trim()
    .toLowerCase()
    .replace(/[?()]/g, '')
    .replace(/[\s_]+/g, '-')

const limpiaCelda = (c: string | undefined): string => (c ?? '').trim().replace(/^"+|"+$/g, '').trim()

/** Unidades: un entero. Quita puntos de millares y lo que no sea cifra */
export function entero(v: string | undefined): number {
  const t = limpiaCelda(v)
  if (t === '') return 0
  const n = Number(t.replace(/[^\d-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Dinero y días: un número con decimales, venga como venga.
 *
 * «1.234,56» y «1,234.56» son lo mismo. Con solo comas o solo puntos manda la forma: «1,234» con
 * tres cifras tras una coma y un grupo de millares es 1234; «0,05» es 0,05. Un punto solo se
 * toma como decimal, que es como escriben Amazon y los informes en inglés.
 */
export function numero(v: string | undefined): number | null {
  const t0 = limpiaCelda(v).replace(/[^\d.,-]/g, '')
  if (t0 === '' || t0 === '-') return null
  let t = t0
  const coma = t.lastIndexOf(',')
  const punto = t.lastIndexOf('.')
  if (coma >= 0 && punto >= 0) {
    t = coma > punto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  } else if (coma >= 0) {
    t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.')
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** 'YYYY-MM-DD' desde «2026-10-19», «19/10/2026» o «2026-10-19T00:00:00Z». null si no se entiende */
export function aDia(v: string | undefined): string | null {
  const t = limpiaCelda(v)
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/)
  // En el informe de un mercado de España el día va primero
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

const partir = (linea: string): string[] => (linea.includes('\t') ? linea.split('\t') : linea.split(',')).map(limpiaCelda)

/** Las columnas de antigüedad finas, las de España, y a qué tramo de Seller Central suman */
const EDAD_FINA: Record<string, IdTramoAmazon> = {
  'inv-age-0-to-30-days': 'a0',
  'inv-age-31-to-60-days': 'a0',
  'inv-age-61-to-90-days': 'a61',
  'inv-age-91-to-180-days': 'a91',
  'inv-age-181-to-330-days': 'a181',
  'inv-age-331-to-365-days': 'a331',
  'inv-age-366-to-455-days': 'a366',
  'inv-age-456-plus-days': 'a456',
}

/** Las de otros mercados: solo valen si no están las finas, y salen marcadas como aproximadas */
const EDAD_GRUESA: Array<{ columna: string; destino: IdTramoAmazon; siFaltan: string[] }> = [
  { columna: 'inv-age-0-to-90-days', destino: 'a0', siFaltan: ['inv-age-0-to-30-days', 'inv-age-31-to-60-days', 'inv-age-61-to-90-days'] },
  { columna: 'inv-age-181-to-270-days', destino: 'a181', siFaltan: ['inv-age-181-to-330-days'] },
  { columna: 'inv-age-271-to-365-days', destino: 'a331', siFaltan: ['inv-age-181-to-330-days', 'inv-age-331-to-365-days'] },
  { columna: 'inv-age-365-plus-days', destino: 'a366', siFaltan: ['inv-age-366-to-455-days', 'inv-age-456-plus-days'] },
]

/** El recargo por inventario antiguo («aged inventory surcharge»), por tramo */
const RECARGO: Record<string, IdTramoAmazon> = {
  'estimated-ais-181-210-days': 'a181',
  'estimated-ais-211-240-days': 'a181',
  'estimated-ais-241-270-days': 'a181',
  'estimated-ais-271-300-days': 'a181',
  'estimated-ais-301-330-days': 'a181',
  'estimated-ais-331-365-days': 'a331',
  'estimated-ais-366-455-days': 'a366',
  'estimated-ais-456-plus-days': 'a456',
}

export function parsearPlanificacion(texto: string): ResultadoLectura {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lineas.length === 0) return { filas: [], fecha: null, columnasEdad: [], aproximada: false, descartadas: 0, columnas: [] }

  const cabecera = partir(lineas[0])
  const nombres = cabecera.map(normaliza)
  const tiene = new Set(nombres)
  const donde = (...candidatos: string[]): number => {
    for (const c of candidatos) {
      const i = nombres.indexOf(c)
      if (i >= 0) return i
    }
    return -1
  }

  const iSku = donde('sku', 'merchant-sku', 'msku')
  const edadCols: Array<{ i: number; destino: IdTramoAmazon }> = []
  let aproximada = false
  nombres.forEach((n, i) => {
    const fina = EDAD_FINA[n]
    if (fina) edadCols.push({ i, destino: fina })
  })
  for (const g of EDAD_GRUESA) {
    if (!tiene.has(g.columna) || g.siFaltan.some((f) => tiene.has(f))) continue
    // Si ya hay una fina para ese tramo, la gruesa solo estorbaría
    edadCols.push({ i: nombres.indexOf(g.columna), destino: g.destino })
    aproximada = true
  }
  const recargoCols: Array<{ i: number; destino: IdTramoAmazon }> = []
  nombres.forEach((n, i) => {
    const r = RECARGO[n]
    if (r) recargoCols.push({ i, destino: r })
  })
  if (recargoCols.length === 0 && tiene.has('estimated-ais-365-plus-days')) {
    recargoCols.push({ i: nombres.indexOf('estimated-ais-365-plus-days'), destino: 'a366' })
  }

  // Sin SKU o sin ninguna columna de antigüedad el informe no sirve: se dice qué ha traído
  if (iSku < 0 || edadCols.length === 0) {
    throw new Error(
      `El informe de planificación no trae las columnas esperadas (SKU y antigüedad del inventario). Ha devuelto: ${cabecera.slice(0, 60).join(', ')}`
    )
  }

  const iFnsku = donde('fnsku')
  const iAsin = donde('asin')
  const iDisponible = donde('available', 'available-quantity')
  const iNoVendible = donde('unfulfillable-quantity')
  const iCoste = donde('estimated-storage-cost-next-month')
  const iMoneda = donde('currency')
  const iDias = donde('days-of-supply')
  const iAccion = donde('recommended-action')
  const iFecha = donde('inventory-age-snapshot-date', 'snapshot-date')

  const porSku = new Map<string, FilaPlanificacion>()
  let descartadas = 0
  let fecha: string | null = null

  for (const linea of lineas.slice(1)) {
    const c = partir(linea)
    const sku = limpiaCelda(c[iSku])
    if (!sku) {
      descartadas++
      continue
    }
    if (fecha === null && iFecha >= 0) fecha = aDia(c[iFecha])

    const edad = edadVacia()
    for (const { i, destino } of edadCols) edad[destino] += Math.max(0, entero(c[i]))
    const recargo = edadVacia()
    for (const { i, destino } of recargoCols) recargo[destino] += Math.max(0, numero(c[i]) ?? 0)

    const nueva: FilaPlanificacion = {
      sku,
      fnsku: iFnsku >= 0 ? limpiaCelda(c[iFnsku]) || null : null,
      asin: iAsin >= 0 ? limpiaCelda(c[iAsin]) || null : null,
      disponible: iDisponible >= 0 ? Math.max(0, entero(c[iDisponible])) : unidadesEnTotal(edad),
      noVendible: iNoVendible >= 0 ? Math.max(0, entero(c[iNoVendible])) : 0,
      edad,
      costeMes: iCoste >= 0 ? numero(c[iCoste]) : null,
      recargo,
      moneda: iMoneda >= 0 ? limpiaCelda(c[iMoneda]) || null : null,
      diasSuministro: iDias >= 0 ? numero(c[iDias]) : null,
      accion: iAccion >= 0 ? limpiaCelda(c[iAccion]) || null : null,
    }

    // El mismo SKU en dos filas (condición nueva y usada, por ejemplo): se suma
    const previa = porSku.get(sku)
    if (!previa) porSku.set(sku, nueva)
    else {
      for (const t of TRAMOS_AMAZON) {
        previa.edad[t.id] += nueva.edad[t.id]
        previa.recargo[t.id] += nueva.recargo[t.id]
      }
      previa.disponible += nueva.disponible
      previa.noVendible += nueva.noVendible
      previa.costeMes = previa.costeMes === null && nueva.costeMes === null ? null : (previa.costeMes ?? 0) + (nueva.costeMes ?? 0)
      previa.fnsku ??= nueva.fnsku
      previa.asin ??= nueva.asin
      previa.accion ??= nueva.accion
    }
  }

  return {
    filas: [...porSku.values()],
    fecha,
    columnasEdad: edadCols.map((e) => nombres[e.i]),
    aproximada,
    descartadas,
    columnas: cabecera,
  }
}

/* ------------------------------------------------------------------ */
/* Lo que se enseña                                                    */
/* ------------------------------------------------------------------ */

export interface EdadAmazonSku {
  /** Unidades por tramo */
  edad: EdadAmazon
  disponible: number
  /** Lo que Amazon calcula que costará guardar este SKU el mes que viene */
  costeMes: number | null
  /** De eso, lo que es recargo por antigüedad */
  recargoMes: number
  /** Lo que cuesta guardar las unidades de cada tramo: la suma es `costeMes`. null si el informe no trae coste */
  costePorTramo: EdadAmazon | null
  masDe90: number
  /** El tramo más antiguo con unidades */
  masAntiguo: IdTramoAmazon | null
  accion: string | null
}

export interface TramoResumido {
  id: IdTramoAmazon
  texto: string
  unidades: number
  /** Unidades a precio de venta. Solo cuentan los SKU que tienen precio */
  valor: number
  /** La parte del coste de almacenaje que corresponde a este tramo, repartido como se explica en `repartoDeCoste` */
  coste: number | null
}

export interface ResumenEdadAmazon {
  /** El día de la foto de Amazon */
  fecha: string
  moneda: string | null
  aproximada: boolean
  tramos: TramoResumido[]
  /** Todas las unidades con edad: la suma de los tramos */
  unidades: number
  masDe90: number
  masDe180: number
  /** Lo que Amazon calcula que costará guardar TODO el stock del cliente el mes que viene */
  costeMes: number | null
  /** De eso, lo que es recargo por antigüedad */
  recargoMes: number
  porSku: Record<string, EdadAmazonSku>
}

/**
 * Cuánto de lo que cuesta un SKU cae en cada tramo.
 *
 * Amazon da UN número por SKU: lo que costará guardarlo el mes que viene (almacenaje mensual y
 * recargos, el de antigüedad incluido) y, aparte, cuánto de eso es recargo por antigüedad en cada
 * tramo. Lo que no es recargo es almacenaje mensual y es igual para todas las unidades, así que se
 * reparte por unidades; el recargo va entero al tramo que lo causa. Así la suma de los tramos es
 * exactamente lo que dice Amazon.
 *
 * Si el recargo declarado fuese mayor que el coste total —el informe no cuadraría consigo mismo—, se
 * reparte todo por unidades y no se afirma nada del recargo.
 */
export function repartoDeCoste(fila: FilaPlanificacion): Record<IdTramoAmazon, number> | null {
  if (fila.costeMes === null) return null
  const unidades = unidadesEnTotal(fila.edad)
  const reparto = edadVacia()
  if (unidades <= 0) return reparto
  const recargoTotal = TRAMOS_AMAZON.reduce((s, t) => s + fila.recargo[t.id], 0)
  const coherente = recargoTotal <= fila.costeMes + 1e-9
  const base = coherente ? fila.costeMes - recargoTotal : fila.costeMes
  for (const t of TRAMOS_AMAZON) reparto[t.id] = (base * fila.edad[t.id]) / unidades + (coherente ? fila.recargo[t.id] : 0)
  return reparto
}

const redondea = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d

export function resumirEdadAmazon(entrada: {
  filas: FilaPlanificacion[]
  fecha: string
  aproximada?: boolean
  /** Precio de venta por SKU, para valorar las unidades de cada tramo */
  precios: ReadonlyMap<string, number | null>
}): ResumenEdadAmazon {
  const tramos: TramoResumido[] = TRAMOS_AMAZON.map((t) => ({ id: t.id, texto: t.texto, unidades: 0, valor: 0, coste: null }))
  const costes = edadVacia()
  let hayCoste = false
  let costeMes = 0
  let recargoMes = 0
  let moneda: string | null = null
  const porSku: Record<string, EdadAmazonSku> = {}

  for (const f of entrada.filas) {
    const precio = entrada.precios.get(f.sku) ?? null
    const reparto = repartoDeCoste(f)
    for (const t of tramos) {
      t.unidades += f.edad[t.id]
      if (precio !== null) t.valor += f.edad[t.id] * precio
      if (reparto) costes[t.id] += reparto[t.id]
    }
    if (f.costeMes !== null) {
      hayCoste = true
      costeMes += f.costeMes
    }
    const recargo = TRAMOS_AMAZON.reduce((s, t) => s + f.recargo[t.id], 0)
    recargoMes += recargo
    moneda ??= f.moneda
    porSku[f.sku] = {
      edad: f.edad,
      disponible: f.disponible,
      costeMes: f.costeMes === null ? null : redondea(f.costeMes),
      recargoMes: redondea(recargo),
      costePorTramo: reparto,
      masDe90: unidadesDeMasDe90(f.edad),
      masAntiguo: tramoMasAntiguo(f.edad),
      accion: f.accion,
    }
  }

  for (const t of tramos) {
    t.valor = redondea(t.valor)
    t.coste = hayCoste ? redondea(costes[t.id]) : null
  }
  const masDe180 = tramos.filter((t) => t.id === 'a181' || t.id === 'a331' || t.id === 'a366' || t.id === 'a456').reduce((s, t) => s + t.unidades, 0)

  return {
    fecha: entrada.fecha,
    moneda,
    aproximada: entrada.aproximada === true,
    tramos,
    unidades: tramos.reduce((s, t) => s + t.unidades, 0),
    masDe90: tramos.filter((t) => TRAMOS_MAS_DE_90.includes(t.id)).reduce((s, t) => s + t.unidades, 0),
    masDe180,
    costeMes: hayCoste ? redondea(costeMes) : null,
    recargoMes: redondea(recargoMes),
    porSku,
  }
}
