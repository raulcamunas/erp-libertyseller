import { avisoDeNoSePuede, leadDeLaDireccion, queHacerConElLead, rutaDeLaFicha, type SituacionAlAbrir } from './abrir-lead'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const ID = '3f2a9c1e-7b4d-4e8a-9f10-5a6b7c8d9e01'
const ANA = '11111111-1111-4111-8111-111111111111'
const BEA = '22222222-2222-4222-8222-222222222222'
const EQUIPO = [ANA, BEA]
const base = (extra: Partial<SituacionAlAbrir> = {}): SituacionAlAbrir => ({ enCartera: false, cargando: false, propietario: 'all', puedeVerTodos: false, equipo: EQUIPO, cambioHecho: false, ...extra })
const que = (extra: Partial<SituacionAlAbrir>) => JSON.stringify(queHacerConElLead(base(extra)))

console.log('\n=== la dirección que se escribe y la que se lee ===')
{
  ok('la ruta lleva el id', rutaDeLaFicha(ID) === `/dashboard/cold-calling?lead=${ID}`)
  ok('lo que se escribe se lee tal cual (ida y vuelta)', leadDeLaDireccion(rutaDeLaFicha(ID).slice(rutaDeLaFicha(ID).indexOf('?'))) === ID)
  ok('con o sin el signo de interrogación', leadDeLaDireccion(`lead=${ID}`) === ID && leadDeLaDireccion(`?lead=${ID}`) === ID)
  ok('entre otros parámetros', leadDeLaDireccion(`?x=1&lead=${ID}&y=2`) === ID)
  ok('en mayúsculas se normaliza', leadDeLaDireccion(`?lead=${ID.toUpperCase()}`) === ID)
  ok('con espacios alrededor, también', leadDeLaDireccion(`?lead=%20${ID}%20`) === ID)
  ok('sin parámetro: nada', leadDeLaDireccion('') === null && leadDeLaDireccion('?x=1') === null)
  ok('un texto que no es un id: nada (un enlace a medio escribir no abre ni rompe nada)', leadDeLaDireccion('?lead=abc') === null && leadDeLaDireccion('?lead=') === null && leadDeLaDireccion(`?lead=${ID}x`) === null)
  ok('ni una inyección', leadDeLaDireccion(`?lead=${ID}'%20or%201=1`) === null && leadDeLaDireccion('?lead=<script>') === null)
}

console.log('\n=== qué hacer: el caso de siempre ===')
{
  ok('ya está en la cartera: se abre', que({ enCartera: true }) === '{"accion":"abrir"}')
  ok('y se abre aunque la cartera siga llegando (ya está)', que({ enCartera: true, cargando: true }) === '{"accion":"abrir"}')
  ok('la cartera sigue llegando: se espera', que({ cargando: true }) === '{"accion":"esperar"}')
  ok('no está y no se sabe nada de él: se pregunta a la base', que({}) === '{"accion":"preguntar"}')
}

console.log('\n=== quien no supervisa ===')
{
  ok('la base dice que no existe (o no lo deja ver): se avisa', que({ enLaBase: { existe: false, dueno: null } }) === '{"accion":"no-se-puede","motivo":"no-existe-o-ajeno"}')
  ok('existe pero no está en su cartera: se avisa, no puede ir a la de otro', que({ enLaBase: { existe: true, dueno: BEA } }) === '{"accion":"no-se-puede","motivo":"fuera-de-la-cartera"}')
}

console.log('\n=== quien supervisa ===')
{
  const sup = { puedeVerTodos: true }
  ok('mirando la cartera de Ana y el lead es de Bea: va a la de Bea', que({ ...sup, propietario: ANA, enLaBase: { existe: true, dueno: BEA } }) === `{"accion":"cambiar-cartera","a":"${BEA}"}`)
  ok('mirando la de Ana y el lead no tiene dueño (el banco): va a la de todos', que({ ...sup, propietario: ANA, enLaBase: { existe: true, dueno: null } }) === '{"accion":"cambiar-cartera","a":"all"}')
  ok('mirando la de Ana y su dueño no es del equipo (un administrador): va a la de todos y no a una que no existe en el selector', que({ ...sup, propietario: ANA, enLaBase: { existe: true, dueno: '99999999-9999-4999-8999-999999999999' } }) === '{"accion":"cambiar-cartera","a":"all"}')
  ok('mirando la de TODOS y no aparece (llegó incompleta): va a la de su dueño, que es más pequeña y sí llega entera', que({ ...sup, propietario: 'all', enLaBase: { existe: true, dueno: BEA } }) === '{"accion":"cambiar-cartera","a":"' + BEA + '"}')
  ok('mirando la de todos y el lead no tiene dueño y no aparece: avisa (no se puede ir a «todos» desde «todos»)', que({ ...sup, propietario: 'all', enLaBase: { existe: true, dueno: null } }) === '{"accion":"no-se-puede","motivo":"fuera-de-la-cartera"}')
  ok('si ya se cambió una vez y sigue sin aparecer, avisa en vez de ir y venir', que({ ...sup, propietario: BEA, cambioHecho: true, enLaBase: { existe: true, dueno: BEA } }) === '{"accion":"no-se-puede","motivo":"fuera-de-la-cartera"}')
  ok('ya mirando la de su dueño y no aparece (llegó incompleta): avisa', que({ ...sup, propietario: BEA, enLaBase: { existe: true, dueno: BEA } }) === '{"accion":"no-se-puede","motivo":"fuera-de-la-cartera"}')
  ok('tras cambiar de cartera, mientras llega se espera', que({ ...sup, propietario: BEA, cambioHecho: true, cargando: true, enLaBase: { existe: true, dueno: BEA } }) === '{"accion":"esperar"}')
  ok('y cuando llega y el lead está, se abre', que({ ...sup, propietario: BEA, cambioHecho: true, enCartera: true, enLaBase: { existe: true, dueno: BEA } }) === '{"accion":"abrir"}')
  ok('quien supervisa también recibe el aviso si no existe', que({ ...sup, enLaBase: { existe: false, dueno: null } }) === '{"accion":"no-se-puede","motivo":"no-existe-o-ajeno"}')
}

console.log('\n=== los avisos ===')
{
  ok('cada motivo tiene su frase y ninguna está vacía', (['no-existe-o-ajeno', 'fuera-de-la-cartera', 'sin-comprobar'] as const).every((m) => avisoDeNoSePuede(m).length > 20))
  ok('y son distintas entre sí', new Set((['no-existe-o-ajeno', 'fuera-de-la-cartera', 'sin-comprobar'] as const).map(avisoDeNoSePuede)).size === 3)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
