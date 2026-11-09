import { MAX_LLAMANDO_MS } from '@/lib/chat/sonidos-voz'
import { AJUSTES_DE_AUDIO_POR_DEFECTO, leerAjustesDeAudio, limpiarAjustesDeAudio } from '@/lib/chat/audio'
import { duracionDeSonido, interaccionDe, sonidoDeBiblioteca } from '@/lib/sonidos/biblioteca'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LOS SONIDOS DE LA JUNTA (lo que no es la biblioteca: eso está en lib/sonidos/biblioteca.prueba.ts). Se vigila el interruptor «Sonidos de la junta» (activado de fábrica, se guarda, un valor
 * roto no lo cambia) y que el «llamando…» de fábrica quepa en su tope.
 */
function main() {
  console.log('\n=== el interruptor «Sonidos de la junta» ===')
  {
    ok('viene activado de fábrica', AJUSTES_DE_AUDIO_POR_DEFECTO.sonidos === true && leerAjustesDeAudio(null).sonidos === true)
    ok('apagado se guarda y se vuelve a leer', leerAjustesDeAudio(JSON.stringify({ sonidos: false })).sonidos === false)
    ok('un valor roto vuelve a activado sin tocar lo demás', limpiarAjustesDeAudio({ sonidos: 'no', eco: false }).sonidos === true && limpiarAjustesDeAudio({ sonidos: 'no', eco: false }).eco === false)
    ok('lo guardado antes de existir el interruptor (sin esa clave) sale activado', leerAjustesDeAudio(JSON.stringify({ supresion: false, eco: true, nivelacion: false, entrada: 'm', salida: 'a' })).sonidos === true)
  }
  console.log('\n=== el «llamando…» ===')
  {
    const s = sonidoDeBiblioteca(interaccionDe('llamando')!.defecto)!
    ok('el de fábrica se repite más despacio de lo que dura y el tope son 40 s', (s.cada ?? 0) > duracionDeSonido(s.id) * 1000 && MAX_LLAMANDO_MS === 40_000)
  }
  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
  if (fallos > 0) process.exit(1)
}

main()
