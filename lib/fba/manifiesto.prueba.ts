import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { LibroError, abrir, buscarHoja, cadenasCompartidas, decode, leerCelda } from '@/lib/fba/libro'
import { manifiestoListo, rellenarManifiesto } from '@/lib/fba/manifiesto'
import { PLANTILLA_MANIFIESTO_BYTES, PLANTILLA_MANIFIESTO_SHA256, plantillaDelManifiesto } from '@/lib/fba/manifiesto-plantilla'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL MANIFIESTO, CONTRA LA PLANTILLA DE VERDAD.
 *
 * No vale una plantilla de mentira: lo que hay que comprobar es que el fichero
 * que sale lo sigue aceptando Seller Central, y eso depende de que NO se pierda
 * ninguna parte del paquete, de que la hoja de ejemplo no se toque y de que un
 * SKU con ceros a la izquierda siga siendo texto.
 *
 * La plantilla ya va empotrada en el repositorio (lib/fba/manifiesto-plantilla.ts),
 * así que esta prueba corre en cualquier sitio. Si además hay una descargada en
 * ~/Downloads, se comprueba que es la misma: así se nota el día que Amazon cambie la suya.
 */
const integrada = Buffer.from(plantillaDelManifiesto())
const DESCARGADA = join(homedir(), 'Downloads', 'ManifestFileUpload_Template_MPL.xlsx')

console.log('\n=== la plantilla empotrada es la de Amazon, sin tocar ===')
ok('pesa lo que debe', integrada.byteLength === PLANTILLA_MANIFIESTO_BYTES, `${integrada.byteLength} bytes`)
ok('su SHA-256 es el anotado', createHash('sha256').update(integrada).digest('hex') === PLANTILLA_MANIFIESTO_SHA256)
ok('cada llamada da una copia propia', (() => {
  const a = plantillaDelManifiesto()
  a[0] = 0
  return plantillaDelManifiesto()[0] === 0x50
})())
if (existsSync(DESCARGADA)) {
  const igual = Buffer.compare(integrada, readFileSync(DESCARGADA)) === 0
  ok('es idéntica a la que hay en Descargas (si Amazon la cambia, esto avisa)', igual)
} else {
  console.log(`  (no hay ${DESCARGADA}: no se compara con una descargada)`)
}

console.log('\n=== el manifiesto sale solo, sin subir nada ===')
const r = manifiestoListo([
  { sku: '602A BEIG/39', unidades: 5 },
  { sku: '0050119247', unidades: 12 },
  { sku: 'Tiburón & Co <test>', unidades: 3 },
  { sku: 'FUERA/0', unidades: 0 },
  { sku: '   ', unidades: 4 },
  { sku: 'MEDIA', unidades: 2.5 },
])
ok('entran las 3 buenas', r.lineas === 3, String(r.lineas))
ok('suman 20 unidades', r.unidades === 20, String(r.unidades))
ok('descarta 3 y dice por que', r.descartadas.length === 3, JSON.stringify(r.descartadas.map((d) => d.sku)))
ok('el .xlsx tiene contenido', r.xlsx.byteLength > 5000, `${r.xlsx.byteLength} bytes`)

console.log('\n=== lo escrito, leído de vuelta desde el fichero ===')
{
  // Se lee con el mismo código que localiza las celdas al escribir, pero sobre el
  // fichero ya cerrado: si algo se escribiera en otra fila, aquí no cuadra.
  const paquete = abrir(r.xlsx, 'el manifiesto')
  const hoja = buscarHoja(paquete, ['Create workflow – template'])
  ok('la hoja de trabajo existe', !!hoja)
  if (hoja) {
    const xml = decode(paquete[hoja.ruta])
    const comp = cadenasCompartidas(paquete)
    const celda = (ref: string) => leerCelda(xml, ref, comp)
    ok('Default prep owner = Seller', celda('B3') === 'Seller', celda('B3'))
    ok('Default labeling owner = Seller', celda('B4') === 'Seller', celda('B4'))
    ok('la cabecera sigue en la fila 8', celda('A8') === 'Merchant SKU' && celda('B8') === 'Quantity', `${celda('A8')} / ${celda('B8')}`)
    ok('primera línea: SKU y unidades', celda('A9') === '602A BEIG/39' && celda('B9') === '5', `${celda('A9')} / ${celda('B9')}`)
    ok('un SKU con ceros a la izquierda sigue siendo texto', celda('A10') === '0050119247' && celda('B10') === '12', `${celda('A10')} / ${celda('B10')}`)
    ok('los símbolos se conservan (& < >)', celda('A11') === 'Tiburón & Co <test>', celda('A11'))
    ok('y detrás no queda nada', celda('A12') === '' && celda('B12') === '', `${celda('A12')} / ${celda('B12')}`)
    ok('prep y labeling por fila, vacíos (coinciden con el valor por defecto)', celda('C9') === '' && celda('D9') === '')
  }
}

console.log('\n=== SKUs de ShoesF tal cual, con sus guiones finales ===')
{
  const s = manifiestoListo([
    { sku: 'FBA366246-39--', unidades: 2 },
    { sku: 'FBA629708-40-', unidades: 3 },
    { sku: 'FBA047768-41', unidades: 4 },
  ])
  const p = abrir(s.xlsx, 'el manifiesto')
  const h = buscarHoja(p, ['Create workflow – template'])!
  const xml = decode(p[h.ruta])
  const comp = cadenasCompartidas(p)
  const skus = ['A9', 'A10', 'A11'].map((c) => leerCelda(xml, c, comp))
  ok('los guiones finales no se tocan', JSON.stringify(skus) === JSON.stringify(['FBA366246-39--', 'FBA629708-40-', 'FBA047768-41']), JSON.stringify(skus))
}

console.log('\n=== se niega en vez de escribir a ciegas ===')
try {
  rellenarManifiesto(Buffer.from('esto no es un excel'), [{ sku: 'A', unidades: 1 }])
  ok('un fichero que no es Excel se rechaza', false)
} catch (e) {
  ok('un fichero que no es Excel se rechaza', e instanceof LibroError, String(e))
}
try {
  manifiestoListo([{ sku: 'A', unidades: 0 }])
  ok('sin ni una linea con unidades, se niega', false)
} catch (e) {
  ok('sin ni una linea con unidades, se niega', e instanceof LibroError, String(e))
}

console.log('\n=== una plantilla propia sigue valiendo ===')
{
  const propia = rellenarManifiesto(integrada, [{ sku: 'PROPIA-1', unidades: 7 }])
  ok('rellenar una plantilla subida da el mismo resultado que la integrada', propia.lineas === 1 && propia.unidades === 7)
}

console.log('\n=== el fichero que sale sigue siendo el de Amazon ===')
const r2 = manifiestoListo([{ sku: 'X', unidades: 1 }])
// Se compara el paquete entero: si al rellenar se perdiera una parte -los
// estilos, el tema, los metadatos- Excel abriria el fichero igual y Seller
// Central lo rechazaria sin decir por que.
const partes = (b: Uint8Array) => {
  const buf = Buffer.from(b)
  const fin = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const n = buf.readUInt16LE(fin + 10)
  let off = buf.readUInt32LE(fin + 16)
  const out: string[] = []
  for (let k = 0; k < n; k += 1) {
    const len = buf.readUInt16LE(off + 28)
    out.push(buf.toString('utf8', off + 46, off + 46 + len))
    off += 46 + len + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32)
  }
  return out.sort()
}
const antes = partes(integrada)
const despues = partes(r2.xlsx)
ok('no se pierde ninguna parte del paquete', antes.every((p) => despues.includes(p)),
   `faltan ${antes.filter((p) => !despues.includes(p)).join(', ')}`)
ok('no se añade ninguna parte', despues.every((p) => antes.includes(p)),
   `sobran ${despues.filter((p) => !antes.includes(p)).join(', ')}`)

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
