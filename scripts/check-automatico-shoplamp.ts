/**
 * EL SIMULACRO DE LA PASADA AUTOMÁTICA. NO ENVÍA NADA.
 *
 * Construye el plan de verdad y aplica los mismos frenos que
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
  const { MAX_AUTOMATICO, SALTO_MAXIMO, salto } = await import('../lib/precios-shoplamp/automatico')

  const plan = await construirPlan()
  const candidatas = plan.filas.filter(
    (f) => f.estado === 'cambia' && f.destino !== null && f.productType !== null
  )

  const frenadas = candidatas.filter((f) => salto(f.actual, f.destino as number) > SALTO_MAXIMO)
  const enviables = candidatas.filter((f) => salto(f.actual, f.destino as number) <= SALTO_MAXIMO)

  console.log(`\nSIMULACRO — no se manda nada a Amazon\n`)
  console.log(`  candidatas (cambian y se pueden enviar): ${candidatas.length}`)
  console.log(`  apartadas por saltar mas del ${Math.round(SALTO_MAXIMO * 100)} %: ${frenadas.length}`)
  console.log(`  se enviarian:                            ${enviables.length}`)
  console.log(`  tope del lote automatico:                ${MAX_AUTOMATICO}`)

  if (enviables.length > MAX_AUTOMATICO) {
    console.log(`\n  >>> SE PLANTARIA ENTERO: ${enviables.length} pasa de ${MAX_AUTOMATICO}`)
  } else {
    console.log(`\n  >>> publicaria ${enviables.length} precios`)
  }

  if (frenadas.length > 0) {
    console.log(`\n  las apartadas:`)
    for (const f of frenadas
      .sort((a, b) => salto(b.actual, b.destino as number) - salto(a.actual, a.destino as number))
      .slice(0, 10)) {
      const s = Math.round(salto(f.actual, f.destino as number) * 100)
      console.log(
        `    ${f.sku.padEnd(16)} ${f.pais.padEnd(9)} ${String(f.actual ?? '—').padStart(7)} € -> ` +
          `${(f.destino as number).toFixed(2).padStart(7)} €   ${s} %`
      )
    }
  }

  console.log(
    `\n  (base en Espana: ${plan.referenciasBase} referencias · plan: ${plan.filas.length} filas)\n`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
