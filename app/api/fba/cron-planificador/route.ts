import { NextResponse, type NextRequest } from 'next/server'
import { diaEnEspana } from '@/lib/fba/fechas'
import { revisarPendientesIa } from '@/lib/fba/ia-plan-servidor'
import { avisarPlanCliente, resumenDelDiaAlChat } from '@/lib/fba/plan-avisos'
import { calcularYGuardarCliente, guardarPasadaConError, invalidarCachePlan } from '@/lib/fba/plan-datos'
import { faltaLaTabla } from '@/lib/fba/planificacion'
import { sumarDias } from '@/lib/fba/planificador'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL PLANIFICADOR DE REPOSICIÓN FBA, CADA 15 MINUTOS (spec remesas-pro §9 y §11 D31).
 *
 * 1. Mira qué clientes tienen ALGO NUEVO desde su última pasada: el libro leído (`fba_lecturas.updated_at`), sus remesas, sus envíos
 *    propuestos, sus ajustes o plazos, un envío en preparación que se ha quedado sin remesa; o que no tienen pasada de hoy. Si no hay
 *    ninguno, contesta «nada nuevo» y no lee nada más.
 * 2. Los calcula del que lleva más tiempo sin calcular al que menos (calcula, guarda la pasada, reconcilia y avisa), mientras quede
 *    presupuesto (280 s en total, `maxDuration` 300). Los que no caben van primero en la siguiente.
 * 3. Con el tiempo que sobre, la IA revisa como mucho 3 pasadas pendientes (2 a la vez, 30 s cada una): `revisarPendientesIa`.
 * 4. El resumen del día al chat (desde las 9, como mucho uno) y, una vez al día, la limpieza: fuera los resúmenes de más de 60 días y
 *    vacías las líneas de más de 7 (menos las de la última pasada de cada cliente).
 *
 * Solo LEE de la base del ERP lo que viene de Amazon; no llama a Amazon. Escribe las pasadas, los envíos propuestos y los avisos.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/** Presupuesto total de la ejecución */
const PRESUPUESTO_MS = 280_000
/** No se empieza un cliente nuevo con menos de esto por delante (el más pesado, ShoesF, tarda ~3 s; con margen) */
const MARGEN_CLIENTE_MS = 25_000
/** La IA solo si quedan al menos esto */
const MINIMO_IA_MS = 40_000
/** Hora de España desde la que sale el resumen del día */
const HORA_RESUMEN = 9

/** Última limpieza hecha por este proceso (una al día) */
let limpiadoEl: string | null = null

type Servicio = ReturnType<typeof createServiceClient>

/** El instante más reciente de una lista de filas `{ client_id, t }` por cliente */
function maximoPorCliente(filas: Array<{ client_id: string | null; t: string | null }>, destino: Map<string, string>): void {
  for (const f of filas) {
    if (!f.client_id || !f.t) continue
    const previo = destino.get(f.client_id)
    if (!previo || f.t > previo) destino.set(f.client_id, f.t)
  }
}

/** Los clientes con algo nuevo desde su última pasada, del más atrasado al menos */
async function clientesConAlgoNuevo(service: Servicio, hoy: string): Promise<{ pendientes: string[]; total: number } | null> {
  const { data: cons, error } = await service.from('amazon_connections').select('id, client_id').eq('is_active', true).not('client_id', 'is', null)
  if (error) throw error
  const conexiones = (cons ?? []) as Array<{ id: string; client_id: string }>
  const ids = [...new Set(conexiones.map((c) => c.client_id))]
  if (ids.length === 0) return { pendientes: [], total: 0 }

  const [cfg, ultimas] = await Promise.all([
    service.from('fba_reposicion_config').select('client_id, planificador_activo').in('client_id', ids),
    service.from('fba_plan_ultima').select('client_id, hoy, calculado_at, estado').in('client_id', ids),
  ])
  if (cfg.error && faltaLaTabla(cfg.error)) return null
  if (cfg.error) throw cfg.error
  if (ultimas.error) throw ultimas.error
  const apagados = new Set(((cfg.data ?? []) as Array<{ client_id: string; planificador_activo: boolean | null }>).filter((c) => c.planificador_activo === false).map((c) => c.client_id))
  const activos = ids.filter((id) => !apagados.has(id))
  const ultima = new Map(((ultimas.data ?? []) as Array<{ client_id: string; hoy: string; calculado_at: string; estado: string }>).map((u) => [u.client_id, u] as const))

  // Sin pasada de hoy, o la de hoy falló hace más de una hora: se vuelve a probar
  const haceUnaHora = new Date(Date.now() - 60 * 60_000).toISOString()
  const sinHoy = activos.filter((id) => {
    const u = ultima.get(id)
    return !u || String(u.hoy).slice(0, 10) !== hoy || (u.estado === 'error' && u.calculado_at < haceUnaHora)
  })
  const conHoy = activos.filter((id) => !sinHoy.includes(id))
  const cambios = new Map<string, string>()
  if (conHoy.length) {
    // Desde la pasada más vieja de las de hoy: lo que haya cambiado después
    const desde = conHoy.map((id) => ultima.get(id)!.calculado_at).sort()[0]
    const deConexion = new Map(conexiones.map((c) => [c.id, c.client_id] as const))
    const [lec, rem, env, huer, rcfg, rsku, acfg, asku] = await Promise.all([
      service.from('fba_lecturas').select('connection_id, updated_at').in('connection_id', conexiones.filter((c) => conHoy.includes(c.client_id)).map((c) => c.id)).gt('updated_at', desde),
      service.from('fba_remesas').select('client_id, updated_at').in('client_id', conHoy).gt('updated_at', desde).limit(2000),
      service.from('fba_envios_propuestos').select('client_id, actualizado_at').in('client_id', conHoy).gt('actualizado_at', desde).limit(2000),
      service.from('fba_envios_propuestos').select('client_id').in('client_id', conHoy).eq('estado', 'en_preparacion').is('remesa_id', null).limit(200),
      service.from('fba_reposicion_config').select('client_id, actualizado_at').in('client_id', conHoy).gt('actualizado_at', desde),
      service.from('fba_reposicion_sku').select('client_id, actualizado_at').in('client_id', conHoy).gt('actualizado_at', desde).limit(2000),
      service.from('fba_alertas_config').select('client_id, actualizado_at').in('client_id', conHoy).gt('actualizado_at', desde),
      service.from('fba_alertas_plazo_sku').select('client_id, actualizado_at').in('client_id', conHoy).gt('actualizado_at', desde).limit(2000),
    ])
    maximoPorCliente(((lec.data ?? []) as Array<{ connection_id: string; updated_at: string }>).map((l) => ({ client_id: deConexion.get(l.connection_id) ?? null, t: l.updated_at })), cambios)
    maximoPorCliente(((rem.data ?? []) as Array<{ client_id: string; updated_at: string }>).map((r) => ({ client_id: r.client_id, t: r.updated_at })), cambios)
    for (const q of [env, rcfg, rsku, acfg, asku]) {
      maximoPorCliente(((q.data ?? []) as Array<{ client_id: string; actualizado_at: string }>).map((r) => ({ client_id: r.client_id, t: r.actualizado_at })), cambios)
    }
    // Un huérfano siempre pide pasada (la reconciliación lo devuelve a «hablado»)
    for (const h of (huer.data ?? []) as Array<{ client_id: string }>) cambios.set(h.client_id, '9999')
  }
  const conCambios = conHoy.filter((id) => {
    const t = cambios.get(id)
    return !!t && t > ultima.get(id)!.calculado_at
  })
  const calculadoDe = (id: string) => ultima.get(id)?.calculado_at ?? ''
  const pendientes = [
    ...sinHoy.sort((a, b) => calculadoDe(a).localeCompare(calculadoDe(b))),
    ...conCambios.sort((a, b) => calculadoDe(a).localeCompare(calculadoDe(b))),
  ]
  return { pendientes, total: activos.length }
}

/** Una vez al día: fuera las pasadas de más de 60 días y vacías las líneas de las de más de 7 (menos la última de cada cliente) */
async function limpiar(service: Servicio, hoy: string): Promise<{ borradas: number; vaciadas: number }> {
  if (limpiadoEl === hoy) return { borradas: 0, vaciadas: 0 }
  const { count: borradas, error: e1 } = await service.from('fba_plan_pasadas').delete({ count: 'exact' }).lt('hoy', sumarDias(hoy, -60))
  if (e1) throw e1
  const { data: ultimas } = await service.from('fba_plan_ultima').select('id')
  const proteger = ((ultimas ?? []) as Array<{ id: string }>).map((u) => u.id)
  let q = service.from('fba_plan_pasadas').update({ lineas: [] }, { count: 'exact' }).lt('hoy', sumarDias(hoy, -7))
  if (proteger.length) q = q.not('id', 'in', `(${proteger.join(',')})`)
  const { count: vaciadas, error: e2 } = await q
  if (e2) throw e2
  limpiadoEl = hoy
  return { borradas: borradas ?? 0, vaciadas: vaciadas ?? 0 }
}

const horaEnEspana = (): number => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date()))

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('fba-planificador')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  const salida = await conRegistro('fba-planificador', lanzadoPorDe(request.headers), async () => {
    const arranque = Date.now()
    const queda = () => PRESUPUESTO_MS - (Date.now() - arranque)
    const service = createServiceClient()
    const hoy = diaEnEspana()

    const pendientes = await clientesConAlgoNuevo(service, hoy)
    if (pendientes === null) return { resumen: 'falta lanzar la migración 316_fba_planificador.sql', calculados: 0 }

    const hechos: Array<{ cliente: string; estado: string; envios: number; insertados: number; caducados: number; avisos: number; ms: number }> = []
    const errores: Array<{ cliente: string; error: string }> = []
    let sinTiempo = 0
    for (const clienteId of pendientes.pendientes) {
      if (queda() < MARGEN_CLIENTE_MS + MINIMO_IA_MS / 2) {
        sinTiempo++
        continue
      }
      const t0 = Date.now()
      try {
        const r = await calcularYGuardarCliente(service, clienteId, hoy, 'cron')
        let avisos = 0
        if (r.pasadaId) {
          const a = await avisarPlanCliente(service, { clienteId, clienteNombre: r.clienteNombre, hoy, plan: r.plan, avisar: r.avisar })
          avisos = a.campana + a.chat
        }
        hechos.push({
          cliente: r.clienteNombre, estado: r.estado, envios: r.plan.envios.length,
          insertados: r.reconciliacion?.insertados ?? 0, caducados: r.reconciliacion?.caducados ?? 0, avisos, ms: Date.now() - t0,
        })
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : String(error)
        console.error('[fba-planificador]', clienteId, error)
        errores.push({ cliente: clienteId, error: mensaje.slice(0, 200) })
        await guardarPasadaConError(service, clienteId, hoy, 'cron', mensaje)
      }
    }
    invalidarCachePlan()

    // La IA, fuera del bucle y con lo que sobre (D31)
    let ia: { revisados: string[]; quedan: number } = { revisados: [], quedan: 0 }
    if (queda() >= MINIMO_IA_MS) {
      ia = await revisarPendientesIa({ presupuestoMs: queda() - 5_000, maxClientes: 3, concurrencia: 2, timeoutMs: 30_000 })
    }

    let resumenChat = false
    if (horaEnEspana() >= HORA_RESUMEN) resumenChat = await resumenDelDiaAlChat(service, hoy)

    let limpieza = { borradas: 0, vaciadas: 0 }
    try {
      limpieza = await limpiar(service, hoy)
    } catch (error) {
      console.error('[fba-planificador] limpieza', error)
    }

    const resumen = pendientes.pendientes.length === 0
      ? `nada nuevo (${pendientes.total} clientes al día)`
      : [
          `${hechos.length} de ${pendientes.pendientes.length} clientes calculados`,
          hechos.reduce((t, h) => t + h.insertados, 0) ? `${hechos.reduce((t, h) => t + h.insertados, 0)} envíos propuestos nuevos` : null,
          errores.length ? `${errores.length} con error` : null,
          sinTiempo ? `${sinTiempo} sin tiempo (van primero en la siguiente)` : null,
          ia.revisados.length ? `IA: ${ia.revisados.length} revisados` : null,
        ].filter(Boolean).join(' · ')
    return { resumen, calculados: hechos.length, hechos, errores, sinTiempo, ia, resumenChat, limpieza, duracionMs: Date.now() - arranque }
  })

  return NextResponse.json({ ok: true, ...salida })
}
