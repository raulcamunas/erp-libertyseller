import { MAX_COLA, MUSICA_VACIA, aplicarAccionDeMusica, esIdDeVideo, leerEnlaceDeYouTube, normalizarEstadoDeMusica, posicionActual, textoDeDuracion, type EstadoDeMusica, type PistaDeMusica } from '@/lib/chat/musica'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LA MÚSICA DE YOUTUBE EN LA SALA. Lo que duele si falla: que un enlace válido no se entienda (o uno raro cuele algo), que la cola se desajuste al quitar o saltar, que dos navegadores avisando del final de la
 * misma canción salten DOS pistas, o que la posición se calcule mal y cada uno oiga la canción en un punto distinto.
 */
const V = (n: number) => `video${String(n).padStart(6, '0')}` // 11 caracteres
const p = (n: number): PistaDeMusica => ({ id: `p${n}`, videoId: V(n), titulo: `Canción ${n}`, autor: 'Autor', anadidaPor: 'ana' })
const base = (cola: number[], indice: number, reproduciendo: boolean, posMs = 0, t = 1000): EstadoDeMusica => ({ cola: cola.map(p), indice, reproduciendo, posMs, t, v: 5 })
const pos = (e: EstadoDeMusica) => e.cola.map((x) => x.id).join()
const A = aplicarAccionDeMusica

function main() {
  console.log('\n=== los enlaces ===')
  {
    const e = (t: string) => leerEnlaceDeYouTube(t)
    ok('watch?v=', e('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.videoId === 'dQw4w9WgXcQ')
    ok('youtu.be (con parámetros de tiempo)', e('https://youtu.be/dQw4w9WgXcQ?t=43')?.videoId === 'dQw4w9WgXcQ')
    ok('shorts, embed, live y YouTube Music', ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=abc', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ'].every((u) => e(u)?.videoId === 'dQw4w9WgXcQ'))
    ok('sin https también vale', e('youtube.com/watch?v=dQw4w9WgXcQ')?.videoId === 'dQw4w9WgXcQ' && e('youtu.be/dQw4w9WgXcQ')?.videoId === 'dQw4w9WgXcQ')
    const lista = e('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf')
    ok('una página de lista: lista y sin vídeo', lista?.listaId === 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf' && lista.videoId === null && lista.esPaginaDeLista)
    const dentro = e('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&index=3')
    ok('un vídeo dentro de una lista: los dos, y no es la página de la lista', dentro?.videoId === 'dQw4w9WgXcQ' && dentro.listaId === 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf' && !dentro.esPaginaDeLista)
    ok('un «mix» (RD…) no se expande: queda el vídeo suelto', e('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ')?.listaId === null)
    ok('lo que no es de YouTube o no es un vídeo, no vale', [e('https://vimeo.com/123456'), e('hola'), e(''), e('https://www.youtube.com/'), e('https://www.youtube.com/watch?v=corto'), e('https://evil.com/watch?v=dQw4w9WgXcQ'), e('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ'), e('javascript:alert(1)')].every((x) => x === null))
    ok('un texto larguísimo se rechaza', e(`https://youtu.be/${'a'.repeat(600)}`) === null)
    ok('esIdDeVideo: 11 caracteres válidos', esIdDeVideo('dQw4w9WgXcQ') && !esIdDeVideo('dQw4w9WgXc') && !esIdDeVideo('dQw4w9WgXc!') && !esIdDeVideo(7))
  }

  console.log('\n=== el estado que llega ===')
  {
    ok('basura: null, lista, texto → vacío', [null, [], 'x', 3, undefined].every((x) => normalizarEstadoDeMusica(x).cola.length === 0 && normalizarEstadoDeMusica(x).indice === -1))
    const n = normalizarEstadoDeMusica({ cola: [p(1), { id: 'x', videoId: 'malo' }, null, p(2)], indice: 9, reproduciendo: true, posMs: -50, t: 5, v: 2 })
    ok('quita lo roto, recorta el índice, no deja posición negativa', n.cola.length === 2 && n.indice === 1 && n.posMs === 0 && n.reproduciendo)
    ok('sin cola no hay nada sonando', normalizarEstadoDeMusica({ cola: [], indice: 3, reproduciendo: true }).reproduciendo === false)
    ok('la cola se corta en el máximo', normalizarEstadoDeMusica({ cola: Array.from({ length: 300 }, (_, i) => p(i)) }).cola.length === MAX_COLA)
    ok('los títulos largos se recortan', normalizarEstadoDeMusica({ cola: [{ ...p(1), titulo: 'x'.repeat(500) }] }).cola[0].titulo.length === 120)
  }

  console.log('\n=== la posición ===')
  {
    ok('sonando: la guardada más lo que ha pasado', posicionActual(base([1], 0, true, 10_000, 1000), 4000) === 13_000)
    ok('en pausa: la guardada, pase lo que pase', posicionActual(base([1], 0, false, 10_000, 1000), 99_000) === 10_000)
    ok('sin pista: cero; y un reloj atrasado no da negativos', posicionActual(MUSICA_VACIA, 5000) === 0 && posicionActual(base([1], 0, true, 1000, 9000), 1000) === 1000)
  }

  console.log('\n=== añadir ===')
  {
    const e1 = A(MUSICA_VACIA, { tipo: 'anadir', pistas: [p(1), p(2)] }, 2000)
    ok('con la cola vacía, empieza a sonar la primera', e1.indice === 0 && e1.reproduciendo && e1.posMs === 0 && e1.cola.length === 2 && e1.v === 1)
    const e2 = A(base([1, 2], 0, true, 5000), { tipo: 'anadir', pistas: [p(3)] }, 2000)
    ok('con música sonando, se añade al final sin tocar lo que suena', e2.indice === 0 && e2.cola.length === 3 && e2.reproduciendo)
    const e3 = A(base([1], 0, false, 0), { tipo: 'anadir', pistas: [p(2)] }, 2000)
    ok('si la cola había acabado (parada al principio de la última), lo nuevo empieza a sonar', e3.indice === 1 && e3.reproduciendo)
    const e4 = A(base([1, 2], 0, false, 30_000), { tipo: 'anadir', pistas: [p(3)] }, 2000)
    ok('en pausa a mitad de una canción, no se pisa: queda en cola', e4.indice === 0 && !e4.reproduciendo && e4.posMs === 30_000)
    ok('no se pasa del máximo de la cola', A(base(Array.from({ length: MAX_COLA - 1 }, (_, i) => i + 1), 0, true), { tipo: 'anadir', pistas: [p(200), p(201), p(202)] }, 2000).cola.length === MAX_COLA)
    ok('lo que no es un vídeo válido no entra', A(base([1], 0, true), { tipo: 'anadir', pistas: [{ ...p(2), videoId: 'x' }] }, 2000).cola.length === 1)
  }

  console.log('\n=== siguiente y anterior ===')
  {
    const e = base([1, 2, 3], 0, true, 100_000)
    ok('siguiente va a la siguiente, desde el principio', A(e, { tipo: 'siguiente' }, 2000).indice === 1 && A(e, { tipo: 'siguiente' }, 2000).posMs === 0)
    ok('siguiente tras el final de la última: parada, al principio, en la última', (() => { const x = A(base([1, 2], 1, true, 5), { tipo: 'siguiente' }, 2000); return x.indice === 1 && !x.reproduciendo && x.posMs === 0 })())
    const fin1 = A(e, { tipo: 'siguiente', desde: 'p1' }, 2000)
    ok('dos navegadores avisan del final de la misma canción: solo salta una vez', A(fin1, { tipo: 'siguiente', desde: 'p1' }, 2001).indice === 1 && fin1.indice === 1)
    ok('un aviso de final de una pista que ya no suena se ignora', A(e, { tipo: 'siguiente', desde: 'p3' }, 2000).indice === 0)
    ok('anterior con la pista empezada hace rato la reinicia', A(base([1, 2], 1, true, 0, 1000), { tipo: 'anterior' }, 10_000).indice === 1 && A(base([1, 2], 1, true, 0, 1000), { tipo: 'anterior' }, 10_000).posMs === 0)
    ok('anterior al principio de la pista va a la anterior', A(base([1, 2], 1, true, 0, 1000), { tipo: 'anterior' }, 2000).indice === 0)
    ok('anterior en la primera la reinicia', A(base([1, 2], 0, true, 0, 1000), { tipo: 'anterior' }, 2000).indice === 0)
    ok('sin música, nada cambia', A(MUSICA_VACIA, { tipo: 'siguiente' }, 1) === MUSICA_VACIA && A(MUSICA_VACIA, { tipo: 'anterior' }, 1) === MUSICA_VACIA)
  }

  console.log('\n=== pausa, rebobinar y saltar de pista ===')
  {
    const sonando = base([1, 2], 0, true, 10_000, 1000)
    const pausada = A(sonando, { tipo: 'pausar' }, 6000)
    ok('pausar guarda por dónde iba (10 s + 5 s)', !pausada.reproduciendo && pausada.posMs === 15_000)
    ok('reanudar sigue desde ahí', (() => { const r = A(pausada, { tipo: 'reanudar' }, 20_000); return r.reproduciendo && r.posMs === 15_000 && r.t === 20_000 })())
    ok('pausar lo que ya está en pausa (o reanudar lo que suena) no cambia nada', A(pausada, { tipo: 'pausar' }, 7000) === pausada && A(sonando, { tipo: 'reanudar' }, 7000) === sonando)
    ok('buscar pone la posición', A(sonando, { tipo: 'buscar', posMs: 42_000 }, 2000).posMs === 42_000)
    ok('rebobinar 10 s resta desde donde va ahora', A(sonando, { tipo: 'saltar', ms: -10_000 }, 6000).posMs === 5000)
    ok('adelantar 30 s suma', A(sonando, { tipo: 'saltar', ms: 30_000 }, 6000).posMs === 45_000)
    ok('rebobinar de más no da negativos', A(sonando, { tipo: 'saltar', ms: -999_999 }, 6000).posMs === 0)
    ok('saltar a una pista de la cola', A(base([1, 2, 3], 0, false), { tipo: 'irA', indice: 2 }, 2000).indice === 2 && A(base([1, 2, 3], 0, false), { tipo: 'irA', indice: 2 }, 2000).reproduciendo)
    ok('saltar a una que no existe no hace nada', [A(sonando, { tipo: 'irA', indice: 9 }, 2000), A(sonando, { tipo: 'irA', indice: -1 }, 2000), A(sonando, { tipo: 'irA', indice: 0.5 }, 2000)].every((x) => x === sonando))
    ok('cada cambio sube la versión', A(sonando, { tipo: 'pausar' }, 2000).v === sonando.v + 1)
  }

  console.log('\n=== quitar y vaciar ===')
  {
    ok('quitar una de antes de la que suena: el índice sigue apuntando a la misma canción', (() => { const x = A(base([1, 2, 3], 2, true, 7000, 1000), { tipo: 'quitar', id: 'p1' }, 2000); return pos(x) === 'p2,p3' && x.indice === 1 && x.cola[x.indice].id === 'p3' && x.posMs === 8000 })())
    ok('quitar una de después: no cambia lo que suena', (() => { const x = A(base([1, 2, 3], 0, true, 7000, 1000), { tipo: 'quitar', id: 'p3' }, 2000); return pos(x) === 'p1,p2' && x.indice === 0 && x.reproduciendo })())
    ok('quitar la que suena: pasa a la siguiente, desde el principio', (() => { const x = A(base([1, 2, 3], 1, true, 7000, 1000), { tipo: 'quitar', id: 'p2' }, 2000); return pos(x) === 'p1,p3' && x.indice === 1 && x.cola[1].id === 'p3' && x.posMs === 0 })())
    ok('quitar la última que suena: pasa a la anterior', (() => { const x = A(base([1, 2], 1, true, 7000, 1000), { tipo: 'quitar', id: 'p2' }, 2000); return pos(x) === 'p1' && x.indice === 0 })())
    ok('quitar la única: queda vacío y parado', (() => { const x = A(base([1], 0, true, 7000, 1000), { tipo: 'quitar', id: 'p1' }, 2000); return x.cola.length === 0 && x.indice === -1 && !x.reproduciendo })())
    ok('quitar una que no está no cambia nada', (() => { const e = base([1, 2], 0, true); return A(e, { tipo: 'quitar', id: 'nada' }, 2000) === e })())
    ok('vaciar deja todo parado', (() => { const x = A(base([1, 2, 3], 1, true, 7000), { tipo: 'vaciar' }, 2000); return x.cola.length === 0 && x.indice === -1 && !x.reproduciendo })())
  }

  console.log('\n=== texto de duración ===')
  ok('3:07, 0:05 y 1:02:15', textoDeDuracion(187_000) === '3:07' && textoDeDuracion(5000) === '0:05' && textoDeDuracion(3_735_000) === '1:02:15' && textoDeDuracion(-5) === '0:00')

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
  if (fallos > 0) process.exit(1)
}

main()
