/**
 * AMAZON ADS · EL AGENTE PPC: CALIBRACIÓN MENSUAL DE LOS UMBRALES DE UNA CUENTA (SOLO SERVIDOR). Solo lee y escribe tablas del ERP.
 *
 * Cada 28 días como mucho (paso `calibrar` del cron): toma los veredictos de los cambios del agente de los últimos 60 días (`ads_efectos`) MEDIDOS DESPUÉS
 * de la calibración anterior (cada veredicto cuenta en UN solo ciclo: si no, tras un paso los mismos veredictos empujarían otro en el mismo sentido),
 * los pasa por `calibrar()` (puro, §6.6: un paso por clase, dentro de min/max y ±50 % del de partida, porcentajes ≤ 25, sin `presupuesto_subir`
 * y sin contar `mezclado` ni `sin_muestra`) y guarda los umbrales nuevos con `guardarUmbrales` A NOMBRE de quien encendió el agente.
 * Sin esa persona (o sin la 305) no se guarda nada: se devuelve el detalle de lo que habría cambiado. No anota eventos (lo hace el orquestador).
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { todasLasFilas } from '../paginar'
import { guardarUmbrales, leerUmbrales } from '../umbrales-cuenta'
import { AGENTE, FALTA_MIGRACION_315, type ClaseDeCambio, type Veredicto } from './tipos'
import { calibrar, desdeDeCalibrar } from './calibrar-calculo'

const VEREDICTOS: ReadonlySet<string> = new Set(['mejoro', 'empeoro', 'neutro', 'sin_muestra', 'mezclado'])

/**
 * Calibra los umbrales de la cuenta con lo medido. Devuelve cuántos umbrales se han GUARDADO (0 si no se guardó nada) y el detalle en español
 * («subirPujaPct 15 → 20 (14 de 20 mejoraron)», o por qué no se guardó). Sin la 315: `{ cambios: 0, detalle: [FALTA_MIGRACION_315] }`.
 */
export async function calibrarCuenta(perfilId: string, encendidoPor: string | null, calibradoAnterior: string | null = null): Promise<{ cambios: number; detalle: string[] }> {
  const desde = desdeDeCalibrar(Date.now(), calibradoAnterior)
  const { data, error } = await todasLasFilas<{ clase: string; veredicto: string | null }>(
    (a, b) =>
      createServiceClient()
        .from('ads_efectos')
        .select('clase, veredicto')
        .eq('perfil_id', perfilId)
        .not('veredicto', 'is', null)
        .gte('medido_at', desde)
        .order('medido_at')
        .order('propuesta_id')
        .range(a, b),
    20_000,
  )
  if (error) {
    if (isMissingSchema(error) || error.code === '23514') return { cambios: 0, detalle: [FALTA_MIGRACION_315] }
    throw error
  }

  const veredictos = data
    .filter((f) => f.veredicto && VEREDICTOS.has(f.veredicto))
    .map((f) => ({ clase: f.clase as ClaseDeCambio, veredicto: f.veredicto as Veredicto }))
  const cuentan = veredictos.filter((v) => v.veredicto !== 'mezclado' && v.veredicto !== 'sin_muestra').length

  const { umbrales, guardables } = await leerUmbrales(perfilId)
  const r = calibrar(umbrales, veredictos)
  if (r.cambios.length === 0) {
    return { cambios: 0, detalle: [`Sin cambios: ${cuentan} veredictos que cuentan desde la calibración anterior (como mucho ${AGENTE.CALIBRAR_VENTANA_DIAS} días) (hacen falta ${AGENTE.CALIBRAR_MIN_VEREDICTOS} de una clase y una mayoría clara).`] }
  }

  const lineas = r.cambios.map((c) => c.motivo)
  if (!encendidoPor) return { cambios: 0, detalle: [...lineas, 'No se guarda: no consta quién encendió el agente (los umbrales se guardan a nombre de una persona).'] }
  if (!guardables) return { cambios: 0, detalle: [...lineas, 'No se guarda: falta lanzar la migración 305 (umbrales del motor).'] }

  try {
    await guardarUmbrales(perfilId, r.umbrales, encendidoPor)
  } catch (e) {
    return { cambios: 0, detalle: [...lineas, `No se pudo guardar: ${e instanceof Error ? e.message : String(e)}`] }
  }
  return { cambios: r.cambios.length, detalle: lineas }
}
