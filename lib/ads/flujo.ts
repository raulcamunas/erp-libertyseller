/**
 * AMAZON ADS · EL FLUJO Y EL DIARIO DE UNA CUENTA: LAS LECTURAS. SOLO SERVIDOR (solo lee; no escribe en la base ni llama a Amazon).
 *
 * Lee del periodo (en días de España) el log de cambios, las propuestas, los eventos del agente, las cifras diarias de las keywords cosechadas y los veredictos de
 * ads_efectos, y se lo pasa a flujo-calculo.ts, que es el que agrupa y clasifica.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { todasLasFilas } from './paginar'
import { asinDeNombre, rolDeNombre, construirDiario, construirFlujo, diaEspana, inicioDelDiaEspana, productosDelPeriodo, sumarDias, type CampanaConocida, type DiaDeObjetivo, type DiaDelDiario, type EfectoFlujo, type EventoFlujo, type FilaDeLogFlujo, type Flujo, type ProductoDelFlujo, type PropuestaFlujo } from './flujo-calculo'
import type { Rol } from './estructura'

export const DIAS_DEL_FLUJO = [7, 14, 30] as const
export type DiasDelFlujo = (typeof DIAS_DEL_FLUJO)[number]

/** Tope de filas del log que se leen (con el volumen de hoy sobra; si se llega, la respuesta lo dice con `cortado`) */
const TOPE_LOG = 5000

export interface RespuestaDelFlujo {
  periodo: { desde: string; hasta: string; dias: DiasDelFlujo }
  /** El producto del flujo (el pedido o, con «auto», el que más cambios tiene) */
  asin: string | null
  productos: ProductoDelFlujo[]
  campanas: Array<{ campaignId: string; nombre: string; rol: Rol | null; asin: string | null }>
  flujo: Flujo | null
  diario: DiaDelDiario[]
  cortado: boolean
}

type Fila = Record<string, unknown>
const texto = (v: unknown): string | null => (v == null ? null : String(v))
const numero = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function enTrozos<T>(ids: readonly string[], leer: (trozo: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>, tamano = 200): Promise<T[]> {
  const salida: T[] = []
  for (let i = 0; i < ids.length; i += tamano) {
    const { data, error } = await leer(ids.slice(i, i + tamano))
    if (error) throw error
    salida.push(...(data ?? []))
  }
  return salida
}

const COLUMNAS_LOG = 'id, creado_at, campaign_id, nombre_campana, entidad, accion, campo, valor_anterior, valor_nuevo, motivo, origen, ok, error, usuario_id, propuesta_id, entidad_id'
const COLUMNAS_PROPUESTA = 'id, tipo, estado, origen, asin, termino, campaign_id, campaign_nombre, desde_rol, hacia_rol, hacia_campaign_id, hacia_campaign_nombre, negativizar_en_origen, motivo, metricas, creada_at, resuelta_at, resuelta_por, retenida_motivo, retenida_at, error'

export async function leerFlujo(perfilId: string, opciones: { dias: DiasDelFlujo; asin: string | null; conPropuestas: boolean }): Promise<RespuestaDelFlujo> {
  const s = createServiceClient()
  const hoy = diaEspana(Date.now())
  const primerDia = sumarDias(hoy, -(opciones.dias - 1))
  const desdeIso = inicioDelDiaEspana(primerDia)

  // ---- 1) el log del periodo (paginado, con tope) ----
  const log = await todasLasFilas<Fila>(
    (a, b) => s.from('ads_cambios_log').select(COLUMNAS_LOG).eq('perfil_id', perfilId).gte('creado_at', desdeIso).order('creado_at', { ascending: false }).order('id', { ascending: false }).range(a, b),
    TOPE_LOG,
  )
  if (log.error) throw log.error
  const cortado = log.data.length >= TOPE_LOG

  // ---- 2) las propuestas del periodo y las que nombra el log ----
  const propuestasPeriodo = await todasLasFilas<Fila>(
    (a, b) => s.from('ads_propuestas').select(COLUMNAS_PROPUESTA).eq('perfil_id', perfilId).or(`creada_at.gte."${desdeIso}",resuelta_at.gte."${desdeIso}",retenida_at.gte."${desdeIso}"`).order('creada_at', { ascending: false }).order('id', { ascending: false }).range(a, b),
    10_000,
  )
  if (propuestasPeriodo.error) throw propuestasPeriodo.error
  const vistas = new Set(propuestasPeriodo.data.map((p) => String(p.id)))
  const faltan = [...new Set(log.data.map((f) => texto(f.propuesta_id)).filter((x): x is string => !!x && !vistas.has(x)))]
  const propuestasViejas = await enTrozos<Fila>(faltan, (t) => s.from('ads_propuestas').select(COLUMNAS_PROPUESTA).eq('perfil_id', perfilId).in('id', t))
  const filasPropuesta = [...propuestasPeriodo.data, ...propuestasViejas]

  // ---- 3) nombres de las personas ----
  const idsPersonas = [...new Set([...log.data.map((f) => texto(f.usuario_id)), ...filasPropuesta.map((p) => texto(p.resuelta_por))].filter((x): x is string => !!x))]
  const perfiles = await enTrozos<{ id: string; full_name: string | null }>(idsPersonas, (t) => s.from('profiles').select('id, full_name').in('id', t))
  const nombre = new Map(perfiles.map((p) => [p.id, p.full_name?.trim() || 'Alguien del equipo']))

  const filas: FilaDeLogFlujo[] = log.data.map((f) => ({
    id: String(f.id),
    creadoAt: String(f.creado_at),
    campaignId: texto(f.campaign_id),
    nombreCampana: texto(f.nombre_campana),
    entidad: String(f.entidad ?? ''),
    accion: String(f.accion ?? ''),
    campo: texto(f.campo),
    valorAnterior: texto(f.valor_anterior),
    valorNuevo: texto(f.valor_nuevo),
    motivo: texto(f.motivo),
    origen: String(f.origen ?? ''),
    ok: f.ok !== false,
    error: texto(f.error),
    persona: f.usuario_id ? (nombre.get(String(f.usuario_id)) ?? null) : null,
    propuestaId: texto(f.propuesta_id),
    entidadId: texto(f.entidad_id),
  }))
  const propuestas: PropuestaFlujo[] = filasPropuesta.map((p) => ({
    id: String(p.id),
    tipo: String(p.tipo ?? ''),
    estado: String(p.estado ?? ''),
    origen: texto(p.origen),
    asin: texto(p.asin),
    termino: texto(p.termino),
    campaignId: texto(p.campaign_id),
    campaignNombre: texto(p.campaign_nombre),
    desdeRol: texto(p.desde_rol),
    haciaRol: texto(p.hacia_rol),
    haciaCampaignId: texto(p.hacia_campaign_id),
    haciaCampaignNombre: texto(p.hacia_campaign_nombre),
    negativizarEnOrigen: p.negativizar_en_origen === true,
    motivo: texto(p.motivo),
    metricas: (p.metricas as PropuestaFlujo['metricas']) ?? null,
    creadaAt: String(p.creada_at),
    resueltaAt: texto(p.resuelta_at),
    retenidaMotivo: texto(p.retenida_motivo),
    retenidaAt: texto(p.retenida_at),
    error: texto(p.error),
    resueltaPor: p.resuelta_por ? (nombre.get(String(p.resuelta_por)) ?? null) : null,
  }))

  // ---- 4) campañas conocidas: las creadas desde el ERP y las que salen en el log ----
  const { data: estructuras, error: errorEstructuras } = await s.from('ads_estructuras').select('campaign_id, rol, nombre').eq('perfil_id', perfilId).limit(2000)
  if (errorEstructuras) throw errorEstructuras
  const campanas = new Map<string, CampanaConocida>()
  for (const e of (estructuras ?? []) as Fila[]) {
    const id = texto(e.campaign_id)
    const n = texto(e.nombre)
    if (id && n) campanas.set(id, { campaignId: id, nombre: n, rol: rolDeNombre(n) ?? ((texto(e.rol) as Rol | null) ?? null) })
  }
  for (const f of filas) if (f.campaignId && f.nombreCampana && !campanas.has(f.campaignId)) campanas.set(f.campaignId, { campaignId: f.campaignId, nombre: f.nombreCampana, rol: rolDeNombre(f.nombreCampana) })
  for (const p of propuestas) {
    if (p.campaignId && p.campaignNombre && !campanas.has(p.campaignId)) campanas.set(p.campaignId, { campaignId: p.campaignId, nombre: p.campaignNombre, rol: rolDeNombre(p.campaignNombre) })
    if (p.haciaCampaignId && p.haciaCampaignNombre && !campanas.has(p.haciaCampaignId)) campanas.set(p.haciaCampaignId, { campaignId: p.haciaCampaignId, nombre: p.haciaCampaignNombre, rol: rolDeNombre(p.haciaCampaignNombre) })
  }
  const listaCampanas = [...campanas.values()]

  // ---- 5) eventos del agente del periodo ----
  const { data: eventosFilas, error: errorEventos } = await s.from('ads_agente_eventos').select('id, creado_at, tipo, titulo, detalle, datos').eq('perfil_id', perfilId).gte('creado_at', desdeIso).order('creado_at', { ascending: false }).limit(1000)
  if (errorEventos) throw errorEventos
  const eventos: EventoFlujo[] = ((eventosFilas ?? []) as Fila[]).map((e) => ({ id: String(e.id), creadoAt: String(e.creado_at), tipo: String(e.tipo ?? ''), titulo: String(e.titulo ?? ''), detalle: texto(e.detalle), datosTexto: e.datos ? JSON.stringify(e.datos) : '' }))

  const productos = productosDelPeriodo(filas, propuestas, listaCampanas)
  const pedido = opciones.asin?.toUpperCase() ?? null
  const asin = pedido === 'AUTO' ? (productos[0]?.asin ?? null) : pedido

  // ---- 6) solo con producto: lo que han hecho después las keywords cosechadas, y los veredictos ----
  let flujo: Flujo | null = null
  if (asin) {
    const entidades = [...new Set(filas.filter((f) => f.accion === 'promover' && f.ok && f.entidadId && asinDeNombre(f.nombreCampana) === asin).map((f) => f.entidadId as string))]
    const diasObjetivo = await enTrozos<Fila>(entidades, (t) => s.from('ads_objetivos_diario').select('fecha, objetivo_id, clics, pedidos, gasto, ventas').eq('perfil_id', perfilId).in('objetivo_id', t).gte('fecha', sumarDias(primerDia, -1)).order('objetivo_id').order('fecha').limit(1000), 25) // 25 keywords × ~32 días < 1.000 filas, el tope real de PostgREST
    const diasDeObjetivo: DiaDeObjetivo[] = diasObjetivo.map((d) => ({ fecha: String(d.fecha), objetivoId: String(d.objetivo_id), clics: numero(d.clics), pedidos: numero(d.pedidos), gasto: numero(d.gasto), ventas: numero(d.ventas) }))
    const idsPropuesta = [...new Set([...filas.filter((f) => asinDeNombre(f.nombreCampana) === asin && (f.accion === 'promover' || f.accion === 'negativizar')).map((f) => f.propuestaId), ...propuestas.filter((p) => (p.asin ?? '').toUpperCase() === asin).map((p) => p.id)].filter((x): x is string => !!x))]
    const efectosFilas = await enTrozos<Fila>(idsPropuesta, (t) => s.from('ads_efectos').select('propuesta_id, veredicto').eq('perfil_id', perfilId).in('propuesta_id', t))
    const efectos: EfectoFlujo[] = efectosFilas.map((x) => ({ propuestaId: String(x.propuesta_id), veredicto: texto(x.veredicto) }))
    flujo = construirFlujo({ asin, filas, propuestas, campanas: listaCampanas, diasDeObjetivo, efectos, conPropuestas: opciones.conPropuestas })
  }

  const diario = construirDiario({ filas, propuestas, eventos, asin, desde: primerDia, hoy })

  return {
    periodo: { desde: primerDia, hasta: hoy, dias: opciones.dias },
    asin,
    productos,
    campanas: listaCampanas.map((c) => ({ ...c, asin: asinDeNombre(c.nombre) })),
    flujo,
    diario,
    cortado,
  }
}

