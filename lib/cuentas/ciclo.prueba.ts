import { lunesDe, pasosDeSemana, progresoDeSemana, semanaDelCiclo, ventanaDelInforme } from './ciclo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** EL CICLO S1–S4 DE CADA CUENTA */

console.log('\n=== el lunes de cada fecha ===')
ok('un sábado cae en su lunes', lunesDe('2026-11-14') === '2026-11-09', lunesDe('2026-11-14'))
ok('un lunes es su propio lunes', lunesDe('2026-11-09') === '2026-11-09')
ok('un domingo es del lunes anterior, no del siguiente', lunesDe('2026-11-15') === '2026-11-09', lunesDe('2026-11-15'))

console.log('\n=== qué semana toca ===')
ok('sin inicio no hay semana', semanaDelCiclo(null, '2026-11-14') === null)
ok('un inicio en el futuro no da semana', semanaDelCiclo('2026-11-23', '2026-11-14') === null)
ok('la semana del inicio es la S1', semanaDelCiclo('2026-11-09', '2026-11-14')?.semana === 1)
ok('una semana después, S2', semanaDelCiclo('2026-11-02', '2026-11-14')?.semana === 2)
ok('tras la S4 vuelve la S1 del ciclo 2', (() => { const s = semanaDelCiclo('2026-10-12', '2026-11-14'); return s?.semana === 1 && s.ciclo === 2 && s.inicioDelCiclo === '2026-11-09' })(), JSON.stringify(semanaDelCiclo('2026-10-12', '2026-11-14')))
ok('un inicio en miércoles cuenta desde su lunes', semanaDelCiclo('2026-10-21', '2026-11-14')?.semana === 4)
ok('el cambio de hora no descoloca la semana (25 oct)', semanaDelCiclo('2026-10-19', '2026-10-26')?.semana === 2)

console.log('\n=== la ventana del informe acaba el domingo anterior ===')
const s2 = semanaDelCiclo('2026-11-02', '2026-11-14')!
const v2 = ventanaDelInforme(s2)
ok('S2: 14 días hasta el domingo 8', v2.desde === '2026-10-26' && v2.hasta === '2026-11-08' && v2.dias === 14, JSON.stringify(v2))
const v4 = ventanaDelInforme(semanaDelCiclo('2026-10-19', '2026-11-14')!)
ok('S4: 30 días', v4.dias === 30 && v4.hasta === '2026-11-08' && v4.desde === '2026-10-10', JSON.stringify(v4))

console.log('\n=== los pasos respetan la regla de separación ===')
const tienePujas = (s: 1 | 2 | 3 | 4) => pasosDeSemana(s).some((p) => p.titulo.includes('pujas'))
const tieneFicha = (s: 1 | 2 | 3 | 4) => pasosDeSemana(s).some((p) => p.id === 'ficha')
ok('pujas solo en S2 y S4', !tienePujas(1) && tienePujas(2) && !tienePujas(3) && tienePujas(4))
ok('ficha solo en S3, nunca con pujas', !tieneFicha(1) && !tieneFicha(2) && tieneFicha(3) && !tieneFicha(4))
ok('todas las semanas empiezan por lo que bloquea la venta', ([1, 2, 3, 4] as const).every((s) => pasosDeSemana(s)[0].id === 'cumplimiento'))
ok('todas acaban con su informe al cliente', ([1, 2, 3, 4] as const).every((s) => pasosDeSemana(s).at(-1)!.area === 'informe'))
ok('el informe de S4 es el mensual y el de S2 el quincenal', pasosDeSemana(4).at(-1)!.id === 'informe-mensual' && pasosDeSemana(2).at(-1)!.id === 'informe-quincenal')
ok('ningún paso se repite en una semana', ([1, 2, 3, 4] as const).every((s) => new Set(pasosDeSemana(s).map((p) => p.id)).size === pasosDeSemana(s).length))

console.log('\n=== progreso ===')
const pr = progresoDeSemana(2, new Set(['cumplimiento', 'auditoria']))
ok('cuenta lo hecho y dice lo siguiente', pr.hechos === 2 && pr.total === 4 && pr.siguiente?.id === 'propuestas', JSON.stringify(pr))
ok('todo hecho: no hay siguiente', progresoDeSemana(1, new Set(['cumplimiento', 'propuestas', 'informe-semanal'])).siguiente === null)

console.log(fallos ? `\n${fallos} FALLOS\n` : '\nTodo bien\n')
if (fallos) process.exit(1)
