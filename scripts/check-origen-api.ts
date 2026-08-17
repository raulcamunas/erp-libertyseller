/**
 * COMPROBACIÓN DEL ORIGEN «API DEL PROVEEDOR».
 *
 * Contesta a la única pregunta que el compilador no puede: el CSV que fabrica
 * el conector, ¿lo lee `leerStock()`? Puede compilar todo perfectamente y
 * generar un fichero que el lector no sepa abrir, y eso no se descubriría hasta
 * que el ciclo procese al cliente de verdad, con el envío automático encendido.
 *
 * Los productos de abajo tienen la forma EXACTA que devuelve su API, sacados
 * del volcado real, con los cuatro casos que rompen un CSV escrito a la ligera:
 * comillas dentro de la descripción, punto y coma dentro de la descripción, EAN
 * vacío y stock negativo.
 *
 * No necesita credenciales ni red: la llamada a la API no se hace aquí. Lo que
 * se comprueba es la serialización y la lectura, que es donde está el riesgo.
 *
 *   npx tsx scripts/check-origen-api.ts
 */

import { leerStock } from '@/lib/stock-sync/lector'
import type { ProductoEntrais } from '@/lib/entrais/api'
import type { PerfilLectura } from '@/lib/stock-sync/lector'

/* Productos con la forma EXACTA que devuelve su API, sacados del volcado real:
   comillas dentro de la descripción, EAN vacío, stock negativo, canon, digital. */
const PRODUCTOS = [
  {
    code: 38265,
    description: "CAJA EXTERNA HDD/SSD 2.5'' NEGRO TOOQ",
    family: null, brand: null, subfamily: null,
    ean: '8433281013544', partNumber: 'TQE-2500B',
    digital: false, price: 3.44, digitalCanon: 0, stock: 48,
    entries: null, pricesPerQuantity: null,
  },
  {
    code: 48021,
    description: 'SMARTPHONE SAMSUNG GALAXY S26 ULTRA 5G 6.9" 256 GB NEGRO',
    family: null, brand: null, subfamily: null,
    ean: '8806097827221', partNumber: 'SM-S948BZKDEUE',
    digital: false, price: 843.25, digitalCanon: 3.25, stock: -1,
    entries: null, pricesPerQuantity: null,
  },
  {
    code: 34519,
    description: '4 TB SSD SERIE 870 EVO SAMSUNG',
    family: null, brand: null, subfamily: null,
    ean: '8806090545894', partNumber: 'MZ-77E4T0B/EU',
    digital: false, price: 224.5, digitalCanon: 3, stock: 9,
    entries: null, pricesPerQuantity: null,
  },
  {
    code: 41718,
    description: 'CABLE; CON PUNTO Y COMA Y "COMILLAS" DENTRO',
    family: null, brand: null, subfamily: null,
    ean: '', partNumber: null,
    digital: false, price: 0.74, digitalCanon: 0, stock: 0,
    entries: null, pricesPerQuantity: null,
  },
  {
    code: 12345,
    description: 'MICROSOFT 365 PERSONAL 1 AÑO ESD',
    family: null, brand: null, subfamily: null,
    ean: null, partNumber: 'QQ2-01897',
    digital: true, price: 55.9, digitalCanon: 0, stock: -100,
    entries: null, pricesPerQuantity: null,
  },
] as unknown as ProductoEntrais[]

/* ---- Copia literal de la serialización del conector (no está exportada) ---- */
const CABECERAS = ['COD_INTERNO', 'EAN', 'STOCK', 'PRECIO', 'CANON', 'DIGITAL', 'NOMBRE']

function celda(valor: string | number): string {
  const texto = String(valor ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, '""')
  return `"${texto}"`
}

function aCsv(productos: ProductoEntrais[]) {
  let negativos = 0
  const ordenados = [...productos].sort((a, b) => a.code - b.code)
  const lineas = [CABECERAS.join(';')]
  for (const p of ordenados) {
    if (p.stock < 0) negativos++
    lineas.push(
      [
        celda(p.code),
        celda(p.ean ?? ''),
        celda(Math.trunc(p.stock)),
        celda(p.price.toFixed(2)),
        celda((p.digitalCanon ?? 0).toFixed(2)),
        celda(p.digital ? 'SI' : 'NO'),
        celda(p.description ?? ''),
      ].join(';')
    )
  }
  return { csv: lineas.join('\n'), negativos }
}

/* ---- El perfil, con los nombres de columna de la tarifa del proveedor ---- */
const PERFIL: PerfilLectura = {
  nombre: 'Entrais · Volcado API',
  tipo: 'stock',
  columnas: {
    referencia: ['COD_INTERNO'],
    stock: ['STOCK'],
    precio: ['PRECIO'],
    ean: ['EAN'],
    descripcion: ['NOMBRE'],
  },
  csvSeparador: null,
  csvCodificacion: null,
}

const { csv, negativos } = aCsv(PRODUCTOS)
console.log('---------- CSV generado ----------')
console.log(csv)
console.log('----------------------------------\n')

const bytes = Buffer.from(csv, 'utf8')
const lectura = leerStock(bytes, PERFIL)

console.log(`Filas leídas: ${lectura.lineas.length} de ${PRODUCTOS.length} productos`)
console.log(`Negativos convertidos a cero: ${negativos}`)
if (lectura.avisos?.length) console.log('Avisos:', lectura.avisos)
console.log()

for (const l of lectura.lineas) {
  console.log(
    `  ref=${String(l.articulo).padEnd(7)} stock=${String(l.stock).padStart(4)}  ` +
      `precio=${String(l.precio ?? '—').padStart(8)}  ean=${(l.ean ?? '—').padEnd(14)} ${String(l.descripcion ?? '').slice(0, 40)}`
  )
}

/* ---- Las comprobaciones ---- */
let fallos = 0
function comprobar(que: string, ok: boolean) {
  console.log(`${ok ? '  OK  ' : ' FALLA'} ${que}`)
  if (!ok) fallos++
}
console.log('\n---------- Comprobaciones ----------')
comprobar('lee las 5 filas', lectura.lineas.length === 5)
comprobar('el orden es por código ascendente', lectura.lineas.map((l) => Number(l.articulo)).join() === '12345,34519,38265,41718,48021')
comprobar('el -100 lo capa el LECTOR a 0', lectura.lineas.find((l) => Number(l.articulo) === 12345)?.stock === 0)
comprobar('el -1 lo capa el LECTOR a 0', lectura.lineas.find((l) => Number(l.articulo) === 48021)?.stock === 0)
comprobar('el 48 se respeta', lectura.lineas.find((l) => Number(l.articulo) === 38265)?.stock === 48)
comprobar('el precio 843.25 se lee entero', lectura.lineas.find((l) => Number(l.articulo) === 48021)?.precio === 843.25)
comprobar(
  'el punto y coma dentro de la descripción no parte la fila',
  (lectura.lineas.find((l) => Number(l.articulo) === 41718)?.descripcion ?? '').includes('COMILLAS')
)
comprobar('el EAN vacío no inventa nada', !lectura.lineas.find((l) => Number(l.articulo) === 41718)?.ean)
comprobar('el lector AVISA de los 2 sobrevendidos', (lectura.avisos ?? []).some((a) => /NEGATIVO/.test(a)))
comprobar('el EAN bueno se lee', lectura.lineas.find((l) => Number(l.articulo) === 34519)?.ean === '8806090545894')

/* Determinismo: dos pasadas con los productos desordenados dan el mismo fichero */
const revuelto = [...PRODUCTOS].reverse()
comprobar('mismo CSV aunque la API conteste en otro orden', aCsv(revuelto).csv === csv)

console.log(fallos === 0 ? '\nTodo correcto.' : `\n${fallos} comprobaciones han fallado.`)
process.exit(fallos === 0 ? 0 : 1)
