import {
  SELECCION_VACIA,
  alternar,
  alternarPagina,
  aPeticion,
  cuantosHay,
  elegirPagina,
  estaElegido,
  haySeleccion,
  ofrecerElegirElFiltro,
  paginaAMedias,
  paginaCompleta,
  quitarPagina,
  seleccionarElFiltro,
  type Seleccion,
} from '@/lib/cold-calling/seleccion'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * ELEGIR VARIOS A LA VEZ, EN UNA TABLA PAGINADA.
 *
 * Lo que se vigila: que marcar una página entera y luego otra se sume, que «todos los que cumplen el filtro» respete los que se desmarcaron a mano (también al marcar
 * y desmarcar páginas), que los contadores digan la verdad en los dos modos, y que lo que se manda al servidor sea exactamente lo elegido sin tocar la selección original.
 */

const pagina1 = ['a1', 'a2', 'a3']
const pagina2 = ['b1', 'b2', 'b3']

const ids = (s: Seleccion) => (s.modo === 'ids' ? [...s.ids].sort() : null)
const excluidos = (s: Seleccion) => (s.modo === 'filtro' ? [...s.excluidos].sort() : null)

function main() {
  console.log('\n=== uno a uno ===')
  {
    let s = SELECCION_VACIA
    ok('vacía: no hay nada elegido', cuantosHay(s, 100) === 0 && !haySeleccion(s, 100) && !estaElegido(s, 'a1'))
    s = alternar(s, 'a1')
    ok('marcar una', estaElegido(s, 'a1') && cuantosHay(s, 100) === 1 && haySeleccion(s, 100))
    s = alternar(s, 'a2')
    s = alternar(s, 'a1')
    ok('desmarcar una', !estaElegido(s, 'a1') && estaElegido(s, 'a2') && cuantosHay(s, 100) === 1)
    ok('la selección vacía de partida no se ha tocado (es inmutable)', SELECCION_VACIA.modo === 'ids' && SELECCION_VACIA.ids.size === 0)
  }

  console.log('\n=== una página entera ===')
  {
    let s = elegirPagina(SELECCION_VACIA, pagina1)
    ok('marcar la página 1: están las tres', paginaCompleta(s, pagina1) && cuantosHay(s, 6) === 3 && !paginaAMedias(s, pagina1))
    ok('la página 2 no está ni a medias', !paginaCompleta(s, pagina2) && !paginaAMedias(s, pagina2))
    s = elegirPagina(s, pagina2)
    ok('marcar también la 2: se suman, no se pisan', cuantosHay(s, 6) === 6 && JSON.stringify(ids(s)) === JSON.stringify(['a1', 'a2', 'a3', 'b1', 'b2', 'b3']))
    s = alternar(s, 'a2')
    ok('desmarcar una de la 1: la página 1 queda a medias y la 2 sigue entera', paginaAMedias(s, pagina1) && !paginaCompleta(s, pagina1) && paginaCompleta(s, pagina2))
    s = alternarPagina(s, pagina1)
    ok('la casilla de la cabecera, estando a medias, marca las que faltan', paginaCompleta(s, pagina1))
    s = alternarPagina(s, pagina1)
    ok('y estando entera, las quita todas', !pagina1.some((id) => estaElegido(s, id)) && paginaCompleta(s, pagina2))
    s = quitarPagina(s, pagina2)
    ok('quitar la 2 deja la selección vacía', cuantosHay(s, 6) === 0)
    ok('una página vacía nunca está «completa»', !paginaCompleta(SELECCION_VACIA, []) && !paginaAMedias(SELECCION_VACIA, []))
  }

  console.log('\n=== todos los que cumplen el filtro ===')
  {
    let s = seleccionarElFiltro()
    ok('todos: cuenta el total del filtro', cuantosHay(s, 3482) === 3482 && estaElegido(s, 'loquesea') && haySeleccion(s, 3482))
    ok('con un filtro que no da nada, no hay selección', !haySeleccion(s, 0) && cuantosHay(s, 0) === 0)
    s = alternar(s, 'a2')
    ok('desmarcar uno lo excluye y resta uno', !estaElegido(s, 'a2') && estaElegido(s, 'a1') && cuantosHay(s, 3482) === 3481 && JSON.stringify(excluidos(s)) === JSON.stringify(['a2']))
    s = alternar(s, 'a2')
    ok('volver a marcarlo lo quita de los excluidos', estaElegido(s, 'a2') && cuantosHay(s, 3482) === 3482)
    s = quitarPagina(s, pagina1)
    ok('quitar una página excluye sus tres', cuantosHay(s, 3482) === 3479 && !pagina1.some((id) => estaElegido(s, id)) && paginaCompleta(s, pagina2))
    s = elegirPagina(s, pagina1)
    ok('marcarla otra vez los readmite', cuantosHay(s, 3482) === 3482 && excluidos(s)?.length === 0)
    ok('si se excluyen más de los que hay, no sale un número negativo', cuantosHay({ modo: 'filtro', excluidos: new Set(['x', 'y', 'z']) }, 2) === 0)
    s = alternarPagina(seleccionarElFiltro(), pagina1)
    ok('la casilla de la cabecera con todo elegido, quita la página', !paginaCompleta(s, pagina1) && cuantosHay(s, 10) === 7)
  }

  console.log('\n=== cuándo ofrecer «elegir los N que cumplen el filtro» ===')
  {
    const s = elegirPagina(SELECCION_VACIA, pagina1)
    ok('con la página entera elegida y más resultados que filas: sí', ofrecerElegirElFiltro(s, pagina1, 250))
    ok('si todos los resultados caben en la página: no', !ofrecerElegirElFiltro(s, pagina1, 3))
    ok('si la página no está entera elegida: no', !ofrecerElegirElFiltro(alternar(s, 'a1'), pagina1, 250))
    ok('si ya se eligieron todos los del filtro: no', !ofrecerElegirElFiltro(seleccionarElFiltro(), pagina1, 250))
    ok('si ya se eligieron a mano tantos como resultados: no', !ofrecerElegirElFiltro(elegirPagina(elegirPagina(SELECCION_VACIA, pagina1), pagina2), pagina1, 6))
    ok('sin filas en la página: no', !ofrecerElegirElFiltro(SELECCION_VACIA, [], 250))
  }

  console.log('\n=== lo que se manda al servidor ===')
  {
    const a = elegirPagina(SELECCION_VACIA, pagina1)
    const p = aPeticion(a)
    ok('a mano: los id', 'ids' in p && JSON.stringify([...p.ids].sort()) === JSON.stringify(pagina1))
    const b = alternar(seleccionarElFiltro(), 'b2')
    const q = aPeticion(b)
    ok('todos menos algunos: «todos» y los excluidos', 'todos' in q && q.todos === true && JSON.stringify(q.excluidos) === JSON.stringify(['b2']))
    if ('ids' in p) p.ids.push('zzz')
    ok('la petición es una copia: tocarla no cambia la selección', a.modo === 'ids' && a.ids.size === 3)
  }
}

main()
console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
if (fallos > 0) process.exit(1)
