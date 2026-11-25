/**
 * PRUEBAS DE LA COSECHA DESDE SEO Y HELIUM 10 (lib/ads/cosecha-seo.ts).
 *   npx tsx lib/ads/cosecha-seo.prueba.ts
 */
import { cosechaDesdeSeo, type PalabraHelium } from './cosecha-seo'
import type { PalabraDesdeSeo } from './desde-seo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const s = (consulta: string, motivo: PalabraDesdeSeo['motivo'], enExacta = false): PalabraDesdeSeo => ({ consulta, motivo, accion: '', porque: 'te compran 4 veces', volumen: 1000, comprasMercado: 50, comprasAsin: 4, cuotaImpresiones: 0.01, cuotaCompras: 0.05, enExacta, enOtraConcordancia: false, enTitulo: true })
const h = (keyword: string, volumen: number, rangoOrganico: number | null = null, decision: PalabraHelium['decision'] = 'nuestra'): PalabraHelium => ({ keyword, volumen, rangoOrganico, oportunidad: 1, decision })

const r = cosechaDesdeSeo({
  seo: [s('zapatillas casa hombre', 'te-compran'), s('zapatillas casa mujer', 'infraexpuesta', true), s('zapatillas skechers', 'ataque-marca'), s('pantuflas hombre', 'empujar'), s('mocasines casa', 'te-compran')],
  helium: [h('zapatillas de estar por casa hombre', 2400), h('zapatillas casa', 9000, 5), h('crocs hombre', 5000), h('zapatillas felpa hombre', 200), h('slippers', 8000), h('zapatillas lana hombre', 1500, null, 'ajena'), h('pantuflas paño hombre', 900), h('zapatillas felpa cálida hombre', 800), h('zapatillas casa hombre', 3000)],
  exactas: new Set(['mocasines casa']),
  cualquiera: new Set(['pantuflas pano hombre', 'mocasines casa']),
  bloqueadas: new Set(['pantuflas hombre']),
  esDeMarca: (t) => /crocs|skechers/.test(t),
})
const t = (x: string) => r.find((c) => c.termino === x)
ok('te compran sin EXACTA → EXACTA DOMINIO', t('zapatillas casa hombre')?.rol === 'MANUAL EXACTA / DOMINIO' && t('zapatillas casa hombre')?.fuente === 'seo')
ok('infraexpuesta que ya tiene EXACTA: no', !t('zapatillas casa mujer'))
ok('ataque de marca: no', !t('zapatillas skechers'))
ok('bloqueada (negativizada o cosechada hace poco): no', !t('pantuflas hombre'))
ok('ya en EXACTA: no', !t('mocasines casa'))
ok('Helium con volumen y sin posición → AMPLIA en frase', t('zapatillas de estar por casa hombre')?.rol === 'MANUAL AMPLIA')
ok('Helium donde ya está en el top 20 orgánico: no', !t('zapatillas casa'))
ok('Helium de marca: no', !t('crocs hombre'))
ok('Helium con poco volumen: no', !t('zapatillas felpa hombre'))
ok('Helium de una sola palabra: no', !t('slippers'))
ok('Helium que SEO da por ajena: no', !t('zapatillas lana hombre'))
ok('Helium ya en una campaña (cualquier concordancia, sin tildes): no', !t('pantuflas paño hombre') && !t('pantuflas pano hombre'))
ok('la misma palabra no entra dos veces (SEO y Helium)', r.filter((c) => c.termino === 'zapatillas casa hombre').length === 1)

ok('la keyword conserva sus tildes', !!t('zapatillas felpa cálida hombre'), r.map((c) => c.termino).join(', '))

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
process.exit(fallos ? 1 : 0)
