import { etiquetaDeControl } from '@/lib/actividad/cliente'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const c = (parte: Partial<Parameters<typeof etiquetaDeControl>[0]>) => etiquetaDeControl({ aria: null, title: null, texto: null, dentroDeTabla: false, ...parte })

console.log('\n=== el nombre de un botón ===')
ok('su texto, si es corto', c({ texto: 'Guardar' }) === 'Guardar')
ok('el aria-label manda sobre el texto', c({ aria: 'Cerrar sesión', texto: 'X' }) === 'Cerrar sesión')
ok('el title si no hay aria-label', c({ title: 'Enviar correo', texto: '' }) === 'Enviar correo')
ok('un botón de solo icono sin nombre: nada', c({ texto: '' }) === null && c({ texto: '   ' }) === null && c({ texto: null }) === null)
ok('un texto de varias líneas es una fila de lista: nada', c({ texto: 'Tienda Luna\nEspaña · 24 k$' }) === null)
ok('un texto largo es contenido: nada', c({ texto: 'Este es un texto larguísimo que no es el nombre de ningún botón' }) === null)
ok('un correo en el botón se oculta', c({ texto: 'juan@x.com' }) === '(dato oculto)')
ok('un teléfono en el botón se oculta', c({ texto: '600 123 456' }) === '(dato oculto)')

console.log('\n=== dentro de una tabla ===')
ok('el texto visible NO vale (es contenido de la tabla)', c({ texto: 'Editar', dentroDeTabla: true }) === null)
ok('pero una etiqueta declarada sí (un botón de icono «Eliminar»)', c({ aria: 'Eliminar', texto: '', dentroDeTabla: true }) === 'Eliminar')
ok('y un title también', c({ title: 'Ver detalle', dentroDeTabla: true }) === 'Ver detalle')

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
