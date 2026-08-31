import { NextResponse, type NextRequest } from 'next/server'
import { fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { EntraisError, faltaConfigurar } from '@/lib/entrais/api'
import { calcularTodo, leerConfig } from '@/lib/entrais/motor'
import { cargarTarifa, listarBloqueados } from '@/lib/entrais/bloqueados'
import type { FilaTarifa } from '@/lib/entrais/tarifa'

/**
 * EL MOTOR DE PRECIOS DE ENTRAIS.
 *
 * Tres acciones en una ruta, porque son tres caras de la misma pantalla y
 * partirlas en tres ficheros solo repartiría el mismo `requireAmazonAdmin` por
 * tres sitios:
 *
 *   leer      la configuración, los precios calculados y el historial
 *   guardar   cambiar la configuración del motor
 *   calcular  recalcular el catálogo entero
 *   tarifa    cargar el CSV del proveedor para saber qué NO se puede vender
 *
 *
 * ============ NINGUNA DE LAS TRES PUBLICA NADA EN AMAZON ============
 *
 * `calcular` lee el catálogo del proveedor, lo cruza y guarda LA PROPUESTA. No
 * escribe ni un precio en la tienda del cliente. El día que eso se haga, será
 * su propia ruta, con su confirmación y su registro de quién publicó qué — y no
 * un cuarto valor en este desplegable.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// El catálogo entero de Entrais tarda ~48 s en llegar, y luego hay que cruzarlo
// contra 2.700 listings y escribir 6.900 filas.
export const maxDuration = 300

const CAMPOS_CONFIG = [
  'connection_id',
  'marketplace_id',
  'entorno',
  'margen_global',
  'usar_tramos',
  'tramos',
  'decidir_tramo_por',
  'iva_venta',
  'porte',
  'tasa_digital',
  'tarifa_por_defecto',
  'redondeo',
  'margen_suelo',
  'publicar_automatico',
  'publicar_cada_minutos',
  'publicar_max_salto_pct',
  'publicar_max_por_pasada',
] as const

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      accion?: string
      marcados?: unknown
      leidos?: unknown
      fecha?: unknown
      config?: Record<string, unknown>
      regla?: Record<string, unknown>
    }
    const service = createServiceClient()

    /* ---------------- Guardar la configuración ---------------- */
    if (body.accion === 'guardar') {
      const config = await leerConfig()
      // Solo los campos conocidos. Un PATCH abierto desde el navegador contra
      // una tabla de configuración es una puerta a escribir lo que no toca.
      const patch: Record<string, unknown> = {}
      for (const campo of CAMPOS_CONFIG) {
        if (body.config && campo in body.config) patch[campo] = body.config[campo]
      }
      if (Object.keys(patch).length === 0) return fail(400, 'No hay nada que guardar.')

      patch.updated_at = new Date().toISOString()
      patch.updated_by = session.userId

      const { error } = await service.from('entrais_config').update(patch).eq('id', config.id)
      if (error) return fail(400, error.message)
      return NextResponse.json({ ok: true, config: await leerConfig() })
    }

    /* ---------------- Guardar una regla de porte ---------------- */
    if (body.accion === 'porte') {
      const r = (body.regla ?? {}) as { id?: string; importe?: number; activa?: boolean }
      if (!r.id) return fail(400, 'Falta la regla.')
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: session.userId }
      if (typeof r.importe === 'number' && r.importe >= 0) patch.importe = r.importe
      if (typeof r.activa === 'boolean') patch.activa = r.activa
      const { error } = await service.from('entrais_portes').update(patch).eq('id', r.id)
      if (error) return fail(400, error.message)
      return NextResponse.json({ ok: true })
    }

    /* ---------------- La tarifa: qué NO se puede vender ----------------
     *
     * Llegan las filas de envío directo ya leídas por la pantalla, no el
     * fichero: son veinte megas y de sus veinticinco columnas hacen falta
     * cuatro. Ver `cargarTarifa` para por qué eso obliga a desconfiar de lo que
     * llega y qué comprobación lo cubre. */
    if (body.accion === 'tarifa') {
      const filas = Array.isArray(body.marcados) ? (body.marcados as FilaTarifa[]) : []
      const leidos = Number(body.leidos)
      if (!Number.isFinite(leidos) || leidos <= 0) {
        return fail(400, 'No ha llegado cuántos artículos traía el fichero.')
      }
      const limpias: FilaTarifa[] = []
      for (const f of filas) {
        const sku = String(f?.sku ?? '').trim()
        if (!sku) continue
        limpias.push({
          sku,
          nombre: String(f?.nombre ?? '').slice(0, 200),
          familia: String(f?.familia ?? '').slice(0, 80),
          precio: Number.isFinite(Number(f?.precio)) ? Number(f.precio) : null,
          envioDirecto: true,
        })
      }
      try {
        const r = await cargarTarifa(limpias, {
          leidos,
          fecha: typeof body.fecha === 'string' && body.fecha ? body.fecha : null,
          usuario: session.userId,
        })
        return NextResponse.json({ ok: true, carga: r })
      } catch (error) {
        return fail(400, error instanceof Error ? error.message : 'No se ha podido cargar la tarifa')
      }
    }

    /* ---------------- Recalcular ---------------- */
    if (body.accion === 'calcular') {
      const config = await leerConfig()
      const falta = faltaConfigurar(config.entorno)
      if (falta) return fail(400, falta)

      const t0 = Date.now()
      const { resumen } = await calcularTodo({ lanzadoPor: session.userId })
      return NextResponse.json({ ok: true, ms: Date.now() - t0, resumen })
    }

    /* ---------------- Leer ---------------- */
    const config = await leerConfig()

    const precios = await fetchAll<Record<string, unknown>>((a, b) =>
      service
        .from('entrais_precios')
        .select('*')
        .order('sku', { ascending: true })
        .range(a, b)
    )

    const { data: ejecuciones } = await service
      .from('entrais_ejecuciones')
      .select('*')
      .order('empezado_at', { ascending: false })
      .limit(20)

    const { data: portes } = await service
      .from('entrais_portes')
      .select('*')
      .order('orden', { ascending: true })

    const { data: propios } = await service
      .from('entrais_margenes_sku')
      .select('sku, margen, motivo')
      .order('sku')

    const bloqueados = await listarBloqueados()

    /* ---------------- Con qué cuentas se puede contrastar ---------------- */
    // Para que la pantalla ofrezca elegir cuenta y país sin tener que ir a otra
    // pestaña a mirar cuáles hay.
    const { data: conexiones } = await service
      .from('amazon_connections')
      .select('id, name, marketplace_ids, marketplaces_activos')
      .eq('is_active', true)
      .eq('status', 'activa')
      .order('name')

    return NextResponse.json({
      ok: true,
      config,
      precios,
      ejecuciones: ejecuciones ?? [],
      portes: portes ?? [],
      propios: propios ?? [],
      bloqueados,
      conexiones: conexiones ?? [],
      faltaCredencial: faltaConfigurar(config.entorno),
    })
  } catch (error) {
    if (error instanceof EntraisError) return fail(400, error.message)
    console.error('Error en el motor de precios de Entrais:', error)
    return fail(500, error instanceof Error ? error.message : 'Ha fallado el motor')
  }
}
