import { DIAS_POR_DEFECTO, PREAJUSTES, diasDeHistoricoValidos, esNombreDeServidor, proveedorPorMx, validarServidor } from '@/lib/correo/proveedores'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (n: string, real: unknown, esperado: unknown) => ok(n, JSON.stringify(real) === JSON.stringify(esperado), `real ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`)

/** PROVEEDORES: a qué servidores se conecta un buzón y qué servidores se aceptan. */

console.log('preajustes')
igual('Hostinger IMAP', PREAJUSTES.hostinger.imap, { host: 'imap.hostinger.com', puerto: 993, seguro: true })
igual('Hostinger SMTP', PREAJUSTES.hostinger.smtp, { host: 'smtp.hostinger.com', puerto: 465, seguro: true })
igual('Titan IMAP', PREAJUSTES.titan.imap, { host: 'imap.titan.email', puerto: 993, seguro: true })
igual('Titan SMTP', PREAJUSTES.titan.smtp, { host: 'smtp.titan.email', puerto: 465, seguro: true })

console.log('proveedorPorMx')
igual('Hostinger', proveedorPorMx(['mx1.hostinger.com', 'mx2.hostinger.com']), 'hostinger')
igual('Hostinger con punto final y mayúsculas', proveedorPorMx(['MX1.Hostinger.com.']), 'hostinger')
igual('Hostinger en otro dominio nacional', proveedorPorMx(['mx1.hostinger.es']), 'hostinger')
igual('Titan', proveedorPorMx(['mx1.titan.email', 'mx2.titan.email']), 'titan')
igual('Google', proveedorPorMx(['aspmx.l.google.com', 'alt1.aspmx.l.google.com']), 'google')
igual('Microsoft', proveedorPorMx(['liberty-es.mail.protection.outlook.com']), 'microsoft')
igual('otro', proveedorPorMx(['mail.midominio.es']), null)
igual('un dominio que solo contiene la palabra no cuenta', proveedorPorMx(['mx.nohostinger.com.evil.es']), null)
igual('una mezcla: gana Titan (el MX de Hostinger que revende Titan)', proveedorPorMx(['mx1.titan.email', 'mx1.hostinger.com']), 'titan')
igual('sin MX', proveedorPorMx([]), null)

console.log('servidores personalizados')
ok('un nombre de servidor normal', esNombreDeServidor('imap.midominio.es'))
ok('no vale localhost', !esNombreDeServidor('localhost'))
ok('no vale una IP', !esNombreDeServidor('192.168.1.10'))
ok('no vale una IP pública', !esNombreDeServidor('8.8.8.8'))
ok('no vale .local', !esNombreDeServidor('impresora.local'))
ok('no vale .internal', !esNombreDeServidor('metadata.google.internal'))
ok('no vale con espacios', !esNombreDeServidor('imap. midominio.es'))
ok('no vale con puerto dentro', !esNombreDeServidor('imap.midominio.es:993'))
ok('no vale con barra', !esNombreDeServidor('imap.midominio.es/x'))
ok('no vale un solo nombre', !esNombreDeServidor('imap'))
ok('no vale si no es texto', !esNombreDeServidor(5))
igual('IMAP 993 es TLS directo', validarServidor({ host: 'Imap.MiDominio.es', puerto: 993 }, 'imap'), { host: 'imap.midominio.es', puerto: 993, seguro: true })
igual('IMAP 143 es STARTTLS', validarServidor({ host: 'imap.midominio.es', puerto: 143 }, 'imap'), { host: 'imap.midominio.es', puerto: 143, seguro: false })
igual('SMTP 465 es TLS directo', validarServidor({ host: 'smtp.midominio.es', puerto: '465' }, 'smtp'), { host: 'smtp.midominio.es', puerto: 465, seguro: true })
igual('SMTP 587 es STARTTLS', validarServidor({ host: 'smtp.midominio.es', puerto: 587 }, 'smtp'), { host: 'smtp.midominio.es', puerto: 587, seguro: false })
igual('el 25 no se acepta', validarServidor({ host: 'smtp.midominio.es', puerto: 25 }, 'smtp'), null)
igual('un puerto de base de datos no se acepta', validarServidor({ host: 'imap.midominio.es', puerto: 5432 }, 'imap'), null)
igual('un puerto de IMAP en SMTP no se acepta', validarServidor({ host: 'smtp.midominio.es', puerto: 993 }, 'smtp'), null)
igual('sin puerto', validarServidor({ host: 'imap.midominio.es' }, 'imap'), null)
igual('con host de loopback', validarServidor({ host: 'localhost', puerto: 993 }, 'imap'), null)
igual('no es un objeto', validarServidor('imap.x.es', 'imap'), null)

console.log('histórico')
igual('60 por defecto', diasDeHistoricoValidos(undefined), DIAS_POR_DEFECTO)
igual('90 vale', diasDeHistoricoValidos(90), 90)
igual('«365» como texto vale', diasDeHistoricoValidos('365'), 365)
igual('7 no vale', diasDeHistoricoValidos(7), DIAS_POR_DEFECTO)
igual('un millón no vale', diasDeHistoricoValidos(1_000_000), DIAS_POR_DEFECTO)

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
