/**
 * ENTRAIS · RECALCULAR Y PUBLICAR EN CADA PASADA
 * =============================================
 * SOLO SERVIDOR.
 *
 * Lo llama el cron. Cuando ha entrado una pasada de stock desde la última
 * publicación, recalcula LAS 6.931 REFERENCIAS y manda a Amazon las que hayan
 * cambiado de precio. Mismo ritmo que el stock, mismo catálogo entero.
 *
 *
 * ============ AQUÍ HUBO UN RELOJ APARTE, Y ESTABA MAL ============
 *
 * La primera versión les puso reloj propio —una vez al día— con este argumento:
 * recalcular son 6.931 escrituras, a 48 pasadas diarias 332.688, «el patrón que
 * llenó la base al 177 %».
 *
 * El argumento no se sostiene. `entrais_precios` se escribe con UPSERT por SKU:
 * tiene 6.931 filas y sigue teniendo 6.931 se recalcule una vez o cuarenta y
 * ocho. NO CRECE. Lo que llenó la base en agosto fueron las tablas de medición
 * —snapshots de precio, BSR e inventario—, que sí son append-only y por eso hoy
 * se purgan a uno y dos días. Recalcular a menudo solo deja tuplas muertas, que
 * es trabajo del autovacuum, no cuota.
 *
 * Así que el reloj aparte no compraba nada y costaba lo evidente: el precio de
 * un producto podía pasarse hasta un día entero mal puesto.
 *
 *
 * ============ LO QUE SÍ SE FILTRA, Y POR QUÉ NO ES LO MISMO ============
 *
 * Se calculan TODAS las referencias en cada pasada. Se MANDAN las que han
 * cambiado. No es una versión descafeinada de «mándalo todo siempre»: mandar las
 * 6.931 cada media hora son 332.688 PATCH diarios a Amazon para reescribir el
 * mismo número, y Amazon corta el grifo mucho antes de llegar ahí. El precio
 * queda igual de bien puesto mandando solo lo que difiere; lo que cambia es que
 * la cuenta no se queda sin cuota.
 *
 * Aparte se caen, como en el botón manual:
 *
 *   · Los que no están listados en Amazon. Un PATCH contra un listing que no
 *     existe es una llamada para un error.
 *   · Los bloqueados por envío directo.
 *
 * Y uno más que el botón no tiene: los que se pasan del tope de salto. En el
 * botón hay una persona mirando el simulacro antes de pulsar, y aquí no hay
 * nadie. Se quita vaciando el campo en la pantalla.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { sendChanges, type ChangeToSend } from '@/lib/amazon/data'
import { calcularTodo, leerConfig } from './motor'

export interface ResultadoAutomatico {
  /** false = no le tocaba, o está apagado. No es un fallo */
  hecho: boolean
  motivo: string
  calculados?: number
  candidatos?: number
  frenados?: number
  enviados?: number
  fallidos?: number
}

/**
 * APUNTA EL MOTIVO Y LO DEVUELVE.
 *
 * Todo lo que sale de aquí pasa por esta función, y por eso la pantalla puede
 * decir por qué no publicó en vez de callarse. Ver la migración 168.
 *
 * Los saltos de RUTINA no se apuntan —«todavía no le toca», que ocurre cada
 * minuto— porque llenarían la columna de ruido y taparían el motivo que importa.
 * Se apunta lo que es una respuesta: publicado, apagado, sin cuenta, sin perfil,
 * nada que cambiar, o reventó.
 */
async function apuntar(
  configId: string,
  resultado: ResultadoAutomatico
): Promise<ResultadoAutomatico> {
  try {
    await createServiceClient()
      .from('entrais_config')
      .update({
        publicado_motivo: resultado.motivo,
        publicado_intento_at: new Date().toISOString(),
      })
      .eq('id', configId)
  } catch (error) {
    // La 168 se lanza a mano, así que el código puede llegar antes. Que no poder
    // apuntar el motivo tumbe la publicación sería cambiar un problema pequeño
    // por uno grande.
    console.warn('[entrais] no se ha podido apuntar el motivo del intento:', error)
  }
  return resultado
}

export async function publicarSiToca(
  opciones: { forzar?: boolean } = {}
): Promise<ResultadoAutomatico> {
  const config = await leerConfig()

  /**
   * ESTE SÍ SE RESPETA AUNQUE SE FUERCE.
   *
   * Forzar salta el reloj, no el permiso. Publicar precios en la tienda de un
   * cliente se enciende a propósito, y un botón que se lo salta convierte
   * «forzar la pasada de stock» en «publicar precios sin querer».
   */
  if (!config.publicar_automatico) {
    // Este NO se apunta: estando apagado se pasa por aquí cada minuto.
    return { hecho: false, motivo: 'La publicación automática de precios está apagada.' }
  }
  if (!config.connection_id || !config.marketplace_id) {
    return apuntar(config.id, {
      hecho: false,
      motivo: 'El motor no tiene cuenta de Amazon ni país configurados.',
    })
  }

  const service = createServiceClient()

  /**
   * ---------- ¿LE TOCA? ----------
   *
   * `publicado_at` se sella cuando TERMINA, no cuando empieza. Si una pasada se
   * cae a la mitad, la siguiente lo reintenta en vez de esperarse el turno
   * entero: un fallo no puede dejar los precios sin publicar.
   */
  const desde = config.publicado_at ? Date.parse(config.publicado_at) : 0

  if (opciones.forzar) {
    // Ni reloj ni pasada previa: lo ha pedido una persona.
  } else if (config.publicar_cada_minutos > 0) {
    // Freno fijo: alguien ha decidido desacoplarlo del stock a propósito.
    if (Date.now() - desde < config.publicar_cada_minutos * 60_000) {
      return { hecho: false, motivo: 'Todavía no le toca.' }
    }
  } else {
    /**
     * AL RITMO DEL SINCRONISMO, LEYÉNDOLO DE DONDE VIVE.
     *
     * No se copia aquí el número de minutos del stock: se mira si ha ENTRADO una
     * pasada desde la última publicación. Así la cadencia sigue existiendo en un
     * solo sitio, y el día que el stock pase de 30 a 15 minutos los precios le
     * siguen sin que nadie se acuerde de venir a tocar esto.
     */
    const { data: perfiles } = await service
      .from('stock_read_profiles')
      .select('last_run_at')
      .eq('connection_id', config.connection_id)
      .eq('is_active', true)
      .order('last_run_at', { ascending: false })
      .limit(1)

    const ultimaPasada = (perfiles ?? [])[0]?.last_run_at as string | undefined
    if (!ultimaPasada) {
      return apuntar(config.id, {
        hecho: false,
        motivo:
          'Esta cuenta no tiene ningún perfil de sincronismo activo del que seguir el ritmo. ' +
          'Enciéndelo, o pon un freno fijo en minutos.',
      })
    }
    if (Date.parse(ultimaPasada) <= desde) {
      return { hecho: false, motivo: 'No ha entrado ninguna pasada de stock desde la última vez.' }
    }
  }

  // ---------- 1. Recalcular ----------
  // Trae el catálogo del proveedor —de la caché si es reciente, así que no gasta
  // cuota— y lo cruza con lo que Amazon acaba de decir en el ciclo de stock.
  const { resumen } = await calcularTodo({ lanzadoPor: null })

  // ---------- 2. Qué se puede mandar ----------
  const filas = await fetchAll<{
    sku: string
    precio: number | null
    pvp_actual: number | null
    dif_euros: number | null
    dif_porcentaje: number | null
    origen: string | null
  }>((a, b) =>
    service
      .from('entrais_precios')
      .select('sku, precio, pvp_actual, dif_euros, dif_porcentaje, origen')
      .order('sku', { ascending: true })
      .range(a, b)
  )

  const tope = config.publicar_max_salto_pct
  const candidatos: { sku: string; precio: number; salto: number }[] = []
  const frenados: { sku: string; de: number; a: number; pct: number }[] = []

  for (const f of filas) {
    if (f.origen === 'bloqueado') continue
    if (f.precio === null || f.pvp_actual === null) continue
    const dif = f.dif_euros === null ? 0 : Number(f.dif_euros)
    if (Math.abs(dif) < 0.005) continue

    const pct = f.dif_porcentaje === null ? 0 : Math.abs(Number(f.dif_porcentaje))
    if (tope !== null && pct > Number(tope)) {
      frenados.push({
        sku: f.sku,
        de: Number(f.pvp_actual),
        a: Number(f.precio),
        pct: Number(f.dif_porcentaje ?? 0),
      })
      continue
    }
    candidatos.push({ sku: f.sku, precio: Number(f.precio), salto: Math.abs(dif) })
  }

  /**
   * LOS MAYORES SALTOS PRIMERO.
   *
   * Con el tope por pasada, lo que no entra se queda para la siguiente. Y si hay
   * que elegir, lo que más urge publicar es lo que más se aleja del precio
   * correcto — ahí es donde se está perdiendo dinero o vendiendo caro.
   */
  candidatos.sort((a, b) => b.salto - a.salto)

  const tanda = candidatos.slice(0, config.publicar_max_por_pasada)

  if (frenados.length > 0) {
    // Se guardan como evento para que salgan en la cola de incidencias: un
    // precio que no se manda y que nadie ve es un precio mal puesto para siempre.
    await service.from('amazon_eventos').insert({
      connection_id: config.connection_id,
      marketplace_id: config.marketplace_id,
      tipo: 'entrais_precio_frenado',
      severidad: 'aviso',
      mensaje:
        `${frenados.length} precios no se han publicado porque cambiaban más de un ` +
        `${Math.round(Number(tope) * 100)} %. Míralos en el motor de precios antes de subir el tope. ` +
        `Los mayores: ${frenados
          .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
          .slice(0, 5)
          .map((f) => `${f.sku} ${f.de.toFixed(2)}→${f.a.toFixed(2)} (${Math.round(f.pct * 100)} %)`)
          .join(', ')}`,
    })
  }

  if (tanda.length === 0) {
    await service
      .from('entrais_config')
      .update({ publicado_at: new Date().toISOString() })
      .eq('id', config.id)
    return apuntar(config.id, {
      hecho: true,
      motivo:
        candidatos.length === 0 && frenados.length > 0
          ? `Ninguno se ha podido mandar: los ${frenados.length} que cambiaban se pasan del tope de salto.`
          : 'No había ningún precio que cambiar: Amazon ya está a los precios calculados.',
      calculados: resumen.productos,
      candidatos: 0,
      frenados: frenados.length,
      enviados: 0,
      fallidos: 0,
    })
  }

  // ---------- 3. Mandar ----------
  const cambios: ChangeToSend[] = tanda.map((c) => ({
    sku: c.sku,
    marketplaceId: config.marketplace_id as string,
    field: 'precio',
    newValue: c.precio,
  }))

  const enviado = await sendChanges({
    connectionId: config.connection_id,
    changes: cambios,
    // `fichero` y no `manual`: lo decidió el motor, no una persona. Es lo primero
    // que hay que saber el día que un precio salga raro.
    source: 'fichero',
    sourceRef: `entrais-automatico:${new Date().toISOString().slice(0, 16)}`,
    userId: null,
  })

  await service
    .from('entrais_config')
    .update({ publicado_at: new Date().toISOString() })
    .eq('id', config.id)

  return apuntar(config.id, {
    hecho: true,
    motivo:
      `Publicado: ${enviado.accepted} precios aceptados por Amazon` +
      (enviado.failed > 0 ? `, ${enviado.failed} rechazados` : '') +
      (frenados.length > 0 ? `, ${frenados.length} frenados por el tope de salto` : '') +
      '.',
    calculados: resumen.productos,
    candidatos: candidatos.length,
    frenados: frenados.length,
    enviados: enviado.accepted,
    fallidos: enviado.failed,
  })
}
