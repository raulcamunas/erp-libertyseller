import { cuerpoDesdePlantilla, describirRecurrencia, diaDeLaSemana, ocurrenciaPendiente, primeraFecha, recurrenciaValida, semanaIso, siguienteFecha, titularDesdePlantilla } from '@/lib/tareas-clientes/recurrencia'
import type { Bloque } from '@/lib/tareas-clientes/bloques'

let fallos = 0
let comprobaciones = 0
const igual = (n: string, a: unknown, b: unknown) => {
  comprobaciones++
  const bien = JSON.stringify(a) === JSON.stringify(b)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(a)} y no ${JSON.stringify(b)}`}`)
}

// 2026-11-08 es domingo; 2026-11-09 lunes
igual('el 8 de nov de 2026 es domingo (7)', diaDeLaSemana('2026-11-08'), 7)
igual('el 9 es lunes (1)', diaDeLaSemana('2026-11-09'), 1)

console.log('\n=== primera fecha ===')
igual('no se repite', primeraFecha({ tipo: 'ninguna' }, '2026-11-08'), null)
igual('laborable desde un domingo: el lunes', primeraFecha({ tipo: 'laborable' }, '2026-11-08'), '2026-11-09')
igual('laborable desde un miércoles: ese mismo día', primeraFecha({ tipo: 'laborable' }, '2026-11-11'), '2026-11-11')
igual('semanal los lunes desde un domingo', primeraFecha({ tipo: 'semanal', diaSemana: 1 }, '2026-11-08'), '2026-11-09')
igual('semanal los viernes desde el viernes: hoy', primeraFecha({ tipo: 'semanal', diaSemana: 5 }, '2026-11-13'), '2026-11-13')
igual('mensual el 15 desde el 8: este mes', primeraFecha({ tipo: 'mensual', diaMes: 15 }, '2026-11-08'), '2026-11-15')
igual('mensual el 5 desde el 8: el mes que viene', primeraFecha({ tipo: 'mensual', diaMes: 5 }, '2026-11-08'), '2026-12-05')
igual('mensual el 31 en abril: el 30', primeraFecha({ tipo: 'mensual', diaMes: 31 }, '2026-04-10'), '2026-04-30')
igual('mensual el 31 desde el 31 de dic: enero', primeraFecha({ tipo: 'mensual', diaMes: 5 }, '2026-12-31'), '2027-01-05')

console.log('\n=== siguiente fecha ===')
igual('laborable: del viernes al lunes', siguienteFecha({ tipo: 'laborable' }, '2026-11-13'), '2026-11-16')
igual('semanal: +7', siguienteFecha({ tipo: 'semanal', diaSemana: 1 }, '2026-11-09'), '2026-11-16')
igual('quincenal: +14', siguienteFecha({ tipo: 'quincenal', diaSemana: 1 }, '2026-11-09'), '2026-11-23')
igual('mensual: el mismo día del mes siguiente', siguienteFecha({ tipo: 'mensual', diaMes: 15 }, '2026-11-15'), '2026-12-15')
igual('mensual el 31: de enero a febrero (28)', siguienteFecha({ tipo: 'mensual', diaMes: 31 }, '2026-01-31'), '2026-02-28')
igual('mensual el 31: de febrero a marzo (31)', siguienteFecha({ tipo: 'mensual', diaMes: 31 }, '2026-02-28'), '2026-03-31')
igual('mensual: de diciembre a enero', siguienteFecha({ tipo: 'mensual', diaMes: 10 }, '2026-12-10'), '2027-01-10')

console.log('\n=== qué hay que crear hoy ===')
igual('todavía no toca', ocurrenciaPendiente({ tipo: 'semanal', diaSemana: 1 }, '2026-11-16', '2026-11-12'), null)
igual('toca hoy', ocurrenciaPendiente({ tipo: 'semanal', diaSemana: 1 }, '2026-11-09', '2026-11-09'), { ocurrencia: '2026-11-09', siguiente: '2026-11-16' })
igual('toca y se pasó un día', ocurrenciaPendiente({ tipo: 'semanal', diaSemana: 1 }, '2026-11-09', '2026-11-10'), { ocurrencia: '2026-11-09', siguiente: '2026-11-16' })
igual('tres semanas sin abrir: solo la más reciente', ocurrenciaPendiente({ tipo: 'semanal', diaSemana: 1 }, '2026-10-19', '2026-11-12'), { ocurrencia: '2026-11-09', siguiente: '2026-11-16' })
igual('laborable tras un fin de semana: el viernes no, el lunes sí', ocurrenciaPendiente({ tipo: 'laborable' }, '2026-11-13', '2026-11-16'), { ocurrencia: '2026-11-16', siguiente: '2026-11-17' })
igual('sin recurrencia nunca', ocurrenciaPendiente({ tipo: 'ninguna' }, '2026-11-01', '2026-11-12'), null)

console.log('\n=== recurrencia que llega de fuera ===')
igual('basura → ninguna', recurrenciaValida('x'), { tipo: 'ninguna' })
igual('día de la semana fuera de rango → ninguna', recurrenciaValida({ tipo: 'semanal', diaSemana: 9 }), { tipo: 'ninguna' })
igual('día del mes 0 → ninguna', recurrenciaValida({ tipo: 'mensual', diaMes: 0 }), { tipo: 'ninguna' })
igual('semanal buena', recurrenciaValida({ tipo: 'semanal', diaSemana: '3', basura: 1 }), { tipo: 'semanal', diaSemana: 3 })

console.log('\n=== título ===')
igual('semana ISO del 2026-11-09', semanaIso('2026-11-09'), 46)
igual('semana ISO del 1 de enero de 2027 (viernes: aún la 53 de 2026)', semanaIso('2027-01-01'), 53)
igual('placeholders', titularDesdePlantilla('Informe {mes} {año} (sem. {semana}) · {fecha}', '2026-11-09'), 'Informe noviembre 2026 (sem. 46) · 9 nov')
igual('sin placeholders se queda igual', titularDesdePlantilla('Reunión mensual', '2026-11-09'), 'Reunión mensual')

console.log('\n=== cuerpo ===')
const origen: Bloque[] = [
  { id: 'a', tipo: 'h1', texto: [{ t: 'Lista' }], notion_id: 'n1' },
  { id: 'b', tipo: 'tarea', texto: [{ t: 'Paso' }], hecho: true, notion_id: 'n2' },
  { id: 'c', tipo: 'notion', texto: [], notion_tipo: 'table', vista: 'Tabla', notion_id: 'n3' },
  { id: 'd', tipo: 'imagen', texto: [], notion_id: 'n4' },
  { id: 'e', tipo: 'imagen', texto: [], url: 'https://x/y.png' },
]
const nuevo = cuerpoDesdePlantilla(origen)
igual('se quitan las tablas ajenas y las imágenes sin dirección', nuevo.map((b) => b.tipo), ['h1', 'tarea', 'imagen'])
igual('ningún bloque conserva su huella de Notion', nuevo.some((b) => 'notion_id' in b || 'notion_tipo' in b), false)
igual('las casillas salen sin marcar', nuevo[1].hecho, false)
igual('los identificadores son nuevos y distintos', new Set(nuevo.map((b) => b.id)).size === 3 && !nuevo.some((b) => ['a', 'b', 'e'].includes(b.id)), true)
igual('el original no se toca', origen[1].hecho, true)

console.log('\n=== con palabras ===')
igual('semanal', describirRecurrencia({ tipo: 'semanal', diaSemana: 1 }), 'Cada lunes')
igual('mensual', describirRecurrencia({ tipo: 'mensual', diaMes: 5 }), 'El día 5 de cada mes')

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones`)
if (fallos > 0) process.exit(1)
