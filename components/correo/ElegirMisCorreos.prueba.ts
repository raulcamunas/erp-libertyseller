/**
 * Pruebas de la lógica pura de ElegirMisCorreos.tsx (secciones, cambios a guardar y silencio efectivo).
 *   cd /Users/raulcamunas/Dev/ERP-correo && npx tsx components/correo/ElegirMisCorreos.prueba.ts
 */
import assert from 'node:assert/strict'
import type { BuzonVisible } from '@/lib/correo/tipos'
import { validarPeticionDePreferencias } from '@/lib/correo/preferencias'
import { cambiosDeEleccion, eleccionInicial, seccionesDeEleccion, silenciadosParaPantalla, silencioEfectivo } from './ElegirMisCorreos'

let ok = 0
const caso = (nombre: string, fn: () => void) => {
  fn()
  ok++
  console.log(`✓ ${nombre}`)
}

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
const buzon = (n: number, parche: Partial<BuzonVisible> = {}): BuzonVisible => ({
  id: ID(n),
  direccion: `b${n}@libertyseller.es`,
  nombre: null,
  proveedor: 'hostinger',
  propietario: { id: `p${n}`, nombre: `Persona ${n}` },
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

const mio = buzon(1, { esMio: true, enMisCorreos: true, puedeResponder: true })
const asignado = buzon(2, { asignado: true, enMisCorreos: true, silenciado: true, silenciadoHasta: null })
const equipo = buzon(3)
const todos = [equipo, asignado, mio]

caso('secciones: tuyos, asignados a ti y del equipo', () => {
  const s = seccionesDeEleccion(todos)
  assert.deepEqual(s.tuyos.map((b) => b.id), [ID(1)])
  assert.deepEqual(s.asignados.map((b) => b.id), [ID(2)])
  assert.deepEqual(s.equipo.map((b) => b.id), [ID(3)])
})

caso('sin tocar nada no hay cambios', () => assert.deepEqual(cambiosDeEleccion(todos, eleccionInicial(todos)), []))

caso('añadir uno del equipo y quitar uno propio: dos cambios, solo enMisCorreos', () => {
  const e = eleccionInicial(todos)
  e[ID(3)] = { enMisCorreos: true }
  e[ID(1)] = { enMisCorreos: false }
  assert.deepEqual(cambiosDeEleccion(todos, e), [
    { buzonId: ID(3), enMisCorreos: true },
    { buzonId: ID(1), enMisCorreos: false },
  ])
})

caso('marcar y desmarcar vuelve a no tener cambios', () => {
  const e = eleccionInicial(todos)
  e[ID(3)] = { enMisCorreos: false }
  assert.deepEqual(cambiosDeEleccion(todos, e), [])
})

caso('silenciar uno sin silenciar y quitar el silencio a otro: en el mismo envío', () => {
  const e = eleccionInicial(todos)
  e[ID(1)] = { enMisCorreos: true, silencio: 'semana' }
  e[ID(2)] = { enMisCorreos: true, silencio: 'quitar' }
  const c = cambiosDeEleccion(todos, e)
  assert.deepEqual(c, [
    { buzonId: ID(2), silencio: 'quitar' },
    { buzonId: ID(1), silencio: 'semana' },
  ])
  // Lo que se manda pasa la validación de la ruta
  const v = validarPeticionDePreferencias({ cambios: c })
  assert.equal(v.ok, true, JSON.stringify(v))
})

caso('«quitar» sobre uno que no estaba silenciado no se manda', () => {
  const e = eleccionInicial(todos)
  e[ID(3)] = { enMisCorreos: false, silencio: 'quitar' }
  assert.deepEqual(cambiosDeEleccion(todos, e), [])
})

caso('un buzón que ya no se lee no se manda', () => {
  const e = eleccionInicial(todos)
  e['00000000-0000-4000-8000-000000000009'] = { enMisCorreos: true }
  assert.deepEqual(cambiosDeEleccion(todos, e), [])
})

caso('silencio efectivo: lo de ahora, lo quitado y una duración nueva', () => {
  const ahora = new Date('2026-11-16T09:00:00Z')
  assert.deepEqual(silencioEfectivo(asignado, undefined, ahora), { silenciado: true, hasta: null })
  assert.deepEqual(silencioEfectivo(asignado, { enMisCorreos: true, silencio: 'quitar' }, ahora), { silenciado: false, hasta: null })
  assert.deepEqual(silencioEfectivo(mio, { enMisCorreos: true, silencio: '8h' }, ahora), { silenciado: true, hasta: '2026-11-16T17:00:00.000Z' })
  assert.deepEqual(silencioEfectivo(mio, { enMisCorreos: true, silencio: 'siempre' }, ahora), { silenciado: true, hasta: null })
})

caso('«Silenciados»: remitentes primero, luego conversaciones, por orden; lo reactivado ya no sale', () => {
  const datos = {
    disponible: true,
    remitentes: [{ direccion: 'zeta@ruido.com', hasta: null }, { direccion: 'avisos@tienda.es', hasta: '2026-11-17T08:00:00Z' }],
    hilos: [{ hiloId: 'h2', asunto: 'Pedido 22', hasta: null }, { hiloId: 'h1', asunto: '  ', hasta: null }],
  }
  const lista = silenciadosParaPantalla(datos)
  assert.deepEqual(lista.map((x) => `${x.tipo}:${x.texto}`), ['remitente:avisos@tienda.es', 'remitente:zeta@ruido.com', 'hilo:(sin asunto)', 'hilo:Pedido 22'])
  assert.deepEqual(silenciadosParaPantalla(datos, new Set(['remitente:zeta@ruido.com', 'hilo:h1'])).map((x) => x.clave), ['avisos@tienda.es', 'h2'])
})

caso('«Silenciados»: sin datos o con basura, lista vacía', () => {
  assert.deepEqual(silenciadosParaPantalla(null), [])
  assert.deepEqual(silenciadosParaPantalla({ remitentes: [{ direccion: '', hasta: null }], hilos: [{ hiloId: '', asunto: 'x', hasta: null }] }), [])
})

console.log(`\n${ok} casos bien`)
