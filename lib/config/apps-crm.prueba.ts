import { apps, APP_CRM, APPS_SIN_EFECTO, PERMISO_EQUIPO_COMERCIAL, puedeVerCrm } from './apps'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const permisos = (...ids: string[]) => new Set(ids)

console.log('\n=== quién ve el CRM de clientes en el menú ===')
{
  ok('un administrador, siempre', puedeVerCrm('admin', permisos()))
  ok('un empleado con «Supervisión del equipo comercial» (el manager de captación)', puedeVerCrm('employee', permisos(PERMISO_EQUIPO_COMERCIAL)))
  ok('un empleado sin ese permiso, no', !puedeVerCrm('employee', permisos('agenda', 'cold-calling')))
  ok('ni con la casilla «crm» a secas: no abre nada por sí sola (la RLS le cerraría las tablas)', !puedeVerCrm('employee', permisos('crm')))
  ok('un socio (partner) no entra por aquí: el middleware le cierra todo salvo sus tres apps', !puedeVerCrm('partner', permisos(PERMISO_EQUIPO_COMERCIAL)))
  ok('un cliente de fuera, nunca', !puedeVerCrm('cliente', permisos(PERMISO_EQUIPO_COMERCIAL)))
  ok('mientras no se ha cargado el rol, no parpadea', !puedeVerCrm(null, permisos(PERMISO_EQUIPO_COMERCIAL)) && !puedeVerCrm(undefined, permisos()))
}

console.log('\n=== la entrada del menú ===')
{
  const app = apps.find((a) => a.id === APP_CRM)
  ok('existe, con el id «crm»', !!app && app.id === 'crm')
  ok('apunta a /dashboard/crm (ya no cuelga de la agenda)', app?.route === '/dashboard/crm')
  ok('se llama «CRM de clientes»', app?.name === 'CRM de clientes')
  ok('va junto a la agenda en el menú (justo después)', apps.findIndex((a) => a.id === 'crm') === apps.findIndex((a) => a.id === 'agenda') + 1)
  ok('ninguna otra aplicación usa esa ruta ni ese id', apps.filter((a) => a.route === '/dashboard/crm' || a.id === 'crm').length === 1)
  ok('su casilla en Gestión de Usuarios se desactiva con el motivo escrito (no promete un acceso que no da)', typeof APPS_SIN_EFECTO.get(APP_CRM) === 'string' && (APPS_SIN_EFECTO.get(APP_CRM) ?? '').length > 20)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
