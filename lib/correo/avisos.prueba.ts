import { avisosDeCorreo, esRebote, type MensajeParaAviso } from './avisos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const m = (id: string, extra: Partial<MensajeParaAviso> = {}): MensajeParaAviso => ({
  id,
  buzon_id: 'b1',
  hilo_id: `h-${id}`,
  de_nombre: 'Ana López',
  de_direccion: 'ana@cliente.es',
  asunto: 'Re: Apertura de canal en Amazon',
  vista_previa: 'Hola Daniela, me interesa, ¿podemos hablar mañana?',
  fecha: '2026-10-22T10:00:00.000Z',
  automatico: false,
  ...extra,
})

console.log('\n=== qué se avisa y qué no ===')
{
  const r = avisosDeCorreo([m('1'), m('2', { automatico: true, de_direccion: 'no-reply@amazon.es', de_nombre: 'Amazon' })])
  ok('una persona sí, un automático no', r.length === 1 && r[0].id === '1')
  ok('con el nombre de quien escribe', r[0].de === 'Ana López')
}
{
  const r = avisosDeCorreo([m('1', { de_nombre: null, de_direccion: 'info@tienda.es' })])
  ok('sin nombre, su dirección', r[0].de === 'info@tienda.es')
}

console.log('\n=== los rebotes sí, aunque sean automáticos ===')
{
  const r = avisosDeCorreo([m('1', { automatico: true, de_nombre: 'Mail Delivery System', de_direccion: 'mailer-daemon@relay.hostinger.com', asunto: 'Undelivered Mail Returned to Sender' })])
  ok('el rebote se avisa', r.length === 1 && r[0].rebote === true)
  ok('por el remitente', esRebote({ de_direccion: 'MAILER-DAEMON@x.com', asunto: 'hola' }) && esRebote({ de_direccion: 'postmaster@x.com', asunto: 'hola' }))
  ok('o por el asunto', esRebote({ de_direccion: 'x@y.com', asunto: 'Delivery Status Notification (Failure)' }) && esRebote({ de_direccion: 'x@y.com', asunto: 'No se pudo entregar el mensaje' }))
  ok('un correo normal no es un rebote', !esRebote({ de_direccion: 'ana@cliente.es', asunto: 'Re: propuesta' }) && !esRebote({ de_direccion: 'notificaciones@amazon.es', asunto: 'Tu pedido' }))
}

console.log('\n=== orden y tope ===')
{
  const filas = Array.from({ length: 8 }, (_, i) => m(String(i), { fecha: `2026-10-22T10:0${i}:00.000Z` }))
  const r = avisosDeCorreo(filas, 3)
  ok('del más reciente al más antiguo', r.map((x) => x.id).join() === '7,6,5')
  ok('sin pasar del tope', r.length === 3 && avisosDeCorreo(filas, 0).length === 0)
}

console.log('\n=== textos largos y vacíos ===')
{
  const r = avisosDeCorreo([m('1', { asunto: '   ', vista_previa: 'a'.repeat(400) }), m('2', { asunto: 'x'.repeat(300) })])
  const sin = r.find((x) => x.id === '1')!
  ok('sin asunto, se dice', sin.asunto === '(sin asunto)')
  ok('la vista previa se recorta con puntos suspensivos', sin.vistaPrevia.length === 160 && sin.vistaPrevia.endsWith('…'))
  ok('un asunto largo también', r.find((x) => x.id === '2')!.asunto.length === 140)
  ok('los saltos de línea de la vista previa se aplanan', avisosDeCorreo([m('3', { vista_previa: 'Hola\n\n  qué   tal' })])[0].vistaPrevia === 'Hola qué tal')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
