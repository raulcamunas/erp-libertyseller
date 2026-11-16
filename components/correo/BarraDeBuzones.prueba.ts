/**
 * Pruebas de la lógica pura de BarraDeBuzones.tsx (reparto, orden, sin leer, ⚠ y carpeta activa).
 *   cd /Users/raulcamunas/Dev/ERP-correo && npx tsx components/correo/BarraDeBuzones.prueba.ts
 */
import assert from 'node:assert/strict'
import type { BuzonVisible } from '@/lib/correo/tipos'
import { alertaDeBuzon, claveActiva, repartirBuzones, sumarSinLeerMios } from './BarraDeBuzones'

let ok = 0
const caso = (nombre: string, fn: () => void) => {
  fn()
  ok++
  console.log(`✓ ${nombre}`)
}

const buzon = (id: string, parche: Partial<BuzonVisible> = {}): BuzonVisible => ({
  id,
  direccion: `${id}@libertyseller.es`,
  nombre: null,
  proveedor: 'hostinger',
  propietario: { id: `p-${id}`, nombre: id },
  esMio: false,
  conectado: true,
  credencialesInvalidas: false,
  ultimoSyncAt: null,
  ultimoError: null,
  historicoCompleto: true,
  desdeFecha: '2026-01-01',
  firma: null,
  resumen: { hilos: 0, hilosSinLeer: 0, sinLeer: 0, esperandoRespuesta: 0, ultimoMensajeAt: null },
  puedeResponder: false,
  asignado: false,
  enMisCorreos: false,
  orden: null,
  silenciado: false,
  silenciadoHasta: null,
  asignaciones: [],
  hilosSinLeerMios: 0,
  ...parche,
})

caso('reparto: Mis buzones (enMisCorreos) y Equipo (el resto)', () => {
  const r = repartirBuzones([buzon('jose'), buzon('stock', { esMio: true, enMisCorreos: true }), buzon('daniela', { asignado: true, enMisCorreos: true })])
  assert.deepEqual(r.mios.map((b) => b.id), ['stock', 'daniela'])
  assert.deepEqual(r.equipo.map((b) => b.id), ['jose'])
})

caso('orden de Mis buzones: orden elegido, luego propios, asignados y dirección', () => {
  const r = repartirBuzones([
    buzon('zeta', { enMisCorreos: true }),
    buzon('asig', { enMisCorreos: true, asignado: true }),
    buzon('mio', { enMisCorreos: true, esMio: true }),
    buzon('primero', { enMisCorreos: true, orden: 0 }),
    buzon('alfa', { enMisCorreos: true }),
  ])
  assert.deepEqual(r.mios.map((b) => b.id), ['primero', 'mio', 'asig', 'alfa', 'zeta'])
})

caso('un propio quitado de Mis correos va a Equipo', () => {
  const r = repartirBuzones([buzon('stock', { esMio: true, enMisCorreos: false })])
  assert.equal(r.mios.length, 0)
  assert.equal(r.equipo[0].id, 'stock')
})

caso('sin leer de Mis correos: solo los elegidos y sin silenciar', () => {
  const n = sumarSinLeerMios([
    buzon('a', { enMisCorreos: true, hilosSinLeerMios: 7 }),
    buzon('b', { enMisCorreos: true, hilosSinLeerMios: 3, silenciado: true }),
    buzon('c', { enMisCorreos: false, hilosSinLeerMios: 5 }),
    buzon('d', { enMisCorreos: true, hilosSinLeerMios: -2 }),
  ])
  assert.equal(n, 7)
})

caso('⚠: contraseña rechazada manda sobre desconectado', () => {
  assert.equal(alertaDeBuzon({ conectado: false, credencialesInvalidas: true }), 'contrasena')
  assert.equal(alertaDeBuzon({ conectado: false, credencialesInvalidas: false }), 'desconectado')
  assert.equal(alertaDeBuzon({ conectado: true, credencialesInvalidas: false }), null)
})

caso('carpeta activa', () => {
  assert.equal(claveActiva({ tipo: 'mios' }), 'mios')
  assert.equal(claveActiva({ tipo: 'mios' }, 'todos'), 'mios')
  assert.equal(claveActiva({ tipo: 'mios' }, 'destacados'), 'destacados')
  assert.equal(claveActiva({ tipo: 'mios' }, 'pendientes'), 'pendientes')
  assert.equal(claveActiva({ tipo: 'buzon', buzonId: 'x' }, 'destacados'), 'buzon:x')
  assert.equal(claveActiva({ tipo: 'asignados' }), 'asignados')
  assert.equal(claveActiva({ tipo: 'equipo' }), 'equipo')
  assert.equal(claveActiva({ tipo: 'secuencias' }), 'secuencias')
})

console.log(`\n${ok} casos bien`)
