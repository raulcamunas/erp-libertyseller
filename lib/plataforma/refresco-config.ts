/**
 * CADA CUÁNTO LE TOCA A CADA REFRESCO
 * ===================================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 * HAY DOS RELOJES EN ESTE ERP Y SE CONFUNDEN CONTINUAMENTE:
 *
 *   · cron_config (lib/sistema/cron.ts) — cada cuánto se DESPIERTA el motor.
 *     Son minutos: 5, 15. Cada pasada mira la cola y avanza un tramo.
 *   · esto — cada cuánto le TOCA a cada refresco. Son horas o días.
 *
 * Que el motor entre cada 5 minutos no significa que se relea el catálogo cada
 * 5 minutos: significa que cada 5 minutos se comprueba si a alguien le toca. La
 * pantalla ponía «diario» y «semanal» a secas, y esas dos palabras eran justo lo
 * que impedía saber cuál de los dos relojes se estaba mirando.
 *
 *
 * LOS VALORES DEL CÓDIGO SON EL SUELO, NO LA VERDAD
 * -------------------------------------------------
 * Si la migración 139 no está lanzada —se pegan a mano en Supabase, así que el
 * código puede llegar antes— se devuelven estos valores y todo sigue como
 * estaba. Fallar o no planificar nada dejaría el ERP parado en silencio por una
 * tabla que falta, que es el fallo que llevamos toda la semana persiguiendo.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { VENTANA_NOCTURNA, type VentanaHoraria } from './refresco'
import type { AmazonJobTipo } from './tipos'

export interface ConfigRefresco {
  tipo: AmazonJobTipo
  cada_minutos: number
  solo_de_noche: boolean
  activo: boolean
  /** true = sale del código porque falta la 139 */
  pordefecto?: boolean
}

/**
 * Los valores de partida.
 *
 * El censo va a 4 h y SIN ventana nocturna, y las dos cosas van juntas a
 * propósito: con la ventana puesta, «cada 4 horas» solo podría arrancar dos
 * veces por noche y ninguna en todo el día. El número guardado diría una cosa y
 * el comportamiento sería otro, sin ningún error por medio.
 *
 * Es quien descubre los SKU nuevos y los listings suprimidos: con cadencia
 * semanal, un producto dado de alta el lunes no existía para el ERP hasta el
 * domingo.
 */
export const REFRESCO_POR_DEFECTO: Record<string, { minutos: number; noche: boolean }> = {
  recalcular_activos: { minutos: 1200, noche: true }, //  20 h
  inventario_fba: { minutos: 1200, noche: true }, //      20 h
  snapshot_bsr: { minutos: 1200, noche: true }, //        20 h
  snapshot_precios: { minutos: 1200, noche: true }, //    20 h
  censo_catalogo: { minutos: 240, noche: false }, //       4 h, y de día también
  enriquecer_catalogo: { minutos: 8640, noche: true }, // 144 h
}

export const MIN_MINUTOS = 15
export const MAX_MINUTOS = 259_200

export function configPorDefecto(tipo: AmazonJobTipo): ConfigRefresco {
  const d = REFRESCO_POR_DEFECTO[tipo] ?? { minutos: 1200, noche: true }
  return {
    tipo,
    cada_minutos: d.minutos,
    solo_de_noche: d.noche,
    activo: true,
    pordefecto: true,
  }
}

/** El horario de todos los refrescos que el planificador conoce */
export async function leerConfigRefrescos(tipos: AmazonJobTipo[]): Promise<ConfigRefresco[]> {
  const base = tipos.map(configPorDefecto)

  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from('refresco_config')
      .select('tipo, cada_minutos, solo_de_noche, activo')
    if (error) throw error

    const guardado = new Map((data ?? []).map((f) => [f.tipo as string, f]))
    // Se recorre la lista del CÓDIGO y no la tabla: un refresco nuevo tiene que
    // salir con su valor por defecto sin otra migración, y una fila huérfana de
    // uno que ya no existe no debe aparecer como si algo se estuviera
    // ejecutando.
    return base.map((d) => {
      const fila = guardado.get(d.tipo)
      return fila ? ({ ...fila, pordefecto: false } as ConfigRefresco) : d
    })
  } catch {
    return base
  }
}

/** La ventana en la que puede arrancar, o null si puede a cualquier hora */
export function ventanaDe(config: ConfigRefresco): VentanaHoraria | null {
  return config.solo_de_noche ? VENTANA_NOCTURNA : null
}

/**
 * Cambia el horario de un refresco.
 *
 * Como en cron_config: se PARTE DE LO QUE YA HAY y no de los valores del
 * código. Es un upsert que escribe la fila entera, así que rellenar los huecos
 * con los defectos haría que tocar solo el interruptor de la noche te borrara en
 * silencio la cadencia que hubieras puesto.
 */
export async function guardarConfigRefresco(
  tipo: AmazonJobTipo,
  cambios: { cadaMinutos?: number; soloDeNoche?: boolean; activo?: boolean },
  userId: string | null
): Promise<ConfigRefresco[]> {
  const tipos = Object.keys(REFRESCO_POR_DEFECTO) as AmazonJobTipo[]
  if (!tipos.includes(tipo)) {
    throw new Error(`«${tipo}» no es un refresco que el planificador sepa encolar`)
  }

  const actual = (await leerConfigRefrescos(tipos)).find((c) => c.tipo === tipo)!
  let cadaMinutos = actual.cada_minutos
  let soloDeNoche = actual.solo_de_noche
  let activo = actual.activo

  if (cambios.cadaMinutos !== undefined) {
    const n = Math.round(cambios.cadaMinutos)
    if (!Number.isFinite(n) || n < MIN_MINUTOS || n > MAX_MINUTOS) {
      throw new Error(
        `El intervalo tiene que estar entre ${MIN_MINUTOS} minutos y 180 días. ` +
          'Por debajo del cuarto de hora se estaría volviendo a pedir un informe que Amazon todavía está generando.'
      )
    }
    cadaMinutos = n
  }
  if (cambios.soloDeNoche !== undefined) soloDeNoche = cambios.soloDeNoche
  if (cambios.activo !== undefined) activo = cambios.activo

  const service = createServiceClient()
  const { error } = await service.from('refresco_config').upsert(
    {
      tipo,
      cada_minutos: cadaMinutos,
      solo_de_noche: soloDeNoche,
      activo,
      actualizado_at: new Date().toISOString(),
      actualizado_por: userId,
    },
    { onConflict: 'tipo' }
  )
  if (error) throw error

  return await leerConfigRefrescos(tipos)
}
