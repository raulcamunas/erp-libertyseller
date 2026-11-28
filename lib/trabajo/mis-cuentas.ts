import { createServiceClient } from '@/lib/supabase/service'
import { clientesGrowth } from '@/lib/growth/clientes'
import { cuentasDeCliente } from '@/lib/ads/cuenta'
import { conexionesDeCliente } from '@/lib/cumplimiento/conexiones'
import { leerGestion, leerHechos } from '@/lib/cuentas/datos'
import { NOMBRE_SEMANA, pasosDeSemana, semanaDelCiclo } from '@/lib/cuentas/ciclo'

/**
 * «TUS CUENTAS HOY» (el bloque de arriba de «Mi día»). SOLO SERVIDOR.
 *
 * Por cada cuenta que lleva la persona (Cuentas de clientes, responsable): la semana del ciclo y los pasos que le faltan, y lo que espera en cada módulo:
 * PPC (cambios que el agente deja a una persona, productos sin la Buy Box, agente frenado), Cumplimiento (listings con stock que no se venden) y SEO
 * (propuestas de ficha por decidir). Todo de lo ya guardado: ni una llamada a Amazon. Sin la 307, o sin cuentas, vacío.
 */

export interface AvisoDeCuenta {
  modulo: 'ppc' | 'seo' | 'cumplimiento'
  texto: string
  tono: 'rojo' | 'ambar'
  href: string
}

export interface CuentaDeHoy {
  amazonClientId: string
  slug: string
  nombre: string
  semana: string | null
  pasosPendientes: Array<{ id: string; titulo: string }>
  pasosTotal: number
  avisos: AvisoDeCuenta[]
  href: string
}

const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export async function misCuentasHoy(userId: string): Promise<CuentaDeHoy[]> {
  const { porCliente } = await leerGestion()
  const mias = [...porCliente.values()].filter((g) => g.responsableId === userId)
  if (mias.length === 0) return []
  const clientes = new Map((await clientesGrowth()).filter((c) => c.amazonClientId).map((c) => [c.amazonClientId as string, c]))
  const hoy = hoyMadrid()
  const semanas = mias.map((g) => ({ g, s: semanaDelCiclo(g.cicloInicio, hoy) }))
  const hechos = await leerHechos(semanas.filter((x) => x.s).map((x) => ({ amazonClientId: x.g.amazonClientId, lunes: (x.s as NonNullable<typeof x.s>).lunes })))
  const s = createServiceClient()

  const salida = await Promise.all(
    semanas.map(async ({ g, s: sem }): Promise<CuentaDeHoy | null> => {
      const c = clientes.get(g.amazonClientId)
      if (!c) return null
      const pasos = sem ? pasosDeSemana(sem.semana) : []
      const hechosDe = hechos.get(g.amazonClientId) ?? new Set<string>()
      const avisos: AvisoDeCuenta[] = []
      const enPpc = `/dashboard/marketing-test?c=${encodeURIComponent(c.slug)}`
      const enSeo = `/dashboard/seo-test?c=${encodeURIComponent(c.slug)}`
      const enCumplimiento = `/dashboard/cumplimiento?c=${encodeURIComponent(c.slug)}`

      // PPC: retenidas para una persona, sin Buy Box y agente frenado (por todas sus cuentas de anuncios)
      const perfiles = (await cuentasDeCliente(g.amazonClientId).catch(() => [])).map((x) => x.id)
      if (perfiles.length > 0) {
        const [ret, bb, ag] = await Promise.all([
          s.from('ads_propuestas').select('id', { count: 'exact', head: true }).in('perfil_id', perfiles).eq('estado', 'pendiente').not('retenida_at', 'is', null),
          s.from('ads_agente_buybox').select('asin', { count: 'exact', head: true }).in('perfil_id', perfiles).not('sin_desde', 'is', null),
          s.from('ads_agente').select('estado').in('perfil_id', perfiles),
        ])
        if (((ag.data ?? []) as Array<{ estado: string }>).some((a) => a.estado === 'frenado')) avisos.push({ modulo: 'ppc', texto: 'El agente PPC está frenado', tono: 'rojo', href: `${enPpc}&t=agente` })
        if ((bb.count ?? 0) > 0) avisos.push({ modulo: 'ppc', texto: `${plural(bb.count ?? 0, 'producto anunciado', 'productos anunciados')} sin la Buy Box`, tono: 'ambar', href: enPpc })
        if ((ret.count ?? 0) > 0) avisos.push({ modulo: 'ppc', texto: `${plural(ret.count ?? 0, 'cambio de PPC espera', 'cambios de PPC esperan')} a que decidas`, tono: 'ambar', href: `${enPpc}&t=propuestas` })
      }

      // Cumplimiento: listings con stock que necesitan atención
      const conexiones = await conexionesDeCliente(g.amazonClientId).catch(() => [])
      if (conexiones.length > 0) {
        const { data } = await s.rpc('cumplimiento_cifras', { p_conexiones: conexiones.map((x) => x.id) })
        const conStock = ((data ?? []) as Array<{ atencion_con_stock?: number }>).reduce((a, f) => a + (Number(f.atencion_con_stock) || 0), 0)
        if (conStock > 0) avisos.push({ modulo: 'cumplimiento', texto: `${plural(conStock, 'listing con stock no se vende', 'listings con stock no se venden')} o están en riesgo`, tono: 'rojo', href: `${enCumplimiento}&t=bloqueos` })
        // SEO: propuestas de ficha por decidir
        const { count } = await s.from('seo_propuestas').select('id', { count: 'exact', head: true }).in('connection_id', conexiones.map((x) => x.id)).eq('estado', 'pendiente')
        if ((count ?? 0) > 0) avisos.push({ modulo: 'seo', texto: `${plural(count ?? 0, 'propuesta de ficha', 'propuestas de ficha')} por decidir`, tono: 'ambar', href: enSeo })
      }

      return {
        amazonClientId: g.amazonClientId,
        slug: c.slug,
        nombre: c.nombre,
        semana: sem ? NOMBRE_SEMANA[sem.semana] : null,
        pasosPendientes: pasos.filter((p) => !hechosDe.has(p.id)).map((p) => ({ id: p.id, titulo: p.titulo })),
        pasosTotal: pasos.length,
        avisos,
        href: `/dashboard/cuentas?c=${encodeURIComponent(c.slug)}`,
      }
    }),
  )
  return salida
    .filter((x): x is CuentaDeHoy => x != null)
    .sort((a, b) => b.avisos.filter((x) => x.tono === 'rojo').length - a.avisos.filter((x) => x.tono === 'rojo').length || b.avisos.length + b.pasosPendientes.length - (a.avisos.length + a.pasosPendientes.length) || a.nombre.localeCompare(b.nombre, 'es'))
}
