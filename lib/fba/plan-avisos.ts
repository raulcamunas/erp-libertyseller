import { publicarEnElChat } from '@/lib/chat/sistema-servidor'
import { createServiceClient } from '@/lib/supabase/service'
import { faltaLaTabla } from './planificacion'
import { enviosActivosConAvisos } from './plan-datos'
import { reglaDeAcceso } from './regla-acceso'
import { avisoDatosChat, avisosQueTocan, avisoTardeChat, resumenDiarioChat, type AvisoDePlan } from './trabajo-plan'
import type { PlanCliente } from './plan-tipos'

/**
 * LOS AVISOS DEL PLAN: CAMPANA Y #notificaciones-erp (spec remesas-pro §4.4 y §11 D24). SOLO ESCRIBE AVISOS.
 * =========================================================================================================
 * Qué toca avisar lo decide `trabajo-plan.ts` (puro); aquí solo se escribe:
 *
 *   · Campana (`notifications`, tipo `fba_alerta`, que ya está en el CHECK): al responsable del envío propuesto o, sin responsable, al
 *     grupo (admins y empleados con la casilla `remesas`, vía `reglaDeAcceso`, y la agencia con acceso a ese cliente). `datos` lleva
 *     `envioPropuestoId` y `url` (la de `urlDeEnvioPropuesto`): la campana y el push abren el envío en el plan. La clave es única por
 *     persona (`user_id, clave`): aunque se llame dos veces, no se duplica.
 *   · Chat (`publicarEnElChat(..., { avisar: false })`: la campana ya la cubre el aviso de arriba): el envío que pasa a «tarde», el
 *     resumen del día (como mucho uno) y, una vez por semana, el cliente con el libro > 7 días atrasado.
 *
 * Se respetan `fba_alertas_config.avisar` (campana) y `fba_reposicion_config.avisar_chat` (chat). Nada provisional avisa salvo
 * los agotados (lo decide trabajo-plan). Nunca lanza: un aviso que no sale no puede tumbar la pasada.
 */

type Servicio = ReturnType<typeof createServiceClient>

const TROZO = 200
const recortar = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t)

/* ------------------------------------------------------------------ */
/* Destinatarios del grupo                                             */
/* ------------------------------------------------------------------ */

/** Por proceso: los perfiles de agencia y sus casillas cambian poco; se vuelven a leer cada 10 minutos */
let cacheGrupo: { hasta: number; perfiles: Array<{ id: string; role: string; puesto: string | null; casilla: boolean }> } | null = null

async function perfilesDeAgencia(service: Servicio) {
  if (cacheGrupo && cacheGrupo.hasta > Date.now()) return cacheGrupo.perfiles
  let filas: Array<{ id: string; role: string; puesto?: string | null }> = []
  const conPuesto = await service.from('profiles').select('id, role, puesto').in('role', ['admin', 'employee'])
  if (conPuesto.error) {
    const soloRol = await service.from('profiles').select('id, role').in('role', ['admin', 'employee'])
    if (soloRol.error) throw soloRol.error
    filas = (soloRol.data ?? []) as typeof filas
  } else filas = (conPuesto.data ?? []) as typeof filas
  const { data: casillas } = await service.from('user_app_permissions').select('user_id, can_access').eq('app_id', 'remesas').eq('can_access', true)
  const conCasilla = new Set(((casillas ?? []) as Array<{ user_id: string }>).map((c) => c.user_id))
  const perfiles = filas.map((f) => ({ id: f.id, role: f.role, puesto: f.puesto ?? null, casilla: conCasilla.has(f.id) }))
  cacheGrupo = { hasta: Date.now() + 10 * 60_000, perfiles }
  return perfiles
}

/**
 * Quién recibe el aviso de un envío sin responsable: la agencia que puede ver a ese cliente según `reglaDeAcceso` (admins,
 * empleados con la casilla `remesas` y empleados con `fba_accesos` de ese cliente). Nunca un cliente externo.
 */
export async function destinatariosDelGrupo(service: Servicio, clienteId: string): Promise<string[]> {
  const perfiles = await perfilesDeAgencia(service)
  const { data: accesos } = await service.from('fba_accesos').select('user_id, puede_editar').eq('client_id', clienteId)
  const accesoDe = new Map(((accesos ?? []) as Array<{ user_id: string; puede_editar: boolean | null }>).map((a) => [a.user_id, a.puede_editar === true] as const))
  const ids: string[] = []
  for (const p of perfiles) {
    const regla = reglaDeAcceso({
      role: p.role,
      puesto: p.puesto,
      casillaRemesas: p.casilla,
      accesos: accesoDe.has(p.id) ? [{ clienteId, puedeEditar: accesoDe.get(p.id)! }] : [],
    })
    if (regla.actor !== 'agencia') continue
    if (regla.clientesPermitidos === null || regla.clientesPermitidos.includes(clienteId)) ids.push(p.id)
  }
  return ids
}

/* ------------------------------------------------------------------ */
/* Campana                                                             */
/* ------------------------------------------------------------------ */

async function escribirEnCampana(service: Servicio, destinatarios: string[], aviso: AvisoDePlan, datos: Record<string, unknown>): Promise<boolean> {
  if (destinatarios.length === 0) return false
  const filas = destinatarios.map((userId) => ({
    user_id: userId,
    type: 'fba_alerta',
    title: recortar(aviso.titulo, 100),
    message: recortar(aviso.cuerpo, 260),
    clave: aviso.clave,
    datos: { ...datos, url: aviso.url },
  }))
  for (let i = 0; i < filas.length; i += TROZO) {
    const { error } = await service.from('notifications').upsert(filas.slice(i, i + TROZO), { onConflict: 'user_id,clave', ignoreDuplicates: true })
    if (error) {
      console.error('[fba/plan-avisos] campana', error.message)
      return false
    }
  }
  return true
}

export interface ResultadoAvisos {
  campana: number
  chat: number
}

/**
 * Los avisos de UN cliente tras su pasada: por cada envío propuesto que se está decidiendo, los de campana que tocan (sube de nivel o
 * vence) y el del chat si pasa a «tarde»; y el del libro atrasado (semanal). Apunta en la fila lo ya avisado. Nunca lanza.
 */
export async function avisarPlanCliente(
  service: Servicio,
  p: { clienteId: string; clienteNombre: string; hoy: string; plan: PlanCliente; avisar: boolean },
): Promise<ResultadoAvisos> {
  const salida: ResultadoAvisos = { campana: 0, chat: 0 }
  try {
    const avisarChat = p.plan.ajustes.avisarChat !== false
    const envios = await enviosActivosConAvisos(service, [p.clienteId], new Map([[p.clienteId, p.clienteNombre]]), p.hoy)
    let grupo: string[] | null = null
    const ahora = new Date().toISOString()

    for (const e of envios) {
      // El chat primero: mira la prioridad ya avisada antes de que se actualice
      const tarde = avisoTardeChat(e, { avisarChat })
      if (tarde) {
        await publicarEnElChat({ clave: tarde.clave, titulo: tarde.titulo, cuerpo: tarde.cuerpo, avisar: false })
        salida.chat++
      }

      const avisos = avisosQueTocan(e, p.hoy, { avisar: p.avisar, avisarChat })
      if (avisos.length === 0) continue
      const cambios: Record<string, unknown> = {}
      for (const a of avisos) {
        let destinatarios: string[]
        if (a.destino === 'responsable' && e.responsableId) destinatarios = [e.responsableId]
        else destinatarios = grupo ??= await destinatariosDelGrupo(service, p.clienteId)
        const escrito = await escribirEnCampana(service, destinatarios, a, {
          app: 'remesas', clienteId: p.clienteId, envioPropuestoId: e.id, prioridad: e.prioridad,
        })
        if (!escrito) continue
        salida.campana += destinatarios.length
        if (a.clave.startsWith('fba_plan_vencido:')) cambios.vencido_avisado_at = ahora
        else {
          cambios.prioridad_avisada = e.prioridad
          cambios.avisado_at = ahora
        }
      }
      if (Object.keys(cambios).length) {
        // Solo columnas de aviso: ni `version` ni `actualizado_at` (no es una acción de una persona)
        const { error } = await service.from('fba_envios_propuestos').update(cambios).eq('id', e.id)
        if (error && !faltaLaTabla(error)) console.error('[fba/plan-avisos] apuntar lo avisado', error.message)
      }
    }

    const datos = avisoDatosChat({ clienteId: p.clienteId, clienteNombre: p.clienteNombre, avisarChat }, p.plan.calidad, p.hoy)
    if (datos) {
      await publicarEnElChat({ clave: datos.clave, titulo: datos.titulo, cuerpo: datos.cuerpo, avisar: false })
      salida.chat++
    }
  } catch (error) {
    console.error('[fba/plan-avisos] avisos del cliente', p.clienteId, error)
  }
  return salida
}

/**
 * El resumen del día en #notificaciones-erp (`fba_plan_dia:<fecha>`, como mucho uno): los envíos tarde, urgentes o vencidos de los
 * clientes con `avisar_chat`. La clave del chat impide repetirlo aunque se llame en cada pasada. Nunca lanza.
 */
export async function resumenDelDiaAlChat(service: Servicio, hoy: string): Promise<boolean> {
  try {
    const { data: cfg, error } = await service.from('fba_reposicion_config').select('client_id, avisar_chat')
    if (error) {
      if (!faltaLaTabla(error)) console.error('[fba/plan-avisos] resumen: ajustes', error.message)
      return false
    }
    const sinChat = new Set(((cfg ?? []) as Array<{ client_id: string; avisar_chat: boolean | null }>).filter((c) => c.avisar_chat === false).map((c) => c.client_id))
    const envios0 = await enviosActivosConAvisos(service, null, new Map(), hoy)
    if (envios0.length === 0) return false
    const ids = [...new Set(envios0.map((e) => e.clienteId))]
    const { data: nombres } = await service.from('amazon_clients').select('id, name').in('id', ids)
    const nombreDe = new Map(((nombres ?? []) as Array<{ id: string; name: string | null }>).map((c) => [c.id, c.name ?? 'Cliente'] as const))
    const envios = envios0.map((e) => ({ ...e, clienteNombre: nombreDe.get(e.clienteId) ?? e.clienteNombre }))
    const resumen = resumenDiarioChat(envios, ids.map((id) => ({ clienteId: id, avisarChat: !sinChat.has(id) })), hoy)
    if (!resumen) return false
    await publicarEnElChat({ clave: resumen.clave, titulo: resumen.titulo, cuerpo: resumen.cuerpo, avisar: false })
    return true
  } catch (error) {
    console.error('[fba/plan-avisos] resumen del día', error)
    return false
  }
}
