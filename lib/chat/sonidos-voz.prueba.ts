import { CADA_LLAMANDO_MS, CADA_TONO_DE_LLAMADA_MS, MAX_LLAMANDO_MS, SONIDOS_PARA_PROBAR, duracionDe, notasDe, notasDelTonoDeLlamada, type SonidoDeVoz } from '@/lib/chat/sonidos-voz'
import { AJUSTES_DE_AUDIO_POR_DEFECTO, leerAjustesDeAudio, limpiarAjustesDeAudio } from '@/lib/chat/audio'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LOS SONIDOS DE LA JUNTA. Lo que se vigila: que cada sonido tenga notas válidas y no dure demasiado (un aviso de 3 s en cada entrada molesta), que lo que oyen los demás sea más suave que
 * lo tuyo, que entrar suba y salir baje (es lo que las distingue al oído), que mutear baje y desmutear suba, y que el interruptor de «Sonidos de la junta» se guarde y valga true por
 * defecto. Lo que suena de verdad solo se puede oír.
 */
const TODOS: SonidoDeVoz[] = ['entrar', 'salir', 'otro-entra', 'otro-sale', 'mute', 'unmute', 'ensordecer', 'oir', 'llamando']
const primera = (s: SonidoDeVoz) => notasDe(s)[0].f
const ultima = (s: SonidoDeVoz) => notasDe(s)[notasDe(s).length - 1].f
const volumen = (s: SonidoDeVoz) => Math.max(...notasDe(s).map((n) => n.g))

function main() {
  console.log('\n=== las notas ===')
  {
    ok('cada sonido tiene notas con frecuencia, duración y volumen válidos', TODOS.every((s) => notasDe(s).length > 0 && notasDe(s).every((n) => n.f > 100 && n.f < 4000 && n.d > 0 && n.t >= 0 && n.g > 0 && n.g <= 0.3)))
    ok('ninguno de los avisos dura más de medio segundo (el «llamando» es otra cosa)', TODOS.filter((s) => s !== 'llamando').every((s) => duracionDe(s) <= 0.5), TODOS.map((s) => duracionDe(s).toFixed(2)).join())
  }

  console.log('\n=== lo que se distingue al oído ===')
  {
    ok('entrar sube y salir baja', ultima('entrar') > primera('entrar') && ultima('salir') < primera('salir'))
    ok('lo de los demás también: entra sube, sale baja', ultima('otro-entra') > primera('otro-entra') && ultima('otro-sale') < primera('otro-sale'))
    ok('lo de los demás suena más suave que lo tuyo', volumen('otro-entra') < volumen('entrar') && volumen('otro-sale') < volumen('salir'))
    ok('mutear baja, desmutear sube', ultima('mute') < primera('mute') && ultima('unmute') > primera('unmute'))
    ok('ensordecer baja, volver a oír sube', ultima('ensordecer') < primera('ensordecer') && ultima('oir') > primera('oir'))
    ok('entrar y otro-entra no son el mismo sonido', JSON.stringify(notasDe('entrar')) !== JSON.stringify(notasDe('otro-entra')))
  }

  console.log('\n=== las llamadas ===')
  {
    ok('el «llamando» son dos tonos a la vez y suaves', notasDe('llamando').length === 2 && notasDe('llamando').every((n) => n.t === 0 && n.g <= 0.06))
    ok('el «llamando» se repite más despacio de lo que dura, y se corta a los 40 s', CADA_LLAMANDO_MS > duracionDe('llamando') * 1000 && MAX_LLAMANDO_MS === 40_000)
    const tono = notasDelTonoDeLlamada()
    const dura = Math.max(...tono.map((n) => n.t + n.d))
    ok('el tono de llamada cabe entre repeticiones y se oye más que un aviso de la junta', dura * 1000 < CADA_TONO_DE_LLAMADA_MS && Math.max(...tono.map((n) => n.g)) > volumen('otro-entra'))
  }

  console.log('\n=== el probador ===')
  {
    const ids = SONIDOS_PARA_PROBAR.map((x) => x.id)
    ok('se puede probar cada sonido de la junta y el tono de llamada, una vez cada uno', [...TODOS, 'llamada'].every((s) => ids.filter((i) => i === s).length === 1) && ids.length === TODOS.length + 1, ids.join())
    ok('cada uno dice cuándo suena', SONIDOS_PARA_PROBAR.every((x) => x.nombre.length > 2 && x.cuando.length > 10))
  }

  console.log('\n=== el interruptor «Sonidos de la junta» ===')
  {
    ok('viene activado de fábrica', AJUSTES_DE_AUDIO_POR_DEFECTO.sonidos === true && leerAjustesDeAudio(null).sonidos === true)
    ok('apagado se guarda y se vuelve a leer', leerAjustesDeAudio(JSON.stringify({ sonidos: false })).sonidos === false)
    ok('un valor roto vuelve a activado sin tocar lo demás', limpiarAjustesDeAudio({ sonidos: 'no', eco: false }).sonidos === true && limpiarAjustesDeAudio({ sonidos: 'no', eco: false }).eco === false)
    ok('lo guardado antes de existir el interruptor (sin esa clave) sale activado', leerAjustesDeAudio(JSON.stringify({ supresion: false, eco: true, nivelacion: false, entrada: 'm', salida: 'a' })).sonidos === true)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
  if (fallos > 0) process.exit(1)
}

main()
