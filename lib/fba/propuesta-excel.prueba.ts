import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { LOGO_ALTO_PX, LOGO_ANCHO_PX, LOGO_SHA256, logoPng } from '@/lib/fba/excel/logo-marca'
import { excelDePropuesta, fechaCorta, fechaLarga, type DatosPropuesta } from '@/lib/fba/propuesta-excel'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL EXCEL DE LA PROPUESTA, ABIERTO DE VUELTA.
 *
 * No basta con que el ZIP se genere: un .xlsx que Excel rechaza («hemos encontrado un
 * problema con el contenido») es peor que no tener Excel, porque se descubre cuando ya
 * se le ha mandado al cliente. Aquí se comprueba por tres vías: la estructura del
 * paquete, que cada pieza XML esté bien formada y que openpyxl —otro lector, escrito por
 * otra gente— lo abra y vea lo que hemos escrito. Si Python u openpyxl no están, esa
 * parte se salta y se dice.
 */

console.log('\n=== el logo es el de la aplicación, sin tocar ===')
{
  const logo = Buffer.from(logoPng())
  ok('es un PNG', logo.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
  ok('su SHA-256 es el anotado', createHash('sha256').update(logo).digest('hex') === LOGO_SHA256)
  ok('mide lo anotado', logo.readUInt32BE(16) === LOGO_ANCHO_PX && logo.readUInt32BE(20) === LOGO_ALTO_PX, `${logo.readUInt32BE(16)}x${logo.readUInt32BE(20)}`)
  const a = logoPng()
  a[0] = 0
  ok('cada llamada da una copia propia', logoPng()[0] === 0x89)
}

console.log('\n=== fechas ===')
ok('larga', fechaLarga('2026-10-22') === '22 de octubre de 2026', fechaLarga('2026-10-22'))
ok('el uno no lleva cero', fechaLarga('2026-03-01') === '1 de marzo de 2026', fechaLarga('2026-03-01'))
ok('corta', fechaCorta('2026-10-22') === '22/10/2026')
ok('lo que no es un día se deja', fechaLarga('pronto') === 'pronto' && fechaCorta('pronto') === 'pronto')

const BASE: DatosPropuesta = {
  cliente: 'ShoesF',
  nombre: 'Reposición de octubre',
  fechaEnvio: '2026-10-22',
  nota: 'Las cajas salen el jueves por la mañana.\nSi falta alguna talla, avisadnos antes.',
  hoy: '2026-10-19',
  rotuloVariante: 'Talla',
  lineas: [
    { sku: 'FBA047768-40', unidades: 6, referencia: '8412', nombre: 'CUERO NEGRO', variante: '40' },
    { sku: 'FBA047768-9', unidades: 3, referencia: '8412', nombre: 'CUERO NEGRO', variante: '9' },
    { sku: 'FBA047768-10', unidades: 4, referencia: '8412', nombre: 'CUERO NEGRO', variante: '10' },
    { sku: 'FBA366246-39--', unidades: 12, referencia: '3662', nombre: 'GAMUZA BEIG con una descripción muy larga que obliga a la fila a hacerse más alta para que se lea entera', variante: '39' },
    { sku: '=SUMA(A1:A9)', unidades: 2, referencia: null, nombre: '=HYPERLINK("http://x","clic")', variante: null },
    { sku: 'CON\u0007CONTROL', unidades: 1, referencia: null, nombre: 'Tiburón & Co <test> "comillas"', variante: null },
    { sku: 'CERO', unidades: 0, referencia: null, nombre: 'No debe salir', variante: null },
    { sku: 'MEDIA', unidades: 2.5, referencia: null, nombre: 'No debe salir', variante: null },
    { sku: '   ', unidades: 5, referencia: null, nombre: 'Sin SKU: no debe salir', variante: null },
  ],
}

const r = excelDePropuesta(BASE)

console.log('\n=== lo que cuenta ===')
ok('entran las 6 buenas', r.lineas === 6, String(r.lineas))
ok('suman 28 unidades', r.unidades === 28, String(r.unidades))
ok('el nombre del fichero es ASCII, sin espacios', /^propuesta-envio-shoesf-reposicion-de-octubre\.xlsx$/.test(r.nombreFichero), r.nombreFichero)
ok('sin nombre usa la fecha de envío', excelDePropuesta({ ...BASE, nombre: null }).nombreFichero === 'propuesta-envio-shoesf-2026-10-22.xlsx')
ok('un cliente con acentos y signos sale limpio', /^propuesta-envio-yo-by-yolanda-/.test(excelDePropuesta({ ...BASE, cliente: 'Yó by Yolanda!' }).nombreFichero))
ok('un nombre entero en japonés no rompe el fichero', /^propuesta-envio-shoesf-2026-10-22\.xlsx$/.test(excelDePropuesta({ ...BASE, nombre: '日本語' }).nombreFichero))

console.log('\n=== el paquete ===')
const paquete = unzipSync(r.xlsx)
const partes = Object.keys(paquete).sort()
ok('lleva las piezas de un .xlsx', ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'].every((p) => partes.includes(p)), partes.join(', '))
ok('lleva el logo', partes.includes('xl/media/image1.png') && partes.includes('xl/drawings/drawing1.xml'))
ok('el logo del paquete es el original, byte a byte', Buffer.compare(Buffer.from(paquete['xl/media/image1.png']), Buffer.from(logoPng())) === 0)
const texto = (ruta: string) => new TextDecoder().decode(paquete[ruta])
const hoja = texto('xl/worksheets/sheet1.xml')
ok('sin fórmulas: todo son valores', !/<f[ >]/.test(hoja))
ok('el «=» del principio es texto y no una fórmula', /t="inlineStr"><is><t xml:space="preserve">=SUMA\(A1:A9\)</.test(hoja))
ok('los caracteres de control no llegan al XML', !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(hoja))
ok('el «&» y el «<» van escapados', hoja.includes('Tiburón &amp; Co &lt;test&gt; &quot;comillas&quot;'))
ok('sin cuadrícula', hoja.includes('showGridLines="0"'))
ok('ajustada a una página de ancho', hoja.includes('fitToWidth="1"') && hoja.includes('fitToPage="1"'))
ok('hay celdas combinadas (las tarjetas)', /<mergeCells count="\d+">/.test(hoja))

console.log('\n=== cada pieza está bien formada y se abre con openpyxl ===')
const carpeta = mkdtempSync(join(tmpdir(), 'propuesta-excel-'))
const ruta = join(carpeta, 'propuesta.xlsx')
writeFileSync(ruta, r.xlsx)
const PY = `
import json, sys, zipfile
from xml.dom import minidom
ruta = sys.argv[1]
z = zipfile.ZipFile(ruta)
assert z.testzip() is None, 'el ZIP está dañado'
for n in z.namelist():
    if n.endswith('.xml') or n.endswith('.rels'):
        minidom.parseString(z.read(n))
import openpyxl
wb = openpyxl.load_workbook(ruta)
ws = wb[wb.sheetnames[0]]
def col(c):
    return None if c is None or c.type != 'rgb' else c.rgb
salida = {
  'hojas': wb.sheetnames,
  'maxFila': ws.max_row, 'maxCol': ws.max_column,
  'cuadricula': ws.sheet_view.showGridLines,
  'imagenes': len(ws._images),
  'ancla': [ws._images[0].anchor._from.col, ws._images[0].anchor._from.row] if ws._images else None,
  'tamLogo': [ws._images[0].width, ws._images[0].height] if ws._images else None,
  'combinadas': sorted(str(m) for m in ws.merged_cells.ranges),
  'pestana': col(ws.sheet_properties.tabColor),
  'anchos': {k: round(v.width, 1) for k, v in ws.column_dimensions.items()},
  'celdas': {},
}
for ref in ('A1','B2','B4','B5','B6','B7','B10','B11','B12','B14','B15','B17','B18','F18','B24','F24'):
    c = ws[ref]
    salida['celdas'][ref] = {
      'v': c.value, 'fuente': c.font.name, 'tam': c.font.sz, 'neg': bool(c.font.b),
      'color': col(c.font.color), 'relleno': col(c.fill.fgColor) if c.fill.fill_type else None,
      'formato': c.number_format,
    }
salida['filas'] = [[ws.cell(row=f, column=c).value for c in range(2, ws.max_column)] for f in range(18, 30)]
print(json.dumps(salida, ensure_ascii=False))
`
let leido: {
  hojas: string[]
  maxFila: number
  maxCol: number
  cuadricula: boolean
  imagenes: number
  ancla: [number, number] | null
  tamLogo: [number, number] | null
  combinadas: string[]
  pestana: string | null
  anchos: Record<string, number>
  celdas: Record<string, { v: unknown; fuente: string; tam: number; neg: boolean; color: string | null; relleno: string | null; formato: string }>
  filas: unknown[][]
} | null = null
try {
  leido = JSON.parse(execFileSync('python3', ['-I', '-c', PY, ruta], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  ok('el ZIP, el XML y openpyxl lo aceptan', true)
} catch (e) {
  const msg = String((e as { stderr?: string }).stderr ?? e)
  if (/No module named 'openpyxl'|ENOENT/.test(msg)) console.log('  (no hay python3 con openpyxl: se salta la lectura)')
  else ok('el ZIP, el XML y openpyxl lo aceptan', false, msg.split('\n').slice(-3).join(' | '))
}

if (leido) {
  const c = leido.celdas
  ok('una sola hoja, «Propuesta»', leido.hojas.join() === 'Propuesta')
  ok('lleva el logo', leido.imagenes === 1)
  ok('el logo está en la banda, a la izquierda (columna B, fila 3)', leido.ancla?.join() === '1,2', String(leido.ancla))
  ok('el logo conserva la proporción 1024:162', !!leido.tamLogo && Math.abs(leido.tamLogo[0] / leido.tamLogo[1] - 1024 / 162) < 0.2, String(leido.tamLogo))
  ok('pestaña naranja', leido.pestana === 'FFF26212', String(leido.pestana))
  ok('sin cuadrícula', leido.cuadricula === false)
  ok('la franja de arriba es naranja', c.A1.relleno === 'FFF26212', String(c.A1.relleno))
  ok('la banda es la oscura de la marca', c.B2.relleno === 'FF0E0E0E', String(c.B2.relleno))
  ok('el título es Sora, grande y blanco', c.B5.v === 'Qué vamos a enviar' && c.B5.fuente === 'Sora' && c.B5.tam === 20 && c.B5.neg && c.B5.color === 'FFFFFFFF', JSON.stringify(c.B5))
  ok('el cliente va en naranja', c.B6.v === 'ShoesF' && c.B6.color === 'FFF26212', JSON.stringify(c.B6))
  ok('el subtítulo cuenta referencias, unidades y fecha', String(c.B7.v) === '6 referencias · 28 unidades · Envío previsto: 22 de octubre de 2026', String(c.B7.v))
  ok('el kicker lleva el nombre de la propuesta', String(c.B4.v) === 'PROPUESTA DE ENVÍO A AMAZON · REPOSICIÓN DE OCTUBRE', String(c.B4.v))
  ok('el título de sección lleva el 01 y el rótulo en la misma celda', typeof c.B14.v === 'string' && c.B14.v.startsWith('01') && c.B14.v.includes('LO QUE VAMOS A ENVIAR'), JSON.stringify(c.B14.v))
  ok('las tarjetas son crema', c.B11.relleno === 'FFF7F5F2' && c.B11.v === '6', JSON.stringify(c.B11))
  ok('la cabecera de la tabla es oscura y con Sora', c.B17.relleno === 'FF0E0E0E' && c.B17.fuente === 'Sora' && c.B17.v === 'Referencia', JSON.stringify(c.B17))
  ok('hay 5 columnas con Referencia y Talla', leido.filas[0].length >= 5)

  // Orden: por referencia, producto y talla EN ORDEN NUMÉRICO (9 antes que 10 antes que 40)
  const datos = leido.filas.map((f) => ({ ref: f[0], producto: f[1], talla: f[2], sku: f[3], uds: f[4] }))
  const primeras = datos.slice(0, 6)
  ok(
    'las líneas sin referencia van primero (por nombre) y las de 3662 antes que las de 8412',
    primeras[0].sku === '=SUMA(A1:A9)' && primeras[1].sku === 'CONCONTROL' && primeras[2].ref === '3662' && primeras[3].ref === '8412',
    JSON.stringify(primeras.map((p) => [p.ref, p.sku]))
  )
  const ochoCuatro = datos.filter((d) => d.ref === '8412').map((d) => d.talla)
  ok('las tallas en orden numérico: 9, 10, 40', ochoCuatro.join() === '9,10,40', ochoCuatro.join())
  ok('la cantidad es un número, no un texto', datos.every((d) => d.ref === undefined || d.uds === null || typeof d.uds === 'number'))
  ok('el SKU con «=» sigue siendo texto', datos.some((d) => d.sku === '=SUMA(A1:A9)'))

  const filaTotal = leido.filas[6]
  ok('la fila del total está donde toca y suma 28', filaTotal[0] === 'TOTAL A ENVIAR' && filaTotal[4] === 28, JSON.stringify(filaTotal))
}

console.log('\n=== sin referencias ni tallas, la tabla se queda en tres columnas ===')
{
  const simple = excelDePropuesta({
    cliente: 'Cobo Family',
    nombre: null,
    fechaEnvio: '2026-10-22',
    nota: null,
    hoy: '2026-10-19',
    lineas: [
      { sku: 'CF-001', unidades: 10, referencia: null, nombre: 'Rompecabezas 1000 piezas', variante: null },
      { sku: 'CF-002', unidades: 5, referencia: null, nombre: 'Juego de mesa familiar', variante: null },
    ],
  })
  const p = unzipSync(simple.xlsx)
  const h = new TextDecoder().decode(p['xl/worksheets/sheet1.xml'])
  ok('sin «Referencia»', !new TextDecoder().decode(p['xl/worksheets/sheet1.xml']).includes('>Referencia<'))
  ok('sin columna de variante', !h.includes('>Variante<') && !h.includes('>Talla<'))
  ok('el total sale igualmente', simple.unidades === 15 && simple.lineas === 2)
  ok('sin nota no hay recuadro de nota', !h.includes('>NOTA<'))
  const e = excelDePropuesta({ ...BASE, lineas: [] })
  ok('una propuesta sin líneas no revienta', e.lineas === 0 && e.unidades === 0 && e.xlsx.byteLength > 1000)
}

if (leido) {
  // Para mirarlo a ojo: el fichero queda en una carpeta temporal y su ruta se imprime
  console.log(`\n  (para verlo: ${ruta})`)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
