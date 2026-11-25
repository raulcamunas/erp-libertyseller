/**
 * AMAZON ADS · LA COSECHA DESDE SEO Y HELIUM 10, CON LOS DATOS DE VERDAD. SOLO SERVIDOR. No escribe en Amazon: deja «promover» pendientes con origen 'agente', y el
 * agente las aplica solo con sus frenos (lib/ads/agente/aplicar-servidor.ts: tope diario de cosechas, puja de partida limitada a la puja máxima, stock, postura…).
 *
 * Lo llama el motor en su paso diario (lib/ads/motor-cron.ts, `generarDelMotor`), SOLO en las cuentas en modo agente: es lo que Raúl pidió («sin aprobaciones»). Por producto
 * con ACoS objetivo y activo: lo que dice SEO (lib/ads/desde-seo-servidor.ts), el Cerebro de Helium 10 guardado (lib/seo/helium-servidor.ts), lo que ya hay en sus
 * campañas (lib/seo/publicidad.ts) y la decisión pura (lib/ads/cosecha-seo.ts). La propuesta va a su campaña de destino (EXACTA del producto o AMPLIA) y su grupo activo;
 * sin esa campaña activa, no se propone nada. La puja de partida es el CPC medio del producto en 30 días (lo que ya paga por un clic).
 */

import { createServiceClient } from '@/lib/supabase/service'
import { todasLasFilas } from './paginar'
import { cuentasSeoDeClientes } from '@/lib/seo/datos'
import { heliumDe } from '@/lib/seo/helium-servidor'
import { decisionesDeBusquedas } from '@/lib/seo/ajenas-servidor'
import { keywordsDelAsin } from '@/lib/seo/publicidad'
import { marcaEnBusqueda } from '@/lib/seo/marcas'
import { cuentaPorId, marketplaceDePais, productosDeCuenta } from './cuenta'
import { campanasDe } from './campanas'
import { gruposActivosDe } from './escritura'
import { leerTerminos } from './terminos'
import { asinDeCampana } from './productos-agrupar'
import { partesDeNombre } from './reglas'
import { elegirDestino, type DestinoDeCampana } from './motor-calculo'
import { desdeSeo } from './desde-seo-servidor'
import { cosechaDesdeSeo, norm as normCosecha } from './cosecha-seo'
import type { CuentaParaSincronizar } from './sincronizar'

const DIA = 86_400_000
const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()

export interface ResultadoDeCosechaSeo {
  productos: number
  nuevas: number
  sinCampana: number
  omitido?: string
}

export async function cosecharDesdeSeo(cuenta: CuentaParaSincronizar, presupuestoMs = 60_000): Promise<ResultadoDeCosechaSeo> {
  const arranque = Date.now()
  const c = await cuentaPorId(cuenta.id)
  if (!c?.clienteAmazonId) return { productos: 0, nuevas: 0, sinCampana: 0, omitido: 'sin cliente' }
  const mkt = marketplaceDePais(c.pais)
  const seo = mkt ? ((await cuentasSeoDeClientes([c.clienteAmazonId])).get(c.clienteAmazonId) ?? []).find((x) => x.marketplaceId === mkt) : undefined
  if (!seo) return { productos: 0, nuevas: 0, sinCampana: 0, omitido: 'sin cuenta de vendedor en este país' }

  const productos = (await productosDeCuenta(cuenta.id)).filter((p) => p.activo && p.asin && p.acosObjetivoPct != null)
  if (productos.length === 0) return { productos: 0, nuevas: 0, sinCampana: 0, omitido: 'sin productos con ACoS objetivo' }

  // Las campañas vivas de cada producto y rol (igual que la cosecha del motor)
  const { campanas } = await campanasDe(cuenta.conexionId, cuenta.profileId)
  const porAsinYRol = new Map<string, DestinoDeCampana & { activa: boolean }>()
  for (const x of campanas) {
    if (x.estado === 'ARCHIVED') continue
    const partes = partesDeNombre(x.nombre)
    const asin = asinDeCampana(x.nombre)
    if (!partes || !asin) continue
    const clave = `${asin}|${partes.rol}`
    const previa = porAsinYRol.get(clave)
    if (!previa || (!previa.activa && x.estado === 'ENABLED')) porAsinYRol.set(clave, { campaignId: x.campaignId, nombre: x.nombre, adGroupId: null, activa: x.estado === 'ENABLED' })
  }

  // Lo que no se vuelve a proponer: cosechas (de donde sean) pendientes o de los últimos 30 días, y negativas aplicadas en 90 días
  const service = createServiceClient()
  const desde30 = new Date(Date.now() - 30 * DIA).toISOString()
  const desde90 = new Date(Date.now() - 90 * DIA).toISOString()
  const { data: previas, error } = await todasLasFilas((a, b) =>
    service.from('ads_propuestas').select('termino, tipo, estado, creada_at, resuelta_at').eq('perfil_id', cuenta.id).in('tipo', ['promover', 'negativizar']).or(`estado.eq.pendiente,creada_at.gte.${desde90}`).order('id').range(a, b),
  )
  if (error) throw error
  const bloqueadas = new Set<string>()
  for (const r of (previas ?? []) as Array<{ termino: string; tipo: string; estado: string; creada_at: string }>) {
    if (r.tipo === 'promover' && (r.estado === 'pendiente' || r.creada_at >= desde30)) bloqueadas.add(norm(r.termino))
    if (r.tipo === 'negativizar' && (r.estado === 'aplicada' || r.estado === 'pendiente')) bloqueadas.add(norm(r.termino))
  }

  // El CPC medio de cada producto en 30 días: la puja de partida de lo cosechado
  const cpc = new Map<string, { clics: number; gasto: number }>()
  for (const t of await leerTerminos(cuenta.id).catch(() => [])) {
    const asin = asinDeCampana(t.campaignName)
    if (!asin) continue
    const x = cpc.get(asin) ?? { clics: 0, gasto: 0 }
    x.clics += t.clics
    x.gasto += t.gasto
    cpc.set(asin, x)
  }

  const { marcas } = await decisionesDeBusquedas(seo.connectionId, seo.marketplaceId).catch(() => ({ marcas: [] as Array<{ clave: string; texto: string; origen: string }> }))
  const esDeMarca = (t: string) => marcaEnBusqueda(t, marcas) !== null
  const grupos = new Map<string, string | null>()
  const grupoDe = async (campaignId: string) => {
    if (!grupos.has(campaignId)) grupos.set(campaignId, (await gruposActivosDe(cuenta.conexionId, cuenta.profileId, campaignId).catch(() => []))[0]?.adGroupId ?? null)
    return grupos.get(campaignId) ?? null
  }

  const resultado: ResultadoDeCosechaSeo = { productos: 0, nuevas: 0, sinCampana: 0 }
  for (const p of productos) {
    if (Date.now() - arranque > presupuestoMs) break
    const asin = p.asin.toUpperCase()
    try {
      const [ds, helium, kw] = await Promise.all([desdeSeo(c, asin), heliumDe(seo, asin).catch(() => null), keywordsDelAsin([cuenta.id], asin)])
      resultado.productos++
      const cosechas = cosechaDesdeSeo({
        seo: ds.palabras,
        helium: (helium?.palabras ?? []).map((h) => ({ keyword: h.keyword, volumen: h.volumen, rangoOrganico: h.rangoOrganico, oportunidad: h.oportunidad, decision: h.decision })),
        exactas: kw.exactas,
        cualquiera: new Set([...kw.exactas, ...kw.otras]),
        bloqueadas,
        esDeMarca,
      })
      const gasto = cpc.get(asin) ?? { clics: 0, gasto: 0 }
      for (const k of cosechas) {
        const destino = elegirDestino(porAsinYRol, asin, k.rol === 'MANUAL AMPLIA' ? 'MANUAL AMPLIA' : 'MANUAL EXACTA / ESTABILIDAD')
        if (!destino) {
          resultado.sinCampana++
          continue
        }
        const grupo = await grupoDe(destino.campaignId)
        if (!grupo) {
          resultado.sinCampana++
          continue
        }
        const fila = {
          perfil_id: cuenta.id,
          tipo: 'promover',
          asin,
          termino: k.termino,
          campaign_id: destino.campaignId,
          campaign_nombre: destino.nombre,
          ad_group_id: grupo,
          desde_rol: k.fuente === 'seo' ? 'SEO · Brand Analytics' : 'Helium 10',
          hacia_rol: destino.rol ?? k.rol,
          hacia_campaign_id: destino.campaignId,
          hacia_campaign_nombre: destino.nombre,
          hacia_ad_group_id: grupo,
          negativizar_en_origen: false,
          motivo: k.motivo,
          // Sin clics propios del término: la puja de partida es el CPC medio del producto (clics y gasto del producto), que el agente limita a su puja máxima
          metricas: { clics: Math.round(gasto.clics), gasto: Math.round(gasto.gasto * 100) / 100, pedidos: 0, ventas: 0, acosPct: null, fuente: k.fuente, ...(k.volumen != null ? { volumen: k.volumen } : {}) },
          origen: 'agente',
        }
        const { error: e } = await service.from('ads_propuestas').insert(fila)
        if (!e) {
          resultado.nuevas++
          bloqueadas.add(normCosecha(k.termino))
        } else if (e.code !== '23505') throw e
      }
    } catch (e) {
      console.error(`[ads] cosecha desde SEO de ${cuenta.id} (${asin}):`, e instanceof Error ? e.message : e)
    }
  }
  return resultado
}
