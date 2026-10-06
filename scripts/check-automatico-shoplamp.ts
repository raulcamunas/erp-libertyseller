/**
 * EL SIMULACRO DE LA PASADA AUTOMÁTICA. NO ENVÍA NADA.
 *
 * Construye el plan de verdad y aplica el mismo freno que
 * lib/precios-shoplamp/automatico.ts, pero sin llamar a Amazon. Es la forma de
 * ver qué haría el automático de las seis horas antes de dejarlo suelto.
 *
 *   npx tsx scripts/check-automatico-shoplamp.ts
 */

import { readFileSync } from 'node:fs'
for (const linea of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

async function main() {
  const { construirPlan } = await import('../lib/precios-shoplamp/plan')
  const { MAX_AUTOMATICO } = await import('../lib/precios-shoplamp/automatico')

  const plan = await construirPlan()
  const enviables = plan.filas.filter(
    (f) => f.estado === 'cambia' && f.destino !== null && f.productType !== null
  )

  console.log(`\nSIMULACRO — no se manda nada a Amazon\n`)
  console.log(`  cambian y se pueden enviar: ${enviables.length}`)
  console.log(`  tope del lote automatico:   ${MAX_AUTOMATICO}`)

  if (enviables.length > MAX_AUTOMATICO) {
    console.log(`\n  >>> SE PLANTARIA ENTERO: ${enviables.length} pasa de ${MAX_AUTOMATICO}`)
  } else {
    console.log(`\n  >>> publicaria ${enviables.length} precios`)
  }

  const porPais = new Map<string, number>()
  for (const f of enviables) porPais.set(f.pais, (porPais.get(f.pais) ?? 0) + 1)
  console.log('')
  for (const [pais, n] of [...porPais].sort()) console.log(`    ${pais.padEnd(10)} ${n}`)

  const mayores = [...enviables]
    .map((f) => ({ f, mov: Math.abs((f.destino as number) - (f.actual ?? 0)) / (f.actual || 1) }))
    .sort((a, b) => b.mov - a.mov)
    .slice(0, 8)
  console.log('\n  las que mas se mueven (ya NO se frenan: es la regla del cliente):')
  for (const { f, mov } of mayores) {
    console.log(
      `    ${f.sku.padEnd(16)} ${f.pais.padEnd(9)} ${String(f.actual ?? '—').padStart(7)} € -> ` +
        `${(f.destino as number).toFixed(2).padStart(7)} €   ${Math.round(mov * 100)} %`
    )
  }

  console.log(
    `\n  (base en Espana: ${plan.referenciasBase} referencias · plan: ${plan.filas.length} filas)\n`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
