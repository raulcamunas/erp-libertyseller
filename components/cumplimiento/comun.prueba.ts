import { cuentaAtras } from '@/components/cumplimiento/comun'

/**
 * Pruebas de la cuenta atrás del plazo de Amazon (el chip de las tarjetas de «Hoy»).
 * Se ejecuta con `npx tsx components/cumplimiento/comun.prueba.ts`.
 */

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
// Por la tarde, para comprobar que cuenta días de calendario y no de 24 h desde ahora
const HOY = new Date('2026-11-14T18:00:00Z')
const v = (p: string) => cuentaAtras(p, HOY)

console.log('\n=== cuenta atrás del plazo ===')
ok('hoy', v('2026-11-14').texto === 'Vence hoy' && v('2026-11-14').tono === 'rojo', JSON.stringify(v('2026-11-14')))
ok('mañana', v('2026-11-15').texto === 'Vence mañana')
ok('en 6 días, rojo', v('2026-11-20').texto === 'Vence en 6 días' && v('2026-11-20').tono === 'rojo')
ok('en 26 días, ámbar', v('2026-12-10').dias === 26 && v('2026-12-10').tono === 'ambar')
ok('lejos, gris', v('2027-03-01').tono === 'gris')
ok('ayer', v('2026-11-13').texto === 'Vencido ayer')
ok('vencido hace meses', v('2026-08-12').texto === 'Vencido hace 94 días' && v('2026-08-12').tono === 'rojo', JSON.stringify(v('2026-08-12')))
ok('fecha rota', v('no-es-fecha').tono === 'gris')

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `${fallos} FALLOS`}\n`)
if (fallos > 0) process.exit(1)
