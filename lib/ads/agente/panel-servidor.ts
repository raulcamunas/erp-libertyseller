/**
 * AMAZON ADS · EL AGENTE PPC: LO QUE ENSEÑA LA PESTAÑA «AGENTE». SOLO SERVIDOR. NO LLAMA A AMAZON (solo base de datos).
 *
 * `panelDelAgente(cuenta, esAdmin)` reúne en una sola respuesta todo lo que pinta la pantalla:
 *   · estado: configuración, interruptor general, modo del motor, ficha firmada, frase de estado, si se puede saltar el ensayo, rampa, evento y veda de temporada;
 *   · objetivos: TACoS objetivo, techo (automático y congelado o de la ficha) y los productos con su objetivo, fase, marca, stock y postura;
 *   · ritmo: el gasto estimado de HOY (día local del marketplace), lo más que se puede gastar hoy, la media de 7 días, la proyección del día y el mes;
 *   · la línea de tiempo (60 últimas entre eventos del agente y cambios que aplicó o ensayó, con su veredicto) y qué cambio se puede deshacer;
 *   · resultados (veredictos de 60 días por clase), IA (coste del mes, último informe, validación de etiquetas) y los topes de hoy por la rampa.
 *
 * Sin la migración 315 devuelve `{ faltaMigracion: 315 }` con lo mínimo (modo, ficha, interruptor) y la pantalla dice que falta lanzarla.
 * Importa solo de la oleada 1, de agente-estado, agente-datos, agente-ia, agente-efectos y motor-nucleo: NUNCA del orquestador.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { leerFicha } from '../cuenta'
import { leerModo } from '../motor'
import type { CuentaParaSincronizar } from '../sincronizar'
import { costeIaDelMes, queDePropuesta, ultimoInforme, validacionDeLaIa } from './cerebro-ia'
import { leerContextoDelAgente, nombreDeCuenta } from './contexto-servidor'
import { resumenDeVeredictos } from './efectos-calculo'
import { veredictosRecientes } from './efectos-servidor'
import { hayEscrituraRealEnAlgunaCuenta, hechosDeHoy, leerConfigDelAgente, paradaGeneral } from './estado-servidor'
import { claseDeCambio, clasificarErrorDeAmazon, datosDelError, FRENOS_AUTOMATICOS, topesDelDia } from './guardarrailes-calculo'
import { diaDeRampa, textoDeEstado } from './pasos-calculo'
import { enVedaDeActivacion, eventoEn } from './temporada-calculo'
import {
  AGENTE,
  FALTA_MIGRACION_315,
  RAMPA,
  TOPES_DE_PARTIDA,
  type ClaseDeCambio,
  type ConfigDelAgente,
  type DiaDeUso,
  type EstadoDelMes,
  type EventoDeLinea,
  type PanelDelAgente,
  type Presion,
  type Veredicto,
} from './tipos'
import { curvaHoraria, gastoDeHoy, gastoMaximoPosible, horaLocal, inicioDelDiaLocal, proyectarHoy } from './uso-calculo'
import { diasDeUso, horasDeCuenta } from './uso-servidor'
import { usoDisponible } from './vigilar-servidor'

const DIA_MS = 86_400_000
/** Cuántas filas tiene la línea de tiempo */
export const FILAS_DE_LINEA = 60
/** Días de veredictos que se resumen por clase */
export const DIAS_DE_VEREDICTOS = 60
/** Días que dura la rampa (el último escalón empieza el día `desdeDia`, que es el día `desdeDia + 1`) */
export const DIAS_DE_RAMPA = RAMPA[RAMPA.length - 1].desdeDia + 1
/** Cuántas campañas se enseñan en el ritmo de hoy (las que más gastan) */
const CAMPANAS_DE_HOY_MAX = 150
/** Días hacia atrás en los que se miran los errores de Amazon que cuentan (con ellos la rampa no pasa del 75 %) */
const DIAS_DE_ERRORES_RECIENTES = 7

/* =============================================================================================================================================================
 * Auxiliares PUROS (probados en panel-servidor.prueba.ts)
 * ============================================================================================================================================================= */

const numero = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 'YYYY-MM-DD' + n días (aritmética UTC sobre una fecha ya local) */
export const desplazarFecha = (dia: string, dias: number): string => new Date(Date.parse(`${dia}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10)

/** PURO. «13:40» de un minuto del día (0–1439) */
export function horaDeMinuto(minuto: number | null): string | null {
  if (minuto == null || !Number.isFinite(minuto)) return null
  const m = Math.max(0, Math.min(1439, Math.round(minuto)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** PURO. El mes vacío (sin la 315 o sin datos): nada gastado, sin techo, ritmo normal */
export function mesVacio(motivo: string): EstadoDelMes {
  return { gastoMes: 0, techo: null, proyeccion: null, media7: 0, diasRestantes: 0, ritmo: 'normal', cambiado: false, motivo }
}

/**
 * PURO. La rampa que enseña la pantalla: solo en ACTIVO y mientras dura (día 1 a 7). `rampaDesdeLocal` es la fecha local en que empezó; el factor y
 * «solo bajadas» los da `topesDelDia` (ya con los errores recientes). null fuera de la rampa.
 */
export function rampaDelPanel(
  estado: ConfigDelAgente['estado'] | null,
  rampaDesdeLocal: string | null,
  hoyLocal: string,
  t: { factor: number; soloBajadas: boolean },
): PanelDelAgente['rampa'] {
  if (estado !== 'activo') return null
  const dia = diaDeRampa(rampaDesdeLocal, hoyLocal)
  if (dia === null || dia >= DIAS_DE_RAMPA) return null
  return { dia: dia + 1, de: DIAS_DE_RAMPA, factor: t.factor, soloBajadas: t.soloBajadas }
}

/**
 * PURO. Las campañas de HOY para la tarjeta de ritmo: presupuesto, uso, a qué hora se agotó («13:40»; «sin presupuesto» si solo se sabe por el estado) y la
 * presión del día. Las que más gastan primero.
 */
export function campanasDeHoy(
  dias: readonly DiaDeUso[],
  fecha: string,
  nombres: ReadonlyMap<string, string>,
  presion: Readonly<Record<string, Presion>>,
): PanelDelAgente['ritmo']['hoy']['campanas'] {
  return dias
    .filter((d) => d.fechaLocal === fecha)
    .sort((a, b) => (b.gastoEstimado ?? 0) - (a.gastoEstimado ?? 0) || (b.usoPct ?? 0) - (a.usoPct ?? 0))
    .slice(0, CAMPANAS_DE_HOY_MAX)
    .map((d) => ({
      campaignId: d.campaignId,
      nombre: nombres.get(d.campaignId) || d.campaignId,
      presupuesto: d.presupuesto,
      usoPct: d.usoPct,
      agotadaA: d.agotadaMin != null ? horaDeMinuto(d.agotadaMin) : d.agotadaPorEstado ? 'sin presupuesto' : null,
      presion: presion[d.campaignId] ?? null,
    }))
}

/** PURO. La lectura más reciente de hoy (ISO) o null */
export function ultimaLectura(dias: readonly DiaDeUso[], fecha: string): string | null {
  let max: string | null = null
  for (const d of dias) if (d.fechaLocal === fecha && d.leidoAt && (!max || d.leidoAt > max)) max = d.leidoAt
  return max
}

/**
 * PURO. La presión que se enseña: la guardada si es de hoy o de ayer (se recalcula una vez al día tras las 03:00 locales y no se toca hasta el día
 * siguiente: antes de esa hora sigue mandando la de ayer). Si es más vieja, ninguna.
 */
export function presionVigente(presion: Readonly<Record<string, Presion>> | null | undefined, presionFecha: string | null, hoyLocal: string): Record<string, Presion> {
  if (!presion || !presionFecha) return {}
  return presionFecha === hoyLocal || presionFecha === desplazarFecha(hoyLocal, -1) ? { ...presion } : {}
}

/** Una propuesta del agente tal y como la lee el panel */
export interface CambioDelAgente {
  id: string
  tipo: string
  asin: string | null
  termino: string
  campaignNombre: string
  motivo: string | null
  error: string | null
  pedidos: number
  valorActual: number | null
  valorNuevo: number | null
  objetivoTipo: string | null
  estado: string
  agenteAt: string
}

/** Un evento de `ads_agente_eventos` tal y como lo lee el panel */
export interface EventoDelAgente {
  id: string
  creadoAt: string
  tipo: string
  titulo: string
  detalle: string | null
  propuestaId: string | null
}

/**
 * PURO. ¿Se puede deshacer desde la pantalla? Solo lo APLICADO de verdad en Amazon; la pausa de una campaña por falta de stock no, mientras el stock del
 * ASIN siga en 0 (se reactiva sola cuando vuelve).
 */
export function esDeshacible(c: Pick<CambioDelAgente, 'estado' | 'tipo' | 'asin'>, asinsSinStock: ReadonlySet<string>): boolean {
  if (c.estado !== 'aplicada') return false
  if (c.tipo === 'pausar-campana' && c.asin && asinsSinStock.has(c.asin.toUpperCase())) return false
  return true
}

/**
 * PURO. La línea de tiempo: los eventos del agente y los cambios que aplicó o ensayó, mezclados por fecha (lo último arriba), con el veredicto de cada
 * cambio (incluido «mezclado») y si lo deshizo él solo. Como mucho `max` filas.
 */
export function lineaDelAgente(
  eventos: readonly EventoDelAgente[],
  cambios: readonly CambioDelAgente[],
  efectos: ReadonlyMap<string, { veredicto: Veredicto | null; deshechoAuto: boolean }>,
  asinsSinStock: ReadonlySet<string>,
  max: number = FILAS_DE_LINEA,
): EventoDeLinea[] {
  const filas: EventoDeLinea[] = []
  for (const c of cambios) {
    const clase: ClaseDeCambio = claseDeCambio({ tipo: c.tipo, valorActual: c.valorActual, valorNuevo: c.valorNuevo, metricas: { pedidos: c.pedidos } })
    const ef = efectos.get(c.id)
    const detalle = [c.motivo?.trim() || null, c.estado === 'error' && c.error ? `Error: ${c.error}` : null].filter(Boolean).join(' · ')
    filas.push({
      id: c.id,
      at: c.agenteAt,
      tipo: 'cambio',
      titulo: queDePropuesta({ tipo: c.tipo, termino: c.termino, campaignNombre: c.campaignNombre, valorActual: c.valorActual, valorNuevo: c.valorNuevo, objetivoTipo: c.objetivoTipo }),
      detalle: detalle || null,
      clase,
      propuestaId: c.id,
      estado: c.estado,
      ensayo: c.estado === 'ensayada',
      veredicto: ef?.veredicto ?? null,
      deshechoAuto: ef?.deshechoAuto === true,
      deshacible: esDeshacible(c, asinsSinStock),
    })
  }
  for (const e of eventos) {
    filas.push({
      id: e.id,
      at: e.creadoAt,
      tipo: 'evento',
      titulo: e.titulo,
      detalle: e.detalle,
      clase: null,
      propuestaId: e.propuestaId,
      estado: e.tipo,
      ensayo: false,
      veredicto: null,
      deshechoAuto: e.tipo === 'deshacer_auto',
      deshacible: false,
    })
  }
  const ms = (iso: string) => {
    const t = Date.parse(iso)
    return Number.isFinite(t) ? t : 0
  }
  return filas.sort((a, b) => ms(b.at) - ms(a.at) || a.id.localeCompare(b.id)).slice(0, Math.max(0, max))
}

/** PURO. ¿Hay errores de Amazon que CUENTAN (autorización) en las filas del log? Con ellos la rampa no pasa del 75 % */
export function hayErroresQueCuentan(filas: ReadonlyArray<{ ok: boolean | null; httpStatus: number | null; error: string | null }>): boolean {
  // Con el código de Amazon del texto (como aplicar-servidor y vigilar)
  return filas.some((f) => f.ok === false && clasificarErrorDeAmazon(f.httpStatus, f.error ? datosDelError(f.error).codigo : null, f.error) === 'autorizacion')
}

/** PURO. El panel cuando falta la migración 315: lo mínimo para que la pantalla diga qué falta */
export function panelSinMigracion(a: {
  esAdmin: boolean
  parada: PanelDelAgente['paradaGeneral']
  modo: string
  fichaFirmada: boolean
  moneda: string | null
  tacosObjetivoPct: number
  techoMensual: number | null
}): PanelDelAgente {
  return {
    faltaMigracion: 315,
    esAdmin: a.esAdmin,
    paradaGeneral: a.parada,
    modoDelMotor: a.modo,
    fichaFirmada: a.fichaFirmada,
    config: null,
    estadoTexto: FALTA_MIGRACION_315,
    puedeSaltarEnsayo: false,
    rampa: null,
    evento: null,
    veda: null,
    cuentaPequena: false,
    moneda: a.moneda,
    objetivos: { tacosObjetivoPct: a.tacosObjetivoPct, techoMensual: a.techoMensual, techoAutomatico: false, techoCongeladoAt: null, productos: [] },
    ritmo: {
      hoy: { gastoEstimado: 0, maximoPosible: 0, mediaDiaria7: 0, proyeccion: null, leidoAt: null, campanas: [] },
      mes: mesVacio(FALTA_MIGRACION_315),
      usoDisponible: false,
      usoError: null,
    },
    linea: [],
    veredictosPorClase: {},
    ia: { costeMesUsd: 0, topeUsd: AGENTE.IA_TOPE_USD_MES, llamadasMes: 0, ultimaAt: null, ultimoError: null, ultimoInforme: null, validacion: { resueltas: 0, deAcuerdo: 0, ok: false } },
    topes: { ...TOPES_DE_PARTIDA },
    topesHoy: { ...TOPES_DE_PARTIDA },
    hechosHoy: {},
    retenidas: 0,
  }
}

/* =============================================================================================================================================================
 * Lecturas (base de datos)
 * ============================================================================================================================================================= */

const esFalta315 = (e: unknown): boolean => e instanceof Error && e.message === FALTA_MIGRACION_315

/** Las 60 últimas propuestas que aplicó o ensayó el agente */
async function cambiosDelAgente(perfilId: string): Promise<CambioDelAgente[]> {
  const { data, error } = await createServiceClient()
    .from('ads_propuestas')
    .select('id, tipo, asin, termino, campaign_nombre, motivo, error, metricas, valor_actual, valor_nuevo, objetivo_tipo, estado, agente_at')
    .eq('perfil_id', perfilId)
    .not('agente_at', 'is', null)
    .order('agente_at', { ascending: false })
    .limit(FILAS_DE_LINEA)
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    id: String(f.id),
    tipo: String(f.tipo ?? ''),
    asin: (f.asin as string | null) ?? null,
    termino: String(f.termino ?? ''),
    campaignNombre: String(f.campaign_nombre ?? ''),
    motivo: (f.motivo as string | null) ?? null,
    error: (f.error as string | null) ?? null,
    pedidos: numero((f.metricas as { pedidos?: unknown } | null)?.pedidos) ?? 0,
    valorActual: numero(f.valor_actual),
    valorNuevo: numero(f.valor_nuevo),
    objetivoTipo: (f.objetivo_tipo as string | null) ?? null,
    estado: String(f.estado ?? ''),
    agenteAt: String(f.agente_at),
  }))
}

/** Los 60 últimos eventos de la línea de tiempo del agente */
async function eventosDelAgente(perfilId: string): Promise<EventoDelAgente[]> {
  const { data, error } = await createServiceClient()
    .from('ads_agente_eventos')
    .select('id, creado_at, tipo, titulo, detalle, propuesta_id')
    .eq('perfil_id', perfilId)
    .order('creado_at', { ascending: false })
    .limit(FILAS_DE_LINEA)
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    id: String(f.id),
    creadoAt: String(f.creado_at),
    tipo: String(f.tipo ?? ''),
    titulo: String(f.titulo ?? ''),
    detalle: (f.detalle as string | null) ?? null,
    propuestaId: (f.propuesta_id as string | null) ?? null,
  }))
}

/** El veredicto y si se deshizo solo, de cada propuesta que lo tenga en `ads_efectos` */
async function efectosDe(perfilId: string, ids: readonly string[]): Promise<Map<string, { veredicto: Veredicto | null; deshechoAuto: boolean }>> {
  const r = new Map<string, { veredicto: Veredicto | null; deshechoAuto: boolean }>()
  if (ids.length === 0) return r
  const { data, error } = await createServiceClient().from('ads_efectos').select('propuesta_id, veredicto, deshecho_auto').eq('perfil_id', perfilId).in('propuesta_id', [...ids])
  if (error) throw error
  for (const f of (data ?? []) as Array<{ propuesta_id: string; veredicto: Veredicto | null; deshecho_auto: boolean | null }>) {
    r.set(f.propuesta_id, { veredicto: f.veredicto ?? null, deshechoAuto: f.deshecho_auto === true })
  }
  return r
}

/** Cuántas propuestas ha dejado el agente para una persona (pendientes y retenidas) */
async function retenidasDe(perfilId: string): Promise<number> {
  const { count, error } = await createServiceClient()
    .from('ads_propuestas')
    .select('id', { count: 'exact', head: true })
    .eq('perfil_id', perfilId)
    .eq('estado', 'pendiente')
    .not('retenida_at', 'is', null)
  if (error) throw error
  return count ?? 0
}

/** Los nombres de las campañas (de su rendimiento de los últimos días). Si falla, vacío: la pantalla enseña el id */
async function nombresDeCampanas(perfilId: string, ids: readonly string[], desde: string): Promise<Map<string, string>> {
  const r = new Map<string, string>()
  if (ids.length === 0) return r
  try {
    const { data } = await createServiceClient()
      .from('ads_rendimiento_diario')
      .select('campaign_id, nombre, fecha')
      .eq('perfil_id', perfilId)
      .in('campaign_id', [...ids].slice(0, 500))
      .gte('fecha', desde)
      .order('fecha', { ascending: false })
      .limit(5000)
    for (const f of (data ?? []) as Array<{ campaign_id: string; nombre: string | null }>) if (f.nombre && !r.has(String(f.campaign_id))) r.set(String(f.campaign_id), f.nombre)
  } catch {
    /* sin nombres */
  }
  return r
}

/** ¿Ha tenido el agente errores de Amazon que cuentan en los últimos 7 días? (log con origen «agente», o «automatico» con «[AGENTE]» si la 315 aún no admitía el origen) */
async function erroresRecientes(perfilId: string, ahora: number): Promise<boolean> {
  const service = createServiceClient()
  const desde = new Date(ahora - DIAS_DE_ERRORES_RECIENTES * DIA_MS).toISOString()
  const pedir = (columnas: string, origen: string, conMarca: boolean) => {
    let q = service.from('ads_cambios_log').select(columnas).eq('perfil_id', perfilId).eq('origen', origen).eq('ok', false).gte('creado_at', desde)
    if (conMarca) q = q.like('motivo', '[AGENTE]%')
    return q.limit(300)
  }
  const leer = async (origen: string, conMarca: boolean) => {
    let r = await pedir('ok, http_status, error', origen, conMarca)
    if (r.error) r = await pedir('ok, error', origen, conMarca)
    if (r.error) return [] as Array<Record<string, unknown>>
    return (r.data ?? []) as unknown as Array<Record<string, unknown>>
  }
  try {
    const filas = [...(await leer('agente', false)), ...(await leer('automatico', true))]
    return hayErroresQueCuentan(filas.map((f) => ({ ok: f.ok === true ? true : f.ok === false ? false : null, httpStatus: numero(f.http_status), error: (f.error as string | null) ?? null })))
  } catch {
    return false
  }
}

/* =============================================================================================================================================================
 * El panel
 * ============================================================================================================================================================= */

/** Todo lo que pinta la pestaña «Agente» de una cuenta. Solo base de datos */
export async function panelDelAgente(cuenta: CuentaParaSincronizar, esAdmin: boolean): Promise<PanelDelAgente> {
  const ahora = Date.now()
  const [parada, modo, ficha] = await Promise.all([paradaGeneral(), leerModo(cuenta.id), leerFicha(cuenta.id)])
  const fichaFirmada = Boolean(ficha.firmadaAt)

  let config: ConfigDelAgente | null
  try {
    config = await leerConfigDelAgente(cuenta.id)
  } catch (e) {
    if (!esFalta315(e)) throw e
    let moneda: string | null = null
    try {
      moneda = (await nombreDeCuenta(cuenta.id)).moneda
    } catch {
      /* sin moneda */
    }
    return panelSinMigracion({ esAdmin, parada, modo, fichaFirmada, moneda, tacosObjetivoPct: ficha.tacosObjetivoPct, techoMensual: ficha.presupuestoMensual })
  }

  const contexto = await leerContextoDelAgente(cuenta, config, ahora)
  const zona = contexto.zonaHoraria
  const local = horaLocal(ahora, zona)
  const fecha = local.fecha
  const manuales = config?.eventosManuales ?? []
  const evento = eventoEn(fecha, contexto.pais, manuales)
  // Sin veda de temporada (20 nov 2026, Raúl)
  const veda = null as ReturnType<typeof enVedaDeActivacion>
  void manuales

  const [diasHoy, horas, escrituraReal, hechosHoy, conErrores, cambios, eventos, retenidas, veredictos, coste, informe, validacion] = await Promise.all([
    diasDeUso(cuenta.id, fecha, fecha),
    horasDeCuenta(cuenta.id, desplazarFecha(fecha, -AGENTE.CURVA_DIAS), desplazarFecha(fecha, -1)),
    hayEscrituraRealEnAlgunaCuenta(),
    hechosDeHoy(cuenta.id, inicioDelDiaLocal(fecha, zona)),
    erroresRecientes(cuenta.id, ahora),
    cambiosDelAgente(cuenta.id),
    eventosDelAgente(cuenta.id),
    retenidasDe(cuenta.id),
    veredictosRecientes(cuenta.id, DIAS_DE_VEREDICTOS),
    costeIaDelMes(cuenta.id, ahora),
    ultimoInforme(cuenta.id),
    validacionDeLaIa(cuenta.id),
  ])

  // Topes de hoy por la rampa (en ensayo, completos: no escribe)
  const topes = config?.topes ?? { ...TOPES_DE_PARTIDA }
  const rampaDesdeLocal = config?.rampaDesde && Number.isFinite(Date.parse(config.rampaDesde)) ? horaLocal(Date.parse(config.rampaDesde), zona).fecha : null
  const diaRampa = config?.estado === 'activo' ? diaDeRampa(rampaDesdeLocal, fecha) : null
  const hoyTopes = topesDelDia(topes, { enEnsayo: config?.estado !== 'activo', diaRampa, cuentaPequena: contexto.cuentaPequena, erroresRecientes: conErrores })

  // Ritmo de hoy: gasto estimado, máximo posible, proyección con la curva horaria de la cuenta
  const gastoEstimado = gastoDeHoy(diasHoy, fecha)
  const hayLecturaHoy = diasHoy.some((d) => d.fechaLocal === fecha)
  const proyeccion = hayLecturaHoy ? Math.round(proyectarHoy(gastoEstimado, local.hora, local.minutos, curvaHoraria(horas)) * 100) / 100 : null
  const presion = presionVigente(config?.presion, config?.presionFecha ?? null, fecha)
  const nombres = await nombresDeCampanas(
    cuenta.id,
    diasHoy.map((d) => d.campaignId),
    desplazarFecha(fecha, -14),
  )

  // Línea de tiempo con veredictos
  const efectos = await efectosDe(
    cuenta.id,
    cambios.map((c) => c.id),
  )
  const asinsSinStock = new Set(contexto.productos.filter((p) => p.stock === 0).map((p) => p.asin.toUpperCase()))

  return {
    faltaMigracion: null,
    esAdmin,
    paradaGeneral: parada,
    modoDelMotor: modo,
    fichaFirmada,
    config,
    estadoTexto: textoDeEstado(config, ahora, zona, veda),
    puedeSaltarEnsayo: escrituraReal && !veda,
    // Sin frenos automáticos no hay rampa (topesDelDia no la aplica): el panel no enseña una que no existe aunque quede un rampa_desde viejo
    rampa: FRENOS_AUTOMATICOS ? rampaDelPanel(config?.estado ?? null, rampaDesdeLocal, fecha, hoyTopes) : null,
    evento,
    veda,
    // Sin límites por cuenta pequeña (20 nov 2026, Raúl)
    cuentaPequena: false,
    moneda: contexto.moneda,
    objetivos: {
      tacosObjetivoPct: contexto.tacosObjetivoPct,
      techoMensual: contexto.techo.techo,
      techoAutomatico: contexto.techo.automatico,
      techoCongeladoAt: contexto.techo.congeladoAt,
      productos: contexto.productos,
    },
    ritmo: {
      hoy: {
        gastoEstimado,
        maximoPosible: gastoMaximoPosible(diasHoy, fecha),
        mediaDiaria7: contexto.mes.media7,
        proyeccion,
        leidoAt: ultimaLectura(diasHoy, fecha),
        campanas: campanasDeHoy(diasHoy, fecha, nombres, presion),
      },
      mes: contexto.mes,
      usoDisponible: usoDisponible(config?.usoError ?? null, config?.usoErrorAt ?? null, ahora),
      usoError: config?.usoError ?? null,
    },
    linea: lineaDelAgente(eventos, cambios, efectos, asinsSinStock),
    veredictosPorClase: resumenDeVeredictos(veredictos.map((v) => ({ clase: v.clase, veredicto: v.veredicto }))),
    ia: {
      costeMesUsd: coste.coste,
      topeUsd: config?.topeIaUsdMes ?? AGENTE.IA_TOPE_USD_MES,
      llamadasMes: coste.llamadas,
      ultimaAt: coste.ultimaAt,
      ultimoError: coste.ultimoError,
      ultimoInforme: informe,
      validacion,
    },
    topes,
    topesHoy: hoyTopes.topes,
    hechosHoy,
    retenidas,
  }
}
