/**
 * ¿QUÉ MIGRACIONES ESTÁN LANZADAS EN SUPABASE?  —  npx tsx scripts/estado-migraciones.ts [--desde 270]
 *
 * Las migraciones se lanzan a mano en el editor SQL, así que no hay registro de cuáles están. Esto lo averigua SOLO LEYENDO: lee cada fichero de supabase/migrations, saca las
 * tablas que crea (CREATE TABLE) y las columnas que añade (ADD COLUMN IF NOT EXISTS) y pregunta a la base si existen, con la clave de servicio de .env.local. No escribe nada.
 *
 *   ✓  todo lo que crea existe      ⚠  existe una parte (¿se pegó a medias?)      ✗  no existe nada de lo que crea      —  no crea tablas ni columnas (solo funciones, políticas…: no se comprueba)
 *
 * Una tabla que una migración posterior borra sale como «no existe»: es normal en las viejas, por eso por defecto solo mira las últimas (--desde 267).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

interface Objeto {
  tabla: string
  columna?: string
}

/** Lo que una migración crea, leído de su texto (sin comentarios SQL) */
export function objetosDe(sql: string): Objeto[] {
  const limpio = sql.replace(/--.*$/gm, '')
  const sal: Objeto[] = []
  for (const m of limpio.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) sal.push({ tabla: m[1].toLowerCase() })
  // ALTER TABLE x … ADD COLUMN IF NOT EXISTS a …, ADD COLUMN IF NOT EXISTS b … (varias columnas en una misma sentencia)
  for (const alter of limpio.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?([^;]*);/gi)) {
    for (const c of alter[2].matchAll(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"?([a-z_][a-z0-9_]*)"?/gi)) sal.push({ tabla: alter[1].toLowerCase(), columna: c[1].toLowerCase() })
  }
  return sal
}

const desde = Number(process.argv[process.argv.indexOf('--desde') + 1]) || 267

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const cache = new Map<string, boolean>()
  const existe = async (o: Objeto): Promise<boolean> => {
    const clave = `${o.tabla}.${o.columna ?? '*'}`
    if (cache.has(clave)) return cache.get(clave) as boolean
    const { error } = await s.from(o.tabla).select(o.columna ?? '*').limit(0)
    const falta = Boolean(error && (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST205' || error.code === 'PGRST204' || /does not exist|could not find/i.test(error.message)))
    cache.set(clave, !falta)
    return !falta
  }

  const dir = 'supabase/migrations'
  const ficheros = readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f) && Number(f.split('_')[0]) >= desde).sort()
  let hayPendientes = false
  for (const f of ficheros) {
    const objetos = objetosDe(readFileSync(join(dir, f), 'utf8'))
    if (objetos.length === 0) {
      console.log(`—  ${f}`)
      continue
    }
    const faltan: string[] = []
    for (const o of objetos) if (!(await existe(o))) faltan.push(o.columna ? `${o.tabla}.${o.columna}` : o.tabla)
    const estado = faltan.length === 0 ? '✓' : faltan.length === objetos.length ? '✗' : '⚠'
    if (estado !== '✓') hayPendientes = true
    console.log(`${estado}  ${f}${faltan.length ? `   falta: ${faltan.join(', ')}` : ''}`)
  }
  console.log(hayPendientes ? '\nHay migraciones sin lanzar (o a medias).' : '\nTodo lo que crean las migraciones comprobadas existe.')
}

if (process.argv[1]?.endsWith('estado-migraciones.ts')) main().catch((e) => { console.error(e); process.exit(1) })
