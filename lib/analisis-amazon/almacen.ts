/**
 * LOS FICHEROS DE LA RECOGIDA EN STORAGE (bucket privado `analisis-keepa`, sin migración). Los usan la recogida (recogida.ts) y el panel de
 * Informes de Cold Calling (panel-servidor.ts).
 *
 *   cola.json             [{ lead, seller, tienda, comercial, comercialId? }]   vendedores de Amazon, en orden de prioridad
 *   cola-sin-amazon.json  [{ lead, tienda, web, comercial, comercialId?, fact? }] tiendas que no venden en Amazon
 *   saltados.json         { clave: motivo }   clave = seller en Amazon, `lead:<id>` en sin Amazon. Sin fecha (la lee también el portátil)
 *   bitacora.json         [EventoDeBitacora]  desde el 16 nov 2026: cada informe hecho, saltado o fallido, con su hora y sus tokens
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TipoDeCola } from './turnos'

export const BUCKET = 'analisis-keepa'

/** `comercial` es el nombre de pila (los ficheros de hasta el 16 nov solo traen eso); `comercialId`, el id del perfil si se puso al montar */
export type EnCola = { lead: string; seller: string; tienda: string; comercial?: string; comercialId?: string }
export type EnColaSinAmazon = { lead: string; tienda: string; web: string; comercial?: string; comercialId?: string; fact?: number | null }

export type ResultadoDeEvento = 'hecho' | 'saltado' | 'fallo'
export interface EventoDeBitacora {
  at: string
  tipo: TipoDeCola
  lead: string
  tienda: string
  /** El comercial de la entrada de la cola en ese momento */
  comercialId: string | null
  resultado: ResultadoDeEvento
  motivo?: string
  /** Tokens de Keepa gastados en esa tienda */
  tokens: number
}

/** Lo que se guarda de la bitácora: los más nuevos (unos 45 días al ritmo de nov 2026; ~2 MB) */
export const TOPE_DE_BITACORA = 10_000

export async function leerJson<T>(s: SupabaseClient, nombre: string, siNoHay: T): Promise<T> {
  const { data, error } = await s.storage.from(BUCKET).download(nombre)
  if (error || !data) return siNoHay
  return JSON.parse(await data.text()) as T
}

export async function escribirJson(s: SupabaseClient, nombre: string, datos: unknown) {
  await s.storage.from(BUCKET).upload(nombre, new Blob([JSON.stringify(datos)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' })
}

/** Añade los eventos de una pasada a la bitácora (una lectura y una escritura, solo si hay algo que apuntar) */
export async function apuntarEnBitacora(s: SupabaseClient, eventos: readonly EventoDeBitacora[]) {
  if (!eventos.length) return
  try {
    const previa = await leerJson<EventoDeBitacora[]>(s, 'bitacora.json', [])
    const todo = [...(Array.isArray(previa) ? previa : []), ...eventos]
    await escribirJson(s, 'bitacora.json', todo.slice(-TOPE_DE_BITACORA))
  } catch (e) {
    // La bitácora es para mirar: nunca puede tirar una pasada que ya ha hecho su trabajo
    console.warn(`[analisis-keepa] no se ha podido apuntar en la bitácora: ${(e as Error).message}`)
  }
}
