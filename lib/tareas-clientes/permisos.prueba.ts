import { filtrarPorCliente, limpiarAcceso, personaPuedeVer, puedeVer } from '@/lib/tareas-clientes/permisos'

let fallos = 0
let comprobaciones = 0
const igual = (n: string, a: unknown, b: unknown) => {
  comprobaciones++
  const bien = JSON.stringify(a) === JSON.stringify(b)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(a)} y no ${JSON.stringify(b)}`}`)
}

const solo = new Set(['c1', 'c2'])
igual('sin límite se ve todo (null)', puedeVer(null, 'c9'), true)
igual('sin límite se ve todo (sin decir)', puedeVer(undefined, 'c9'), true)
igual('con límite, uno de la lista sí', puedeVer(solo, 'c1'), true)
igual('con límite, uno de fuera no', puedeVer(solo, 'c9'), false)
igual('algo general (sin cliente) siempre', puedeVer(solo, null), true)
igual('un conjunto vacío no deja ver ninguno', puedeVer(new Set(), 'c1'), false)

const tareas = [{ id: 'a', c: 'c1' }, { id: 'b', c: 'c9' }, { id: 'c', c: 'c2' }]
igual('se queda con lo de sus clientes', filtrarPorCliente(tareas, solo, (t) => t.c).map((t) => t.id), ['a', 'c'])
igual('sin límite, todo', filtrarPorCliente(tareas, null, (t) => t.c).map((t) => t.id), ['a', 'b', 'c'])

igual('una persona sin límite ve cualquiera', personaPuedeVer({ clientes: null }, 'c9'), true)
igual('una persona sin dato ve cualquiera', personaPuedeVer({}, 'c9'), true)
igual('una persona limitada, solo los suyos', [personaPuedeVer({ clientes: ['c1'] }, 'c1'), personaPuedeVer({ clientes: ['c1'] }, 'c2')], [true, false])

const existen = new Set(['c1', 'c2', 'c3'])
igual('guardar: quita repetidos y lo que no existe', limpiarAcceso(['c1', 'c1', 'zzz', 'c3'], existen), ['c1', 'c3'])
igual('guardar: lista vacía = todos', limpiarAcceso([], existen), null)
igual('guardar: solo cosas que no existen = todos (no se deja a nadie sin nada por error)', limpiarAcceso(['zzz'], existen), null)
igual('guardar: null = todos', limpiarAcceso(null, existen), null)
igual('guardar: basura = todos', limpiarAcceso('c1', existen), null)

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones`)
if (fallos > 0) process.exit(1)
