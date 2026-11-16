'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type {
  CalidadDatos, EnvioPropuestoGuardado, PlanCliente, PlanParaCliente, ResumenPlan, SaludCliente,
} from '@/lib/fba/plan-tipos'
import { leerRespuesta } from './errores'
import { invalidarRemesas, useAgencia } from './useAgencia'

/**
 * EL PLAN DE REPOSICIÓN DESDE LA PANTALLA (spec remesas-pro §9, D25, D26 y D28).
 *
 * API
 *   usePlan(clienteId | null, { todas?, pagina?, sku? })
 *     → { plan, deAgencia, pasada, envios, migracion316, cargando, error, estado, recargar, recalcular, recalculando }
 *     · GET /api/fba/plan?cliente=<id>: la agencia recibe PlanCliente (+ pasada, envíos guardados y si está la 316);
 *       el cliente externo, PlanParaCliente (sin €, prioridades, ajustes ni envíos). `deAgencia` dice cuál ha llegado.
 *     · `todas: true` pide todas las líneas (por defecto: las propuestas y las que rompen en 60 días); `sku` una sola.
 *     · recalcular(): POST /api/fba/plan { clienteId } (agencia con editar; como mucho 1 cada 2 min por cliente).
 *       Vacía la memoria (invalidarRemesas) y hace router.refresh(), nunca router.push. Devuelve true si salió bien.
 *   usePlanTodos(activo = true)
 *     → GET /api/fba/plan?todos=1: { envios (activos), porCliente: [{ clienteId, nombre, resumen, calidad, salud }] }
 *   esPlanDeAgencia(plan)   distingue PlanCliente de PlanParaCliente
 *   recalcularPlan(clienteId)   lo mismo que recalcular() fuera de React (sin router.refresh)
 */

export interface PasadaPlan {
  id: string
  calculadoAt: string
  origen: string
}

interface RespuestaPlanAgencia {
  plan: PlanCliente
  pasada: PasadaPlan | null
  envios: EnvioPropuestoGuardado[]
  migracion316: boolean
}
interface RespuestaPlanCliente {
  plan: PlanParaCliente
}
type RespuestaPlan = RespuestaPlanAgencia | RespuestaPlanCliente

export function esPlanDeAgencia(plan: PlanCliente | PlanParaCliente | null | undefined): plan is PlanCliente {
  return !!plan && 'envios' in plan && 'ajustes' in plan
}

export function urlDelPlan(clienteId: string, opciones: { todas?: boolean; pagina?: number; sku?: string } = {}): string {
  const p = new URLSearchParams({ cliente: clienteId })
  if (opciones.todas) p.set('todas', '1')
  if (opciones.pagina && opciones.pagina > 1) p.set('pagina', String(opciones.pagina))
  if (opciones.sku) p.set('sku', opciones.sku)
  return `/api/fba/plan?${p.toString()}`
}

/** POST del plan. Nunca lanza: { ok, error } */
export async function recalcularPlan(clienteId: string): Promise<{ ok: true } | { ok: false; error: string; estado: number }> {
  let res: Response
  try {
    res = await fetch('/api/fba/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId }) })
  } catch {
    return { ok: false, error: 'No hay conexión con el servidor: comprueba la red y vuelve a probar.', estado: 0 }
  }
  const r = await leerRespuesta<unknown>(res, 'No se ha podido recalcular el plan')
  invalidarRemesas(clienteId)
  return r.ok ? { ok: true } : { ok: false, error: r.error, estado: r.estado }
}

export function usePlan(clienteId: string | null, opciones: { todas?: boolean; pagina?: number; sku?: string } = {}) {
  const router = useRouter()
  const url = clienteId ? urlDelPlan(clienteId, opciones) : null
  const r = useAgencia<RespuestaPlan>(url, { que: 'No se ha podido leer el plan de reposición' })
  const [recalculando, setRecalculando] = useState(false)

  const recalcular = useCallback(async (): Promise<boolean> => {
    if (!clienteId) return false
    setRecalculando(true)
    try {
      const x = await recalcularPlan(clienteId)
      if (!x.ok) {
        // 429 = ya se recalculó hace menos de 2 minutos: no es un fallo, es un «espera»
        if (x.estado === 429) toast.message(x.error)
        else toast.error(x.error)
        return false
      }
      toast.success('Plan recalculado')
      router.refresh()
      return true
    } finally {
      setRecalculando(false)
    }
  }, [clienteId, router])

  const datos = r.datos
  const plan = datos?.plan ?? null
  const deAgencia = esPlanDeAgencia(plan)
  return {
    plan,
    deAgencia,
    pasada: datos && 'pasada' in datos ? datos.pasada : null,
    envios: datos && 'envios' in datos ? datos.envios : ([] as EnvioPropuestoGuardado[]),
    /** null mientras no se sepa (cliente externo o sin respuesta) */
    migracion316: datos && 'migracion316' in datos ? datos.migracion316 : null,
    cargando: r.cargando,
    error: r.error,
    estado: r.estado,
    actualizadoEn: r.actualizadoEn,
    recargar: r.recargar,
    recalcular,
    recalculando,
  }
}

export interface PlanDeCliente {
  clienteId: string
  nombre: string
  resumen: ResumenPlan | null
  calidad: CalidadDatos | null
  salud: SaludCliente
}

export function usePlanTodos(activo = true) {
  const r = useAgencia<{ envios: EnvioPropuestoGuardado[]; porCliente: PlanDeCliente[] }>(activo ? '/api/fba/plan?todos=1' : null, {
    que: 'No se han podido leer los planes de los clientes',
  })
  return {
    envios: r.datos?.envios ?? [],
    porCliente: r.datos?.porCliente ?? [],
    cargando: r.cargando,
    error: r.error,
    estado: r.estado,
    actualizadoEn: r.actualizadoEn,
    recargar: r.recargar,
  }
}
