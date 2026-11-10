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
 *   3. SOLO CAMPAÑAS CON LA NOMENCLATURA del SOP: las demás no se tocan.
 *   4. EL PILOTO AUTOMÁTICO SOLO NEGATIVIZA, y con un tope al día. Promover un término crea una keyword nueva (un cambio estructural) y el SOP exige aprobación.
 *   5. TODO SE ANOTA EN EL LOG y todo lo aplicado se puede DESHACER: se guardan los identificadores de lo creado en Amazon.
 *   6. Un término que ya se propuso o se resolvió hace menos de 14 días no se vuelve a proponer (cuarentena: un cambio cada vez y con ventana de lectura).
 */

import { createServiceClient } from '@/lib/supabase/service'
import { campanasDe } from './campanas'
import { anotarCambio, leerFicha, productosDeCuenta } from './cuenta'
import { borrarKeyword, borrarNegativaDeCampana, crearKeyword, crearNegativaDeCampana, gruposActivosDe } from './escritura'
import { margenDeProducto, objetivosDeProducto } from './margen'
import { decidirSiSePuedeAplicar, planificarPropuestas, type DestinoDeCampana, type PropuestaNueva } from './motor-calculo'
import { asinDeCampana } from './productos-agrupar'
import { partesDeNombre, type ObjetivosParaReglas, type TipoDePropuesta } from './reglas'
import { leerTerminos } from './terminos'
import type { CuentaParaSincronizar } from './sincronizar'
import type { Rol } from './estructura'

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
  metricas: { clics: number; gasto: number; pedidos: number; ventas: number; acosPct: number | null }
  estado: EstadoDePropuesta
  error: string | null
  automatica: boolean
  creadaAt: string
  resueltaAt: string | null
}

const COLUMNAS = 'id, tipo, asin, termino, campaign_id, campaign_nombre, ad_group_id, desde_rol, hacia_rol, hacia_campaign_id, hacia_campaign_nombre, hacia_ad_group_id, negativizar_en_origen, motivo, metricas, estado, error, automatica, creada_at, resuelta_at, aplicada'

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
/* Generar propuestas                                                  */
/* ------------------------------------------------------------------ */

export interface ResumenDeGeneracion {
  omitido?: 'apagado' | 'sin-terminos'
  nuevas: number
  repetidas: number
  evaluados: number
  sinCoste: string[]
  caducadas: number
}

/** Los términos y la ficha → propuestas nuevas, guardadas como pendientes. No toca Amazon salvo para LEER las campañas y sus grupos */
export async function generarPropuestas(cuenta: CuentaParaSincronizar): Promise<ResumenDeGeneracion> {
  const vacio = { nuevas: 0, repetidas: 0, evaluados: 0, sinCoste: [], caducadas: 0 }
  const modo = await leerModo(cuenta.id)
  if (modo === 'apagado') return { ...vacio, omitido: 'apagado' }

  const service = createServiceClient()
  // Lo que lleva 14 días pendiente sin que nadie lo mire ya no es fiable: caduca
  const limite = new Date(Date.now() - DIAS_PARA_CADUCAR * DIA_MS).toISOString()
  const { data: caducadas } = await service.from('ads_propuestas').update({ estado: 'caducada', resuelta_at: new Date().toISOString() }).eq('perfil_id', cuenta.id).eq('estado', 'pendiente').lt('creada_at', limite).select('id')

  const terminos = await leerTerminos(cuenta.id)
  if (terminos.length === 0) return { ...vacio, omitido: 'sin-terminos', caducadas: caducadas?.length ?? 0 }

  const [ficha, productos] = await Promise.all([leerFicha(cuenta.id), productosDeCuenta(cuenta.id)])
  const objetivos = new Map<string, ObjetivosParaReglas | null>()
  for (const p of productos) {
    const m = margenDeProducto(p)
    const o = m && p.precio ? objetivosDeProducto(m, p.precio, { fase: ficha.fase, acosLanzamientoX: ficha.acosLanzamientoX, acosMaduroX: ficha.acosMaduroX, gastoSinVentaX: ficha.gastoSinVentaX }) : null
    objetivos.set(p.asin.toUpperCase(), o ? { acosObjetivoPct: o.acosObjetivoPct, gastoMaximoSinVenta: o.gastoMaximoSinVenta } : null)
  }

  // Las campañas vivas, para saber a cuál sube cada término (la del mismo producto con el rol de destino)
  const { campanas } = await campanasDe(cuenta.conexionId, cuenta.profileId)
  const porAsinYRol = new Map<string, DestinoDeCampana & { activa: boolean }>()
  for (const c of campanas) {
    if (c.estado === 'ARCHIVED') continue
    const p = partesDeNombre(c.nombre)
    const asin = asinDeCampana(c.nombre)
    if (!p || !asin) continue
    const clave = `${asin}|${p.rol}`
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
      const d = porAsinYRol.get(`${asin}|${rol}`)
      return d ? { campaignId: d.campaignId, nombre: d.nombre, adGroupId: null } : null
    },
    yaHay: (campaignId, termino, tipo) => yaHay.has(`${campaignId}|${termino.trim().toLowerCase()}|${tipo}`),
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
      motivo: n.motivo,
      metricas: n.metricas,
    })
    if (!error) nuevas += 1
    else if (error.code !== '23505') throw error // 23505 = ya había una pendiente igual: no es un error
  }
  return { nuevas, repetidas: plan.repetidas, evaluados: plan.evaluados, sinCoste: plan.sinCoste, caducadas: caducadas?.length ?? 0 }
}

/* ------------------------------------------------------------------ */
/* Leer                                                                */
/* ------------------------------------------------------------------ */

/** Las propuestas pendientes y lo resuelto en los últimos 30 días */
export async function listarPropuestas(perfilId: string): Promise<Propuesta[]> {
  const desde = new Date(Date.now() - 30 * DIA_MS).toISOString()
  const { data, error } = await createServiceClient()
    .from('ads_propuestas')
    .select(COLUMNAS)
    .eq('perfil_id', perfilId)
    .or(`estado.eq.pendiente,creada_at.gte.${desde}`)
    .order('creada_at', { ascending: false })
    .limit(400)
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map(deFila)
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
  const { data, error } = await createServiceClient().from('ads_propuestas').select(COLUMNAS).eq('perfil_id', perfilId).eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Esa propuesta no existe.')
  return data as Record<string, unknown>
}

/** Lo que se puede aplicar o no, y por qué. Se comprueba aquí en el servidor, nunca solo en la pantalla (los candados están en decidirSiSePuedeAplicar, que tiene sus pruebas) */
export async function puedeAplicar(perfilId: string, p: Propuesta, automatica: boolean): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const [modo, ficha, hoy] = await Promise.all([leerModo(perfilId), leerFicha(perfilId), aplicadasHoy(perfilId, automatica)])
  return decidirSiSePuedeAplicar({
    modo,
    automatica,
    tipo: p.tipo,
    estado: p.estado,
    fichaFirmada: Boolean(ficha.firmadaAt),
    campaignNombre: p.campaignNombre,
    haciaRol: p.haciaRol,
    haciaCampaignId: p.haciaCampaignId,
    haciaAdGroupId: p.haciaAdGroupId,
    aplicadasHoy: hoy,
    topeDiario: automatica ? TOPE_DIARIO_AUTOPILOTO : TOPE_DIARIO_MANUAL,
  })
}

/** Aplica una propuesta en la cuenta de Amazon. Si algo falla a mitad, deshace lo que ya hubiera creado y la deja en «error» con el motivo */
export async function aplicarPropuesta(cuenta: CuentaParaSincronizar, id: string, quien: { userId: string | null; automatica: boolean }): Promise<Propuesta> {
  const fila = await cargar(cuenta.id, id)
  const p = deFila(fila)
  const puede = await puedeAplicar(cuenta.id, p, quien.automatica)
  if (!puede.ok) throw new Error(puede.motivo)

  const service = createServiceClient()
  const comun = { perfilId: cuenta.id, campaignId: p.campaignId, nombreCampana: p.campaignNombre, origen: (quien.automatica ? 'automatico' : 'manual') as 'automatico' | 'manual', userId: quien.userId }
  const creado: { keywordId?: string; negativaId?: string } = {}
  try {
    if (p.tipo === 'promover') {
      const cpc = p.metricas.clics > 0 ? p.metricas.gasto / p.metricas.clics : 0.2
      const coincidencia = (p.haciaRol ?? '').includes('EXACTA') ? 'EXACT' : 'PHRASE'
      creado.keywordId = await crearKeyword(cuenta.conexionId, cuenta.profileId, { campaignId: p.haciaCampaignId as string, adGroupId: p.haciaAdGroupId as string, texto: p.termino, coincidencia, puja: cpc })
      await anotarCambio({ ...comun, campaignId: p.haciaCampaignId, nombreCampana: p.haciaCampaignNombre, entidad: 'keyword', accion: 'promover', campo: `keyword ${coincidencia === 'EXACT' ? 'exacta' : 'de frase'}`, valorAnterior: p.desdeRol, valorNuevo: `${p.termino} → ${p.haciaRol}`, motivo: p.motivo })
    }
    if (p.tipo === 'negativizar' || p.negativizarEnOrigen) {
      creado.negativaId = await crearNegativaDeCampana(cuenta.conexionId, cuenta.profileId, p.campaignId, p.termino)
      await anotarCambio({ ...comun, entidad: 'negativa', accion: 'negativizar', campo: 'palabra clave negativa exacta', valorNuevo: p.termino, motivo: p.tipo === 'promover' ? `Para que no compita con la campaña ${p.haciaRol}: ${p.motivo}` : p.motivo })
    }
    await service.from('ads_propuestas').update({ estado: 'aplicada', aplicada: creado, error: null, resuelta_at: new Date().toISOString(), resuelta_por: quien.userId, automatica: quien.automatica }).eq('id', id)
  } catch (e) {
    // Lo que ya se hubiera creado a medias se deshace: una keyword sin su negativa en origen dejaría los dos compitiendo
    let detalle = e instanceof Error ? e.message : String(e)
    try {
      if (creado.keywordId) await borrarKeyword(cuenta.conexionId, cuenta.profileId, creado.keywordId)
      if (creado.negativaId) await borrarNegativaDeCampana(cuenta.conexionId, cuenta.profileId, creado.negativaId)
      if (creado.keywordId || creado.negativaId) detalle += ' (lo que se había creado a medias se ha deshecho)'
    } catch (e2) {
      detalle += ` (OJO: no se ha podido deshacer lo creado a medias: ${e2 instanceof Error ? e2.message : String(e2)})`
    }
    await anotarCambio({ ...comun, entidad: 'keyword', accion: p.tipo === 'promover' ? 'promover' : 'negativizar', ok: false, error: detalle, motivo: p.motivo })
    await service.from('ads_propuestas').update({ estado: 'error', error: detalle.slice(0, 500), resuelta_at: new Date().toISOString(), resuelta_por: quien.userId }).eq('id', id)
    throw new Error(detalle)
  }
  return deFila(await cargar(cuenta.id, id))
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
  const creado = (fila.aplicada ?? {}) as { keywordId?: string; negativaId?: string }
  if (creado.keywordId) await borrarKeyword(cuenta.conexionId, cuenta.profileId, creado.keywordId)
  if (creado.negativaId) await borrarNegativaDeCampana(cuenta.conexionId, cuenta.profileId, creado.negativaId)
  await createServiceClient().from('ads_propuestas').update({ estado: 'deshecha', resuelta_at: new Date().toISOString(), resuelta_por: userId }).eq('id', id)
  await anotarCambio({ perfilId: cuenta.id, campaignId: p.campaignId, nombreCampana: p.campaignNombre, entidad: creado.keywordId ? 'keyword' : 'negativa', accion: 'cambiar', campo: 'deshacer', valorAnterior: p.termino, valorNuevo: 'quitado', motivo: `Se deshace: ${p.motivo}`, origen: 'manual', userId })
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
