/**
 * PRUEBAS DE LO PURO DE LOS LOTES EN PANTALLA (useLotes.ts): cronograma, embudo al 100 %, curvas y textos.
 *
 *   cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx components/remesas/lotes/useLotes.prueba.ts
 */
import type { LoteEnvio } from '@/lib/fba/plan-tipos'
import { estadoDeLote, filasDeCronograma, loteDestacado, partesDelEmbudo, seriesDeCurvas, textoDuracion, velocidadDe } from './useLotes'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

function lote(p: Partial<LoteEnvio> & { remesaId: string }): LoteEnvio {
  return {
    nombre: p.remesaId,
    referenciaEnvio: null,
    fechaEnvio: '2026-09-01',
    fechaLlegada: '2026-09-07',
    diasTransito: 6,
    estadoAmazon: 'CLOSED',
    referencias: 1,
    embudo: { enviadas: 100, noLlegaron: 0, recibidas: 100, vendidas: 100, retiradasYMermas: 0, devueltasVendibles: 0, quedanVendibles: 0, noVendibles: 0 },
    hitos: { d50: 10, d80: 20, d100: 30 },
    duracionDias: 30,
    duracionEstimada: null,
    agotaraElEstimado: null,
    estimado: false,
    curva: [
      { dia: 0, pctVendido: 0 },
      { dia: 10, pctVendido: 50 },
      { dia: 30, pctVendido: 100 },
    ],
    porSku: [],
    vivo: false,
    ...p,
  }
}

const HOY = '2026-11-15'

console.log('\n=== estado ===')
ok('agotado', estadoDeLote(lote({ remesaId: 'a' })) === 'agotado')
ok('vivo', estadoDeLote(lote({ remesaId: 'v', duracionDias: null, vivo: true })) === 'vivo')
ok(
  'de camino: sin llegada ni ventas',
  estadoDeLote(lote({ remesaId: 'c', duracionDias: null, fechaLlegada: null, embudo: { ...lote({ remesaId: 'x' }).embudo, vendidas: 0, quedanVendibles: 100 } })) === 'camino'
)

console.log('\n=== cronograma ===')
{
  const agotado = lote({ remesaId: 'a', fechaEnvio: '2026-09-01', fechaLlegada: '2026-09-07', duracionDias: 30 })
  const vivo = lote({
    remesaId: 'v',
    fechaEnvio: '2026-10-20',
    fechaLlegada: '2026-10-26',
    duracionDias: null,
    vivo: true,
    agotaraElEstimado: '2026-12-05',
    embudo: { ...agotado.embudo, vendidas: 60, quedanVendibles: 40 },
    hitos: { d50: 12, d80: null, d100: null },
  })
  const camino = lote({ remesaId: 'c', fechaEnvio: '2026-11-10', fechaLlegada: null, duracionDias: null, embudo: { ...agotado.embudo, vendidas: 0, quedanVendibles: 100 }, hitos: { d50: null, d80: null, d100: null } })
  const c = filasDeCronograma([camino, vivo, agotado], HOY)
  const [fc, fv, fa] = c.filas
  ok('origen = el primer envío', c.origen === '2026-09-01', String(c.origen))
  ok('agotado: hueco 0, tránsito 6, venta 30, sin estimado', fa.hueco === 0 && fa.transito === 6 && fa.venta === 30 && fa.estimado === 0, JSON.stringify(fa))
  ok('agotado: d50 en el día 6 + 10 = 16 y d80 en 26', fa.marca50 === 16 && fa.marca80 === 26, JSON.stringify([fa.marca50, fa.marca80]))
  ok('vivo: venta hasta hoy (20 días) y estimado hasta el 5 dic (20 más)', fv.venta === 20 && fv.estimado === 20 && fv.finVenta === HOY, JSON.stringify(fv))
  ok('vivo: 60 % vendido', fv.pctVendido === 60)
  ok('vivo: d80 sin alcanzar → sin marca', fv.marca80 === null && fv.inicio === 49 && fv.marca50 === 49 + 6 + 12, JSON.stringify([fv.inicio, fv.marca50]))
  ok('de camino: todo tránsito hasta hoy (5 días), sin venta', fc.transito === 5 && fc.venta === 0 && fc.estado === 'camino', JSON.stringify(fc))
  ok('el eje llega hasta lo estimado', c.fin === fv.inicio + 6 + 20 + 20, String(c.fin))
  ok('hoy marcado en el eje', c.hoy === 75, String(c.hoy))
  const corto = filasDeCronograma([camino, vivo, agotado], HOY, 2)
  ok('los 20 más recientes (aquí 2) y el total para «Ver más»', corto.filas.length === 2 && corto.total === 3)
  ok('sin lotes', filasDeCronograma([], HOY).filas.length === 0)
}

console.log('\n=== embudo al 100 % ===')
{
  const p = partesDelEmbudo({ enviadas: 162, noLlegaron: 3, recibidas: 159, vendidas: 101, retiradasYMermas: 7, devueltasVendibles: 2, quedanVendibles: 45, noVendibles: 6 })
  ok('las cuatro partes suman 100', p.reduce((s, x) => s + x.pct, 0) === 100, JSON.stringify(p))
  ok('quedan = vendibles + no vendibles', p.find((x) => x.clave === 'quedan')?.valor === 51)
  ok('orden: vendidas, retiradas, quedan, no llegaron', p.map((x) => x.clave).join() === 'vendidas,retiradas,quedan,noLlegaron')
  const vacio = partesDelEmbudo({ enviadas: 0, noLlegaron: 0, recibidas: 0, vendidas: 0, retiradasYMermas: 0, devueltasVendibles: 0, quedanVendibles: 0, noVendibles: 0 })
  ok('sin nada: todo 0 %', vacio.every((x) => x.pct === 0))
  const tercios = partesDelEmbudo({ enviadas: 3, noLlegaron: 1, recibidas: 2, vendidas: 1, retiradasYMermas: 0, devueltasVendibles: 0, quedanVendibles: 1, noVendibles: 0 })
  ok('tercios: 34 + 33 + 33 y la vacía en 0', tercios.reduce((s, x) => s + x.pct, 0) === 100 && tercios.find((x) => x.clave === 'retiradas')?.pct === 0, JSON.stringify(tercios.map((x) => x.pct)))
}

console.log('\n=== curvas ===')
{
  const ls = Array.from({ length: 10 }, (_, i) => lote({ remesaId: `a${i}`, fechaLlegada: `2026-0${(i % 9) + 1}-10` }))
  const vivo = lote({ remesaId: 'v', duracionDias: null, vivo: true, curva: [{ dia: 0, pctVendido: 0 }, { dia: 5, pctVendido: 30 }] })
  const s = seriesDeCurvas([vivo, ...ls], 'v')
  ok('el destacado y los 8 últimos agotados', s.series.length === 9 && s.series.filter((x) => x.destacada).length === 1, String(s.series.length))
  ok('juntas por día y ordenadas', s.datos[0].dia === 0 && s.datos.some((d) => d.dia === 5 && d.v === 30))
  const sin = seriesDeCurvas(ls, null, 3)
  ok('sin destacado: solo los agotados', sin.series.length === 3 && !sin.series.some((x) => x.destacada))
}

console.log('\n=== textos ===')
ok('Duró 30 días', textoDuracion(lote({ remesaId: 'a' }), HOY) === 'Duró 30 días')
ok('Durará ~20 días más', textoDuracion(lote({ remesaId: 'v', duracionDias: null, vivo: true, agotaraElEstimado: '2026-12-05' }), HOY) === 'Durará ~20 días más')
ok('Vivo sin ritmo', textoDuracion(lote({ remesaId: 'v', duracionDias: null, vivo: true }), HOY) === 'Sin ritmo para estimar')
ok('destacado: el vivo', loteDestacado([lote({ remesaId: 'a' }), lote({ remesaId: 'v', duracionDias: null, vivo: true })])?.remesaId === 'v')
ok('velocidad', velocidadDe({ velocidadComparada: [{ remesaId: 'x', pct: 12 }] }, 'x') === '12 % más rápido que la mediana')
ok('velocidad lenta', velocidadDe({ velocidadComparada: [{ remesaId: 'x', pct: -20 }] }, 'x') === '20 % más lento que la mediana')
ok('sin velocidad', velocidadDe(null, 'x') === null)

console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} fallo(s).\n`)
if (fallos > 0) process.exit(1)
