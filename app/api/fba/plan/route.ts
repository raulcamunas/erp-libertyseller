import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeEditar, puedeVer, requireFbaAccess, type SesionFba } from '@/lib/fba/acceso'
import { leerEnvios } from '@/lib/fba/envios-propuestos-servidor'
import { diaEnEspana } from '@/lib/fba/fechas'
import { avisarPlanCliente } from '@/lib/fba/plan-avisos'
import { estadoDePasada, planificarCliente } from '@/lib/fba/plan-cliente'
import {
  AVISO_FALTA_316,
  aCachePlan,
  calcularYGuardarCliente,
  deCachePlan,
  filtrarLineas,
  invalidarCachePlan,
  leerEntradaPlan,
  leerUltimaPasada,
} from '@/lib/fba/plan-datos'
import { faltaLaTabla } from '@/lib/fba/planificacion'
import { planParaCliente } from '@/lib/fba/recorte-cliente'
import { saludCliente } from '@/lib/fba/salud'
import type { CalidadDatos, EnvioPropuestoGuardado, EstadoEnvioPropuesto, PlanCliente, ResumenPlan, SaludCliente } from '@/lib/fba/plan-tipos'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL PLAN DE REPOSICIÓN FBA (spec remesas-pro §9 corregido por §11 D26, D28 y D32).
 *
 * GET  ?cliente=<id>[&todas=1&pagina=N | &sku=…]
 *      agencia  → { plan: PlanCliente, pasada: { id, calculadoAt, origen } | null, envios: EnvioPropuestoGuardado[], migracion316 }
 *      cliente  → { plan: PlanParaCliente | null }   (recorte sin €, prioridades, ajustes, IA ni envíos; NUNCA calcula)
 *      Sirve SIEMPRE la última pasada guardada. Solo calcula al vuelo si no hay ninguna, quien pide es la agencia y consigue el
 *      candado del cliente (dos peticiones a la vez esperan al mismo cálculo). Sin la 316 no hay pasadas: se calcula al vuelo
 *      (con la caché de 3 min) y no se guarda. Líneas por defecto: las propuestas y las que rompen en 60 días.
 * GET  ?todos=1 (agencia) → { envios (activos), porCliente: [{ clienteId, nombre, resumen, calidad, salud }], migracion316 }
 * POST { clienteId } (agencia con editar) → recalcula, guarda la pasada del día, reconcilia y avisa. 1 cada 2 min por cliente.
 *
 * Caché en memoria del proceso (`Map`, 3 min), que se vacía en cada POST y en cada pasada del cron. PROHIBIDO `unstable_cache`.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const ACTIVOS: EstadoEnvioPropuesto[] = ['nuevo', 'hablado', 'esperando_cliente', 'en_preparacion']
const ESPERA_POST_MS = 2 * 60_000

/** Candado en memoria por cliente: el cálculo en curso, que comparten las peticiones que lleguen mientras tanto */
const calculando = new Map<string, Promise<{ plan: PlanCliente; pasadaId: string | null; migracion316: boolean }>>()
/** Último recálculo a mano por cliente (tope de 1 cada 2 min) */
const ultimoPost = new Map<string, number>()

/** ¿Está la 316? Se recuerda el «sí»; el «no» se vuelve a mirar a los 5 minutos */
let migracion316Vista: { valor: boolean; hasta: number } | null = null
async function hayMigracion316(service: ReturnType<typeof createServiceClient>): Promise<boolean> {
  if (migracion316Vista && (migracion316Vista.valor || migracion316Vista.hasta > Date.now())) return migracion316Vista.valor
  // Un GET normal: una petición HEAD a una tabla que no existe contesta 204 sin error y haría creer que la 316 está lanzada
  const { error } = await service.from('fba_plan_pasadas').select('id').limit(1)
  const valor = !(error && faltaLaTabla(error))
  if (error && !faltaLaTabla(error)) throw error
  migracion316Vista = { valor, hasta: Date.now() + 5 * 60_000 }
  return valor
}

const sinCache = { 'Cache-Control': 'no-store' }

function opcionesDeLineas(p: URLSearchParams): { lineas: 'propuestas' | 'todas'; sku?: string; pagina?: number } {
  const sku = (p.get('sku') ?? '').trim().slice(0, 80)
  const pagina = Number(p.get('pagina'))
  return {
    lineas: p.get('todas') === '1' ? 'todas' : 'propuestas',
    sku: sku || undefined,
    pagina: Number.isFinite(pagina) && pagina >= 1 ? Math.floor(pagina) : undefined,
  }
}

/** Calcula (y guarda si hay 316) compartiendo el cálculo en curso del mismo cliente */
function calcularConCandado(clienteId: string, hoy: string, guardar: boolean): Promise<{ plan: PlanCliente; pasadaId: string | null; migracion316: boolean }> {
  const enCurso = calculando.get(clienteId)
  if (enCurso) return enCurso
  const p = (async () => {
    const service = createServiceClient()
    if (guardar) {
      const r = await calcularYGuardarCliente(service, clienteId, hoy, 'manual')
      if (r.pasadaId) await avisarPlanCliente(service, { clienteId, clienteNombre: r.clienteNombre, hoy, plan: r.plan, avisar: r.avisar })
      return { plan: r.plan, pasadaId: r.pasadaId, migracion316: r.migracion316 }
    }
    // Sin la 316: solo en memoria
    const leida = await leerEntradaPlan(service, clienteId, hoy)
    const plan = planificarCliente(leida.entrada).plan
    if (!plan.calidad.avisos.includes(AVISO_FALTA_316)) plan.calidad.avisos.push(AVISO_FALTA_316)
    return { plan, pasadaId: null, migracion316: false }
  })()
  calculando.set(clienteId, p)
  p.finally(() => calculando.delete(clienteId)).catch(() => {})
  return p
}

async function enviosDelCliente(service: ReturnType<typeof createServiceClient>, sesion: SesionFba, clienteId: string, hoy: string, migracion316: boolean): Promise<EnvioPropuestoGuardado[]> {
  if (!migracion316) return []
  const r = await leerEnvios(service, sesion, { clienteId, estados: ACTIVOS }, hoy)
  return r.envios
}

/* ------------------------------------------------------------------ */
/* GET                                                                 */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams
    if (p.get('todos') === '1') return await todos()

    const clienteId = p.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')
    const sesion = await requireFbaAccess('ver', clienteId)
    if (sesion instanceof NextResponse) return sesion
    const service = createServiceClient()
    const hoy = diaEnEspana()

    /* ---------- cliente externo: la última pasada recortada; nunca calcula (D26) ---------- */
    if (sesion.actor !== 'agencia') {
      const clave = `cliente:${clienteId}`
      const guardado = deCachePlan<unknown>(clave)
      if (guardado !== undefined) return NextResponse.json(guardado, { headers: sinCache })
      const ultima = (await hayMigracion316(service)) ? await leerUltimaPasada(service, clienteId, { lineas: 'todas' }) : null
      const cuerpo = { plan: ultima ? planParaCliente(ultima.plan, ultima.calculadoAt) : null }
      aCachePlan(clave, cuerpo)
      return NextResponse.json(cuerpo, { headers: sinCache })
    }

    /* ---------- agencia ---------- */
    const opciones = opcionesDeLineas(p)
    const clave = `plan:${clienteId}:${opciones.lineas}:${opciones.sku ?? ''}:${opciones.pagina ?? ''}`
    const guardado = deCachePlan<unknown>(clave)
    if (guardado !== undefined) return NextResponse.json(guardado, { headers: sinCache })

    const migracion316 = await hayMigracion316(service)
    let plan: PlanCliente
    let pasada: { id: string; calculadoAt: string; origen: 'cron' | 'manual' } | null = null
    let totalLineas: number
    const ultima = migracion316 ? await leerUltimaPasada(service, clienteId, opciones) : null
    if (ultima) {
      plan = ultima.plan
      totalLineas = ultima.totalLineas
      pasada = { id: ultima.pasada.id, calculadoAt: ultima.pasada.calculadoAt, origen: ultima.pasada.origen }
    } else {
      // Sin ninguna pasada: se calcula al vuelo (y se guarda si está la 316), con el candado del cliente
      const r = await calcularConCandado(clienteId, hoy, migracion316)
      plan = { ...r.plan, lineas: filtrarLineas(r.plan.lineas, r.plan.hoy, opciones) }
      totalLineas = r.plan.lineas.length
      if (r.pasadaId) pasada = { id: r.pasadaId, calculadoAt: r.plan.calidad.calculadoAt ?? new Date().toISOString(), origen: 'manual' }
    }
    if (!migracion316 && !plan.calidad.avisos.includes(AVISO_FALTA_316)) plan.calidad.avisos.push(AVISO_FALTA_316)

    const envios = await enviosDelCliente(service, sesion, clienteId, hoy, migracion316)
    const cuerpo = { plan, pasada, envios, migracion316, totalLineas, estado: estadoDePasada(plan) }
    aCachePlan(clave, cuerpo)
    return NextResponse.json(cuerpo, { headers: sinCache })
  } catch (error) {
    return errorResponse(error, 'No se ha podido leer el plan de reposición')
  }
}

/* ------------------------------------------------------------------ */
/* GET ?todos=1                                                        */
/* ------------------------------------------------------------------ */

async function todos(): Promise<NextResponse> {
  const sesion = await requireFbaAccess('ver')
  if (sesion instanceof NextResponse) return sesion
  if (sesion.actor !== 'agencia') return fail(403, 'El plan de todos los clientes es de Liberty Seller')
  const permitidos = sesion.clientesPermitidos
  const clave = `todos:${permitidos === null ? '*' : [...permitidos].sort().join(',')}`
  const guardado = deCachePlan<unknown>(clave)
  if (guardado !== undefined) return NextResponse.json(guardado, { headers: sinCache })

  const service = createServiceClient()
  const hoy = diaEnEspana()
  if (!(await hayMigracion316(service))) {
    const cuerpo = { envios: [], porCliente: [], migracion316: false, aviso: AVISO_FALTA_316 }
    return NextResponse.json(cuerpo, { headers: sinCache })
  }

  let q = service.from('fba_plan_ultima').select('client_id, calculado_at, estado, resumen, calidad')
  if (permitidos) q = q.in('client_id', permitidos)
  const { data: ultimas, error } = await q
  if (error) throw error
  const filas = (ultimas ?? []) as Array<{ client_id: string; calculado_at: string; estado: string; resumen: unknown; calidad: unknown }>
  const ids = filas.map((f) => f.client_id)

  const [{ data: nombres }, { data: activos }, { data: enviadas }, envios] = await Promise.all([
    ids.length ? service.from('amazon_clients').select('id, name').in('id', ids) : Promise.resolve({ data: [] }),
    ids.length ? service.from('fba_reposicion_config').select('client_id, planificador_activo').in('client_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? service.from('fba_remesas').select('client_id').in('client_id', ids).in('estado', ['enviada', 'cerrada']).limit(5000) : Promise.resolve({ data: [] }),
    leerEnvios(service, sesion, { estados: ACTIVOS }, hoy),
  ])
  const nombreDe = new Map(((nombres ?? []) as Array<{ id: string; name: string | null }>).map((c) => [c.id, c.name ?? 'Cliente'] as const))
  const activoDe = new Map(((activos ?? []) as Array<{ client_id: string; planificador_activo: boolean | null }>).map((a) => [a.client_id, a.planificador_activo !== false] as const))
  const conEnvios = new Set(((enviadas ?? []) as Array<{ client_id: string }>).map((r) => r.client_id))

  const objeto = <T,>(v: unknown): T | null => (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length ? (v as T) : null)
  const porCliente: Array<{ clienteId: string; nombre: string; resumen: ResumenPlan | null; calidad: CalidadDatos | null; salud: SaludCliente; calculadoAt: string }> = filas
    .filter((f) => puedeVer(sesion, f.client_id))
    .map((f) => {
      const resumen = objeto<ResumenPlan>(f.resumen)
      const calidad = objeto<CalidadDatos>(f.calidad)
      return {
        clienteId: f.client_id,
        nombre: nombreDe.get(f.client_id) ?? 'Cliente',
        resumen,
        calidad,
        salud: saludCliente(resumen, calidad, {
          activo: activoDe.get(f.client_id) ?? true,
          movimientos90: calidad?.libro === 'sin_leer' || !resumen || resumen.referencias === 0 ? 0 : 1,
          primerEnvio: !conEnvios.has(f.client_id),
        }),
        calculadoAt: f.calculado_at,
      }
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  const cuerpo = { envios: envios.envios, porCliente, migracion316: envios.migracion316 }
  aCachePlan(clave, cuerpo)
  return NextResponse.json(cuerpo, { headers: sinCache })
}

/* ------------------------------------------------------------------ */
/* POST                                                                */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { clienteId?: unknown }
    const clienteId = typeof body.clienteId === 'string' ? body.clienteId : ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')
    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (sesion.actor !== 'agencia') return fail(403, 'El plan lo recalcula Liberty Seller')
    if (!puedeEditar(sesion, clienteId)) return fail(403, 'Tu acceso a esta cuenta es solo de lectura')

    const antes = ultimoPost.get(clienteId)
    if (antes && Date.now() - antes < ESPERA_POST_MS && !calculando.has(clienteId)) {
      const s = Math.ceil((ESPERA_POST_MS - (Date.now() - antes)) / 1000)
      return fail(429, `El plan se acaba de recalcular: espera ${s} s para volver a hacerlo`)
    }
    ultimoPost.set(clienteId, Date.now())

    const service = createServiceClient()
    const hoy = diaEnEspana()
    const migracion316 = await hayMigracion316(service)
    invalidarCachePlan(clienteId)
    let r: Awaited<ReturnType<typeof calcularConCandado>>
    try {
      r = await calcularConCandado(clienteId, hoy, migracion316)
    } catch (error) {
      // Un fallo no gasta el turno de 2 minutos
      ultimoPost.delete(clienteId)
      throw error
    }
    invalidarCachePlan(clienteId)

    const envios = await enviosDelCliente(service, sesion, clienteId, hoy, r.migracion316)
    const plan = { ...r.plan, lineas: filtrarLineas(r.plan.lineas, r.plan.hoy, { lineas: 'propuestas' }) }
    return NextResponse.json(
      {
        plan,
        pasada: r.pasadaId ? { id: r.pasadaId, calculadoAt: r.plan.calidad.calculadoAt ?? new Date().toISOString(), origen: 'manual' as const } : null,
        envios,
        migracion316: r.migracion316,
        totalLineas: r.plan.lineas.length,
        estado: estadoDePasada(r.plan),
      },
      { headers: sinCache },
    )
  } catch (error) {
    return errorResponse(error, 'No se ha podido recalcular el plan de reposición')
  }
}
