import * as XLSX from 'xlsx'

/**
 * EL ENVÍO DE UN MES, SACADO DEL «TABLERO DE PRODUCTOS» DE SELLERBOARD.
 *
 * Shoplamp paga el 5 % de lo que su facturación neta del mes supera 3.500 €. Desde noviembre de 2026 (lo pidió Raúl) a esa facturación
 * neta se le resta antes lo que le ha costado el envío ese mes, que el tax report de Amazon no trae y Sellerboard sí: la columna
 * «Shipping» del export por producto, en negativo, una fila por SKU. Su suma es el «Envío» del panel de Sellerboard (octubre de 2026:
 * −1.941,06 €, comprobado contra la captura).
 *
 * Pura: recibe los bytes y devuelve el número. Lee XLSX, XLS y CSV con la misma librería. No guarda nada del fichero.
 *
 * Las filas sin ASIN ni SKU no se cuentan: si Sellerboard algún día añade una fila de totales al final, sumarla duplicaría el envío.
 */

export interface EnvioDeSellerboard {
  /** Lo que cuesta el envío del mes, en positivo y redondeado a céntimos */
  total: number
  /** Cuántas filas de producto tenían envío */
  filasConEnvio: number
  /** Cómo se llamaba la columna en el fichero */
  columna: string
}

const ES_ENVIO = /^(shipping|env[ií]o|gastos de env[ií]o)$/i
const ES_ID = /^(asin|sku)$/i

function numero(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v !== 'string') return 0
  const t = v.trim().replace(/[€\s]/g, '')
  if (!t || t === '-') return 0
  // «1.941,06», «1,941.06» o «-1941.06»: el separador que va el último es el de los decimales
  const decimalComa = t.lastIndexOf(',') > t.lastIndexOf('.')
  const normal = decimalComa ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  const n = Number(normal)
  return Number.isFinite(n) ? n : 0
}

export function envioDeSellerboard(datos: ArrayBuffer | Uint8Array): EnvioDeSellerboard {
  // raw: en un CSV deja el texto tal cual («-1.941,06»); si no, la librería lo lee como -1,941 en formato inglés
  const libro = XLSX.read(datos instanceof Uint8Array ? datos : new Uint8Array(datos), { type: 'array', raw: true })
  const hoja = libro.Sheets[libro.SheetNames[0]]
  if (!hoja) throw new Error('El fichero de Sellerboard está vacío.')
  const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: null })

  // La cabecera es la primera fila (en las primeras diez) que tenga una columna de envío
  let cabecera = -1
  let iEnvio = -1
  for (let i = 0; i < Math.min(10, filas.length); i++) {
    const j = (filas[i] ?? []).findIndex((c) => typeof c === 'string' && ES_ENVIO.test(c.trim()))
    if (j >= 0) {
      cabecera = i
      iEnvio = j
      break
    }
  }
  if (cabecera < 0) {
    throw new Error(
      'El fichero de Sellerboard no tiene la columna «Shipping». Tiene que ser el export del «Tablero de productos» (Dashboard → Products → Excel).'
    )
  }

  const titulos = filas[cabecera] as unknown[]
  const iIds = titulos.map((c, j) => (typeof c === 'string' && ES_ID.test(c.trim()) ? j : -1)).filter((j) => j >= 0)

  let suma = 0
  let filasConEnvio = 0
  for (const fila of filas.slice(cabecera + 1)) {
    if (!fila) continue
    if (iIds.length > 0 && iIds.every((j) => fila[j] == null || String(fila[j]).trim() === '')) continue
    const v = numero(fila[iEnvio])
    if (v === 0) continue
    suma += v
    filasConEnvio++
  }

  return { total: Math.round(Math.abs(suma) * 100) / 100, filasConEnvio, columna: String(titulos[iEnvio]).trim() }
}
