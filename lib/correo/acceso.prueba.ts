import { NO_EXISTE, decidirAcceso, type DatosDelDueno, type ModoDeAcceso, type QuienPide } from '@/lib/correo/acceso'

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
caso('NO escribe desde el de Ana', veredicto(raul, deAna, comercial, 'escribir'), '403')
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
caso('NO desconecta el de Ana', veredicto(alejandro, deAna, comercial, 'administrar'), '403')

console.log('quien supervisa el correo (permiso suelto, a quien el administrador quiera)')
caso('lee el de una comercial', veredicto(lucia, deAna, comercial, 'leer'), 'sí (supervisión)')
caso('lee el de alguien que NO es comercial (a diferencia de la supervisión comercial)', veredicto(lucia, deConta, noComercial, 'leer'), 'sí (supervisión)')
caso('lee el de una persona sin dato de comercial', veredicto(lucia, deConta, { is_comercial: null, role: 'employee' }, 'leer'), 'sí (supervisión)')
caso('lee el de un partner', veredicto(lucia, deSocio, partner, 'leer'), 'sí (supervisión)')
caso('NO lee el de un administrador', veredicto(lucia, deRaul, administrador, 'leer'), '404')
caso('NO lee uno cuyo dueño no se conoce (ante la duda, no se abre)', veredicto(lucia, deConta, { is_comercial: null, role: null }, 'leer'), '404')
caso('NO escribe desde el de Ana', veredicto(lucia, deAna, comercial, 'escribir'), '403')
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

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
