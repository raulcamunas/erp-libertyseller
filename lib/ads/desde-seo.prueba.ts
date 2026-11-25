/**
 * PRUEBAS DE LAS PALABRAS QUE VIENEN DE SEO (lib/ads/desde-seo.ts).
 *   npx tsx lib/ads/desde-seo.prueba.ts
 */
import type { ConsultaGuardada } from '@/lib/seo/datos'
import type { BusquedaDiagnosticada, Veredicto } from '@/lib/seo/embudo'
import { palabrasDesdeSeo } from './desde-seo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const b = (consulta: string, veredicto: Veredicto, extra: Partial<ConsultaGuardada> = {}, posibleAjena = false): BusquedaDiagnosticada<ConsultaGuardada> => ({
  fila: { asin: 'A', periodo: 'MONTH', desde: '2026-10-01', hasta: '2026-10-31', consulta, puntuacion: null, volumen: 1000, cuotaImpresiones: 0.03, cuotaClics: 0.04, cuotaCarritos: 0.05, cuotaCompras: 0.06, comprasAsin: 3, comprasTotal: 50, clicsAsin: null, impresionesAsin: null, impresionesTotal: null, clicsTotal: null, carritosTotal: null, carritosAsin: null, precioMedianoTotal: null, precioMedianoAsin: null, ...extra },
  veredicto,
  impacto: 0,
  compras: 0,
  posibleAjena,
} as BusquedaDiagnosticada<ConsultaGuardada>)

const busquedas = [
  b('funda nordica 150', { tipo: 'infraexpuesta', motivo: '', fuerza: 2 }, { comprasTotal: 80 }),
  b('funda nordica', { tipo: 'infraexpuesta', motivo: '', fuerza: 2 }, { comprasTotal: 300 }),
  b('funda nordica algodon', { tipo: 'fuga', etapa: 'clics', motivo: '', caida: 0.5 }, { comprasAsin: 4 }),
  b('funda nordica 135', { tipo: 'visibilidad', motivo: '', fuerza: 1 }, { comprasAsin: 0 }),
  b('funda nordica 90', { tipo: 'visibilidad', motivo: '', fuerza: 1 }, { comprasAsin: 0 }),
  b('ideas regalo', { tipo: 'ruido', motivo: '' }),
  b('lego', { tipo: 'sin-datos', motivo: '' }, {}, true),
  b('b0abcdefgh', { tipo: 'infraexpuesta', motivo: '', fuerza: 2 }),
  b('funda nordica lider', { tipo: 'lider', motivo: '' }, { comprasAsin: 30 }),
]
const keywords = { exactas: new Set(['funda nordica', 'funda nordica lider']), otras: new Set(['funda nordica 150']) }
const enTitulo = (c: string) => c === 'funda nordica 135'
const r = palabrasDesdeSeo(busquedas, keywords, enTitulo)
const de = (c: string) => r.find((p) => p.consulta === c)

ok('infraexpuestas primero, la de más compras delante', r[0]?.consulta === 'funda nordica' && r[1]?.consulta === 'funda nordica 150', r.map((p) => p.consulta).join(', '))
ok('infraexpuesta con EXACTA: subir puja', de('funda nordica')?.accion.includes('sube') === true)
ok('infraexpuesta en frase: crear EXACTA', de('funda nordica 150')?.accion.includes('crea la keyword EXACTA') === true, de('funda nordica 150')?.accion)
ok('te compran sin EXACTA (aunque pierda en clics)', de('funda nordica algodon')?.motivo === 'te-compran')
ok('falta visibilidad y en el título: empujar', de('funda nordica 135')?.motivo === 'empujar')
ok('falta visibilidad sin estar en el título: no (es trabajo de SEO)', !de('funda nordica 90'))
ok('ni ruido, ni ajena, ni ASIN', !de('ideas regalo') && !de('lego') && !de('b0abcdefgh'))
ok('lider con EXACTA: no sale', !de('funda nordica lider'))

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
process.exit(fallos ? 1 : 0)
