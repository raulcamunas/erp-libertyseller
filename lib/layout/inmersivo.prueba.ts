import { esRutaInmersiva } from '@/lib/layout/inmersivo'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean) => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}`)
}

ok('el inicio del módulo', esRutaInmersiva('/dashboard/tareas-clientes'))
ok('el espacio de un cliente', esRutaInmersiva('/dashboard/tareas-clientes/8a1f0c3e-0000-4000-8000-000000000001'))
ok('todas las tareas', esRutaInmersiva('/dashboard/tareas-clientes/todas'))
ok('otra aplicación no', !esRutaInmersiva('/dashboard/agenda'))
ok('el inicio del ERP no', !esRutaInmersiva('/dashboard'))
ok('un nombre parecido no', !esRutaInmersiva('/dashboard/tareas-clientes-viejo'))
ok('sin ruta no', !esRutaInmersiva(null) && !esRutaInmersiva(undefined) && !esRutaInmersiva(''))

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones`)
if (fallos > 0) process.exit(1)
