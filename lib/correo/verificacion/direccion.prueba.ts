import { analizarDireccion, corregirDominio, distancia, limpiarDireccion } from '@/lib/correo/verificacion/direccion'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const codigos = (t: string): string => analizarDireccion(t).problemas.map((p) => `${p.codigo}:${p.gravedad}`).join(',')
const tiene = (t: string, codigo: string): boolean => analizarDireccion(t).problemas.some((p) => p.codigo === codigo)
const limpia = (t: string): boolean => analizarDireccion(t).problemas.filter((p) => p.gravedad !== 'info').length === 0

console.log('\n=== direcciones buenas ===')
for (const d of ['ana@tienda.es', 'Ana.Lopez@Casa-Luz.com', 'ventas+pedidos@empresa.com.mx', 'a@b.co', 'jose_maria@mi-tienda-online.shop', "o'brien@irish.ie", 'ana@xn--tienda-9za.es', 'ana@sub.dominio.empresa.es', 'x.y.z@a.es']) {
  ok(`«${d}»`, limpia(d), codigos(d))
}
ok('se limpia: minúsculas, sin espacios, sin mailto: ni < >', analizarDireccion('  <MAILTO:Ana@Tienda.ES> ').direccion === 'ana@tienda.es' && limpiarDireccion('mailto:ANA@x.es') === 'ana@x.es')
ok('se reconoce el proveedor libre', analizarDireccion('pepe@gmail.com').esProveedorLibre && !analizarDireccion('pepe@tienda.es').esProveedorLibre)
ok('un dominio con letras de otro alfabeto se pasa a punycode', analizarDireccion('ana@tiendañ.es').dominio.startsWith('xn--') && limpia('ana@tiendañ.es'))

console.log('\n=== direcciones mal escritas ===')
const malas: Array<[string, string]> = [
  ['', 'vacia'],
  ['   ', 'vacia'],
  ['ana', 'sintaxis'],
  ['ana@', 'sin_dominio'],
  ['@tienda.es', 'sintaxis'],
  ['ana@@tienda.es', 'sintaxis'],
  ['ana@tienda', 'dominio_sin_punto'],
  ['ana@tienda..es', 'dominio_no_valido'],
  ['ana@.tienda.es', 'dominio_no_valido'],
  ['ana@tienda.es.', 'dominio_no_valido'],
  ['ana@-tienda.es', 'dominio_no_valido'],
  ['ana@tienda-.es', 'dominio_no_valido'],
  ['ana@tien da.es', 'sintaxis'],
  ['an a@tienda.es', 'sintaxis'],
  ['ana@tienda.e', 'extension_no_valida'],
  ['ana@tienda.123', 'extension_no_valida'],
  ['.ana@tienda.es', 'sintaxis'],
  ['ana.@tienda.es', 'sintaxis'],
  ['an..a@tienda.es', 'sintaxis'],
  ['ana(1)@tienda.es', 'sintaxis'],
  ['ana@tienda.es,otra@x.es', 'sintaxis'],
  [`${'a'.repeat(65)}@tienda.es`, 'local_largo'],
  [`ana@${'a'.repeat(64)}.es`, 'dominio_no_valido'],
]
for (const [d, codigo] of malas) {
  const t = d.trim() === '' ? 'vacío' : d.length > 40 ? `${d.slice(0, 20)}…` : d
  ok(`«${t}» -> ${codigo}`, tiene(d, codigo) && analizarDireccion(d).problemas.some((p) => p.gravedad === 'mala'), codigos(d))
}

console.log('\n=== lo que se sabe de ella ===')
ok('un correo desechable es malo', tiene('x@mailinator.com', 'desechable') && analizarDireccion('x@yopmail.com').problemas[0].gravedad === 'mala')
for (const l of ['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster', 'abuse']) ok(`«${l}@» no lo lee nadie`, tiene(`${l}@tienda.es`, 'no_responde'))
ok('un dominio de ejemplo no existe', tiene('ana@example.com', 'dominio_de_ejemplo') && tiene('ana@miempresa.test', 'dominio_de_ejemplo') && tiene('ana@ejemplo.es', 'dominio_de_ejemplo'))
ok('las direcciones genéricas se avisan sin penalizar', tiene('info@tienda.es', 'generica') && analizarDireccion('info@tienda.es').problemas.every((p) => p.gravedad === 'info') && limpia('contacto@tienda.es'))
ok('un nombre de relleno es dudoso', tiene('prueba@tienda.es', 'parece_inventada') && tiene('nombre@gmail.com', 'parece_inventada') && analizarDireccion('test@tienda.es').problemas[0].gravedad === 'dudosa')
ok('letras con acento antes de la @: dudosa, no mala', tiene('josé@tienda.es', 'caracteres_no_ascii') && analizarDireccion('josé@tienda.es').problemas.every((p) => p.gravedad !== 'mala'))

console.log('\n=== erratas de proveedores ===')
for (const [mal, bien] of [['gmial.com', 'gmail.com'], ['gmail.con', 'gmail.com'], ['gmail.es', 'gmail.com'], ['hotmial.com', 'hotmail.com'], ['hotmail.ez', 'hotmail.es'], ['outlok.com', 'outlook.com'], ['yaho.es', 'yahoo.es'], ['iclod.com', 'icloud.com'], ['gmaul.com', 'gmail.com'], ['hotmaul.com', 'hotmail.com']]) {
  const a = analizarDireccion(`pepe@${mal}`)
  ok(`${mal} -> ${bien}`, a.sugerencia === `pepe@${bien}` && a.problemas.some((p) => p.codigo === 'errata_de_dominio' && p.gravedad === 'dudosa'), JSON.stringify(a.sugerencia))
}
ok('un proveedor bien escrito no es una errata', corregirDominio('gmail.com') === null && corregirDominio('hotmail.es') === null)
for (const d of ['tienda.es', 'casaluz.com', 'mail.es', 'gmx.net', 'live.com', 'msn.com', 'empresa-gmail.com', 'mygmail.es', 'tiendagmail.com']) ok(`un dominio normal como ${d} no se toma por errata`, corregirDominio(d) === null, String(corregirDominio(d)))
ok('la distancia de edición', distancia('gmail', 'gmial') === 1 && distancia('gmail', 'gmail') === 0 && distancia('abc', 'abcd') === 1 && distancia('abc', 'xyz') === 3 && distancia('gmail.com', 'gmaul.com') === 1)

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
