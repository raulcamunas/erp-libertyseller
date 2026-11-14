/**
 * AMAZON ADS · LOS UMBRALES ESTIMADOS Y EL CVR DE REFERENCIA DE UNA CUENTA (SOLO SERVIDOR, solo lee y escribe tablas del ERP: nunca Amazon).
 *
 * Aparte de motor.ts para que lo puedan leer la lectura de términos (que necesita «días sin cerrar») y el motor de pujas sin importarse en círculo.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { anotarCambio } from './cuenta'
import { asinDeCampana } from './productos-agrupar'
import { cvrDeReferencia, umbralesValidos, type UmbralesEstimados } from './umbrales'

/** Los umbrales de la cuenta. Sin la columna (migración 305) o sin fila, los de partida; `guardables` dice si se pueden cambiar */
export async function leerUmbrales(perfilId: string): Promise<{ umbrales: UmbralesEstimados; guardables: boolean }> {
  const { data, error } = await createServiceClient().from('ads_motor_config').select('umbrales').eq('perfil_id', perfilId).maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return { umbrales: umbralesValidos(null), guardables: false }
    throw error
  }
  return { umbrales: umbralesValidos((data as { umbrales?: unknown } | null)?.umbrales), guardables: true }
}

export async function guardarUmbrales(perfilId: string, crudo: unknown, userId: string): Promise<UmbralesEstimados> {
  const umbrales = umbralesValidos(crudo)
  const { error } = await createServiceClient().from('ads_motor_config').upsert({ perfil_id: perfilId, umbrales, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'perfil_id' })
  if (error) {
    if (isMissingSchema(error)) throw new Error('Para guardar los umbrales de esta cuenta hay que lanzar la migración 305 en Supabase. Mientras, el motor usa los de partida.')
    throw error
  }
  await anotarCambio({ perfilId, entidad: 'campaña', accion: 'cambiar', campo: 'umbrales estimados del motor', valorNuevo: JSON.stringify(umbrales).slice(0, 300), motivo: 'Lo cambia una persona desde Marketing Test', origen: 'manual', userId })
  return umbrales
}

export interface CvrsDeCuenta {
  /** El CVR de referencia de una campaña (cae al del producto, la cuenta o el de partida si no tiene pedidos suficientes) */
  de: (campaignId: string, asin: string | null) => { cvr: number; fuente: 'campaña' | 'producto' | 'cuenta' | 'estimado' }
}

/** Clics y pedidos de los últimos 60 días por campaña, producto y cuenta (de `ads_rendimiento_diario`), para el CVR de referencia */
export async function cvrsDeCuenta(perfilId: string, porDefectoPct: number): Promise<CvrsDeCuenta> {
  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)
  const campana = new Map<string, { clics: number; pedidos: number }>()
  const producto = new Map<string, { clics: number; pedidos: number }>()
  const cuenta = { clics: 0, pedidos: 0 }
  const sumar = (m: Map<string, { clics: number; pedidos: number }>, k: string, c: number, p: number) => {
    const x = m.get(k) ?? { clics: 0, pedidos: 0 }
    x.clics += c
    x.pedidos += p
    m.set(k, x)
  }
  for (let i = 0; i < 50_000; i += 1000) {
    const { data, error } = await createServiceClient().from('ads_rendimiento_diario').select('campaign_id, nombre, clics, pedidos').eq('perfil_id', perfilId).gte('fecha', desde).gt('clics', 0).order('fecha').order('campaign_id').range(i, i + 999)
    if (error) {
      if (isMissingSchema(error)) break
      throw error
    }
    for (const r of (data ?? []) as Array<{ campaign_id: string; nombre: string | null; clics: number; pedidos: number }>) {
      const c = Number(r.clics) || 0
      const p = Number(r.pedidos) || 0
      sumar(campana, r.campaign_id, c, p)
      const asin = r.nombre ? asinDeCampana(r.nombre) : null
      if (asin) sumar(producto, asin, c, p)
      cuenta.clics += c
      cuenta.pedidos += p
    }
    if (!data || data.length < 1000) break
  }
  return { de: (campaignId, asin) => cvrDeReferencia({ campana: campana.get(campaignId), producto: asin ? producto.get(asin) : null, cuenta }, porDefectoPct) }
}
