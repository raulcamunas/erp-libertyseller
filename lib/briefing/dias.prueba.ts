import { situacionDelDia } from '@/lib/briefing/dias'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

// 2026-10-26 es lunes, 27 martes, 23 viernes, 24 sábado, 25 domingo
console.log('\n=== el de hoy ===')
{
  const s = situacionDelDia({ dia: '2026-10-27', hoy: '2026-10-27', esElUltimo: true })
  ok('si es de hoy no hay nada que avisar', s.clase === 'hoy' && s.texto === '')
  ok('mirando el de hoy desde el selector tampoco', situacionDelDia({ dia: '2026-10-27', hoy: '2026-10-27', esElUltimo: false }).clase === 'hoy')
}

console.log('\n=== el último no es el de hoy ===')
{
  const lunes = situacionDelDia({ dia: '2026-10-26', hoy: '2026-10-27', esElUltimo: true })
  ok('un día laborable sin el de hoy: se avisa y se dice de qué día es el que se ve', lunes.clase === 'aviso' && lunes.texto.includes('Aún no ha llegado') && lunes.texto.includes('lun 26 oct'), lunes.texto)
  ok('el lunes sin el del viernes también avisa', situacionDelDia({ dia: '2026-10-23', hoy: '2026-10-26', esElUltimo: true }).clase === 'aviso')
  ok('un sábado con el del viernes es lo normal: sin aviso', situacionDelDia({ dia: '2026-10-23', hoy: '2026-10-24', esElUltimo: true }).clase === 'normal')
  ok('un domingo con el del viernes también', situacionDelDia({ dia: '2026-10-23', hoy: '2026-10-25', esElUltimo: true }).clase === 'normal')
  const largo = situacionDelDia({ dia: '2026-10-20', hoy: '2026-10-25', esElUltimo: true })
  ok('un domingo con el del martes anterior: hace cinco días, se avisa', largo.clase === 'aviso' && largo.texto.includes('Hace 5 días') && largo.texto.includes('mar 20 oct'), largo.texto)
}

console.log('\n=== un día pasado elegido a propósito ===')
{
  const s = situacionDelDia({ dia: '2026-10-22', hoy: '2026-10-27', esElUltimo: false })
  ok('se dice que es histórico y de qué día', s.clase === 'historico' && s.texto.includes('jue 22 oct'), s.texto)
  ok('sin importar si hoy es laborable o no', situacionDelDia({ dia: '2026-10-22', hoy: '2026-10-25', esElUltimo: false }).clase === 'historico')
}

console.log('\n=== uno de mañana ===')
{
  const s = situacionDelDia({ dia: '2026-10-28', hoy: '2026-10-27', esElUltimo: true })
  ok('publicado con adelanto: se dice', s.clase === 'adelantado' && s.texto.includes('mié 28 oct'), s.texto)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
