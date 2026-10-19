import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { excelDeAntiguedad } from '@/lib/fba/antiguedad-excel'
import type { InventarioDeCliente, SkuInventario } from '@/lib/fba/inventario'
import { edadVacia, resumirEdadAmazon, type FilaPlanificacion } from '@/lib/fba/planificacion'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL EXCEL DE LA ANTIGÜEDAD, ABIERTO DE VUELTA.
 *
 * Igual que el de la propuesta: no basta con que el ZIP se genere. Se comprueba el paquete, que
 * cada pieza XML esté bien formada y que openpyxl —otro lector— vea lo que hemos escrito: las dos
 * hojas, el filtro, la cabecera congelada, el orden de los tramos y que lo de Amazon que parezca
 * una fórmula siga siendo texto.
 */

function sku(sobre: Partial<SkuInventario> & { sku: string }): SkuInventario {
  const base: SkuInventario = {
    sku: sobre.sku,
    asin: null,
    fnsku: null,
    nombre: `Producto ${sobre.sku}`,
    precio: 20,
    moneda: 'EUR',
    enAmazon: 0,
    vendibles: 0,
    entrante: 0,
    noDisponibles: 0,
    vendidas: { d7: 0, d14: 0, d30: 0, d60: 0, d90: 0 },
    devueltas: { d30: 0, d90: 0 },
    tasaDevolucion90: null,
    ritmo7: 0,
    ritmo30: 0,
    ritmo90: 0,
    ritmoPlan: 0,
    tendencia: null,
    muestraCorta: false,
    serie90: null,
    ultimaVenta: null,
    diasSinVenta: null,
    primeraEntrada: null,
    lotes: [],
    edadMediaDias: null,
    edadMaxDias: null,
    porTramo: { t0: 0, t91: 0, t181: 0, t271: 0, t366: 0 },
    anteriorALaLectura: 0,
    diasMedioDeVenta: null,
    retiradas: 0,
    mermas: 0,
    descuadre: 0,
    cobertura: null,
    seAgotaEl: null,
    valorStock: null,
    valorVentas30: null,
    estado: 'ok',
    alertas: [],
  }
  return { ...base, ...sobre }
}

function cliente(skus: SkuInventario[], sobre: Partial<InventarioDeCliente> = {}): InventarioDeCliente {
  return {
    hoy: '2026-10-19',
    leidoHasta: '2026-10-19',
    libroDesde: '2026-07-02',
    diasDeLibro: 109,
    libro: 'ok',
    skus,
    resumen: {
      unidadesEnAmazon: 0, vendibles: 0, entrante: 0, noDisponibles: 0, valorStock: 0, sinPrecio: 0, vendidas30: 0, valorVentas30: 0, ritmo30: 0, coberturaMedia: null,
      vendidas90: 0, devueltas90: 0, tasaDevolucion90: null, referencias: skus.length, agotadas: 0, urgentes: 0, paradas: 0, paradasUnidades: 0, paradasValor: 0, exceso: 0,
      edadMediaDias: null,
      porTramo: { t0: 16, t91: 0, t181: 0, t271: 0, t366: 0 },
      valorPorTramo: { t0: 416, t91: 0, t181: 0, t271: 0, t366: 0 },
      anteriorALaLectura: 8, unidadesAntiguas: 0, conNoVendibles: 0, enviosEnCamino: 0,
    },
    porDia: [],
    avisos: [],
    conectado: true,
    marketplaceId: 'A1RKKUPIHCS9HS',
    conexionId: 'c1',
    lectura: null,
    edadAmazon: null,
    planificacion: { tabla: true, leidoAt: null, error: null },
    ...sobre,
  }
}

const fila = (s: string, edad: Partial<ReturnType<typeof edadVacia>>, costeMes: number | null, recargo: Partial<ReturnType<typeof edadVacia>> = {}): FilaPlanificacion => ({
  sku: s,
  fnsku: null,
  asin: null,
  disponible: Object.values(edad).reduce((a, b) => a + (b ?? 0), 0),
  noVendible: 0,
  edad: { ...edadVacia(), ...edad },
  costeMes,
  recargo: { ...edadVacia(), ...recargo },
  moneda: 'EUR',
  diasSuministro: null,
  accion: null,
})

// Cobo Family, como lo enseña Seller Central: tres referencias con una unidad de más de 90 días
const skusAmazon = [
  sku({ sku: '4036R NEGRO 40 FBA', nombre: 'Zapatillas de Casa Hombre Verano Primavera, Zapatos Cómodas Rejilla Cuña Multicolor, Suela Caucho Talla 39-46 Made In Spain', asin: 'B0CZP6XZKV', precio: 29.99, enAmazon: 3, ritmoPlan: 0, ultimaVenta: '2026-08-25' }),
  sku({ sku: '410 REJILLA NEGRO/39 FBA', nombre: 'Zapatillas de Casa Hombre | Calzado Transpirable de Rejilla', asin: 'B0B2Q6L9V1', precio: 26.99, enAmazon: 1, ritmoPlan: 0.02, ultimaVenta: '2026-09-20' }),
  sku({ sku: '4030 NEGRO 39 FBA', nombre: 'COZSERIES Zapatillas de Casa Hombre Cerradas', asin: 'B0CX5LX5MJ', precio: 27.99, enAmazon: 1, ritmoPlan: 0.02, ultimaVenta: '2026-09-29' }),
  sku({ sku: '725A MARINO/37 FBA', nombre: 'COZSERIES Zapatillas Casa Mujer', asin: 'B0AAAAAAAA', precio: 25, enAmazon: 18, ritmoPlan: 0.5, ultimaVenta: '2026-10-18' }),
  sku({ sku: '=SUMA(A1:A9)', nombre: '=HYPERLINK("http://x","clic") & <b>Tiburón</b>', asin: null, precio: null, enAmazon: 2 }),
]
const filasAmazon = [
  fila('4036R NEGRO 40 FBA', { a0: 2, a91: 1 }, 0.09),
  fila('410 REJILLA NEGRO/39 FBA', { a91: 1 }, 0.03),
  fila('4030 NEGRO 39 FBA', { a91: 1 }, 0.03),
  fila('725A MARINO/37 FBA', { a0: 18 }, 0.54),
  fila('=SUMA(A1:A9)', { a181: 2 }, 0.6, { a181: 0.4 }),
]
const eaAmazon = resumirEdadAmazon({ filas: filasAmazon, fecha: '2026-10-16', precios: new Map(skusAmazon.map((k) => [k.sku, k.precio] as const)) })
for (const k of skusAmazon) k.edadAmazon = eaAmazon.porSku[k.sku] ?? null
const conAmazon = cliente(skusAmazon, { edadAmazon: eaAmazon })

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
def col(c):
    return None if c is None or c.type != 'rgb' else c.rgb
out = {'hojas': wb.sheetnames}
for nombre in wb.sheetnames:
    ws = wb[nombre]
    celdas = {}
    for ref in ('A1','B2','B4','B5','B6','B7','C17','C18','C19','B18','B20'):
        c = ws[ref]
        celdas[ref] = {'v': c.value, 'fuente': c.font.name, 'tam': c.font.sz, 'neg': bool(c.font.b), 'color': col(c.font.color), 'relleno': col(c.fill.fgColor) if c.fill.fill_type else None, 'formato': c.number_format}
    out[nombre] = {
        'maxFila': ws.max_row, 'maxCol': ws.max_column,
        'cuadricula': ws.sheet_view.showGridLines,
        'congelar': ws.freeze_panes,
        'filtro': ws.auto_filter.ref,
        'imagenes': len(ws._images),
        'combinadas': len(ws.merged_cells.ranges),
        'pestana': col(ws.sheet_properties.tabColor),
        'celdas': celdas,
        'filas': [[ws.cell(row=f, column=c).value for c in range(2, ws.max_column)] for f in range(1, ws.max_row + 1)],
    }
print(json.dumps(out, ensure_ascii=False, default=str))
`
type Hoja = { maxFila: number; maxCol: number; cuadricula: boolean; congelar: string | null; filtro: string | null; imagenes: number; combinadas: number; pestana: string | null; celdas: Record<string, { v: unknown; fuente: string; tam: number; neg: boolean; color: string | null; relleno: string | null; formato: string }>; filas: unknown[][] }
type Leido = { hojas: string[] } & Record<string, Hoja | string[]>

function abrir(xlsx: Uint8Array, nombre: string): Leido | null {
  const carpeta = mkdtempSync(join(tmpdir(), 'antiguedad-excel-'))
  const ruta = join(carpeta, nombre)
  writeFileSync(ruta, xlsx)
  try {
    const l = JSON.parse(execFileSync('python3', ['-I', '-c', PY, ruta], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as Leido
    console.log(`  (para verlo: ${ruta})`)
    return l
  } catch (e) {
    const msg = String((e as { stderr?: string }).stderr ?? e)
    if (/No module named 'openpyxl'|ENOENT/.test(msg)) {
      console.log('  (no hay python3 con openpyxl: se salta la lectura)')
      return null
    }
    ok('el ZIP, el XML y openpyxl lo aceptan', false, msg.split('\n').slice(-3).join(' | '))
    return null
  }
}

console.log('\n=== todos los tramos, con la antigüedad de Amazon ===')
const todo = excelDeAntiguedad({ cliente: 'Cobo Family', inventario: conAmazon, tramo: null, hoy: '2026-10-19' })
ok('una fila por producto y tramo: 4036R sale en dos tramos, y son 6', todo.filas === 6, String(todo.filas))
ok('suman las unidades del informe: 3 + 1 + 1 + 18 + 2 = 25', todo.unidades === 25, String(todo.unidades))
ok('el nombre del fichero es ASCII, con el cliente y el día', todo.nombreFichero === 'antiguedad-stock-cobo-family-2026-10-19.xlsx', todo.nombreFichero)

const paquete = unzipSync(todo.xlsx)
const partes = Object.keys(paquete).sort()
ok('lleva las dos hojas', partes.includes('xl/worksheets/sheet1.xml') && partes.includes('xl/worksheets/sheet2.xml'))
ok('el logo va en la primera hoja', partes.includes('xl/media/image1.png') && partes.includes('xl/drawings/drawing1.xml') && !partes.includes('xl/drawings/drawing2.xml'))
const hoja2 = new TextDecoder().decode(paquete['xl/worksheets/sheet2.xml'])
ok('sin fórmulas: todo son valores', !/<f[ >]/.test(hoja2) && !/<f[ >]/.test(new TextDecoder().decode(paquete['xl/worksheets/sheet1.xml'])))
ok('lo que parece una fórmula es texto', /t="inlineStr"><is><t xml:space="preserve">=SUMA\(A1:A9\)</.test(hoja2))
ok('y el HTML y las comillas del nombre van escapados', hoja2.includes('&lt;b&gt;Tiburón&lt;/b&gt;') && hoja2.includes('&quot;http://x&quot;'))
ok('la cabecera está congelada y la tabla lleva filtro', /<pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"\/>/.test(hoja2) && /<autoFilter ref="C5:L11"\/>/.test(hoja2), (/<autoFilter[^>]*>/.exec(hoja2) ?? [''])[0])
ok('apaisada: la tabla es ancha', hoja2.includes('orientation="landscape"'))

const l = abrir(todo.xlsx, 'todo.xlsx')
if (l) {
  ok('las dos hojas, Resumen y Productos', l.hojas.join() === 'Resumen,Productos')
  const r = l.Resumen as Hoja
  const p = l.Productos as Hoja
  ok('el resumen lleva el logo y la banda oscura', r.imagenes === 1 && r.celdas.B2.relleno === 'FF0E0E0E' && r.celdas.A1.relleno === 'FFF26212', JSON.stringify(r.celdas.B2))
  ok('sin cuadrícula y con la pestaña naranja', r.cuadricula === false && p.cuadricula === false && r.pestana === 'FFF26212' && p.pestana === 'FFF26212')
  ok('el título es Sora y el cliente va en naranja', r.celdas.B5.v === 'Cuánto lleva el stock' && r.celdas.B5.fuente === 'Sora' && r.celdas.B5.neg && r.celdas.B6.v === 'Cobo Family' && r.celdas.B6.color === 'FFF26212', JSON.stringify([r.celdas.B5, r.celdas.B6]))
  ok('el rótulo de arriba es naranja y dice qué es', r.celdas.B4.v === 'ANTIGÜEDAD DEL STOCK EN AMAZON' && r.celdas.B4.color === 'FFF26212', JSON.stringify(r.celdas.B4))
  ok('el subtítulo cuenta las unidades, las de más de 90 días y de dónde sale', String(r.celdas.B7.v) === '25 unidades · 5 de más de 90 días · Antigüedad según Amazon, foto del 16 de octubre de 2026', String(r.celdas.B7.v))
  ok('hay tres tarjetas (celdas combinadas)', r.combinadas >= 9, String(r.combinadas))
  const tramos = r.filas.filter((f) => typeof f[1] === 'string' && /^(0-60|61-90|91-180|181-330|331-365|366-455|Más de 455)/.test(String(f[1])))
  ok('la tabla tiene los siete tramos de Seller Central en su orden', tramos.map((f) => String(f[1])).join('|') === '0-60 días|61-90|91-180|181-330|331-365|366-455|Más de 455', tramos.map((f) => String(f[1])).join('|'))
  ok('con sus unidades: 20 · 0 · 3 · 2 · 0 · 0 · 0', tramos.map((f) => f[2]).join() === '20,0,3,2,0,0,0', tramos.map((f) => f[2]).join())
  const pct = r.filas.filter((f) => typeof f[1] === 'string' && /^(0-60|91-180|181-330)/.test(String(f[1]))).map((f) => f[3])
  ok('el porcentaje es una fracción (0,8 se ve «80 %»): 0,8 · 0,12 · 0,08', pct.join() === '0.8,0.12,0.08', pct.join())
  ok('con el formato de porcentaje de Excel', new TextDecoder().decode(paquete['xl/styles.xml']).includes('formatCode="0\\ %"'))
  const total = r.filas.find((f) => f[1] === 'TOTAL')
  ok('el total suma 25 y es un número', !!total && total[2] === 25, JSON.stringify(total))

  ok('la hoja de productos tiene la cabecera congelada en la fila 6 y el filtro puesto', p.congelar === 'A6' && p.filtro === 'C5:L11', `${p.congelar} ${p.filtro}`)
  const cab = p.filas[4]
  ok('las columnas: tramo, producto, SKU, ASIN, en este tramo, total, valor, almacenaje, ritmo y última venta', cab.slice(1, 11).join('|') === 'Tramo|Producto|SKU|ASIN|En este tramo|Total en Amazon|Valor del tramo|Almacenaje/mes|Ud/día|Última venta', cab.join('|'))
  const datos = p.filas.slice(5, 11).map((f) => ({ tramo: f[1], sku: f[3], uds: f[5], total: f[6], valor: f[7], coste: f[8] }))
  ok('de lo más antiguo a lo más reciente: 181-330, luego 91-180 y al final 0-60', datos.map((d) => d.tramo).join('|') === '181-330|91-180|91-180|91-180|0-60 días|0-60 días', datos.map((d) => d.tramo).join('|'))
  ok('dentro de un tramo, primero el que más unidades tiene', datos[4].sku === '725A MARINO/37 FBA' && datos[4].uds === 18 && datos[5].sku === '4036R NEGRO 40 FBA' && datos[5].uds === 2, JSON.stringify(datos.slice(4)))
  ok('las unidades son números y el valor es de ESE tramo (1 × 29,99)', datos.every((d) => typeof d.uds === 'number') && datos[1].sku === '4036R NEGRO 40 FBA' && datos[1].valor === 29.99, JSON.stringify(datos[1]))
  ok('el almacenaje de ese tramo es el que da Amazon: 0,09 / 3', datos[1].coste === 0.03, String(datos[1].coste))
  ok('el SKU con «=» sigue siendo texto', datos[0].sku === '=SUMA(A1:A9)')
  const totalP = p.filas.find((f) => String(f[2] ?? '').startsWith('TOTAL'))
  ok('el total de la hoja de productos está fuera del filtro (fila 13) y suma 25 unidades, 594,95 € y 1,29 €', !!totalP && p.filas.indexOf(totalP) === 12 && totalP[5] === 25 && totalP[7] === 594.95 && totalP[8] === 1.29, JSON.stringify(totalP))
}

console.log('\n=== un solo tramo ===')
{
  const uno = excelDeAntiguedad({ cliente: 'Cobo Family', inventario: conAmazon, tramo: 'a91', hoy: '2026-10-19' })
  ok('solo las tres referencias de 91-180 y sus tres unidades', uno.filas === 3 && uno.unidades === 3, `${uno.filas} filas, ${uno.unidades} uds`)
  ok('el fichero lo dice en el nombre', uno.nombreFichero === 'antiguedad-stock-cobo-family-2026-10-19-91-180.xlsx', uno.nombreFichero)
  const h = new TextDecoder().decode(unzipSync(uno.xlsx)['xl/worksheets/sheet2.xml'])
  ok('la hoja de productos solo trae ese tramo', !h.includes('0-60 días') && !h.includes('181-330') && h.includes('PRODUCTOS POR ANTIGÜEDAD'))
  const res = new TextDecoder().decode(unzipSync(uno.xlsx)['xl/worksheets/sheet1.xml'])
  ok('y el resumen lo nombra en el rótulo y sigue enseñando todos los tramos', res.includes('ANTIGÜEDAD DEL STOCK EN AMAZON · 91-180') && res.includes('0-60 días') && res.includes('Más de 455'))
  const desconocido = excelDeAntiguedad({ cliente: 'Cobo Family', inventario: conAmazon, tramo: 'zzz' as never, hoy: '2026-10-19' })
  ok('un tramo que no existe da el documento entero, no uno vacío', desconocido.filas === 6)
}

console.log('\n=== lo que parece un error y no lo es: el documento lo explica ===')
{
  // Como el Cobo real: la foto de Amazon (16/10) da 3 unidades en 0-60 días de A pero hoy consta que hay 2; B no tiene coste en el informe
  const A = sku({ sku: 'A VENDIDA', nombre: 'Producto A', precio: 10, enAmazon: 2, ultimaVenta: '2026-10-10', ritmoPlan: 0.1 })
  const B = sku({ sku: 'B SIN COSTE', nombre: 'Producto B', precio: 10, enAmazon: 2, ultimaVenta: null })
  const C = sku({ sku: 'C ANTIGUA', nombre: 'Producto C', precio: 10, enAmazon: 1, ultimaVenta: '2026-09-01', ritmoPlan: 0.02 })
  const filasD = [fila('A VENDIDA', { a0: 3 }, 0.27), fila('B SIN COSTE', { a0: 2 }, null), fila('C ANTIGUA', { a91: 1 }, 0.09)]
  const ea = resumirEdadAmazon({ filas: filasD, fecha: '2026-10-16', precios: new Map([A, B, C].map((k) => [k.sku, k.precio] as const)) })
  for (const k of [A, B, C]) k.edadAmazon = ea.porSku[k.sku] ?? null
  const inv = cliente([A, B, C], { edadAmazon: ea })
  const d = excelDeAntiguedad({ cliente: 'Cobo Family', inventario: inv, tramo: null, hoy: '2026-10-19' })
  ok('salen las tres filas y sus seis unidades', d.filas === 3 && d.unidades === 6, `${d.filas} / ${d.unidades}`)
  const pk = unzipSync(d.xlsx)
  const r1 = new TextDecoder().decode(pk['xl/worksheets/sheet1.xml'])
  const r2 = new TextDecoder().decode(pk['xl/worksheets/sheet2.xml'])
  ok('el resumen cuenta cuántos productos no tienen almacenaje de Amazon', r1.includes('Amazon no calcula el almacenaje de 1 producto: en la hoja Productos salen con «—»'))
  ok('la hoja de productos avisa de la foto: «Total en Amazon» es lo de ahora', r2.includes('foto de Amazon del 16 de octubre de 2026') && r2.includes('«Total en Amazon» es lo que consta ahora'))
  ok('avisa de la «—» y de «sin ventas», con el día en que empieza el libro', r2.includes('«—» en Almacenaje/mes') && r2.includes('«Sin ventas»: no hay ninguna venta registrada desde el 2 de julio de 2026, que es cuando empieza el libro mayor.'))
  ok('ya no dice «nunca»', !r2.includes('>nunca<') && r2.includes('sin ventas'))

  const dd = abrir(d.xlsx, 'explicado.xlsx')
  if (dd) {
    const p = dd.Productos as Hoja
    const filaB = p.filas.find((f) => f[3] === 'B SIN COSTE')
    const filaA = p.filas.find((f) => f[3] === 'A VENDIDA')
    ok('el producto sin coste lleva «—», no una celda vacía', !!filaB && filaB[8] === '—', JSON.stringify(filaB))
    ok('el que sí lo tiene sigue siendo un número: 0,27', !!filaA && filaA[8] === 0.27, JSON.stringify(filaA))
    ok('el total de almacenaje solo suma lo que Amazon calculó: 0,27 + 0,09', p.filas.some((f) => String(f[2] ?? '').startsWith('TOTAL') && f[8] === 0.36), JSON.stringify(p.filas.find((f) => String(f[2] ?? '').startsWith('TOTAL'))))
    ok('las unidades siguen siendo las de Amazon: 3 + 2 + 1', p.filas.filter((f) => ['A VENDIDA', 'B SIN COSTE', 'C ANTIGUA'].includes(String(f[3]))).map((f) => f[5]).join() === '1,3,2', p.filas.filter((f) => ['A VENDIDA', 'B SIN COSTE', 'C ANTIGUA'].includes(String(f[3]))).map((f) => f[5]).join())
    const pie = p.filas.findIndex((f) => String(f[0] ?? '').startsWith('Liberty Seller'))
    const notaFila = p.filas.findIndex((f) => String(f[1] ?? '').startsWith('A TENER EN CUENTA'))
    const totalFila = p.filas.findIndex((f) => String(f[2] ?? '').startsWith('TOTAL'))
    ok('la nota va debajo del total, fuera del filtro, y el pie al final', totalFila > 0 && notaFila > totalFila && pie > notaFila, `${totalFila} < ${notaFila} < ${pie}`)
    ok('el filtro llega hasta la última fila de productos, no a la nota', /^C5:L8$/.test(String(p.filtro)), String(p.filtro))
  }

  // Si se pide solo el tramo de C, que no tiene ninguno de los tres casos, no hay nada que avisar
  const solo = excelDeAntiguedad({ cliente: 'Cobo Family', inventario: inv, tramo: 'a91', hoy: '2026-10-19' })
  const h = new TextDecoder().decode(unzipSync(solo.xlsx)['xl/worksheets/sheet2.xml'])
  ok('un tramo sin esos casos no lleva notas de más', solo.filas === 1 && !h.includes('A TENER EN CUENTA') && !h.includes('consta ahora') && !h.includes('Sin ventas') && !h.includes('«—»'))
  // y en el documento de siempre (todo cuadra, salvo el producto raro que nunca ha vendido) solo sale lo de las ventas
  const base = new TextDecoder().decode(unzipSync(todo.xlsx)['xl/worksheets/sheet2.xml'])
  ok('cuando todo cuadra no se avisa de la foto ni de la «—»', !base.includes('consta ahora') && !base.includes('«—» en Almacenaje'))
}

console.log('\n=== con la edad estimada del libro ===')
{
  const skus = [
    sku({ sku: 'A', nombre: 'Producto A', porTramo: { t0: 10, t91: 0, t181: 0, t271: 0, t366: 0 }, enAmazon: 10, precio: 10 }),
    sku({ sku: 'B', nombre: 'Producto B', porTramo: { t0: 6, t91: 0, t181: 0, t271: 0, t366: 0 }, anteriorALaLectura: 5, enAmazon: 11, precio: 10 }),
    sku({ sku: 'C', nombre: 'Producto C', anteriorALaLectura: 3, enAmazon: 3, precio: 10 }),
  ]
  const libro = excelDeAntiguedad({ cliente: 'Yo By Yolanda', inventario: cliente(skus), tramo: null, hoy: '2026-10-19' })
  ok('lista lo que tiene unidades en cada tramo: A y B en 0-90 y B y C en «anterior al libro»', libro.filas === 4 && libro.unidades === 24, `${libro.filas} / ${libro.unidades}`)
  const p = unzipSync(libro.xlsx)
  const h1 = new TextDecoder().decode(p['xl/worksheets/sheet1.xml'])
  const h2 = new TextDecoder().decode(p['xl/worksheets/sheet2.xml'])
  ok('lo dice: es una estimación y las anteriores al libro, que su edad es esa o más', h1.includes('esta es una estimación con el libro mayor') && h1.includes('«Anterior al libro» son unidades'))
  ok('sin coste de Amazon no hay columna de almacenaje', !h2.includes('>Almacenaje/mes<') && !h1.includes('>Almacenaje/mes<'))
  ok('las de «anterior al libro» salen primero: pueden ser las más antiguas', h2.indexOf('Anterior al libro') > 0 && h2.indexOf('Anterior al libro') < h2.indexOf('0-90 días'))
}

console.log('\n=== sin nada que enseñar ===')
{
  const vacio = excelDeAntiguedad({ cliente: 'Nadie', inventario: cliente([], { resumen: { ...conAmazon.resumen, porTramo: { t0: 0, t91: 0, t181: 0, t271: 0, t366: 0 }, anteriorALaLectura: 0 } }), tramo: null, hoy: '2026-10-19' })
  ok('un cliente sin stock no revienta: documento válido con cero filas', vacio.filas === 0 && vacio.unidades === 0 && vacio.xlsx.byteLength > 1000)
  const h = new TextDecoder().decode(unzipSync(vacio.xlsx)['xl/worksheets/sheet2.xml'])
  ok('y el filtro no se sale de la cabecera', /<autoFilter ref="C5:[A-Z]5"\/>/.test(h), (/<autoFilter[^>]*>/.exec(h) ?? [''])[0])
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
