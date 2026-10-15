import { aCsv, celda } from '@/lib/cumplimiento/exportar'
import { limpiarBusqueda } from '@/lib/cumplimiento/consulta'
import type { FilaCumplimiento, Incidencia } from '@/lib/cumplimiento/tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const inc = (extra: Partial<Incidencia> = {}): Incidencia => ({
  codigo: '90220',
  gravedad: 'error',
  mensaje: 'Falta el atributo «Fabricante».',
  atributos: ['manufacturer'],
  categorias: ['MISSING_ATTRIBUTE'],
  acciones: [],
  exencion: null,
  tema: 'datos',
  desde: '2026-09-01T08:00:00.000Z',
  ...extra,
})
const fila = (extra: Partial<FilaCumplimiento> = {}): FilaCumplimiento => ({
  sku: 'ABC-1',
  asin: 'B0TEST0001',
  titulo: 'Zapato de piel',
  marketplace_id: 'A1RKKUPIHCS9HS',
  estado: ['DISCOVERABLE'],
  en_amazon: true,
  errores: 1,
  avisos: 0,
  suprimido: false,
  tema: 'datos',
  temas: ['datos'],
  desde: '2026-09-01T08:00:00.000Z',
  incidencias: [inc()],
  con_stock: true,
  es_padre: false,
  revisado_at: '2026-10-15T09:00:00.000Z',
  ...extra,
})
const pais = (id: string) => (id === 'A1RKKUPIHCS9HS' ? 'España' : id)

console.log('\n=== las celdas ===')
ok('texto normal', celda('hola') === 'hola')
ok('null y undefined son vacío', celda(null) === '' && celda(undefined) === '')
ok('número', celda(12) === '12')
ok('un punto y coma obliga a comillas', celda('a;b') === '"a;b"')
ok('las comillas se duplican', celda('di "hola"') === '"di ""hola"""')
ok('un salto de línea obliga a comillas', celda('a\nb') === '"a\nb"')
ok('una fórmula se neutraliza (=)', celda('=1+1') === "'=1+1")
ok('una fórmula se neutraliza (+)', celda('+34600') === "'+34600")
ok('una fórmula se neutraliza (@)', celda('@SUMA(A1)') === "'@SUMA(A1)")
ok('un guion seguido de letra se neutraliza', celda('-cmd|calc') === "'-cmd|calc")
ok('un número negativo NO se toca', celda('-5') === '-5' && celda('-0,5') === '-0,5')
ok('un SKU con guion en medio no se toca', celda('ABC-1') === 'ABC-1')

console.log('\n=== el fichero ===')
{
  const csv = aCsv([fila()], pais)
  const l = csv.split('\r\n')
  ok('cabecera + una fila', l.length === 2, String(l.length))
  ok('15 columnas', l[0].split(';').length === 15)
  ok('empieza por SKU y acaba por Revisado', l[0].startsWith('SKU;ASIN;') && l[0].endsWith(';Revisado'))
  const c = l[1].split(';')
  ok('SKU y ASIN', c[0] === 'ABC-1' && c[1] === 'B0TEST0001')
  ok('país con nombre', c[3] === 'España', c[3])
  ok('estado legible', c[4] === 'Visible, no comprable', c[4])
  ok('stock en español', c[5] === 'Sí')
  ok('gravedad y tema', c[6] === 'Error' && c[7] === 'Datos', `${c[6]} ${c[7]}`)
  ok('código y mensaje', c[8] === '90220' && c[9] === 'Falta el atributo «Fabricante».')
  ok('fechas solo con el día', c[13] === '2026-09-01' && c[14] === '2026-10-15', `${c[13]} ${c[14]}`)
}

console.log('\n=== una fila por incidencia ===')
{
  const f = fila({
    incidencias: [
      inc({ codigo: '1', acciones: ['SEARCH_SUPPRESSED'], tema: 'identificadores', atributos: ['gtin', 'brand'] }),
      inc({ codigo: '2', gravedad: 'aviso', tema: 'imagenes' }),
      inc({ codigo: '3', gravedad: 'info', tema: 'otros' }),
    ],
  })
  const l = aCsv([f], pais).split('\r\n')
  ok('tres incidencias, tres filas', l.length === 4)
  ok('el SKU se repite', l.slice(1).every((x) => x.startsWith('ABC-1;')))
  ok('la acción de Amazon va en español', l[1].includes('Oculto en las búsquedas'))
  ok('varios atributos juntos', l[1].includes('gtin, brand'))
  ok('sugerencia', l[3].split(';')[6] === 'Sugerencia')
  ok('un listing sin incidencias no sale', aCsv([fila({ incidencias: [] })], pais).split('\r\n').length === 1)
}

console.log('\n=== el plazo de gracia ===')
{
  const l = aCsv([fila({ incidencias: [inc({ exencion: { estado: 'EXEMPT_UNTIL_EXPIRY_DATE', caduca: '2026-12-01T00:00:00Z' } })] })], pais).split('\r\n')
  ok('sale la fecha en que caduca', l[1].split(';')[12] === '2026-12-01', l[1].split(';')[12])
  const l2 = aCsv([fila({ incidencias: [inc({ exencion: { estado: 'EXEMPT', caduca: null } })] })], pais).split('\r\n')
  ok('una exención sin fecha no pone fecha', l2[1].split(';')[12] === '')
}

console.log('\n=== lo raro no rompe el CSV ===')
{
  const l = aCsv([fila({ titulo: 'Zapato; "premium"\nnuevo', sku: '=HYPERLINK("x")' })], pais)
  ok('título con ; comillas y salto queda entre comillas', l.includes('"Zapato; ""premium""\nnuevo"'))
  ok('un SKU que parece fórmula se neutraliza', l.includes(`"'=HYPERLINK(""x"")"`) || l.includes(`'=HYPERLINK`), l.split('\r\n')[1].slice(0, 40))
  ok('un país desconocido sale con su código', aCsv([fila({ marketplace_id: 'XXXXXXXXXX' })], pais).includes(';XXXXXXXXXX;'))
}

console.log('\n=== la búsqueda ===')
ok('quita comas y paréntesis', limpiarBusqueda('a,b(c)') === 'a b c')
ok('quita comodines', limpiarBusqueda('50%*') === '50')
ok('quita comillas', limpiarBusqueda(`o'neil "x"`) === 'o neil x')
ok('el guion bajo se queda', limpiarBusqueda('ABC_123') === 'ABC_123')
ok('colapsa espacios', limpiarBusqueda('  a    b ') === 'a b')
ok('recorta a 80', limpiarBusqueda('x'.repeat(200)).length === 80)

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
