import { bloqueNuevo, huellaDeContenido, type Bloque } from '@/lib/tareas-clientes/bloques'
import { cuerpoParaRestaurar, MINUTOS_ENTRE_VERSIONES, resumirVersion, tocaGuardarVersion } from '@/lib/tareas-clientes/historial'

let fallos = 0
let comprobaciones = 0
function igual(nombre: string, real: unknown, esperado: unknown) {
  comprobaciones += 1
  const a = JSON.stringify(real)
  const b = JSON.stringify(esperado)
  const bien = a === b
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${nombre}${bien ? '' : ` → ${a}, esperaba ${b}`}`)
}

const p = (texto: string, extra: Partial<Bloque> = {}): Bloque => ({ ...bloqueNuevo('parrafo', texto), ...extra })
const ahora = new Date('2026-11-08T12:00:00Z')
const haceMin = (m: number) => new Date(ahora.getTime() - m * 60_000).toISOString()

const cuerpo = [p('Hola mundo'), p('segunda línea')]
igual('resumen: bloques, palabras y extracto', resumirVersion(cuerpo), { bloques: 2, palabras: 4, extracto: 'Hola mundo segunda línea' })
igual('resumen de un cuerpo vacío', resumirVersion([]), { bloques: 0, palabras: 0, extracto: '' })

igual('un cuerpo vacío no se guarda', tocaGuardarVersion([], null, ahora), false)
igual('un párrafo en blanco tampoco', tocaGuardarVersion([p('  ')], null, ahora), false)
igual('el primero sí', tocaGuardarVersion(cuerpo, null, ahora), true)
igual('igual que la última copia: no', tocaGuardarVersion(cuerpo, { huella: huellaDeContenido(cuerpo), creadaEn: haceMin(60) }, ahora), false)
igual('distinto pero de hace poco: no', tocaGuardarVersion(cuerpo, { huella: 'otra', creadaEn: haceMin(MINUTOS_ENTRE_VERSIONES - 1) }, ahora), false)
igual('distinto y de hace rato: sí', tocaGuardarVersion(cuerpo, { huella: 'otra', creadaEn: haceMin(MINUTOS_ENTRE_VERSIONES + 1) }, ahora), true)
igual('forzar ignora el tiempo pero no la igualdad', [tocaGuardarVersion(cuerpo, { huella: 'otra', creadaEn: haceMin(1) }, ahora, true), tocaGuardarVersion(cuerpo, { huella: huellaDeContenido(cuerpo), creadaEn: haceMin(1) }, ahora, true)], [true, false])
igual('una imagen sola cuenta como contenido', tocaGuardarVersion([{ ...bloqueNuevo('imagen'), url: 'https://x/y.png' }], null, ahora), true)

// Restaurar sin romper Notion
const actual: Bloque[] = [p('vivo', { notion_id: 'n-vivo' }), { ...bloqueNuevo('notion'), notion_id: 'n-ext', notion_tipo: 'child_database', vista: 'Base' }]
const vieja: Bloque[] = [
  p('vivo (antes)', { notion_id: 'n-vivo' }),
  p('borrado después', { notion_id: 'n-muerto' }),
  { ...bloqueNuevo('notion'), notion_id: 'n-ext', notion_tipo: 'child_database', vista: 'Base' },
  { ...bloqueNuevo('notion'), notion_id: 'n-ext-borrado', notion_tipo: 'synced_block', vista: 'X' },
  { ...bloqueNuevo('imagen'), notion_id: 'n-img-muerta' },
  { ...bloqueNuevo('imagen'), notion_id: 'n-img-url', url: 'https://nuestro/img.png' },
  p('sin id (nacido en el ERP)'),
]
const r = cuerpoParaRestaurar(vieja, actual)
igual('lo que sigue vivo conserva su identificador', r[0].notion_id, 'n-vivo')
igual('lo borrado en Notion queda como bloque nuevo', [r[1].texto[0]?.t, r[1].notion_id], ['borrado después', undefined])
igual('un bloque de solo Notion que sigue existiendo se queda', r[2].notion_id, 'n-ext')
igual('uno que ya no existe se omite; una imagen sin dirección también', r.map((b) => b.tipo), ['parrafo', 'parrafo', 'notion', 'imagen', 'parrafo'])
igual('la imagen con dirección nuestra pierde el identificador muerto', [r[3].url, r[3].notion_id], ['https://nuestro/img.png', undefined])

const tabla: Bloque = { ...bloqueNuevo('tabla'), notion_id: 'n-tabla', filas: [[[{ t: 'a' }]], [[{ t: 'b' }]]], filaIds: ['f1', 'f2'] }
const tablaActual: Bloque = { ...tabla, filaIds: ['f1', 'otra'] }
igual('de una tabla viva solo valen las filas que siguen', cuerpoParaRestaurar([tabla], [tablaActual])[0].filaIds, ['f1', null])
igual('de una tabla muerta ninguna fila', [cuerpoParaRestaurar([tabla], [])[0].notion_id, cuerpoParaRestaurar([tabla], [])[0].filaIds], [undefined, [null, null]])
igual('no toca el original', vieja[1].notion_id, 'n-muerto')

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
