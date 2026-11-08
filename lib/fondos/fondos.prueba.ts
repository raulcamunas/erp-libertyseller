import { PALETAS, PALETAS_ANIMADAS_NUEVAS, conAlfa, oscurecer } from '@/lib/fondos/paletas'
import { FONDOS_DEL_CHAT, esFondoDelChat, variablesDeFondo } from '@/lib/chat/fondos'
import { AJUSTES_POR_DEFECTO, limpiarAjustes } from '@/lib/chat/temas'
import { PATRONES, capasDeCss, patronComoFondo } from '@/lib/fondos/patrones'
import { DEGRADADOS, FONDOS_ANIMADOS, PATRONES_DE_FONDO, fondoAnimadoId, fondoCss } from '@/lib/tareas-clientes/colores'

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
const equilibrado = (css: string) => css.split('(').length === css.split(')').length
const unicos = (ids: string[]) => new Set(ids).size === ids.length

igual('colores con transparencia', [conAlfa('#fff', 0.5), conAlfa('#ff6600', 1)], ['rgba(255, 255, 255, 0.5)', 'rgba(255, 102, 0, 1)'])
igual('oscurecer', [oscurecer('#ffffff', 0.5), oscurecer('#ff6600', 0)], ['#808080', '#000000'])
igual('las paletas tienen id único y tres colores válidos', [unicos(PALETAS.map((p) => p.id)), PALETAS.every((p) => [p.a, p.b, p.c].every((c) => /^#[0-9a-f]{6}$/i.test(c)))], [true, true])
igual('hay 28 paletas', PALETAS.length, 28)
igual('los animados nuevos: ids únicos y colores válidos', [unicos(PALETAS_ANIMADAS_NUEVAS.map((p) => p.id)), PALETAS_ANIMADAS_NUEVAS.every((p) => [p.a, p.b, p.c].every((c) => /^#[0-9a-f]{6}$/i.test(c)))], [true, true])
igual('27 patrones, ids únicos', [PATRONES.length, unicos(PATRONES.map((p) => p.id))], [27, true])
igual('cada patrón da CSS con los paréntesis cerrados, con cualquier color', PATRONES.every((p) => equilibrado(p.imagen('#000')) && equilibrado(p.imagen('rgba(255, 255, 255, 0.08)'))), true)
igual('un patrón SVG no deja caracteres que rompan el url()', PATRONES.every((p) => !/url\("data:[^"]*"[^)]/.test(p.imagen('#000').replace(/"\)/g, '")'))), true)

// ---------- chat
igual('69 fondos en el chat, ids únicos', [FONDOS_DEL_CHAT.length, unicos(FONDOS_DEL_CHAT.map((f) => f.id))], [69, true])
igual('los cuatro de siempre siguen existiendo', ['liso', 'aurora', 'puntos', 'malla'].every(esFondoDelChat), true)
igual('todo el CSS del chat está equilibrado', FONDOS_DEL_CHAT.every((f) => equilibrado(f.fondo ?? '') && equilibrado(f.patron ?? '')), true)
igual('un fondo desconocido vuelve al de siempre', limpiarAjustes({ fondo: 'no-existe' }).fondo, AJUSTES_POR_DEFECTO.fondo)
igual('un fondo nuevo se respeta', limpiarAjustes({ fondo: 'hexagonos' }).fondo, 'hexagonos')
igual('las variables de un fondo sin dibujo no pintan máscara', [variablesDeFondo('aurora')['--chat-tinte'], variablesDeFondo('liso')['--chat-fondo']], ['transparent', 'none'])
igual('las variables de un fondo con dibujo traen tinte y tamaño', [variablesDeFondo('hexagonos')['--chat-tam'], variablesDeFondo('hexagonos')['--chat-tinte'].startsWith('color-mix')], ['56px 100px', true])

// ---------- tareas
igual('capas de CSS con comas dentro de paréntesis', capasDeCss('linear-gradient(0deg, #000 0 1px, transparent 1px 8px), radial-gradient(#000 1px, transparent 1px)').length, 2)
igual('un patrón con varias capas lleva el tamaño de cada una', patronComoFondo(PATRONES[2], '#fff', '#000').split(' 0 0 / ').length, 5)
igual('28 fondos animados nuevos, todos reconocidos', [FONDOS_ANIMADOS.length, FONDOS_ANIMADOS.every((f) => fondoAnimadoId({ tipo: 'animado', valor: f.id }) === f.id), unicos(FONDOS_ANIMADOS.map((f) => f.id))], [51, true, true])
igual('50 degradados, ids únicos', [DEGRADADOS.length, unicos(DEGRADADOS.map((d) => d.id))], [50, true])
igual('27 patrones de fondo, ids únicos y distintos de los degradados', [PATRONES_DE_FONDO.length, unicos([...DEGRADADOS, ...PATRONES_DE_FONDO].map((d) => d.id))], [27, true])
igual('un patrón guardado como degradado se pinta, y uno inventado no', [typeof fondoCss({ tipo: 'degradado', valor: 'p-hexagonos' }), fondoCss({ tipo: 'degradado', valor: 'p-inventado' })], ['string', null])
igual('todo el CSS de las tareas está equilibrado', [...DEGRADADOS, ...PATRONES_DE_FONDO].every((d) => equilibrado(d.css)), true)

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones bien`)
if (fallos > 0) process.exit(1)
