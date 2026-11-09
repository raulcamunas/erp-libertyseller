import {
  MAX_VISTAS,
  inicialDe,
  leerVistasPrevias,
  pastillaDelChatVisible,
  ponerPastillaDelChatVisible,
  publicarVistaPrevia,
  quitarVistaPrevia,
  suscribirVistasPrevias,
  vaciarVistasPrevias,
} from '@/lib/chat/vista-previa'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LAS VISTAS PREVIAS DEL CHAT. Lo que duele si falla: que el mismo aviso salga dos veces, que una torre de tarjetas tape la pantalla, que la misma lista cambie de referencia sin
 * haber cambiado nada (useSyncExternalStore se queda en bucle) o que queden tarjetas colgadas cuando la pastilla ya no está.
 */

const v = (n: number) => ({ clave: `chat-d:${n}`, titulo: `Persona ${n}`, texto: `mensaje ${n}`, canalId: `canal-${n}` })

function main() {
  console.log('\n=== publicar y quitar ===')
  {
    vaciarVistasPrevias()
    let avisos = 0
    const baja = suscribirVistasPrevias(() => avisos++)
    publicarVistaPrevia(v(1))
    ok('una publicada se ve', leerVistasPrevias().length === 1 && leerVistasPrevias()[0].texto === 'mensaje 1')
    publicarVistaPrevia(v(1))
    ok('la misma clave no sale dos veces ni avisa dos veces', leerVistasPrevias().length === 1 && avisos === 1, `${leerVistasPrevias().length} / ${avisos}`)
    const ref = leerVistasPrevias()
    quitarVistaPrevia('no-existe')
    ok('quitar una que no está no cambia nada ni avisa (misma referencia)', leerVistasPrevias() === ref && avisos === 1)
    quitarVistaPrevia('chat-d:1')
    ok('quitar la que está la retira', leerVistasPrevias().length === 0 && avisos === 2)
    baja()
    publicarVistaPrevia(v(2))
    ok('sin suscripción no avisa a nadie', avisos === 2)
    vaciarVistasPrevias()
  }

  console.log('\n=== el tope ===')
  {
    vaciarVistasPrevias()
    for (let i = 1; i <= MAX_VISTAS + 2; i++) publicarVistaPrevia(v(i))
    const claves = leerVistasPrevias().map((x) => x.clave)
    ok(`solo se ven ${MAX_VISTAS} y son las más nuevas`, claves.length === MAX_VISTAS && claves[0] === `chat-d:3` && claves[claves.length - 1] === `chat-d:${MAX_VISTAS + 2}`, claves.join())
    vaciarVistasPrevias()
  }

  console.log('\n=== la pastilla ===')
  {
    vaciarVistasPrevias()
    ponerPastillaDelChatVisible(true)
    ok('a la vista', pastillaDelChatVisible())
    publicarVistaPrevia(v(1))
    ponerPastillaDelChatVisible(false)
    ok('al quitarse la pastilla se retiran las tarjetas que quedaban', !pastillaDelChatVisible() && leerVistasPrevias().length === 0)
    const ref = leerVistasPrevias()
    vaciarVistasPrevias()
    ok('vaciar lo que ya está vacío no cambia la referencia', leerVistasPrevias() === ref)
  }

  console.log('\n=== la inicial ===')
  {
    ok('la primera letra, en mayúscula', inicialDe('Daniela') === 'D' && inicialDe('  ana en #general') === 'A')
    ok('se salta lo que no es letra', inicialDe('📊 Encuesta') === 'E' && inicialDe('@José') === 'J')
    ok('con acentos y la eñe', inicialDe('élida') === 'É' && inicialDe('ñoño') === 'Ñ')
    ok('vacío no rompe', inicialDe('') === '·' && inicialDe('   ') === '·')
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
  if (fallos > 0) process.exit(1)
}

main()
