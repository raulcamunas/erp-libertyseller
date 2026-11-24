/** Pruebas de los informes urgentes: `npx tsx lib/analisis-amazon/urgentes.prueba.ts` */
import { anadirPedido, minutosDeEspera, pendientesUrgentes, resolverPedidos, textoDeEspera, vendedorDeUrl, type PedidoUrgente } from './urgentes'

let fallos = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(d)}`}`)
}
const p = (lead: string): Omit<PedidoUrgente, 'estado'> => ({ lead, tipo: 'sin', tienda: lead, por: 'u', at: '2026-11-24T12:00:00Z' })

// Espera: 148 de saldo, 21/min, una tienda sin Amazon (280) → faltan 132 → 7 min + 1 del cron
let m = minutosDeEspera([280], 148, 21)
ok('sin Amazon con 148 de saldo: 8 min', m.min === 8, m)
ok('…y como mucho si se cuela una de 280', m.max === Math.ceil((280 - 148 + 280) / 21) + 1, m)
m = minutosDeEspera([110], 500, 21)
ok('con saldo de sobra: 1 min', m.min === 1, m)
m = minutosDeEspera([280, 110], 0, 21)
ok('el segundo de la fila espera a los dos', m.min === 20, m) // 14 min (294, sobran 14) + 5 min para 110 + 1
ok('ritmo 0 no divide por cero', Number.isFinite(minutosDeEspera([110], 0, 0).min))
ok('texto corto', textoDeEspera({ min: 8, max: 9 }) === 'unos 9 min', textoDeEspera({ min: 8, max: 9 }))
ok('texto con horquilla', textoDeEspera({ min: 8, max: 75 }) === 'entre 8 min y 1 h 15 min', textoDeEspera({ min: 8, max: 75 }))

// La lista
let l = anadirPedido([], p('a'))
l = anadirPedido(l, p('b'))
l = anadirPedido(l, p('a'))
ok('pedir dos veces no duplica ni cambia el puesto', l.map((x) => x.lead).join() === 'a,b', l)
l = resolverPedidos(l, [{ lead: 'a', hecho: true, at: 'x' }, { lead: 'b', hecho: false, motivo: 'su web no contesta', at: 'x' }])
ok('el hecho sale, el saltado queda con su motivo', l.length === 1 && l[0].estado === 'saltado' && l[0].motivo === 'su web no contesta', l)
ok('sin pendientes', pendientesUrgentes(l).length === 0)
l = anadirPedido(l, p('b'))
ok('volver a pedir uno saltado lo pone pendiente', l.length === 1 && l[0].estado === 'pendiente' && !l[0].motivo, l)
// Lo pedido mientras la pasada trabajaba no se pierde
const releida = anadirPedido(l, p('c'))
const tras = resolverPedidos(releida, [{ lead: 'b', hecho: true, at: 'x' }])
ok('un pedido nuevo durante la pasada sigue en la lista', tras.map((x) => x.lead).join() === 'c', tras)

// Vendedor de la URL
ok('seller de amazon.es', vendedorDeUrl('https://www.amazon.es/sp?seller=a21xige30zkup3')?.seller === 'A21XIGE30ZKUP3')
ok('mercado de México', vendedorDeUrl('https://www.amazon.com.mx/sp?ie=UTF8&seller=A1B2C3D4E5')?.mercado === 'mx')
ok('sin seller', vendedorDeUrl('https://www.percyphoto.com') === null)

if (fallos) {
  console.log(`\n${fallos} fallos`)
  process.exit(1)
}
console.log('\nTodo bien')
