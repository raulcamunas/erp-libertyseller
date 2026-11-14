import { categoriaDe, contarCambios, filtrarUsuarios, generarContrasena, resumir, type DatosDeFicha, type UsuarioDeLista } from '@/lib/usuarios/filtros'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LA LISTA DE GESTIÓN DE USUARIOS: categorías, filtros, resumen y cambios sin guardar.
 *   npx tsx lib/usuarios/filtros.prueba.ts
 */

const u = (id: string, role: string, puesto: string | null, extra: Partial<UsuarioDeLista> = {}): UsuarioDeLista => ({
  id,
  email: `${id}@liberty.es`,
  full_name: id,
  role,
  puesto,
  created_at: '2026-06-01T10:00:00Z',
  accesos: [],
  ...extra,
})

const gente = [
  u('raul', 'admin', null),
  u('carla', 'admin', 'ceo'),
  u('pepe', 'partner', null),
  u('ana', 'employee', 'comercial', { full_name: 'Ana Martínez' }),
  u('jhanna', 'employee', 'manager_comercial'),
  u('lola', 'employee', 'gestion_administrativa'),
  u('sin', 'employee', null),
  u('cobo', 'cliente', null),
  u('viejo', 'employee', 'comercial', { desactivado: true }),
]

function main() {
  console.log('\n=== categorías ===')
  ok('admin, CEO y partner: dirección', ['raul', 'carla', 'pepe'].every((id) => categoriaDe(gente.find((g) => g.id === id)!) === 'direccion'))
  ok('comercial y manager: comercial', categoriaDe(gente[3]) === 'comercial' && categoriaDe(gente[4]) === 'comercial')
  ok('gestión administrativa: administración', categoriaDe(gente[5]) === 'administracion')
  ok('empleado sin puesto y cliente', categoriaDe(gente[6]) === 'empleado' && categoriaDe(gente[7]) === 'cliente')

  console.log('\n=== filtros ===')
  ok('«todos» no enseña a los desactivados', filtrarUsuarios(gente, 'todos', '').length === 8)
  ok('«desactivados» solo a ellos', filtrarUsuarios(gente, 'desactivados', '').map((g) => g.id).join() === 'viejo')
  ok('comercial', filtrarUsuarios(gente, 'comercial', '').map((g) => g.id).join() === 'ana,jhanna')
  ok('buscar sin acentos ni mayúsculas', filtrarUsuarios(gente, 'todos', 'MARTINEZ').map((g) => g.id).join() === 'ana')
  ok('buscar por correo', filtrarUsuarios(gente, 'todos', 'cobo@').map((g) => g.id).join() === 'cobo')

  console.log('\n=== resumen ===')
  const r = resumir([...gente, u('nueva', 'employee', null, { created_at: '2026-11-10T09:00:00Z' })], Date.parse('2026-11-14T12:00:00Z'), 8)
  ok('activos y desactivados', r.activos === 9 && r.desactivados === 1, `${r.activos}/${r.desactivados}`)
  ok('por categoría', r.porCategoria.direccion === 3 && r.porCategoria.comercial === 2 && r.porCategoria.empleado === 2, JSON.stringify(r.porCategoria))
  ok('un CEO', r.ceos === 1)
  ok('altas de los últimos 30 días', r.altasRecientes === 1)
  ok('la serie acumulada sube y acaba en el total', r.altasAcumuladas.length === 8 && r.altasAcumuladas[7] === 10 && r.altasAcumuladas[0] === 0, r.altasAcumuladas.join())

  console.log('\n=== cambios sin guardar ===')
  const base: DatosDeFicha = { email: 'a@x.es', full_name: 'Ana', password: '', role: 'employee', puesto: 'comercial', is_comercial: true, accesos: ['agenda', 'correo'] }
  ok('igual: cero', contarCambios(base, { ...base }) === 0)
  ok('espacios de más no cuentan', contarCambios(base, { ...base, full_name: ' Ana ' }) === 0)
  ok('nombre + contraseña + una casilla quitada y otra puesta: cuatro', contarCambios(base, { ...base, full_name: 'Ana M', password: 'secreta', accesos: ['agenda', 'horas'] }) === 4)
  ok('cambiar de puesto cuenta uno', contarCambios(base, { ...base, puesto: 'manager_comercial' }) === 1)

  console.log('\n=== contraseña ===')
  const c = generarContrasena()
  ok('14 caracteres, sin l, 1, O ni 0', c.length === 14 && !/[l1O0]/.test(c), c)
  ok('con una semilla fija sale siempre la misma', generarContrasena(() => 0.5) === generarContrasena(() => 0.5))

  console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones OK`)
  if (fallos > 0) process.exit(1)
}

main()
