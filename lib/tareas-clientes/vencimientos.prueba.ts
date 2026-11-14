import { avisosDeFecha, type TareaConFecha } from '@/lib/tareas-clientes/vencimientos'

let fallos = 0
let comprobaciones = 0
const igual = (n: string, a: unknown, b: unknown) => {
  comprobaciones++
  const bien = JSON.stringify(a) === JSON.stringify(b)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(a)} y no ${JSON.stringify(b)}`}`)
}

const t = (id: string, fin: string | null, inicio: string | null = null, titulo = `Tarea ${id}`): TareaConFecha => ({ id, cliente_id: 'c1', titulo, fecha_inicio: inicio, fecha_fin: fin })
const HOY = '2026-11-08'

igual('sin fechas no hay avisos', avisosDeFecha([t('a', null)], HOY), [])
igual('lejana no avisa', avisosDeFecha([t('a', '2026-11-20')], HOY), [])
igual('vence hoy', avisosDeFecha([t('a', '2026-11-08')], HOY).map((x) => [x.tipo, x.titulo, x.clave]), [['tarea_vence', 'Vence hoy', 'tc-vence:a:2026-11-08:hoy']])
igual('vence mañana', avisosDeFecha([t('a', '2026-11-09T10:00:00Z')], HOY).map((x) => x.titulo), ['Vence mañana'])
igual('sin fin se mira el inicio', avisosDeFecha([t('a', null, '2026-11-08')], HOY).map((x) => x.titulo), ['Vence hoy'])
igual('mañana cruzando de mes', avisosDeFecha([t('a', '2026-12-01')], '2026-11-30').map((x) => x.titulo), ['Vence mañana'])
const nueve = Array.from({ length: 9 }, (_, i) => t(`v${i}`, `2026-10-0${(i % 9) + 1}`))
const r = avisosDeFecha(nueve, HOY)
igual('nueve vencidas = un solo aviso', r.length, 1)
igual('el resumen dice cuántas', r[0].titulo, 'Tienes 9 tareas vencidas')
igual('la clave del resumen es del día', r[0].clave, 'tc-vencidas:2026-11-08')
igual('una vencida, en singular', avisosDeFecha([t('a', '2026-11-01', null, 'Informe')], HOY).map((x) => [x.titulo, x.mensaje]), [['Tienes 1 tarea vencida', 'Informe']])
igual('mezcla: hoy + resumen', avisosDeFecha([t('a', '2026-11-08'), t('b', '2026-11-01')], HOY).map((x) => x.tipo), ['tarea_vence', 'tarea_vencidas'])
igual('sin título', avisosDeFecha([t('a', '2026-11-08', null, '  ')], HOY)[0].mensaje, 'Tarea sin título')

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones`)
if (fallos > 0) process.exit(1)
