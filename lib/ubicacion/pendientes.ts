/**
 * UBICAR LOS LEADS QUE FALTAN — el trabajo del proceso automático «Ubicación de los leads».
 * ==========================================================================================
 * Lee los leads pendientes (`ubicacion_calculada_at` nulo: los nuevos y los que han cambiado de ciudad, provincia, dirección, registro, teléfono o web), les pasa el
 * localizador (resolver.ts) y guarda el resultado en tandas con la función SQL `poner_ubicaciones_de_leads` (migración 263), que sella la fecha. Un lead sin ninguna pista
 * también se sella (con la comunidad vacía): si no, el proceso lo volvería a leer en cada pasada.
 *
 * Va por tandas pequeñas con una pausa entre ellas A PROPÓSITO: cada lead guardado es un aviso del tiempo real a las pantallas de Cold Calling abiertas, y 35.000 de golpe
 * (la primera vez, al lanzar la migración) serían 35.000 avisos en unos segundos, y cada pantalla abierta vuelve a calcular su cartera con cada tanda. Así salen unos 100 por segundo y ni se notan.
 *
 * Sirve igual desde el cron que desde un script: recibe el cliente con la clave de servicio. Se comprueba con pendientes.prueba.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ubicar } from './resolver'

export type ClienteDeUbicacion = Pick<SupabaseClient, 'from' | 'rpc'>

export const COLUMNAS_PARA_UBICAR = 'id, ciudad, province, business_address, mercantile_registry, phone, web'

export interface OpcionesDeUbicacion {
  /** Cuántos leads como máximo en una pasada. Por defecto 6.000: un minuto de trabajo, y la primera vez los 35.000 salen en seis pasadas */
  limite?: number
  /** Cuántos leads por tanda (por lectura y por escritura). Por defecto 100 */
  tanda?: number
  /** Pausa entre tandas, en milisegundos. Por defecto 1.000 */
  pausaMs?: number
  /** Tiempo máximo de la pasada, en milisegundos. Por defecto 240.000: la ruta aguanta 300 s */
  tiempoMaxMs?: number
  /** Para las pruebas: el reloj y la espera */
  ahora?: () => number
  esperar?: (ms: number) => Promise<void>
}

export interface ResumenDeUbicacion {
  /** Leads leídos y procesados en esta pasada */
  leidos: number
  /** De ellos, cuántos han quedado con comunidad */
  ubicados: number
  /** Cuántos no traían ninguna pista que sirva (comunidad vacía, pero sellados) */
  sinUbicar: number
  porOrigen: Record<string, number>
  tandas: number
  /** true si se paró por el tope de leads o de tiempo y todavía puede quedar alguno por ubicar */
  quedan: boolean
  /** La base todavía no tiene la migración 263: no se ha tocado nada */
  faltaLaMigracion: boolean
  /** Una frase para Sistema */
  resumen: string
}

interface FilaParaUbicar {
  id: string
  ciudad: string | null
  province: string | null
  business_address: string | null
  mercantile_registry: string | null
  phone: string | null
  web: string | null
}

/** La base no tiene las columnas (42703) ni la función (PGRST202) de la migración 263: el código llega antes de que nadie la lance */
const faltaLaMigracion = (error: unknown): boolean => {
  const codigo = (error as { code?: unknown } | null)?.code
  return codigo === '42703' || codigo === 'PGRST204' || codigo === 'PGRST202' || codigo === 'PGRST205'
}

export async function ubicarPendientes(db: ClienteDeUbicacion, op: OpcionesDeUbicacion = {}): Promise<ResumenDeUbicacion> {
  const limite = op.limite ?? 6000
  const tanda = op.tanda ?? 100
  const pausaMs = op.pausaMs ?? 1000
  const tiempoMax = op.tiempoMaxMs ?? 240_000
  const ahora = op.ahora ?? Date.now
  const esperar = op.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const arranque = ahora()

  const r: ResumenDeUbicacion = { leidos: 0, ubicados: 0, sinUbicar: 0, porOrigen: {}, tandas: 0, quedan: false, faltaLaMigracion: false, resumen: '' }

  while (r.leidos < limite) {
    const pedidos = Math.min(tanda, limite - r.leidos)
    const { data, error } = await db.from('cold_leads').select(COLUMNAS_PARA_UBICAR).is('ubicacion_calculada_at', null).order('id', { ascending: true }).limit(pedidos)
    if (error) {
      if (faltaLaMigracion(error)) {
        r.faltaLaMigracion = true
        r.resumen = 'Falta lanzar la migración 263: todavía no se ubica ningún lead'
        return r
      }
      throw new Error(`No se han podido leer los leads por ubicar: ${(error as { message?: string }).message ?? 'error de la base'}`)
    }
    const filas = (data ?? []) as unknown as FilaParaUbicar[]
    if (filas.length === 0) break

    const paraGuardar = filas.map((l) => {
      const u = ubicar({ ciudad: l.ciudad, provincia: l.province, direccion: l.business_address, registro: l.mercantile_registry, telefono: l.phone, web: l.web })
      if (u) {
        r.ubicados++
        r.porOrigen[`${u.origen}/${u.confianza}`] = (r.porOrigen[`${u.origen}/${u.confianza}`] ?? 0) + 1
      } else r.sinUbicar++
      return { id: l.id, ccaa: u?.ccaa ?? null, municipio_ine: u?.ine ?? null, origen: u?.origen ?? null, confianza: u?.confianza ?? null }
    })

    const { data: guardados, error: errorAlGuardar } = await db.rpc('poner_ubicaciones_de_leads', { filas: paraGuardar })
    if (errorAlGuardar) {
      if (faltaLaMigracion(errorAlGuardar)) {
        r.faltaLaMigracion = true
        r.resumen = 'Falta lanzar la migración 263: todavía no se ubica ningún lead'
        return r
      }
      throw new Error(`No se ha podido guardar la ubicación de ${paraGuardar.length} leads: ${(errorAlGuardar as { message?: string }).message ?? 'error de la base'}`)
    }
    // Si la base dice que no ha guardado ninguno, seguir leyendo los mismos para siempre no arregla nada
    if (typeof guardados === 'number' && guardados === 0) throw new Error('La base no ha guardado la ubicación de ningún lead de la tanda (¿se han borrado a la vez?)')

    r.leidos += filas.length
    r.tandas++
    if (filas.length < pedidos) break // la base dio menos de lo pedido: no había más pendientes
    if (ahora() - arranque > tiempoMax) {
      r.quedan = true
      break
    }
    if (r.leidos >= limite) {
      r.quedan = true
      break
    }
    if (pausaMs > 0) await esperar(pausaMs)
  }

  r.resumen =
    r.leidos === 0
      ? 'Nada por ubicar'
      : `Ubicados ${r.leidos.toLocaleString('es-ES')} leads: ${r.ubicados.toLocaleString('es-ES')} con comunidad y ${r.sinUbicar.toLocaleString('es-ES')} sin ninguna pista${r.quedan ? ' · quedan más por ubicar' : ''}`
  return r
}
