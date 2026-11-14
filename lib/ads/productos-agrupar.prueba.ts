import { agruparPorProducto, asinDeCampana, resumenDeCampana } from './productos-agrupar'
import { totalesDe } from './rendimiento-calculo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const c = (nombre: string, gasto: number, ventas = 0) => ({ nombre, ...totalesDe([{ impresiones: 100, clics: 10, gasto, ventas, pedidos: ventas > 0 ? 1 : 0, unidades: 0 }]) })

console.log('\n=== el ASIN de una campaña ===')
{
  ok('de la nomenclatura del SOP', asinDeCampana('B0FMS6N5L8 | MONTE 004 - ES | JAMON ENTERO 7-8KG SET JAMONERO | MANUAL AMPLIA') === 'B0FMS6N5L8')
  ok('de una campaña de Amazon (ProductAI)', asinDeCampana('[ProductAI] ES-B0GXGPXR1X-JAMONERO-SP-PAT-May042026') === 'B0GXGPXR1X')
  ok('en minúsculas también', asinDeCampana('auto b0gxgpxr1x jamonero') === 'B0GXGPXR1X')
  ok('sin ASIN → null', asinDeCampana('Campaña antigua de ofertas') === null)
  ok('una palabra larga que empieza por B0 pero no es un ASIN no cuenta', asinDeCampana('B0LSAMUYENDOLARGA') === null)
}

console.log('\n=== el nombre corto ===')
{
  ok('resumen de la nomenclatura', resumenDeCampana('B0FMS6N5L8 | MONTE 004 - ES | JAMON ENTERO | AUTO RADAR') === 'JAMON ENTERO')
  ok('la palabra tras el ASIN en las de Amazon', resumenDeCampana('[ProductAI] ES-B0GXGPXR1X-JAMONERO-SP-PAT-May042026') === 'JAMONERO')
  ok('sin nada que sacar → null', resumenDeCampana('Campaña antigua') === null)
}

console.log('\n=== agrupar ===')
{
  const lista = [
    c('B0FMS6N5L8 | SKU1 | JAMON ENTERO | AUTO RADAR', 40, 100),
    c('B0FMS6N5L8 | SKU1 | JAMON ENTERO | MANUAL AMPLIA', 30, 90),
    c('B0GXGPXR1X | SKU2 | JAMONERO | AUTO RADAR', 20, 10),
    c('[ProductAI] ES-B0GXGPXR1X-JAMONERO-SP-PAT-May042026', 15, 0),
    c('Campaña antigua', 99, 5),
    c('B0AAAAAAA1 | SKU3 | CUCHILLO | ATAQUE ASIN', 100, 0),
  ]
  const g = agruparPorProducto(lista)
  ok('3 productos y el grupo sin producto', g.length === 4, g.map((x) => x.clave).join())
  ok('de más a menos gasto y el «sin producto» siempre el último, aunque gaste más', g.map((x) => x.clave).join() === 'B0AAAAAAA1,B0FMS6N5L8,B0GXGPXR1X,sin-producto', g.map((x) => x.clave).join())
  const jamon = g.find((x) => x.asin === 'B0FMS6N5L8')!
  ok('las dos campañas del jamón en su grupo, con 70 de gasto y 190 de ventas', jamon.campanas.length === 2 && jamon.totales.gasto === 70 && jamon.totales.ventas === 190)
  ok('las de nomenclatura y las de Amazon del mismo ASIN van juntas', g.find((x) => x.asin === 'B0GXGPXR1X')!.campanas.length === 2)
  ok('el título sale del resumen más repetido', jamon.titulo === 'JAMON ENTERO' && g.find((x) => x.asin === 'B0GXGPXR1X')!.titulo === 'JAMONERO')
  ok('el grupo sin producto lo dice', g[3].titulo === 'Sin producto identificado' && g[3].asin === null)
  const conocido = agruparPorProducto(lista, new Map([['B0FMS6N5L8', 'Jamón entero 7-8 kg']]))
  ok('un producto ya dado de alta pone su nombre', conocido.find((x) => x.asin === 'B0FMS6N5L8')!.titulo === 'Jamón entero 7-8 kg')
  ok('lista vacía → sin grupos', agruparPorProducto([]).length === 0)
  ok('el total de los grupos es el de todas las campañas', Math.abs(g.reduce((a, x) => a + x.totales.gasto, 0) - 304) < 1e-9)
}
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
