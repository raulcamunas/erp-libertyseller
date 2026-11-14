import { claveDeSemana, cruzarClientes, nombreParaCruzar, propuestaDeCumplimiento, propuestasDeAlertasFba, MAX_SKU_EN_LA_TAREA, type AlertaFba } from '@/lib/tareas-clientes/automaticas'
import { textoPlano } from '@/lib/tareas-clientes/bloques'

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

const al = (clave: string, severidad: AlertaFba['severidad'], estado: AlertaFba['estado'] = 'abierta', extra: Partial<AlertaFba> = {}): AlertaFba => ({ clave, tipo: 'reposicion', severidad, titulo: `Alerta ${clave}`, detalle: null, sku: null, estado, ...extra })

const props = propuestasDeAlertasFba([al('a', 'critica'), al('b', 'alta'), al('c', 'media'), al('d', 'info'), al('e', 'critica', 'resuelta'), al('f', 'critica', 'silenciada'), al('g', 'alta', 'abierta', { sku: 'SKU-1', detalle: 'Se acaba en 5 días' })])
igual('solo abiertas, críticas y altas', props.map((x) => x.clave), ['fba:a', 'fba:b', 'fba:g'])
igual('el icono sigue a la gravedad', props.map((x) => x.icono), ['🚨', '⚠️', '⚠️'])
igual('el cuerpo lleva el detalle y la referencia', textoPlano(props[2].contenido).includes('Se acaba en 5 días') && textoPlano(props[2].contenido).includes('SKU-1'), true)
igual('una alerta larga se recorta en el título', propuestasDeAlertasFba([al('x', 'critica', 'abierta', { titulo: 'x'.repeat(500) })])[0].titulo.length, 200)

igual('semana ISO: 8 nov 2026 (domingo)', claveDeSemana('2026-11-08'), '2026-W45')
igual('semana ISO: lunes siguiente', claveDeSemana('2026-11-09'), '2026-W46')
igual('semana ISO: 1 enero 2027 cae en la 53 de 2026', claveDeSemana('2027-01-01'), '2026-W53')
igual('semana ISO: 29 dic 2025 ya es de 2026', claveDeSemana('2025-12-29'), '2026-W01')

igual('sin listings suprimidos, nada', propuestaDeCumplimiento([], '2026-11-08'), null)
const uno = propuestaDeCumplimiento([{ sku: 'A', titulo: 'Zapato', tema: 'normativa', errores: 2 }], '2026-11-08')
igual('uno: singular, clave por semana', [uno?.titulo, uno?.clave], ['1 listing suprimido con stock', 'cumpl:2026-W45'])
const muchos = propuestaDeCumplimiento(Array.from({ length: 20 }, (_, i) => ({ sku: `S${String(i).padStart(2, '0')}`, titulo: null, tema: null, errores: i })), '2026-11-08')
igual('muchos: plural, se enseñan los primeros y se dice cuántos más', [muchos?.titulo, textoPlano(muchos?.contenido ?? []).includes(`…y ${20 - MAX_SKU_EN_LA_TAREA} más`)], ['20 listings suprimidos con stock', true])
igual('entran los de más errores y los de menos se quedan fuera', [textoPlano(muchos?.contenido ?? []).includes('S19'), textoPlano(muchos?.contenido ?? []).includes('S00')], [true, false])

igual('nombre para cruzar', nombreParaCruzar('  Shoes-F, S.L.  '), 'shoes f s l')
const t = [{ id: 't1', nombre: 'ShoesF' }, { id: 't2', nombre: 'Entrais' }, { id: 't3', nombre: 'Lenobotics', amazonClientId: 'a3' }, { id: 't4', nombre: 'Doble' }, { id: 't5', nombre: 'doble' }]
const a = [{ id: 'a1', nombre: 'SHOESF' }, { id: 'a2', nombre: 'Otra marca' }, { id: 'a3', nombre: 'Nombre distinto' }, { id: 'a4', nombre: 'Doble' }]
const c = cruzarClientes(t, a)
igual('se cruzan por nombre, lo enlazado a mano manda y lo ambiguo no se adivina', [[...c.porAmazon.entries()].sort(), c.sinPareja.map((x) => x.id)], [[['a1', 't1'], ['a3', 't3']], ['a2', 'a4']])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
