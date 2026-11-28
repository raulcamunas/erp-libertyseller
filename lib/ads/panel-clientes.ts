import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { tiposDeCambio } from '@/lib/divisas/servidor'
import { emojisDeClientes } from '@/lib/ventas/emoji-servidor'
import type { ClienteDelPanel, ResumenDelPanel } from '@/components/plataforma/PanelDeClientes'
import type { CuentaDeAnunciante } from './cuenta'

/**
 * PPC · EL PANEL DE TODOS LOS CLIENTES (la pantalla de inicio del módulo). De cada cliente con Amazon Ads: lo de los últimos 7 días frente a los 7
 * anteriores (gasto, ventas por publicidad, ACOS, ROAS, clics, CPC), las propuestas del motor sin decidir y cuándo se leyó por última vez.
 * Todo de lo ya guardado (`ads_rendimiento_diario`, `ads_propuestas`, `ads_sincronizacion`): ni una llamada a Amazon. En euros.
 */

const DIA = 86_400_000
const dia = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (n: number | null) => (n == null ? '—' : `${(n * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`)

async function todas<T>(pagina: (d: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const filas: T[] = []
  for (let d = 0; d < 200_000; d += 1000) {
    const { data, error } = await pagina(d)
    if (error) throw error
    const t = (data ?? []) as T[]
    filas.push(...t)
    if (t.length < 1000) break
  }
  return filas
}

export async function panelPpc(clientes: Array<{ slug: string; nombre: string; amazonClientId: string; cuentas: CuentaDeAnunciante[] }>): Promise<{ clientes: ClienteDelPanel[]; resumen: ResumenDelPanel[] }> {
  const s = createServiceClient()
  const perfiles = clientes.flatMap((c) => c.cuentas.map((x) => x.id))
  const hoy = Date.now()
  const desde = dia(hoy - 14 * DIA)
  const corte = dia(hoy - 7 * DIA)
  type Fila = { perfil_id: string; fecha: string; clics: number; gasto: number; ventas: number; pedidos: number }
  const [filas, propuestas, sincro, { porEuro }, emojis] = await Promise.all([
    perfiles.length ? todas<Fila>((d) => s.from('ads_rendimiento_diario').select('perfil_id, fecha, clics, gasto, ventas, pedidos').in('perfil_id', perfiles).gte('fecha', desde).order('perfil_id').order('fecha').order('campaign_id').range(d, d + 999)) : Promise.resolve([]),
    perfiles.length ? todas<{ perfil_id: string }>((d) => s.from('ads_propuestas').select('perfil_id').in('perfil_id', perfiles).eq('estado', 'pendiente').order('perfil_id').range(d, d + 999)).catch(() => []) : Promise.resolve([]),
    perfiles.length ? s.from('ads_sincronizacion').select('perfil_id, ultimo_ok_at').in('perfil_id', perfiles).then((r) => (r.data ?? []) as Array<{ perfil_id: string; ultimo_ok_at: string | null }>) : Promise.resolve([]),
    tiposDeCambio(),
    emojisDeClientes(clientes.map((c) => c.nombre)).catch(() => new Map<string, string | null>()),
  ])
  const monedaDe = new Map(clientes.flatMap((c) => c.cuentas.map((x) => [x.id, x.moneda ?? 'EUR'] as const)))
  const aEur = (n: number, perfil: string) => {
    const m = monedaDe.get(perfil) ?? 'EUR'
    const r = porEuro[m]
    return m === 'EUR' || !r ? n : n / r
  }
  type Suma = { gasto: number; ventas: number; clics: number; pedidos: number }
  const nueva = (): Suma => ({ gasto: 0, ventas: 0, clics: 0, pedidos: 0 })
  const ahora = new Map<string, Suma>()
  const antes = new Map<string, Suma>()
  for (const f of filas) {
    const m = f.fecha >= corte ? ahora : antes
    const x = m.get(f.perfil_id) ?? nueva()
    x.gasto += aEur(Number(f.gasto), f.perfil_id)
    x.ventas += aEur(Number(f.ventas), f.perfil_id)
    x.clics += Number(f.clics)
    x.pedidos += Number(f.pedidos)
    m.set(f.perfil_id, x)
  }
  const pendientes = new Map<string, number>()
  for (const p of propuestas) pendientes.set(p.perfil_id, (pendientes.get(p.perfil_id) ?? 0) + 1)
  const ultimo = new Map(sincro.map((x) => [x.perfil_id, x.ultimo_ok_at]))

  const total = nueva()
  const totalAntes = nueva()
  let conAviso = 0
  const salida: ClienteDelPanel[] = clientes.map((c) => {
    const a = nueva()
    const b = nueva()
    let props = 0
    let masViejo: number | null = null
    for (const x of c.cuentas) {
      const s1 = ahora.get(x.id)
      const s2 = antes.get(x.id)
      if (s1) for (const k of ['gasto', 'ventas', 'clics', 'pedidos'] as const) a[k] += s1[k]
      if (s2) for (const k of ['gasto', 'ventas', 'clics', 'pedidos'] as const) b[k] += s2[k]
      props += pendientes.get(x.id) ?? 0
      const u = ultimo.get(x.id)
      const t = u ? Date.parse(u) : 0
      masViejo = masViejo == null ? t : Math.min(masViejo, t)
    }
    for (const k of ['gasto', 'ventas', 'clics', 'pedidos'] as const) {
      total[k] += a[k]
      totalAntes[k] += b[k]
    }
    const acos = a.ventas > 0 ? a.gasto / a.ventas : null
    const acosAntes = b.ventas > 0 ? b.gasto / b.ventas : null
    const roas = a.gasto > 0 ? a.ventas / a.gasto : null
    const cpc = a.clics > 0 ? a.gasto / a.clics : null
    const dias = masViejo ? (hoy - masViejo) / DIA : null
    let aviso: ClienteDelPanel['aviso'] = null
    if (a.gasto > 20 && a.ventas === 0) aviso = { texto: `${eur(a.gasto)} gastados en 7 días sin ninguna venta`, tono: 'rojo' }
    else if (dias == null || dias > 3) aviso = { texto: dias == null ? 'Sin datos leídos de Amazon Ads todavía' : `Sin leer de Amazon Ads desde hace ${Math.floor(dias)} días`, tono: 'ambar' }
    else if (acos != null && acosAntes != null && acos > acosAntes * 1.3 && acos > 0.25) aviso = { texto: `ACOS ${pct(acos)}: sube desde ${pct(acosAntes)} la semana anterior`, tono: 'ambar' }
    else if (props > 0) aviso = { texto: `${props} ${props === 1 ? 'propuesta' : 'propuestas'} del motor esperando que decidas`, tono: 'ambar' }
    if (aviso) conAviso++
    const cambio = b.gasto > 0 ? (a.gasto - b.gasto) / b.gasto : null
    return {
      id: c.slug,
      nombre: c.nombre,
      sub: `${c.cuentas.length} ${c.cuentas.length === 1 ? 'país' : 'países'} · ${c.cuentas.map((x) => x.pais).filter(Boolean).join(', ')}`,
      emoji: emojis.get(c.nombre) ?? null,
      href: `/dashboard/marketing-test?c=${encodeURIComponent(c.slug)}`,
      principal: { texto: 'Ventas por publicidad · 7 d', valor: eur(a.ventas), orden: a.ventas, ayuda: `Semana anterior: ${eur(b.ventas)}` },
      cifras: [
        { texto: 'Gasto', valor: eur(a.gasto), orden: a.gasto, ayuda: cambio == null ? undefined : `${cambio >= 0 ? '+' : ''}${(cambio * 100).toFixed(0)} % frente a la semana anterior` },
        { texto: 'ACOS', valor: pct(acos), orden: acos ?? -1, tono: acos == null ? undefined : acos > 0.35 ? 'rojo' : acos > 0.25 ? 'ambar' : 'verde', ayuda: acosAntes == null ? undefined : `Semana anterior: ${pct(acosAntes)}` },
        { texto: 'ROAS', valor: roas == null ? '—' : roas.toLocaleString('es-ES', { maximumFractionDigits: 2 }), orden: roas ?? -1 },
        { texto: 'CPC', valor: cpc == null ? '—' : eur(cpc), orden: cpc ?? -1, ayuda: `${a.clics.toLocaleString('es-ES')} clics` },
      ],
      aviso,
      sinDatos: c.cuentas.length === 0 ? 'Sin cuentas de Amazon Ads encendidas' : null,
    }
  })
  const acosTotal = total.ventas > 0 ? total.gasto / total.ventas : null
  const acosTotalAntes = totalAntes.ventas > 0 ? totalAntes.gasto / totalAntes.ventas : null
  return {
    clientes: salida,
    resumen: [
      { texto: 'Gasto · 7 días', valor: eur(total.gasto) },
      { texto: 'Ventas por publicidad', valor: eur(total.ventas), tono: 'verde' },
      { texto: 'ACOS global', valor: pct(acosTotal), tono: acosTotal != null && acosTotalAntes != null && acosTotal > acosTotalAntes ? 'ambar' : undefined },
      { texto: 'Pedidos', valor: total.pedidos.toLocaleString('es-ES') },
      { texto: 'Clientes con aviso', valor: String(conAviso), tono: conAviso ? 'ambar' : 'verde' },
    ],
  }
}
