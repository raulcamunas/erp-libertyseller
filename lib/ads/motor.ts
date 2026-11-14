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
  leerPresupuestoActual,
  leerPujaActual,
  ponerPresupuesto,
  ponerPuja,
} from './escritura'
import { anotarEnLote } from './log'
import { conRastro } from './rastro'
import { todasLasFilas } from './paginar'
import { objetivosDesdeAcos, precioParaMotor, ticketsMedios } from './margen'
import { decidirEnsayo, decidirSiSePuedeAplicar, inicioDelDiaEnEspana, motivoDeObsoleta, planificarPropuestas, valorSigueIgual, type DestinoDeCampana, type PropuestaNueva } from './motor-calculo'
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

/** «aplicando» (311) o «aprobada» (sin la 311) = reclamada por quien la aplica; «obsoleta» (311) = el valor de Amazon ya no era el de la propuesta */
export type EstadoDePropuesta = 'pendiente' | 'aprobada' | 'aplicando' | 'aplicada' | 'descartada' | 'deshecha' | 'error' | 'caducada' | 'obsoleta'

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
  const anterior = await leerModo(perfilId)
  const { error } = await createServiceClient().from('ads_motor_config').upsert({ perfil_id: perfilId, modo, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'perfil_id' })
  if (error) throw error
  await anotarCambio({ perfilId, entidad: 'motor', accion: 'cambiar', campo: 'modo del motor automático', valorAnterior: anterior, valorNuevo: modo, motivo: 'Lo cambia un administrador desde PPC · Amazon Ads', origen: 'manual', userId })
}

/** El modo de cada cuenta con el motor encendido (una consulta para todas) */
export async function modosConMotor(): Promise<Map<string, ModoDelMotor>> {
  const { data, error } = await createServiceClient().from('ads_motor_config').select('perfil_id, modo').neq('modo', 'apagado')
  if (error) throw error
  return new Map(((data ?? []) as Array<{ perfil_id: string; modo: string }>).filter((r) => MODOS.includes(r.modo as ModoDelMotor)).map((r) => [r.perfil_id, r.modo as ModoDelMotor]))
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
  // Paginado: con más de 1.000 propuestas recientes PostgREST cortaba en silencio y se repetían propuestas
  const { data: previas, error: ePrevias } = await todasLasFilas((a, b) => service.from('ads_propuestas').select('id, campaign_id, termino, tipo, estado, resuelta_at').eq('perfil_id', cuenta.id).or(`estado.eq.pendiente,resuelta_at.gte.${desdeCuarentena}`).order('id').range(a, b))
  if (ePrevias) throw ePrevias
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

  const filas = (plan.nuevas as PropuestaNueva[]).map((n) => ({
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
  }))
  // En LOTE (antes, un insert por propuesta). Si una choca con una pendiente igual (23505), el lote entero se rechaza: entonces, una a una
  let nuevas = 0
  for (let i = 0; i < filas.length; i += 200) {
    const trozo = filas.slice(i, i + 200)
    const { error } = await service.from('ads_propuestas').insert(trozo)
    if (!error) {
      nuevas += trozo.length
      continue
    }
    if (error.code !== '23505') throw error
    for (const f of trozo) {
      const { error: e1 } = await service.from('ads_propuestas').insert(f)
      if (!e1) nuevas += 1
      else if (e1.code !== '23505') throw e1 // 23505 = ya había una pendiente igual: no es un error
    }
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

/**
 * EL ESTADO DE RESERVA. Antes de llamar a Amazon, la propuesta se RECLAMA con un UPDATE condicionado (… WHERE estado IN ('pendiente','error') RETURNING):
 * solo una petición la consigue, así que dos clics, dos personas o el autopiloto más una persona ya no aplican lo mismo dos veces. Con la migración 311 el
 * estado es «aplicando»; sin ella, «aprobada» (que ya admitía el CHECK y no se usaba). Se detecta la primera vez y se recuerda.
 */
let estadoDeReserva: 'aplicando' | 'aprobada' = 'aplicando'
/** Lo mismo para «obsoleta» (311); sin ella, «caducada» con el motivo en el error */
let estadoObsoleta: 'obsoleta' | 'caducada' = 'obsoleta'

const esCheck = (e: { code?: string } | null) => e?.code === '23514'

/** Una reserva que lleva más de esto sin resolverse es un proceso que murió a mitad: la pantalla la marca para revisar a mano en Amazon (puede estar aplicada) */
export const MINUTOS_RESERVA_COLGADA = 15

async function aplicadasHoy(perfilId: string, automatica: boolean): Promise<number> {
  const { count, error } = await createServiceClient().from('ads_propuestas').select('id', { count: 'exact', head: true }).eq('perfil_id', perfilId).eq('estado', 'aplicada').eq('automatica', automatica).gte('resuelta_at', inicioDelDiaEnEspana(Date.now()))
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

function entradaDeAplicar(c: ContextoDeAplicar, p: Propuesta, automatica: boolean) {
  return {
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
  }
}

export function decidirConContexto(c: ContextoDeAplicar, p: Propuesta, automatica: boolean): { ok: true } | { ok: false; motivo: string } {
  return decidirSiSePuedeAplicar(entradaDeAplicar(c, p, automatica))
}

/** Lo que se puede aplicar o no, y por qué. Se comprueba aquí en el servidor, nunca solo en la pantalla (los candados están en decidirSiSePuedeAplicar, que tiene sus pruebas) */
export async function puedeAplicar(perfilId: string, p: Propuesta, automatica: boolean): Promise<{ ok: true } | { ok: false; motivo: string }> {
  return decidirConContexto(await contextoDeAplicar(perfilId, automatica), p, automatica)
}

/** Reclama la propuesta (ver estadoDeReserva). Devuelve la fila reclamada o lanza diciendo por qué no se ha podido */
async function reclamar(perfilId: string, id: string, userId: string | null, desde: readonly string[]): Promise<Record<string, unknown>> {
  const service = createServiceClient()
  const intentar = () =>
    service
      .from('ads_propuestas')
      .update({ estado: estadoDeReserva, error: null, resuelta_at: new Date().toISOString(), resuelta_por: userId })
      .eq('perfil_id', perfilId)
      .eq('id', id)
      .in('estado', desde as string[])
      .select('id')
  let r = await intentar()
  if (esCheck(r.error) && estadoDeReserva === 'aplicando') {
    estadoDeReserva = 'aprobada'
    r = await intentar()
  }
  if (r.error) throw r.error
  if (!r.data || r.data.length === 0) {
    const ahora = deFila(await cargar(perfilId, id))
    const enCurso = ahora.estado === 'aplicando' || ahora.estado === 'aprobada'
    throw new Error(enCurso ? 'Otra persona (o el piloto automático) está aplicando esta propuesta ahora mismo.' : `Esa propuesta ya está ${ahora.estado}.`)
  }
  return r.data[0] as Record<string, unknown>
}

/**
 * Guarda el resultado de una propuesta RECLAMADA. Comprueba el error (antes no se miraba) y reintenta una vez. Si aun así no se puede guardar, lo que se hizo en
 * Amazon queda en el log con sus ids («aplicado en Amazon pero no guardado») y la propuesta se queda en reserva: así nadie la vuelve a aplicar.
 */
async function guardarResultado(perfilId: string, id: string, cambios: Record<string, unknown>, rastro: { campaignId: string | null; nombreCampana: string | null; userId: string | null; origen: 'manual' | 'automatico'; que: string }): Promise<void> {
  const service = createServiceClient()
  const intentar = () => service.from('ads_propuestas').update(cambios).eq('perfil_id', perfilId).eq('id', id).in('estado', ['aplicando', 'aprobada']).select('id')
  let r = await intentar()
  if (esCheck(r.error) && cambios.estado === 'obsoleta') {
    estadoObsoleta = 'caducada'
    cambios = { ...cambios, estado: 'caducada' }
    r = await intentar()
  }
  if (r.error) r = await intentar()
  if (!r.error && r.data && r.data.length > 0) return
  const detalle = r.error ? r.error.message : 'la propuesta ya no estaba reservada'
  await anotarCambio({
    perfilId,
    campaignId: rastro.campaignId,
    nombreCampana: rastro.nombreCampana,
    entidad: 'propuesta',
    accion: 'cambiar',
    campo: 'estado de la propuesta',
    valorNuevo: JSON.stringify(cambios).slice(0, 500),
    motivo: `${rastro.que}: hecho en Amazon pero NO guardado en el ERP. La propuesta se queda «aplicando» para que nadie la repita; revísala.`,
    origen: rastro.origen,
    ok: false,
    error: detalle,
    userId: rastro.userId,
    propuestaId: id,
  })
  throw new Error(`${rastro.que} se ha hecho en Amazon, pero el ERP no ha podido guardarlo (${detalle}). Queda en el log; no vuelvas a aplicarla.`)
}

/** Libera una reserva sin haber tocado Amazon (falló una comprobación antes de escribir): vuelve al estado de antes */
async function liberar(perfilId: string, id: string, estado: string, error: string | null): Promise<void> {
  const { error: e } = await createServiceClient().from('ads_propuestas').update({ estado, error, resuelta_at: null }).eq('perfil_id', perfilId).eq('id', id).in('estado', ['aplicando', 'aprobada'])
  if (e) console.error('Ads: no se ha podido liberar la propuesta', id, e.message)
}

/** El producto de la propuesta (para rellenar producto_id del log). Una consulta pequeña; null si no está dado de alta */
async function productoDe(perfilId: string, asin: string | null): Promise<string | null> {
  if (!asin) return null
  const { data } = await createServiceClient().from('ads_productos').select('id').eq('perfil_id', perfilId).ilike('asin', asin).limit(1).maybeSingle()
  return ((data as { id: string } | null)?.id as string | undefined) ?? null
}

export interface ResultadoDeEnsayo {
  ensayo: true
  /** Lo que se haría en Amazon, llamada a llamada */
  llamadas: Array<{ metodo: string; ruta: string; cuerpo: unknown; simulada: boolean }>
  /** Lo que de verdad impediría aplicarla hoy (modo, ficha, tope) */
  avisos: string[]
  /** Si el camino ha fallado antes de llegar a escribir (una lectura de Amazon, un dato que falta…) */
  error: string | null
}

/**
 * Aplica una propuesta en la cuenta de Amazon. EL ORDEN IMPORTA:
 *   1. los candados (decidirSiSePuedeAplicar);
 *   2. RECLAMARLA (UPDATE condicionado): si otra petición ya la tiene, se para aquí sin tocar Amazon;
 *   3. en puja y presupuesto, RELEER el valor actual en Amazon: si no es el de la propuesta, se marca «obsoleta» y no se pisa;
 *   4. escribir en Amazon dentro de un RASTRO (la petición y la respuesta van al log);
 *   5. guardar el resultado comprobando el error (guardarResultado).
 * Si algo falla a mitad, deshace lo que ya hubiera creado y la deja en «error» con el motivo.
 */
export async function aplicarPropuesta(cuenta: CuentaParaSincronizar, id: string, quien: { userId: string | null; automatica: boolean; contexto?: ContextoDeAplicar }): Promise<Propuesta> {
  const p = deFila(await cargar(cuenta.id, id))
  const decision = decidirConContexto(quien.contexto ?? (await contextoDeAplicar(cuenta.id, quien.automatica)), p, quien.automatica)
  if (!decision.ok) throw new Error(decision.motivo)
  const estadoAntes = p.estado
  await reclamar(cuenta.id, id, quien.userId, ['pendiente', 'error'])
  const productoId = await productoDe(cuenta.id, p.asin)
  try {
    await conRastro({ propuestaId: id }, () => recorrerAplicar(cuenta, p, { userId: quien.userId, automatica: quien.automatica, productoId, estadoAntes }))
  } catch (e) {
    if (e instanceof ObsoletaOLiberada) throw new Error(e.message)
    throw e
  }
  return deFila(await cargar(cuenta.id, id))
}

/** Se lanza cuando la propuesta se ha resuelto sin escribir (obsoleta) o se ha liberado: no es un fallo de Amazon */
class ObsoletaOLiberada extends Error {}

/** EL ENSAYO: el mismo camino que aplicar, sin reclamar la propuesta ni escribir en Amazon (las lecturas sí se hacen). Todo queda en el log con origen «ensayo» */
export async function ensayarPropuesta(cuenta: CuentaParaSincronizar, id: string, userId: string): Promise<ResultadoDeEnsayo> {
  const p = deFila(await cargar(cuenta.id, id))
  const decision = decidirEnsayo(entradaDeAplicar(await contextoDeAplicar(cuenta.id, false), p, false))
  if (!decision.ok) throw new Error(decision.motivo)
  const productoId = await productoDe(cuenta.id, p.asin)
  let error: string | null = null
  const { llamadas } = await conRastro({ ensayo: true, propuestaId: id }, async () => {
    try {
      await recorrerAplicar(cuenta, p, { userId, automatica: false, productoId, estadoAntes: p.estado, ensayo: true })
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  })
  return { ensayo: true, llamadas: llamadas.filter((l) => l.simulada).map((l) => ({ metodo: l.metodo, ruta: l.ruta, cuerpo: l.cuerpo, simulada: l.simulada })), avisos: decision.avisos, error }
}

/** El camino de aplicar, común a la aplicación de verdad y al ensayo (en ensayo no se toca ads_propuestas y llamarAds no escribe: lo decide el rastro) */
async function recorrerAplicar(cuenta: CuentaParaSincronizar, p: Propuesta, q: { userId: string | null; automatica: boolean; productoId: string | null; estadoAntes: string; ensayo?: boolean }): Promise<void> {
  const id = p.id
  const origen = (q.automatica ? 'automatico' : 'manual') as 'automatico' | 'manual'
  const comun = { perfilId: cuenta.id, productoId: q.productoId, campaignId: p.campaignId, nombreCampana: p.campaignNombre, origen, userId: q.userId }
  const resolver = (estado: string, extra: Record<string, unknown>, que: string) =>
    q.ensayo ? Promise.resolve() : guardarResultado(cuenta.id, id, { estado, ...extra, resuelta_at: new Date().toISOString(), resuelta_por: q.userId, automatica: q.automatica }, { campaignId: p.campaignId, nombreCampana: p.campaignNombre, userId: q.userId, origen, que })
  const marcarError = async (detalle: string) => {
    if (q.ensayo) return
    const { error } = await createServiceClient().from('ads_propuestas').update({ estado: 'error', error: detalle.slice(0, 500), resuelta_at: new Date().toISOString(), resuelta_por: q.userId }).eq('perfil_id', cuenta.id).eq('id', id).in('estado', ['aplicando', 'aprobada'])
    if (error) await anotarCambio({ ...comun, entidad: 'propuesta', accion: 'cambiar', campo: 'estado de la propuesta', valorNuevo: 'error', motivo: 'No se ha podido marcar el error en la propuesta', ok: false, error: `${error.message} · ${detalle}`, propuestaId: id })
  }

  // Pausar: la misma función que el botón de pausa del panel de campañas (deja el log con el motivo del motor); deshacer = volver a activarla
  if (p.tipo === 'pausar') {
    if (!p.objetivoId || (p.objetivoTipo !== 'keyword' && p.objetivoTipo !== 'producto')) {
      if (!q.ensayo) await liberar(cuenta.id, id, q.estadoAntes, 'A la propuesta le falta la segmentación que hay que pausar.')
      throw new ObsoletaOLiberada('A la propuesta le falta la segmentación que hay que pausar.')
    }
    try {
      await cambiarEstado({ cuenta: { id: cuenta.id, conexionId: cuenta.conexionId, profileId: cuenta.profileId }, campaignId: p.campaignId, nombreCampana: p.campaignNombre, userId: q.userId ?? '' }, { tipo: p.objetivoTipo, id: p.objetivoId, texto: p.termino, activar: false, motivo: p.motivo, origen })
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e)
      await marcarError(detalle)
      throw new Error(detalle)
    }
    await resolver('aplicada', { aplicada: { pausada: true }, error: null }, 'La pausa')
    return
  }

  // Puja y presupuesto: se RELEE el valor de ahora; si no es el de la propuesta, obsoleta. Un solo PUT, y deshacer es volver a poner el valor de antes
  if (p.tipo === 'puja' || p.tipo === 'presupuesto') {
    const entidad = p.tipo === 'puja' ? (p.objetivoTipo === 'keyword' ? 'keyword' : 'target') : 'campaña'
    const campo = p.tipo === 'puja' ? `puja de «${p.termino}»` : 'presupuesto diario'
    const entidadId = p.tipo === 'puja' ? p.objetivoId : p.campaignId
    if (p.valorNuevo == null || (p.tipo === 'puja' && !p.objetivoId)) {
      if (!q.ensayo) await liberar(cuenta.id, id, q.estadoAntes, 'A la propuesta le faltan datos (¿falta la migración 298?).')
      throw new ObsoletaOLiberada('A la propuesta le faltan datos (¿falta la migración 298?).')
    }
    let heredada = false
    try {
      const actual = p.tipo === 'puja' ? await leerPujaActual(cuenta, p.objetivoTipo, p.objetivoId as string) : { puja: await leerPresupuestoActual(cuenta, p.campaignId), heredada: false }
      heredada = Boolean(actual?.heredada)
      const valorAhora = actual?.puja ?? null
      if (!valorSigueIgual(p.valorActual, valorAhora)) {
        const motivo = motivoDeObsoleta(p.tipo, p.valorActual, valorAhora)
        await anotarCambio({ ...comun, entidad: 'propuesta', accion: 'descartar', campo: 'propuesta obsoleta', valorAnterior: p.valorActual == null ? null : fmt(p.valorActual), valorNuevo: valorAhora == null ? null : fmt(valorAhora), motivo, entidadId })
        await resolver(estadoObsoleta, { error: motivo }, 'Marcarla obsoleta')
        throw new ObsoletaOLiberada(motivo)
      }
    } catch (e) {
      if (e instanceof ObsoletaOLiberada) throw e
      // No se ha podido LEER: no se ha escrito nada, así que se libera tal como estaba
      const detalle = `No se ha podido leer el valor actual en Amazon: ${e instanceof Error ? e.message : String(e)}`
      if (!q.ensayo) await liberar(cuenta.id, id, q.estadoAntes, detalle.slice(0, 500))
      await anotarCambio({ ...comun, entidad, accion: 'cambiar', campo, ok: false, error: detalle, motivo: p.motivo, entidadId })
      throw new ObsoletaOLiberada(detalle)
    }
    try {
      if (p.tipo === 'puja') await ponerPuja(cuenta, p.objetivoTipo, p.objetivoId as string, p.valorNuevo)
      else await ponerPresupuesto(cuenta, p.campaignId, p.valorNuevo)
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e)
      await anotarCambio({ ...comun, entidad, accion: 'cambiar', campo, valorAnterior: p.valorActual == null ? null : fmt(p.valorActual), valorNuevo: fmt(p.valorNuevo), ok: false, error: detalle, motivo: p.motivo, entidadId })
      await marcarError(detalle)
      throw new Error(detalle)
    }
    await anotarCambio({ ...comun, entidad, accion: 'cambiar', campo, valorAnterior: p.valorActual == null ? null : fmt(p.valorActual) + (heredada ? ' (heredada del grupo)' : ''), valorNuevo: fmt(p.valorNuevo), motivo: p.motivo, entidadId })
    await resolver('aplicada', { aplicada: { valorAnterior: p.valorActual, heredada }, error: null }, p.tipo === 'puja' ? 'La puja' : 'El presupuesto')
    return
  }

  const creado: { keywordId?: string; negativaId?: string; targetId?: string; negativaProductoId?: string } = {}
  try {
    // La puja de partida de lo cosechado: el CPC que ya pagaba (lo que ha demostrado que convierte a ese precio)
    const cpc = p.metricas.clics > 0 ? p.metricas.gasto / p.metricas.clics : 0.2
    if (p.tipo === 'promover' && p.esAsin) {
      creado.targetId = await crearSegmentacionDeProducto(cuenta.conexionId, cuenta.profileId, { campaignId: p.haciaCampaignId as string, adGroupId: p.haciaAdGroupId as string, asin: p.termino, puja: cpc })
      await anotarCambio({ ...comun, campaignId: p.haciaCampaignId, nombreCampana: p.haciaCampaignNombre, entidad: 'target', accion: 'promover', campo: 'segmentación por producto (ASIN)', valorAnterior: p.desdeRol, valorNuevo: `${p.termino.toUpperCase()} → ${p.haciaRol}`, motivo: p.motivo, entidadId: creado.targetId })
    } else if (p.tipo === 'promover') {
      const coincidencia = (p.haciaRol ?? '').includes('EXACTA') ? 'EXACT' : 'PHRASE'
      creado.keywordId = await crearKeyword(cuenta.conexionId, cuenta.profileId, { campaignId: p.haciaCampaignId as string, adGroupId: p.haciaAdGroupId as string, texto: p.termino, coincidencia, puja: cpc })
      await anotarCambio({ ...comun, campaignId: p.haciaCampaignId, nombreCampana: p.haciaCampaignNombre, entidad: 'keyword', accion: 'promover', campo: `keyword ${coincidencia === 'EXACT' ? 'exacta' : 'de frase'}`, valorAnterior: p.desdeRol, valorNuevo: `${p.termino} → ${p.haciaRol}`, motivo: p.motivo, entidadId: creado.keywordId })
    }
    if ((p.tipo === 'negativizar' || p.negativizarEnOrigen) && p.esAsin) {
      // Un ASIN se excluye como segmentación negativa por producto, en el grupo donde apareció (SOP: una palabra clave negativa «b0…» no excluye nada y Amazon no avisa)
      if (!p.adGroupId) throw new Error('No se sabe en qué grupo de anuncios apareció este ASIN: exclúyelo a mano en Amazon.')
      creado.negativaProductoId = await crearNegativaDeProducto(cuenta.conexionId, cuenta.profileId, { campaignId: p.campaignId, adGroupId: p.adGroupId, asin: p.termino })
      await anotarCambio({ ...comun, entidad: 'negativa', accion: 'negativizar', campo: 'segmentación negativa por productos', valorNuevo: p.termino.toUpperCase(), motivo: p.tipo === 'promover' ? `Para que no compita con la campaña ${p.haciaRol}: ${p.motivo}` : p.motivo, entidadId: creado.negativaProductoId })
    } else if (p.tipo === 'negativizar' || p.negativizarEnOrigen) {
      creado.negativaId = await crearNegativaDeCampana(cuenta.conexionId, cuenta.profileId, p.campaignId, p.termino)
      await anotarCambio({ ...comun, entidad: 'negativa', accion: 'negativizar', campo: 'palabra clave negativa exacta', valorNuevo: p.termino, motivo: p.tipo === 'promover' ? `Para que no compita con la campaña ${p.haciaRol}: ${p.motivo}` : p.motivo, entidadId: creado.negativaId })
    }
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
    const entidad = p.tipo === 'promover' ? (p.esAsin ? 'target' : 'keyword') : 'negativa'
    await anotarCambio({ ...comun, entidad, accion: p.tipo === 'promover' ? 'promover' : 'negativizar', campo: p.termino, ok: false, error: detalle, motivo: p.motivo })
    await marcarError(detalle)
    throw new Error(detalle)
  }
  await resolver('aplicada', { aplicada: creado, error: null }, p.tipo === 'promover' ? 'La cosecha' : 'La negativa')
}

const fmt = (n: number) => n.toFixed(2).replace('.', ',')

/**
 * APLICAR VARIAS DE GOLPE (lo que el administrativo marca en la lista). Una a una y en orden, cada una con TODOS sus candados: si una falla, se apunta y se sigue
 * con la siguiente, porque son cambios independientes. El contexto (modo, ficha, aplicadas hoy) se lee UNA vez y se va sumando; como mucho el tope diario manual.
 */
export async function aplicarVarias(cuenta: CuentaParaSincronizar, ids: readonly string[], userId: string): Promise<Array<{ id: string; ok: boolean; error?: string }>> {
  const salida: Array<{ id: string; ok: boolean; error?: string }> = []
  const contexto = await contextoDeAplicar(cuenta.id, false)
  for (const id of ids.slice(0, TOPE_DIARIO_MANUAL)) {
    try {
      await aplicarPropuesta(cuenta, id, { userId, automatica: false, contexto })
      contexto.aplicadasHoy += 1
      salida.push({ id, ok: true })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      salida.push({ id, ok: false, error })
      if (/Tope diario/.test(error)) break // el resto chocaría con lo mismo
    }
  }
  return salida
}

/** Descartar UNA: atómico (solo si sigue pendiente o en error) y con su entrada en el log */
export async function descartarPropuesta(perfilId: string, id: string, userId: string): Promise<void> {
  const n = await descartarVarias(perfilId, [id], userId)
  if (n === 0) {
    const p = deFila(await cargar(perfilId, id))
    throw new Error(`Esa propuesta ya está ${p.estado}.`)
  }
}

/** Descartar varias: UN update condicionado (… WHERE estado IN ('pendiente','error')) y UN insert en el log con una fila por propuesta. Devuelve cuántas */
export async function descartarVarias(perfilId: string, ids: readonly string[], userId: string): Promise<number> {
  const lote = [...new Set(ids)].slice(0, 500)
  if (lote.length === 0) return 0
  const { data, error } = await createServiceClient()
    .from('ads_propuestas')
    .update({ estado: 'descartada', resuelta_at: new Date().toISOString(), resuelta_por: userId })
    .eq('perfil_id', perfilId)
    .in('id', lote)
    .in('estado', ['pendiente', 'error'])
    .select('id, tipo, termino, campaign_id, campaign_nombre, objetivo_id')
  if (error) throw error
  const filas = (data ?? []) as Array<{ id: string; tipo: string; termino: string; campaign_id: string; campaign_nombre: string; objetivo_id?: string | null }>
  await anotarEnLote(
    filas.map((f) => ({ perfilId, campaignId: f.campaign_id, nombreCampana: f.campaign_nombre, entidad: 'propuesta' as const, accion: 'descartar' as const, campo: `${f.tipo} · «${f.termino.slice(0, 120)}»`, motivo: 'Descartada por una persona', origen: 'manual' as const, userId, propuestaId: f.id, entidadId: f.objetivo_id ?? null }))
  )
  return filas.length
}

/**
 * Quita de Amazon lo que hizo una propuesta aplicada y la deja «deshecha». También ATÓMICO: se reclama (aplicada → reserva), y si Amazon falla vuelve a «aplicada»
 * con el error y su entrada en el log. En puja y presupuesto se relee el valor: si ya no es el que puso el motor, no se pisa.
 */
export async function deshacerPropuesta(cuenta: CuentaParaSincronizar, id: string, userId: string): Promise<void> {
  const fila = await cargar(cuenta.id, id)
  const p = deFila(fila)
  if (p.estado !== 'aplicada') throw new Error('Solo se puede deshacer una propuesta aplicada.')
  await reclamar(cuenta.id, id, userId, ['aplicada'])
  const productoId = await productoDe(cuenta.id, p.asin)
  const comun = { perfilId: cuenta.id, productoId, campaignId: p.campaignId, nombreCampana: p.campaignNombre, origen: 'manual' as const, userId, propuestaId: id }
  const volverAAplicada = async (detalle: string) => {
    const { error } = await createServiceClient().from('ads_propuestas').update({ estado: 'aplicada', error: `Deshacer falló: ${detalle}`.slice(0, 500) }).eq('perfil_id', cuenta.id).eq('id', id).in('estado', ['aplicando', 'aprobada'])
    if (error) console.error('Ads: no se ha podido devolver la propuesta a aplicada', id, error.message)
  }
  const resolver = () => guardarResultado(cuenta.id, id, { estado: 'deshecha', resuelta_at: new Date().toISOString(), resuelta_por: userId }, { campaignId: p.campaignId, nombreCampana: p.campaignNombre, userId, origen: 'manual', que: 'Deshacer' })

  await conRastro({ propuestaId: id }, async () => {
    if (p.tipo === 'pausar') {
      if (!p.objetivoId || (p.objetivoTipo !== 'keyword' && p.objetivoTipo !== 'producto')) {
        await volverAAplicada('a la propuesta le falta la segmentación')
        throw new Error('A la propuesta le falta la segmentación: actívala a mano desde Campañas.')
      }
      try {
        await cambiarEstado({ cuenta: { id: cuenta.id, conexionId: cuenta.conexionId, profileId: cuenta.profileId }, campaignId: p.campaignId, nombreCampana: p.campaignNombre, userId }, { tipo: p.objetivoTipo, id: p.objetivoId, texto: p.termino, activar: true, motivo: `Se deshace: ${p.motivo}` })
      } catch (e) {
        const detalle = e instanceof Error ? e.message : String(e)
        await volverAAplicada(detalle)
        throw new Error(detalle)
      }
      await resolver()
      return
    }
    if (p.tipo === 'puja' || p.tipo === 'presupuesto') {
      const entidad = p.tipo === 'puja' ? (p.objetivoTipo === 'keyword' ? 'keyword' : 'target') : 'campaña'
      const entidadId = p.tipo === 'puja' ? p.objetivoId : p.campaignId
      try {
        if (p.valorActual == null || p.valorNuevo == null) throw new Error('No se sabe el valor de antes: no se puede deshacer.')
        const actual = p.tipo === 'puja' ? (await leerPujaActual(cuenta, p.objetivoTipo, p.objetivoId as string))?.puja ?? null : await leerPresupuestoActual(cuenta, p.campaignId)
        if (!valorSigueIgual(p.valorNuevo, actual)) throw new Error(`En Amazon ya no está el valor que puso el motor (${fmt(p.valorNuevo)}; ahora ${actual == null ? 'no se encuentra' : fmt(actual)}): alguien lo ha cambiado después y no se pisa.`)
        if (p.tipo === 'puja') await ponerPuja(cuenta, p.objetivoTipo, p.objetivoId as string, p.valorActual)
        else await ponerPresupuesto(cuenta, p.campaignId, p.valorActual)
      } catch (e) {
        const detalle = e instanceof Error ? e.message : String(e)
        await anotarCambio({ ...comun, entidad, accion: 'deshacer', campo: p.tipo === 'puja' ? `puja de «${p.termino}»` : 'presupuesto diario', ok: false, error: detalle, motivo: `Se deshace: ${p.motivo}`, entidadId })
        await volverAAplicada(detalle)
        throw new Error(detalle)
      }
      await anotarCambio({ ...comun, entidad, accion: 'deshacer', campo: p.tipo === 'puja' ? `puja de «${p.termino}»` : 'presupuesto diario', valorAnterior: fmt(p.valorNuevo), valorNuevo: fmt(p.valorActual), motivo: `Se deshace: ${p.motivo}`, entidadId })
      await resolver()
      return
    }
    const creado = (fila.aplicada ?? {}) as { keywordId?: string; negativaId?: string; targetId?: string; negativaProductoId?: string }
    const entidad = creado.keywordId ? 'keyword' : creado.targetId ? 'target' : 'negativa'
    const entidadId = creado.keywordId ?? creado.targetId ?? creado.negativaId ?? creado.negativaProductoId ?? null
    try {
      if (creado.keywordId) await borrarKeyword(cuenta.conexionId, cuenta.profileId, creado.keywordId)
      if (creado.targetId) await borrarSegmentacion(cuenta.conexionId, cuenta.profileId, creado.targetId)
      if (creado.negativaId) await borrarNegativaDeCampana(cuenta.conexionId, cuenta.profileId, creado.negativaId)
      if (creado.negativaProductoId) await borrarNegativaDeProducto(cuenta.conexionId, cuenta.profileId, creado.negativaProductoId)
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e)
      await anotarCambio({ ...comun, entidad, accion: 'deshacer', campo: p.termino, ok: false, error: detalle, motivo: `Se deshace: ${p.motivo}`, entidadId })
      await volverAAplicada(detalle)
      throw new Error(detalle)
    }
    await anotarCambio({ ...comun, entidad, accion: 'deshacer', campo: p.termino, valorAnterior: p.termino, valorNuevo: 'quitado', motivo: `Se deshace: ${p.motivo}`, entidadId })
    await resolver()
  })
}

/* ------------------------------------------------------------------ */
/* El piloto automático                                                */
/* ------------------------------------------------------------------ */

/** Si la cuenta está en autopiloto: aplica las negativas pendientes, hasta el tope del día. El contexto se lee UNA vez (antes, tres consultas por propuesta y otra vez dentro de aplicar) */
export async function pilotoAutomatico(cuenta: CuentaParaSincronizar): Promise<{ aplicadas: number; fallidas: number }> {
  const contexto = await contextoDeAplicar(cuenta.id, true)
  if (contexto.modo !== 'autopiloto' || contexto.aplicadasHoy >= TOPE_DIARIO_AUTOPILOTO) return { aplicadas: 0, fallidas: 0 }
  const pendientes = (await listarPropuestas(cuenta.id)).filter((p) => p.estado === 'pendiente' && p.tipo === 'negativizar')
  let aplicadas = 0
  let fallidas = 0
  for (const p of pendientes) {
    const puede = decidirConContexto(contexto, p, true)
    if (!puede.ok) {
      if (/Tope diario/.test(puede.motivo)) break
      continue
    }
    try {
      await aplicarPropuesta(cuenta, p.id, { userId: null, automatica: true, contexto })
      contexto.aplicadasHoy += 1
      aplicadas += 1
    } catch {
      fallidas += 1
    }
  }
  return { aplicadas, fallidas }
}
