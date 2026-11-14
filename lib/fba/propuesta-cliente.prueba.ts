import {
  diferenciaDe,
  faseDelPortal,
  leerLineasDeseadas,
  limpiarNombreDeFirma,
  ordenarParaRevision,
  planificarCambiosDelCliente,
  planVacio,
  puntoDePropuesta,
  resumirDiferencias,
  type LineaDePropuesta,
  type ProductoDeCatalogo,
} from './propuesta-cliente'
import { quienLoHizo, tituloDeEvento, tonoDeEvento } from './historial'
import { actorDeRol } from './acceso'

let fallos = 0
const ok = (n: string, real: unknown, esp: unknown) => {
  const bien = JSON.stringify(real) === JSON.stringify(esp)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${n}${bien ? '' : ` -> esperado ${JSON.stringify(esp)}, real ${JSON.stringify(real)}`}`)
}

const linea = (sku: string, unidades: number, propuestas: number | null, nueva = false, comentario: string | null = null): LineaDePropuesta => ({
  sku,
  nombre: null,
  variante: null,
  referencia: null,
  asin: null,
  unidades,
  propuestas,
  nueva,
  comentario,
})

console.log('\n=== EN QUÉ PUNTO ESTÁ LA PROPUESTA ===')
ok('sin mandar = montando', puntoDePropuesta({ estado: 'borrador', propuestaEnviadaAt: null, clienteAceptoAt: null }), 'montando')
ok('mandada = con el cliente', puntoDePropuesta({ estado: 'borrador', propuestaEnviadaAt: '2026-11-14', clienteAceptoAt: null }), 'con_el_cliente')
ok('aceptada = pendiente de revisión, NO aprobada', puntoDePropuesta({ estado: 'borrador', propuestaEnviadaAt: '2026-11-14', clienteAceptoAt: '2026-11-14' }), 'pendiente_revision')
ok('aprobada = cerrada', puntoDePropuesta({ estado: 'aprobada', propuestaEnviadaAt: '2026-11-14', clienteAceptoAt: '2026-11-14' }), 'cerrada')

console.log('\n=== FASES DEL PORTAL ===')
ok('borrador → propuesta', faseDelPortal('borrador'), 'propuesta')
ok('aprobada → etiquetas', faseDelPortal('aprobada'), 'etiquetas')
ok('encajando → cajas', faseDelPortal('encajando'), 'cajas')
ok('lista → envío', faseDelPortal('lista'), 'envio')

console.log('\n=== DIFERENCIAS ===')
ok('igual', diferenciaDe(linea('A', 10, 10)).tipo, 'igual')
ok('más', diferenciaDe(linea('A', 12, 10)), { sku: 'A', tipo: 'mas', propuestas: 10, cliente: 12, delta: 2 })
ok('menos', diferenciaDe(linea('A', 4, 10)).tipo, 'menos')
ok('a 0 es quitada', diferenciaDe(linea('A', 0, 10)).tipo, 'quitada')
ok('añadida por el cliente es nueva', diferenciaDe(linea('N', 5, null, true)).tipo, 'nueva')
const resumen = resumirDiferencias([linea('A', 10, 10), linea('B', 12, 10), linea('C', 0, 6, false, 'no queda'), linea('N', 5, null, true)])
ok('resumen', resumen, { cambios: 3, mas: 1, menos: 0, quitadas: 1, nuevas: 1, unidadesPropuestas: 26, unidadesCliente: 27, comentarios: 1 })
ok('orden de revisión: nuevas, quitadas, cambios, iguales', ordenarParaRevision([linea('A', 10, 10), linea('B', 12, 10), linea('C', 0, 6), linea('N', 5, null, true)]).map((l) => l.sku), ['N', 'C', 'B', 'A'])

console.log('\n=== LO QUE MANDA EL CLIENTE ===')
ok('rechaza lo que no es lista', leerLineasDeseadas('hola').ok, false)
ok('rechaza duplicados', leerLineasDeseadas([{ sku: 'A', unidades: 1 }, { sku: 'A', unidades: 2 }]).ok, false)
ok('rechaza negativos', leerLineasDeseadas([{ sku: 'A', unidades: -1 }]).ok, false)
ok('rechaza decimales', leerLineasDeseadas([{ sku: 'A', unidades: 1.5 }]).ok, false)
ok('admite 0', leerLineasDeseadas([{ sku: 'A', unidades: 0 }]).ok, true)
const largo = leerLineasDeseadas([{ sku: 'A', unidades: 1, comentario: 'x'.repeat(500) }])
ok('el comentario se corta a 300', largo.ok && largo.lineas[0].comentario?.length, 300)

const catalogo = new Map<string, ProductoDeCatalogo>([['N', { sku: 'N', titulo: 'Zapatilla nueva', asin: 'B0N', fnsku: 'X00N' }]])
const actuales = [linea('A', 10, 10), linea('B', 6, 6), linea('V', 3, null, true)]

const p1 = planificarCambiosDelCliente(actuales, [{ sku: 'A', unidades: 12, comentario: null }, { sku: 'N', unidades: 4, comentario: 'urgente' }, { sku: 'V', unidades: 3, comentario: null }], catalogo)
ok('cambia A, añade N con datos de Amazon, B no viene y no se toca, V sigue', p1.ok && { a: p1.plan.actualizar, n: p1.plan.anadir, q: p1.plan.quitar }, {
  a: [{ sku: 'A', unidades: 12, comentario: null }],
  n: [{ sku: 'N', unidades: 4, comentario: 'urgente', nombre: 'Zapatilla nueva', asin: 'B0N', fnsku: 'X00N' }],
  q: [],
})
const p2 = planificarCambiosDelCliente(actuales, [{ sku: 'Z', unidades: 1, comentario: null }], catalogo)
ok('no deja añadir lo que no está en su catálogo', p2.ok, false)
const p3 = planificarCambiosDelCliente(actuales, [{ sku: 'A', unidades: 10, comentario: null }], catalogo)
ok('lo que añadió y ya no viene se quita', p3.ok && p3.plan.quitar, ['V'])
const p4 = planificarCambiosDelCliente(actuales, [{ sku: 'V', unidades: 0, comentario: null }], catalogo)
ok('lo que añadió y pone a 0 se quita', p4.ok && p4.plan.quitar, ['V'])
const p5 = planificarCambiosDelCliente(actuales, [{ sku: 'A', unidades: 0, comentario: null }, { sku: 'V', unidades: 3, comentario: null }], catalogo)
ok('lo propuesto a 0 se queda a 0 (no se borra)', p5.ok && { a: p5.plan.actualizar, q: p5.plan.quitar }, { a: [{ sku: 'A', unidades: 0, comentario: null }], q: [] })
const p6 = planificarCambiosDelCliente(actuales, [{ sku: 'A', unidades: 10, comentario: null }, { sku: 'V', unidades: 3, comentario: null }], catalogo)
ok('sin cambios = plan vacío', p6.ok && planVacio(p6.plan), true)
const p7 = planificarCambiosDelCliente(actuales, [{ sku: 'N', unidades: 0, comentario: null }, { sku: 'V', unidades: 3, comentario: null }], catalogo)
ok('un nuevo a 0 no se añade', p7.ok && p7.plan.anadir.length, 0)

console.log('\n=== FIRMA ===')
ok('nombre normal', limpiarNombreDeFirma('  Ana   García '), 'Ana García')
ok('vacío no vale', limpiarNombreDeFirma(' '), null)
ok('no texto no vale', limpiarNombreDeFirma(4), null)

console.log('\n=== HISTORIAL (textos) ===')
ok('aprobar', tituloDeEvento({ accion: 'estado', desde: 'borrador', hasta: 'aprobada', detalle: {}, veces: 1 }), 'Aprobó el envío')
ok('volver a borrador', tituloDeEvento({ accion: 'estado', desde: 'aprobada', hasta: 'borrador', detalle: {}, veces: 1 }), 'Volvió a borrador')
ok('cajas agrupadas', tituloDeEvento({ accion: 'cajas', desde: null, hasta: null, detalle: { cajas: 3 }, veces: 4 }), 'Guardó las cajas (3 cajas) · 4 guardados')
ok('aceptó con nombre', tituloDeEvento({ accion: 'propuesta_aceptada', desde: null, hasta: null, detalle: { nombre: 'Ana' }, veces: 1 }), 'Aceptó la propuesta como «Ana»')
ok('tono de aprobar', tonoDeEvento({ accion: 'estado', hasta: 'aprobada' }), 'ok')
ok('quién: enlace', quienLoHizo({ actor: 'enlace', autor: null }), 'El cliente, desde su enlace')
ok('quién: agencia con nombre', quienLoHizo({ actor: 'agencia', autor: 'Raúl' }), 'Raúl')

console.log('\n=== ACTOR POR ROL ===')
ok('admin es agencia', actorDeRol('admin'), 'agencia')
ok('employee es agencia', actorDeRol('employee'), 'agencia')
ok('cliente es cliente', actorDeRol('cliente'), 'cliente')
ok('sin rol es cliente', actorDeRol(null), 'cliente')

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
process.exit(fallos === 0 ? 0 : 1)
