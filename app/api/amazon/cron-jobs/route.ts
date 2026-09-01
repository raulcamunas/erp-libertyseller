import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { NextResponse, type NextRequest } from 'next/server'
import { ejecutarJobs } from '@/lib/plataforma/motor'
import { planificarRefrescos } from '@/lib/plataforma/planificador'
import { registrarTareas } from '@/lib/plataforma/tareas'
import { empujar } from '@/lib/ads/generador'
import { limpiar } from '@/lib/plataforma/limpieza'
import { lanzarProgramadas } from '@/lib/ads/programador'

/**
 * EL DISPARADOR DEL MOTOR DE TRABAJOS.
 *
 * Lo llama el cron del propio contenedor (scripts/amazon-jobs.sh, línea del
 * crontab en el Dockerfile), no el navegador.
 *
 *
 * POR QUÉ TIENE LÍNEA PROPIA EN EL CRON Y NO VA DETRÁS DE cron-sync
 * ================================================================
 * Al revés que el ciclo de stock, que sí va encadenado al refresco del catálogo
 * porque necesita contrastar contra un espejo recién actualizado. Aquí no hay
 * esa dependencia y sí hay una razón para separarlos:
 *
 *   · cron-sync tiene un presupuesto de nueve minutos y entra cada quince. Meter
 *     debajo un motor que puede estar horas trabajando dejaría a los dos
 *     compitiendo por el mismo hueco, y el refresco del catálogo —que es lo que
 *     hace que la pantalla esté al día— empezaría a llegar tarde por culpa de un
 *     barrido nocturno.
 *   · un trabajo largo no necesita un ciclo de quince minutos: necesita muchos
 *     ciclos cortos y seguidos. Cinco minutos con cuatro de presupuesto es el
 *     reparto que hace que un barrido de 13.700 SKU avance sin bloquear nada.
 *
 * Los dos son seguros por separado porque el motor NO LANZA NUNCA hacia arriba:
 * un trabajo que revienta se registra como evento y no puede convertir en un 500
 * la pasada de los demás.
 *
 *
 * POR QUÉ EL SECRETO SE COMPRUEBA AL REVÉS QUE EN LA AGENDA
 * ========================================================
 * La ruta gemela de la agenda hace `if (secret && …)`, o sea: si CRON_SECRET no
 * está puesta, NO COMPRUEBA NADA. Y como en middleware.ts todo lo que empieza
 * por /api/ es ruta pública, eso deja la ruta abierta a internet.
 *
 * Aquí la ausencia del secreto CIERRA la puerta. Esta ruta lanza trabajos que
 * leen catálogos ajenos y gastan el cupo de Amazon de todos los clientes: un
 * fallo ruidoso el día del despliegue es infinitamente más barato que una ruta
 * abierta que nadie sabe que existe. Es el mismo criterio que
 * app/api/amazon/cron-sync/route.ts, que es el patrón bueno de este repositorio.
 */
export const dynamic = 'force-dynamic'

/**
 * El motor se corta solo a los cuatro minutos (PRESUPUESTO_MS). Este número está
 * por encima para no cortarlo por fuera y dejar un lote a medias sin saber por
 * dónde iba.
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
   * verdad está en la tabla cron_config y lo decide tocaAhora(). Así se cambia
   * desde la pantalla de Sistema en vez de editando el Dockerfile.
   *
   * `?forzar=1` se lo pone el botón «Lanzar ahora», que es el único que tiene
   * que saltarse el reloj.
   */
  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    /**
     * ---------- LA PURGA VA LA PRIMERA, ANTES DE NINGUNA SALIDA ----------
     *
     * Estaba al final, detrás de dos returns tempranos: la cadencia de este
     * trabajo y el «omitido» del motor. Resultado: solo se ejecutaba cuando el
     * motor hacía una pasada completa, que con las ingestas apagadas es casi
     * nunca.
     *
     * Y no se notaba, porque las tablas con quince días de plazo —eventos, cron—
     * sí se limpiaban en las pocas veces que corría. Las de un día no: llegaron
     * a 222.293 filas de snapshots de precio con siete días de antigüedad y la
     * base se volvió a pasar del plan.
     *
     * Ahora corre siempre. Cuesta una consulta por minuto que casi nunca borra
     * nada; la alternativa era quedarse otra vez sin base.
     */
    let purga: Awaited<ReturnType<typeof limpiar>> | null = null
    try {
      purga = await limpiar()
      const total = purga.reduce((a, b) => a + Math.max(0, b.borradas), 0)
      if (total > 0) console.log(`[limpieza] ${total} filas retiradas`)
      for (const r of purga) {
        if (r.error) console.error(`[limpieza] ${r.tabla}: ${r.error}`)
      }
    } catch (error) {
      console.error('[limpieza] la purga ha fallado:', error)
    }

    const veredicto = await tocaAhora('amazon-jobs')
    if (!veredicto.toca) {
      return NextResponse.json({ ok: true, saltado: veredicto.motivo, purga })
    }
  }

  // Idempotente. Ver el comentario de lib/plataforma/tareas/index.ts.
  registrarTareas()

  // ---------- EL REFRESCO A DOS VELOCIDADES ----------
  // Planificar es BARATO —dos consultas por cliente y ni una llamada a Amazon—
  // así que va delante del motor y en la misma pasada: lo que se acaba de meter
  // en la cola se puede empezar a trabajar ya.
  //
  // Va DENTRO de su propio try porque el planificador no puede impedir que se
  // procesen los trabajos que ya estaban en la cola. Un fallo suyo se registra y
  // la pasada sigue; sus decisiones son idempotentes (cadencia + índice único),
  // así que saltarse una pasada no pierde nada: en la siguiente sigue tocando.
  try {
    const plan = await planificarRefrescos()
    if (plan.omitido) {
      console.log(`[plataforma] planificador omitido: ${plan.omitido}`)
    } else if (plan.creados > 0) {
      console.log(
        `[plataforma] planificador: ${plan.creados} trabajos nuevos de ${plan.clientes} clientes ` +
          `(${plan.yaVivos} ya estaban en la cola)`
      )
    }
  } catch (error) {
    console.error('[plataforma] el planificador de refrescos ha fallado:', error)
  }

  try {
    // Ver lib/sistema/cron.ts: deja una fila con cuánto tardó y cómo acabó. El
    // planificador de arriba queda fuera a propósito —tiene su propio try y no
    // debe hacer fallar la pasada—, así que lo que se mide es el motor.
    const resultado = await conRegistro('amazon-jobs', lanzadoPorDe(request.headers), () => ejecutarJobs())

    if (resultado.omitido) {
      console.log(`[plataforma] pasada omitida: ${resultado.omitido}`)
      return NextResponse.json({ ok: true, omitido: resultado.omitido })
    }

    console.log(
      `[plataforma] ${resultado.mirados} trabajos mirados · ${resultado.procesados} procesados · ` +
        `${resultado.terminados} terminados · ${resultado.errores} con error · ` +
        `${Math.round(resultado.duracionMs / 1000)}s`
    )

    // Los que no han ido bien, uno a uno: es el rastro que se mira cuando
    // alguien pregunta por qué un cliente lleva tres días con datos viejos,
    // antes incluso de abrir la pantalla.
    for (const job of resultado.jobs) {
      if (job.desenlace === 'error' || job.desenlace === 'sin_tarea') {
        console.error(`[plataforma] trabajo ${job.jobId} (${job.tipo}): ${job.detalle}`)
      }
    }

    /**
     * ---------- Y de paso, los informes de marketing ----------
     *
     * Van aquí y no en un cron propio porque son la misma clase de problema:
     * algo que tarda minutos, que no cabe en una petición, y que hay que ir
     * empujando hasta que termine. Añadir una línea al crontab del contenedor
     * obliga a reconstruir la imagen; esto sale gratis y corre cada minuto.
     *
     * SU FALLO NO PUEDE TUMBAR EL MOTOR, que es lo que de verdad importa aquí:
     * si Amazon Ads está caído, el ciclo de catálogo y el de stock tienen que
     * seguir. Por eso va en su propio try y solo deja una línea en el registro.
     */
    let marketing: Awaited<ReturnType<typeof empujar>> | null = null
    try {
      marketing = await empujar(6)
    } catch (error) {
      console.error('[marketing] el empujón de los informes ha fallado:', error)
    }

    /**
     * ---------- El calendario de informes de marketing ----------
     *
     * Una vuelta al día basta: lo que se programa es un día, no una hora. Se
     * lanzan también las de días pasados que quedaran pendientes —si el servidor
     * estuvo caído el martes, el miércoles salen igual en vez de perderse.
     */
    let programados: Awaited<ReturnType<typeof lanzarProgramadas>> | null = null
    try {
      programados = await lanzarProgramadas(new Date().toISOString().slice(0, 10))
      if (programados.lanzados > 0 || programados.fallidos > 0) {
        console.log(
          `[marketing] programador: ${programados.lanzados} lanzados, ${programados.fallidos} fallidos`
        )
      }
    } catch (error) {
      console.error('[marketing] el programador de informes ha fallado:', error)
    }

    /**
     * Aquí estaba la publicación de precios de Entrais, y estaba MAL.
     *
     * Esta ruta tiene su propia cadencia en `cron_config` y dos returns
     * tempranos antes de este punto, así que con las ingestas apagadas los
     * precios no se publicaban ni una vez — y desde la pantalla se veía como
     * «el interruptor está encendido y no manda nada», sin nada que lo explicara.
     *
     * Se ha ido a cron-sync, detrás del ciclo de stock: allí el ritmo es el que
     * se pidió y, sobre todo, es la MISMA llamada que acaba de traer el catálogo
     * del proveedor, así que calcular no gasta otra de las cuatro que deja
     * Entrais por hora.
     */
    /**
     * ---------- Y la purga ----------
     *
     * Este ERP escribía sesenta mil filas al día y no borraba ninguna, hasta que
     * la base se pasó del plan al 177 %. Ver lib/plataforma/limpieza.ts para qué
     * se borra y por qué ese plazo y no otro.
     *
     * Va aquí por lo mismo que los informes: el cron ya corre cada minuto y
     * añadir una línea al crontab obliga a reconstruir la imagen. Y en su propio
     * try, porque una purga que falle no puede parar el motor.
     */

    // El detalle por trabajo NO viaja en la respuesta: la lee un
    // `curl -o /dev/null` del cron, y en la tabla de trabajos está entero.
    return NextResponse.json({
      ok: true,
      mirados: resultado.mirados,
      procesados: resultado.procesados,
      terminados: resultado.terminados,
      errores: resultado.errores,
      duracionMs: resultado.duracionMs,
      marketing,
      programados: programados?.lanzados ? programados : null,
      purga: purga?.filter((r) => r.borradas > 0 || r.error) ?? null,
    })
  } catch (error) {
    console.error('[plataforma] la pasada del motor de trabajos ha fallado entera:', error)
    return NextResponse.json(
      { ok: false, error: 'El motor de trabajos ha fallado' },
      { status: 500 }
    )
  }
}
