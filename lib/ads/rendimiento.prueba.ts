import { periodosDe } from './rendimiento'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== periodos del informe ===')
{
  const p = periodosDe('2026-11-11', 14)
  ok('acaba AYER (hoy está a medias)', p.actual.hasta === '2026-11-10', JSON.stringify(p))
  ok('14 días: del 28 de octubre al 10 de noviembre', p.actual.desde === '2026-10-28')
  ok('el anterior son los 14 días justo antes, sin solaparse', p.anterior.hasta === '2026-10-27' && p.anterior.desde === '2026-10-14')
  const q = periodosDe('2026-03-02', 7)
  ok('cruza febrero (2026 no es bisiesto)', q.actual.desde === '2026-02-23' && q.actual.hasta === '2026-03-01' && q.anterior.desde === '2026-02-16')
  const t = periodosDe('2026-11-11', 30)
  ok('30 días: cada informe cabe en 31 días', t.actual.desde === '2026-10-12' && t.anterior.desde === '2026-09-12')
}
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
