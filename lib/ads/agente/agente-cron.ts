/**
 * AMAZON ADS · EL AGENTE PPC: EL BUCLE DEL CRON (proceso `ads-agente`, cada 5 minutos, 240 s). SOLO SERVIDOR. Es el ÚNICO pegamento del agente.
 *
 *   cuentasDelAgenteConTrabajo  las cuentas con el agente en ensayo/activo (y el motor en «agente») o frenado, que tienen un paso que dar AHORA (`siguientePaso`). Barato: unas pocas
 *                               consultas, sin tocar Amazon. Con la parada general, ninguna.
 *   correrAgente                por cuenta: la reserva (`tomarCuenta`, 330 s), hasta 3 pasos si caben en la pasada (`pasoCabe`), el sello de cada paso ANTES de darlo
 *                               (`reservarPaso`) y el paso dentro de un try. Lo que devuelven los pasos de la oleada 2 lo convierte aquí en hechos: propuestas, freno, deshacer,
 *                               avisos al canal y eventos de la línea de tiempo.
 *
 * Pasos (§2.4): vigilar → aplicar → objetivos → cerebro → resumen → efectos → terminos_semana → calibrar. `hizoAlgo` (abrir fila en el registro) solo si se aplicó, ensayó, retuvo,
 * descartó, deshizo, frenó, avisó de algo nuevo o saltó un error: un vigilar rutinario no abre fila.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { deshacerPropuesta, guardarDecisionesIa, insertarPropuestasDelAgente, modosConMotor } from '../motor'
import { cuentasASincronizar, type CuentaParaSincronizar } from '../sincronizar'
import { anotarCampanaActivaHoy, anotarPresupuestoDeHoy, aplicarComoAgente, leerGuardaDeEscritura, permitidoParaReactivarCampana, permitidoParaVolverPresupuesto } from './aplicar-servidor'
import { avisoDeNoReactivar, avisoDeRecortarPorStock, idDeAvisoDePausaPorStock, textoDeAgotada, textoDeEnsayoFin, textoDeIa, textoDeStock, textoDeStockFallo, textoDeTechoAuto } from './avisos-calculo'
import { calibrarCuenta } from './calibrar-servidor'
import { pensarCuenta } from './cerebro-ia'
import { configDeFila, filasDeUso, leerContextoDelAgente, nombreDeCuenta } from './contexto-servidor'
import { medirEfectos, veredictosRecientes } from './efectos-servidor'
import { actualizarAgente, frenarAgente, leerConfigDelAgente, paradaGeneral, pasarAActivo, reservarPaso, soltarCuenta, tomarCuenta } from './estado-servidor'
import { anotarEvento, anotarGuardaUnaVez, avisar } from './eventos-servidor'
import { claseDeCambio, FRENOS_AUTOMATICOS, sinSubidasDePresupuesto } from './guardarrailes-calculo'
import { recalcularObjetivos } from './objetivos-servidor'
import { diaDeRampa, ensayoTerminado, horaEnMadrid, lunesLocal, motorFueraDeModoAgente, pasoCabe, siguientePaso } from './pasos-calculo'
import { prepararResumen } from './resumen-servidor'
import { enVedaDeActivacion } from './temporada-calculo'
import { guardarTerminosDeLaSemana } from './terminos-semana-servidor'
import { AGENTE, ERROR_INTERRUPTOR_GENERAL, FALTA_MIGRACION_315, RAMPA, type ClaseDeCambio, type ConfigDelAgente, type PasoDelAgente, type TipoDeEvento } from './tipos'
import { horaLocal, inicioDelDiaLocal, leerUsoError, zonaDePais } from './uso-calculo'
import { subidasDelAgenteRecientes, vigilarCuenta, type ResultadoDeVigilar } from './vigilar-servidor'

const HORA_MS = 3_600_000
/**
 * Hasta cuándo, tras un freno por gasto o ACoS, se siguen deshaciendo las subidas que quedaron (10 por pasada, en cada vigilar): mientras quede alguna de la ventana.
 * Cada subida se intenta UNA vez: la que falla se apunta («deshacer_fallo»), se avisa y no se reintenta (la revisa una persona).
 */
const HORAS_SEGUIR_DESHACIENDO_TRAS_FRENO = AGENTE.FRENO_DESHACER_HORAS
const DIAS_DE_RAMPA = RAMPA[RAMPA.length - 1].desdeDia + 1

type ErrorDeBase = { code?: string; message?: string } | null | undefined
const faltaLa315 = (e: ErrorDeBase): boolean => !!e && (isMissingSchema(e) || e.code === '42703' || e.code === 'PGRST204')
const textoDe = (e: unknown, max = 160) => (e instanceof Error ? e.message : String(e)).slice(0, max)

/* =============================================================================================================================================================
 * PURO (probado en agente-cron.prueba.ts)
 * ============================================================================================================================================================= */

/** «13:40» de un minuto del día */
export function horaDeMinuto(minuto: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minuto)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/**
 * PURO. Los cambios DISTINTOS que habría hecho el ensayo, por clase: una misma propuesta ensayada varios días (la misma campaña, segmentación o término, y el mismo tipo) cuenta una vez.
 */
export function cambiosDistintosDelEnsayo(
  filas: ReadonlyArray<{ tipo: string; campaign_id: string; objetivo_id: string | null; termino: string; valor_actual: unknown; valor_nuevo: unknown; metricas: { pedidos?: unknown } | null }>,
): Partial<Record<ClaseDeCambio, number>> {
  const n = (x: unknown) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x))
  const vistos = new Set<string>()
  const r: Partial<Record<ClaseDeCambio, number>> = {}
  for (const f of filas) {
    const clave = `${f.campaign_id}|${f.objetivo_id ?? (f.termino ?? '').trim().toLowerCase()}|${f.tipo}`
    if (vistos.has(clave)) continue
    vistos.add(clave)
    const clase = claseDeCambio({ tipo: f.tipo, valorActual: n(f.valor_actual), valorNuevo: n(f.valor_nuevo), metricas: { pedidos: n(f.metricas?.pedidos) ?? 0 } })
    r[clase] = (r[clase] ?? 0) + 1
  }
  return r
}

/** Tras un vigilar fallido, a los cuántos minutos se reintenta (según los fallos seguidos, incluido este): 5, 10, 20 y luego cada 30 (lo normal) */
const ESPERA_TRAS_VIGILAR_FALLIDO_MIN = [5, 10, 20, 30] as const

/**
 * PURO. Lo que se guarda tras un vigilar que ha lanzado: se suma el fallo y se ANULA el sello del último vigilar bueno. Si el vigilar lanzó tras ver un freno
 * (antes de guardarlo), un `vigilar_ok_at` de hasta 45 min dejaría a aplicar escribir en una cuenta que debía quedar frenada: sin sello, aplicar no escribe
 * hasta que un vigilar termine bien. Y se ADELANTA el sello `vigilar_at` para reintentar a los 5, 10, 20 y 30 min (no a los 30 de siempre): un fallo pasajero
 * dejaba la cuenta media hora sin aplicar nada. `ahora` sin dar: solo el contador (no se toca el sello).
 */
export function camposDeVigilarFallido(fallosAntes: number, ahora?: number): { vigilar_fallos: number; vigilar_ok_at: null; vigilar_at?: string } {
  const fallos = Math.max(0, Math.floor(fallosAntes) || 0) + 1
  if (ahora === undefined || !Number.isFinite(ahora)) return { vigilar_fallos: fallos, vigilar_ok_at: null }
  const espera = ESPERA_TRAS_VIGILAR_FALLIDO_MIN[Math.min(fallos, ESPERA_TRAS_VIGILAR_FALLIDO_MIN.length) - 1]
  // reservarPaso deja pasar el vigilar cuando vigilar_at < ahora − MIN_ENTRE_VIGILAR: con este sello, eso ocurre a los `espera` minutos
  const sello = ahora - Math.max(0, AGENTE.MIN_ENTRE_VIGILAR - espera) * 60_000
  return { vigilar_fallos: fallos, vigilar_ok_at: null, vigilar_at: new Date(sello).toISOString() }
}

/** PURO. ¿Se siguen dando pasos en esta cuenta tras un paso que ha lanzado? Tras un vigilar fallido, no (en esta pasada no se aplica nada) */
export function seguirTrasPasoFallido(paso: PasoDelAgente): boolean {
  return paso !== 'vigilar'
}

/** PURO. ¿Merece este vigilar una fila en el registro? (hechos, no rutina) */
export function vigilarHizoAlgo(e: { insertadas: number; frenado: boolean; deshechas: number; activado: boolean; eventos: number; reactivadas: number }): boolean {
  return e.insertadas > 0 || e.frenado || e.deshechas > 0 || e.activado || e.eventos > 0 || e.reactivadas > 0
}

/* =============================================================================================================================================================
 * Las cuentas con trabajo
 * ============================================================================================================================================================= */

export interface CuentaDelAgente {
  cuenta: CuentaParaSincronizar
  config: ConfigDelAgente
}

/** Pendientes libres por cuenta (una consulta): si hay alguna y si alguna es un REVISAR (término que espera la etiqueta de la IA) */
async function pendientesPorCuenta(ids: readonly string[]): Promise<Map<string, { hay: boolean; revisar: boolean }>> {
  const salida = new Map<string, { hay: boolean; revisar: boolean }>()
  if (ids.length === 0) return salida
  const { data, error } = await createServiceClient()
    .from('ads_propuestas')
    .select('perfil_id, tipo, motivo, metricas')
    .in('perfil_id', ids as string[])
    .eq('estado', 'pendiente')
    .is('retenida_at', null)
    .limit(2000)
  if (error) {
    if (faltaLa315(error)) throw new Error(FALTA_MIGRACION_315)
    throw error
  }
  for (const f of (data ?? []) as Array<{ perfil_id: string; tipo: string; motivo: string | null; metricas: Record<string, unknown> | null }>) {
    const x = salida.get(f.perfil_id) ?? { hay: false, revisar: false }
    x.hay = true
    if (f.tipo === 'negativizar' && (f.metricas?.revisar === true || /^REVISAR:/i.test(f.motivo ?? ''))) x.revisar = true
    salida.set(f.perfil_id, x)
  }
  return salida
}

/** Zona horaria de cada cuenta (una consulta) */
async function zonasDe(ids: readonly string[]): Promise<Map<string, { zona: string; pais: string }>> {
  const salida = new Map<string, { zona: string; pais: string }>()
  if (ids.length === 0) return salida
  const { data } = await createServiceClient().from('ads_profiles').select('id, pais, zona_horaria').in('id', ids as string[])
  for (const f of (data ?? []) as Array<{ id: string; pais: string | null; zona_horaria: string | null }>) {
    const pais = String(f.pais ?? '').toUpperCase()
    salida.set(f.id, { zona: zonaDePais(pais, f.zona_horaria), pais })
  }
  return salida
}

/** El paso que toca ahora en una cuenta (o null) */
function pasoDe(config: ConfigDelAgente, zona: string, ahora: number, pend: { hay: boolean; revisar: boolean } | undefined): PasoDelAgente | null {
  const l = horaLocal(ahora, zona)
  return siguientePaso({
    estado: config.estado,
    marcas: config.marcas,
    ahora,
    local: { fecha: l.fecha, hora: l.hora, minutos: l.minutos },
    hayPendientes: Boolean(pend?.hay),
    rarasSinIa: config.rarasSinIa,
    hayTerminosSinIa: Boolean(pend?.revisar),
    pensarYa: config.pensarYa,
  })
}

/**
 * Las cuentas y si falta la migración (para que la ruta lo diga). `cuentasDelAgenteConTrabajo` es esto sin el aviso de la migración.
 */
export async function cuentasDelAgente(ahora: number): Promise<{ cuentas: CuentaDelAgente[]; faltaMigracion: boolean }> {
  // 1. Interruptor general
  if ((await paradaGeneral()).parado) return { cuentas: [], faltaMigracion: false }

  // 2. Agente en ensayo/activo con el motor en «agente», o frenado (el freno pone el motor en «aprueba»)
  const { data, error } = await createServiceClient().from('ads_agente').select('*').in('estado', ['ensayo', 'activo', 'frenado'])
  if (error) {
    if (faltaLa315(error)) return { cuentas: [], faltaMigracion: true }
    throw error
  }
  const filas = ((data ?? []) as Array<Record<string, unknown>>).map(configDeFila)
  if (filas.length === 0) return { cuentas: [], faltaMigracion: false }
  const [modos, todas] = await Promise.all([modosConMotor(), cuentasASincronizar()])
  const cuentaDe = new Map(todas.map((c) => [c.id, c]))
  const validas = filas.filter((c) => cuentaDe.has(c.perfilId) && (c.estado === 'frenado' || modos.get(c.perfilId) === 'agente'))
  // En marcha con el motor en otro modo: NO corre (ni vigila ni frena). Que no quede en silencio: a la consola, y el panel lo dice en rojo (motorFueraDeModoAgente)
  for (const c of filas) {
    if (cuentaDe.has(c.perfilId) && motorFueraDeModoAgente(c.estado, modos.get(c.perfilId) ?? null)) {
      console.warn(`[agente] ${c.perfilId}: el agente está «${c.estado}» pero el motor está en «${modos.get(c.perfilId) ?? 'sin modo'}»: no corre`)
    }
  }
  if (validas.length === 0) return { cuentas: [], faltaMigracion: false }

  // 3. Pendientes libres y zonas
  const ids = validas.map((c) => c.perfilId)
  const [pend, zonas] = await Promise.all([pendientesPorCuenta(ids), zonasDe(ids)])

  // 4. Las que tienen un paso
  const cuentas: CuentaDelAgente[] = []
  for (const config of validas) {
    const zona = zonas.get(config.perfilId)?.zona ?? 'Europe/Madrid'
    if (pasoDe(config, zona, ahora, pend.get(config.perfilId))) cuentas.push({ cuenta: cuentaDe.get(config.perfilId)!, config })
  }
  return { cuentas, faltaMigracion: false }
}

/** Las cuentas del agente que tienen un paso que dar ahora (§2.2). Sin la 315, ninguna */
export async function cuentasDelAgenteConTrabajo(ahora: number): Promise<Array<{ cuenta: CuentaParaSincronizar; config: ConfigDelAgente }>> {
  return (await cuentasDelAgente(ahora)).cuentas
}

/* =============================================================================================================================================================
 * El bucle
 * ============================================================================================================================================================= */

export interface ResultadoDelAgente {
  cuentas: number
  pasos: number
  aplicadas: number
  ensayadas: number
  retenidas: number
  errores: string[]
  hizoAlgo: boolean
  sinTiempo: number
}

/** Lo que un paso le devuelve al bucle */
interface HechoDelPaso {
  hizoAlgo: boolean
  aplicadas?: number
  ensayadas?: number
  retenidas?: number
  errores?: string[]
}

/** Datos de la cuenta que se piden una vez por cuenta y pasada (nombre para los avisos, país, moneda y zona) */
interface DatosDeCuenta {
  nombre: string
  pais: string
  moneda: string | null
  zona: string
}

/** ¿Hay ya un evento de este tipo desde ese instante? (para no repetir en la línea de tiempo lo que el aviso ya no repite por su clave) */
async function hayEventoDesde(perfilId: string, tipo: TipoDeEvento, desdeIso: string): Promise<boolean> {
  try {
    const { count, error } = await createServiceClient().from('ads_agente_eventos').select('id', { count: 'exact', head: true }).eq('perfil_id', perfilId).eq('tipo', tipo).gte('creado_at', desdeIso)
    if (error) return false
    return (count ?? 0) > 0
  } catch {
    return false
  }
}

/** Pendientes libres de UNA cuenta (para elegir el siguiente paso de la misma pasada) */
async function pendientesDe(perfilId: string): Promise<{ hay: boolean; revisar: boolean }> {
  return (await pendientesPorCuenta([perfilId])).get(perfilId) ?? { hay: false, revisar: false }
}

/**
 * Deshace una propuesta como el agente, sin lanzar. Deshacer ESCRIBE en Amazon: nunca con el interruptor general puesto (releído aquí, también en el del freno), y solo con
 * el agente «activo» (releído aquí), salvo el deshacer del freno (`delFreno`), que corre justo al frenar o ya frenado. En ensayo nunca se escribe.
 * Un presupuesto que vuelve se apunta en la fila de hoy de `ads_presupuesto_dia` (`zona` = la de la cuenta): el guardarraíl de la suma lee de ahí, y los siguientes deshacer
 * y subidas de la misma pasada (o de la de aplicar, antes de que vigilar relea) cuentan con él.
 */
async function deshacerComoAgente(cuenta: CuentaParaSincronizar, zona: string, id: string, motivo: string, valorMaximo?: number, delFreno = false): Promise<{ ok: boolean; error: string | null }> {
  try {
    if ((await paradaGeneral()).parado) return { ok: false, error: ERROR_INTERRUPTOR_GENERAL }
    if (!delFreno) {
      const estado = (await leerConfigDelAgente(cuenta.id))?.estado ?? null
      if (estado !== 'activo') return { ok: false, error: `El agente no está activo (${estado ?? 'apagado'}): no deshago nada en Amazon.` }
    }
    await deshacerPropuesta(cuenta, id, null, {
      origen: 'agente',
      motivo,
      valorMaximo,
      alEscribirPresupuesto: (campaignId, valor) => anotarPresupuestoDeHoy(cuenta.id, campaignId, horaLocal(Date.now(), zona).fecha, valor),
    })
    return { ok: true, error: null }
  } catch (e) {
    return { ok: false, error: textoDe(e, 300) }
  }
}

/** Las propuestas con un «deshacer_fallo» apuntado desde un instante (ya se intentaron deshacer y fallaron: no se reintentan) */
async function deshacerFallidosDesde(perfilId: string, desdeIso: string): Promise<Set<string>> {
  try {
    const { data, error } = await createServiceClient().from('ads_agente_eventos').select('propuesta_id').eq('perfil_id', perfilId).eq('tipo', 'deshacer_fallo').gte('creado_at', desdeIso).limit(2000)
    if (error) return new Set()
    return new Set(((data ?? []) as Array<{ propuesta_id: string | null }>).map((f) => f.propuesta_id).filter((x): x is string => Boolean(x)))
  } catch {
    return new Set()
  }
}

/**
 * Deshace las subidas de puja y presupuesto del agente de las últimas `horas` (como mucho 10 por pasada), salvo las de `saltar` (ya fallaron).
 * Cada fallo se apunta como «deshacer_fallo» (con su propuesta) y se avisa una vez por propuesta y día. Devuelve cuántas se deshicieron, las que fallaron y cuántas quedan.
 */
async function deshacerSubidas(
  cuenta: CuentaParaSincronizar,
  horas: number,
  motivo: string,
  hastaMs: number,
  d: DatosDeCuenta,
  saltar: ReadonlySet<string> = new Set(),
): Promise<{ deshechas: number; fallidas: Array<{ id: string; error: string }>; quedan: number }> {
  const subidas = (await subidasDelAgenteRecientes(cuenta.id, horas)).filter((s) => !saltar.has(s.id))
  let deshechas = 0
  let intentadas = 0
  const fallidas: Array<{ id: string; error: string }> = []
  for (const s of subidas.slice(0, AGENTE.FRENO_DESHACER_MAX)) {
    if (Date.now() > hastaMs - AGENTE.MARGEN_FIN_APLICAR_MS) break
    const r = await deshacerComoAgente(cuenta, d.zona, s.id, motivo, undefined, true)
    // Con el interruptor general no se ha intentado: se corta (no cuenta como fallo ni se apunta; queda para cuando se quite)
    if (r.error === ERROR_INTERRUPTOR_GENERAL) break
    intentadas += 1
    if (r.ok) deshechas += 1
    else fallidas.push({ id: s.id, error: r.error ?? 'sin detalle' })
  }
  if (deshechas > 0) await anotarEvento(cuenta.id, 'deshacer_freno', `Deshechas ${deshechas} subida(s) de las últimas ${AGENTE.FRENO_DESHACER_HORAS} h por el freno`, motivo, { deshechas })
  const hoy = horaEnMadrid(Date.now()).fecha
  for (const f of fallidas) {
    await anotarEvento(cuenta.id, 'deshacer_fallo', 'No he podido deshacer una subida al frenar: sigue aplicada', f.error.slice(0, 300), { motivo }, f.id)
    await avisar(cuenta.id, 'deshacer-fallo', hoy, {
      titulo: `Subida sin deshacer · ${d.nombre}`.slice(0, 80),
      cuerpo: `⚠️ **No he podido deshacer una subida** · ${d.nombre}\nEl agente está frenado (${motivo.slice(0, 160)}), pero esta subida sigue aplicada en Amazon: «${f.error.slice(0, 240)}». Revísala en Marketing Test → Agente.`,
    }, { id: f.id })
  }
  return { deshechas, fallidas, quedan: Math.max(0, subidas.length - intentadas) }
}

/* ---------------------------------------------------------------- vigilar ---------------------------------------------------------------- */

async function pasoVigilar(cuenta: CuentaParaSincronizar, config: ConfigDelAgente, d: DatosDeCuenta, hastaMs: number): Promise<HechoDelPaso> {
  const ahora = Date.now()
  const perfilId = cuenta.id
  const madrid = horaEnMadrid(ahora).fecha
  const errores: string[] = []
  const r: ResultadoDeVigilar = await vigilarCuenta(cuenta, config, ahora)
  let activado = false
  let frenado = false
  let deshechas = 0
  let reactivadas = 0
  let estado = config.estado

  // (a) fin del ensayo (con la veda de temporada)
  if (estado === 'ensayo') {
    // Sin veda de temporada: el ensayo que quede pasa a activo en cuanto termina (20 nov 2026, Raúl)
    const veda = null as ReturnType<typeof enVedaDeActivacion>
    const hechos = async () => {
      const desde = config.encendidoAt ?? new Date(ahora - AGENTE.DIAS_DE_ENSAYO * 86_400_000).toISOString()
      const { data } = await createServiceClient()
        .from('ads_propuestas')
        .select('tipo, campaign_id, objetivo_id, termino, valor_actual, valor_nuevo, metricas')
        .eq('perfil_id', perfilId)
        .eq('estado', 'ensayada')
        .gte('agente_at', desde)
        .limit(5000)
      return cambiosDistintosDelEnsayo((data ?? []) as Parameters<typeof cambiosDistintosDelEnsayo>[0])
    }
    if (ensayoTerminado(config, ahora, veda) && !r.freno) {
      await pasarAActivo(perfilId, ahora)
      estado = 'activo'
      activado = true
      const h = await hechos()
      const texto = textoDeEnsayoFin({ nombreCuenta: d.nombre, hechos: h, veda: null })
      await anotarEvento(perfilId, 'ensayo_fin', 'Termina el ensayo: el agente pasa a activo', texto.cuerpo, { hechos: h })
      await avisar(perfilId, 'ensayo-fin', madrid, texto)
    } else if (veda && config.ensayoHasta && Date.parse(config.ensayoHasta) <= ahora) {
      // El ensayo ha terminado, pero hay veda: sigue ensayando y se avisa UNA vez por veda
      if (!(await hayEventoDesde(perfilId, 'veda', config.ensayoHasta))) {
        const h = await hechos()
        const texto = textoDeEnsayoFin({ nombreCuenta: d.nombre, hechos: h, veda })
        await anotarEvento(perfilId, 'veda', `Termina el ensayo, pero no activo hasta que acabe la veda de ${veda.nombre}`, texto.cuerpo, { veda, hechos: h })
        await avisar(perfilId, 'veda', veda.hasta, texto)
        activado = true
      }
    }
  }

  // (b) las propuestas que devuelve vigilar (R1/R4, recorte, pausas por stock)
  // Si el freno salta en esta pasada, vigilarCuenta ya no devuelve subidas de presupuesto (sinSubidasDePresupuesto): solo bajadas y pausas
  let insertadas = 0
  let fallaInsertar = false
  if (r.propuestas.length > 0) {
    try {
      insertadas = await insertarPropuestasDelAgente(perfilId, r.freno ? sinSubidasDePresupuesto(r.propuestas) : r.propuestas)
    } catch (e) {
      fallaInsertar = true
      errores.push(`propuestas de vigilar: ${textoDe(e)}`)
    }
  }

  // (c) el freno (ensayo o activo): deshacer las subidas de 48 h si es por gasto o ACoS, frenar y avisar (con lo que no se pudo deshacer y lo que queda)
  if (r.freno && (estado === 'ensayo' || estado === 'activo')) {
    let deshacer: { noDeshechas: number; quedan: number } | undefined
    if (estado === 'activo' && (r.freno.motivo === 'gasto_disparado' || r.freno.motivo === 'acos_cuenta')) {
      const x = await deshacerSubidas(cuenta, AGENTE.FRENO_DESHACER_HORAS, `freno: ${r.freno.detalle.slice(0, 200)}`, hastaMs, d)
      deshechas = x.deshechas
      deshacer = { noDeshechas: x.fallidas.length, quedan: x.quedan }
    }
    await frenarAgente(perfilId, r.freno.motivo, r.freno.detalle, d.nombre, deshechas, deshacer)
    frenado = true
    estado = 'frenado'
  } else if (estado === 'frenado' && (config.frenoMotivo === 'gasto_disparado' || config.frenoMotivo === 'acos_cuenta') && config.frenadoAt) {
    // Lo que no dio tiempo a deshacer al frenar, en las pasadas siguientes: mientras queden subidas de la ventana (cada una se intenta una vez; las que fallaron, no)
    const desdeFreno = (ahora - Date.parse(config.frenadoAt)) / HORA_MS
    if (Number.isFinite(desdeFreno) && desdeFreno >= 0 && desdeFreno < HORAS_SEGUIR_DESHACIENDO_TRAS_FRENO) {
      const yaFallaron = await deshacerFallidosDesde(perfilId, new Date(Date.parse(config.frenadoAt) - 5 * 60_000).toISOString())
      const x = await deshacerSubidas(cuenta, AGENTE.FRENO_DESHACER_HORAS + desdeFreno, `freno (${config.frenoMotivo}): lo que quedaba por deshacer`, hastaMs, d, yaFallaron)
      deshechas = x.deshechas
      if (x.fallidas.length > 0) errores.push(`freno: ${x.fallidas.length} subida(s) no se han podido deshacer`)
    }
  }

  // El freno está evaluado (y, si tocaba, aplicado): este vigilar cuenta como bueno para aplicar
  await actualizarAgente(perfilId, { vigilar_ok_at: new Date().toISOString(), vigilar_fallos: 0 })

  // (d) avisos de stock
  // Cada motivo con su clave: «aún no pauso» y «pauso» el mismo día son dos avisos, y el de pausar lleva el ESTADO en el id (idDeAvisoDePausaPorStock): si el día
  // pasa de ensayo a activo, el «voy a pausar» real no se descarta como duplicado del «habría pausado». El de pausar depende del estado (en ensayo
  // no escribe y no va a la campana; frenado, lo aplica una persona) y solo se avisa si la propuesta se ha podido guardar
  const estadoParaStock: 'ensayo' | 'activo' | 'frenado' = estado === 'ensayo' ? 'ensayo' : estado === 'frenado' ? 'frenado' : 'activo'
  for (const s of fallaInsertar ? [] : r.sinStock) {
    await avisar(
      perfilId,
      'stock',
      madrid,
      textoDeStock({ nombreCuenta: d.nombre, producto: s.nombre, asin: s.asin, campanas: s.campanas, anuncios: s.anuncios, fuente: s.fuente, vuelve: false, estado: estadoParaStock }),
      { id: idDeAvisoDePausaPorStock(s.asin, estadoParaStock), ...(estadoParaStock === 'ensayo' ? { avisar: false } : {}) },
    )
  }
  // «Aún no pauso»: uno por episodio de stock a 0 (no cada día mientras dure la rotura) y, en ensayo, sin campana
  for (const s of r.soloRecortarPorStock) {
    const a = avisoDeRecortarPorStock({ asin: s.asin, ceroDesde: s.ceroDesde, estado: estadoParaStock, hoy: madrid })
    await avisar(perfilId, 'stock', a.fecha, textoDeStock({ nombreCuenta: d.nombre, producto: s.nombre, asin: s.asin, campanas: 0, anuncios: 0, fuente: s.porque, vuelve: false }), { id: a.id, ...(a.avisar === false ? { avisar: false } : {}) })
  }

  // (e) el stock vuelve: se reactiva lo que pausó el agente (deshacer la pausa), salvo si una persona lo tocó. Reactivar ESCRIBE en Amazon: solo en activo;
  // en ensayo se anota lo que habría reactivado
  if (estado === 'ensayo') {
    const yaAnotado = r.vuelveStock.length > 0 && (await hayEventoDesde(perfilId, 'stock_vuelve', horaEnMadrid(ahora).inicioDelDia))
    for (const v of yaAnotado ? [] : r.vuelveStock) {
      if (v.propuestaIds.length === 0) continue
      await anotarEvento(perfilId, 'stock_vuelve', `Vuelve el stock de ${v.nombre} (${v.asin}): habría reactivado ${v.propuestaIds.length} (ensayo, no escribo)`, null, { asin: v.asin, ensayo: true, propuestas: v.propuestaIds })
    }
  } else if (estado === 'activo') {
    let parado = false
    for (const v of r.vuelveStock) {
      if (parado) break
      let campanas = 0
      let anuncios = 0
      if (v.propuestaIds.length > 0) {
        const { data } = await createServiceClient().from('ads_propuestas').select('id, tipo, campaign_id, campaign_nombre').in('id', v.propuestaIds)
        const porId = new Map(((data ?? []) as Array<{ id: string; tipo: string; campaign_id: string; campaign_nombre: string }>).map((f) => [f.id, f]))
        for (const id of v.propuestaIds) {
          const f = porId.get(id)
          // Reactivar una CAMPAÑA devuelve su presupuesto entero a la suma de la cuenta: tiene que caber en los topes (techo, suma al encender, × 1,3 de hace 7
          // días) y el mes no puede ir en «recorte». Si no, no se reactiva: se avisa una vez por pausa y lo decide una persona (o el agente cuando quepa)
          let activaHoy: string | null = null
          if (!f || f.tipo === 'pausar-campana') {
            const cabe = f ? await permitidoParaReactivarCampana(cuenta, config, Date.now(), String(f.campaign_id), r.ritmo?.ritmo ?? null) : { no: 'no encuentro la propuesta de la pausa' }
            if ('no' in cabe) {
              const a = avisoDeNoReactivar(v.asin, id)
              await avisar(perfilId, 'stock-vuelve', a.fecha, textoDeStock({ nombreCuenta: d.nombre, producto: v.nombre, asin: v.asin, campanas: 0, anuncios: 0, fuente: '', vuelve: true, noReactivada: cabe.no }), { id: a.id })
              continue
            }
            activaHoy = cabe.fecha
          }
          const x = await deshacerComoAgente(cuenta, d.zona, id, `vuelve el stock de ${v.nombre} (${v.asin})`)
          if (x.ok && activaHoy && f) await anotarCampanaActivaHoy(perfilId, String(f.campaign_id), activaHoy)
          // Interruptor general: no se sigue reactivando (ni se avisa de fallo: no se ha intentado)
          if (x.error === ERROR_INTERRUPTOR_GENERAL) {
            parado = true
            break
          }
          if (x.ok) {
            reactivadas += 1
            if (f?.tipo === 'pausar-campana') campanas += 1
            else anuncios += 1
          } else {
            await anotarEvento(perfilId, 'stock_fallo', `No he podido reactivar «${f?.campaign_nombre ?? id}»`, x.error, { asin: v.asin }, id)
            await avisar(perfilId, 'stock-fallo', madrid, textoDeStockFallo({ nombreCuenta: d.nombre, campana: f?.campaign_nombre ?? id, error: x.error ?? 'error' }), { id })
          }
        }
        if (campanas + anuncios > 0) {
          await anotarEvento(perfilId, 'stock_vuelve', `Vuelve el stock de ${v.nombre} (${v.asin}): reactivadas ${campanas + anuncios}`, null, { asin: v.asin, campanas, anuncios })
          await avisar(perfilId, 'stock-vuelve', madrid, textoDeStock({ nombreCuenta: d.nombre, producto: v.nombre, asin: v.asin, campanas, anuncios, fuente: '', vuelve: true }), { id: v.asin })
        }
      }
      // Una vez por pausa (no cada día mientras dure el stock): la pausa sigue «aplicada» y vigilar la devuelve en cada pasada
      for (const n of v.noReactivar) {
        const a = avisoDeNoReactivar(v.asin, n.propuestaId)
        await avisar(perfilId, 'stock-vuelve', a.fecha, textoDeStock({ nombreCuenta: d.nombre, producto: v.nombre, asin: v.asin, campanas: 0, anuncios: 0, fuente: '', vuelve: true, noReactivada: n.porque }), { id: a.id })
      }
    }
  }

  // (f) la campaña que más vende se ha agotado (una vez al día)
  if (r.agotadaTop) {
    const a = r.agotadaTop
    const inicioDia = horaEnMadrid(ahora).inicioDelDia
    if (!(await hayEventoDesde(perfilId, 'agotada_top', inicioDia))) {
      const hora = horaDeMinuto(a.minuto)
      await anotarEvento(perfilId, 'agotada_top', `«${a.nombre}» sin presupuesto a las ${hora}`, a.porque, { campaignId: a.campaignId, presupuesto: a.presupuesto, nuevo: a.nuevo })
      await avisar(perfilId, 'agotada-top', madrid, textoDeAgotada({ nombreCuenta: d.nombre, campana: a.nombre, hora, presupuesto: a.presupuesto, acosPct: a.acosPct, nuevo: a.nuevo, moneda: d.moneda, porque: a.porque }))
    }
  }

  // (g) la API de uso falla (una vez: luego reintenta cada 6 h; mientras, nada sube; pasadas 12 h, sin R1–R4; nunca frena)
  if (r.usoErrorNuevo && r.usoError) {
    await avisar(perfilId, 'uso-error', madrid, {
      titulo: `No puedo leer el gasto de hoy · ${d.nombre}`.slice(0, 80),
      cuerpo: `⚠️ **No puedo leer el uso de presupuesto de hoy** · ${d.nombre}\nAmazon contesta: «${(leerUsoError(r.usoError, null)?.mensaje ?? r.usoError).slice(0, 300)}». Pruebo un lote en cada vigilar y lo leo todo como mucho cada ${AGENTE.USO_REINTENTO_HORAS} h. Mientras no sepa cuánto se gasta hoy no subo pujas ni presupuestos (las bajadas y negativas siguen); si sigue ${AGENTE.USO_ERROR_SIN_REGLAS_HORAS} h, dejo también las reglas de presupuesto (R1–R4), pero no freno el agente.`,
    })
  }

  // (h) avisos de las reglas de presupuesto (portfolio con tope, subida sin hueco…), uno por campaña y día; la agotada top ya lo lleva en su aviso
  const avisos = r.avisos.filter((a) => a.campaignId !== r.agotadaTop?.campaignId)
  if (avisos.length > 0) {
    await avisar(
      perfilId,
      'agotada-top',
      madrid,
      {
        titulo: `Presupuestos que no puedo subir · ${d.nombre}`.slice(0, 80),
        cuerpo: `⏱️ **Presupuestos que no puedo subir** · ${d.nombre}\n${avisos.slice(0, 8).map((a) => `• ${a.texto.slice(0, 240)}`).join('\n')}${avisos.length > 8 ? `\n… y ${avisos.length - 8} más` : ''}`,
      },
      { id: 'reglas', avisar: false },
    )
  }

  // (i) los eventos de vigilar a la línea de tiempo
  for (const ev of r.eventos) await anotarEvento(perfilId, ev.tipo, ev.titulo, ev.detalle, ev.datos)

  return { hizoAlgo: vigilarHizoAlgo({ insertadas, frenado, deshechas, activado, eventos: r.eventos.length, reactivadas }) || errores.length > 0, errores }
}

/* ---------------------------------------------------------------- objetivos ---------------------------------------------------------------- */

async function pasoObjetivos(cuenta: CuentaParaSincronizar, config: ConfigDelAgente, d: DatosDeCuenta): Promise<HechoDelPaso> {
  const ahora = Date.now()
  const perfilId = cuenta.id
  const r = await recalcularObjetivos(cuenta, config, ahora)
  for (const n of r.nuevos) await anotarEvento(perfilId, 'objetivo_auto', `${n.asin}: ACoS objetivo automático ${n.acosObjetivoPct.toLocaleString('es-ES')} % (congelado)`, n.detalle, n)
  for (const v of r.revisados) await anotarEvento(perfilId, 'objetivo_revisado', `${v.asin}: ACoS objetivo ${v.antes.toLocaleString('es-ES')} % → ${v.despues.toLocaleString('es-ES')} %`, 'Revisión mensual (sube como mucho 2 puntos; baja libre).', v)
  let aviso = false
  // Solo cuando el techo cambia (primera vez o revisión mensual que lo mueve); una revisión que lo deja igual solo marca el mes
  if (r.techo.congelado && r.techo.cambia) {
    await anotarEvento(perfilId, 'techo_auto', `Techo mensual automático: ${r.techo.techo?.toLocaleString('es-ES') ?? '—'} (congelado)`, r.techo.detalle, r.techo)
    await avisar(perfilId, 'techo-auto', horaEnMadrid(ahora).fecha, textoDeTechoAuto({ nombreCuenta: d.nombre, techo: r.techo.techo, detalle: r.techo.detalle, moneda: d.moneda }))
    aviso = true
  } else if (r.techo.techo == null && r.techo.automatico && config.techoMensual == null) {
    // Sin gasto para fijar un techo: nada sube. Se avisa una vez al mes
    await avisar(perfilId, 'techo-auto', horaLocal(ahora, d.zona).mes, textoDeTechoAuto({ nombreCuenta: d.nombre, techo: null, detalle: r.techo.detalle, moneda: d.moneda }))
  }
  return { hizoAlgo: aviso }
}

/* ---------------------------------------------------------------- cerebro ---------------------------------------------------------------- */

async function pasoCerebro(cuenta: CuentaParaSincronizar, config: ConfigDelAgente, d: DatosDeCuenta, momento: 'manana' | 'tarde'): Promise<HechoDelPaso> {
  const ahora = Date.now()
  const perfilId = cuenta.id
  const madrid = horaEnMadrid(ahora)
  const [contexto, veredictos] = await Promise.all([leerContextoDelAgente(cuenta, config, ahora), veredictosRecientes(perfilId, 30)])
  const r = await pensarCuenta(cuenta, config, ahora, momento, { contexto, veredictos })
  if (r.decisiones.length > 0) await guardarDecisionesIa(perfilId, r.decisiones)
  await actualizarAgente(perfilId, { pensar_ya: false })
  if (r.ok) return { hizoAlgo: false }
  if (r.motivo === FALTA_MIGRACION_315) throw new Error(FALTA_MIGRACION_315)
  if (r.tope) {
    // Una vez al mes (Madrid)
    if (!(await hayEventoDesde(perfilId, 'ia_tope', madrid.inicioDelMes))) {
      await anotarEvento(perfilId, 'ia_tope', 'Tope de IA del mes alcanzado: sigo con reglas', r.motivo, { tope: config.topeIaUsdMes })
      await avisar(perfilId, 'ia-tope', madrid.fecha.slice(0, 7), textoDeIa({ nombreCuenta: d.nombre, tipo: 'tope', tope: config.topeIaUsdMes }))
      return { hizoAlgo: true }
    }
    return { hizoAlgo: false }
  }
  // Un fallo: evento y aviso una vez al día
  if (!(await hayEventoDesde(perfilId, 'ia_fallo', madrid.inicioDelDia))) {
    await anotarEvento(perfilId, 'ia_fallo', 'La IA no ha contestado: posturas por reglas y lo raro sin decidir', r.motivo, { momento })
    await avisar(perfilId, 'ia-fallo', madrid.fecha, textoDeIa({ nombreCuenta: d.nombre, tipo: 'fallo' }))
  }
  return { hizoAlgo: true, errores: [`IA: ${(r.motivo ?? 'sin respuesta').slice(0, 120)}`] }
}

/* ---------------------------------------------------------------- resumen ---------------------------------------------------------------- */

async function pasoResumen(cuenta: CuentaParaSincronizar, config: ConfigDelAgente, d: DatosDeCuenta): Promise<HechoDelPaso> {
  const ahora = Date.now()
  const local = horaLocal(ahora, d.zona)
  const [contexto, veredictos] = await Promise.all([leerContextoDelAgente(cuenta, config, ahora), veredictosRecientes(cuenta.id, 14)])
  const veda = config.estado === 'ensayo' ? enVedaDeActivacion(local.fecha, d.pais, config.eventosManuales) : null
  const rampaLocal = config.rampaDesde ? horaLocal(Date.parse(config.rampaDesde), d.zona).fecha : null
  const dia = config.estado === 'activo' ? diaDeRampa(rampaLocal, local.fecha) : null
  // Sin frenos automáticos no hay rampa (topesDelDia no la aplica): el resumen no la menciona aunque quede un rampa_desde viejo
  const rampa = FRENOS_AUTOMATICOS && dia != null && dia < DIAS_DE_RAMPA ? { dia: dia + 1, de: DIAS_DE_RAMPA } : null
  const r = await prepararResumen(cuenta, config, ahora, { contexto, veredictos, veda, rampa })
  await avisar(cuenta.id, 'resumen', r.fecha, { titulo: r.titulo, cuerpo: r.cuerpo }, { avisar: false })
  return { hizoAlgo: true }
}

/* ---------------------------------------------------------------- efectos ---------------------------------------------------------------- */

async function pasoEfectos(cuenta: CuentaParaSincronizar, config: ConfigDelAgente, d: DatosDeCuenta): Promise<HechoDelPaso> {
  const ahora = Date.now()
  const perfilId = cuenta.id
  const hoy = horaLocal(ahora, d.zona).fecha
  // Guardas técnicas (las de aplicar): con datos viejos se mediría y desharía con métricas de hace días; sin autorización, deshacer fallaría. Se deja para mañana
  // (las mediciones no se pierden: se hacen cuando toca y hay datos) y se anota una vez al día
  if (config.estado === 'activo') {
    const g = await leerGuardaDeEscritura(cuenta, ahora)
    if ('no' in g) {
      await anotarGuardaUnaVez(perfilId, g.no, inicioDelDiaLocal(hoy, d.zona), g.no === 'datos_viejos' ? 'Datos viejos: no mido ni deshago cambios' : 'Sin autorización en Amazon: no deshago cambios', g.motivo)
      return { hizoAlgo: false }
    }
  }
  const r = await medirEfectos(cuenta, ahora, {
    deshacer: (propuestaId, motivo, valorMaximo) => deshacerComoAgente(cuenta, d.zona, propuestaId, motivo, valorMaximo),
    // Lo que permite hoy el guardarraíl al DESHACER una subida de presupuesto: nunca por encima del presupuesto de hoy
    permitidoHoyPresupuesto: async (campaignId) => {
      try {
        const filas = await filasDeUso(perfilId, hoy, hoy)
        return filas.find((f) => f.campaignId === campaignId)?.presupuesto ?? null
      } catch {
        return null
      }
    },
    permitidoVolverBajada: (campaignId, actual, anterior) => permitidoParaVolverPresupuesto(cuenta, config, Date.now(), campaignId, actual, anterior),
    // Deshacer escribe en Amazon: solo con el agente activo (en ensayo y frenado, solo aviso)
    puedeDeshacer: config.estado === 'activo',
  })
  if (r.quedan) await actualizarAgente(perfilId, { efectos_resto: true })
  for (const x of r.deshechos) await anotarEvento(perfilId, 'deshacer_auto', x.texto.slice(0, 300), null, null, x.propuestaId)
  // Lo que la medición habría deshecho y NO se deshizo (falló, es una negativa, el agente está frenado o lo tocó una persona): a la línea y al canal, una vez por propuesta y día
  for (const x of r.soloAviso) {
    const fallo = /Intenté deshacerla y falló/.test(x.texto)
    await anotarEvento(perfilId, 'deshacer_fallo', `${fallo ? 'No he podido deshacer' : 'Sin deshacer'}: ${x.texto}`.slice(0, 300), null, null, x.propuestaId)
    await avisar(
      perfilId,
      'deshacer-fallo',
      hoy,
      {
        titulo: `${fallo ? 'No he podido deshacer un cambio' : 'Un cambio empeora y sigue aplicado'} · ${d.nombre}`.slice(0, 80),
        cuerpo: `${fallo ? '⚠️' : '👀'} **${fallo ? 'No he podido deshacer un cambio' : 'Un cambio empeora y sigue aplicado'}** · ${d.nombre}\n${x.texto.slice(0, 500)}\nRevísalo en Marketing Test → Agente.`,
      },
      { id: x.propuestaId, avisar: fallo },
    )
  }
  return { hizoAlgo: r.deshechos.length > 0 || r.soloAviso.length > 0 }
}

/* ---------------------------------------------------------------- calibrar ---------------------------------------------------------------- */

async function pasoCalibrar(cuenta: CuentaParaSincronizar, config: ConfigDelAgente): Promise<HechoDelPaso> {
  // El sello de este paso (`calibrado_at`) se puso ANTES de darlo: el config leído antes del sello trae el de la calibración ANTERIOR
  const r = await calibrarCuenta(cuenta.id, config.encendidoPor, config.marcas.calibradoAt)
  if (r.detalle.length > 0 || r.cambios > 0) {
    await anotarEvento(cuenta.id, 'calibracion', r.cambios > 0 ? `Calibración: ${r.cambios} umbral(es) ajustado(s) con lo medido` : 'Calibración: sin cambios', r.detalle.join('\n') || null, r)
  }
  return { hizoAlgo: false }
}

/* ---------------------------------------------------------------- un paso ---------------------------------------------------------------- */

async function darPaso(paso: PasoDelAgente, cuenta: CuentaParaSincronizar, config: ConfigDelAgente, d: DatosDeCuenta, hastaMs: number, momentoCerebro: 'manana' | 'tarde'): Promise<HechoDelPaso> {
  switch (paso) {
    case 'vigilar':
      return pasoVigilar(cuenta, config, d, hastaMs)
    case 'aplicar': {
      const r = await aplicarComoAgente(cuenta, config, hastaMs, Date.now())
      return {
        hizoAlgo: r.aplicadas + r.ensayadas + r.retenidas + r.descartadas + r.fallidas > 0,
        aplicadas: r.aplicadas,
        ensayadas: r.ensayadas,
        retenidas: r.retenidas,
        errores: r.fallidas > 0 ? [`aplicar: ${r.fallidas} fallida(s)${r.erroresQueCuentan ? `, ${r.erroresQueCuentan} de autorización` : ''}`] : [],
      }
    }
    case 'objetivos':
      return pasoObjetivos(cuenta, config, d)
    case 'cerebro':
      return pasoCerebro(cuenta, config, d, momentoCerebro)
    case 'resumen':
      return pasoResumen(cuenta, config, d)
    case 'efectos':
      return pasoEfectos(cuenta, config, d)
    case 'terminos_semana':
      await guardarTerminosDeLaSemana(cuenta.id, lunesLocal(horaLocal(Date.now(), d.zona).fecha))
      return { hizoAlgo: false }
    case 'calibrar':
      return pasoCalibrar(cuenta, config)
    default:
      return { hizoAlgo: false }
  }
}

/**
 * Un vigilar que ha lanzado: el freno no se ha evaluado (o se vio y no se pudo guardar). Se cuenta (`vigilar_fallos`), se anula `vigilar_ok_at` (aplicar no escribe hasta
 * el próximo vigilar bueno), se adelanta el reintento (camposDeVigilarFallido) y, a los `AGENTE.VIGILAR_FALLOS_FRENO` seguidos, se anota «vigilar_falla» una vez al día
 * (no se frena: frenarAgente ya no frena por esto, y antes se quedaba en un console.warn que nadie veía). Nunca lanza.
 */
async function vigilarFallido(perfilId: string, config: ConfigDelAgente, nombre: string, error: string, zona: string): Promise<void> {
  try {
    const ahora = Date.now()
    const campos = camposDeVigilarFallido(config.vigilarFallos, ahora)
    const fallos = campos.vigilar_fallos
    await actualizarAgente(perfilId, campos)
    if (fallos >= AGENTE.VIGILAR_FALLOS_FRENO && (config.estado === 'ensayo' || config.estado === 'activo')) {
      await anotarGuardaUnaVez(
        perfilId,
        'vigilar_falla',
        inicioDelDiaLocal(horaLocal(ahora, zona).fecha, zona),
        `No puedo vigilar «${nombre}»: ${fallos} intentos seguidos han fallado`,
        `Último error: «${error}». Sin vigilar no sé cuánto se gasta hoy: no aplico nada hasta que vuelva a ir bien (lo reintento cada pocos minutos).`,
        { fallos },
      )
    }
  } catch (e) {
    console.error(`[agente] no se ha podido apuntar el vigilar fallido de ${perfilId}:`, e instanceof Error ? e.message : e)
  }
}

/**
 * EL BUCLE (§2.3). Por cuenta: reserva, hasta 3 pasos que quepan en lo que queda de pasada, sello antes de cada paso, el paso en un try, y la reserva se suelta siempre.
 */
export async function correrAgente(cuentas: ReadonlyArray<{ cuenta: CuentaParaSincronizar; config: ConfigDelAgente }>, arranque: number, presupuestoMs: number): Promise<ResultadoDelAgente> {
  const salida: ResultadoDelAgente = { cuentas: 0, pasos: 0, aplicadas: 0, ensayadas: 0, retenidas: 0, errores: [], hizoAlgo: false, sinTiempo: 0 }
  const hastaMs = arranque + presupuestoMs

  for (const { cuenta } of cuentas) {
    if (Date.now() - arranque >= presupuestoMs) {
      salida.sinTiempo += 1
      continue
    }
    let tomada = false
    try {
      tomada = await tomarCuenta(cuenta.id)
    } catch (e) {
      salida.errores.push(`${cuenta.id.slice(0, 8)}: reserva: ${textoDe(e, 100)}`)
      salida.hizoAlgo = true
      continue
    }
    if (!tomada) continue // otra invocación la está trabajando
    salida.cuentas += 1

    let datos: DatosDeCuenta | null = null
    const intentados = new Set<PasoDelAgente>()
    try {
      for (let i = 0; i < AGENTE.MAX_PASOS_POR_CUENTA; i++) {
        // Estado fresco (los sellos y el estado cambian con cada paso)
        const config = await leerConfigDelAgente(cuenta.id)
        if (!config || config.estado === 'apagado') break
        if (!datos) {
          const n = await nombreDeCuenta(cuenta.id)
          datos = { nombre: n.nombre, pais: n.pais, moneda: n.moneda, zona: n.zona }
        }
        const ahora = Date.now()
        const paso = pasoDe(config, datos.zona, ahora, await pendientesDe(cuenta.id))
        if (!paso || intentados.has(paso)) break
        if (!pasoCabe(paso, ahora - arranque, presupuestoMs)) {
          salida.sinTiempo += 1
          break
        }
        intentados.add(paso)
        // El momento del cerebro se decide antes del sello (el sello apaga «Pensar ahora»)
        const momento: 'manana' | 'tarde' = !config.pensarYa && horaEnMadrid(ahora).hora >= AGENTE.HORA_CEREBRO_TARDE ? 'tarde' : 'manana'
        if (!(await reservarPaso(cuenta.id, paso, ahora, datos.zona))) continue // otro proceso lo acaba de hacer
        salida.pasos += 1
        try {
          const h = await darPaso(paso, cuenta, config, datos, hastaMs, momento)
          salida.aplicadas += h.aplicadas ?? 0
          salida.ensayadas += h.ensayadas ?? 0
          salida.retenidas += h.retenidas ?? 0
          for (const e of h.errores ?? []) salida.errores.push(`${datos.nombre}: ${e}`)
          if (h.hizoAlgo) salida.hizoAlgo = true
        } catch (e) {
          salida.errores.push(`${datos.nombre}: ${paso}: ${textoDe(e, 140)}`)
          salida.hizoAlgo = true
          console.error(`[agente] ${paso} de ${cuenta.id}:`, e)
          if (paso === 'vigilar') await vigilarFallido(cuenta.id, config, datos.nombre, textoDe(e, 300), datos.zona)
          // Tras un vigilar fallido no se da ningún paso más en esta cuenta en esta pasada (ni aplicar con un sello anterior)
          if (!seguirTrasPasoFallido(paso)) break
        }
      }
    } catch (e) {
      salida.errores.push(`${datos?.nombre ?? cuenta.id.slice(0, 8)}: ${textoDe(e, 140)}`)
      salida.hizoAlgo = true
    } finally {
      await soltarCuenta(cuenta.id)
    }
  }
  return salida
}
