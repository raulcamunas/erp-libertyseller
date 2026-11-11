import { avisoDeCorreo, buzonVigilado, casosDelCorreo, nombraElCaso, normalizarIdDeCaso, ordenarCasos } from './casos'

let fallos = 0
const ok = (n: string, bien: boolean) => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${n}`)
}

ok('un ID normal', normalizarIdDeCaso('17123456781') === '17123456781')
ok('con espacios, guiones y #', normalizarIdDeCaso(' #171-2345 6781 ') === '17123456781')
ok('como número', normalizarIdDeCaso(17123456781) === '17123456781')
ok('con letras no vale', normalizarIdDeCaso('CASO123456') === null)
ok('demasiado corto no vale', normalizarIdDeCaso('12345') === null)
ok('vacío no vale', normalizarIdDeCaso('') === null && normalizarIdDeCaso(null) === null)

ok('en el asunto entre corchetes', nombraElCaso('[ID del caso 17123456781] Tu caso se ha actualizado', '17123456781'))
ok('al final del texto', nombraElCaso('Gracias. Caso: 17123456781', '17123456781'))
ok('dentro de un número más largo no cuenta', !nombraElCaso('Pedido 171234567812', '17123456781'))
ok('con una cifra delante tampoco', !nombraElCaso('917123456781', '17123456781'))
ok('si aparece dos veces y la segunda vale, cuenta', nombraElCaso('9171234567810 y luego 17123456781.', '17123456781'))
ok('texto vacío', !nombraElCaso(null, '17123456781'))

const casos = [{ id: 'a', casoAmazon: '17123456781' }, { id: 'b', casoAmazon: '18000000000' }]
ok('el correo va a su caso', casosDelCorreo({ asunto: 'Re: caso 17123456781', texto: null }, casos).map((c) => c.id).join() === 'a')
ok('por el texto también', casosDelCorreo({ asunto: 'Actualización', texto: 'Respecto al caso 18000000000…' }, casos).map((c) => c.id).join() === 'b')
ok('un correo sin caso no va a ninguno', casosDelCorreo({ asunto: 'Novedades de Amazon', texto: 'nada' }, casos).length === 0)

ok('sin elegir, se vigila business@', buzonVigilado({ id: '1', direccion: 'Business@empresa.com' }, []))
ok('sin elegir, otro no', !buzonVigilado({ id: '2', direccion: 'stock@empresa.es' }, []))
ok('con elegidos, solo esos', buzonVigilado({ id: '2', direccion: 'stock@empresa.es' }, ['2']) && !buzonVigilado({ id: '1', direccion: 'business@empresa.com' }, ['2']))

const orden = ordenarCasos([
  { id: 'r', estado: 'resuelto' as const, actualizadoEn: '2026-11-11T10:00:00Z', ultimoCorreoEn: null },
  { id: 'e', estado: 'esperando_amazon' as const, actualizadoEn: '2026-11-10T10:00:00Z', ultimoCorreoEn: null },
  { id: 'a1', estado: 'abierto' as const, actualizadoEn: '2026-11-01T10:00:00Z', ultimoCorreoEn: '2026-11-11T09:00:00Z' },
  { id: 'a2', estado: 'abierto' as const, actualizadoEn: '2026-11-05T10:00:00Z', ultimoCorreoEn: null },
])
ok('abiertos primero, con el correo más reciente arriba; resueltos al final', orden.map((c) => c.id).join() === 'a1,a2,e,r')

const aviso = avisoDeCorreo({ cliente: 'Creative Toys', casoAmazon: '17123456781' })
ok('el aviso es una línea: cliente, caso y «ha llegado un correo»', aviso === '📨 **Creative Toys · caso 17123456781**: ha llegado un correo')

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
