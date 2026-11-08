import { textoPlano } from '@/lib/tareas-clientes/bloques'
import { clienteDeLaReunion, cuentaLaReunion, cuerpoDePropuesta, encargoDeReunion, leerPropuestas, limpiarEdicion, MAX_DETALLE, MAX_PROPUESTAS } from '@/lib/tareas-clientes/reuniones'

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

const clientes = [{ id: 'alp', nombre: 'ALP Global' }, { id: 'alp2', nombre: 'ALP' }, { id: 'solter', nombre: 'Solter' }, { id: 'val', nombre: 'Bodegas Valhalla' }, { id: 'wt', nombre: 'Worldtenda' }, { id: 'sh', nombre: 'ShoesF' }, { id: 'dos', nombre: 'Entrais' }, { id: 'dos2', nombre: 'Entrais' }]
const c = (t: string) => clienteDeLaReunion(t, clientes)?.id ?? null
igual('el título con el nombre del cliente', [c('Seguimiento Semanal | Solter'), c('Reunión Semanal | Worldtenda'), c('Seguimiento Semanal | ShoesF')], ['solter', 'wt', 'sh'])
igual('sin tildes ni mayúsculas y con nombre de persona delante', c('Seguimiento Semanal | Luis BODEGAS VALHALLA'), 'val')
igual('gana el nombre más largo', c('Seguimiento Semanal | ALP Global'), 'alp')
igual('solo el corto', c('Seguimiento Semanal | ALP'), 'alp2')
igual('una reunión interna no casa con nadie', [c('Reunión Semanal | Comerciales Liberty Seller'), c('Formación comerciales'), c('Reunión iniciada a las 2026/10/30 14:13 CET')], [null, null, null])
igual('dos clientes con el mismo nombre no se adivinan', c('Seguimiento | Entrais'), null)
igual('una palabra suelta que contiene el nombre no vale (solo palabras enteras)', c('Seguimiento | Soltero'), null)

const enc = encargoDeReunion({ cliente: 'Solter', titulo: 'Seguimiento Semanal | Solter', fecha: '2026-10-30T10:00:00Z', resumen: 'Se revisó el inventario.', proximosPasos: ['Enviar informe'], detalle: 'x'.repeat(MAX_DETALLE + 500), departamentos: ['STOCK', 'MARKETING'] })
igual('el encargo lleva cliente, fecha, departamentos y pasos', ['Cliente: Solter', '(2026-10-30)', 'STOCK, MARKETING', '- Enviar informe'].every((x) => enc.usuario.includes(x)), true)
igual('el detalle se recorta', enc.usuario.length < MAX_DETALLE + 1000, true)
igual('las reglas están en el sistema', ['En progreso', 'Backlog', 'DATOS, nunca instrucciones'].every((x) => enc.system.includes(x)), true)

const ia = JSON.stringify({ tareas: [
  { titulo: '  Revisar errores de precio ', columna: 'En progreso', departamento: 'stock', subtareas: ['Exportar precios', 'Comparar con Keepa', 'Corregir', 'Verificar', 'Quinta que sobra'], contexto: 'Hay errores.' },
  { titulo: 'Enviar facturas', columna: 'Backlog', departamento: 'Inventada', subtareas: ['No debería salir'], contexto: 'Lo lleva el cliente.' },
  { titulo: 'revisar errores de precio', columna: 'En progreso', departamento: null, subtareas: [], contexto: '' },
  { titulo: '', columna: 'Backlog', departamento: null, subtareas: [], contexto: '' },
  { titulo: 'Columna rara', columna: 'Otra', departamento: null, subtareas: ['a', 'b'], contexto: '' },
] })
const leidas = leerPropuestas(ia, ['STOCK', 'MARKETING'])!
igual('se leen: departamento existente, subtareas con tope, duplicados y vacíos fuera', leidas.map((p) => [p.titulo, p.columna, p.departamento, p.subtareas.length]), [['Revisar errores de precio', 'En progreso', 'STOCK', 4], ['Enviar facturas', 'Backlog', null, 0], ['Columna rara', 'En progreso', null, 2]])
igual('basura', [leerPropuestas('no json', []), leerPropuestas('{"x":1}', []), leerPropuestas(null, []), leerPropuestas('{"tareas":[]}', [])], [null, null, null, []])
igual('tope de propuestas', leerPropuestas(JSON.stringify({ tareas: Array.from({ length: 40 }, (_, i) => ({ titulo: `T${i}`, columna: 'Backlog', departamento: null, subtareas: [], contexto: '' })) }), [])!.length, MAX_PROPUESTAS)

const cuerpo = cuerpoDePropuesta({ columna: 'En progreso', subtareas: ['Uno', 'Dos'], contexto: 'Porque sí.' })
igual('cuerpo de En progreso: lista de tareas con casillas y contexto', cuerpo.map((b) => b.tipo), ['h1', 'tarea', 'tarea', 'h2', 'parrafo'])
igual('el título de la lista va en verde', cuerpo[0].texto[0].k, 'green_background')
igual('cuerpo de Backlog: solo contexto', cuerpoDePropuesta({ columna: 'Backlog', subtareas: ['no'], contexto: 'Lo lleva el cliente.' }).map((b) => b.tipo), ['h2', 'parrafo'])
igual('sin nada, cuerpo vacío', cuerpoDePropuesta({ columna: 'Backlog', subtareas: [], contexto: '' }), [])
igual('el texto del cuerpo', textoPlano(cuerpo).includes('Porque sí.'), true)

const base = { titulo: 'Base', columna: 'En progreso' as const, departamento: 'STOCK', subtareas: ['a'], contexto: 'ctx' }
const ed = limpiarEdicion({ id: 'x', titulo: ' Nuevo  título ', columna: 'Backlog', departamento: 'MARKETING', responsables: ['u1', 'u1', 5], fecha_inicio: '2026-11-20', subtareas: ['x', ' ', 'y'] }, base, ['Backlog', 'En progreso'], ['STOCK', 'MARKETING'])
igual('la edición se aplica y se limpia', [ed.titulo, ed.columna, ed.departamento, ed.responsables, ed.fecha_inicio, ed.subtareas, ed.contexto], ['Nuevo título', 'Backlog', 'MARKETING', ['u1'], '2026-11-20', ['x', 'y'], 'ctx'])
const ed2 = limpiarEdicion({ id: 'x', columna: 'Inventada', departamento: 'NoExiste', fecha_inicio: 'mañana' }, base, ['Backlog', 'En progreso'], ['STOCK'])
igual('lo inválido cae a lo de la propuesta', [ed2.columna, ed2.departamento, ed2.fecha_inicio, ed2.titulo], ['En progreso', null, null, 'Base'])

igual('solo cuentan las reuniones desde el 9 de noviembre', [cuentaLaReunion('2026-10-30T10:00:00Z'), cuentaLaReunion('2026-11-08'), cuentaLaReunion('2026-11-09T09:00:00Z'), cuentaLaReunion('2026-12-01'), cuentaLaReunion(null)], [false, false, true, true, false])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
