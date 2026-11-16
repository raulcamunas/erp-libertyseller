import { buzonesDeEnvio, cambiarFirma, hayQueElegirDe, sePuedeEnviarDesde } from './redactar-de'
import { borradorDe } from './redactar'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const b = (id: string, o: Partial<{ puedeResponder: boolean; conectado: boolean; credencialesInvalidas: boolean }> = {}) => ({
  id,
  puedeResponder: o.puedeResponder ?? true,
  conectado: o.conectado ?? true,
  credencialesInvalidas: o.credencialesInvalidas ?? false,
})

console.log('\n=== desde qué buzones se puede enviar ===')
{
  ok('dueño o asignado con respuesta, conectado: sí', sePuedeEnviarDesde(b('a')))
  ok('solo lectura (supervisión, asignado sin respuesta): no', !sePuedeEnviarDesde(b('a', { puedeResponder: false })))
  ok('desconectado: no', !sePuedeEnviarDesde(b('a', { conectado: false })))
  ok('contraseña rechazada: no', !sePuedeEnviarDesde(b('a', { credencialesInvalidas: true })))

  const inicial = b('stock')
  ok('sin lista (CorreoRapido): solo el de partida', JSON.stringify(buzonesDeEnvio(inicial, undefined).map((x) => x.id)) === '["stock"]')
  const lista = [b('soporte'), b('stock'), b('jose', { puedeResponder: false }), b('maoli', { credencialesInvalidas: true }), b('daniela'), b('soporte')]
  const ids = buzonesDeEnvio(inicial, lista).map((x) => x.id)
  ok('el de partida primero, sin repetidos y sin los que no pueden enviar', JSON.stringify(ids) === '["stock","soporte","daniela"]', JSON.stringify(ids))
  const raro = b('equipo', { puedeResponder: false })
  ok('el de partida va aunque no cumpla (lo decide quien abre)', buzonesDeEnvio(raro, [b('stock')])[0].id === 'equipo')
}

console.log('\n=== cuándo sale el «De:» ===')
{
  ok('2 o más y mensaje nuevo: sí', hayQueElegirDe(2, 'nuevo'))
  ok('uno solo: no', !hayQueElegirDe(1, 'nuevo'))
  ok('al responder: no (el original es de un buzón)', !hayQueElegirDe(3, 'responder'))
  ok('al reenviar: no', !hayQueElegirDe(3, 'reenviar'))
}

console.log('\n=== la firma cambia con el buzón ===')
{
  const inicial = borradorDe('nuevo', null, { miDireccion: 'stock@x.es', firma: 'Ana\nStock' }).texto
  const r = cambiarFirma(inicial, 'Ana\nStock', 'Luis\nSoporte')
  ok('texto recién abierto: queda con la forma de borradorDe', r.cambiada && r.texto === borradorDe('nuevo', null, { miDireccion: 's@x.es', firma: 'Luis\nSoporte' }).texto, JSON.stringify(r.texto))
  const escrito = cambiarFirma('Hola Marta,\n\nte escribo…\n\nAna\nStock\n', 'Ana\nStock', 'Luis')
  ok('con algo escrito: se conserva lo escrito', escrito.cambiada && escrito.texto === 'Hola Marta,\n\nte escribo…\n\nLuis', JSON.stringify(escrito.texto))
  const tocada = cambiarFirma('Hola\n\nAna (de vacaciones)', 'Ana', 'Luis')
  ok('firma tocada a mano: no se pisa', !tocada.cambiada && tocada.texto === 'Hola\n\nAna (de vacaciones)')
  const sinVieja = cambiarFirma('Hola', null, 'Luis')
  ok('sin firma vieja: la nueva va debajo', sinVieja.cambiada && sinVieja.texto === 'Hola\n\nLuis')
  const vacio = cambiarFirma('', null, 'Luis')
  ok('vacío y sin firma vieja: como borradorDe', vacio.texto === '\n\nLuis')
  const sinNueva = cambiarFirma('Hola\n\nAna', 'Ana', null)
  ok('el nuevo no tiene firma: se quita la vieja', sinNueva.cambiada && sinNueva.texto === 'Hola')
  const igual = cambiarFirma('Hola\n\nAna', 'Ana', ' Ana ')
  ok('la misma firma: no se toca', igual.cambiada && igual.texto === 'Hola\n\nAna')
  const vuelta = cambiarFirma(cambiarFirma(inicial, 'Ana\nStock', 'Luis').texto, 'Luis', 'Ana\nStock')
  ok('ida y vuelta: el texto de partida', vuelta.texto === inicial)
}

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} FALLOS.`)
if (fallos > 0) process.exit(1)
