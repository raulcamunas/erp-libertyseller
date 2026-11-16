/**
 * Pruebas de la lógica pura de AjustesDeBuzon.tsx y ActualizarCorreo.tsx (rastro, pestañas por persona, estado y «Actualizado hace…»).
 *   cd /Users/raulcamunas/Dev/ERP-correo && npx tsx components/correo/AjustesDeBuzon.prueba.ts
 */
import assert from 'node:assert/strict'
import { estadoDeBuzon, fraseDeAcceso, pestanasVisibles } from './AjustesDeBuzon'
import { textoDeActualizado } from './ActualizarCorreo'

let ok = 0
const caso = (nombre: string, fn: () => void) => {
  fn()
  ok++
  console.log(`✓ ${nombre}`)
}

caso('rastro: «envio» con asunto y sin él', () => {
  assert.equal(fraseDeAcceso({ accion: 'envio', asunto: 'Re: presupuesto' }), 'envió “Re: presupuesto”')
  assert.equal(fraseDeAcceso({ accion: 'envio', asunto: null }), 'envió un correo')
  assert.equal(fraseDeAcceso({ accion: 'envio', asunto: '   ' }), 'envió un correo')
})

caso('rastro: «aviso» con asunto y sin él', () => {
  assert.equal(fraseDeAcceso({ accion: 'aviso', asunto: 'Pedido 42' }), 'vio el aviso de “Pedido 42”')
  assert.equal(fraseDeAcceso({ accion: 'aviso', asunto: null }), 'vio el aviso de un correo nuevo')
})

caso('rastro: las acciones de siempre', () => {
  assert.equal(fraseDeAcceso({ accion: 'lista', asunto: null }), 'miró la lista de correos')
  assert.equal(fraseDeAcceso({ accion: 'hilo', asunto: 'Hola' }), 'abrió “Hola”')
  assert.equal(fraseDeAcceso({ accion: 'hilo', asunto: null }), 'abrió una conversación')
  assert.equal(fraseDeAcceso({ accion: 'busqueda', asunto: null }), 'buscó en el buzón')
  assert.equal(fraseDeAcceso({ accion: 'adjunto', asunto: 'Factura' }), 'descargó un adjunto de “Factura”')
  assert.equal(fraseDeAcceso({ accion: 'adjunto', asunto: null }), 'descargó un adjunto')
})

caso('rastro: una acción desconocida nunca sale vacía', () => {
  assert.equal(fraseDeAcceso({ accion: 'otra_cosa', asunto: 'x' }), 'miró el buzón')
})

caso('pestañas: el dueño (no admin) no ve el rastro', () => {
  assert.deepEqual(pestanasVisibles({ esMio: true, esAdmin: false }), ['general', 'conexion', 'trabajan', 'silenciar'])
})

caso('pestañas: un admin ve todo, también en un buzón ajeno', () => {
  assert.deepEqual(pestanasVisibles({ esMio: false, esAdmin: true }), ['general', 'conexion', 'trabajan', 'rastro', 'silenciar'])
  assert.deepEqual(pestanasVisibles({ esMio: true, esAdmin: true }), ['general', 'conexion', 'trabajan', 'rastro', 'silenciar'])
})

caso('pestañas: quien lo tiene asignado (ni dueño ni admin) solo ve General y Silenciar', () => {
  assert.deepEqual(pestanasVisibles({ esMio: false, esAdmin: false }), ['general', 'silenciar'])
})

caso('estado de la conexión, con su prioridad', () => {
  assert.equal(estadoDeBuzon({ conectado: false, credencialesInvalidas: true, ultimoError: 'x' }), 'desconectado')
  assert.equal(estadoDeBuzon({ conectado: true, credencialesInvalidas: true, ultimoError: 'x' }), 'rechazada')
  assert.equal(estadoDeBuzon({ conectado: true, credencialesInvalidas: false, ultimoError: 'x' }), 'aviso')
  assert.equal(estadoDeBuzon({ conectado: true, credencialesInvalidas: false, ultimoError: null }), 'bien')
})

const AHORA = Date.parse('2026-11-16T09:00:00Z')

caso('«Actualizado hace…»: corto en el móvil y largo desde md, con hace() de fechas.ts', () => {
  const t = textoDeActualizado({ ultimoSyncAt: new Date(AHORA - 5 * 60_000).toISOString(), sincronizando: false, conectado: true }, AHORA)
  assert.deepEqual(t, { corto: 'hace 5 min', largo: 'Actualizado hace 5 min' })
})

caso('«Actualizado hace…»: una fecha que viene del futuro cuenta como «ahora mismo»', () => {
  const t = textoDeActualizado({ ultimoSyncAt: new Date(AHORA + 30_000).toISOString(), sincronizando: false, conectado: true }, AHORA)
  assert.equal(t.largo, 'Actualizado ahora mismo')
})

caso('«Actualizado hace…»: buscando, sin leer aún y desconectado', () => {
  assert.deepEqual(textoDeActualizado({ ultimoSyncAt: null, sincronizando: true, conectado: true }, AHORA), { corto: 'Buscando…', largo: 'Buscando correos nuevos…' })
  assert.deepEqual(textoDeActualizado({ ultimoSyncAt: null, sincronizando: false, conectado: true }, AHORA), { corto: 'Sin leer aún', largo: 'Todavía sin leer' })
  assert.deepEqual(textoDeActualizado({ ultimoSyncAt: null, sincronizando: false, conectado: false }, AHORA), { corto: '', largo: '' })
  assert.deepEqual(textoDeActualizado({ ultimoSyncAt: 'no es fecha', sincronizando: false, conectado: false }, AHORA), { corto: '', largo: '' })
})

console.log(`\n${ok} pruebas bien`)
