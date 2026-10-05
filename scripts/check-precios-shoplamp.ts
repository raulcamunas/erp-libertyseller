/**
 * EL PLAN DE PRECIOS DE SHOPLAMP, CONTRA LA BASE DE VERDAD.
 *
 * Construye el plan exactamente como lo hace la pantalla y lo cuenta: cuántas
 * cambian por país, cuántas ya están bien, cuántas no tienen base en España, y
 * —lo importante— cómo se reparte la SUBIDA EN PORCENTAJE, que es lo que un
 * recargo fijo en euros hace distinto arriba y abajo del catálogo.
 *
 * No publica nada. No llama a Amazon. Solo lee.
 *
 *   npx tsx scripts/check-precios-shoplamp.ts
 */

import { readFileSync } from 'node:fs'

// `.env.local` a mano: el repo no tiene dotenv y para tres variables no merece
// una dependencia. Next lo lee solo cuando corre la aplicación, no aquí.
for (const linea of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

async function main() {
  const { construirPlan, resumir } = await import('../lib/precios-shoplamp/plan')

  const t0 = Date.now()
  const plan = await construirPlan()
  const ms = Date.now() - t0

  console.log(`\n${plan.clienteNombre} · conexión ${plan.connectionId ?? 'NINGUNA'} · ${ms} ms`)
  console.log(`catálogo leído por última vez: ${plan.catalogoAl ?? '—'}`)
  console.log(`referencias con precio en España: ${plan.referenciasBase}`)
  console.log(`filas del plan: ${plan.filas.length}\n`)

  for (const r of resumir(plan.filas)) {
    console.log(
      `  ${r.pais.padEnd(10)} +${(r.recargo).toFixed(2)} €  ` +
        `cambian ${String(r.cambia).padStart(4)}   ` +
        `ya ok ${String(r.yaCorrecto).padStart(4)}   ` +
        `sin base ${String(r.sinBase).padStart(4)}   ` +
        `base mala ${String(r.baseInvalida).padStart(3)}`
    )
  }

  const cambian = plan.filas.filter((f) => f.estado === 'cambia' && f.subida !== null)
  const tramos = [
    { h: 10, n: 0 },
    { h: 25, n: 0 },
    { h: 50, n: 0 },
    { h: 100, n: 0 },
    { h: 300, n: 0 },
    { h: Infinity, n: 0 },
  ]
  for (const f of cambian) {
    const t = tramos.find((x) => (f.subida as number) < x.h)
    if (t) t.n += 1
  }

  console.log('\n  reparto de la subida:')
  let desde = 0
  for (const t of tramos) {
    const etiqueta = t.h === Infinity ? `+${desde} % y más` : `${desde}–${t.h} %`
    console.log(`    ${etiqueta.padEnd(16)} ${String(t.n).padStart(5)}`)
    desde = t.h
  }

  const peores = [...cambian].sort((a, b) => (b.subida ?? 0) - (a.subida ?? 0)).slice(0, 8)
  console.log('\n  las que más suben:')
  for (const f of peores) {
    console.log(
      `    ${f.sku.padEnd(22)} ${f.pais.padEnd(9)} ` +
        `${(f.base ?? 0).toFixed(2)} € → ${(f.destino ?? 0).toFixed(2)} €  +${f.subida} %`
    )
  }

  // La comprobación que de verdad importa: que no haya ni un precio calculado
  // sobre una base que no existe, y que los céntimos salgan exactos.
  const fantasmas = plan.filas.filter((f) => f.destino !== null && f.base === null)
  const sucios = plan.filas.filter(
    (f) => f.destino !== null && Math.abs(f.destino * 100 - Math.round(f.destino * 100)) > 1e-9
  )
  const colados = plan.filas.filter(
    (f) => !['A13V1IB3VIYZZH', 'APJ6JRA9NG5V4', 'A1PA6795UKMFR9'].includes(f.marketplaceId)
  )

  console.log('')
  console.log(`  precios sin base (tienen que ser 0):            ${fantasmas.length}`)
  console.log(`  precios con céntimos sucios (tienen que ser 0): ${sucios.length}`)
  console.log(`  países que no son los tres (tienen que ser 0):  ${colados.length}`)
  console.log(
    fantasmas.length + sucios.length + colados.length === 0 ? '\nTODO BIEN\n' : '\nHAY FALLOS\n'
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
