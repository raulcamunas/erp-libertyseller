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
