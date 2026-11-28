import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { campanasDe } from './campanas'
import { leerFicha } from './cuenta'
import { ajustesDeUbicacionDe } from './escritura'
import { descargarInformeCrudo, estadoInforme, pedirInformeUbicaciones } from './informes'
import { objetivosDeCuenta } from './motor'
import { asinDeCampana } from './productos-agrupar'
import { partesDeNombre } from './reglas'
import type { CuentaParaSincronizar } from './sincronizar'
import { cvrsDeCuenta, leerUmbrales } from './umbrales-cuenta'
import { NOMBRE_DE_UBICACION, proponerUbicaciones, ubicacionDeInforme, UBICACIONES, type CampanaParaUbicaciones, type MetricasDeUbicacion, type Ubicacion } from './ubicaciones-calculo'
import { AGENTE, type AjustesDelAgenteParaPujas } from './agente/tipos'

/**
 * AMAZON ADS · EL AJUSTE POR UBICACIÓN (SOLO SERVIDOR). Las reglas están en ubicaciones-calculo.ts.
 *
 * El informe por campaña y ubicación se pide una vez al día dentro de la generación diaria del motor (motor-cron): la generación RECOGE el que pidió el día
 * anterior (14 días que acaban 3 antes de hoy: las ventas de los últimos días aún se atribuyen), propone con él y PIDE el siguiente. Con 14 días de datos, uno
 * de retraso no cambia nada y así nada se queda esperando a Amazon.
 *
 * Cuarentena: una campaña con una propuesta de ubicación pendiente, o resuelta hace menos de 14 días, en esa misma ubicación, no se vuelve a tocar.
 * En modo agente: el objetivo para BAJAR del producto (con su postura), sin subidas si el producto o la cuenta no las permiten, las campañas de marca con la
 * mitad del objetivo y sin subidas, y nada de los productos congelados por Buy Box. El agente NO las aplica solo: las deja para una persona (aplicar-servidor).
 */

const DIA = 86_400_000
const VENTANA_DIAS = 14
const DIAS_SIN_CERRAR = 3
const CUARENTENA_DIAS = 14
/** El informe recogido sirve para proponer mientras no tenga más de 3 días */
const VALIDO_DIAS = 3
const ESPERA_MAXIMA_MS = 3 * 3_600_000
const dia = (ms: number) => new Date(ms).toISOString().slice(0, 10)

type FilaGuardada = { campaignId: string; ubicacion: Ubicacion } & MetricasDeUbicacion

interface EstadoDeUbicaciones {
  report_id: string | null
  pedido_at: string | null
  pedido_desde: string | null
  pedido_hasta: string | null
  desde: string | null
  hasta: string | null
  filas: FilaGuardada[]
  leido_at: string | null
}

async function leerEstado(perfilId: string): Promise<EstadoDeUbicaciones | null | 'sin_tabla'> {
  const { data, error } = await createServiceClient().from('ads_ubicaciones').select('report_id, pedido_at, pedido_desde, pedido_hasta, desde, hasta, filas, leido_at').eq('perfil_id', perfilId).maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return 'sin_tabla'
    throw error
  }
  return (data as EstadoDeUbicaciones | null) ?? null
}

async function guardar(perfilId: string, cambios: Partial<EstadoDeUbicaciones> & { error?: string | null }): Promise<void> {
  const { error } = await createServiceClient().from('ads_ubicaciones').upsert({ perfil_id: perfilId, ...cambios, updated_at: new Date().toISOString() }, { onConflict: 'perfil_id' })
  if (error) throw error
}

/** Las filas del informe sumadas por campaña y ubicación (Amazon puede mandar varias por la misma) */
export function filasDeUbicaciones(crudas: ReadonlyArray<Record<string, unknown>>): FilaGuardada[] {
  const suma = new Map<string, FilaGuardada>()
  for (const f of crudas) {
    const u = ubicacionDeInforme(f.placementClassification as string | undefined)
    const id = String(f.campaignId ?? '')
    if (!u || !id) continue
    const k = `${id}:${u}`
    const x = suma.get(k) ?? { campaignId: id, ubicacion: u, clics: 0, gasto: 0, ventas: 0, pedidos: 0 }
    x.clics += Number(f.clicks ?? 0) || 0
    x.gasto += Number(f.cost ?? 0) || 0
    x.ventas += Number(f.sales7d ?? 0) || 0
    x.pedidos += Number(f.purchases7d ?? 0) || 0
    suma.set(k, x)
  }
  return [...suma.values()]
}

/**
 * RECOGER el informe pedido (si está) y, con `pedir`, PEDIR el siguiente si toca (el último recogido tiene más de 20 h y no hay otro en marcha). Nunca lanza por
 * Amazon: lo que falla queda en `error` y se dice en la respuesta. Sin la migración 355, no hace nada.
 */
export async function avanzarUbicaciones(cuenta: CuentaParaSincronizar, opciones: { pedir: boolean }): Promise<{ accion: string }> {
  const estado = await leerEstado(cuenta.id)
  if (estado === 'sin_tabla') return { accion: 'falta la migración 355' }
  const ahora = Date.now()
  let recogido = false
  if (estado?.report_id) {
    try {
      const e = await estadoInforme(cuenta.conexionId, cuenta.profileId, estado.report_id)
      if (e.estado === 'COMPLETED' && e.url) {
        const filas = filasDeUbicaciones(await descargarInformeCrudo(e.url))
        await guardar(cuenta.id, { report_id: null, pedido_at: estado.pedido_at, desde: estado.pedido_desde, hasta: estado.pedido_hasta, filas, leido_at: new Date().toISOString(), error: null })
        recogido = true
      } else if (e.estado === 'FAILED' || (estado.pedido_at && ahora - Date.parse(estado.pedido_at) > ESPERA_MAXIMA_MS)) {
        await guardar(cuenta.id, { report_id: null, error: `Informe de ubicaciones ${e.estado === 'FAILED' ? `fallido${e.detalle ? `: ${e.detalle}` : ''}` : 'sin terminar en 3 h'}`.slice(0, 400) })
      } else return { accion: 'esperando' }
    } catch (err) {
      await guardar(cuenta.id, { report_id: null, error: `Recoger ubicaciones: ${err instanceof Error ? err.message : String(err)}`.slice(0, 400) }).catch(() => undefined)
    }
  }
  if (!opciones.pedir) return { accion: recogido ? 'recogido' : 'nada' }
  const ultimo = recogido ? ahora : estado?.leido_at ? Date.parse(estado.leido_at) : 0
  if (ahora - ultimo < 20 * 3_600_000) return { accion: recogido ? 'recogido' : 'al día' }
  const hasta = dia(ahora - DIAS_SIN_CERRAR * DIA)
  const desde = dia(Date.parse(`${hasta}T00:00:00Z`) - (VENTANA_DIAS - 1) * DIA)
  try {
    const id = await pedirInformeUbicaciones(cuenta.conexionId, cuenta.profileId, desde, hasta)
    await guardar(cuenta.id, { report_id: id, pedido_at: new Date().toISOString(), pedido_desde: desde, pedido_hasta: hasta, error: null })
    return { accion: recogido ? 'recogido y pedido' : 'pedido' }
  } catch (err) {
    await guardar(cuenta.id, { error: `Pedir ubicaciones: ${err instanceof Error ? err.message : String(err)}`.slice(0, 400) }).catch(() => undefined)
    return { accion: 'no se ha podido pedir' }
  }
}

/** Genera las propuestas de ajuste por ubicación con el último informe recogido (si tiene ≤ 3 días). Devuelve cuántas ha creado */
export async function generarPropuestasDeUbicacion(cuenta: CuentaParaSincronizar, ajustes?: AjustesDelAgenteParaPujas): Promise<{ nuevas: number; omitido?: string }> {
  const estado = await leerEstado(cuenta.id)
  if (estado === 'sin_tabla') return { nuevas: 0, omitido: 'falta la migración 355' }
  if (!estado?.leido_at || !estado.filas?.length) return { nuevas: 0, omitido: 'sin informe de ubicaciones todavía' }
  if (Date.now() - Date.parse(estado.leido_at) > VALIDO_DIAS * DIA) return { nuevas: 0, omitido: 'informe de ubicaciones viejo' }

  const service = createServiceClient()
  const ficha = await leerFicha(cuenta.id)
  const [objetivos, { umbrales }, { campanas }] = await Promise.all([objetivosDeCuenta(cuenta.id, ficha), leerUmbrales(cuenta.id), campanasDe(cuenta.conexionId, cuenta.profileId)])
  const cvrs = await cvrsDeCuenta(cuenta.id, umbrales.cvrPorDefectoPct)

  // Cuarentena por campaña y ubicación
  const desdeCuarentena = new Date(Date.now() - CUARENTENA_DIAS * DIA).toISOString()
  const { data: previas, error: ePrevias } = await service
    .from('ads_propuestas')
    .select('campaign_id, objetivo_tipo, estado, resuelta_at')
    .eq('perfil_id', cuenta.id)
    .eq('tipo', 'ubicacion')
    .or(`estado.eq.pendiente,resuelta_at.gte.${desdeCuarentena}`)
    .limit(2000)
  if (ePrevias) throw ePrevias
  const bloqueadas = new Set<string>()
  for (const r of (previas ?? []) as Array<{ campaign_id: string; objetivo_tipo: string | null; estado: string }>) if (r.estado !== 'caducada' && r.objetivo_tipo) bloqueadas.add(`${r.campaign_id}:${r.objetivo_tipo}`)

  const metricasDe = new Map<string, Partial<Record<Ubicacion, MetricasDeUbicacion>>>()
  for (const f of estado.filas) {
    const m = metricasDe.get(f.campaignId) ?? {}
    m[f.ubicacion] = { clics: f.clics, gasto: f.gasto, ventas: f.ventas, pedidos: f.pedidos }
    metricasDe.set(f.campaignId, m)
  }
  const marca = new Set(ajustes?.campanasDeMarca ?? [])
  const congelados = new Set((ajustes?.congeladosPorBuyBox ?? []).map((a) => a.toUpperCase()))
  const entrada: CampanaParaUbicaciones[] = []
  for (const c of campanas) {
    if (c.estado !== 'ENABLED' || !partesDeNombre(c.nombre)) continue
    const asin = asinDeCampana(c.nombre)
    if (!asin || congelados.has(asin.toUpperCase())) continue
    const o = objetivos.porAsin.get(asin)
    const m = metricasDe.get(c.campaignId)
    if (!o || !m) continue
    let acos = o.acosObjetivoPct
    let sinSubidas = false
    if (ajustes) {
      const pa = ajustes.porAsin[asin] ?? ajustes.porAsin[asin.toUpperCase()]
      if (!pa) continue
      acos = pa.acosParaBajar
      sinSubidas = ajustes.sinSubidas || pa.sinSubidas
    }
    if (marca.has(c.campaignId)) {
      acos = acos * AGENTE.MARCA_ACOS_X
      sinSubidas = true
    }
    const actuales = ajustesDeUbicacionDe(c.crudo)
    const ajustesC: Partial<Record<Ubicacion, number>> = {}
    for (const u of UBICACIONES) ajustesC[u] = actuales[u] ?? 0
    entrada.push({ campaignId: c.campaignId, campaignName: c.nombre, asin, acosObjetivoPct: Math.round(acos * 100) / 100, cvr: cvrs.de(c.campaignId, asin).cvr, ajustes: ajustesC, metricas: m, sinSubidas })
  }

  let nuevas = 0
  for (const p of proponerUbicaciones(entrada, ficha.muestraMinimaClics, bloqueadas)) {
    const { error } = await service.from('ads_propuestas').insert({
      perfil_id: cuenta.id,
      tipo: 'ubicacion',
      asin: p.asin,
      termino: NOMBRE_DE_UBICACION[p.ubicacion],
      campaign_id: p.campaignId,
      campaign_nombre: p.campaignName,
      desde_rol: partesDeNombre(p.campaignName)?.rol ?? null,
      motivo: p.motivo,
      metricas: { ...p.metricas, ubicacion: p.ubicacion, desde: estado.desde, hasta: estado.hasta },
      objetivo_id: `${p.campaignId}:${p.ubicacion}`,
      objetivo_tipo: p.ubicacion,
      valor_actual: p.pctActual,
      valor_nuevo: p.pctNuevo,
    })
    if (!error) nuevas += 1
    else if (error.code === '23514') return { nuevas, omitido: 'falta la migración 355' }
    else if (error.code !== '23505') throw error
  }
  return { nuevas }
}
