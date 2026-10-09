/**
 * LA CONEXIÓN CON PRESTASHOP, SIN NINGUNA TIENDA DELANTE.
 *
 *   npx tsx lib/prestashop/prestashop.prueba.ts
 */
import { claveValida, normalizarUrlTienda } from './url'
import {
  cantidadDe,
  eanValido,
  extraerLista,
  mensajeDeEstado,
  pareceHtml,
  recursosPermitidos,
  resumenEan,
} from './respuesta'

let fallos = 0
function ok(que: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${que}${bien ? '' : `  (${JSON.stringify(real)} != ${JSON.stringify(esperado)})`}`)
}
const url = (e: string) => {
  const r = normalizarUrlTienda(e)
  return r.ok ? r.url : `RECHAZADA: ${r.motivo}`
}
const rechaza = (e: string) => !normalizarUrlTienda(e).ok

console.log('\n=== LA DIRECCIÓN DE LA TIENDA: LO QUE SE ACEPTA, Y CÓMO SE DEJA ===')
ok('una tienda normal', url('https://tienda.com'), 'https://tienda.com')
ok('sin https: se completa', url('tienda.com'), 'https://tienda.com')
ok('con barra final', url('https://tienda.com/'), 'https://tienda.com')
ok('con /api copiado del manual', url('https://tienda.com/api'), 'https://tienda.com')
ok('con /api/ y barra', url('https://tienda.com/api/'), 'https://tienda.com')
ok('con www', url('https://www.tienda.com'), 'https://www.tienda.com')
ok('mayúsculas en el dominio', url('https://TIENDA.com'), 'https://tienda.com')
ok('tienda en una carpeta se conserva', url('https://tienda.com/shop'), 'https://tienda.com/shop')
ok('carpeta + /api', url('https://tienda.com/shop/api/'), 'https://tienda.com/shop')
ok('quita la consulta', url('https://tienda.com/?ws_key=ABC'), 'https://tienda.com')
ok('quita el ancla', url('https://tienda.com/#algo'), 'https://tienda.com')
ok('con espacios alrededor', url('  https://tienda.com  '), 'https://tienda.com')
ok('subdominio', url('https://shop.mi-tienda.es'), 'https://shop.mi-tienda.es')

// LA DIRECCIÓN DEL PANEL, que es lo que se pega sin querer. Es la de ShoesF de
// verdad (sin el token de sesión): lo que hay que quedarse es la tienda.
ok(
  'la dirección DEL PANEL se queda en la tienda',
  url('https://www.zapateriasbsc.com/admin477nh099c/index.php/configure/advanced/webservice-keys/?_token=XXXX'),
  'https://www.zapateriasbsc.com'
)
ok('panel con index.php suelto', url('https://tienda.com/index.php'), 'https://tienda.com')
ok('carpeta admin sola', url('https://tienda.com/admin123abc'), 'https://tienda.com')
ok('tienda en carpeta + panel', url('https://tienda.com/shop/admin999/index.php?controller=x'), 'https://tienda.com/shop')
ok('una carpeta que NO es del panel se conserva', url('https://tienda.com/tienda-online'), 'https://tienda.com/tienda-online')
ok('«administracion» al principio también es panel', url('https://tienda.com/administracion/x'), 'https://tienda.com')

console.log('\n=== LO QUE NO SE ACEPTA: http, IP, interno, credenciales ===')
ok('http se rechaza (la clave iría en claro)', rechaza('http://tienda.com'), true)
ok('vacío', rechaza(''), true)
ok('solo espacios', rechaza('   '), true)
ok('basura', rechaza('esto no es una url'), true)
ok('ftp', rechaza('ftp://tienda.com'), true)
for (const ip of ['https://127.0.0.1', 'https://10.0.0.5', 'https://192.168.1.10', 'https://169.254.169.254', 'https://8.8.8.8', 'https://[::1]']) {
  ok(`IP literal ${ip}`, rechaza(ip), true)
}
for (const h of ['https://localhost', 'https://miservidor', 'https://base.internal', 'https://impresora.local', 'https://x.localhost', 'https://router.lan']) {
  ok(`host interno ${h}`, rechaza(h), true)
}
ok('con usuario y contraseña en la dirección', rechaza('https://usuario:clave@tienda.com'), true)
ok('con puerto', rechaza('https://tienda.com:8443'), true)
ok('con puerto 443 explícito también se rechaza... o se quita', normalizarUrlTienda('https://tienda.com:443').ok, true)

console.log('\n=== LA CLAVE ===')
ok('32 caracteres alfanuméricos', claveValida('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'), true)
ok('con espacios alrededor se acepta', claveValida('  ABCDEFGHIJKLMNOPQRSTUVWXYZ012345  '), true)
ok('demasiado corta', claveValida('ABC123'), false)
ok('vacía', claveValida(''), false)
ok('con símbolos', claveValida('ABCDEFGHIJKLMNOPQRSTUVWXYZ01234!'), false)
ok('con un espacio en medio', claveValida('ABCDEFGHIJKLMNOP QRSTUVWXYZ012345'), false)

console.log('\n=== QUÉ RECURSOS PUEDE LEER LA CLAVE (la raíz de /api/) ===')
ok('forma plana', recursosPermitidos({ products: {}, combinations: {}, stock_availables: {} }), ['products', 'combinations', 'stock_availables'])
ok('dentro de un «api»', recursosPermitidos({ api: { products: {}, customers: {} } }), ['products', 'customers'])
ok('ignora lo que empieza por @ o _', recursosPermitidos({ '@attributes': {}, products: {} }), ['products'])
ok('vacío -> ninguno', recursosPermitidos({}), [])
ok('null -> ninguno', recursosPermitidos(null), [])
ok('texto -> ninguno', recursosPermitidos('hola'), [])

console.log('\n=== LISTAS DE FILAS ===')
ok('lista normal', extraerLista({ stock_availables: [{ id: '1' }, { id: '2' }] }, 'stock_availables').length, 2)
ok('lista vacía como []', extraerLista({ stock_availables: [] }, 'stock_availables'), [])
ok('lista vacía como {}', extraerLista({ stock_availables: {} }, 'stock_availables'), [])
ok('recurso que no está', extraerLista({ otra: [{ id: 1 }] }, 'stock_availables'), [])
ok('basura', extraerLista(null, 'stock_availables'), [])
ok('filas que no son objetos se descartan', extraerLista({ x: [1, 'a', { id: 1 }] }, 'x').length, 1)

console.log('\n=== EAN Y CANTIDADES ===')
ok('EAN-13', eanValido('8435668577885'), true)
ok('EAN-8', eanValido('12345670'), true)
ok('vacío NO es un EAN', eanValido(''), false)
ok('con letras', eanValido('84356685ABC85'), false)
ok('un número (no cadena) no cuenta', eanValido(8435668577885), false)
ok('resumen de EAN', resumenEan([{ ean13: '8435668577885' }, { ean13: '' }, { ean13: '8445472944322' }, {}]), { total: 4, conEan: 2 })
ok('cantidad "12" -> 12', cantidadDe('12'), 12)
ok('cantidad "-3" se conserva con su signo', cantidadDe('-3'), -3)
ok('cantidad "" NO es cero', cantidadDe(''), null)
ok('cantidad "hola" NO es cero', cantidadDe('hola'), null)
ok('cantidad null NO es cero', cantidadDe(null), null)
ok('cantidad 0 -> 0', cantidadDe('0'), 0)

console.log('\n=== QUÉ SE LE DICE A UNA PERSONA CUANDO LA TIENDA CONTESTA MAL ===')
ok('401 habla de la clave', /clave/i.test(mensajeDeEstado(401, '')), true)
ok('403 habla de permisos', /permiso/i.test(mensajeDeEstado(403, '')), true)
ok('404 dice que no es la dirección del panel', /administración/i.test(mensajeDeEstado(404, '')), true)
ok('503 dice dónde se activa', /Webservice/.test(mensajeDeEstado(503, '')), true)
ok('el cuerpo «webservice is disabled» se reconoce', /desactivado/i.test(mensajeDeEstado(200, 'The PrestaShop webservice is disabled')), true)
ok('301 dice a dónde', /https:\/\/www\.tienda\.com/.test(mensajeDeEstado(301, '', 'https://www.tienda.com')), true)
ok('301 sin destino sigue siendo útil', /redirige/i.test(mensajeDeEstado(302, '', null)), true)
ok('429', /limitando/i.test(mensajeDeEstado(429, '')), true)
ok('500', /500/.test(mensajeDeEstado(500, '')), true)
ok('una página HTML se reconoce', pareceHtml('<!DOCTYPE html><html>'), true)
ok('con espacios delante', pareceHtml('  \n<html lang="es">'), true)
ok('JSON NO es html', pareceHtml('{"products":{}}'), false)

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
