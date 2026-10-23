import { extraerDireccionesFallidas, motivoDeRebote } from '@/lib/correo/verificacion/rebotes'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const propios = new Set(['libertyseller.es', 'libertyseller.com'])

const GMAIL = `Address not found
Your message wasn't delivered to ana@casaluz.es because the address couldn't be found, or is unable to receive mail.

The response from the remote server was:
550 5.1.1 The email account that you tried to reach does not exist. Please try double-checking the recipient's email address for typos.

----- Original message -----
From: Ana López <ana@libertyseller.es>
To: ana@casaluz.es
Subject: Casa Luz en Amazon`

const OUTLOOK = `Delivery has failed to these recipients or groups:

pepe@tiendapepe.com
The email address you entered couldn't be found. Check the recipient's email address and try to resend the message.

Diagnostic information for administrators:
Remote Server returned '550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup'`

const POSTFIX = `This is the mail system at host mx.libertyseller.es.
I'm sorry to have to inform you that your message could not be delivered to one or more recipients.

Reporting-MTA: dns; mx.libertyseller.es
Final-Recipient: rfc822; Info@Empresa-X.com
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 <info@empresa-x.com>: Recipient address rejected: User unknown in virtual mailbox table`

const SPAM = `Your message to jefe@grande.com was rejected.
The response from the remote server was:
550 5.7.1 Message rejected as spam by Content Filtering. Your IP is listed in Spamhaus.`

const LLENO = `Delivery to the following recipient failed permanently:
     jefe@pequena.es
552 5.2.2 The recipient's mailbox is full and can't accept messages now (over quota).`

console.log('\n=== por qué rebotó ===')
ok('Gmail: la dirección no existe (5.1.1)', motivoDeRebote(GMAIL) === 'inexistente')
ok('Outlook: dirección no encontrada (5.1.10)', motivoDeRebote(OUTLOOK) === 'inexistente')
ok('Postfix: usuario desconocido', motivoDeRebote(POSTFIX) === 'inexistente')
ok('un 5.7.1 por spam NO es una dirección inexistente: es que nos rechazan a nosotros', motivoDeRebote(SPAM) === 'rechazo_de_politica')
ok('buzón lleno (5.2.2): pasajero, no inexistente', motivoDeRebote(LLENO) === 'pasajero')
ok('un aviso sin pistas es desconocido', motivoDeRebote('Hubo un problema con tu mensaje.') === 'desconocido')
ok('en español también', motivoDeRebote('El usuario desconocido no existe en este servidor.') === 'inexistente')
ok('un 5.1.1 que además habla de política se fía del código', motivoDeRebote('550 5.1.1 user unknown. This policy forbids relaying.') === 'inexistente')

console.log('\n=== a quién no se pudo entregar ===')
ok('Gmail: la dirección que nombra, no la nuestra', extraerDireccionesFallidas(GMAIL, propios).join() === 'ana@casaluz.es')
ok('Outlook: la que va suelta', extraerDireccionesFallidas(OUTLOOK, propios).join() === 'pepe@tiendapepe.com')
ok('Postfix: la de Final-Recipient, en minúsculas', extraerDireccionesFallidas(POSTFIX, propios).join() === 'info@empresa-x.com')
ok('si no queda ninguna clara, no se adivina', extraerDireccionesFallidas('Hubo un problema. Escribe a soporte@proveedor.com o a ayuda@proveedor.com.', propios).length === 0)
ok('si solo hay direcciones nuestras o de servidores, ninguna', extraerDireccionesFallidas('From: ana@libertyseller.es\nmailer-daemon@googlemail.com postmaster@x.com', propios).length === 0)
ok('con varias en Final-Recipient, todas', extraerDireccionesFallidas('Final-Recipient: rfc822; a@x.com\nFinal-Recipient: rfc822; b@y.com', propios).join() === 'a@x.com,b@y.com')
ok('X-Failed-Recipients', extraerDireccionesFallidas('X-Failed-Recipients: c@z.es\n', propios).join() === 'c@z.es')
ok('lo que no es una dirección no cuenta', extraerDireccionesFallidas('Final-Recipient: rfc822; basura\n', propios).length === 0)

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
