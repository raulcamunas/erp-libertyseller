import { diaALaVenta, diasValidos, etapasValidas, medirPlazos, repartirTotal, totalDeEtapas } from './plazos'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** PLAZOS POR ETAPAS. Lo que duele si falla: guardar un total que no es la suma, o aceptar basura que luego rompe las alertas */

console.log('\n=== validar ===')
{
  ok('0 y 365 valen; -1 y 366 no', diasValidos(0) === 0 && diasValidos(365) === 365 && diasValidos(-1) === null && diasValidos(366) === null)
  ok('decimales, vacío y texto no valen; «12» y «12,0» sí', diasValidos(1.5) === null && diasValidos('') === null && diasValidos('abc') === null && diasValidos('12') === 12 && diasValidos('12,0') === 12)
  ok('cuatro etapas buenas', JSON.stringify(etapasValidas({ preparacion: 7, transporte: 14, recepcion: 5, margen: 4 })) === '{"preparacion":7,"transporte":14,"recepcion":5,"margen":4}')
  ok('falta una → null', etapasValidas({ preparacion: 7, transporte: 14, recepcion: 5 }) === null)
  ok('todo a cero (total 0) → null: el plazo de las alertas es de 1 a 365', etapasValidas({ preparacion: 0, transporte: 0, recepcion: 0, margen: 0 }) === null)
  ok('suma de más de 365 → null', etapasValidas({ preparacion: 200, transporte: 200, recepcion: 0, margen: 0 }) === null)
  ok('no objeto → null', etapasValidas(null) === null && etapasValidas('x') === null)
}

console.log('\n=== repartir el total ===')
{
  for (const t of [1, 7, 30, 45, 60, 100, 365]) {
    const e = repartirTotal(t)
    ok(`el reparto de ${t} suma ${t}`, totalDeEtapas(e) === t, JSON.stringify(e))
  }
  ok('para CUALQUIER total de 1 a 365 el reparto suma justo ese total y no hay negativos', Array.from({ length: 365 }, (_, i) => i + 1).every((t) => { const e = repartirTotal(t); return totalDeEtapas(e) === t && Object.values(e).every((v) => v >= 0) }))
  ok('45 vuelve a las de partida', JSON.stringify(repartirTotal(45)) === '{"preparacion":10,"transporte":18,"recepcion":7,"margen":10}')
  ok('nada negativo', Object.values(repartirTotal(1)).every((v) => v >= 0))
}

console.log('\n=== el día a la venta ===')
{
  ok('hoy + 45', diaALaVenta('2026-11-10', 45) === '2026-12-25', diaALaVenta('2026-11-10', 45))
  ok('cruza el fin de año', diaALaVenta('2026-12-20', 20) === '2027-01-09')
}

console.log('\n=== medir ===')
{
  const r = [
    { aprobadaAt: '2026-10-01T10:00:00Z', fechaEnvio: '2026-10-06', llegadaAt: '2026-10-20T00:00:00Z' },
    { aprobadaAt: '2026-09-01T10:00:00Z', fechaEnvio: '2026-09-11', llegadaAt: '2026-09-23T00:00:00Z' },
    { aprobadaAt: null, fechaEnvio: '2026-08-01', llegadaAt: '2026-08-10T00:00:00Z' },
    { aprobadaAt: '2026-10-10T10:00:00Z', fechaEnvio: '2026-10-08', llegadaAt: null },
  ]
  const m = medirPlazos(r)
  ok('preparación: media de los que pasaron por propuesta y con fecha coherente (5 y 10 → 8; el -2 se descarta)', m.preparacion?.dias === 8 && m.preparacion?.envios === 2, JSON.stringify(m.preparacion))
  ok('del envío a la llegada: 14, 12 y 9 → 12', m.envioALlegada?.dias === 12 && m.envioALlegada?.envios === 3, JSON.stringify(m.envioALlegada))
  ok('sin datos → null', medirPlazos([]).preparacion === null && medirPlazos([]).envioALlegada === null)
  ok('solo cuenta los últimos N', medirPlazos(r, 1).envioALlegada?.envios === 1)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
if (fallos > 0) process.exit(1)
