import { tandasDeAsins, ultimaSemana, ultimoMes } from './periodos'
import { leerInformeSqp } from './sqp'
import { bytesDe, coberturaDe, palabras, raiz } from './cobertura'
import { palabrasQueFaltanEnElTitulo, resumenDeProducto } from './resumen'
import { fichaDeItem } from './ficha-servidor'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== periodos ===')
{
  // Miércoles 11 nov 2026 − 3 días = domingo 8 → la última semana cerrada es la del domingo 1 al sábado 7
  const s = ultimaSemana('2026-11-11')
  ok('última semana publicada: domingo 1 a sábado 7 de noviembre', s.desde === '2026-11-01' && s.hasta === '2026-11-07', JSON.stringify(s))
  ok('empieza en domingo y acaba en sábado', new Date(`${s.desde}T00:00:00Z`).getUTCDay() === 0 && new Date(`${s.hasta}T00:00:00Z`).getUTCDay() === 6)
  const s2 = ultimaSemana('2026-11-09')
  ok('el lunes 9 todavía no se da la semana que acabó el sábado 7 (margen de 3 días): sale la del 25 al 31 de octubre', s2.desde === '2026-10-25' && s2.hasta === '2026-10-31', JSON.stringify(s2))
  for (const hoy of ['2026-01-01', '2026-03-15', '2026-07-04', '2026-12-31']) {
    const w = ultimaSemana(hoy)
    ok(`siempre domingo-sábado y 7 días (${hoy})`, new Date(`${w.desde}T00:00:00Z`).getUTCDay() === 0 && (Date.parse(w.hasta) - Date.parse(w.desde)) / 86_400_000 === 6)
  }
  ok('último mes publicado el 11 de noviembre: octubre entero', JSON.stringify(ultimoMes('2026-11-11')) === JSON.stringify({ periodo: 'MONTH', desde: '2026-10-01', hasta: '2026-10-31' }))
  ok('el 2 de noviembre (margen de 3 días) todavía sale septiembre', ultimoMes('2026-11-02').desde === '2026-09-01' && ultimoMes('2026-11-02').hasta === '2026-09-30')
  ok('enero → diciembre del año anterior', ultimoMes('2026-01-20').desde === '2025-12-01' && ultimoMes('2026-01-20').hasta === '2025-12-31')
  ok('febrero de 2026 acaba el 28', ultimoMes('2026-03-10').hasta === '2026-02-28')
}

console.log('\n=== tandas de ASIN ===')
{
  const asins = Array.from({ length: 40 }, (_, i) => `B0${String(i).padStart(8, '0')}`)
  const t = tandasDeAsins(asins)
  ok('cada tanda cabe en 200 caracteres', t.every((x) => x.join(' ').length <= 200), t.map((x) => x.join(' ').length).join())
  ok('18 por tanda como mucho, y no se pierde ninguno', t[0].length === 18 && t.flat().length === 40)
  ok('quita repetidos y lo que no es un ASIN', tandasDeAsins(['b0aaaaaaa1', 'B0AAAAAAA1', 'mal', '']).flat().join() === 'B0AAAAAAA1')
}

console.log('\n=== informe SQP ===')
{
  const json = {
    reportSpecification: {},
    dataByAsin: [
      { startDate: '2026-10-01', endDate: '2026-10-31', asin: 'b0fms6n5l8', searchQueryData: { searchQuery: 'jamon entero', searchQueryScore: 1, searchQueryVolume: 12000 }, impressionData: { totalQueryImpressionCount: 300000, asinImpressionCount: 6000, asinImpressionShare: 2 }, clickData: { totalClickCount: 9000, asinClickCount: 450, asinClickShare: 5 }, cartAddData: { totalCartAddCount: 900, asinCartAddCount: 90, asinCartAddShare: 10 }, purchaseData: { totalPurchaseCount: 600, asinPurchaseCount: 75, asinPurchaseShare: 12.5, totalMedianPurchasePrice: { amount: 89.9, currencyCode: 'EUR' }, asinMedianPurchasePrice: { amount: 99, currencyCode: 'EUR' } } },
      { asin: 'B0X', searchQueryData: {} },
      { searchQueryData: { searchQuery: 'sin asin' } },
    ],
  }
  const r = leerInformeSqp(json)
  ok('una fila buena; las que no tienen búsqueda o ASIN se descartan', r.length === 1)
  ok('ASIN en mayúsculas y volumen', r[0].asin === 'B0FMS6N5L8' && r[0].volumen === 12000)
  ok('las cuotas pasan de porcentaje a fracción (12,5 % → 0,125)', r[0].cuotaCompras === 0.125 && r[0].cuotaImpresiones === 0.02)
  ok('el precio mediano se lee del objeto con «amount»', r[0].precioMedianoTotal === 89.9 && r[0].precioMedianoAsin === 99)
  ok('un informe vacío o raro no rompe', leerInformeSqp(null).length === 0 && leerInformeSqp({ dataByAsin: 'x' }).length === 0)
}

console.log('\n=== cobertura en la ficha ===')
{
  ok('raíz del plural', raiz('cuchillos') === 'cuchillo' && raiz('jamones') === 'jamon' && raiz('box') === 'box' && raiz('mas') === 'mas')
  ok('sin tildes, sin palabras vacías', palabras('Jamón de Bellota para regalo').join() === 'jamon,bellota,regalo')
  const ficha = { titulo: 'Jamón Serrano Entero 7-8 kg con Jamonero de madera', bullets: ['Incluye cuchillo jamonero profesional', 'Ideal para regalo'], descripcion: null, backend: 'paleta iberica soporte' }
  const a = coberturaDe('jamon serrano entero', ficha)
  ok('todas las palabras en el título', a.titulo && a.faltan.length === 0, JSON.stringify(a))
  const b = coberturaDe('cuchillos jamoneros', ficha)
  ok('plural en la búsqueda, singular en la ficha → está (bullets)', !b.titulo && b.bullets && b.faltan.length === 0, JSON.stringify(b))
  const c = coberturaDe('soporte jamonero', ficha)
  ok('palabras repartidas entre título y backend: no está entera en ninguno, pero no falta nada', !c.titulo && !c.bullets && !c.backend && c.faltan.length === 0, JSON.stringify(c))
  const d = coberturaDe('jamon iberico de bellota', ficha)
  ok('«bellota» no está en ninguna parte → falta; «iberico» tampoco (en la ficha pone «ibérica»: el género no se iguala a propósito)', d.faltan.join() === 'iberico,bellota', JSON.stringify(d))
  ok('búsqueda solo de palabras vacías → no cuenta como cubierta', !coberturaDe('de la', ficha).titulo)
}

console.log('\n=== bytes del backend ===')
{
  ok('ASCII: un byte por letra', bytesDe('jamon') === 5)
  ok('la ñ y las tildes cuentan doble', bytesDe('jamón año') === 11)
  ok('vacío → 0', bytesDe(null) === 0)
}
console.log('\n=== resumen de un producto ===')
{
  const consultas = [
    { consulta: 'jamon entero', volumen: 10000, cuotaImpresiones: 0.02, comprasAsin: 50, comprasTotal: 500, cuotaCompras: 0.1 },
    { consulta: 'jamon iberico bellota', volumen: 5000, cuotaImpresiones: 0.08, comprasAsin: 10, comprasTotal: 300, cuotaCompras: 0.033 },
    { consulta: 'soporte jamonero', volumen: 1000, cuotaImpresiones: null, comprasAsin: 0, comprasTotal: 200, cuotaCompras: 0 },
  ]
  const ficha = { titulo: 'Jamón Serrano Entero 7-8 kg con Jamonero', bullets: ['Soporte de madera'], descripcion: null, backend: null }
  const r = resumenDeProducto(consultas, ficha)
  ok('cuota de compras = suma suya ÷ suma total = 60/1000 (no la media de porcentajes)', Math.abs((r.cuotaCompras as number) - 0.06) < 1e-9, String(r.cuotaCompras))
  ok('cuota de impresiones ponderada por volumen = (0,02·10000 + 0,08·5000)/15000 = 4 %', Math.abs((r.cuotaImpresiones as number) - 0.04) < 1e-9, String(r.cuotaImpresiones))
  ok('principal = la de más volumen', r.principal === 'jamon entero')
  ok('cobertura: 2 de 3 enteras en la ficha (falta «iberico bellota»)', Math.abs((r.cobertura as number) - 2 / 3) < 1e-9 && r.faltanEnFicha === 1, JSON.stringify(r))
  ok('sin ficha leída, la cobertura no se inventa: null', resumenDeProducto(consultas, null).cobertura === null)
  const vacio = resumenDeProducto([], ficha)
  ok('sin búsquedas: ceros y nulls, sin dividir por cero', vacio.busquedas === 0 && vacio.cuotaCompras === null && vacio.cobertura === null && vacio.principal === null)
}

console.log('\n=== palabras que faltan en el título ===')
{
  const consultas = [
    { consulta: 'jamon iberico bellota', volumen: 5000, cuotaImpresiones: null, comprasAsin: null, comprasTotal: null, cuotaCompras: null },
    { consulta: 'jamon bellota regalo', volumen: 2000, cuotaImpresiones: null, comprasAsin: null, comprasTotal: null, cuotaCompras: null },
    { consulta: 'jamon entero', volumen: 9000, cuotaImpresiones: null, comprasAsin: null, comprasTotal: null, cuotaCompras: null },
  ]
  const ficha = { titulo: 'Jamón entero 7 kg', bullets: ['Ideal para regalo'], descripcion: null, backend: 'iberico' }
  const f = palabrasQueFaltanEnElTitulo(consultas, ficha)
  ok('«bellota» pesa más (7000) que «iberico» (5000) y que «regalo» (2000); «jamon» y «entero» ya están', f.map((x) => x.palabra).join() === 'bellota,iberico,regalo', JSON.stringify(f))
  ok('dice dónde sí está: «regalo» en bullets, «iberico» en backend', f.find((x) => x.palabra === 'regalo')?.enBullets === true && f.find((x) => x.palabra === 'iberico')?.enBackend === true)
  ok('cuenta en cuántas búsquedas sale', f.find((x) => x.palabra === 'bellota')?.busquedas === 2)
}

console.log('\n=== ficha desde la Listings API ===')
{
  const item = {
    sku: 'MONTE 004 - ES',
    summaries: [{ marketplaceId: 'A1RKKUPIHCS9HS', asin: 'B0FMS6N5L8', itemName: 'Resumen' }],
    attributes: {
      item_name: [{ value: 'Jamón entero', marketplace_id: 'A1RKKUPIHCS9HS' }, { value: 'Whole ham', marketplace_id: 'ATVPDKIKX0DER' }],
      bullet_point: [{ value: 'Uno', marketplace_id: 'A1RKKUPIHCS9HS' }, { value: 'Dos', marketplace_id: 'A1RKKUPIHCS9HS' }],
      generic_keyword: [{ value: 'paleta serrano', marketplace_id: 'A1RKKUPIHCS9HS' }],
    },
  }
  const f = fichaDeItem(item, 'A1RKKUPIHCS9HS')
  ok('toma el título de ESE marketplace', f?.titulo === 'Jamón entero', JSON.stringify(f))
  ok('bullets, backend y ASIN', f?.bullets.length === 2 && f?.backend === 'paleta serrano' && f?.asin === 'B0FMS6N5L8')
  ok('sin descripción → null', f?.descripcion === null)
  ok('sin atributos usa el nombre del resumen', fichaDeItem({ sku: 'X', summaries: [{ marketplaceId: 'M', itemName: 'Del resumen' }] }, 'M')?.titulo === 'Del resumen')
  ok('sin SKU → null', fichaDeItem({}, 'M') === null)
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
