import { AJUSTES_DE_AUDIO_POR_DEFECTO, leerAjustesDeAudio, leerVolumenes, limitarVolumen, limpiarAjustesDeAudio, restriccionesDeMicro, volumenEfectivo } from '@/lib/chat/audio'
import { CANALES_DE_VOZ_POR_DEFECTO, esCanalDeVoz, origenDeVoz } from '@/lib/chat/voz'

let fallos = 0
let comprobaciones = 0
function igual(nombre: string, real: unknown, esperado: unknown) {
  comprobaciones += 1
  const a = JSON.stringify(real)
  const b = JSON.stringify(esperado)
  const bien = a === b
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${nombre}${bien ? '' : ` → ${a}, esperaba ${b}`}`)
}

igual('un canal de voz se reconoce por su marca', [esCanalDeVoz('voz:sala-general'), esCanalDeVoz('slack:C123'), esCanalDeVoz(null), esCanalDeVoz(undefined), esCanalDeVoz('')], [true, false, false, false, false])
igual('la marca de un canal nuevo lo es', esCanalDeVoz(origenDeVoz('a1b2')), true)
igual('los canales de voz de siempre: tres, con clave y nombre distintos', [CANALES_DE_VOZ_POR_DEFECTO.length, new Set(CANALES_DE_VOZ_POR_DEFECTO.map((c) => c.clave)).size, new Set(CANALES_DE_VOZ_POR_DEFECTO.map((c) => c.nombre)).size], [3, 3, 3])
igual('los nombres sirven de nombre de canal (minúsculas y guiones)', CANALES_DE_VOZ_POR_DEFECTO.every((c) => /^[a-z0-9-]+$/.test(c.nombre)), true)

igual('sin nada guardado: todo activado', leerAjustesDeAudio(null), AJUSTES_DE_AUDIO_POR_DEFECTO)
igual('lo guardado se respeta', leerAjustesDeAudio(JSON.stringify({ supresion: false, eco: true, nivelacion: false, entrada: 'mic-1', salida: 'alt-2' })), { supresion: false, eco: true, nivelacion: false, entrada: 'mic-1', salida: 'alt-2' })
igual('lo roto vuelve al valor de siempre sin afectar a lo demás', limpiarAjustesDeAudio({ supresion: 'sí', eco: false, entrada: 7 }), { ...AJUSTES_DE_AUDIO_POR_DEFECTO, eco: false })
igual('un JSON roto vuelve a lo de siempre', leerAjustesDeAudio('{no'), AJUSTES_DE_AUDIO_POR_DEFECTO)
igual('las restricciones del micrófono', restriccionesDeMicro({ supresion: true, eco: false, nivelacion: true, entrada: 'x', salida: '' }), { noiseSuppression: true, echoCancellation: false, autoGainControl: true, deviceId: 'x' })
igual('sin micrófono elegido no se pide ninguno', 'deviceId' in restriccionesDeMicro(AJUSTES_DE_AUDIO_POR_DEFECTO), false)

igual('el volumen se limita entre 0 y 1', [limitarVolumen(-3), limitarVolumen(0.4), limitarVolumen(9), limitarVolumen('a'), limitarVolumen(NaN)], [0, 0.4, 1, 1, 1])
igual('los volúmenes guardados se limpian', leerVolumenes(JSON.stringify({ a: 0.5, b: 7, c: 'x' })), { a: 0.5, b: 1 })
igual('un volumen roto no guarda nada', [leerVolumenes('[1]'), leerVolumenes('{no'), leerVolumenes(null)], [{}, {}, {}])
igual('quien no está guardado se oye a tope; ensordecido, a nadie', [volumenEfectivo({ a: 0.3 }, 'a', false), volumenEfectivo({ a: 0.3 }, 'z', false), volumenEfectivo({ a: 0.3 }, 'a', true)], [0.3, 1, 0])

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones bien`)
if (fallos > 0) process.exit(1)
