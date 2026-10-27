import { cicloDeVenta, diasEntre, FASES_DEL_CAMINO, lineaDeFases, textoDeDias, textoDeDuracion, type EntradaDeFase } from './fases'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const HOY = new Date('2026-10-27T12:00:00Z')
const e = (etapa: EntradaDeFase['etapa'], desde: string, origen: EntradaDeFase['origen'] = 'manual'): EntradaDeFase => ({ etapa, desde, origen })
const estados = (l: ReturnType<typeof lineaDeFases>) => l.pasos.map((p) => `${p.etapa.slice(0, 3)}:${p.estado}`).join(' ')

console.log('\n=== el camino ===')
{
  ok('seis fases, y «perdido» no es una de ellas', FASES_DEL_CAMINO.length === 6 && !FASES_DEL_CAMINO.includes('perdido'))
  ok('empieza en «nuevo» y acaba en «cerrado» (ganado)', FASES_DEL_CAMINO[0] === 'nuevo' && FASES_DEL_CAMINO[5] === 'ganado')
}

console.log('\n=== un cliente que avanza paso a paso ===')
{
  const h = [e('nuevo', '2026-10-01T10:00:00Z', 'alta'), e('seguimiento', '2026-10-05T10:00:00Z'), e('propuesta_enviada', '2026-10-18T10:00:00Z')]
  const l = lineaDeFases('propuesta_enviada', h, HOY)
  ok('nuevo y seguimiento hechos, propuesta actual, el resto pendiente', estados(l) === 'nue:hecho seg:hecho pro:actual rev:pendiente neg:pendiente gan:pendiente', estados(l))
  ok('la actual lleva 9 días (del 18 al 27)', l.diasEnLaActual === 9 && l.pasos[2].dias === 9, String(l.diasEnLaActual))
  ok('«nuevo» duró 4 días y «seguimiento» 13', l.pasos[0].dias === 4 && l.pasos[1].dias === 13, `${l.pasos[0].dias}/${l.pasos[1].dias}`)
  ok('cada fase recorrida lleva su fecha; las que faltan, ninguna', l.pasos[0].desde === '2026-10-01T10:00:00Z' && l.pasos[2].desde === '2026-10-18T10:00:00Z' && l.pasos[3].desde === null)
  ok('el avance es 2 de 5 fases (0,4)', Math.abs(l.avance - 0.4) < 1e-9 && l.indice === 2)
  ok('no está perdido', l.perdido === null)
  ok('ninguna fecha es aproximada (todas son de verdad)', l.pasos.every((p) => !p.aproximada))
}

console.log('\n=== una fase saltada se queda saltada ===')
{
  const h = [e('nuevo', '2026-10-01T10:00:00Z', 'alta'), e('negociacion', '2026-10-10T10:00:00Z')]
  const l = lineaDeFases('negociacion', h, HOY)
  ok('de «nuevo» a «negociación»: seguimiento y propuesta, saltadas; revisión, también', estados(l) === 'nue:hecho seg:saltado pro:saltado rev:saltado neg:actual gan:pendiente', estados(l))
  ok('las saltadas no tienen fecha ni duración', l.pasos[1].desde === null && l.pasos[1].dias === null)
  ok('el avance cuenta la posición (4 de 5), no cuántas fases se pisaron', Math.abs(l.avance - 0.8) < 1e-9)
}

console.log('\n=== volver atrás ===')
{
  const h = [e('nuevo', '2026-10-01T10:00:00Z', 'alta'), e('seguimiento', '2026-10-05T10:00:00Z'), e('nuevo', '2026-10-24T10:00:00Z')]
  const l = lineaDeFases('nuevo', h, HOY)
  ok('devuelto a «nuevo»: seguimiento vuelve a ser pendiente y sin fecha', estados(l) === 'nue:actual seg:pendiente pro:pendiente rev:pendiente neg:pendiente gan:pendiente', estados(l))
  ok('«lleva X días en nuevo» cuenta desde que VOLVIÓ (3 días), no desde que nació (26)', l.diasEnLaActual === 3 && l.pasos[0].dias === 3, String(l.diasEnLaActual))
}

console.log('\n=== cerrado y perdido ===')
{
  const h = [e('nuevo', '2026-09-01T10:00:00Z', 'alta'), e('seguimiento', '2026-09-03T10:00:00Z'), e('propuesta_enviada', '2026-09-10T10:00:00Z'), e('revision_propuesta', '2026-09-14T10:00:00Z'), e('negociacion', '2026-09-20T10:00:00Z'), e('ganado', '2026-10-02T10:00:00Z')]
  const l = lineaDeFases('ganado', h, HOY)
  ok('cerrado: las cinco anteriores hechas y la última, actual', estados(l) === 'nue:hecho seg:hecho pro:hecho rev:hecho neg:hecho gan:actual', estados(l))
  ok('avance completo (1)', l.avance === 1)
  ok('el ciclo de venta son 31 días (del 1 de sept al 2 de oct)', cicloDeVenta(h) === 31, String(cicloDeVenta(h)))
}
{
  const h = [e('nuevo', '2026-10-01T10:00:00Z', 'alta'), e('seguimiento', '2026-10-05T10:00:00Z'), e('perdido', '2026-10-20T10:00:00Z')]
  const l = lineaDeFases('perdido', h, HOY)
  ok('perdido: se queda hasta donde llegó (seguimiento, hecho) y lo demás pendiente', estados(l) === 'nue:hecho seg:hecho pro:pendiente rev:pendiente neg:pendiente gan:pendiente', estados(l))
  ok('y el abandono se marca aparte, con sus 7 días', l.perdido !== null && l.perdido.dias === 7 && l.perdido.desde === '2026-10-20T10:00:00Z', JSON.stringify(l.perdido))
  ok('lo que estuvo en la última fase se mide hasta que se perdió (15 días)', l.pasos[1].dias === 15, String(l.pasos[1].dias))
  ok('«lleva X días» es desde que se perdió', l.diasEnLaActual === 7)
  ok('el avance es lo que llegó (1 de 5)', Math.abs(l.avance - 0.2) < 1e-9)
}
{
  const l = lineaDeFases('perdido', [], HOY)
  ok('perdido sin historial: no se inventa hasta dónde llegó (solo la primera fase) ni la fecha', l.indice === 0 && l.perdido !== null && l.perdido.desde === null && l.perdido.dias === null)
}

console.log('\n=== fechas recuperadas (fichas anteriores a la migración) ===')
{
  const h = [e('seguimiento', '2026-10-12T10:00:00Z', 'recuperado')]
  const l = lineaDeFases('seguimiento', h, HOY)
  ok('la actual sale con su fecha y marcada como aproximada', l.pasos[1].desde === '2026-10-12T10:00:00Z' && l.pasos[1].aproximada)
  ok('lo anterior no consta: «nuevo» está hecho pero sin fecha (no se inventa)', l.pasos[0].estado === 'saltado' && l.pasos[0].desde === null)
  ok('y sin ciclo de venta: no se puede calcular con fechas aproximadas', cicloDeVenta([e('nuevo', '2026-09-01T10:00:00Z', 'recuperado'), e('ganado', '2026-10-01T10:00:00Z', 'recuperado')]) === null)
}

console.log('\n=== sin historial (la migración aún no está lanzada) ===')
{
  const l = lineaDeFases('revision_propuesta', [], HOY)
  ok('la línea funciona con la fase de hoy', estados(l) === 'nue:saltado seg:saltado pro:saltado rev:actual neg:pendiente gan:pendiente', estados(l))
  ok('sin fechas ni días en ningún paso', l.pasos.every((p) => p.desde === null && p.dias === null) && l.diasEnLaActual === null)
  ok('pero el avance sí se sabe (3 de 5)', Math.abs(l.avance - 0.6) < 1e-9)
}

console.log('\n=== el orden de entrada da igual ===')
{
  const h = [e('propuesta_enviada', '2026-10-18T10:00:00Z'), e('nuevo', '2026-10-01T10:00:00Z', 'alta'), e('seguimiento', '2026-10-05T10:00:00Z')]
  const l = lineaDeFases('propuesta_enviada', h, HOY)
  ok('el historial desordenado da la misma línea', estados(l) === 'nue:hecho seg:hecho pro:actual rev:pendiente neg:pendiente gan:pendiente' && l.diasEnLaActual === 9)
}

console.log('\n=== días y textos ===')
{
  ok('diasEntre cuenta días enteros', diasEntre('2026-10-18T10:00:00Z', HOY) === 9)
  ok('nunca sale negativo (una fecha del futuro es 0)', diasEntre('2026-11-18T10:00:00Z', HOY) === 0)
  ok('una fecha que no lo es: null', diasEntre('mañana', HOY) === null && diasEntre(null, HOY) === null && diasEntre(undefined, HOY) === null)
  ok('textoDeDias: hoy, ayer, hace 9 días, hace 2 meses', textoDeDias(0) === 'hoy' && textoDeDias(1) === 'ayer' && textoDeDias(9) === 'hace 9 días' && textoDeDias(65) === 'hace 2 meses' && textoDeDias(null) === null)
  ok('textoDeDuracion: menos de un día, 1 día, 9 días', textoDeDuracion(0) === 'menos de un día' && textoDeDuracion(1) === '1 día' && textoDeDuracion(9) === '9 días' && textoDeDuracion(null) === null)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
