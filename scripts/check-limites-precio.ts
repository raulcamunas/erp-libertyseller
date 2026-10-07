/**
 * LOS ALCANCES DE «SINCRONIZAR PRECIO MÍN Y MÁX», CONTRA EL ESPEJO REAL.
 *
 * Solo lee de Supabase: NO llama a Amazon. Cuenta cuántas referencias se
 * preguntarían con cada alcance, y cuánto tardaría.
 *
 *   npx tsx scripts/check-limites-precio.ts shoesf A1RKKUPIHCS9HS
 */
import { readFileSync } from 'node:fs'
for (const linea of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

async function main() {
  const slug = process.argv[2] ?? 'shoesf'
  const marketplace = process.argv[3] ?? 'A1RKKUPIHCS9HS'

  const { createServiceClient } = await import('../lib/supabase/service')
  const { candidatos, resolverConexion } = await import('../lib/precios-limites/servidor')
  const { ALCANCES } = await import('../lib/precios-limites/diagnostico')

  const service = createServiceClient()
  const { data: cli } = await service.from('amazon_clients').select('id, name').eq('slug', slug).maybeSingle()
  if (!cli) throw new Error(`No hay cliente ${slug}`)

  const r = await resolverConexion((cli as { id: string }).id, marketplace)
  if ('error' in r) throw new Error(r.error)
  console.log(`\n${(cli as { name: string }).name} · ${marketplace} · conexion ${r.connectionId}\n`)

  for (const a of ALCANCES) {
    const t0 = Date.now()
    const c = await candidatos(r.connectionId, marketplace, a.id)
    const llamadas = Math.ceil(c.length / 20)
    console.log(
      `  ${a.id.padEnd(12)} ${String(c.length).padStart(6)} SKU   ` +
        `${String(llamadas).padStart(4)} llamadas a Amazon   ~${Math.max(1, Math.round(llamadas / 4 / 60))} min   (${Date.now() - t0} ms)`
    )
  }

  // Un pais que no es suyo se rechaza
  const mal = await resolverConexion((cli as { id: string }).id, 'ATVPDKIKX0DER')
  console.log(`\n  pais no autorizado -> ${'error' in mal ? 'RECHAZADO: ' + mal.error : 'PASA (MAL)'}`)
  const malCli = await resolverConexion('00000000-0000-0000-0000-000000000000', marketplace)
  console.log(`  cliente inexistente -> ${'error' in malCli ? 'RECHAZADO: ' + malCli.error : 'PASA (MAL)'}\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
