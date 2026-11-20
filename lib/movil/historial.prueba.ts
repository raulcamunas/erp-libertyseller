import { apilarRuta, hayAtras } from '@/lib/movil/historial'
import { buscarApps, normalizar } from '@/lib/movil/buscar'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const j = (x: unknown) => JSON.stringify(x)

console.log('\n=== la pila de «Atrás» ===')
{
  let p: string[] = []
  p = apilarRuta(p, '/dashboard')
  ok('entrar: una ruta, sin atrás', j(p) === j(['/dashboard']) && !hayAtras(p))
  p = apilarRuta(p, '/dashboard/correo')
  ok('navegar: se apila y hay atrás', p.length === 2 && hayAtras(p))
  p = apilarRuta(p, '/dashboard/correo')
  ok('la misma ruta no apila', p.length === 2)
  p = apilarRuta(p, '/dashboard')
  ok('volver a la de antes: se desapila', j(p) === j(['/dashboard']))
  let largo: string[] = []
  for (let i = 0; i < 50; i++) largo = apilarRuta(largo, `/r/${i}`)
  ok('con tope', largo.length === 30 && largo[29] === '/r/49')
  ok('ruta vacía: nada', apilarRuta(['/a'], '').length === 1)
}

console.log('\n=== el buscador ===')
{
  const apps = [
    { id: 'facturacion', name: 'Facturación', nombreCorto: 'Facturación', description: 'Facturas contra Zoho', grupo: 'Contabilidad' },
    { id: 'tesoreria', name: 'Tesorería', description: 'Bancos y cobros', grupo: 'Contabilidad' },
    { id: 'correo', name: 'Correo', description: 'Buzones del equipo' },
    { id: 'cold-calling', name: 'Cold Calling', description: 'Llamadas a leads' },
  ]
  ok('sin tildes ni mayúsculas', normalizar('  FACTURACIÓN  ') === 'facturacion')
  ok('vacío: todas, en orden', j(buscarApps(apps, '  ').map((a) => a.id)) === j(['facturacion', 'tesoreria', 'correo', 'cold-calling']))
  ok('por el nombre', j(buscarApps(apps, 'factu').map((a) => a.id)) === j(['facturacion']))
  ok('por el grupo', j(buscarApps(apps, 'contab').map((a) => a.id)) === j(['facturacion', 'tesoreria']))
  ok('por la descripción', j(buscarApps(apps, 'leads').map((a) => a.id)) === j(['cold-calling']))
  ok('el nombre va antes que la descripción', buscarApps(apps, 'co')[0].id === 'correo' || buscarApps(apps, 'co')[0].id === 'cold-calling')
  ok('todas las palabras tienen que salir', j(buscarApps(apps, 'cold zoho').map((a) => a.id)) === j([]))
  ok('palabra de en medio del nombre', j(buscarApps(apps, 'calling').map((a) => a.id)) === j(['cold-calling']))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
