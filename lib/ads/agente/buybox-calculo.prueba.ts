import { congelado, siguienteFila, tocaAvisar } from './buybox-calculo'

let fallos = 0
const ok = (nombre: string, cond: boolean, extra?: unknown) => {
  if (!cond) {
    fallos++
    console.error('✗', nombre, extra ?? '')
  } else console.log('✓', nombre)
}
const H = 3_600_000
const t0 = Date.parse('2026-11-28T10:00:00Z')

let f = siguienteFila(null, 'B0', 'nuestra', t0)
ok('nuestra no congela', !congelado(f, t0).congelado)

f = siguienteFila(f, 'B0', 'de_otro', t0 + H)
ok('pierde: sinDesde', f.sinDesde === new Date(t0 + H).toISOString())
ok('a la hora no congela', !congelado(f, t0 + 2 * H).congelado)
ok('a la hora no avisa', !tocaAvisar(f, t0 + 2 * H))
f = siguienteFila(f, 'B0', 'nadie', t0 + 3 * H)
ok('sigue sin: conserva sinDesde', f.sinDesde === new Date(t0 + H).toISOString())
ok('a las 2 h congela', congelado(f, t0 + 3 * H).congelado)
ok('a las 2 h avisa', tocaAvisar(f, t0 + 3 * H))
f = { ...f, avisadaAt: new Date(t0 + 3 * H).toISOString() }
f = siguienteFila(f, 'B0', 'desconocido', t0 + 4 * H)
ok('desconocido no cambia', f.sinDesde != null && f.avisadaAt != null)
ok('avisado una vez', !tocaAvisar(f, t0 + 4 * H))

// Recupera tras 5 h: no congela después (pérdida corta)
f = siguienteFila(f, 'B0', 'nuestra', t0 + 6 * H)
ok('recupera: perdida 5 h', f.perdidaHoras === 5 && f.sinDesde === null)
ok('pérdida corta no congela', !congelado(f, t0 + 7 * H).congelado)

// Pérdida de 30 h: congela 7 días tras recuperar
let g = siguienteFila(null, 'B1', 'de_otro', t0)
g = siguienteFila(g, 'B1', 'nuestra', t0 + 30 * H)
ok('pérdida larga congela 3 días después', congelado(g, t0 + 30 * H + 3 * 24 * H).congelado)
ok('pérdida larga no congela a los 8 días', !congelado(g, t0 + 30 * H + 8 * 24 * H).congelado)

if (fallos) {
  console.error(`${fallos} fallos`)
  process.exit(1)
}
