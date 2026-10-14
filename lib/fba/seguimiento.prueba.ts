import { hayCambio } from './cambio'

let fallos = 0
function ok(nombre: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'FALLA'}  ${nombre}${bien ? '' : ` → ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`}`)
}

console.log('=== HISTORIAL DE ENVÍOS ===')
ok('la primera vez siempre se apunta', hayCambio(null, { estado: 'WORKING', recibidas: 0 }), true)
ok('igual que lo último: no se apunta', hayCambio({ estado_amazon: 'SHIPPED', unidades_recibidas: 0 }, { estado: 'SHIPPED', recibidas: 0 }), false)
ok('cambia el estado: se apunta', hayCambio({ estado_amazon: 'SHIPPED', unidades_recibidas: 0 }, { estado: 'IN_TRANSIT', recibidas: 0 }), true)
ok('mismo estado pero llegan unidades: se apunta', hayCambio({ estado_amazon: 'RECEIVING', unidades_recibidas: 10 }, { estado: 'RECEIVING', recibidas: 25 }), true)

console.log(fallos === 0 ? '\n  TODO CORRECTO' : `\n  ${fallos} FALLOS`)
if (fallos) process.exit(1)
