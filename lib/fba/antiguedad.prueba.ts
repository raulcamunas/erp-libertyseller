import { informeDeAntiguedad, nombreDeFuente, productosDeTramo, tramoDelInforme, unidadesEnTramo } from '@/lib/fba/antiguedad'
import type { InventarioDeCliente, SkuInventario } from '@/lib/fba/inventario'
import { edadVacia, resumirEdadAmazon, type FilaPlanificacion } from '@/lib/fba/planificacion'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const cerca = (a: number | null, b: number, tol = 0.005) => a !== null && Math.abs(a - b) <= tol

/**
 * LA ANTIGÜEDAD COMO UNA LISTA DE TRAMOS CON SUS PRODUCTOS.
 *
 * Lo que se comprueba: que la lista sea la de Amazon cuando la hay y la estimada cuando no, y que
 * «los productos de este tramo» sean los que de verdad tienen unidades en él.
 */

function sku(sobre: Partial<SkuInventario> & { sku: string }): SkuInventario {
  const base: SkuInventario = {
    sku: sobre.sku,
    asin: null,
    fnsku: null,
    nombre: `Producto ${sobre.sku}`,
    precio: 20,
    moneda: 'EUR',
    enAmazon: 0,
    vendibles: 0,
    entrante: 0,
    noDisponibles: 0,
    vendidas: { d7: 0, d14: 0, d30: 0, d60: 0, d90: 0 },
    devueltas: { d30: 0, d90: 0 },
    tasaDevolucion90: null,
    ritmo7: 0,
    ritmo30: 0,
    ritmo90: 0,
    ritmoPlan: 0,
    tendencia: null,
    muestraCorta: false,
    serie90: null,
    ultimaVenta: null,
    diasSinVenta: null,
    primeraEntrada: null,
    lotes: [],
    edadMediaDias: null,
    edadMaxDias: null,
    porTramo: { t0: 0, t91: 0, t181: 0, t271: 0, t366: 0 },
    anteriorALaLectura: 0,
    diasMedioDeVenta: null,
    retiradas: 0,
    mermas: 0,
    descuadre: 0,
    cobertura: null,
    seAgotaEl: null,
    valorStock: null,
    valorVentas30: null,
    estado: 'ok',
    alertas: [],
  }
  return { ...base, ...sobre }
}

function cliente(skus: SkuInventario[], sobre: Partial<InventarioDeCliente> = {}): InventarioDeCliente {
  return {
    hoy: '2026-10-19',
    leidoHasta: '2026-10-19',
    libroDesde: '2026-07-02',
    diasDeLibro: 109,
    libro: 'ok',
    skus,
    resumen: {
      unidadesEnAmazon: 0,
      vendibles: 0,
      entrante: 0,
      noDisponibles: 0,
      valorStock: 0,
      sinPrecio: 0,
      vendidas30: 0,
      valorVentas30: 0,
      ritmo30: 0,
      coberturaMedia: null,
      vendidas90: 0,
      devueltas90: 0,
      tasaDevolucion90: null,
      referencias: skus.length,
      agotadas: 0,
      urgentes: 0,
      paradas: 0,
      paradasUnidades: 0,
      paradasValor: 0,
      exceso: 0,
      edadMediaDias: null,
      porTramo: { t0: 16, t91: 0, t181: 0, t271: 0, t366: 0 },
      valorPorTramo: { t0: 416, t91: 0, t181: 0, t271: 0, t366: 0 },
      anteriorALaLectura: 8,
      unidadesAntiguas: 0,
      conNoVendibles: 0,
      enviosEnCamino: 0,
    },
    porDia: [],
    avisos: [],
    conectado: true,
    marketplaceId: 'A1RKKUPIHCS9HS',
    conexionId: 'c1',
    lectura: null,
    edadAmazon: null,
    planificacion: { tabla: true, leidoAt: null, error: null },
    ...sobre,
  }
}

const fila = (s: string, edad: Partial<ReturnType<typeof edadVacia>>, costeMes: number | null = 0.1): FilaPlanificacion => ({
  sku: s,
  fnsku: null,
  asin: null,
  disponible: Object.values(edad).reduce((a, b) => a + (b ?? 0), 0),
  noVendible: 0,
  edad: { ...edadVacia(), ...edad },
  costeMes,
  recargo: edadVacia(),
  moneda: 'EUR',
  diasSuministro: null,
  accion: null,
})

console.log('\n=== con la antigüedad de Amazon ===')
{
  const skus = [
    sku({ sku: '4036R', nombre: 'Zapatilla 4036R', precio: 30 }),
    sku({ sku: '410R39', nombre: 'Zapatilla 410R', precio: 27 }),
    sku({ sku: '4030N', nombre: 'Zapatilla 4030', precio: 28 }),
    sku({ sku: '725A', nombre: 'Zapatilla 725A', precio: 25 }),
    sku({ sku: 'SIN-PRECIO', precio: null }),
    sku({ sku: 'FUERA', nombre: 'No sale en el informe' }),
  ]
  const filas = [
    fila('4036R', { a0: 2, a91: 1 }, 0.09),
    fila('410R39', { a91: 1 }, 0.03),
    fila('4030N', { a91: 1 }, 0.03),
    fila('725A', { a0: 6 }, 0.18),
    fila('SIN-PRECIO', { a91: 4 }, 0.12),
  ]
  const precios = new Map(skus.map((k) => [k.sku, k.precio] as const))
  const ea = resumirEdadAmazon({ filas, fecha: '2026-10-16', precios })
  for (const k of skus) k.edadAmazon = ea.porSku[k.sku] ?? null
  const d = cliente(skus, { edadAmazon: ea })
  const inf = informeDeAntiguedad(d)

  ok('la fuente es Amazon y la fecha, la de su foto', inf.fuente === 'amazon' && inf.fecha === '2026-10-16')
  ok('hay siete tramos, los de Seller Central', inf.tramos.length === 7 && inf.tramos.map((t) => t.texto).join('|') === '0-60 días|61-90|91-180|181-330|331-365|366-455|Más de 455', inf.tramos.map((t) => t.texto).join('|'))
  ok('«antiguo» es de más de 90 días: de 91-180 en adelante', inf.tramos.map((t) => (t.antiguo ? '1' : '0')).join('') === '0011111', inf.tramos.map((t) => (t.antiguo ? '1' : '0')).join(''))
  ok('las unidades por tramo suman las del informe: 8 de 0-60 y 7 de 91-180', inf.unidades === 15 && inf.tramos[0].unidades === 8 && inf.tramos[2].unidades === 7, JSON.stringify(inf.tramos.map((t) => t.unidades)))
  ok('el coste de todo el cliente es el que da Amazon', cerca(inf.costeMes, 0.45) && inf.moneda === 'EUR')

  const p = productosDeTramo(skus, inf, 'a91')
  ok('los productos de 91-180 son los cuatro que tienen unidades ahí, y ninguno más', p.map((x) => x.sku.sku).sort().join('|') === '4030N|4036R|410R39|SIN-PRECIO', p.map((x) => x.sku.sku).join('|'))
  ok('primero el que más unidades tiene', p[0].sku.sku === 'SIN-PRECIO' && p[0].unidades === 4)
  ok('a igualdad de unidades, el que más vale (30, 28 y 27 €)', p.slice(1).map((x) => x.sku.sku).join('|') === '4036R|4030N|410R39', p.map((x) => x.sku.sku).join('|'))
  ok('el valor son las unidades de ESE tramo por el precio', cerca(p[1].valor, 30) && p[0].valor === null)
  ok('y el coste, el que Amazon da para esas unidades', cerca(p[1].coste, 0.09 / 3, 0.005))
  const dos = productosDeTramo(skus, inf, 'a0')
  ok('un producto con unidades en dos tramos sale en los dos, con las de cada uno', dos.find((x) => x.sku.sku === '4036R')?.unidades === 2 && p.find((x) => x.sku.sku === '4036R')?.unidades === 1)
  ok('un tramo sin unidades no tiene productos', productosDeTramo(skus, inf, 'a456').length === 0)
  ok('un producto que no sale en el informe no tiene unidades en ningún tramo', inf.tramos.every((t) => unidadesEnTramo(skus.find((k) => k.sku === 'FUERA')!, inf, t.id) === 0))
  ok('la suma de lo que lista cada tramo es el total del informe', inf.tramos.reduce((s, t) => s + productosDeTramo(skus, inf, t.id).reduce((a, x) => a + x.unidades, 0), 0) === inf.unidades)
  ok('buscar un tramo que no existe da null y uno que sí, el tramo', tramoDelInforme(inf, 'zzz') === null && tramoDelInforme(inf, null) === null && tramoDelInforme(inf, 'a91')?.unidades === 7)
  ok('se dice de dónde sale', nombreDeFuente('amazon') === 'según Amazon' && nombreDeFuente('libro') === 'estimada con el libro mayor')
}

console.log('\n=== con la edad estimada del libro ===')
{
  const skus = [
    sku({ sku: 'A', porTramo: { t0: 10, t91: 0, t181: 0, t271: 0, t366: 0 }, anteriorALaLectura: 0 }),
    sku({ sku: 'B', porTramo: { t0: 6, t91: 0, t181: 0, t271: 0, t366: 0 }, anteriorALaLectura: 5 }),
    sku({ sku: 'C', porTramo: { t0: 0, t91: 0, t181: 0, t271: 0, t366: 0 }, anteriorALaLectura: 3 }),
  ]
  const d = cliente(skus)
  const inf = informeDeAntiguedad(d)
  ok('la fuente es el libro, con la fecha de lo leído', inf.fuente === 'libro' && inf.fecha === '2026-10-19')
  ok('cinco tramos y el cajón de «anterior al libro» al final', inf.tramos.length === 6 && inf.tramos[5].id === 'anterior' && inf.tramos[5].texto === 'Anterior al libro (más de 109 d)', inf.tramos.map((t) => t.texto).join('|'))
  ok('«antiguo» lo son los de más de 90 días y no lo desconocido', inf.tramos.map((t) => (t.antiguo ? '1' : '0')).join('') === '011110', inf.tramos.map((t) => (t.antiguo ? '1' : '0')).join(''))
  ok('las unidades de cada tramo salen del resumen y las anteriores, aparte', inf.tramos[0].unidades === 16 && inf.tramos[5].unidades === 8 && inf.unidades === 24)
  ok('sin quien le calcule el coste, no se inventa', inf.tramos.every((t) => t.coste === null) && inf.costeMes === null)
  const conCoste = informeDeAntiguedad(d, { costeDe: (u) => u * 0.5 })
  ok('con una función de coste, cada tramo lleva el suyo', conCoste.tramos[0].coste === 8 && conCoste.tramos[5].coste === 4)
  const ant = productosDeTramo(skus, inf, 'anterior')
  ok('los de «anterior al libro» son los que tienen unidades sin edad, B y C', ant.map((x) => x.sku.sku).join('|') === 'B|C' && ant[0].unidades === 5, ant.map((x) => x.sku.sku).join('|'))
  const t0 = productosDeTramo(skus, inf, 't0')
  ok('los de 0-90 salen de su reparto por lotes: A y B', t0.map((x) => x.sku.sku).join('|') === 'A|B' && t0[0].unidades === 10 && t0[0].coste === null)
  const sinLibro = informeDeAntiguedad(cliente(skus, { libro: 'sin_leer', diasDeLibro: null }))
  ok('sin libro mayor, ese cajón dice que no se sabe', sinLibro.tramos.at(-1)?.texto === 'Edad desconocida (sin libro mayor)')
  const sinAnteriores = cliente(skus)
  sinAnteriores.resumen = { ...sinAnteriores.resumen, anteriorALaLectura: 0 }
  ok('si no hay nada anterior al libro, el cajón no sale', informeDeAntiguedad(sinAnteriores).tramos.length === 5)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
