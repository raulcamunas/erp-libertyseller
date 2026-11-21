/**
 * Pruebas de la evolución con cesta fija (lib/seo/cesta.ts). Se corre con: npx tsx lib/seo/cesta.prueba.ts
 */
import type { ConsultaGuardada } from './datos'
import { cestaFija } from './cesta'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const ASIN = 'B0JUEGO001'
/** [volumen, imp total, imp tuyas, clics total, tuyos, carritos total, tuyos, compras total, tuyas] */
function fila(consulta: string, desde: string, n: number[], asin = ASIN): ConsultaGuardada {
  const [volumen, it, ia, ct, ca, kt, ka, pt, pa] = n
  return {
    asin, periodo: 'WEEK', desde, hasta: desde, consulta, puntuacion: null, volumen,
    impresionesTotal: it, impresionesAsin: ia, cuotaImpresiones: ia / it, clicsTotal: ct, clicsAsin: ca, cuotaClics: ca / ct, carritosTotal: kt, carritosAsin: ka, cuotaCarritos: ka / kt,
    comprasTotal: pt, comprasAsin: pa, cuotaCompras: pa / pt, precioMedianoTotal: 25, precioMedianoAsin: 30,
  }
}

const semana = (desde: string) => [
  fila('juegos de mesa adultos', desde, [8000, 300000, 3000, 9000, 90, 900, 9, 200, 2]),
  fila('juego de mesa familiar', desde, [5000, 200000, 2000, 6000, 60, 600, 6, 150, 1]),
  fila('juego mesa cartas', desde, [3000, 100000, 1000, 3000, 30, 300, 3, 90, 1]),
  fila('juego mesa preguntas', desde, [2000, 80000, 800, 2400, 24, 240, 2, 60, 1]),
]
const FICHA = { titulo: 'MARCA Juego de Mesa de Cartas y Preguntas para Adultos y Familias', bullets: [], descripcion: null, backend: 'familiar', highlights: null }
const LEGO = fila('lego', '2026-10-11', [400000, 14340612, 661, 40000, 10, 9000, 0, 3557, 0])

console.log('\n=== cesta fija ===')
{
  const sin = [...semana('2026-10-04'), ...semana('2026-10-11'), ...semana('2026-10-18')]
  const con = [...sin, LEGO]
  const a = cestaFija(sin, ASIN, 'WEEK', 30, 20, { ficha: FICHA })
  const b = cestaFija(con, ASIN, 'WEEK', 30, 20, { ficha: FICHA })
  const p = (x: typeof a, d: string) => x.serie.find((s) => s.desde === d)!
  ok('la cesta son las 4 del producto, por compras del mercado', a.consultas.join('|') === 'juegos de mesa adultos|juego de mesa familiar|juego mesa cartas|juego mesa preguntas', a.consultas.join('|'))
  ok('si entra «lego» en un periodo, la cuota de la cesta no cambia', JSON.stringify(p(a, '2026-10-11')) === JSON.stringify(p(b, '2026-10-11')), `${JSON.stringify(p(a, '2026-10-11'))} vs ${JSON.stringify(p(b, '2026-10-11'))}`)
  ok('cuota de impresiones = suma ÷ suma de la cesta (6.800 / 680.000 = 1 %)', Math.abs((p(a, '2026-10-18').cuotaImpresiones as number) - 0.01) < 1e-12)
  ok('compras propias y volumen sumados', p(a, '2026-10-18').comprasAsin === 5 && p(a, '2026-10-18').volumen === 18000)
  ok('3 periodos en orden', a.serie.map((s) => s.desde).join() === '2026-10-04,2026-10-11,2026-10-18')

  // Una semana con solo 1 de las 4 → hueco, no cero
  const conHueco = [...sin.filter((f) => !(f.desde === '2026-10-11' && f.consulta !== 'juego mesa cartas'))]
  const h = cestaFija(conHueco, ASIN, 'WEEK', 30, 20, { ficha: FICHA }).serie.find((s) => s.desde === '2026-10-11')!
  ok('con menos de la mitad de la cesta, el punto es un hueco (null), no un cero', h.cuotaImpresiones === null && h.comprasAsin === null && h.presentes === 1 && h.total === 4, JSON.stringify(h))
  const mitad = sin.filter((f) => !(f.desde === '2026-10-11' && (f.consulta === 'juego mesa cartas' || f.consulta === 'juego mesa preguntas')))
  ok('con justo la mitad, sí hay punto', cestaFija(mitad, ASIN, 'WEEK', 30, 20, { ficha: FICHA }).serie.find((s) => s.desde === '2026-10-11')!.cuotaImpresiones !== null)

  ok('n = 2 → las 2 de más compras', cestaFija(sin, ASIN, 'WEEK', 30, 2).consultas.length === 2)
  ok('la cesta se elige en el último periodo: «lego» el 11 no entra aunque venda más', !b.consultas.includes('lego'))
  ok('ni aunque «lego» esté en el último periodo (posible ajena)', !cestaFija([...sin, { ...LEGO, desde: '2026-10-18', hasta: '2026-10-18' }], ASIN, 'WEEK', 30, 20, { ficha: FICHA }).consultas.includes('lego'))
  ok('otro ASIN no cuenta', cestaFija(sin.map((f) => ({ ...f, asin: 'B0OTRO0001' })), ASIN, 'WEEK', 30).serie.length === 0)
  ok('sin filas, vacía', cestaFija([], ASIN, 'WEEK', 30).consultas.length === 0)
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
