/**
 * PRUEBAS DE LAS MARCAS DE LA COMPETENCIA (lib/seo/marcas.ts y su uso en lib/seo/embudo.ts).
 *   npx tsx lib/seo/marcas.prueba.ts
 */
import { claveDeMarca, esMarcaValida, marcaDelTitulo, marcaEnBusqueda } from './marcas'
import { diagnosticarTodas, esDelProducto, type FilaDeEmbudo } from './embudo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const M = (t: string, origen = 'clics') => ({ clave: claveDeMarca(t), texto: t, origen })

console.log('\n=== reconocer la marca ===')
ok('clave sin tildes ni ®', claveDeMarca('Skéchers®') === 'skechers')
ok('genéricas no valen', !esMarcaValida('generic') && !esMarcaValida(claveDeMarca('Genérico')) && !esMarcaValida('sin marca'))
ok('dos letras no valen', !esMarcaValida('ab'))
ok('casa en la búsqueda', marcaEnBusqueda('zapatillas skechers mujer', [M('Skechers')])?.texto === 'Skechers')
ok('marca de dos palabras', marcaEnBusqueda('hey dude mujer', [M('Hey Dude'), M('Dude')])?.texto === 'Hey Dude')
ok('no casa a medias', marcaEnBusqueda('zapatillas skech', [M('Skechers')]) === null)
ok('no casa dentro de otra palabra', marcaEnBusqueda('crocsland', [M('Crocs')]) === null)
ok('marca del título', marcaDelTitulo('Cozseries Zapatillas de Casa') === 'cozseries' && marcaDelTitulo('Generic zapatillas') === null)

console.log('\n=== en el diagnóstico ===')
const fila = (consulta: string, comprasAsin = 0): FilaDeEmbudo => ({ consulta, volumen: 10000, impresionesTotal: 100000, impresionesAsin: 2000, clicsTotal: 3000, clicsAsin: 60, carritosTotal: 400, carritosAsin: 8, comprasTotal: 300, comprasAsin, cuotaImpresiones: 0.02, cuotaClics: 0.02, cuotaCarritos: 0.02, cuotaCompras: comprasAsin / 300 })
const filas = [fila('zapatillas casa mujer', 6), fila('zapatillas skechers mujer', 6), fila('zapatillas casa hombre', 6), fila('pantuflas casa', 6), fila('funda iphone 15', 6)]
const ficha = { titulo: 'Cozseries Zapatillas de Casa Mujer', bullets: ['Funda compatible con iphone'], descripcion: null, backend: '' }
const { busquedas } = diagnosticarTodas(filas, null, { ficha, marcas: [M('Skechers'), M('Casa'), M('iPhone', 'ia')] })
const de = (q: string) => busquedas.find((b) => b.fila.consulta === q)!
ok('skechers: ajena con su marca', de('zapatillas skechers mujer').veredicto.tipo === 'ajena' && (de('zapatillas skechers mujer').veredicto as { marca?: string }).marca === 'Skechers')
ok('y no cuenta para el producto', !esDelProducto(de('zapatillas skechers mujer')))
ok('una «marca» que es palabra común del producto (casa) no borra nada', de('zapatillas casa mujer').veredicto.tipo !== 'ajena')
ok('una marca que está en la propia ficha (iphone) no cuenta', de('funda iphone 15').veredicto.tipo !== 'ajena')
const { busquedas: conNuestra } = diagnosticarTodas(filas, null, { ficha, marcas: [M('Skechers')], nuestras: ['zapatillas skechers mujer'] })
ok('lo que una persona dijo «sí es nuestro» manda', conNuestra.find((b) => b.fila.consulta === 'zapatillas skechers mujer')!.veredicto.tipo !== 'ajena')

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
process.exit(fallos ? 1 : 0)
