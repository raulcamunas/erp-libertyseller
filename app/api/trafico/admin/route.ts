import { NextResponse, type NextRequest } from 'next/server'
import { fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { cuentaAuditada, MERCADO_AUDITADO } from '@/lib/auditor-stock/auditar'
import { activarEnlace, cambiarClave, crearEnlace, guardarJuegos, juegosParaEditar, listarEnlaces } from '@/lib/trafico/servidor'

/**
 * LOS ENLACES DE TRÁFICO PARA CLIENTES (migración 322). SOLO ADMINISTRADORES.
 *
 *   GET                                   → los enlaces (con cómo va la lectura) y los clientes con cuenta de vendedor conectada, para crear uno
 *   GET ?juegos=<id>                       → los ASIN de un enlace y a qué juego pertenece cada uno
 *   POST { accion: 'crear', clientId, marketplaceId, titulo, desde }   → crea el enlace; devuelve la clave UNA vez (no se guarda en claro)
 *   POST { accion: 'clave', id }            → clave nueva (cierra las sesiones abiertas); la devuelve una vez
 *   POST { accion: 'activar', id, activo }  → activa o desactiva el enlace
 *   POST { accion: 'juegos', id, filas: [{ asin, juego, producto }] } → guarda cómo se agrupan los ASIN
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const s = await requireAmazonAdmin()
  if (s instanceof NextResponse) return s
  try {
    const id = request.nextUrl.searchParams.get('juegos')
    if (id) return NextResponse.json({ juegos: await juegosParaEditar(id) })
    const service = createServiceClient()
    const [enlaces, clientes, conexiones] = await Promise.all([
      listarEnlaces(),
      service.from('amazon_clients').select('id, name').order('name'),
      service.from('amazon_connections').select('client_id, marketplace_ids').eq('is_active', true),
    ])
    const mercados = new Map<string, Set<string>>()
    for (const c of (conexiones.data ?? []) as Array<{ client_id: string; marketplace_ids: string[] | null }>) {
      const m = mercados.get(c.client_id) ?? new Set<string>()
      for (const x of c.marketplace_ids ?? []) m.add(x)
      mercados.set(c.client_id, m)
    }
    const conVendedor = ((clientes.data ?? []) as Array<{ id: string; name: string }>).filter((c) => mercados.has(c.id)).map((c) => ({ id: c.id, nombre: c.name, marketplaces: [...(mercados.get(c.id) ?? [])] }))
    return NextResponse.json({ disponible: true, enlaces, clientes: conVendedor })
  } catch (e) {
    if (isMissingSchema(e)) return NextResponse.json({ disponible: false, enlaces: [], clientes: [] })
    return fail(500, e instanceof Error ? e.message : 'No se han podido leer los enlaces.')
  }
}

export async function POST(request: NextRequest) {
  const s = await requireAmazonAdmin()
  if (s instanceof NextResponse) return s
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const id = typeof b.id === 'string' ? b.id : ''
  try {
    if (b.accion === 'crear') {
      // El auditor de stock es de UNA cuenta (ShoesF): el cliente y el país salen de ahí, no del formulario
      if (b.tipo === 'stock') {
        const cuenta = await cuentaAuditada()
        if ('error' in cuenta) return fail(404, cuenta.error)
        return NextResponse.json(await crearEnlace({ clientId: cuenta.clientId, marketplaceId: MERCADO_AUDITADO, titulo: b.titulo || `${cuenta.nombre} · stock Amazon y tienda`, desde: null, userId: s.userId, tipo: 'stock' }))
      }
      // El panel de PcComponentes es de Entrais: el cliente sale de ahí, no del formulario
      if (b.tipo === 'pccomponentes') {
        const { data: ent } = await createServiceClient().from('amazon_clients').select('id, name').ilike('name', 'entrais').limit(1).maybeSingle()
        if (!ent) return fail(404, 'No encuentro el cliente Entrais.')
        return NextResponse.json(await crearEnlace({ clientId: (ent as { id: string }).id, marketplaceId: 'PCCOMPONENTES', titulo: b.titulo || 'Entrais · PcComponentes', desde: null, userId: s.userId, tipo: 'pccomponentes' }))
      }
      return NextResponse.json(await crearEnlace({ clientId: b.clientId, marketplaceId: b.marketplaceId, titulo: b.titulo, desde: b.desde, userId: s.userId }))
    }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, 'Falta el enlace.')
    if (b.accion === 'clave') return NextResponse.json({ clave: await cambiarClave(id) })
    if (b.accion === 'activar') {
      await activarEnlace(id, b.activo === true)
      return NextResponse.json({ ok: true })
    }
    if (b.accion === 'juegos') return NextResponse.json({ guardados: await guardarJuegos(id, b.filas) })
    return fail(400, 'Acción desconocida.')
  } catch (e) {
    if (isMissingSchema(e)) return fail(503, 'Falta lanzar la migración 322 en Supabase.')
    return fail(400, e instanceof Error ? e.message : 'No se ha podido hacer.')
  }
}
