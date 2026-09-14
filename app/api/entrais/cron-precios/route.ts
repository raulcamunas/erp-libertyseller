import { NextResponse, type NextRequest } from 'next/server'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { isAmazonConfigured } from '@/lib/amazon/lwa'
import { conRegistro, lanzadoPorDe } from '@/lib/sistema/cron'
import { publicarSiToca, PRESUPUESTO_TOTAL_MS } from '@/lib/entrais/automatico'

/**
 * LOS PRECIOS, EN SU PROPIA PASADA
 * ================================
 * SOLO SERVIDOR. Lo llama el cron del contenedor cada minuto
 * (scripts/entrais-precios.sh).
 *
 *
 * ============ POR QUÉ SE SALE DE cron-sync ============
 *
 * Estaba metido detrás del ciclo de stock, en la MISMA petición, y eso es lo
 * que hacía que no se publicaran todos los precios. Las dos cosas se repartían
 * una sola ventana de 600 segundos:
 *
 *     pasada de stock       ~145 s
 *     precios, lo que sobra ~115 s  ->  unos 570 precios a 5 por segundo
 *
 * Medido en las ejecuciones reales del 14 de septiembre: las pasadas alternan
 * 145 s (solo stock) y 300-480 s (stock y precios), y la última dejó dicho
 * «598 precios aceptados. Quedan 893 para las siguientes pasadas».
 *
 * Y esos 893 no se retomaban enseguida: cron-sync está en `cron_config` a
 * QUINCE MINUTOS, así que cada resto esperaba un cuarto de hora. Con 966
 * candidatos eso son dos pasadas y media hora para poner al día unos precios
 * que caben de sobra en una.
 *
 * Aquí los precios tienen los 600 segundos enteros: unos 2.900 a 5 por segundo,
 * tres veces lo que hay que mandar un día normal.
 *
 *
 * ============ POR QUÉ ESTA RUTA NO TIENE RELOJ PROPIO ============
 *
 * Corre cada minuto y NO mira `cron_config`. El reloj de verdad está dentro,
 * en `publicar_cada_minutos` de la configuración del motor —que es donde se
 * ajusta desde la pantalla— y eso tiene una consecuencia buscada: cuando una
 * pasada deja precios pendientes, `publicado_at` no se sella y la del minuto
 * siguiente los retoma. El intervalo decide cuándo EMPIEZA un ciclo nuevo; lo
 * que quedó a medias no espera a nadie.
 *
 * Sin cuota del proveedor de por medio: los precios se calculan con el catálogo
 * que la pasada de stock dejó en memoria hace menos de veinte minutos. Ver
 * `soloCache` en lib/entrais/api.ts.
 */
export const dynamic = 'force-dynamic'

/**
 * Diez minutos, lo mismo que cron-sync. El presupuesto de envío
 * (PRESUPUESTO_TOTAL_MS) va por debajo para cerrar y contestar dentro.
 */
export const maxDuration = 600

export async function POST(request: NextRequest) {
  /**
   * El secreto CIERRA si falta, no abre. Igual que en cron-sync y por el mismo
   * motivo: desde aquí se cambian los precios de la tienda de un cliente.
   */
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isAmazonConfigured() || !hasTokenKey()) {
    return NextResponse.json({ ok: true, saltado: 'Amazon no configurado' })
  }

  const forzar = request.nextUrl.searchParams.get('forzar') === '1'

  try {
    const salida = await conRegistro(
      'entrais-precios',
      lanzadoPorDe(request.headers),
      async () => {
        const resultado = await publicarSiToca({
          forzar,
          presupuestoMs: PRESUPUESTO_TOTAL_MS,
        })
        // Una línea por pasada en el registro del contenedor: es lo que se mira
        // cuando alguien pregunta por qué un precio sigue viejo.
        if (resultado.hecho) console.log(`[entrais] precios: ${resultado.motivo}`)
        return resultado as unknown as Record<string, unknown>
      }
    )

    return NextResponse.json(salida)
  } catch (error) {
    console.error('[entrais] la publicación de precios ha fallado:', error)
    return NextResponse.json({ ok: false, error: 'La publicación de precios ha fallado' }, { status: 500 })
  }
}
