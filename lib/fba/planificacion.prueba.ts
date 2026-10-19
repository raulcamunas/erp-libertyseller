import {
  TRAMOS_AMAZON,
  aDia,
  edadVacia,
  entero,
  numero,
  parsearPlanificacion,
  repartoDeCoste,
  resumirEdadAmazon,
  tramoMasAntiguo,
  unidadesDeMasDe90,
  unidadesEnTotal,
  type FilaPlanificacion,
} from '@/lib/fba/planificacion'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const cerca = (a: number | null, b: number, tol = 0.005) => a !== null && Math.abs(a - b) <= tol

/**
 * EL INFORME DE PLANIFICACIÓN DE AMAZON: LEERLO Y REPARTIRLO.
 *
 * Las cabeceras son las de la documentación de Amazon para España. Los datos imitan los que
 * enseña Seller Central de Cobo Family: tres referencias con unidades de más de 90 días.
 */

const CABECERA = [
  'snapshot-date', 'sku', 'fnsku', 'asin', 'product-name', 'condition', 'available', 'pending-removal-quantity', 'unfulfillable-quantity',
  'inv-age-0-to-30-days', 'inv-age-31-to-60-days', 'inv-age-61-to-90-days', 'inv-age-91-to-180-days', 'inv-age-181-to-330-days',
  'inv-age-331-to-365-days', 'inv-age-366-to-455-days', 'inv-age-456-plus-days', 'currency', 'estimated-storage-cost-next-month',
  'estimated-ais-181-210-days', 'estimated-ais-211-240-days', 'estimated-ais-331-365-days', 'estimated-ais-366-455-days', 'estimated-ais-456-plus-days',
  'days-of-supply', 'recommended-action', 'Inventory age snapshot date',
]
const fila = (v: Record<string, string | number>) => CABECERA.map((c) => String(v[c] ?? '')).join('\t')
const informe = (...filas: Array<Record<string, string | number>>) => [CABECERA.join('\t'), ...filas.map(fila)].join('\n')

const base = { 'snapshot-date': '2026-10-19', currency: 'EUR', condition: 'New', 'Inventory age snapshot date': '2026-10-18' }
const filas = [
  { ...base, sku: '4036R NEGRO 40 FBA', fnsku: 'X00203FEEP', asin: 'B0CZP6XZKV', available: 3, 'inv-age-0-to-30-days': 1, 'inv-age-31-to-60-days': 1, 'inv-age-61-to-90-days': 0, 'inv-age-91-to-180-days': 1, 'estimated-storage-cost-next-month': '0.09', 'days-of-supply': 152, 'recommended-action': 'No action required' },
  { ...base, sku: '410 REJILLA NEGRO/39 FBA', fnsku: 'X001KSL909', asin: 'B0B2Q6L9V1', available: 1, 'inv-age-91-to-180-days': 1, 'estimated-storage-cost-next-month': '0.03' },
  { ...base, sku: '4030 NEGRO 39 FBA', fnsku: 'X001ZXIP65', asin: 'B0CX5LX5MJ', available: 1, 'inv-age-91-to-180-days': 1, 'estimated-storage-cost-next-month': '0.03' },
  { ...base, sku: '725A MARINO/37 FBA', available: 2, 'unfulfillable-quantity': 1, 'inv-age-0-to-30-days': 2, 'estimated-storage-cost-next-month': '0.06' },
  { ...base, sku: 'CON RECARGO', available: 3, 'inv-age-0-to-30-days': 1, 'inv-age-181-to-330-days': 2, 'estimated-storage-cost-next-month': '1.00', 'estimated-ais-181-210-days': '0.40' },
]

console.log('\n=== leer números y días, venga como venga ===')
{
  ok('«0.05» y «0,05» son 0,05', numero('0.05') === 0.05 && numero('0,05') === 0.05)
  ok('«1.234,56» y «1,234.56» son lo mismo', numero('1.234,56') === 1234.56 && numero('1,234.56') === 1234.56)
  ok('«1,234» con cifras de millares es 1234', numero('1,234') === 1234)
  ok('con moneda y espacios: «€ 12,50»', numero('€ 12,50') === 12.5)
  ok('vacío o un guion: null', numero('') === null && numero('-') === null && numero(undefined) === null)
  ok('entre comillas: «"3.5"»', numero('"3.5"') === 3.5)
  ok('unidades: «1.234» son mil doscientas treinta y cuatro', entero('1.234') === 1234 && entero('') === 0 && entero('7') === 7 && entero('abc') === 0)
  ok('días: ISO y a la española', aDia('2026-10-19') === '2026-10-19' && aDia('19/10/2026') === '2026-10-19' && aDia('2026-10-19T00:00:00Z') === '2026-10-19' && aDia('5/3/2026') === '2026-03-05')
  ok('un día que no se entiende: null', aDia('ayer') === null && aDia('') === null)
}

console.log('\n=== el informe de España ===')
{
  const r = parsearPlanificacion(informe(...filas))
  ok('lee las cinco referencias', r.filas.length === 5, String(r.filas.length))
  ok('la foto de la antigüedad es la del 18/10', r.fecha === '2026-10-18', String(r.fecha))
  ok('reconoce las ocho columnas de antigüedad finas', r.columnasEdad.length === 8, r.columnasEdad.join())
  ok('y no es aproximado', r.aproximada === false)
  const a = r.filas.find((f) => f.sku === '4036R NEGRO 40 FBA')!
  ok('4036R NEGRO 40: 2 de 0-60, 1 de 91-180 —lo que enseña Seller Central—', a.edad.a0 === 2 && a.edad.a61 === 0 && a.edad.a91 === 1 && unidadesEnTotal(a.edad) === 3, JSON.stringify(a.edad))
  ok('lleva su FNSKU, su ASIN y la acción recomendada', a.fnsku === 'X00203FEEP' && a.asin === 'B0CZP6XZKV' && a.accion === 'No action required')
  ok('los días de suministro y la moneda', a.diasSuministro === 152 && a.moneda === 'EUR')
  ok('lo que Amazon calcula de coste', cerca(a.costeMes, 0.09))
  const antiguas = r.filas.filter((f) => unidadesDeMasDe90(f.edad) > 0).map((f) => f.sku).sort()
  ok('con unidades de más de 90 días: las tres de Seller Central y la del recargo', antiguas.join('|') === '4030 NEGRO 39 FBA|4036R NEGRO 40 FBA|410 REJILLA NEGRO/39 FBA|CON RECARGO', antiguas.join('|'))
  const n = r.filas.find((f) => f.sku === '725A MARINO/37 FBA')!
  ok('las no vendibles se cuentan aparte', n.disponible === 2 && n.noVendible === 1)
  const c = r.filas.find((f) => f.sku === 'CON RECARGO')!
  ok('el recargo por antigüedad cae en su tramo', cerca(c.recargo.a181, 0.4) && c.recargo.a0 === 0)
}

console.log('\n=== el informe que no se parece ===')
{
  let msg = ''
  try {
    parsearPlanificacion('foo\tbar\tbaz\n1\t2\t3')
  } catch (e) {
    msg = (e as Error).message
  }
  ok('sin SKU ni antigüedad, no se inventa nada: se dice qué ha traído', /no trae las columnas esperadas/.test(msg) && msg.includes('foo, bar, baz'), msg)
  let sinEdad = ''
  try {
    parsearPlanificacion('sku\tavailable\nA\t1')
  } catch (e) {
    sinEdad = (e as Error).message
  }
  ok('con SKU pero sin ninguna columna de antigüedad, tampoco', /no trae las columnas esperadas/.test(sinEdad))
  ok('vacío: nada, y sin error', parsearPlanificacion('').filas.length === 0 && parsearPlanificacion('\n\n').filas.length === 0)
  ok('solo la cabecera: ninguna fila', parsearPlanificacion(CABECERA.join('\t')).filas.length === 0)
  const sinSku = parsearPlanificacion(informe(...filas, { ...base, available: 4, 'inv-age-0-to-30-days': 4 }))
  ok('una fila sin SKU se descarta y se cuenta', sinSku.filas.length === 5 && sinSku.descartadas === 1)
}

console.log('\n=== formatos de otros mercados ===')
{
  const viejo = ['sku\tavailable\tinv-age-0-to-90-days\tinv-age-91-to-180-days\tinv-age-181-to-270-days\tinv-age-271-to-365-days\tinv-age-365-plus-days', 'A\t10\t5\t2\t1\t1\t1'].join('\n')
  const r = parsearPlanificacion(viejo)
  const e = r.filas[0].edad
  ok('con los tramos de antes se lee, y se avisa de que es aproximado', r.aproximada === true && r.filas.length === 1)
  ok('0-90 va al primer tramo, 181-270 al de 181-330, 271-365 al de 331-365 y 365+ al de 366-455', e.a0 === 5 && e.a91 === 2 && e.a181 === 1 && e.a331 === 1 && e.a366 === 1, JSON.stringify(e))
  const mezcla = parsearPlanificacion(informe(...filas).replace('inv-age-181-to-330-days', 'inv-age-181-to-270-days'))
  ok('si faltan las finas de un tramo pero hay las otras, las que están se usan', mezcla.filas.length === 5)
}

console.log('\n=== comillas, comas y filas repetidas ===')
{
  const coma = ['"sku","inv-age-0-to-30-days","inv-age-91-to-180-days","available"', '"A B","2","1","3"'].join('\n')
  const r = parsearPlanificacion(coma)
  ok('separado por comas y entre comillas también se lee', r.filas[0]?.sku === 'A B' && r.filas[0].edad.a0 === 2 && r.filas[0].edad.a91 === 1)
  const dup = parsearPlanificacion(informe({ ...base, sku: 'X', available: 1, 'inv-age-0-to-30-days': 1, 'estimated-storage-cost-next-month': '0.10' }, { ...base, sku: 'X', available: 2, 'inv-age-91-to-180-days': 2, 'estimated-storage-cost-next-month': '0.20' }))
  ok('el mismo SKU en dos filas se suma en una', dup.filas.length === 1 && dup.filas[0].edad.a0 === 1 && dup.filas[0].edad.a91 === 2 && dup.filas[0].disponible === 3 && cerca(dup.filas[0].costeMes, 0.3))
  const mayus = parsearPlanificacion(informe(...filas).replace('snapshot-date', 'Snapshot-Date').replace('inv-age-91-to-180-days', 'Inv_Age_91_to_180_days'))
  ok('las mayúsculas y los guiones bajos en la cabecera no la rompen', mayus.filas.find((f) => f.sku === '4030 NEGRO 39 FBA')?.edad.a91 === 1)
}

console.log('\n=== repartir lo que cuesta ===')
{
  const r = parsearPlanificacion(informe(...filas))
  const c = r.filas.find((f) => f.sku === 'CON RECARGO')!
  const rep = repartoDeCoste(c)!
  ok('lo que no es recargo se reparte por unidades: 0,60 entre 3 = 0,20 por unidad', cerca(rep.a0, 0.2) && cerca(rep.a181, 0.2 * 2 + 0.4), JSON.stringify(rep))
  ok('y la suma es exactamente lo que dice Amazon', cerca(TRAMOS_AMAZON.reduce((s, t) => s + rep[t.id], 0), 1.0, 1e-9))
  const sinCoste = repartoDeCoste({ ...c, costeMes: null })
  ok('sin coste en el informe, no se reparte nada', sinCoste === null)
  const incoherente = repartoDeCoste({ ...c, costeMes: 0.3 })!
  ok('si el recargo declarado pasa del coste total, se reparte por unidades y no se afirma nada del recargo', cerca(incoherente.a0, 0.1) && cerca(incoherente.a181, 0.2), JSON.stringify(incoherente))
  const vacia: FilaPlanificacion = { ...c, edad: edadVacia(), costeMes: 0.5 }
  ok('sin unidades con edad, nada que repartir', TRAMOS_AMAZON.every((t) => repartoDeCoste(vacia)![t.id] === 0))
}

console.log('\n=== el resumen del cliente ===')
{
  const r = parsearPlanificacion(informe(...filas))
  const precios = new Map<string, number | null>([['4036R NEGRO 40 FBA', 30], ['410 REJILLA NEGRO/39 FBA', 27], ['4030 NEGRO 39 FBA', 28], ['725A MARINO/37 FBA', 25]])
  const s = resumirEdadAmazon({ filas: r.filas, fecha: '2026-10-18', precios })
  const por = Object.fromEntries(s.tramos.map((t) => [t.id, t]))
  ok('unidades por tramo: 0-60 = 2 + 2 + 1, 91-180 = 3, 181-330 = 2', por.a0.unidades === 5 && por.a91.unidades === 3 && por.a181.unidades === 2, JSON.stringify(s.tramos.map((t) => t.unidades)))
  ok('las que pasan de 90 días son 5 (tres de 91-180 y dos de 181-330)', s.masDe90 === 5, String(s.masDe90))
  ok('y las de más de 180, las dos de 181-330', s.masDe180 === 2)
  ok('el total son todas las unidades con edad', s.unidades === 10, String(s.unidades))
  ok('el valor de 91-180 es lo que valen esas tres unidades: 30 + 27 + 28', cerca(por.a91.valor, 85, 1e-9), String(por.a91.valor))
  ok('el SKU sin precio no cuenta en el valor, pero sí en las unidades', por.a181.valor === 0 && por.a181.unidades === 2)
  ok('el coste de todo el cliente es la suma de lo que dice Amazon de cada SKU', cerca(s.costeMes, 0.09 + 0.03 + 0.03 + 0.06 + 1.0, 1e-9), String(s.costeMes))
  ok('y los costes por tramo suman lo mismo', cerca(s.tramos.reduce((t, x) => t + (x.coste ?? 0), 0), s.costeMes ?? -1, 0.011))
  ok('el recargo por antigüedad, aparte', cerca(s.recargoMes, 0.4))
  ok('la foto y la moneda', s.fecha === '2026-10-18' && s.moneda === 'EUR' && s.aproximada === false)
  const sku = s.porSku['4036R NEGRO 40 FBA']
  ok('por SKU: lo más antiguo es 91-180 y hay una unidad de más de 90 días', sku.masAntiguo === 'a91' && sku.masDe90 === 1 && sku.edad.a0 === 2)
  ok('una referencia solo con unidades recientes no tiene nada de más de 90 días', s.porSku['725A MARINO/37 FBA'].masDe90 === 0 && s.porSku['725A MARINO/37 FBA'].masAntiguo === 'a0')
  ok('el tramo más antiguo de una edad vacía es null', tramoMasAntiguo(edadVacia()) === null)
  const rec = s.porSku['CON RECARGO']
  ok('por SKU se guarda lo que cuesta cada tramo, y suma lo que dice Amazon', !!rec.costePorTramo && cerca(rec.costePorTramo.a181, 0.8) && cerca(rec.costePorTramo.a0, 0.2) && cerca(TRAMOS_AMAZON.reduce((t, x) => t + (rec.costePorTramo?.[x.id] ?? 0), 0), 1.0, 1e-9))
  const sinCoste = resumirEdadAmazon({ filas: r.filas.map((f) => ({ ...f, costeMes: null })), fecha: '2026-10-18', precios })
  ok('si el informe no trae coste, no se inventa: null', sinCoste.costeMes === null && sinCoste.tramos.every((t) => t.coste === null) && Object.values(sinCoste.porSku).every((k) => k.costePorTramo === null))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
