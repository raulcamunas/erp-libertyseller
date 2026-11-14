import { coincide, palabrasDe, resaltar, sinAcentos } from '@/lib/tareas-clientes/busqueda'

let fallos = 0
let comprobaciones = 0
const igual = (n: string, a: unknown, b: unknown) => {
  comprobaciones++
  const bien = JSON.stringify(a) === JSON.stringify(b)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(a)} y no ${JSON.stringify(b)}`}`)
}

igual('sin acentos ni mayúsculas', sinAcentos('Acción Éxito Niño'), 'accion exito nino')
igual('las palabras de lo buscado', palabrasDe('  Acción   legal '), ['accion', 'legal'])
igual('todas las palabras, en cualquier orden', coincide('Revisión de la Acción legal', 'legal accion'), true)
igual('si falta una, no', coincide('Revisión de la Acción legal', 'legal factura'), false)
igual('sin acento en lo buscado encuentra el texto con acento', coincide('Cumplimiento Normativo Alemán', 'aleman'), true)
igual('y al revés', coincide('Cumplimiento Normativo Aleman', 'alemán'), true)
igual('vacío no coincide con nada', coincide('lo que sea', '   '), false)

igual('resalta lo buscado conservando el texto original', resaltar('Revisión de la Acción', 'accion'), [{ texto: 'Revisión de la ', resaltado: false }, { texto: 'Acción', resaltado: true }])
igual('varias palabras', resaltar('Pedir la acción al cliente', 'pedir cliente').map((t) => [t.texto, t.resaltado]), [['Pedir', true], [' la acción al ', false], ['cliente', true]])
igual('sin coincidencias, un solo trozo', resaltar('hola', 'zzz'), [{ texto: 'hola', resaltado: false }])
igual('texto vacío', resaltar('', 'a'), [{ texto: '', resaltado: false }])
igual('lo juntado vuelve a dar el texto', resaltar('Niño y niña ñu', 'nin').map((t) => t.texto).join(''), 'Niño y niña ñu')

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones`)
if (fallos > 0) process.exit(1)
