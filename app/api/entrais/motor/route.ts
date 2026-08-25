import { NextResponse, type NextRequest } from 'next/server'
import { fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { EntraisError, faltaConfigurar } from '@/lib/entrais/api'
import { calcularTodo, leerConfig } from '@/lib/entrais/motor'

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
] as const

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      accion?: string
      config?: Record<string, unknown>
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

    const { data: propios } = await service
      .from('entrais_margenes_sku')
      .select('sku, margen, motivo')
      .order('sku')

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
      propios: propios ?? [],
      conexiones: conexiones ?? [],
      faltaCredencial: faltaConfigurar(config.entorno),
    })
  } catch (error) {
    if (error instanceof EntraisError) return fail(400, error.message)
    console.error('Error en el motor de precios de Entrais:', error)
    return fail(500, error instanceof Error ? error.message : 'Ha fallado el motor')
  }
}
