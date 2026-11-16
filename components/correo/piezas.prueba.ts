/**
 * Pruebas de la lógica pura de piezas.tsx (textoDeSilencio y el menú de duraciones).
 *   cd /Users/raulcamunas/Dev/ERP-correo && npx tsx components/correo/piezas.prueba.ts
 */
import assert from 'node:assert/strict'
import { DURACIONES, ETIQUETA_DE_DURACION, textoDeSilencio } from './piezas'

let ok = 0
const caso = (nombre: string, fn: () => void) => {
  fn()
  ok++
  console.log(`✓ ${nombre}`)
}

// Lunes 16 nov 2026, 10:00 en Madrid (09:00 UTC, horario de invierno)
const AHORA = Date.parse('2026-11-16T09:00:00Z')

caso('sin silenciar', () => assert.equal(textoDeSilencio(false, '2026-11-16T15:00:00Z', AHORA), 'Sin silenciar'))
caso('para siempre', () => assert.equal(textoDeSilencio(true, null, AHORA), 'Silenciado para siempre'))
caso('hoy: solo la hora de Madrid', () => assert.equal(textoDeSilencio(true, '2026-11-16T17:00:00Z', AHORA), 'Silenciado hasta las 18:00'))
caso('mañana a las 8:00', () => assert.equal(textoDeSilencio(true, '2026-11-17T07:00:00Z', AHORA), 'Silenciado hasta mañana a las 8:00'))
caso('8 h que cruzan la medianoche de Madrid cuentan como mañana', () =>
  assert.equal(textoDeSilencio(true, '2026-11-16T23:30:00Z', Date.parse('2026-11-16T15:30:00Z')), 'Silenciado hasta mañana a las 0:30'))
caso('dentro de la semana: el día', () => assert.equal(textoDeSilencio(true, '2026-11-20T08:00:00Z', AHORA), 'Silenciado hasta el viernes a las 9:00'))
caso('una semana o más: la fecha', () => assert.equal(textoDeSilencio(true, '2026-11-23T09:00:00Z', AHORA), 'Silenciado hasta el 23 nov'))
caso('fecha rota no revienta', () => assert.equal(textoDeSilencio(true, 'no-es-fecha', AHORA), 'Silenciado'))
caso('cambio de hora (29 mar 2026): mañana sigue siendo mañana', () =>
  assert.equal(textoDeSilencio(true, '2026-03-29T06:00:00Z', Date.parse('2026-03-28T20:00:00Z')), 'Silenciado hasta mañana a las 8:00'))
caso('las cuatro duraciones, en orden y con texto', () => {
  assert.deepEqual([...DURACIONES], ['8h', 'manana', 'semana', 'siempre'])
  for (const d of DURACIONES) assert.ok(ETIQUETA_DE_DURACION[d].length > 0)
  assert.equal(ETIQUETA_DE_DURACION.manana, 'Hasta mañana a las 8:00')
})

console.log(`\n${ok} pruebas bien`)
