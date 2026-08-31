import { NextResponse, type NextRequest } from 'next/server'
import { syncAllConnections } from '@/lib/amazon/data'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { isAmazonConfigured } from '@/lib/amazon/lwa'
import { ejecutarCicloStock } from '@/lib/stock-sync/ciclo'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { publicarSiToca } from '@/lib/entrais/automatico'

/**
 * EL REFRESCO DE CADA QUINCE MINUTOS, Y EL CICLO DE STOCK DETRÁS.
 *
 * Lo llama el cron del propio contenedor (scripts/amazon-sync.sh, línea del
 * crontab en el Dockerfile), no el navegador. Es lo que hace que el catálogo
 * esté al día cuando alguien abre la pantalla, en vez de empezar a estarlo
 * entonces — y lo que hace que un cambio enviado pase de «enviado» a
 * «confirmado» sin que nadie tenga que volver a mirar.
 *
 * Quince minutos sobran de largo. Con unos 400 SKU por cliente, un catálogo
 * entero son unas 20 llamadas paginadas a cinco por segundo: cuatro segundos
 * por cliente y marketplace.
 *
 *
 * POR QUÉ EL CICLO DE STOCK VA AQUÍ Y NO EN SU PROPIA LÍNEA DEL CRON
 * =================================================================
 * Por el ORDEN, que en este caso es el fondo del asunto y no una comodidad. El
 * ciclo de stock decide qué mandar CONTRASTANDO contra el espejo del catálogo:
 * cuántos SKU cambian de verdad, cuántos se irían a cero, cuántos ya están
 * igual. Si corriera por su cuenta, compararía contra la foto de hace un cuarto
 * de hora y propondría otra vez cambios que ya se mandaron —y los volvería a
 * mandar—. Detrás del refresco, compara contra lo que Amazon acaba de decir que
 * tiene.
 *
 * Encadenarlos es seguro en los dos sentidos: syncAllConnections() no lanza
 * nunca, así que el paso nuevo no se puede quedar sin ejecutar por un fallo del
 * anterior; y el ciclo va dentro de su propio try, así que un fallo suyo no
 * puede convertir en un 500 un refresco que sí funcionó.
 *
 *
 * POR QUÉ EL SECRETO SE COMPRUEBA AL REVÉS QUE EN EL RESTO DEL ERP
 * ================================================================
 * La ruta gemela de la agenda hace esto:
 *
 *     if (secret && request.headers.get('x-cron-secret') !== secret) → 401
 *
 * o sea: si CRON_SECRET no está puesta, NO COMPRUEBA NADA. Y como en
 * middleware.ts todo lo que empieza por /api/ es ruta pública, eso deja la ruta
 * abierta a internet. En la agenda el daño de que alguien la dispare es una
 * sincronización de más. Aquí no: esta ruta lee catálogos ajenos, gasta el cupo
 * de Amazon de todos los clientes y toca sus conexiones.
 *
 * Así que aquí la ausencia del secreto CIERRA la puerta en vez de abrirla. Si
 * falta la variable, esto no funciona y hay que ponerla — que es exactamente lo
 * que se quiere que pase, porque un fallo ruidoso el día del despliegue es
 * infinitamente más barato que una ruta abierta que nadie sabe que existe.
 */
export const dynamic = 'force-dynamic'

/**
 * El refresco del catálogo son segundos, pero el ciclo de stock lee ficheros de
 * 20.000 líneas y puede acabar mandando cientos de cambios a cinco por segundo.
 * Su propio presupuesto interno lo corta en nueve minutos —antes de que entre la
 * pasada siguiente—, y este número está por encima para no cortarlo por fuera y
 * dejar un envío a medias sin saber por dónde iba.
 */
export const maxDuration = 600

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  /**
   * ¿TOCA?
   *
   * El crontab del contenedor llama a esta ruta CADA MINUTO; el intervalo de
   * verdad está en cron_config y lo decide tocaAhora(). Así se cambia desde la
   * pantalla de Sistema en vez de editando el Dockerfile y esperando un
   * despliegue.
   *
   * Va lo primero, antes incluso de mirar si Amazon está configurado: si no
   * toca, no hay que hacer NADA, y desde luego no leer variables de entorno
   * sesenta veces por hora para acabar contestando lo mismo.
   *
   * `?forzar=1` se lo pone el botón «Lanzar ahora».
   */
  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('amazon-sync')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  // Sin credenciales o sin clave de cifrado no hay nada que refrescar, y desde
  // luego no hay que dejar un error cada cuarto de hora en el registro.
  if (!isAmazonConfigured() || !hasTokenKey()) {
    return NextResponse.json({ ok: true, skipped: 'Amazon no configurado' })
  }

  try {
    // Envuelto para que quede una fila en cron_ejecuciones con cuánto tardó y
    // cómo acabó. Ver lib/sistema/cron.ts: sin esto, un cron muerto no se
    // distingue de uno que corre y no encuentra nada que hacer.
    const salida = await conRegistro('amazon-sync', lanzadoPorDe(request.headers), async () => {
    const stats = await syncAllConnections()

    // Los fallos se registran uno a uno: son el rastro de que la conexión de un
    // cliente lleva días sin refrescarse, y sin esto solo se vería un contador.
    // El mensaje ya viene traducido y sin credenciales dentro (lib/amazon/errors.ts).
    for (const f of stats.failures) {
      console.error(
        `[amazon] refresco fallido en la conexión ${f.connectionId} (${f.marketplaceId}): ${f.error}`
      )
    }

    const stock = await cicloDeStock()

    return { ok: true, ...stats, stock }
    })

    return NextResponse.json(salida)
  } catch (error) {
    console.error('Error en el refresco periódico de Amazon:', error)
    return NextResponse.json(
      { ok: false, error: 'El refresco periódico ha fallado' },
      { status: 500 }
    )
  }
}

/**
 * El ciclo de stock, con su propia red debajo.
 *
 * El try no es de adorno: si esto lanzara, el refresco del catálogo —que ya ha
 * terminado bien— saldría como un 500 y el cron lo daría por fallido. Son dos
 * trabajos distintos que comparten disparador, y el segundo no puede desacreditar
 * al primero.
 *
 * Lo que sale por consola es una línea por pasada con lo que ha pasado, más una
 * por cada perfil que no haya ido bien. Es el rastro que se mira cuando alguien
 * pregunta por qué un cliente lleva tres días con el stock viejo, antes incluso
 * de abrir la pantalla.
 */
async function cicloDeStock(): Promise<Record<string, unknown>> {
  try {
    const ciclo = await ejecutarCicloStock()

    if (ciclo.omitido) {
      console.log(`[stock-sync] ciclo omitido: ${ciclo.omitido}`)
      return { omitido: ciclo.omitido }
    }

    console.log(
      `[stock-sync] ${ciclo.mirados} perfiles mirados · ${ciclo.procesados} procesados · ` +
        `${ciclo.enviados} enviados · ${ciclo.frenados} frenados · ${ciclo.errores} con error · ` +
        `${Math.round(ciclo.duracionMs / 1000)}s`
    )

    for (const p of ciclo.perfiles) {
      if (p.desenlace === 'error' || p.desenlace === 'frenado') {
        console.error(`[stock-sync] «${p.perfil}» ${p.desenlace}: ${p.detalle}`)
      }
    }

    /**
     * ---------- Y LOS PRECIOS, EN LA MISMA PASADA ----------
     *
     * AQUÍ Y NO EN amazon-jobs, que es donde estaban y por eso no salían nunca.
     * Aquella ruta tiene su propia cadencia en `cron_config` y dos returns
     * tempranos antes de llegar a los precios: con las ingestas apagadas —que es
     * como está hoy— la publicación no se ejecutaba ni una sola vez, y desde
     * fuera se veía como «el interruptor está encendido y no manda nada».
     *
     * Aquí es su sitio por dos razones, y la segunda es la que importa:
     *
     *   · El ritmo es el del stock, que es justo lo que se pidió.
     *   · Es LA MISMA LLAMADA. El catálogo del proveedor que acaba de traer el
     *     ciclo sigue en memoria, así que los precios se calculan con él sin
     *     gastar otra de las cuatro llamadas por hora que deja Entrais. Puesto
     *     en otra ruta eso dependía de que la caché siguiera viva entre dos
     *     peticiones distintas, que es como se agotó la cuota esta mañana.
     *
     * En su try: publicar precios es lo más delicado que hace esto y no puede
     * llevarse por delante un ciclo de stock que ya ha terminado bien.
     */
    let precios: Awaited<ReturnType<typeof publicarSiToca>> | null = null
    try {
      precios = await publicarSiToca()
      console.log(`[entrais] precios: ${precios.motivo}`)
    } catch (error) {
      console.error('[entrais] la publicación automática de precios ha fallado:', error)
    }

    // El detalle por perfil NO viaja en la respuesta: la lee un `curl -o
    // /dev/null` del cron y en el historial de la pantalla está entero.
    return {
      precios: precios?.motivo ?? null,
      mirados: ciclo.mirados,
      procesados: ciclo.procesados,
      saltados: ciclo.saltados,
      enviados: ciclo.enviados,
      frenados: ciclo.frenados,
      errores: ciclo.errores,
      duracionMs: ciclo.duracionMs,
    }
  } catch (error) {
    console.error('[stock-sync] el ciclo automático ha fallado entero:', error)
    return { error: 'El ciclo de stock ha fallado' }
  }
}
