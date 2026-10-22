import { SIN_FILTROS } from '@/lib/cold-calling/cartera'
import { leerPreferencias } from '@/components/cold-calling/usePreferencias'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LAS PREFERENCIAS GUARDADAS DE COLD CALLING.
 *
 * Lo que se vigila: que quien ya tenía sus preferencias guardadas con el formato de siempre (`view`, `statusFilter`, `listFilter`…) no
 * las pierda con el rediseño, que unas preferencias estropeadas o con valores que ya no existen se ignoren en vez de romper la pantalla, y
 * que quien no supervisa no pueda dejarse puesta la cartera de otro.
 */

const guardado = (o: Record<string, unknown>) => JSON.stringify(o)

console.log('\n=== el formato de siempre se sigue leyendo ===')
{
  const p = leerPreferencias(guardado({ view: 'tabla', statusFilter: 'no_contesta', listFilter: 'José V2', nivelFilter: 2, minRev: '50000', maxRev: '100000', sort: 'name', ownerFilter: 'u-daniela' }), true)
  ok('la vista', p.vista === 'tabla')
  ok('todos los filtros', p.filtros?.estado === 'no_contesta' && p.filtros?.lista === 'José V2' && p.filtros?.nivel === 2 && p.filtros?.minRev === '50000' && p.filtros?.maxRev === '100000' && p.filtros?.orden === 'name')
  ok('la búsqueda NO se recuerda: un texto de ayer parece un filtro roto', p.filtros?.busqueda === '')
  ok('y quien supervisa recupera la cartera que miraba', p.propietario === 'u-daniela')
}

console.log('\n=== quien no supervisa no se deja la cartera de otro ===')
{
  const p = leerPreferencias(guardado({ view: 'ficha', ownerFilter: 'u-daniela' }), false)
  ok('el comercial no recupera el ownerFilter', p.propietario === undefined && p.vista === 'ficha')
}

console.log('\n=== lo estropeado se ignora ===')
{
  ok('sin nada guardado, nada', Object.keys(leerPreferencias(null, true)).length === 0 && Object.keys(leerPreferencias('', true)).length === 0)
  ok('un JSON que no se puede leer, nada', Object.keys(leerPreferencias('{esto no es json', true)).length === 0)
  ok('un JSON que no es un objeto, nada', Object.keys(leerPreferencias('"hola"', true)).length === 0 && Object.keys(leerPreferencias('42', true)).length === 0)
  ok('una vista que ya no existe se ignora', leerPreferencias(guardado({ view: 'kanban' }), true).vista === undefined)
  ok('un orden que ya no existe se ignora', leerPreferencias(guardado({ sort: 'por_color' }), true).filtros === undefined)
  ok('un nivel que no es 1, 2 ni 3 se ignora', leerPreferencias(guardado({ nivelFilter: 7 }), true).filtros === undefined)
  ok('un filtro con un tipo que no es el suyo se ignora', leerPreferencias(guardado({ listFilter: 5, minRev: 100 }), true).filtros === undefined)
  const parcial = leerPreferencias(guardado({ view: 'rellamadas', sort: 'por_color', statusFilter: 'seguimiento' }), true)
  ok('lo bueno se aprovecha aunque haya algo malo al lado', parcial.vista === 'rellamadas' && parcial.filtros?.estado === 'seguimiento' && parcial.filtros?.orden === SIN_FILTROS.orden)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
