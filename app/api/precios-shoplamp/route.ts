import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { sendChanges, type ChangeToSend } from '@/lib/amazon/data'
import { construirPlan } from '@/lib/precios-shoplamp/plan'
import { DESTINOS, MAX_POR_TRAMO, paisDe } from '@/lib/precios-shoplamp/reglas'

/**
 * PRECIOS DE SHOPLAMP · APLICAR LA REGLA.
 *
 * Recibe QUÉ filas aplicar —SKU y país— y nada más. El precio NO viaja en la
 * petición: se vuelve a calcular aquí, en el servidor, leyendo otra vez el
 * precio de España.
 *
 *
 * ============ POR QUÉ EL PRECIO NO LLEGA DE FUERA ============
 *
 * Porque esta ruta publica en la tienda de un cliente real. Si el precio
 * llegara en el cuerpo, cualquiera con la sesión abierta —o una pestaña con el
 * plan de hace dos horas— decidiría a cuánto se pone cada referencia, y
 * `sendChanges` lo mandaría: sus comprobaciones solo miran que sea un número
 * positivo, así que 1,00 € sobre 400 referencias pasaría limpio.
 *
 * Aquí el servidor es la única fuente del precio. Lo que sí viaja es
 * `esperado`: lo que la pantalla CREÍA que iba a publicar. Si no coincide con
 * lo recalculado, esa fila no se manda y se devuelve como `desfasada`. Es un
 * seguro contra el caso aburrido y real: alguien cambia el precio de España
 * mientras la pantalla está abierta, y lo que se publicaría no es lo que se
 * vio.
 *
 *
 * ============ SIMULAR PRIMERO ============
 *
 * `simular: true` manda `validateOnly` a Amazon: contesta si lo aceptaría sin
 * tocar nada y sin dejar registro. La pantalla no habilita el envío de verdad
 * hasta que la simulación de ESA MISMA selección ha pasado.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * La pantalla parte la selección en tramos de `MAX_POR_TRAMO` y los manda en
 * serie con el mismo `batchId`, que es lo que mantiene el lote reconocible en el
 * registro. El número vive en reglas.ts porque lo usan los dos lados.
 */

interface FilaPedida {
  sku?: unknown
  marketplaceId?: unknown
  /** Lo que la pantalla creía que iba a publicar. Ver el comentario de arriba */
  esperado?: unknown
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      filas?: FilaPedida[]
      simular?: boolean
      batchId?: string | null
    }

    const pedidas = Array.isArray(body.filas) ? body.filas : []
    if (pedidas.length === 0) return fail(400, 'No has marcado ninguna referencia.')
    if (pedidas.length > MAX_POR_TRAMO) {
      return fail(
        400,
        `De una vez se mandan como mucho ${MAX_POR_TRAMO} referencias. Con más, la petición se ` +
          'queda sin tiempo a la mitad y no habría forma de saber cuáles llegaron.'
      )
    }

    const simular = body.simular === true

    // El plan se reconstruye ENTERO, aquí. Es la misma función que pinta la
    // pantalla, así que no hay dos formas de calcular el precio: hay una.
    const plan = await construirPlan()
    if (!plan.connectionId) {
      return fail(400, 'Shoplamp no tiene ninguna cuenta de Amazon conectada y activa.')
    }

    const porClave = new Map(plan.filas.map((f) => [`${f.marketplaceId}|${f.sku}`, f]))
    const permitidos = new Set(DESTINOS.map((d) => d.marketplaceId))

    const cambios: ChangeToSend[] = []
    const rechazadas: { sku: string; marketplaceId: string; pais: string; motivo: string }[] = []

    for (const p of pedidas) {
      const sku = typeof p.sku === 'string' ? p.sku : ''
      const marketplaceId = typeof p.marketplaceId === 'string' ? p.marketplaceId : ''
      if (!sku || !marketplaceId) continue

      // El cortafuegos, por tercera vez y en la puerta: lo que no sea uno de los
      // tres destinos no se manda aunque alguien lo pida a mano.
      if (!permitidos.has(marketplaceId)) {
        rechazadas.push({
          sku,
          marketplaceId,
          pais: paisDe(marketplaceId),
          motivo: 'Ese país no entra en esta regla.',
        })
        continue
      }

      const fila = porClave.get(`${marketplaceId}|${sku}`)
      if (!fila) {
        rechazadas.push({
          sku,
          marketplaceId,
          pais: paisDe(marketplaceId),
          motivo: 'Ya no está en el catálogo de ese país. Vuelve a cargar la pantalla.',
        })
        continue
      }
      if (fila.destino === null) {
        rechazadas.push({
          sku,
          marketplaceId,
          pais: fila.pais,
          motivo: 'No tiene precio base en España.',
        })
        continue
      }
      if (!fila.productType) {
        rechazadas.push({
          sku,
          marketplaceId,
          pais: fila.pais,
          motivo: 'No tenemos su tipo de producto, y Amazon lo exige en cada cambio.',
        })
        continue
      }

      // En céntimos, que es como se compara dinero. Ver reglas.ts.
      const esperado = typeof p.esperado === 'number' ? p.esperado : null
      if (esperado !== null && Math.round(esperado * 100) !== Math.round(fila.destino * 100)) {
        rechazadas.push({
          sku,
          marketplaceId,
          pais: fila.pais,
          motivo:
            `En la pantalla ponía ${esperado.toFixed(2)} € y ahora saldría ` +
            `${fila.destino.toFixed(2)} €: el precio de España ha cambiado por el camino. ` +
            'Vuelve a cargar la pantalla.',
        })
        continue
      }

      cambios.push({ sku, marketplaceId, field: 'precio', newValue: fila.destino })
    }

    if (cambios.length === 0) {
      return NextResponse.json({
        ok: true,
        simulado: simular,
        batchId: body.batchId ?? null,
        aceptados: 0,
        fallidos: 0,
        resultados: [],
        rechazadas,
      })
    }

    const res = await sendChanges({
      connectionId: plan.connectionId,
      changes: cambios,
      source: 'manual',
      userId: session.userId,
      batchId: body.batchId ?? null,
      validateOnly: simular,
    })

    return NextResponse.json({
      ok: true,
      simulado: simular,
      batchId: res.batchId,
      aceptados: res.accepted,
      fallidos: res.failed,
      // SE TRADUCE AQUÍ, y no se devuelve `res.results` tal cual.
      //
      // `SentChange` habla en inglés (`status`, `message`) y el resto de este
      // módulo en castellano. Devolverlo crudo y declararlo en la pantalla con
      // los nombres de aquí compila igual —son dos objetos distintos que
      // TypeScript nunca ve juntos—, pero en tiempo de ejecución `estado` y
      // `mensaje` son `undefined`: el recuento de aceptados sale 0 SIEMPRE y
      // todas las filas se listan como fallidas sin ningún motivo escrito.
      // Pasó, y solo se vio ejecutándolo.
      resultados: res.results.map((r) => ({
        sku: r.sku,
        marketplaceId: r.marketplaceId,
        estado: r.status,
        mensaje: r.message,
        anterior: r.previousValue,
        nuevo: r.newValue,
      })),
      retirados: res.retirados ?? [],
      abortReason: res.abortReason,
      rechazadas,
    })
  } catch (error) {
    return errorResponse(error, 'Error aplicando los precios de Shoplamp')
  }
}
