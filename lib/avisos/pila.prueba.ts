import { MAX_VISIBLES, cerrarAviso, leerAvisos, publicarAviso, suscribirAvisos, vaciarAvisos, type Aviso } from './pila'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const aviso = (id: string): Aviso => ({ id, tipo: 'correo', titulo: id, duracionMs: 1000 })

console.log('\n=== publicar, repetir y cerrar ===')
{
  vaciarAvisos()
  let cambios = 0
  const parar = suscribirAvisos(() => cambios++)
  publicarAviso(aviso('a'))
  publicarAviso(aviso('a'))
  ok('lo mismo dos veces es un solo aviso', leerAvisos().length === 1 && cambios === 1)
  const antes = leerAvisos()
  publicarAviso(aviso('a'))
  ok('y no avisa a nadie por un repetido: la referencia no cambia', leerAvisos() === antes && cambios === 1)
  cerrarAviso('zzz')
  ok('cerrar uno que no está no hace nada', cambios === 1)
  cerrarAviso('a')
  ok('cerrar lo quita', leerAvisos().length === 0 && cambios === 2)
  parar()
  publicarAviso(aviso('b'))
  ok('sin suscripción no se llama', cambios === 2)
}

console.log('\n=== el tope de la pila ===')
{
  vaciarAvisos()
  for (let i = 0; i < MAX_VISIBLES + 3; i++) publicarAviso(aviso(String(i)))
  const ids = leerAvisos().map((a) => a.id)
  ok('nunca pasa del tope', ids.length === MAX_VISIBLES, String(ids.length))
  ok('se retiran los más antiguos', ids[0] === '3' && ids[ids.length - 1] === String(MAX_VISIBLES + 2), ids.join())
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
