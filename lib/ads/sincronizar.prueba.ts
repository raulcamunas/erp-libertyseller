import { debeEmpezar, ESPERA_MAXIMA_MS, INTERVALO_MS, periodosAPedir, REINTENTO_TRAS_ERROR_MS } from './sincronizar'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.parse('2026-11-11T12:00:00Z')
const base = { ultimoOkAt: null as number | null, pedidoAt: null as number | null, hayError: false, ahora: AHORA, forzar: false }

console.log('\n=== qué se pide ===')
{
  const p = periodosAPedir('2026-11-11', true)
  ok('primera lectura: dos informes de 30 días que suman 60 y acaban ayer', p.length === 2 && p[1].hasta === '2026-11-10' && p[1].desde === '2026-10-12' && p[0].hasta === '2026-10-11' && p[0].desde === '2026-09-12', JSON.stringify(p))
  ok('los dos informes no se solapan ni dejan hueco', p[0].hasta === '2026-10-11' && p[1].desde === '2026-10-12')
  const r = periodosAPedir('2026-11-11', false)
  ok('repaso: 14 días hasta ayer', r.length === 1 && r[0].desde === '2026-10-28' && r[0].hasta === '2026-11-10', JSON.stringify(r))
  ok('ningún informe pasa de 31 días (límite del desglose diario)', [...p, ...r].every((x) => (Date.parse(x.hasta) - Date.parse(x.desde)) / 86_400_000 + 1 <= 31))
}

console.log('\n=== cuándo toca ===')
{
  ok('nunca se ha leído: toca', debeEmpezar(base))
  ok('leído hace 1 h: no toca', !debeEmpezar({ ...base, ultimoOkAt: AHORA - 3_600_000 }))
  ok('leído hace 3 h justas: toca', debeEmpezar({ ...base, ultimoOkAt: AHORA - INTERVALO_MS }))
  ok('leído hace 2 h 59 min: no toca', !debeEmpezar({ ...base, ultimoOkAt: AHORA - INTERVALO_MS + 60_000 }))
  ok('tras un error reciente no se reintenta (10 min)', !debeEmpezar({ ...base, ultimoOkAt: AHORA - 5 * 3_600_000, hayError: true, pedidoAt: AHORA - 10 * 60_000 }))
  ok('tras un error de hace más de 30 min se reintenta', debeEmpezar({ ...base, ultimoOkAt: AHORA - 5 * 3_600_000, hayError: true, pedidoAt: AHORA - REINTENTO_TRAS_ERROR_MS - 1000 }))
  ok('error en la primera lectura: también espera 30 min', !debeEmpezar({ ...base, hayError: true, pedidoAt: AHORA - 60_000 }) && debeEmpezar({ ...base, hayError: true, pedidoAt: AHORA - REINTENTO_TRAS_ERROR_MS - 1 }))
  ok('«Actualizar» fuerza aunque se haya leído hace nada', debeEmpezar({ ...base, ultimoOkAt: AHORA - 60_000, forzar: true }))
  ok('dos «Actualizar» seguidos (hace 20 s) no piden dos veces', !debeEmpezar({ ...base, ultimoOkAt: AHORA - 60_000, pedidoAt: AHORA - 20_000, forzar: true }))
  ok('«Actualizar» tras un error reciente SÍ vale (es una persona pidiéndolo)', debeEmpezar({ ...base, hayError: true, pedidoAt: AHORA - 5 * 60_000, forzar: true }))
}

console.log('\n=== constantes ===')
{
  ok('se espera a Amazon como mucho 25 min', ESPERA_MAXIMA_MS === 25 * 60_000)
  ok('lectura nueva cada 3 horas', INTERVALO_MS === 3 * 3_600_000)
}
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
