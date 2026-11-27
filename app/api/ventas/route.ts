import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, requireAmazonAdmin, UUID } from '@/lib/amazon/api'
import { canalesDeVentas, borrarPerfilEnvio, costoDeEnvio, guardarPerfilEnvio, importarEnvioPedidos, anadirCuenta, cambiarIva, cambiarIvaPorPais, cuentasDelPanel, cuentasParaAnadir, filasDelPanel, guardarCoste, guardarCostes, lineasDelPanel, motivosDeReembolso, productosDelPanel, resumenDeCuentas, sesionesDelPanel } from '@/lib/ventas/panel-servidor'

/**
 * VENTAS (EL «SELLERBOARD» PROPIO) · LO QUE USA EL PANEL. Solo administradores (como Amazon API: son las cifras de negocio de los clientes).
 *
 *   GET ?que=cuentas                                  las cuentas del panel y su estado de lectura (+ las que se pueden añadir)
 *   GET ?que=resumen&desde=&hasta=[&compDesde=&compHasta=]  todas las cuentas con sus cifras del periodo (el panel de todas)
 *   GET ?cuenta=&desde=&hasta=[&lineasDesde=&lineasHasta=]  las filas del resumen diario, títulos, costes y (si se piden) las líneas de pedido
 *   POST { accion: 'coste', cuenta, sku, coste|null }  el coste por unidad de un SKU
 *   POST { accion: 'costes', cuenta, costes: [{ sku, coste }] }  muchos de golpe (importar), hasta 5.000
 *   POST { accion: 'anadir', cuenta }                 da de alta una cuenta en el panel (la lectura empieza sola en la próxima pasada)
 *   POST { accion: 'iva', cuenta, iva }               el IVA que se descuenta en esa cuenta
 *   POST { accion: 'iva-pais', cuenta, porPais }      «IVA de cada país» (OSS): a cada venta el IVA de su mercado (migración 346)
 * Solo lee de la base, nunca de Amazon (eso lo hace el cron).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  try {
    const sesion = await requireAmazonAdmin()
    if (sesion instanceof NextResponse) return sesion
    const q = request.nextUrl.searchParams
    if (q.get('que') === 'cuentas') {
      const [cuentas, libres] = await Promise.all([cuentasDelPanel(), cuentasParaAnadir()])
      return NextResponse.json({ cuentas, libres })
    }
    // Costo de envío: los perfiles de la cuenta y cuántos pedidos tienen el coste importado
    if (q.get('que') === 'envio') {
      const c = q.get('cuenta') ?? ''
      if (!UUID.test(c)) return fail(400, 'Falta la cuenta.')
      return NextResponse.json(await costoDeEnvio(c))
    }
    // El panel de TODAS las cuentas (vista de pájaro): lo de cada una en el periodo y en el de comparación
    if (q.get('que') === 'resumen') {
      const desde = q.get('desde') ?? ''
      const hasta = q.get('hasta') ?? ''
      const cDesde = q.get('compDesde')
      const cHasta = q.get('compHasta')
      if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) return fail(400, 'Faltan las fechas.')
      const ok = (x: string | null) => (x && FECHA.test(x) ? x : null)
      return NextResponse.json({ resumen: await resumenDeCuentas(desde, hasta, ok(cDesde), ok(cHasta), ok(q.get('serieDesde'))) })
    }
    const cuenta = q.get('cuenta') ?? ''
    const desde = q.get('desde') ?? ''
    const hasta = q.get('hasta') ?? ''
    if (!UUID.test(cuenta) || !FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) return fail(400, 'Faltan la cuenta o las fechas.')
    // Los motivos de los reembolsos del periodo (lo que sale al pulsar «Reembolsos»)
    if (q.get('que') === 'motivos') {
      const lista = (k: string) => (q.get(k) ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 2000)
      return NextResponse.json(await motivosDeReembolso(cuenta, desde, hasta, { skus: lista('skus'), mercados: lista('mercados') }))
    }
    // Las ventas por canal (FBA / FBM) del periodo: la pestaña «FBA / FBM» del reparto
    if (q.get('que') === 'canal') {
      const lista = (k: string) => (q.get(k) ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 2000)
      return NextResponse.json(await canalesDeVentas(cuenta, desde, hasta, { skus: lista('skus'), mercados: lista('mercados') }))
    }
    const lDesde = q.get('lineasDesde')
    const lHasta = q.get('lineasHasta')
    const [filas, productos, lineas, sesiones] = await Promise.all([
      filasDelPanel(cuenta, desde, hasta),
      q.get('productos') === '0' ? Promise.resolve(null) : productosDelPanel(cuenta),
      lDesde && lHasta && FECHA.test(lDesde) && FECHA.test(lHasta) ? lineasDelPanel(cuenta, lDesde, lHasta) : Promise.resolve(null),
      sesionesDelPanel(cuenta, desde, hasta).catch(() => null),
    ])
    return NextResponse.json({ filas, productos, lineas, sesiones })
  } catch (error) {
    return errorResponse(error, 'Ventas: leer el panel')
  }
}

export async function POST(request: NextRequest) {
  try {
    const sesion = await requireAmazonAdmin()
    if (sesion instanceof NextResponse) return sesion
    const b = (await request.json().catch(() => ({}))) as { accion?: string; cuenta?: string; sku?: string; coste?: unknown; iva?: unknown }
    if (typeof b.cuenta !== 'string' || !UUID.test(b.cuenta)) return fail(400, 'Falta la cuenta.')
    if (b.accion === 'coste') {
      const sku = typeof b.sku === 'string' ? b.sku.trim() : ''
      if (!sku || sku.length > 200) return fail(400, 'Falta el SKU.')
      const coste = b.coste === null || b.coste === '' ? null : Number(b.coste)
      if (coste !== null && (!Number.isFinite(coste) || coste < 0 || coste > 100_000)) return fail(400, 'El coste no es válido.')
      await guardarCoste(b.cuenta, sku, coste === null ? null : Math.round(coste * 100) / 100, sesion.userId)
      return NextResponse.json({ ok: true })
    }
    if (b.accion === 'costes') {
      const lista = Array.isArray((b as { costes?: unknown }).costes) ? ((b as { costes: unknown[] }).costes as Array<{ sku?: unknown; coste?: unknown }>) : []
      const limpios = lista
        .map((x) => ({ sku: typeof x.sku === 'string' ? x.sku.trim() : '', coste: Number(x.coste) }))
        .filter((x) => x.sku && x.sku.length <= 200 && Number.isFinite(x.coste) && x.coste >= 0 && x.coste <= 100_000)
        .slice(0, 5000)
        .map((x) => ({ sku: x.sku, coste: Math.round(x.coste * 100) / 100 }))
      if (limpios.length === 0) return fail(400, 'No hay ningún coste válido.')
      return NextResponse.json({ ok: true, guardados: await guardarCostes(b.cuenta, limpios, sesion.userId) })
    }
    if (b.accion === 'envio-perfil') {
      const perfil = (b as { perfil?: Record<string, unknown> }).perfil
      if (!perfil || typeof perfil !== 'object') return fail(400, 'Falta el perfil.')
      if (perfil.id != null && (typeof perfil.id !== 'string' || !UUID.test(perfil.id))) return fail(400, 'Perfil no válido.')
      return NextResponse.json({ ok: true, id: await guardarPerfilEnvio(b.cuenta, perfil) })
    }
    if (b.accion === 'envio-borrar') {
      const id = (b as { id?: unknown }).id
      if (typeof id !== 'string' || !UUID.test(id)) return fail(400, 'Perfil no válido.')
      await borrarPerfilEnvio(b.cuenta, id)
      return NextResponse.json({ ok: true })
    }
    if (b.accion === 'envio-csv') {
      const lista = Array.isArray((b as { filas?: unknown }).filas) ? ((b as { filas: Array<{ pedido?: unknown; coste?: unknown }> }).filas) : []
      const limpias = lista
        .map((x) => ({ pedido: typeof x.pedido === 'string' ? x.pedido.trim() : '', coste: Number(x.coste) }))
        .filter((x) => /^[0-9A-Za-z-]{5,40}$/.test(x.pedido) && Number.isFinite(x.coste) && x.coste >= 0 && x.coste <= 10_000)
        .slice(0, 20_000)
      if (!limpias.length) return fail(400, 'No hay ninguna fila válida (pedido;coste).')
      return NextResponse.json({ ok: true, ...(await importarEnvioPedidos(b.cuenta, limpias)) })
    }
    if (b.accion === 'anadir') {
      await anadirCuenta(b.cuenta)
      return NextResponse.json({ ok: true })
    }
    if (b.accion === 'iva') {
      const iva = Number(b.iva)
      if (!Number.isFinite(iva) || iva < 0 || iva > 30) return fail(400, 'El IVA no es válido.')
      await cambiarIva(b.cuenta, iva)
      return NextResponse.json({ ok: true })
    }
    if (b.accion === 'iva-pais') {
      try {
        await cambiarIvaPorPais(b.cuenta, (b as { porPais?: unknown }).porPais === true)
      } catch (e) {
        if (/iva_por_pais/.test(String((e as { message?: string })?.message ?? ''))) return fail(409, 'Falta lanzar la migración 346 (IVA de cada país) en Supabase.')
        throw e
      }
      return NextResponse.json({ ok: true })
    }
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorResponse(error, 'Ventas: guardar')
  }
}
