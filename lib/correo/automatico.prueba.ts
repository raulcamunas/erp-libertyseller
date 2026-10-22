import { esAutomatico } from '@/lib/correo/automatico'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** AUTOMÁTICO: personas contra máquinas. */

const persona = { deDireccion: 'carmen@cliente.es' }

ok('una persona normal no es automática', !esAutomatico(persona))
ok('Auto-Submitted: auto-replied', esAutomatico({ ...persona, autoSubmitted: 'auto-replied' }))
ok('Auto-Submitted: auto-generated', esAutomatico({ ...persona, autoSubmitted: 'auto-generated' }))
ok('Auto-Submitted: no es una persona', !esAutomatico({ ...persona, autoSubmitted: 'no' }))
ok('Auto-Submitted: No (mayúsculas)', !esAutomatico({ ...persona, autoSubmitted: ' No ' }))
ok('Precedence: bulk', esAutomatico({ ...persona, precedence: 'bulk' }))
ok('Precedence: list', esAutomatico({ ...persona, precedence: 'List' }))
ok('Precedence: first-class no es automática', !esAutomatico({ ...persona, precedence: 'first-class' }))
ok('List-Id', esAutomatico({ ...persona, listId: '<novedades.amazon.es>' }))
ok('List-Unsubscribe', esAutomatico({ ...persona, listUnsubscribe: '<mailto:baja@x.es>' }))
ok('X-Auto-Response-Suppress', esAutomatico({ ...persona, autoResponseSuppress: 'All' }))
ok('X-Autoreply', esAutomatico({ ...persona, xAutoreply: 'yes' }))
ok('Return-Path vacío (un rebote)', esAutomatico({ ...persona, returnPath: '<>' }))
ok('Return-Path normal', !esAutomatico({ ...persona, returnPath: '<carmen@cliente.es>' }))
ok('no-reply', esAutomatico({ deDireccion: 'no-reply@amazon.es' }))
ok('noreply', esAutomatico({ deDireccion: 'noreply@liberty.es' }))
ok('no_reply', esAutomatico({ deDireccion: 'no_reply@liberty.es' }))
ok('donotreply', esAutomatico({ deDireccion: 'donotreply@paypal.com' }))
ok('do-not-reply', esAutomatico({ deDireccion: 'do-not-reply@x.com' }))
ok('mailer-daemon', esAutomatico({ deDireccion: 'mailer-daemon@googlemail.com' }))
ok('postmaster', esAutomatico({ deDireccion: 'postmaster@x.es' }))
ok('notifications', esAutomatico({ deDireccion: 'notifications@github.com' }))
ok('notificaciones con sufijo', esAutomatico({ deDireccion: 'notificaciones+ana@x.es' }))
ok('no-reply con sufijo', esAutomatico({ deDireccion: 'no-reply.7f3a@x.es' }))
ok('bounces', esAutomatico({ deDireccion: 'bounces+123@mail.x.es' }))
ok('info@ es una persona', !esAutomatico({ deDireccion: 'info@cliente.es' }))
ok('ventas@ es una persona', !esAutomatico({ deDireccion: 'ventas@cliente.es' }))
ok('un nombre que empieza como no-reply pero es otra cosa', !esAutomatico({ deDireccion: 'noreplyto@cliente.es' }))
ok('alertas que son de una persona', !esAutomatico({ deDireccion: 'alertaria@cliente.es' }))
ok('una dirección sin arroba no rompe', !esAutomatico({ deDireccion: 'rarisimo' }))
ok('vacío', !esAutomatico({ deDireccion: '' }))

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
