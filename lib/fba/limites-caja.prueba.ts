/**
 *   npx tsx lib/fba/limites-caja.prueba.ts
 */
import { esCajaPesada, fueraDeLimites, motivosDeLimites } from './limites-caja'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${d}`}`)
}
const caja = (pesoKg: number | null, lado = 40, unidades = 5) => ({ numero: 1, largoCm: lado, anchoCm: 30, altoCm: 30, pesoKg, unidades })
ok('23 kg pasa', fueraDeLimites(caja(23)).length === 0)
ok('23,1 kg no pasa', fueraDeLimites(caja(23.1)).some((x) => x.bloquea))
ok('63,5 cm pasa', fueraDeLimites(caja(10, 63.5)).length === 0)
ok('64 cm no pasa', fueraDeLimites(caja(10, 64)).some((x) => x.bloquea))
ok('una sola unidad de 30 kg: solo aviso', (() => { const r = fueraDeLimites(caja(30, 40, 1)); return r.length === 1 && !r[0].bloquea })())
ok('sin medidas ni peso: nada (eso lo dice «faltan medidas»)', fueraDeLimites({ numero: 1, largoCm: null, anchoCm: null, altoCm: null, pesoKg: null, unidades: 3 }).length === 0)
ok('motivos solo de lo que bloquea', motivosDeLimites([caja(28), caja(30, 40, 1)]).length === 1)
ok('15 kg es pesada; 14,9 no', esCajaPesada(15) && !esCajaPesada(14.9))
console.log(fallos === 0 ? '\n  TODO CORRECTO' : `\n  ${fallos} FALLOS`)
if (fallos) process.exit(1)
