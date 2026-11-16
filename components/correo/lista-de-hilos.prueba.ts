import type { HiloDeLista } from '@/lib/correo/tipos'
import { esHiloDeRebote, estadoDeFiltro, puedeEncargarHilo, filtrarEnCliente, idsAnimados, seAtenua, segmentoActivo, tituloDeModo, vacioDeLista, type FiltroDeCliente } from './lista-de-hilos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const hilo = (id: string, extra: Partial<HiloDeLista> = {}): HiloDeLista => ({
  id,
  asunto: 'Presupuesto Q4',
  contraparte: 'Ana López',
  contraparteDireccion: 'ana@tienda.com',
  vistaPrevia: 'Te paso las cifras',
  ultimoMensajeAt: '2026-11-16T10:00:00Z',
  mensajes: 1,
  noLeidos: 0,
  entrantes: 1,
  salientes: 0,
  tieneAdjuntos: false,
  destacado: false,
  esperandoRespuesta: false,
  automatico: false,
  buzonId: 'b1',
  silenciado: false,
  asignadoA: null,
  ...extra,
})

const base: FiltroDeCliente = { busqueda: '', vista: 'todos', soloNoLeidos: false, ocultarSilenciados: false, modo: 'mios', seleccionado: null }

console.log('\n=== segmentado y «Más» ===')
ok('todos', segmentoActivo('todos', false) === 'todos')
ok('sin leer manda sobre la vista', segmentoActivo('pendientes', true) === 'sin-leer')
ok('pendientes', segmentoActivo('pendientes', false) === 'pendientes')
ok('destacados: ninguno (va en Más)', segmentoActivo('destacados', false) === null)
ok('pulsar Sin leer: todos + soloNoLeidos', JSON.stringify(estadoDeFiltro('sin-leer')) === JSON.stringify({ vista: 'todos', soloNoLeidos: true }))
ok('pulsar Pendientes quita Sin leer', JSON.stringify(estadoDeFiltro('pendientes')) === JSON.stringify({ vista: 'pendientes', soloNoLeidos: false }))
ok('pulsar Enviados (Más)', JSON.stringify(estadoDeFiltro('enviados')) === JSON.stringify({ vista: 'enviados', soloNoLeidos: false }))

console.log('\n=== rebotes y atenuado ===')
const rebote = hilo('r', { contraparteDireccion: 'MAILER-DAEMON@hostinger.com', asunto: 'Undelivered Mail Returned to Sender', silenciado: true, automatico: true })
ok('mailer-daemon es rebote', esHiloDeRebote(rebote))
ok('por el asunto también', esHiloDeRebote(hilo('x', { contraparteDireccion: 'noreply@x.com', asunto: 'Mensaje no entregado' })))
ok('un correo normal no', !esHiloDeRebote(hilo('n')))
ok('silenciado normal se atenúa', seAtenua(hilo('s', { silenciado: true })))
ok('un rebote silenciado (o automático de rebote) NUNCA se atenúa', !seAtenua(rebote))
ok('sin silenciar no se atenúa', !seAtenua(hilo('n')))

console.log('\n=== filtrar en el cliente ===')
const lista = [
  hilo('a', { noLeidos: 2 }),
  hilo('b', { silenciado: true }),
  hilo('c', { destacado: true, salientes: 1, entrantes: 0 }),
  hilo('d', { esperandoRespuesta: true }),
  rebote,
]
ok('sin búsqueda ni ocultar: el mismo array', filtrarEnCliente(lista, base) === lista)
ok('sin búsqueda, la vista NO se aplica aquí (la aplica el servidor)', filtrarEnCliente(lista, { ...base, vista: 'destacados' }) === lista)
const ocultos = filtrarEnCliente(lista, { ...base, ocultarSilenciados: true }).map((h) => h.id).join(',')
ok('ocultar silenciados quita los atenuados pero deja el rebote', ocultos === 'a,c,d,r', ocultos)
ok('ocultar silenciados no vale fuera de Mis correos', filtrarEnCliente(lista, { ...base, modo: 'buzon', ocultarSilenciados: true }) === lista)
ok('el abierto no se oculta', filtrarEnCliente(lista, { ...base, ocultarSilenciados: true, seleccionado: 'b' }).some((h) => h.id === 'b'))
const busca = { ...base, busqueda: 'ana' }
ok('con búsqueda y sin filtros: todo', filtrarEnCliente(lista, busca).length === lista.length)
ok('con búsqueda, Sin leer se aplica', filtrarEnCliente(lista, { ...busca, soloNoLeidos: true }).map((h) => h.id).join(',') === 'a')
ok('con búsqueda, Destacados se aplica', filtrarEnCliente(lista, { ...busca, vista: 'destacados' }).map((h) => h.id).join(',') === 'c')
ok('con búsqueda, Enviados', filtrarEnCliente(lista, { ...busca, vista: 'enviados' }).map((h) => h.id).join(',') === 'c')
ok('con búsqueda, Pendientes', filtrarEnCliente(lista, { ...busca, vista: 'pendientes' }).map((h) => h.id).join(',') === 'd')
ok('con búsqueda, Recibidos', filtrarEnCliente(lista, { ...busca, vista: 'recibidos' }).every((h) => h.entrantes > 0))
ok('1 carácter no cuenta como búsqueda', filtrarEnCliente(lista, { ...base, busqueda: ' a ', vista: 'destacados' }) === lista)

console.log('\n=== animaciones ===')
const muchos = Array.from({ length: 20 }, (_, i) => hilo(`h${i}`))
const todos = new Set(muchos.map((h) => h.id))
ok('como mucho 12 a la vez', idsAnimados(muchos, todos).size === 12)
ok('las 12 primeras de la lista', [...idsAnimados(muchos, todos)].join(',') === muchos.slice(0, 12).map((h) => h.id).join(','))
ok('sin nuevos, ninguna', idsAnimados(muchos, new Set()).size === 0)
ok('ignora ids que no están en la lista', idsAnimados(muchos, new Set(['zz', 'h3'])).size === 1)

console.log('\n=== estados vacíos ===')
const v = { modo: 'mios' as const, busqueda: '', vista: 'todos' as const, soloNoLeidos: false, ocultarSilenciados: false, hayMisBuzones: true, importando: false }
ok('Mis correos sin elegir', vacioDeLista({ ...v, hayMisBuzones: false }).tipo === 'sin-elegir' && vacioDeLista({ ...v, hayMisBuzones: false }).titulo === 'Aún no has elegido tus correos')
ok('búsqueda sin resultados', vacioDeLista({ ...v, busqueda: ' xyz ' }).titulo === 'Nada con «xyz» en Mis correos', vacioDeLista({ ...v, busqueda: ' xyz ' }).titulo)
ok('búsqueda en un buzón', vacioDeLista({ ...v, modo: 'buzon', busqueda: 'xyz' }).titulo.endsWith('en este buzón'))
ok('con Sin leer', vacioDeLista({ ...v, soloNoLeidos: true }).titulo === 'Nada sin leer aquí 🎉' && vacioDeLista({ ...v, soloNoLeidos: true }).tipo === 'filtro')
ok('con Pendientes', vacioDeLista({ ...v, vista: 'pendientes' }).tipo === 'filtro')
ok('ocultar silenciados cuenta como filtro en Mis correos', vacioDeLista({ ...v, ocultarSilenciados: true }).tipo === 'filtro')
ok('asignados vacío', vacioDeLista({ ...v, modo: 'asignados' }).titulo === 'No tienes conversaciones encargadas')
ok('vacío normal con importación', vacioDeLista({ ...v, modo: 'buzon', importando: true }).descripcion.includes('antiguos'))
ok('títulos de la cabecera', tituloDeModo('mios') === 'Mis correos' && tituloDeModo('asignados') === 'Asignados a mí')

console.log('\n=== «Asignar» en la fila (la misma regla que la vista del hilo y la ruta) ===')
ok('quien responde desde el buzón: sí', puedeEncargarHilo({ puedeResponder: true }, false))
ok('supervisor de solo lectura (no admin): no', !puedeEncargarHilo({ puedeResponder: false }, false))
ok('administrador aunque no responda: sí', puedeEncargarHilo({ puedeResponder: false }, true))
ok('sin buzón (ya no se lee): no, ni a un administrador', !puedeEncargarHilo(null, true) && !puedeEncargarHilo(undefined, false))

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
if (fallos) process.exit(1)
