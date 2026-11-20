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
 *
 * ============ EL MODO «AGENTE» (migración 315) ============
 *
 *   El agente PPC (lib/ads/agente/) aplica SOLO, por este mismo camino (aplicarPropuesta con `origen: 'agente'`), con sus topes, rampa y guardarraíles fuera de aquí. Solo se enciende desde la
 *   pestaña «Agente» (guardarModo con `desdeAgente`); cambiar el modo por otro camino lo APAGA. En ensayo las propuestas quedan «ensayadas» (con resuelta_at: cuentan para la cuarentena hasta que el agente pasa a activo).
 *   Todo lo del agente se escribe solo si existe la 315 (columnasAgente); sin ella el agente no puede llegar aquí (no hay tabla ads_agente).
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
  leerEstadoDeAnuncio,
  leerEstadoDeCampana,
  leerPresupuestoActual,
  leerPujaActual,
  ponerEstadoDeAnuncio,
  ponerEstadoDeCampana,
  ponerPresupuesto,
  ponerPuja,
} from './escritura'
import { anotarEnLote } from './log'
import { conRastro } from './rastro'
import { todasLasFilas } from './paginar'
import { objetivosDesdeAcos, precioParaMotor, ticketsMedios } from './margen'
import { clavesEnCuarentena, confirmaPausaDeReintento, confirmaReintento, decidirEnsayo, esReintentoDeTransporte, decidirSiSePuedeAplicar, hayQueComprobarColumna, inicioDelDiaEnEspana, motivoDeObsoleta, planificarPropuestas, pujaDePromover, pujasDelMotorACaducar, resultadoDeComprobarColumna, valorSigueIgual, type CacheDeColumna, type DestinoDeCampana, type PropuestaNueva } from './motor-calculo'
import { asinDeCampana } from './productos-agrupar'
import { esAsin, normalizarTexto, palabrasDe, partesDeNombre, type ObjetivosParaReglas, type TipoDePropuesta } from './reglas'
import { cambiarEstado } from './segmentaciones'
import { cvrsDeCuenta, leerUmbrales } from './umbrales-cuenta'
import { leerTerminos } from './terminos'
import type { CuentaParaSincronizar } from './sincronizar'
import type { Rol } from './estructura'
import { FALTA_MIGRACION_315, type FilaDePropuestaDelAgente } from './agente/tipos'
import { clasificarSubidasPendientes } from './agente/guardarrailes-calculo'

export { guardarUmbrales, leerUmbrales } from './umbrales-cuenta'

/** «agente» (315): el agente PPC aplica solo. Se enciende SOLO desde la pestaña «Agente» */
export type ModoDelMotor = 'apagado' | 'sugiere' | 'aprueba' | 'autopiloto' | 'agente'
export const MODOS: readonly ModoDelMotor[] = ['apagado', 'sugiere', 'aprueba', 'autopiloto', 'agente']

/** El piloto automático aplica como mucho esto por cuenta y día */
export const TOPE_DIARIO_AUTOPILOTO = 5
/** Una persona, como mucho esto por cuenta y día (un freno contra un clic descontrolado, no un límite de uso normal) */
export const TOPE_DIARIO_MANUAL = 40
export const DIAS_DE_CUARENTENA = 14
export const DIAS_PARA_CADUCAR = 14

const DIA_MS = 86_400_000

/**
 * «aplicando» (311) o «aprobada» (sin la 311) = reclamada por quien la aplica; «obsoleta» (311) = el valor de Amazon ya no era el de la propuesta;
 * «ensayada» (315) = el agente en ensayo la recorrió sin escribir (lleva resuelta_at: cuenta para las cuarentenas mientras dura el ensayo; al pasar a activo se le quita)
 */
export type EstadoDePropuesta = 'pendiente' | 'aprobada' | 'aplicando' | 'aplicada' | 'descartada' | 'deshecha' | 'error' | 'caducada' | 'obsoleta' | 'ensayada'

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
  metricas: { clics: number; gasto: number; pedidos: number; ventas: number; acosPct: number | null; usoPct?: number; precioEstimado?: number; revisar?: boolean; cvrPct?: number; concordancia?: 'NEGATIVE_EXACT'; ubicacionAlta?: boolean }
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
  /** Migración 315 (sin ella: 'motor' y null). Quién la creó: el motor (reglas diarias) o el agente (vigilar: presupuestos y stock) */
  origen: 'motor' | 'agente'
  /** El agente la ha dejado para una persona (y por qué) */
  retenidaMotivo: string | null
  /** Lo que dijo la IA del agente de una propuesta rara */
  iaDecision: 'aplicar' | 'retener' | null
  iaMotivo: string | null
  /** Cuándo la aplicó o ensayó el agente (topes del día) */
  agenteAt: string | null
}

const COLUMNAS_BASE = 'id, tipo, asin, termino, campaign_id, campaign_nombre, ad_group_id, desde_rol, hacia_rol, hacia_campaign_id, hacia_campaign_nombre, hacia_ad_group_id, negativizar_en_origen, motivo, metricas, estado, error, automatica, creada_at, resuelta_at, aplicada'
/** Con las columnas de puja y presupuesto (migración 298). Sin ella se lee lo de antes */
const COLUMNAS = `${COLUMNAS_BASE}, objetivo_id, objetivo_tipo, valor_actual, valor_nuevo`
/** Con las del agente PPC (migración 315) */
const COLUMNAS_315 = `${COLUMNAS}, origen, retenida_motivo, retenida_at, ia_decision, ia_motivo, agente_at`
/*
 * Caché de «¿está la columna?» (cacheDeColumna en motor-calculo.ts): `true` se recuerda para siempre; `false` solo si el error es de
 * columna/tabla inexistente, y se vuelve a mirar a los 5 min (nota la migración recién lanzada sin redesplegar). Cualquier otro error
 * (red, tiempo agotado…) NO se guarda y se relanza: un fallo pasajero ya no deja el proceso creyendo que falta la 315 hasta el despliegue.
 */
const hay298: CacheDeColumna = { valor: null, at: 0 }
const hay315: CacheDeColumna = { valor: null, at: 0 }
async function comprobarColumna(c: CacheDeColumna, columna: string): Promise<boolean> {
  const ahora = Date.now()
  if (hayQueComprobarColumna(c, ahora)) {
    const { error } = await createServiceClient().from('ads_propuestas').select(columna).limit(1)
    const r = resultadoDeComprobarColumna(error, ahora)
    c.valor = r.valor
    c.at = r.at
  }
  return c.valor === true
}
async function columnas(): Promise<string> {
  if (!(await comprobarColumna(hay298, 'objetivo_id'))) return COLUMNAS_BASE
  return (await columnasAgente()) ? COLUMNAS_315 : COLUMNAS
}

/** ¿Están las columnas del agente en ads_propuestas (migración 315)? `true` se recuerda; `false` solo si falta la columna y se recomprueba a los 5 min; otro error se relanza */
export async function columnasAgente(): Promise<boolean> {
  return comprobarColumna(hay315, 'agente_at')
}

/** El error de una escritura del agente sin la 315 (columna o CHECK) → el texto de siempre; cualquier otro, tal cual */
function errorDelAgente(e: { code?: string; message?: string }): Error {
  if (e.code === '23514' || e.code === 'PGRST204' || e.code === '42703' || isMissingSchema(e)) return new Error(FALTA_MIGRACION_315)
  return new Error(e.message ?? 'Error de la base de datos')
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
    origen: f.origen === 'agente' ? 'agente' : 'motor',
    retenidaMotivo: (f.retenida_motivo as string | null) ?? null,
    iaDecision: f.ia_decision === 'aplicar' || f.ia_decision === 'retener' ? f.ia_decision : null,
    iaMotivo: (f.ia_motivo as string | null) ?? null,
    agenteAt: (f.agente_at as string | null) ?? null,
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

/**
 * Cambia el modo. Aplicar cosas (aprueba, autopiloto, agente) exige la ficha de cuenta firmada.
 * «agente» solo se pone desde la pestaña «Agente» (`desdeAgente`). Cualquier OTRO modo puesto por otro camino apaga el agente de la cuenta (si estaba encendido) y lo apunta en su línea de tiempo:
 * así el agente nunca sigue «encendido» con el motor en otro modo.
 */
export async function guardarModo(perfilId: string, modo: ModoDelMotor, userId: string, opciones?: { desdeAgente?: boolean }): Promise<void> {
  if (!MODOS.includes(modo)) throw new Error('Ese modo no existe.')
  if (modo === 'agente' && !opciones?.desdeAgente) throw new Error('El modo agente se enciende desde la pestaña «Agente».')
  if (modo === 'aprueba' || modo === 'autopiloto' || modo === 'agente') {
    const ficha = await leerFicha(perfilId)
    if (!ficha.firmadaAt) throw new Error('Para que el motor pueda aplicar cambios, la ficha de cuenta tiene que estar firmada (pestaña «Ficha de cuenta»).')
  }
  const anterior = await leerModo(perfilId)
  const { error } = await createServiceClient().from('ads_motor_config').upsert({ perfil_id: perfilId, modo, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'perfil_id' })
  if (error) {
    // 23514 = el CHECK de modo aún no admite «agente» (falta la 315)
    if (modo === 'agente' && error.code === '23514') throw new Error(FALTA_MIGRACION_315)
    throw error
  }
  await anotarCambio({ perfilId, entidad: 'motor', accion: 'cambiar', campo: 'modo del motor automático', valorAnterior: anterior, valorNuevo: modo, motivo: opciones?.desdeAgente ? 'Lo cambia el agente PPC (pestaña «Agente»)' : 'Lo cambia un administrador desde PPC · Amazon Ads', origen: 'manual', userId })
  if (modo !== 'agente' && !opciones?.desdeAgente) await apagarAgenteSiEstaba(perfilId, modo)
}

const NOMBRE_DE_MODO: Record<ModoDelMotor, string> = { apagado: 'apagado', sugiere: '«Solo sugiere»', aprueba: '«Aprueba y aplica»', autopiloto: '«Piloto automático»', agente: '«Agente»' }

/** Si la cuenta tiene el agente encendido (ensayo, activo o frenado), lo apaga y anota el evento «apagado». Sin la 315 no hay agente: no hace nada. Nunca lanza */
async function apagarAgenteSiEstaba(perfilId: string, modo: ModoDelMotor): Promise<void> {
  try {
    const service = createServiceClient()
    const { data, error } = await service.from('ads_agente').update({ estado: 'apagado', updated_at: new Date().toISOString() }).eq('perfil_id', perfilId).neq('estado', 'apagado').select('perfil_id')
    if (error) {
      if (!isMissingSchema(error)) console.error('Ads: no se ha podido apagar el agente al cambiar el modo', perfilId, error.message)
      return
    }
    if (!data || data.length === 0) return
    const { error: e2 } = await service.from('ads_agente_eventos').insert({ perfil_id: perfilId, tipo: 'apagado', titulo: `Apagado al cambiar el modo del motor a ${NOMBRE_DE_MODO[modo]}`, detalle: 'El modo del motor se ha cambiado fuera de la pestaña «Agente»: el agente deja de aplicar.' })
    if (e2 && !isMissingSchema(e2)) console.error('Ads: no se ha podido anotar el apagado del agente', perfilId, e2.message)
  } catch (e) {
    console.error('Ads: no se ha podido apagar el agente al cambiar el modo', perfilId, e instanceof Error ? e.message : e)
  }
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
  /** Productos sin ACoS objetivo fijado (ni humano ni automático del agente) */
  sinAcos: Array<{ asin: string; resumen: string }>
  /** Productos sin ACoS humano que usan el AUTOMÁTICO congelado del agente PPC (ads_agente_objetivos, 315) */
  automaticos: Array<{ asin: string; resumen: string; acosObjetivoPct: number; fuente: string; detalle: string | null; soloDefensivo: boolean }>
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
  const [productos, { tickets, conGasto }, automaticos] = await Promise.all([productosDeCuenta(perfilId), ventasDeCampanas(perfilId), objetivosAutomaticos(perfilId)])
  const conFicha = new Set(productos.map((p) => p.asin.toUpperCase()))
  const salida: ObjetivosDeCuenta = { porAsin: new Map(), sinAcos: [], automaticos: [], sinPrecio: [], conPrecioEstimado: [], palabras: new Map(), sinFicha: [...conGasto].filter((a) => !conFicha.has(a)).sort() }
  for (const p of productos) {
    const asin = p.asin.toUpperCase()
    const resumen = p.resumen || asin
    salida.palabras.set(asin, palabrasDe(`${p.resumen && p.resumen !== asin ? p.resumen : ''} ${p.titulo ?? ''}`))
    // El humano manda; sin él, el automático CONGELADO del agente (nunca pisa uno humano)
    const auto = p.acosObjetivoPct == null ? automaticos.get(asin) : undefined
    const acosObjetivo = p.acosObjetivoPct ?? auto?.acosObjetivoPct ?? null
    if (acosObjetivo == null) {
      salida.sinAcos.push({ asin, resumen })
      salida.porAsin.set(asin, null)
      continue
    }
    if (auto) salida.automaticos.push({ asin, resumen, ...auto })
    const precio = precioParaMotor(p.precio, tickets.get(asin))
    const o = precio ? objetivosDesdeAcos(precio.precio, acosObjetivo, ficha.gastoSinVentaX) : null
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

/** Los ACoS objetivo AUTOMÁTICOS (congelados) del agente PPC por ASIN. Sin la 315 (o si falla la lectura), ninguno: como antes */
async function objetivosAutomaticos(perfilId: string): Promise<Map<string, { acosObjetivoPct: number; fuente: string; detalle: string | null; soloDefensivo: boolean }>> {
  const salida = new Map<string, { acosObjetivoPct: number; fuente: string; detalle: string | null; soloDefensivo: boolean }>()
  const { data, error } = await createServiceClient().from('ads_agente_objetivos').select('asin, acos_objetivo_pct, fuente, detalle, solo_defensivo').eq('perfil_id', perfilId)
  if (error) {
    if (!isMissingSchema(error)) console.error('Ads: no se han podido leer los objetivos automáticos del agente', perfilId, error.message)
    return salida
  }
  for (const r of (data ?? []) as Array<{ asin: string; acos_objetivo_pct: number | string; fuente: string; detalle: string | null; solo_defensivo: boolean }>) {
    const acos = Number(r.acos_objetivo_pct)
    if (Number.isFinite(acos) && acos > 0) salida.set(r.asin.toUpperCase(), { acosObjetivoPct: acos, fuente: r.fuente, detalle: r.detalle ?? null, soloDefensivo: Boolean(r.solo_defensivo) })
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
  // Las ENSAYADAS del agente llevan resuelta_at: cuentan igual (motor-calculo.clavesEnCuarentena, con su prueba)
  const yaHay = clavesEnCuarentena((previas ?? []) as Array<{ campaign_id: string; termino: string; tipo: string; estado: string; resuelta_at: string | null }>, desdeCuarentena)

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
  /** El agente PPC lleva sus propios topes por clase (fuera de aquí): pasa Number.MAX_SAFE_INTEGER. Sin él, el de siempre (autopiloto o manual) */
  topeDiario?: number
}

export async function contextoDeAplicar(perfilId: string, automatica: boolean): Promise<ContextoDeAplicar> {
  const [modo, ficha, hoy] = await Promise.all([leerModo(perfilId), leerFicha(perfilId), aplicadasHoy(perfilId, automatica)])
  return { modo, fichaFirmada: Boolean(ficha.firmadaAt), aplicadasHoy: hoy }
}

function entradaDeAplicar(c: ContextoDeAplicar, p: Propuesta, automatica: boolean, agente?: { origen?: 'agente'; iaAprueba?: boolean }) {
  return {
    modo: c.modo,
    automatica,
    origen: agente?.origen,
    revisarAprobadoPorIa: Boolean(agente?.iaAprueba),
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
    topeDiario: c.topeDiario ?? (automatica ? TOPE_DIARIO_AUTOPILOTO : TOPE_DIARIO_MANUAL),
  }
}

export function decidirConContexto(c: ContextoDeAplicar, p: Propuesta, automatica: boolean, agente?: { origen?: 'agente'; iaAprueba?: boolean }): { ok: true } | { ok: false; motivo: string } {
  return decidirSiSePuedeAplicar(entradaDeAplicar(c, p, automatica, agente))
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
async function guardarResultado(perfilId: string, id: string, cambios: Record<string, unknown>, rastro: { campaignId: string | null; nombreCampana: string | null; userId: string | null; origen: 'manual' | 'automatico' | 'agente'; que: string }): Promise<void> {
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
export async function aplicarPropuesta(
  cuenta: CuentaParaSincronizar,
  id: string,
  quien: { userId: string | null; automatica: boolean; contexto?: ContextoDeAplicar; origen?: 'agente'; iaAprueba?: boolean; pujaMaxima?: number | null }
): Promise<Propuesta> {
  const p = deFila(await cargar(cuenta.id, id))
  const agente = quien.origen === 'agente' ? { origen: 'agente' as const, iaAprueba: quien.iaAprueba } : undefined
  const decision = decidirConContexto(quien.contexto ?? (await contextoDeAplicar(cuenta.id, quien.automatica)), p, quien.automatica, agente)
  if (!decision.ok) throw new Error(decision.motivo)
  // El agente necesita las columnas de la 315 para dejar su marca (origen, agente_at); sin ellas no aplica
  if (agente && !(await columnasAgente())) throw new Error(FALTA_MIGRACION_315)
  const estadoAntes = p.estado
  await reclamar(cuenta.id, id, quien.userId, ['pendiente', 'error'])
  const productoId = await productoDe(cuenta.id, p.asin)
  try {
    await conRastro({ propuestaId: id, origen: agente ? 'agente' : null }, () => recorrerAplicar(cuenta, p, { userId: quien.userId, automatica: quien.automatica, productoId, estadoAntes, origen: agente?.origen, iaAprueba: agente?.iaAprueba, pujaMaxima: agente ? quien.pujaMaxima : undefined }))
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

/**
 * ENSAYO DEL AGENTE PPC: el camino de aplicar sin escribir en Amazon (las lecturas sí salen) y, si llega al final, la propuesta queda «ensayada» con resuelta_at = ahora
 * (cuenta para todas las cuarentenas: en ensayo no se repite cada día lo mismo) y agente_at = ahora (topes del día). Si falla, se queda pendiente y devuelve el porqué.
 */
export async function ensayarComoAgente(cuenta: CuentaParaSincronizar, id: string, opciones?: { pujaMaxima?: number | null }): Promise<{ ok: boolean; error: string | null; llamadas: number }> {
  if (!(await columnasAgente())) return { ok: false, error: FALTA_MIGRACION_315, llamadas: 0 }
  const p = deFila(await cargar(cuenta.id, id))
  if (p.estado !== 'pendiente') return { ok: false, error: `Esa propuesta ya está ${p.estado}.`, llamadas: 0 }
  const contexto = await contextoDeAplicar(cuenta.id, true)
  const decision = decidirEnsayo(entradaDeAplicar({ ...contexto, topeDiario: Number.MAX_SAFE_INTEGER }, p, true, { origen: 'agente' }))
  if (!decision.ok) return { ok: false, error: decision.motivo, llamadas: 0 }
  const productoId = await productoDe(cuenta.id, p.asin)
  let error: string | null = null
  const { llamadas } = await conRastro({ ensayo: true, propuestaId: id, origen: 'agente' }, async () => {
    try {
      await recorrerAplicar(cuenta, p, { userId: null, automatica: true, productoId, estadoAntes: p.estado, ensayo: true, origen: 'agente', pujaMaxima: opciones?.pujaMaxima })
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  })
  const simuladas = llamadas.filter((l) => l.simulada).length
  if (error) return { ok: false, error, llamadas: simuladas }
  const ahora = new Date().toISOString()
  const { data, error: e } = await createServiceClient()
    .from('ads_propuestas')
    .update({ estado: 'ensayada', resuelta_at: ahora, resuelta_por: null, agente_at: ahora, automatica: true, aplicada: { ensayo: true, at: ahora, llamadas: simuladas } })
    .eq('perfil_id', cuenta.id)
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select('id')
  if (e) return { ok: false, error: errorDelAgente(e).message, llamadas: simuladas }
  if (!data || data.length === 0) return { ok: false, error: 'La propuesta ya no estaba pendiente (otra pasada la ha tocado).', llamadas: simuladas }
  return { ok: true, error: null, llamadas: simuladas }
}

/** El camino de aplicar, común a la aplicación de verdad y al ensayo (en ensayo no se toca ads_propuestas y llamarAds no escribe: lo decide el rastro) */
async function recorrerAplicar(
  cuenta: CuentaParaSincronizar,
  p: Propuesta,
  q: { userId: string | null; automatica: boolean; productoId: string | null; estadoAntes: string; ensayo?: boolean; origen?: 'agente'; iaAprueba?: boolean; pujaMaxima?: number | null }
): Promise<void> {
  const id = p.id
  const origen: 'manual' | 'automatico' | 'agente' = q.origen === 'agente' ? 'agente' : q.automatica ? 'automatico' : 'manual'
  const comun = { perfilId: cuenta.id, productoId: q.productoId, campaignId: p.campaignId, nombreCampana: p.campaignNombre, origen, userId: q.userId }
  // Lo que aplica el agente queda con su marca (origen y agente_at: los topes del día cuentan desde aquí). Las columnas existen: aplicarPropuesta lo ha comprobado
  const marcaDelAgente = origen === 'agente' ? { origen: 'agente', agente_at: new Date().toISOString(), automatica: true } : {}
  const resolver = (estado: string, extra: Record<string, unknown>, que: string) =>
    q.ensayo ? Promise.resolve() : guardarResultado(cuenta.id, id, { estado, ...extra, resuelta_at: new Date().toISOString(), resuelta_por: q.userId, automatica: q.automatica, ...(estado === 'aplicada' ? marcaDelAgente : {}) }, { campaignId: p.campaignId, nombreCampana: p.campaignNombre, userId: q.userId, origen, que })
  const motivoLog = p.motivo + (q.iaAprueba ? ' · aprobada por la IA del agente' : '')
  const marcarError = async (detalle: string) => {
    if (q.ensayo) return
    const { error } = await createServiceClient().from('ads_propuestas').update({ estado: 'error', error: detalle.slice(0, 500), resuelta_at: new Date().toISOString(), resuelta_por: q.userId }).eq('perfil_id', cuenta.id).eq('id', id).in('estado', ['aplicando', 'aprobada'])
    if (error) await anotarCambio({ ...comun, entidad: 'propuesta', accion: 'cambiar', campo: 'estado de la propuesta', valorNuevo: 'error', motivo: 'No se ha podido marcar el error en la propuesta', ok: false, error: `${error.message} · ${detalle}`, propuestaId: id })
  }

  // Pausar la CAMPAÑA entera (el agente, por falta de stock): se lee su estado; si ya está pausada, obsoleta (no se pisa). Deshacer = activarla si sigue pausada
  if (p.tipo === 'pausar-campana' || (p.tipo === 'pausar' && p.objetivoTipo === 'anuncio')) {
    const esCampana = p.tipo === 'pausar-campana'
    const entidad = esCampana ? 'campaña' : 'anuncio'
    const entidadId = esCampana ? p.campaignId : p.objetivoId
    const campo = esCampana ? 'estado de la campaña' : `estado del anuncio de ${p.asin ?? p.termino}`
    if (!entidadId) {
      if (!q.ensayo) await liberar(cuenta.id, id, q.estadoAntes, 'A la propuesta le falta el anuncio que hay que pausar.')
      throw new ObsoletaOLiberada('A la propuesta le falta el anuncio que hay que pausar.')
    }
    let estadoAhora: string | null
    try {
      estadoAhora = esCampana ? await leerEstadoDeCampana(cuenta, entidadId) : await leerEstadoDeAnuncio(cuenta, entidadId)
    } catch (e) {
      const detalle = `No se ha podido leer el estado actual en Amazon: ${e instanceof Error ? e.message : String(e)}`
      if (!q.ensayo) await liberar(cuenta.id, id, q.estadoAntes, detalle.slice(0, 500))
      await anotarCambio({ ...comun, entidad, accion: 'pausar', campo, ok: false, error: detalle, motivo: p.motivo, entidadId })
      throw new ObsoletaOLiberada(detalle)
    }
    // Un REINTENTO tras un fallo de transporte al pausar: si ya está pausada, la pausa llegó → «aplicada» con la marca del agente (el stock la puede reactivar)
    if (origen === 'agente' && confirmaPausaDeReintento(p.error, estadoAhora)) {
      await anotarCambio({ ...comun, entidad, accion: 'pausar', campo, valorAnterior: 'activa', valorNuevo: 'pausada', motivo: `${p.motivo} · confirmado tras un fallo de red: Amazon ya la tenía pausada`, entidadId })
      await resolver('aplicada', { aplicada: { pausada: true, estadoAnterior: 'ENABLED', confirmadaTrasReintento: true }, error: null }, esCampana ? 'La pausa de la campaña' : 'La pausa del anuncio')
      return
    }
    if (estadoAhora !== 'ENABLED') {
      const motivo = estadoAhora == null ? `Amazon ya no encuentra ${esCampana ? 'esa campaña' : 'ese anuncio'}: la propuesta queda obsoleta.` : `En Amazon ${esCampana ? 'la campaña' : 'el anuncio'} ya está ${estadoAhora === 'PAUSED' ? 'pausad' + (esCampana ? 'a' : 'o') : estadoAhora}: no se toca.`
      await anotarCambio({ ...comun, entidad: 'propuesta', accion: 'descartar', campo: 'propuesta obsoleta', valorNuevo: estadoAhora, motivo, entidadId })
      await resolver(estadoObsoleta, { error: motivo }, 'Marcarla obsoleta')
      throw new ObsoletaOLiberada(motivo)
    }
    try {
      if (esCampana) await ponerEstadoDeCampana(cuenta, entidadId, 'PAUSED')
      else await ponerEstadoDeAnuncio(cuenta, entidadId, 'PAUSED')
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e)
      await anotarCambio({ ...comun, entidad, accion: 'pausar', campo, valorAnterior: 'activa', valorNuevo: 'pausada', ok: false, error: detalle, motivo: p.motivo, entidadId })
      await marcarError(detalle)
      throw new Error(detalle)
    }
    await anotarCambio({ ...comun, entidad, accion: 'pausar', campo, valorAnterior: 'activa', valorNuevo: 'pausada', motivo: p.motivo, entidadId })
    await resolver('aplicada', { aplicada: { pausada: true, estadoAnterior: estadoAhora }, error: null }, esCampana ? 'La pausa de la campaña' : 'La pausa del anuncio')
    return
  }

  // Pausar: la misma función que el botón de pausa del panel de campañas (deja el log con el motivo del motor); deshacer = volver a activarla
  if (p.tipo === 'pausar') {
    if (!p.objetivoId || (p.objetivoTipo !== 'keyword' && p.objetivoTipo !== 'producto')) {
      if (!q.ensayo) await liberar(cuenta.id, id, q.estadoAntes, 'A la propuesta le falta la segmentación que hay que pausar.')
      throw new ObsoletaOLiberada('A la propuesta le falta la segmentación que hay que pausar.')
    }
    try {
      // userId null si no hay persona (antes '' → la entrada del log se perdía con un 22P02)
      await cambiarEstado({ cuenta: { id: cuenta.id, conexionId: cuenta.conexionId, profileId: cuenta.profileId }, campaignId: p.campaignId, nombreCampana: p.campaignNombre, userId: q.userId }, { tipo: p.objetivoTipo, id: p.objetivoId, texto: p.termino, activar: false, motivo: p.motivo, origen })
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
    let valorAhora: number | null = null
    try {
      const actual = p.tipo === 'puja' ? await leerPujaActual(cuenta, p.objetivoTipo, p.objetivoId as string) : { puja: await leerPresupuestoActual(cuenta, p.campaignId), heredada: false }
      heredada = Boolean(actual?.heredada)
      valorAhora = actual?.puja ?? null
    } catch (e) {
      // No se ha podido LEER: no se ha escrito nada, así que se libera tal como estaba
      const detalle = `No se ha podido leer el valor actual en Amazon: ${e instanceof Error ? e.message : String(e)}`
      if (!q.ensayo) await liberar(cuenta.id, id, q.estadoAntes, detalle.slice(0, 500))
      await anotarCambio({ ...comun, entidad, accion: 'cambiar', campo, ok: false, error: detalle, motivo: p.motivo, entidadId })
      throw new ObsoletaOLiberada(detalle)
    }
    // Un REINTENTO tras un fallo de transporte al escribir: si Amazon ya tiene lo que el agente intentó poner, el cambio llegó. Se resuelve «aplicada» con la
    // marca del agente (topes, efecto, freno), no obsoleta: si no, lo que el agente subió de verdad quedaría fuera de todos los controles
    if (origen === 'agente' && confirmaReintento(p, valorAhora)) {
      await anotarCambio({ ...comun, entidad, accion: 'cambiar', campo, valorAnterior: fmt(p.valorActual as number), valorNuevo: fmt(valorAhora as number), motivo: `${p.motivo} · confirmado tras un fallo de red: Amazon ya tenía el valor nuevo`, entidadId })
      await resolver('aplicada', { aplicada: { valorAnterior: p.valorActual, heredada, confirmadaTrasReintento: true }, valor_nuevo: valorAhora, error: null }, p.tipo === 'puja' ? 'La puja' : 'El presupuesto')
      return
    }
    // Fuera del try de la lectura: si falla GUARDAR la obsoleta (guardarResultado), no se confunde con un fallo al leer ni se libera la propuesta
    if (!valorSigueIgual(p.valorActual, valorAhora)) {
      const motivo = motivoDeObsoleta(p.tipo, p.valorActual, valorAhora)
      await anotarCambio({ ...comun, entidad: 'propuesta', accion: 'descartar', campo: 'propuesta obsoleta', valorAnterior: p.valorActual == null ? null : fmt(p.valorActual), valorNuevo: valorAhora == null ? null : fmt(valorAhora), motivo, entidadId })
      await resolver(estadoObsoleta, { error: motivo }, 'Marcarla obsoleta')
      throw new ObsoletaOLiberada(motivo)
    }
    // El agente sin valor de partida (forma reducida de una pausa): se guarda ANTES de escribir, para que un reintento tras un fallo de red pueda reconocer
    // su propio cambio y deshacerlo (confirmaReintento exige el valor de partida)
    if (!q.ensayo && origen === 'agente' && p.valorActual == null && valorAhora != null) {
      const { error: eVa } = await createServiceClient().from('ads_propuestas').update({ valor_actual: valorAhora }).eq('perfil_id', cuenta.id).eq('id', id).in('estado', ['aplicando', 'aprobada'])
      if (eVa) console.error(`[motor] no se ha podido guardar el valor de partida de ${id}:`, eVa.message)
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
    // El agente puede aplicar una puja sin valor de partida (la forma reducida de una pausa): se guarda el que había en Amazon para poder deshacerla
    const valorDePartida = p.valorActual ?? (origen === 'agente' ? valorAhora : null)
    await anotarCambio({ ...comun, entidad, accion: 'cambiar', campo, valorAnterior: valorDePartida == null ? null : fmt(valorDePartida), valorNuevo: fmt(p.valorNuevo), motivo: p.motivo + (heredada ? ' · la puja de antes era la heredada del grupo' : ''), entidadId })
    await resolver('aplicada', { aplicada: { valorAnterior: valorDePartida, heredada }, ...(p.valorActual == null && valorDePartida != null ? { valor_actual: valorDePartida } : {}), error: null }, p.tipo === 'puja' ? 'La puja' : 'El presupuesto')
    return
  }

  const creado: { keywordId?: string; negativaId?: string; targetId?: string; negativaProductoId?: string } = {}
  try {
    // La puja de partida de lo cosechado: el CPC que ya pagaba (lo que ha demostrado que convierte a ese precio). El agente la limita a su puja máxima (decidirPropuesta)
    const cpcCalculado = p.tipo === 'promover' ? pujaDePromover(p.metricas, q.pujaMaxima) : 0.2
    if (cpcCalculado == null) throw new Error('No se puede calcular la puja de partida (CPC o puja máxima no válidos): no se crea nada.')
    const cpc = cpcCalculado
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
      await anotarCambio({ ...comun, entidad: 'negativa', accion: 'negativizar', campo: 'segmentación negativa por productos', valorNuevo: p.termino.toUpperCase(), motivo: p.tipo === 'promover' ? `Para que no compita con la campaña ${p.haciaRol}: ${p.motivo}` : motivoLog, entidadId: creado.negativaProductoId })
    } else if (p.tipo === 'negativizar' || p.negativizarEnOrigen) {
      creado.negativaId = await crearNegativaDeCampana(cuenta.conexionId, cuenta.profileId, p.campaignId, p.termino)
      await anotarCambio({ ...comun, entidad: 'negativa', accion: 'negativizar', campo: 'palabra clave negativa exacta', valorNuevo: p.termino, motivo: p.tipo === 'promover' ? `Para que no compita con la campaña ${p.haciaRol}: ${p.motivo}` : motivoLog, entidadId: creado.negativaId })
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
 * El agente PPC deshace con `userId: null` y `origen: 'agente'` (su motivo va al log); `valorMaximo`, en presupuesto: se vuelve a min(valor anterior, valorMaximo) (lo que permite hoy el guardarraíl).
 */
export async function deshacerPropuesta(
  cuenta: CuentaParaSincronizar,
  id: string,
  userId: string | null,
  opciones?: { origen?: 'agente'; motivo?: string; valorMaximo?: number; alEscribirPresupuesto?: (campaignId: string, valor: number) => Promise<void> },
): Promise<void> {
  const fila = await cargar(cuenta.id, id)
  const p = deFila(fila)
  if (p.estado !== 'aplicada') throw new Error('Solo se puede deshacer una propuesta aplicada.')
  await reclamar(cuenta.id, id, userId, ['aplicada'])
  const productoId = await productoDe(cuenta.id, p.asin)
  const origen: 'manual' | 'agente' = opciones?.origen === 'agente' ? 'agente' : 'manual'
  const comun = { perfilId: cuenta.id, productoId, campaignId: p.campaignId, nombreCampana: p.campaignNombre, origen, userId, propuestaId: id }
  const seDeshace = `Se deshace${opciones?.motivo ? ` (${opciones.motivo})` : ''}: ${p.motivo}`
  const volverAAplicada = async (detalle: string) => {
    const { error } = await createServiceClient().from('ads_propuestas').update({ estado: 'aplicada', error: `Deshacer falló: ${detalle}`.slice(0, 500) }).eq('perfil_id', cuenta.id).eq('id', id).in('estado', ['aplicando', 'aprobada'])
    if (error) console.error('Ads: no se ha podido devolver la propuesta a aplicada', id, error.message)
  }
  const resolver = () => guardarResultado(cuenta.id, id, { estado: 'deshecha', resuelta_at: new Date().toISOString(), resuelta_por: userId }, { campaignId: p.campaignId, nombreCampana: p.campaignNombre, userId, origen, que: 'Deshacer' })

  await conRastro({ propuestaId: id, origen: origen === 'agente' ? 'agente' : null }, async () => {
    // La pausa de una campaña o de un anuncio (stock): se vuelve a ACTIVAR solo si sigue pausada (si alguien la ha tocado, no se pisa)
    if (p.tipo === 'pausar-campana' || (p.tipo === 'pausar' && p.objetivoTipo === 'anuncio')) {
      const esCampana = p.tipo === 'pausar-campana'
      const entidad = esCampana ? ('campaña' as const) : ('anuncio' as const)
      const entidadId = esCampana ? p.campaignId : p.objetivoId
      const campo = esCampana ? 'estado de la campaña' : `estado del anuncio de ${p.asin ?? p.termino}`
      try {
        if (!entidadId) throw new Error('A la propuesta le falta el anuncio: actívalo a mano desde Campañas.')
        const ahora = esCampana ? await leerEstadoDeCampana(cuenta, entidadId) : await leerEstadoDeAnuncio(cuenta, entidadId)
        if (ahora !== 'PAUSED') throw new Error(`En Amazon ${esCampana ? 'la campaña' : 'el anuncio'} ya no está pausad${esCampana ? 'a' : 'o'} (${ahora ?? 'no se encuentra'}): alguien lo ha cambiado después y no se pisa.`)
        if (esCampana) await ponerEstadoDeCampana(cuenta, entidadId, 'ENABLED')
        else await ponerEstadoDeAnuncio(cuenta, entidadId, 'ENABLED')
      } catch (e) {
        const detalle = e instanceof Error ? e.message : String(e)
        await anotarCambio({ ...comun, entidad, accion: 'activar', campo, ok: false, error: detalle, motivo: seDeshace, entidadId })
        await volverAAplicada(detalle)
        throw new Error(detalle)
      }
      await anotarCambio({ ...comun, entidad, accion: 'activar', campo, valorAnterior: 'pausada', valorNuevo: 'activa', motivo: seDeshace, entidadId })
      await resolver()
      return
    }
    if (p.tipo === 'pausar') {
      if (!p.objetivoId || (p.objetivoTipo !== 'keyword' && p.objetivoTipo !== 'producto')) {
        await volverAAplicada('a la propuesta le falta la segmentación')
        throw new Error('A la propuesta le falta la segmentación: actívala a mano desde Campañas.')
      }
      try {
        await cambiarEstado({ cuenta: { id: cuenta.id, conexionId: cuenta.conexionId, profileId: cuenta.profileId }, campaignId: p.campaignId, nombreCampana: p.campaignNombre, userId }, { tipo: p.objetivoTipo, id: p.objetivoId, texto: p.termino, activar: true, motivo: seDeshace, origen })
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
      // Presupuesto con valorMaximo (el agente): se vuelve como mucho a lo que deja hoy el guardarraíl
      const valorDeVuelta = p.valorActual != null && p.tipo === 'presupuesto' && opciones?.valorMaximo != null && Number.isFinite(opciones.valorMaximo) && opciones.valorMaximo > 0 ? Math.min(p.valorActual, opciones.valorMaximo) : p.valorActual
      try {
        if (p.valorActual == null || p.valorNuevo == null || valorDeVuelta == null) throw new Error('No se sabe el valor de antes: no se puede deshacer.')
        const actual = p.tipo === 'puja' ? (await leerPujaActual(cuenta, p.objetivoTipo, p.objetivoId as string))?.puja ?? null : await leerPresupuestoActual(cuenta, p.campaignId)
        if (!valorSigueIgual(p.valorNuevo, actual)) throw new Error(`En Amazon ya no está el valor que puso el motor (${fmt(p.valorNuevo)}; ahora ${actual == null ? 'no se encuentra' : fmt(actual)}): alguien lo ha cambiado después y no se pisa.`)
        if (p.tipo === 'puja') await ponerPuja(cuenta, p.objetivoTipo, p.objetivoId as string, valorDeVuelta)
        else await ponerPresupuesto(cuenta, p.campaignId, valorDeVuelta)
      } catch (e) {
        const detalle = e instanceof Error ? e.message : String(e)
        await anotarCambio({ ...comun, entidad, accion: 'deshacer', campo: p.tipo === 'puja' ? `puja de «${p.termino}»` : 'presupuesto diario', ok: false, error: detalle, motivo: seDeshace, entidadId })
        await volverAAplicada(detalle)
        throw new Error(detalle)
      }
      // Ya está escrito en Amazon: el presupuesto de vuelta, a quien lo apunta (el agente, en ads_presupuesto_dia, que es de donde lee la suma su guardarraíl). Nunca lanza aquí
      if (p.tipo === 'presupuesto' && opciones?.alEscribirPresupuesto) {
        try {
          await opciones.alEscribirPresupuesto(p.campaignId, valorDeVuelta as number)
        } catch (e) {
          console.error('Ads: no se ha podido apuntar el presupuesto deshecho', id, e instanceof Error ? e.message : e)
        }
      }
      await anotarCambio({ ...comun, entidad, accion: 'deshacer', campo: p.tipo === 'puja' ? `puja de «${p.termino}»` : 'presupuesto diario', valorAnterior: fmt(p.valorNuevo), valorNuevo: fmt(valorDeVuelta), motivo: seDeshace + (valorDeVuelta !== p.valorActual ? ` · vuelve a ${fmt(valorDeVuelta)} y no a ${fmt(p.valorActual)} (lo que permite hoy el guardarraíl)` : ''), entidadId })
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
      await anotarCambio({ ...comun, entidad, accion: 'deshacer', campo: p.termino, ok: false, error: detalle, motivo: seDeshace, entidadId })
      await volverAAplicada(detalle)
      throw new Error(detalle)
    }
    await anotarCambio({ ...comun, entidad, accion: 'deshacer', campo: p.termino, valorAnterior: p.termino, valorNuevo: 'quitado', motivo: seDeshace, entidadId })
    await resolver()
  })
}

/* ------------------------------------------------------------------ */
/* El agente PPC: retener, descartar, ajustar, decisiones de la IA     */
/* (todo exige la 315; sin ella → «Falta lanzar la migración 315…»)    */
/* ------------------------------------------------------------------ */

/** La deja para una persona, con el porqué. Solo si sigue pendiente (si no, no hace nada) */
export async function marcarRetenida(perfilId: string, id: string, motivo: string): Promise<void> {
  const { error } = await createServiceClient().from('ads_propuestas').update({ retenida_motivo: motivo.slice(0, 500), retenida_at: new Date().toISOString() }).eq('perfil_id', perfilId).eq('id', id).eq('estado', 'pendiente')
  if (error) throw errorDelAgente(error)
}

/** El agente la caduca (pendiente → caducada, con el porqué en `error`): se creó con otras reglas o con datos de otro día. No cuenta para la cuarentena: si sigue haciendo falta, se vuelve a proponer */
export async function caducarComoAgente(perfilId: string, id: string, motivo: string): Promise<void> {
  const { error } = await createServiceClient()
    .from('ads_propuestas')
    .update({ estado: 'caducada', resuelta_at: new Date().toISOString(), error: `Caducada por el agente: ${motivo}`.slice(0, 500) })
    .eq('perfil_id', perfilId)
    .eq('id', id)
    .eq('estado', 'pendiente')
  if (error) throw errorDelAgente(error)
}

/** El motivo con que se retiene una subida que iba a caducarse pero viene de un reintento por transporte (su cambio puede estar ya en Amazon) */
const motivoDeReintentoRetenido = (porque: string) =>
  `Falló por la red al aplicarla y puede que el cambio ya esté en Amazon; no la caduco (${porque}). Comprueba en Amazon el valor y decide.`.slice(0, 500)

/**
 * Caduca las pendientes que SUBEN (y los presupuestos que no son del agente) de la cuenta: al reanudar, al encender, al saltar el ensayo y al frenar (subidasACaducar).
 * Las que vienen de un REINTENTO por transporte (Amazon no contestó: el cambio puede estar ya escrito) NO se caducan: caducada, quedaría fuera del deshacer del
 * freno, de la medición y de los topes. Se retienen para una persona (clasificarSubidasPendientes), como hace decisionDeReintento al aplicar.
 * Devuelve cuántas se han caducado. Lanza si falla la lectura o la escritura (quien llama decide; lo prudente es no seguir aplicando).
 */
export async function caducarSubidasPendientes(perfilId: string, motivo: string): Promise<number> {
  const service = createServiceClient()
  const agente = await columnasAgente()
  const { data, error } = await todasLasFilas((a, b) =>
    service
      .from('ads_propuestas')
      .select(agente ? 'id, tipo, origen, valor_actual, valor_nuevo, error' : 'id, tipo, valor_actual, valor_nuevo, error')
      .eq('perfil_id', perfilId)
      .eq('estado', 'pendiente')
      .in('tipo', ['puja', 'presupuesto', 'promover'])
      .order('id')
      .range(a, b) as unknown as PromiseLike<{
      data: Array<{ id: string; tipo: string; origen?: string | null; valor_actual: number | null; valor_nuevo: number | null; error: string | null }> | null
      error: { code?: string; message?: string } | null
    }>,
  )
  if (error) throw errorDelAgente(error)
  const { caducar: ids, retener } = clasificarSubidasPendientes(data ?? [])
  // Primero las que pueden estar ya en Amazon: retenidas (siguen pendientes, fuera de pendientesLibres) con el porqué
  for (const id of retener) await marcarRetenida(perfilId, id, motivoDeReintentoRetenido(motivo))
  let n = 0
  for (let i = 0; i < ids.length; i += 200) {
    const { data: hechas, error: e } = await service
      .from('ads_propuestas')
      .update({ estado: 'caducada', resuelta_at: new Date().toISOString(), error: `Caducada por el agente: ${motivo}`.slice(0, 500) })
      .eq('perfil_id', perfilId)
      .eq('estado', 'pendiente')
      .in('id', ids.slice(i, i + 200))
      .select('id')
    if (e) throw errorDelAgente(e)
    n += hechas?.length ?? 0
  }
  return n
}

/**
 * Caduca las pujas y pausas PENDIENTES de la generación diaria del motor con más de `horas` (pujasDelMotorACaducar): se llama justo ANTES de generar en modo agente, para que la generación de hoy
 * las vuelva a calcular con su ventana en vez de aplicarlas días más tarde con métricas viejas. Sin la 315 (sin origen ni retenida_at) no hace nada. Lanza si falla la base.
 */
export async function caducarPujasViejasDelMotor(perfilId: string, horas: number): Promise<number> {
  if (!(await columnasAgente())) return 0
  const service = createServiceClient()
  const { data, error } = await todasLasFilas((a, b) =>
    service
      .from('ads_propuestas')
      .select('id, tipo, origen, retenida_at, error, creada_at')
      .eq('perfil_id', perfilId)
      .eq('estado', 'pendiente')
      .in('tipo', ['puja', 'pausar'])
      .eq('origen', 'motor')
      .is('retenida_at', null)
      .lt('creada_at', new Date(Date.now() - horas * 3_600_000).toISOString())
      .order('id')
      .range(a, b) as unknown as PromiseLike<{ data: Array<{ id: string; tipo: string; origen: string | null; retenida_at: string | null; error: string | null; creada_at: string }> | null; error: { code?: string; message?: string } | null }>,
  )
  if (error) throw errorDelAgente(error)
  const ids = pujasDelMotorACaducar(data ?? [], Date.now(), horas)
  let n = 0
  for (let i = 0; i < ids.length; i += 200) {
    const { data: hechas, error: e } = await service
      .from('ads_propuestas')
      .update({ estado: 'caducada', resuelta_at: new Date().toISOString(), error: 'Caducada por el agente: datos de otra generación' })
      .eq('perfil_id', perfilId)
      .eq('estado', 'pendiente')
      .in('id', ids.slice(i, i + 200))
      .select('id')
    if (e) throw errorDelAgente(e)
    n += hechas?.length ?? 0
  }
  return n
}

/** El agente la descarta (pendiente → descartada, sin persona) y lo apunta en el log con su motivo. Si ya no estaba pendiente, no hace nada */
export async function descartarComoAgente(perfilId: string, id: string, motivo: string): Promise<void> {
  const { data, error } = await createServiceClient()
    .from('ads_propuestas')
    .update({ estado: 'descartada', resuelta_at: new Date().toISOString(), resuelta_por: null })
    .eq('perfil_id', perfilId)
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select('id, tipo, termino, campaign_id, campaign_nombre, objetivo_id')
  if (error) throw errorDelAgente(error)
  const f = ((data ?? []) as Array<{ id: string; tipo: string; termino: string; campaign_id: string; campaign_nombre: string; objetivo_id?: string | null }>)[0]
  if (!f) return
  await anotarCambio({ perfilId, campaignId: f.campaign_id, nombreCampana: f.campaign_nombre, entidad: 'propuesta', accion: 'descartar', campo: `${f.tipo} · «${f.termino.slice(0, 120)}»`, motivo, origen: 'agente', userId: null, propuestaId: f.id, entidadId: f.objetivo_id ?? null })
}

/**
 * Cambia el valor nuevo de una propuesta PENDIENTE (un guardarraíl la recorta, o la forma reducida de una rara) y añade « · <nota>» a su motivo. Con `tipoNuevo: 'puja'`, una pausa pasa a ser
 * una bajada de puja (la forma reducida: la puja de partida se lee en Amazon al aplicarla y se guarda para poder deshacerla).
 */
export async function ajustarValorNuevo(perfilId: string, id: string, valor: number, nota: string, tipoNuevo?: 'puja', valorActual?: number): Promise<void> {
  if (!Number.isFinite(valor) || valor <= 0) throw new Error('El valor nuevo tiene que ser un número mayor que cero.')
  const service = createServiceClient()
  const { data, error } = await service.from('ads_propuestas').select('motivo, estado').eq('perfil_id', perfilId).eq('id', id).maybeSingle()
  if (error) throw errorDelAgente(error)
  const fila = data as { motivo: string; estado: string } | null
  if (!fila || fila.estado !== 'pendiente') return
  const { error: e2 } = await service
    .from('ads_propuestas')
    .update({
      valor_nuevo: Math.round(valor * 100) / 100,
      motivo: `${fila.motivo} · ${nota}`.slice(0, 2000),
      ...(tipoNuevo ? { tipo: tipoNuevo } : {}),
      // Con el tipo nuevo (una pausa rara que pasa a bajada de puja) se guarda también la puja leída como valor actual: al aplicar se comprueba que Amazon sigue igual
      // y, si se reintenta, los guardarraíles de la puja tienen con qué compararla
      ...(tipoNuevo && valorActual !== undefined && Number.isFinite(valorActual) && valorActual > 0 ? { valor_actual: Math.round(valorActual * 100) / 100 } : {}),
    })
    .eq('perfil_id', perfilId)
    .eq('id', id)
    .eq('estado', 'pendiente')
  if (e2) throw errorDelAgente(e2)
}

/**
 * Una negativa que el agente aplica por la IA va SIEMPRE en concordancia exacta. La negativa de campaña ya se crea así (crearNegativaDeCampana: NEGATIVE_EXACT); esto lo deja dicho en la propuesta
 * (métricas y motivo) para que nadie la lea como de frase. Solo si sigue pendiente.
 */
export async function ajustarConcordancia(perfilId: string, id: string, concordancia: 'NEGATIVE_EXACT'): Promise<void> {
  const service = createServiceClient()
  const { data, error } = await service.from('ads_propuestas').select('metricas, motivo, estado').eq('perfil_id', perfilId).eq('id', id).maybeSingle()
  if (error) throw errorDelAgente(error)
  const fila = data as { metricas: Record<string, unknown> | null; motivo: string; estado: string } | null
  if (!fila || fila.estado !== 'pendiente' || fila.metricas?.concordancia === concordancia) return
  const { error: e2 } = await service
    .from('ads_propuestas')
    .update({ metricas: { ...(fila.metricas ?? {}), concordancia }, motivo: `${fila.motivo} · negativa en concordancia exacta`.slice(0, 2000) })
    .eq('perfil_id', perfilId)
    .eq('id', id)
    .eq('estado', 'pendiente')
  if (e2) throw errorDelAgente(e2)
}

/** Lo que ha dicho la IA del agente de cada propuesta rara (aplicar o retener, con su motivo). Solo en las que siguen pendientes */
export async function guardarDecisionesIa(perfilId: string, decisiones: ReadonlyArray<{ id: string; decision: 'aplicar' | 'retener'; motivo: string }>): Promise<void> {
  const service = createServiceClient()
  const ahora = new Date().toISOString()
  for (const d of decisiones) {
    if (d.decision !== 'aplicar' && d.decision !== 'retener') continue
    const { error } = await service.from('ads_propuestas').update({ ia_decision: d.decision, ia_motivo: d.motivo.slice(0, 500), ia_at: ahora }).eq('perfil_id', perfilId).eq('id', d.id).eq('estado', 'pendiente')
    if (error) throw errorDelAgente(error)
  }
}

/**
 * Inserta las propuestas que crea el propio agente (vigilar: presupuestos R1/R4 y el recorte, pausas por stock), con origen 'agente'. El término es el nombre de la campaña (o el ASIN del anuncio).
 * Una igual ya pendiente (23505) se ignora. Devuelve cuántas se han guardado.
 */
export async function insertarPropuestasDelAgente(perfilId: string, filas: ReadonlyArray<FilaDePropuestaDelAgente>): Promise<number> {
  if (filas.length === 0) return 0
  if (!(await columnasAgente())) throw new Error(FALTA_MIGRACION_315)
  const service = createServiceClient()
  const aFila = (f: FilaDePropuestaDelAgente) => ({
    perfil_id: perfilId,
    tipo: f.tipo,
    asin: f.asin,
    termino: (f.objetivoTipo === 'anuncio' ? (f.asin ?? f.objetivoId ?? f.campaignNombre).toUpperCase() : f.campaignNombre).slice(0, 300),
    campaign_id: f.campaignId,
    campaign_nombre: f.campaignNombre,
    desde_rol: partesDeNombre(f.campaignNombre)?.rol ?? null,
    motivo: f.motivo,
    metricas: { clics: 0, gasto: 0, pedidos: 0, ventas: 0, acosPct: null, ...f.metricas },
    objetivo_id: f.objetivoId ?? null,
    objetivo_tipo: f.objetivoTipo ?? null,
    valor_actual: f.valorActual,
    valor_nuevo: f.valorNuevo,
    origen: 'agente',
  })
  let nuevas = 0
  for (const f of filas) {
    // Una BAJADA de presupuesto (recorte, R4, donante) gana a una SUBIDA pendiente de la misma campaña (retenida o esperando): esa caduca, o el índice
    // único de pendientes (294) rechazaría la bajada en silencio y el guardarraíl de gasto no actuaría justo ahí
    if (f.tipo === 'presupuesto' && f.valorActual != null && f.valorNuevo != null && f.valorNuevo < f.valorActual) {
      const { data: subidas, error: eSub } = await service
        .from('ads_propuestas')
        .select('id, valor_actual, valor_nuevo, error')
        .eq('perfil_id', perfilId)
        .eq('tipo', 'presupuesto')
        .eq('campaign_id', f.campaignId)
        .eq('estado', 'pendiente')
      if (eSub) throw errorDelAgente(eSub)
      const filasSube = ((subidas ?? []) as Array<{ id: string; valor_actual: unknown; valor_nuevo: unknown; error: string | null }>).filter((s) => Number(s.valor_nuevo) > Number(s.valor_actual))
      // Una subida que viene de un reintento por transporte puede estar YA en Amazon: no se caduca (quedaría fuera de todo control), se retiene para una persona.
      // La bajada choca entonces con el índice único (23505) y no entra: lo prudente con un cambio que no se sabe si está hecho es que lo mire una persona
      for (const s of filasSube) {
        if (esReintentoDeTransporte(s.error)) await marcarRetenida(perfilId, s.id, motivoDeReintentoRetenido('la cuenta quiere bajar el presupuesto de esta campaña'))
      }
      const ids = filasSube.filter((s) => !esReintentoDeTransporte(s.error)).map((s) => s.id)
      if (ids.length > 0) {
        const { error: eCad } = await service
          .from('ads_propuestas')
          .update({ estado: 'caducada', resuelta_at: new Date().toISOString(), error: 'Caducada por el agente: la cuenta baja el presupuesto de esta campaña (recorte o presupuesto sobrante).' })
          .eq('perfil_id', perfilId)
          .eq('estado', 'pendiente')
          .in('id', ids)
        if (eCad) throw errorDelAgente(eCad)
      }
    }
    const { error } = await service.from('ads_propuestas').insert(aFila(f))
    if (!error) nuevas += 1
    else if (error.code !== '23505') throw errorDelAgente(error) // 23505 = ya había una pendiente igual
  }
  return nuevas
}

/** Las pendientes que el agente puede mirar: sin retener, las que más gastan primero. Consulta propia (no listarPropuestas): índice idx_ads_propuestas_pendientes_libres */
export async function pendientesLibres(perfilId: string, limite: number): Promise<Propuesta[]> {
  if (!(await columnasAgente())) throw new Error(FALTA_MIGRACION_315)
  const { data, error } = await createServiceClient()
    .from('ads_propuestas')
    .select(await columnas())
    .eq('perfil_id', perfilId)
    .eq('estado', 'pendiente')
    .is('retenida_at', null)
    .order('metricas->gasto', { ascending: false, nullsFirst: false })
    .order('creada_at', { ascending: true })
    .limit(Math.min(Math.max(1, Math.floor(limite) || 1), 2000))
  if (error) throw errorDelAgente(error)
  // El orden por JSON lo hace la base; se repite aquí por si un gasto llega como texto
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(deFila).sort((a, b) => (Number(b.metricas.gasto) || 0) - (Number(a.metricas.gasto) || 0))
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
