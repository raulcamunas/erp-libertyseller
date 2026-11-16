import { NO_EXISTE, buzonesAjenosQueSeLeen, SOLO_ASIGNADO_RESPONDE, SOLO_EL_DUENO, decidirAcceso, type DatosDelDueno, type ModoDeAcceso, type QuienPide } from '@/lib/correo/acceso'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * ACCESO A LOS BUZONES: la regla entera, caso por caso.
 *
 * Personas de la prueba:
 *   · ana       comercial, dueña de su buzón
 *   · bea       otra comercial
 *   · raul      administrador (no comercial)
 *   · socio     partner (no comercial; figura externa)
 *   · alejandro employee con el permiso «Supervisión del equipo comercial»
 *   · lucia     employee con el permiso «Supervisión del correo»
 *   · conta     employee sin nada especial
 *
 * Escribir desde un buzón ajeno (modo 'responder') solo se puede con una asignación explícita de un administrador con
 * «Puede responder y enviar»; configurarlo (modo 'escribir') sigue siendo solo del dueño. La tabla de la especificación
 * (3.2, 15 casos) va al final.
 */

const sin = { tienePermisoEquipo: false, tienePermisoCorreo: false }
const ana: QuienPide = { userId: 'ana', role: 'employee', ...sin }
const bea: QuienPide = { userId: 'bea', role: 'employee', ...sin }
const raul: QuienPide = { userId: 'raul', role: 'admin', ...sin }
const socio: QuienPide = { userId: 'socio', role: 'partner', ...sin }
const alejandro: QuienPide = { userId: 'alejandro', role: 'employee', ...sin, tienePermisoEquipo: true }
const lucia: QuienPide = { userId: 'lucia', role: 'employee', ...sin, tienePermisoCorreo: true }
const conta: QuienPide = { userId: 'conta', role: 'employee', ...sin }

const deAna = { user_id: 'ana' }
const deRaul = { user_id: 'raul' }
const deSocio = { user_id: 'socio' }
const deConta = { user_id: 'conta' }
const deLucia = { user_id: 'lucia' }
const comercial: DatosDelDueno = { is_comercial: true, role: 'employee' }
const noComercial: DatosDelDueno = { is_comercial: false, role: 'employee' }
const administrador: DatosDelDueno = { is_comercial: false, role: 'admin' }
const partner: DatosDelDueno = { is_comercial: false, role: 'partner' }

const veredicto = (quien: QuienPide, buzon: { user_id: string; id?: string }, dueno: DatosDelDueno, modo: ModoDeAcceso) => {
  const d = decidirAcceso(quien, buzon, dueno, modo)
  return d.ok ? (d.porSupervision ? 'sí (supervisión)' : 'sí (dueño)') : `${d.estado}`
}
const caso = (nombre: string, real: string, esperado: string) => ok(nombre, real === esperado, `real «${real}», esperado «${esperado}»`)

console.log('el dueño')
caso('lee el suyo', veredicto(ana, deAna, comercial, 'leer'), 'sí (dueño)')
caso('escribe desde el suyo', veredicto(ana, deAna, comercial, 'escribir'), 'sí (dueño)')
caso('responde desde el suyo', veredicto(ana, deAna, comercial, 'responder'), 'sí (dueño)')
caso('cambia la conexión del suyo', veredicto(ana, deAna, comercial, 'administrar'), 'sí (dueño)')
caso('un administrador dueño de su propio buzón lo usa como cualquiera', veredicto(raul, deRaul, administrador, 'escribir'), 'sí (dueño)')
caso('un employee no comercial dueño de su buzón lo lee', veredicto(conta, deConta, noComercial, 'leer'), 'sí (dueño)')

console.log('otra comercial')
caso('no lee el de Ana', veredicto(bea, deAna, comercial, 'leer'), '404')
caso('no escribe desde el de Ana', veredicto(bea, deAna, comercial, 'escribir'), '404')
caso('no lo desconecta', veredicto(bea, deAna, comercial, 'administrar'), '404')

console.log('el administrador')
caso('lee el de una comercial', veredicto(raul, deAna, comercial, 'leer'), 'sí (supervisión)')
caso('lee el de alguien que no es comercial', veredicto(raul, deConta, noComercial, 'leer'), 'sí (supervisión)')
caso('lee el de un partner', veredicto(raul, deSocio, partner, 'leer'), 'sí (supervisión)')
caso('NO configura el de Ana', veredicto(raul, deAna, comercial, 'escribir'), '403')
caso('NO responde desde el de Ana sin asignárselo', veredicto(raul, deAna, comercial, 'responder'), '403')
caso('desconecta el de Ana', veredicto(raul, deAna, comercial, 'administrar'), 'sí (supervisión)')

console.log('un partner (figura externa: no supervisa nada por su rol)')
caso('NO lee el de una comercial', veredicto(socio, deAna, comercial, 'leer'), '404')
caso('NO lee el de un administrador', veredicto(socio, deRaul, administrador, 'leer'), '404')
caso('NO escribe desde el de Ana', veredicto(socio, deAna, comercial, 'escribir'), '404')
caso('NO desconecta el de Ana', veredicto(socio, deAna, comercial, 'administrar'), '404')
caso('lee el suyo, como cualquiera', veredicto(socio, deSocio, partner, 'leer'), 'sí (dueño)')
caso('un partner CON el permiso de supervisión comercial entra por el permiso, no por el rol', veredicto({ ...socio, tienePermisoEquipo: true }, deAna, comercial, 'leer'), 'sí (supervisión)')

console.log('quien supervisa el equipo comercial')
caso('lee el de una comercial', veredicto(alejandro, deAna, comercial, 'leer'), 'sí (supervisión)')
caso('NO lee el de un administrador', veredicto(alejandro, deRaul, administrador, 'leer'), '404')
caso('NO lee el de un partner', veredicto(alejandro, deSocio, partner, 'leer'), '404')
caso('NO lee el de alguien que no es comercial', veredicto(alejandro, deConta, noComercial, 'leer'), '404')
caso('NO lee el de una persona sin dato de comercial', veredicto(alejandro, deConta, { is_comercial: null, role: 'employee' }, 'leer'), '404')
caso('NO escribe desde el de Ana', veredicto(alejandro, deAna, comercial, 'escribir'), '403')
caso('NO responde desde el de Ana', veredicto(alejandro, deAna, comercial, 'responder'), '403')
caso('NO desconecta el de Ana', veredicto(alejandro, deAna, comercial, 'administrar'), '403')

console.log('quien supervisa el correo (permiso suelto, a quien el administrador quiera)')
caso('lee el de una comercial', veredicto(lucia, deAna, comercial, 'leer'), 'sí (supervisión)')
caso('lee el de alguien que NO es comercial (a diferencia de la supervisión comercial)', veredicto(lucia, deConta, noComercial, 'leer'), 'sí (supervisión)')
caso('lee el de una persona sin dato de comercial', veredicto(lucia, deConta, { is_comercial: null, role: 'employee' }, 'leer'), 'sí (supervisión)')
caso('lee el de un partner', veredicto(lucia, deSocio, partner, 'leer'), 'sí (supervisión)')
caso('NO lee el de un administrador', veredicto(lucia, deRaul, administrador, 'leer'), '404')
caso('NO lee uno cuyo dueño no se conoce (ante la duda, no se abre)', veredicto(lucia, deConta, { is_comercial: null, role: null }, 'leer'), '404')
caso('NO escribe desde el de Ana', veredicto(lucia, deAna, comercial, 'escribir'), '403')
caso('NO responde desde el de Ana (supervisar no es escribir)', veredicto(lucia, deAna, comercial, 'responder'), '403')
caso('NO escribe desde el de nadie que no sea comercial', veredicto(lucia, deConta, noComercial, 'escribir'), '403')
caso('NO desconecta el de Ana', veredicto(lucia, deAna, comercial, 'administrar'), '403')
caso('lee el suyo, como cualquiera', veredicto(lucia, deLucia, noComercial, 'leer'), 'sí (dueño)')
caso('escribe desde el suyo', veredicto(lucia, deLucia, noComercial, 'escribir'), 'sí (dueño)')
caso('un partner con este permiso lo lee por el permiso', veredicto({ ...socio, tienePermisoCorreo: true }, deConta, noComercial, 'leer'), 'sí (supervisión)')
caso('con los dos permisos tampoco lee el de un administrador', veredicto({ ...alejandro, tienePermisoCorreo: true }, deRaul, administrador, 'leer'), '404')

console.log('el resto del equipo')
caso('no lee el de Ana', veredicto(conta, deAna, comercial, 'leer'), '404')
caso('no lee el de un administrador', veredicto(conta, deRaul, administrador, 'leer'), '404')
caso('no lee el de otra persona que tampoco es comercial', veredicto(conta, deLucia, noComercial, 'leer'), '404')

console.log('quien tiene un buzón concedido a mano (Correo → Quién ve qué)')
{
  const jhanna: QuienPide = { userId: 'jhanna', role: 'employee', ...sin, buzonesConcedidos: new Set(['b-ana', 'b-bea']) }
  const buzonAna = { user_id: 'ana', id: 'b-ana' }
  const buzonBea = { user_id: 'bea', id: 'b-bea' }
  const buzonConta = { user_id: 'conta', id: 'b-conta' }
  const buzonRaul = { user_id: 'raul', id: 'b-raul' }
  caso('lee el que se le ha concedido', veredicto(jhanna, buzonAna, comercial, 'leer'), 'sí (supervisión)')
  caso('lee el otro que se le ha concedido', veredicto(jhanna, buzonBea, comercial, 'leer'), 'sí (supervisión)')
  caso('NO lee uno que no se le ha concedido', veredicto(jhanna, buzonConta, noComercial, 'leer'), '404')
  caso('NO lee el de un administrador si no se le ha concedido', veredicto(jhanna, buzonRaul, administrador, 'leer'), '404')
  caso('NO escribe desde el concedido', veredicto(jhanna, buzonAna, comercial, 'escribir'), '403')
  caso('NO responde desde el concedido (conceder es solo leer)', veredicto(jhanna, buzonAna, comercial, 'responder'), '403')
  caso('NO desconecta el concedido', veredicto(jhanna, buzonAna, comercial, 'administrar'), '403')
  caso('sin el id del buzón no se abre nada (ante la duda, no)', veredicto(jhanna, { user_id: 'ana' }, comercial, 'leer'), '404')
  caso('lo concedido es por buzón, no por persona: otro buzón de la misma dueña no se abre', veredicto(jhanna, { user_id: 'ana', id: 'b-ana-2' }, comercial, 'leer'), '404')
  const conTodo: QuienPide = { ...jhanna, buzonesConcedidos: new Set(['b-raul']) }
  caso('un administrador puede conceder el buzón de otro administrador: lo decide quien lo concede', veredicto(conTodo, buzonRaul, administrador, 'leer'), 'sí (supervisión)')
  const vacio: QuienPide = { ...jhanna, buzonesConcedidos: new Set() }
  caso('con la lista vacía, nada', veredicto(vacio, buzonAna, comercial, 'leer'), '404')
  const sinLista: QuienPide = { userId: 'jhanna', role: 'employee', ...sin }
  caso('sin lista (quien nunca ha tenido ninguno), nada', veredicto(sinLista, buzonAna, comercial, 'leer'), '404')
  caso('un partner no entra ni con un buzón en la tabla: no supervisa por rol ni por esto', veredicto({ userId: 'socio', role: 'partner', ...sin, buzonesConcedidos: new Set(['b-ana']) }, buzonAna, comercial, 'leer'), '404')
  caso('sumado a un permiso de supervisión, sigue valiendo lo más amplio', veredicto({ ...jhanna, tienePermisoEquipo: true }, buzonConta, comercial, 'leer'), 'sí (supervisión)')
  caso('el dueño sigue leyendo el suyo con la lista que tenga', veredicto({ userId: 'ana', role: 'employee', ...sin, buzonesConcedidos: new Set(['b-bea']) }, buzonAna, comercial, 'leer'), 'sí (dueño)')
}

console.log('quien tiene un buzón BLOQUEADO (Correo → Quién ve qué, migración 260)')
{
  const buzonAna = { user_id: 'ana', id: 'b-ana' }
  const buzonBea = { user_id: 'bea', id: 'b-bea' }
  const buzonConta = { user_id: 'conta', id: 'b-conta' }
  const buzonRaul = { user_id: 'raul', id: 'b-raul' }
  // Alejandro supervisa el equipo comercial y el correo (lee todo lo que no es de un administrador), pero a Raúl no le parece bien que lea el de la administrativa
  const alejandroConTodo: QuienPide = { userId: 'alejandro', role: 'employee', tienePermisoEquipo: true, tienePermisoCorreo: true }
  caso('sin bloqueos lee el de una comercial y el de la administrativa (los dos permisos)', veredicto(alejandroConTodo, buzonAna, comercial, 'leer') + '|' + veredicto(alejandroConTodo, buzonConta, noComercial, 'leer'), 'sí (supervisión)|sí (supervisión)')
  const sinConta: QuienPide = { ...alejandroConTodo, buzonesBloqueados: new Set(['b-conta']) }
  caso('con el de la administrativa bloqueado, ese NO lo lee (aunque el permiso del correo lo abriría)', veredicto(sinConta, buzonConta, noComercial, 'leer'), '404')
  caso('y sigue leyendo el de las comerciales (el bloqueo es de un buzón, no de la persona)', veredicto(sinConta, buzonAna, comercial, 'leer'), 'sí (supervisión)')
  caso('bloquear a una persona un buzón no le quita el permiso para los demás', veredicto(sinConta, buzonBea, comercial, 'leer'), 'sí (supervisión)')
  const sinAna: QuienPide = { ...alejandroConTodo, buzonesBloqueados: new Set(['b-ana']) }
  caso('el permiso de supervisión comercial tampoco abre un buzón bloqueado', veredicto({ userId: 'alejandro', role: 'employee', tienePermisoEquipo: true, tienePermisoCorreo: false, buzonesBloqueados: new Set(['b-ana']) }, buzonAna, comercial, 'leer'), '404')
  caso('ni lo escribe ni lo administra (para ella no existe)', veredicto(sinAna, buzonAna, comercial, 'escribir') + '|' + veredicto(sinAna, buzonAna, comercial, 'administrar'), '404|404')
  const concedidoYBloqueado: QuienPide = { userId: 'jhanna', role: 'employee', ...sin, buzonesConcedidos: new Set(['b-ana']), buzonesBloqueados: new Set(['b-ana']) }
  caso('un buzón abierto a mano y a la vez bloqueado: gana el bloqueo', veredicto(concedidoYBloqueado, buzonAna, comercial, 'leer'), '404')
  const soloOtroBloqueado: QuienPide = { userId: 'jhanna', role: 'employee', ...sin, buzonesConcedidos: new Set(['b-ana', 'b-bea']), buzonesBloqueados: new Set(['b-bea']) }
  caso('el bloqueo de un buzón no cierra el otro que tiene abierto a mano', veredicto(soloOtroBloqueado, buzonAna, comercial, 'leer') + '|' + veredicto(soloOtroBloqueado, buzonBea, comercial, 'leer'), 'sí (supervisión)|404')
  caso('un bloqueo en la lista no afecta al dueño: siempre lee el suyo', veredicto({ userId: 'ana', role: 'employee', ...sin, buzonesBloqueados: new Set(['b-ana']) }, buzonAna, comercial, 'leer') + '|' + veredicto({ userId: 'ana', role: 'employee', ...sin, buzonesBloqueados: new Set(['b-ana']) }, buzonAna, comercial, 'escribir'), 'sí (dueño)|sí (dueño)')
  caso('ni a un administrador (nunca se le bloquea nada)', veredicto({ userId: 'raul', role: 'admin', ...sin, buzonesBloqueados: new Set(['b-ana', 'b-conta']) }, buzonAna, comercial, 'leer') + '|' + veredicto({ userId: 'raul', role: 'admin', ...sin, buzonesBloqueados: new Set(['b-conta']) }, buzonConta, noComercial, 'leer'), 'sí (supervisión)|sí (supervisión)')
  caso('el bloqueo también cierra el buzón de un administrador que se le hubiera abierto a mano', veredicto({ userId: 'jhanna', role: 'employee', ...sin, buzonesConcedidos: new Set(['b-raul']), buzonesBloqueados: new Set(['b-raul']) }, buzonRaul, administrador, 'leer'), '404')
  caso('sin el id del buzón no hay forma de saber que está bloqueado: la regla de siempre manda', veredicto(sinConta, { user_id: 'conta' }, noComercial, 'leer'), 'sí (supervisión)')
  caso('una lista de bloqueos vacía no cambia nada', veredicto({ ...alejandroConTodo, buzonesBloqueados: new Set() }, buzonConta, noComercial, 'leer'), 'sí (supervisión)')
  const d = decidirAcceso(sinConta, buzonConta, noComercial, 'leer')
  ok('lo bloqueado se niega con el mismo «no existe» de siempre (no se nota que existe)', !d.ok && d.mensaje === NO_EXISTE && d.estado === 404)
}

console.log('lo que no se ve se niega como si no existiera')
{
  const d = decidirAcceso(conta, deAna, comercial, 'leer')
  ok('el mensaje es el mismo que el de un id inventado', !d.ok && d.mensaje === NO_EXISTE)
  const e = decidirAcceso(lucia, deRaul, administrador, 'leer')
  ok('también cuando lo que se niega es el buzón de un administrador', !e.ok && e.mensaje === NO_EXISTE && e.estado === 404)
}

console.log('un rol que no existe no abre nada')
caso('rol raro', veredicto({ userId: 'x', role: 'superadmin', ...sin }, deAna, comercial, 'leer'), '404')
caso('rol vacío', veredicto({ userId: 'x', role: '', ...sin }, deAna, comercial, 'leer'), '404')

console.log('buzones ASIGNADOS (migración 318): leer, responder solo con la casilla, configurar nunca')
{
  const buzonAna = { user_id: 'ana', id: 'b-ana' }
  const buzonBea = { user_id: 'bea', id: 'b-bea' }
  const patricia: QuienPide = { userId: 'patricia', role: 'employee', ...sin, buzonesAsignados: new Set(['b-ana', 'b-bea']), buzonesConRespuesta: new Set(['b-ana']) }
  caso('con respuesta: lee, responde, no configura ni desconecta', ['leer', 'responder', 'escribir', 'administrar'].map((m) => veredicto(patricia, buzonAna, comercial, m as ModoDeAcceso)).join('|'), 'sí (supervisión)|sí (supervisión)|403|403')
  caso('sin respuesta (solo avisos): lee, pero no responde', veredicto(patricia, buzonBea, comercial, 'leer') + '|' + veredicto(patricia, buzonBea, comercial, 'responder'), 'sí (supervisión)|403')
  caso('una respuesta sin asignación no cuenta (fila suelta)', veredicto({ userId: 'x', role: 'employee', ...sin, buzonesConRespuesta: new Set(['b-ana']) }, buzonAna, comercial, 'leer'), '404')
  const d = decidirAcceso(patricia, buzonAna, comercial, 'leer')
  ok('la decisión dice asignado y puedeResponder', d.ok && d.asignado && d.puedeResponder && d.porSupervision && !d.esDueno)
  const e = decidirAcceso(patricia, buzonBea, comercial, 'leer')
  ok('solo avisos: asignado, sin puedeResponder', e.ok && e.asignado && !e.puedeResponder)
  const f = decidirAcceso(lucia, buzonAna, comercial, 'leer')
  ok('el supervisor no sale como asignado ni puede responder', f.ok && !f.asignado && !f.puedeResponder)
  const g = decidirAcceso(ana, buzonAna, comercial, 'leer')
  ok('el dueño puede responder y no sale como asignado', g.ok && g.puedeResponder && !g.asignado && !g.porSupervision)
  const r = decidirAcceso(patricia, buzonBea, comercial, 'responder')
  ok('responder sin permiso explica que hace falta una asignación', !r.ok && r.estado === 403 && r.mensaje === SOLO_ASIGNADO_RESPONDE)
  const w = decidirAcceso(patricia, buzonAna, comercial, 'escribir')
  ok('escribir sin ser el dueño da el mensaje NEUTRO (Keepa y Cuentas lo usan para enviar)', !w.ok && w.estado === 403 && w.mensaje === SOLO_EL_DUENO)
  caso('un asignado con un permiso de supervisión sigue respondiendo por la asignación', veredicto({ ...patricia, tienePermisoCorreo: true }, buzonAna, comercial, 'responder'), 'sí (supervisión)')
  caso('el buzón asignado de un administrador se lee (lo decide quien asigna)', veredicto({ ...patricia, buzonesAsignados: new Set(['b-raul']), buzonesConRespuesta: new Set(['b-raul']) }, { user_id: 'raul', id: 'b-raul' }, administrador, 'responder'), 'sí (supervisión)')
}

console.log('tabla de la especificación (3.2): leer | responder | escribir | administrar | rastro')
{
  const buzonAna = { user_id: 'ana', id: 'b-ana' }
  const buzonDaniela = { user_id: 'daniela', id: 'b-daniela' }
  const buzonRaul = { user_id: 'raul', id: 'b-raul' }
  const modos: ModoDeAcceso[] = ['leer', 'responder', 'escribir', 'administrar']
  const fila = (quien: QuienPide, buzon: { user_id: string; id?: string }, dueno: DatosDelDueno) => {
    const ds = modos.map((m) => decidirAcceso(quien, buzon, dueno, m))
    const celdas = ds.map((d) => (d.ok ? '✓' : `${d.estado}`))
    const leer = ds[0]
    celdas.push(leer.ok ? (leer.porSupervision ? 'sí' : 'no') : '—')
    return celdas.join(' ')
  }
  const tabla = (n: number, nombre: string, real: string, esperado: string) => caso(`${n}. ${nombre}`, real, esperado)
  const asignada = (conRespuesta: boolean, extra: Partial<QuienPide> = {}): QuienPide => ({
    userId: 'bea', role: 'employee', ...sin, buzonesAsignados: new Set(['b-ana']), buzonesConRespuesta: new Set(conRespuesta ? ['b-ana'] : []), ...extra,
  })

  tabla(1, 'dueña (comercial), el suyo', fila(ana, buzonAna, comercial), '✓ ✓ ✓ ✓ no')
  tabla(2, 'admin, el de Ana', fila(raul, buzonAna, comercial), '✓ 403 403 ✓ sí')
  tabla(3, 'admin con asignación a sí mismo y respuesta, el de Ana', fila({ ...raul, buzonesAsignados: new Set(['b-ana']), buzonesConRespuesta: new Set(['b-ana']) }, buzonAna, comercial), '✓ ✓ 403 ✓ sí')
  tabla(4, 'comercial sin nada, el de Ana', fila(bea, buzonAna, comercial), '404 404 404 404 —')
  tabla(5, 'comercial con asignación y respuesta, el de Ana', fila(asignada(true), buzonAna, comercial), '✓ ✓ 403 403 sí')
  tabla(6, 'comercial con asignación sin respuesta, el de Ana', fila(asignada(false), buzonAna, comercial), '✓ 403 403 403 sí')
  tabla(7, 'administrativa con concesión (255), el de Daniela', fila({ ...conta, buzonesConcedidos: new Set(['b-daniela']) }, buzonDaniela, comercial), '✓ 403 403 403 sí')
  tabla(8, 'supervisora de correo, el de Ana', fila(lucia, buzonAna, comercial), '✓ 403 403 403 sí')
  tabla(9, 'supervisora de correo, el de un admin', fila(lucia, buzonRaul, administrador), '404 404 404 404 —')
  tabla(10, 'supervisora de correo con el de Ana bloqueado', fila({ ...lucia, buzonesBloqueados: new Set(['b-ana']) }, buzonAna, comercial), '404 404 404 404 —')
  tabla(11, 'asignada con respuesta y además bloqueada (estado imposible): gana el bloqueo', fila(asignada(true, { buzonesBloqueados: new Set(['b-ana']) }), buzonAna, comercial), '404 404 404 404 —')
  tabla(12, 'partner con asignación (fila colada): no entra', fila({ ...socio, buzonesAsignados: new Set(['b-ana']), buzonesConRespuesta: new Set(['b-ana']) }, buzonAna, comercial), '404 404 404 404 —')
  tabla(13, 'supervisor de ventas, el de una comercial', fila(alejandro, buzonAna, comercial), '✓ 403 403 403 sí')
  tabla(14, 'asignada, sin id de buzón en la llamada: sin id no hay asignación', fila(asignada(true), { user_id: 'ana' }, comercial), '404 404 404 404 —')
  caso('14b. y si por otra vía lo lee, lee pero no responde', fila(asignada(true, { tienePermisoCorreo: true }), { user_id: 'ana' }, comercial), '✓ 403 403 403 sí')
  tabla(15, 'dueña con su propio buzón «bloqueado» (fila colada)', fila({ ...ana, buzonesBloqueados: new Set(['b-ana']) }, buzonAna, comercial), '✓ ✓ ✓ ✓ no')
}

console.log('\n=== Los avisos: los ajenos (asignados y seguidos) pasan todos por la regla ===')
{
  const duenos = new Map([['ana', { is_comercial: true, role: 'employee' }], ['jose', { is_comercial: true, role: 'employee' }]])
  const ajenos = [{ id: 'b-ana', user_id: 'ana' }, { id: 'b-jose', user_id: 'jose' }]
  const asignadaYBloqueada: QuienPide = { userId: 'bea', role: 'employee', ...sin, buzonesAsignados: new Set(['b-ana', 'b-jose']), buzonesConRespuesta: new Set(['b-ana']), buzonesBloqueados: new Set(['b-ana']) }
  const ids = (q: QuienPide) => buzonesAjenosQueSeLeen(q, ajenos, duenos).map((b) => b.id).join(',') || '(ninguno)'
  ok('asignado y bloqueado: fuera (ni IMAP ni aviso); el otro asignado sigue', ids(asignadaYBloqueada) === 'b-jose', ids(asignadaYBloqueada))
  ok('asignado sin bloqueo: entra', ids({ ...asignadaYBloqueada, buzonesBloqueados: new Set() }) === 'b-ana,b-jose')
  ok('un partner con asignaciones coladas: ninguno', ids({ ...asignadaYBloqueada, role: 'partner', buzonesBloqueados: new Set() }) === '(ninguno)')
  ok('dueño desconocido y sin vía: fuera', buzonesAjenosQueSeLeen({ userId: 'bea', role: 'employee', ...sin, tienePermisoCorreo: true }, [{ id: 'b-x', user_id: 'x' }], duenos).length === 0)
}

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
