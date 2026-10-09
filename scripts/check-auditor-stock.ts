/**
 * EL AUDITOR DE STOCK, CON EL ESPEJO HACIENDO DE AMAZON.
 *
 * NO llama a Amazon. Lee de Supabase el universo de SKU (la misma consulta que
 * usa el auditor de verdad) y cuenta con la cantidad que tiene el ESPEJO, que es
 * un dato de hace horas: sirve para comprobar que la consulta, el recuento y el
 * tamaño de lo que se guarda son los que tienen que ser, no para saber el stock
 * de ahora.
 *
 *   npx tsx scripts/check-auditor-stock.ts
 */
import { readFileSync } from 'node:fs'
for (const linea of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

async function main() {
  const { cuentaAuditada, universo, MERCADO_AUDITADO } = await import('../lib/auditor-stock/auditar')
  const { clasificar } = await import('../lib/auditor-stock/clasificar')
  const { fetchAll } = await import('../lib/supabase/paginacion')
  const { createServiceClient } = await import('../lib/supabase/service')

  const cuenta = await cuentaAuditada()
  if ('error' in cuenta) throw new Error(cuenta.error)
  console.log(`\n${cuenta.nombre} · conexion ${cuenta.connectionId}\n`)

  const t0 = Date.now()
  const filas = await universo(cuenta.connectionId, MERCADO_AUDITADO)
  console.log(`  universo: ${filas.length} SKU (hijos, sin padres de variacion)   ${Date.now() - t0} ms`)

  // El espejo haciendo de Amazon
  const service = createServiceClient()
  const espejoCrudo = await fetchAll<{
    sku: string
    asin: string | null
    quantity: number | null
    is_fba: boolean
  }>((a, b) =>
    service
      .from('amazon_listings')
      .select('sku, asin, quantity, is_fba')
      .eq('connection_id', cuenta.connectionId)
      .eq('marketplace_id', MERCADO_AUDITADO)
      .or('clasificacion_item.is.null,clasificacion_item.neq.VARIATION_PARENT')
      .order('sku', { ascending: true })
      .range(a, b)
  )

  const vivos = new Map(
    espejoCrudo.map((f) => [f.sku, { sku: f.sku, asin: f.asin, quantity: f.quantity, isFba: f.is_fba }])
  )
  const espejo = new Map(
    filas.map((f) => [
      f.sku,
      { sku: f.sku, asin: f.asin, fbaCantidad: f.fba_fulfillable_quantity ?? f.fba_quantity ?? null },
    ])
  )
  const skus = filas.map((f) => f.sku)

  const t1 = Date.now()
  const r = clasificar(skus, vivos, espejo)
  console.log(`  recuento: ${Date.now() - t1} ms\n`)

  console.log(`  pedidos      ${String(r.pedidos).padStart(7)}`)
  console.log(`  leidas       ${String(r.leidas).padStart(7)}`)
  console.log(`  CON STOCK    ${String(r.conStock).padStart(7)}   (FBM ${r.conStockFbm} · FBA ${r.conStockFba})`)
  console.log(`  SIN STOCK    ${String(r.sinStock).padStart(7)}`)
  console.log(`  SIN DATO     ${String(r.sinDato).padStart(7)}   <- NO son agotados`)
  console.log(`  unidades     ${String(r.unidades).padStart(7)}`)
  console.log(`  suma         ${String(r.conStock + r.sinStock + r.sinDato).padStart(7)}   (tiene que ser = leidas: ${r.conStock + r.sinStock + r.sinDato === r.leidas ? 'OK' : 'MAL'})`)

  const json = JSON.stringify(r.detalle)
  console.log(`\n  detalle: ${r.detalle.length} filas, ${(json.length / 1024).toFixed(0)} KB sin comprimir`)
  console.log(`  al dia (96 auditorias): ${((json.length * 96) / 1024 / 1024).toFixed(1)} MB sin comprimir`)
  console.log(`  a 21 dias de retencion: ${((json.length * 96 * 21) / 1024 / 1024).toFixed(0)} MB sin comprimir (TOAST comprime ~4x)`)

  console.log('\n  los 6 con mas stock:')
  for (const d of r.detalle.slice(0, 6)) {
    console.log(`    ${String(d[0]).padEnd(14)} ${String(d[1]).padEnd(12)} ${String(d[2]).padStart(6)}  ${d[3] === 'M' ? 'FBM' : 'FBA'}`)
  }

  const llamadas = Math.ceil(skus.length / 20)
  console.log(`\n  una auditoria real: ${llamadas} llamadas a Amazon, ~${Math.round(llamadas / 5)} s a 5 por segundo\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
