/**
 * Pruebas de la lógica pura de «Equipo y permisos» y del resumen del equipo:
 *   PermisosDeBuzones.tsx (celdas de «Quién ve qué», pasos de cada cambio, atajos, tandas de 50),
 *   PestanaAsignaciones.tsx (buscador, avisos antes de asignar, confirmación, deshacer),
 *   EquipoYPermisos.tsx (textos del historial) y VistaEquipo.tsx (estado y «Lo trabajan»).
 *
 *   cd /Users/raulcamunas/Dev/ERP-correo && npx tsx components/correo/equipo.prueba.ts
 */
import assert from 'node:assert/strict'
import { MAX_CAMBIOS_POR_PETICION, QUITALO_EN_ASIGNACIONES, armarMatriz, celdaDe, type BuzonDeLaMatriz, type CeldaDeAcceso, type PersonaDeLaMatriz } from '@/lib/correo/lectores'
import { personasParaAsignar, type BuzonConAsignaciones, type PersonaAsignable } from '@/lib/correo/asignaciones'
import { textoDeCambio } from './EquipoYPermisos'
import { FALTA_LA_260, LO_ABRE_UN_PERMISO, aspectoDeCelda, atajosDeFila, enTandas, estadoDeCelda, opcionesDeCelda, pasosHacia, textoDeResultado } from './PermisosDeBuzones'
import { avisosDeAsignar, despuesDeCambiar, filtrarBuzones, filtrarPersonas, normalizar, pideConfirmacion, textoDeConfirmacion } from './PestanaAsignaciones'
import { estadoCortoDeBuzon, estadoDeBuzon, formaDeTabla, quienLoTrabaja } from './VistaEquipo'

let ok = 0
const caso = (nombre: string, fn: () => void) => {
  fn()
  ok++
  console.log(`✓ ${nombre}`)
}

const B = '00000000-0000-4000-8000-000000000101'
const celda = (c: Partial<CeldaDeAcceso>): CeldaDeAcceso => ({ via: 'nada', concedido: false, bloqueado: false, asignado: false, puedeResponder: false, ...c })

/* ---------------- Quién ve qué: celdas ---------------- */

caso('estado: nada → no; permiso, abierto y asignado → lee; bloqueado gana', () => {
  assert.equal(estadoDeCelda(celda({})), 'no')
  assert.equal(estadoDeCelda(celda({ via: 'permiso' })), 'lee')
  assert.equal(estadoDeCelda(celda({ via: 'concedido', concedido: true })), 'lee')
  assert.equal(estadoDeCelda(celda({ via: 'asignado', asignado: true })), 'lee')
  assert.equal(estadoDeCelda(celda({ via: 'permiso', bloqueado: true })), 'bloqueado')
  assert.equal(estadoDeCelda(celda({ via: 'suyo' })), 'lee')
})

caso('aspecto: Suyo, Por permiso, Abierto, Asignado, Bloqueado, No ve', () => {
  assert.deepEqual(aspectoDeCelda(celda({ via: 'suyo' })), { tipo: 'suyo', texto: 'Suyo' })
  assert.equal(aspectoDeCelda(celda({ via: 'permiso' })).texto, 'Por permiso')
  assert.equal(aspectoDeCelda(celda({ via: 'concedido', concedido: true })).texto, 'Abierto')
  assert.equal(aspectoDeCelda(celda({ via: 'asignado', asignado: true })).texto, 'Asignado')
  assert.equal(aspectoDeCelda(celda({ via: 'concedido', bloqueado: true })).texto, 'Bloqueado')
  assert.equal(aspectoDeCelda(celda({})).texto, 'No ve')
})

caso('celda asignada: «No ve» desactivado con «Quítalo en Asignaciones»; «Bloqueado» sí, avisando de que quita la asignación', () => {
  const c = celda({ via: 'asignado', asignado: true, puedeResponder: true })
  const op = opcionesDeCelda(c, B, true)
  const no = op.find((o) => o.id === 'no')!
  assert.equal(no.desactivada, true)
  assert.equal(no.motivo, QUITALO_EN_ASIGNACIONES)
  const bloq = op.find((o) => o.id === 'bloqueado')!
  assert.equal(bloq.desactivada, false)
  assert.match(bloq.motivo ?? '', /quita antes la asignación/)
  const p = pasosHacia(c, B, 'bloqueado', true)
  assert.ok(p.ok)
  if (p.ok) assert.deepEqual(p.pasos, [[{ buzonId: B, bloquear: true }]])
})

caso('celda asignada y además abierta a mano: «No ve» sigue desactivado (no se quita una asignación desde la matriz)', () => {
  const p = pasosHacia(celda({ via: 'concedido', concedido: true, asignado: true }), B, 'no', true)
  assert.deepEqual(p, { ok: false, motivo: QUITALO_EN_ASIGNACIONES })
})

caso('sin la 260 no se ofrece bloquear', () => {
  const p = pasosHacia(celda({ via: 'permiso' }), B, 'bloqueado', false)
  assert.deepEqual(p, { ok: false, motivo: FALTA_LA_260 })
  assert.equal(opcionesDeCelda(celda({}), B, false).find((o) => o.id === 'bloqueado')!.desactivada, true)
})

caso('por permiso: «No ve» se manda a Gestión de Usuarios; bloquear sí', () => {
  assert.deepEqual(pasosHacia(celda({ via: 'permiso' }), B, 'no', true), { ok: false, motivo: LO_ABRE_UN_PERMISO })
  const p = pasosHacia(celda({ via: 'permiso' }), B, 'bloqueado', true)
  assert.ok(p.ok && p.pasos.length === 1 && p.pasos[0][0].bloquear === true)
})

caso('abrir y cerrar a mano: un paso', () => {
  assert.deepEqual(pasosHacia(celda({}), B, 'lee', true), { ok: true, pasos: [[{ buzonId: B, leer: true }]], aviso: null })
  assert.deepEqual(pasosHacia(celda({ via: 'concedido', concedido: true }), B, 'no', true), { ok: true, pasos: [[{ buzonId: B, leer: false }]], aviso: null })
})

caso('bloqueado sin nada → «Lee»: quitar el bloqueo y LUEGO abrir (dos peticiones: un buzón no sale dos veces en una)', () => {
  const p = pasosHacia(celda({ bloqueado: true }), B, 'lee', true)
  assert.deepEqual(p, { ok: true, pasos: [[{ buzonId: B, bloquear: false }], [{ buzonId: B, leer: true }]], aviso: null })
})

caso('bloqueado con permiso → «Lee»: basta con quitar el bloqueo', () => {
  assert.deepEqual(pasosHacia(celda({ via: 'permiso', bloqueado: true }), B, 'lee', true), { ok: true, pasos: [[{ buzonId: B, bloquear: false }]], aviso: null })
})

caso('bloqueado y abierto a mano → «No ve»: primero se cierra (quita) y después se desbloquea; nunca un momento leyéndolo', () => {
  assert.deepEqual(pasosHacia(celda({ via: 'concedido', concedido: true, bloqueado: true }), B, 'no', true), { ok: true, pasos: [[{ buzonId: B, leer: false }], [{ buzonId: B, bloquear: false }]], aviso: null })
})

caso('el propio buzón no se toca; lo mismo no cambia nada', () => {
  assert.equal(pasosHacia(celda({ via: 'suyo' }), B, 'no', true).ok, false)
  assert.deepEqual(pasosHacia(celda({}), B, 'no', true), { ok: true, pasos: [], aviso: null })
})

caso('tandas de 50: 120 cambios → 50 + 50 + 20', () => {
  const t = enTandas(Array.from({ length: 120 }, (_, i) => i))
  assert.equal(MAX_CAMBIOS_POR_PETICION, 50)
  assert.deepEqual(t.map((x) => x.length), [50, 50, 20])
  assert.deepEqual(enTandas([]), [])
})

caso('textos del resultado', () => {
  assert.equal(textoDeResultado({ concedidos: 1, quitados: 0, bloqueados: 0, desbloqueados: 0 }), 'Buzón abierto.')
  assert.equal(textoDeResultado({ concedidos: 0, quitados: 0, bloqueados: 1, desbloqueados: 0, desasignados: 1 }), 'Asignación quitada · buzón bloqueado.')
  assert.equal(textoDeResultado({ concedidos: 0, quitados: 0, bloqueados: 0, desbloqueados: 0 }), 'Sin cambios.')
})

/* ---------------- Quién ve qué: atajos con la misma lógica ---------------- */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const persona = (n: number, nombre: string, extra: Partial<PersonaDeLaMatriz> = {}): PersonaDeLaMatriz => ({ id: id(n), nombre, email: null, role: 'employee', tieneCorreo: true, permisoEquipo: false, permisoCorreo: false, ...extra })
const buzon = (n: number, d: PersonaDeLaMatriz, esComercial: boolean, puesto: string | null = null): BuzonDeLaMatriz => ({ id: id(100 + n), direccion: `${d.nombre.toLowerCase()}@libertyseller.es`, nombre: null, dueno: { id: d.id, nombre: d.nombre, role: d.role, esComercial, puesto } })

caso('atajos: comerciales por abrir, abiertos a mano, administrativos por bloquear (sin los asignados) y bloqueos por quitar', () => {
  const ANA = persona(1, 'Ana')
  const BEA = persona(2, 'Bea')
  const CONTA = persona(3, 'Conta')
  const SUPER = persona(4, 'Super', { permisoCorreo: true })
  const bA = buzon(1, ANA, true, 'comercial')
  const bB = buzon(2, BEA, true, 'comercial')
  const bC = buzon(3, CONTA, false, 'gestion_administrativa')
  const m = armarMatriz({
    personas: [ANA, BEA, CONTA, SUPER],
    buzones: [bA, bB, bC],
    concesiones: [{ buzonId: bA.id, lectorId: BEA.id, por: null, desde: '2026-11-01T00:00:00Z' }],
    bloqueos: [],
    asignaciones: [],
  })
  const filaBea = m.filas.find((f) => f.persona.id === BEA.id)!
  const aBea = atajosDeFila(filaBea, m.buzones, true)
  assert.equal(aBea.find((a) => a.id === 'comerciales')!.cambios.length, 0) // ya lee el de Ana (a mano) y el suyo es suyo
  assert.deepEqual(aBea.find((a) => a.id === 'quitar')!.cambios, [{ buzonId: bA.id, leer: false }])
  const filaSuper = m.filas.find((f) => f.persona.id === SUPER.id)!
  assert.deepEqual(atajosDeFila(filaSuper, m.buzones, true).find((a) => a.id === 'bloquear')!.cambios, [{ buzonId: bC.id, bloquear: true }])
  // Sin la 260, ni bloquear ni desbloquear
  assert.equal(atajosDeFila(filaSuper, m.buzones, false).find((a) => a.id === 'bloquear')!.cambios.length, 0)
  // Asignado: el atajo de bloquear no se lo quita
  const m2 = armarMatriz({ personas: [CONTA, SUPER], buzones: [bC], concesiones: [], asignaciones: [{ buzonId: bC.id, personaId: SUPER.id, puedeResponder: true }] })
  const f2 = m2.filas.find((f) => f.persona.id === SUPER.id)!
  assert.equal(atajosDeFila(f2, m2.buzones, true).find((a) => a.id === 'bloquear')!.cambios.length, 0)
  assert.equal(celdaDe(SUPER, bC, false, false, { puedeResponder: true }).asignado, true)
})

/* ---------------- Asignaciones ---------------- */

const yo: PersonaAsignable = { id: id(50), nombre: 'Raúl Camuñas', role: 'admin', puesto: null, esYo: true, bloqueados: [] }
const patricia: PersonaAsignable = { id: id(51), nombre: 'Patricia Torres', role: 'employee', puesto: 'comercial', esYo: false, bloqueados: [id(201)] }
const jhanna: PersonaAsignable = { id: id(52), nombre: 'Jhanna Hernández', role: 'employee', puesto: 'manager_comercial', esYo: false, bloqueados: [] }
const daniela: PersonaAsignable = { id: id(53), nombre: 'Daniela Ruiz', role: 'employee', puesto: 'comercial', esYo: false, bloqueados: [] }
const bDaniela: BuzonConAsignaciones = {
  id: id(201),
  direccion: 'daniela@libertyseller.es',
  nombre: null,
  dueno: { id: daniela.id, nombre: daniela.nombre, role: 'employee', puesto: 'comercial' },
  deAdmin: false,
  asignaciones: [{ personaId: jhanna.id, nombre: jhanna.nombre, puedeResponder: false, asignadoAt: '2026-11-10T10:00:00Z', asignadoPor: 'Raúl Camuñas' }],
}
const bOtroAdmin: BuzonConAsignaciones = { id: id(202), direccion: 'admin2@libertyseller.es', nombre: null, dueno: { id: id(60), nombre: 'Otro Admin', role: 'admin', puesto: null }, deAdmin: true, asignaciones: [] }
const bMio: BuzonConAsignaciones = { id: id(203), direccion: 'raul@libertyseller.es', nombre: 'Dirección', dueno: { id: yo.id, nombre: yo.nombre, role: 'admin', puesto: null }, deAdmin: true, asignaciones: [] }

caso('normalizar: sin tildes ni mayúsculas', () => assert.equal(normalizar('  Hernández '), 'hernandez'))

caso('buscador: por dirección, dueño o quien lo trabaja (sin tildes); filtro «Solo con asignaciones»', () => {
  const todos = [bDaniela, bOtroAdmin, bMio]
  assert.deepEqual(filtrarBuzones(todos, 'hernandez', 'todos').map((b) => b.id), [bDaniela.id])
  assert.deepEqual(filtrarBuzones(todos, 'admin2', 'todos').map((b) => b.id), [bOtroAdmin.id])
  assert.deepEqual(filtrarBuzones(todos, 'dirección', 'todos').map((b) => b.id), [bMio.id])
  assert.deepEqual(filtrarBuzones(todos, '', 'con').map((b) => b.id), [bDaniela.id])
  assert.equal(filtrarBuzones(todos, '', 'todos').length, 3)
})

caso('selector: «Yo» arriba, sin el dueño ni quien ya lo tiene (personasParaAsignar); la búsqueda «yo» encuentra a quien mira', () => {
  const vista = { buzones: [bDaniela], personas: [yo, daniela, jhanna, patricia] }
  const candidatas = personasParaAsignar(vista, bDaniela.id)
  assert.deepEqual(candidatas.map((p) => p.id), [yo.id, patricia.id])
  assert.deepEqual(filtrarPersonas(candidatas, 'yo').map((p) => p.id), [yo.id])
  assert.deepEqual(filtrarPersonas(candidatas, 'torr').map((p) => p.id), [patricia.id])
})

caso('avisos antes de asignar: remitente anotado y «asignar quita el bloqueo»', () => {
  const a = avisosDeAsignar({ persona: patricia, buzon: bDaniela, puedeResponder: true })
  assert.deepEqual(a.map((x) => x.id), ['remitente', 'bloqueo'])
  assert.equal(a[0].texto, 'Lo que envíe saldrá desde daniela@libertyseller.es y quedará anotado que lo envió Patricia.')
  assert.match(a[1].texto, /asignar quita el bloqueo/)
  const solo = avisosDeAsignar({ persona: jhanna, buzon: bDaniela, puedeResponder: false })
  assert.deepEqual(solo.map((x) => x.id), ['lectura'])
  assert.match(avisosDeAsignar({ persona: yo, buzon: bDaniela, puedeResponder: true })[0].texto, /lo enviaste tú/)
})

caso('confirmación solo con el buzón de OTRO administrador', () => {
  assert.equal(pideConfirmacion(bOtroAdmin, yo.id), true)
  assert.equal(pideConfirmacion(bMio, yo.id), false)
  assert.equal(pideConfirmacion(bDaniela, yo.id), false)
  assert.equal(textoDeConfirmacion(patricia, bOtroAdmin.direccion, true), 'Vas a dejar que Patricia Torres escriba como admin2@libertyseller.es')
  assert.equal(textoDeConfirmacion(patricia, bOtroAdmin.direccion, false), 'Vas a dejar que Patricia Torres lea admin2@libertyseller.es')
  assert.equal(textoDeConfirmacion(yo, bOtroAdmin.direccion, true), 'Vas a escribir como admin2@libertyseller.es')
})

caso('deshacer con un clic: cada acción tiene su contraria', () => {
  assert.deepEqual(despuesDeCambiar('asignar', 'Patricia', bDaniela.direccion, null).deshacer, { accion: 'quitar' })
  assert.deepEqual(despuesDeCambiar('quitar', 'Patricia', bDaniela.direccion, false).deshacer, { accion: 'asignar', puedeResponder: false })
  assert.deepEqual(despuesDeCambiar('quitar', 'Patricia', bDaniela.direccion, true).deshacer, { accion: 'asignar', puedeResponder: true })
  assert.deepEqual(despuesDeCambiar('responde', 'Patricia', bDaniela.direccion, null).deshacer, { accion: 'solo_avisos' })
  assert.deepEqual(despuesDeCambiar('solo_avisos', 'Patricia', bDaniela.direccion, null).deshacer, { accion: 'responde' })
  assert.equal(despuesDeCambiar('asignar', 'Patricia', bDaniela.direccion, null).texto, 'daniela@ asignado a Patricia.')
})

/* ---------------- Últimos cambios ---------------- */

caso('historial: un texto para cada una de las 8 acciones, y el detalle en palabras', () => {
  const base = { buzon: 'daniela@libertyseller.es', lector: 'Patricia', porQuien: 'Raúl', cuando: '2026-11-16T09:00:00Z' }
  const esperado: Record<string, string> = {
    concedido: 'Abierto a mano',
    quitado: 'Cerrado',
    bloqueado: 'Bloqueado',
    desbloqueado: 'Desbloqueado',
    asignado: 'Asignado',
    desasignado: 'Asignación quitada',
    responde: 'Ya puede responder',
    solo_avisos: 'Solo avisos',
  }
  for (const [accion, etiqueta] of Object.entries(esperado)) assert.equal(textoDeCambio({ ...base, accion }).etiqueta, etiqueta, accion)
  assert.equal(textoDeCambio({ ...base, accion: 'asignado', detalle: 'responde' }).detalle, 'Puede responder y enviar desde el buzón')
  assert.equal(textoDeCambio({ ...base, accion: 'asignado', detalle: 'solo_avisos' }).detalle, 'Solo lo lee y recibe sus avisos')
  assert.equal(textoDeCambio({ ...base, accion: 'responde', detalle: 'responde' }).detalle, null)
  assert.equal(textoDeCambio({ ...base, accion: 'desbloqueado', detalle: 'asignado' }).detalle, 'Al asignarle el buzón')
  assert.equal(textoDeCambio({ ...base, accion: 'desasignado', detalle: 'al bloquear el buzón' }).detalle, 'Al bloquear el buzón')
  assert.equal(textoDeCambio({ ...base, accion: 'asignado' }).frase, 'daniela@ a Patricia')
  assert.equal(textoDeCambio({ ...base, accion: 'concedido' }).frase, 'daniela@ para Patricia')
  assert.equal(textoDeCambio({ ...base, accion: 'rarísimo' }).etiqueta, 'rarísimo')
})

/* ---------------- Resumen del equipo ---------------- */

caso('estado del buzón y «Lo trabajan»', () => {
  const AHORA = Date.parse('2026-11-16T10:00:00Z')
  const b = { conectado: true, credencialesInvalidas: false, ultimoError: null, ultimoSyncAt: '2026-11-16T09:55:00Z', historicoCompleto: true }
  assert.deepEqual(estadoDeBuzon(b, AHORA), { tono: 'verde', texto: 'Leído hace 5 min', detalle: null })
  assert.equal(estadoDeBuzon({ ...b, historicoCompleto: false }, AHORA).texto, 'Leído hace 5 min · importando')
  assert.equal(estadoDeBuzon({ ...b, conectado: false }, AHORA).texto, 'Desconectado')
  assert.equal(estadoDeBuzon({ ...b, credencialesInvalidas: true }, AHORA).texto, 'Contraseña rechazada')
  assert.equal(estadoDeBuzon({ ...b, ultimoError: 'IMAP caído' }, AHORA).detalle, 'IMAP caído')
  assert.equal(estadoDeBuzon({ ...b, ultimoSyncAt: null }, AHORA).texto, 'Todavía sin leer')
  assert.deepEqual(quienLoTrabaja({ asignaciones: [{ personaId: 'x', nombre: 'Patricia', puedeResponder: true }] }), ['Patricia'])
  assert.deepEqual(quienLoTrabaja({ asignaciones: [] }), [])
})

caso('estado corto (tabla compacta, con la barra lateral del ERP abierta)', () => {
  const b = { conectado: true, credencialesInvalidas: false, ultimoError: null, ultimoSyncAt: '2026-11-16T09:55:00Z', historicoCompleto: true }
  assert.equal(estadoCortoDeBuzon(b), 'Al día')
  assert.equal(estadoCortoDeBuzon({ ...b, historicoCompleto: false }), 'Importando')
  assert.equal(estadoCortoDeBuzon({ ...b, conectado: false }), 'Desconectado')
  assert.equal(estadoCortoDeBuzon({ ...b, credencialesInvalidas: true }), 'Contraseña')
  assert.equal(estadoCortoDeBuzon({ ...b, ultimoError: 'IMAP caído' }), 'Aviso')
  assert.equal(estadoCortoDeBuzon({ ...b, ultimoSyncAt: null }), 'Esperando')
})

caso('la forma de la tabla según el hueco (medido: 1076 a 1680 px, 836-860 a 1280-1440, 680 a 1100)', () => {
  assert.equal(formaDeTabla(0), 'completa')
  assert.equal(formaDeTabla(1076), 'completa')
  assert.equal(formaDeTabla(860), 'compacta')
  assert.equal(formaDeTabla(836), 'compacta')
  assert.equal(formaDeTabla(680), 'minima')
})

console.log(`\n${ok} casos OK`)
