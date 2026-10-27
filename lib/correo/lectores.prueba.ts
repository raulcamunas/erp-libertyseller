import { MAX_CAMBIOS_POR_PETICION, armarMatriz, celdaDe, decidirCambios, validarPeticion, type BuzonDeLaMatriz, type Concesion, type PersonaDeLaMatriz } from '@/lib/correo/lectores'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const persona = (n: number, nombre: string, extra: Partial<PersonaDeLaMatriz> = {}): PersonaDeLaMatriz => ({ id: id(n), nombre, email: `${nombre.toLowerCase()}@liberty.es`, role: 'employee', tieneCorreo: true, permisoEquipo: false, permisoCorreo: false, ...extra })

// Cinco buzones: tres de comerciales, uno administrativo y uno de un administrador
const ANA = persona(1, 'Ana')
const BEA = persona(2, 'Bea')
const CARLOS = persona(3, 'Carlos')
const ADMIN_DE_CONTA = persona(4, 'Conta') // administrativa
const RAUL = persona(5, 'Raúl', { role: 'admin' })
const JHANNA = persona(6, 'Jhanna')
const buzon = (n: number, d: PersonaDeLaMatriz, esComercial: boolean): BuzonDeLaMatriz => ({ id: id(100 + n), direccion: `${d.nombre.toLowerCase()}@liberty.es`, nombre: null, dueno: { id: d.id, nombre: d.nombre, role: d.role, esComercial } })
const B_ANA = buzon(1, ANA, true)
const B_BEA = buzon(2, BEA, true)
const B_CARLOS = buzon(3, CARLOS, true)
const B_CONTA = buzon(4, ADMIN_DE_CONTA, false)
const B_RAUL = buzon(5, RAUL, false)
const BUZONES = [B_ANA, B_BEA, B_CARLOS, B_CONTA, B_RAUL]
const abre = (lector: PersonaDeLaMatriz, b: BuzonDeLaMatriz): Concesion => ({ buzonId: b.id, lectorId: lector.id, por: 'Raúl', desde: '2026-10-27T10:00:00.000Z' })

console.log('\n=== cada celda dice por qué se ve (o que no) ===')
{
  ok('su propio buzón es «suyo»', celdaDe(ANA, B_ANA, false).via === 'suyo')
  ok('sin nada, «nada»', celdaDe(JHANNA, B_ANA, false).via === 'nada' && !celdaDe(JHANNA, B_ANA, false).concedido)
  ok('abierto a mano, «concedido»', celdaDe(JHANNA, B_ANA, true).via === 'concedido' && celdaDe(JHANNA, B_ANA, true).concedido)
  const supervisora = persona(6, 'Jhanna', { permisoEquipo: true })
  ok('la supervisión comercial abre los de los comerciales y los marca «permiso»', celdaDe(supervisora, B_ANA, false).via === 'permiso')
  ok('pero no el administrativo ni el del administrador', celdaDe(supervisora, B_CONTA, false).via === 'nada' && celdaDe(supervisora, B_RAUL, false).via === 'nada')
  ok('abierto a mano y además por permiso: se ve por el permiso y se sabe que hay uno a mano debajo', (() => { const c = celdaDe(supervisora, B_ANA, true); return c.via === 'permiso' && c.concedido })())
  const correo = persona(6, 'Jhanna', { permisoCorreo: true })
  ok('la supervisión del correo abre también el administrativo, pero NO el de un administrador', celdaDe(correo, B_CONTA, false).via === 'permiso' && celdaDe(correo, B_RAUL, false).via === 'nada')
  ok('lo abierto a mano sí puede abrir el de un administrador', celdaDe(correo, B_RAUL, true).via === 'concedido')
}

console.log('\n=== la matriz ===')
{
  const personas = [ANA, BEA, CARLOS, ADMIN_DE_CONTA, RAUL, JHANNA, persona(7, 'Sin correo', { tieneCorreo: false }), persona(8, 'Externo', { role: 'partner' })]
  const m = armarMatriz({ personas, buzones: BUZONES, concesiones: [abre(JHANNA, B_ANA), abre(JHANNA, B_BEA)] })
  ok('un administrador no sale (lee todo), ni un partner, ni quien no tiene la aplicación Correo y nada abierto', m.filas.map((f) => f.persona.nombre).join() === 'Ana,Bea,Carlos,Conta,Jhanna', m.filas.map((f) => f.persona.nombre).join())
  ok('las columnas, por nombre del dueño', m.buzones.map((b) => b.dueno.nombre).join() === 'Ana,Bea,Carlos,Conta,Raúl')
  const j = m.filas.find((f) => f.persona.id === JHANNA.id)!
  ok('Jhanna: dos abiertos a mano y nada más', j.celdas[B_ANA.id].via === 'concedido' && j.celdas[B_BEA.id].via === 'concedido' && j.celdas[B_CARLOS.id].via === 'nada' && j.celdas[B_CONTA.id].via === 'nada' && j.celdas[B_RAUL.id].via === 'nada')
  ok('cuenta cuántos ajenos lee', j.leidos === 2)
  const ana = m.filas.find((f) => f.persona.id === ANA.id)!
  ok('Ana ve el suyo y ninguno más', ana.celdas[B_ANA.id].via === 'suyo' && ana.leidos === 0)
  const conSupervision = armarMatriz({ personas: [persona(6, 'Jhanna', { permisoEquipo: true })], buzones: BUZONES, concesiones: [] })
  ok('con la supervisión comercial lee 3 (los de los comerciales)', conSupervision.filas[0].leidos === 3)
  const sinCasilla = armarMatriz({ personas: [persona(7, 'Ex', { tieneCorreo: false })], buzones: BUZONES, concesiones: [abre(persona(7, 'Ex', { tieneCorreo: false }), B_ANA)] })
  ok('quien perdió la casilla de Correo pero conserva un buzón abierto sigue saliendo, para poder quitárselo', sinCasilla.filas.length === 1)
  ok('sin nadie, una matriz vacía', armarMatriz({ personas: [], buzones: [], concesiones: [] }).filas.length === 0)
}

console.log('\n=== validar la petición ===')
{
  const buena = validarPeticion({ lectorId: id(6).toUpperCase(), cambios: [{ buzonId: id(101).toUpperCase(), leer: true }, { buzonId: id(102), leer: false }] })
  ok('una petición buena, con los ids en minúsculas', buena.ok && buena.peticion.lectorId === id(6) && buena.peticion.cambios[0].buzonId === id(101) && buena.peticion.cambios.length === 2)
  ok('sin cuerpo', !validarPeticion(null).ok && !validarPeticion('x').ok)
  ok('sin persona o con una que no es un id', !validarPeticion({ cambios: [{ buzonId: id(1), leer: true }] }).ok && !validarPeticion({ lectorId: 'maria', cambios: [{ buzonId: id(1), leer: true }] }).ok)
  ok('sin cambios', !validarPeticion({ lectorId: id(6), cambios: [] }).ok && !validarPeticion({ lectorId: id(6) }).ok)
  ok('un buzón que no es un id', !validarPeticion({ lectorId: id(6), cambios: [{ buzonId: '1; drop table', leer: true }] }).ok)
  ok('«leer» tiene que ser verdadero o falso (no «true» como texto)', !validarPeticion({ lectorId: id(6), cambios: [{ buzonId: id(101), leer: 'true' }] }).ok)
  ok('el mismo buzón dos veces', !validarPeticion({ lectorId: id(6), cambios: [{ buzonId: id(101), leer: true }, { buzonId: id(101).toUpperCase(), leer: false }] }).ok)
  const muchos = Array.from({ length: MAX_CAMBIOS_POR_PETICION + 1 }, (_, i) => ({ buzonId: id(1000 + i), leer: true }))
  ok('no más de los que caben', !validarPeticion({ lectorId: id(6), cambios: muchos }).ok && validarPeticion({ lectorId: id(6), cambios: muchos.slice(0, MAX_CAMBIOS_POR_PETICION) }).ok)
}

console.log('\n=== qué cambios se pueden hacer ===')
{
  const mapa = new Map(BUZONES.map((b) => [b.id, { dueno: b.dueno.id }]))
  const pet = { lectorId: JHANNA.id, cambios: [{ buzonId: B_ANA.id, leer: true }, { buzonId: B_BEA.id, leer: false }, { buzonId: id(999), leer: true }] }
  const d = decidirCambios({ id: JHANNA.id, role: 'employee' }, mapa, pet)
  ok('se aplican los buenos (también cerrar) y se rechaza el buzón que no existe, con motivo', d.ok && d.aplicar.length === 2 && d.rechazados.length === 1 && d.rechazados[0].buzonId === id(999) && /no existe/.test(d.rechazados[0].motivo))
  const suyo = decidirCambios({ id: ANA.id, role: 'employee' }, mapa, { lectorId: ANA.id, cambios: [{ buzonId: B_ANA.id, leer: true }] })
  ok('abrirle a alguien su propio buzón no hace nada y se dice', suyo.ok && suyo.aplicar.length === 0 && /propio/.test(suyo.rechazados[0].motivo))
  const admin = decidirCambios({ id: RAUL.id, role: 'admin' }, mapa, { lectorId: RAUL.id, cambios: [{ buzonId: B_ANA.id, leer: true }] })
  ok('a un administrador no se le abre nada (ya lee todo)', !admin.ok && admin.estado === 422)
  const partner = decidirCambios({ id: id(8), role: 'partner' }, mapa, { lectorId: id(8), cambios: [{ buzonId: B_ANA.id, leer: true }] })
  ok('ni a un partner', !partner.ok && partner.estado === 422)
  const nadie = decidirCambios(null, mapa, pet)
  ok('una persona que no existe es un 404', !nadie.ok && nadie.estado === 404)
  const quita = decidirCambios({ id: JHANNA.id, role: 'employee' }, mapa, { lectorId: JHANNA.id, cambios: [{ buzonId: B_CARLOS.id, leer: false }] })
  ok('cerrar uno que no estaba abierto no es un error: se aplica (no cambia nada)', quita.ok && quita.aplicar.length === 1)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
