import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { connectionCredentials } from '@/lib/amazon/data'
import { desdeCuandoLeer, leerLedger } from '@/lib/fba/ledger'
import { claveDeCuenta, haceCuanto, pedirTurnoDeLectura } from '@/lib/fba/lectura-en-curso'
import { mercadosQueVendeLaCuenta, participaEn } from '@/lib/fba/mercados'
import { esperarPlanificacion, leerYGuardarPlanificacion } from '@/lib/fba/planificacion-amazon'
import { desdeParaLeerAhora } from '@/lib/fba/ventana-lectura'
import { createServiceClient } from '@/lib/supabase/service'
import { marketplaceLabel } from '@/lib/types/amazon'

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
 *
 *
 * ============ DE QUÉ CUENTA Y DE QUÉ MERCADO ============
 *
 *   ?remesa=<id>      la cuenta y el mercado de ESE envío. Es lo que usa el botón «Leer ventas»
 *                     de un envío, y la única forma que sirve para una cuenta que no vende en el
 *                     mercado por defecto de su conexión (Portico LLC: por defecto México, y sus
 *                     envíos y productos están en Estados Unidos). Además estira la ventana hacia
 *                     atrás hasta cubrir el envío si el libro todavía no ha confirmado su llegada:
 *                     traer de Amazon un envío antiguo a una cuenta que ya se leía cada noche
 *                     dejaba sus ventas fuera para siempre, porque la pasada solo relee 14 días.
 *   ?conexion=<id>    la cuenta entera (el botón del panel del cliente). El mercado es el de sus
 *                     remesas si el por defecto de la conexión no tiene ninguna; si no, el de siempre.
 *   &mercado=<id>     fuerza el mercado en cualquiera de las dos.
 *
 * Un mercado en el que la cuenta no vende NO se pide a Amazon: se dice cuál es el problema.
 *
 * UNA LECTURA A LA VEZ por cuenta y mercado (lib/fba/lectura-en-curso.ts): dos lecturas cruzadas
 * duplican cada movimiento sin dar ningún error. La segunda no espera: se rechaza.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 600

export async function POST(request: NextRequest) {
  const parametros = request.nextUrl.searchParams
  let conexionId = parametros.get('conexion') ?? ''
  const remesaId = parametros.get('remesa') ?? ''
  let mercadoPedido = parametros.get('mercado') ?? ''
  const service = createServiceClient()
  let marketplaceId = ''
  let soltarTurno: (() => void) | null = null

  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    // Con ?remesa= la cuenta y el mercado son los del envío
    let remesa: { id: string; nombre: string | null; fecha_envio: string; llegada_at: string | null } | null = null
    if (remesaId) {
      if (!UUID.test(remesaId)) return fail(400, 'Hay que decir de qué envío')
      const { data } = await service
        .from('fba_remesas')
        .select('id, nombre, connection_id, marketplace_id, fecha_envio, llegada_at')
        .eq('id', remesaId)
        .maybeSingle()
      const fila = data as { id: string; nombre: string | null; connection_id: string | null; marketplace_id: string; fecha_envio: string; llegada_at: string | null } | null
      if (!fila) return fail(404, 'Ese envío no existe')
      if (!fila.connection_id) return fail(409, 'Este envío no tiene una cuenta de Amazon conectada, así que no hay libro mayor que leer.')
      conexionId = fila.connection_id
      mercadoPedido = fila.marketplace_id
      remesa = { id: fila.id, nombre: fila.nombre, fecha_envio: fila.fecha_envio, llegada_at: fila.llegada_at }
    }
    if (!UUID.test(conexionId)) return fail(400, 'Hay que decir de qué conexión')

    const resuelta = await connectionCredentials(conexionId)
    if (!resuelta) return fail(404, 'Esa conexión no existe')

    const { connection, credentials } = resuelta
    const porDefecto =
      connection.default_marketplace_id ??
      connection.marketplaces_activos?.[0] ??
      connection.marketplace_ids?.[0] ??
      ''

    if (mercadoPedido) {
      marketplaceId = mercadoPedido
    } else {
      // Sin mercado pedido: el por defecto de la conexión, salvo que no tenga ni una remesa y la cuenta sí las
      // tenga en otro (así se leen las ventas de un cliente cuyo mercado por defecto no es donde envía)
      marketplaceId = porDefecto
      const { data: deRemesas } = await service.from('fba_remesas').select('marketplace_id').eq('connection_id', conexionId)
      const cuenta = new Map<string, number>()
      for (const r of (deRemesas ?? []) as Array<{ marketplace_id: string }>) cuenta.set(r.marketplace_id, (cuenta.get(r.marketplace_id) ?? 0) + 1)
      if (cuenta.size > 0 && !cuenta.has(porDefecto)) {
        marketplaceId = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0][0]
      }
    }
    if (!marketplaceId) return fail(400, `${connection.name} no tiene ningún mercado asignado`)

    // Si la cuenta no está dada de alta en ese mercado, Amazon no contesta con un error que se entienda:
    // devuelve un informe vacío o rechaza la petición, y las ventas se quedan en cero sin explicación
    if (!participaEn(connection, marketplaceId)) {
      const dondeVende = mercadosQueVendeLaCuenta(connection).join(', ') || 'ningún mercado conocido'
      return fail(
        409,
        remesa
          ? `Este envío está apuntado en Amazon ${marketplaceLabel(marketplaceId)}, pero la cuenta «${connection.name}» no vende ahí (vende en: ${dondeVende}). Hay que corregir el país del envío antes de leer sus ventas.`
          : `La cuenta «${connection.name}» no vende en Amazon ${marketplaceLabel(marketplaceId)} (vende en: ${dondeVende}).`
      )
    }

    // Una lectura a la vez por cuenta y mercado. Se pide ANTES de tocar nada
    const turno = pedirTurnoDeLectura(claveDeCuenta(conexionId, marketplaceId))
    if (!turno.ok) {
      return fail(
        409,
        `Ya se está leyendo el libro mayor de ${connection.name} en Amazon ${marketplaceLabel(marketplaceId)} (empezó ${haceCuanto(turno.desdeHaceMs)}). Espera a que termine y vuelve a mirar.`
      )
    }
    soltarTurno = turno.soltar

    const { data: lecturaPrevia } = await service
      .from('fba_lecturas')
      .select('leido_hasta')
      .eq('connection_id', conexionId)
      .eq('marketplace_id', marketplaceId)
      .maybeSingle()

    const leidoHasta = (lecturaPrevia as { leido_hasta: string | null } | null)?.leido_hasta ?? null

    // La remesa más antigua de esta cuenta. Solo importa la primera vez, y es lo
    // que hace que una migración de histórico signifique algo: sin esto la
    // primera lectura empieza 90 días atrás y las remesas anteriores salen
    // intactas, como si no se hubiera vendido nada de ellas.
    const { data: primera } = await service
      .from('fba_remesas')
      .select('fecha_envio')
      .eq('connection_id', conexionId)
      .eq('marketplace_id', marketplaceId)
      .order('fecha_envio', { ascending: true })
      .limit(1)
      .maybeSingle()
    const remesaMasAntigua = (primera as { fecha_envio: string } | null)?.fecha_envio ?? null

    const hoy = new Date()
    // Para un envío concreto la ventana se estira hasta cubrirlo si el libro aún no ha confirmado su llegada;
    // sin envío (el botón del panel) es la de siempre
    const desde = remesa
      ? desdeParaLeerAhora(leidoHasta, hoy, remesaMasAntigua, remesa.llegada_at ? [] : [remesa.fecha_envio])
      : desdeCuandoLeer(leidoHasta, hoy, remesaMasAntigua)
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

    // La antigüedad del stock que cuenta Amazon se lee A LA VEZ que las ventas: los dos informes tardan
    // minutos y cuesta lo que el más lento. Esa lectura no lanza nunca: que falle no impide ver las ventas
    // y queda dicho en la respuesta y en `fba_lecturas`.
    const planificacionPendiente = leerYGuardarPlanificacion(service, credentials, { conexion: conexionId, mercado: marketplaceId })

    let lectura: Awaited<ReturnType<typeof leerLedger>> = null
    try {
      lectura = await leerLedger(credentials, marketplaceId, desde, hasta)
    } catch (e) {
      // Se espera un poco a la otra lectura para no dejarla suelta: el catch de abajo guarda este error
      await esperarPlanificacion(planificacionPendiente)
      throw e
    }
    if (!lectura) {
      await esperarPlanificacion(planificacionPendiente)
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

    // Con un plazo: si Amazon tarda más en este informe, la respuesta no espera y lo que tarde se guarda solo
    const planificacion = await esperarPlanificacion(planificacionPendiente)

    return NextResponse.json({
      conexion: connection.name,
      mercado: { id: marketplaceId, nombre: marketplaceLabel(marketplaceId) },
      informe: lectura.reportId,
      desde: lectura.desde,
      hasta: lectura.hasta,
      movimientos: filas.length,
      descartadas: lectura.descartadas,
      remesasReconocidas: reconocidas,
      // La antigüedad del stock según Amazon: cuántas referencias se han guardado, y por qué no si no
      planificacion: { guardadas: planificacion.guardadas, guardado: planificacion.guardado, aviso: planificacion.aviso, error: planificacion.error },
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
  } finally {
    // Pase lo que pase: sin esto una lectura que falla dejaría la cuenta bloqueada hasta que caduque el candado
    soltarTurno?.()
  }
}
