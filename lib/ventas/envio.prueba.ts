import { aKg, costeDeFila, importeDeTabla, type TablaEnvio } from './envio'

let fallos = 0
const ok = (n: string, v: unknown, e: unknown) => {
  const bien = JSON.stringify(v) === JSON.stringify(e)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` → ${JSON.stringify(v)} (esperado ${JSON.stringify(e)})`}`)
}

// La de la captura de Sellerboard: una columna sin límite, España 3,60 · Francia 8 · Italia 7 · Alemania 9 · resto 0
const sb: TablaEnvio = { topes: [null], filas: [{ zona: 'ES', importes: [3.6] }, { zona: 'FR', importes: [8] }, { zona: 'IT', importes: [7] }, { zona: 'DE', importes: [9] }, { zona: 'resto', importes: [0] }] }
ok('España', importeDeTabla(sb, 'ES', 25), 3.6)
ok('Francia', importeDeTabla(sb, 'fr', 25), 8)
ok('Países Bajos → resto', importeDeTabla(sb, 'NL', 25), 0)

const tramos: TablaEnvio = { topes: [30, 60, null], filas: [{ zona: 'ES', importes: [3, 4, 5] }, { zona: 'resto', importes: [9, null, 12] }] }
ok('29,99 € → primer tramo', importeDeTabla(tramos, 'ES', 29.99), 3)
ok('30 € justo → primer tramo', importeDeTabla(tramos, 'ES', 30), 3)
ok('45 € → segundo', importeDeTabla(tramos, 'ES', 45), 4)
ok('200 € → sin límite', importeDeTabla(tramos, 'ES', 200), 5)
ok('hueco vacío → null', importeDeTabla(tramos, 'FR', 45), null)

const x = { pedidos: 4, unidades: 6, cobrado: 10, precioUnidad: 20, pais: 'ES', pesoUnidadKg: 0.8 }
ok('por precio: pedido medio 30 € → 3 × 4 pedidos', costeDeFila({ regla: 'precio', importe: 0, tabla: tramos }, x), 12)
ok('por unidades: 1,5 → 2 uds', costeDeFila({ regla: 'unidades', importe: 0, tabla: { topes: [1, 3], filas: [{ zona: 'ES', importes: [2, 3] }] } }, x), 12)
ok('por peso: 1,2 kg', costeDeFila({ regla: 'peso', importe: 0, tabla: { topes: [1, 2], filas: [{ zona: 'ES', importes: [2, 3.5] }] } }, x), 14)
ok('hueco → lo cobrado', costeDeFila({ regla: 'precio', importe: 0, tabla: tramos }, { ...x, pais: 'FR', precioUnidad: 30 }), 10)
ok('sin gastos', costeDeFila({ regla: 'ninguno', importe: 5 }, x), 0)
ok('fijo por pedido', costeDeFila({ regla: 'pedido', importe: 4.95 }, x), 19.8)
ok('en dólares (1,10 por euro)', Math.round(costeDeFila({ regla: 'pedido', importe: 11, porEuro: 1.1 }, x) * 100) / 100, 40)
ok('gramos', aKg(850, 'grams'), 0.85)
ok('libras', Math.round((aKg(2, 'pounds') ?? 0) * 1000) / 1000, 0.907)

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
if (fallos) process.exit(1)
