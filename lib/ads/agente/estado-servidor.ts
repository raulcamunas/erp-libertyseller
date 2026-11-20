/**
 * AMAZON ADS · EL AGENTE PPC: ESTADO, INTERRUPTOR, RESERVAS Y HECHOS DEL DÍA. SOLO SERVIDOR.
 *
 *   ESTADO       `ads_agente` (una fila por cuenta): apagado → ensayo (3 días, no escribe) → activo (rampa de 7 días) ⇄ frenado. Lo enciende, apaga,
 *                reanuda y configura un administrador; lo frena el propio agente (o una persona). Encender pone `ads_motor_config.modo = 'agente'`
 *                DIRECTAMENTE (no pasa por motor.ts) con la misma comprobación que guardarModo: la ficha de cuenta tiene que estar firmada.
 *   INTERRUPTOR  `ads_agente_interruptor` (una fila) o la variable de entorno ADS_AGENTE_PARADO=1: con él, el agente no da ningún paso en ninguna cuenta.
 *                Si no se puede leer, se da por PARADO (un freno de emergencia falla cerrado).
 *   RESERVAS     `tomarCuenta` (trabajando_hasta, 330 s) para que dos pasadas no trabajen la misma cuenta, y `reservarPaso`: el sello del paso se pone
 *                ANTES de ejecutarlo con un UPDATE condicional atómico (si no devuelve fila, otro proceso ya lo hizo). Un proceso que muere a mitad
 *                no repite el paso cada 5 minutos.
 *   HECHOS       `hechosDeHoy`: cuántos cambios de cada clase ha hecho hoy (día LOCAL del marketplace) para los topes; en ensayo cuenta las ensayadas,
 *                en activo las aplicadas y las deshechas.
 *
 * Sin la migración 315 todo lanza Error(FALTA_MIGRACION_315), salvo `paradaGeneral` y `hayEscrituraRealEnAlgunaCuenta`, que contestan «no» (sin la
 * tabla no hay agente que parar), y `apagarAgente`, que apaga el modo del motor de todas formas.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { anotarCambio, firmarFicha, leerFicha } from '../cuenta'
import { textoDeFreno, textoDeTechoAuto, type HechoDeAviso } from './avisos-calculo'
import { claseDeCambio, claseDeTope, topesValidos } from './guardarrailes-calculo'
import { SIN_SELLO_DE_VIGILAR, ensayoAlReanudar, finDeEnsayo, horaEnMadrid, lunesLocal } from './pasos-calculo'
import { enVedaDeActivacion, eventosManualesValidos } from './temporada-calculo'
import { horaLocal, zonaDePais } from './uso-calculo'
import { anotarEvento, avisar } from './eventos-servidor'
import { caducarSubidasPendientes } from '../motor'
import {
  AGENTE,
  FALTA_MIGRACION_315,
  type ClaseDeTope,
  type ConfigDelAgente,
  type EstadoDelAgente,
  type EventoDeTemporada,
  type FaseDeProducto,
  type MotivoDeFreno,
  type PasoDelAgente,
  type Presion,
  type RitmoDelMes,
} from './tipos'

// ---------------------------------------------------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------------------------------------------------

type ErrorDeBase = { code?: string; message?: string } | null | undefined

const MIN_MS = 60_000
const HORA_MS = 3_600_000
const DIA_MS = 86_400_000

/** Sin la 315: tabla o columna que no existe, o un CHECK que aún no admite los valores nuevos ('agente', 'ensayada'…) */
const faltaLa315 = (e: ErrorDeBase): boolean => !!e && (isMissingSchema(e) || e.code === '23514')

/** Traduce el error de la base: sin la 315 → FALTA_MIGRACION_315; si no, el mensaje tal cual */
function lanzar(e: ErrorDeBase, que: string): never {
  if (faltaLa315(e)) throw new Error(FALTA_MIGRACION_315)
  throw new Error(`${que}: ${e?.message ?? 'error desconocido'}`)
}

const ahoraIso = (ms: number = Date.now()) => new Date(ms).toISOString()

const numOpc = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const fechaOpc = (v: unknown): string | null => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null)
const textoOpc = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

const ESTADOS: readonly EstadoDelAgente[] = ['apagado', 'ensayo', 'activo', 'frenado']
const MOTIVOS: readonly MotivoDeFreno[] = ['gasto_disparado', 'acos_cuenta', 'errores_amazon', 'datos_viejos', 'ventas_caidas', 'manual']
const RITMOS: readonly RitmoDelMes[] = ['recorte', 'normal', 'crecer']

const esMotivo = (v: unknown): v is MotivoDeFreno => typeof v === 'string' && (MOTIVOS as readonly string[]).includes(v)
const esRitmo = (v: unknown): v is RitmoDelMes => typeof v === 'string' && (RITMOS as readonly string[]).includes(v)

/** Valor entre comillas para los filtros `or` de PostgREST (las fechas ISO llevan «.» y «:», que allí son reservados) */
const comillas = (v: string) => `"${v.replace(/"/g, '')}"`

const TEXTO_DE_MOTIVO: Record<MotivoDeFreno, string> = {
  gasto_disparado: 'gasto disparado',
  acos_cuenta: 'ACoS de la cuenta',
  errores_amazon: 'errores de Amazon',
  datos_viejos: 'datos viejos',
  ventas_caidas: 'ventas hundidas',
  manual: 'a mano',
}

// ---------------------------------------------------------------------------------------------------------------------
// Leer la configuración
// ---------------------------------------------------------------------------------------------------------------------

const COLUMNAS_AGENTE =
  'perfil_id, estado, encendido_at, encendido_por, ensayo_hasta, activo_desde, rampa_desde, frenado_at, freno_motivo, freno_detalle, ignorar_freno_motivo, ignorar_freno_hasta, ' +
  'acos7_inicio, topes, tope_ia_usd_mes, puja_max, pico_eventos, eventos_manuales, presion, presion_fecha, ritmo, ritmo_fecha, ritmo_cambiado_at, ritmo_mes_anterior, recorte_desde, recorte_presupuestos, ' +
  'techo_mensual, techo_automatico, techo_congelado_at, suma_presupuestos_inicio, uso_error, uso_error_at, primera_escritura_at, raras_sin_ia, pensar_ya, ' +
  'vigilar_at, aplicar_at, cerebro_at, cerebro_tarde_dia, resumen_dia, efectos_dia, efectos_resto, objetivos_dia, terminos_semana, limpieza_dia, calibrado_at, vigilar_ok_at, vigilar_fallos'

/** La presión guardada (jsonb {campaignId: 'subir'|'bajar'}), solo con valores válidos */
function presionValida(crudo: unknown): Record<string, Presion> {
  const r: Record<string, Presion> = {}
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return r
  for (const [k, v] of Object.entries(crudo as Record<string, unknown>)) if (v === 'subir' || v === 'bajar') r[k] = v
  return r
}

/** Los presupuestos guardados (jsonb {campaignId: número}), solo con números > 0 */
function presupuestosValidos(crudo: unknown): Record<string, number> {
  const r: Record<string, number> = {}
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return r
  for (const [k, v] of Object.entries(crudo as Record<string, unknown>)) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    if (Number.isFinite(n) && n > 0) r[k] = n
  }
  return r
}

/** PURO. De la fila de `ads_agente` a ConfigDelAgente */
function configDeFila(f: Record<string, unknown>): ConfigDelAgente {
  const motivoIgnorar = f.ignorar_freno_motivo
  const hastaIgnorar = textoOpc(f.ignorar_freno_hasta)
  return {
    perfilId: String(f.perfil_id),
    estado: ESTADOS.includes(f.estado as EstadoDelAgente) ? (f.estado as EstadoDelAgente) : 'apagado',
    encendidoAt: textoOpc(f.encendido_at),
    encendidoPor: textoOpc(f.encendido_por),
    ensayoHasta: textoOpc(f.ensayo_hasta),
    activoDesde: textoOpc(f.activo_desde),
    rampaDesde: textoOpc(f.rampa_desde),
    frenadoAt: textoOpc(f.frenado_at),
    frenoMotivo: esMotivo(f.freno_motivo) ? f.freno_motivo : null,
    frenoDetalle: textoOpc(f.freno_detalle),
    ignorarFreno: esMotivo(motivoIgnorar) && hastaIgnorar ? { motivo: motivoIgnorar, hasta: hastaIgnorar } : null,
    acos7Inicio: numOpc(f.acos7_inicio),
    topes: topesValidos(f.topes),
    topeIaUsdMes: numOpc(f.tope_ia_usd_mes) ?? AGENTE.IA_TOPE_USD_MES,
    pujaMax: numOpc(f.puja_max),
    picoEventos: f.pico_eventos === true,
    eventosManuales: eventosManualesValidos(f.eventos_manuales),
    presion: presionValida(f.presion),
    presionFecha: fechaOpc(f.presion_fecha),
    ritmo: esRitmo(f.ritmo) ? f.ritmo : 'normal',
    ritmoFecha: fechaOpc(f.ritmo_fecha),
    ritmoCambiadoAt: textoOpc(f.ritmo_cambiado_at),
    ritmoMesAnterior: esRitmo(f.ritmo_mes_anterior) ? f.ritmo_mes_anterior : null,
    recorteDesde: fechaOpc(f.recorte_desde),
    recortePresupuestos: presupuestosValidos(f.recorte_presupuestos),
    techoMensual: numOpc(f.techo_mensual),
    techoAutomatico: f.techo_automatico === true,
    techoCongeladoAt: textoOpc(f.techo_congelado_at),
    sumaPresupuestosInicio: numOpc(f.suma_presupuestos_inicio),
    usoError: textoOpc(f.uso_error),
    usoErrorAt: textoOpc(f.uso_error_at),
    primeraEscrituraAt: textoOpc(f.primera_escritura_at),
    rarasSinIa: Math.max(0, Math.round(numOpc(f.raras_sin_ia) ?? 0)),
    pensarYa: f.pensar_ya === true,
    marcas: {
      vigilarAt: textoOpc(f.vigilar_at),
      aplicarAt: textoOpc(f.aplicar_at),
      cerebroAt: textoOpc(f.cerebro_at),
      cerebroTardeDia: fechaOpc(f.cerebro_tarde_dia),
      resumenDia: fechaOpc(f.resumen_dia),
      efectosDia: fechaOpc(f.efectos_dia),
      efectosResto: f.efectos_resto === true,
      objetivosDia: fechaOpc(f.objetivos_dia),
      terminosSemana: fechaOpc(f.terminos_semana),
      limpiezaDia: fechaOpc(f.limpieza_dia),
      calibradoAt: textoOpc(f.calibrado_at),
    },
    vigilarOkAt: textoOpc(f.vigilar_ok_at),
    vigilarFallos: Math.max(0, Math.round(numOpc(f.vigilar_fallos) ?? 0)),
  }
}

/** La configuración del agente de la cuenta. null si nunca se ha encendido (sin fila); lanza Error(FALTA_MIGRACION_315) sin la tabla */
export async function leerConfigDelAgente(perfilId: string): Promise<ConfigDelAgente | null> {
  const { data, error } = await createServiceClient().from('ads_agente').select(COLUMNAS_AGENTE).eq('perfil_id', perfilId).maybeSingle()
  if (error) lanzar(error, 'No se ha podido leer el agente de la cuenta')
  return data ? configDeFila(data as unknown as Record<string, unknown>) : null
}

/** Lo mismo, pero sin fila es un error (para devolver la configuración tras escribirla) */
async function configObligatoria(perfilId: string): Promise<ConfigDelAgente> {
  const c = await leerConfigDelAgente(perfilId)
  if (!c) throw new Error('El agente de esta cuenta no existe.')
  return c
}

/** Escribe columnas de `ads_agente` (siempre con updated_at). Lanza con el error traducido */
async function escribirAgente(perfilId: string, campos: Record<string, unknown>, que: string): Promise<void> {
  const { error } = await createServiceClient()
    .from('ads_agente')
    .update({ ...campos, updated_at: ahoraIso() })
    .eq('perfil_id', perfilId)
  if (error) lanzar(error, que)
}

// ---------------------------------------------------------------------------------------------------------------------
// La cuenta: país, zona y nombre para los avisos
// ---------------------------------------------------------------------------------------------------------------------

const nombresDePais = (() => {
  try {
    return new Intl.DisplayNames(['es'], { type: 'region' })
  } catch {
    return null
  }
})()

function nombreDePais(pais: string): string {
  const p = pais.trim().toUpperCase() === 'UK' ? 'GB' : pais.trim().toUpperCase()
  if (!p) return ''
  try {
    return nombresDePais?.of(p) ?? p
  } catch {
    return p
  }
}

/** País, moneda, zona y «<cliente> · <país>» de la cuenta (para la veda y los avisos). Nunca lanza: sin datos, «Cuenta · ES» */
async function datosDeCuenta(perfilId: string): Promise<{ pais: string; moneda: string | null; zona: string; nombreCuenta: string }> {
  const service = createServiceClient()
  let pais = ''
  let moneda: string | null = null
  let zonaPerfil: string | null = null
  let nombre: string | null = null
  try {
    const { data } = await service.from('ads_profiles').select('pais, moneda, zona_horaria, nombre, connection_id').eq('id', perfilId).maybeSingle()
    const p = data as { pais: string | null; moneda: string | null; zona_horaria: string | null; nombre: string | null; connection_id: string | null } | null
    pais = (p?.pais ?? '').toUpperCase()
    moneda = p?.moneda ?? null
    zonaPerfil = p?.zona_horaria ?? null
    nombre = p?.nombre ?? null
    if (p?.connection_id) {
      const { data: con } = await service.from('ads_connections').select('client_id').eq('id', p.connection_id).maybeSingle()
      const clienteId = (con as { client_id: string | null } | null)?.client_id
      if (clienteId) {
        const { data: cli } = await service.from('amazon_clients').select('name').eq('id', clienteId).maybeSingle()
        nombre = (cli as { name: string | null } | null)?.name ?? nombre
      }
    }
  } catch (e) {
    console.error('Agente PPC: no se han podido leer los datos de la cuenta:', e instanceof Error ? e.message : e)
  }
  const paisTexto = nombreDePais(pais)
  return { pais, moneda, zona: zonaDePais(pais, zonaPerfil), nombreCuenta: [nombre ?? 'Cuenta', paisTexto].filter(Boolean).join(' · ') }
}

// ---------------------------------------------------------------------------------------------------------------------
// El modo del motor (escrito aquí, sin pasar por motor.ts)
// ---------------------------------------------------------------------------------------------------------------------

type ModoQueEscribe = 'agente' | 'aprueba' | 'sugiere'

const TEXTO_DE_MODO: Record<string, string> = {
  apagado: 'Apagado',
  sugiere: 'Solo sugiere',
  aprueba: 'Aprueba y aplica',
  autopiloto: 'Piloto automático',
  agente: 'Agente PPC',
}

async function leerModoActual(perfilId: string): Promise<string | null> {
  const { data, error } = await createServiceClient().from('ads_motor_config').select('modo').eq('perfil_id', perfilId).maybeSingle()
  if (error) return null
  return (data as { modo: string } | null)?.modo ?? null
}

/** Exige la ficha firmada (lo mismo que guardarModo para «aprueba»/«autopiloto»); si se pide, la firma */
async function exigirFichaFirmada(perfilId: string, userId: string, firmar: boolean): Promise<boolean> {
  const ficha = await leerFicha(perfilId)
  if (ficha.firmadaAt) return false
  if (!firmar) throw new Error('Para encender el agente, la ficha de cuenta tiene que estar firmada (pestaña «Ficha de cuenta»).')
  await firmarFicha(perfilId, userId)
  return true
}

/** Upsert de ads_motor_config.modo. Devuelve el modo anterior. 'agente' sin la 315 (CHECK) → FALTA_MIGRACION_315 */
async function escribirModo(perfilId: string, modo: ModoQueEscribe, userId: string | null): Promise<string | null> {
  const anterior = await leerModoActual(perfilId)
  const { error } = await createServiceClient()
    .from('ads_motor_config')
    .upsert({ perfil_id: perfilId, modo, updated_by: userId, updated_at: ahoraIso() }, { onConflict: 'perfil_id' })
  if (error) lanzar(error, 'No se ha podido cambiar el modo del motor')
  return anterior
}

/** Apunta en el log de la cuenta el cambio de modo (nunca lanza: anotarCambio no lanza) */
async function anotarModo(perfilId: string, anterior: string | null, nuevo: string, motivo: string, userId: string | null): Promise<void> {
  if (anterior === nuevo) return
  await anotarCambio({
    perfilId,
    entidad: 'motor',
    accion: 'cambiar',
    campo: 'modo del motor automático',
    valorAnterior: anterior,
    valorNuevo: nuevo,
    motivo,
    // El origen «agente» llega con la 315 y el paquete del motor; lo que hace una persona es «manual» y el freno, «automatico» con [AGENTE] delante
    origen: userId ? 'manual' : 'automatico',
    userId,
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// Interruptor general
// ---------------------------------------------------------------------------------------------------------------------

/**
 * ¿Está el agente parado en TODAS las cuentas? Por la variable de entorno ADS_AGENTE_PARADO=1 o por la fila del interruptor. Sin la 315, no
 * (no hay agente). Si la fila no se puede leer por otra cosa, SÍ (falla cerrado: antes de escribir en Amazon se pregunta esto).
 */
export async function paradaGeneral(): Promise<{ parado: boolean; motivo: string | null; porEntorno: boolean }> {
  if (process.env.ADS_AGENTE_PARADO === '1') return { parado: true, motivo: 'Parado en el servidor (variable ADS_AGENTE_PARADO=1).', porEntorno: true }
  try {
    const { data, error } = await createServiceClient().from('ads_agente_interruptor').select('parado, motivo').eq('id', 1).maybeSingle()
    if (error) {
      if (isMissingSchema(error)) return { parado: false, motivo: null, porEntorno: false }
      return { parado: true, motivo: `No se ha podido leer el interruptor general (${error.message}): el agente no escribe hasta que se pueda.`, porEntorno: false }
    }
    const f = data as { parado: boolean; motivo: string | null } | null
    return { parado: f?.parado === true, motivo: f?.parado ? f.motivo ?? 'Parado por un administrador.' : null, porEntorno: false }
  } catch (e) {
    return { parado: true, motivo: `No se ha podido leer el interruptor general (${e instanceof Error ? e.message : String(e)}): el agente no escribe hasta que se pueda.`, porEntorno: false }
  }
}

/** Para (o deja seguir) el agente en todas las cuentas. Apunta el evento en cada cuenta con el agente encendido */
export async function cambiarParadaGeneral(parar: boolean, motivo: string | null, userId: string): Promise<void> {
  const service = createServiceClient()
  const texto = (motivo ?? '').trim().slice(0, 500) || null
  const { error } = await service
    .from('ads_agente_interruptor')
    .upsert({ id: 1, parado: parar, motivo: parar ? texto : null, por: userId, cambiado_at: ahoraIso() }, { onConflict: 'id' })
  if (error) lanzar(error, 'No se ha podido cambiar el interruptor general')

  const { data } = await service.from('ads_agente').select('perfil_id').neq('estado', 'apagado')
  const titulo = parar ? 'Interruptor general: agente parado en todas las cuentas' : 'Interruptor general: el agente vuelve a trabajar'
  await Promise.all(((data ?? []) as Array<{ perfil_id: string }>).map((f) => anotarEvento(f.perfil_id, 'parada_general', titulo, texto, { parado: parar, por: userId })))
}

/** ¿Ha escrito ya el agente de verdad en Amazon en alguna cuenta? (sin eso, ninguna puede saltarse el ensayo) */
export async function hayEscrituraRealEnAlgunaCuenta(): Promise<boolean> {
  const { data, error } = await createServiceClient().from('ads_agente').select('perfil_id').not('primera_escritura_at', 'is', null).limit(1)
  if (error) return false
  return (data ?? []).length > 0
}

/** Si se puede pasar ya a activo sin ensayo: hace falta una escritura real previa en alguna cuenta y estar fuera de la veda de temporada */
async function exigirQueSePuedeSaltarElEnsayo(pais: string, zona: string, manuales: readonly EventoDeTemporada[], ahora: number): Promise<void> {
  if (!(await hayEscrituraRealEnAlgunaCuenta())) throw new Error('La primera cuenta del agente tiene que pasar el ensayo.')
  const veda = enVedaDeActivacion(horaLocal(ahora, zona).fecha, pais, manuales)
  if (veda) throw new Error(`No se puede saltar el ensayo durante la veda de ${veda.nombre} (hasta el ${veda.hasta}): el ensayo puede seguir, pero no se activa hasta que acabe.`)
}

// ---------------------------------------------------------------------------------------------------------------------
// Encender, apagar, saltar el ensayo, activar, reanudar, frenar
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Enciende el agente en la cuenta: ficha firmada (la firma si se pide), modo del motor 'agente', estado 'ensayo' (3 días) o 'activo' (si se salta
 * el ensayo: exige una escritura real previa en alguna cuenta y estar fuera de la veda). Guarda los datos de partida (suma de presupuestos, ACoS 7 d)
 * y el techo: el automático se CONGELA y solo se revisa una vez al mes, como mucho +25 % (si ya había uno automático, se queda).
 */
export async function encenderAgente(
  perfilId: string,
  userId: string,
  opciones: { saltarEnsayo: boolean; firmarFicha: boolean; datos: { sumaPresupuestos: number | null; acos7: number | null; techo: { techo: number | null; automatico: boolean; detalle: string } } },
): Promise<ConfigDelAgente> {
  const ahora = Date.now()
  const previo = await leerConfigDelAgente(perfilId)
  if (previo && previo.estado !== 'apagado') {
    throw new Error(previo.estado === 'frenado' ? 'El agente de esta cuenta está frenado: usa «Reanudar».' : 'El agente de esta cuenta ya está encendido.')
  }
  const cuenta = await datosDeCuenta(perfilId)
  // Sin ensayo ni veda de temporada: se enciende activo siempre (20 nov 2026, Raúl)
  const firmada = await exigirFichaFirmada(perfilId, userId, opciones.firmarFicha)
  // Lo que SUBE y quedó pendiente del modo anterior se creó sin los frenos del agente (subidaPermitida, R1): se caduca ANTES de encender (si falla, no se enciende)
  const caducadas = await caducarSubidasPendientes(perfilId, 'se enciende el agente: las subidas pendientes del modo anterior no pasaron sus frenos')

  // El techo: uno automático ya congelado se queda; si no, el de los datos de encendido (congelado si es automático)
  const t = opciones.datos.techo
  const seQuedaElTecho = !!previo && previo.techoAutomatico && previo.techoMensual != null && t.automatico
  const congelaAhora = !seQuedaElTecho && t.automatico
  const techo = seQuedaElTecho
    ? { techo_mensual: previo!.techoMensual, techo_automatico: true, techo_congelado_at: previo!.techoCongeladoAt }
    : { techo_mensual: t.techo, techo_automatico: t.automatico, techo_congelado_at: t.automatico && t.techo != null ? ahoraIso(ahora) : null }

  const salta = true
  const fila = {
    perfil_id: perfilId,
    estado: salta ? 'activo' : 'ensayo',
    encendido_at: ahoraIso(ahora),
    encendido_por: userId,
    ensayo_hasta: finDeEnsayo(ahora, salta),
    activo_desde: salta ? ahoraIso(ahora) : null,
    rampa_desde: null,
    frenado_at: null,
    freno_motivo: null,
    freno_detalle: null,
    ignorar_freno_motivo: null,
    ignorar_freno_hasta: null,
    vigilar_fallos: 0,
    // Sin el sello de vigilar de una sesión anterior: el primer paso es un vigilar que evalúa el freno, y aplicar no escribe hasta que termine bien
    ...SIN_SELLO_DE_VIGILAR,
    acos7_inicio: opciones.datos.acos7 == null || !Number.isFinite(opciones.datos.acos7) ? null : Math.round(opciones.datos.acos7 * 100) / 100,
    suma_presupuestos_inicio:
      opciones.datos.sumaPresupuestos == null || !Number.isFinite(opciones.datos.sumaPresupuestos) ? null : Math.round(opciones.datos.sumaPresupuestos * 100) / 100,
    ...techo,
    pensar_ya: false,
    trabajando_hasta: null,
    updated_at: ahoraIso(ahora),
  }
  const { error } = await createServiceClient().from('ads_agente').upsert(fila, { onConflict: 'perfil_id' })
  if (error) lanzar(error, 'No se ha podido encender el agente')

  // El modo del motor, después: si falla, el agente se vuelve a apagar (no puede quedar encendido sin el modo 'agente')
  let modoAnterior: string | null
  try {
    modoAnterior = await escribirModo(perfilId, 'agente', userId)
  } catch (e) {
    await createServiceClient().from('ads_agente').update({ estado: 'apagado', updated_at: ahoraIso() }).eq('perfil_id', perfilId)
    throw e
  }

  const comoArranca = salta ? 'sin ensayo (activo desde ya, con rampa de 7 días)' : `en ensayo ${AGENTE.DIAS_DE_ENSAYO} días (no escribe en Amazon)`
  await anotarModo(perfilId, modoAnterior, 'agente', `Un administrador enciende el agente PPC ${comoArranca}${firmada ? ' · firma la ficha de cuenta' : ''}`, userId)
  await anotarEvento(perfilId, 'encendido', `Agente encendido ${comoArranca}`, firmada ? 'Se ha firmado la ficha de cuenta al encender.' : null, {
    por: userId,
    modoAnterior,
    sumaPresupuestosInicio: fila.suma_presupuestos_inicio,
    acos7Inicio: fila.acos7_inicio,
    techo: techo.techo_mensual,
    techoAutomatico: techo.techo_automatico,
    // Subidas pendientes del modo anterior caducadas al encender (se crearon sin los frenos del agente)
    caducadas,
  })
  if (salta) await anotarEvento(perfilId, 'ensayo_saltado', 'Se salta el ensayo', 'Lo ha decidido un administrador al encender.', { por: userId })

  if (congelaAhora) {
    await anotarEvento(perfilId, 'techo_auto', t.techo == null ? 'Sin techo de gasto: nada sube' : 'Techo mensual automático congelado', t.detalle || null, { techo: t.techo })
    await avisar(perfilId, 'techo-auto', horaEnMadrid(ahora).fecha, textoDeTechoAuto({ nombreCuenta: cuenta.nombreCuenta, techo: t.techo, detalle: t.detalle, moneda: cuenta.moneda }))
  }
  return configObligatoria(perfilId)
}

/** Apaga el agente y deja el motor en «Solo sugiere» o «Aprueba y aplica» (sin ficha firmada, «Solo sugiere»). Nunca se queda a medias por falta de la 315 */
export async function apagarAgente(perfilId: string, userId: string, modoNuevo: 'sugiere' | 'aprueba'): Promise<void> {
  // Primero el estado: es lo que para el bucle del agente
  const { error } = await createServiceClient()
    .from('ads_agente')
    .update({ estado: 'apagado', pensar_ya: false, updated_at: ahoraIso() })
    .eq('perfil_id', perfilId)
  if (error && !faltaLa315(error)) lanzar(error, 'No se ha podido apagar el agente')

  let modo: ModoQueEscribe = modoNuevo
  if (modo === 'aprueba') {
    const ficha = await leerFicha(perfilId).catch(() => null)
    if (!ficha?.firmadaAt) modo = 'sugiere'
  }
  const anterior = await escribirModo(perfilId, modo, userId)
  const nota = modo !== modoNuevo ? ' (la ficha no está firmada: se queda en «Solo sugiere»)' : ''
  await anotarModo(perfilId, anterior, modo, `Un administrador apaga el agente PPC y deja el motor en «${TEXTO_DE_MODO[modo]}»${nota}`, userId)
  await anotarEvento(perfilId, 'apagado', `Agente apagado: el motor queda en «${TEXTO_DE_MODO[modo]}»`, nota.trim() || null, { por: userId, modoAnterior: anterior, modo })
}

/**
 * Al pasar a ACTIVO, lo ensayado sale de las cuarentenas: a las «ensayada» se les quita resuelta_at (siguen «ensayada» para la historia, que se filtra por agente_at).
 * Así la generación siguiente vuelve a proponer lo que el ensayo vio necesario (negativas, bajadas, pausas) y el agente lo aplica de verdad, en vez de esperar 14 días.
 * Nunca lanza: si falla, se anota en consola (lo peor es la espera de la cuarentena).
 */
async function sacarEnsayadasDeLaCuarentena(perfilId: string): Promise<void> {
  try {
    const { error } = await createServiceClient().from('ads_propuestas').update({ resuelta_at: null }).eq('perfil_id', perfilId).eq('estado', 'ensayada').not('resuelta_at', 'is', null)
    if (error) console.error(`[agente] ${perfilId}: no se han podido sacar las ensayadas de la cuarentena:`, error.message)
  } catch (e) {
    console.error(`[agente] ${perfilId}: no se han podido sacar las ensayadas de la cuarentena:`, e instanceof Error ? e.message : e)
  }
}

/** En ensayo → activo ya (rampa desde hoy). Exige una escritura real previa en alguna cuenta y estar fuera de la veda */
export async function saltarEnsayo(perfilId: string, userId: string): Promise<void> {
  const config = await configObligatoria(perfilId)
  if (config.estado !== 'ensayo') throw new Error('El agente no está en ensayo.')
  const cuenta = await datosDeCuenta(perfilId)
  const ahora = Date.now()
  void cuenta // sin veda de temporada (20 nov 2026, Raúl)
  // Antes de pasar a activo: las subidas pendientes (de antes de encender o con datos del ensayo) se caducan; si siguen haciendo falta, se vuelven a proponer
  await caducarSubidasPendientes(perfilId, 'se salta el ensayo: las subidas pendientes se vuelven a proponer con los datos de ahora')
  const { data, error } = await createServiceClient()
    .from('ads_agente')
    .update({ estado: 'activo', activo_desde: ahoraIso(ahora), rampa_desde: null, ensayo_hasta: ahoraIso(ahora), updated_at: ahoraIso(ahora) })
    .eq('perfil_id', perfilId)
    .eq('estado', 'ensayo')
    .select('perfil_id')
  if (error) lanzar(error, 'No se ha podido saltar el ensayo')
  if (!data || data.length === 0) throw new Error('El agente ya no está en ensayo.')
  await sacarEnsayadasDeLaCuarentena(perfilId)
  await anotarEvento(perfilId, 'ensayo_saltado', 'Se salta el ensayo: activo desde ya (rampa de 7 días)', null, { por: userId })
}

/**
 * Fin del ensayo: ensayo → activo, con activo_desde = rampa_desde = ahora. Solo si sigue en ensayo (dos pasadas no lo hacen dos veces).
 * El evento «ensayo_fin» y el aviso (con lo que habría hecho) los pone quien lo llama, que tiene las cuentas.
 * Igual que `saltarEnsayo`: ANTES de pasar, las subidas pendientes (calculadas con datos del ensayo, de hasta 3 días) se caducan; si siguen haciendo falta, el motor
 * las vuelve a proponer con los datos de ahora. Si caducar falla, lanza y NO pasa a activo (el vigilar cuenta como fallido y el siguiente lo reintenta): lo prudente
 * es no empezar a escribir con subidas viejas. Caducar estando aún en ensayo no hace daño (se vuelven a proponer).
 */
export async function pasarAActivo(perfilId: string, ahora: number): Promise<void> {
  await caducarSubidasPendientes(perfilId, 'termina el ensayo: las subidas pendientes se vuelven a proponer con los datos de ahora')
  const { data, error } = await createServiceClient()
    .from('ads_agente')
    .update({ estado: 'activo', activo_desde: ahoraIso(ahora), rampa_desde: null, updated_at: ahoraIso(ahora) })
    .eq('perfil_id', perfilId)
    .eq('estado', 'ensayo')
    .select('perfil_id')
  if (error) lanzar(error, 'No se ha podido pasar el agente a activo')
  if (data && data.length > 0) await sacarEnsayadasDeLaCuarentena(perfilId)
}

/**
 * Reanuda un agente frenado: modo 'agente' y rampa al día 2 (rampa_desde = ahora − 1 día). Si se pide, ignora ese motivo de freno 24 h.
 * Si se frenó en el ENSAYO (nunca llegó a activo), vuelve al ensayo COMPLETO (`ensayoAlReanudar`: ensayo_hasta = ahora + 3 días): reanudar no es una forma de saltárselo,
 * y sin tocar ensayo_hasta el siguiente vigilar lo pasaría a activo en cuanto el freno hubiera durado más que lo que quedaba de ensayo.
 * Comprobar que ningún motivo sigue (frenosActuales + decisionDeReanudar → 409) es cosa de la API, antes de llamar aquí.
 */
export async function reanudarAgente(perfilId: string, userId: string, ignorar: MotivoDeFreno | null): Promise<void> {
  const config = await configObligatoria(perfilId)
  if (config.estado !== 'frenado') throw new Error('El agente no está frenado.')
  await exigirFichaFirmada(perfilId, userId, false)
  const ahora = Date.now()
  const volverAlEnsayo = !config.activoDesde
  // ANTES de reanudar: lo que sube y sigue pendiente se creó con el motor en «Aprueba y aplica» (sin subidaPermitida ni R1) o antes del freno, con datos de otro
  // momento. Se caduca; si sigue haciendo falta, se vuelve a proponer con los frenos del agente. Si falla, no se reanuda
  const caducadas = await caducarSubidasPendientes(perfilId, 'se reanuda el agente: las subidas pendientes son de antes o de durante el freno')
  const { data, error } = await createServiceClient()
    .from('ads_agente')
    .update({
      // Sin ensayo ni rampa (20 nov 2026, Raúl): reanudar es activo desde ya
      estado: 'activo',
      rampa_desde: null,
      ...(volverAlEnsayo ? { activo_desde: ahoraIso(ahora), ensayo_hasta: ahoraIso(ahora) } : {}),
      freno_motivo: null,
      freno_detalle: null,
      ignorar_freno_motivo: ignorar,
      ignorar_freno_hasta: ignorar ? ahoraIso(ahora + AGENTE.FRENO_IGNORAR_HORAS * HORA_MS) : null,
      // La cuenta de vigilar fallidos empieza de cero (si el freno fue por ellos, el siguiente fallo no vuelve a frenar enseguida)
      vigilar_fallos: 0,
      // Sin sello de vigilar: el de antes se puso en frenado, donde el freno NO se evalúa. El siguiente paso es un vigilar que lo evalúa con el «ignorar» nuevo,
      // y aplicar no escribe en Amazon hasta que ese vigilar termine bien (vigilarReciente)
      ...SIN_SELLO_DE_VIGILAR,
      updated_at: ahoraIso(ahora),
    })
    .eq('perfil_id', perfilId)
    .eq('estado', 'frenado')
    .select('perfil_id')
  if (error) lanzar(error, 'No se ha podido reanudar el agente')
  if (!data || data.length === 0) throw new Error('El agente ya no está frenado.')

  // El modo del motor, después: si falla, la fila vuelve a «frenado» tal como estaba (motivo, detalle, rampa, ensayo, ignorar, fallos). Si no, quedaría «Activo»
  // en la base y en la pantalla con el motor en «Aprueba y aplica»: cuentasDelAgente la deja fuera del bucle (no vigila, no frena, no avisa) y ya no se
  // podría pulsar «Reanudar». Igual que encenderAgente vuelve a «apagado»
  let anterior: string | null
  try {
    anterior = await escribirModo(perfilId, 'agente', userId)
  } catch (e) {
    const { error: eVuelta } = await createServiceClient()
      .from('ads_agente')
      .update({
        estado: 'frenado',
        rampa_desde: config.rampaDesde,
        ensayo_hasta: config.ensayoHasta,
        freno_motivo: config.frenoMotivo,
        freno_detalle: config.frenoDetalle,
        ignorar_freno_motivo: config.ignorarFreno?.motivo ?? null,
        ignorar_freno_hasta: config.ignorarFreno?.hasta ?? null,
        vigilar_fallos: config.vigilarFallos,
        updated_at: ahoraIso(),
      })
      .eq('perfil_id', perfilId)
      .in('estado', ['activo', 'ensayo'])
    if (eVuelta) console.error(`Agente PPC: no se ha podido devolver a «frenado» tras fallar el modo del motor al reanudar (${perfilId}):`, eVuelta.message)
    throw e
  }
  const comoSigue = volverAlEnsayo ? 'vuelve al ensayo' : 'activo, con la rampa en el día 2'
  const ignora = ignorar ? ` · ignora «${TEXTO_DE_MOTIVO[ignorar]}» ${AGENTE.FRENO_IGNORAR_HORAS} h` : ''
  await anotarModo(perfilId, anterior, 'agente', `Un administrador reanuda el agente PPC (${comoSigue})${ignora}`, userId)
  await anotarEvento(
    perfilId,
    'reanudado',
    `Agente reanudado: ${comoSigue}`,
    config.frenoMotivo ? `Estaba frenado por ${TEXTO_DE_MOTIVO[config.frenoMotivo]}${config.frenoDetalle ? `: ${config.frenoDetalle}` : ''}.${ignora ? ` Se ignora ese motivo ${AGENTE.FRENO_IGNORAR_HORAS} h.` : ''}` : null,
    { por: userId, motivoAnterior: config.frenoMotivo, ignorar, caducadas },
  )
}

/** El hecho del aviso según el motivo del freno */
const HECHO_DE_FRENO: Record<MotivoDeFreno, HechoDeAviso> = {
  gasto_disparado: 'freno',
  acos_cuenta: 'freno',
  errores_amazon: 'errores',
  ventas_caidas: 'ventas-caidas',
  datos_viejos: 'freno',
  manual: 'freno',
}

/**
 * Frena el agente (ensayo o activo → frenado): motivo y detalle, el motor a «Aprueba y aplica», evento y aviso inmediato. Si ya estaba frenado
 * o apagado no hace nada (ni avisa dos veces). `deshechas`: cuántas subidas ha deshecho ya quien frena (va en el aviso).
 */
export async function frenarAgente(perfilId: string, motivo: MotivoDeFreno, detalle: string, nombreCuenta: string, deshechas: number, deshacer?: { noDeshechas: number; quedan: number }): Promise<void> {
  // Solo frena un administrador a mano (Raúl, 20 nov 2026: «que no frene nunca, ni sistema de seguridad ni ensayos»). Lo demás se apunta y sigue
  if (motivo !== 'manual') {
    console.warn(`[agente] ${perfilId}: no se frena (${motivo}): ${detalle.slice(0, 200)}`)
    return
  }
  const ahora = Date.now()
  const texto = (detalle ?? '').trim().slice(0, 2000)
  const { data, error } = await createServiceClient()
    .from('ads_agente')
    .update({ estado: 'frenado', frenado_at: ahoraIso(ahora), freno_motivo: motivo, freno_detalle: texto || null, pensar_ya: false, updated_at: ahoraIso(ahora) })
    .eq('perfil_id', perfilId)
    .in('estado', ['ensayo', 'activo'])
    .select('perfil_id')
  if (error) lanzar(error, 'No se ha podido frenar el agente')
  if (!data || data.length === 0) return

  // Las subidas pendientes se caducan: nacieron antes del freno (R1 de «se agota hoy», pujas…) y al reanudar ya serían de otro día. Nunca lanza
  let caducadas = 0
  try {
    caducadas = await caducarSubidasPendientes(perfilId, `freno (${TEXTO_DE_MOTIVO[motivo]}): las subidas pendientes no se aplican`)
  } catch (e) {
    console.error(`Agente PPC: frenado, pero no se han podido caducar las subidas pendientes (${perfilId}):`, e instanceof Error ? e.message : e)
  }

  // El motor a «Aprueba y aplica»: lo que quede pendiente lo decide una persona. Un fallo aquí no deshace el freno (el estado ya para el bucle)
  try {
    const anterior = await escribirModo(perfilId, 'aprueba', null)
    await anotarModo(perfilId, anterior, 'aprueba', `[AGENTE] Freno automático (${TEXTO_DE_MOTIVO[motivo]}): el motor vuelve a «Aprueba y aplica»`, null)
  } catch (e) {
    console.error(`Agente PPC: frenado, pero no se ha podido poner el motor en «Aprueba y aplica» (${perfilId}):`, e instanceof Error ? e.message : e)
  }

  await anotarEvento(perfilId, 'freno', `Agente frenado: ${TEXTO_DE_MOTIVO[motivo]}`, texto || null, { motivo, deshechas, caducadas, ...(deshacer ?? {}) })
  await avisar(perfilId, HECHO_DE_FRENO[motivo], horaEnMadrid(ahora).fecha, textoDeFreno({ nombreCuenta, motivo, detalle: texto, deshechas, noDeshechas: deshacer?.noDeshechas, quedan: deshacer?.quedan }), {
    avisar: true,
    // Un id por freno (motivo + instante): dos frenos el mismo día (otro motivo, o el mismo tras reanudar) avisan los dos
    id: `${motivo}:${ahoraIso(ahora)}`,
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// Ajustes de un administrador: topes, temporada, producto, «Pensar ahora»
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Guarda los topes diarios (cada clase 0–200; lo que falte, el de partida), el tope de IA al mes (0–100 $) y la puja máxima (0,01–100; vacía =
 * la de serie, AGENTE.PUJA_MAX_ABSOLUTA). `topeIaUsd` o `pujaMax` sin venir (undefined) no se tocan.
 */
export async function guardarTopes(perfilId: string, crudo: unknown, topeIaUsd: unknown, pujaMax: unknown, userId: string): Promise<ConfigDelAgente> {
  const topes = topesValidos(crudo)
  const fila: Record<string, unknown> = { perfil_id: perfilId, topes, updated_at: ahoraIso() }

  if (topeIaUsd !== undefined) {
    const n = numOpc(topeIaUsd)
    if (n === null || n < 0 || n > 100) throw new Error('El tope de gasto en IA tiene que ser un número entre 0 y 100 $ al mes.')
    fila.tope_ia_usd_mes = Math.round(n * 100) / 100
  }
  if (pujaMax !== undefined) {
    const n = numOpc(pujaMax)
    if (pujaMax !== null && pujaMax !== '' && n === null) throw new Error('La puja máxima tiene que ser un número.')
    if (n !== null && (n <= 0 || n > 100)) throw new Error('La puja máxima tiene que estar entre 0,01 y 100.')
    fila.puja_max = n === null ? null : Math.round(n * 100) / 100
  }

  const { error } = await createServiceClient().from('ads_agente').upsert(fila, { onConflict: 'perfil_id' })
  if (error) lanzar(error, 'No se han podido guardar los topes')
  const config = await configObligatoria(perfilId)
  const resumen = (Object.keys(topes) as ClaseDeTope[]).map((c) => `${c} ${topes[c]}`).join(', ')
  await anotarEvento(
    perfilId,
    'topes',
    'Topes del agente cambiados',
    `${resumen} · IA ${config.topeIaUsdMes} $/mes · puja máxima ${config.pujaMax ?? `${AGENTE.PUJA_MAX_ABSOLUTA} (de serie)`}`,
    { por: userId, topes, topeIaUsdMes: config.topeIaUsdMes, pujaMax: config.pujaMax },
  )
  return config
}

/** Guarda los eventos de temporada manuales (Prime Day, Hot Sale…) y si en los meses con evento el techo sube un 30 %. Un evento que no se entiende → error */
export async function guardarTemporada(perfilId: string, eventosManuales: unknown, picoEventos: unknown, userId: string): Promise<ConfigDelAgente> {
  const lista = eventosManuales === undefined || eventosManuales === null ? [] : eventosManuales
  if (!Array.isArray(lista)) throw new Error('Los eventos tienen que ser una lista.')
  const validos = eventosManualesValidos(lista)
  if (validos.length !== lista.length) {
    throw new Error(`Hay ${lista.length - validos.length} evento(s) que no se entienden: cada uno necesita nombre, «desde» y «hasta» (AAAA-MM-DD, desde ≤ hasta) y países de 2 letras.`)
  }
  const fila: Record<string, unknown> = { perfil_id: perfilId, eventos_manuales: validos, updated_at: ahoraIso() }
  if (picoEventos !== undefined) {
    if (typeof picoEventos !== 'boolean') throw new Error('«Subir el techo en los meses con evento» tiene que ser sí o no.')
    fila.pico_eventos = picoEventos
  }
  const { error } = await createServiceClient().from('ads_agente').upsert(fila, { onConflict: 'perfil_id' })
  if (error) lanzar(error, 'No se ha podido guardar la temporada')
  const config = await configObligatoria(perfilId)
  await anotarEvento(
    perfilId,
    'temporada',
    'Temporada del agente cambiada',
    `${validos.length ? validos.map((e) => `${e.nombre} (${e.desde} → ${e.hasta})`).join(', ') : 'Sin eventos manuales'} · techo ×${AGENTE.PESO_MES_EVENTO} en meses con evento: ${config.picoEventos ? 'sí' : 'no'}`,
    { por: userId, eventosManuales: validos, picoEventos: config.picoEventos },
  )
  return config
}

/**
 * La marca y la fase de un producto (las pone una persona). `marca` vacía o null = sin marca; con texto, al menos 3 letras. `fase` null =
 * automática (lanzamiento los 60 primeros días). Un campo que no viene (undefined) no se toca.
 */
export async function guardarProducto(perfilId: string, asin: string, cambios: { marca?: string | null; fase?: FaseDeProducto | null }, userId: string): Promise<void> {
  const a = (asin ?? '').trim().toUpperCase()
  if (!a) throw new Error('Falta el ASIN del producto.')
  const fila: Record<string, unknown> = {}
  if (cambios.marca !== undefined) {
    const m = (cambios.marca ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
    if (m && m.replace(/[^\p{L}\p{N}]/gu, '').length < AGENTE.MARCA_LETRAS_MIN) throw new Error(`La marca tiene que tener al menos ${AGENTE.MARCA_LETRAS_MIN} letras.`)
    fila.marca = m || null
  }
  if (cambios.fase !== undefined) {
    if (cambios.fase !== null && cambios.fase !== 'lanzamiento' && cambios.fase !== 'normal') throw new Error('La fase tiene que ser «lanzamiento», «normal» o automática.')
    fila.fase_agente = cambios.fase
  }
  if (Object.keys(fila).length === 0) return
  fila.updated_at = ahoraIso()

  const { data, error } = await createServiceClient().from('ads_productos').update(fila).eq('perfil_id', perfilId).ilike('asin', a).select('id')
  if (error) lanzar(error, 'No se ha podido guardar el producto')
  if (!data || data.length === 0) throw new Error(`El producto ${a} no está en esta cuenta.`)

  const partes: string[] = []
  if ('marca' in fila) partes.push(fila.marca ? `marca «${fila.marca}»` : 'sin marca')
  if ('fase_agente' in fila) partes.push(fila.fase_agente ? `fase ${fila.fase_agente}` : 'fase automática')
  await anotarEvento(perfilId, 'producto', `${a}: ${partes.join(' · ')}`, null, { por: userId, asin: a, ...cambios })
}

/** «Pensar ahora»: el cerebro corre en la siguiente pasada */
export async function pedirPensar(perfilId: string): Promise<void> {
  const { data, error } = await createServiceClient().from('ads_agente').update({ pensar_ya: true, updated_at: ahoraIso() }).eq('perfil_id', perfilId).neq('estado', 'apagado').select('perfil_id')
  if (error) lanzar(error, 'No se ha podido pedir que piense')
  if (!data || data.length === 0) throw new Error('El agente no está encendido en esta cuenta.')
}

/** Update genérico de columnas de `ads_agente` (nombres snake_case). Lo usan los pasos para guardar ritmo, presión, sellos, errores de uso… */
export async function actualizarAgente(perfilId: string, campos: Record<string, unknown>): Promise<void> {
  const limpios: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(campos)) if (k !== 'perfil_id' && v !== undefined) limpios[k] = v
  if (Object.keys(limpios).length === 0) return
  await escribirAgente(perfilId, limpios, 'No se ha podido guardar el estado del agente')
}

// ---------------------------------------------------------------------------------------------------------------------
// Reservas: la cuenta y cada paso
// ---------------------------------------------------------------------------------------------------------------------

/**
 * PURO. El instante de caducidad de una reserva FIRMADO: `ms` con 3 cifras más de microsegundos al azar («…12.345678Z»). `trabajando_hasta` es TIMESTAMPTZ (guarda
 * microsegundos), así que el valor exacto escrito es la firma de quien reservó: soltar o renovar con `.eq('trabajando_hasta', firma)` solo toca la reserva PROPIA.
 * Sin columna nueva (no hace falta migración). `azar` en [0, 1) entra por parámetro para poder probarlo.
 */
export function firmaDeReserva(ms: number, azar: number = Math.random()): string {
  const micro = String(Math.min(999, Math.max(0, Math.floor(azar * 1000)))).padStart(3, '0')
  return new Date(ms).toISOString().replace(/Z$/, `${micro}Z`)
}

/**
 * Reserva la cuenta 330 s para esta pasada. Devuelve la FIRMA de la reserva (ver `firmaDeReserva`) o null si otra invocación la está trabajando.
 * Con la firma, `renovarCuenta` alarga la reserva antes de cada paso y `soltarCuenta` solo suelta la propia: una pasada que se alarga más de 330 s y otra que entra
 * después ya no se pisan (antes la primera, al acabar, borraba la reserva de la segunda y una tercera podía entrar en la misma cuenta).
 */
export async function tomarCuenta(perfilId: string): Promise<string | null> {
  const ahora = Date.now()
  const firma = firmaDeReserva(ahora + AGENTE.RESERVA_CUENTA_S * 1000)
  const { data, error } = await createServiceClient()
    .from('ads_agente')
    .update({ trabajando_hasta: firma })
    .eq('perfil_id', perfilId)
    .or(`trabajando_hasta.is.null,trabajando_hasta.lt.${comillas(ahoraIso(ahora))}`)
    .select('perfil_id')
  if (error) lanzar(error, 'No se ha podido reservar la cuenta')
  return (data ?? []).length > 0 ? firma : null
}

/**
 * Alarga la reserva PROPIA otros 330 s (antes de cada paso). Devuelve la firma nueva, o null si la reserva ya no es nuestra (caducó y otra pasada la tomó, o se
 * soltó): entonces esta pasada deja la cuenta. Lanza si falla la base (quien llama deja la cuenta igual: sin saber si la reserva sigue, no se sigue).
 */
export async function renovarCuenta(perfilId: string, firma: string): Promise<string | null> {
  const nueva = firmaDeReserva(Date.now() + AGENTE.RESERVA_CUENTA_S * 1000)
  const { data, error } = await createServiceClient().from('ads_agente').update({ trabajando_hasta: nueva }).eq('perfil_id', perfilId).eq('trabajando_hasta', firma).select('perfil_id')
  if (error) lanzar(error, 'No se ha podido renovar la reserva de la cuenta')
  return (data ?? []).length > 0 ? nueva : null
}

/** Suelta la reserva PROPIA de la cuenta (en el finally de la pasada): solo si sigue llevando nuestra firma. Nunca lanza: la reserva caduca sola a los 330 s */
export async function soltarCuenta(perfilId: string, firma: string): Promise<void> {
  try {
    const { error } = await createServiceClient().from('ads_agente').update({ trabajando_hasta: null }).eq('perfil_id', perfilId).eq('trabajando_hasta', firma)
    if (error && !faltaLa315(error)) console.error(`Agente PPC: no se ha podido soltar la cuenta ${perfilId}:`, error.message)
  } catch (e) {
    console.error(`Agente PPC: no se ha podido soltar la cuenta ${perfilId}:`, e instanceof Error ? e.message : e)
  }
}

/** UPDATE condicional atómico: pone `campos` solo si se cumple `condicion` (filtro `or` de PostgREST). true = lo ha reservado esta llamada */
async function sellar(perfilId: string, campos: Record<string, unknown>, condicion: string): Promise<boolean> {
  const { data, error } = await createServiceClient().from('ads_agente').update(campos).eq('perfil_id', perfilId).or(condicion).select('perfil_id')
  if (error) lanzar(error, 'No se ha podido reservar el paso')
  return (data ?? []).length > 0
}

/** Un sello de fecha (DATE): libre si es nulo o distinto de hoy */
const fechaLibre = (col: string, hoy: string) => `${col}.is.null,${col}.neq.${comillas(hoy)}`
/** Un sello de instante: libre si es nulo o anterior al límite */
const instanteLibre = (col: string, limiteIso: string) => `${col}.is.null,${col}.lt.${comillas(limiteIso)}`

/** El instante de las HH:00 de Madrid de hoy (ajusta la hora del cambio de horario) */
function horaDeMadridHoy(ahora: number, hora: number): number {
  const m = horaEnMadrid(ahora)
  let t = Date.parse(m.inicioDelDia) + hora * HORA_MS
  for (let i = 0; i < 2; i++) {
    const h = horaLocal(t, 'Europe/Madrid').hora
    if (h === hora) break
    t += (hora - h) * HORA_MS
  }
  return t
}

/**
 * Sello-reserva del paso ANTES de ejecutarlo (§2.3): `UPDATE ads_agente SET <sello> = <valor> WHERE perfil_id = … AND (<sello> IS NULL OR <sello> < límite)`.
 * vigilar y aplicar por minutos (30 / 10); objetivos, efectos y terminos_semana por la fecha LOCAL; cerebro y resumen por Madrid. false = otro proceso
 * lo acaba de hacer (o ya no toca): se pasa al siguiente.
 *   · efectos: también se reserva si quedó a medias (`efectos_resto`); el sello lo apaga y quien mide lo vuelve a encender si deja filas.
 *   · cerebro: «Pensar ahora» (apaga `pensar_ya`), la pasada de la mañana (cerebro_at antes de las 08:00 de hoy) o la de la tarde (cerebro_tarde_dia).
 */
export async function reservarPaso(perfilId: string, paso: PasoDelAgente, ahora: number, zona: string): Promise<boolean> {
  const ya = ahoraIso(ahora)
  const local = horaLocal(ahora, zona)
  const madrid = horaEnMadrid(ahora)

  switch (paso) {
    case 'vigilar':
      return sellar(perfilId, { vigilar_at: ya }, instanteLibre('vigilar_at', ahoraIso(ahora - AGENTE.MIN_ENTRE_VIGILAR * MIN_MS)))
    case 'aplicar':
      return sellar(perfilId, { aplicar_at: ya }, instanteLibre('aplicar_at', ahoraIso(ahora - AGENTE.MIN_ENTRE_APLICAR * MIN_MS)))
    case 'objetivos':
      return sellar(perfilId, { objetivos_dia: local.fecha }, fechaLibre('objetivos_dia', local.fecha))
    case 'resumen':
      return sellar(perfilId, { resumen_dia: madrid.fecha }, fechaLibre('resumen_dia', madrid.fecha))
    case 'efectos':
      return sellar(perfilId, { efectos_dia: local.fecha, efectos_resto: false }, `${fechaLibre('efectos_dia', local.fecha)},efectos_resto.is.true`)
    case 'terminos_semana': {
      const lunes = lunesLocal(local.fecha)
      return sellar(perfilId, { terminos_semana: lunes }, fechaLibre('terminos_semana', lunes))
    }
    case 'calibrar':
      return sellar(perfilId, { calibrado_at: ya }, instanteLibre('calibrado_at', ahoraIso(ahora - AGENTE.DIAS_ENTRE_CALIBRACIONES * DIA_MS)))
    case 'cerebro': {
      const tarde = madrid.hora >= AGENTE.HORA_CEREBRO_TARDE
      // Si la pasada de la mañana o «Pensar ahora» caen ya por la tarde, cuentan también como la de la tarde (no piensa dos veces seguidas)
      const conTarde: Record<string, unknown> = tarde ? { cerebro_tarde_dia: madrid.fecha } : {}
      if (await sellar(perfilId, { pensar_ya: false, cerebro_at: ya, ...conTarde }, 'pensar_ya.is.true')) return true
      if (madrid.hora >= AGENTE.HORA_CEREBRO_MANANA) {
        const ocho = ahoraIso(horaDeMadridHoy(ahora, AGENTE.HORA_CEREBRO_MANANA))
        if (await sellar(perfilId, { cerebro_at: ya, ...conTarde }, instanteLibre('cerebro_at', ocho))) return true
      }
      if (tarde) return sellar(perfilId, { cerebro_at: ya, cerebro_tarde_dia: madrid.fecha }, fechaLibre('cerebro_tarde_dia', madrid.fecha))
      return false
    }
    default:
      return false
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Lo hecho hoy (para los topes)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cuántos cambios de cada clase de tope ha hecho hoy el agente, contando `agente_at ≥ inicio del día LOCAL` (lo pasa quien llama, con
 * inicioDelDiaLocal). En ensayo cuentan las ENSAYADAS; en activo (o frenado), las aplicadas, las que se están aplicando y las deshechas
 * (deshacer no devuelve el cupo). Lanza sin la 315: sin saber lo hecho no se puede aplicar nada.
 */
export async function hechosDeHoy(perfilId: string, inicioDelDiaLocalIso: string): Promise<Partial<Record<ClaseDeTope, number>>> {
  const service = createServiceClient()
  const [agente, propuestas] = await Promise.all([
    service.from('ads_agente').select('estado').eq('perfil_id', perfilId).maybeSingle(),
    service
      .from('ads_propuestas')
      .select('tipo, estado, valor_actual, valor_nuevo, metricas')
      .eq('perfil_id', perfilId)
      .gte('agente_at', inicioDelDiaLocalIso)
      .in('estado', ['ensayada', 'aplicada', 'aplicando', 'deshecha'])
      .limit(5000),
  ])
  if (agente.error) lanzar(agente.error, 'No se ha podido leer el agente')
  if (propuestas.error) lanzar(propuestas.error, 'No se han podido contar los cambios de hoy')

  const enEnsayo = (agente.data as { estado: string } | null)?.estado === 'ensayo'
  const cuentan: ReadonlySet<string> = enEnsayo ? new Set(['ensayada']) : new Set(['aplicada', 'aplicando', 'deshecha'])
  const r: Partial<Record<ClaseDeTope, number>> = {}
  for (const f of (propuestas.data ?? []) as Array<{ tipo: string; estado: string; valor_actual: unknown; valor_nuevo: unknown; metricas: { pedidos?: unknown } | null }>) {
    if (!cuentan.has(f.estado)) continue
    const clase = claseDeTope(
      claseDeCambio({ tipo: f.tipo, valorActual: numOpc(f.valor_actual), valorNuevo: numOpc(f.valor_nuevo), metricas: { pedidos: numOpc(f.metricas?.pedidos) ?? 0 } }),
    )
    r[clase] = (r[clase] ?? 0) + 1
  }
  return r
}
