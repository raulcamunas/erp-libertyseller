import { enTemporada, finDeTemporada, proximoInicio, temporadaPorReglas } from '@/lib/fba/temporada'

let fallos = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(d)}`}`)
}
console.log('\n=== La temporada por palabras (gratis) ===')
ok('sandalia → verano', temporadaPorReglas('Fluchos Sandalia Mujer Piel F1475 TIBET BLANCO (38)')?.temporada === 'verano')
ok('alpargata de esparto → verano', temporadaPorReglas('Alpargata cuña esparto')?.temporada === 'verano')
ok('botín → invierno', temporadaPorReglas('Botín Chelsea Mujer Piel Negro')?.temporada === 'invierno')
ok('bota con forro → invierno', temporadaPorReglas('Bota Mujer Agua Forro Borreguito')?.temporada === 'invierno')
ok('zapatilla deportiva → no lo sabe (la IA o todo el año)', temporadaPorReglas('Zapatilla Deportiva Hombre Running') === null)
ok('«Botafumeiro» no es una bota', temporadaPorReglas('Juego Botafumeiro') === null)
ok('si dice las dos cosas, no decide', temporadaPorReglas('Pack bota y sandalia') === null)
ok('sin nombre, nada', temporadaPorReglas(null) === null)
ok('«Zapatillas de casa … Invierno» → invierno por la palabra', temporadaPorReglas('COZSERIES Zapatillas Casa Mujer Invierno Cuña')?.temporada === 'invierno')
ok('«Zapatillas de estar por casa» sin más: no lo sabe (las hay de rejilla para el verano)', temporadaPorReglas('Zapatillas de Estar por Casa Rejilla Transpirable') === null)

console.log('\n=== Fechas de temporada ===')
ok('verano: 15 mar sí, 14 mar no, 31 ago sí, 1 sep no', enTemporada('verano', '2027-03-15') && !enTemporada('verano', '2027-03-14') && enTemporada('verano', '2027-08-31') && !enTemporada('verano', '2027-09-01'))
ok('invierno: 15 sep a febrero, cruzando el año', enTemporada('invierno', '2026-12-28') && enTemporada('invierno', '2027-02-28') && !enTemporada('invierno', '2027-03-01') && !enTemporada('invierno', '2026-07-10'))
ok('invierno: 29 feb de un bisiesto también', enTemporada('invierno', '2028-02-29'))
ok('todo el año: siempre', enTemporada('todo', '2026-07-01'))
ok('fin del invierno que empieza en dic 2026: 28 feb 2027', finDeTemporada('invierno', '2026-12-28') === '2027-02-28', finDeTemporada('invierno', '2026-12-28'))
ok('fin del invierno en febrero de un bisiesto: 29', finDeTemporada('invierno', '2028-02-10') === '2028-02-29', finDeTemporada('invierno', '2028-02-10'))
ok('fin del verano desde mayo: 31 ago', finDeTemporada('verano', '2027-05-01') === '2027-08-31')
ok('próximo verano desde diciembre: 15 mar del año siguiente', proximoInicio('verano', '2026-12-28') === '2027-03-15', proximoInicio('verano', '2026-12-28'))
ok('próximo invierno desde marzo: 15 sep', proximoInicio('invierno', '2027-03-20') === '2027-09-15')
console.log(fallos === 0 ? '\nTODO OK\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
