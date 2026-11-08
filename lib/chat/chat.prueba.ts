import { filasDeMensajes, conMensaje, diaDe, etiquetaDeDia } from '@/lib/chat/agrupar'
import { claveDeDirecto, nombreVisible, normalizarNombreDeCanal, repartirCanales, totalSinLeer } from '@/lib/chat/canales'
import { aTextoEditable, cuerpoValido, CUERPO_MAX, desdeTextoEditable, extraerMenciones, limpiarCuerpo, partirCuerpo, textoPlano, tokenDeMencion } from '@/lib/chat/mensajes'
import type { MensajeChat } from '@/lib/chat/tipos'

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

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

// Canales
igual('la clave de un directo es la misma pregunte quien pregunte', claveDeDirecto(A, B) === claveDeDirecto(B, A), true)
igual('nombres de canal', [normalizarNombreDeCanal('#Ventas España'), normalizarNombreDeCanal('  general  '), normalizarNombreDeCanal('a__b--c'), normalizarNombreDeCanal('###'), normalizarNombreDeCanal(7), normalizarNombreDeCanal('¡Hola! ¿Qué tal?')], ['ventas-españa', 'general', 'a__b-c', null, null, 'hola-qué-tal'])
igual('un nombre largo se corta a 40', normalizarNombreDeCanal('x'.repeat(100))?.length, 40)
const personas = new Map([[A, { id: A, nombre: 'Ana', email: null }], [B, { id: B, nombre: 'Beto', email: null }]])
igual('nombre de un directo = la otra persona', [nombreVisible({ tipo: 'directo', nombre: null, miembros: [A, B] }, A, personas), nombreVisible({ tipo: 'canal', nombre: 'ventas', miembros: [] }, A, personas), nombreVisible({ tipo: 'directo', nombre: null, miembros: [A] }, A, personas)], ['Beto', 'ventas', 'Alguien del equipo'])
const base = { archivado: false, creado_en: '2026-11-01T10:00:00Z' }
const reparto = repartirCanales([
  { ...base, tipo: 'canal' as const, nombre: 'b', soy_miembro: true, ultimo_mensaje_en: null },
  { ...base, tipo: 'canal' as const, nombre: 'a', soy_miembro: true, ultimo_mensaje_en: null },
  { ...base, tipo: 'privado' as const, nombre: 'c', soy_miembro: true, ultimo_mensaje_en: null },
  { ...base, tipo: 'directo' as const, nombre: null, soy_miembro: true, ultimo_mensaje_en: '2026-11-05T10:00:00Z' },
  { ...base, tipo: 'directo' as const, nombre: null, soy_miembro: true, ultimo_mensaje_en: '2026-11-07T10:00:00Z' },
  { ...base, tipo: 'canal' as const, nombre: 'zeta', soy_miembro: false, ultimo_mensaje_en: null },
  { ...base, archivado: true, tipo: 'canal' as const, nombre: 'viejo', soy_miembro: true, ultimo_mensaje_en: null },
])
igual('reparto de la barra', [reparto.canales.map((c) => c.nombre), reparto.directos.map((c) => c.ultimo_mensaje_en?.slice(0, 10)), reparto.sinUnirme.map((c) => c.nombre)], [['a', 'b', 'c'], ['2026-11-07', '2026-11-05'], ['zeta']])
igual('sin leer: un canal silenciado no cuenta, salvo menciones', totalSinLeer([
  { soy_miembro: true, silenciado: false, no_leidos: 3, menciones: 1, archivado: false },
  { soy_miembro: true, silenciado: true, no_leidos: 9, menciones: 2, archivado: false },
  { soy_miembro: false, silenciado: false, no_leidos: 5, menciones: 5, archivado: false },
]), { mensajes: 3, menciones: 3 })

// Texto
igual('limpiar el cuerpo', [limpiarCuerpo('  hola \r\n\r\n\r\n\r\n\r\nque tal  '), limpiarCuerpo(5), limpiarCuerpo('\u0000a\u0007')], ['hola\n\n\nque tal', '', 'a'])
igual('largo máximo', [cuerpoValido('x'.repeat(CUERPO_MAX)), cuerpoValido('x'.repeat(CUERPO_MAX + 1))], [true, false])
igual('menciones sin repetir', extraerMenciones(`hola ${tokenDeMencion(A)} y ${tokenDeMencion(B)} y otra vez ${tokenDeMencion(A)} <@no-es-id>`), [A, B])
igual('trozos', partirCuerpo(`Mira **esto** _ahora_ \`x=1\` ${tokenDeMencion(A)} https://a.es/b.`), [
  { t: 'texto', v: 'Mira ' }, { t: 'negrita', v: 'esto' }, { t: 'texto', v: ' ' }, { t: 'cursiva', v: 'ahora' }, { t: 'texto', v: ' ' }, { t: 'codigo', v: 'x=1' }, { t: 'texto', v: ' ' },
  { t: 'mencion', id: A }, { t: 'texto', v: ' ' }, { t: 'enlace', v: 'https://a.es/b', url: 'https://a.es/b' }, { t: 'texto', v: '.' },
])
igual('un bloque de código', partirCuerpo('antes\n```\nlinea\n```\ndespués'), [{ t: 'texto', v: 'antes\n' }, { t: 'bloque', v: 'linea' }, { t: 'texto', v: '\ndespués' }])
igual('el HTML se queda como texto', partirCuerpo('<b>hola</b> <script>x</script>'), [{ t: 'texto', v: '<b>hola</b> <script>x</script>' }])
igual('una_variable_con_guiones no es cursiva', partirCuerpo('mi_variable_larga'), [{ t: 'texto', v: 'mi_variable_larga' }])
igual('texto plano de una vista previa', textoPlano(`**Hola** ${tokenDeMencion(A)} mira https://a.es`, (id) => (id === A ? 'Ana' : '?')), 'Hola @Ana mira https://a.es')
igual('texto plano se corta', textoPlano('x'.repeat(200), () => '', 20).length, 20)

const editable = aTextoEditable(`Hola ${tokenDeMencion(A)} y ${tokenDeMencion(B)}`, (id) => (id === A ? 'Ana María' : 'Ana'))
igual('al editar se ve @Nombre', editable.texto, 'Hola @Ana María y @Ana')
igual('y al guardar vuelven los identificadores, sin confundir Ana con Ana María', desdeTextoEditable(editable.texto, editable.mencionados), `Hola ${tokenDeMencion(A)} y ${tokenDeMencion(B)}`)
igual('una mención que se borró del texto no deja rastro, y @Anabel no es @Ana', desdeTextoEditable('hola @Anabel', [{ id: B, nombre: 'Ana' }]), 'hola @Anabel')
igual('un nombre con paréntesis no rompe nada', desdeTextoEditable('hola @Ana (la jefa)', [{ id: A, nombre: 'Ana (la jefa)' }]), `hola ${tokenDeMencion(A)}`)

// Agrupar
const ms = (id: number, autor: string | null, iso: string, extra: Partial<MensajeChat> = {}): MensajeChat => ({ id, canal_id: 'c', autor_id: autor, cuerpo: 'x', hilo_de: null, cita: null, menciones: [], adjuntos: [], editado_en: null, fijado_en: null, borrado_en: null, creado_en: iso, reacciones: {}, respuestas: 0, ...extra })
const AHORA = Date.parse('2026-11-08T12:00:00Z')
igual('día en hora de España', [diaDe('2026-11-08T23:30:00Z'), diaDe('2026-11-08T10:00:00Z')], ['2026-11-09', '2026-11-08'])
igual('etiquetas de día', [etiquetaDeDia('2026-11-08T10:00:00Z', AHORA), etiquetaDeDia('2026-11-07T10:00:00Z', AHORA), etiquetaDeDia('2026-11-02T10:00:00Z', AHORA), etiquetaDeDia('2025-11-02T10:00:00Z', AHORA)], ['Hoy', 'Ayer', 'Lunes, 2 de noviembre', 'Domingo, 2 de noviembre de 2025'])
const filas = filasDeMensajes([
  ms(1, A, '2026-11-07T10:00:00Z'), ms(2, A, '2026-11-07T10:02:00Z'), ms(3, B, '2026-11-07T10:03:00Z'), ms(4, A, '2026-11-07T10:30:00Z'), ms(5, A, '2026-11-08T09:00:00Z'), ms(6, B, '2026-11-08T09:01:00Z', { hilo_de: 5 }),
], { yo: A, ultimoLeidoEn: null, ahora: AHORA })
igual('filas: días y rachas (las respuestas de hilo no salen)', filas.map((f) => (f.tipo === 'dia' ? `dia:${f.etiqueta}` : f.tipo === 'mensaje' ? `${f.mensaje.id}${f.continuacion ? '+' : ''}` : f.tipo)), ['dia:Ayer', '1', '2+', '3', '4', 'dia:Hoy', '5'])
const conNuevos = filasDeMensajes([ms(1, B, '2026-11-07T10:00:00Z'), ms(2, B, '2026-11-07T11:00:00Z'), ms(3, A, '2026-11-07T11:05:00Z'), ms(4, B, '2026-11-07T11:10:00Z')], { yo: A, ultimoLeidoEn: '2026-11-07T10:30:00Z', ahora: AHORA })
igual('la marca «Nuevos» va antes del primer mensaje ajeno sin leer', conNuevos.map((f) => (f.tipo === 'mensaje' ? String(f.mensaje.id) : f.tipo)), ['dia', '1', 'nuevos', '2', '3', '4'])
igual('un borrado rompe la racha', filasDeMensajes([ms(1, A, '2026-11-07T10:00:00Z', { borrado_en: '2026-11-07T10:01:00Z' }), ms(2, A, '2026-11-07T10:02:00Z')], { yo: B, ultimoLeidoEn: null, ahora: AHORA }).filter((f) => f.tipo === 'mensaje').map((f) => (f.tipo === 'mensaje' ? f.continuacion : null)), [false, false])
igual('un mensaje que llega dos veces no se repite y queda ordenado', conMensaje(conMensaje([ms(1, A, '2026-11-07T10:00:00Z'), ms(3, A, '2026-11-07T10:05:00Z')], ms(2, B, '2026-11-07T10:02:00Z')), ms(2, B, '2026-11-07T10:02:00Z', { cuerpo: 'editado' })).map((m) => `${m.id}:${m.cuerpo}`), ['1:x', '2:editado', '3:x'])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
