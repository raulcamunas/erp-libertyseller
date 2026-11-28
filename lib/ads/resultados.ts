import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { todasLasFilas } from './paginar'

/**
 * AMAZON ADS · LOS RESULTADOS DE LOS CAMBIOS (pestaña «Resultados»). SOLO SERVIDOR. Solo lee `ads_efectos` (migración 315), que mide cada cambio aplicado
 * por el agente: antes y después (de lo que se tocó y, en las pausas y negativas, de su campaña), un control y las ventas totales del producto.
 *
 * Todo por DÍA (las dos ventanas pueden tener días distintos): gasto y ventas al día antes y después. Por clase de cambio: cuántos mejoran, empeoran o
 * no se notan, y lo que suman al día en gasto y en ventas. Y la lista de los últimos cambios medidos con sus cifras.
 */

type Metricas = { clics: number; gasto: number; ventas: number; pedidos: number; dias: number }

export interface CambioMedido {
  propuestaId: string
  clase: string
  termino: string
  campana: string | null
  asin: string | null
  medidoAt: string
  veredicto: string
  detalle: string | null
  gastoDiaAntes: number
  gastoDiaDespues: number
  ventasDiaAntes: number
  ventasDiaDespues: number
  acosAntes: number | null
  acosDespues: number | null
  deshechoAuto: boolean
}

export interface ResultadoPorClase {
  clase: string
  medidos: number
  mejoro: number
  empeoro: number
  neutro: number
  /** Gasto al día que se ha dejado de gastar (positivo = ahorro) */
  ahorroGastoDia: number
  /** Ventas al día de más (negativo = menos ventas) */
  ventasDiaDeMas: number
}

const porDia = (m: Metricas | null | undefined, k: 'gasto' | 'ventas') => (m && m.dias > 0 ? (Number(m[k]) || 0) / m.dias : 0)
const acos = (m: Metricas | null | undefined) => (m && Number(m.ventas) > 0 ? Math.round((Number(m.gasto) / Number(m.ventas)) * 1000) / 10 : null)
const r2 = (n: number) => Math.round(n * 100) / 100

export async function resultadosDeCuenta(perfilId: string, dias = 60): Promise<{ disponible: boolean; porClase: ResultadoPorClase[]; cambios: CambioMedido[] }> {
  const s = createServiceClient()
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  const r = await todasLasFilas<Record<string, unknown>>(
    (a, b) =>
      s
        .from('ads_efectos')
        .select('propuesta_id, clase, asin, campaign_id, antes, despues, veredicto, detalle, medido_at, deshecho_auto')
        .eq('perfil_id', perfilId)
        .not('veredicto', 'is', null)
        .gte('medido_at', desde)
        .order('medido_at', { ascending: false })
        .order('propuesta_id')
        .range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null }>,
    20_000,
  )
  if (r.error) {
    if (isMissingSchema(r.error as { code?: string; message?: string })) return { disponible: false, porClase: [], cambios: [] }
    throw r.error
  }
  const filas = r.data
  // El término y la campaña de cada cambio (de su propuesta)
  const ids = filas.slice(0, 300).map((f) => String(f.propuesta_id))
  const textos = new Map<string, { termino: string; campana: string | null }>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await s.from('ads_propuestas').select('id, termino, campaign_nombre').in('id', ids.slice(i, i + 200))
    for (const p of (data ?? []) as Array<{ id: string; termino: string; campaign_nombre: string | null }>) textos.set(p.id, { termino: p.termino, campana: p.campaign_nombre })
  }

  const clases = new Map<string, ResultadoPorClase>()
  for (const f of filas) {
    const clase = String(f.clase)
    const antes = f.antes as Metricas | null
    const despues = f.despues as Metricas | null
    const c = clases.get(clase) ?? { clase, medidos: 0, mejoro: 0, empeoro: 0, neutro: 0, ahorroGastoDia: 0, ventasDiaDeMas: 0 }
    c.medidos++
    if (f.veredicto === 'mejoro') c.mejoro++
    else if (f.veredicto === 'empeoro') c.empeoro++
    else c.neutro++
    c.ahorroGastoDia += porDia(antes, 'gasto') - porDia(despues, 'gasto')
    c.ventasDiaDeMas += porDia(despues, 'ventas') - porDia(antes, 'ventas')
    clases.set(clase, c)
  }
  const cambios: CambioMedido[] = filas.slice(0, 300).map((f) => {
    const antes = f.antes as Metricas | null
    const despues = f.despues as Metricas | null
    const t = textos.get(String(f.propuesta_id))
    return {
      propuestaId: String(f.propuesta_id),
      clase: String(f.clase),
      termino: t?.termino ?? '',
      campana: t?.campana ?? null,
      asin: (f.asin as string | null) ?? null,
      medidoAt: String(f.medido_at),
      veredicto: String(f.veredicto),
      detalle: (f.detalle as string | null) ?? null,
      gastoDiaAntes: r2(porDia(antes, 'gasto')),
      gastoDiaDespues: r2(porDia(despues, 'gasto')),
      ventasDiaAntes: r2(porDia(antes, 'ventas')),
      ventasDiaDespues: r2(porDia(despues, 'ventas')),
      acosAntes: acos(antes),
      acosDespues: acos(despues),
      deshechoAuto: Boolean(f.deshecho_auto),
    }
  })
  return { disponible: true, porClase: [...clases.values()].map((c) => ({ ...c, ahorroGastoDia: r2(c.ahorroGastoDia), ventasDiaDeMas: r2(c.ventasDiaDeMas) })).sort((a, b) => b.medidos - a.medidos), cambios }
}
