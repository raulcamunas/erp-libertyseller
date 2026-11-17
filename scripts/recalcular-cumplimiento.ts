/**
 * Recalcula errores/avisos/suprimido/tema(s) de listing_cumplimiento desde las incidencias guardadas, con las reglas actuales de resumir()
 * (17 nov 2026: un error de «datos» que no oculta cuenta como aviso). npx tsx scripts/recalcular-cumplimiento.ts [--aplicar]
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { resumir } from '../lib/cumplimiento/incidencias'
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const aplicar = process.argv.includes('--aplicar')
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
;(async () => {
  const ahora = new Date()
  let vistas = 0, cambian = 0, dejanDeAtender = 0
  for (let d = 0; ; d += 500) {
    const { data, error } = await s.from('listing_cumplimiento').select('id,incidencias,errores,avisos,suprimido,tema,temas').order('id').range(d, d + 499)
    if (error) throw error
    for (const r of data ?? []) {
      vistas++
      const n = resumir((r.incidencias ?? []) as never, ahora)
      if (n.errores === r.errores && n.avisos === r.avisos && n.suprimido === r.suprimido) continue
      cambian++
      if ((r.errores > 0 || r.suprimido) && !(n.errores > 0 || n.suprimido)) dejanDeAtender++
      if (aplicar) {
        const { error: e2 } = await s.from('listing_cumplimiento').update({ errores: n.errores, avisos: n.avisos, suprimido: n.suprimido, tema: n.tema, temas: n.temas }).eq('id', r.id)
        if (e2) throw e2
      }
    }
    if (!data || data.length < 500) break
  }
  console.log({ vistas, cambian, dejanDeAtender, aplicado: aplicar })
})()
