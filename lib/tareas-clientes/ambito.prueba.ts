import { ambitoDeRuta, mismoAmbito, rutaDeAmbito } from '@/lib/tareas-clientes/ambito'

let fallos = 0
let comprobaciones = 0
const igual = (n: string, a: unknown, b: unknown) => {
  comprobaciones++
  const bien = JSON.stringify(a) === JSON.stringify(b)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(a)} y no ${JSON.stringify(b)}`}`)
}

const ID = '8a1f0c3e-0000-4000-8000-000000000001'
igual('mi día', [ambitoDeRuta('/dashboard/tareas-clientes/mi-dia'), rutaDeAmbito({ tipo: 'dia' })], [{ tipo: 'dia' }, '/dashboard/tareas-clientes/mi-dia'])
igual('un cliente', ambitoDeRuta(`/dashboard/tareas-clientes/${ID}`), { tipo: 'cliente', id: ID })
igual('un cliente con ?tarea=', ambitoDeRuta(`/dashboard/tareas-clientes/${ID}?tarea=x`), { tipo: 'cliente', id: ID })
igual('un cliente con barra final', ambitoDeRuta(`/dashboard/tareas-clientes/${ID}/`), { tipo: 'cliente', id: ID })
igual('en mayúsculas se normaliza', ambitoDeRuta(`/dashboard/tareas-clientes/${ID.toUpperCase()}`), { tipo: 'cliente', id: ID })
igual('todas', ambitoDeRuta('/dashboard/tareas-clientes/todas'), { tipo: 'todas' })
igual('mis tareas', ambitoDeRuta('/dashboard/tareas-clientes/mis-tareas'), { tipo: 'mias' })
igual('el inicio no es un espacio', ambitoDeRuta('/dashboard/tareas-clientes'), null)
igual('algo que no es un id', ambitoDeRuta('/dashboard/tareas-clientes/loquesea'), null)
igual('otra aplicación', ambitoDeRuta('/dashboard/agenda'), null)
igual('una ruta más profunda', ambitoDeRuta(`/dashboard/tareas-clientes/${ID}/mas`), null)
igual('sin ruta', ambitoDeRuta(null), null)
igual('de ámbito a ruta y vuelta', ambitoDeRuta(rutaDeAmbito({ tipo: 'cliente', id: ID })), { tipo: 'cliente', id: ID })
igual('mismo ámbito', mismoAmbito({ tipo: 'cliente', id: ID }, { tipo: 'cliente', id: ID }), true)
igual('otro cliente', mismoAmbito({ tipo: 'cliente', id: ID }, { tipo: 'cliente', id: 'otro' }), false)
igual('cliente y todas', mismoAmbito({ tipo: 'cliente', id: ID }, { tipo: 'todas' }), false)
igual('todas y todas', mismoAmbito({ tipo: 'todas' }, { tipo: 'todas' }), true)

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones`)
if (fallos > 0) process.exit(1)
