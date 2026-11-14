import { APPS_SIN_MARCAR_AL_HACER_CEO, abreLaApp, esCeo } from '@/lib/usuarios/ceo'
import { apps } from '@/lib/config/apps'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL CEO. Lo que duele si falla: que un CEO entre a todo por ser administrador (lo que se quiere evitar), que un administrador normal pierda apps, o que los ids del Chat y de Tareas no coincidan con
 * los de `apps` y la casilla no sirva (se marca y no pasa nada).
 */
function main() {
  console.log('\n=== quién es CEO ===')
  ok('hace falta el rol admin Y el puesto', esCeo('admin', 'ceo') && !esCeo('admin', null) && !esCeo('admin', 'comercial') && !esCeo('employee', 'ceo') && !esCeo('partner', 'ceo') && !esCeo(null, 'ceo') && !esCeo(undefined, undefined))

  console.log('\n=== qué abre ===')
  const nada = new Set<string>()
  const algunas = new Set(['tesoreria', 'correo'])
  ok('un administrador normal abre todo, sin casillas', abreLaApp('admin', null, nada, 'chat') && abreLaApp('admin', 'manager_comercial', nada, 'tesoreria'))
  ok('un CEO sin casillas no abre ninguna aplicación (salvo el Inicio)', !abreLaApp('admin', 'ceo', nada, 'tesoreria') && !abreLaApp('admin', 'ceo', nada, 'chat') && abreLaApp('admin', 'ceo', nada, 'home'))
  ok('un CEO abre exactamente las que tiene marcadas', abreLaApp('admin', 'ceo', algunas, 'tesoreria') && abreLaApp('admin', 'ceo', algunas, 'correo') && !abreLaApp('admin', 'ceo', algunas, 'chat') && !abreLaApp('admin', 'ceo', algunas, 'facturacion'))
  ok('y si se le marca el Chat, lo abre (como cualquier otro rol)', abreLaApp('admin', 'ceo', new Set(['chat']), 'chat'))
  ok('quien no es administrador no abre nada por aquí (eso es de los permisos de siempre)', !abreLaApp('employee', null, algunas, 'tesoreria') && !abreLaApp('employee', 'ceo', algunas, 'tesoreria'))

  console.log('\n=== lo que no se marca de partida ===')
  const ids = new Set(apps.map((a) => a.id))
  ok('son el Chat y Tareas de clientes, y existen en `apps` con ese id', [...APPS_SIN_MARCAR_AL_HACER_CEO].sort().join() === 'chat,tareas-clientes' && [...APPS_SIN_MARCAR_AL_HACER_CEO].every((i) => ids.has(i)))

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
  if (fallos > 0) process.exit(1)
}

main()
