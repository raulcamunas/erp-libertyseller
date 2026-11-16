/**
 * Pruebas de la lógica pura de la vista del hilo (VistaDeHilo, RespuestaRapida y AsignarHilo).
 *   cd /Users/raulcamunas/Dev/ERP-correo && npx tsx components/correo/hilo.prueba.ts
 */
import assert from 'node:assert/strict'
import type { MensajeDeHilo } from '@/lib/correo/tipos'
import { filtrarEncargables, NOTA_MAXIMA, ordenarEncargables } from './AsignarHilo'
import { textoDeRespuestaRapida } from './RespuestaRapida'
import { abiertosAlEmpezar, accesoDelBuzon, autorDe, desdeCuando, enlaceDelHilo, etiquetaDeEnviadoPor, mensajeAlQueContestar, remitenteDelHilo } from './VistaDeHilo'

let ok = 0
const caso = (nombre: string, fn: () => void) => {
  fn()
  ok++
  console.log(`✓ ${nombre}`)
}

const m = (id: string, direccion: 'entrante' | 'saliente', extra: Partial<MensajeDeHilo> = {}): MensajeDeHilo => ({
  id,
  direccion,
  deNombre: direccion === 'entrante' ? 'Ana López' : 'Stock',
  deDireccion: direccion === 'entrante' ? 'Ana@Tienda.com' : 'stock@libertyseller.es',
  para: [],
  cc: [],
  responderA: [],
  asunto: 'Presupuesto',
  fecha: '2026-11-16T09:00:00Z',
  texto: 'hola',
  html: null,
  adjuntos: [],
  leido: true,
  automatico: false,
  messageId: null,
  ...extra,
})

/* ---------- A qué se contesta y qué sale abierto ---------- */
caso('contesta al último entrante aunque después haya un saliente', () => {
  assert.equal(mensajeAlQueContestar([m('1', 'entrante'), m('2', 'entrante'), m('3', 'saliente')])?.id, '2')
})
caso('sin entrantes, al último', () => assert.equal(mensajeAlQueContestar([m('1', 'saliente'), m('2', 'saliente')])?.id, '2'))
caso('hilo vacío: nada', () => assert.equal(mensajeAlQueContestar([]), null))
caso('abiertos: el último y los no leídos', () => {
  const s = abiertosAlEmpezar([m('1', 'entrante', { leido: false }), m('2', 'entrante'), m('3', 'saliente')])
  assert.deepEqual([...s].sort(), ['1', '3'])
})

/* ---------- Remitente para silenciar ---------- */
caso('remitente: la dirección del último entrante, en minúsculas', () => {
  assert.deepEqual(remitenteDelHilo([m('1', 'entrante'), m('2', 'saliente')]), { direccion: 'ana@tienda.com', nombre: 'Ana López' })
})
caso('sin entrantes no hay remitente que silenciar', () => assert.equal(remitenteDelHilo([m('1', 'saliente')]), null))
caso('un entrante sin dirección válida no cuenta', () => assert.equal(remitenteDelHilo([m('1', 'entrante', { deDireccion: '' })]), null))

/* ---------- Insignia de acceso ---------- */
caso('propio, asignado, supervisión y sin buzón', () => {
  assert.equal(accesoDelBuzon({ esMio: true, asignado: false }), 'propio')
  assert.equal(accesoDelBuzon({ esMio: false, asignado: true }), 'asignado')
  assert.equal(accesoDelBuzon({ esMio: false, asignado: false }), 'supervision')
  assert.equal(accesoDelBuzon(null), null)
})

/* ---------- Enlace ---------- */
caso('el enlace lleva ?buzon= y ?hilo=', () => {
  assert.equal(enlaceDelHilo('https://erp.example/dashboard/correo', 'b1', 'h 2'), 'https://erp.example/dashboard/correo?buzon=b1&hilo=h+2')
})

/* ---------- Enviado por ---------- */
caso('enviado por otra persona: su nombre de pila', () => assert.equal(etiquetaDeEnviadoPor({ id: 'p1', nombre: 'Patricia Gómez' }, 'yo'), 'Enviado por Patricia'))
caso('enviado por mí: «Enviado por ti»', () => assert.equal(etiquetaDeEnviadoPor({ id: 'yo', nombre: 'Raúl' }, 'yo'), 'Enviado por ti'))
caso('persona borrada (id null): sigue saliendo el nombre', () => assert.equal(etiquetaDeEnviadoPor({ id: null, nombre: 'Jhanna' }, 'yo'), 'Enviado por Jhanna'))
caso('sin enviadoPor o sin nombre: nada', () => {
  assert.equal(etiquetaDeEnviadoPor(undefined, 'yo'), null)
  assert.equal(etiquetaDeEnviadoPor(null, 'yo'), null)
  assert.equal(etiquetaDeEnviadoPor({ id: 'x', nombre: '  ' }, 'yo'), null)
})

/* ---------- Quién firma el mensaje ---------- */
caso('lo mandó Patricia desde MI buzón: firma Patricia, no «Tú»', () =>
  assert.equal(autorDe(m('s1', 'saliente', { enviadoPor: { id: 'p1', nombre: 'Patricia Gómez' } }), { esMio: true }, 'yo'), 'Patricia'))
caso('lo mandé yo desde un buzón asignado: «Tú», no el nombre del dueño', () =>
  assert.equal(autorDe(m('s2', 'saliente', { enviadoPor: { id: 'yo', nombre: 'Raúl' } }), { esMio: false }, 'yo'), 'Tú'))
caso('saliente de mi buzón sin enviadoPor (los de antes): «Tú»', () => assert.equal(autorDe(m('s3', 'saliente'), { esMio: true }, 'yo'), 'Tú'))
caso('saliente de un buzón ajeno sin enviadoPor: el remitente', () => assert.equal(autorDe(m('s4', 'saliente'), { esMio: false }, 'yo'), 'Stock'))
caso('persona borrada (id null): su nombre', () => assert.equal(autorDe(m('s5', 'saliente', { enviadoPor: { id: null, nombre: 'Jhanna' } }), { esMio: true }, 'yo'), 'Jhanna'))
caso('un entrante siempre lo firma quien lo manda', () => assert.equal(autorDe(m('e1', 'entrante', { enviadoPor: { id: 'yo', nombre: 'Raúl' } }), { esMio: true }, 'yo'), 'Ana López'))

/* ---------- Desde cuándo ---------- */
const AHORA = Date.parse('2026-11-16T09:00:00Z')
caso('desde hace un momento / desde hace 3 h', () => {
  assert.equal(desdeCuando('2026-11-16T09:00:00Z', AHORA), 'desde hace un momento')
  assert.match(desdeCuando('2026-11-16T06:00:00Z', AHORA), /^desde hace 3 h/)
})
caso('fecha rota: vacío', () => assert.equal(desdeCuando('no-es-fecha', AHORA), ''))

/* ---------- Respuesta rápida ---------- */
caso('lo escrito y la firma debajo', () => assert.equal(textoDeRespuestaRapida('Gracias, Ana.\n\n', '--\nRaúl'), 'Gracias, Ana.\n\n--\nRaúl'))
caso('sin firma, solo lo escrito', () => {
  assert.equal(textoDeRespuestaRapida('Vale', null), 'Vale')
  assert.equal(textoDeRespuestaRapida('Vale', '   '), 'Vale')
})

/* ---------- Encargables ---------- */
const lista = [
  { id: 'c', nombre: 'Óscar', puedeResponder: false },
  { id: 'yo', nombre: 'Raúl', puedeResponder: true },
  { id: 'a', nombre: 'Ana', puedeResponder: true },
]
caso('«Yo» arriba y el resto por nombre', () => assert.deepEqual(ordenarEncargables(lista, 'yo').map((p) => p.id), ['yo', 'a', 'c']))
caso('si «yo» no está, solo por nombre', () => assert.deepEqual(ordenarEncargables(lista, 'nadie').map((p) => p.id), ['a', 'c', 'yo']))
caso('buscar sin tildes ni mayúsculas', () => assert.deepEqual(filtrarEncargables(lista, 'osc').map((p) => p.id), ['c']))
caso('buscar vacío: todos', () => assert.equal(filtrarEncargables(lista, '  ').length, 3))
caso('la nota cabe en 280', () => assert.equal(NOTA_MAXIMA, 280))

console.log(`\n${ok} casos bien`)
