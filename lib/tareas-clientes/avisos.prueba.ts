import { destinatariosDeAsignacion, destinatariosDeComentario, mencionesEnTexto, resumen } from '@/lib/tareas-clientes/avisos'
import { estadisticasDe } from '@/lib/tareas-clientes/servidor'

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

igual('quien comenta no se avisa a sí mismo', destinatariosDeComentario({ actorId: 'a', responsables: ['a', 'b'], creadoPor: 'a', menciones: [] }), [{ userId: 'b', tipo: 'comment' }])
igual('la mención avisa como mención aunque también lleve la tarea', destinatariosDeComentario({ actorId: 'a', responsables: ['b'], creadoPor: 'c', menciones: ['b'] }), [{ userId: 'b', tipo: 'mention' }, { userId: 'c', tipo: 'comment' }])
igual('sin repetir a nadie', destinatariosDeComentario({ actorId: 'z', responsables: ['b', 'b'], creadoPor: 'b', menciones: [] }), [{ userId: 'b', tipo: 'comment' }])
igual('una asignación avisa solo a los nuevos', destinatariosDeAsignacion(['a'], ['a', 'b', 'c'], 'c'), ['b'])
igual('el texto menciona por nombre', mencionesEnTexto('Hola @Daniella y @Maria Fernanda, mirad esto', [{ id: '1', nombre: 'Daniella' }, { id: '2', nombre: 'Maria Fernanda' }, { id: '3', nombre: 'Maria' }]), ['2', '1'])
igual('un nombre que es el principio de otro no cuenta', mencionesEnTexto('@Daniellaa mira', [{ id: '1', nombre: 'Daniella' }]), [])
igual('sin arroba no hay mención', mencionesEnTexto('Daniella mira', [{ id: '1', nombre: 'Daniella' }]), [])
igual('el resumen corta y no deja saltos', resumen('a\n\n b   c', 20), 'a b c')
igual('y se pone puntos suspensivos si es largo', resumen('x'.repeat(200), 10), 'xxxxxxxxx…')

const cliente = { opciones: { estados: [{ nombre: 'Backlog', color: 'yellow' as const, grupo: 'pendiente' as const }, { nombre: 'En progreso', color: 'blue' as const, grupo: 'en_curso' as const }, { nombre: 'Completadas', color: 'green' as const, grupo: 'hecho' as const }] } }
const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
const t = (estado: string, fecha: string | null, responsables: string[] = [], archivada = false) => ({ estado, fecha_inicio: fecha, fecha_fin: null, responsables, archivada })
const e = estadisticasDe(cliente, [t('Backlog', ayer, ['a']), t('En progreso', manana, ['a', 'b']), t('En progreso', ayer, ['a']), t('Completadas', ayer, ['b']), t('Backlog', null, [], true)])
igual('cuenta por situación y no cuenta las archivadas', [e.total, e.pendientes, e.enCurso, e.hechas], [4, 1, 2, 1])
igual('vencida es lo no hecho con la fecha pasada (lo hecho no vence)', e.vencidas, 2)
igual('los que más tareas llevan, primero', e.responsables, ['a', 'b'])

console.log(`\n${comprobaciones - fallos}/${comprobaciones} bien`)
if (fallos > 0) process.exit(1)
