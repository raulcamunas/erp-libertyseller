import { NO_EXISTE, decidirAcceso, type ModoDeAcceso, type QuienPide } from '@/lib/correo/acceso'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * ACCESO A LOS BUZONES: la regla entera, caso por caso.
 *
 * Personas de la prueba:
 *   · ana      comercial, dueña de su buzón
 *   · bea      otra comercial
 *   · raul     administrador (no comercial)
 *   · socio    partner (no comercial; figura externa)
 *   · alejandro employee con el permiso «Supervisión del equipo comercial»
 *   · conta    employee sin nada especial
 */

const ana: QuienPide = { userId: 'ana', role: 'employee', tienePermisoEquipo: false }
const bea: QuienPide = { userId: 'bea', role: 'employee', tienePermisoEquipo: false }
const raul: QuienPide = { userId: 'raul', role: 'admin', tienePermisoEquipo: false }
const socio: QuienPide = { userId: 'socio', role: 'partner', tienePermisoEquipo: false }
const alejandro: QuienPide = { userId: 'alejandro', role: 'employee', tienePermisoEquipo: true }
const conta: QuienPide = { userId: 'conta', role: 'employee', tienePermisoEquipo: false }

const deAna = { user_id: 'ana' }
const deRaul = { user_id: 'raul' }
const deSocio = { user_id: 'socio' }
const deConta = { user_id: 'conta' }
const comercial = { is_comercial: true }
const noComercial = { is_comercial: false }

const veredicto = (quien: QuienPide, buzon: { user_id: string }, dueno: { is_comercial: boolean | null }, modo: ModoDeAcceso) => {
  const d = decidirAcceso(quien, buzon, dueno, modo)
  return d.ok ? (d.porSupervision ? 'sí (supervisión)' : 'sí (dueño)') : `${d.estado}`
}
const caso = (nombre: string, real: string, esperado: string) => ok(nombre, real === esperado, `real «${real}», esperado «${esperado}»`)

console.log('el dueño')
caso('lee el suyo', veredicto(ana, deAna, comercial, 'leer'), 'sí (dueño)')
caso('escribe desde el suyo', veredicto(ana, deAna, comercial, 'escribir'), 'sí (dueño)')
caso('cambia la conexión del suyo', veredicto(ana, deAna, comercial, 'administrar'), 'sí (dueño)')
caso('un administrador dueño de su propio buzón lo usa como cualquiera', veredicto(raul, deRaul, noComercial, 'escribir'), 'sí (dueño)')
caso('un employee no comercial dueño de su buzón lo lee', veredicto(conta, deConta, noComercial, 'leer'), 'sí (dueño)')

console.log('otra comercial')
caso('no lee el de Ana', veredicto(bea, deAna, comercial, 'leer'), '404')
caso('no escribe desde el de Ana', veredicto(bea, deAna, comercial, 'escribir'), '404')
caso('no lo desconecta', veredicto(bea, deAna, comercial, 'administrar'), '404')

console.log('el administrador')
caso('lee el de una comercial', veredicto(raul, deAna, comercial, 'leer'), 'sí (supervisión)')
caso('lee el de alguien que no es comercial', veredicto(raul, deConta, noComercial, 'leer'), 'sí (supervisión)')
caso('lee el de un partner', veredicto(raul, deSocio, noComercial, 'leer'), 'sí (supervisión)')
caso('NO escribe desde el de Ana', veredicto(raul, deAna, comercial, 'escribir'), '403')
caso('desconecta el de Ana', veredicto(raul, deAna, comercial, 'administrar'), 'sí (supervisión)')

console.log('un partner (figura externa: no supervisa nada)')
caso('NO lee el de una comercial', veredicto(socio, deAna, comercial, 'leer'), '404')
caso('NO lee el de un administrador', veredicto(socio, deRaul, noComercial, 'leer'), '404')
caso('NO escribe desde el de Ana', veredicto(socio, deAna, comercial, 'escribir'), '404')
caso('NO desconecta el de Ana', veredicto(socio, deAna, comercial, 'administrar'), '404')
caso('lee el suyo, como cualquiera', veredicto(socio, deSocio, noComercial, 'leer'), 'sí (dueño)')
caso('un partner CON el permiso de supervisión tampoco entra por rol (lo que cuenta es el permiso)', veredicto({ ...socio, tienePermisoEquipo: true }, deAna, comercial, 'leer'), 'sí (supervisión)')

console.log('quien supervisa el equipo comercial')
caso('lee el de una comercial', veredicto(alejandro, deAna, comercial, 'leer'), 'sí (supervisión)')
caso('NO lee el de un administrador', veredicto(alejandro, deRaul, noComercial, 'leer'), '404')
caso('NO lee el de un partner', veredicto(alejandro, deSocio, noComercial, 'leer'), '404')
caso('NO lee el de alguien que no es comercial', veredicto(alejandro, deConta, noComercial, 'leer'), '404')
caso('NO lee el de una persona sin dato de comercial', veredicto(alejandro, deConta, { is_comercial: null }, 'leer'), '404')
caso('NO escribe desde el de Ana', veredicto(alejandro, deAna, comercial, 'escribir'), '403')
caso('NO desconecta el de Ana', veredicto(alejandro, deAna, comercial, 'administrar'), '403')

console.log('el resto del equipo')
caso('no lee el de Ana', veredicto(conta, deAna, comercial, 'leer'), '404')
caso('no lee el de un administrador', veredicto(conta, deRaul, noComercial, 'leer'), '404')

console.log('lo que no se ve se niega como si no existiera')
{
  const d = decidirAcceso(conta, deAna, comercial, 'leer')
  ok('el mensaje es el mismo que el de un id inventado', !d.ok && d.mensaje === NO_EXISTE)
}

console.log('un rol que no existe no abre nada')
caso('rol raro', veredicto({ userId: 'x', role: 'superadmin', tienePermisoEquipo: false }, deAna, comercial, 'leer'), '404')
caso('rol vacío', veredicto({ userId: 'x', role: '', tienePermisoEquipo: false }, deAna, comercial, 'leer'), '404')

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
