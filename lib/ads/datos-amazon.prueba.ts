import { tarifasAFicha } from './datos-amazon'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== tarifas de Amazon → ficha del producto ===')
{
  const a = tarifasAFicha({ referral: 4.64, fba: 3.415, otras: 0.1 }, 29.9)
  ok('comisión en % del precio con IVA, a un decimal', a.comisionPct === 15.5, JSON.stringify(a))
  ok('FBA y otros redondeados a céntimos', a.tarifaFba === 3.42 && a.otrosCostes === 0.1, JSON.stringify(a))
  const b = tarifasAFicha({ referral: null, fba: null, otras: null }, 29.9)
  ok('sin comisión desglosada → null (no un 15 % inventado); sin FBA → 0', b.comisionPct === null && b.tarifaFba === 0 && b.otrosCostes === 0, JSON.stringify(b))
  ok('precio 0 → comisión null, sin dividir entre cero', tarifasAFicha({ referral: 1, fba: 0, otras: 0 }, 0).comisionPct === null)
  ok('comisión mínima: 0,30 sobre 1,50 = 20 %', tarifasAFicha({ referral: 0.3, fba: 0, otras: 0 }, 1.5).comisionPct === 20)
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
