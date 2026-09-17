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

/**
 * CUÁNTO TIEMPO PUEDE OCUPAR EL ENVÍO DE PRECIOS EN UNA PASADA.
 *
 * Amazon acepta CINCO patchListingsItem por segundo (lib/amazon/throttle.ts), y
 * eso no se negocia: 966 precios son 193 segundos, 2.900 son los 580 de la
 * ventana entera. Todo lo que hay que decidir aquí es cuánta ventana se usa.
 *
 *
 * ============ AQUÍ HABÍA 260 SEGUNDOS Y ERA EL FALLO ============
 *
 * El número venía de creer que «el cron corta la petición a los 280 segundos».
 * No es verdad: la ruta declara maxDuration = 600 y el curl del contenedor
 * espera 780. Con 260 y el ciclo de stock por delante comiéndose 145, a los
 * precios les quedaban 115 segundos — unos 570 precios— y el resto se quedaba
 * para la pasada siguiente. Que además tardaba un cuarto de hora en llegar,
 * porque cron-sync está a quince minutos en `cron_config`.
 *
 * Eso es exactamente lo que dejó escrito la última pasada real:
 *
 *     «598 precios aceptados por Amazon, 2 frenados. Quedan 893 para las
 *      siguientes pasadas»
 *
 * Ahora los precios corren en su propia ruta (app/api/entrais/cron-precios) y
 * tienen la ventana entera. 580 segundos dejan 20 de margen para cerrar y
 * contestar dentro de los 600.
 */
export const PRESUPUESTO_TOTAL_MS = 580_000

/**
 * Lo que se usa si quien llama no dice nada. Sigue siendo el valor viejo a
 * propósito: cualquier llamada que comparta petición con otro trabajo tiene que
 * pedir su presupuesto expresamente, no heredar la ventana entera y morirse.
 */
const PRESUPUESTO_ENVIO_MS = 100_000

/** Suelo: por poco tiempo que quede, una tanda entra siempre */
const PRESUPUESTO_MINIMO_MS = 30_000

/**
 * Cuántos precios por llamada a sendChanges.
 *
 * NO es un tope de cuántos se mandan: el bucle da tantas vueltas como haga
 * falta hasta acabarlos todos o agotar el presupuesto. Es el tamaño del lote
 * con el que se escribe en el historial, y 200 es lo que hace que en la
 * pantalla se vea el avance en vez de un único bloque al final.
 *
 * Se comprueba el reloj ENTRE tandas, así que la última puede pasarse hasta
 * cuarenta segundos del presupuesto. Por eso PRESUPUESTO_TOTAL_MS deja margen.
 */
const POR_TANDA = 200

/**
 * CUÁNTO SE ESPERA ANTES DE VOLVER A MANDAR EL MISMO PRECIO.
 *
 * Amazon contesta «aceptado» en cuanto entiende la petición, NO cuando la
 * aplica. Aplicarla es un trabajo suyo, asíncrono, y tarda bastante más de lo
 * que parece. Medido sobre 5.000 envíos de precio confirmados del 14 al 16 de
 * septiembre, tiempo desde que sale hasta que el catálogo lo refleja:
 *
 *     mediana     16,6 min
 *     p90         84,1 min
 *     p99        161,3 min
 *     maximo     369,6 min   (algo más de seis horas)
 *
 * AQUÍ HABÍA 25 MINUTOS Y ESO ERA EL FALLO. El número salió de razonar que «el
 * catálogo se refresca cada quince minutos, así que lo que va a cuadrar cuadra
 * en la primera media hora». El refresco sí es rápido; lo lento es Amazon. Con
 * 25 minutos, el 38,5 % de los envíos volvían a mandarse antes de que Amazon
 * hubiera aplicado el anterior, y el 24,5 % tardaban más de una hora — o sea
 * más que la cadencia, así que se remandaban una vez por pasada.
 *
 * El resultado medido: 1.516 SKU reenviados tres o más veces y 10.733 llamadas
 * a Amazon en dos días gastadas en repetir lo que ya estaba en camino. De esos
 * SKU, 917 tienen HOY el precio correcto en el espejo: no es que no se aplicara,
 * es que se mandó otra vez antes de que llegara.
 *
 * Y esa cola de reenvíos inútiles es la que empujaba fuera de la ventana a los
 * precios que sí hacía falta mandar. De ahí «hay precios que no se sincronizan».
 *
 * CUATRO HORAS cubren el 99,6 % de los casos medidos. Lo que pase de ahí se
 * reintenta, que es lo correcto: a esas alturas ya no está en camino.
 */
const ESPERA_CONFIRMACION_MS = 4 * 60 * 60_000

/**
 * CUÁNTAS VECES SE INSISTE CON UN PRECIO QUE AMAZON ACEPTA Y NO APLICA.
 *
 * Medido el 16 de septiembre: de 2.098 combinaciones SKU+precio intentadas en
 * dos días, 341 se aplicaron y 1.262 llevaban más de cuatro horas aceptadas sin
 * aplicarse. Amazon dice que sí y no hace nada.
 *
 * La causa está en Seller Central, no aquí: esos listados tienen una regla de
 * precio automático que vuelve a poner el suyo. Comparados con los que sí
 * entran, coinciden en todo lo que el ERP puede ver —canal, stock, estado—, así
 * que desde este lado no hay nada que arreglar salvo dejar de gastar llamadas.
 */
const INTENTOS_ANTES_DE_RENDIRSE = 3

/**
 * Y cada cuánto se vuelve a probar uno de los que se dieron por perdidos.
 *
 * Una vez al día: si se quita la regla en Seller Central, el precio entra solo
 * sin que nadie tenga que acordarse de desbloquearlo aquí. Abandonar para
 * siempre convertiría un problema que se arregla en un problema permanente.
 */
const REINTENTO_DE_LOS_IGNORADOS_MS = 24 * 60 * 60_000

/**
 * El mismo tope que valida sendChanges antes de llamar a Amazon
 * (MAX_PRICE en lib/amazon/catalogo.ts). Se repite aquí para apartar el SKU
 * ANTES de meterlo en el lote, en vez de que reviente el lote entero.
 */
const MAX_PRECIO = 999_999.99

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

/**
 * ¿HAY YA UNA PASADA DE PRECIOS EN MARCHA?
 *
 * El cron llama cada minuto y una pasada con cola dura minutos, así que sin
 * esto se solapan: hasta diez a la vez. Y no van diez veces más rápido — van
 * más lento. El cubo de fichas de patchListingsItem es UNO por conexión (5 por
 * segundo, lib/amazon/throttle.ts) y vive en la memoria del proceso, así que
 * diez pasadas se reparten esos mismos 5/s. Encima recorren la MISMA lista
 * ordenada igual, y como `enviado_at` solo se sella al terminar cada tanda de
 * 200, se pisan: PATCH duplicados del mismo SKU gastando la cuota en reescribir
 * lo mismo.
 *
 * Mismo mecanismo que `ejecutarCicloStock`. Basta con que sea de proceso: hay
 * un solo contenedor y un solo proceso de Next.
 */
let enMarcha = false

export async function publicarSiToca(
  opciones: {
    forzar?: boolean
    /**
     * Cuánto tiempo queda para mandar precios en esta petición.
     *
     * Lo sabe quien llama y no este módulo: detrás de una pasada de stock quedan
     * unos 120 segundos de los 280 que da el cron, pero en una pasada donde al
     * stock no le tocaba están casi los 280 enteros. Fijarlo aquí a un número
     * dejaba sin usar la mitad del tiempo disponible justo en las pasadas más
     * desahogadas.
     */
    presupuestoMs?: number
  } = {}
): Promise<ResultadoAutomatico> {
  if (enMarcha) {
    // No se apunta: con el cron cada minuto esto se contesta muchas veces
    // durante una pasada larga y llenaría la columna de motivos de ruido.
    return { hecho: false, motivo: 'Ya hay una pasada de precios en marcha.' }
  }

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
      /**
       * `nullsFirst: false` NO ES DECORACIÓN.
       *
       * En PostgreSQL, `ORDER BY ... DESC` pone los NULL PRIMERO por defecto. Un
       * perfil activo que todavía no ha corrido nunca —uno recién creado— tiene
       * `last_run_at` a NULL, así que salía el primero, `ultimaPasada` quedaba
       * en undefined y esto contestaba «esta cuenta no tiene ningún perfil de
       * sincronismo activo». Con perfiles corriendo cada quince minutos delante.
       *
       * O sea: dar de alta un perfil nuevo apagaba la publicación de precios
       * entera, sin error y sin relación aparente con lo que se acababa de hacer.
       */
      .order('last_run_at', { ascending: false, nullsFirst: false })
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

  enMarcha = true
  try {
    return await publicar(config, opciones)
  } finally {
    // En `finally`: si revienta el recálculo o el envío, el cerrojo tiene que
    // soltarse igual. Si no, la publicación queda apagada hasta que alguien
    // reinicie el contenedor, y sin ningún error que lo explique.
    enMarcha = false
  }
}

async function publicar(
  config: Awaited<ReturnType<typeof leerConfig>>,
  opciones: { forzar?: boolean; presupuestoMs?: number }
): Promise<ResultadoAutomatico> {
  const service = createServiceClient()
  const arranque = Date.now()

  /**
   * LA CUENTA Y EL PAÍS, YA COMPROBADOS, EN VARIABLES PROPIAS.
   *
   * `publicarSiToca` ya se asegura de que los dos existen antes de llamar aquí,
   * pero eso TypeScript no lo sabe: el estrechamiento de tipo no cruza de una
   * función a otra, así que `config.connection_id` sigue siendo `string | null`
   * en este lado y la compilación falla al pasarlo a sendChanges.
   *
   * Se vuelve a comprobar en vez de poner un `as string`. El cast compila igual
   * y esconde el día que deje de ser cierto —una cuenta desconectada a mitad de
   * pasada, una configuración que se vacía— y entonces lo que llega a Amazon es
   * un `null` disfrazado de texto.
   */
  const connectionId = config.connection_id
  const marketplaceId = config.marketplace_id
  if (!connectionId || !marketplaceId) {
    return apuntar(config.id, {
      hecho: false,
      motivo: 'El motor no tiene cuenta de Amazon ni país configurados.',
    })
  }

  /**
   * ---------- 1. Recalcular CON LO QUE YA HAY ----------
   *
   * `soloCache` es la línea importante de este módulo. El proveedor deja cuatro
   * llamadas por hora a su catálogo y quien las necesita es el ciclo de stock.
   * Los precios se calculan con EL MISMO catálogo que acaba de traer esa pasada:
   * una petición, los dos trabajos.
   *
   * No es solo ahorro de cuota, es que el dato es mejor: el stock y el precio
   * salen de la misma lectura, no de dos que pueden diferir en lo que tardan en
   * llegar la una de la otra.
   *
   * Si no hay catálogo en memoria —recién desplegado, o la pasada de stock falló
   * por cuota— no se publica y se dice por qué, en vez de gastar la llamada que
   * le hace falta al stock para volver a fallar.
   */
  const calculo = await calcularTodo({ lanzadoPor: null, soloCache: true }).catch(
    (error: unknown) =>
      ({ fallo: error instanceof Error ? error.message : 'No se ha podido recalcular.' }) as const
  )
  if ('fallo' in calculo) {
    return apuntar(config.id, { hecho: false, motivo: calculo.fallo })
  }
  const { resumen } = calculo

  // ---------- 2. Qué se puede mandar ----------
  interface FilaPrecio {
    sku: string
    precio: number | null
    pvp_actual: number | null
    dif_euros: number | null
    dif_porcentaje: number | null
    origen: string | null
    enviado_precio?: number | null
    enviado_at?: string | null
    intentos_sin_aplicar?: number | null
    pvp_al_enviar?: number | null
  }

  const COLUMNAS = 'sku, precio, pvp_actual, dif_euros, dif_porcentaje, origen'

  /**
   * SE REINTENTA SIN LAS COLUMNAS DE LA 180 SI TODAVÍA NO ESTÁ LANZADA.
   *
   * Las migraciones de este ERP se lanzan a mano, así que el código llega antes
   * que la columna. Pidiendo `enviado_precio` a una tabla que no la tiene,
   * PostgREST contesta 42703 y `fetchAll` lanza: la publicación entera se
   * quedaba muerta —sin mandar un solo precio— hasta que alguien se acordara de
   * ejecutar el SQL. Y el motivo que quedaba escrito hablaba de una columna, no
   * de una migración.
   *
   * Sin esas dos columnas se trabaja igual; lo único que se pierde es no
   * reenviar lo que acaba de salir, que es justo lo que la 180 viene a añadir.
   */
  let filas: FilaPrecio[]
  try {
    filas = await fetchAll<FilaPrecio>((a, b) =>
      service
        .from('entrais_precios')
        .select(`${COLUMNAS}, enviado_precio, enviado_at, intentos_sin_aplicar, pvp_al_enviar`)
        .order('sku', { ascending: true })
        .range(a, b)
    )
  } catch (error) {
    const codigo = (error as { code?: string } | null)?.code
    if (codigo !== '42703' && codigo !== 'PGRST204') throw error
    console.warn('[entrais] falta la migración 180: se publica sin control de reenvío')
    filas = await fetchAll<FilaPrecio>((a, b) =>
      service.from('entrais_precios').select(COLUMNAS).order('sku', { ascending: true }).range(a, b)
    )
  }

  /** Para poder mirar en qué estado estaba cada SKU al apuntar lo enviado */
  const porSku = new Map(filas.map((f) => [f.sku, f]))

  const tope = config.publicar_max_salto_pct
  /**
   * El suelo por debajo del cual no se manda nada. `?? 0.005` para que el código
   * siga funcionando si la 188 aún no está lanzada: ese era el valor de antes.
   */
  const minimo = Number(config.publicar_min_dif_eur ?? 0.005)
  const candidatos: { sku: string; precio: number; salto: number }[] = []
  const frenados: { sku: string; de: number; a: number; pct: number }[] = []
  /** Ya salieron hacia Amazon y el espejo todavía no lo refleja */
  let enVuelo = 0
  /** Precios que Amazon no aceptaría nunca: cero, negativos o desorbitados */
  const imposibles: { sku: string; precio: number }[] = []
  /** Los que Amazon acepta y no aplica, y que se han dejado de intentar */
  const ignorados: { sku: string; precio: number; veces: number }[] = []
  /** Cambios tan pequeños que no compensa mandarlos */
  let minucias = 0

  const ahoraMs = Date.now()

  for (const f of filas) {
    if (f.origen === 'bloqueado') continue
    if (f.precio === null || f.pvp_actual === null) continue
    const dif = f.dif_euros === null ? 0 : Number(f.dif_euros)

    /**
     * POR UN CÉNTIMO NO SE MOLESTA A AMAZON.
     *
     * Medido el 17 de septiembre: de 176 precios que tocaba cambiar, 142 eran
     * de 0,01 EUR. Ocho de cada diez envíos servían para mover un precio un
     * céntimo — que no cambia el margen, ni lo que ve el comprador, ni la Buy
     * Box— y cuesta lo mismo que uno de verdad: una de las cinco llamadas por
     * segundo que deja Amazon, y un hueco en la ventana de la pasada.
     *
     * El mínimo se ajusta desde la pantalla (migración 188) porque el número
     * bueno depende del catálogo: diez céntimos son un 1,7 % en una referencia
     * de 6 EUR y un 0,08 % en una de 130.
     */
    if (Math.abs(dif) < minimo) {
      if (Math.abs(dif) >= 0.005) minucias += 1
      continue
    }

    /**
     * YA SE MANDÓ Y AMAZON NO LO HA CONFIRMADO TODAVÍA.
     *
     * Va ANTES del tope de salto y antes de contarlo como candidato: no es que
     * no se pueda mandar, es que ya está mandado. Ver ESPERA_CONFIRMACION_MS.
     */
    /**
     * UN PRECIO IMPOSIBLE SE APARTA AQUÍ, NO EN AMAZON.
     *
     * sendChanges() valida el LOTE ENTERO y LANZA si un solo precio es <= 0 o
     * se pasa del máximo. Un cero es alcanzable de verdad: si el proveedor manda
     * un artículo sin precio, el motor calcula coste 0 y objetivo 0 —de ahí que
     * exista el aviso `precio_proveedor_cero`—. Dejándolo entrar, ese SKU
     * tumbaba su tanda de 200 Y el resto de la pasada, y como el orden es el
     * mismo en cada pasada, volvía a tumbarla la siguiente. Indefinidamente.
     *
     * Se aparta como frenado: es un precio que no se puede mandar, y sale en la
     * cola de incidencias en vez de desaparecer.
     */
    const valor = Number(f.precio)
    if (!Number.isFinite(valor) || valor <= 0 || valor > MAX_PRECIO) {
      imposibles.push({ sku: f.sku, precio: valor })
      continue
    }

    const yaMandado =
      f.enviado_precio != null &&
      f.enviado_at != null &&
      Math.abs(Number(f.enviado_precio) - Number(f.precio)) < 0.005

    /**
     * ¿HA CAMBIADO EL PRECIO DE AMAZON DESDE QUE MANDAMOS?
     *
     * Si el que tiene ahora no es el que tenía cuando se mandó, aquel envío YA
     * SE RESOLVIÓ —lo aplicara Amazon, lo pisara una regla o lo cambiara una
     * persona a mano— y hay un precio nuevo que corregir. Esperar en ese caso es
     * quedarse mirando.
     *
     * Pasó de verdad: el 16 de septiembre el ERP mandó 33,44 del SKU 34660 a las
     * 12:04, Raúl puso 33,90 a mano a las 13:40, y la pasada de las 14:08 no
     * mandó nada porque el guardia lo daba por «en camino» hasta las 16:04.
     */
    const espejoSeHaMovido =
      f.pvp_al_enviar != null &&
      f.pvp_actual != null &&
      Math.abs(Number(f.pvp_actual) - Number(f.pvp_al_enviar)) > 0.005

    if (
      yaMandado &&
      !espejoSeHaMovido &&
      ahoraMs - Date.parse(f.enviado_at as string) < ESPERA_CONFIRMACION_MS
    ) {
      enVuelo += 1
      continue
    }

    /**
     * AMAZON LO ACEPTA Y NO LO APLICA: SE DEJA DE INSISTIR.
     *
     * Tres envíos del mismo precio sin que llegue a ponerse y este SKU deja de
     * intentarse durante un día. Son 1.262 combinaciones en este catálogo, y
     * cada pasada las volvía a mandar: esa cola es la que empujaba fuera de la
     * ventana a los precios que sí entran.
     *
     * Se reintenta una vez al día por si se ha quitado la regla de precio
     * automático en Seller Central, que es lo que los bloquea.
     */
    if (
      yaMandado &&
      !espejoSeHaMovido &&
      Number(f.intentos_sin_aplicar ?? 0) >= INTENTOS_ANTES_DE_RENDIRSE &&
      ahoraMs - Date.parse(f.enviado_at as string) < REINTENTO_DE_LOS_IGNORADOS_MS
    ) {
      ignorados.push({ sku: f.sku, precio: Number(f.precio), veces: Number(f.intentos_sin_aplicar) })
      continue
    }

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

  if (imposibles.length > 0) {
    // Un precio a cero es un producto sin precio de proveedor, no un error de
    // Amazon. Va a la cola de incidencias porque es lo que hay que arreglar.
    await service.from('amazon_eventos').insert({
      connection_id: connectionId,
      marketplace_id: marketplaceId,
      tipo: 'entrais_precio_imposible',
      severidad: 'aviso',
      mensaje:
        `${imposibles.length} precios no se pueden mandar porque el cálculo da un importe que ` +
        'Amazon no acepta (cero, negativo o desorbitado). Suele ser un artículo que llega del ' +
        `proveedor sin precio. Los primeros: ${imposibles
          .slice(0, 8)
          .map((i) => `${i.sku} (${i.precio})`)
          .join(', ')}`,
    })
  }

  if (ignorados.length > 0) {
    await service.from('amazon_eventos').insert({
      connection_id: connectionId,
      marketplace_id: marketplaceId,
      tipo: 'entrais_precio_ignorado',
      severidad: 'aviso',
      mensaje:
        `${ignorados.length} precios se han dejado de intentar: Amazon los acepta y no los ` +
        'aplica. Casi siempre es una REGLA DE PRECIO AUTOMÁTICO puesta en ese listado en Seller ' +
        'Central (el icono de las flechas junto al precio, con su mínimo y su máximo): la regla ' +
        'vuelve a poner el suyo en cuanto el ERP pone otro. Se reintentan solos una vez al día. ' +
        `Los primeros: ${ignorados
          .slice(0, 10)
          .map((i) => `${i.sku} (${i.precio.toFixed(2)}, ${i.veces} intentos)`)
          .join(', ')}`,
    })
  }

  if (frenados.length > 0) {
    // Se guardan como evento para que salgan en la cola de incidencias: un
    // precio que no se manda y que nadie ve es un precio mal puesto para siempre.
    await service.from('amazon_eventos').insert({
      connection_id: connectionId,
      marketplace_id: marketplaceId,
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
          : enVuelo > 0
            ? `Nada que mandar ahora mismo: ${enVuelo} ya salieron y Amazon todavía no los ha ` +
              'confirmado. Se confirman en el refresco del catálogo, cada quince minutos.'
            : 'No había ningún precio que cambiar: Amazon ya está a los precios calculados.',
      calculados: resumen.productos,
      candidatos: 0,
      frenados: frenados.length,
      enviados: 0,
      fallidos: 0,
    })
  }

  /**
   * ---------- 3. Mandar, POR TANDAS Y CON RELOJ ----------
   *
   * Nunca en una sola llamada. Ver PRESUPUESTO_ENVIO_MS: mandar el catálogo
   * entero de golpe es lo que hacía que la petición muriera a mitad y no se
   * publicara nada, pasada tras pasada.
   */
  /**
   * El reloj arranca con la PASADA, no con el envío.
   *
   * Medido desde `arranqueEnvio` se dejaban fuera el recálculo de las 6.931
   * referencias y la lectura de la tabla, que son bastantes segundos: el
   * presupuesto se pasaba de largo de la ventana justo en las pasadas con más
   * trabajo, que son las que no se pueden permitir un corte.
   */
  const arranqueEnvio = arranque
  let aceptados = 0
  let rechazados = 0
  let mandados = 0
  /** Las tandas que sendChanges rechazó enteras, si alguna */
  const fallos: string[] = []

  for (let i = 0; i < tanda.length; i += POR_TANDA) {
    const presupuesto = Math.max(
      PRESUPUESTO_MINIMO_MS,
      opciones.presupuestoMs ?? PRESUPUESTO_ENVIO_MS
    )
    /**
     * PREDICTIVA: se mira si cabe la tanda ENTERA, no si ya se pasó.
     *
     * Comprobando sólo «¿me he pasado?» se arrancaba una tanda de 200 con dos
     * segundos de margen y se acababa cuarenta segundos por encima de la
     * ventana. Ahora una tanda que no cabe no se empieza.
     */
    const DURACION_TANDA_MS = (POR_TANDA / 5) * 1000
    if (Date.now() - arranqueEnvio + DURACION_TANDA_MS > presupuesto) break

    const cambios: ChangeToSend[] = tanda.slice(i, i + POR_TANDA).map((c) => ({
      sku: c.sku,
      marketplaceId,
      field: 'precio',
      newValue: c.precio,
    }))

    /**
     * EN SU TRY, PORQUE sendChanges() LANZA Y SE LO LLEVABA TODO POR DELANTE.
     *
     * sendChanges valida el LOTE ENTERO y lanza si un solo precio sale <= 0 o
     * por encima del máximo (lib/amazon/data.ts). Esa excepción salía de
     * publicarSiToca sin pasar por apuntar(), así que en la pantalla no quedaba
     * ni el motivo: se veía como que la publicación no hacía nada, cuando lo
     * que pasaba es que UN producto tenía el precio mal calculado.
     *
     * Se corta el bucle pero NO se pierde lo ya mandado: las tandas anteriores
     * están enviadas y apuntadas, y el motivo de abajo lo dice.
     */
    let parcial: Awaited<ReturnType<typeof sendChanges>>
    try {
      parcial = await sendChanges({
        connectionId,
        changes: cambios,
        // `fichero` y no `manual`: lo decidió el motor, no una persona. Es lo
        // primero que hay que saber el día que un precio salga raro.
        source: 'fichero',
        sourceRef: `entrais-automatico:${new Date().toISOString().slice(0, 16)}`,
        userId: null,
      })
    } catch (error) {
      /**
       * `continue`, NO `break`.
       *
       * Con `break`, un lote que sendChanges rechaza entero se llevaba por
       * delante las tandas que quedaban —hasta 2.800 precios más— y la pasada
       * acababa con cero enviados. Y como cada pasada recorre la misma lista en
       * el mismo orden, la siguiente moría igual: la publicación se quedaba
       * parada para siempre por un solo producto.
       */
      fallos.push(error instanceof Error ? error.message : 'Amazon ha rechazado el lote.')
      continue
    }
    aceptados += parcial.accepted
    rechazados += parcial.failed
    mandados += cambios.length

    /**
     * QUEDA APUNTADO LO QUE AMAZON HA ACEPTADO, TANDA A TANDA.
     *
     * Tanda a tanda y no al final: si la pasada se corta —se acaba el
     * presupuesto, revientan los tokens, se cae el contenedor— lo ya mandado
     * tiene que constar igualmente. Apuntándolo al final, un corte dejaría 2.000
     * precios enviados a Amazon y sin rastro aquí, y la pasada siguiente los
     * mandaría otra vez.
     *
     * Solo los ACEPTADOS. Uno que Amazon ha rechazado no está puesto, así que
     * tiene que volver a intentarse en la pasada siguiente.
     */
    const aceptadosDeLaTanda = parcial.results.filter((r) => r.status === 'aceptado')
    if (aceptadosDeLaTanda.length > 0) {
      const sello = new Date().toISOString()
      await Promise.all(
        aceptadosDeLaTanda.map((r) => {
          /**
           * LA CUENTA DE VECES QUE SE HA MANDADO ESTE MISMO PRECIO.
           *
           * Si es el mismo que la vez anterior, es un reenvío: Amazon no lo
           * aplicó. Si es distinto, empieza de cero — es un intento nuevo, no
           * una insistencia.
           */
          const antes = porSku.get(r.sku)
          const esElMismo =
            antes?.enviado_precio != null &&
            Math.abs(Number(antes.enviado_precio) - Number(r.newValue)) < 0.005
          const intentos = esElMismo ? Number(antes?.intentos_sin_aplicar ?? 0) + 1 : 1

          return service
            .from('entrais_precios')
            .update({
              enviado_precio: r.newValue,
              enviado_at: sello,
              intentos_sin_aplicar: intentos,
              // Con qué precio partía Amazon. Ver la migración 187.
              pvp_al_enviar: antes?.pvp_actual ?? null,
            })
            .eq('sku', r.sku)
        })
      ).catch((error) => {
        // La 180 se lanza a mano, así que el código puede llegar antes. Que no
        // poder apuntarlo tumbe una publicación que YA HA SALIDO hacia Amazon
        // sería cambiar un problema pequeño por uno grande.
        console.warn('[entrais] no se ha podido apuntar el precio enviado:', error)
      })
    }
  }

  /**
   * LO QUE QUEDA ES SOBRE LOS CANDIDATOS, NO SOBRE LA TANDA.
   *
   * `tanda` ya viene recortada por `publicar_max_por_pasada`. Midiendo contra
   * ella, los candidatos que se quedaron FUERA del recorte no contaban como
   * pendientes: con el tope por debajo de lo que cambia, esto sellaba
   * `publicado_at` diciendo que no quedaba nada y esos precios no se mandaban
   * hasta el ciclo siguiente. Hoy el tope está en 20.000 y no recorta nada,
   * pero es un número de la pantalla y cualquiera puede bajarlo.
   */
  const quedan = candidatos.length - mandados
  const enviado = { accepted: aceptados, failed: rechazados }

  /**
   * SOLO SE SELLA CUANDO NO QUEDA NADA, Y ESO ES LO QUE ACELERA LA PUESTA AL DÍA.
   *
   * `publicado_at` es lo que hace esperar a la siguiente pasada de stock. Si se
   * sellara con trabajo pendiente, los 5.424 precios del primer día saldrían a
   * 400 por media hora: siete horas.
   *
   * Dejándolo sin sellar mientras queden, el cron —que entra cada minuto—
   * retoma por donde iba en la pasada siguiente, y esas pasadas tienen el tiempo
   * casi entero porque al stock no le toca. La puesta al día pasa de horas a
   * minutos, y en cuanto la cola se vacía se sella y todo vuelve al ritmo del
   * sincronismo.
   */
  if (quedan === 0) {
    await service
      .from('entrais_config')
      .update({ publicado_at: new Date().toISOString() })
      .eq('id', config.id)
  }

  return apuntar(config.id, {
    hecho: true,
    motivo:
      (fallos.length > 0 ? `${fallos.length} tanda(s) rechazadas (${fallos[0]}). El resto: ` : 'Publicado: ') +
      `${enviado.accepted} precios aceptados por Amazon` +
      (enviado.failed > 0 ? `, ${enviado.failed} rechazados` : '') +
      (frenados.length > 0 ? `, ${frenados.length} frenados por el tope de salto` : '') +
      (enVuelo > 0 ? `, ${enVuelo} ya estaban mandados y sin confirmar` : '') +
      (imposibles.length > 0 ? `, ${imposibles.length} con un precio que Amazon no admite` : '') +
      (ignorados.length > 0
        ? `, ${ignorados.length} que Amazon acepta y no aplica (regla de precio automático en su ficha)`
        : '') +
      (minucias > 0
        ? `, ${minucias} sin mandar por cambiar menos de ${minimo.toFixed(2)} €`
        : '') +
      (quedan > 0
        ? `. Quedan ${quedan} para las siguientes pasadas: no caben en el tiempo de una, y van ` +
          'ordenados de mayor a menor diferencia, así que lo que espera es lo menos urgente.'
        : '.'),
    calculados: resumen.productos,
    candidatos: candidatos.length,
    frenados: frenados.length,
    enviados: enviado.accepted,
    fallidos: enviado.failed,
  })
}
