/** Pruebas de lib/seo/sin-stock.ts. Se corre con: npx tsx lib/seo/sin-stock.prueba.ts */
import { frasesSinVentas, sinVentasEnPeriodo, tramosSinVentas } from './sin-stock'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const sumar = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
function serie(desde: string, n: number, f: (i: number) => number) {
  const o: Record<string, number> = {}
  for (let i = 0; i < n; i++) o[sumar(desde, i)] = f(i)
  return o
}

// Opinas, octubre: ~10 al día, a 0 del 7 al 22 de octubre, entrada de 1.004 el 21
const v = serie('2026-09-01', 70, (i) => { const d = sumar('2026-09-01', i); return d >= '2026-10-07' && d <= '2026-10-22' ? 0 : 10 })
const t = tramosSinVentas(v, { '2026-10-21': 1004 }, '2026-09-01', sumar('2026-09-01', 69))
ok('un tramo', t.length === 1, JSON.stringify(t))
ok('del 7 al 22 de octubre', t[0]?.desde === '2026-10-07' && t[0]?.hasta === '2026-10-22' && t[0]?.dias === 16)
ok('con la entrada', t[0]?.entrada === 1004)
ok('16 días en octubre', sinVentasEnPeriodo(t, '2026-10-01', '2026-10-31').dias === 16)
ok('nada en septiembre', sinVentasEnPeriodo(t, '2026-09-01', '2026-09-30').dias === 0)
ok('frase', /Del 7 al 22 de octubre \(16 días\).*10 al día.*1\.?004 uds/.test(frasesSinVentas(t)), frasesSinVentas(t))

// Un producto lento (0,3 al día): 5 días a 0 no es nada
const lento = serie('2026-09-01', 70, (i) => (i % 3 === 0 && !(i >= 40 && i <= 44) ? 1 : 0))
ok('lento: sin tramos', tramosSinVentas(lento, {}, '2026-09-01', sumar('2026-09-01', 69)).length === 0)

// Un tramo que llega al último día leído no se afirma
const final = serie('2026-09-01', 50, (i) => (i >= 45 ? 0 : 8))
ok('abierto al final: no se cuenta', tramosSinVentas(final, {}, '2026-09-01', sumar('2026-09-01', 49)).length === 0)

// 2 días a 0 vendiendo mucho: no llega al mínimo de 3 días
const corto = serie('2026-09-01', 60, (i) => (i === 40 || i === 41 ? 0 : 20))
ok('2 días: no', tramosSinVentas(corto, {}, '2026-09-01', sumar('2026-09-01', 59)).length === 0)

// Al principio, sin 14 días de ritmo: no se afirma
const principio = serie('2026-09-01', 60, (i) => (i < 10 ? 0 : 10))
ok('sin ritmo previo: no', tramosSinVentas(principio, {}, '2026-09-01', sumar('2026-09-01', 59)).length === 0)

console.log(fallos ? `\n${fallos} FALLOS` : '\nTODO OK')
if (fallos) process.exit(1)
