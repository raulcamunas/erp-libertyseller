import { cumpleFecha, filtrarTareas, hayFiltros, semanaDe } from '@/lib/tareas-clientes/filtros'
import { FILTROS_VACIOS, type OpcionDeEstado } from '@/lib/tareas-clientes/tipos'
import { configDeFiltros, filtrosDeConfig, filtrosDePredefinida, mismosFiltros, nombreDeVista, vistaDeConfig, VISTAS_PREDEFINIDAS } from '@/lib/tareas-clientes/vistas-guardadas'

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

// 2026-11-08 es domingo: su semana va del lunes 2 al domingo 8
const HOY = '2026-11-08'
igual('la semana de un domingo es la que acaba en él', semanaDe(HOY), { lunes: '2026-11-02', domingo: '2026-11-08' })
igual('la semana de un lunes empieza en él', semanaDe('2026-11-09'), { lunes: '2026-11-09', domingo: '2026-11-15' })

const t = (inicio: string | null, fin: string | null = null) => ({ fecha_inicio: inicio, fecha_fin: fin })
igual('vencida: acabó ayer y no está hecha', cumpleFecha(t('2026-11-07'), 'vencidas', HOY, false), true)
igual('una hecha no vence', cumpleFecha(t('2026-11-07'), 'vencidas', HOY, true), false)
igual('la de hoy no está vencida', cumpleFecha(t('2026-11-08'), 'vencidas', HOY, false), false)
igual('con rango, vence cuando acaba el rango', [cumpleFecha(t('2026-11-01', '2026-11-09'), 'vencidas', HOY, false), cumpleFecha(t('2026-11-01', '2026-11-07'), 'vencidas', HOY, false)], [false, true])
igual('hoy: dentro de su rango', [cumpleFecha(t('2026-11-05', '2026-11-10'), 'hoy', HOY, false), cumpleFecha(t('2026-11-09'), 'hoy', HOY, false)], [true, false])
igual('esta semana: la que solapa aunque empiece antes', [cumpleFecha(t('2026-10-30', '2026-11-03'), 'semana', HOY, false), cumpleFecha(t('2026-11-09'), 'semana', HOY, false), cumpleFecha(t('2026-11-02'), 'semana', HOY, false)], [true, false, true])
igual('sin fecha', [cumpleFecha(t(null), 'sin_fecha', HOY, false), cumpleFecha(t('2026-11-08'), 'sin_fecha', HOY, false), cumpleFecha(t(null), 'vencidas', HOY, false)], [true, false, false])

const estados: OpcionDeEstado[] = [{ nombre: 'En progreso', color: 'blue', grupo: 'en_curso' }, { nombre: 'Completadas', color: 'green', grupo: 'hecho' }]
const tarea = (titulo: string, estado: string, responsables: string[], inicio: string | null, fin: string | null = null) => ({ titulo, estado, departamento: null as string | null, responsables, responsables_notion: [] as Array<{ id: string; nombre: string }>, etiquetas: [] as string[], fecha_inicio: inicio, fecha_fin: fin })
const lista = [
  tarea('A vencida mía', 'En progreso', ['yo'], '2026-11-03'),
  tarea('B vencida de otro', 'En progreso', ['otro'], '2026-11-03'),
  tarea('C hecha antigua mía', 'Completadas', ['yo'], '2026-11-01'),
  tarea('D de esta semana, sin dueño', 'En progreso', [], '2026-11-08'),
  tarea('E sin fecha, mía', 'En progreso', ['yo'], null),
]
const titulos = (id: string) => filtrarTareas(lista, filtrosDePredefinida(VISTAS_PREDEFINIDAS.find((v) => v.id === id)!), 'yo', estados, (x) => x, HOY).map((x) => x.titulo[0])
igual('«Mis vencidas»', titulos('mis-vencidas'), ['A'])
igual('«Vencidas (todo el equipo)»', titulos('vencidas'), ['A', 'B'])
igual('«Sin responsable»', titulos('sin-responsable'), ['D'])
igual('«Sin fecha»', titulos('sin-fecha'), ['E'])
igual('«Esta semana» esconde las hechas', titulos('esta-semana'), ['A', 'B', 'D'])
igual('«Mi semana»', titulos('mi-semana'), ['A'])
igual('todas las predefinidas ponen algún filtro', VISTAS_PREDEFINIDAS.every((v) => hayFiltros(filtrosDePredefinida(v))), true)

// Guardar y recuperar
const puestos = { ...FILTROS_VACIOS, soloMias: true, fecha: 'vencidas' as const, departamentos: ['PRICING'] }
const guardado = configDeFiltros(puestos, 'tabla')
igual('solo se guarda lo que no es de por defecto', guardado, { filtros: { departamentos: ['PRICING'], soloMias: true, fecha: 'vencidas' }, vista: 'tabla' })
igual('guardar y leer devuelve los mismos filtros', filtrosDeConfig(JSON.parse(JSON.stringify(guardado))), puestos)
igual('el modo de mirar', vistaDeConfig(guardado), 'tabla')
igual('un modo desconocido se ignora', vistaDeConfig({ vista: 'galeria' }), undefined)
igual('JSON basura → filtros vacíos', filtrosDeConfig('hola'), FILTROS_VACIOS)
igual('valores raros se ignoran', filtrosDeConfig({ filtros: { fecha: 'ayer', agruparPor: 'color', responsables: [1, 'x', 'x', ''], soloMias: 'sí' } }), { ...FILTROS_VACIOS, responsables: ['x'] })
igual('se reconoce la vista puesta', [mismosFiltros(puestos, filtrosDeConfig(guardado)), mismosFiltros(puestos, FILTROS_VACIOS)], [true, false])
igual('el nombre se limpia', [nombreDeVista('  Mis   vencidas '), nombreDeVista('   '), nombreDeVista('x'.repeat(61)), nombreDeVista(3)], ['Mis vencidas', null, null, null])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
