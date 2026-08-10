/**
 * EL REGISTRO DE LOS PROCESOS AUTOMÁTICOS.
 *
 * Envuelve lo que hace cada ruta de cron y deja una fila en `cron_ejecuciones`
 * (migración 137) con cuándo arrancó, cuánto tardó y cómo acabó.
 *
 *
 * POR QUÉ EXISTE ESTO
 * -------------------
 * Los tres crones llevaban desde el primer día pidiendo a `localhost:3000`
 * cuando el servidor escucha en el 80, y contestaban HTTP 000 en cada pasada. El
 * catálogo se quedó en «refrescado hace 17 horas», los trabajos de plataforma
 * acumularon 0 pasadas y la agenda solo se sincronizaba a mano.
 *
 * Nada de eso dio un error en ninguna pantalla. Se descubrió mirando los
 * registros del contenedor de casualidad.
 *
 *
 * SE REGISTRA AUNQUE FALLE, Y ESO ES EL PUNTO
 * -------------------------------------------
 * La fila se abre ANTES de trabajar y se cierra en un `finally`. Si la tarea
 * revienta, queda con `ok = false` y su error. Si el proceso se muere a medias
 * —el contenedor se reinicia, se acaba el tiempo— la fila se queda con `ok` a
 * NULL, y eso también dice algo: arrancó y no llegó al final.
 *
 * Lo único que NO deja rastro es que la ruta no llegue a ejecutarse. Y ahí la
 * ausencia es la señal: la pantalla enseña cuánto hace de la última pasada, así
 * que un cron muerto se ve como un hueco que crece.
 *
 *
 * EL REGISTRO NO PUEDE TUMBAR EL CRON
 * -----------------------------------
 * Todo lo de aquí va en try/catch propio. Si la tabla no existe todavía —las
 * migraciones se lanzan a mano y el código puede llegar antes— o Supabase no
 * contesta, se sigue trabajando igual. Un sistema de observación que rompe lo
 * que observa es peor que no tenerlo.
 */

import { createServiceClient } from '@/lib/supabase/service'

/** Los procesos que corren solos. El id es el que se guarda en la tabla */
export const TAREAS_CRON = [
  {
    id: 'amazon-sync',
    nombre: 'Catálogo de Amazon',
    ruta: '/api/amazon/cron-sync',
    cadaMinutos: 15,
    que:
      'Relee el catálogo de cada cuenta conectada —precios, stock y estado de los listings— y ' +
      'después ejecuta el ciclo de sincronismo de stock. Las dos cosas van en la misma pasada.',
  },
  {
    id: 'amazon-jobs',
    nombre: 'Trabajos de plataforma',
    ruta: '/api/amazon/cron-jobs',
    cadaMinutos: 5,
    que: 'Coge el siguiente trabajo de la cola —censo, atributos, BSR, inventario— y avanza un tramo.',
  },
  {
    id: 'calendario',
    nombre: 'Agenda con Google',
    ruta: '/api/appointments/cron-sync',
    cadaMinutos: 3,
    que: 'Trae al ERP las citas creadas, movidas o canceladas directamente en Google Calendar.',
  },
] as const

export type TareaCron = (typeof TAREAS_CRON)[number]['id']

export interface ConfigCron {
  tarea: string
  cada_minutos: number
  activo: boolean
  /** true cuando sale del código y no de la tabla: la 138 no está lanzada */
  pordefecto?: boolean
}

/**
 * MARGEN AL COMPARAR EL INTERVALO.
 *
 * Sin él, un proceso «cada 15 minutos» acaba corriendo cada 16. El cron entra en
 * el segundo 0 de cada minuto, pero la pasada anterior arrancó en un segundo
 * cualquiera —pongamos las 10:00:05—: a las 10:15:00 han pasado 14 min 55 s, no
 * llega a 15, se salta, y le toca a las 10:16. Y como cada pasada empieza más
 * tarde que la anterior, el retraso se acumula solo.
 *
 * Con 59 segundos de margen se dispara en el primer minuto en que puede, que es
 * lo que uno espera al escribir «cada 15 minutos».
 */
const MARGEN_MS = 59_000

/**
 * Vive aquí y no en la ruta porque Next NO deja exportar constantes sueltas de
 * un fichero de ruta: solo los métodos HTTP y sus opciones. Compila igual y
 * revienta en `next build` con «is not a valid Route export field».
 */
export const FALTA_MIGRACION_CRON =
  'Falta la tabla del registro de procesos: lanza 137_cron_ejecuciones.sql en el editor SQL de Supabase.'

export function tareaCron(id: string) {
  return TAREAS_CRON.find((t) => t.id === id) ?? null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Quién ha lanzado esta pasada. null = el cron.
 *
 * Lo pone /api/sistema/cron cuando alguien pulsa «Lanzar ahora», y viaja por
 * cabecera porque el botón no llama a la función: llama a la MISMA ruta que
 * llama el cron, a propósito, para probar el camino y no solo el código.
 *
 * Se valida la forma antes de devolverlo: la columna es una clave foránea a
 * auth.users y un texto cualquiera haría fallar la escritura del registro. Como
 * `abrir()` se traga sus errores, ese fallo no se vería en ningún sitio — la
 * pasada quedaría sin registrar y parecería que el proceso no ha corrido.
 */
export function lanzadoPorDe(headers: Headers): string | null {
  const valor = headers.get('x-lanzado-por')
  return valor && UUID.test(valor) ? valor : null
}

/**
 * A partir de cuánto se considera que un proceso está parado.
 *
 * TRES veces su cadencia, no una: una pasada puede tardar, el contenedor puede
 * estar reiniciándose, y avisar al primer minuto de retraso convierte esto en el
 * aviso que salta siempre y que nadie lee. Con tres vueltas, un hueco ya no es
 * mala suerte.
 */
export function estaParada(cadaMinutos: number, ultima: string | null): boolean {
  if (!ultima) return true
  const minutos = (Date.now() - new Date(ultima).getTime()) / 60_000
  return minutos > cadaMinutos * 3
}

/* ------------------------------------------------------------------ */
/* El horario                                                          */
/* ------------------------------------------------------------------ */

/**
 * Cada cuánto corre cada proceso.
 *
 * SI LA TABLA NO ESTÁ, SE DEVUELVEN LOS VALORES DEL CÓDIGO. Las migraciones de
 * este ERP se lanzan a mano en el editor de Supabase, así que el código puede
 * estar desplegado antes que la 138 — y de las tres cosas que podía hacer esta
 * función en ese hueco (fallar, no ejecutar nada, o seguir con los intervalos de
 * siempre) solo la última deja el sistema como estaba.
 */
export async function leerConfigCron(): Promise<ConfigCron[]> {
  const pordefecto: ConfigCron[] = TAREAS_CRON.map((t) => ({
    tarea: t.id,
    cada_minutos: t.cadaMinutos,
    activo: true,
    pordefecto: true,
  }))

  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from('cron_config')
      .select('tarea, cada_minutos, activo')
    if (error) throw error

    const guardado = new Map((data ?? []).map((f) => [f.tarea as string, f as ConfigCron]))
    // Se recorre TAREAS_CRON y no la tabla: un proceso nuevo en el código tiene
    // que aparecer con su valor por defecto sin necesidad de otra migración, y
    // una fila huérfana de un proceso que ya no existe no debe salir en la
    // pantalla como si algo estuviera corriendo.
    return pordefecto.map((d) => {
      const fila = guardado.get(d.tarea)
      return fila ? { ...fila, pordefecto: false } : d
    })
  } catch {
    return pordefecto
  }
}

export interface Veredicto {
  toca: boolean
  /** Para el registro del contenedor. Vacío cuando toca */
  motivo?: string
}

/**
 * ¿LE TOCA CORRER A ESTE PROCESO?
 *
 * La llaman las tres rutas de cron nada más entrar. El crontab del contenedor
 * las despierta CADA MINUTO y es aquí donde se decide, porque así el intervalo
 * es un dato de la base y no una línea del Dockerfile que hay que redesplegar
 * para cambiar.
 *
 *
 * MIRA LA ÚLTIMA PASADA AUTOMÁTICA, NO LA ÚLTIMA DE TODAS
 * -------------------------------------------------------
 * Si contara también las lanzadas a mano, pulsar «Lanzar ahora» para comprobar
 * algo retrasaría el automatismo un intervalo entero. Peor: en un proceso que
 * uno anda depurando a botonazos, el cron podría no volver a entrar en toda la
 * tarde y no se notaría, porque las pasadas manuales llenarían el hueco. Es la
 * misma trampa que ya nos costó meses con la agenda.
 *
 *
 * ESTO TAMBIÉN IMPIDE QUE SE SOLAPEN
 * ----------------------------------
 * `conRegistro` abre la fila ANTES de trabajar, así que una pasada en curso ya
 * cuenta como «última». Un refresco de catálogo que tarde trece minutos no va a
 * ver arrancar otro encima en el minuto siguiente.
 *
 *
 * ANTE LA DUDA, SE EJECUTA
 * ------------------------
 * Si la consulta falla o la migración no está, devuelve `toca: true`. Un
 * guardián del que depende que las cosas corran tiene que fallar hacia el lado
 * de que corran: equivocarse por ejecutar de más cuesta una pasada, y
 * equivocarse por no ejecutar deja el ERP parado en silencio, que es justo el
 * fallo que llevamos toda la semana pagando.
 */
export async function tocaAhora(tarea: TareaCron): Promise<Veredicto> {
  const config = (await leerConfigCron()).find((c) => c.tarea === tarea)
  if (!config) return { toca: true }
  if (!config.activo) return { toca: false, motivo: 'apagado desde la pantalla de Sistema' }

  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from('cron_ejecuciones')
      .select('iniciado_at')
      .eq('tarea', tarea)
      .is('lanzado_por', null)
      .order('iniciado_at', { ascending: false })
      .limit(1)
    if (error) throw error

    const ultima = data?.[0]?.iniciado_at as string | undefined
    if (!ultima) return { toca: true }

    const transcurrido = Date.now() - new Date(ultima).getTime()
    if (transcurrido + MARGEN_MS >= config.cada_minutos * 60_000) return { toca: true }

    return {
      toca: false,
      motivo: `le toca cada ${config.cada_minutos} min y van ${Math.round(transcurrido / 60_000)}`,
    }
  } catch {
    // Ver la cabecera: ante la duda, se ejecuta.
    return { toca: true }
  }
}

/** Cambia el horario de un proceso. Devuelve la lista entera ya actualizada */
export async function guardarConfigCron(
  tarea: string,
  cambios: { cadaMinutos?: number; activo?: boolean },
  userId: string | null
): Promise<ConfigCron[]> {
  if (!tareaCron(tarea)) {
    throw new Error(`No existe el proceso «${tarea}»`)
  }

  /**
   * SE PARTE DE LO QUE YA HAY, no de los valores del código.
   *
   * Es un UPSERT y escribe la fila entera, así que rellenar los huecos con los
   * valores por defecto tenía una consecuencia que no se ve leyendo la línea:
   * pulsar «Apagar» —que solo manda `activo`— le devolvía a `cada_minutos` el
   * número del código. O sea que apagar y encender un proceso te borraba en
   * silencio el intervalo que hubieras puesto.
   */
  const actual = (await leerConfigCron()).find((c) => c.tarea === tarea)
  let cadaMinutos = actual?.cada_minutos ?? tareaCron(tarea)!.cadaMinutos
  let activo = actual?.activo ?? true

  if (cambios.cadaMinutos !== undefined) {
    const n = Math.round(cambios.cadaMinutos)
    // El mismo rango que el CHECK de la migración, comprobado también aquí: el
    // de la base es la garantía, este es el que da un mensaje que se entiende.
    if (!Number.isFinite(n) || n < 1 || n > 43_200) {
      throw new Error('El intervalo tiene que estar entre 1 minuto y 30 días')
    }
    cadaMinutos = n
  }
  if (cambios.activo !== undefined) activo = cambios.activo

  const service = createServiceClient()
  // UPSERT y no UPDATE: si la fila no existe —proceso añadido al código después
  // de la 138— guardar tiene que crearla, no fallar en silencio con 0 filas.
  const { error } = await service.from('cron_config').upsert(
    {
      tarea,
      cada_minutos: cadaMinutos,
      activo,
      actualizado_at: new Date().toISOString(),
      actualizado_por: userId,
    },
    { onConflict: 'tarea' }
  )
  if (error) throw error

  return await leerConfigCron()
}

interface Registro {
  id: string | null
}

/**
 * Envuelve una pasada de cron y la deja registrada.
 *
 * `lanzadoPor` es el usuario cuando se dispara a mano desde la pantalla, y null
 * cuando lo hace el cron. La distinción importa: una pasada lanzada a mano para
 * depurar NO demuestra que el automatismo funcione, que es exactamente lo que
 * nos tuvo semanas creyendo que la agenda se sincronizaba sola.
 */
export async function conRegistro<T>(
  tarea: TareaCron,
  lanzadoPor: string | null,
  faena: () => Promise<T>
): Promise<T> {
  const arranque = Date.now()
  const registro = await abrir(tarea, lanzadoPor)

  try {
    const salida = await faena()
    await cerrar(registro, {
      ok: true,
      resumen: resumirDe(salida),
      duracionMs: Date.now() - arranque,
    })
    return salida
  } catch (error) {
    await cerrar(registro, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      duracionMs: Date.now() - arranque,
    })
    throw error
  }
}

/**
 * Un resumen legible de lo que devolvió la tarea.
 *
 * Cada ruta devuelve una forma distinta, así que se buscan las claves que suelen
 * traer en vez de exigir un contrato común: obligar a las cuatro rutas a
 * devolver lo mismo sería tocarlas todas para poder mirarlas, y este módulo
 * existe justo para no cambiar lo que observa.
 */
function resumirDe(salida: unknown): string | null {
  if (!salida || typeof salida !== 'object') return null
  const o = salida as Record<string, unknown>
  for (const clave of ['resumen', 'mensaje', 'message', 'summary']) {
    const v = o[clave]
    if (typeof v === 'string' && v.trim() !== '') return v.slice(0, 500)
  }
  const numeros = ['procesados', 'creados', 'actualizados', 'sincronizadas', 'perfiles']
    .map((k) => (typeof o[k] === 'number' ? `${k}: ${o[k]}` : null))
    .filter(Boolean)
  return numeros.length > 0 ? numeros.join(' · ') : null
}

async function abrir(tarea: TareaCron, lanzadoPor: string | null): Promise<Registro> {
  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from('cron_ejecuciones')
      .insert({ tarea, lanzado_por: lanzadoPor })
      .select('id')
      .single()
    if (error) throw error
    return { id: data?.id ?? null }
  } catch {
    // Ver la cabecera: el registro nunca puede impedir que el cron trabaje.
    return { id: null }
  }
}

async function cerrar(
  registro: Registro,
  fin: { ok: boolean; resumen?: string | null; error?: string; duracionMs: number }
): Promise<void> {
  if (!registro.id) return
  try {
    const service = createServiceClient()
    await service
      .from('cron_ejecuciones')
      .update({
        terminado_at: new Date().toISOString(),
        ok: fin.ok,
        resumen: fin.resumen ?? null,
        error: fin.error ?? null,
        duracion_ms: fin.duracionMs,
      })
      .eq('id', registro.id)

    /**
     * La limpieza, de vez en cuando y no siempre.
     *
     * El de calendario corre cada 3 minutos: hacer un DELETE con rango de fechas
     * en cada pasada son 480 barridos diarios para borrar nada el 99 % de las
     * veces. Una de cada cien pasadas basta y sobra para que la tabla no crezca.
     */
    if (Math.random() < 0.01) {
      await service.rpc('limpiar_cron_ejecuciones', { p_dias: 30 })
    }
  } catch {
    /* ver arriba */
  }
}
