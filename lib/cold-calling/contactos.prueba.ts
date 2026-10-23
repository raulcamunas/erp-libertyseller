import { anadirEmail, anadirTelefono, emailsDelLead, normalizarEmail, normalizarTelefono, telefonosDelLead } from '@/lib/cold-calling/contactos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const j = (x: unknown) => JSON.stringify(x)

console.log('\n=== normalizarTelefono ===')
ok('nueve cifras españolas -> +34', normalizarTelefono('600112233') === '+34600112233')
ok('con espacios', normalizarTelefono('600 11 22 33') === '+34600112233')
ok('con puntos', normalizarTelefono('600.112.233') === '+34600112233')
ok('un fijo', normalizarTelefono('948 31 07 60') === '+34948310760')
ok('el «.0» de un Excel se va', normalizarTelefono('653476608.0') === '+34653476608')
ok('con el +34 ya puesto', normalizarTelefono('+34 600 11 22 33') === '+34600112233')
ok('con 0034', normalizarTelefono('0034 600112233') === '+34600112233')
ok('sin el más pero con el 34', normalizarTelefono('34600112233') === '+34600112233')
ok('uno de fuera con prefijo se respeta', normalizarTelefono('+44 20 7946 0958') === '+442079460958')
ok('uno de fuera con 00', normalizarTelefono('0044 20 7946 0958') === '+442079460958')
ok('nueve cifras que no empiezan por 6-9 no se adivinan', normalizarTelefono('123456789') === null)
ok('muy corto: nada', normalizarTelefono('12345') === null)
ok('con letras: nada', normalizarTelefono('llamar mañana') === null)
ok('vacío o no es texto: nada', normalizarTelefono('') === null && normalizarTelefono(null) === null && normalizarTelefono(12) === null)
ok('un número de otro país sin prefijo no se adivina', normalizarTelefono('2079460958') === null)

console.log('\n=== normalizarEmail ===')
ok('un correo normal', normalizarEmail('info@empresa.es') === 'info@empresa.es')
ok('con espacios y mayúsculas', normalizarEmail('  Info@Empresa.ES ') === 'info@empresa.es')
ok('con mailto:', normalizarEmail('mailto:info@empresa.es') === 'info@empresa.es')
ok('sin arroba: nada', normalizarEmail('info.empresa.es') === null)
ok('sin dominio: nada', normalizarEmail('info@empresa') === null)
ok('dos correos juntos: nada (se añade uno cada vez)', normalizarEmail('a@b.es, c@d.es') === null)
ok('con espacio dentro: nada', normalizarEmail('in fo@empresa.es') === null)
ok('no es texto: nada', normalizarEmail(null) === null && normalizarEmail(5) === null)

console.log('\n=== todos los contactos de un lead ===')
ok('teléfonos: los de phone y luego los extra, sin repetidos',
  j(telefonosDelLead({ phone: '+34600112233', telefonos_extra: '+34 962 28 32 06; 600 11 22 33' })) === j(['+34600112233', '+34 962 28 32 06']), j(telefonosDelLead({ phone: '+34600112233', telefonos_extra: '+34 962 28 32 06; 600 11 22 33' })))
ok('teléfonos: «653476608.0» sale limpio', j(telefonosDelLead({ phone: '653476608.0', telefonos_extra: null })) === j(['653476608']))
ok('teléfonos: nada', j(telefonosDelLead({ phone: null, telefonos_extra: null })) === '[]')
ok('correos: el de email, los extra y sin repetir aunque cambien las mayúsculas',
  j(emailsDelLead({ email: 'info@x.es', emails_extra: 'ventas@x.es; INFO@x.es' })) === j(['info@x.es', 'ventas@x.es']))
ok('correos: un campo con varios', j(emailsDelLead({ email: 'a@x.es / b@x.es', emails_extra: null })) === j(['a@x.es', 'b@x.es']))
ok('correos: nada', j(emailsDelLead({ email: null, emails_extra: null })) === '[]')

console.log('\n=== añadir un teléfono ===')
{
  const sin = anadirTelefono({ phone: null, telefonos_extra: null }, '600 11 22 33')
  ok('sin teléfono: pasa a ser el principal', sin.ok && j(sin.campos) === j({ phone: '+34600112233' }))
  const uno = anadirTelefono({ phone: '+34931112244', telefonos_extra: null }, '600112233')
  ok('con uno: va al campo extra', uno.ok && j(uno.campos) === j({ telefonos_extra: '+34600112233' }))
  const dos = anadirTelefono({ phone: '+34931112244', telefonos_extra: '+34962283206' }, '600112233')
  ok('con extras: se añade al final con «; »', dos.ok && j(dos.campos) === j({ telefonos_extra: '+34962283206; +34600112233' }))
  const igual = anadirTelefono({ phone: '+34 600 11 22 33', telefonos_extra: null }, '600112233')
  ok('el mismo número escrito de otra forma: repetido', !igual.ok && igual.motivo === 'repetido')
  const enExtra = anadirTelefono({ phone: '+34931112244', telefonos_extra: '600.112.233' }, '+34600112233')
  ok('repetido también contra los extra', !enExtra.ok && enExtra.motivo === 'repetido')
  const malo = anadirTelefono({ phone: null, telefonos_extra: null }, 'abc')
  ok('algo que no es un teléfono: inválido', !malo.ok && malo.motivo === 'invalido')
  const conPuntoCero = anadirTelefono({ phone: '+34931112244', telefonos_extra: null }, '653476608.0')
  ok('con el «.0» de un Excel se guarda limpio', conPuntoCero.ok && j(conPuntoCero.campos) === j({ telefonos_extra: '+34653476608' }))
  const extraVacio = anadirTelefono({ phone: '+34931112244', telefonos_extra: '   ' }, '600112233')
  ok('un campo extra solo de espacios cuenta como vacío', extraVacio.ok && j(extraVacio.campos) === j({ telefonos_extra: '+34600112233' }))
}

console.log('\n=== añadir un correo ===')
{
  const sin = anadirEmail({ email: null, emails_extra: null }, 'Info@Tienda.es')
  ok('sin correo: pasa a ser el principal, en minúsculas', sin.ok && j(sin.campos) === j({ email: 'info@tienda.es' }))
  const uno = anadirEmail({ email: 'info@tienda.es', emails_extra: null }, 'ventas@tienda.es')
  ok('con uno: va al campo extra', uno.ok && j(uno.campos) === j({ emails_extra: 'ventas@tienda.es' }))
  const dos = anadirEmail({ email: 'info@tienda.es', emails_extra: 'a@tienda.es' }, 'ventas@tienda.es')
  ok('con extras: se añade al final', dos.ok && j(dos.campos) === j({ emails_extra: 'a@tienda.es; ventas@tienda.es' }))
  const igual = anadirEmail({ email: 'info@tienda.es', emails_extra: null }, ' INFO@tienda.es ')
  ok('el mismo, con otras mayúsculas: repetido', !igual.ok && igual.motivo === 'repetido')
  const enExtra = anadirEmail({ email: 'a@x.es', emails_extra: 'b@x.es; c@x.es' }, 'c@x.es')
  ok('repetido contra los extra', !enExtra.ok && enExtra.motivo === 'repetido')
  const malo = anadirEmail({ email: null, emails_extra: null }, 'no-es-un-correo')
  ok('inválido', !malo.ok && malo.motivo === 'invalido')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
