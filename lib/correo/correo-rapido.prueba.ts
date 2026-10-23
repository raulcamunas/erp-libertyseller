import { escucharCorreoRapido, hayCorreoRapido, pedirCorreoRapido, type PeticionDeCorreoRapido } from '@/lib/correo/correo-rapido'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const peticion = (para: string, ia = false): PeticionDeCorreoRapido => ({ para, ia, lead: { id: 'l1', nombre: 'Acme', empresa: 'Acme SL', contacto: null } })

console.log('\n=== el encargo de la ventana rápida ===')
{
  ok('sin nadie escuchando no hay ventana y el encargo no se pierde en silencio: devuelve false', !hayCorreoRapido() && pedirCorreoRapido(peticion('a@x.es')) === false)

  const recibidos: PeticionDeCorreoRapido[] = []
  const dejar = escucharCorreoRapido((p) => recibidos.push(p))
  ok('con la ventana montada hay oyente', hayCorreoRapido())
  ok('el encargo llega y devuelve true', pedirCorreoRapido(peticion('b@x.es', true)) === true && recibidos.length === 1 && recibidos[0].para === 'b@x.es' && recibidos[0].ia === true)
  ok('lleva el lead entero', recibidos[0].lead.id === 'l1' && recibidos[0].lead.empresa === 'Acme SL')
  pedirCorreoRapido(peticion('c@x.es'))
  ok('cada encargo llega una vez', recibidos.length === 2)

  dejar()
  ok('al desmontarse la ventana deja de haber oyente', !hayCorreoRapido())
  ok('y los encargos devuelven false otra vez', pedirCorreoRapido(peticion('d@x.es')) === false && recibidos.length === 2)

  const a: string[] = []
  const b: string[] = []
  const dejarA = escucharCorreoRapido((p) => a.push(p.para))
  const dejarB = escucharCorreoRapido((p) => b.push(p.para))
  pedirCorreoRapido(peticion('e@x.es'))
  ok('si hubiera dos ventanas (no debería), las dos lo reciben', a.length === 1 && b.length === 1)
  dejarA()
  dejarB()
  ok('al soltar las dos no queda nada', !hayCorreoRapido())
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
