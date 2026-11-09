import {
  BIBLIOTECA,
  INTERACCIONES,
  SIN_SONIDO,
  SONIDOS_DE_AVISO,
  SONIDOS_DE_TONO,
  duracionDeSonido,
  esDeFabrica,
  interaccionDe,
  leerEleccion,
  limpiarEleccion,
  notasDeSonido,
  sonidoDeBiblioteca,
  sonidoElegidoPara,
} from '@/lib/sonidos/biblioteca'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LA BIBLIOTECA DE SONIDOS. Lo que se vigila: que cada sonido sea tocable (notas válidas, ni muy largos ni muy fuertes), que cada interacción tenga un sonido de fábrica de SU familia, que lo
 * guardado en el navegador se limpie sin romper nada (un sonido borrado, de otra familia o un JSON roto vuelven al de fábrica) y que los de fábrica de la junta se sigan distinguiendo al
 * oído (entrar sube, salir baja, mutear baja, desmutear sube).
 */
const primera = (id: string) => notasDeSonido(id)[0].f
const ultima = (id: string) => notasDeSonido(id)[notasDeSonido(id).length - 1].f
const defecto = (i: string) => interaccionDe(i)!.defecto

function main() {
  console.log('\n=== el catálogo ===')
  {
    ok('los ids no se repiten', new Set(BIBLIOTECA.map((s) => s.id)).size === BIBLIOTECA.length)
    ok('hay un buen puñado de avisos y de tonos', SONIDOS_DE_AVISO.length >= 20 && SONIDOS_DE_TONO.length >= 6, `${SONIDOS_DE_AVISO.length}/${SONIDOS_DE_TONO.length}`)
    ok('cada sonido tiene notas válidas: frecuencia, duración y volumen razonables', BIBLIOTECA.every((s) => s.notas.length > 0 && s.notas.every((x) => x.f >= 100 && x.f <= 4000 && (x.fin === undefined || (x.fin >= 100 && x.fin <= 4000)) && x.t >= 0 && x.d > 0 && x.g > 0 && x.g <= 0.3)))
    ok('un aviso no dura más de 1,3 s', SONIDOS_DE_AVISO.every((s) => duracionDeSonido(s.id) <= 1.3), SONIDOS_DE_AVISO.map((s) => `${s.id}:${duracionDeSonido(s.id).toFixed(2)}`).join(' '))
    ok('un tono dura menos de lo que tarda en repetirse', SONIDOS_DE_TONO.every((s) => typeof s.cada === 'number' && s.cada >= 2000 && duracionDeSonido(s.id) * 1000 < s.cada))
    ok('solo los tonos llevan `cada`; solo los dos «de siempre» llevan fichero', BIBLIOTECA.every((s) => (s.familia === 'tono') === (s.cada !== undefined)) && BIBLIOTECA.filter((s) => s.fichero).map((s) => s.id).sort().join() === 'din-don-correo,ding-tareas')
    ok('todos tienen nombre y grupo', BIBLIOTECA.every((s) => s.nombre.length > 2 && s.grupo.length > 2))
  }

  console.log('\n=== las interacciones ===')
  {
    ok('los ids no se repiten y hay doce', new Set(INTERACCIONES.map((i) => i.id)).size === INTERACCIONES.length && INTERACCIONES.length === 12)
    ok('cada una tiene de fábrica un sonido que existe y es de su familia', INTERACCIONES.every((i) => sonidoDeBiblioteca(i.defecto)?.familia === i.familia), INTERACCIONES.map((i) => i.defecto).join())
    ok('llamando y llamada son tonos; el resto, avisos', INTERACCIONES.every((i) => (i.id === 'llamando' || i.id === 'llamada') === (i.familia === 'tono')))
    ok('lo que oyes de los demás es más suave que lo tuyo', interaccionDe('otro-entra')!.volumen < interaccionDe('entrar')!.volumen && interaccionDe('otro-sale')!.volumen < interaccionDe('salir')!.volumen)
    ok('todas dicen cuándo suenan', INTERACCIONES.every((i) => i.nombre.length > 5 && i.cuando.length > 15))
  }

  console.log('\n=== los de fábrica se distinguen al oído ===')
  {
    ok('entrar sube y salir baja', ultima(defecto('entrar')) > primera(defecto('entrar')) && ultima(defecto('salir')) < primera(defecto('salir')))
    ok('lo de los demás: entra sube, sale baja', ultima(defecto('otro-entra')) > primera(defecto('otro-entra')) && ultima(defecto('otro-sale')) < primera(defecto('otro-sale')))
    ok('mutear baja y desmutear sube', ultima(defecto('mute')) < primera(defecto('mute')) && ultima(defecto('unmute')) > primera(defecto('unmute')))
    ok('ensordecer baja y volver a oír sube', ultima(defecto('ensordecer')) < primera(defecto('ensordecer')) && ultima(defecto('oir')) > primera(defecto('oir')))
    ok('entrar y alguien entra no son el mismo sonido', defecto('entrar') !== defecto('otro-entra'))
  }

  console.log('\n=== lo elegido ===')
  {
    ok('sin nada guardado, todo de fábrica', INTERACCIONES.every((i) => esDeFabrica({}, i.id) && sonidoElegidoPara({}, i.id) === i.defecto))
    const e = leerEleccion(JSON.stringify({ entrar: 'marimba', mute: SIN_SONIDO, llamada: 'campanas' }))
    ok('lo elegido se respeta, también el silencio', e.entrar === 'marimba' && e.mute === SIN_SONIDO && e.llamada === 'campanas')
    ok('y lo demás sigue de fábrica', sonidoElegidoPara(e, 'salir') === defecto('salir') && !esDeFabrica(e, 'entrar') && esDeFabrica(e, 'salir'))
    ok('elegir justo el de fábrica cuenta como de fábrica', esDeFabrica({ entrar: defecto('entrar') }, 'entrar'))
    ok('un sonido que no existe vuelve al de fábrica', limpiarEleccion({ entrar: 'no-existe' }).entrar === undefined)
    ok('un tono en un aviso (o al revés) se ignora', limpiarEleccion({ entrar: 'clasico', llamada: 'marimba' }).entrar === undefined && limpiarEleccion({ llamada: 'marimba' }).llamada === undefined)
    ok('una interacción inventada se ignora', Object.keys(limpiarEleccion({ cocina: 'pop', entrar: 'pop' })).join() === 'entrar')
    ok('basura: JSON roto, null, números, listas', Object.keys(leerEleccion('{no')).length === 0 && Object.keys(leerEleccion(null)).length === 0 && Object.keys(limpiarEleccion(3)).length === 0 && Object.keys(limpiarEleccion(['pop'])).length === 0 && Object.keys(limpiarEleccion({ entrar: 7 })).length === 0)
    ok('el silencio no tiene notas ni duración', notasDeSonido(SIN_SONIDO).length === 0 && duracionDeSonido(SIN_SONIDO) === 0)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
  if (fallos > 0) process.exit(1)
}

main()
