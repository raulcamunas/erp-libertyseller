import { PERMISOS_SUELTOS, apps } from '@/lib/config/apps'
import { CASILLAS, CASILLAS_GESTIONADAS, CASILLA_POR_ID, GRUPOS_DE_CASILLAS, casillaCoincide, casillasDelPuesto, origenDeCasilla } from '@/lib/usuarios/casillas'
import {
  CORREO_DEL_DUENO,
  casillasMarcadasDeLaPeticion,
  errorAlDarDeBaja,
  errorAlEditar,
  esAdminPleno,
  estaDesactivado,
  planDeCasillas,
  puedeGestionarUsuarios,
} from '@/lib/usuarios/gestion'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * GESTIÓN DE USUARIOS: QUIÉN ENTRA, QUÉ NO SE DEJA HACER NUNCA Y QUÉ CASILLAS SE TOCAN AL GUARDAR.
 *   npx tsx lib/usuarios/gestion.prueba.ts
 */

const dueno = { id: 'raul', role: 'admin', puesto: null, email: CORREO_DEL_DUENO }
const otroAdmin = { id: 'ana', role: 'admin', puesto: null, email: 'ana@x.es' }
const ceo = { id: 'ceo', role: 'admin', puesto: 'ceo', email: 'ceo@x.es' }
const empleado = { id: 'luis', role: 'employee', puesto: 'comercial', email: 'luis@x.es' }

function main() {
  console.log('\n=== quién gestiona usuarios ===')
  ok('el dueño, administrador pleno', puedeGestionarUsuarios(dueno))
  ok('el correo del dueño, en mayúsculas y con espacios, también', puedeGestionarUsuarios({ ...dueno, email: `  ${CORREO_DEL_DUENO.toUpperCase()} ` }))
  ok('otro administrador, no', !puedeGestionarUsuarios(otroAdmin))
  ok('un CEO, no (ni con el correo del dueño)', !puedeGestionarUsuarios(ceo) && !puedeGestionarUsuarios({ ...ceo, email: CORREO_DEL_DUENO }))
  ok('el correo del dueño sin ser admin, no', !puedeGestionarUsuarios({ ...empleado, email: CORREO_DEL_DUENO }))
  ok('sin perfil, no', !puedeGestionarUsuarios(null))
  ok('admin pleno: admin y no CEO', esAdminPleno('admin', null) && !esAdminPleno('admin', 'ceo') && !esAdminPleno('partner', null))

  console.log('\n=== editar ===')
  const base = { actorId: 'raul', adminsPlenos: 2 }
  ok('quitarse el admin a uno mismo: no', errorAlEditar({ ...base, objetivo: dueno, rolFinal: 'employee', puestoFinal: null }) !== null)
  ok('pasarse a CEO a uno mismo: no', errorAlEditar({ ...base, objetivo: dueno, rolFinal: 'admin', puestoFinal: 'ceo' }) !== null)
  ok('cambiarle el correo al dueño: no', errorAlEditar({ ...base, objetivo: dueno, rolFinal: 'admin', puestoFinal: null, correoNuevo: 'otro@x.es' }) !== null)
  ok('mandar el mismo correo del dueño (en otra caja): sí', errorAlEditar({ ...base, objetivo: dueno, rolFinal: 'admin', puestoFinal: null, correoNuevo: CORREO_DEL_DUENO.toUpperCase() }) === null)
  ok('quitarle el admin al dueño desde otra cuenta: no', errorAlEditar({ ...base, actorId: 'ana', objetivo: dueno, rolFinal: 'partner', puestoFinal: null }) !== null)
  ok('quitarle el admin a otro admin si quedan más: sí', errorAlEditar({ ...base, objetivo: otroAdmin, rolFinal: 'employee', puestoFinal: null }) === null)
  ok('quitarle el admin al último: no', errorAlEditar({ ...base, adminsPlenos: 1, objetivo: otroAdmin, rolFinal: 'employee', puestoFinal: null }) !== null)
  ok('editar a un empleado: sí', errorAlEditar({ ...base, objetivo: empleado, rolFinal: 'employee', puestoFinal: 'comercial', correoNuevo: 'nuevo@x.es' }) === null)
  ok('ascender a un CEO a admin pleno: sí', errorAlEditar({ ...base, objetivo: ceo, rolFinal: 'admin', puestoFinal: null }) === null)

  console.log('\n=== borrar y desactivar ===')
  ok('borrarse a uno mismo: no', errorAlDarDeBaja('borrar', 'raul', dueno, 3) !== null)
  ok('desactivar al dueño desde otra cuenta: no', errorAlDarDeBaja('desactivar', 'ana', dueno, 3) !== null)
  ok('borrar al último admin: no', errorAlDarDeBaja('borrar', 'raul', otroAdmin, 1) !== null)
  ok('borrar a otro admin si quedan: sí', errorAlDarDeBaja('borrar', 'raul', otroAdmin, 2) === null)
  ok('desactivar a un empleado: sí', errorAlDarDeBaja('desactivar', 'raul', empleado, 1) === null)
  ok('un CEO no cuenta como admin pleno: se le puede desactivar con un solo admin', errorAlDarDeBaja('desactivar', 'raul', ceo, 1) === null)

  console.log('\n=== casillas al guardar ===')
  const gestionadas = new Set(['agenda', 'correo', 'horas'])
  const plan = planDeCasillas(['correo', 'briefing-falso'], gestionadas)
  ok('pone solo las marcadas que gestiona', plan.poner.join() === 'correo', plan.poner.join())
  ok('quita solo las gestionadas que no están marcadas', plan.quitar.join() === 'agenda,horas', plan.quitar.join())
  ok('un id que la pantalla no ofrece no se pone ni se quita', !plan.poner.includes('briefing-falso') && !plan.quitar.includes('briefing-falso'))
  ok(
    'de la petición: solo can_access === true, sin repetir y sin basura',
    casillasMarcadasDeLaPeticion([{ app_id: 'a', can_access: true }, { app_id: 'a', can_access: true }, { app_id: 'b', can_access: false }, { app_id: 3, can_access: true }, null, 'x']).join() === 'a'
  )
  ok('de la petición: algo que no es una lista, nada', casillasMarcadasDeLaPeticion('hola').length === 0)
  ok("'briefing' es casilla y se gestiona (antes se perdía al editar)", CASILLAS_GESTIONADAS.has('briefing') && CASILLA_POR_ID.get('briefing')?.grupo === 'especiales')
  ok('las que no hacen nada (Inicio, Usuarios, Growth, CRM) no se tocan', ['home', 'users', 'growth', 'crm'].every((id) => !CASILLAS_GESTIONADAS.has(id) && !!CASILLA_POR_ID.get(id)?.sinEfecto))
  ok('todas las apps y todos los permisos sueltos tienen casilla', [...apps.map((a) => a.id), ...PERMISOS_SUELTOS.map((p) => p.id)].every((id) => CASILLA_POR_ID.has(id)))
  ok('sin ids repetidos', new Set(CASILLAS.map((c) => c.id)).size === CASILLAS.length)
  ok('cada casilla cae en un grupo que existe', CASILLAS.every((c) => GRUPOS_DE_CASILLAS.some((g) => g.id === c.grupo)))
  ok('ningún grupo vacío', GRUPOS_DE_CASILLAS.every((g) => CASILLAS.some((c) => c.grupo === g.id)))
  ok('los grupos del menú están (Contabilidad y Gestión de cuentas)', CASILLA_POR_ID.get('tesoreria')?.grupo === 'contabilidad' && CASILLA_POR_ID.get('cuentas')?.grupo === 'gestion-de-cuentas')

  console.log('\n=== del puesto o a mano ===')
  ok('un comercial: agenda viene del puesto', origenDeCasilla('agenda', true, 'comercial') === 'puesto')
  ok('un comercial: tesorería, a mano', origenDeCasilla('tesoreria', true, 'comercial') === 'mano')
  ok('sin marcar: nada', origenDeCasilla('agenda', false, 'comercial') === null)
  ok('sin puesto: todo a mano', origenDeCasilla('agenda', true, null) === 'mano')
  ok('un CEO: el chat no viene del puesto, la tesorería sí', !casillasDelPuesto('ceo').has('chat') && casillasDelPuesto('ceo').has('tesoreria'))

  console.log('\n=== buscar ===')
  const corr = CASILLA_POR_ID.get('correo')!
  ok('por nombre sin acentos', casillaCoincide(CASILLA_POR_ID.get('tesoreria')!, 'tesoreria') && casillaCoincide(corr, 'CORREO'))
  ok('vacío coincide con todo', casillaCoincide(corr, '  '))
  ok('lo que no está, no', !casillaCoincide(corr, 'zzzz'))

  console.log('\n=== desactivado ===')
  const ahora = Date.parse('2026-11-14T12:00:00Z')
  ok('bloqueo en el futuro: desactivado', estaDesactivado('2126-01-01T00:00:00Z', ahora))
  ok('bloqueo pasado o vacío: activo', !estaDesactivado('2020-01-01T00:00:00Z', ahora) && !estaDesactivado(null, ahora) && !estaDesactivado('basura', ahora))

  console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones OK`)
  if (fallos > 0) process.exit(1)
}

main()
