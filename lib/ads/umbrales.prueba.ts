import { clicsPorPedido, cvrDeReferencia, sonDePartida, UMBRALES_DE_PARTIDA, umbralesValidos } from './umbrales'
import { precioParaMotor, ticketsMedios } from './margen'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== umbrales estimados ===')
{
  ok('sin nada guardado → los de partida', sonDePartida(umbralesValidos(null)) && sonDePartida(umbralesValidos({})))
  const u = umbralesValidos({ negativizarClicsPorCvr: 2.5, pedidosParaCosechar: '4', cvrPorDefectoPct: '12,5' })
  ok('se aceptan números y textos con coma', u.negativizarClicsPorCvr === 2.5 && u.pedidosParaCosechar === 4 && u.cvrPorDefectoPct === 12.5, JSON.stringify(u))
  ok('fuera de sus límites o sin sentido → se queda el de partida', umbralesValidos({ pujaMaxBajadaPct: 90, subirSiAcosBajoX: -1, diasSinCerrar: 'mucho' }).pujaMaxBajadaPct === UMBRALES_DE_PARTIDA.pujaMaxBajadaPct && umbralesValidos({ subirSiAcosBajoX: -1 }).subirSiAcosBajoX === 0.7 && umbralesValidos({ diasSinCerrar: 'mucho' }).diasSinCerrar === 3)
  ok('los de pedidos y días se redondean a entero', umbralesValidos({ pedidosParaSubir: 2.6, diasSinCerrar: 2.2 }).pedidosParaSubir === 3 && umbralesValidos({ diasSinCerrar: 2.2 }).diasSinCerrar === 2)
  ok('un campo vacío no es 0', umbralesValidos({ diasSinCerrar: '' }).diasSinCerrar === 3)
}

console.log('\n=== CVR de referencia ===')
{
  ok('la campaña con ≥ 3 pedidos manda', cvrDeReferencia({ campana: { clics: 100, pedidos: 8 }, producto: { clics: 1000, pedidos: 20 } }, 10).cvr === 0.08)
  const r = cvrDeReferencia({ campana: { clics: 40, pedidos: 1 }, producto: { clics: 400, pedidos: 20 } }, 10)
  ok('campaña con 1 pedido → el del producto', r.cvr === 0.05 && r.fuente === 'producto', JSON.stringify(r))
  ok('nada con pedidos suficientes → la cuenta y luego el de partida', cvrDeReferencia({ campana: null, producto: null, cuenta: { clics: 300, pedidos: 30 } }, 10).fuente === 'cuenta' && cvrDeReferencia({}, 12).cvr === 0.12 && cvrDeReferencia({}, 12).fuente === 'estimado')
  ok('acotado entre el 1 % y el 60 %', cvrDeReferencia({ campana: { clics: 3, pedidos: 3 } }, 10).cvr === 0.6 && cvrDeReferencia({}, 0.1).cvr === 0.01)
  ok('clics por pedido: 10 % → 10, 12 % → 9, 15 % → 7', clicsPorPedido(0.1) === 10 && clicsPorPedido(0.12) === 9 && clicsPorPedido(0.15) === 7)
}

console.log('\n=== precio con el que decide el motor ===')
{
  ok('el de la ficha manda', JSON.stringify(precioParaMotor(29.9, 25)) === JSON.stringify({ precio: 29.9, estimado: false }))
  ok('sin precio en la ficha → el ticket medio de Ads, marcado como estimación', JSON.stringify(precioParaMotor(null, 109.083)) === JSON.stringify({ precio: 109.08, estimado: true }))
  ok('sin ninguno → null (no se inventa)', precioParaMotor(null, null) === null && precioParaMotor(0, undefined) === null)
  const t = ticketsMedios([
    { asin: 'B0A', ventas: 79.98, unidades: 2 },
    { asin: 'B0A', ventas: 39.99, unidades: 1 },
    { asin: 'B0B', ventas: 0, unidades: 0 },
    { asin: null, ventas: 50, unidades: 1 },
  ])
  ok('ticket medio = ventas ÷ unidades; sin unidades no hay ticket', t.get('B0A') === 39.99 && !t.has('B0B') && t.size === 1, JSON.stringify([...t]))
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
