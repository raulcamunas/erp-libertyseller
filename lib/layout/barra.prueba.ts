import { apps } from '@/lib/config/apps'
import { cuelgaDe, etiquetaDeInsignia, inicialesDe, limpiarRuta, rutaActivaDelMenu } from '@/lib/layout/barra'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

function main() {
  console.log('\n=== la ruta limpia ===')
  {
    ok('quita la consulta y el ancla', limpiarRuta('/dashboard/correo?x=1#a') === '/dashboard/correo')
    ok('quita las barras del final', limpiarRuta('/dashboard/correo///') === '/dashboard/correo')
    ok('la raíz se queda como /', limpiarRuta('/') === '/' && limpiarRuta('') === '/' && limpiarRuta('?a=1') === '/')
  }

  console.log('\n=== qué entrada del menú se enciende ===')
  {
    ok('una página de la aplicación la enciende', cuelgaDe('/dashboard/correo', '/dashboard/correo'))
    ok('y una que cuelga de ella también', cuelgaDe('/dashboard/correo/secuencias', '/dashboard/correo') && cuelgaDe('/dashboard/clients/abc/detalle', '/dashboard/clients'))
    ok('con frontera: «commissions» no es «commissions-shoes-f»', !cuelgaDe('/dashboard/commissions-shoes-f', '/dashboard/commissions'))
    ok('Inicio solo es Inicio', cuelgaDe('/dashboard', '/dashboard') && !cuelgaDe('/dashboard/correo', '/dashboard') && cuelgaDe('/dashboard/', '/dashboard'))
    ok('con consulta y ancla sigue siendo la misma', cuelgaDe('/dashboard/rendimiento?periodo=semana#tabla', '/dashboard/rendimiento'))

    const rutas = ['/dashboard', '/dashboard/commissions', '/dashboard/commissions-shoes-f', '/dashboard/correo', '/dashboard/correo/secuencias']
    ok('gana la más larga: dos entradas no se encienden a la vez', rutaActivaDelMenu(rutas, '/dashboard/commissions-shoes-f') === '/dashboard/commissions-shoes-f')
    ok('una página dentro de una aplicación enciende la aplicación', rutaActivaDelMenu(['/dashboard', '/dashboard/commissions'], '/dashboard/commissions/liquidacion') === '/dashboard/commissions')
    ok('si la página no está en el menú no se enciende nada', rutaActivaDelMenu(['/dashboard', '/dashboard/correo'], '/dashboard/users') === null)
    ok('sin entradas, nada', rutaActivaDelMenu([], '/dashboard') === null)
    ok('Inicio se enciende en /dashboard', rutaActivaDelMenu(rutas, '/dashboard') === '/dashboard')
  }

  console.log('\n=== con las aplicaciones de verdad ===')
  {
    const rutas = apps.map((a) => a.route)
    ok('todas las rutas son distintas', new Set(rutas).size === rutas.length)
    // Cada aplicación, visitada por su propia ruta, es la única que se enciende
    const mal = apps.filter((a) => rutaActivaDelMenu(rutas, a.route) !== a.route).map((a) => a.id)
    ok('cada aplicación se enciende a sí misma y a ninguna otra', mal.length === 0, mal.join(', '))
    const sub = apps.filter((a) => a.route !== '/dashboard').filter((a) => rutaActivaDelMenu(rutas, `${a.route}/una/subpagina`) !== a.route).map((a) => a.id)
    ok('y sus subpáginas también', sub.length === 0, sub.join(', '))
  }

  console.log('\n=== las letras del avatar ===')
  {
    ok('nombre y apellido', inicialesDe('Raúl Camuñas', 'r@x.es') === 'RC')
    ok('con nombre compuesto: la primera y el último apellido', inicialesDe('María Fernanda Rojas', null) === 'MR')
    ok('sin las partículas', inicialesDe('María de los Ángeles García', null) === 'MG')
    ok('una sola palabra, una sola letra', inicialesDe('Daniela', null) === 'D')
    ok('sin nombre, lo de antes de la @', inicialesDe(null, 'daniela.rojas@libertyseller.es') === 'DR')
    ok('sin nombre y con un correo de una palabra', inicialesDe('  ', 'raulcamunas369@gmail.com') === 'R')
    ok('minúsculas a mayúsculas', inicialesDe('ana pérez', null) === 'AP')
    ok('sin nada, un interrogante', inicialesDe(null, null) === '?' && inicialesDe('', '') === '?' && inicialesDe('---', '@x') === '?')
  }

  console.log('\n=== el número de la insignia ===')
  {
    ok('nada, cero o menos: sin insignia', etiquetaDeInsignia(undefined, false) === null && etiquetaDeInsignia(0, false) === null && etiquetaDeInsignia(-3, true) === null && etiquetaDeInsignia('', false) === null)
    ok('un número abierto', etiquetaDeInsignia(3, false) === '3' && etiquetaDeInsignia(99, false) === '99')
    ok('abierto: 99+ a partir de cien', etiquetaDeInsignia(100, false) === '99+')
    ok('plegado: 9+ a partir de diez', etiquetaDeInsignia(9, true) === '9' && etiquetaDeInsignia(10, true) === '9+' && etiquetaDeInsignia(250, true) === '9+')
    ok('un número escrito como texto vale igual', etiquetaDeInsignia('7', false) === '7' && etiquetaDeInsignia('12', true) === '9+')
    ok('un texto no numérico: tal cual abierto y un punto plegado', etiquetaDeInsignia('Nuevo', false) === 'Nuevo' && etiquetaDeInsignia('Nuevo', true) === '•')
    ok('un decimal se queda en el entero', etiquetaDeInsignia(3.9, false) === '3')
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main()
