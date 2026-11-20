/**
 * Pruebas de los movimientos de la semana (lib/seo/movimientos.ts). Se corre con: npx tsx lib/seo/movimientos.prueba.ts
 */
import type { ConsultaGuardada } from './datos'
import { movimientosDe } from './movimientos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const ASIN = 'B0FK5X28D6'
const SEMANAS = ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01']
const ULTIMA = SEMANAS[4]

/** Una búsqueda con 5.000 impresiones del mercado y la cuota de impresiones que se pida (200 clics, 20 carritos, 10 compras del mercado) */
function fila(consulta: string, desde: string, cuota: number, impresiones = 5000): ConsultaGuardada {
  const ia = Math.round(impresiones * cuota)
  const ca = Math.round(200 * cuota)
  return {
    asin: ASIN, periodo: 'WEEK', desde, hasta: desde, consulta, puntuacion: null, volumen: 1000,
    impresionesTotal: impresiones, impresionesAsin: ia, cuotaImpresiones: ia / impresiones, clicsTotal: 200, clicsAsin: ca, cuotaClics: ca / 200, carritosTotal: 20, carritosAsin: 0, cuotaCarritos: 0,
    comprasTotal: 10, comprasAsin: 0, cuotaCompras: 0, precioMedianoTotal: null, precioMedianoAsin: null,
  }
}

/** 63 búsquedas al 2 % las 4 semanas anteriores; la última, lo que diga `ultima` (null = no sale) */
function historia(ultima: (i: number) => number | null, n = 63): ConsultaGuardada[] {
  const filas: ConsultaGuardada[] = []
  for (let i = 0; i < n; i++) {
    for (const s of SEMANAS.slice(0, 4)) filas.push(fila(`busqueda ${i}`, s, 0.02))
    const c = ultima(i)
    if (c != null) filas.push(fila(`busqueda ${i}`, ULTIMA, c))
  }
  return filas
}

console.log('\n=== movimientos de la semana ===')
{
  // Octubre de B0FK5X28D6 con la publicidad apagada: 32 bajan a la mitad y 30 desaparecen del informe
  const caida = movimientosDe(historia((i) => (i < 32 ? 0.01 : i < 62 ? null : 0.02)), ASIN, null)
  ok('base de 63, 32 bajan y 30 salen', caida.base === 63 && caida.bajan.length === 32 && caida.salen.length === 30 && caida.suben.length === 0, JSON.stringify({ base: caida.base, b: caida.bajan.length, s: caida.salen.length }))
  ok('→ caída general', caida.caidaGeneral === true)
  ok('la semana mirada es la última y hay 5 leídas', caida.semana === ULTIMA && caida.semanasLeidas === 5)
  ok('cada movimiento con su delta en puntos (2 % → 1 % = −1 pt)', Math.abs((caida.bajan[0].deltaPt as number) + 1) < 1e-9 && Math.abs(caida.bajan[0].cuotaMedia - 0.02) < 1e-12)
  ok('lo que sale va sin cuota de ahora', caida.salen.every((m) => m.cuotaAhora === null && m.deltaPt === null))

  const normal = movimientosDe(historia((i) => (i < 3 ? 0.01 : 0.02)), ASIN, null)
  ok('semana normal con 3 que bajan → no es caída general', normal.bajan.length === 3 && !normal.caidaGeneral, JSON.stringify({ b: normal.bajan.length, base: normal.base }))

  const poco = movimientosDe(historia((i) => (i < 3 ? 0.0225 : 0.02)), ASIN, null)
  ok('2 % → 2,25 % (+12 %) no se mueve', poco.suben.length === 0)
  const sube = movimientosDe(historia((i) => (i < 2 ? 0.04 : 0.02)), ASIN, null)
  ok('2 % → 4 % sube (+100 % y +2 pt)', sube.suben.length === 2 && Math.abs((sube.suben[0].deltaPt as number) - 2) < 1e-9)

  // 0,2 % → 0,6 %: +200 % pero solo 0,4 pt sí; 0,2 % → 0,4 %: +100 % y 0,2 pt no (hace falta 0,3 pt)
  const pequenas = (c: number) => {
    const f: ConsultaGuardada[] = []
    for (let i = 0; i < 12; i++) {
      for (const s of SEMANAS.slice(0, 4)) f.push(fila(`q ${i}`, s, 0.002, 50000))
      f.push(fila(`q ${i}`, ULTIMA, c, 50000))
    }
    return movimientosDe(f, ASIN, null)
  }
  ok('+100 % pero 0,2 pt → no se mueve (hacen falta 0,3 pt)', pequenas(0.004).suben.length === 0)
  ok('+200 % y 0,4 pt → sube', pequenas(0.006).suben.length === 12)

  // Base: al menos 2 de 4 semanas y media de 2.000 impresiones
  const unaSemana: ConsultaGuardada[] = [fila('rara', SEMANAS[3], 0.02), fila('poca', SEMANAS[2], 0.02, 1500), fila('poca', SEMANAS[3], 0.02, 1500)]
  ok('una búsqueda que sale 1 de 4 semanas o con menos de 2.000 impresiones de media no entra en la base', movimientosDe(unaSemana, ASIN, null).base === 0)
  ok('con base < 10, aunque todo caiga, no hay caída general', !movimientosDe(historia(() => null, 9), ASIN, null).caidaGeneral)

  // El producto no sale nada la última semana de la cuenta: todo «sale»
  const otro = fila('de otro', ULTIMA, 0.02)
  const desaparece = movimientosDe([...historia(() => null), { ...otro, asin: 'B0OTRO0001' }], ASIN, null)
  ok('si el producto desaparece la última semana de la cuenta, todo sale y es caída general', desaparece.semana === ULTIMA && desaparece.salen.length === 63 && desaparece.caidaGeneral)
  ok('sin semanas, vacío', movimientosDe([], ASIN, null).semana === null)
  ok('las ajenas marcadas no entran en la base', movimientosDe(historia((i) => (i < 32 ? 0.01 : 0.02)), ASIN, null, { ajenas: Array.from({ length: 63 }, (_, i) => `busqueda ${i}`) }).base === 0)
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
