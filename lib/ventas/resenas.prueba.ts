import { campanaDelPedido, cuandoPedir, instanteEnMadrid, siNoLaOfrece, type Campana, type PedidoParaCola } from './resenas'

let fallos = 0
const igual = (nombre: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b)
  if (!ok) fallos++
  console.log(`${ok ? '  OK ' : '  MAL'}  ${nombre}${ok ? '' : `: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`}`)
}

const base: Campana = { id: 'c1', connection_id: 'x', nombre: 'Reseñas', prioridad: 1, activa: true, desde: '2026-11-01', hasta: null, dias_tras_entrega: 2, hora: 20, excluir_fbm: true, excluir_promo: false, mercados: null, productos_modo: 'todos', skus: [] }
const pedido: PedidoParaCola = { pedido: '1', marketplace_id: 'A1RKKUPIHCS9HS', fecha: '2026-11-10T10:00:00Z', dia: '2026-11-10', fbm: false, promo: 0, skus: ['A'], importe: 20 }

igual('una campaña activa se lleva el pedido', campanaDelPedido(pedido, [base])?.id, 'c1')
igual('pausada no', campanaDelPedido(pedido, [{ ...base, activa: false }]), null)
igual('FBM excluido', campanaDelPedido({ ...pedido, fbm: true }, [base]), null)
igual('con promoción excluido si se pide', campanaDelPedido({ ...pedido, promo: 3 }, [{ ...base, excluir_promo: true }]), null)
igual('antes de «desde» no', campanaDelPedido({ ...pedido, dia: '2026-10-31' }, [base]), null)
igual('otro país no', campanaDelPedido(pedido, [{ ...base, mercados: ['A13V1IB3VIYZZH'] }]), null)
igual('solo productos elegidos', campanaDelPedido(pedido, [{ ...base, productos_modo: 'solo', skus: ['B'] }]), null)
igual('todos menos los elegidos', campanaDelPedido(pedido, [{ ...base, productos_modo: 'excepto', skus: ['A'] }]), null)
igual('gana la de más prioridad', campanaDelPedido(pedido, [{ ...base, id: 'c2', prioridad: 2 }, base])?.id, 'c1')

igual('20:00 de Madrid en invierno = 19:00 UTC', instanteEnMadrid('2026-11-14', 20).toISOString(), '2026-11-14T19:00:00.000Z')
igual('20:00 de Madrid en verano = 18:00 UTC', instanteEnMadrid('2026-07-14', 20).toISOString(), '2026-07-14T18:00:00.000Z')
igual('compra + 2 de entrega + 2 de campaña', cuandoPedir('2026-11-10', base).toISOString(), '2026-11-14T19:00:00.000Z')

igual('aún pronto: mañana otra vez', siNoLaOfrece('2026-11-10', '2026-11-15'), { estado: 'en_cola', reintentarEl: '2026-11-16' })
igual('a los 14 días ya no la va a ofrecer', siNoLaOfrece('2026-11-01', '2026-11-15').estado, 'no_disponible')
igual('pasado el plazo', siNoLaOfrece('2026-10-01', '2026-11-15').estado, 'caducada')

console.log(fallos ? `\n${fallos} MAL` : '\nTODO BIEN')
if (fallos) process.exit(1)
