import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { connectionCredentials } from '@/lib/amazon/data'
import { desdeCuandoLeer, leerLedger } from '@/lib/fba/ledger'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * TRAER LOS MOVIMIENTOS DE UNA CUENTA Y GUARDARLOS.
 *
 * Lee el libro mayor desde donde se quedó —con solape hacia atrás, ver
 * lib/fba/ledger.ts— y deja escrita la ventana entera.
 *
 *
 * ============ EL ORDEN IMPORTA, Y NO ES EL OBVIO ============
 *
 * Primero se BORRA la ventana y después se INSERTA. Al revés —insertar y luego
 * limpiar lo viejo— habría un instante con los movimientos duplicados, y si la
 * pasada se corta justo ahí el duplicado se queda: el reparto contaría cada
 * venta dos veces y las remesas se agotarían a la mitad de lo debido.
 *
 * Borrar primero deja, en el peor caso, un hueco temporal. Un hueco se nota y se
 * arregla solo en la pasada siguiente; un duplicado se queda callado.
 *
 * Se apunta `leido_hasta` SOLO si todo ha ido bien. Si falla a mitad, la próxima
 * pasada vuelve a por el mismo tramo.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 600

export async function POST(request: NextRequest) {
  const conexionId = request.nextUrl.searchParams.get('conexion') ?? ''
  const service = createServiceClient()
  let marketplaceId = ''

  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session
    if (!UUID.test(conexionId)) return fail(400, 'Hay que decir de qué conexión')

    const resuelta = await connectionCredentials(conexionId)
    if (!resuelta) return fail(404, 'Esa conexión no existe')

    const { connection, credentials } = resuelta
    marketplaceId =
      connection.default_marketplace_id ??
      connection.marketplaces_activos?.[0] ??
      connection.marketplace_ids?.[0] ??
      ''
    if (!marketplaceId) return fail(400, `${connection.name} no tiene ningún mercado asignado`)

    const { data: lecturaPrevia } = await service
      .from('fba_lecturas')
      .select('leido_hasta')
      .eq('connection_id', conexionId)
      .eq('marketplace_id', marketplaceId)
      .maybeSingle()

    const leidoHasta = (lecturaPrevia as { leido_hasta: string | null } | null)?.leido_hasta ?? null
    const hoy = new Date()
    const desde = desdeCuandoLeer(leidoHasta, hoy)
    // Hasta hace una hora: el libro mayor del día en curso todavía se está
    // escribiendo, y pedirlo hasta «ahora» devuelve un tramo a medio cerrar.
    const hasta = new Date(hoy.getTime() - 60 * 60_000)

    await service.from('fba_lecturas').upsert(
      {
        connection_id: conexionId,
        marketplace_id: marketplaceId,
        ultimo_intento_at: new Date().toISOString(),
        ultimo_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'connection_id,marketplace_id' }
    )

    const lectura = await leerLedger(credentials, marketplaceId, desde, hasta)
    if (!lectura) {
      return fail(502, 'Amazon ha aceptado la petición del informe pero no ha devuelto su identificador')
    }

    // 1) Fuera la ventana. Ver la nota de arriba sobre el orden.
    const { error: errorBorrado } = await service
      .from('fba_movimientos')
      .delete()
      .eq('connection_id', conexionId)
      .eq('marketplace_id', marketplaceId)
      .gte('fecha', lectura.desde)
      .lte('fecha', lectura.hasta)
    if (errorBorrado) throw errorBorrado

    // 2) Y dentro lo leído, de 500 en 500: un insert de miles de filas se pasa
    //    del tamaño que aguanta PostgREST y falla sin mencionar el tamaño.
    const filas = lectura.movimientos.map((m) => ({
      connection_id: conexionId,
      marketplace_id: marketplaceId,
      sku: m.sku,
      asin: m.asin,
      fecha: m.fecha,
      ocurrido_at: m.ocurridoAt,
      tipo: m.tipo,
      referencia: m.referencia,
      cantidad: m.cantidad,
      disposicion: m.disposicion,
      motivo: m.motivo,
      centro: m.centro,
      pais: m.pais,
    }))

    for (let i = 0; i < filas.length; i += 500) {
      const { error } = await service.from('fba_movimientos').insert(filas.slice(i, i + 500))
      if (error) throw error
    }

    // 3) Las entradas reconocen su remesa: el «Reference ID» de un Receipt es el
    //    identificador del envío. Solo se rellena lo que esté vacío, para no
    //    pisar lo que alguien haya escrito a mano.
    const llegadas = new Map<string, string>()
    for (const m of lectura.movimientos) {
      if (m.tipo !== 'Receipts' || !m.referencia) continue
      const previa = llegadas.get(m.referencia)
      if (!previa || m.fecha < previa) llegadas.set(m.referencia, m.fecha)
    }
    let reconocidas = 0
    for (const [referencia, fecha] of llegadas) {
      const { data } = await service
        .from('fba_remesas')
        .update({ llegada_at: `${fecha}T00:00:00Z`, updated_at: new Date().toISOString() })
        .eq('connection_id', conexionId)
        .eq('referencia_envio', referencia)
        .is('llegada_at', null)
        .select('id')
      reconocidas += (data ?? []).length
    }

    await service.from('fba_lecturas').upsert(
      {
        connection_id: conexionId,
        marketplace_id: marketplaceId,
        leido_hasta: lectura.hasta,
        ultimo_informe: lectura.reportId,
        ultimo_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'connection_id,marketplace_id' }
    )

    return NextResponse.json({
      conexion: connection.name,
      informe: lectura.reportId,
      desde: lectura.desde,
      hasta: lectura.hasta,
      movimientos: filas.length,
      descartadas: lectura.descartadas,
      remesasReconocidas: reconocidas,
    })
  } catch (error) {
    // El error se guarda para que la pantalla lo pueda decir sin que nadie tenga
    // que mirar los registros del contenedor.
    if (UUID.test(conexionId) && marketplaceId) {
      await service
        .from('fba_lecturas')
        .upsert(
          {
            connection_id: conexionId,
            marketplace_id: marketplaceId,
            ultimo_error: error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'connection_id,marketplace_id' }
        )
        .then(() => undefined)
    }
    return errorResponse(error, 'No se ha podido leer el libro mayor')
  }
}
