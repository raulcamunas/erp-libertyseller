/**
 * EL MOTOR DE TRABAJOS
 * ====================
 * SOLO SERVIDOR.
 *
 * Este fichero no sabe leer un catálogo, ni hablar con Amazon, ni escribir un
 * snapshot. Solo decide a qué trabajo le toca, se lo queda, le pide lotes a su
 * tarea hasta que se acaba el tiempo, GUARDA POR DÓNDE IBA y lo suelta. Todo lo
 * demás vive en las tareas (lib/plataforma/tareas/**).
 *
 * Es la misma separación que hay entre lib/stock-sync/ciclo.ts y el resto de
 * aquel módulo, y por la misma razón: mezclarlos obliga a levantar media
 * aplicación para comprobar que un cursor avanza.
 *
 *
 * LAS CINCO REGLAS QUE HACEN QUE ESTO SE PUEDA DEJAR SOLO
 * ------------------------------------------------------
 *
 * 1. PROGRESO GUARDADO DESPUÉS DE CADA LOTE. No al final, no cada N lotes:
 *    después de cada uno. Si el contenedor muere al 80 % de 13.700 SKU, lo que
 *    se pierde es el último lote, no el trabajo.
 *
 * 2. PRESUPUESTO DE TIEMPO POR PASADA. Cuando se acaba NO se corta el lote que
 *    está en marcha: no se empieza otro. Un lote a medias contaría a medias. Con
 *    una excepción, y es importante: el PRIMER lote de cada trabajo se hace
 *    siempre, aunque el presupuesto ya esté agotado. Ver `esElPrimero`.
 *
 * 3. UN TRABAJO SOLO LO PROCESA UNO. El cerrojo está en la base (ver jobs.ts) y
 *    se comprueba EN CADA ESCRITURA de progreso: si nos lo han robado por
 *    caducidad, esta pasada abandona sin tocar nada más.
 *
 * 4. LA CANCELACIÓN SE MIRA EN CADA LOTE, en la misma consulta que guarda el
 *    progreso. Cancelar no interrumpe un lote a la mitad; lo que hace es que no
 *    empiece el siguiente.
 *
 * 5. NADA FALLA EN SILENCIO. Un tipo de trabajo sin tarea registrada, un lote
 *    que revienta, un trabajo que se rinde: los tres dejan un evento con
 *    severidad y una frase en español, y los que hay que atender suenan en la
 *    campana. Un trabajo que deja de avanzar sin decir nada es el fallo más caro
 *    de esta parte, porque los datos del cliente se quedan viejos y todo parece
 *    correcto.
 */

import { registrarEvento, type EventoNuevo } from './eventos'
import {
  CERROJO_CADUCA_MS,
  guardarProgreso,
  isMissingSchema,
  jobsDeLaCola,
  nuevoTokenCerrojo,
  soltarJob,
  terminarJob,
  tomarJob,
} from './jobs'
import { AMAZON_JOB_TIPO_LABELS, type AmazonJob, type AmazonJobTipo } from './tipos'

/**
 * Cuánto puede durar UNA pasada del motor.
 *
 * El cron entra cada cinco minutos, así que una pasada que se acerque a eso
 * empalma con la siguiente. Cuatro minutos dejan margen: cuando se acaba el
 * presupuesto no se corta ningún lote, simplemente no se empieza otro, y el
 * trabajo se queda 'en_curso' con su cursor puesto.
 */
export const PRESUPUESTO_MS = 4 * 60 * 1000

/**
 * Cuántos lotes seguidos pueden reventar antes de rendirse con el trabajo.
 *
 * No es cero porque un 429 o un 500 de Amazon son normales y se reintentan
 * solos en la pasada siguiente. No es infinito porque un trabajo mal configurado
 * —un marketplace en el que el cliente no vende, un informe que Amazon nunca va
 * a dar— reintentaría cada cinco minutos para siempre, quemando cupo de todos
 * los clientes y sin que nadie se entere.
 */
export const MAX_ERRORES_JOB = 10

/* ------------------------------------------------------------------ */
/* El contrato de una tarea                                            */
/* ------------------------------------------------------------------ */

/** Lo que una tarea puede contar sin repetir a qué cliente y trabajo pertenece */
export type EventoDeTarea = Omit<EventoNuevo, 'clientId' | 'connectionId' | 'marketplaceId' | 'jobId'>

export interface ContextoTarea {
  job: AmazonJob
  /** El instante en que arrancó la pasada. SIEMPRE por parámetro, para que todo
      lo que dependa de la fecha se pueda comprobar */
  ahora: Date
  /** Milisegundos que le quedan a la pasada. <= 0 significa «no empieces otro» */
  tiempoRestanteMs(): number
  /** Deja constancia. Ya lleva puestos el cliente, la conexión y el trabajo */
  evento(evento: EventoDeTarea): Promise<void>
  /**
   * Bloc de notas de ESTA pasada. Para que una tarea no repita el mismo aviso
   * en cada lote.
   *
   * Un trabajo de 13.700 referencias son 685 lotes: si algo le pasa a todos,
   * un evento por lote son 685 incidencias idénticas, y 685 incidencias
   * idénticas no informan de nada — tapan las que sí. Es la misma razón por la
   * que existe la huella en eventos.ts, pero una pasada por debajo: la huella
   * calla la campana, esto evita escribir la fila.
   *
   * Se crea vacío en cada pasada y no se guarda en ningún sitio: sirve para
   * agrupar, no para recordar.
   */
  memoria: Map<string, unknown>
}

export interface Lote {
  /**
   * Las claves de este lote (normalmente SKU). Vacío + hayMas=false significa
   * «se acabó»; vacío + hayMas=true significa «este tramo no tenía nada, sigue
   * por el cursor siguiente».
   */
  claves: string[]
  /** Por dónde seguir. Es lo que se guarda en la base tras procesar el lote */
  cursorSiguiente: string | null
  hayMas: boolean
}

export interface ResultadoLote {
  /** Elementos tratados de verdad */
  procesados: number
  /**
   * Los que no se pudieron tratar pero NO rompen el lote: un ASIN que Amazon ya
   * no tiene, un SKU sin tipo de producto. Aquí es donde van los problemas por
   * elemento; `errores` está reservado para fallos del lote entero, porque es el
   * contador que acaba rindiendo al trabajo.
   */
  omitidos?: number
  errores?: number
  /** Cursores opacos, si la tarea los usa */
  cursorExterno?: string | null
  cursorPagina?: number | null
}

export interface CuentasJob {
  procesados: number
  omitidos: number
  errores: number
  /**
   * Lotes fallidos SEGUIDOS. Se pone a cero en cuanto uno sale bien, y es esto
   * —no `errores`— lo que decide si el trabajo se rinde. Ver MAX_ERRORES_JOB.
   */
  lotesFallidosSeguidos: number
  lotes: number
}

/**
 * Una tarea: lo que hace un tipo de trabajo.
 *
 * El registro es ENCHUFABLE a propósito. A1 solo trae la de recalcular el
 * conjunto activo; A2 traerá la de precios y Buy Box, A4 la de tarifas, y ninguno
 * tendrá que tocar este fichero ni la migración: los tipos ya están declarados en
 * el CHECK de amazon_jobs.
 */
export interface Tarea {
  tipo: AmazonJobTipo
  etiqueta: string
  /** Cuántas claves por lote. Casi siempre 20, que es el número que admiten
      todas las operaciones por lotes de la Selling Partner API */
  tamanoLote: number
  /**
   * Se llama UNA VEZ, la primera pasada, para saber cuánto hay que hacer. Sin
   * esto no hay barra de progreso, y sin barra de progreso nadie sabe si un
   * trabajo de tres horas va bien o está atascado.
   */
  preparar?(ctx: ContextoTarea): Promise<{ totalEstimado: number | null }>
  /** El siguiente tramo a partir del cursor */
  siguienteLote(ctx: ContextoTarea, cursor: string | null, tamano: number): Promise<Lote>
  procesarLote(ctx: ContextoTarea, lote: Lote): Promise<ResultadoLote>
  /** La frase de cierre que se guarda en el trabajo */
  resumir?(ctx: ContextoTarea, cuentas: CuentasJob): string
}

const TAREAS = new Map<AmazonJobTipo, Tarea>()

export function registrarTarea(tarea: Tarea): void {
  TAREAS.set(tarea.tipo, tarea)
}

export function tareaDe(tipo: AmazonJobTipo): Tarea | null {
  return TAREAS.get(tipo) ?? null
}

export function tareasRegistradas(): AmazonJobTipo[] {
  return [...TAREAS.keys()]
}

/* ------------------------------------------------------------------ */
/* Resultado                                                           */
/* ------------------------------------------------------------------ */

export type DesenlacePasada =
  /** Llegó al final */
  | 'terminado'
  /** Se acabó el presupuesto; sigue en la pasada siguiente */
  | 'sin_tiempo'
  /** Alguien pidió cancelarlo y se ha parado ordenadamente */
  | 'cancelado'
  /** Se ha rendido: demasiados lotes seguidos reventando */
  | 'error'
  /** Otra pasada lo tiene cogido */
  | 'ocupado'
  /** Su tipo no tiene tarea registrada */
  | 'sin_tarea'
  /** Nos robaron el cerrojo por caducidad a mitad de pasada */
  | 'cerrojo_perdido'
  /** Un lote reventó; se reintenta en la pasada siguiente */
  | 'reintentable'

export interface ResultadoJobPasada {
  jobId: string
  tipo: AmazonJobTipo
  clientId: string
  desenlace: DesenlacePasada
  /** Una frase que explica el desenlace sin tener que abrir nada */
  detalle: string
  /** Procesados EN ESTA PASADA, no en total */
  procesados: number
  lotes: number
  duracionMs: number
}

export interface ResultadoMotor {
  /** Trabajos que se han mirado */
  mirados: number
  /** De esos, los que se han llegado a procesar */
  procesados: number
  terminados: number
  errores: number
  duracionMs: number
  jobs: ResultadoJobPasada[]
  /** Por qué no se ha ejecutado nada, si es que no se ha ejecutado nada */
  omitido: string | null
}

/**
 * EL CANDADO DEL PROCESO, que es el primero de los dos.
 *
 * Solo protege de sí mismo —dos peticiones que caen en el mismo Node— y por eso
 * NO basta: el de verdad es el de la base de datos, que funciona también con dos
 * contenedores. Este está porque es gratis y ataja el caso más frecuente con
 * diferencia: que alguien dispare el cron a mano mientras la pasada de turno
 * sigue corriendo.
 */
let enMarcha = false

/* ------------------------------------------------------------------ */
/* La pasada                                                           */
/* ------------------------------------------------------------------ */

export interface OpcionesMotor {
  ahora?: Date
  presupuestoMs?: number
  /** Cuántos trabajos como mucho en esta pasada */
  maxJobs?: number
  /** Solo este trabajo. Para lanzar uno a mano desde la pantalla */
  soloJobId?: string
}

export async function ejecutarJobs(opciones: OpcionesMotor = {}): Promise<ResultadoMotor> {
  const arranque = Date.now()
  const presupuestoMs = opciones.presupuestoMs ?? PRESUPUESTO_MS
  const ahora = opciones.ahora ?? new Date()

  if (enMarcha) {
    return sinHacerNada(
      'Ya había una pasada del motor en marcha en este proceso, así que esta no arranca.',
      arranque
    )
  }
  enMarcha = true

  try {
    let cola: AmazonJob[]
    try {
      cola = await jobsDeLaCola(opciones.maxJobs ?? 50)
    } catch (error) {
      // La migración se lanza a mano en el editor SQL de Supabase, así que el
      // código puede llegar desplegado antes que ella. Que el cron deje un error
      // cada cinco minutos hasta que alguien la pegue no ayuda a nadie.
      if (isMissingSchema(error)) {
        return sinHacerNada(
          'Faltan las tablas de la plataforma: lanza 123_plataforma_a1.sql en el editor SQL de Supabase.',
          arranque
        )
      }
      throw error
    }

    if (opciones.soloJobId) {
      cola = cola.filter((j) => j.id === opciones.soloJobId)
    }

    const salida: ResultadoJobPasada[] = []

    for (const job of cola) {
      if (Date.now() - arranque > presupuestoMs) {
        salida.push(
          nota(
            job,
            'sin_tiempo',
            'No ha dado tiempo en esta pasada. Va el primero en la siguiente.'
          )
        )
        continue
      }

      try {
        salida.push(await procesarJob(job, ahora, arranque, presupuestoMs))
      } catch (error) {
        // Un trabajo que revienta de una forma no prevista no puede llevarse por
        // delante a los demás clientes de la tanda.
        const mensaje = error instanceof Error ? error.message : 'Error desconocido'
        console.error(`[plataforma] el trabajo ${job.id} ha fallado de forma inesperada:`, error)
        await registrarEvento({
          tipo: 'job_fallo_inesperado',
          severidad: 'error',
          clientId: job.client_id,
          connectionId: job.connection_id,
          marketplaceId: job.marketplace_id,
          jobId: job.id,
          mensaje: `El trabajo «${AMAZON_JOB_TIPO_LABELS[job.tipo]}» ha fallado de una forma que no estaba prevista: ${mensaje}`,
        })
        salida.push(nota(job, 'error', mensaje))
      }
    }

    return resumir(salida, arranque)
  } finally {
    enMarcha = false
  }
}

async function procesarJob(
  job: AmazonJob,
  ahora: Date,
  arranquePasada: number,
  presupuestoMs: number
): Promise<ResultadoJobPasada> {
  const arranque = Date.now()

  const token = nuevoTokenCerrojo()
  const tomado = await tomarJob(
    job,
    token,
    ahora,
    new Date(ahora.getTime() - CERROJO_CADUCA_MS)
  )
  if (!tomado) {
    return nota(
      job,
      'ocupado',
      'Otra pasada lo tiene cogido. Esta lo deja en paz: procesarlo dos veces a la vez duplicaría el trabajo y el gasto de cupo.',
      arranque
    )
  }

  try {
    return await conCerrojo(job, token, ahora, arranquePasada, presupuestoMs, arranque)
  } finally {
    // En el `finally` y no al final del `try`: un fallo a mitad de proceso tiene
    // que soltar el cerrojo igual, o ese trabajo se queda esperando media hora a
    // que caduque sin ninguna razón. soltarJob solo suelta si sigue siendo
    // nuestro, así que llamarlo tras un cerrojo perdido no hace nada.
    await soltarJob(job.id, token)
  }
}

async function conCerrojo(
  job: AmazonJob,
  token: string,
  ahora: Date,
  arranquePasada: number,
  presupuestoMs: number,
  arranqueJob: number
): Promise<ResultadoJobPasada> {
  const tarea = tareaDe(job.tipo)

  const ctx: ContextoTarea = {
    job,
    ahora,
    tiempoRestanteMs: () => presupuestoMs - (Date.now() - arranquePasada),
    memoria: new Map(),
    evento: async (evento) => {
      await registrarEvento({
        ...evento,
        clientId: job.client_id,
        connectionId: job.connection_id,
        marketplaceId: job.marketplace_id,
        jobId: job.id,
      })
    },
  }

  // ---------- ¿Sabemos hacer esto? ----------
  if (!tarea) {
    const mensaje =
      `El trabajo «${AMAZON_JOB_TIPO_LABELS[job.tipo]}» está en la cola pero su tipo no tiene ` +
      'ninguna tarea registrada en el motor. Nadie lo va a procesar nunca: se cierra con error ' +
      'para que no se quede dando vueltas y para que esto se vea.'
    await ctx.evento({ tipo: 'tarea_no_registrada', severidad: 'error', mensaje })
    await terminarJob(job.id, token, { estado: 'error', errorMessage: mensaje })
    return nota(job, 'sin_tarea', mensaje, arranqueJob)
  }

  const cuentas: CuentasJob = {
    procesados: job.procesados,
    omitidos: job.omitidos,
    errores: job.errores,
    lotesFallidosSeguidos: job.lotes_fallidos_seguidos ?? 0,
    lotes: job.lotes,
  }
  const procesadosAlEmpezar = job.procesados
  const lotesAlEmpezar = job.lotes

  let cursor = job.cursor_clave
  let totalEstimado = job.total_estimado

  // ---------- ¿Cuánto hay que hacer? ----------
  // Solo la primera vez: en las pasadas siguientes ya está guardado, y volver a
  // contarlo costaría una consulta cara por cada retoma.
  if (tarea.preparar && totalEstimado === null) {
    try {
      const preparacion = await tarea.preparar(ctx)
      totalEstimado = preparacion.totalEstimado
    } catch (error) {
      return await fallo(job, token, ctx, cuentas, cursor, totalEstimado, error, arranqueJob, {
        procesadosAlEmpezar,
        lotesAlEmpezar,
      })
    }
  }

  // ---------- Los lotes ----------
  /**
   * SIEMPRE SE HACE AL MENOS UN LOTE.
   *
   * El presupuesto se mira a partir del SEGUNDO, y esto no es un detalle: si se
   * mirara también antes del primero, una pasada que llega con el tiempo justo
   * —porque los trabajos anteriores de la cola se lo comieron— cogería el
   * cerrojo, no haría nada, lo soltaría y se iría. Y la pasada siguiente haría
   * exactamente lo mismo. El trabajo se quedaría girando para siempre sin
   * avanzar un solo elemento Y SIN DAR NINGÚN ERROR, que es el peor fallo que
   * puede tener esta parte: parece que está trabajando.
   *
   * Pagado el precio de tomar el cerrojo, se avanza algo. Un lote de más nunca
   * cuesta más que el presupuesto de una pasada; el cerrojo caduca a la media
   * hora, así que hay margen de sobra.
   */
  let esElPrimero = true

  for (;;) {
    if (!esElPrimero && ctx.tiempoRestanteMs() <= 0) {
      await guardarProgreso(job.id, token, {
        ...cuentas,
        cursorClave: cursor,
        totalEstimado,
      })
      return nota(
        job,
        'sin_tiempo',
        `Se ha acabado el presupuesto de esta pasada con ${cuentas.procesados} procesados` +
          `${totalEstimado ? ` de ${totalEstimado}` : ''}. Sigue por donde iba en la pasada siguiente.`,
        arranqueJob,
        cuentas.procesados - procesadosAlEmpezar,
        cuentas.lotes - lotesAlEmpezar
      )
    }

    esElPrimero = false

    let lote: Lote
    let resultado: ResultadoLote
    try {
      lote = await tarea.siguienteLote(ctx, cursor, tarea.tamanoLote)

      if (lote.claves.length === 0) {
        if (!lote.hayMas) break
        // Tramo vacío: se avanza el cursor y se sigue. Pasa cuando el filtro de
        // la tarea deja fuera un tramo entero.
        cursor = lote.cursorSiguiente
        continue
      }

      resultado = await tarea.procesarLote(ctx, lote)
    } catch (error) {
      return await fallo(job, token, ctx, cuentas, cursor, totalEstimado, error, arranqueJob, {
        procesadosAlEmpezar,
        lotesAlEmpezar,
      })
    }

    cuentas.procesados += resultado.procesados
    cuentas.omitidos += resultado.omitidos ?? 0
    cuentas.errores += resultado.errores ?? 0
    cuentas.lotes += 1
    // El lote ha salido bien: la racha de fallos se acaba aquí. Sin esta línea
    // el contador sería acumulativo y un barrido que falla un lote de cada dos
    // se abandonaría a mitad de catálogo pese a ir avanzando.
    cuentas.lotesFallidosSeguidos = 0
    cursor = lote.cursorSiguiente

    // ---------- EL PROGRESO, DESPUÉS DE CADA LOTE ----------
    const progreso = await guardarProgreso(job.id, token, {
      ...cuentas,
      cursorClave: cursor,
      cursorExterno: resultado.cursorExterno,
      cursorPagina: resultado.cursorPagina,
      totalEstimado,
    })

    if (!progreso.ok) {
      // Nos han robado el cerrojo. Se abandona SIN escribir nada más: seguir
      // sería pisar el trabajo del que lo tiene ahora.
      const mensaje =
        'Otra pasada se ha quedado con este trabajo mientras estábamos procesándolo ' +
        '(el cerrojo había caducado). Esta pasada abandona sin tocar nada más.'
      await ctx.evento({ tipo: 'cerrojo_perdido', severidad: 'aviso', mensaje })
      return nota(
        job,
        'cerrojo_perdido',
        mensaje,
        arranqueJob,
        cuentas.procesados - procesadosAlEmpezar,
        cuentas.lotes - lotesAlEmpezar
      )
    }

    if (progreso.cancelado) {
      const mensaje = `Cancelado a petición, con ${cuentas.procesados} elementos ya procesados.`
      await terminarJob(job.id, token, { estado: 'cancelado', resumen: mensaje })
      return nota(
        job,
        'cancelado',
        mensaje,
        arranqueJob,
        cuentas.procesados - procesadosAlEmpezar,
        cuentas.lotes - lotesAlEmpezar
      )
    }

    if (!lote.hayMas) break
  }

  // ---------- Terminado ----------
  const resumen =
    tarea.resumir?.(ctx, cuentas) ??
    `${cuentas.procesados} elementos procesados en ${cuentas.lotes} lotes` +
      (cuentas.omitidos > 0 ? `, ${cuentas.omitidos} omitidos` : '') +
      '.'

  await guardarProgreso(job.id, token, { ...cuentas, cursorClave: cursor, totalEstimado })
  await terminarJob(job.id, token, { estado: 'terminado', resumen })

  // Un 'info' no suena en la campana (ver el trigger de la 123) pero deja el
  // rastro que contesta «¿esto se está ejecutando?» sin abrir la consola.
  await ctx.evento({
    tipo: 'job_terminado',
    severidad: cuentas.omitidos > 0 ? 'aviso' : 'info',
    mensaje: `«${tarea.etiqueta}» ha terminado: ${resumen}`,
  })

  return nota(
    job,
    'terminado',
    resumen,
    arranqueJob,
    cuentas.procesados - procesadosAlEmpezar,
    cuentas.lotes - lotesAlEmpezar
  )
}

/**
 * Un lote ha reventado.
 *
 * Se guarda el progreso —incluido el cursor, que no ha avanzado— y se decide si
 * se reintenta en la pasada siguiente o si se abandona el trabajo. Ver
 * MAX_ERRORES_JOB para el porqué del número.
 */
async function fallo(
  job: AmazonJob,
  token: string,
  ctx: ContextoTarea,
  cuentas: CuentasJob,
  cursor: string | null,
  totalEstimado: number | null,
  error: unknown,
  arranqueJob: number,
  inicio: { procesadosAlEmpezar: number; lotesAlEmpezar: number }
): Promise<ResultadoJobPasada> {
  const mensaje = error instanceof Error ? error.message : 'Error desconocido'
  cuentas.errores += 1
  cuentas.lotesFallidosSeguidos += 1

  await guardarProgreso(job.id, token, { ...cuentas, cursorClave: cursor, totalEstimado })

  const seRinde = cuentas.lotesFallidosSeguidos >= MAX_ERRORES_JOB
  const texto = seRinde
    ? `El trabajo «${AMAZON_JOB_TIPO_LABELS[job.tipo]}» se ha rendido tras ${cuentas.lotesFallidosSeguidos} ` +
      `intentos fallidos. Último error: ${mensaje}. Lo hecho hasta ahora (${cuentas.procesados} ` +
      'elementos) está guardado: al relanzarlo seguirá donde estaba, no empezará de cero.'
    : `Un lote de «${AMAZON_JOB_TIPO_LABELS[job.tipo]}» ha fallado: ${mensaje}. Se reintenta en ` +
      `la pasada siguiente desde donde estaba (${cuentas.procesados} elementos hechos).`

  await ctx.evento({
    tipo: seRinde ? 'job_abandonado' : 'job_lote_fallido',
    severidad: seRinde ? 'critico' : 'error',
    mensaje: texto,
    detalle: { errores: cuentas.errores, seguidos: cuentas.lotesFallidosSeguidos, cursor },
  })

  if (seRinde) {
    await terminarJob(job.id, token, { estado: 'error', errorMessage: texto })
    return nota(
      job,
      'error',
      texto,
      arranqueJob,
      cuentas.procesados - inicio.procesadosAlEmpezar,
      cuentas.lotes - inicio.lotesAlEmpezar
    )
  }

  return nota(
    job,
    'reintentable',
    texto,
    arranqueJob,
    cuentas.procesados - inicio.procesadosAlEmpezar,
    cuentas.lotes - inicio.lotesAlEmpezar
  )
}

/* ------------------------------------------------------------------ */
/* Salida                                                              */
/* ------------------------------------------------------------------ */

function nota(
  job: AmazonJob,
  desenlace: DesenlacePasada,
  detalle: string,
  arranque = Date.now(),
  procesados = 0,
  lotes = 0
): ResultadoJobPasada {
  return {
    jobId: job.id,
    tipo: job.tipo,
    clientId: job.client_id,
    desenlace,
    detalle,
    procesados,
    lotes,
    duracionMs: Date.now() - arranque,
  }
}

function sinHacerNada(motivo: string, arranque: number): ResultadoMotor {
  return {
    mirados: 0,
    procesados: 0,
    terminados: 0,
    errores: 0,
    duracionMs: Date.now() - arranque,
    jobs: [],
    omitido: motivo,
  }
}

function resumir(jobs: ResultadoJobPasada[], arranque: number): ResultadoMotor {
  const trabajados: DesenlacePasada[] = [
    'terminado',
    'sin_tiempo',
    'cancelado',
    'error',
    'reintentable',
    'cerrojo_perdido',
  ]
  return {
    mirados: jobs.length,
    procesados: jobs.filter((j) => trabajados.includes(j.desenlace)).length,
    terminados: jobs.filter((j) => j.desenlace === 'terminado').length,
    errores: jobs.filter((j) => j.desenlace === 'error' || j.desenlace === 'sin_tarea').length,
    duracionMs: Date.now() - arranque,
    jobs,
    omitido: null,
  }
}
