/**
 * TAREA · EL CENSO DEL CATÁLOGO
 * =============================
 * SOLO SERVIDOR. A1 SOLO LEE: aquí no se le escribe nada a Amazon.
 *
 * Pide GET_MERCHANT_LISTINGS_ALL_DATA, espera a que Amazon lo genere, lo
 * descarga, lo lee y lo vuelca en el espejo del catálogo.
 *
 *
 * POR QUÉ ESTA TAREA ES IMPRESCINDIBLE
 * ------------------------------------
 * El refresco de quince minutos usa `searchListingsItems`, que NO PUEDE PAGINAR
 * MÁS ALLÁ DE 1.000 SKU. Y no da error al quedarse corto: devuelve mil líneas y
 * calla. Con ShoesF y sus ~13.700 referencias eso es leer el 7 % del catálogo
 * creyendo que se ha leído entero. Este informe es la única operación capaz de
 * enumerarlo, y además trae los listings suprimidos e inactivos.
 *
 *
 * CÓMO SE REANUDA, QUE ES LA PARTE QUE HAY QUE ENTENDER
 * ----------------------------------------------------
 * Un informe no es una llamada, es una máquina de estados con una espera de
 * entre uno y veinte minutos en medio. El trabajo la recorre en FASES, y la fase
 * en la que va se guarda en la base después de cada lote:
 *
 *      pedir  ->  esperando  ->  volcando  ->  fin
 *
 *   · `cursor_clave` guarda la FASE, para poder mirarla en la pantalla. Va un
 *     paso por detrás (ver siguienteLote) y NO es lo que se usa para reanudar.
 *   · `cursor_externo` guarda el ESTADO COMPLETO en JSON: el reportId, el
 *     reportDocumentId y cuándo se pidió. Esos tres sí sobreviven a una pausa
 *     entre pasadas del cron.
 *   · LA URL DE DESCARGA NO SE GUARDA NUNCA. Caduca a los cinco minutos y una
 *     pausa entre pasadas es de cinco: al reanudar estaría muerta siempre. Se
 *     vuelve a pedir con el reportDocumentId, que no caduca.
 *
 * Si el contenedor se reinicia mientras Amazon genera el informe, la pasada
 * siguiente retoma en `esperando` con el mismo reportId y no vuelve a pedirlo:
 * pedirlo otra vez gastaría una ficha de un cupo que se repone UNA VEZ POR
 * MINUTO, y encima devolvería la misma foto, porque Amazon cachea este informe
 * entre una y seis horas.
 *
 *
 * Y UNA COSA QUE NO ES UN FALLO
 * -----------------------------
 * `CANCELLED` significa, casi siempre, «no hay datos que devolver»: es lo que
 * contesta Amazon para un cliente que no vende en ese país. Se cierra el trabajo
 * en verde con un aviso, no en rojo. Tratarlo como error generaría una alerta
 * falsa cada semana por cada país en el que un cliente no vende, y una alerta
 * que salta siempre deja de mirarse.
 */

import { AmazonApiError } from '@/lib/amazon/errors'
import { sleep } from '@/lib/amazon/throttle'
import {
  conexionDeTrabajo,
  marketplaceDeTrabajo,
  type ConexionResuelta,
} from '../amazon/conexion'
import {
  INFORME_LISTINGS,
  consultarInforme,
  descargarInforme,
  esEstadoFinal,
  pedirInforme,
  type EstadoInforme,
} from '../amazon/informes'
import { InformeIlegible, leerInformeListings } from '../amazon/informe-listings'
import { volcarCenso } from '../catalogo'
import type { UnidadDeTrabajo } from '../datos'
import type { ContextoTarea, Lote, ResultadoLote, Tarea } from '../motor'

/* ------------------------------------------------------------------ */
/* El estado de la máquina                                             */
/* ------------------------------------------------------------------ */

type Fase = 'pedir' | 'esperando' | 'volcando' | 'fin'

interface EstadoCenso {
  fase: Fase
  reportId: string | null
  documentId: string | null
  /** Cuándo se pidió. Es el reloj contra el que se decide rendirse */
  pedidoAt: string | null
  /** Cuántas veces se ha preguntado si estaba */
  consultas: number
  /** Cómo acabó, para poder redactar el resumen */
  desenlace: 'ok' | 'sin_datos' | null
  filas: number
}

const NUEVO: EstadoCenso = {
  fase: 'pedir',
  reportId: null,
  documentId: null,
  pedidoAt: null,
  consultas: 0,
  desenlace: null,
  filas: 0,
}

/**
 * Cuánto se espera como mucho a que Amazon genere el informe, EN TOTAL y a
 * través de todas las pasadas.
 *
 * Amazon no publica ningún plazo: dice que depende del tamaño, de la carga y de
 * la cola. Lo observado va de uno a veinte minutos. Tres cuartos de hora deja
 * margen de sobra para una hora punta y, pasado eso, insistir cada cinco minutos
 * para siempre solo consigue que un trabajo atascado parezca uno lento.
 */
const ESPERA_MAXIMA_MS = 45 * 60 * 1000

/** Lo que se espera entre dos consultas, creciendo */
const ESPERA_MIN_MS = 8_000
const ESPERA_MAX_MS = 60_000

/**
 * El estado del trabajo, en memoria durante la pasada.
 *
 * Hace falta porque el motor NO RELEE la fila entre lotes: `ctx.job` es la foto
 * del arranque de la pasada, así que el reportId que se acaba de conseguir en el
 * lote anterior no estaría en ella. Se siembra desde `cursor_externo` la primera
 * vez y se persiste en cada lote, de forma que una pasada nueva —o un contenedor
 * nuevo— lo recupera de la base.
 */
const enMemoria = new Map<string, EstadoCenso>()

function estadoDe(ctx: ContextoTarea): EstadoCenso {
  const vivo = enMemoria.get(ctx.job.id)
  if (vivo) return vivo

  // Un trabajo que muere en error deja su entrada aquí, así que el mapa crece
  // despacio pero crece. Vaciarlo entero de vez en cuando es inofensivo: el
  // estado de verdad está en la base y se vuelve a leer de `cursor_externo`.
  if (enMemoria.size > 500) enMemoria.clear()

  const guardado = leerEstado(ctx.job.cursor_externo)
  enMemoria.set(ctx.job.id, guardado)
  return guardado
}

function leerEstado(crudo: string | null): EstadoCenso {
  if (!crudo) return { ...NUEVO }
  try {
    const parseado = JSON.parse(crudo) as Partial<EstadoCenso>
    return {
      fase: parseado.fase ?? 'pedir',
      reportId: parseado.reportId ?? null,
      documentId: parseado.documentId ?? null,
      pedidoAt: parseado.pedidoAt ?? null,
      consultas: parseado.consultas ?? 0,
      desenlace: parseado.desenlace ?? null,
      filas: parseado.filas ?? 0,
    }
  } catch {
    // Un cursor que no se entiende no puede parar el trabajo: se empieza otra
    // vez desde el principio, que como mucho cuesta un informe de más.
    return { ...NUEVO }
  }
}

function guardar(ctx: ContextoTarea, estado: EstadoCenso): string {
  enMemoria.set(ctx.job.id, estado)
  return JSON.stringify(estado)
}

/* ------------------------------------------------------------------ */
/* La tarea                                                            */
/* ------------------------------------------------------------------ */

export const tareaCensoCatalogo: Tarea = {
  tipo: 'censo_catalogo',
  etiqueta: 'Censo del catálogo',
  /** Da igual: los lotes de esta tarea son fases, no elementos */
  tamanoLote: 1,

  // Sin `preparar`: hasta que no se lee el fichero no se sabe cuántos SKU hay, y
  // una barra de progreso a cero durante veinte minutos miente más que no tener
  // barra. El total se rellena al volcar.

  /**
   * La fase que toca.
   *
   * `cursorSiguiente` es la fase EN LA QUE ENTRA este lote, no en la que sale:
   * la de salida no se sabe hasta haberlo procesado, y el contrato del motor
   * pide el cursor antes. O sea que `cursor_clave` en la base va un paso por
   * detrás y sirve para mirar, no para reanudar. LO QUE MANDA AL REANUDAR ES
   * `cursor_externo`, que lleva el estado entero y lo escribe procesarLote.
   */
  async siguienteLote(ctx): Promise<Lote> {
    const estado = estadoDe(ctx)
    if (estado.fase === 'fin') {
      return { claves: [], cursorSiguiente: 'fin', hayMas: false }
    }
    return { claves: [estado.fase], cursorSiguiente: estado.fase, hayMas: true }
  },

  async procesarLote(ctx): Promise<ResultadoLote> {
    const estado = estadoDe(ctx)
    const conexion = await conexionDeTrabajo(ctx.job.connection_id)
    const marketplaceId = marketplaceDeTrabajo(conexion, ctx.job.marketplace_id)
    const unidad: UnidadDeTrabajo = {
      connectionId: ctx.job.connection_id as string,
      sellingPartnerId: conexion.sellingPartnerId,
      marketplaceId,
    }

    switch (estado.fase) {
      case 'pedir':
        return fasePedir(ctx, estado, conexion, marketplaceId)
      case 'esperando':
        return faseEsperar(ctx, estado, conexion)
      case 'volcando':
        return faseVolcar(ctx, estado, conexion, unidad)
      default:
        return { procesados: 0, cursorExterno: guardar(ctx, estado) }
    }
  },

  resumir(ctx, cuentas): string {
    const estado = estadoDe(ctx)
    enMemoria.delete(ctx.job.id)
    if (estado.desenlace === 'sin_datos') {
      return (
        'Amazon ha cancelado el informe, que es como dice que no hay nada que devolver: esta ' +
        'cuenta no tiene listings en este país. No es un fallo.'
      )
    }
    return `${cuentas.procesados} referencias leídas del informe y volcadas en el catálogo.`
  },
}

/* ------------------------------------------------------------------ */
/* Fase 1: pedirlo                                                     */
/* ------------------------------------------------------------------ */

async function fasePedir(
  ctx: ContextoTarea,
  estado: EstadoCenso,
  conexion: ConexionResuelta,
  marketplaceId: string
): Promise<ResultadoLote> {
  const opciones = ((ctx.job.parametros ?? {}).reportOptions ?? null) as Record<
    string,
    string
  > | null

  const { reportId, requestId } = await pedirInforme(conexion.credenciales, {
    tipo: INFORME_LISTINGS,
    marketplaceId,
    reportOptions: opciones,
  })

  estado.fase = 'esperando'
  estado.reportId = reportId
  estado.pedidoAt = ctx.ahora.toISOString()
  estado.consultas = 0

  await ctx.evento({
    tipo: 'informe_pedido',
    severidad: 'info',
    mensaje:
      `Pedido el censo del catálogo de «${conexion.nombre}» en ${marketplaceId}. Amazon suele ` +
      'tardar entre uno y veinte minutos en generarlo; el trabajo se queda esperando y sigue solo.',
    detalle: { reportId, tipo: INFORME_LISTINGS },
    requestId,
  })

  return { procesados: 0, cursorExterno: guardar(ctx, estado) }
}

/* ------------------------------------------------------------------ */
/* Fase 2: esperar a que esté                                          */
/* ------------------------------------------------------------------ */

/**
 * Pregunta si el informe está, esperando cada vez un poco más.
 *
 * LA ESPERA CONSUME EL RESTO DE LA PASADA A PROPÓSITO, Y ESO HAY QUE ENTENDERLO
 * ANTES DE TOCAR ESTE BUCLE.
 *
 * El motor solo tiene una forma de dejar un trabajo a medias sin darlo por
 * terminado y sin contarlo como error: que se acabe el presupuesto de la pasada.
 * Así que cuando el informe no está, este bucle espera hasta que el presupuesto
 * se agota y devuelve el control; el motor lo ve, guarda el progreso y cierra la
 * pasada dejando el trabajo 'en_curso' con su fase intacta. Cinco minutos
 * después, la pasada siguiente retoma preguntando por EL MISMO informe: no se
 * pide otro, que gastaría una ficha de un cupo de una llamada por minuto y
 * encima devolvería la misma foto, porque Amazon lo cachea entre una y seis
 * horas.
 *
 * Lo que NO se puede hacer —y es lo que había antes— es devolver el control con
 * presupuesto de sobra: el motor vuelve a llamar inmediatamente a esta misma
 * fase, y el resultado es un bucle que pregunta a Amazon sin parar hasta agotar
 * la pasada. Un trabajo esperando tiene que esperar de verdad.
 *
 * El precio es que un censo esperando se queda con el final de la pasada. Se
 * paga con gusto por dos razones: los censos son lo último de la cola (prioridad
 * 80 y 90, frente a 40-60 del refresco diario), así que lo que se come es el
 * tiempo sobrante; y corren de madrugada, cuando no hay nadie esperando nada.
 */
async function faseEsperar(
  ctx: ContextoTarea,
  estado: EstadoCenso,
  conexion: ConexionResuelta
): Promise<ResultadoLote> {
  if (!estado.reportId) {
    estado.fase = 'pedir'
    return { procesados: 0, cursorExterno: guardar(ctx, estado) }
  }

  for (;;) {
    // ---------- ¿Llevamos demasiado? ----------
    const pedidoAt = estado.pedidoAt ? Date.parse(estado.pedidoAt) : NaN
    if (Number.isFinite(pedidoAt) && ctx.ahora.getTime() - pedidoAt > ESPERA_MAXIMA_MS) {
      /**
       * SE TIRA ESTE INFORME Y SE PIDE OTRO, y el orden importa.
       *
       * El estado se rebobina a 'pedir' y se GUARDA antes de avisar. Si se
       * lanzara la excepción con el estado intacto —que es lo que hacía antes—,
       * el `throw` no persiste nada: el cursor se quedaría con este mismo
       * reportId y este mismo pedidoAt, así que la pasada siguiente entraría por
       * aquí y volvería a saltar en el primer lote. El trabajo no se detiene y
       * relanzarlo tampoco sirve: se queda dando vueltas al mismo informe muerto
       * hasta que alguien vacíe `cursor_externo` a mano en la base.
       *
       * Rebobinando, la pasada siguiente pide un informe nuevo, que es lo que el
       * mensaje decía que pasaba y ahora pasa de verdad.
       */
      const viejo = estado.reportId
      estado.fase = 'pedir'
      estado.reportId = null
      estado.documentId = null
      estado.pedidoAt = null

      await ctx.evento({
        tipo: 'job_lote_fallido',
        severidad: 'error',
        mensaje:
          `Amazon lleva más de ${Math.round(ESPERA_MAXIMA_MS / 60000)} minutos sin entregar el censo ` +
          `del catálogo de «${conexion.nombre}» (informe ${viejo}). Se descarta ese informe y se pide ` +
          'otro en la pasada siguiente.',
        detalle: { reportId: viejo },
      })

      return { procesados: 0, cursorExterno: guardar(ctx, estado) }
    }

    const consulta = await consultarInforme(conexion.credenciales, estado.reportId)
    estado.consultas += 1

    if (esEstadoFinal(consulta.estado)) {
      return await cerrarEspera(ctx, estado, conexion, consulta.estado, consulta.documentId, consulta.requestId)
    }

    // ---------- ¿Queda pasada para seguir esperando? ----------
    const restante = ctx.tiempoRestanteMs()
    if (restante <= 0) {
      return { procesados: 0, cursorExterno: guardar(ctx, estado) }
    }

    // Espera creciente: 8s, 16s, 32s, y a partir de ahí un minuto. Preguntar
    // cada segundo no acelera nada y gasta cupo de una operación que comparten
    // todos los informes de ese cliente. Nunca más allá de lo que le queda a la
    // pasada, para no retrasar la escritura del progreso.
    const espera = Math.min(ESPERA_MAX_MS, ESPERA_MIN_MS * 2 ** Math.max(0, estado.consultas - 1))
    await sleep(Math.min(espera, restante))
  }
}

async function cerrarEspera(
  ctx: ContextoTarea,
  estado: EstadoCenso,
  conexion: ConexionResuelta,
  final: EstadoInforme,
  documentId: string | null,
  requestId: string | null
): Promise<ResultadoLote> {
  if (final === 'DONE') {
    if (!documentId) {
      throw new AmazonApiError({
        kind: 'servidor',
        message: `informe ${estado.reportId} DONE sin documento`,
        humanMessage:
          'Amazon dice que el censo del catálogo está listo pero no ha devuelto el fichero. Se reintenta en la pasada siguiente.',
        requestId,
        retryable: true,
      })
    }
    estado.fase = 'volcando'
    estado.documentId = documentId
    return { procesados: 0, cursorExterno: guardar(ctx, estado) }
  }

  if (final === 'CANCELLED') {
    // NO ES UN FALLO. Ver la cabecera del fichero.
    estado.fase = 'fin'
    estado.desenlace = 'sin_datos'
    await ctx.evento({
      tipo: 'informe_sin_datos',
      severidad: 'aviso',
      mensaje:
        `Amazon ha cancelado el censo del catálogo de «${conexion.nombre}», que es como dice que no ` +
        'hay nada que devolver: esta cuenta no tiene listings en este país. Si eso te sorprende, ' +
        'revisa que el marketplace sea el correcto; si no, es normal y no hay nada que hacer.',
      detalle: { reportId: estado.reportId },
      requestId,
    })
    return { procesados: 0, cursorExterno: guardar(ctx, estado) }
  }

  // FATAL. Puede traer un documento que EXPLICA por qué murió: es la única
  // pista, así que se intenta leer antes de rendirse.
  let explicacion = ''
  if (documentId) {
    try {
      const doc = await descargarInforme(conexion.credenciales, documentId)
      explicacion = ` Amazon dice: ${doc.texto.slice(0, 500).replace(/\s+/g, ' ').trim()}`
    } catch {
      // Que no se pueda leer la explicación no puede tapar el fallo original.
      explicacion = ''
    }
  }

  throw new AmazonApiError({
    kind: 'servidor',
    message: `informe ${estado.reportId} FATAL`,
    humanMessage:
      `Amazon ha terminado el censo del catálogo de «${conexion.nombre}» con un error grave y no hay ` +
      `fichero que leer.${explicacion}`,
    requestId,
  })
}

/* ------------------------------------------------------------------ */
/* Fase 3: descargar y volcar                                          */
/* ------------------------------------------------------------------ */

async function faseVolcar(
  ctx: ContextoTarea,
  estado: EstadoCenso,
  conexion: ConexionResuelta,
  unidad: UnidadDeTrabajo
): Promise<ResultadoLote> {
  if (!estado.documentId) {
    estado.fase = 'esperando'
    return { procesados: 0, cursorExterno: guardar(ctx, estado) }
  }

  // Pedir la URL y descargar VAN JUNTOS: la URL caduca en cinco minutos.
  const documento = await descargarInforme(conexion.credenciales, estado.documentId)

  const alias = ((ctx.job.parametros ?? {}).cabeceras ?? null) as Record<string, string> | null

  let lectura
  try {
    lectura = leerInformeListings(documento.texto, { alias })
  } catch (error) {
    if (error instanceof InformeIlegible) {
      await ctx.evento({
        tipo: 'informe_ilegible',
        severidad: 'critico',
        mensaje: error.message,
        detalle: { cabeceras: error.cabeceras.slice(0, 40) },
      })
    }
    throw error
  }

  // ---------- Lo que hay que contar en voz alta ----------
  if (lectura.via === 'posicion') {
    await ctx.evento({
      tipo: 'informe_leido_por_posicion',
      severidad: 'info',
      mensaje:
        'La cabecera del informe venía en un idioma que no reconocemos, así que se ha leído por ' +
        'la posición de las columnas, que es el orden que Amazon garantiza. El resultado es el ' +
        'mismo; si quieres que se lea por nombre, añade los sinónimos en informe-listings.ts o ' +
        'pásalos en los parámetros del trabajo.',
      detalle: { cabeceras: lectura.cabeceras.slice(0, 40) },
    })
  }

  if (lectura.ausentes.length > 0) {
    await ctx.evento({
      tipo: 'informe_columnas_ausentes',
      severidad: 'aviso',
      mensaje:
        `El informe no trae ${lectura.ausentes.length} de las columnas que usamos ` +
        `(${lectura.ausentes.join(', ')}). Esos datos se quedan como estaban en el catálogo, no ` +
        'se ponen a cero.',
      detalle: { ausentes: lectura.ausentes },
    })
  }

  if (lectura.descartadas > 0) {
    await ctx.evento({
      tipo: 'informe_lineas_descartadas',
      // Unas pocas líneas sueltas pasan; muchas significan que el mapa de
      // columnas está mal y que lo que se ha volcado no vale.
      severidad: lectura.descartadas > lectura.filas.length / 10 ? 'error' : 'aviso',
      mensaje:
        `${lectura.descartadas} líneas del informe no traían SKU y se han descartado, frente a ` +
        `${lectura.filas.length} que sí. Si son muchas, la lectura de columnas no está bien.`,
      detalle: { descartadas: lectura.descartadas, leidas: lectura.filas.length },
    })
  }

  const estadosRaros = Object.keys(lectura.estadosDesconocidos)
  if (estadosRaros.length > 0) {
    await ctx.evento({
      tipo: 'informe_estado_desconocido',
      severidad: 'aviso',
      mensaje:
        `El informe trae estados de listing que no sabemos traducir (${estadosRaros.slice(0, 5).join(', ')}). ` +
        'Esas filas conservan el estado que ya tenían en vez de marcarse como no disponibles: ' +
        'poner un estado equivocado sacaría esos SKU del seguimiento diario sin motivo.',
      detalle: lectura.estadosDesconocidos,
    })
  }

  if (lectura.filas.length === 0) {
    await ctx.evento({
      tipo: 'informe_vacio',
      severidad: 'error',
      mensaje:
        `El censo del catálogo de «${conexion.nombre}» ha llegado sin ninguna referencia. Amazon ha ` +
        'dado el informe por bueno, así que o la cuenta no tiene listings en este país o la lectura ' +
        'del fichero no está encontrando las filas.',
    })
    estado.fase = 'fin'
    estado.desenlace = 'ok'
    return { procesados: 0, cursorExterno: guardar(ctx, estado) }
  }

  // ---------- El volcado ----------
  const resultado = await volcarCenso(unidad, lectura.filas, ctx.ahora)

  if (resultado.desaparecidos > 0) {
    await ctx.evento({
      tipo: 'censo_desaparecidos',
      severidad: 'aviso',
      mensaje:
        `${resultado.desaparecidos} referencias que hay en nuestro catálogo NO vienen en el censo de ` +
        'Amazon. No se borran aquí: el censo solo añade y actualiza. Míralas antes de darlas por ' +
        'muertas, porque un listing borrado se lleva por delante el enlace de su histórico.',
      detalle: { desaparecidos: resultado.desaparecidos, nuevos: resultado.nuevos },
    })
  }

  console.log(
    `[plataforma] censo ${unidad.marketplaceId}: ${resultado.escritas} referencias ` +
      `(${resultado.nuevos} nuevas, ${resultado.desaparecidos} ya no vienen) en ` +
      `${resultado.consultas} escrituras · ${Math.round(documento.bytes / 1024)} KB` +
      `${documento.comprimido ? ' comprimidos' : ''}`
  )

  estado.fase = 'fin'
  estado.desenlace = 'ok'
  estado.filas = lectura.filas.length

  return {
    procesados: lectura.filas.length,
    omitidos: lectura.descartadas,
    cursorExterno: guardar(ctx, estado),
  }
}
