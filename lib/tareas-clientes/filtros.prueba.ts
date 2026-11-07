import { agruparTareas, filtrarTareas, hayFiltros, porFecha } from '@/lib/tareas-clientes/filtros'
import { FILTROS_VACIOS, type OpcionDeEstado } from '@/lib/tareas-clientes/tipos'

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

const estados: OpcionDeEstado[] = [{ nombre: 'Backlog', color: 'yellow', grupo: 'pendiente' }, { nombre: 'En progreso', color: 'blue', grupo: 'en_curso' }, { nombre: 'Completadas', color: 'green', grupo: 'hecho' }]
const t = (titulo: string, estado: string, extra: Record<string, unknown> = {}) => ({ titulo, estado, departamento: null as string | null, responsables: [] as string[], responsables_notion: [] as Array<{ id: string; nombre: string }>, etiquetas: [] as string[], cliente_id: 'c1', fecha_inicio: null as string | null, orden: 0, ...extra })
const lista = [
  t('Revisar errores de precio', 'En progreso', { departamento: 'PRICING', responsables: ['ana'] }),
  t('Enviar propuesta de márgenes', 'Completadas', { departamento: 'ANALITICA', responsables: ['ana', 'luis'] }),
  t('Llamar a soporte', 'Backlog', { responsables_notion: [{ id: 'n1', nombre: 'Carlos Externo' }] }),
  t('Plan de envío a FBA', 'En progreso', { departamento: 'PRODUCTO', cliente_id: 'c2' }),
]
const nombre = (id: string) => ({ ana: 'Ana García', luis: 'Luis' })[id] ?? id
const f = (c: Partial<typeof FILTROS_VACIOS>) => ({ ...FILTROS_VACIOS, ...c })
const titulos = (r: typeof lista) => r.map((x) => x.titulo)

igual('sin filtros, todas', filtrarTareas(lista, FILTROS_VACIOS, 'ana', estados, nombre).length, 4)
igual('la búsqueda ignora tildes y mayúsculas', titulos(filtrarTareas(lista, f({ busqueda: 'MARGENES' }), 'ana', estados, nombre)), ['Enviar propuesta de márgenes'])
igual('busca también por el nombre de quien la lleva', titulos(filtrarTareas(lista, f({ busqueda: 'garcia' }), 'ana', estados, nombre)), ['Revisar errores de precio', 'Enviar propuesta de márgenes'])
igual('y por una persona que Notion conoce y el ERP no', titulos(filtrarTareas(lista, f({ busqueda: 'externo' }), 'ana', estados, nombre)), ['Llamar a soporte'])
igual('ocultar hechas', titulos(filtrarTareas(lista, f({ ocultarHechas: true }), 'ana', estados, nombre)).includes('Enviar propuesta de márgenes'), false)
igual('solo las mías', titulos(filtrarTareas(lista, f({ soloMias: true }), 'luis', estados, nombre)), ['Enviar propuesta de márgenes'])
igual('por responsable', titulos(filtrarTareas(lista, f({ responsables: ['luis'] }), 'ana', estados, nombre)), ['Enviar propuesta de márgenes'])
igual('por departamento', titulos(filtrarTareas(lista, f({ departamentos: ['PRODUCTO', 'PRICING'] }), 'ana', estados, nombre)).length, 2)
igual('varios filtros a la vez se suman', titulos(filtrarTareas(lista, f({ departamentos: ['PRODUCTO', 'PRICING'], responsables: ['ana'] }), 'ana', estados, nombre)), ['Revisar errores de precio'])
igual('hayFiltros', [hayFiltros(FILTROS_VACIOS), hayFiltros(f({ busqueda: ' ' })), hayFiltros(f({ soloMias: true }))], [false, false, true])

const orden = { estados: ['Backlog', 'En progreso', 'Completadas'], nombreDePersona: nombre, nombreDeCliente: (id: string) => (id === 'c1' ? 'ShoesF' : 'ALP') }
igual('por estado, en el orden de las columnas', agruparTareas(lista, 'estado', orden).map((g) => `${g.nombre}:${g.tareas.length}`), ['Backlog:1', 'En progreso:2', 'Completadas:1'])
igual('por responsable, lo sin asignar al final y una tarea con dos aparece en los dos', agruparTareas(lista, 'responsable', orden).map((g) => `${g.nombre}:${g.tareas.length}`), ['Ana García:2', 'Luis:1', 'Sin asignar:2'])
igual('por cliente', agruparTareas(lista, 'cliente', orden).map((g) => g.nombre), ['ALP', 'ShoesF'])
igual('por departamento, sin departamento al final', agruparTareas(lista, 'departamento', orden).map((g) => g.nombre).slice(-1), ['Sin departamento'])
igual('por fecha, las que no tienen al final y se desempata por el sitio', porFecha([t('b', 'x', { fecha_inicio: null, orden: 1 }), t('a', 'x', { fecha_inicio: '2026-11-02', orden: 5 }), t('c', 'x', { fecha_inicio: '2026-11-02', orden: 2 })]).map((x) => x.titulo), ['c', 'a', 'b'])

console.log(`\n${comprobaciones - fallos}/${comprobaciones} bien`)
if (fallos > 0) process.exit(1)
