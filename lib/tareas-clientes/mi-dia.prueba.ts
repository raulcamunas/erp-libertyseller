import { arrastrarPendientes, esDiaValido, limpiarPlan, MAX_PUNTOS, progresoDelPlan, repartirPorFecha, saludoDeLaHora, sugerirRevision, sumarDiasA } from '@/lib/tareas-clientes/mi-dia'

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
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

igual('no es una lista', limpiarPlan('x'), null)
const plan = limpiarPlan([{ id: 'abcdef12', texto: '  Revisar   precios ', hecho: true, tarea_id: U(1), cliente_id: 'no' }, { texto: '   ' }, { texto: 'Llamar', tarea_id: 7 }, null, 'x'])!
igual('se limpian textos, se quitan vacíos y basura', plan.map((p) => [p.texto, p.hecho, p.tarea_id, p.cliente_id]), [['Revisar precios', true, U(1), null], ['Llamar', false, null, null]])
igual('todo punto acaba con un id propio', plan.every((p) => /^[A-Za-z0-9_-]{6,40}$/.test(p.id)), true)
igual('ids repetidos se rehacen', new Set(limpiarPlan([{ id: 'abcdef12', texto: 'a' }, { id: 'abcdef12', texto: 'b' }])!.map((p) => p.id)).size, 2)
igual('tope de puntos', limpiarPlan(Array.from({ length: MAX_PUNTOS + 20 }, (_, i) => ({ texto: `p${i}` })))!.length, MAX_PUNTOS)
igual('texto largo se recorta', limpiarPlan([{ texto: 'x'.repeat(1000) }])![0].texto.length, 300)

igual('arrastrar: solo lo pendiente y sin marcar', arrastrarPendientes([{ id: 'a', texto: 'a', hecho: true, tarea_id: null, cliente_id: null }, { id: 'b', texto: 'b', hecho: false, tarea_id: U(2), cliente_id: null }]).map((p) => [p.id, p.hecho]), [['b', false]])
igual('progreso', [progresoDelPlan([]), progresoDelPlan([{ hecho: true }, { hecho: false }, { hecho: true }])], [{ total: 0, hechos: 0, porcentaje: 0 }, { total: 3, hechos: 2, porcentaje: 67 }])
igual('revisión sugerida', sugerirRevision({ puntosHechos: ['Revisar precios'], puntosPendientes: ['Llamar a Ana'], tareasCerradas: ['Revisar precios', 'Enviar informe'], comentarios: 2 }), 'Hecho hoy:\n- Revisar precios\n- Enviar informe\n\nHe escrito 2 comentarios en tareas.\n\nQueda para mañana:\n- Llamar a Ana')
igual('revisión sin nada', sugerirRevision({ puntosHechos: [], puntosPendientes: [], tareasCerradas: [], comentarios: 0 }), '')
igual('revisión: un comentario en singular', sugerirRevision({ puntosHechos: [], puntosPendientes: [], tareasCerradas: [], comentarios: 1 }), 'He escrito 1 comentario en tareas.')

// 2026-11-10 es martes: la semana acaba el domingo 15
const t = (id: string, i: string | null, f: string | null = null) => ({ id, fecha_inicio: i, fecha_fin: f })
const r = repartirPorFecha([t('v', '2026-11-03'), t('rango', '2026-11-08', '2026-11-12'), t('h', '2026-11-10'), t('s', '2026-11-13'), t('d', '2026-11-20'), t('n', null), t('v2', '2026-11-01', '2026-11-09')], '2026-11-10')
igual('reparto', { v: r.vencidas.map((x) => x.id), h: r.hoy.map((x) => x.id), s: r.semana.map((x) => x.id), d: r.despues.map((x) => x.id), n: r.sinFecha.map((x) => x.id) }, { v: ['v', 'v2'], h: ['rango', 'h'], s: ['s'], d: ['d'], n: ['n'] })
igual('días', [esDiaValido('2026-11-10'), esDiaValido('10/11/2026'), esDiaValido(5), sumarDiasA('2026-11-30', 1), sumarDiasA('2026-03-01', -1)], [true, false, false, '2026-12-01', '2026-02-28'])
igual('saludo', [saludoDeLaHora(new Date('2026-11-10T08:00:00Z')), saludoDeLaHora(new Date('2026-11-10T14:00:00Z')), saludoDeLaHora(new Date('2026-11-10T21:30:00Z')), saludoDeLaHora(new Date('2026-11-10T03:00:00Z'))], ['Buenos días', 'Buenas tardes', 'Buenas noches', 'Buenas noches'])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
