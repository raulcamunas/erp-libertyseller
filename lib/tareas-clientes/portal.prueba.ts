import { armarPanel, FORMA_DE_TOKEN_DEL_PORTAL, MAX_HECHAS_EN_EL_PORTAL, paraElCliente, type FilaParaElPortal } from '@/lib/tareas-clientes/portal'
import type { ClienteTC } from '@/lib/tareas-clientes/tipos'

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

const cliente = { nombre: 'ShoesF', icono: '👟', opciones: { estados: [{ nombre: 'Backlog', color: 'yellow', grupo: 'pendiente' }, { nombre: 'En progreso', color: 'blue', grupo: 'en_curso' }, { nombre: 'Completadas', color: 'green', grupo: 'hecho' }] } } as unknown as ClienteTC
const fila = (id: string, estado: string, extra: Partial<FilaParaElPortal> = {}): FilaParaElPortal => ({ id, titulo: `T${id}`, icono: null, estado, departamento: null, fecha_inicio: null, fecha_fin: null, progreso: 0, actualizado_en: `2026-11-0${id}T10:00:00Z`, ...extra })

// Lista blanca: aunque la fila traiga más cosas, no salen
const sucia = { ...fila('1', 'En progreso'), contenido: [{ texto: 'SECRETO' }], responsables: ['u1'], notion_url: 'https://notion.so/x', contenido_texto: 'SECRETO', comentarios: 3 } as unknown as FilaParaElPortal
const salida = paraElCliente(sucia, [])
igual('solo salen los campos permitidos', Object.keys(salida).sort(), ['actualizada', 'departamento', 'estado', 'fase', 'fecha_fin', 'fecha_inicio', 'icono', 'id', 'progreso', 'titulo'])
igual('ni rastro del cuerpo en el JSON', JSON.stringify(salida).includes('SECRETO') || JSON.stringify(salida).includes('notion.so'), false)

igual('la fase sale del grupo del estado', ['Backlog', 'En progreso', 'Completadas', 'Desconocido'].map((e) => paraElCliente(fila('1', e), (cliente.opciones as unknown as { estados: never[] }).estados).fase), ['pendiente', 'en_curso', 'hecho', 'pendiente'])
igual('una hecha está al 100 aunque diga otra cosa', paraElCliente(fila('1', 'Completadas', { progreso: 20 }), (cliente.opciones as unknown as { estados: never[] }).estados).progreso, 100)
igual('con casillas manda la cuenta', paraElCliente(fila('1', 'En progreso', { progreso: 90, checklist_total: 4, checklist_hecho: 1 }), (cliente.opciones as unknown as { estados: never[] }).estados).progreso, 25)
igual('el progreso se queda entre 0 y 100', [paraElCliente(fila('1', 'x', { progreso: 250 }), []).progreso, paraElCliente(fila('1', 'x', { progreso: -5 }), []).progreso], [100, 0])
igual('sin título', paraElCliente(fila('1', 'x', { titulo: '   ' }), []).titulo, 'Tarea sin título')
igual('las fechas van sin hora', paraElCliente(fila('1', 'x', { fecha_inicio: '2026-11-20T10:00:00Z' }), []).fecha_inicio, '2026-11-20')

const panel = armarPanel(cliente, [
  fila('1', 'En progreso', { fecha_fin: '2026-11-30' }),
  fila('2', 'En progreso', { fecha_fin: '2026-11-10' }),
  fila('3', 'En progreso'),
  fila('4', 'Backlog'),
  fila('5', 'Completadas'),
  fila('6', 'Completadas'),
])
igual('en curso: primero las que tienen fecha, la más cercana antes', panel.enCurso.map((t) => t.id), ['2', '1', '3'])
igual('pendientes y hechas (las más recientes primero)', [panel.pendientes.map((t) => t.id), panel.hechas.map((t) => t.id), panel.totalHechas], [['4'], ['6', '5'], 2])
igual('el cliente se llama como se llama', panel.cliente, { nombre: 'ShoesF', icono: '👟' })
const muchas = armarPanel(cliente, Array.from({ length: MAX_HECHAS_EN_EL_PORTAL + 20 }, (_, i) => fila(String(i), 'Completadas', { actualizado_en: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() })))
igual('de las hechas solo las más recientes', [muchas.hechas.length, muchas.totalHechas], [MAX_HECHAS_EN_EL_PORTAL, MAX_HECHAS_EN_EL_PORTAL + 20])
igual('forma del token', [FORMA_DE_TOKEN_DEL_PORTAL.test('a'.repeat(43)), FORMA_DE_TOKEN_DEL_PORTAL.test('a'.repeat(42)), FORMA_DE_TOKEN_DEL_PORTAL.test(`${'a'.repeat(42)}/`)], [true, false, false])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
