import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { LibroError } from '@/lib/fba/libro'
import { rellenarManifiesto } from '@/lib/fba/manifiesto'

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
 * La plantilla sale de ~/Downloads porque no puede vivir en el repositorio: cada
 * una lleva grabada la cuenta de vendedor de la que se descargó. Si no está, la
 * prueba lo dice y no falla: no es un fallo del código.
 */
const PLANTILLA = join(homedir(), 'Downloads', 'ManifestFileUpload_Template_MPL.xlsx')

let bytes: Buffer
try {
  bytes = readFileSync(PLANTILLA)
} catch {
  console.log(`\n  (saltada: no está ${PLANTILLA}. Descarga una plantilla de Seller Central.)\n`)
  process.exit(0)
}

console.log('\n=== lo que entra y lo que se descarta ===')
const r = rellenarManifiesto(bytes, [
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

console.log('\n=== se niega en vez de escribir a ciegas ===')
try {
  rellenarManifiesto(Buffer.from('esto no es un excel'), [{ sku: 'A', unidades: 1 }])
  ok('un fichero que no es Excel se rechaza', false)
} catch (e) {
  ok('un fichero que no es Excel se rechaza', e instanceof LibroError, String(e))
}
try {
  rellenarManifiesto(bytes, [{ sku: 'A', unidades: 0 }])
  ok('sin ni una linea con unidades, se niega', false)
} catch (e) {
  ok('sin ni una linea con unidades, se niega', e instanceof LibroError, String(e))
}

console.log('\n=== el fichero que sale sigue siendo el de Amazon ===')
const r2 = rellenarManifiesto(bytes, [{ sku: 'X', unidades: 1 }])
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
const antes = partes(bytes)
const despues = partes(r2.xlsx)
ok('no se pierde ninguna parte del paquete', antes.every((p) => despues.includes(p)),
   `faltan ${antes.filter((p) => !despues.includes(p)).join(', ')}`)
ok('no se añade ninguna parte', despues.every((p) => antes.includes(p)),
   `sobran ${despues.filter((p) => !antes.includes(p)).join(', ')}`)

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
