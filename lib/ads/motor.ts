/**
 * AMAZON ADS · EL MOTOR AUTOMÁTICO DEL SOP (SOLO SERVIDOR). ESCRIBE EN LA CUENTA DEL CLIENTE cuando se aplica una propuesta.
 *
 * El ciclo de una propuesta:
 *
 *     generar ──▶ pendiente ──(una persona aprueba)──▶ aplicada ──(deshacer)──▶ deshecha
 *                    │  └─(descartar)──▶ descartada            └─ si falla ──▶ error
 *                    └─(14 días sin tocar)──▶ caducada
 *
 * ============ LOS CANDADOS ============
 *
 *   1. MODO POR CUENTA, apagado por defecto: apagado · sugiere (propone, NO aplica nada) · aprueba (una persona pulsa «Aplicar») · autopiloto (aplica sola, y solo lo que el SOP permite sin aprobación).
 *   2. LA FICHA DE CUENTA TIENE QUE ESTAR FIRMADA para aplicar nada, ni siquiera con aprobación: los umbrales son doctrina solo cuando alguien los ha firmado.
 *   3. SOLO CAMPAÑAS CON LA NOMENCLATURA del SOP (la del ERP o sus variantes reconocidas: «Manual Exacta», «FRASE H10», «ASIN H10»…, ver reglas.ts): las demás no se tocan.
 *   4. EL PILOTO AUTOMÁTICO SOLO NEGATIVIZA, y con un tope al día. Promover un término crea una keyword nueva (un cambio estructural) y el SOP exige aprobación. Tampoco excluye ASIN (negativa
 *      de producto) ni términos marcados «Revisar» (posibles irrelevantes): eso lo decide una persona. Pujas, pausas y presupuesto, siempre con aprobación.
 *   5. TODO SE ANOTA EN EL LOG y todo lo aplicado se puede DESHACER: se guardan los identificadores de lo creado en Amazon.
 *   6. Un término que ya se propuso o se resolvió hace menos de 14 días no se vuelve a proponer (cuarentena: un cambio cada vez y con ventana de lectura).
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { campanasDe } from './campanas'
import { anotarCambio, leerFicha, productosDeCuenta, type FichaDeCuenta } from './cuenta'
import {
  borrarKeyword,
  borrarNegativaDeCampana,
  borrarNegativaDeProducto,
  borrarSegmentacion,
  crearKeyword,
  crearNegativaDeCampana,
  crearNegativaDeProducto,
  crearSegmentacionDeProducto,
  gruposActivosDe,
  ponerPresupuesto,
  ponerPuja,
} from './escritura'
import { objetivosDesdeAcos, precioParaMotor, ticketsMedios } from './margen'
import { decidirSiSePuedeAplicar, planificarPropuestas, type DestinoDeCampana, type PropuestaNueva } from './motor-calculo'
import { asinDeCampana } from './productos-agrupar'
import { esAsin, normalizarTexto, palabrasDe, partesDeNombre, type ObjetivosParaReglas, type TipoDePropuesta } from './reglas'
import { cambiarEstado } from './segmentaciones'
import { cvrsDeCuenta, leerUmbrales } from './umbrales-cuenta'
import { leerTerminos } from './terminos'
import type { CuentaParaSincronizar } from './sincronizar'
import type { Rol } from './estructura'

export { guardarUmbrales, leerUmbrales } from './umbrales-cuenta'

export type ModoDelMotor = 'apagado' | 'sugiere' | 'aprueba' | 'autopiloto'
export const MODOS: readonly ModoDelMotor[] = ['apagado', 'sugiere', 'aprueba', 'autopiloto']

/** El piloto automático aplica como mucho esto por cuenta y día */
export const TOPE_DIARIO_AUTOPILOTO = 5
/** Una persona, como mucho esto por cuenta y día (un freno contra un clic descontrolado, no un límite de uso normal) */
export const TOPE_DIARIO_MANUAL = 40
export const DIAS_DE_CUARENTENA = 14
export const DIAS_PARA_CADUCAR = 14

const DIA_MS = 86_400_000

export type EstadoDePropuesta = 'pendiente' | 'aprobada' | 'aplicada' | 'descartada' | 'deshecha' | 'error' | 'caducada'

export interface Propuesta {
  id: string
  tipo: TipoDePropuesta
  asin: string | null
  termino: string
  campaignId: string
  campaignNombre: string
  adGroupId: string | null
  desdeRol: string | null
  haciaRol: string | null
  haciaCampaignId: string | null
  haciaCampaignNombre: string | null
  haciaAdGroupId: string | null
  negativizarEnOrigen: boolean
  motivo: string
  metricas: { clics: number; gasto: number; pedidos: number; ventas: number; acosPct: number | null; usoPct?: number; precioEstimado?: number; revisar?: boolean; cvrPct?: number }
  /** El término es un ASIN (ficha de producto): se excluye y se ataca como segmentación por producto */
  esAsin: boolean
  /** Puja y presupuesto (migración 298): la segmentación, su tipo y el valor antes y después */
  objetivoId: string | null
  objetivoTipo: string | null
  valorActual: number | null
  valorNuevo: number | null
  estado: EstadoDePropuesta
  error: string | null
  automatica: boolean
  creadaAt: string
  resueltaAt: string | null
}

const COLUMNAS_BASE = 'id, tipo, asin, termino, campaign_id, campaign_nombre, ad_group_id, desde_rol, hacia_rol, hacia_campaign_id, hacia_campaign_nombre, hacia_ad_group_id, negativizar_en_origen, motivo, metricas, estado, error, automatica, creada_at, resuelta_at, aplicada'
/** Con las columnas de puja y presupuesto (migración 298). Sin ella se lee lo de antes */
const COLUMNAS = `${COLUMNAS_BASE}, objetivo_id, objetivo_tipo, valor_actual, valor_nuevo`
let hay298: boolean | null = null
async function columnas(): Promise<string> {
  if (hay298 === null) {
    const { error } = await createServiceClient().from('ads_propuestas').select('objetivo_id').limit(1)
    hay298 = !error
  }
  return hay298 ? COLUMNAS : COLUMNAS_BASE
}

function deFila(f: Record<string, unknown>): Propuesta {
  return {
    id: f.id as string,
    tipo: f.tipo as TipoDePropuesta,
    asin: (f.asin as string | null) ?? null,
    termino: f.termino as string,
    campaignId: f.campaign_id as string,
    campaignNombre: f.campaign_nombre as string,
    adGroupId: (f.ad_group_id as string | null) ?? null,
    desdeRol: (f.desde_rol as string | null) ?? null,
    haciaRol: (f.hacia_rol as string | null) ?? null,
    haciaCampaignId: (f.hacia_campaign_id as string | null) ?? null,
    haciaCampaignNombre: (f.hacia_campaign_nombre as string | null) ?? null,
    haciaAdGroupId: (f.hacia_ad_group_id as string | null) ?? null,
    negativizarEnOrigen: Boolean(f.negativizar_en_origen),
    motivo: f.motivo as string,
    metricas: (f.metricas as Propuesta['metricas']) ?? { clics: 0, gasto: 0, pedidos: 0, ventas: 0, acosPct: null },
    objetivoId: (f.objetivo_id as string | null) ?? null,
    objetivoTipo: (f.objetivo_tipo as string | null) ?? null,
    valorActual: f.valor_actual == null ? null : Number(f.valor_actual),
    valorNuevo: f.valor_nuevo == null ? null : Number(f.valor_nuevo),
    esAsin: esAsin(f.termino as string) && (f.tipo === 'negativizar' || f.tipo === 'promover'),
    estado: f.estado as EstadoDePropuesta,
    error: (f.error as string | null) ?? null,
    automatica: Boolean(f.automatica),
    creadaAt: f.creada_at as string,
    resueltaAt: (f.resuelta_at as string | null) ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* El modo                                                             */
/* ------------------------------------------------------------------ */

export async function leerModo(perfilId: string): Promise<ModoDelMotor> {
  const { data, error } = await createServiceClient().from('ads_motor_config').select('modo').eq('perfil_id', perfilId).maybeSingle()
  if (error) throw error
  const m = (data as { modo: string } | null)?.modo
  return MODOS.includes(m as ModoDelMotor) ? (m as ModoDelMotor) : 'apagado'
}

/** Cambia el modo. Aplicar cosas (aprueba, autopiloto) exige la ficha de cuenta firmada */
export async function guardarModo(perfilId: string, modo: ModoDelMotor, userId: string): Promise<void> {
  if (!MODOS.includes(modo)) throw new Error('Ese modo no existe.')
  if (modo === 'aprueba' || modo === 'autopiloto') {
    const ficha = await leerFicha(perfilId)
    if (!ficha.firmadaAt) throw new Error('Para que el motor pueda aplicar cambios, la ficha de cuenta tiene que estar firmada (pestaña «Ficha de cuenta»).')
  }
  const { error } = await createServiceClient().from('ads_motor_config').upsert({ perfil_id: perfilId, modo, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'perfil_id' })
  if (error) throw error
  await anotarCambio({ perfilId, entidad: 'campaña', accion: 'cambiar', campo: 'modo del motor automático', valorNuevo: modo, motivo: 'Lo cambia una persona desde Marketing Test', origen: 'manual', userId })
}

/** Las cuentas con el motor encendido (cualquier modo menos apagado) */
export async function perfilesConMotor(): Promise<string[]> {
  const { data, error } = await createServiceClient().from('ads_motor_config').select('perfil_id').neq('modo', 'apagado')
  if (error) throw error
  return ((data ?? []) as Array<{ perfil_id: string }>).map((r) => r.perfil_id)
}

/* ------------------------------------------------------------------ */
/* Los objetivos de cada producto (con el precio estimado si falta)    */
/* ------------------------------------------------------------------ */

export interface ObjetivoDeProducto extends ObjetivosParaReglas {
  cpaObjetivo: number
  precio: number
  /** true = el precio es el ticket medio de Ads (el producto no tiene precio en su ficha) */
  precioEstimado: boolean
}

export interface ObjetivosDeCuenta {
  porAsin: Map<string, ObjetivoDeProducto | null>
  /** Productos sin ACoS objetivo fijado */
  sinAcos: Array<{ asin: string; resumen: string }>
  /** Productos con ACoS objetivo pero sin precio ni ventas de las que estimarlo: el motor no puede decidir nada de ellos */
  sinPrecio: Array<{ asin: string; resumen: string }>
  /** Productos cuyo precio es el ticket medio de Ads */
  conPrecioEstimado: Array<{ asin: string; resumen: string; precio: number }>
  /** Las palabras de cada producto (resumen y título de su ficha), para la regla de irrelevantes */
  palabras: Map<string, string[]>
  /** ASIN con campañas (con la nomenclatura) que gastan y que NO están en Productos: el motor no puede mirarlos */
  sinFicha: string[]
}

/**
 * El ticket medio de lo vendido por publicidad en los últimos 30 días, por ASIN (sale del nombre de la campaña), y los ASIN que han tenido campañas con gasto en ese tiempo (para avisar de los que
 * no están dados de alta en Productos: el motor no los mira y antes no se decía).
 */
async function ventasDeCampanas(perfilId: string): Promise<{ tickets: Map<string, number>; conGasto: Set<string> }> {
  const desde = new Date(Date.now() - 30 * DIA_MS).toISOString().slice(0, 10)
  const filas: Array<{ asin: string | null; ventas: number; unidades: number }> = []
  const conGasto = new Set<string>()
  for (let i = 0; i < 20_000; i += 1000) {
    const { data, error } = await createServiceClient().from('ads_rendimiento_diario').select('nombre, ventas, unidades').eq('perfil_id', perfilId).gte('fecha', desde).gt('gasto', 0).order('fecha').order('campaign_id').range(i, i + 999)
    if (error) {
      if (isMissingSchema(error)) return { tickets: new Map(), conGasto }
      throw error
    }
    for (const r of (data ?? []) as Array<{ nombre: string | null; ventas: number; unidades: number }>) {
      // Solo las campañas con la nomenclatura: las que el motor podría mirar
      const asin = r.nombre && partesDeNombre(r.nombre) ? asinDeCampana(r.nombre) : null
      if (asin) conGasto.add(asin)
      filas.push({ asin, ventas: Number(r.ventas), unidades: Number(r.unidades) })
    }
    if (!data || data.length < 1000) break
  }
  return { tickets: ticketsMedios(filas), conGasto }
}

/**
 * EL OBJETIVO DE CADA PRODUCTO, que es de donde cuelgan todas las reglas: el ACoS que ha FIJADO una persona en su ficha de producto y el precio (el de la ficha o, si falta, el ticket medio de Ads,
 * marcado como estimación). Sin ACoS o sin ninguno de los dos precios, el producto no se evalúa y la pantalla lo dice en «Qué hacer hoy».
 */
export async function objetivosDeCuenta(perfilId: string, ficha: FichaDeCuenta): Promise<ObjetivosDeCuenta> {
  const [productos, { tickets, conGasto }] = await Promise.all([productosDeCuenta(perfilId), ventasDeCampanas(perfilId)])
  const conFicha = new Set(productos.map((p) => p.asin.toUpperCase()))
  const salida: ObjetivosDeCuenta = { porAsin: new Map(), sinAcos: [], sinPrecio: [], conPrecioEstimado: [], palabras: new Map(), sinFicha: [...conGasto].filter((a) => !conFicha.has(a)).sort() }
  for (const p of productos) {
    const asin = p.asin.toUpperCase()
    const resumen = p.resumen || asin
    salida.palabras.set(asin, palabrasDe(`${p.resumen && p.resumen !== asin ? p.resumen : ''} ${p.titulo ?? ''}`))
    if (p.acosObjetivoPct == null) {
      salida.sinAcos.push({ asin, resumen })
      salida.porAsin.set(asin, null)
      continue
    }
    const precio = precioParaMotor(p.precio, tickets.get(asin))
    const o = precio ? objetivosDesdeAcos(precio.precio, p.acosObjetivoPct, ficha.gastoSinVentaX) : null
    if (!precio || !o) {
      salida.sinPrecio.push({ asin, resumen })
      salida.porAsin.set(asin, null)
      continue
    }
    if (precio.estimado) salida.conPrecioEstimado.push({ asin, resumen, precio: precio.precio })
    salida.porAsin.set(asin, { acosObjetivoPct: o.acosObjetivoPct, gastoMaximoSinVenta: o.gastoMaximoSinVenta, cpaObjetivo: o.cpaObjetivo, precio: precio.precio, precioEstimado: precio.estimado })
  }
  return salida
}

/**
 * LAS SEGMENTACIONES QUE YA HAY en cada campaña (las keywords y ASIN con alguna impresión en 30 días, de `ads_objetivos_diario`): para no cosechar un término que ya está en su destino. Es una lectura
 * de la base, sin tocar Amazon; una keyword recién creada y sin impresiones no sale (Amazon rechazaría el duplicado y la propuesta quedaría en «error» con su motivo).
 */
async function segmentacionesExistentes(perfilId: string): Promise<Map<string, Set<string>>> {
  const desde = new Date(Date.now() - 30 * DIA_MS).toISOString().slice(0, 10)
  const por = new Map<string, Set<string>>()
  for (let i = 0; i < 60_000; i += 1000) {
    const { data, error } = await createServiceClient().from('ads_objetivos_diario').select('campaign_id, texto, tipo').eq('perfil_id', perfilId).gte('fecha', desde).order('fecha').order('objetivo_id').range(i, i + 999)
    if (error) {
      if (isMissingSchema(error)) return por
      throw error
    }
    for (const r of (data ?? []) as Array<{ campaign_id: string; texto: string; tipo: string | null }>) {
      const asin = /(b0[a-z0-9]{8})/i.exec(r.texto)?.[1]
      const texto = r.tipo === 'EXACT' || r.tipo === 'PHRASE' || r.tipo === 'BROAD' ? normalizarTexto(r.texto) : asin ? asin.toLowerCase() : null
      if (!texto) continue
      const set = por.get(r.campaign_id) ?? new Set<string>()
      set.add(texto)
      por.set(r.campaign_id, set)
    }
    if (!data || data.length < 1000) break
  }
  return por
}

/* ------------------------------------------------------------------ */
/* Generar propuestas                                                  */
/* ------------------------------------------------------------------ */

export interface ResumenDeGeneracion {
  omitido?: 'apagado' | 'sin-terminos'
  nuevas: number
  repetidas: number
  evaluados: number
  sinObjetivo: string[]
  caducadas: number
}

/** Los términos y la ficha → propuestas nuevas, guardadas como pendientes. No toca Amazon salvo para LEER las campañas y sus grupos */
export async function generarPropuestas(cuenta: CuentaParaSincronizar): Promise<ResumenDeGeneracion> {
  const vacio = { nuevas: 0, repetidas: 0, evaluados: 0, sinObjetivo: [], caducadas: 0 }
  const modo = await leerModo(cuenta.id)
  if (modo === 'apagado') return { ...vacio, omitido: 'apagado' }

  const service = createServiceClient()
  // Lo que lleva 14 días pendiente sin que nadie lo mire ya no es fiable: caduca
  const limite = new Date(Date.now() - DIAS_PARA_CADUCAR * DIA_MS).toISOString()
  const { data: caducadas } = await service.from('ads_propuestas').update({ estado: 'caducada', resuelta_at: new Date().toISOString() }).eq('perfil_id', cuenta.id).eq('estado', 'pendiente').lt('creada_at', limite).select('id')

  const terminos = await leerTerminos(cuenta.id)
  if (terminos.length === 0) return { ...vacio, omitido: 'sin-terminos', caducadas: caducadas?.length ?? 0 }

  const ficha = await leerFicha(cuenta.id)
  // El objetivo de cada producto es el ACoS que ha FIJADO una persona en su ficha de producto, con su precio (o el ticket medio de Ads como estimación); sin ellos el producto no se evalúa
  const [cuentaObjetivos, existentes, { umbrales: estimados }] = await Promise.all([objetivosDeCuenta(cuenta.id, ficha), segmentacionesExistentes(cuenta.id), leerUmbrales(cuenta.id)])
  const cvrs = await cvrsDeCuenta(cuenta.id, estimados.cvrPorDefectoPct)
  const objetivos = new Map<string, ObjetivosParaReglas | null>([...cuentaObjetivos.porAsin].map(([asin, o]) => [asin, o ? { acosObjetivoPct: o.acosObjetivoPct, gastoMaximoSinVenta: o.gastoMaximoSinVenta, cpaObjetivo: o.cpaObjetivo } : null]))
  const precioEstimado = new Map(cuentaObjetivos.conPrecioEstimado.map((p) => [p.asin, p.precio]))

  // Las campañas vivas, para saber a cuál sube cada término (la del mismo producto con el rol de destino)
  const { campanas } = await campanasDe(cuenta.conexionId, cuenta.profileId)
  const porAsinYRol = new Map<string, DestinoDeCampana & { activa: boolean }>()
  // Todas las campañas (de cualquier estado menos archivadas) de cada producto y rol: para saber si un término ya está cosechado en alguna
  const campanasDeRol = new Map<string, string[]>()
  for (const c of campanas) {
    if (c.estado === 'ARCHIVED') continue
    const p = partesDeNombre(c.nombre)
    const asin = asinDeCampana(c.nombre)
    if (!p || !asin) continue
    const clave = `${asin}|${p.rol}`
    campanasDeRol.set(clave, [...(campanasDeRol.get(clave) ?? []), c.campaignId])
    const previa = porAsinYRol.get(clave)
    if (!previa || (!previa.activa && c.estado === 'ENABLED')) porAsinYRol.set(clave, { campaignId: c.campaignId, nombre: c.nombre, adGroupId: null, activa: c.estado === 'ENABLED' })
  }

  // Lo ya propuesto: lo pendiente y lo resuelto hace menos de 14 días (la cuarentena)
  const desdeCuarentena = new Date(Date.now() - DIAS_DE_CUARENTENA * DIA_MS).toISOString()
  const { data: previas } = await service.from('ads_propuestas').select('campaign_id, termino, tipo, estado, resuelta_at').eq('perfil_id', cuenta.id).or(`estado.eq.pendiente,resuelta_at.gte.${desdeCuarentena}`)
  const yaHay = new Set(((previas ?? []) as Array<{ campaign_id: string; termino: string; tipo: string; estado: string }>).filter((r) => r.estado !== 'caducada').map((r) => `${r.campaign_id}|${r.termino.trim().toLowerCase()}|${r.tipo}`))

  const plan = planificarPropuestas({
    terminos,
    umbrales: { comprasParaExacta: ficha.comprasParaExacta, clicsMinimosNegativizar: ficha.clicsMinimosNegativizar, muestraMinimaClics: ficha.muestraMinimaClics },
    objetivos,
    destino: (asin, rol: Rol) => {
      // La cosecha va a la ESTABILIDAD del producto; si no la tiene (el día 1 no se crea), a la DOMINIO, que es la otra exacta
      const opciones: Rol[] = rol === 'MANUAL EXACTA / ESTABILIDAD' ? ['MANUAL EXACTA / ESTABILIDAD', 'MANUAL EXACTA / DOMINIO'] : [rol]
      for (const r of opciones) {
        const d = porAsinYRol.get(`${asin}|${r}`)
        if (d) return { campaignId: d.campaignId, nombre: d.nombre, adGroupId: null, rol: r }
      }
      return null
    },
    yaHay: (campaignId, termino, tipo) => yaHay.has(`${campaignId}|${termino.trim().toLowerCase()}|${tipo}`),
    // Cosechar a EXACTA lo que ya está en cualquiera de las dos EXACTA del producto (DOMINIO o ESTABILIDAD) sería duplicarlo
    yaEsta: (asin, rol, termino) => {
      const roles: Rol[] = rol.startsWith('MANUAL EXACTA') ? ['MANUAL EXACTA / DOMINIO', 'MANUAL EXACTA / ESTABILIDAD'] : [rol]
      const t = esAsin(termino) ? termino.trim().toLowerCase() : normalizarTexto(termino)
      return roles.some((r) => (campanasDeRol.get(`${asin}|${r}`) ?? []).some((id) => existentes.get(id)?.has(t)))
    },
    precioEstimado,
    cvrDe: (campaignId, asin) => cvrs.de(campaignId, asin).cvr,
    palabrasDe: (asin) => {
      // Las del producto (ficha) y, si no las hay, el RESUMEN de sus campañas: «JAMON SERRANO DESHUESADO 2,5KG»
      const propias = cuentaObjetivos.palabras.get(asin) ?? []
      const deCampanas = campanas.filter((c) => asinDeCampana(c.nombre) === asin).flatMap((c) => palabrasDe(partesDeNombre(c.nombre)?.resumen ?? ''))
      return [...new Set([...propias, ...deCampanas])]
    },
    estimados,
  })

  // El grupo de anuncios de cada campaña destino (una lectura por campaña distinta)
  const gruposPorCampana = new Map<string, string | null>()
  for (const id of new Set(plan.nuevas.map((n) => n.haciaCampaignId).filter((x): x is string => !!x))) {
    try {
      gruposPorCampana.set(id, (await gruposActivosDe(cuenta.conexionId, cuenta.profileId, id))[0]?.adGroupId ?? null)
    } catch {
      gruposPorCampana.set(id, null)
    }
  }

  let nuevas = 0
  for (const n of plan.nuevas as PropuestaNueva[]) {
    const { error } = await service.from('ads_propuestas').insert({
      perfil_id: cuenta.id,
      tipo: n.tipo,
      asin: n.asin,
      termino: n.termino,
      campaign_id: n.campaignId,
      campaign_nombre: n.campaignNombre,
      ad_group_id: n.adGroupId,
      desde_rol: n.desdeRol,
      hacia_rol: n.haciaRol,
      hacia_campaign_id: n.haciaCampaignId,
      hacia_campaign_nombre: n.haciaCampaignNombre,
      hacia_ad_group_id: n.haciaCampaignId ? (gruposPorCampana.get(n.haciaCampaignId) ?? null) : null,
      negativizar_en_origen: n.negativizarEnOrigen,
      motivo: n.motivo + (n.metricas.precioEstimado ? ` · precio estimado ${n.metricas.precioEstimado.toFixed(2).replace('.', ',')} (ticket medio de Ads)` : ''),
      metricas: n.metricas,
    })
    if (!error) nuevas += 1
    else if (error.code !== '23505') throw error // 23505 = ya había una pendiente igual: no es un error
  }
  return { nuevas, repetidas: plan.repetidas + plan.yaCosechadas, evaluados: plan.evaluados, sinObjetivo: plan.sinObjetivo, caducadas: caducadas?.length ?? 0 }
}

/* ------------------------------------------------------------------ */
/* Leer                                                                */
/* ------------------------------------------------------------------ */

/** Las propuestas pendientes y lo resuelto en los últimos 30 días */
export async function listarPropuestas(perfilId: string): Promise<Propuesta[]> {
  const desde = new Date(Date.now() - 30 * DIA_MS).toISOString()
  const { data, error } = await createServiceClient()
    .from('ads_propuestas')
    .select(await columnas())
    .eq('perfil_id', perfilId)
    .or(`estado.eq.pendiente,creada_at.gte.${desde}`)
    .order('creada_at', { ascending: false })
    .limit(400)
  if (error) throw error
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(deFila)
}

/* ------------------------------------------------------------------ */
/* Aplicar, descartar, deshacer                                        */
/* ------------------------------------------------------------------ */

async function aplicadasHoy(perfilId: string, automatica: boolean): Promise<number> {
  const inicio = new Date()
  inicio.setUTCHours(0, 0, 0, 0)
  const { count, error } = await createServiceClient().from('ads_propuestas').select('id', { count: 'exact', head: true }).eq('perfil_id', perfilId).eq('estado', 'aplicada').eq('automatica', automatica).gte('resuelta_at', inicio.toISOString())
  if (error) throw error
  return count ?? 0
}

async function cargar(perfilId: string, id: string) {
  const { data, error } = await createServiceClient().from('ads_propuestas').select(await columnas()).eq('perfil_id', perfilId).eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Esa propuesta no existe.')
  return data as unknown as Record<string, unknown>
}

/** Lo que hace falta para decidir si se puede aplicar: se lee UNA vez por cuenta (antes se leía por cada propuesta: tres consultas × cada fila de la pantalla) */
export interface ContextoDeAplicar {
  modo: ModoDelMotor
  fichaFirmada: boolean
  aplicadasHoy: number
}

export async function contextoDeAplicar(perfilId: string, automatica: boolean): Promise<ContextoDeAplicar> {
  const [modo, ficha, hoy] = await Promise.all([leerModo(perfilId), leerFicha(perfilId), aplicadasHoy(perfilId, automatica)])
  return { modo, fichaFirmada: Boolean(ficha.firmadaAt), aplicadasHoy: hoy }
}

export function decidirConContexto(c: ContextoDeAplicar, p: Propuesta, automatica: boolean): { ok: true } | { ok: false; motivo: string } {
  return decidirSiSePuedeAplicar({
    modo: c.modo,
    automatica,
    tipo: p.tipo,
    estado: p.estado,
    fichaFirmada: c.fichaFirmada,
    campaignNombre: p.campaignNombre,
    haciaRol: p.haciaRol,
    haciaCampaignId: p.haciaCampaignId,
    haciaAdGroupId: p.haciaAdGroupId,
    adGroupId: p.adGroupId,
    esAsin: p.esAsin,
    revisar: Boolean(p.metricas.revisar),
    aplicadasHoy: c.aplicadasHoy,
    topeDiario: automatica ? TOPE_DIARIO_AUTOPILOTO : TOPE_DIARIO_MANUAL,
  })
}

/** Lo que se puede aplicar o no, y por qué. Se comprueba aquí en el servidor, nunca solo en la pantalla (los candados están en decidirSiSePuedeAplicar, que tiene sus pruebas) */
export async function puedeAplicar(perfilId: string, p: Propuesta, automatica: boolean): Promise<{ ok: true } | { ok: false; motivo: string }> {
  return decidirConContexto(await contextoDeAplicar(perfilId, automatica), p, automatica)
}

/** Aplica una propuesta en la cuenta de Amazon. Si algo falla a mitad, deshace lo que ya hubiera creado y la deja en «error» con el motivo */
export async function aplicarPropuesta(cuenta: CuentaParaSincronizar, id: string, quien: { userId: string | null; automatica: boolean }): Promise<Propuesta> {
  const fila = await cargar(cuenta.id, id)
  const p = deFila(fila)
  const puede = await puedeAplicar(cuenta.id, p, quien.automatica)
  if (!puede.ok) throw new Error(puede.motivo)

  const service = createServiceClient()
  const comun = { perfilId: cuenta.id, campaignId: p.campaignId, nombreCampana: p.campaignNombre, origen: (quien.automatica ? 'automatico' : 'manual') as 'automatico' | 'manual', userId: quien.userId }
  const creado: { keywordId?: string; negativaId?: string; targetId?: string; negativaProductoId?: string } = {}
  // Pausar: la misma función que el botón de pausa del panel de campañas (deja el log con el motivo del motor); deshacer = volver a activarla
  if (p.tipo === 'pausar') {
    if (!p.objetivoId || (p.objetivoTipo !== 'keyword' && p.objetivoTipo !== 'producto')) throw new Error('A la propuesta le falta la segmentación que hay que pausar.')
    try {
      await cambiarEstado({ cuenta: { id: cuenta.id, conexionId: cuenta.conexionId, profileId: cuenta.profileId }, campaignId: p.campaignId, nombreCampana: p.campaignNombre, userId: quien.userId ?? '' }, { tipo: p.objetivoTipo, id: p.objetivoId, texto: p.termino, activar: false, motivo: p.motivo, origen: quien.automatica ? 'automatico' : 'manual' })
      await service.from('ads_propuestas').update({ estado: 'aplicada', aplicada: { pausada: true }, error: null, resuelta_at: new Date().toISOString(), resuelta_por: quien.userId, automatica: quien.automatica }).eq('id', id)
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e)
      await service.from('ads_propuestas').update({ estado: 'error', error: detalle.slice(0, 500), resuelta_at: new Date().toISOString(), resuelta_por: quien.userId }).eq('id', id)
      throw new Error(detalle)
    }
    return deFila(await cargar(cuenta.id, id))
  }
  // Puja y presupuesto: un solo PUT, y deshacer es volver a poner el valor de antes
  if (p.tipo === 'puja' || p.tipo === 'presupuesto') {
    try {
      if (p.valorNuevo == null || (p.tipo === 'puja' && !p.objetivoId)) throw new Error('A la propuesta le faltan datos (¿falta la migración 298?).')
      if (p.tipo === 'puja') await ponerPuja(cuenta, p.objetivoTipo, p.objetivoId as string, p.valorNuevo)
      else await ponerPresupuesto(cuenta, p.campaignId, p.valorNuevo)
      await anotarCambio({ ...comun, entidad: p.tipo === 'puja' ? (p.objetivoTipo === 'keyword' ? 'keyword' : 'target') : 'campaña', accion: 'cambiar', campo: p.tipo === 'puja' ? `puja de «${p.termino}»` : 'presupuesto diario', valorAnterior: p.valorActual == null ? null : p.valorActual.toFixed(2).replace('.', ','), valorNuevo: p.valorNuevo.toFixed(2).replace('.', ','), motivo: p.motivo })
      await service.from('ads_propuestas').update({ estado: 'aplicada', aplicada: { valorAnterior: p.valorActual }, error: null, resuelta_at: new Date().toISOString(), resuelta_por: quien.userId, automatica: quien.automatica }).eq('id', id)
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e)
      await anotarCambio({ ...comun, entidad: p.tipo === 'puja' ? (p.objetivoTipo === 'keyword' ? 'keyword' : 'target') : 'campaña', accion: 'cambiar', campo: p.tipo === 'puja' ? `puja de «${p.termino}»` : 'presupuesto diario', ok: false, error: detalle, motivo: p.motivo })
      await service.from('ads_propuestas').update({ estado: 'error', error: detalle.slice(0, 500), resuelta_at: new Date().toISOString(), resuelta_por: quien.userId }).eq('id', id)
      throw new Error(detalle)
    }
    return deFila(await cargar(cuenta.id, id))
  }
  try {
    // La puja de partida de lo cosechado: el CPC que ya pagaba (lo que ha demostrado que convierte a ese precio)
    const cpc = p.metricas.clics > 0 ? p.metricas.gasto / p.metricas.clics : 0.2
    if (p.tipo === 'promover' && p.esAsin) {
      creado.targetId = await crearSegmentacionDeProducto(cuenta.conexionId, cuenta.profileId, { campaignId: p.haciaCampaignId as string, adGroupId: p.haciaAdGroupId as string, asin: p.termino, puja: cpc })
      await anotarCambio({ ...comun, campaignId: p.haciaCampaignId, nombreCampana: p.haciaCampaignNombre, entidad: 'target', accion: 'promover', campo: 'segmentación por producto (ASIN)', valorAnterior: p.desdeRol, valorNuevo: `${p.termino.toUpperCase()} → ${p.haciaRol}`, motivo: p.motivo })
    } else if (p.tipo === 'promover') {
      const coincidencia = (p.haciaRol ?? '').includes('EXACTA') ? 'EXACT' : 'PHRASE'
      creado.keywordId = await crearKeyword(cuenta.conexionId, cuenta.profileId, { campaignId: p.haciaCampaignId as string, adGroupId: p.haciaAdGroupId as string, texto: p.termino, coincidencia, puja: cpc })
      await anotarCambio({ ...comun, campaignId: p.haciaCampaignId, nombreCampana: p.haciaCampaignNombre, entidad: 'keyword', accion: 'promover', campo: `keyword ${coincidencia === 'EXACT' ? 'exacta' : 'de frase'}`, valorAnterior: p.desdeRol, valorNuevo: `${p.termino} → ${p.haciaRol}`, motivo: p.motivo })
    }
    if ((p.tipo === 'negativizar' || p.negativizarEnOrigen) && p.esAsin) {
      // Un ASIN se excluye como segmentación negativa por producto, en el grupo donde apareció (SOP: una palabra clave negativa «b0…» no excluye nada y Amazon no avisa)
      if (!p.adGroupId) throw new Error('No se sabe en qué grupo de anuncios apareció este ASIN: exclúyelo a mano en Amazon.')
      creado.negativaProductoId = await crearNegativaDeProducto(cuenta.conexionId, cuenta.profileId, { campaignId: p.campaignId, adGroupId: p.adGroupId, asin: p.termino })
      await anotarCambio({ ...comun, entidad: 'negativa', accion: 'negativizar', campo: 'segmentación negativa por productos', valorNuevo: p.termino.toUpperCase(), motivo: p.tipo === 'promover' ? `Para que no compita con la campaña ${p.haciaRol}: ${p.motivo}` : p.motivo })
    } else if (p.tipo === 'negativizar' || p.negativizarEnOrigen) {
      creado.negativaId = await crearNegativaDeCampana(cuenta.conexionId, cuenta.profileId, p.campaignId, p.termino)
      await anotarCambio({ ...comun, entidad: 'negativa', accion: 'negativizar', campo: 'palabra clave negativa exacta', valorNuevo: p.termino, motivo: p.tipo === 'promover' ? `Para que no compita con la campaña ${p.haciaRol}: ${p.motivo}` : p.motivo })
    }
    await service.from('ads_propuestas').update({ estado: 'aplicada', aplicada: creado, error: null, resuelta_at: new Date().toISOString(), resuelta_por: quien.userId, automatica: quien.automatica }).eq('id', id)
  } catch (e) {
    // Lo que ya se hubiera creado a medias se deshace: una keyword sin su negativa en origen dejaría los dos compitiendo
    let detalle = e instanceof Error ? e.message : String(e)
    try {
      if (creado.keywordId) await borrarKeyword(cuenta.conexionId, cuenta.profileId, creado.keywordId)
      if (creado.targetId) await borrarSegmentacion(cuenta.conexionId, cuenta.profileId, creado.targetId)
      if (creado.negativaId) await borrarNegativaDeCampana(cuenta.conexionId, cuenta.profileId, creado.negativaId)
      if (creado.negativaProductoId) await borrarNegativaDeProducto(cuenta.conexionId, cuenta.profileId, creado.negativaProductoId)
      if (creado.keywordId || creado.targetId || creado.negativaId || creado.negativaProductoId) detalle += ' (lo que se había creado a medias se ha deshecho)'
    } catch (e2) {
      detalle += ` (OJO: no se ha podido deshacer lo creado a medias: ${e2 instanceof Error ? e2.message : String(e2)})`
    }
    await anotarCambio({ ...comun, entidad: 'keyword', accion: p.tipo === 'promover' ? 'promover' : 'negativizar', ok: false, error: detalle, motivo: p.motivo })
    await service.from('ads_propuestas').update({ estado: 'error', error: detalle.slice(0, 500), resuelta_at: new Date().toISOString(), resuelta_por: quien.userId }).eq('id', id)
    throw new Error(detalle)
  }
  return deFila(await cargar(cuenta.id, id))
}

/**
 * APLICAR VARIAS DE GOLPE (lo que el administrativo marca en la lista). Una a una y en orden, cada una con TODOS sus candados (tope diario incluido): si una falla, se apunta y se sigue con la
 * siguiente, porque son cambios independientes. Como mucho el tope diario manual por llamada.
 */
export async function aplicarVarias(cuenta: CuentaParaSincronizar, ids: readonly string[], userId: string): Promise<Array<{ id: string; ok: boolean; error?: string }>> {
  const salida: Array<{ id: string; ok: boolean; error?: string }> = []
  for (const id of ids.slice(0, TOPE_DIARIO_MANUAL)) {
    try {
      await aplicarPropuesta(cuenta, id, { userId, automatica: false })
      salida.push({ id, ok: true })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      salida.push({ id, ok: false, error })
      if (/Tope diario/.test(error)) break // el resto chocaría con lo mismo
    }
  }
  return salida
}

export async function descartarVarias(perfilId: string, ids: readonly string[], userId: string): Promise<number> {
  let n = 0
  for (const id of ids.slice(0, 500)) {
    try {
      await descartarPropuesta(perfilId, id, userId)
      n += 1
    } catch {
      /* ya resuelta por otra persona: no es un error de este lote */
    }
  }
  return n
}

export async function descartarPropuesta(perfilId: string, id: string, userId: string): Promise<void> {
  const p = deFila(await cargar(perfilId, id))
  if (p.estado !== 'pendiente' && p.estado !== 'error') throw new Error(`Esa propuesta ya está ${p.estado}.`)
  const { error } = await createServiceClient().from('ads_propuestas').update({ estado: 'descartada', resuelta_at: new Date().toISOString(), resuelta_por: userId }).eq('id', id)
  if (error) throw error
}

/** Quita de Amazon lo que creó una propuesta aplicada (la keyword y/o la negativa) y la deja «deshecha» */
export async function deshacerPropuesta(cuenta: CuentaParaSincronizar, id: string, userId: string): Promise<void> {
  const fila = await cargar(cuenta.id, id)
  const p = deFila(fila)
  if (p.estado !== 'aplicada') throw new Error('Solo se puede deshacer una propuesta aplicada.')
  if (p.tipo === 'pausar') {
    if (!p.objetivoId || (p.objetivoTipo !== 'keyword' && p.objetivoTipo !== 'producto')) throw new Error('A la propuesta le falta la segmentación: actívala a mano desde Campañas.')
    await cambiarEstado({ cuenta: { id: cuenta.id, conexionId: cuenta.conexionId, profileId: cuenta.profileId }, campaignId: p.campaignId, nombreCampana: p.campaignNombre, userId }, { tipo: p.objetivoTipo, id: p.objetivoId, texto: p.termino, activar: true, motivo: `Se deshace: ${p.motivo}` })
    await createServiceClient().from('ads_propuestas').update({ estado: 'deshecha', resuelta_at: new Date().toISOString(), resuelta_por: userId }).eq('id', id)
    return
  }
  if (p.tipo === 'puja' || p.tipo === 'presupuesto') {
    if (p.valorActual == null) throw new Error('No se sabe el valor de antes: no se puede deshacer.')
    if (p.tipo === 'puja') await ponerPuja(cuenta, p.objetivoTipo, p.objetivoId as string, p.valorActual)
    else await ponerPresupuesto(cuenta, p.campaignId, p.valorActual)
    await createServiceClient().from('ads_propuestas').update({ estado: 'deshecha', resuelta_at: new Date().toISOString(), resuelta_por: userId }).eq('id', id)
    await anotarCambio({ perfilId: cuenta.id, campaignId: p.campaignId, nombreCampana: p.campaignNombre, entidad: p.tipo === 'puja' ? 'keyword' : 'campaña', accion: 'cambiar', campo: 'deshacer', valorAnterior: p.valorNuevo == null ? null : p.valorNuevo.toFixed(2).replace('.', ','), valorNuevo: p.valorActual.toFixed(2).replace('.', ','), motivo: `Se deshace: ${p.motivo}`, origen: 'manual', userId })
    return
  }
  const creado = (fila.aplicada ?? {}) as { keywordId?: string; negativaId?: string; targetId?: string; negativaProductoId?: string }
  if (creado.keywordId) await borrarKeyword(cuenta.conexionId, cuenta.profileId, creado.keywordId)
  if (creado.targetId) await borrarSegmentacion(cuenta.conexionId, cuenta.profileId, creado.targetId)
  if (creado.negativaId) await borrarNegativaDeCampana(cuenta.conexionId, cuenta.profileId, creado.negativaId)
  if (creado.negativaProductoId) await borrarNegativaDeProducto(cuenta.conexionId, cuenta.profileId, creado.negativaProductoId)
  await createServiceClient().from('ads_propuestas').update({ estado: 'deshecha', resuelta_at: new Date().toISOString(), resuelta_por: userId }).eq('id', id)
  await anotarCambio({ perfilId: cuenta.id, campaignId: p.campaignId, nombreCampana: p.campaignNombre, entidad: creado.keywordId ? 'keyword' : creado.targetId ? 'target' : 'negativa', accion: 'cambiar', campo: 'deshacer', valorAnterior: p.termino, valorNuevo: 'quitado', motivo: `Se deshace: ${p.motivo}`, origen: 'manual', userId })
}

/* ------------------------------------------------------------------ */
/* El piloto automático                                                */
/* ------------------------------------------------------------------ */

/** Si la cuenta está en autopiloto: aplica las negativas pendientes, hasta el tope del día. Devuelve cuántas */
export async function pilotoAutomatico(cuenta: CuentaParaSincronizar): Promise<{ aplicadas: number; fallidas: number }> {
  if ((await leerModo(cuenta.id)) !== 'autopiloto') return { aplicadas: 0, fallidas: 0 }
  const pendientes = (await listarPropuestas(cuenta.id)).filter((p) => p.estado === 'pendiente' && p.tipo === 'negativizar')
  let aplicadas = 0
  let fallidas = 0
  for (const p of pendientes) {
    const puede = await puedeAplicar(cuenta.id, p, true)
    if (!puede.ok) {
      if (/Tope diario/.test(puede.motivo)) break
      continue
    }
    try {
      await aplicarPropuesta(cuenta, p.id, { userId: null, automatica: true })
      aplicadas += 1
    } catch {
      fallidas += 1
    }
  }
  return { aplicadas, fallidas }
}
