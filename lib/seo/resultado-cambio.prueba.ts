/**
 * PRUEBAS DEL RESULTADO DE UN CAMBIO DE FICHA (lib/seo/resultado-cambio.ts).
 *   npx tsx lib/seo/resultado-cambio.prueba.ts
 */
import type { ConsultaGuardada } from './datos'
import { resultadoDelCambio } from './resultado-cambio'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const DIA = 86_400_000
const mas = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10)
const SEMANAS = ['2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01']
const CONSULTAS = ['lampara pie', 'lampara pie led', 'lampara salon']

function fila(asin: string, desde: string, consulta: string, impA: number, comA: number): ConsultaGuardada {
  return {
    asin, periodo: 'WEEK', desde, hasta: mas(desde, 6), consulta, puntuacion: null, volumen: 1000,
    impresionesTotal: 50000, impresionesAsin: impA, cuotaImpresiones: impA / 50000,
    clicsTotal: 3000, clicsAsin: impA * 0.06, cuotaClics: (impA * 0.06) / 3000,
    carritosTotal: 300, carritosAsin: comA * 3, cuotaCarritos: (comA * 3) / 300,
    comprasTotal: 100, comprasAsin: comA, cuotaCompras: comA / 100,
    precioMedianoTotal: 30, precioMedianoAsin: 30,
  }
}
const filas = (despues: (s: string) => [number, number]) => SEMANAS.flatMap((s) => CONSULTAS.map((c) => fila('A', s, c, ...(s > '2026-10-15' ? despues(s) : ([1000, 2] as [number, number])))))

const base = {
  asin: 'A',
  fecha: '2026-10-15T09:00:00Z',
  antes: { titulo: 'Lampara de pie', bullets: [], backend: '' },
  despues: { titulo: 'Lampara de pie LED para salon' },
  precio: 30,
  hoy: '2026-11-20',
}

console.log('\n=== mejora ===')
{
  const r = resultadoDelCambio({ ...base, filas: filas(() => [2000, 4]) })
  ok('estado mejora', r.estado === 'mejora', r.estado + ' ' + r.resumen)
  ok('mide por compras', r.medida === 'compras', String(r.medida))
  ok('variación +100 %', r.variacion != null && Math.abs(r.variacion - 1) < 0.01, String(r.variacion))
  ok('3 semanas a cada lado', r.antes.semanas === 3 && r.despues.semanas === 3, `${r.antes.semanas}/${r.despues.semanas}`)
  ok('la semana del cambio va aparte', r.serie.filter((p) => p.lado === 'cambio').length === 1 && r.serie.length === 7)
  ok('«lampara pie led» entra', r.tocadas.some((t) => t.consulta === 'lampara pie led' && t.cambio === 'entra'), JSON.stringify(r.tocadas.map((t) => t.consulta)))
  ok('«lampara pie» no se toca', !r.tocadas.some((t) => t.consulta === 'lampara pie'))
}

console.log('\n=== se queda igual y empeora ===')
{
  ok('igual', resultadoDelCambio({ ...base, filas: filas(() => [1050, 2]) }).estado === 'igual')
  ok('empeora', resultadoDelCambio({ ...base, filas: filas(() => [500, 1]) }).estado === 'empeora')
}

console.log('\n=== antes de tiempo ===')
{
  const pocas = filas(() => [2000, 4]).filter((f) => f.desde <= '2026-10-18')
  const r = resultadoDelCambio({ ...base, filas: pocas, hoy: '2026-10-27' })
  ok('provisional con 1 semana', r.estado === 'provisional', r.estado)
  ok('dice desde cuándo se juzga', r.juzgableDesde === '2026-11-05' && r.resumen.includes('Se juzga'), r.resumen)
  const r2 = resultadoDelCambio({ ...base, filas: filas(() => [2000, 4]).filter((f) => f.desde <= '2026-10-11'), hoy: '2026-10-17' })
  ok('esperando sin semanas de después', r2.estado === 'esperando', r2.estado)
}

console.log('\n=== lo que ensucia ===')
{
  const stock = resultadoDelCambio({ ...base, filas: filas(() => [2000, 4]), sinVentas: [{ desde: '2026-10-20', hasta: '2026-10-24', dias: 5, ritmoAntes: 4, entrada: 100 }] })
  ok('rotura de stock: no atribuible', stock.estado === 'no-atribuible' && stock.avisos.some((a) => a.includes('5 días')), stock.estado)
  const otro = resultadoDelCambio({ ...base, filas: filas(() => [2000, 4]), otrosCambios: ['2026-10-15', '2026-10-28'] })
  ok('otro cambio dentro: no atribuible', otro.estado === 'no-atribuible', otro.estado)
  const fuera = resultadoDelCambio({ ...base, filas: filas(() => [2000, 4]), otrosCambios: ['2026-10-15', '2026-08-01'] })
  ok('un cambio de antes de las 6 semanas no molesta', fuera.estado === 'mejora', fuera.estado)
  const ppc = resultadoDelCambio({ ...base, filas: filas(() => [2000, 4]), gastoSemanal: SEMANAS.map((s) => ({ desde: s, gasto: s > '2026-10-15' ? 100 : 40 })) })
  ok('publicidad que sube: avisa y juzga', ppc.estado === 'mejora' && ppc.avisos.some((a) => a.includes('publicidad')), ppc.avisos.join(' | '))
}

console.log('\n=== pocas compras: decide la cuota de impresiones ===')
{
  const sinCompras = SEMANAS.flatMap((s) => CONSULTAS.map((c) => fila('A', s, c, s > '2026-10-15' ? 1500 : 1000, s > '2026-10-15' ? 1 : 0)))
  const r = resultadoDelCambio({ ...base, filas: sinCompras })
  ok('mide por impresiones', r.medida === 'impresiones', String(r.medida))
  ok('mejora un 50 %', r.estado === 'mejora' && r.variacion != null && Math.abs(r.variacion - 0.5) < 0.01, `${r.estado} ${r.variacion}`)
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
process.exit(fallos ? 1 : 0)
