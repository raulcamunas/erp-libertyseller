import { EVENTOS_DE_TEMPORADA, enVedaDeActivacion, eventoEn, eventosDe, eventosManualesValidos, hayEventoEnElMes, ventanaTocaEvento } from './temporada-calculo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const j = (x: unknown) => JSON.stringify(x)

console.log('\n=== fases de Black Friday (27 → 30 nov) ===')
ok('24 nov: nada (3 días antes)', eventoEn('2026-11-24', 'ES', []) === null, j(eventoEn('2026-11-24', 'ES', [])))
ok('25 nov = previo de BF', j(eventoEn('2026-11-25', 'ES', [])) === j({ nombre: 'Black Friday', fase: 'previo' }), j(eventoEn('2026-11-25', 'ES', [])))
ok('26 nov = previo', eventoEn('2026-11-26', 'DE', [])?.fase === 'previo')
ok('29 nov = durante', j(eventoEn('2026-11-29', 'ES', [])) === j({ nombre: 'Black Friday', fase: 'durante' }))
ok('30 nov (Cyber Monday) = durante', eventoEn('2026-11-30', 'US', [])?.fase === 'durante')
ok('4 dic = posterior', j(eventoEn('2026-12-04', 'ES', [])) === j({ nombre: 'Black Friday', fase: 'posterior' }), j(eventoEn('2026-12-04', 'ES', [])))
ok('7 dic = último posterior', eventoEn('2026-12-07', 'ES', [])?.fase === 'posterior')
ok('8 dic: nada', eventoEn('2026-12-08', 'ES', []) === null, j(eventoEn('2026-12-08', 'ES', [])))
ok('fecha basura → null', eventoEn('2026-13-01', 'ES', []) === null && eventoEn('hoy', 'ES', []) === null)

console.log('\n=== solapes: durante gana ===')
ok('27 dic en ES = durante Reyes (no posterior de Navidad)', j(eventoEn('2026-12-27', 'ES', [])) === j({ nombre: 'Reyes', fase: 'durante' }), j(eventoEn('2026-12-27', 'ES', [])))
ok('27 dic en DE = posterior de Navidad', j(eventoEn('2026-12-27', 'DE', [])) === j({ nombre: 'Navidad', fase: 'posterior' }))
ok('25 dic en ES = previo de Reyes (gana a posterior de Navidad)', eventoEn('2026-12-25', 'ES', [])?.nombre === 'Reyes' && eventoEn('2026-12-25', 'ES', [])?.fase === 'previo')

console.log('\n=== por país ===')
ok('Reyes solo en ES', eventoEn('2027-01-02', 'ES', [])?.nombre === 'Reyes' && eventoEn('2027-01-02', 'FR', []) === null && eventoEn('2027-01-02', 'MX', []) === null)
ok('país en minúsculas vale', eventoEn('2027-01-02', 'es', [])?.nombre === 'Reyes')
ok('Buen Fin solo en MX', eventoEn('2026-11-15', 'MX', [])?.nombre === 'El Buen Fin' && eventoEn('2026-11-15', 'ES', []) === null && eventoEn('2026-11-15', 'US', []) === null)
ok('eventosDe(ES) = BF, Navidad, Reyes', j(eventosDe('ES', []).map(e => e.nombre)) === j(['Black Friday', 'Navidad', 'Reyes']), j(eventosDe('ES', []).map(e => e.nombre)))
ok('eventosDe(MX) empieza por Buen Fin y no tiene Reyes', eventosDe('MX', [])[0].nombre === 'El Buen Fin' && !eventosDe('MX', []).some(e => e.nombre === 'Reyes'))
ok('Prime Day y Hot Sale no están en la tabla', !EVENTOS_DE_TEMPORADA.some(e => /prime|hot sale/i.test(e.nombre)))

console.log('\n=== veda de activación (20 nov → 2 dic) ===')
ok('19 nov sin veda', enVedaDeActivacion('2026-11-19', 'ES', []) === null)
let todaLaVeda = true
for (let d = 20; d <= 32; d++) {
  const f = d <= 30 ? `2026-11-${String(d).padStart(2, '0')}` : `2026-12-0${d - 30}`
  const v = enVedaDeActivacion(f, 'ES', [])
  if (!v || v.nombre !== 'Black Friday' || v.hasta !== '2026-12-02') todaLaVeda = false
}
ok('20 nov … 2 dic en veda, hasta 2026-12-02', todaLaVeda, j(enVedaDeActivacion('2026-11-20', 'ES', [])))
ok('3 dic sin veda', enVedaDeActivacion('2026-12-03', 'ES', []) === null, j(enVedaDeActivacion('2026-12-03', 'ES', [])))
ok('veda también en US y MX', enVedaDeActivacion('2026-11-25', 'US', []) !== null && enVedaDeActivacion('2026-11-25', 'MX', []) !== null)
ok('Navidad no tiene veda', enVedaDeActivacion('2026-12-18', 'ES', []) === null)

console.log('\n=== ventanas y meses ===')
ok('ventana 1–26 nov en ES no toca (solo previo)', ventanaTocaEvento('2026-11-01', '2026-11-26', 'ES', []) === null)
ok('ventana 1–27 nov en ES toca BF', ventanaTocaEvento('2026-11-01', '2026-11-27', 'ES', []) === 'Black Friday')
ok('ventana 1–20 nov en MX toca Buen Fin', ventanaTocaEvento('2026-11-01', '2026-11-20', 'MX', []) === 'El Buen Fin')
ok('ventana 1–7 dic (posterior) no toca', ventanaTocaEvento('2026-12-01', '2026-12-07', 'ES', []) === null)
ok('ventana al revés se ordena', ventanaTocaEvento('2026-12-20', '2026-12-10', 'ES', []) === 'Navidad')
ok('noviembre y diciembre con evento', hayEventoEnElMes('2026-11', 'ES', []) && hayEventoEnElMes('2026-12', 'ES', []))
ok('enero 2027 con evento solo en ES', hayEventoEnElMes('2027-01', 'ES', []) && !hayEventoEnElMes('2027-01', 'DE', []))
ok('octubre sin evento; mes basura false', !hayEventoEnElMes('2026-10', 'ES', []) && !hayEventoEnElMes('2026-13', 'ES', []))

console.log('\n=== eventos manuales ===')
const manuales = eventosManualesValidos([
  { nombre: '  Prime Day  ', desde: '2027-07-08', hasta: '2027-07-11', paises: ['es', 'DE'] },
  { nombre: 'Hot Sale', desde: '2027-05-25', hasta: '2027-06-02', paises: ['MX'], veda: true },
  { nombre: 'Sin países', desde: '2027-03-01', hasta: '2027-03-01' },
  { nombre: '', desde: '2027-03-01', hasta: '2027-03-02' },
  { nombre: 'Fecha imposible', desde: '2027-02-30', hasta: '2027-03-02' },
  { nombre: 'Al revés', desde: '2027-03-05', hasta: '2027-03-02' },
  { nombre: 'Formato malo', desde: '1/3/2027', hasta: '2027-03-02' },
  { nombre: 'País raro', desde: '2027-03-01', hasta: '2027-03-02', paises: ['España'] },
  { nombre: 'Países no lista', desde: '2027-03-01', hasta: '2027-03-02', paises: 'ES' },
  { nombre: 42, desde: '2027-03-01', hasta: '2027-03-02' },
  null,
  'texto',
  [1, 2],
])
ok('quedan 3 de 13', manuales.length === 3, j(manuales.map(m => m.nombre)))
ok('Prime Day limpio y con países en mayúsculas', j(manuales[0]) === j({ nombre: 'Prime Day', desde: '2027-07-08', hasta: '2027-07-11', paises: ['ES', 'DE'], veda: false }), j(manuales[0]))
ok('Hot Sale conserva veda', manuales[1].veda === true && j(manuales[1].paises) === j(['MX']))
ok('sin países = todos (null)', manuales[2].paises === null)
ok('crudo que no es lista → []', eventosManualesValidos(null).length === 0 && eventosManualesValidos({}).length === 0 && eventosManualesValidos('[]').length === 0)
ok('Prime Day manual en ES = durante', j(eventoEn('2027-07-09', 'ES', manuales)) === j({ nombre: 'Prime Day', fase: 'durante' }))
ok('Prime Day manual no en MX', eventoEn('2027-07-09', 'MX', manuales) === null)
ok('Hot Sale manual con veda en MX (18 may → 4 jun)', enVedaDeActivacion('2027-05-18', 'MX', manuales)?.hasta === '2027-06-04' && enVedaDeActivacion('2027-05-17', 'MX', manuales) === null)
ok('mes de julio 2027 con evento por manual', hayEventoEnElMes('2027-07', 'DE', manuales) && !hayEventoEnElMes('2027-07', 'DE', []))

console.log(fallos ? `\n${fallos} FALLAN` : '\nTODO OK')
if (fallos) process.exit(1)
