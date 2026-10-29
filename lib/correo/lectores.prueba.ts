import {
  MAX_CAMBIOS_POR_PETICION,
  armarMatriz,
  celdaDe,
  decidirCambios,
  esDeAdministrativo,
  esDeComercial,
  paraBloquear,
  paraDesbloquear,
  validarPeticion,
  type Bloqueo,
  type BuzonDeLaMatriz,
  type Concesion,
  type PersonaDeLaMatriz,
} from '@/lib/correo/lectores'

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
const bloquea = (lector: PersonaDeLaMatriz, b: BuzonDeLaMatriz): Bloqueo => ({ buzonId: b.id, lectorId: lector.id, por: 'Raúl', desde: '2026-10-29T10:00:00.000Z' })

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

console.log('\n=== un buzón BLOQUEADO (migración 260) ===')
{
  // Alejandro: supervisa al equipo comercial Y el correo (lee comerciales y administrativos, no el de un administrador)
  const ALEJANDRO = persona(9, 'Alejandro', { permisoEquipo: true, permisoCorreo: true })
  const c = celdaDe(ALEJANDRO, B_CONTA, false, true)
  ok('bloqueado: la celda dice «bloqueado» y sigue diciendo por dónde lo vería sin el bloqueo', c.bloqueado && c.via === 'permiso')
  ok('sin bloquear, la celda no está bloqueada (el valor de siempre)', !celdaDe(ALEJANDRO, B_CONTA, false).bloqueado && !celdaDe(ALEJANDRO, B_CONTA, false, false).bloqueado)
  ok('el suyo no se bloquea: el dueño siempre lo lee', (() => { const x = celdaDe(ALEJANDRO, buzon(9, ALEJANDRO, true), false, true); return x.via === 'suyo' && !x.bloqueado })())
  ok('bloquear uno que no veía no cambia lo que ve, pero se sabe que está bloqueado', (() => { const x = celdaDe(JHANNA, B_ANA, false, true); return x.via === 'nada' && x.bloqueado })())
  ok('uno abierto a mano también se puede bloquear: sigue «concedido» por debajo', (() => { const x = celdaDe(JHANNA, B_RAUL, true, true); return x.via === 'concedido' && x.concedido && x.bloqueado })())

  const personas = [ANA, ADMIN_DE_CONTA, ALEJANDRO, JHANNA]
  const sin = armarMatriz({ personas, buzones: BUZONES, concesiones: [] })
  const alejandroSin = sin.filas.find((f) => f.persona.id === ALEJANDRO.id)!
  ok('sin bloqueos, Alejandro lee 4 buzones (3 comerciales + el administrativo) y no tiene ninguno bloqueado', alejandroSin.leidos === 4 && alejandroSin.bloqueados === 0)

  const con = armarMatriz({ personas, buzones: BUZONES, concesiones: [], bloqueos: [bloquea(ALEJANDRO, B_CONTA)] })
  const alejandro = con.filas.find((f) => f.persona.id === ALEJANDRO.id)!
  ok('con el administrativo bloqueado lee 3 y tiene 1 bloqueado', alejandro.leidos === 3 && alejandro.bloqueados === 1)
  ok('el bloqueo es de ESA persona: Jhanna (sin permisos) no se ve afectada', con.filas.find((f) => f.persona.id === JHANNA.id)!.bloqueados === 0)
  ok('y de ESE buzón: el resto de Alejandro siguen sin bloquear', alejandro.celdas[B_ANA.id].bloqueado === false && alejandro.celdas[B_CONTA.id].bloqueado === true)

  const soloBloqueo = persona(10, 'Ex', { tieneCorreo: false })
  const conExtra = armarMatriz({ personas: [soloBloqueo], buzones: BUZONES, concesiones: [], bloqueos: [bloquea(soloBloqueo, B_ANA)] })
  ok('quien perdió la casilla de Correo pero conserva un bloqueo sigue saliendo, para poder quitárselo', conExtra.filas.length === 1)
  ok('sin bloqueos pasados (la migración no está lanzada) la matriz sale como siempre', armarMatriz({ personas, buzones: BUZONES, concesiones: [], bloqueos: undefined }).filas.length === sin.filas.length)

  // Los dos grupos
  ok('«administrativo» = un buzón de alguien del equipo que ni es comercial ni administrador', esDeAdministrativo(B_CONTA) && !esDeAdministrativo(B_ANA) && !esDeAdministrativo(B_RAUL))
  ok('«comercial» = el buzón de un comercial', esDeComercial(B_ANA) && esDeComercial(B_BEA) && !esDeComercial(B_CONTA) && !esDeComercial(B_RAUL))

  // Atajos de la fila
  const aBloquear = paraBloquear(alejandroSin, BUZONES, 'administrativos')
  ok('«bloquear administrativos» a Alejandro: solo el de Conta (lo lee por la supervisión del correo)', aBloquear.length === 1 && aBloquear[0].id === B_CONTA.id)
  ok('lo que ya tiene bloqueado no se vuelve a ofrecer', paraBloquear(alejandro, BUZONES, 'administrativos').length === 0)
  ok('a quien no lee ninguno de ese grupo no se le ofrece nada (bloquear algo que no ve no cambia nada)', paraBloquear(con.filas.find((f) => f.persona.id === JHANNA.id)!, BUZONES, 'administrativos').length === 0)
  ok('«bloquear comerciales» a Alejandro: sus tres', paraBloquear(alejandroSin, BUZONES, 'comerciales').length === 3)
  ok('el suyo no entra jamás en lo que se puede bloquear', (() => {
    const suyo = buzon(9, ALEJANDRO, false)
    const m = armarMatriz({ personas: [ALEJANDRO], buzones: [...BUZONES, suyo], concesiones: [] })
    return paraBloquear(m.filas[0], [...BUZONES, suyo], 'administrativos').every((b) => b.id !== suyo.id)
  })())
  ok('abierto a mano también se puede bloquear desde el atajo', (() => {
    const m = armarMatriz({ personas: [JHANNA], buzones: BUZONES, concesiones: [abre(JHANNA, B_CONTA)] })
    return paraBloquear(m.filas[0], BUZONES, 'administrativos').map((b) => b.id).join() === B_CONTA.id
  })())
  ok('«desbloquear»: lo bloqueado, de un grupo o de todos', paraDesbloquear(alejandro, BUZONES, 'administrativos').length === 1 && paraDesbloquear(alejandro, BUZONES, 'comerciales').length === 0 && paraDesbloquear(alejandro, BUZONES).length === 1)
}

console.log('\n=== validar y decidir cambios de bloqueo ===')
{
  const buena = validarPeticion({ lectorId: id(6), cambios: [{ buzonId: id(104), bloquear: true }, { buzonId: id(101).toUpperCase(), bloquear: false }, { buzonId: id(102), leer: true }] })
  ok('una petición mezclada (bloquear, desbloquear y abrir) es válida y conserva cada tipo', buena.ok && buena.peticion.cambios.length === 3 && buena.peticion.cambios[0].bloquear === true && buena.peticion.cambios[1].bloquear === false && buena.peticion.cambios[1].buzonId === id(101) && buena.peticion.cambios[2].leer === true)
  ok('un cambio que abre y bloquea a la vez se rechaza', !validarPeticion({ lectorId: id(6), cambios: [{ buzonId: id(104), leer: true, bloquear: true }] }).ok)
  ok('un cambio sin decir qué (ni leer ni bloquear) se rechaza', !validarPeticion({ lectorId: id(6), cambios: [{ buzonId: id(104) }] }).ok)
  ok('«bloquear» tiene que ser verdadero o falso (no texto)', !validarPeticion({ lectorId: id(6), cambios: [{ buzonId: id(104), bloquear: 'true' }] }).ok && !validarPeticion({ lectorId: id(6), cambios: [{ buzonId: id(104), bloquear: 1 }] }).ok)
  ok('un buzón que sale una vez para bloquear y otra para abrir es el mismo buzón dos veces', !validarPeticion({ lectorId: id(6), cambios: [{ buzonId: id(104), bloquear: true }, { buzonId: id(104), leer: true }] }).ok)

  const mapa = new Map(BUZONES.map((b) => [b.id, { dueno: b.dueno.id }]))
  const lector = { id: JHANNA.id, role: 'employee' }
  const pet = { lectorId: JHANNA.id, cambios: [{ buzonId: B_CONTA.id, bloquear: true }, { buzonId: B_ANA.id, bloquear: false }, { buzonId: id(999), bloquear: true }] }
  const d = decidirCambios(lector, mapa, pet)
  ok('se aplican bloquear y desbloquear y se rechaza el buzón que no existe', d.ok && d.aplicar.length === 2 && d.rechazados.length === 1 && d.rechazados[0].buzonId === id(999))
  const suyo = decidirCambios({ id: ANA.id, role: 'employee' }, mapa, { lectorId: ANA.id, cambios: [{ buzonId: B_ANA.id, bloquear: true }] })
  ok('bloquearle a alguien su propio buzón no se puede, y el motivo lo dice', suyo.ok && suyo.aplicar.length === 0 && /no se le puede bloquear/.test(suyo.rechazados[0].motivo))
  const suyoAbrir = decidirCambios({ id: ANA.id, role: 'employee' }, mapa, { lectorId: ANA.id, cambios: [{ buzonId: B_ANA.id, leer: true }] })
  ok('el motivo de abrirle el suyo sigue siendo el de siempre', suyoAbrir.ok && /ya lo lee/.test(suyoAbrir.rechazados[0].motivo))
  const admin = decidirCambios({ id: RAUL.id, role: 'admin' }, mapa, { lectorId: RAUL.id, cambios: [{ buzonId: B_CONTA.id, bloquear: true }] })
  ok('a un administrador no se le bloquea nada (lee todo)', !admin.ok && admin.estado === 422 && /bloquea/.test(admin.error))
  const partner = decidirCambios({ id: id(8), role: 'partner' }, mapa, { lectorId: id(8), cambios: [{ buzonId: B_CONTA.id, bloquear: true }] })
  ok('ni a un partner', !partner.ok && partner.estado === 422)
  const quita = decidirCambios(lector, mapa, { lectorId: JHANNA.id, cambios: [{ buzonId: B_CARLOS.id, bloquear: false }] })
  ok('quitar un bloqueo que no existía no es un error: se aplica (no cambia nada)', quita.ok && quita.aplicar.length === 1)
  ok('se puede bloquear un buzón de un administrador (aunque nadie lo lea por permiso, queda dicho)', (() => { const x = decidirCambios(lector, mapa, { lectorId: JHANNA.id, cambios: [{ buzonId: B_RAUL.id, bloquear: true }] }); return x.ok && x.aplicar.length === 1 })())
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
