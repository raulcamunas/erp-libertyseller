import { clasificarEntrante, lecturaDelBuzon, type EntranteParaControl } from '@/lib/correo/secuencias/respuestas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const PRIMERO = Date.UTC(2026, 9, 23, 9, 0)
const S = { destinatario: 'Ana@Tienda.es', hiloId: 'hilo-1', primerEnvioAt: PRIMERO }
const msg = (o: Partial<EntranteParaControl>): EntranteParaControl => ({ id: 'm', hiloId: null, deDireccion: 'ana@tienda.es', asunto: 'Re: hola', texto: 'Gracias', fecha: PRIMERO + 3600_000, automatico: false, ...o })

console.log('\n=== quién contesta ===')
{
  ok('la misma dirección (sin mirar mayúsculas)', clasificarEntrante(msg({}), S) === 'respuesta')
  ok('otra persona de la misma empresa (dominio propio)', clasificarEntrante(msg({ deDireccion: 'info@tienda.es' }), S) === 'respuesta')
  ok('uno de gmail que no es el destinatario: no se sabe de quién es', clasificarEntrante(msg({ deDireccion: 'luis@gmail.com' }), { ...S, destinatario: 'ana@gmail.com', hiloId: null }) === 'ajeno')
  ok('pero si contesta dentro del hilo, sí', clasificarEntrante(msg({ deDireccion: 'luis@gmail.com', hiloId: 'hilo-1' }), { ...S, destinatario: 'ana@gmail.com' }) === 'respuesta')
  ok('de otra empresa y de otro hilo: ajeno', clasificarEntrante(msg({ deDireccion: 'pedido@amazon.es', hiloId: 'otro' }), S) === 'ajeno')
  ok('lo que entró antes del primer correo no cuenta', clasificarEntrante(msg({ fecha: PRIMERO - 1000 }), S) === 'ajeno')
  ok('sin hilo conocido, solo cuenta por dirección', clasificarEntrante(msg({ deDireccion: 'otro@fuera.es', hiloId: 'x' }), { ...S, hiloId: null }) === 'ajeno')
}

console.log('\n=== rebotes ===')
{
  const rebote = (texto: string, o: Partial<EntranteParaControl> = {}) => msg({ deDireccion: 'MAILER-DAEMON@hostinger.com', asunto: 'Undelivered Mail Returned to Sender', automatico: true, texto, ...o })
  ok('dirección que no existe (550 5.1.1): duro', clasificarEntrante(rebote('The following address failed: ana@tienda.es\n550 5.1.1 User unknown'), S) === 'rebote_duro')
  ok('con el texto en español', clasificarEntrante(rebote('No se ha podido entregar a ana@tienda.es: el usuario no existe'), S) === 'rebote_duro')
  ok('buzón lleno (aunque lleve un 5.2.2): blando', clasificarEntrante(rebote('ana@tienda.es: 552 5.2.2 Mailbox full'), S) === 'rebote_blando')
  ok('código 4.x.x: blando', clasificarEntrante(rebote('ana@tienda.es: 451 4.7.1 try again later'), S) === 'rebote_blando')
  ok('un aviso de retraso: blando', clasificarEntrante(rebote('Still trying to deliver to ana@tienda.es', { asunto: 'Delivery Status Notification (Delay)' }), S) === 'rebote_blando')
  ok('un rebote sin explicación: se da por duro', clasificarEntrante(rebote('Failure delivering to ana@tienda.es'), S) === 'rebote_duro')
  ok('un rebote de OTRO destinatario no es de esta secuencia', clasificarEntrante(rebote('The following address failed: otro@empresa.es\n550 5.1.1 User unknown'), { ...S, hiloId: null }) === 'automatico_otro')
  ok('pero si cuelga del hilo del correo, sí aunque no nombre la dirección', clasificarEntrante(rebote('550 5.1.1 User unknown', { hiloId: 'hilo-1' }), S) === 'rebote_duro')
  ok('Postmaster también cuenta como remitente de rebotes', clasificarEntrante(rebote('ana@tienda.es 550 5.1.1', { deDireccion: 'postmaster@tienda.es' }), S) === 'rebote_duro')
}

console.log('\n=== fuera de oficina y otros avisos ===')
{
  ok('la respuesta automática de la misma dirección', clasificarEntrante(msg({ automatico: true, asunto: 'Respuesta automática: de vacaciones' }), S) === 'fuera_de_oficina')
  ok('o de otra del mismo dominio propio', clasificarEntrante(msg({ automatico: true, deDireccion: 'info@tienda.es' }), S) === 'fuera_de_oficina')
  ok('un aviso automático de otro remitente se ignora', clasificarEntrante(msg({ automatico: true, deDireccion: 'no-reply@amazon.es', asunto: 'Tu pedido' }), S) === 'automatico_otro')
}

console.log('\n=== lo más importante primero ===')
{
  const lista: EntranteParaControl[] = [
    msg({ id: 'ooo', automatico: true, fecha: PRIMERO + 1000 }),
    msg({ id: 'rebote', automatico: true, deDireccion: 'mailer-daemon@x.com', asunto: 'Undelivered Mail Returned to Sender', texto: 'ana@tienda.es 550 5.1.1', fecha: PRIMERO + 2000 }),
    msg({ id: 'respuesta-2', fecha: PRIMERO + 9000 }),
    msg({ id: 'respuesta-1', fecha: PRIMERO + 5000 }),
    msg({ id: 'ruido', deDireccion: 'factura@proveedor.es', fecha: PRIMERO + 100 }),
  ]
  const r = lecturaDelBuzon(lista, S)
  ok('una respuesta manda sobre un rebote y un fuera de oficina, y sale la primera que llegó', r?.clase === 'respuesta' && r.mensaje.id === 'respuesta-1')
  ok('sin respuesta, el rebote manda sobre el fuera de oficina', lecturaDelBuzon(lista.slice(0, 2), S)?.clase === 'rebote_duro')
  ok('solo fuera de oficina', lecturaDelBuzon(lista.slice(0, 1), S)?.clase === 'fuera_de_oficina')
  ok('nada que ver: null', lecturaDelBuzon([lista[4]], S) === null && lecturaDelBuzon([], S) === null)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
