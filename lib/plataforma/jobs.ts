/**
 * TRABAJOS: LA COLA, EL CERROJO Y EL CURSOR
 * =========================================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 * Aquí vive todo lo que toca `amazon_jobs`. El motor (motor.ts) no sabe que
 * existe Postgres y las tareas tampoco: este fichero es el único que traduce
 * entre las filas de la base y las estructuras del dominio. Es la misma
 * separación que hay entre lib/stock-sync/perfiles.ts y lib/stock-sync/ciclo.ts.
 *
 *
 * LA IDEA CENTRAL, Y CONDICIONA TODO LO DEMÁS
 * -------------------------------------------
 *   UN TRABAJO LARGO NO ES UNA EJECUCIÓN LARGA.
 *   ES MUCHAS EJECUCIONES CORTAS CON EL PROGRESO EN LA BASE.
 *
 * No se puede meter un barrido de 13.700 SKU dentro de una ruta de Next: hay un
 * `maxDuration` de diez minutos, el cron entra cada pocos minutos y un trabajo
 * de tres horas tendría instancias solapadas. Y lanzarlo en segundo plano con un
 * setTimeout dentro del handler es peor: en un contenedor que se reinicia con
 * cada despliegue, el trabajo muere sin dejar rastro, que es exactamente el
 * fallo silencioso que la especificación prohíbe.
 *
 * Así que cada pasada del cron: coge el trabajo más prioritario que esté libre,
 * procesa lotes hasta agotar su presupuesto de tiempo, GUARDA POR DÓNDE IBA y se
 * va. La pasada siguiente lo recoge donde estaba.
 *
 *
 * EL CERROJO ES EL MISMO PATRÓN DE LA MIGRACIÓN 121, Y POR LA MISMA RAZÓN
 * ----------------------------------------------------------------------
 * Una bandera en Node solo protege de sí misma. El ERP corre en un contenedor
 * hoy y puede correr en dos mañana, y el cron entra por HTTP: nada garantiza que
 * dos peticiones caigan en el mismo proceso. El cerrojo tiene que estar donde
 * los dos miran, y eso es la base de datos.
 *
 * Se toma con UN ÚNICO UPDATE CONDICIONAL, y ahí está toda la garantía: un
 * UPDATE es atómico, y en READ COMMITTED el segundo que llega espera el bloqueo
 * de fila y RE-EVALÚA su WHERE contra la versión ya escrita: encuentra
 * `running_since` puesto y actualiza cero filas. Leer primero y escribir después
 * —el `if (!job.running_since) tomar()` que pide el cuerpo— es justo el error que
 * esto evita: entre la lectura y la escritura cabe la otra pasada entera.
 */

import { randomUUID } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from './eventos'
import {
  jobNecesitaConexion,
  type AmazonJob,
  type AmazonJobEstado,
  type AmazonJobTipo,
} from './tipos'

export { isMissingSchema }

/**
 * A partir de cuándo un cerrojo se considera abandonado y se puede robar.
 *
 * Media hora, igual que en el ciclo de stock. Sin caducidad, un contenedor que
 * se reinicia a mitad de trabajo deja ese trabajo congelado PARA SIEMPRE, y es
 * el peor fallo posible de esta parte: un trabajo que no avanza no da ningún
 * error, no aparece en ninguna lista de incidencias, y los datos del cliente
 * simplemente se quedan viejos.
 */
export const CERROJO_CADUCA_MS = 30 * 60 * 1000

/* ------------------------------------------------------------------ */
/* Crear                                                               */
/* ------------------------------------------------------------------ */

export interface NuevoJob {
  tipo: AmazonJobTipo
  clientId: string
  connectionId?: string | null
  marketplaceId?: string | null
  /** Menor va antes. 100 es lo normal; 10 para lo que pide una persona */
  prioridad?: number
  /** Subconjunto de prueba. null o vacío = todo el ámbito */
  skusFiltro?: string[] | null
  parametros?: Record<string, unknown>
  createdBy?: string | null
}

export interface ResultadoCrearJob {
  job: AmazonJob
  /**
   * true cuando ya había uno vivo igual y se devuelve ESE en vez de crear otro.
   *
   * No es un error: es la respuesta correcta a «lánzame el barrido de este
   * cliente» pulsado dos veces. La pantalla enseña el que ya está en marcha.
   */
  yaExistia: boolean
}

/**
 * Mete un trabajo en la cola.
 *
 * DOS TRABAJOS DEL MISMO TIPO Y CLIENTE NO SE PISAN, y lo garantiza el índice
 * único parcial de la migración 123, no este código: dos contenedores creando el
 * mismo trabajo a la vez pasarían cualquier comprobación previa que se escribiera
 * aquí. Lo que hace este código es RECOGER la violación de unicidad y devolver el
 * trabajo que ya estaba, que es lo que quería quien llamó.
 *
 * Los trabajos sobre un subconjunto (`skusFiltro`) quedan fuera de esa exclusión
 * a propósito: son los de prueba y los que pide una persona a demanda, y
 * bloquearlos mientras corre el barrido semanal haría imposible probar nada
 * durante horas.
 */
export async function crearJob(nuevo: NuevoJob): Promise<ResultadoCrearJob> {
  const service = createServiceClient()

  const connectionId = nuevo.connectionId ?? null
  const marketplaceId = nuevo.marketplaceId ?? null

  if (jobNecesitaConexion(nuevo.tipo) && (!connectionId || !marketplaceId)) {
    // Se corta aquí en vez de dejar que reviente el CHECK de la base, porque el
    // mensaje de Postgres no dice qué falta.
    throw new Error(
      `El trabajo «${nuevo.tipo}» habla con Amazon, así que necesita saber con qué conexión y en qué marketplace.`
    )
  }

  // Un array vacío NO es «sin filtro»: es un filtro que no selecciona nada, y el
  // trabajo terminaría en verde sin haber hecho nada. Se normaliza a null.
  const skusFiltro =
    nuevo.skusFiltro && nuevo.skusFiltro.length > 0 ? [...new Set(nuevo.skusFiltro)] : null

  const fila = {
    tipo: nuevo.tipo,
    client_id: nuevo.clientId,
    connection_id: connectionId,
    marketplace_id: marketplaceId,
    estado: 'pendiente' as AmazonJobEstado,
    prioridad: nuevo.prioridad ?? 100,
    skus_filtro: skusFiltro,
    parametros: nuevo.parametros ?? {},
    created_by: nuevo.createdBy ?? null,
  }

  const { data, error } = await service.from('amazon_jobs').insert(fila).select('*').maybeSingle()

  if (error) {
    // 23505 = unique_violation: ya hay uno vivo de este tipo para este destino.
    if ((error as { code?: string }).code === '23505' && skusFiltro === null) {
      const existente = await jobVivo(nuevo.tipo, nuevo.clientId, connectionId, marketplaceId)
      if (existente) return { job: existente, yaExistia: true }
    }
    throw error
  }

  if (!data) {
    // No debería pasar: un INSERT sin error devuelve la fila. Si pasa, es
    // preferible reventar aquí que devolver un trabajo a medias que luego
    // nadie pueda procesar.
    throw new Error('El trabajo se ha creado pero la base no ha devuelto la fila')
  }

  return { job: data as unknown as AmazonJob, yaExistia: false }
}

/** El trabajo vivo de este tipo y destino, si lo hay */
export async function jobVivo(
  tipo: AmazonJobTipo,
  clientId: string,
  connectionId: string | null,
  marketplaceId: string | null
): Promise<AmazonJob | null> {
  const service = createServiceClient()
  let consulta = service
    .from('amazon_jobs')
    .select('*')
    .eq('tipo', tipo)
    .eq('client_id', clientId)
    .is('skus_filtro', null)
    .in('estado', ['pendiente', 'en_curso', 'pausado'])

  consulta = connectionId ? consulta.eq('connection_id', connectionId) : consulta.is('connection_id', null)
  consulta = marketplaceId
    ? consulta.eq('marketplace_id', marketplaceId)
    : consulta.is('marketplace_id', null)

  const { data, error } = await consulta.order('created_at', { ascending: true }).limit(1)
  if (error) throw error
  return ((data ?? [])[0] as AmazonJob | undefined) ?? null
}

/* ------------------------------------------------------------------ */
/* Leer                                                                */
/* ------------------------------------------------------------------ */

export async function cargarJob(jobId: string): Promise<AmazonJob | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_jobs')
    .select('*')
    // maybeSingle() y no single(): un trabajo que ya no existe es un 404 con
    // mensaje, no la excepción de «se esperaba una fila» que acaba en 500.
    .eq('id', jobId)
    .maybeSingle()
  if (error) throw error
  return (data as AmazonJob | null) ?? null
}

/**
 * Los trabajos que el cron tiene que mirar, en el orden en que se eligen.
 *
 * Por prioridad y después por antigüedad: el que lleva más tiempo esperando va
 * delante, así que si una pasada se queda sin tiempo, los que sobran son los
 * primeros de la siguiente y ninguno se queda atrás indefinidamente. Es el mismo
 * criterio que perfilesDelCiclo() del módulo de stock.
 *
 * Trae también los que están cogidos: filtrarlos aquí obligaría a repetir la
 * regla de caducidad del cerrojo en dos sitios. Quien intente tomarlos se
 * llevará un `false` y seguirá con el siguiente.
 */
export async function jobsDeLaCola(limite = 50): Promise<AmazonJob[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_jobs')
    .select('*')
    .in('estado', ['pendiente', 'en_curso'])
    .order('prioridad', { ascending: true })
    .order('created_at', { ascending: true })
    // Desempate por una columna única: sin él, dos trabajos creados en el mismo
    // milisegundo salen en un orden distinto en cada consulta.
    .order('id', { ascending: true })
    .limit(limite)
  if (error) throw error
  return (data ?? []) as AmazonJob[]
}

export async function jobsDeCliente(clientId: string, limite = 50): Promise<AmazonJob[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_jobs')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limite)
  if (error) throw error
  return (data ?? []) as AmazonJob[]
}

/* ------------------------------------------------------------------ */
/* El cerrojo                                                          */
/* ------------------------------------------------------------------ */

/** Un testigo nuevo para cada intento de coger un trabajo */
export function nuevoTokenCerrojo(): string {
  return randomUUID()
}

/**
 * Intenta quedarse un trabajo. Devuelve true solo si lo ha conseguido.
 *
 * SON DOS PASOS Y EL SEGUNDO ES EL QUE MANDA:
 *
 *   1. Soltar el cerrojo si está ABANDONADO. `caducadoAntes` es la fecha a
 *      partir de la cual se da por muerto el que lo tenía. Este paso es
 *      idempotente: que lo hagan dos a la vez da igual.
 *
 *   2. Cogerlo si está libre. UN ÚNICO UPDATE CONDICIONAL. Ver la cabecera.
 *
 * Los dos pasos usan filtros simples en vez de un `.or()` con una fecha dentro:
 * una marca ISO lleva puntos y dos puntos, que son separadores en la sintaxis de
 * filtros de PostgREST, y un filtro mal interpretado aquí NO daría error —
 * devolvería siempre «no lo he conseguido» y el motor no procesaría nunca nada.
 * Está aprendido en lib/stock-sync/perfiles.ts.
 */
export async function tomarJob(
  job: Pick<AmazonJob, 'id' | 'iniciado_at' | 'pasadas'>,
  token: string,
  ahora: Date,
  caducadoAntes: Date
): Promise<boolean> {
  const service = createServiceClient()

  const { error: errorCaducado } = await service
    .from('amazon_jobs')
    .update({ running_since: null, running_token: null })
    .eq('id', job.id)
    .lt('running_since', caducadoAntes.toISOString())
  if (errorCaducado) throw errorCaducado

  // La fila entra por parámetro y no se relee, y no es por ahorrar un viaje:
  // PostgREST no sabe hacer `COALESCE(iniciado_at, now())` ni `pasadas + 1`
  // dentro de un UPDATE, así que esos dos valores hay que calcularlos fuera. Se
  // usan los de la lectura de la cola. `iniciado_at` es «cuándo empezó», NO
  // «cuándo se retomó»: reescribirlo en cada pasada borraría cuánto lleva de
  // verdad este trabajo, que es el único dato que delata a uno atascado.
  const { data, error } = await service
    .from('amazon_jobs')
    .update({
      running_since: ahora.toISOString(),
      running_token: token,
      estado: 'en_curso',
      iniciado_at: job.iniciado_at ?? ahora.toISOString(),
      // `pasadas` es un contador de diagnóstico, no un invariante: que dos
      // pasadas que compiten por el cerrojo lo dejen en el mismo número no
      // rompe nada, y solo una de las dos va a conseguirlo.
      pasadas: (job.pasadas ?? 0) + 1,
    })
    .eq('id', job.id)
    .is('running_since', null)
    .in('estado', ['pendiente', 'en_curso'])
    .select('id')

  if (error) throw error
  return (data ?? []).length > 0
}

/**
 * Suelta el cerrojo, y SOLO SI SIGUE SIENDO SUYO.
 *
 * El `.eq('running_token', token)` es lo que hace que una pasada que se quedó
 * colgada —y a la que ya le robaron el cerrojo por caducado— no le abra la
 * puerta a nadie al terminar tarde: soltaría un cerrojo que ahora tiene otro y
 * acabarían dos procesando el mismo trabajo.
 *
 * NUNCA LANZA: si esto fallara y se propagara, el error taparía el del trabajo,
 * que es el que explica lo que pasó de verdad. Un cerrojo que no se suelta se
 * acaba soltando solo por caducidad.
 */
export async function soltarJob(jobId: string, token: string): Promise<void> {
  try {
    const service = createServiceClient()
    const { error } = await service
      .from('amazon_jobs')
      .update({ running_since: null, running_token: null })
      .eq('id', jobId)
      .eq('running_token', token)
    if (error) throw error
  } catch (error) {
    console.error('[plataforma] no se ha podido soltar el cerrojo del trabajo:', error)
  }
}

/* ------------------------------------------------------------------ */
/* El progreso                                                         */
/* ------------------------------------------------------------------ */

export interface ProgresoLote {
  /** Por dónde iba. Es lo que hace que un trabajo del 80% no empiece de cero */
  cursorClave?: string | null
  cursorPagina?: number | null
  cursorExterno?: string | null
  /** Totales ACUMULADOS del trabajo, no los del lote */
  procesados: number
  omitidos: number
  errores: number
  /** Fallidos SEGUIDOS, no totales. Ver la columna en la 123 */
  lotesFallidosSeguidos: number
  lotes: number
  totalEstimado?: number | null
}

export interface ResultadoProgreso {
  /**
   * false = el cerrojo ya no es nuestro. Alguien nos lo robó porque esta pasada
   * se pasó del plazo de caducidad. Hay que PARAR INMEDIATAMENTE: seguir
   * escribiendo sería pisar el trabajo del que lo tiene ahora.
   */
  ok: boolean
  /** Han pedido cancelar mientras trabajábamos */
  cancelado: boolean
}

/**
 * Guarda el progreso DESPUÉS DE CADA LOTE, y de paso mira si han pedido cancelar.
 *
 * Las dos cosas en la misma consulta a propósito: son la pareja que se ejecuta
 * miles de veces en un barrido grande, y hacerlas en dos viajes duplicaría la
 * latencia de la parte más repetida del motor.
 *
 * El `.eq('running_token', token)` no es una precaución de más: es la
 * comprobación de que el cerrojo sigue siendo nuestro. Si devuelve cero filas,
 * el trabajo ya lo tiene otro y esta pasada tiene que abandonar sin tocar nada.
 */
export async function guardarProgreso(
  jobId: string,
  token: string,
  progreso: ProgresoLote
): Promise<ResultadoProgreso> {
  const service = createServiceClient()

  const patch: Record<string, unknown> = {
    procesados: progreso.procesados,
    omitidos: progreso.omitidos,
    errores: progreso.errores,
    lotes_fallidos_seguidos: progreso.lotesFallidosSeguidos,
    lotes: progreso.lotes,
    progreso_at: new Date().toISOString(),
  }
  if (progreso.cursorClave !== undefined) patch.cursor_clave = progreso.cursorClave
  if (progreso.cursorPagina !== undefined) patch.cursor_pagina = progreso.cursorPagina
  if (progreso.cursorExterno !== undefined) patch.cursor_externo = progreso.cursorExterno
  if (progreso.totalEstimado !== undefined) patch.total_estimado = progreso.totalEstimado

  const { data, error } = await service
    .from('amazon_jobs')
    .update(patch)
    .eq('id', jobId)
    .eq('running_token', token)
    .select('cancel_solicitado')

  if (error) throw error
  const filas = (data ?? []) as Array<{ cancel_solicitado: boolean }>
  if (filas.length === 0) return { ok: false, cancelado: false }
  return { ok: true, cancelado: filas[0].cancel_solicitado }
}

/* ------------------------------------------------------------------ */
/* Terminar                                                            */
/* ------------------------------------------------------------------ */

export interface DesenlaceJob {
  estado: Extract<AmazonJobEstado, 'terminado' | 'error' | 'cancelado' | 'pausado'>
  /** Una frase con cómo acabó: «13.712 SKU leídos, 4 sin ASIN» */
  resumen?: string | null
  /** En español. OBLIGATORIO si el estado es 'error' (lo exige el CHECK) */
  errorMessage?: string | null
  errorDetalle?: unknown
  requestId?: string | null
}

/**
 * Cierra el trabajo y suelta el cerrojo en la misma escritura.
 *
 * Devuelve false cuando el cerrojo ya no era nuestro, por lo mismo que
 * guardarProgreso: cerrar un trabajo que otro está procesando lo dejaría
 * escribiendo sobre una fila terminada.
 */
export async function terminarJob(
  jobId: string,
  token: string,
  desenlace: DesenlaceJob
): Promise<boolean> {
  const service = createServiceClient()

  if (desenlace.estado === 'error' && !desenlace.errorMessage?.trim()) {
    // El CHECK de la base lo rechazaría igualmente, pero con un mensaje de
    // Postgres que no dice qué falta. Y perder la fila sería perder justo la
    // explicación del fallo.
    throw new Error('Un trabajo que termina en error tiene que decir por qué')
  }

  const ahora = new Date().toISOString()
  const patch: Record<string, unknown> = {
    estado: desenlace.estado,
    running_since: null,
    running_token: null,
    resumen: desenlace.resumen ?? null,
    error_message: desenlace.errorMessage ?? null,
    error_detalle: desenlace.errorDetalle ?? null,
    request_id: desenlace.requestId ?? null,
  }
  // 'pausado' sigue vivo: no lleva fecha de fin.
  if (desenlace.estado !== 'pausado') patch.terminado_at = ahora

  const { data, error } = await service
    .from('amazon_jobs')
    .update(patch)
    .eq('id', jobId)
    .eq('running_token', token)
    .select('id')

  if (error) throw error
  return (data ?? []).length > 0
}

/* ------------------------------------------------------------------ */
/* Cancelar y pausar                                                   */
/* ------------------------------------------------------------------ */

/**
 * Pide que se cancele. NO lo cancela.
 *
 * La diferencia importa: poner el estado a 'cancelado' por debajo de una pasada
 * que está trabajando la dejaría escribiendo sobre un trabajo que ya nadie mira,
 * y el lote a medias quedaría contado a medias. Con la petición, el trabajador
 * la ve al guardar el progreso del lote siguiente y para él mismo,
 * ordenadamente, con el cursor en un punto coherente.
 *
 * Si el trabajo NO lo está procesando nadie ahora mismo, se cierra en el acto:
 * esperar a la próxima pasada del cron para cancelar algo que está parado sería
 * absurdo.
 *
 *
 * POR QUÉ HAY QUE MANDAR `iniciadoAt`, QUE PARECE QUE SOBRA
 * --------------------------------------------------------
 * Porque el CHECK amazon_jobs_inicio_ok de la 123 dice que todo lo que no está
 * 'pendiente' TIENE que decir cuándo empezó, y un trabajo recién creado por el
 * planificador nace 'pendiente' con `iniciado_at` a NULL: solo lo rellena
 * `tomarJob`. O sea que cancelar —o pausar— algo que todavía está EN LA COLA es
 * exactamente el caso en el que la columna está vacía, y sin este parámetro el
 * UPDATE revienta contra el CHECK y el botón contesta con el texto crudo de
 * Postgres. Peor aún al cancelar: el primer UPDATE va en su propia transacción y
 * sí entra, así que la fila se queda 'pendiente' con `cancel_solicitado = true`
 * —o sea, en la cola y marcada como cancelada— hasta que el motor le dedique un
 * lote entero de trabajo real contra Amazon para enterarse.
 *
 * Va por parámetro y no releyendo la fila por el mismo motivo que en `tomarJob`:
 * PostgREST no sabe hacer `COALESCE(iniciado_at, now())` dentro de un UPDATE.
 * La ruta ya ha leído el trabajo con `cargarJob` antes de llamar aquí.
 */
export async function pedirCancelacion(
  jobId: string,
  params: { userId: string | null; motivo: string; iniciadoAt: string | null }
): Promise<{ ok: boolean; inmediato: boolean }> {
  const motivo = params.motivo.trim()
  if (motivo === '') {
    throw new Error('Hay que decir por qué se cancela el trabajo')
  }

  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_jobs')
    .update({
      cancel_solicitado: true,
      cancel_por: params.userId,
      cancel_motivo: motivo,
    })
    .eq('id', jobId)
    .in('estado', ['pendiente', 'en_curso', 'pausado'])
    .select('id, running_since')

  if (error) throw error
  const filas = (data ?? []) as Array<{ id: string; running_since: string | null }>
  if (filas.length === 0) return { ok: false, inmediato: false }

  if (filas[0].running_since === null) {
    const ahora = new Date().toISOString()
    const { error: errorCierre } = await service
      .from('amazon_jobs')
      .update({
        estado: 'cancelado',
        // Un trabajo cancelado en la cola no llegó a empezar nunca; se marca con
        // la hora de la cancelación para poder salir de 'pendiente'. Ver arriba.
        iniciado_at: params.iniciadoAt ?? ahora,
        terminado_at: ahora,
        resumen: `Cancelado antes de empezar a procesar: ${motivo}`,
      })
      .eq('id', jobId)
      // Solo si sigue sin dueño: entre las dos consultas puede haber entrado una
      // pasada del cron, y entonces la cancelación la aplica ella.
      .is('running_since', null)
      .in('estado', ['pendiente', 'en_curso', 'pausado'])
    if (errorCierre) throw errorCierre
    return { ok: true, inmediato: true }
  }

  return { ok: true, inmediato: false }
}

/**
 * Lo saca de la cola sin cancelarlo. Se reanuda donde estaba.
 *
 * `iniciadoAt` por el mismo motivo que en pedirCancelacion: pausar uno que
 * todavía estaba 'pendiente' es el caso en el que la columna está vacía y el
 * CHECK amazon_jobs_inicio_ok no deja salir de ese estado sin rellenarla.
 */
export async function pausarJob(jobId: string, iniciadoAt: string | null): Promise<boolean> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_jobs')
    .update({ estado: 'pausado', iniciado_at: iniciadoAt ?? new Date().toISOString() })
    .eq('id', jobId)
    .in('estado', ['pendiente', 'en_curso'])
    // Solo si no lo está procesando nadie: pausar por debajo de una pasada en
    // marcha dejaría el lote a medias.
    .is('running_since', null)
    .select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

/**
 * Vuelve a meterlo en la cola. El cursor se conserva, así que sigue donde
 * estaba.
 *
 * Sirve también para relanzar uno que acabó en error: se limpia el mensaje y la
 * fecha de fin, pero NO los contadores ni el cursor, que es lo que evita repetir
 * las 11.000 referencias que ya se habían leído.
 */
export async function reanudarJob(jobId: string): Promise<boolean> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_jobs')
    .update({
      estado: 'en_curso',
      terminado_at: null,
      error_message: null,
      error_detalle: null,
      cancel_solicitado: false,
      cancel_por: null,
      cancel_motivo: null,
      // La racha de fallos se borra al relanzar a mano, y es lo que hace que
      // relanzar sirva de algo: sin esto, un trabajo que se rindió vuelve con
      // el contador tocando el techo y el primer 429 suelto lo mata otra vez
      // en el acto. Los contadores de trabajo hecho (`procesados`, `errores`,
      // `lotes`) NO se tocan: son lo que evita repetir lo ya leído.
      lotes_fallidos_seguidos: 0,
    })
    .eq('id', jobId)
    .in('estado', ['pausado', 'error'])
    .select('id')
  if (error) throw error
  return (data ?? []).length > 0
}
