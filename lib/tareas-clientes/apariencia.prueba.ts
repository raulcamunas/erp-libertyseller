import { COLORES, ICONOS, PERSONAJES, EMOJI_DE_PERSONAJE, esIconoValido, elegirApariencia, hexDeColor, ocupadosPorOtros, type MapaDeApariencia } from '@/lib/tareas-clientes/apariencia'

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

const mapa: MapaDeApariencia = { ana: { color: 'azul', icono: 'cohete' }, bea: { color: 'rojo', icono: null }, cris: { color: null, icono: 'gato' } }
const nombre = (id: string) => ({ ana: 'Ana', bea: 'Bea', cris: 'Cris' })[id] ?? id

igual('listas sin repetidos', [new Set(COLORES.map((c) => c.id)).size === COLORES.length, new Set(ICONOS.map((i) => i.id)).size === ICONOS.length, new Set(COLORES.map((c) => c.hex)).size === COLORES.length], [true, true, true])
igual('hay de sobra para un equipo', [COLORES.length >= 15, ICONOS.length >= 20], [true, true])
igual('el hex de un color', [hexDeColor('azul'), hexDeColor('nada'), hexDeColor(null)], ['#3B82F6', null, null])
const o = ocupadosPorOtros(mapa, 'ana')
igual('lo mío no cuenta como ocupado', [o.colores.has('azul'), o.colores.get('rojo'), o.iconos.has('cohete'), o.iconos.get('gato')], [false, 'bea', false, 'cris'])
igual('coger algo libre', elegirApariencia(mapa, 'ana', { color: 'verde', icono: 'luna' }), { ok: true, color: 'verde', icono: 'luna' })
igual('quedarse con lo que ya es mío', elegirApariencia(mapa, 'ana', { color: 'azul', icono: 'cohete' }), { ok: true, color: 'azul', icono: 'cohete' })
igual('un color de otra persona se rechaza y dice quién', elegirApariencia(mapa, 'ana', { color: 'rojo', icono: null }, nombre), { ok: false, motivo: 'Ese color ya lo tiene Bea.' })
igual('un icono de otra persona se rechaza y dice quién', elegirApariencia(mapa, 'ana', { color: null, icono: 'gato' }, nombre), { ok: false, motivo: 'Ese icono ya lo tiene Cris.' })
igual('quitarlo todo vale', elegirApariencia(mapa, 'ana', { color: null, icono: null }), { ok: true, color: null, icono: null })
igual('lo que no existe se rechaza', [elegirApariencia(mapa, 'ana', { color: 'x', icono: null }).ok, elegirApariencia(mapa, 'ana', { color: null, icono: 7 }).ok, elegirApariencia(mapa, 'ana', { color: undefined, icono: undefined }).ok], [false, false, true])
igual('una persona nueva puede coger lo que dejó otra al quitárselo', elegirApariencia({ ...mapa, ana: { color: null, icono: null } }, 'dan', { color: 'azul', icono: 'cohete' }).ok, true)

// ---------- iconos y personajes
igual('ids de icono y de personaje, todos distintos', new Set([...ICONOS.map((x) => x.id), ...PERSONAJES.map((x) => x.id)]).size, ICONOS.length + PERSONAJES.length)
igual('los personajes llevan «e-» y solo letras minúsculas', PERSONAJES.every((x) => /^e-[a-z]+$/.test(x.id)), true)
igual('cada personaje tiene su emoji', PERSONAJES.every((x) => EMOJI_DE_PERSONAJE.get(x.id) === x.emoji && x.emoji.length > 0), true)
igual('un personaje es un icono válido, uno inventado no', [esIconoValido('e-zorro'), esIconoValido('e-inventado'), esIconoValido('robot')], [true, false, true])
igual('un personaje se puede elegir y es exclusivo', [elegirApariencia({}, 'ana', { color: null, icono: 'e-zorro' }).ok, elegirApariencia({ ana: { color: null, icono: 'e-zorro' } }, 'bea', { color: null, icono: 'e-zorro' }).ok], [true, false])
igual('hay más de 60 iconos y 50 personajes o más', [ICONOS.length > 60, PERSONAJES.length >= 50], [true, true])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
