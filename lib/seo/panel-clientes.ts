import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { emojisDeClientes } from '@/lib/ventas/emoji-servidor'
import type { ClienteDelPanel, ResumenDelPanel } from '@/components/plataforma/PanelDeClientes'
import { conMemoria } from '@/lib/plataforma/memoria'
import { repartirAvisos } from '@/lib/plataforma/avisos-del-panel'
import { responsablesDeClientes } from '@/lib/cuentas/datos'

/**
 * SEO · EL PANEL DE TODOS LOS CLIENTES (la pantalla de inicio del módulo). De cada cliente, sumando sus países: productos que seguimos, propuestas de
 * ficha sin decidir, cambios aplicados en Amazon en los últimos 30 días, cambios que Amazon no aplicó, y cómo va la lectura de Brand Analytics y de
 * las fichas. Todo de lo ya guardado (`seo_productos`, `seo_propuestas`, `seo_ediciones`, `seo_lecturas`): ni una llamada a Amazon.
 */

const DIA = 86_400_000
const num = (n: number) => n.toLocaleString('es-ES')

type Cuenta = { connectionId: string; marketplaceId: string; pais: string }

async function todas<T>(pagina: (d: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const filas: T[] = []
  for (let d = 0; d < 100_000; d += 1000) {
    const { data, error } = await pagina(d)
    if (error) throw error
    const t = (data ?? []) as T[]
    filas.push(...t)
    if (t.length < 1000) break
  }
  return filas
}

async function panelSeoCalculo(clientes: Array<{ slug: string; nombre: string; amazonClientId?: string; cuentas: Cuenta[] }>): Promise<{ clientes: ClienteDelPanel[]; resumen: ResumenDelPanel[] }> {
  const s = createServiceClient()
  const conexiones = [...new Set(clientes.flatMap((c) => c.cuentas.map((x) => x.connectionId)))]
  const hace30 = new Date(Date.now() - 30 * DIA).toISOString()
  type Fila = { connection_id: string; marketplace_id: string }
  const vacio = <T,>() => Promise.resolve([] as T[])
  const [productos, propuestas, ediciones, lecturas, emojis, responsables] = await Promise.all([
    conexiones.length ? todas<Fila>((d) => s.from('seo_productos').select('connection_id, marketplace_id').in('connection_id', conexiones).order('id').range(d, d + 999)).catch(() => []) : vacio<Fila>(),
    conexiones.length ? todas<Fila>((d) => s.from('seo_propuestas').select('connection_id, marketplace_id').in('connection_id', conexiones).eq('estado', 'pendiente').order('id').range(d, d + 999)).catch(() => []) : vacio<Fila>(),
    conexiones.length
      ? todas<Fila & { estado: string }>((d) => s.from('seo_ediciones').select('connection_id, marketplace_id, estado').in('connection_id', conexiones).gte('created_at', hace30).order('id').range(d, d + 999)).catch(() => [])
      : vacio<Fila & { estado: string }>(),
    conexiones.length
      ? s
          .from('seo_lecturas')
          .select('connection_id, marketplace_id, estado, semana_ok, ficha_leida_at, acceso, error')
          .in('connection_id', conexiones)
          .then((r) => (r.data ?? []) as Array<Fila & { estado: string | null; semana_ok: string | null; ficha_leida_at: string | null; acceso: string | null; error: string | null }>)
      : vacio<Fila & { estado: string | null; semana_ok: string | null; ficha_leida_at: string | null; acceso: string | null; error: string | null }>(),
    emojisDeClientes(clientes.map((c) => c.nombre)).catch(() => new Map<string, string | null>()),
    responsablesDeClientes(),
  ])
  const clave = (f: Fila) => `${f.connection_id}|${f.marketplace_id}`
  const contar = (filas: Fila[]) => {
    const m = new Map<string, number>()
    for (const f of filas) m.set(clave(f), (m.get(clave(f)) ?? 0) + 1)
    return m
  }
  const nProductos = contar(productos)
  const nPropuestas = contar(propuestas)
  const nAplicadas = contar(ediciones.filter((e) => e.estado === 'aplicada' || e.estado === 'parcial'))
  const nFallidas = contar(ediciones.filter((e) => e.estado === 'no_aplicada' || e.estado === 'error'))
  const lectura = new Map(lecturas.map((l) => [clave(l), l]))

  const total = { productos: 0, propuestas: 0, aplicadas: 0, fallidas: 0 }
  let conAviso = 0
  const salida: ClienteDelPanel[] = clientes.map((c) => {
    let productosC = 0
    let propuestasC = 0
    let aplicadasC = 0
    let fallidasC = 0
    let semana: string | null = null
    let errores = 0
    let sinAcceso = 0
    for (const x of c.cuentas) {
      const k = `${x.connectionId}|${x.marketplaceId}`
      productosC += nProductos.get(k) ?? 0
      propuestasC += nPropuestas.get(k) ?? 0
      aplicadasC += nAplicadas.get(k) ?? 0
      fallidasC += nFallidas.get(k) ?? 0
      const l = lectura.get(k)
      if (l?.semana_ok && (!semana || l.semana_ok > semana)) semana = l.semana_ok
      if (l?.acceso === 'no') sinAcceso++
      else if (l?.error) errores++
    }
    total.productos += productosC
    total.propuestas += propuestasC
    total.aplicadas += aplicadasC
    total.fallidas += fallidasC
    const diasSemana = semana ? Math.floor((Date.now() - Date.parse(semana)) / DIA) : null
    const { aviso, masAvisos } = repartirAvisos([
      fallidasC > 0 && { texto: `${fallidasC} ${fallidasC === 1 ? 'cambio que Amazon no aplicó' : 'cambios que Amazon no aplicó'} en 30 días`, tono: 'rojo' },
      sinAcceso > 0 && { texto: 'Sin acceso a Brand Analytics (hace falta marca registrada)', tono: 'ambar' },
      errores > 0 && { texto: 'La última lectura de Brand Analytics falló', tono: 'ambar' },
      productosC > 0 && (diasSemana == null || diasSemana > 14) && { texto: diasSemana == null ? 'Brand Analytics sin leer todavía' : `Brand Analytics sin leer desde hace ${diasSemana} días`, tono: 'ambar' },
      propuestasC > 0 && { texto: `${propuestasC} ${propuestasC === 1 ? 'propuesta de ficha esperando' : 'propuestas de ficha esperando'} que decidas`, tono: 'ambar' },
    ])
    if (aviso) conAviso++
    return {
      id: c.slug,
      nombre: c.nombre,
      sub: `${c.cuentas.length} ${c.cuentas.length === 1 ? 'país' : 'países'} · ${c.cuentas.map((x) => x.pais).join(', ')}`,
      emoji: emojis.get(c.nombre) ?? null,
      href: `/dashboard/seo-test?c=${encodeURIComponent(c.slug)}`,
      principal: { texto: 'Cambios aplicados · 30 d', valor: num(aplicadasC), orden: aplicadasC, tono: aplicadasC ? 'verde' : undefined, ayuda: 'Fichas cambiadas en Amazon en los últimos 30 días' },
      cifras: [
        { texto: 'Productos', valor: num(productosC), orden: productosC, ayuda: 'Productos que seguimos en SEO' },
        { texto: 'Por decidir', valor: num(propuestasC), orden: propuestasC, tono: propuestasC ? 'ambar' : undefined, ayuda: 'Propuestas de ficha con IA sin aplicar ni descartar' },
        { texto: 'No aplicados', valor: num(fallidasC), orden: fallidasC, tono: fallidasC ? 'rojo' : undefined, ayuda: 'Cambios que Amazon rechazó o no aplicó (30 días)' },
        { texto: 'Brand Analytics', valor: diasSemana == null ? '—' : diasSemana <= 1 ? 'Al día' : `${diasSemana} d`, orden: diasSemana == null ? 9999 : diasSemana, tono: diasSemana == null ? undefined : diasSemana > 14 ? 'ambar' : 'verde', ayuda: semana ? `Última semana leída: ${semana}` : undefined },
      ],
      aviso,
      masAvisos,
      responsable: c.amazonClientId ? (responsables.get(c.amazonClientId) ?? null) : null,
      sinDatos: productosC === 0 && aplicadasC === 0 ? 'Sin productos en SEO todavía' : null,
    }
  })
  return {
    clientes: salida,
    resumen: [
      { texto: 'Productos seguidos', valor: num(total.productos) },
      { texto: 'Cambios aplicados · 30 d', valor: num(total.aplicadas), tono: 'verde' },
      { texto: 'Propuestas por decidir', valor: num(total.propuestas), tono: total.propuestas ? 'ambar' : undefined },
      { texto: 'No aplicados · 30 d', valor: num(total.fallidas), tono: total.fallidas ? 'rojo' : undefined },
      { texto: 'Clientes con aviso', valor: String(conAviso), tono: conAviso ? 'ambar' : 'verde' },
    ],
  }
}

/** Con memoria de 2 minutos (lib/plataforma/memoria.ts): el panel lo abre todo el equipo a primera hora y cada carga lee miles de filas */
export async function panelSeo(clientes: Array<{ slug: string; nombre: string; amazonClientId?: string; cuentas: Cuenta[] }>): Promise<{ clientes: ClienteDelPanel[]; resumen: ResumenDelPanel[] }> {
  return conMemoria(`panelSeo:${JSON.stringify(clientes)}`, 120_000, () => panelSeoCalculo(clientes))
}
