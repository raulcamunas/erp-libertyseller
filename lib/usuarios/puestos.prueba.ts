import { PERMISOS_SUELTOS, PERMISO_CORREO_SUPERVISION, PERMISO_CRM_PROPIOS, PERMISO_EQUIPO_COMERCIAL, PERMISO_GESTION_LISTAS, apps } from '@/lib/config/apps'
import {
  ETIQUETA_DE_PUESTO,
  OPCIONES_DE_ROL,
  PERMISOS_DEL_PUESTO,
  PUESTOS,
  aplicarPuesto,
  cambioDePuestoDeLaPeticion,
  esComercialDelPuesto,
  esPuesto,
  etiquetaDeRol,
  llevaListaPropia,
  opcionDeRol,
  rolYPuestoDe,
  type Casilla,
} from '@/lib/usuarios/puestos'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LOS PUESTOS DEL EQUIPO.
 *
 * Lo que se vigila: que un puesto se guarde como empleado + puesto y vuelva a salir igual en el desplegable, que las casillas de cada puesto existan de verdad en la lista de
 * apps (un id mal escrito no da ningún error: simplemente no se marca nada), que cambiar de puesto al editar no le quite a nadie lo que ya tenía, y que lo que llega a las
 * rutas se valide: un puesto inventado, un puesto en un admin, un is_comercial que no es un booleano.
 */

const casillasDe = (...marcadas: string[]): Casilla[] => [...apps.map((a) => a.id), ...PERMISOS_SUELTOS.map((p) => p.id)].map((id) => ({ app_id: id, can_access: marcadas.includes(id) }))
const marcadas = (c: readonly Casilla[]) => c.filter((x) => x.can_access).map((x) => x.app_id).sort()

function main() {
  console.log('\n=== los tres puestos ===')
  {
    ok('son cuatro y tienen nombre', PUESTOS.length === 4 && PUESTOS.every((p) => ETIQUETA_DE_PUESTO[p].length > 0))
    ok('los nombres son los que pidió Raúl', ETIQUETA_DE_PUESTO.comercial === 'Comercial' && ETIQUETA_DE_PUESTO.manager_comercial === 'Manager Comercial' && ETIQUETA_DE_PUESTO.comercial_autonomo === 'Comercial Autónomo' && ETIQUETA_DE_PUESTO.gestion_administrativa === 'Gestión Administrativa')
    ok('esPuesto acepta los cuatro y nada más', PUESTOS.every(esPuesto) && !esPuesto('admin') && !esPuesto('employee') && !esPuesto(null) && !esPuesto(3) && !esPuesto('') && !esPuesto('autonomo'))
    ok('el desplegable ofrece Empleado, los cuatro puestos, Admin, Partner y Cliente, sin repetir', OPCIONES_DE_ROL.map((o) => o.valor).join() === 'employee,comercial,manager_comercial,comercial_autonomo,gestion_administrativa,admin,partner,cliente')
    ok('y cada opción dice qué significa', OPCIONES_DE_ROL.every((o) => o.ayuda.length > 20 && o.etiqueta.length > 0))
  }

  console.log('\n=== del desplegable a la base, y vuelta ===')
  {
    ok('un puesto se guarda como empleado + puesto', JSON.stringify(rolYPuestoDe('manager_comercial')) === JSON.stringify({ role: 'employee', puesto: 'manager_comercial' }))
    ok('un rol de siempre, sin puesto', JSON.stringify(rolYPuestoDe('admin')) === JSON.stringify({ role: 'admin', puesto: null }) && JSON.stringify(rolYPuestoDe('cliente')) === JSON.stringify({ role: 'cliente', puesto: null }))
    ok('«Empleado» a secas, sin puesto', JSON.stringify(rolYPuestoDe('employee')) === JSON.stringify({ role: 'employee', puesto: null }))
    for (const o of OPCIONES_DE_ROL) {
      const { role, puesto } = rolYPuestoDe(o.valor)
      ok(`${o.valor}: guardar y volver a leer da la misma opción`, opcionDeRol(role, puesto) === o.valor)
    }
    ok('un empleado de la base sin puesto (o sin la columna, antes de la 257) sale como «Empleado»', opcionDeRol('employee', null) === 'employee' && opcionDeRol('employee', undefined) === 'employee')
    ok('un puesto raro guardado a mano no rompe: empleado', opcionDeRol('employee', 'cocinero') === 'employee')
    ok('un admin con un puesto que se le quedó de antes sigue siendo admin', opcionDeRol('admin', 'manager_comercial') === 'admin')
    ok('un rol que no existe: empleado', opcionDeRol('rey', null) === 'employee' && opcionDeRol(undefined, null) === 'employee')
    ok('cómo se nombra en la tabla', etiquetaDeRol('employee', 'comercial') === 'Comercial' && etiquetaDeRol('employee', null) === 'Empleado' && etiquetaDeRol('admin', null) === 'Admin' && etiquetaDeRol('partner', null) === 'Partner' && etiquetaDeRol('cliente', null) === 'Cliente' && etiquetaDeRol('employee', 'gestion_administrativa') === 'Gestión Administrativa')
  }

  console.log('\n=== las casillas de cada puesto existen de verdad ===')
  {
    const existentes = new Set([...apps.map((a) => a.id), ...PERMISOS_SUELTOS.map((p) => p.id)])
    for (const p of PUESTOS) {
      const faltan = PERMISOS_DEL_PUESTO[p].filter((id) => !existentes.has(id))
      ok(`${p}: todas las casillas existen en apps o en los permisos sueltos`, faltan.length === 0, faltan.join(', '))
      ok(`${p}: sin casillas repetidas`, new Set(PERMISOS_DEL_PUESTO[p]).size === PERMISOS_DEL_PUESTO[p].length)
    }
    ok('los permisos sueltos del manager son los de lib/config/apps.ts, letra por letra', PERMISOS_DEL_PUESTO.manager_comercial.includes(PERMISO_EQUIPO_COMERCIAL) && PERMISOS_DEL_PUESTO.manager_comercial.includes(PERMISO_CORREO_SUPERVISION) && PERMISOS_DEL_PUESTO.manager_comercial.includes(PERMISO_GESTION_LISTAS))
    ok('el comercial tiene lo mismo que los cuatro comerciales de hoy', PERMISOS_DEL_PUESTO.comercial.slice().sort().join() === 'agenda,cold-calling,correo,horas,rendimiento')
    ok('y NO tiene ninguno de los permisos de supervisión', !PERMISOS_DEL_PUESTO.comercial.includes(PERMISO_EQUIPO_COMERCIAL) && !PERMISOS_DEL_PUESTO.comercial.includes(PERMISO_GESTION_LISTAS) && !PERMISOS_DEL_PUESTO.comercial.includes(PERMISO_CORREO_SUPERVISION))
    ok('el manager tiene todo lo del comercial más lo suyo', PERMISOS_DEL_PUESTO.comercial.every((id) => PERMISOS_DEL_PUESTO.manager_comercial.includes(id)))
    ok('administración: correo y vacaciones, sin Cold Calling', PERMISOS_DEL_PUESTO.gestion_administrativa.slice().sort().join() === 'correo,vacaciones')
    ok('el autónomo: solo el CRM de lo suyo (crm-propios, letra por letra como en apps.ts)', PERMISOS_DEL_PUESTO.comercial_autonomo.join() === PERMISO_CRM_PROPIOS && PERMISO_CRM_PROPIOS === 'crm-propios')
    ok('y NO el de supervisar a todo el equipo, ni nada de Cold Calling, correo o horas', !PERMISOS_DEL_PUESTO.comercial_autonomo.includes(PERMISO_EQUIPO_COMERCIAL) && !PERMISOS_DEL_PUESTO.comercial_autonomo.some((id) => ['cold-calling', 'correo', 'horas', 'rendimiento', 'agenda'].includes(id)))
    ok('«crm-propios» tiene su casilla con nombre y explicación en los permisos sueltos', (() => { const p = PERMISOS_SUELTOS.find((x) => x.id === PERMISO_CRM_PROPIOS); return !!p && p.name.length > 5 && p.description.length > 60 })())
    ok('ninguno de los cuatro abre Tesorería, Facturación, sueldos ni Amazon', PUESTOS.every((p) => !PERMISOS_DEL_PUESTO[p].some((id) => ['tesoreria', 'facturacion', 'empleados', 'amazon-api', 'commissions', 'users', 'tax-reports'].includes(id))))
  }

  console.log('\n=== marcar las casillas al elegir un puesto ===')
  {
    const nada = casillasDe()
    const comercial = aplicarPuesto(nada, 'comercial', 'sustituir')
    ok('crear un comercial: se marcan las suyas', marcadas(comercial).join() === 'agenda,cold-calling,correo,horas,rendimiento')
    ok('la lista de partida no se toca', marcadas(nada).length === 0)
    const manager = aplicarPuesto(comercial, 'manager_comercial', 'sustituir')
    ok('de comercial a manager al crear: las del manager, y nada de más', marcadas(manager).join() === 'agenda,cold-calling,correo,correo-supervision,equipo-comercial,gestion-listas,horas,rendimiento')
    ok('crear un autónomo: solo crm-propios', marcadas(aplicarPuesto(manager, 'comercial_autonomo', 'sustituir')).join() === 'crm-propios')
    ok('editar a alguien a autónomo suma crm-propios y no le quita lo que tenía', marcadas(aplicarPuesto(casillasDe('correo', 'agenda'), 'comercial_autonomo', 'sumar')).join() === 'agenda,correo,crm-propios')
    const admin = aplicarPuesto(manager, 'gestion_administrativa', 'sustituir')
    ok('de manager a administración al crear: solo las de administración (lo de antes se quita)', marcadas(admin).join() === 'correo,vacaciones')
    const conExtra = casillasDe('marketing-ads', 'correo')
    const sumado = aplicarPuesto(conExtra, 'comercial', 'sumar')
    ok('editar: cambiar de puesto SUMA las del puesto y no quita lo que ya tenía', marcadas(sumado).join() === 'agenda,cold-calling,correo,horas,marketing-ads,rendimiento')
    ok('editar a empleado a secas: no cambia nada', marcadas(aplicarPuesto(conExtra, null, 'sumar')).join() === 'correo,marketing-ads' && marcadas(aplicarPuesto(conExtra, null, 'sustituir')).join() === 'correo,marketing-ads')
    const ajena = aplicarPuesto([{ app_id: 'solo-esta', can_access: false }], 'comercial', 'sustituir')
    ok('solo cambia las casillas que existen en el formulario', ajena.length === 1 && ajena[0].can_access === false)
    ok('conserva las demás propiedades de cada casilla', aplicarPuesto([{ app_id: 'agenda', can_access: false, nombre: 'Agenda' }], 'comercial', 'sumar')[0].nombre === 'Agenda')
  }

  console.log('\n=== quién llama y quién tiene lista propia ===')
  {
    ok('un comercial siempre llama, se marque lo que se marque', esComercialDelPuesto('comercial', false) === true && esComercialDelPuesto('comercial', undefined) === true)
    ok('administración nunca', esComercialDelPuesto('gestion_administrativa', true) === false)
    ok('un autónomo, lo que se marque (por defecto no llama: no entra en el equipo de Cold Calling ni en las comisiones por cita)', esComercialDelPuesto('comercial_autonomo', true) === true && esComercialDelPuesto('comercial_autonomo', false) === false && esComercialDelPuesto('comercial_autonomo', undefined) === undefined)
    ok('un manager, lo que se marque; si no se dice, no se toca', esComercialDelPuesto('manager_comercial', true) === true && esComercialDelPuesto('manager_comercial', false) === false && esComercialDelPuesto('manager_comercial', undefined) === undefined)
    ok('sin puesto, lo que se marque; si no se dice, no se toca', esComercialDelPuesto(null, true) === true && esComercialDelPuesto(null, undefined) === undefined)
    ok('lista propia: el comercial sí, el manager solo si también llama, administración, el autónomo y los demás no', llevaListaPropia('comercial', true) && llevaListaPropia('manager_comercial', true) && !llevaListaPropia('manager_comercial', false) && !llevaListaPropia('gestion_administrativa', false) && !llevaListaPropia('comercial_autonomo', true) && !llevaListaPropia(null, true))
  }

  console.log('\n=== lo que llega a las rutas de crear y editar ===')
  {
    const c1 = cambioDePuestoDeLaPeticion({ puesto: 'comercial' }, 'employee')
    ok('un comercial: puesto y is_comercial a true', c1.ok && c1.puesto === 'comercial' && c1.is_comercial === true)
    const c2 = cambioDePuestoDeLaPeticion({ puesto: 'comercial', is_comercial: false }, 'employee')
    ok('aunque la petición diga que no llama, un comercial llama', c2.ok && c2.is_comercial === true)
    const c3 = cambioDePuestoDeLaPeticion({ puesto: 'gestion_administrativa', is_comercial: true }, 'employee')
    ok('administración nunca llama', c3.ok && c3.puesto === 'gestion_administrativa' && c3.is_comercial === false)
    const aut = cambioDePuestoDeLaPeticion({ puesto: 'comercial_autonomo' }, 'employee')
    ok('un autónomo: se guarda el puesto y no se toca is_comercial (no llama por defecto)', aut.ok && aut.puesto === 'comercial_autonomo' && !('is_comercial' in aut))
    const c4 = cambioDePuestoDeLaPeticion({ puesto: 'manager_comercial', is_comercial: true }, 'employee')
    const c5 = cambioDePuestoDeLaPeticion({ puesto: 'manager_comercial' }, 'employee')
    ok('un manager: lo que diga la petición; si no dice, no se toca', c4.ok && c4.is_comercial === true && c5.ok && c5.puesto === 'manager_comercial' && !('is_comercial' in c5))
    const c6 = cambioDePuestoDeLaPeticion({ puesto: null }, 'employee')
    ok('quitar el puesto: null, y no se toca is_comercial', c6.ok && c6.puesto === null && !('is_comercial' in c6))
    ok('un puesto en blanco también lo quita', (() => { const c = cambioDePuestoDeLaPeticion({ puesto: '' }, 'employee'); return c.ok && c.puesto === null })())
    const c7 = cambioDePuestoDeLaPeticion({}, 'employee')
    ok('una petición sin puesto ni is_comercial no toca nada', c7.ok && !('puesto' in c7) && !('is_comercial' in c7))
    const c8 = cambioDePuestoDeLaPeticion({ is_comercial: true }, 'employee')
    ok('solo is_comercial: se pone, y el puesto no se toca', c8.ok && c8.is_comercial === true && !('puesto' in c8))

    const c9 = cambioDePuestoDeLaPeticion({ puesto: 'manager_comercial' }, 'admin')
    ok('un puesto a un admin: rechazado', !c9.ok && /empleado/.test(c9.error))
    ok('a un partner y a un cliente también', !cambioDePuestoDeLaPeticion({ puesto: 'comercial' }, 'partner').ok && !cambioDePuestoDeLaPeticion({ puesto: 'comercial' }, 'cliente').ok)
    const c10 = cambioDePuestoDeLaPeticion({}, 'admin')
    ok('pasar a alguien a admin sin decir nada del puesto: se le quita el que tuviera', c10.ok && c10.puesto === null)
    const c11 = cambioDePuestoDeLaPeticion({ puesto: null }, 'cliente')
    ok('y con null explícito lo mismo', c11.ok && c11.puesto === null)
    const c12 = cambioDePuestoDeLaPeticion({ puesto: 'cocinero' }, 'employee')
    ok('un puesto inventado: rechazado', !c12.ok && /no existe/.test(c12.error))
    ok('un puesto que no es texto: rechazado', !cambioDePuestoDeLaPeticion({ puesto: 3 }, 'employee').ok && !cambioDePuestoDeLaPeticion({ puesto: {} }, 'employee').ok && !cambioDePuestoDeLaPeticion({ puesto: ['comercial'] }, 'employee').ok)
    ok('is_comercial que no es un booleano: rechazado', !cambioDePuestoDeLaPeticion({ is_comercial: 'si' }, 'employee').ok && !cambioDePuestoDeLaPeticion({ is_comercial: 1 }, 'employee').ok && !cambioDePuestoDeLaPeticion({ is_comercial: null }, 'employee').ok)
  }
}

main()
console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
if (fallos > 0) process.exit(1)
