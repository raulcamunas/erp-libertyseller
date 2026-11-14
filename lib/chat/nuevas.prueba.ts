import { esNivel, motivoDeAviso, nivelDe } from '@/lib/chat/avisos'
import { COMANDOS, leerComando, leerRecordatorio, sugerenciasDeComandos } from '@/lib/chat/comandos'
import { contarVotos, limpiarEncuesta, votosTrasPulsar } from '@/lib/chat/encuesta'
import { convertirTexto, emojiDeSlack, isoDeTs, leerExportacion } from '@/lib/chat/slack'
import { esHoraDeDescanso, frasePorZona, horaLocal, zonaDetectada, zonaValida } from '@/lib/chat/zonas'

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
const iso = (ms: number) => new Date(ms).toISOString()

// ---------- avisos
igual('niveles', [esNivel('todo'), esNivel('menciones'), esNivel('nada'), esNivel('x'), esNivel(null)], [true, true, true, false, false])
igual('el nivel de siempre: directo todo, canal menciones, silenciado nada', [nivelDe({}, 'directo'), nivelDe({}, 'canal'), nivelDe({}, 'privado'), nivelDe({ silenciado: true }, 'directo'), nivelDe({ avisos: 'todo', silenciado: true }, 'canal')], ['todo', 'menciones', 'menciones', 'nada', 'todo'])
const base = { tipoDeCanal: 'canal' as const, esDeHilo: false, estaEnElHilo: false, mencionada: false, citada: false, nivel: 'menciones' as const }
igual('«nada» no avisa ni de menciones', motivoDeAviso({ ...base, nivel: 'nada', mencionada: true }), null)
igual('una mención avisa con «menciones»', motivoDeAviso({ ...base, mencionada: true }), 'mencion')
igual('un mensaje normal en un canal con «menciones»: nada', motivoDeAviso(base), null)
igual('con «todo» en un canal: avisa del canal; en un directo, del directo', [motivoDeAviso({ ...base, nivel: 'todo' }), motivoDeAviso({ ...base, nivel: 'todo', tipoDeCanal: 'directo' })], ['canal', 'directo'])
igual('responder a un mensaje tuyo avisa (menos en un directo, donde ya se ve)', [motivoDeAviso({ ...base, citada: true }), motivoDeAviso({ ...base, citada: true, tipoDeCanal: 'directo', nivel: 'menciones' })], ['respuesta', null])
igual('un hilo en el que estás avisa; uno ajeno no', [motivoDeAviso({ ...base, esDeHilo: true, estaEnElHilo: true }), motivoDeAviso({ ...base, esDeHilo: true, estaEnElHilo: false })], ['hilo', null])
igual('la mención gana a lo demás', motivoDeAviso({ ...base, nivel: 'todo', mencionada: true, citada: true, esDeHilo: true, estaEnElHilo: true }), 'mencion')

// ---------- zonas
const AHORA = Date.parse('2026-11-08T20:40:00Z') // 21:40 en Madrid, 00:40 en Dubái (ya es lunes), 14:40 en Bogotá
igual('zonas válidas', [zonaValida('Asia/Dubai'), zonaValida('Mars/Olympus'), zonaValida(5)], [true, false, false])
igual('zona detectada: se acepta la de la lista, los alias y se descarta el resto', [zonaDetectada('Europe/Madrid'), zonaDetectada('America/Buenos_Aires'), zonaDetectada('Pacific/Fiji'), zonaDetectada(null)], ['Europe/Madrid', 'America/Argentina/Buenos_Aires', null, null])
igual('hora local de Dubái, Bogotá y Madrid', [horaLocal('Asia/Dubai', AHORA)?.hora, horaLocal('America/Bogota', AHORA)?.hora, horaLocal('Europe/Madrid', AHORA)?.hora], ['00:40', '15:40', '21:40'])
igual('Dubái ya está en otro día; Bogotá y Madrid no', [horaLocal('Asia/Dubai', AHORA)?.otroDia, horaLocal('America/Bogota', AHORA)?.otroDia, horaLocal('Europe/Madrid', AHORA)?.otroDia], ['lun', null, null])
igual('hora de descanso', [esHoraDeDescanso(23), esHoraDeDescanso(2), esHoraDeDescanso(7), esHoraDeDescanso(8), esHoraDeDescanso(21), esHoraDeDescanso(22)], [true, true, true, false, false, true])
igual('la frase para enseñar', [frasePorZona('Asia/Dubai', AHORA), frasePorZona('America/Bogota', AHORA)?.descansando, frasePorZona(null, AHORA), frasePorZona('Mars/Olympus', AHORA)], [{ texto: '00:40 (lun)', descansando: true, nombreDeZona: 'Emiratos (Dubái)' }, false, null, null])

// ---------- encuestas
igual('una encuesta buena, con opciones limpias y sin repetir', limpiarEncuesta({ pregunta: '  ¿Comemos  a las 14 o a las 15?  ', opciones: ['14:00', ' 15:00 ', '14:00', '', '16:00'], multiple: true }), { ok: true, encuesta: { pregunta: '¿Comemos a las 14 o a las 15?', opciones: ['14:00', '15:00', '16:00'], multiple: true, cerrada: false } })
igual('sin pregunta, con una opción o con demasiadas, no vale', [limpiarEncuesta({ pregunta: '', opciones: ['a', 'b'] }).ok, limpiarEncuesta({ pregunta: 'x', opciones: ['a'] }).ok, limpiarEncuesta({ pregunta: 'x', opciones: Array.from({ length: 9 }, (_, i) => `o${i}`) }).ok, limpiarEncuesta(null).ok], [false, false, false, false])
const enc = { opciones: ['a', 'b', 'c'], multiple: false }
igual('el recuento', contarVotos(enc, { 0: ['u1', 'u2'], 1: ['u3'] }, 'u1'), { votantes: 3, opciones: [{ votos: 2, porcentaje: 67, mio: true }, { votos: 1, porcentaje: 33, mio: false }, { votos: 0, porcentaje: 0, mio: false }] })
igual('sin votos, todo a cero', contarVotos(enc, {}, 'u1').opciones.every((o) => o.votos === 0 && o.porcentaje === 0), true)
igual('votar en una de una respuesta sustituye; pulsar la propia la quita', [votosTrasPulsar(enc, [0], 1), votosTrasPulsar(enc, [1], 1), votosTrasPulsar(enc, [], 2)], [[1], [], [2]])
igual('en una múltiple se suma y se quita', [votosTrasPulsar({ ...enc, multiple: true }, [0], 2), votosTrasPulsar({ ...enc, multiple: true }, [0, 2], 0)], [[0, 2], [2]])
igual('una opción que no existe no cambia nada', votosTrasPulsar(enc, [1], 9), [1])

// ---------- comandos
igual('comandos', [leerComando('/junta', false), leerComando('/recordar mañana 9:00 llamar', false), leerComando('/erp ¿cuántas citas?', false), leerComando('/erp ¿cuántas citas?', true), leerComando('/Users/raul/foto.png', true), leerComando('hola /junta', true)], [{ nombre: 'junta', argumentos: '' }, { nombre: 'recordar', argumentos: 'mañana 9:00 llamar' }, null, null, null, null])
igual('sugerencias al escribir «/»', [sugerenciasDeComandos('/', false).map((c) => c.nombre), sugerenciasDeComandos('/re', true).map((c) => c.nombre), sugerenciasDeComandos('/e', false).map((c) => c.nombre), sugerenciasDeComandos('/erp hola', true).length, sugerenciasDeComandos('hola', true).length], [['recordar', 'estado', 'junta', 'encuesta', 'silenciar'], ['recordar'], ['estado', 'encuesta'], 0, 0])
igual('todos los comandos tienen uso y descripción', COMANDOS.every((c) => c.uso.startsWith(`/${c.nombre}`) && c.descripcion.length > 5), true)
const DOMINGO = Date.parse('2026-11-08T21:00:00Z') // domingo 22:00 en Madrid
const r = (t: string) => { const x = leerRecordatorio(t, DOMINGO); return x.ok ? { en: iso(x.en), texto: x.texto } : x.motivo }
igual('recordar: rápidos', [r('20min llamar a Ana'), r('1h revisar el manifiesto'), r('3 horas cerrar caja')], [{ en: '2026-11-08T21:20:00.000Z', texto: 'llamar a Ana' }, { en: '2026-11-08T22:00:00.000Z', texto: 'revisar el manifiesto' }, { en: '2026-11-09T00:00:00.000Z', texto: 'cerrar caja' }])
igual('recordar: mañana y lunes', [r('mañana llamar a ShoesF'), r('manana 9:30 reunión'), r('lunes enviar informe')], [{ en: '2026-11-09T08:00:00.000Z', texto: 'llamar a ShoesF' }, { en: '2026-11-09T08:30:00.000Z', texto: 'reunión' }, { en: '2026-11-09T08:00:00.000Z', texto: 'enviar informe' }])
igual('recordar: una hora suelta (la de hoy si no ha pasado; si no, la de mañana)', [r('23:30 cerrar'), r('9:15 llamar')], [{ en: '2026-11-08T22:30:00.000Z', texto: 'cerrar' }, { en: '2026-11-09T08:15:00.000Z', texto: 'llamar' }])
igual('recordar: sin texto o sin hora', [typeof r('1h'), typeof r(''), typeof r('un día de estos algo')], ['string', 'string', 'string'])

// ---------- Slack
const ctx = { menciones: new Map([['U1', { perfilId: '11111111-1111-4111-8111-111111111111', nombre: 'Ana' }], ['U2', { perfilId: null, nombre: 'Beto' }]]), canales: new Map([['C9', 'ventas']]) }
igual('texto: menciones, canales, enlaces y entidades', convertirTexto('Hola <@U1> y <@U2>, mirad <#C9|ventas> &amp; <https://a.es|este enlace> o <https://b.es> <!here>', ctx), 'Hola <@11111111-1111-4111-8111-111111111111> y @Beto, mirad #ventas & este enlace (https://a.es) o https://b.es @todos')
igual('texto: negrita, tachado y emojis; el código no se toca', convertirTexto('esto es *importante* y ~esto no~ :tada: `*no*` y :nombre_raro:', ctx), 'esto es **importante** y esto no 🎉 `*no*` y :nombre_raro:')
igual('texto: un bloque de código se deja entero', convertirTexto('```\na &lt; b *x*\n```', ctx), '```\na < b *x*\n```')
igual('emojis de reacción', [emojiDeSlack('+1'), emojiDeSlack('thumbsup::skin-tone-3'), emojiDeSlack('inventado')], ['👍', '👍', null])
igual('ts a fecha', isoDeTs('1699999999.000200'), '2023-11-14T22:13:19.000Z')

const ficheros = new Map<string, string>([
  ['users.json', JSON.stringify([{ id: 'U1', real_name: 'Ana Pérez', profile: { email: 'Ana@Liberty.es' } }, { id: 'U2', name: 'beto', profile: { real_name: 'Beto' } }, { id: 'B1', real_name: 'Bot', is_bot: true }])],
  ['channels.json', JSON.stringify([{ id: 'C1', name: 'general', members: ['U1', 'U2'], purpose: { value: 'Todo el equipo' } }, { id: 'C2', name: 'vacio', members: [] }])],
  ['dms.json', JSON.stringify([{ id: 'D1', members: ['U1', 'U2'] }])],
  ['general/2026-10-05.json', JSON.stringify([
    { type: 'message', user: 'U1', text: 'Buenos días', ts: '1000.000100', reactions: [{ name: '+1', users: ['U2'] }], files: [{ name: 'plan.pdf' }] },
    { type: 'message', subtype: 'channel_join', user: 'U2', text: 'se unió', ts: '1000.000200' },
    { type: 'message', user: 'U2', text: 'Hola', ts: '1000.000300', thread_ts: '1000.000100' },
    { type: 'message', subtype: 'bot_message', username: 'Alertas', text: 'aviso', ts: '1000.000400' },
  ])],
  ['general/2026-10-06.json', '{roto'],
  ['D1/2026-10-05.json', JSON.stringify([{ type: 'message', user: 'U2', text: 'Privado', ts: '2000.000100' }])],
])
const x = leerExportacion(ficheros)
igual('usuarios: nombre, correo en minúsculas y bots', x.usuarios.map((u) => [u.id, u.nombre, u.email, u.esBot]), [['U1', 'Ana Pérez', 'ana@liberty.es', false], ['U2', 'Beto', null, false], ['B1', 'Bot', null, true]])
igual('conversaciones: las vacías se descartan y los directos se nombran con las dos personas', x.conversaciones.map((c) => [c.origenId, c.nombre, c.tipo, c.mensajes.length]), [['C1', 'general', 'canal', 3], ['D1', 'Ana Pérez · Beto', 'directo', 1]])
const g = x.conversaciones[0]
igual('mensajes: se ignoran las altas, el hilo apunta al de arriba y el bot queda como externo', g.mensajes.map((m) => [m.ts, m.usuarioId, m.nombreExterno, m.hiloTs]), [['1000.000100', 'U1', null, null], ['1000.000300', 'U2', null, '1000.000100'], ['1000.000400', null, 'Alertas', null]])
igual('reacciones y archivos', [g.mensajes[0].reacciones, g.mensajes[0].archivos], [[{ emoji: '+1', usuarios: ['U2'] }], ['plan.pdf']])
igual('un fichero roto se avisa, no tumba la lectura', x.avisos, ['No se ha podido leer general/2026-10-06.json'])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
