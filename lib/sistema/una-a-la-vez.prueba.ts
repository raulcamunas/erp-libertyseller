import { crearGuardianDePasadas } from '@/lib/sistema/una-a-la-vez'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== una pasada a la vez ===')
{
  let reloj = 1_000_000
  const g = crearGuardianDePasadas(330_000, () => reloj)
  const a = g.entrar()
  ok('la primera pasada entra', a !== null)
  ok('mientras sigue, otra no entra', g.entrar() === null)
  reloj += 100_000
  ok('ni 100 s después (una pasada larga todavía puede estar trabajando)', g.entrar() === null)
  a!()
  const b = g.entrar()
  ok('al soltar, la siguiente entra', b !== null)
  b!()
  ok('y soltar dos veces no estropea nada', (() => { b!(); return g.entrar() !== null })())
}

console.log('\n=== una pasada colgada no para la tarea para siempre ===')
{
  let reloj = 1_000_000
  const g = crearGuardianDePasadas(330_000, () => reloj)
  const colgada = g.entrar()
  reloj += 329_000
  ok('a los 329 s todavía se respeta', g.entrar() === null)
  reloj += 2_000
  const nueva = g.entrar()
  ok('pasados los 330 s se da por muerta y entra otra', nueva !== null)
  ok('y mientras esa trabaja, no entra una tercera', g.entrar() === null)
  colgada!()
  ok('si la muerta termina por fin, NO suelta el paso de la que la sustituyó', g.entrar() === null)
  nueva!()
  ok('cuando termina la buena, vuelve a haber paso', g.entrar() !== null)
}

console.log('\n=== dos guardianes no se estorban ===')
{
  const a = crearGuardianDePasadas(1000)
  const b = crearGuardianDePasadas(1000)
  const pasoA = a.entrar()
  ok('cada ruta tiene el suyo: que una trabaje no frena a la otra', pasoA !== null && b.entrar() !== null)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
