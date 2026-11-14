import { fechaDeCita, slackAChat, textoDeCita } from '@/lib/chat/sistema'

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

igual('negrita y emoji de Slack', slackAChat(':white_check_mark: *Lenobotics*: el stock se ha subido bien (12 de 12).'), '✅ **Lenobotics**: el stock se ha subido bien (12 de 12).')
igual('el código y la cursiva se quedan', slackAChat('• `ABC-1` — _sin lectura_'), '• `ABC-1` — _sin lectura_')
igual('un emoji que no se conoce se deja', slackAChat(':nube: hola'), ':nube: hola')
igual('un asterisco suelto no es negrita', slackAChat('2 * 3 = 6'), '2 * 3 = 6')
igual('la fecha en hora de Madrid', fechaDeCita('2026-11-12T15:00:00Z'), 'jue, 12 nov, 16:00')
igual('una fecha rota no escribe nada', fechaDeCita('no es una fecha'), '')
igual('la cita con empresa y closer', textoDeCita({ comercial: 'Daniela', lead: 'Ana López', empresa: 'Tienda Sol', inicioIso: '2026-11-12T15:00:00Z', closer: 'Raúl', enlace: 'https://x.test/agenda' }), '📅 **Daniela** ha agendado una cita con **Ana López** (Tienda Sol) · jue, 12 nov, 16:00\nCierra: Raúl\nhttps://x.test/agenda')
igual('la cita sin empresa repetida', textoDeCita({ comercial: 'Mario', lead: 'Tienda Sol', empresa: 'tienda sol', inicioIso: '2026-11-12T15:00:00Z' }), '📅 **Mario** ha agendado una cita con **Tienda Sol** · jue, 12 nov, 16:00')

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones bien`)
if (fallos > 0) process.exit(1)
