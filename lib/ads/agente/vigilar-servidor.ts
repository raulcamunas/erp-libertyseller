/**
 * AMAZON ADS · EL AGENTE PPC: VIGILAR UNA CUENTA (SOLO SERVIDOR; LEE de Amazon: campañas, uso del presupuesto, portfolios y, si hay stock 0, sus anuncios).
 *
 * Cada 30 minutos (paso «vigilar»):
 *   (b) campañas + uso de presupuesto de hoy → `ads_presupuesto_dia` y `ads_gasto_hora` (uso-servidor). Si no se pueden leer las campañas, el vigilar FALLA (no se apunta
 *       como error de uso). Un fallo PASAJERO de la API de uso (429, 5xx, red) solo cuenta como error tras USO_FALLOS_PASAJEROS seguidos, con reintentos a los 30 min,
 *       1 h, 2 h… (como mucho 6 h) desde el ÚLTIMO intento; uno persistente (401/403, 4xx, 207 sin aciertos), cada 6 h. Tras un error, cada vigilar prueba un lote.
 *       Mientras, «agotada» sale del estado.
 *   (c) Una vez al día, en el primer vigilar tras las 03:00 locales: presión del día (R2/R3) y ritmo del mes (con recorte), con días CERRADOS; se guardan en `ads_agente`.
 *   (d) Reglas de presupuesto R1 (con financiación) y R4 → propuestas DEVUELTAS (no se insertan aquí).
 *   (e) Stock por ASIN: dos lecturas a 0 separadas ≥ 6 h (`ads_agente_stock_cero`), listing fresco y la campaña gastando → pausa (campaña o anuncio); si no, solo «recortar» y aviso. Reactivación.
 *   (f) Datos del freno → `evaluarFrenos` (ensayo o activo; frena el primero).
 *   (g) `raras_sin_ia` y limpieza diaria (> 35 días).
 * NO inserta propuestas, NO frena, NO avisa y NO deshace: lo devuelve todo (`ResultadoDeVigilar`) y lo hace el orquestador. En «frenado» solo mide (uso), devuelve el freno a null (ya está frenado),
 * no recalcula presión ni ritmo, no devuelve ninguna propuesta que SUBA (solo las pausas por stock, que esperan a una persona en «Aprueba y aplica») y no propone reactivar nada.
 *
 * Sin la 315, lanza `Error(FALTA_MIGRACION_315)`.
 *
 * Límite de los datos (ver contexto-servidor): sin ventas totales día a día, el freno «ventas_caidas» compara la media diaria de los últimos 7 días cerrados con la de los 23 anteriores (de las
 * ventanas de 7 y 30 días), no 3 días contra 28.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { campanasDe, type Campana } from '../campanas'
import { llamarAds } from '../datos'
import { esReintentoDeTransporte } from '../motor-calculo'
import { todasLasFilas } from '../paginar'
import { asinDeCampana } from '../productos-agrupar'
import { esAsin, partesDeNombre } from '../reglas'
import type { CuentaParaSincronizar } from '../sincronizar'
import { leerUmbrales } from '../umbrales-cuenta'
import {
  acosDe,
  actualizarFilaPropia,
  campanaEsDeMarca,
  desplazar,
  diasEntre,
  estadoDelMesGuardado,
  filasDeUso,
  gastoDelMes,
  lanzar,
  leerCuenta,
  numero,
  redondear2,
  stockPorAsin,
  sumaDeVentas,
  sumarDias,
  tendenciaSemanal,
  type DiaDeCampana,
  type LecturaDeCuenta,
  type ProductoDelAgente,
} from './contexto-servidor'
import { subidasVetadasDeCuenta } from './ajustes-servidor'
import { hechosDeHoy } from './estado-servidor'
import { clasificarErrorDeAmazon, datosViejos, esRara, evaluarFrenos, faltaEnSumas, quedaTope, ventasParaFreno, presupuestoUtil, sinSubidasDePresupuesto, topesDelDia } from './guardarrailes-calculo'
import { combinarAjustes } from './objetivos-calculo'
import { diaDeRampa } from './pasos-calculo'
import { presionDelDia, recortePorRitmo, reglasDePresupuesto, ritmoDelMes } from './ritmo-calculo'
import { coberturaDias, decisionDeStock, decisionDeStockConAnuncios, ESTADOS_DE_PAUSA_HECHA, pausasYaHechas, posturasPorStock, puedeReactivar, type FilaDePausa } from './stock-calculo'
import { eventoEn } from './temporada-calculo'
import {
  AGENTE,
  TOPES_DE_PARTIDA,
  type CampanaParaRitmo,
  type ConfigDelAgente,
  type DiaDeUso,
  type EstadoDelMes,
  type FilaDePropuestaDelAgente,
  type HoraDeCuenta,
  type MotivoDeFreno,
  type Postura,
  type Presion,
  type PropuestaDeRitmo,
  type TipoDeEvento,
} from './tipos'
import { curvaHoraria, gastoDeHoy, gastoMaximoPosible, horaLocal, inicioDelDiaLocal, leerUsoError, proyectarHoy, textoDeUsoPasajero, usoErrorBloquea } from './uso-calculo'
import { horasDeCuenta, leerPortfolios, leerUsoDePresupuesto } from './uso-servidor'

// Los auxiliares del texto de `uso_error` viven en uso-calculo (puro: también los usa el panel); se reexportan para quien ya los toma de aquí
export { leerUsoError, textoDeUsoPasajero, usoErrorBloquea, USO_FALLOS_PASAJEROS } from './uso-calculo'

const HORA_MS = 3_600_000
const TIPO_ANUNCIO = 'application/vnd.spProductAd.v3+json'
/** Ventana dentro de cada bloque de 6 h en la que se reintenta la API de uso tras un error (vigilar corre cada 30 min) */
const VENTANA_REINTENTO_USO_H = 0.75

export interface ResultadoDeVigilar {
  fechaLocal: string
  minutoLocal: number
  ritmo: EstadoDelMes
  presionNueva: Record<string, Presion> | null
  propuestas: FilaDePropuestaDelAgente[]
  presionBajarPorRecorte: string[]
  gastoHoy: number
  maximoPosible: number
  proyeccionHoy: number
  media7: number
  freno: { motivo: MotivoDeFreno; detalle: string } | null
  sinStock: Array<{ asin: string; nombre: string; campanas: number; anuncios: number; fuente: string }>
  /** `ceroDesde`: la primera lectura a 0 del episodio (ads_agente_stock_cero.primera_at): el aviso es uno por episodio, no uno por día */
  soloRecortarPorStock: Array<{ asin: string; nombre: string; porque: string; ceroDesde: string | null }>
  vuelveStock: Array<{ asin: string; nombre: string; propuestaIds: string[]; noReactivar: Array<{ propuestaId: string; porque: string }> }>
  agotadaTop: { campaignId: string; nombre: string; minuto: number; presupuesto: number; acosPct: number | null; nuevo: number | null; porque: string | null } | null
  avisos: Array<{ campaignId: string; texto: string }>
  usoError: string | null
  usoErrorNuevo: boolean
  eventos: Array<{ tipo: TipoDeEvento; titulo: string; detalle: string | null; datos?: unknown }>
}

/* =============================================================================================================================================================
 * Auxiliares PUROS (probados en la prueba del paquete)
 * ============================================================================================================================================================= */

/** Margen al medir el retroceso: vigilar corre cada 30 min y el último intento se apunta un poco después de su sello */
const MARGEN_RETROCESO_MIN = 5

/**
 * PURO. ¿Toca leer solo un lote de prueba de la API de uso (en vez de todos)? Tras un error PERSISTENTE, cada 6 h (en la primera ¾ h de cada bloque de 6 h desde
 * el primer fallo); tras uno PASAJERO, el retroceso crece con los fallos seguidos (el vigilar siguiente, 1 h, 2 h, 4 h y como mucho 6 h) y se mide desde el ÚLTIMO intento.
 * Mientras, cada vigilar prueba un lote: si va bien, el error se borra.
 */
export function saltarApiDeUso(usoError: string | null, usoErrorAt: string | null, ahora: number): boolean {
  const e = leerUsoError(usoError, usoErrorAt)
  if (!e) return false
  if (e.pasajero) {
    // El 1.er fallo no espera nada más que el vigilar siguiente (30 min); luego 1 h, 2 h, 4 h y como mucho 6 h
    if (e.fallos <= 1) return false
    const t = e.ultimoIntento ? Date.parse(e.ultimoIntento) : NaN
    if (!Number.isFinite(t)) return false
    const esperaMin = Math.min(AGENTE.USO_REINTENTO_HORAS * 60, 30 * 2 ** (e.fallos - 1))
    return ahora - t < (esperaMin - MARGEN_RETROCESO_MIN) * 60_000
  }
  const t = usoErrorAt ? Date.parse(usoErrorAt) : NaN
  if (!Number.isFinite(t)) return false
  const h = (ahora - t) / HORA_MS
  if (h < AGENTE.USO_REINTENTO_HORAS) return true
  return h % AGENTE.USO_REINTENTO_HORAS >= VENTANA_REINTENTO_USO_H
}

/**
 * PURO. Lo que queda en `uso_error` tras una lectura de uso. `error` null y se ha llamado → se borra. Uno PASAJERO suma un fallo (con la hora de este intento);
 * uno persistente se guarda tal cual. `usoErrorAt` es siempre la hora del PRIMER fallo (el «> 12 h sin reglas»). `nuevo`: pasa ahora a contar como error (aviso, una vez).
 */
export function siguienteUsoError(
  antes: { usoError: string | null; usoErrorAt: string | null },
  lectura: { error: string | null; transitorio: boolean; seLlamo: boolean },
  ahoraIso: string,
): { usoError: string | null; usoErrorAt: string | null; nuevo: boolean; cambia: boolean } {
  if (!lectura.error) {
    if (lectura.seLlamo && antes.usoError) return { usoError: null, usoErrorAt: null, nuevo: false, cambia: true }
    return { usoError: antes.usoError, usoErrorAt: antes.usoErrorAt, nuevo: false, cambia: false }
  }
  const previo = leerUsoError(antes.usoError, antes.usoErrorAt)
  const usoError = lectura.transitorio ? textoDeUsoPasajero(previo?.pasajero ? previo.fallos + 1 : 1, ahoraIso, lectura.error) : lectura.error.slice(0, 500)
  const usoErrorAt = antes.usoError && antes.usoErrorAt ? antes.usoErrorAt : ahoraIso
  return { usoError, usoErrorAt, nuevo: !usoErrorBloquea(antes.usoError) && usoErrorBloquea(usoError), cambia: true }
}

/** PURO. ¿Se pueden usar las reglas de presupuesto (R1–R4)? Sí sin error de uso (o con uno pasajero que aún no cuenta), o con un error de menos de 12 h (mientras, «agotada» sale del estado) */
export function usoDisponible(usoError: string | null, usoErrorAt: string | null, ahora: number): boolean {
  if (!usoErrorBloquea(usoError)) return true
  const t = usoErrorAt ? Date.parse(usoErrorAt) : NaN
  if (!Number.isFinite(t)) return false
  return ahora - t < AGENTE.USO_ERROR_SIN_REGLAS_HORAS * HORA_MS
}

/** PURO. ¿Está activa la fila (ENABLED o sin estado conocido)? */
const activa = (d: DiaDeUso) => (d.estadoCampana ?? 'ENABLED').toUpperCase() === 'ENABLED'

/** PURO. Σ presupuesto de las activas de una fecha (null si no hay ninguna); `primera` = el presupuesto de la primera lectura de ese día */
export function sumaDePresupuestos(dias: readonly DiaDeUso[], fecha: string, primera = false): number | null {
  const filas = dias.filter((d) => d.fechaLocal === fecha && activa(d))
  const vals = filas.map((d) => (primera ? (d.presupuestoPrimera ?? d.presupuesto) : d.presupuesto)).filter((x): x is number => x != null && x > 0)
  return vals.length ? redondear2(vals.reduce((s, x) => s + x, 0)) : null
}

/** PURO. De los 3 últimos días CERRADOS (fecha−1 … fecha−3): cuántos se agotó la campaña (uso máx ≥ 95 % del presupuesto de ese día, o por estado) y cuántos antes de las 18:00 (por la API) */
export function agotadaEnDias3(dias: readonly DiaDeUso[], campaignId: string, fechaLocal: string): { agotadaDias3: number; agotadaAntes18Dias3: number } {
  const fechas = new Set([desplazar(fechaLocal, -1), desplazar(fechaLocal, -2), desplazar(fechaLocal, -3)])
  let agotadaDias3 = 0
  let agotadaAntes18Dias3 = 0
  for (const d of dias) {
    if (d.campaignId !== campaignId || !fechas.has(d.fechaLocal)) continue
    const porApi = d.usoMaxPct != null && d.usoMaxPct >= AGENTE.USO_AGOTADO_PCT
    if (porApi || d.agotadaPorEstado) agotadaDias3++
    if (porApi && d.agotadaMin != null && d.agotadaMin < AGENTE.MINUTO_AGOTADO_TEMPRANO) agotadaAntes18Dias3++
  }
  return { agotadaDias3, agotadaAntes18Dias3 }
}

/**
 * Caduca las pausas por stock (de campaña, o de anuncio) de un ASIN que siguen PENDIENTES cuando su stock vuelve. Las que vienen de un reintento por transporte
 * (la pausa puede estar ya hecha en Amazon) no se tocan: decidirPropuesta las caduca y decisionDeReintento las retiene para una persona. Nunca lanza.
 */
async function caducarPausasDeStockPendientes(perfilId: string, asin: string, stock: number): Promise<number> {
  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from('ads_propuestas')
      .select('id, tipo, objetivo_tipo, error')
      .eq('perfil_id', perfilId)
      .eq('estado', 'pendiente')
      .eq('origen', 'agente')
      .eq('asin', asin)
      .in('tipo', ['pausar-campana', 'pausar'])
      .limit(200)
    if (error) throw new Error(error.message)
    const ids = ((data ?? []) as Array<{ id: string; tipo: string; objetivo_tipo: string | null; error: string | null }>)
      .filter((f) => (f.tipo === 'pausar-campana' || f.objetivo_tipo === 'anuncio') && !esReintentoDeTransporte(f.error))
      .map((f) => f.id)
    if (ids.length === 0) return 0
    const { data: hechas, error: e } = await service
      .from('ads_propuestas')
      .update({ estado: 'caducada', resuelta_at: new Date().toISOString(), error: `Caducada por el agente: ${asin} vuelve a tener stock (${stock}); ya no hay que pausar.`.slice(0, 500) })
      .eq('perfil_id', perfilId)
      .eq('estado', 'pendiente')
      .in('id', ids)
      .select('id')
    if (e) throw new Error(e.message)
    return hechas?.length ?? 0
  } catch (err) {
    console.error(`[agente] caducar las pausas por stock pendientes de ${asin} (${perfilId}):`, err instanceof Error ? err.message : err)
    return 0
  }
}

/** PURO. Una propuesta de ritmo → la fila que inserta el orquestador (la regla y la clase van en las métricas: el orden de aplicar las usa) */
export function filaDeRitmo(p: PropuestaDeRitmo): FilaDePropuestaDelAgente {
  return {
    tipo: 'presupuesto',
    asin: p.asin || null,
    campaignId: p.campaignId,
    campaignNombre: p.nombre,
    motivo: p.motivo,
    metricas: { ...p.metricas, regla: p.regla, clase: p.clase, origenAgente: 'ritmo' },
    valorActual: p.presupuestoActual,
    valorNuevo: p.presupuestoNuevo,
  }
}

/* =============================================================================================================================================================
 * Lecturas de la base para vigilar y el freno
 * ============================================================================================================================================================= */

/** Fecha local de un instante ISO */
const fechaLocalDe = (iso: string | null, zona: string): string | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? horaLocal(t, zona).fecha : null
}

/** Los errores de Amazon del agente que CUENTAN para el freno (autorización y multi-status que no son de validación), con los aciertos para cortar las rachas. Últimas 48 h */
async function erroresDelAgente(perfilId: string, ahora: number): Promise<Array<{ at: string; ok: boolean }>> {
  const service = createServiceClient()
  const desde = new Date(ahora - 48 * HORA_MS).toISOString()
  const pedir = (columnas: string, origen: string, conMarca: boolean) => {
    let q = service.from('ads_cambios_log').select(columnas).eq('perfil_id', perfilId).eq('origen', origen).gte('creado_at', desde)
    if (conMarca) q = q.like('motivo', '[AGENTE]%')
    return q.order('creado_at', { ascending: false }).limit(300)
  }
  const leer = async (origen: string, conMarca: boolean) => {
    let r = await pedir('creado_at, ok, http_status, error', origen, conMarca)
    if (r.error) r = await pedir('creado_at, ok, error', origen, conMarca)
    if (r.error) return [] as Array<Record<string, unknown>>
    return (r.data ?? []) as unknown as Array<Record<string, unknown>>
  }
  // Con la 315 el origen es «agente»; si el CHECK aún no lo admitía, el log se apuntó como «automatico» con «[AGENTE]» delante del motivo
  const filas = [...(await leer('agente', false)), ...(await leer('automatico', true))]
  const salida: Array<{ at: string; ok: boolean }> = []
  for (const f of filas) {
    const at = String(f.creado_at ?? '')
    if (f.ok === true) {
      salida.push({ at, ok: true })
      continue
    }
    const tipo = clasificarErrorDeAmazon(numero(f.http_status), null, (f.error as string | null) ?? null)
    if (tipo === 'autorizacion') salida.push({ at, ok: false })
  }
  return salida
}

/** Frescura de los datos: horas desde el último rendimiento y los últimos términos, y retraso de `ads_objetivos_diario` sobre el día cerrado esperado (ayer UTC) */
export async function frescura(perfilId: string, ahora: number): Promise<{ horasDesdeRendimiento: number | null; horasDesdeTerminos: number | null; horasRetrasoObjetivosDiario: number | null }> {
  const service = createServiceClient()
  const [s, t, o] = await Promise.all([
    service.from('ads_sincronizacion').select('ultimo_ok_at').eq('perfil_id', perfilId).maybeSingle(),
    service.from('ads_terminos_sync').select('ultimo_ok_at').eq('perfil_id', perfilId).maybeSingle(),
    service.from('ads_objetivos_diario').select('fecha').eq('perfil_id', perfilId).order('fecha', { ascending: false }).limit(1),
  ])
  const horas = (iso: unknown) => {
    const ms = typeof iso === 'string' ? Date.parse(iso) : NaN
    return Number.isFinite(ms) ? Math.round(((ahora - ms) / HORA_MS) * 10) / 10 : null
  }
  const ultimaFecha = ((o.data ?? []) as Array<{ fecha: string }>)[0]?.fecha ?? null
  const esperado = desplazar(new Date(ahora).toISOString().slice(0, 10), -1)
  return {
    horasDesdeRendimiento: s.error ? null : horas((s.data as { ultimo_ok_at?: string } | null)?.ultimo_ok_at),
    horasDesdeTerminos: t.error ? null : horas((t.data as { ultimo_ok_at?: string } | null)?.ultimo_ok_at),
    horasRetrasoObjetivosDiario: o.error || !ultimaFecha ? null : Math.max(0, diasEntre(String(ultimaFecha).slice(0, 10), esperado) * 24),
  }
}

/** Todo lo que pide `evaluarFrenos`, a partir de lo ya leído (solo base de datos) */
async function evaluarFrenoDeCuenta(
  l: LecturaDeCuenta,
  config: ConfigDelAgente,
  ahora: number,
  diasHoy: readonly DiaDeUso[],
  usoAnterior: readonly DiaDeUso[],
  horas: readonly HoraDeCuenta[],
  stock: Map<string, { stock: number | null; actualizadoAt: string | null; fuente: string }>,
  anunciados: ReadonlySet<string>,
  uso: { error: string | null; errorAt: string | null },
): Promise<{
  freno: { motivo: MotivoDeFreno; detalle: string } | null
  frenos: Array<{ motivo: MotivoDeFreno; detalle: string }>
  gastoHoy: number
  maximoPosible: number
  proyeccionHoy: number
  media7: number
}> {
  const { local, rendimiento, hasta, perfil, ventas } = l
  const fecha = local.fecha
  const minutoLocal = local.hora * 60 + local.minutos
  const todos = [...usoAnterior, ...diasHoy]

  const gastoHoy = gastoDeHoy(diasHoy, fecha)
  const maximoPosible = gastoMaximoPosible(diasHoy, fecha)
  const curva = curvaHoraria(horas.filter((h) => h.fechaLocal < fecha && h.fechaLocal >= desplazar(fecha, -AGENTE.CURVA_DIAS)))
  const proyeccionHoy = proyectarHoy(gastoHoy, local.hora, local.minutos, curva)
  const manuales = config.eventosManuales
  const hoyEnEvento = l.evento?.fase === 'durante' || l.evento?.fase === 'previo'
  const { media7 } = gastoDelMes(rendimiento, todos, fecha, (d) => eventoEn(d, perfil.pais, manuales)?.fase === 'durante', hoyEnEvento)

  const c7 = sumarDias(rendimiento, desplazar(hasta, -6), hasta)
  const sumaHoy = sumaDePresupuestos(diasHoy, fecha) ?? 0
  const suma7 = sumaDePresupuestos(todos, desplazar(fecha, -7), true) ?? config.sumaPresupuestosInicio

  // Stock: la lectura más vieja de los productos anunciados (null si no hay ninguno con dato)
  let horasDesdeStock: number | null = null
  for (const asin of Array.from(anunciados)) {
    const at = stock.get(asin)?.actualizadoAt
    const ms = at ? Date.parse(at) : NaN
    if (!Number.isFinite(ms)) continue
    const h = (ahora - ms) / HORA_MS
    if (horasDesdeStock == null || h > horasDesdeStock) horasDesdeStock = Math.round(h * 10) / 10
  }

  const [errores, fresca] = await Promise.all([erroresDelAgente(config.perfilId, ahora), frescura(config.perfilId, ahora)])
  // Las ventas de Amazon (ads_ventas_asin) solo valen si son recientes
  const ventasFrescas = l.ventas.leidoAt != null && ahora - Date.parse(l.ventas.leidoAt) < 48 * HORA_MS
  const vf = ventasParaFreno(ventasFrescas ? sumaDeVentas(ventas.v7) : null, ventasFrescas ? sumaDeVentas(ventas.v30) : null)
  // El gasto de los 3 últimos días CERRADOS de verdad (no 3/7 del de la semana: así casi siempre igualaba la media de 7 y la condición no filtraba nada)
  const gasto3 = redondear2(sumarDias(rendimiento, desplazar(hasta, -2), hasta).gasto)

  const frenos = evaluarFrenos({
    minutoLocal,
    gastoHoy,
    proyeccionHoy,
    maximoPosible,
    media7,
    sumaPresupuestosHoy: sumaHoy,
    suma7,
    evento: l.evento?.fase ?? null,
    gasto7Cerrado: c7.gasto,
    ventas7Cerrado: c7.ventas,
    acosObjetivoMedio: l.acosObjetivoMedio,
    cpaObjetivoMedio: l.cpaObjetivoMedio,
    acos7Inicio: config.acos7Inicio,
    diasActivo: config.estado !== 'ensayo' && config.activoDesde && Number.isFinite(Date.parse(config.activoDesde)) ? (ahora - Date.parse(config.activoDesde)) / (24 * HORA_MS) : null,
    erroresQueCuentan: errores,
    ahora,
    horasDesdeRendimiento: fresca.horasDesdeRendimiento,
    horasDesdeTerminos: fresca.horasDesdeTerminos,
    horasRetrasoObjetivosDiario: fresca.horasRetrasoObjetivosDiario,
    horasDesdeStock,
    ventasDiaRecientes: vf.ventasDiaRecientes,
    ventasDiaAnteriores: vf.ventasDiaAnteriores,
    gasto3,
    ignorar: config.ignorarFreno,
  })
  return { freno: frenos[0] ?? null, frenos, gastoHoy, maximoPosible, proyeccionHoy, media7 }
}

/**
 * PURO. ¿Bloquea esta propuesta de presupuesto la campaña (cuarentena de presupuestos)? No: las caducadas; las OBSOLETAS del agente (no se escribió nada en
 * Amazon: el valor ya no era el esperado, y bloquearla 72 h dejaba sin subida a la campaña que más vende); y una SUBIDA pendiente creada antes del inicio del día
 * local (una R1 «se agota hoy» de otro día: aplicar la caduca, y sin esto una retenida la bloqueaba para siempre).
 */
export function propuestaBloqueaPresupuesto(
  f: { estado: string; origen?: string | null; creadaAt?: string | null; valorActual: number | null; valorNuevo: number | null },
  inicioDelDiaMs: number | null,
): boolean {
  if (f.estado === 'caducada') return false
  if (f.estado === 'obsoleta' && f.origen === 'agente') return false
  const sube = f.valorActual != null && f.valorNuevo != null && Number.isFinite(f.valorActual) && Number.isFinite(f.valorNuevo) && f.valorNuevo > f.valorActual
  if (f.estado === 'pendiente' && sube && inicioDelDiaMs != null) {
    const t = f.creadaAt ? Date.parse(f.creadaAt) : NaN
    if (Number.isFinite(t) && t < inicioDelDiaMs) return false
  }
  return true
}

/**
 * Las campañas con una propuesta de presupuesto pendiente o resuelta/ENSAYADA en la cuarentena, o con un cambio de presupuesto A MANO en el log, o con un efecto abierto de presupuesto.
 * `soloSubidaPendiente`: las bloqueadas ÚNICAMENTE por una subida pendiente (retenida o esperando): no frenan una bajada (recorte, R4, donante).
 * `comprometido`: lo que suben las subidas de presupuesto PENDIENTES de hoy (aún no están en la suma de hoy): las R1 nuevas de esta pasada no pueden usar ese hueco.
 */
async function campanasConPresupuestoBloqueado(
  perfilId: string,
  horasEntreSubidas: number,
  ahora: number,
  inicioDelDiaMs: number | null,
): Promise<{ bloqueadas: Set<string>; soloSubidaPendiente: Set<string>; comprometido: number }> {
  const service = createServiceClient()
  const desde = new Date(ahora - Math.max(1, horasEntreSubidas) * HORA_MS).toISOString()
  const bloqueadas = new Set<string>()
  const subidasPendientes = new Set<string>()
  const porOtraCosa = new Set<string>()
  let comprometido = 0
  type Fila = { campaign_id: string; estado: string; valor_actual: unknown; valor_nuevo: unknown; creada_at?: string | null; origen?: string | null }
  const r = await todasLasFilas<Fila>((a, b) =>
    service
      .from('ads_propuestas')
      .select('campaign_id, estado, valor_actual, valor_nuevo, creada_at, origen')
      .eq('perfil_id', perfilId)
      .eq('tipo', 'presupuesto')
      .or(`estado.eq.pendiente,resuelta_at.gte.${desde}`)
      .order('id')
      .range(a, b) as unknown as PromiseLike<{ data: Fila[] | null; error: { code?: string; message?: string } | null }>,
  10_000)
  if (r.error) lanzar(r.error)
  for (const f of r.data) {
    const antes = numero(f.valor_actual)
    const despues = numero(f.valor_nuevo)
    if (!propuestaBloqueaPresupuesto({ estado: f.estado, origen: f.origen ?? null, creadaAt: f.creada_at ?? null, valorActual: antes, valorNuevo: despues }, inicioDelDiaMs)) continue
    const id = String(f.campaign_id)
    bloqueadas.add(id)
    if (f.estado === 'pendiente' && antes != null && despues != null && despues > antes) {
      subidasPendientes.add(id)
      comprometido += despues - antes
    } else porOtraCosa.add(id)
  }

  const { data: log } = await service
    .from('ads_cambios_log')
    .select('campaign_id, motivo')
    .eq('perfil_id', perfilId)
    .eq('origen', 'manual')
    .eq('ok', true)
    .ilike('campo', 'presupuesto%')
    .gte('creado_at', desde)
    .limit(2000)
  for (const f of (log ?? []) as Array<{ campaign_id: string | null; motivo: string | null }>) {
    if (f.campaign_id && !/^\[ENSAYO\]/.test(f.motivo ?? '')) {
      bloqueadas.add(f.campaign_id)
      porOtraCosa.add(f.campaign_id)
    }
  }

  const { data: efectos, error: eEf } = await service.from('ads_efectos').select('campaign_id, clase').eq('perfil_id', perfilId).is('revisado_7d_at', null).in('clase', ['presupuesto_subir', 'presupuesto_bajar', 'pausar_campana']).limit(5000)
  if (eEf) lanzar(eEf)
  for (const f of (efectos ?? []) as Array<{ campaign_id: string | null }>) {
    if (f.campaign_id) {
      bloqueadas.add(f.campaign_id)
      porOtraCosa.add(f.campaign_id)
    }
  }
  return { bloqueadas, soloSubidaPendiente: new Set([...subidasPendientes].filter((id) => !porOtraCosa.has(id))), comprometido: redondear2(comprometido) }
}

/** Los anuncios ACTIVOS de unas campañas (POST /sp/productAds/list): campaignId → [{adId, asin}]. Lectura */
async function anunciosDeCampanas(cuenta: CuentaParaSincronizar, ids: readonly string[]): Promise<Map<string, Array<{ adId: string; asin: string }>>> {
  const salida = new Map<string, Array<{ adId: string; asin: string }>>()
  for (let i = 0; i < ids.length; i += 100) {
    let token: string | undefined
    for (let pagina = 0; pagina < 10; pagina++) {
      const res = await llamarAds<{ productAds?: Array<Record<string, unknown>>; nextToken?: string }>(cuenta.conexionId, '/sp/productAds/list', {
        perfilId: cuenta.profileId,
        metodo: 'POST',
        cabeceras: { Accept: TIPO_ANUNCIO, 'Content-Type': TIPO_ANUNCIO },
        cuerpo: { campaignIdFilter: { include: ids.slice(i, i + 100) }, stateFilter: { include: ['ENABLED'] }, maxResults: 1000, ...(token ? { nextToken: token } : {}) },
      })
      for (const a of res.productAds ?? []) {
        const c = a.campaignId != null ? String(a.campaignId) : ''
        const adId = a.adId != null ? String(a.adId) : ''
        const asin = String(a.asin ?? '').toUpperCase()
        if (!c || !adId) continue
        const lista = salida.get(c) ?? []
        lista.push({ adId, asin })
        salida.set(c, lista)
      }
      token = res.nextToken
      if (!token) break
    }
  }
  return salida
}

/** Cambios de estado A MANO (log) de una campaña o anuncio desde un instante */
async function cambiosAManoDeEstado(perfilId: string, campaignId: string, entidadId: string | null, desde: string): Promise<number> {
  const service = createServiceClient()
  let q = service.from('ads_cambios_log').select('id, motivo').eq('perfil_id', perfilId).eq('origen', 'manual').eq('ok', true).gte('creado_at', desde).limit(200)
  q = entidadId ? q.eq('entidad_id', entidadId) : q.eq('campaign_id', campaignId).in('accion', ['pausar', 'activar', 'cambiar'])
  const { data, error } = await q
  if (error) {
    // Sin la 311 no hay entidad_id: se mira la campaña
    if (entidadId) return cambiosAManoDeEstado(perfilId, campaignId, null, desde)
    return 0
  }
  return ((data ?? []) as Array<{ motivo: string | null }>).filter((f) => !/^\[ENSAYO\]/.test(f.motivo ?? '')).length
}

/* =============================================================================================================================================================
 * vigilarCuenta
 * ============================================================================================================================================================= */

export async function vigilarCuenta(cuenta: CuentaParaSincronizar, config: ConfigDelAgente, ahora: number): Promise<ResultadoDeVigilar> {
  const service = createServiceClient()
  const l = await leerCuenta(cuenta.id, config, ahora, 45)
  const { perfil, local, rendimiento, hasta, productos, ventas, ficha } = l
  const fecha = local.fecha
  const minutoLocal = local.hora * 60 + local.minutos
  const frenado = config.estado === 'frenado'
  const manuales = config.eventosManuales
  const ahoraIso = new Date(ahora).toISOString()
  const eventos: ResultadoDeVigilar['eventos'] = []
  const cambiosEnFila: Record<string, unknown> = {}

  // ---------- (b) campañas y uso de presupuesto ----------
  let campanas: Campana[] = []
  try {
    campanas = (await campanasDe(cuenta.conexionId, cuenta.profileId)).campanas
  } catch (err) {
    // No es un fallo de la API de USO (antes se apuntaba como uso_error y bloqueaba las subidas 6 h por un 429 al listar): el vigilar falla, aplicar no escribe
    // hasta el siguiente vigilar bueno y el reintento llega en minutos (camposDeVigilarFallido)
    throw new Error(`No he podido leer las campañas en Amazon: ${err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)}`)
  }
  const previasHoy = await filasDeUso(cuenta.id, fecha, fecha)
  const saltar = saltarApiDeUso(config.usoError, config.usoErrorAt, ahora)
  let diasHoy: DiaDeUso[] = previasHoy
  let errorDeUso: string | null = null
  let errorPasajero = false
  // Campañas con una regla de presupuesto de Amazon activa hoy: id → presupuesto efectivo (se apunta en las métricas de sus propuestas de presupuesto)
  let conRegla = new Map<string, number>()
  if (campanas.length > 0) {
    const r = await leerUsoDePresupuesto(
      cuenta,
      campanas.map((c) => ({ campaignId: c.campaignId, presupuesto: c.presupuesto, servicio: c.servicio, estado: c.estado })),
      perfil.zona,
      ahora,
      // Tras un error, mientras dura el retroceso, solo un lote de prueba: si va bien, el error se borra ya
      { soloPrueba: saltar },
    )
    diasHoy = r.dias
    errorDeUso = r.error
    errorPasajero = r.transitorio
    conRegla = r.conRegla
  }

  // Estado del error de uso (siguienteUsoError): si se ha llamado y ha ido bien, se borra; si ha fallado, se apunta. Uno pasajero solo cuenta tras varios seguidos
  const sig = siguienteUsoError({ usoError: config.usoError, usoErrorAt: config.usoErrorAt }, { error: errorDeUso, transitorio: errorPasajero, seLlamo: campanas.length > 0 }, ahoraIso)
  const usoError: string | null = sig.usoError
  const usoErrorAt: string | null = sig.usoErrorAt
  const usoErrorNuevo = sig.nuevo
  if (sig.cambia) {
    cambiosEnFila.uso_error = usoError
    cambiosEnFila.uso_error_at = usoErrorAt
  }
  if (usoErrorNuevo && errorDeUso) eventos.push({ tipo: 'uso_error', titulo: 'No puedo leer el uso de presupuesto de hoy', detalle: errorDeUso.slice(0, 500) })
  // «No sé cuánto se gasta hoy»: un error persistente, o uno pasajero repetido
  const gastoDesconocido = usoErrorBloquea(usoError)
  const reglasConUso = usoDisponible(usoError, usoErrorAt, ahora)

  // ---------- lecturas comunes ----------
  const [usoAnterior, horas, stock, { umbrales }] = await Promise.all([
    filasDeUso(cuenta.id, desplazar(fecha, -AGENTE.DIAS_USO_SE_CONSERVAN), desplazar(fecha, -1)),
    horasDeCuenta(cuenta.id, desplazar(fecha, -(AGENTE.CURVA_DIAS + 1)), desplazar(fecha, -1)),
    stockPorAsin(cuenta.id),
    leerUmbrales(cuenta.id),
  ])
  const todosLosDias = [...usoAnterior, ...diasHoy]
  const diaHoyDe = new Map(diasHoy.map((d) => [d.campaignId, d]))
  const previaDe = new Map(previasHoy.map((d) => [d.campaignId, d]))
  const productoDe = new Map(productos.map((p) => [p.asin, p]))
  const activas = campanas.filter((c) => c.estado === 'ENABLED')
  const anunciados = new Set(activas.map((c) => asinDeCampana(c.nombre)).filter((a): a is string => Boolean(a)))

  const esDiaDeEvento = (d: string) => eventoEn(d, perfil.pais, manuales)?.fase === 'durante'
  const hoyEnEvento = l.evento?.fase === 'durante' || l.evento?.fase === 'previo'

  // Rampa y topes de hoy (para saber si la cuenta puede subir presupuestos)
  const rampaLocal = config.rampaDesde ? horaLocal(Date.parse(config.rampaDesde), perfil.zona).fecha : null
  const hoyTopes = topesDelDia(config.topes ?? TOPES_DE_PARTIDA, {
    enEnsayo: config.estado === 'ensayo',
    diaRampa: config.estado === 'activo' ? diaDeRampa(rampaLocal, fecha) : null,
    cuentaPequena: l.cuentaPequena,
    erroresRecientes: false,
  })

  // ---------- las campañas para las reglas de ritmo ----------
  const portfolioIds = new Set(activas.map((c) => (c.crudo?.portfolioId != null ? String(c.crudo.portfolioId) : '')).filter(Boolean))
  let portfolios = new Map<string, { topado: boolean; porque: string | null }>()
  if (portfolioIds.size > 0 && !frenado) {
    try {
      portfolios = await leerPortfolios(cuenta)
    } catch (err) {
      console.error(`[agente] portfolios de ${cuenta.id}:`, err)
    }
  }
  const inicioDelDiaMs = Date.parse(inicioDelDiaLocal(fecha, perfil.zona))
  const { bloqueadas, soloSubidaPendiente, comprometido: subidasPendientesHoy } = frenado
    ? { bloqueadas: new Set<string>(), soloSubidaPendiente: new Set<string>(), comprometido: 0 }
    : await campanasConPresupuestoBloqueado(cuenta.id, ficha.horasEntreSubidas, ahora, Number.isFinite(inicioDelDiaMs) ? inicioDelDiaMs : null)
  // Campañas cuya subida de presupuesto empeoró o se deshizo sola hace poco: R1 no la repite (sin esto, subir → deshacer → subir)
  const subidaVetada = frenado ? new Set<string>() : (await subidasVetadasDeCuenta(cuenta.id, fecha)).campanas
  const ritmoEsDeEsteMes = Boolean(config.ritmoFecha && config.ritmoFecha.slice(0, 7) === local.mes)
  const ritmoDeEsteMes = ritmoEsDeEsteMes ? config.ritmo : 'normal'
  const enRecorteDelMesAnterior = config.ritmoMesAnterior === 'recorte' && local.dia <= AGENTE.DIAS_TRAS_RECORTE
  // Fecha local del último cambio de ritmo (cambia en CADA transición: el día 1 del mes, al salir del recorte, ya es otra)
  const inicioDelRecorte = fechaLocalDe(config.ritmoCambiadoAt, perfil.zona)
  // El día en que ENTRÓ en recorte, guardado aparte (`recorte_desde`): no se pisa al salir. Sin él (filas de antes), el último cambio de ritmo si sigue en recorte
  const recorteDesde = config.recorteDesde ?? (config.ritmo === 'recorte' ? inicioDelRecorte : null)
  // Sin saber el gasto de hoy no se generan subidas que aplicar caducaría (A2)
  const sinSubidasCuenta = ritmoDeEsteMes === 'recorte' || hoyTopes.soloBajadas || l.techoMes == null || l.evento?.fase === 'posterior' || gastoDesconocido

  const desde7 = desplazar(hasta, -6)
  const desde14 = desplazar(hasta, -13)
  const fueraDeEvento = !(l.evento?.fase === 'durante')
  const campanasRitmo: CampanaParaRitmo[] = []
  const metricasDe = new Map<string, { ventas7: number; gasto7: number }>()
  for (const c of activas) {
    const asin = asinDeCampana(c.nombre)
    const deEsta = (f: DiaDeCampana) => f.campaignId === c.campaignId
    const w7 = sumarDias(rendimiento, desde7, hasta, deEsta)
    metricasDe.set(c.campaignId, { ventas7: w7.ventas, gasto7: w7.gasto })
    if (!partesDeNombre(c.nombre) || !asin) continue
    const p = productoDe.get(asin)
    if (!p || !p.activo || p.acosObjetivoPct == null) continue
    const hoy = diaHoyDe.get(c.campaignId)
    // El presupuesto BASE recién leído de /sp/campaigns/list (el que el motor relee al aplicar); la fila de hoy, solo si falta. Con el de la API de uso (con las
    // reglas de presupuesto de Amazon aplicadas) R1 calcularía sobre otro valor y el motor marcaría la subida obsoleta
    const presupuesto = c.presupuesto ?? hoy?.presupuesto ?? 0
    if (!(presupuesto > 0)) continue
    const w14 = sumarDias(rendimiento, desde14, hasta, deEsta)
    // La media de 14 días sin los días de un evento (si ya no estamos en él)
    const w14Media = fueraDeEvento ? sumarDias(rendimiento, desde14, hasta, (f) => deEsta(f) && !esDiaDeEvento(f.fecha)) : w14
    const esMarca = campanaEsDeMarca(c.nombre, p.marca)
    const postura = ritmoDeEsteMes === 'recorte' && p.postura === 'crecer' ? 'mantener' : p.postura
    const comb = combinarAjustes(umbrales, {
      postura,
      presion: null,
      objetivoBase: p.acosObjetivoPct,
      equilibrioPct: p.equilibrioPct,
      soloDefensivo: p.soloDefensivo,
      esMarca,
      cuentaPequena: l.cuentaPequena,
      sinSubidasCuenta,
    })
    const pid = c.crudo?.portfolioId != null ? String(c.crudo.portfolioId) : null
    // Tras un recorte, R1 no sube por encima del presupuesto que tenía la campaña al ENTRAR en él: el congelado ese día; si no está, la última lectura de antes de ese día
    let presupuestoAntesDelRecorte: number | null = null
    if (enRecorteDelMesAnterior) {
      const congelado = config.recortePresupuestos[c.campaignId]
      if (congelado != null && congelado > 0) presupuestoAntesDelRecorte = congelado
      else if (recorteDesde) {
        const antes = usoAnterior.filter((d) => d.campaignId === c.campaignId && d.fechaLocal < recorteDesde).sort((a, b) => (a.fechaLocal < b.fechaLocal ? 1 : -1))[0]
        presupuestoAntesDelRecorte = antes ? (antes.presupuestoPrimera ?? antes.presupuesto) : null
      }
    }
    campanasRitmo.push({
      campaignId: c.campaignId,
      nombre: c.nombre,
      asin,
      presupuesto,
      agotadaHoyMin: hoy?.agotadaMin ?? null,
      agotadaHoyPorEstado: hoy?.agotadaPorEstado ?? false,
      ...agotadaEnDias3(usoAnterior, c.campaignId, fecha),
      gasto7: w7.gasto,
      ventas7: w7.ventas,
      pedidos7: w7.pedidos,
      clics7: w7.clics,
      diasConDatos7: w7.dias,
      gasto14: w14.gasto,
      ventas14: w14.ventas,
      pedidos14: w14.pedidos,
      clics14: w14.clics,
      mediaGasto14: w14Media.dias > 0 ? redondear2(w14Media.gasto / w14Media.dias) : 0,
      maxGasto14: w14Media.maxGastoDia,
      diasConDatos14: w14Media.dias,
      acosParaSubir: comb.acosParaSubir,
      acosParaBajar: comb.acosParaBajar,
      muestraMinima: ficha.muestraMinimaClics,
      tieneEquilibrio: p.equilibrioPct != null && p.equilibrioPct > 0,
      postura,
      soloDefensivo: p.soloDefensivo,
      esMarca,
      fase: p.fase,
      bloqueadaPresupuesto: bloqueadas.has(c.campaignId),
      soloSubidaPendiente: soloSubidaPendiente.has(c.campaignId),
      subidaVetada: subidaVetada.has(c.campaignId),
      portfolioTopado: pid ? (portfolios.get(pid)?.topado ?? false) : false,
      presupuestoAntesDelRecorte,
      // El mismo máximo con el que la campaña cuenta en la suma útil (sumaUtil, abajo): 14 días con eventos, null sin 14 días de datos
      maxGasto14Util: w14.dias >= 14 ? w14.maxGastoDia : null,
    })
  }

  // ---------- (c) presión del día y ritmo del mes: una vez al día, tras las 03:00 locales ----------
  const gm = gastoDelMes(rendimiento, todosLosDias, fecha, esDiaDeEvento, hoyEnEvento)
  const toca = !frenado && local.hora >= AGENTE.HORA_PRESION_LOCAL && config.presionFecha !== fecha
  let mes: EstadoDelMes
  let presionNueva: Record<string, Presion> | null = null
  let presionBajarPorRecorte: string[] = []
  const propuestasRitmo: PropuestaDeRitmo[] = []
  if (toca) {
    const ventasTotales30 = sumaDeVentas(ventas.v30)
    const tendencia = tendenciaSemanal(sumaDeVentas(ventas.v7), sumaDeVentas(ventas.v14))
    mes = ritmoDelMes({
      gastoMesHastaAyer: gm.gastoMesHastaAyer,
      techoMes: l.techoMes,
      dia: local.dia,
      diasDelMes: local.diasDelMes,
      media7: gm.media7,
      ritmoAnterior: config.ritmo,
      ritmoAnteriorEsDeEsteMes: ritmoEsDeEsteMes,
      diasDesdeCambio: inicioDelRecorte ? diasEntre(inicioDelRecorte, fecha) : null,
      acos30Cuenta: acosDe(l.cuenta30.gasto, l.cuenta30.ventas),
      acosObjetivoMedio: l.acosObjetivoMedio,
      tacos30: ventasTotales30 != null && ventasTotales30 > 0 ? redondear2((l.cuenta30.gasto / ventasTotales30) * 100) : null,
      tacosObjetivoPct: ficha.tacosObjetivoPct,
      ventasTotalesCrecen: tendencia == null ? null : tendencia >= 0,
      evento: l.evento?.fase ?? null,
    })
    const presion = presionDelDia(campanasRitmo, { ritmo: mes.ritmo })
    const desdeRecorte = recorteDesde ?? inicioDelRecorte
    const diasEnRecorte = mes.ritmo === 'recorte' && config.ritmo === 'recorte' && desdeRecorte ? diasEntre(desdeRecorte, fecha) : 0
    const rec = recortePorRitmo(campanasRitmo, mes, diasEnRecorte)
    presionBajarPorRecorte = rec.presionBajar
    presionNueva = { ...presion }
    for (const id of rec.presionBajar) presionNueva[id] = 'bajar'
    propuestasRitmo.push(...rec.propuestas)

    const cambiaRitmo = mes.ritmo !== config.ritmo
    const mesNuevo = Boolean(config.ritmoFecha && config.ritmoFecha.slice(0, 7) !== local.mes)
    // Al ENTRAR en recorte se guarda el día y el presupuesto de cada campaña activa (la primera lectura de hoy: aún sin el −20 %)
    const entraEnRecorte = mes.ritmo === 'recorte' && config.ritmo !== 'recorte'
    if (entraEnRecorte) {
      const congelados: Record<string, number> = {}
      for (const c of activas) {
        const h = diaHoyDe.get(c.campaignId)
        const pres = c.presupuesto ?? h?.presupuestoPrimera ?? h?.presupuesto ?? 0
        if (pres > 0) congelados[c.campaignId] = redondear2(pres)
      }
      Object.assign(cambiosEnFila, { recorte_desde: fecha, recorte_presupuestos: congelados })
    }
    Object.assign(cambiosEnFila, {
      presion: presionNueva,
      presion_fecha: fecha,
      ritmo: mes.ritmo,
      ritmo_fecha: fecha,
      ...(cambiaRitmo ? { ritmo_cambiado_at: ahoraIso } : {}),
      ...(mesNuevo ? { ritmo_mes_anterior: config.ritmo } : {}),
    })
    if (cambiaRitmo) eventos.push({ tipo: 'ritmo', titulo: `Ritmo del mes: ${config.ritmo} → ${mes.ritmo}`, detalle: mes.motivo, datos: { gastoMes: mes.gastoMes, techo: mes.techo, proyeccion: mes.proyeccion } })
  } else {
    mes = estadoDelMesGuardado({ gastoMesHastaAyer: gm.gastoMesHastaAyer, media7: gm.media7, techoMes: l.techoMes, dia: local.dia, diasDelMes: local.diasDelMes, ritmo: config.ritmo, ritmoEsDeEsteMes })
  }

  // ---------- (d) R1 (con financiación) y R4 ----------
  const propuestas: FilaDePropuestaDelAgente[] = []
  let avisos: ResultadoDeVigilar['avisos'] = []
  const r1De = new Map<string, PropuestaDeRitmo>()
  // Guarda técnica (no un freno): con el rendimiento o los términos sin sincronizar > 36 h, R1–R4 se decidirían con métricas viejas. No se proponen (el recorte del
  // mes sí: es una bajada por el gasto del mes). Lo anota aplicar, que tampoco escribe mientras dure
  const viejos = frenado || campanasRitmo.length === 0 ? null : datosViejos({ ...(await frescura(config.perfilId, ahora)), horasDesdeStock: null })
  // Sin hueco en el tope de subidas de presupuesto de HOY, una R1 no llegaría y sus donantes bajarían para nada: no se proponen (solo R1; R4 sigue)
  let sinTopeDeSubirHoy = false
  if (!frenado && campanasRitmo.length > 0) {
    try {
      sinTopeDeSubirHoy = !quedaTope('presupuesto_subir', await hechosDeHoy(cuenta.id, inicioDelDiaLocal(fecha, perfil.zona)), hoyTopes.topes)
    } catch (err) {
      // Falla cerrado: sin saber lo hecho hoy, esta pasada no propone R1
      sinTopeDeSubirHoy = true
      console.error(`[agente] lo hecho hoy de ${cuenta.id}:`, err instanceof Error ? err.message : err)
    }
  }
  if (!frenado && campanasRitmo.length > 0 && !viejos?.rendimientoOTerminos) {
    // Topes de la suma de presupuestos (topesDeSuma): útil (presupuesto o 1,3 × el máximo de 14 días) contra el techo; la real de hoy contra el techo (o la suma al encender) y contra la de hace 7 días
    let sumaUtil = 0
    for (const c of activas) {
      const pres = c.presupuesto ?? diaHoyDe.get(c.campaignId)?.presupuesto ?? 0
      if (!(pres > 0)) continue
      const w14 = sumarDias(rendimiento, desde14, hasta, (f) => f.campaignId === c.campaignId)
      sumaUtil += presupuestoUtil(pres, w14.dias >= 14 ? w14.maxGastoDia : null)
    }
    const sumaActual = sumaDePresupuestos(diasHoy, fecha) ?? activas.reduce((s, c) => s + (c.presupuesto ?? 0), 0)
    const suma7 = sumaDePresupuestos(todosLosDias, desplazar(fecha, -7), true) ?? config.sumaPresupuestosInicio
    const actualDe = new Map(campanasRitmo.map((c) => [c.campaignId, c.presupuesto]))
    // Lo que falta en cada suma (útil frente al techo; la real de hoy frente al techo o la suma al encender y a la de hace 7 días), con lo ya comprometido en esta pasada: los donantes liberan distinto en cada una
    // Lo que suben las R1 de hoy aún PENDIENTES (no están en la suma de hoy) se da por comprometido desde el principio: una R1 nueva no usa su hueco
    const huecoDeSuma = (campaignId: string, nuevo: number, comprometido: { suma: number; semana: number }) =>
      faltaEnSumas({
        actual: actualDe.get(campaignId) ?? 0,
        nuevo,
        sumaUtil: redondear2(sumaUtil + subidasPendientesHoy + comprometido.suma),
        sumaActual: redondear2(sumaActual + subidasPendientesHoy + comprometido.semana),
        techoMes: l.techoMes,
        suma7,
        sumaInicio: config.sumaPresupuestosInicio,
      })
    const res = reglasDePresupuesto(campanasRitmo, {
      ritmo: mes.ritmo,
      evento: l.evento?.fase ?? null,
      // Sin la API de uso no se sabe cuánto se gasta hoy: «agotada» solo sale del estado y no basta para subir (R4 sigue, las 12 h de usoDisponible)
      sinSubidas: hoyTopes.soloBajadas || gastoDesconocido,
      sinPresupuestoSubir: hoyTopes.sinPresupuestoSubir || sinTopeDeSubirHoy,
      techoNulo: l.techoMes == null,
      cuentaPequena: l.cuentaPequena,
      usoDisponible: reglasConUso,
      huecoDeSuma,
    })
    avisos = res.avisos
    const conPropuesta = new Set<string>()
    for (const p of res.propuestas) {
      const fila = filaDeRitmo(p)
      // Regla de presupuesto de Amazon activa hoy: la propuesta va sobre el presupuesto BASE; el efectivo queda a la vista
      const efectivo = conRegla.get(p.campaignId)
      if (efectivo != null) fila.metricas = { ...fila.metricas, reglaDePresupuesto: true, presupuestoEfectivo: efectivo }
      propuestas.push(fila)
      conPropuesta.add(p.campaignId)
      if (p.clase === 'presupuesto_subir') r1De.set(p.campaignId, p)
      if (p.regla === 'R1_financiada') eventos.push({ tipo: 'mover_presupuesto', titulo: `Muevo presupuesto a «${p.nombre}»`, detalle: p.motivo, datos: { campaignId: p.campaignId, de: p.presupuestoActual, a: p.presupuestoNuevo } })
    }
    // El recorte del mes (presupuesto −20 % al 3.er día) no se suma a otra propuesta de la misma campaña
    for (const p of propuestasRitmo) if (!conPropuesta.has(p.campaignId)) propuestas.push(filaDeRitmo(p))
  } else if (!frenado) {
    for (const p of propuestasRitmo) propuestas.push(filaDeRitmo(p))
  }

  // La campaña que más vende (7 d), si hoy se ha agotado según la API
  let agotadaTop: ResultadoDeVigilar['agotadaTop'] = null
  {
    const candidatas = activas.filter((c) => (metricasDe.get(c.campaignId)?.ventas7 ?? 0) > 0)
    candidatas.sort((a, b) => (metricasDe.get(b.campaignId)?.ventas7 ?? 0) - (metricasDe.get(a.campaignId)?.ventas7 ?? 0))
    const top = candidatas[0]
    const hoy = top ? diaHoyDe.get(top.campaignId) : undefined
    if (top && hoy && hoy.agotadaMin != null) {
      const m = metricasDe.get(top.campaignId)!
      const r1 = r1De.get(top.campaignId)
      agotadaTop = {
        campaignId: top.campaignId,
        nombre: top.nombre,
        minuto: hoy.agotadaMin,
        presupuesto: hoy.presupuesto ?? top.presupuesto ?? 0,
        acosPct: acosDe(m.gasto7, m.ventas7),
        nuevo: r1 ? r1.presupuestoNuevo : null,
        porque: r1 ? null : (avisos.find((a) => a.campaignId === top.campaignId)?.texto ?? (frenado ? 'El agente está frenado: no subo presupuestos.' : null)),
      }
    }
  }

  // ---------- (e) stock ----------
  const sinStock: ResultadoDeVigilar['sinStock'] = []
  const soloRecortarPorStock: ResultadoDeVigilar['soloRecortarPorStock'] = []
  const vuelveStock: ResultadoDeVigilar['vuelveStock'] = []
  const nombreDe = (asin: string) => productoDe.get(asin)?.nombre ?? asin
  {
    const { data: ceros, error: eCeros } = await service.from('ads_agente_stock_cero').select('asin, primera_at, ultima_at, lecturas, fuente').eq('perfil_id', cuenta.id)
    if (eCeros) lanzar(eCeros)
    const ceroDe = new Map(((ceros ?? []) as Array<{ asin: string; primera_at: string; lecturas: number }>).map((c) => [c.asin.toUpperCase(), c]))

    // Lo que ya está pausado (o a punto) por stock, para no proponerlo otra vez
    const { data: yaPausadas, error: eYa } = await service
      .from('ads_propuestas')
      .select('id, tipo, asin, campaign_id, objetivo_id, objetivo_tipo, estado, resuelta_at, origen, agente_at')
      .eq('perfil_id', cuenta.id)
      .in('tipo', ['pausar-campana', 'pausar'])
      .in('estado', ESTADOS_DE_PAUSA_HECHA)
      .limit(2000)
    if (eYa) lanzar(eYa)
    const pausasDeStock = ((yaPausadas ?? []) as Array<FilaDePausa & { id: string; asin: string | null; resuelta_at: string | null; origen: string | null }>).filter(
      (p) => p.tipo === 'pausar-campana' || p.objetivo_tipo === 'anuncio',
    )
    // En ensayo, una pausa ya ENSAYADA en este ensayo cuenta como hecha (la campaña sigue gastando de verdad, pero proponerla cada 30 min gastaría el tope diario
    // y llenaría el resumen de repetidas). En activo, una ensayada no cuenta: la pausa se propone y se aplica de verdad
    const yaHechas = pausasYaHechas(pausasDeStock, config.estado, config.encendidoAt, ahora)
    const campanaYaPausada = yaHechas.campanas
    const anuncioYaPausado = yaHechas.anuncios

    // Lecturas a 0 (dos seguidas, separadas ≥ 6 h) y limpieza de las que ya no están a 0
    const aCero: string[] = []
    for (const asin of Array.from(anunciados)) {
      const st = stock.get(asin)
      if (!st || st.stock == null) continue
      const previo = ceroDe.get(asin)
      if (st.stock === 0) {
        aCero.push(asin)
        if (previo) {
          const { error } = await service.from('ads_agente_stock_cero').update({ ultima_at: ahoraIso, lecturas: (Number(previo.lecturas) || 1) + 1, fuente: st.fuente }).eq('perfil_id', cuenta.id).eq('asin', asin)
          if (error) lanzar(error)
          ceroDe.set(asin, { ...previo, lecturas: (Number(previo.lecturas) || 1) + 1 })
        } else {
          const { error } = await service.from('ads_agente_stock_cero').insert({ perfil_id: cuenta.id, asin, primera_at: ahoraIso, ultima_at: ahoraIso, lecturas: 1, fuente: st.fuente })
          if (error && error.code !== '23505') lanzar(error)
          ceroDe.set(asin, { asin, primera_at: ahoraIso, lecturas: 1 })
        }
      } else if (previo) {
        const { error } = await service.from('ads_agente_stock_cero').delete().eq('perfil_id', cuenta.id).eq('asin', asin)
        if (error) lanzar(error)
        ceroDe.delete(asin)
        // El stock ha vuelto: las pausas por stock de este ASIN que siguen PENDIENTES ya no tienen sentido (aplicarlas pausaría una campaña con stock y el vigilar
        // siguiente la reactivaría). Se caducan. Nunca lanza: decidirPropuesta también las caduca al aplicar si ve el stock > 0
        await caducarPausasDeStockPendientes(cuenta.id, asin, st.stock)
      }
    }

    // Decisión por campaña de cada ASIN a 0
    if (aCero.length > 0) {
      const campanasACero = activas.filter((c) => {
        const a = asinDeCampana(c.nombre)
        return a != null && aCero.includes(a) && !campanaYaPausada.has(c.campaignId)
      })
      let anuncios: Map<string, Array<{ adId: string; asin: string }>> | null = null
      // Solo se piden los anuncios si alguna podría pausarse (antes se mira todo lo demás con un ASIN)
      const podria = campanasACero.some((c) => {
        const asin = asinDeCampana(c.nombre) as string
        const cero = ceroDe.get(asin)
        const gasta = (diaHoyDe.get(c.campaignId)?.gastoEstimado ?? 0) > (previaDe.get(c.campaignId)?.gastoEstimado ?? Number.POSITIVE_INFINITY) + 0.009
        return decisionDeStock({ stock: 0, ceroDesde: cero?.primera_at ?? null, lecturasCero: Number(cero?.lecturas) || 0, listingAt: stock.get(asin)?.actualizadoAt ?? null, ahora, campanaGastaHoy: gasta, asinsEnCampana: 1 }).decision !== 'solo_recortar'
      })
      if (podria) {
        try {
          anuncios = await anunciosDeCampanas(cuenta, campanasACero.map((c) => c.campaignId))
        } catch (err) {
          console.error(`[agente] anuncios de ${cuenta.id}:`, err)
          anuncios = null
        }
      }
      const porAsin = new Map<string, { campanas: number; anuncios: number }>()
      const recortarPor = new Map<string, string>()
      for (const c of campanasACero) {
        const asin = asinDeCampana(c.nombre) as string
        const st = stock.get(asin)!
        const cero = ceroDe.get(asin)
        const gasta = (diaHoyDe.get(c.campaignId)?.gastoEstimado ?? 0) > (previaDe.get(c.campaignId)?.gastoEstimado ?? Number.POSITIVE_INFINITY) + 0.009
        // Sin los anuncios leídos (falló la lectura o la campaña no está) no se pausa nada: el nombre no garantiza que tenga un solo producto
        const ads = anuncios?.get(c.campaignId) ?? null
        const d = decisionDeStockConAnuncios({ stock: 0, ceroDesde: cero?.primera_at ?? null, lecturasCero: Number(cero?.lecturas) || 0, listingAt: st.actualizadoAt, ahora, campanaGastaHoy: gasta }, ads)
        const metricas = { stock: 0, fuenteStock: st.fuente, lecturasCero: Number(cero?.lecturas) || 0, ceroDesde: cero?.primera_at ?? null, origenAgente: 'stock' }
        if (d.decision === 'pausar_campana') {
          propuestas.push({ tipo: 'pausar-campana', asin, campaignId: c.campaignId, campaignNombre: c.nombre, motivo: `Sin stock de ${nombreDe(asin)} (${asin}): ${d.porque}. Fuente: ${st.fuente}.`, metricas, valorActual: null, valorNuevo: null })
          const x = porAsin.get(asin) ?? { campanas: 0, anuncios: 0 }
          x.campanas++
          porAsin.set(asin, x)
        } else if (d.decision === 'pausar_anuncio') {
          const ad = ads?.find((a) => a.asin === asin)
          if (!ad) {
            recortarPor.set(asin, recortarPor.get(asin) ?? `stock 0, pero no encuentro el anuncio de ${asin} en «${c.nombre}» para pausarlo`)
            continue
          }
          if (anuncioYaPausado.has(ad.adId)) continue
          propuestas.push({
            tipo: 'pausar',
            asin,
            campaignId: c.campaignId,
            campaignNombre: c.nombre,
            objetivoTipo: 'anuncio',
            objetivoId: ad.adId,
            motivo: `Sin stock de ${nombreDe(asin)} (${asin}): ${d.porque}. Fuente: ${st.fuente}.`,
            metricas,
            valorActual: null,
            valorNuevo: null,
          })
          const x = porAsin.get(asin) ?? { campanas: 0, anuncios: 0 }
          x.anuncios++
          porAsin.set(asin, x)
        } else if (d.decision === 'solo_recortar') {
          if (!recortarPor.has(asin)) recortarPor.set(asin, d.porque)
        }
      }
      for (const [asin, x] of Array.from(porAsin.entries())) {
        sinStock.push({ asin, nombre: nombreDe(asin), campanas: x.campanas, anuncios: x.anuncios, fuente: stock.get(asin)?.fuente ?? '' })
        eventos.push({ tipo: 'stock', titulo: `Sin stock: ${nombreDe(asin)} (${asin})`, detalle: `Propongo pausar ${x.campanas} campaña(s) y ${x.anuncios} anuncio(s). Fuente: ${stock.get(asin)?.fuente ?? '—'}.` })
      }
      for (const [asin, porque] of Array.from(recortarPor.entries())) if (!porAsin.has(asin)) soloRecortarPorStock.push({ asin, nombre: nombreDe(asin), porque, ceroDesde: ceroDe.get(asin)?.primera_at ?? null })
    }

    // §6.5: un producto sin stock queda en «recortar» YA (no a las 08:00 con el cerebro), para que aplicar y el motor de pujas dejen de subirle pujas y de promover.
    // Todos los ASIN a 0 (los que se pausan, los que solo se recortan y los que ya tenían la pausa propuesta). No lanza: si falla, decidirPropuesta retiene igual
    // las subidas de un producto con stock 0 (red de seguridad).
    if (aCero.length > 0) {
      try {
        const { data: guardadas, error: eG } = await service.from('ads_agente_posturas').select('asin, postura').eq('perfil_id', cuenta.id).limit(2000)
        if (eG) throw new Error(eG.message)
        const previa = new Map(((guardadas ?? []) as Array<{ asin: string; postura: Postura }>).map((g) => [String(g.asin).toUpperCase(), g.postura]))
        const porqueDe = new Map(soloRecortarPorStock.map((s) => [s.asin, s.porque]))
        const cambios = posturasPorStock(aCero.map((asin) => ({ asin, porque: porqueDe.get(asin) ?? 'stock 0 en el inventario' })), previa)
        if (cambios.length > 0) {
          const { error: eU } = await service
            .from('ads_agente_posturas')
            .upsert(cambios.map((c) => ({ perfil_id: cuenta.id, asin: c.asin, postura: 'recortar', fuente: 'stock', motivo: c.motivo, actualizado_at: ahoraIso })), { onConflict: 'perfil_id,asin' })
          if (eU) throw new Error(eU.message)
          for (const c of cambios) {
            if (c.antes == null) continue
            eventos.push({ tipo: 'postura', titulo: `Postura de ${nombreDe(c.asin)}: ${c.antes} → recortar`, detalle: c.motivo, datos: { asin: c.asin, antes: c.antes, despues: 'recortar', fuente: 'stock' } })
          }
        }
      } catch (err) {
        console.error(`[agente] postura «recortar» por stock de ${cuenta.id}:`, err instanceof Error ? err.message : err)
      }
    }

    // Reactivar lo que el agente pausó por stock cuando vuelve (nunca en frenado)
    if (!frenado) {
      const aplicadas = pausasDeStock.filter((p) => p.estado === 'aplicada' && p.origen === 'agente' && p.asin)
      const porAsin = new Map<string, { propuestaIds: string[]; noReactivar: Array<{ propuestaId: string; porque: string }> }>()
      for (const p of aplicadas) {
        const asin = (p.asin as string).toUpperCase()
        const st = stock.get(asin)
        if (!st || st.stock == null || st.stock < AGENTE.STOCK_REACTIVAR) continue
        const manuales = await cambiosAManoDeEstado(cuenta.id, p.campaign_id, p.objetivo_tipo === 'anuncio' ? p.objetivo_id : null, p.resuelta_at ?? ahoraIso)
        const r = puedeReactivar({ stock: st.stock, listingAt: st.actualizadoAt, ahora, cambiosManualesDesdeLaPausa: manuales })
        const x = porAsin.get(asin) ?? { propuestaIds: [], noReactivar: [] }
        if (r.reactivar) x.propuestaIds.push(p.id)
        else if (manuales > 0) x.noReactivar.push({ propuestaId: p.id, porque: r.porque })
        else continue
        porAsin.set(asin, x)
      }
      for (const [asin, x] of Array.from(porAsin.entries())) vuelveStock.push({ asin, nombre: nombreDe(asin), ...x })
    }
  }

  // ---------- (f) freno ----------
  const f = await evaluarFrenoDeCuenta(l, config, ahora, diasHoy, usoAnterior, horas, stock, anunciados, { error: usoError, errorAt: usoErrorAt })
  const freno = config.estado === 'ensayo' || config.estado === 'activo' ? f.freno : null

  // ---------- (g) raras sin decisión de la IA y limpieza diaria ----------
  try {
    cambiosEnFila.raras_sin_ia = await contarRarasSinIa(cuenta.id, rendimiento, hasta, stock, ventas.v14, productos)
  } catch (err) {
    if (err instanceof Error && /315/.test(err.message)) throw err
    console.error(`[agente] raras sin IA de ${cuenta.id}:`, err)
  }
  if (config.marcas.limpiezaDia !== fecha) {
    const limite = desplazar(fecha, -AGENTE.DIAS_USO_SE_CONSERVAN)
    const [a, b, c] = await Promise.all([
      service.from('ads_presupuesto_dia').delete().eq('perfil_id', cuenta.id).lt('fecha_local', limite),
      service.from('ads_gasto_hora').delete().eq('perfil_id', cuenta.id).lt('fecha_local', limite),
      service.from('ads_agente_stock_cero').delete().eq('perfil_id', cuenta.id).lt('ultima_at', new Date(ahora - AGENTE.DIAS_USO_SE_CONSERVAN * 86_400_000).toISOString()),
    ])
    for (const r of [a, b, c]) if (r.error) lanzar(r.error)
    cambiosEnFila.limpieza_dia = fecha
  }

  if (Object.keys(cambiosEnFila).length > 0) await actualizarFilaPropia(cuenta.id, cambiosEnFila)

  // En frenado no sale nada que suba; tampoco si el freno salta en ESTA pasada (si no, una R1 nacida justo antes del freno se quedaría pendiente
  // y se aplicaría al reanudar, con datos de otro día)
  const salida = frenado || freno ? sinSubidasDePresupuesto(propuestas) : propuestas

  return {
    fechaLocal: fecha,
    minutoLocal,
    ritmo: mes,
    presionNueva,
    propuestas: salida,
    presionBajarPorRecorte,
    gastoHoy: f.gastoHoy,
    maximoPosible: f.maximoPosible,
    proyeccionHoy: f.proyeccionHoy,
    media7: f.media7,
    freno,
    sinStock,
    soloRecortarPorStock,
    vuelveStock,
    agotadaTop,
    avisos,
    usoError,
    usoErrorNuevo,
    eventos,
  }
}

/** Las propuestas pendientes y libres que son RARAS y aún no tienen decisión de la IA (el contador `raras_sin_ia`) */
async function contarRarasSinIa(
  perfilId: string,
  rendimiento: readonly DiaDeCampana[],
  hasta: string,
  stock: Map<string, { stock: number | null }>,
  v14: Record<string, { unidades: number }>,
  productos: readonly ProductoDelAgente[],
): Promise<number> {
  const { data, error } = await createServiceClient()
    .from('ads_propuestas')
    .select('id, tipo, asin, termino, campaign_id, valor_actual, valor_nuevo, metricas')
    .eq('perfil_id', perfilId)
    .eq('estado', 'pendiente')
    .is('retenida_at', null)
    .is('ia_decision', null)
    .limit(2000)
  if (error) lanzar(error)
  const filas = (data ?? []) as Array<{ tipo: string; asin: string | null; termino: string; campaign_id: string; valor_actual: unknown; valor_nuevo: unknown; metricas: Record<string, unknown> | null }>
  if (filas.length === 0) return 0
  const gasto30 = new Map<string, number>()
  for (const f of rendimiento) {
    if (f.fecha < desplazar(hasta, -29) || f.fecha > hasta) continue
    const a = asinDeCampana(f.nombre)
    if (a) gasto30.set(a, (gasto30.get(a) ?? 0) + f.gasto)
  }
  // Las subidas en campañas con ubicación > 100 % las marca motor-pujas en las métricas (ubicacionAlta)
  const ubicacionAlta = Array.from(new Set(filas.filter((f) => f.metricas?.ubicacionAlta === true).map((f) => f.campaign_id)))
  const conocidos = new Set(productos.map((p) => p.asin))
  let n = 0
  for (const f of filas) {
    const asin = (f.asin ?? '').toUpperCase()
    const st = asin ? (stock.get(asin)?.stock ?? null) : null
    const r = esRara(
      {
        tipo: f.tipo,
        termino: f.termino ?? '',
        esAsin: esAsin(f.termino ?? ''),
        valorActual: numero(f.valor_actual),
        valorNuevo: numero(f.valor_nuevo),
        metricas: { gasto: numero(f.metricas?.gasto) ?? 0, pedidos: numero(f.metricas?.pedidos) ?? 0 },
        campaignId: f.campaign_id,
      },
      {
        gastoProducto30: asin ? (gasto30.get(asin) ?? 0) : 0,
        stock: asin && conocidos.has(asin) ? st : null,
        coberturaDias: asin ? coberturaDias(st, v14[asin]?.unidades ?? null) : null,
        campanasConUbicacionAlta: ubicacionAlta,
      },
    )
    if (r.rara) n++
  }
  return n
}

/* =============================================================================================================================================================
 * Para reanudar y para el freno con deshacer
 * ============================================================================================================================================================= */

/**
 * TODOS los motivos de freno que siguen vigentes AHORA y no están ignorados (no solo el primero), solo con la base de datos (no llama a Amazon). Lo usa la API
 * al reanudar (decisionDeReanudar): con dos vigentes no se reanuda, porque solo se puede ignorar uno.
 */
export async function frenosActuales(cuenta: CuentaParaSincronizar, config: ConfigDelAgente, ahora: number): Promise<Array<{ motivo: MotivoDeFreno; detalle: string }>> {
  const l = await leerCuenta(cuenta.id, config, ahora, 45)
  const fecha = l.local.fecha
  const [diasHoy, usoAnterior, horas, stock] = await Promise.all([
    filasDeUso(cuenta.id, fecha, fecha),
    filasDeUso(cuenta.id, desplazar(fecha, -AGENTE.DIAS_USO_SE_CONSERVAN), desplazar(fecha, -1)),
    horasDeCuenta(cuenta.id, desplazar(fecha, -(AGENTE.CURVA_DIAS + 1)), desplazar(fecha, -1)),
    stockPorAsin(cuenta.id),
  ])
  // Los productos anunciados: los de las campañas con gasto en los últimos 7 días
  const anunciados = new Set(
    l.rendimiento
      .filter((f) => f.fecha >= desplazar(l.hasta, -6) && f.gasto > 0)
      .map((f) => asinDeCampana(f.nombre))
      .filter((a): a is string => Boolean(a)),
  )
  const r = await evaluarFrenoDeCuenta(l, config, ahora, diasHoy, usoAnterior, horas, stock, anunciados, { error: config.usoError, errorAt: config.usoErrorAt })
  return r.frenos
}

/** Las SUBIDAS (puja y presupuesto) que el agente ha aplicado en las últimas `horas` (para deshacerlas al frenar por gasto o por ACoS). Más recientes primero */
export async function subidasDelAgenteRecientes(perfilId: string, horas: number): Promise<Array<{ id: string; tipo: string; campaignId: string }>> {
  const desde = new Date(Date.now() - Math.max(0, horas) * HORA_MS).toISOString()
  const { data, error } = await createServiceClient()
    .from('ads_propuestas')
    .select('id, tipo, campaign_id, valor_actual, valor_nuevo, agente_at')
    .eq('perfil_id', perfilId)
    .eq('estado', 'aplicada')
    .in('tipo', ['puja', 'presupuesto'])
    .gte('agente_at', desde)
    .order('agente_at', { ascending: false })
    .limit(500)
  if (error) lanzar(error)
  return ((data ?? []) as Array<{ id: string; tipo: string; campaign_id: string; valor_actual: unknown; valor_nuevo: unknown }>)
    .filter((p) => {
      const a = numero(p.valor_actual)
      const n = numero(p.valor_nuevo)
      return a != null && n != null && n > a
    })
    .map((p) => ({ id: p.id, tipo: p.tipo, campaignId: String(p.campaign_id) }))
}
