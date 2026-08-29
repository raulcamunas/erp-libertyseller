/**
 * EL CICLO AUTOMÁTICO DE CADA QUINCE MINUTOS.
 *
 *   traer el fichero -> leer -> reglas -> cruzar -> contrastar -> frenos -> enviar
 *
 * Es lo que convierte todo lo anterior en algo que funciona sin nadie delante.
 * Lo dispara el mismo cron que ya refresca el catálogo (scripts/amazon-sync.sh
 * -> /api/amazon/cron-sync), y va DETRÁS de ese refresco a propósito: el
 * simulacro contrasta contra el espejo del catálogo, así que primero se pone al
 * día lo que Amazon tiene y después se compara contra ello. Al revés, cada
 * pasada compararía contra la foto de hace un cuarto de hora y propondría
 * cambios que ya se mandaron.
 *
 * LAS TRES REGLAS QUE HACEN QUE ESTO SE PUEDA DEJAR SOLO:
 *
 *   1. EL ENVÍO NACE APAGADO, POR CLIENTE. Con el interruptor apagado el ciclo
 *      hace exactamente lo mismo salvo el último paso, y deja el simulacro
 *      guardado. Eso ya vale por sí solo: se ve cada quince minutos qué habría
 *      pasado, sin riesgo ninguno.
 *
 *   2. SI SALTA UN FRENO NO SE MANDA NADA. Ni la parte buena del lote. Un
 *      fichero mal exportado un martes por la noche no puede vaciar el
 *      inventario de un cliente quince minutos después, y avisar de que se
 *      mandó «solo la mitad» no arregla nada.
 *
 *   3. NO SE REPITE TRABAJO Y NO SE PISAN DOS PASADAS. Las dos cosas están
 *      explicadas donde se hacen, más abajo.
 *
 * ESTE FICHERO NO SABE LEER UN EXCEL NI CRUZAR NADA. Solo decide a quién le
 * toca, se lo queda, mira si hay algo nuevo y llama a procesarPerfil(). Todo lo
 * demás sigue viviendo donde vivía.
 */

import { sendChanges, type ChangeToSend } from '@/lib/amazon/data'
import { humanMessageOf } from '@/lib/amazon/errors'
import type { StockProfileRunState, StockReadProfile } from '@/lib/types/stock-sync'
import { StockSyncError } from './engine'
import { conectorDe, OrigenError } from './origenes'
import {
  isMissingSchema,
  marcarPerfil,
  perfilesDelCiclo,
  registrarRun,
  soltarCerrojo,
  tomarCerrojo,
} from './perfiles'
import { procesarPerfil, traerFichero, type AntesDeEnviar, type EnvioRealizado } from './proceso'

/**
 * Cuánto tiempo puede ocupar UNA pasada del ciclo.
 *
 * El cron entra cada quince minutos, así que una pasada que se acerque a eso
 * empalma con la siguiente. Nueve minutos dejan margen de sobra: cuando se
 * acaba el presupuesto no se corta nada a medias —el perfil que está en marcha
 * termina— sino que no se EMPIEZA ninguno más. Como la lista va ordenada por el
 * que lleva más tiempo sin mirarse, los que se quedan fuera son los primeros de
 * la pasada siguiente y ninguno se queda atrás indefinidamente.
 */
export const PRESUPUESTO_MS = 9 * 60 * 1000

/**
 * A partir de cuándo un cerrojo se considera abandonado y se puede robar.
 *
 * Media hora es más del doble de lo que tarda el cliente más grande que hemos
 * visto. Sin caducidad, un contenedor que se reinicia a mitad de proceso deja
 * ese perfil congelado PARA SIEMPRE, y es el peor fallo posible de esta parte:
 * un perfil que no se procesa no da ningún error, no aparece en ninguna lista
 * de incidencias y el stock del cliente simplemente se queda viejo.
 */
export const CERROJO_CADUCA_MS = 30 * 60 * 1000

/**
 * Margen de la cadencia.
 *
 * Sin esto, un perfil de 15 minutos disparado por un cron de 15 minutos se
 * procesaría la mitad de las veces: basta con que la pasada de hoy empiece unos
 * segundos antes que la de hace un cuarto de hora para que hayan pasado 14
 * minutos y 55 segundos y se descarte por poco. Se compara con un minuto de
 * holgura, que es siempre menos que la propia cadencia (el CHECK de la base
 * exige 5 minutos como mínimo).
 */
const MARGEN_CADENCIA_MS = 60 * 1000

/** Cómo acabó un perfil en esta pasada */
export type DesenlaceCiclo =
  /** El origen está declarado pero no construido (SFTP, correo) */
  | 'sin_conector'
  /** Todavía no le toca según su cadencia */
  | 'aun_no_toca'
  /** Otra ejecución lo tiene cogido */
  | 'ocupado'
  /** El fichero es idéntico al que ya se procesó: no hay nada que hacer */
  | 'mismo_fichero'
  /** Se ha acabado el presupuesto de la pasada; se mira en la siguiente */
  | 'sin_tiempo'
  /** Los cinco estados de una ejecución de verdad */
  | StockProfileRunState

export interface ResultadoPerfilCiclo {
  profileId: string
  perfil: string
  desenlace: DesenlaceCiclo
  /** Una frase que explica el desenlace sin tener que abrir nada */
  detalle: string
  /** Fila de stock_profile_runs, cuando la hubo */
  runId: string | null
  /** Cambios que el simulacro proponía */
  cambios: number
  /** De esos, los que Amazon aceptó */
  enviados: number
  duracionMs: number
}

export interface ResultadoCiclo {
  /** Perfiles candidatos que se han mirado */
  mirados: number
  /** De esos, los que se han leído y procesado de verdad */
  procesados: number
  /** Los que no había que tocar: misma huella, no les tocaba, o estaban cogidos */
  saltados: number
  enviados: number
  frenados: number
  errores: number
  perfiles: ResultadoPerfilCiclo[]
  duracionMs: number
  /** Por qué no se ha ejecutado nada, si es que no se ha ejecutado nada */
  omitido: string | null
}

/**
 * EL CANDADO DEL PROCESO, que es el primero de los dos.
 *
 * Solo protege de sí mismo —dos peticiones que caen en el mismo Node—, y por
 * eso NO basta: el de verdad es el de la base de datos, que funciona también
 * con dos contenedores. Este está porque es gratis y ataja el caso más
 * frecuente con diferencia: que alguien dispare el cron a mano mientras la
 * pasada de la hora sigue corriendo.
 */
let enMarcha = false

/**
 * Lo que puede durar UN perfil como mucho.
 *
 * Dos minutos: cabe de sobra una descarga lenta (el tope de la descarga en
 * sftp.ts es de 60 segundos) y siguen entrando varios perfiles en el
 * presupuesto de 9 minutos de la pasada.
 */
const TOPE_POR_PERFIL_MS = 2 * 60 * 1000

/**
 * EL SEGURO DEL CANDADO, y hace falta aunque cada origen tenga ya su tope.
 *
 * El presupuesto de la pasada se mira ENTRE perfiles, nunca dentro de uno. Si
 * `mirarPerfil` devuelve una promesa que no resuelve jamás —un socket que se
 * queda esperando, una librería sin tiempo máximo—, el `await` de arriba no
 * vuelve, el `finally` que pone `enMarcha` a false NO SE EJECUTA, y a partir de
 * ahí todas las pasadas del cron contestan «ya había un ciclo en marcha».
 * O sea: deja de sincronizarse el stock de TODOS los clientes, no solo el del
 * origen colgado, hasta que alguien reinicie el contenedor. Y sin un error en
 * ninguna parte, porque esa respuesta es informativa.
 *
 * Los topes de cada origen son la primera defensa y la que da un mensaje útil.
 * Este es el que garantiza que ningún fallo futuro —un origen nuevo, una
 * librería que cambie— pueda volver a dejar el candado echado para siempre.
 */
async function conTopePorPerfil(
  faena: Promise<ResultadoPerfilCiclo>,
  perfil: StockReadProfile
): Promise<ResultadoPerfilCiclo> {
  let reloj: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      faena,
      new Promise<ResultadoPerfilCiclo>((resolver) => {
        reloj = setTimeout(
          () =>
            resolver(
              nota(
                perfil,
                'error',
                `El origen no ha contestado en ${Math.round(TOPE_POR_PERFIL_MS / 60000)} minutos y se ha ` +
                  'dejado para no bloquear a los demás clientes de la tanda. Comprueba el origen de este perfil.'
              )
            ),
          TOPE_POR_PERFIL_MS
        )
      }),
    ])
  } finally {
    if (reloj) clearTimeout(reloj)
  }
}

export async function ejecutarCicloStock(
  opciones: { ahora?: Date; presupuestoMs?: number } = {}
): Promise<ResultadoCiclo> {
  const arranque = Date.now()
  const presupuestoMs = opciones.presupuestoMs ?? PRESUPUESTO_MS

  if (enMarcha) {
    return sinHacerNada(
      'Ya había un ciclo en marcha en este proceso, así que esta pasada no arranca.',
      arranque
    )
  }
  enMarcha = true

  try {
    let perfiles: StockReadProfile[]
    try {
      perfiles = await perfilesDelCiclo()
    } catch (error) {
      // La migración se lanza a mano en el editor SQL de Supabase, así que el
      // código puede llegar desplegado antes que ella. Que el cron deje un error
      // cada cuarto de hora hasta que alguien la pegue no ayuda a nadie.
      if (isMissingSchema(error)) {
        return sinHacerNada(
          'Faltan las tablas de la automatización: lanza 120_stock_profiles.sql y 121_stock_ciclo.sql en el editor SQL de Supabase.',
          arranque
        )
      }
      throw error
    }

    /**
     * La hora se lee POR PERFIL y no una vez para toda la pasada: una tanda de
     * veinte clientes puede durar minutos, y si todos se marcaran con la hora
     * del principio, la cadencia del último se mediría desde antes de que
     * empezara a procesarse. Sigue entrando por parámetro para poder fijarla.
     */
    const reloj = () => opciones.ahora ?? new Date()
    const salida: ResultadoPerfilCiclo[] = []

    for (const perfil of perfiles) {
      if (Date.now() - arranque > presupuestoMs) {
        salida.push(
          nota(
            perfil,
            'sin_tiempo',
            'No ha dado tiempo en esta pasada. Va el primero en la siguiente, que es dentro de un cuarto de hora.'
          )
        )
        continue
      }

      try {
        salida.push(await conTopePorPerfil(mirarPerfil(perfil, reloj()), perfil))
      } catch (error) {
        if (isMissingSchema(error)) {
          salida.push(
            nota(
              perfil,
              'error',
              'Falta lanzar 121_stock_ciclo.sql: sin el cerrojo no se puede garantizar que dos pasadas no se pisen, así que el ciclo no procesa nada.'
            )
          )
          break
        }
        // Un perfil que revienta de una forma no prevista no puede llevarse por
        // delante a los demás clientes de la tanda.
        const mensaje = error instanceof Error ? error.message : 'Error desconocido'
        console.error(`[stock-sync] el perfil ${perfil.id} ha fallado de forma inesperada:`, error)
        salida.push(nota(perfil, 'error', mensaje))
      }
    }

    return resumir(salida, arranque)
  } finally {
    enMarcha = false
  }
}

/* ------------------------------------------------------------------ */
/* Un perfil                                                           */
/* ------------------------------------------------------------------ */

async function mirarPerfil(perfil: StockReadProfile, ahora: Date): Promise<ResultadoPerfilCiclo> {
  const arranque = Date.now()

  // ---------- ¿Se puede traer el fichero de este origen? ----------
  // Los orígenes declarados y sin construir (SFTP, correo) se saltan en
  // silencio en vez de dejar un error cada quince minutos: no están rotos,
  // están sin hacer, y un error repetido de algo que ya se sabe acaba tapando
  // los errores de verdad.
  const conector = conectorDe(perfil.origen)
  if (!conector.construido) {
    return nota(
      perfil,
      'sin_conector',
      `El origen «${conector.etiqueta}» todavía no está construido. El perfil se puede procesar a mano desde la pantalla.`,
      arranque
    )
  }

  // ---------- ¿Le toca? ----------
  if (!leToca(perfil, ahora)) {
    return nota(
      perfil,
      'aun_no_toca',
      `Su cadencia es de ${perfil.cadencia_minutos} minutos y todavía no se han cumplido.`,
      arranque
    )
  }

  // ---------- EL CERROJO ----------
  // Se toma ANTES de tocar el origen del cliente: si se tomara después de
  // descargar, dos pasadas se bajarían el mismo fichero de Drive antes de que
  // una descubriera que la otra ya lo tenía.
  const token = crypto.randomUUID()
  const tomado = await tomarCerrojo(
    perfil.id,
    token,
    ahora,
    new Date(ahora.getTime() - CERROJO_CADUCA_MS)
  )
  if (!tomado) {
    return nota(
      perfil,
      'ocupado',
      'Otra ejecución lo tiene cogido. Esta pasada lo deja en paz: procesarlo dos veces a la vez mandaría los cambios por duplicado.',
      arranque
    )
  }

  try {
    return await procesarConCerrojo(perfil, ahora, arranque)
  } finally {
    // En el `finally` y no al final del `try`: un fallo a mitad de proceso tiene
    // que soltar el cerrojo igual, o ese perfil se queda esperando media hora a
    // que caduque sin ninguna razón.
    await soltarCerrojo(perfil.id, token)
  }
}

async function procesarConCerrojo(
  perfil: StockReadProfile,
  ahora: Date,
  arranque: number
): Promise<ResultadoPerfilCiclo> {
  // ---------- Traer el fichero ----------
  let fichero
  try {
    fichero = await traerFichero(perfil)
  } catch (error) {
    return await registrarFallo(perfil, error, ahora, arranque)
  }

  /**
   * ---------- NO REPETIR TRABAJO, PERO SÍ DEJAR CONSTANCIA ----------
   *
   * La comparación es por SHA-256 del contenido que se acaba de leer, nunca por
   * la fecha de modificación: en Drive esa fecha se mueve porque alguien abre el
   * fichero y lo vuelve a guardar sin tocar nada, y eso dispararía un reproceso
   * —y un envío a Amazon— por nada.
   *
   * LO QUE SÍ HA CAMBIADO: antes esto no escribía fila. El motivo era evitar 96
   * líneas idénticas al día, y el efecto fue peor que el problema: el historial
   * salía lleno de huecos de horas y «no hay filas» se lee como «el ciclo se ha
   * parado». Había que explicarlo con un cartel entre fila y fila.
   *
   * Ahora deja su fila, corta y clara: el ciclo entró, el proveedor mandaba lo
   * mismo, no había nada que hacer. Son 48 filas al día por cliente —no las
   * 360.000 diarias que llenaron la base en agosto, que eran de las tablas de
   * medición— y ahora se purgan a los 30 días. Una pasada que ocurre y no se
   * apunta es una pasada que nadie puede auditar.
   */
  if (fichero.huellaContenido === perfil.last_file_fingerprint) {
    // `last_error` NO se limpia aquí, y es importante: a este punto también se
    // llega cuando el fichero anterior no se pudo leer y se apuntó su huella
    // para no releerlo cada cuarto de hora. Borrar el error dejaría la pantalla
    // diciendo que todo va bien mientras ese cliente lleva días sin actualizarse.
    const atascado = perfil.last_error !== null
    const motivo = atascado
      ? `«${fichero.nombre}» sigue siendo el mismo fichero que falló, así que no se vuelve a procesar hasta que el cliente lo cambie o se corrija el perfil.`
      : `«${fichero.nombre}» es el mismo fichero que ya se procesó: el proveedor no ha mandado nada nuevo.`

    /**
     * Estado `sin_cambios` y no uno nuevo: el CHECK de la tabla solo admite los
     * cinco de siempre, y añadir un sexto sería una migración con riesgo para
     * decir algo que la frase de `notes` ya dice mejor y sin límite de sitio.
     */
    await registrarRun({
      profile_id: perfil.id,
      client_id: perfil.client_id,
      created_by: null,
      origen: perfil.origen,
      fichero_nombre: fichero.nombre,
      fichero_huella: fichero.huellaContenido,
      fichero_bytes: fichero.tamano,
      fichero_modificado_at: fichero.modificadoAt,
      estado: 'sin_cambios' satisfies StockProfileRunState,
      duracion_ms: Date.now() - arranque,
      notes: motivo,
      // Un solo paso: se recogió el fichero y ahí se acabó. Los otros cinco
      // salen en pantalla como «no llegó», que es la verdad.
      fases: [
        {
          paso: 'origen',
          estado: atascado ? 'aviso' : 'omitido',
          ms: Date.now() - arranque,
          cifra: fichero.tamano ?? null,
          nota: motivo,
        },
      ],
    })

    await marcarPerfil(perfil.id, {
      last_run_at: ahora.toISOString(),
      last_skipped_at: ahora.toISOString(),
      last_skip_reason: motivo,
    })
    return nota(
      perfil,
      'mismo_fichero',
      `«${fichero.nombre}» no ha cambiado desde la última vez.`,
      arranque
    )
  }

  // ---------- El ciclo entero ----------
  let resultado
  try {
    resultado = await procesarPerfil({
      perfil,
      fichero,
      // null porque no lo ha lanzado nadie: lo ha lanzado el reloj. Es lo que
      // distingue en el historial una lectura automática de una que alguien
      // pidió desde la pantalla.
      userId: null,
      ahora,
      // AQUÍ Y EN NINGÚN OTRO SITIO se decide que esto pueda escribir en la
      // tienda de un cliente. Con el interruptor apagado no se pasa la función,
      // así que no hay ningún camino por el que se mande nada.
      enviar: perfil.envio_automatico ? (antes) => enviarLoQueSalga(antes) : undefined,
    })
  } catch (error) {
    // procesarPerfil ya ha dejado su fila de error en el historial; aquí solo se
    // traduce para el registro del cron.
    //
    // Y SE APUNTA LA HUELLA SI EL FALLO ES DEL FICHERO. Un StockSyncError es
    // «este fichero no encaja con este perfil»: la hoja no se llama así, la
    // columna del stock no aparece. Volver a leer los MISMOS bytes dentro de un
    // cuarto de hora no puede dar otra respuesta, así que reintentarlo solo sirve
    // para dejar 96 filas de error idénticas al día y enterrar el historial.
    // Un OrigenError —no llego a Drive— es lo contrario: casi siempre pasajero,
    // y ahí sí hay que reintentar. Cualquier edición del perfil borra la huella,
    // así que arreglar el nombre de la columna lo vuelve a intentar al momento.
    if (error instanceof StockSyncError) {
      await marcarPerfil(perfil.id, { last_file_fingerprint: fichero.huellaContenido })
    }
    return await registrarFallo(perfil, error, ahora, arranque, { yaRegistrado: true })
  }

  // La huella la escribe SOLO el ciclo, y solo aquí: es lo que hace que la
  // próxima pasada sepa que este contenido ya está hecho.
  //
  // MENOS CUANDO EL ENVÍO FALLÓ ENTERO. Ahí hay que volver a intentarlo en la
  // pasada siguiente: lo más probable es que Amazon estuviera caído un minuto, y
  // apuntar la huella dejaría ese envío sin hacer hasta que el cliente publicara
  // otro fichero, que puede ser mañana.
  if (resultado.estado !== 'error') {
    const apuntada = await marcarPerfil(perfil.id, {
      last_file_fingerprint: fichero.huellaContenido,
      last_skipped_at: null,
      last_skip_reason: null,
    })

    // Si la huella no se pudo escribir Y ya se había enviado algo, la pasada
    // siguiente reprocesará este mismo fichero y volverá a mandar los mismos
    // cambios. Lo publicado no cambiará —los valores son absolutos— pero
    // aparecerán dos lotes idénticos en el historial de Amazon. Que quede
    // dicho en algún sitio que no sea la consola es lo que permite explicarlo
    // cuando alguien lo vea.
    if (!apuntada && resultado.envio) {
      console.error(
        `[stock-sync] el perfil ${perfil.id} ha enviado el lote ${resultado.envio.batchId} y NO se ha ` +
          'podido apuntar la huella del fichero. La pasada siguiente lo reprocesará y el historial ' +
          'de Amazon enseñará dos lotes iguales.'
      )
    }
  }

  await fijarLineasDeReferencia(perfil, resultado.estado, resultado.lineasLeidas)

  return {
    profileId: perfil.id,
    perfil: perfil.name,
    desenlace: resultado.estado,
    detalle: detalleDe(resultado.estado, resultado, fichero.nombre),
    runId: resultado.runId,
    cambios: resultado.simulacro.cambios.length,
    enviados: resultado.envio?.aceptados ?? 0,
    duracionMs: Date.now() - arranque,
  }
}

/* ------------------------------------------------------------------ */
/* El envío                                                            */
/* ------------------------------------------------------------------ */

/**
 * Manda a Amazon exactamente lo que el simulacro ha enseñado.
 *
 * Los cambios salen de `simulacro.cambios`, que es LA MISMA LISTA que se ha
 * medido, que se ha pintado y que han visto los frenos. No se vuelve a recorrer
 * nada para construirla: dos recorridos con la misma intención acaban
 * discrepando en cuanto uno de los dos cambia, y aquí discrepar significa mandar
 * algo distinto de lo que se aprobó.
 *
 * Todo lo demás —el cupo de cinco por segundo, los reintentos, el valor
 * anterior, el registro en amazon_submissions y el corte del lote si la
 * autorización ya no vale— lo hace sendChanges(), que ya existía y está
 * probado.
 */
async function enviarLoQueSalga(antes: AntesDeEnviar): Promise<EnvioRealizado | null> {
  const { destino, simulacro, fichero, perfil } = antes

  // Sin destino no hay a dónde mandar. Se devuelve null en vez de lanzar: la
  // ejecución queda como simulacro con su nota, que es la verdad —se ha
  // calculado todo y no se ha mandado—, y no como un error del cliente.
  if (!destino) return null

  const changes: ChangeToSend[] = simulacro.cambios.map((c) => ({
    sku: c.sku,
    marketplaceId: destino.marketplaceId,
    field: c.campo,
    newValue: c.valorNuevo,
  }))

  try {
    const resultado = await sendChanges({
      connectionId: destino.connectionId,
      changes,
      // El origen del cambio queda grabado en cada fila del historial de Amazon:
      // así se distingue para siempre lo que tecleó una persona de lo que salió
      // de un fichero. El CHECK de la 118 exige la referencia cuando es de
      // fichero, y con razón: «vino de un fichero» sin decir de cuál no sirve.
      source: 'fichero',
      sourceRef: `${fichero.nombre} · perfil ${perfil.slug}`.slice(0, 200),
      userId: null,
    })

    return {
      batchId: resultado.batchId,
      aceptados: resultado.accepted,
      fallidos: resultado.failed,
      abortado: resultado.abortReason,
    }
  } catch (error) {
    // humanMessageOf traduce los fallos de Amazon a una frase en español y sin
    // credenciales dentro. Se relanza para que procesarPerfil deje la ejecución
    // en 'error' con esa frase, que es lo que acaba en la campana.
    throw new Error(humanMessageOf(error))
  }
}

/* ------------------------------------------------------------------ */
/* Piezas sueltas                                                      */
/* ------------------------------------------------------------------ */

/**
 * ¿Han pasado ya sus minutos?
 *
 * Un perfil que nunca se ha ejecutado va siempre: es su primera lectura y es la
 * que se está esperando.
 *
 * Se exporta porque es política, no fontanería, y está comprobada en
 * scripts/check-ciclo.ts: el caso del margen es de los que se cuelan sin dar
 * ningún error y se descubren tres semanas después viendo que un cliente se
 * actualiza la mitad de veces de las que debería.
 */
export function leToca(perfil: StockReadProfile, ahora: Date): boolean {
  if (!perfil.last_run_at) return true
  const desde = ahora.getTime() - new Date(perfil.last_run_at).getTime()
  return desde >= perfil.cadencia_minutos * 60 * 1000 - MARGEN_CADENCIA_MS
}

/**
 * Deja constancia de un fallo que ha ocurrido ANTES de poder procesar nada.
 *
 * Es el caso de la carpeta de Drive que el cliente movió de sitio, y no puede
 * quedarse solo en la consola: sin fila en el historial no salta el aviso de la
 * campana y el stock de ese cliente se queda viejo en silencio, que es
 * exactamente lo que esta parte existe para impedir.
 */
async function registrarFallo(
  perfil: StockReadProfile,
  error: unknown,
  ahora: Date,
  arranque: number,
  opciones: { yaRegistrado?: boolean } = {}
): Promise<ResultadoPerfilCiclo> {
  const mensaje = mensajeDe(error).slice(0, 2000)
  let runId: string | null = null

  /**
   * UN FALLO QUE SE REPITE TAMBIÉN DEJA SU FILA.
   *
   * Aquí antes se callaba. El razonamiento era razonable —un OrigenError se
   * reintenta en cada pasada porque casi siempre es pasajero, y a cuatro
   * pasadas por hora eso son 96 líneas idénticas al día que entierran todo lo
   * demás— pero la cura salió peor:
   *
   *   · El historial quedaba con huecos de dos y tres horas, y un hueco se lee
   *     como «el ciclo no está corriendo». Hubo que poner un cartel entre fila
   *     y fila explicándolo, y aun así fue la primera pregunta que salió al
   *     mirar la pantalla.
   *   · El aviso de arriba solo sale MIENTRAS falla. En cuanto se recupera
   *     desaparece, y los huecos se quedan ahí sin nada que los explique.
   *
   * Lo que se buscaba —que el mismo error no tape lo demás— ya lo resuelve el
   * botón «Solo con cambios», que es donde tiene que estar: en quien mira, no
   * en quien escribe. Un ciclo que corre y no lo apunta no se puede auditar.
   *
   * `repetido` no desaparece: marca la fila para poder decir en pantalla que es
   * el mismo fallo de siempre y no uno nuevo.
   */
  const repetido = !opciones.yaRegistrado && perfil.last_error === mensaje

  if (!opciones.yaRegistrado) {
    runId = await registrarRun({
      profile_id: perfil.id,
      client_id: perfil.client_id,
      created_by: null,
      origen: perfil.origen,
      estado: 'error' satisfies StockProfileRunState,
      duracion_ms: Date.now() - arranque,
      error_message: mensaje,
      notes: repetido
        ? 'Es el mismo fallo que en la pasada anterior: el ciclo lo sigue reintentando cada vez.'
        : null,
      fases: [
        {
          paso: 'origen',
          estado: 'error',
          ms: Date.now() - arranque,
          cifra: null,
          nota: mensaje.slice(0, 300),
        },
      ],
    })
    await marcarPerfil(perfil.id, {
      last_run_at: ahora.toISOString(),
      ...(repetido ? { last_skipped_at: ahora.toISOString() } : {}),
      last_error: mensaje,
    })
  }

  return {
    profileId: perfil.id,
    perfil: perfil.name,
    desenlace: 'error',
    detalle: mensaje,
    runId,
    cambios: 0,
    enviados: 0,
    duracionMs: Date.now() - arranque,
  }
}

/**
 * La primera lectura buena fija «lo habitual» de este cliente.
 *
 * Sin este número el freno de caída de líneas está declarado pero no puede
 * saltar, porque no hay contra qué comparar — y ese freno es justo el que
 * detecta el volcado a medias, que es el fallo que vacía el inventario de un
 * cliente sin que nadie haya hecho nada raro a la vista.
 *
 * SOLO SE ESCRIBE UNA VEZ, y a mano se cambia desde la pantalla. Ir ajustándolo
 * solo en cada pasada sería peor que no tenerlo: un fichero que encoge un 10%
 * cada día movería la referencia con él y el freno no saltaría nunca, que es la
 * forma más silenciosa posible de que un freno no exista.
 *
 * Y no se fija con una ejecución frenada: si la primera lectura ya venía mal,
 * grabar ese número como «lo normal» dejaría el freno calibrado sobre el
 * desastre.
 */
async function fijarLineasDeReferencia(
  perfil: StockReadProfile,
  estado: StockProfileRunState,
  lineasLeidas: number
): Promise<void> {
  if (perfil.lineas_referencia !== null) return
  if (estado === 'frenado' || estado === 'error') return
  if (lineasLeidas <= 0) return

  await marcarPerfil(perfil.id, { lineas_referencia: lineasLeidas })
}

function detalleDe(
  estado: StockProfileRunState,
  resultado: { simulacro: { cambios: unknown[]; frenos: { resumen: string | null } }; envio: EnvioRealizado | null },
  fichero: string
): string {
  const cambios = resultado.simulacro.cambios.length

  switch (estado) {
    case 'sin_cambios':
      return `«${fichero}» es nuevo pero no cambia nada de lo que Amazon ya tiene publicado.`
    case 'simulacro':
      return `${cambios} cambios preparados y NO enviados: este perfil tiene el envío automático apagado.`
    case 'frenado':
      return resultado.simulacro.frenos.resumen ?? 'Ha saltado un freno y no se ha mandado nada.'
    case 'enviado':
      return `${resultado.envio?.aceptados ?? 0} de ${cambios} cambios aceptados por Amazon.`
    case 'error':
      return 'El envío ha fallado. El detalle está en la fila de la ejecución.'
  }
}

function mensajeDe(error: unknown): string {
  if (error instanceof OrigenError || error instanceof StockSyncError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'Error desconocido'
}

function nota(
  perfil: StockReadProfile,
  desenlace: DesenlaceCiclo,
  detalle: string,
  arranque?: number
): ResultadoPerfilCiclo {
  return {
    profileId: perfil.id,
    perfil: perfil.name,
    desenlace,
    detalle,
    runId: null,
    cambios: 0,
    enviados: 0,
    duracionMs: arranque ? Date.now() - arranque : 0,
  }
}

function sinHacerNada(motivo: string, arranque: number): ResultadoCiclo {
  return {
    mirados: 0,
    procesados: 0,
    saltados: 0,
    enviados: 0,
    frenados: 0,
    errores: 0,
    perfiles: [],
    duracionMs: Date.now() - arranque,
    omitido: motivo,
  }
}

/** Los estados que significan «se ha leído el fichero y se ha procesado entero» */
const PROCESADOS: ReadonlySet<DesenlaceCiclo> = new Set<DesenlaceCiclo>([
  'sin_cambios',
  'simulacro',
  'frenado',
  'enviado',
  'error',
])

function resumir(perfiles: ResultadoPerfilCiclo[], arranque: number): ResultadoCiclo {
  return {
    mirados: perfiles.length,
    procesados: perfiles.filter((p) => PROCESADOS.has(p.desenlace)).length,
    saltados: perfiles.filter((p) => !PROCESADOS.has(p.desenlace)).length,
    enviados: perfiles.filter((p) => p.desenlace === 'enviado').length,
    frenados: perfiles.filter((p) => p.desenlace === 'frenado').length,
    errores: perfiles.filter((p) => p.desenlace === 'error').length,
    perfiles,
    duracionMs: Date.now() - arranque,
    omitido: null,
  }
}
