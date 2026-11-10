/**
 * AMAZON ADS · LA LECTURA AUTOMÁTICA DEL RENDIMIENTO (el proceso `ads-rendimiento` y la pantalla de Marketing Test).
 * SOLO SERVIDOR. Solo LEE de Amazon; escribe únicamente en las tablas del ERP (migración 293).
 *
 * Por cuenta de anunciante hay una pequeña máquina de estados, que vive ENTERA en la base (si el contenedor se reinicia a mitad, la pasada siguiente sigue por donde iba):
 *
 *     reposo ──(toca: han pasado 3 h, o nunca se ha leído, o alguien pulsa «Actualizar»)──▶ pide los informes a Amazon ──▶ esperando
 *     esperando ──(Amazon los tiene listos)──▶ descarga, guarda las filas ──▶ reposo
 *               └─(fallan, o llevan más de 25 min)──▶ apunta el error ──▶ reposo (se reintenta a los 30 min)
 *
 * NADA SE QUEDA ESPERANDO A AMAZON: pedir y recoger son dos pasadas distintas. Quien llama a `avanzar` (el proceso cada 2 minutos, o la propia pantalla al abrirse) da UN paso y sigue.
 *
 *
 * QUÉ SE LEE
 *   · La primera vez, 60 días (dos informes de 30: Amazon limita el desglose diario a unos 31 por informe), para poder comparar un periodo con el anterior.
 *   · Después, los últimos 14 días cada vez, porque Amazon corrige las ventas atribuidas durante unas dos semanas: las filas se SOBRESCRIBEN (la clave es cuenta + día + campaña).
 *   · Se conservan 90 días.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { AdsError } from './oauth'
import { descargarFilas, estadoDeInforme, pedirInforme, periodosDe, type Periodo } from './rendimiento'
import type { FilaDiaria } from './rendimiento-calculo'

export const INTERVALO_MS = 3 * 3_600_000
export const REINTENTO_TRAS_ERROR_MS = 30 * 60_000
export const ESPERA_MAXIMA_MS = 25 * 60_000
export const DIAS_PRIMERA_LECTURA = 60
export const DIAS_DE_REPASO = 14
export const DIAS_QUE_SE_CONSERVAN = 90
/** Dos «Actualizar» seguidos no piden dos veces: si hace menos de esto que se pidió, se espera al que ya está en marcha */
const ENFRIAMIENTO_DE_FORZAR_MS = 60_000

export interface CuentaParaSincronizar {
  id: string
  conexionId: string
  profileId: number
}

const desplazar = (dia: string, dias: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)

/** Los informes que hay que pedir: 60 días en dos tandas la primera vez, y 14 días el resto. Acaban AYER (hoy está a medias). `hoy` = 'YYYY-MM-DD' */
export function periodosAPedir(hoy: string, primera: boolean): Periodo[] {
  const ayer = desplazar(hoy, -1)
  if (!primera) return [{ desde: desplazar(ayer, -(DIAS_DE_REPASO - 1)), hasta: ayer }]
  const mitad = DIAS_PRIMERA_LECTURA / 2
  return [
    { desde: desplazar(ayer, -(DIAS_PRIMERA_LECTURA - 1)), hasta: desplazar(ayer, -mitad) },
    { desde: desplazar(ayer, -(mitad - 1)), hasta: ayer },
  ]
}

export interface EstadoParaDecidir {
  ultimoOkAt: number | null
  /** Cuándo se pidió el último informe (o se intentó) */
  pedidoAt: number | null
  hayError: boolean
  ahora: number
  forzar: boolean
}

/** ¿Hay que EMPEZAR una lectura nueva? (Solo se pregunta en reposo.) */
export function debeEmpezar(e: EstadoParaDecidir): boolean {
  if (e.forzar) return e.pedidoAt === null || e.ahora - e.pedidoAt >= ENFRIAMIENTO_DE_FORZAR_MS
  // Tras un error no se reintenta cada pasada: se espera un rato
  if (e.hayError && e.pedidoAt !== null && e.ahora - e.pedidoAt < REINTENTO_TRAS_ERROR_MS) return false
  if (e.ultimoOkAt === null) return true
  return e.ahora - e.ultimoOkAt >= INTERVALO_MS
}

interface FilaEstado {
  estado: 'reposo' | 'esperando'
  informes: Array<{ id: string; desde: string; hasta: string }>
  pedido_at: string | null
  ultimo_ok_at: string | null
  datos_desde: string | null
  datos_hasta: string | null
  error: string | null
  intentos: number
}

export type ResultadoDeAvanzar = { accion: 'nada' | 'pedido' | 'esperando' | 'guardado' | 'error'; detalle?: string }

const hoyUTC = () => new Date().toISOString().slice(0, 10)

async function leerEstado(perfilId: string): Promise<FilaEstado | null> {
  const { data, error } = await createServiceClient().from('ads_sincronizacion').select('estado, informes, pedido_at, ultimo_ok_at, datos_desde, datos_hasta, error, intentos').eq('perfil_id', perfilId).maybeSingle()
  if (error) throw error
  return (data as unknown as FilaEstado | null) ?? null
}

async function guardarEstado(perfilId: string, cambios: Partial<FilaEstado>): Promise<void> {
  const { error } = await createServiceClient()
    .from('ads_sincronizacion')
    .upsert({ perfil_id: perfilId, ...cambios, updated_at: new Date().toISOString() }, { onConflict: 'perfil_id' })
  if (error) throw error
}

/** Las filas del informe, con las repetidas (misma cuenta, día y campaña) sumadas: un upsert no admite dos veces la misma clave en el mismo lote */
function filasParaGuardar(perfilId: string, filas: readonly FilaDiaria[]) {
  const por = new Map<string, FilaDiaria>()
  for (const f of filas) {
    const clave = `${f.fecha}|${f.campaignId}`
    const x = por.get(clave)
    if (!x) por.set(clave, { ...f })
    else {
      x.impresiones += f.impresiones
      x.clics += f.clics
      x.gasto += f.gasto
      x.ventas += f.ventas
      x.pedidos += f.pedidos
      x.unidades += f.unidades
    }
  }
  const ahora = new Date().toISOString()
  return [...por.values()].map((f) => ({
    perfil_id: perfilId,
    fecha: f.fecha,
    campaign_id: f.campaignId,
    nombre: f.nombre.slice(0, 300),
    impresiones: Math.round(f.impresiones),
    clics: Math.round(f.clics),
    gasto: Number(f.gasto.toFixed(2)),
    ventas: Number(f.ventas.toFixed(2)),
    pedidos: Math.round(f.pedidos),
    unidades: Math.round(f.unidades),
    actualizado_at: ahora,
  }))
}

/**
 * DA UN PASO en la lectura de una cuenta. Nunca espera a Amazon. Lanza solo si falta la migración o la base falla; los errores de Amazon se apuntan en la fila y se devuelven como `error`.
 */
export async function avanzar(cuenta: CuentaParaSincronizar, opciones: { forzar?: boolean } = {}): Promise<ResultadoDeAvanzar> {
  const ahora = Date.now()
  const estado = await leerEstado(cuenta.id)

  try {
    // ---------- hay informes pedidos: ¿están? ----------
    if (estado?.estado === 'esperando' && estado.informes.length > 0) {
      const pedidoAt = estado.pedido_at ? Date.parse(estado.pedido_at) : ahora
      if (ahora - pedidoAt > ESPERA_MAXIMA_MS) {
        await guardarEstado(cuenta.id, { estado: 'reposo', informes: [], error: 'Amazon ha tardado más de 25 minutos en preparar el informe.', intentos: (estado.intentos ?? 0) + 1, pedido_at: new Date(ahora).toISOString() })
        return { accion: 'error', detalle: 'caducado' }
      }
      const estados = await Promise.all(estado.informes.map((i) => estadoDeInforme(cuenta.conexionId, cuenta.profileId, i.id)))
      const fallido = estados.find((e) => e.estado === 'FAILED')
      if (fallido) {
        await guardarEstado(cuenta.id, { estado: 'reposo', informes: [], error: `Amazon no ha podido generar el informe${fallido.detalle ? `: ${fallido.detalle}` : '.'}`.slice(0, 500), intentos: (estado.intentos ?? 0) + 1, pedido_at: new Date(ahora).toISOString() })
        return { accion: 'error', detalle: fallido.detalle }
      }
      if (!estados.every((e) => e.estado === 'COMPLETED' && e.url)) return { accion: 'esperando' }

      const filas = (await Promise.all(estados.map((e) => descargarFilas(e.url as string)))).flat()
      const paraGuardar = filasParaGuardar(cuenta.id, filas)
      const service = createServiceClient()
      for (let i = 0; i < paraGuardar.length; i += 500) {
        const { error } = await service.from('ads_rendimiento_diario').upsert(paraGuardar.slice(i, i + 500), { onConflict: 'perfil_id,fecha,campaign_id' })
        if (error) throw error
      }
      // Lo que ya no entra en la ventana de conservación
      await service.from('ads_rendimiento_diario').delete().eq('perfil_id', cuenta.id).lt('fecha', desplazar(hoyUTC(), -DIAS_QUE_SE_CONSERVAN))
      const desde = estado.informes.map((i) => i.desde).sort()[0]
      const hasta = estado.informes.map((i) => i.hasta).sort().slice(-1)[0]
      await guardarEstado(cuenta.id, {
        estado: 'reposo',
        informes: [],
        ultimo_ok_at: new Date().toISOString(),
        datos_desde: estado.datos_desde && estado.datos_desde < desde ? estado.datos_desde : desde,
        datos_hasta: hasta,
        error: null,
        intentos: 0,
      })
      return { accion: 'guardado', detalle: `${paraGuardar.length} filas` }
    }

    // ---------- en reposo: ¿toca empezar? ----------
    const toca = debeEmpezar({
      ultimoOkAt: estado?.ultimo_ok_at ? Date.parse(estado.ultimo_ok_at) : null,
      pedidoAt: estado?.pedido_at ? Date.parse(estado.pedido_at) : null,
      hayError: Boolean(estado?.error),
      ahora,
      forzar: Boolean(opciones.forzar),
    })
    if (!toca) return { accion: 'nada' }

    const primera = !estado?.ultimo_ok_at
    const periodos = periodosAPedir(hoyUTC(), primera)
    const informes: Array<{ id: string; desde: string; hasta: string }> = []
    for (const p of periodos) informes.push({ id: await pedirInforme(cuenta.conexionId, cuenta.profileId, p), desde: p.desde, hasta: p.hasta })
    await guardarEstado(cuenta.id, { estado: 'esperando', informes, pedido_at: new Date(ahora).toISOString(), error: null })
    return { accion: 'pedido', detalle: primera ? 'primera lectura (60 días)' : 'repaso de 14 días' }
  } catch (error) {
    // La migración sin lanzar y los fallos de la base se dejan subir: no son cosa de Amazon
    if (isMissingSchema(error) || !(error instanceof AdsError)) throw error
    await guardarEstado(cuenta.id, { estado: 'reposo', informes: [], error: error.message.slice(0, 500), intentos: (estado?.intentos ?? 0) + 1, pedido_at: new Date(ahora).toISOString() }).catch(() => undefined)
    return { accion: 'error', detalle: error.message }
  }
}

/* ------------------------------------------------------------------ */
/* Leer lo guardado                                                    */
/* ------------------------------------------------------------------ */

export interface RendimientoGuardado {
  hayDatos: boolean
  /** Hay una lectura en marcha (informes pedidos que Amazon todavía no ha terminado) */
  sincronizando: boolean
  actualizadoAt: string | null
  datosHasta: string | null
  error: string | null
  periodos: { actual: Periodo; anterior: Periodo }
  actual: FilaDiaria[]
  anterior: FilaDiaria[]
}

/** Las filas guardadas del periodo pedido y del anterior (PostgREST devuelve como mucho 1.000 por consulta: se pagina) */
export async function leerGuardado(perfilId: string, dias: number): Promise<RendimientoGuardado> {
  const p = periodosDe(hoyUTC(), dias)
  const service = createServiceClient()
  const estado = await leerEstado(perfilId)

  const filas: FilaDiaria[] = []
  for (let desde = 0; desde < 20_000; desde += 1000) {
    const { data, error } = await service
      .from('ads_rendimiento_diario')
      .select('fecha, campaign_id, nombre, impresiones, clics, gasto, ventas, pedidos, unidades')
      .eq('perfil_id', perfilId)
      .gte('fecha', p.anterior.desde)
      .lte('fecha', p.actual.hasta)
      .order('fecha', { ascending: true })
      .order('campaign_id', { ascending: true })
      .range(desde, desde + 999)
    if (error) throw error
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      filas.push({
        fecha: String(r.fecha),
        campaignId: String(r.campaign_id),
        nombre: String(r.nombre),
        impresiones: Number(r.impresiones),
        clics: Number(r.clics),
        gasto: Number(r.gasto),
        ventas: Number(r.ventas),
        pedidos: Number(r.pedidos),
        unidades: Number(r.unidades),
      })
    }
    if (!data || data.length < 1000) break
  }

  return {
    hayDatos: Boolean(estado?.ultimo_ok_at),
    sincronizando: estado?.estado === 'esperando',
    actualizadoAt: estado?.ultimo_ok_at ?? null,
    datosHasta: estado?.datos_hasta ?? null,
    error: estado?.error ?? null,
    periodos: p,
    actual: filas.filter((f) => f.fecha >= p.actual.desde),
    anterior: filas.filter((f) => f.fecha <= p.anterior.hasta),
  }
}

/** Las cuentas que el proceso automático lee: en uso Y asignadas a un cliente (de las apagadas o sin asignar no se pide ni se guarda nada) */
export async function cuentasASincronizar(): Promise<CuentaParaSincronizar[]> {
  const { data, error } = await createServiceClient().from('ads_profiles').select('id, profile_id, connection_id').eq('en_uso', true).not('cliente_id', 'is', null)
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; profile_id: number; connection_id: string }>).map((p) => ({ id: p.id, profileId: Number(p.profile_id), conexionId: p.connection_id }))
}

/**
 * Las cuentas que ahora mismo tienen algo que hacer: informes pedidos que recoger, o una lectura nueva que empezar. Es lo que mira el proceso antes de abrir su registro: con 5 cuentas y una lectura
 * cada 3 horas, casi todas las pasadas de los 2 minutos no tienen nada que hacer y no merece una fila en el registro cada vez.
 */
export async function cuentasConTrabajo(): Promise<CuentaParaSincronizar[]> {
  const cuentas = await cuentasASincronizar()
  if (cuentas.length === 0) return []
  const { data, error } = await createServiceClient().from('ads_sincronizacion').select('perfil_id, estado, pedido_at, ultimo_ok_at, error').in('perfil_id', cuentas.map((c) => c.id))
  if (error) throw error
  const por = new Map(((data ?? []) as Array<{ perfil_id: string; estado: string; pedido_at: string | null; ultimo_ok_at: string | null; error: string | null }>).map((r) => [r.perfil_id, r]))
  const ahora = Date.now()
  return cuentas.filter((c) => {
    const e = por.get(c.id)
    if (e?.estado === 'esperando') return true
    return debeEmpezar({ ultimoOkAt: e?.ultimo_ok_at ? Date.parse(e.ultimo_ok_at) : null, pedidoAt: e?.pedido_at ? Date.parse(e.pedido_at) : null, hayError: Boolean(e?.error), ahora, forzar: false })
  })
}
