import { claveDeInstante, claveDeSemana, limitesDeSemanas, lunesDeLaClave, lunesDeLaSemana, semanasAlrededor, tramosDeSemanas } from './semanas'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const horasEntre = (a: string, b: string): number => (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000

console.log('\n=== el lunes de la semana, en hora de España ===')
{
  ok('un miércoles cae en el lunes anterior', claveDeSemana(lunesDeLaSemana('2026-10-28T12:00:00Z')) === '2026-10-26')
  ok('el propio lunes a mediodía', claveDeSemana(lunesDeLaSemana('2026-10-26T11:00:00Z')) === '2026-10-26')
  ok('el domingo por la noche sigue en la semana que acaba', claveDeSemana(lunesDeLaSemana('2026-11-01T21:30:00Z')) === '2026-10-26')
  ok('el domingo 23:30 en Madrid (22:30 UTC) todavía es esa semana', claveDeSemana(lunesDeLaSemana('2026-11-01T22:30:00Z')) === '2026-10-26')
  ok('y a las 00:30 de Madrid ya es la siguiente (23:30 UTC del domingo)', claveDeSemana(lunesDeLaSemana('2026-11-01T23:30:00Z')) === '2026-11-02')
  ok('el lunes 00:00 de Madrid es de la semana nueva, no de la vieja', claveDeSemana(lunesDeLaSemana('2026-10-25T23:00:00Z')) === '2026-10-26')
  ok('la hora del lunes es 00:00', lunesDeLaSemana('2026-10-28T12:00:00Z').getHours() === 0 && lunesDeLaSemana('2026-10-28T12:00:00Z').getMinutes() === 0)
  ok('acepta un Date igual que un texto', claveDeSemana(lunesDeLaSemana(new Date('2026-10-28T12:00:00Z'))) === '2026-10-26')
  ok('claveDeInstante da lo mismo que pasar por el lunes', claveDeInstante('2026-10-28T12:00:00Z') === '2026-10-26')
  ok('cruza el fin de año', claveDeInstante('2027-01-01T10:00:00Z') === '2026-12-28')
}

console.log('\n=== de la clave al lunes ===')
{
  ok('una clave de lunes vuelve a su lunes', claveDeSemana(lunesDeLaClave('2026-10-26')!) === '2026-10-26')
  ok('una clave de un miércoles se lleva a su lunes', claveDeSemana(lunesDeLaClave('2026-10-28')!) === '2026-10-26')
  ok('texto que no es una fecha: null', lunesDeLaClave('mañana') === null && lunesDeLaClave('') === null && lunesDeLaClave('2026-10') === null)
  ok('una fecha imposible no se corrige a otro mes', lunesDeLaClave('2026-02-31') === null && lunesDeLaClave('2026-13-01') === null)
}

console.log('\n=== entre qué instantes cae una semana ===')
{
  const normal = limitesDeSemanas(lunesDeLaClave('2026-10-26')!)
  ok('la semana del 26 oct 2026 (ya en horario de invierno) va de 23:00 UTC a 23:00 UTC', normal.desde === '2026-10-25T23:00:00.000Z' && normal.hasta === '2026-11-01T23:00:00.000Z', JSON.stringify(normal))
  ok('y dura 168 horas', horasEntre(normal.desde, normal.hasta) === 168)

  const otoño = limitesDeSemanas(lunesDeLaClave('2026-10-19')!)
  ok('la semana del cambio de hora de otoño empieza con horario de verano (22:00 UTC) y acaba con el de invierno (23:00 UTC)', otoño.desde === '2026-10-18T22:00:00.000Z' && otoño.hasta === '2026-10-25T23:00:00.000Z', JSON.stringify(otoño))
  ok('y dura 169 horas, no 168', horasEntre(otoño.desde, otoño.hasta) === 169)

  const primavera = limitesDeSemanas(lunesDeLaClave('2026-03-23')!)
  ok('la de primavera dura 167', horasEntre(primavera.desde, primavera.hasta) === 167, String(horasEntre(primavera.desde, primavera.hasta)))

  const tres = limitesDeSemanas(lunesDeLaClave('2026-10-19')!, 3)
  ok('tres semanas seguidas: del primer lunes al lunes de la cuarta', tres.desde === '2026-10-18T22:00:00.000Z' && tres.hasta === '2026-11-08T23:00:00.000Z', JSON.stringify(tres))
  ok('el límite de una semana es el principio de la siguiente (no se solapan ni dejan hueco)', limitesDeSemanas(lunesDeLaClave('2026-10-19')!).hasta === limitesDeSemanas(lunesDeLaClave('2026-10-26')!).desde)
}

console.log('\n=== una cita en el borde cae en UNA sola semana ===')
{
  const s = limitesDeSemanas(lunesDeLaClave('2026-10-26')!)
  const cita = '2026-10-25T23:00:00.000Z' // lunes 26 a las 00:00 en Madrid
  ok('empieza justo donde `desde` (entra)', cita >= s.desde && cita < s.hasta)
  const anterior = limitesDeSemanas(lunesDeLaClave('2026-10-19')!)
  ok('y NO cae también en la anterior (hasta no entra)', !(cita >= anterior.desde && cita < anterior.hasta))
  ok('la clave de ese instante es la del lunes 26', claveDeInstante(cita) === '2026-10-26')
}

console.log('\n=== las semanas de alrededor ===')
{
  const centro = lunesDeLaClave('2026-10-26')!
  const claves = semanasAlrededor(centro, 1, 1).map(claveDeSemana)
  ok('la anterior, la propia y la siguiente', JSON.stringify(claves) === JSON.stringify(['2026-10-19', '2026-10-26', '2026-11-02']), claves.join(','))
  ok('sin semanas de más', semanasAlrededor(centro, 0, 0).map(claveDeSemana).join() === '2026-10-26')
  ok('atravesando el cambio de hora cada una sigue siendo un lunes a las 00:00', semanasAlrededor(lunesDeLaClave('2026-10-19')!, 0, 2).every((l) => l.getDay() === 1 && l.getHours() === 0))
}

console.log('\n=== los tramos seguidos (una consulta por tramo) ===')
{
  const l = (c: string) => lunesDeLaClave(c)!
  const resumen = (xs: ReturnType<typeof tramosDeSemanas>) => xs.map((t) => `${claveDeSemana(t.lunes)}x${t.semanas}`).join(' ')
  ok('tres seguidas son un tramo', resumen(tramosDeSemanas([l('2026-10-19'), l('2026-10-26'), l('2026-11-02')])) === '2026-10-19x3')
  ok('con un hueco en medio son dos', resumen(tramosDeSemanas([l('2026-10-19'), l('2026-11-02')])) === '2026-10-19x1 2026-11-02x1')
  ok('el orden de entrada da igual', resumen(tramosDeSemanas([l('2026-11-02'), l('2026-10-19'), l('2026-10-26')])) === '2026-10-19x3')
  ok('las repetidas cuentan una vez', resumen(tramosDeSemanas([l('2026-10-26'), l('2026-10-26')])) === '2026-10-26x1')
  ok('sin semanas, sin tramos', tramosDeSemanas([]).length === 0)
  ok('seguidas a través del cambio de hora', resumen(tramosDeSemanas([l('2026-10-19'), l('2026-10-26')])) === '2026-10-19x2')
  const t = tramosDeSemanas([l('2026-10-19'), l('2026-10-26')])[0]
  const rango = limitesDeSemanas(t.lunes, t.semanas)
  ok('y el rango del tramo cubre las dos semanas', rango.desde === '2026-10-18T22:00:00.000Z' && rango.hasta === '2026-11-01T23:00:00.000Z', JSON.stringify(rango))
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
