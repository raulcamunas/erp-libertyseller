import { agruparPorDia, alturaDeLaHora, claveDeDia, colocarCitas, huecoDeLaRejilla, REJILLA } from './colocar'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

// En octubre de 2026 España está en CET (UTC+1) a partir del domingo 25: 09:00 en Madrid = 08:00 UTC
const c = (id: string, ini: string, fin: string) => ({ id, start_time: ini, end_time: fin })

console.log('\n=== la posición de una cita ===')
{
  const [a] = colocarCitas([c('a', '2026-10-28T08:00:00Z', '2026-10-28T09:00:00Z')])
  ok('09:00 en Madrid arranca una hora por debajo de las 08:00 (64 px)', a.top === 64, String(a.top))
  ok('una hora mide 64 px', a.height === 64)
  ok('con su hora de inicio en España', a.hora === '09:00')
  ok('sola, ocupa una columna de una', a.col === 0 && a.totalCols === 1)
  const [b] = colocarCitas([c('b', '2026-10-28T09:30:00Z', '2026-10-28T10:00:00Z')])
  ok('a las 10:30 y de media hora: 160 px de arriba y 32 de alto, pero no baja de 26', b.top === 160 && b.height === 32, `${b.top}/${b.height}`)
  const [d] = colocarCitas([c('d', '2026-10-28T09:00:00Z', '2026-10-28T09:10:00Z')])
  ok('una de diez minutos se queda en el mínimo para poder leerse', d.height === REJILLA.alturaMinima)
  const [e] = colocarCitas([c('e', '2026-10-28T07:00:00Z', '2026-10-28T08:00:00Z')])
  ok('la primera hora del día está arriba del todo', e.top === 0 && e.hora === '08:00')
}

console.log('\n=== las que se salen de la rejilla se recortan ===')
{
  const total = (REJILLA.finDia - REJILLA.inicioDia) * REJILLA.alturaHora // 832
  const [larga] = colocarCitas([c('l', '2026-10-28T08:00:00Z', '2026-10-28T21:00:00Z')])
  ok('una de 13 horas llega hasta el final de la rejilla y no más', larga.top + larga.height === total, `${larga.top + larga.height} vs ${total}`)
  const [tarde] = colocarCitas([c('t', '2026-10-28T19:30:00Z', '2026-10-28T20:30:00Z')])
  ok('la que acaba a las 21:30 se corta a las 21:00', tarde.top + tarde.height === total, String(tarde.top + tarde.height))
  const [madrugada] = colocarCitas([c('m', '2026-10-28T05:00:00Z', '2026-10-28T08:00:00Z')])
  ok('la que empieza a las 06:00 y acaba a las 09:00 arranca arriba del todo', madrugada.top === 0 && madrugada.height === 64, `${madrugada.top}/${madrugada.height}`)
  ok('la que cae entera antes de las 08:00 no se pinta', colocarCitas([c('x', '2026-10-28T03:00:00Z', '2026-10-28T05:00:00Z')]).length === 0)
  ok('ni la que cae entera después de las 21:00', colocarCitas([c('y', '2026-10-28T20:30:00Z', '2026-10-28T22:00:00Z')]).length === 0)
  const [noche] = colocarCitas([c('n', '2026-10-28T19:00:00Z', '2026-10-28T23:30:00Z')])
  ok('la que cruza la medianoche llega al final y no se va a una hora negativa', noche.top + noche.height === total && noche.height > 0, `${noche.top}/${noche.height}`)
}

console.log('\n=== dos a la vez ===')
{
  const r = colocarCitas([c('a', '2026-10-28T09:00:00Z', '2026-10-28T10:00:00Z'), c('b', '2026-10-28T09:30:00Z', '2026-10-28T10:30:00Z'), c('z', '2026-10-28T13:00:00Z', '2026-10-28T14:00:00Z')])
  const por = Object.fromEntries(r.map((x) => [x.cita.id, x]))
  ok('las que se pisan se reparten en dos columnas', por.a.totalCols === 2 && por.b.totalCols === 2 && por.a.col !== por.b.col)
  ok('la que no se pisa con nadie ocupa la columna entera', por.z.totalCols === 1)
  ok('mantiene el orden de inicio', r.map((x) => x.cita.id).join() === 'a,b,z')
}

console.log('\n=== el día al que pertenece ===')
{
  ok('las 23:30 UTC ya son el día siguiente en Madrid', claveDeDia('2026-10-28T23:30:00Z') === '2026-10-29')
  ok('las 22:30 UTC todavía no (invierno, UTC+1)', claveDeDia('2026-10-28T22:30:00Z') === '2026-10-28')
  const mapa = agruparPorDia([c('a', '2026-10-28T09:00:00Z', 'x'), c('b', '2026-10-28T17:00:00Z', 'x'), c('c', '2026-10-29T09:00:00Z', 'x')])
  ok('agrupa por día de España', mapa.get('2026-10-28')?.length === 2 && mapa.get('2026-10-29')?.length === 1 && mapa.size === 2)
  ok('el día del cambio de hora (25 oct 2026) cada cita cae en su día', claveDeDia('2026-10-25T00:30:00Z') === '2026-10-25' && claveDeDia('2026-10-25T23:30:00Z') === '2026-10-26')
}

console.log('\n=== pinchar en la rejilla ===')
{
  const h = (y: number) => JSON.stringify(huecoDeLaRejilla(y))
  ok('arriba del todo: las 08:00', h(0) === JSON.stringify({ hour: 8, minute: 0 }))
  ok('a 64 px (una hora): las 09:00', h(64) === JSON.stringify({ hour: 9, minute: 0 }))
  ok('a las 10:20 (rejilla 160 + 21 px) se redondea al más cercano: las 10:30', h(64 * 2 + 21) === JSON.stringify({ hour: 10, minute: 30 }))
  ok('a las 10:10 se queda en las 10:00', h(64 * 2 + 10) === JSON.stringify({ hour: 10, minute: 0 }))
  ok('por debajo de la rejilla, el último hueco: las 20:30', h(5000) === JSON.stringify({ hour: 20, minute: 30 }))
  ok('por encima (un arrastre que sale), el primero: las 08:00', h(-300) === JSON.stringify({ hour: 8, minute: 0 }))
  ok('la altura de una hora vuelve a su sitio', alturaDeLaHora(10, 30) === 160 && alturaDeLaHora(8, 0) === 0)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
