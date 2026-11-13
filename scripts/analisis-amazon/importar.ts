/**
 * CARGA EN LA BASE LOS ANÁLISIS QUE VA BAJANDO KEEPA.
 *
 * La recogida (~/Dev/keepa-estudios/recoger.py) deja una carpeta por vendedor; cuando tiene `competencia.json`, está completa. Este
 * script construye el informe (lib/analisis-amazon/construir.ts), lo guarda en `analisis_amazon` con su enlace y marca el lead
 * (`cold_leads.analisis_amazon_at`), que es lo que enciende la casilla «Con informe» de Cold Calling.
 *
 * Idempotente: lo ya cargado se apunta en importados.json y no se repite; si se repite un día ya cargado, se actualiza el informe y se
 * conserva el enlace. Necesita la migración 303: sin ella no escribe nada y lo dice.
 *
 *   set -a && source .env.local && set +a && npx tsx scripts/analisis-amazon/importar.ts            una pasada
 *   … importar.ts --bucle                                                                           cada 5 minutos, sin parar
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { construirAnalisis } from '@/lib/analisis-amazon/construir'
import { falta303, nuevoToken } from '@/lib/analisis-amazon/servidor'

const K = process.env.KEEPA_ESTUDIOS ?? '/Users/raulcamunas/Dev/keepa-estudios/'
const HECHOS = K + 'importados.json'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

type EnCola = { lead: string; seller: string; tienda: string; comercial?: string }

const leer = (f: string) => JSON.parse(readFileSync(f, 'utf8'))
const hora = () => new Date().toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid' })

async function pasada(): Promise<'ok' | 'falta303'> {
  const cola: EnCola[] = leer(K + 'cola.json')
  const hechos: Record<string, string> = existsSync(HECHOS) ? leer(HECHOS) : {}
  let cargados = 0
  for (const v of cola) {
    const dir = K + v.seller + '/'
    if (hechos[v.seller] || !existsSync(dir + 'competencia.json')) continue
    const productos = leer(dir + 'productos.json')
    if (!productos.products?.length) {
      hechos[v.seller] = 'sin-datos'
      continue
    }
    const fecha: string = productos.fecha ?? new Date().toISOString().slice(0, 10)
    let informe
    try {
      informe = construirAnalisis({
        vendedorEs: leer(dir + 'seller_es.json'),
        productos,
        paises: existsSync(dir + 'paises.json') ? leer(dir + 'paises.json') : undefined,
        competencia: leer(dir + 'competencia.json'),
        fecha,
      })
    } catch (e) {
      console.log(hora(), 'no se puede construir', v.tienda, (e as Error).message)
      hechos[v.seller] = 'error'
      continue
    }

    const { data: previo, error: e1 } = await s.from('analisis_amazon').select('id, fecha').eq('lead_id', v.lead).order('fecha', { ascending: false })
    if (e1) {
      if (falta303(e1)) return 'falta303'
      console.log(hora(), 'error al leer', v.tienda, e1.message)
      continue
    }
    const mismoDia = (previo ?? []).find((p) => p.fecha === fecha)
    const { error: e2 } = mismoDia
      ? await s.from('analisis_amazon').update({ informe, tipo: informe.tipo }).eq('id', mismoDia.id)
      : await s.from('analisis_amazon').insert({
          lead_id: v.lead,
          seller_id: v.seller,
          token: nuevoToken(),
          fecha,
          version: (previo?.length ?? 0) + 1,
          tipo: informe.tipo,
          informe,
        })
    if (e2) {
      if (falta303(e2)) return 'falta303'
      console.log(hora(), 'error al guardar', v.tienda, e2.message)
      continue
    }
    const { error: e3 } = await s.from('cold_leads').update({ analisis_amazon_at: new Date().toISOString() }).eq('id', v.lead)
    if (e3) console.log(hora(), 'guardado pero sin marcar el lead', v.tienda, e3.message)
    hechos[v.seller] = fecha
    cargados++
    writeFileSync(HECHOS, JSON.stringify(hechos))
    await new Promise((r) => setTimeout(r, 150))
  }
  writeFileSync(HECHOS, JSON.stringify(hechos))
  const total = Object.values(hechos).filter((x) => /^\d{4}-/.test(x)).length
  console.log(hora(), `cargados ${cargados} nuevos · ${total} en total`)
  return 'ok'
}

async function main() {
  const bucle = process.argv.includes('--bucle')
  do {
    const r = await pasada().catch((e) => {
      console.log(hora(), 'fallo en la pasada', (e as Error).message)
      return 'ok' as const
    })
    if (r === 'falta303') console.log(hora(), 'Falta lanzar la migración 303: no se ha escrito nada')
    if (bucle) await new Promise((res) => setTimeout(res, 5 * 60_000))
  } while (bucle)
}
main()
