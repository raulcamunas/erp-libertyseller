import {
  asuntoDeReenvio,
  asuntoDeRespuesta,
  asuntoSirveParaAgrupar,
  elegirHiloPorAsunto,
  hiloQueSeQueda,
  idsParaElHilo,
  normalizarAsunto,
  normalizarMessageId,
  participantesDe,
  referenciasDe,
} from '@/lib/correo/hilos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (n: string, real: unknown, esperado: unknown) => ok(n, JSON.stringify(real) === JSON.stringify(esperado), `real ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`)

/** HILOS: qué correos son la misma conversación. */

console.log('normalizarAsunto')
igual('quita Re:', normalizarAsunto('Re: Propuesta'), 'propuesta')
igual('quita RE: re: y Fwd: apilados', normalizarAsunto('RE: re: Fwd: Propuesta Amazon'), 'propuesta amazon')
igual('quita RV: de Outlook en español', normalizarAsunto('RV: Presupuesto'), 'presupuesto')
igual('quita Re[2]:', normalizarAsunto('Re[2]: Hola Ana'), 'hola ana')
igual('quita AW: y WG: alemanes', normalizarAsunto('AW: WG: Angebot'), 'angebot')
igual('sin acentos y en minúsculas', normalizarAsunto('Reunión del MARTES'), 'reunion del martes')
igual('espacios normalizados', normalizarAsunto('  Hola    mundo  '), 'hola mundo')
igual('«Re» dentro del asunto se queda', normalizarAsunto('Reunión re: algo'), 'reunion re: algo')
igual('un asunto que empieza por una palabra con «re»', normalizarAsunto('Recordatorio de pago'), 'recordatorio de pago')
igual('solo «Re:» queda vacío', normalizarAsunto('Re:'), '')
igual('no es texto', normalizarAsunto(null), '')
ok('un asunto vacío no sirve', !asuntoSirveParaAgrupar(''))
ok('«sin asunto» no sirve', !asuntoSirveParaAgrupar('sin asunto'))
ok('un asunto normal sí', asuntoSirveParaAgrupar('propuesta'))
igual('asuntoDeRespuesta', asuntoDeRespuesta('Propuesta'), 'Re: Propuesta')
igual('asuntoDeRespuesta no apila', asuntoDeRespuesta('Re: Propuesta'), 'Re: Propuesta')
igual('asuntoDeRespuesta con RV:', asuntoDeRespuesta('RV: Propuesta'), 'RV: Propuesta')
igual('asuntoDeRespuesta sin asunto', asuntoDeRespuesta(''), 'Re:')
igual('asuntoDeReenvio', asuntoDeReenvio('Propuesta'), 'Fwd: Propuesta')
igual('asuntoDeReenvio no apila', asuntoDeReenvio('Fwd: Propuesta'), 'Fwd: Propuesta')

console.log('identificadores')
igual('Message-ID sin ángulos y en minúsculas', normalizarMessageId('<ABC.123@Mail.Cliente.ES>'), 'abc.123@mail.cliente.es')
igual('Message-ID sin ángulos de entrada', normalizarMessageId('abc@x.es'), 'abc@x.es')
igual('Message-ID con espacios alrededor', normalizarMessageId('  <a@b.es> '), 'a@b.es')
igual('Message-ID vacío', normalizarMessageId('  '), null)
igual('Message-ID con espacio dentro', normalizarMessageId('a b@c.es'), null)
igual('Message-ID que no es texto', normalizarMessageId(undefined), null)
igual('Message-ID demasiado largo', normalizarMessageId(`<${'a'.repeat(600)}@x.es>`), null)
igual('References en un texto', referenciasDe('<a@x.es> <B@x.es>\r\n <c@x.es>'), ['a@x.es', 'b@x.es', 'c@x.es'])
igual('References en un array', referenciasDe(['<a@x.es>', '<b@x.es> <a@x.es>']), ['a@x.es', 'b@x.es'])
igual('References ausentes', referenciasDe(undefined), [])
igual('References: se quedan las 30 últimas', referenciasDe(Array.from({ length: 40 }, (_, i) => `<m${i}@x.es>`).join(' ')).length, 30)
igual('References: la última se conserva', referenciasDe(Array.from({ length: 40 }, (_, i) => `<m${i}@x.es>`).join(' ')).at(-1), 'm39@x.es')
igual('ids para el hilo', idsParaElHilo({ messageId: 'c@x.es', enRespuestaA: 'b@x.es', referencias: ['a@x.es', 'b@x.es'] }), ['c@x.es', 'b@x.es', 'a@x.es'])
igual('ids sin nada', idsParaElHilo({ messageId: null, enRespuestaA: null, referencias: [] }), [])

console.log('participantes')
igual('quita la propia y repetidas', participantesDe(['Ana@X.es', 'yo@liberty.es', 'ana@x.es', null, undefined, 'b@y.es'], 'YO@liberty.es'), ['ana@x.es', 'b@y.es'])

console.log('elegirHiloPorAsunto')
const hilo = (id: string, participantes: string[], primero: string, ultimo: string) => ({ id, participantes, primerMensajeAt: primero, ultimoMensajeAt: ultimo })
const fecha = (s: string) => new Date(s)
igual('mismo asunto, alguien en común, a tiempo', elegirHiloPorAsunto([hilo('h1', ['ana@x.es'], '2026-10-01T10:00:00Z', '2026-10-05T10:00:00Z')], { participantes: ['ana@x.es'], fecha: fecha('2026-10-10T10:00:00Z') }), 'h1')
igual('sin nadie en común: no', elegirHiloPorAsunto([hilo('h1', ['ana@x.es'], '2026-10-01T10:00:00Z', '2026-10-05T10:00:00Z')], { participantes: ['otra@y.es'], fecha: fecha('2026-10-10T10:00:00Z') }), null)
igual('demasiado lejos en el tiempo: no', elegirHiloPorAsunto([hilo('h1', ['ana@x.es'], '2026-01-01T10:00:00Z', '2026-01-05T10:00:00Z')], { participantes: ['ana@x.es'], fecha: fecha('2026-10-10T10:00:00Z') }), null)
igual('justo en el límite de 45 días: sí', elegirHiloPorAsunto([hilo('h1', ['ana@x.es'], '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')], { participantes: ['ana@x.es'], fecha: fecha('2026-10-16T00:00:00Z') }), 'h1')
igual('un día más del límite: no', elegirHiloPorAsunto([hilo('h1', ['ana@x.es'], '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')], { participantes: ['ana@x.es'], fecha: fecha('2026-10-17T00:00:00Z') }), null)
igual('un correo anterior al hilo (importación de lo más reciente primero) entra', elegirHiloPorAsunto([hilo('h1', ['ana@x.es'], '2026-10-10T10:00:00Z', '2026-10-12T10:00:00Z')], { participantes: ['ana@x.es'], fecha: fecha('2026-10-08T10:00:00Z') }), 'h1')
igual('de varios, el más cercano', elegirHiloPorAsunto([hilo('lejos', ['ana@x.es'], '2026-09-01T10:00:00Z', '2026-09-02T10:00:00Z'), hilo('cerca', ['ana@x.es'], '2026-10-01T10:00:00Z', '2026-10-09T10:00:00Z')], { participantes: ['ana@x.es'], fecha: fecha('2026-10-10T10:00:00Z') }), 'cerca')
igual('a igual distancia, el que comparte más gente', elegirHiloPorAsunto([hilo('uno', ['ana@x.es'], '2026-10-01T10:00:00Z', '2026-10-09T10:00:00Z'), hilo('dos', ['ana@x.es', 'bea@y.es'], '2026-10-01T10:00:00Z', '2026-10-09T10:00:00Z')], { participantes: ['ana@x.es', 'bea@y.es'], fecha: fecha('2026-10-10T10:00:00Z') }), 'dos')
igual('sin participantes: no', elegirHiloPorAsunto([hilo('h1', ['ana@x.es'], '2026-10-01T10:00:00Z', '2026-10-05T10:00:00Z')], { participantes: [], fecha: fecha('2026-10-06T10:00:00Z') }), null)
igual('fecha inválida: no', elegirHiloPorAsunto([hilo('h1', ['ana@x.es'], '2026-10-01T10:00:00Z', '2026-10-05T10:00:00Z')], { participantes: ['ana@x.es'], fecha: new Date('nada') }), null)
igual('sin candidatos', elegirHiloPorAsunto([], { participantes: ['ana@x.es'], fecha: fecha('2026-10-06T10:00:00Z') }), null)

console.log('hiloQueSeQueda')
igual('el más antiguo', hiloQueSeQueda([{ id: 'b', primerMensajeAt: '2026-10-05T00:00:00Z' }, { id: 'a', primerMensajeAt: '2026-10-01T00:00:00Z' }, { id: 'c', primerMensajeAt: '2026-10-09T00:00:00Z' }])?.id, 'a')
igual('a igual fecha, por id', hiloQueSeQueda([{ id: 'b', primerMensajeAt: '2026-10-01T00:00:00Z' }, { id: 'a', primerMensajeAt: '2026-10-01T00:00:00Z' }])?.id, 'a')
igual('ninguno', hiloQueSeQueda([]), null)

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
