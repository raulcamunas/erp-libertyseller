/**
 * AMAZON ADS · LA PARTE DEL MOTOR QUE CORRE SOLA (dentro del proceso `ads-rendimiento`, cada 2 minutos).
 * SOLO SERVIDOR.
 *
 * Por cada cuenta con el motor encendido: recoge o pide el informe de términos (una vez al día), cuando llega genera las propuestas y, si la cuenta está en AUTOPILOTO, aplica las negativas
 * pendientes (hasta su tope diario). En «sugiere» y «aprueba» no se aplica nada solo.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { cuentasASincronizar, debeEmpezar, type CuentaParaSincronizar } from './sincronizar'
import { avanzarTerminos, INTERVALO_TERMINOS_MS } from './terminos'
import { generarPropuestas, leerModo, perfilesConMotor, pilotoAutomatico } from './motor'

/** Las cuentas con el motor encendido que ahora mismo tienen algo que hacer. Barato: unas pocas consultas pequeñas, sin tocar Amazon */
export async function cuentasDelMotorConTrabajo(): Promise<CuentaParaSincronizar[]> {
  const encendidas = new Set(await perfilesConMotor())
  if (encendidas.size === 0) return []
  const cuentas = (await cuentasASincronizar()).filter((c) => encendidas.has(c.id))
  if (cuentas.length === 0) return []
  const service = createServiceClient()
  const ids = cuentas.map((c) => c.id)

  const [{ data: sync, error }, { data: pendientes }] = await Promise.all([
    service.from('ads_terminos_sync').select('perfil_id, estado, pedido_at, ultimo_ok_at, error').in('perfil_id', ids),
    service.from('ads_propuestas').select('perfil_id').in('perfil_id', ids).eq('estado', 'pendiente').eq('tipo', 'negativizar').limit(1000),
  ])
  if (error) throw error
  const por = new Map(((sync ?? []) as Array<{ perfil_id: string; estado: string; pedido_at: string | null; ultimo_ok_at: string | null; error: string | null }>).map((r) => [r.perfil_id, r]))
  const conPendientes = new Set(((pendientes ?? []) as Array<{ perfil_id: string }>).map((r) => r.perfil_id))
  const ahora = Date.now()
  return cuentas.filter((c) => {
    const e = por.get(c.id)
    if (e?.estado === 'esperando') return true
    if (debeEmpezar({ ultimoOkAt: e?.ultimo_ok_at ? Date.parse(e.ultimo_ok_at) : null, pedidoAt: e?.pedido_at ? Date.parse(e.pedido_at) : null, hayError: Boolean(e?.error), ahora, forzar: false }, INTERVALO_TERMINOS_MS)) return true
    return conPendientes.has(c.id) // posible trabajo para el piloto automático
  })
}

export interface PasoDelMotor {
  terminos: string
  nuevas: number
  aplicadas: number
  fallidas: number
}

/** Un paso del motor en una cuenta: términos → propuestas → piloto automático */
export async function pasoDelMotor(cuenta: CuentaParaSincronizar): Promise<PasoDelMotor> {
  const t = await avanzarTerminos(cuenta)
  let nuevas = 0
  if (t.accion === 'guardado') nuevas = (await generarPropuestas(cuenta)).nuevas
  let aplicadas = 0
  let fallidas = 0
  if ((await leerModo(cuenta.id)) === 'autopiloto') {
    const r = await pilotoAutomatico(cuenta)
    aplicadas = r.aplicadas
    fallidas = r.fallidas
  }
  return { terminos: t.accion, nuevas, aplicadas, fallidas }
}
