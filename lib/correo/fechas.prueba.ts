import { fechaCompleta, fechaDeLista, hace } from '@/lib/correo/fechas'
import * as formato from '@/lib/correo/formato'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.parse('2026-11-16T10:00:00.000Z')
const antes = (ms: number) => new Date(AHORA - ms).toISOString()
const MIN = 60_000
const H = 60 * MIN
const D = 24 * H

console.log('\n=== reexporta las de formato.ts (una sola fuente) ===')
ok('fechaDeLista es la misma función', fechaDeLista === formato.fechaDeLista)
ok('fechaCompleta es la misma función', fechaCompleta === formato.fechaCompleta)
ok('fechaDeLista de hoy da la hora', fechaDeLista('2026-11-16T09:42:00.000Z', new Date(AHORA)) === '10:42', fechaDeLista('2026-11-16T09:42:00.000Z', new Date(AHORA)))

console.log('\n=== hace ===')
ok('hace 10 s: ahora mismo', hace(antes(10_000), AHORA) === 'ahora mismo', hace(antes(10_000), AHORA))
ok('hace 5 min', hace(antes(5 * MIN), AHORA) === 'hace 5 min', hace(antes(5 * MIN), AHORA))
ok('hace 3 h', hace(antes(3 * H), AHORA) === 'hace 3 h', hace(antes(3 * H), AHORA))
ok('hace 1 día: ayer', hace(antes(D), AHORA) === 'ayer', hace(antes(D), AHORA))
ok('hace 4 días', hace(antes(4 * D), AHORA) === 'hace 4 días', hace(antes(4 * D), AHORA))
ok('hace 20 días: la fecha corta', /^\d{1,2} [a-z]+\.?$/.test(hace(antes(20 * D), AHORA)), hace(antes(20 * D), AHORA))
ok('del futuro (reloj adelantado): ahora mismo, no una fecha', hace(new Date(AHORA + 2 * H).toISOString(), AHORA) === 'ahora mismo', hace(new Date(AHORA + 2 * H).toISOString(), AHORA))
ok('null: vacío', hace(null, AHORA) === '')
ok('undefined: vacío', hace(undefined, AHORA) === '')
ok('basura: vacío', hace('no es una fecha', AHORA) === '')
ok('sin ahora usa el reloj', hace(new Date().toISOString()) === 'ahora mismo')

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
if (fallos) process.exit(1)
