import { normalizarActividad, describirLugar, desconectados, enCliente, enTarea, escribiendoEnTarea, estadoDeActividad, lugarDeRuta, nombresEnFrase, porCliente, porTarea, QUIETA_TRAS_MS, unirDispositivos, type EstadoDePresencia } from '@/lib/tareas-clientes/presencia'

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
const AHORA = 1_000_000_000
const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'
const T1 = '33333333-3333-4333-8333-333333333333'
const est = (id: string, nombre: string, extra: Partial<EstadoDePresencia> = {}): EstadoDePresencia => ({ id, nombre, pantalla: 'cliente', clienteId: C1, tareaId: null, escribiendoEn: null, escribiendoHasta: 0, actividad: AHORA - 1000, quieto: false, ...extra })

igual('activa o quieta según lo último que hizo', [estadoDeActividad(AHORA - 1000, AHORA), estadoDeActividad(AHORA - QUIETA_TRAS_MS - 1, AHORA), estadoDeActividad(AHORA, AHORA, false)], ['activo', 'quieto', 'quieto'])

const bruto = { dani: [est('dani', 'Daniella')], pat: [est('pat', 'Patricia', { actividad: AHORA - 600_000 }), est('pat', 'Patricia', { actividad: AHORA - 5000, clienteId: C2 })], raul: [est('raul', 'Raúl')], roto: [{ nombre: 'sin id ni actividad' }] }
const c = unirDispositivos(bruto, AHORA)
igual('una persona por id; la pestaña con lo último hecho manda; lo roto se ignora', c.map((x) => [x.id, x.estado, x.clienteId]), [['dani', 'activo', C1], ['pat', 'activo', C2], ['raul', 'activo', C1]])
igual('ordena: activas primero, luego por nombre', unirDispositivos({ b: [est('b', 'Beatriz', { actividad: AHORA - 900_000 })], a: [est('a', 'Zoe')], c: [est('c', 'Ana')] }, AHORA).map((x) => x.nombre), ['Ana', 'Zoe', 'Beatriz'])

igual('en un cliente: los demás, no yo', enCliente(c, C1, 'raul').map((x) => x.id), ['dani'])
const conTarea = unirDispositivos({ d: [est('d', 'Daniella', { tareaId: T1, escribiendoEn: T1, escribiendoHasta: AHORA + 5000 })], p: [est('p', 'Patricia', { tareaId: T1, escribiendoEn: T1, escribiendoHasta: AHORA - 1 })], r: [est('r', 'Raúl', { tareaId: T1 })] }, AHORA)
igual('en una tarea: los demás', enTarea(conTarea, T1, 'r').map((x) => x.id), ['d', 'p'])
igual('escribiendo: solo mientras no caduque el «escribiendo»', escribiendoEnTarea(conTarea, T1, AHORA, 'r').map((x) => x.id), ['d'])
igual('agrupado por tarea y por cliente, sin mí', [[...porTarea(conTarea, 'r').keys()], porTarea(conTarea, 'r').get(T1)?.length, [...porCliente(conTarea, 'd').keys()], porCliente(conTarea, 'd').get(C1)?.length], [[T1], 2, [C1], 2])

igual('lugar de una dirección', [lugarDeRuta(`/dashboard/tareas-clientes/${C1}`), lugarDeRuta('/dashboard/tareas-clientes/mi-dia'), lugarDeRuta('/dashboard/tareas-clientes/mis-tareas'), lugarDeRuta('/dashboard/tareas-clientes/todas'), lugarDeRuta('/dashboard/tareas-clientes')], [{ pantalla: 'cliente', clienteId: C1 }, { pantalla: 'dia', clienteId: null }, { pantalla: 'mias', clienteId: null }, { pantalla: 'todas', clienteId: null }, { pantalla: 'inicio', clienteId: null }])
const nom = (id: string) => ({ [C1]: 'ShoesF' })[id]
const tit = (id: string) => ({ [T1]: 'Revisar precios' })[id]
igual('describir dónde está', [describirLugar({ pantalla: 'cliente', clienteId: C1, tareaId: T1 }, nom, tit), describirLugar({ pantalla: 'cliente', clienteId: C1, tareaId: null }, nom, tit), describirLugar({ pantalla: 'dia', clienteId: null, tareaId: null }, nom, tit), describirLugar({ pantalla: 'cliente', clienteId: C2, tareaId: null }, nom, tit), describirLugar({ pantalla: 'todas', clienteId: null, tareaId: T1 }, nom, tit)], ['ShoesF · Revisar precios', 'ShoesF', 'Mi día', 'un cliente', 'Revisar precios'])

igual('los que no están conectados', desconectados([{ id: 'dani' }, { id: 'carla' }, { id: 'raul' }], c).map((p) => p.id), ['carla'])
igual('nombres en una frase', [nombresEnFrase([]), nombresEnFrase(['Daniella Villarroel']), nombresEnFrase(['Daniella V', 'Patricia A']), nombresEnFrase(['A', 'B', 'C']), nombresEnFrase(['A', 'B', 'C', 'D', 'E'])], ['', 'Daniella', 'Daniella y Patricia', 'A, B y C', 'A, B y 3 más'])

// Relojes distintos: lo que cuenta es cuándo vi yo cambiar el pulso
const payload = (id: string, pulso: number, quieto = false) => ({ id, nombre: id, pantalla: 'cliente' as const, clienteId: C1, tareaId: null, escribiendoEn: null, escribiendoHasta: 0, pulso, quieto, presence_ref: `ref-${id}` })
const t0 = 5_000_000
const a = normalizarActividad({ dani: [payload('dani', 7)] }, new Map(), t0)
igual('un dispositivo nuevo cuenta como visto ahora', a.estados.dani[0].actividad, t0)
const b = normalizarActividad({ dani: [payload('dani', 7)] }, a.observados, t0 + 60_000)
igual('mismo pulso: sigue valiendo la última vez que lo vi cambiar', b.estados.dani[0].actividad, t0)
const c2 = normalizarActividad({ dani: [payload('dani', 8)] }, b.observados, t0 + 70_000)
igual('pulso nuevo: visto ahora', c2.estados.dani[0].actividad, t0 + 70_000)
igual('sin pulso nuevo durante más de dos minutos pasa a quieta', unirDispositivos(normalizarActividad({ dani: [payload('dani', 8)] }, c2.observados, t0 + 70_000 + QUIETA_TRAS_MS + 5000).estados, t0 + 70_000 + QUIETA_TRAS_MS + 5000)[0].estado, 'quieto')
igual('si ella misma avisa de que está quieta, quieta al momento', unirDispositivos(normalizarActividad({ dani: [payload('dani', 9, true)] }, new Map(), t0).estados, t0)[0].estado, 'quieto')
igual('lo roto (sin pulso) se ignora', Object.values(normalizarActividad({ x: [{ id: 'x' }] }, new Map(), t0).estados).flat().length, 0)

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
