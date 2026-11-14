/**
 * PRUEBAS DE HELIUM 10 EN SEO TEST: leer Cerebro (también multi-ASIN), Magnet y Keyword Tracker, y cruzar con Brand Analytics.
 *   npx tsx lib/seo/helium.prueba.ts
 */
import { asinsDelCerebro, detectarTipoH10, leerCerebro, leerKeywordTracker } from '@/lib/ads/helium10'
import { cruzarConBrandAnalytics, juntarImportaciones, oportunidadesParaLaIa, type KeywordH10 } from './helium'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const CEREBRO = [
  'Keyword Phrase,Cerebro IQ Score,Search Volume,Search Volume Trend,H10 PPC Sugg. Bid,Competing Products,Title Density,Organic Rank,Sponsored Rank,B0RIVAL001,B0RIVAL002',
  'lampara de pie,"1.234","12.500",15,"0,85",">2,000",12,8,3,2,-',
  'lampara salon led,500,3400,-4,0.6,800,4,0,,15,31',
  'lampara de pie,9,9,9,9,9,9,9,9,9,9',
].join('\n')

const MULTI_SIN_RANK = ['Keyword Phrase,Search Volume,B0PROPI001,B0RIVAL001', 'flexo,900,4,7'].join('\n')

const TRACKER = [
  'Title,ASIN,Keyword,Marketplace,Search Volume,Organic Rank,Sponsored Position,Date Added',
  'Lámpara,B0PROPI001,lampara de pie,ES,12500,40,,2026-11-01',
  'Lámpara,B0PROPI001,lampara de pie,ES,12500,22,5,2026-11-10',
  'Otra,B0OTRO0001,lampara de pie,ES,12500,1,,2026-11-12',
  'Lámpara,B0PROPI001,flexo estudio,ES,800,>306,,2026-11-10',
].join('\n')

console.log('\n=== qué fichero es ===')
ok('Cerebro', detectarTipoH10(CEREBRO) === 'cerebro')
ok('Keyword Tracker', detectarTipoH10(TRACKER) === 'keyword_tracker')
ok('Magnet', detectarTipoH10('Keyword Phrase,Magnet IQ Score,Search Volume\nx,1,2') === 'magnet')

console.log('\n=== Cerebro ===')
{
  const r = leerCerebro(CEREBRO)
  ok('se lee', r.ok)
  if (r.ok) {
    ok('sin repetidas', r.filas.length === 2)
    const a = r.filas[0]
    ok('IQ, volumen y tendencia', a.cerebroIq === 1234 && a.volumen === 12500 && a.tendencia === 15, JSON.stringify(a))
    ok('rango orgánico y patrocinado', a.rankingOrganico === 8 && a.rangoPatrocinado === 3)
    ok('rangos de los rivales por ASIN', a.rangosRivales?.B0RIVAL001 === 2 && a.rangosRivales?.B0RIVAL002 === undefined, JSON.stringify(a.rangosRivales))
    ok('rango 0 = sin rango', r.filas[1].rankingOrganico === null)
  }
  ok('los ASIN de las columnas', asinsDelCerebro(CEREBRO).join() === 'B0RIVAL001,B0RIVAL002')
  const m = leerCerebro(MULTI_SIN_RANK, 'B0PROPI001')
  ok('multi-ASIN: el rango propio sale de su columna', m.ok && m.filas[0].rankingOrganico === 4 && m.filas[0].rangosRivales?.B0RIVAL001 === 7)
  ok('Marketing Test sigue leyendo sin ASIN', leerCerebro(MULTI_SIN_RANK).ok)
}

console.log('\n=== Keyword Tracker ===')
{
  const r = leerKeywordTracker(TRACKER, 'B0PROPI001')
  ok('se lee', r.ok)
  if (r.ok) {
    const l = r.filas.find((f) => f.keyword === 'lampara de pie')
    ok('la fecha más reciente del ASIN propio (no la del otro)', l?.rangoOrganico === 22 && l?.rangoPatrocinado === 5, JSON.stringify(l))
    ok('«>306» se lee como 306', r.filas.find((f) => f.keyword === 'flexo estudio')?.rangoOrganico === 306)
  }
  ok('sin columna Organic Rank → error claro', !leerKeywordTracker('Keyword,Search Volume\nx,1').ok)
}

console.log('\n=== cruce con Brand Analytics ===')
{
  const k = (keyword: string, volumen: number, rango: number | null = null): KeywordH10 => ({ keyword, volumen, cerebroIq: null, tendencia: null, competidores: null, densidad: null, pujaSugerida: null, rangoOrganico: rango, rangoPatrocinado: null, rangosRivales: {} })
  const juntas = juntarImportaciones([k('Lampara de pie', 12500), k('flexo', 900)], [{ keyword: 'lampara de pie', volumen: 1, rangoOrganico: 22, rangoPatrocinado: null }, { keyword: 'aplique pared', volumen: 300, rangoOrganico: 80, rangoPatrocinado: null }])
  ok('junta Cerebro y Tracker por palabra', juntas.length === 3 && juntas.find((x) => x.keyword === 'lampara de pie')?.rangoOrganico === 22 && juntas.find((x) => x.keyword === 'lampara de pie')?.volumen === 12500)
  const ficha = { titulo: 'Marca Lámpara de pie LED', bullets: ['Luz cálida'], descripcion: null, backend: null }
  const c = cruzarConBrandAnalytics(juntas, ['lampara de pie'], ficha)
  const lp = c.find((x) => x.keyword === 'lampara de pie')
  ok('lo que ya sale en BA no es oportunidad', lp?.enBrandAnalytics === true && lp.oportunidad === 0)
  const fl = c.find((x) => x.keyword === 'flexo')
  ok('lo que no sale en BA y falta en la ficha es oportunidad', (fl?.oportunidad ?? 0) > 0 && fl?.faltan.includes('flexo') === true, JSON.stringify(fl))
  ok('ordenado por oportunidad', c[0].keyword === 'flexo')
  ok('a la IA solo van oportunidades', oportunidadesParaLaIa(c).every((x) => x.keyword !== 'lampara de pie'))
}

console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} FALLOS\n`)
process.exit(fallos === 0 ? 0 : 1)
