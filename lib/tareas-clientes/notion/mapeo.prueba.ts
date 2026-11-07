import { aProgreso, camposDesdePagina, esquemaDe, grupoPorNombre, opcionesDe, propiedadesParaNotion } from '@/lib/tareas-clientes/notion/mapeo'
import type { DataSourceNotion, PaginaNotion } from '@/lib/tareas-clientes/notion/cliente'

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

/* La forma de la base «ALP Global» (con la errata «Resposable»), y la de una base más sencilla con selects */
const alp: DataSourceNotion = {
  id: 'ds1',
  properties: {
    Nombre: { name: 'Nombre', type: 'title' },
    Estado: {
      name: 'Estado',
      type: 'status',
      status: {
        options: [
          { id: 'o1', name: 'Backlog', color: 'yellow' },
          { id: 'o2', name: 'En progreso', color: 'blue' },
          { id: 'o3', name: 'Completadas', color: 'green' },
          { id: 'o4', name: 'Hitos', color: 'brown' },
        ],
        groups: [
          { name: 'To-do', option_ids: ['o1'] },
          { name: 'In progress', option_ids: ['o2'] },
          { name: 'Complete', option_ids: ['o3', 'o4'] },
        ],
      },
    },
    Departamento: { name: 'Departamento', type: 'select', select: { options: [{ name: 'MARKETING', color: 'green' }, { name: 'PRODUCTO', color: 'orange' }] } },
    Resposable: { name: 'Resposable', type: 'people' },
    'Fecha de inicio': { name: 'Fecha de inicio', type: 'date' },
    Progreso: { name: 'Progreso', type: 'number' },
    URL: { name: 'URL', type: 'url' },
    Checklist: { name: 'Checklist', type: 'rich_text' },
    'Archivos multimedia': { name: 'Archivos multimedia', type: 'files' },
  },
}
const simple: DataSourceNotion = {
  id: 'ds2',
  properties: {
    Tarea: { name: 'Tarea', type: 'title' },
    Status: { name: 'Status', type: 'select', select: { options: [{ name: 'Por hacer', color: 'gray' }, { name: 'Hecho', color: 'green' }] } },
    Fecha: { name: 'Fecha', type: 'date' },
  },
}

const esq = esquemaDe(alp)
igual('detecta el título, el estado y el departamento', [esq.titulo?.nombre, esq.estado?.nombre, esq.departamento?.nombre], ['Nombre', 'Estado', 'Departamento'])
igual('detecta al responsable aunque lleve la errata', esq.responsable, { nombre: 'Resposable', tipo: 'people' })
igual('la fecha, el progreso y el enlace', [esq.fecha?.nombre, esq.progreso?.nombre, esq.url?.nombre], ['Fecha de inicio', 'Progreso', 'URL'])
const esq2 = esquemaDe(simple)
igual('un select llamado Status es el estado y no el departamento', [esq2.estado?.nombre, esq2.estado?.tipo, esq2.departamento], ['Status', 'select', undefined])

const op = opcionesDe(alp, esq)
igual('los estados llevan su color y su grupo según Notion', op.estados.map((e) => `${e.nombre}:${e.color}:${e.grupo}`), ['Backlog:yellow:pendiente', 'En progreso:blue:en_curso', 'Completadas:green:hecho', 'Hitos:brown:hecho'])
igual('los departamentos llevan su color', op.departamentos, [{ nombre: 'MARKETING', color: 'green' }, { nombre: 'PRODUCTO', color: 'orange' }])
igual('un select sin grupos los deduce del nombre', opcionesDe(simple, esq2).estados.map((e) => e.grupo), ['pendiente', 'hecho'])
igual('el grupo por nombre', ['Cierres Sprint', 'Backlog', 'En revisión', 'Recurrentes'].map(grupoPorNombre), ['hecho', 'pendiente', 'en_curso', 'en_curso'])

const pagina: PaginaNotion = {
  id: 'pg1',
  url: 'https://www.notion.so/pg1',
  last_edited_time: '2026-11-05T12:09:00.000Z',
  icon: { type: 'emoji', emoji: '🚀' },
  properties: {
    Nombre: { type: 'title', title: [{ plain_text: 'Entregar el pedido ' }, { plain_text: 'al transportista' }] },
    Estado: { type: 'status', status: { name: 'En progreso', color: 'blue' } },
    Departamento: { type: 'select', select: { name: 'PRODUCTO' } },
    Resposable: { type: 'people', people: [{ id: 'u1', name: 'Daniella Villarroel' }, { id: 'u2', name: 'Alguien Externo' }] },
    'Fecha de inicio': { type: 'date', date: { start: '2026-11-05', end: null } },
    Progreso: { type: 'number', number: 0.5 },
    URL: { type: 'url', url: 'https://docs.google.com/x' },
  },
}
const personas = (id: string) => (id === 'u1' ? 'perfil-daniella' : null)
const c = camposDesdePagina(pagina, esq, personas)
igual('el título junta los trozos', c.titulo, 'Entregar el pedido al transportista')
igual('estado, departamento, icono y enlace', [c.estado, c.departamento, c.icono, c.url], ['En progreso', 'PRODUCTO', '🚀', 'https://docs.google.com/x'])
igual('la fecha de solo día no lleva hora', [c.fecha_inicio, c.fecha_con_hora], ['2026-11-05', false])
igual('el progreso en fracción pasa a porcentaje', c.progreso, 50)
igual('los enlazados van como personas del ERP y los demás se guardan aparte', [c.responsables, c.responsables_notion], [['perfil-daniella'], [{ id: 'u2', nombre: 'Alguien Externo' }]])
igual('guarda cuándo se editó en Notion, para no repetirse a sí misma', c.notion_editado, '2026-11-05T12:09:00.000Z')
igual('una página sin estado cae al de por defecto', camposDesdePagina({ ...pagina, properties: { Nombre: pagina.properties.Nombre } }, esq, personas).estado, 'Backlog')
igual('una página archivada lo dice', camposDesdePagina({ ...pagina, in_trash: true }, esq, personas).archivada, true)
igual('una fecha con hora lo dice', camposDesdePagina({ ...pagina, properties: { ...pagina.properties, 'Fecha de inicio': { type: 'date', date: { start: '2026-11-05T10:00:00.000+01:00', end: null } } } }, esq, personas).fecha_con_hora, true)
igual('el progreso se queda entre 0 y 100', [aProgreso(150), aProgreso(-3), aProgreso(null), aProgreso(42.4)], [100, 0, 0, 42])

const inverso = (id: string) => (id === 'perfil-daniella' ? 'u1' : null)
const props = propiedadesParaNotion({ estado: 'Completadas', departamento: null, responsables: ['perfil-daniella', 'sin-enlazar'], responsables_notion: [{ id: 'u2', nombre: 'Alguien Externo' }] }, esq, inverso)
igual('solo manda lo que cambió', Object.keys(props), ['Estado', 'Departamento', 'Resposable'])
igual('el estado de tipo status va como status', props.Estado, { status: { name: 'Completadas' } })
igual('quitar el departamento lo vacía', props.Departamento, { select: null })
igual('los responsables van con los enlazados y los que Notion ya tenía', props.Resposable, { people: [{ id: 'u1' }, { id: 'u2' }] })
igual('un select de estado va como select', propiedadesParaNotion({ estado: 'Hecho' }, esq2, inverso), { Status: { select: { name: 'Hecho' } } })
igual('las fechas van como rango', propiedadesParaNotion({ fecha_inicio: '2026-11-05', fecha_fin: '2026-11-09' }, esq, inverso), { 'Fecha de inicio': { date: { start: '2026-11-05', end: '2026-11-09' } } })
igual('sin fecha de inicio, la vacía', propiedadesParaNotion({ fecha_inicio: null, fecha_fin: null }, esq, inverso), { 'Fecha de inicio': { date: null } })
igual('una propiedad que esa base no tiene no se manda', propiedadesParaNotion({ progreso: 10, departamento: 'X' }, esq2, inverso), {})

console.log(`\n${comprobaciones - fallos}/${comprobaciones} bien`)
if (fallos > 0) process.exit(1)
