/**
 * CUENTAS DE CLIENTES · EL RESUMEN DE UN CLIENTE: lo que el administrativo necesita para saber cómo va su cuenta y qué toca hoy. SOLO SERVIDOR.
 *
 * Solo lee lo que el ERP ya tiene guardado (ninguna llamada a Amazon, para que la pantalla abra rápido y no gaste cupo):
 *   · PPC          por cuenta de anunciante: gasto, ventas, ACoS y TACoS de los últimos 7 días contra los 7 anteriores, el modo del motor y sus
 *                  propuestas pendientes por tipo (y el dinero que se deja de tirar si se aprueban las negativas y pausas).
 *   · SEO          por cuenta de vendedor y país: las tareas de «Qué hacer hoy» de SEO (las mismas que la pestaña de SEO de fichas).
 *   · Cumplimiento las cifras (listings que necesitan atención, ocultos, con stock) y las tareas de la pestaña «Hoy».
 *
 * En la LISTA (todos los clientes) va solo lo ligero —PPC y las cifras de cumplimiento—, porque la base es pequeña (Supabase Nano, ver
 * project_proteccion_de_carga). Las tareas de SEO y de cumplimiento se calculan al abrir UN cliente.
 *
 * Cada parte falla por su lado: si una no se puede leer, se dice en esa tarjeta y el resto sale igual.
 */
import { createServiceClient } from '@/lib/supabase/service'
import { cuentasDeCliente } from '@/lib/ads/cuenta'
import { leerModo, listarPropuestas, type ModoDelMotor } from '@/lib/ads/motor'
import { filtroDe, type FiltroDePropuestas } from '@/lib/ads/hoy'
import { ventasTotales } from '@/lib/ads/ventas-totales'
import { cuentasSeoDeClientes, productosSeguidos, fichasGuardadas, consultasGuardadas, evolucionDeCuenta, preciosDeListings, cambiosAplicados } from '@/lib/seo/datos'
import { leerEstadoSeo } from '@/lib/seo/lectura'
import { tareasDeLaCuenta, type Tarea as TareaSeo } from '@/lib/seo/tareas'
import { panelDeCliente } from '@/lib/cumplimiento/panel'
import { conexionesDeCliente } from '@/lib/cumplimiento/conexiones'
import type { TareaDeHoy as TareaCumplimiento } from '@/lib/cumplimiento/acciones'

const DIA = 86_400_000
const fecha = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const n = (v: unknown) => Number(v ?? 0) || 0
const mensaje = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e))

/* ------------------------------------------------------------------ */
/* PPC                                                                 */
/* ------------------------------------------------------------------ */

export interface Ventana {
  gasto: number
  ventas: number
  pedidos: number
  clics: number
}

export interface ResumenPpc {
  perfilId: string
  pais: string
  moneda: string | null
  nombre: string | null
  modo: ModoDelMotor
  /** Últimos 7 días cerrados (hasta ayer) y los 7 de antes */
  ultimos: Ventana
  anteriores: Ventana
  /** Ventas totales de la cuenta (orgánico + publicidad) en los últimos 7 días, si hay cuenta de vendedor del mismo país */
  ventasTotales7: number | null
  pendientes: number
  porTipo: Partial<Record<Exclude<FiltroDePropuestas, 'todas'>, number>>
  /** Lo gastado sin vender en lo que se propone negativizar o pausar: lo que se deja de tirar si se aprueba */
  recuperable: number
  /** Día más reciente con datos guardados */
  datosHasta: string | null
}

const VACIA: Ventana = { gasto: 0, ventas: 0, pedidos: 0, clics: 0 }

async function ppcDeCuenta(c: { id: string; pais: string; moneda: string | null; nombre: string | null }, hoy: number): Promise<ResumenPpc> {
  const ayer = fecha(hoy - DIA)
  const corte = fecha(hoy - 7 * DIA) // el primer día de los «últimos 7»
  const desde = fecha(hoy - 14 * DIA)
  const s = createServiceClient()
  const [diario, modo, propuestas, totales] = await Promise.all([
    s.from('ads_rendimiento_diario').select('fecha, gasto, ventas, pedidos, clics').eq('perfil_id', c.id).gte('fecha', desde).lte('fecha', ayer).limit(20000),
    leerModo(c.id).catch(() => 'apagado' as ModoDelMotor),
    listarPropuestas(c.id).catch(() => []),
    ventasTotales(c.id, 7).catch(() => null),
  ])
  if (diario.error) throw diario.error
  const ultimos = { ...VACIA }
  const anteriores = { ...VACIA }
  let datosHasta: string | null = null
  for (const r of (diario.data ?? []) as Array<{ fecha: string; gasto: unknown; ventas: unknown; pedidos: unknown; clics: unknown }>) {
    const v = r.fecha >= corte ? ultimos : anteriores
    v.gasto += n(r.gasto)
    v.ventas += n(r.ventas)
    v.pedidos += n(r.pedidos)
    v.clics += n(r.clics)
    if (!datosHasta || r.fecha > datosHasta) datosHasta = r.fecha
  }
  const pendientes = propuestas.filter((p) => p.estado === 'pendiente' || p.estado === 'error')
  const porTipo: ResumenPpc['porTipo'] = {}
  let recuperable = 0
  for (const p of pendientes) {
    const f = filtroDe(p)
    porTipo[f] = (porTipo[f] ?? 0) + 1
    if ((p.tipo === 'negativizar' || p.tipo === 'pausar') && p.estado === 'pendiente' && n(p.metricas.ventas) === 0) recuperable += n(p.metricas.gasto)
  }
  let ventasTotales7: number | null = null
  if (totales && !totales.error) {
    const suma = Object.values(totales.porAsin).reduce((a, x) => a + n(x.ventas), 0)
    ventasTotales7 = suma > 0 ? suma : null
  }
  return { perfilId: c.id, pais: c.pais, moneda: c.moneda, nombre: c.nombre, modo, ultimos, anteriores, ventasTotales7, pendientes: pendientes.length, porTipo, recuperable, datosHasta }
}

export async function ppcDeCliente(amazonClientId: string, hoy = Date.now()): Promise<{ cuentas: ResumenPpc[]; error: string | null }> {
  try {
    const cuentas = await cuentasDeCliente(amazonClientId)
    const salida: ResumenPpc[] = []
    // Una cuenta detrás de otra: son pocas por cliente y así no se juntan veinte consultas a la vez en la base
    for (const c of cuentas) salida.push(await ppcDeCuenta(c, hoy))
    return { cuentas: salida, error: null }
  } catch (e) {
    console.error('[cuentas] PPC:', mensaje(e))
    return { cuentas: [], error: 'No se han podido leer las cifras de publicidad.' }
  }
}

/* ------------------------------------------------------------------ */
/* Cumplimiento                                                        */
/* ------------------------------------------------------------------ */

export interface CifrasCumplimiento {
  revisados: number
  atencion: number
  atencionConStock: number
  ocultos: number
  normativa: number
  ultimaRevision: string | null
}

/** Ligero, para la lista: una sola función de la base */
export async function cifrasDeCumplimiento(amazonClientId: string): Promise<CifrasCumplimiento | null> {
  try {
    const conexiones = await conexionesDeCliente(amazonClientId)
    if (conexiones.length === 0) return null
    const { data, error } = await createServiceClient().rpc('cumplimiento_cifras', { p_conexiones: conexiones.map((c) => c.id) })
    if (error) throw error
    const filas = (data ?? []) as Array<Record<string, unknown>>
    if (filas.length === 0) return null
    return filas.reduce<CifrasCumplimiento>(
      (a, f) => ({
        revisados: a.revisados + n(f.revisados),
        atencion: a.atencion + n(f.atencion),
        atencionConStock: a.atencionConStock + n(f.atencion_con_stock),
        ocultos: a.ocultos + n(f.ocultos),
        normativa: a.normativa + n(f.normativa),
        ultimaRevision: [a.ultimaRevision, (f.ultima_revision as string | null) ?? null].filter(Boolean).sort().at(-1) ?? null,
      }),
      { revisados: 0, atencion: 0, atencionConStock: 0, ocultos: 0, normativa: 0, ultimaRevision: null }
    )
  } catch (e) {
    console.error('[cuentas] cumplimiento:', mensaje(e))
    return null
  }
}

/** Completo, para el detalle: las tareas de la pestaña «Hoy» de Cumplimiento */
export async function tareasDeCumplimiento(amazonClientId: string): Promise<{ tareas: TareaCumplimiento[]; error: string | null }> {
  const p = await panelDeCliente(amazonClientId, null)
  if (!p.ok) return { tareas: [], error: p.faltaMigracion ? 'Falta lanzar una migración de Cumplimiento.' : p.error }
  // Lo menor no es trabajo del día
  return { tareas: p.tareas.filter((t) => t.nivel !== 'menor'), error: null }
}

/* ------------------------------------------------------------------ */
/* SEO                                                                 */
/* ------------------------------------------------------------------ */

export interface ResumenSeo {
  cuentaId: string
  pais: string
  nombre: string | null
  acceso: 'desconocido' | 'si' | 'no'
  productos: number
  tareas: TareaSeo[]
}

export async function seoDeCliente(amazonClientId: string, hoy = Date.now()): Promise<{ cuentas: ResumenSeo[]; error: string | null }> {
  try {
    const cuentas = (await cuentasSeoDeClientes([amazonClientId])).get(amazonClientId) ?? []
    const salida: ResumenSeo[] = []
    for (const c of cuentas) {
      const { connectionId, marketplaceId } = c
      const productos = await productosSeguidos(connectionId, marketplaceId)
      if (productos.length === 0) {
        salida.push({ cuentaId: c.id, pais: c.pais, nombre: c.nombre, acceso: 'desconocido', productos: 0, tareas: [] })
        continue
      }
      const [estado, fichas, mes, semana, evolucion, precios, cambios] = await Promise.all([
        leerEstadoSeo({ connectionId, marketplaceId }),
        fichasGuardadas(connectionId, marketplaceId),
        consultasGuardadas(connectionId, marketplaceId, 'MONTH'),
        consultasGuardadas(connectionId, marketplaceId, 'WEEK'),
        evolucionDeCuenta(connectionId, marketplaceId).catch(() => []),
        preciosDeListings(connectionId, marketplaceId, productos.map((p) => p.asin)).catch(() => ({})),
        cambiosAplicados(connectionId, marketplaceId).catch(() => []),
      ])
      const lectura = { acceso: estado?.acceso ?? 'desconocido', mesOk: estado?.mes_ok ?? null, semanaOk: estado?.semana_ok ?? null, fichaLeidaAt: estado?.ficha_leida_at ?? null } as const
      const tareas = tareasDeLaCuenta({ hoy: fecha(hoy), lectura, productos, fichas, consultas: { MONTH: mes, WEEK: semana }, evolucion, precios, cambios })
      salida.push({ cuentaId: c.id, pais: c.pais, nombre: c.nombre, acceso: lectura.acceso, productos: productos.length, tareas })
    }
    return { cuentas: salida, error: null }
  } catch (e) {
    console.error('[cuentas] SEO:', mensaje(e))
    return { cuentas: [], error: 'No se han podido leer los datos de SEO.' }
  }
}
