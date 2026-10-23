import {
  AVISO_ANTES_S,
  debeCerrarseLaSesion,
  estadoDeInactividad,
  limiteDeInactividadMin,
  MINUTOS_MAXIMOS,
  MINUTOS_MINIMOS,
  MINUTOS_POR_DEFECTO,
  ultimaActividadEfectiva,
} from '@/lib/actividad/inactividad'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const MIN = 60_000
const AHORA = Date.UTC(2026, 9, 23, 12, 0, 0)

console.log('\n=== el límite que se configura ===')
ok('sin configurar: 30', limiteDeInactividadMin(undefined) === MINUTOS_POR_DEFECTO && MINUTOS_POR_DEFECTO === 30)
ok('un texto con un número', limiteDeInactividadMin('45') === 45)
ok('un número', limiteDeInactividadMin(20) === 20)
ok('con espacios', limiteDeInactividadMin(' 15 ') === 15)
ok('vacío o basura: el de siempre', limiteDeInactividadMin('') === 30 && limiteDeInactividadMin('abc') === 30 && limiteDeInactividadMin(null) === 30 && limiteDeInactividadMin(NaN) === 30)
ok('un decimal se redondea', limiteDeInactividadMin('15.6') === 16)
ok('menos de 5 min no vale: se sube a 5 (con 1 min echarían a todos)', limiteDeInactividadMin('1') === MINUTOS_MINIMOS && limiteDeInactividadMin(0) === MINUTOS_MINIMOS && limiteDeInactividadMin(-5) === MINUTOS_MINIMOS)
ok('más de 12 horas tampoco: se baja a 720', limiteDeInactividadMin('5000') === MINUTOS_MAXIMOS)

console.log('\n=== la pestaña, con límite de 30 min ===')
const e = (minSinTocar: number, seg = 0) => estadoDeInactividad(AHORA, AHORA - minSinTocar * MIN - seg * 1000, 30)
ok('recién tocada: activa', e(0).fase === 'activa')
ok('a los 20 min sigue activa', e(20).fase === 'activa')
ok('a los 28 min (faltan 120 s) sigue activa', e(28).fase === 'activa')
ok(`a los 29 min faltan 60 s: sale el aviso (${AVISO_ANTES_S} s antes)`, JSON.stringify(e(29)) === '{"fase":"aviso","segundos":60}', JSON.stringify(e(29)))
ok('a los 29:30 faltan 30 s', JSON.stringify(e(29, 30)) === '{"fase":"aviso","segundos":30}', JSON.stringify(e(29, 30)))
ok('a los 29:59 falta 1 s', JSON.stringify(e(29, 59)) === '{"fase":"aviso","segundos":1}', JSON.stringify(e(29, 59)))
ok('a los 30 min en punto se cierra', e(30).fase === 'cerrar')
ok('a los 45 min, también', e(45).fase === 'cerrar')
ok('tras una noche entera, también (el portátil dormía)', e(600).fase === 'cerrar')
ok('un reloj que va por delante (último toque «en el futuro») no cierra', estadoDeInactividad(AHORA, AHORA + 5 * MIN, 30).fase === 'activa')
ok('con otro límite (10 min), a los 9 min avisa', estadoDeInactividad(AHORA, AHORA - 9 * MIN, 10).fase === 'aviso')

console.log('\n=== la última actividad ===')
ok('la más reciente', ultimaActividadEfectiva(100, 300, 200) === 300)
ok('ignora lo que falta', ultimaActividadEfectiva(null, 50, undefined) === 50)
ok('sin nada: null', ultimaActividadEfectiva(null, undefined) === null && ultimaActividadEfectiva() === null)
ok('ignora lo que no es número', ultimaActividadEfectiva(NaN, 7, Infinity) === 7)

console.log('\n=== la decisión del servidor ===')
const d = (parte: Partial<Parameters<typeof debeCerrarseLaSesion>[0]>) =>
  debeCerrarseLaSesion({ rol: 'employee', ahoraMs: AHORA, ultimoEventoMs: AHORA - 5 * MIN, inicioDeSesionMs: AHORA - 600 * MIN, limiteMin: 30, ...parte })
ok('un empleado con un movimiento reciente: no se cierra', d({}) === false)
ok('un empleado parado hace 31 min (y sesión vieja): se cierra', d({ ultimoEventoMs: AHORA - 31 * MIN }) === true)
ok('justo en el límite: se cierra', d({ ultimoEventoMs: AHORA - 30 * MIN }) === true)
ok('a punto de cumplirse el límite: no', d({ ultimoEventoMs: AHORA - 29 * MIN - 59_000 }) === false)
ok('SIN movimientos apuntados pero con un inicio de sesión reciente: no se cierra (nada más entrar)', d({ ultimoEventoMs: null, inicioDeSesionMs: AHORA - 20_000 }) === false)
ok('con un movimiento viejo pero un inicio de sesión de hace 2 minutos: no se cierra (el apunte del login aún no ha llegado)', d({ ultimoEventoMs: AHORA - 300 * MIN, inicioDeSesionMs: AHORA - 2 * MIN }) === false)
ok('sin movimientos y con una sesión de hace 3 días: se cierra (es lo que se quiere el primer día)', d({ ultimoEventoMs: null, inicioDeSesionMs: AHORA - 3 * 24 * 60 * MIN }) === true)
ok('SIN NINGÚN DATO: no se echa a nadie', d({ ultimoEventoMs: null, inicioDeSesionMs: null }) === false)
for (const rol of ['admin', 'partner', 'cliente', 'client', null, undefined, 'otro']) {
  ok(`rol «${String(rol)}»: nunca se cierra`, d({ rol: rol as string | null | undefined, ultimoEventoMs: AHORA - 9999 * MIN, inicioDeSesionMs: AHORA - 9999 * MIN }) === false)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
