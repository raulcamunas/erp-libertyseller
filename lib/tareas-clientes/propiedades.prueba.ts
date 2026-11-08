import { comoTexto, limpiarValor, mezclarPropiedades, type PropiedadExtra } from '@/lib/tareas-clientes/propiedades'

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

const e = (nombre: string, tipo: PropiedadExtra['tipo']): PropiedadExtra => ({ nombre, tipo })
igual('checkbox', [limpiarValor(e('a', 'checkbox'), true), limpiarValor(e('a', 'checkbox'), 'sí')], [true, undefined])
igual('número: texto numérico, vacío y basura', [limpiarValor(e('a', 'number'), '12,5'), limpiarValor(e('a', 'number'), '12.5'), limpiarValor(e('a', 'number'), ''), limpiarValor(e('a', 'number'), 'x')], [undefined, 12.5, null, undefined])
igual('select', [limpiarValor(e('a', 'select'), ' Alta '), limpiarValor(e('a', 'select'), null), limpiarValor(e('a', 'select'), 5)], ['Alta', null, undefined])
igual('multi_select sin repetidos ni vacíos', limpiarValor(e('a', 'multi_select'), ['x', ' x ', 'y']), ['x', 'y'])
igual('multi_select con algo que no es texto', limpiarValor(e('a', 'multi_select'), ['x', 3]), undefined)
igual('url exige http(s)', [limpiarValor(e('a', 'url'), 'https://x.es/a'), limpiarValor(e('a', 'url'), 'javascript:alert(1)'), limpiarValor(e('a', 'url'), '')], ['https://x.es/a', undefined, null])
igual('email', [limpiarValor(e('a', 'email'), 'a@b.es'), limpiarValor(e('a', 'email'), 'a@b')], ['a@b.es', undefined])
igual('texto largo se recorta', (limpiarValor(e('a', 'rich_text'), 'x'.repeat(5000)) as string).length, 2000)
igual('fecha con y sin fin, y absurda', [limpiarValor(e('a', 'date'), { start: '2026-11-20' }), limpiarValor(e('a', 'date'), { start: '2026-11-20', end: '2026-11-25' }), limpiarValor(e('a', 'date'), { start: '2026-11-20', end: '2026-11-10' }), limpiarValor(e('a', 'date'), { start: 'mañana' })], [{ start: '2026-11-20', end: null }, { start: '2026-11-20', end: '2026-11-25' }, undefined, undefined])

const extras = [e('Prioridad', 'select'), e('Horas', 'number'), e('Revisado', 'checkbox')]
const r = mezclarPropiedades({ Horas: 3, Revisado: true }, extras, { Prioridad: 'Alta', Horas: 3 })
igual('mezclar: conserva lo anterior y apunta solo lo que cambió', r, { ok: true, valores: { Prioridad: 'Alta', Horas: 3, Revisado: true }, cambiadas: ['Revisado'] })
igual('mezclar: una propiedad que el cliente no tiene se rechaza', mezclarPropiedades({ Inventada: 1 }, extras, {}).ok, false)
igual('mezclar: un valor malo rechaza todo', mezclarPropiedades({ Horas: 'x', Revisado: true }, extras, {}).ok, false)
igual('mezclar: no es un objeto', mezclarPropiedades([1], extras, {}).ok, false)
igual('mezclar: sin nada anterior', mezclarPropiedades({ Prioridad: 'Baja' }, extras, null), { ok: true, valores: { Prioridad: 'Baja' }, cambiadas: ['Prioridad'] })
igual('como texto', [comoTexto(e('a', 'checkbox'), true), comoTexto(e('a', 'multi_select'), ['x', 'y']), comoTexto(e('a', 'date'), { start: '2026-11-20T10:00:00Z', end: '2026-11-22' }), comoTexto(e('a', 'select'), null)], ['Sí', 'x, y', '2026-11-20 → 2026-11-22', ''])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
