/**
 * AMAZON ADS · EL AGENTE PPC: USO DE PRESUPUESTO, HORA LOCAL Y CURVA DEL DÍA. PURO (nada de servidor).
 *
 * - La API de uso (`POST /sp/campaigns/budget/usage`) dice, por campaña, qué % del presupuesto de HOY lleva gastado. Se pide en lotes de 100 (secuenciales,
 *   lo hace el servidor) y aquí se interpreta la respuesta: el presupuesto es el `budget` de la RESPUESTA (ya con las reglas de presupuesto aplicadas), el minuto
 *   es el de `usageUpdatedTimestamp`, el uso se acota a [0, 200] (Amazon deja gastar hasta un 25 % más en un día) y un 207 sin ningún acierto es un ERROR.
 * - Un «día» es el día del marketplace: `horaLocal(ahora, zona)` con Intl (sin librerías), que respeta el cambio de horario.
 * - Una fila por campaña y día (`fusionarDiaDeUso`): uso último y máximo, gasto estimado, primer minuto en que se agotó (≥ 95 %) y si se agotó solo «por estado».
 * - La curva del día (`curvaHoraria`): qué fracción del gasto diario suele llevar la cuenta a cada hora; con ella se proyecta el gasto de hoy (`proyectarHoy`).
 */

import { AGENTE, type DiaDeUso, type HoraDeCuenta, type LecturaDeUso } from './tipos'

export const TIPO_USO = 'application/vnd.spcampaignbudgetusage.v1+json'
export const RUTA_USO = '/sp/campaigns/budget/usage'

const redondear2 = (n: number) => Math.round(n * 100) / 100

/** Un número que puede venir como número o como texto («45.5», «45,5»); null si no es un número finito */
function aNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const t = v.trim().replace(',', '.')
    if (!t) return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Un id de campaña (Amazon lo da como texto, pero a veces como número) */
function aId(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

/** Una marca de tiempo (ISO o milisegundos) como ISO; null si no se entiende */
function aIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString()
  if (typeof v === 'string' && v.trim()) {
    const ms = Date.parse(v.trim())
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }
  return null
}

function aTexto(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Los ids en lotes de `tam` (100, el máximo de la API). Sin ids repetidos ni vacíos */
export function lotesDeCampanas(ids: readonly string[], tam: number = AGENTE.USO_LOTE): string[][] {
  const t = Math.max(1, Math.floor(tam) || AGENTE.USO_LOTE)
  const unicos = Array.from(new Set(ids.map((i) => String(i).trim()).filter(Boolean)))
  const lotes: string[][] = []
  for (let i = 0; i < unicos.length; i += t) lotes.push(unicos.slice(i, i + t))
  return lotes
}

/**
 * Interpreta la respuesta (207) de la API de uso. `usoPct` acotado a [0, 200]; `presupuesto` = `budget` de la respuesta (null si falta: el servidor pone el de
 * `campanasDe`); `actualizadoAt` = `usageUpdatedTimestamp`. `todoError` = ningún acierto y algún error (o una respuesta que no se entiende).
 */
export function leerRespuestaDeUso(crudo: unknown): { usos: LecturaDeUso[]; errores: Array<{ campaignId: string | null; codigo: string; detalle: string }>; todoError: boolean } {
  let datos: unknown = crudo
  if (typeof datos === 'string') {
    try {
      datos = JSON.parse(datos)
    } catch {
      return { usos: [], errores: [{ campaignId: null, codigo: 'RESPUESTA_INVALIDA', detalle: 'La respuesta de uso no es JSON' }], todoError: true }
    }
  }
  if (!datos || typeof datos !== 'object') {
    return { usos: [], errores: [{ campaignId: null, codigo: 'RESPUESTA_INVALIDA', detalle: 'La respuesta de uso está vacía' }], todoError: true }
  }
  const r = datos as { success?: unknown; error?: unknown }
  const aciertos = Array.isArray(r.success) ? r.success : []
  const fallos = Array.isArray(r.error) ? r.error : []

  const usos: LecturaDeUso[] = []
  const errores: Array<{ campaignId: string | null; codigo: string; detalle: string }> = []

  for (const a of aciertos) {
    if (!a || typeof a !== 'object') continue
    const x = a as Record<string, unknown>
    const campaignId = aId(x.campaignId)
    if (!campaignId) {
      errores.push({ campaignId: null, codigo: 'SIN_CAMPANA', detalle: 'Lectura de uso sin campaignId' })
      continue
    }
    const uso = aNumero(x.budgetUsagePercent)
    const budget = aNumero(x.budget)
    usos.push({
      campaignId,
      usoPct: uso == null ? null : Math.min(AGENTE.USO_PCT_MAX, Math.max(0, uso)),
      presupuesto: budget != null && budget > 0 ? budget : null,
      actualizadoAt: aIso(x.usageUpdatedTimestamp),
    })
  }

  for (const f of fallos) {
    if (!f || typeof f !== 'object') {
      errores.push({ campaignId: null, codigo: 'DESCONOCIDO', detalle: aTexto(f) })
      continue
    }
    const x = f as Record<string, unknown>
    errores.push({
      campaignId: aId(x.campaignId),
      codigo: aTexto(x.code ?? x.errorType ?? 'DESCONOCIDO') || 'DESCONOCIDO',
      detalle: aTexto(x.details ?? x.message ?? x.errorValue ?? ''),
    })
  }

  return { usos, errores, todoError: usos.length === 0 && errores.length > 0 }
}

/** ¿Entiende Intl esta zona? */
function zonaValida(zona: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona })
    return true
  } catch {
    return false
  }
}

/**
 * La zona de cada marketplace según Amazon Ads (la que da `/v2/profiles` en `timezone`): el presupuesto diario se reinicia a la medianoche de ESA zona.
 * Solo es el respaldo: manda `ads_profiles.zona_horaria`.
 */
const ZONA_POR_PAIS: Record<string, string> = {
  US: 'America/Los_Angeles',
  CA: 'America/Los_Angeles',
  MX: 'America/Los_Angeles',
  BR: 'America/Sao_Paulo',
  UK: 'Europe/London',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  ES: 'Europe/Paris',
  FR: 'Europe/Paris',
  DE: 'Europe/Paris',
  IT: 'Europe/Paris',
  NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels',
  SE: 'Europe/Stockholm',
  PL: 'Europe/Warsaw',
  TR: 'Europe/Istanbul',
  AE: 'Asia/Dubai',
  SA: 'Asia/Riyadh',
  EG: 'Africa/Cairo',
  IN: 'Asia/Kolkata',
  JP: 'Asia/Tokyo',
  SG: 'Asia/Singapore',
  AU: 'Australia/Sydney',
}

/** La zona del perfil si es válida; si no, la del país; si tampoco, Madrid */
export function zonaDePais(pais: string | null | undefined, zona: string | null | undefined): string {
  const z = (zona ?? '').trim()
  if (z && zonaValida(z)) return z
  const p = (pais ?? '').trim().toUpperCase()
  return ZONA_POR_PAIS[p] ?? 'Europe/Madrid'
}

const formatos = new Map<string, Intl.DateTimeFormat>()
function formatoDe(zona: string): Intl.DateTimeFormat {
  let f = formatos.get(zona)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatos.set(zona, f)
  }
  return f
}

/** La hora de pared en la zona: año, mes, día, hora, minuto, segundo */
function partesLocales(ahora: number, zona: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const partes = formatoDe(zona).formatToParts(new Date(ahora))
  const v = (t: string) => Number(partes.find((x) => x.type === t)?.value ?? 0)
  return { y: v('year'), m: v('month'), d: v('day'), h: v('hour') % 24, mi: v('minute'), s: v('second') }
}

const dos = (n: number) => String(n).padStart(2, '0')

/**
 * La hora local del marketplace. `fecha` 'YYYY-MM-DD', `mes` 'YYYY-MM', `hora` 0–23, `minutos` = minuto DENTRO de la hora (0–59; el minuto del día es
 * `hora × 60 + minutos`), `dia` del mes, `diasDelMes`, `diaSemana` 0 = domingo … 6 = sábado (como `Date.getDay`).
 */
export function horaLocal(ahora: number, zona: string): { fecha: string; minutos: number; hora: number; dia: number; diasDelMes: number; diaSemana: number; mes: string } {
  const p = partesLocales(ahora, zona)
  const mes = `${p.y}-${dos(p.m)}`
  return {
    fecha: `${mes}-${dos(p.d)}`,
    minutos: p.mi,
    hora: p.h,
    dia: p.d,
    diasDelMes: new Date(Date.UTC(p.y, p.m, 0)).getUTCDate(),
    diaSemana: new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(),
    mes,
  }
}

/** Cuánto va la zona por delante de UTC en ese instante (ms) */
function desfase(ms: number, zona: string): number {
  const p = partesLocales(ms, zona)
  const comoUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s)
  return comoUtc - (ms - (((ms % 1000) + 1000) % 1000))
}

/** El instante (ISO UTC) de las 00:00 locales de esa fecha 'YYYY-MM-DD' en la zona */
export function inicioDelDiaLocal(fecha: string, zona: string): string {
  const [y, m, d] = fecha.split('-').map(Number)
  const pared = Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0)
  // Dos vueltas: el desfase de la medianoche puede no ser el de la hora de pared tomada como UTC (cambio de horario)
  let t = pared - desfase(pared, zona)
  t = pared - desfase(t, zona)
  // Si la medianoche no existe (salto de horario a las 00:00), la primera hora del día es el instante siguiente
  if (horaLocal(t, zona).fecha !== fecha) {
    const t2 = pared - desfase(t + 3_600_000, zona)
    if (horaLocal(t2, zona).fecha === fecha) t = t2
  }
  return new Date(t).toISOString()
}

/** El minuto del día local (0–1439) de ese instante, o null si no es de esa fecha local (o no se entiende) */
export function minutoLocalDe(iso: string | null, zona: string, fecha: string): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const l = horaLocal(ms, zona)
  if (l.fecha !== fecha) return null
  return l.hora * 60 + l.minutos
}

/**
 * Une una lectura de uso con la fila del día de esa campaña (una fila por campaña y día local).
 * - `presupuesto` y `usoPct` el último; `presupuestoPrimera` el de la primera lectura del día; `usoMaxPct` el máximo; `gastoEstimado` = presupuesto × uso / 100.
 * - `agotadaMin`: el primer minuto local (por `actualizadoAt`) con uso ≥ 95; una vez puesto no se borra en el día.
 * - `porEstado` (servingStatus = CAMPAIGN_OUT_OF_BUDGET, sin API): `agotadaPorEstado = true` y el minuto no se toca.
 * - Una lectura cuyo `actualizadoAt` es de OTRO día local (uso de ayer) no cuenta para hoy: solo se apunta que se leyó.
 * - Una fila previa de otro día se ignora (empieza el día de nuevo).
 */
export function fusionarDiaDeUso(
  previo: DiaDeUso | null,
  lectura: { campaignId: string; usoPct: number | null; presupuesto: number | null; actualizadoAt: string | null; porEstado: boolean; estadoCampana: string | null },
  ahora: number,
  zona: string,
): DiaDeUso {
  const local = horaLocal(ahora, zona)
  const fecha = local.fecha
  const antes = previo && previo.fechaLocal === fecha && previo.campaignId === lectura.campaignId ? previo : null

  // ¿El uso de esta lectura es de hoy?
  const minutoLectura = lectura.actualizadoAt ? minutoLocalDe(lectura.actualizadoAt, zona, fecha) : null
  const usoDeOtroDia = lectura.actualizadoAt != null && minutoLectura == null
  const usoLeido = !usoDeOtroDia && lectura.usoPct != null && Number.isFinite(lectura.usoPct) ? Math.min(AGENTE.USO_PCT_MAX, Math.max(0, lectura.usoPct)) : null

  const presupuestoLeido = lectura.presupuesto != null && Number.isFinite(lectura.presupuesto) && lectura.presupuesto > 0 ? lectura.presupuesto : null
  const presupuesto = presupuestoLeido ?? antes?.presupuesto ?? null
  const presupuestoPrimera = antes ? (antes.presupuestoPrimera ?? presupuesto) : presupuesto

  const usoPct = usoLeido ?? antes?.usoPct ?? null
  const maximos = [antes?.usoMaxPct, usoLeido].filter((x): x is number => x != null)
  const usoMaxPct = maximos.length ? Math.max(...maximos) : null

  const gastoEstimado = usoLeido != null && presupuesto != null ? redondear2((presupuesto * usoLeido) / 100) : (antes?.gastoEstimado ?? null)

  let agotadaMin = antes?.agotadaMin ?? null
  if (agotadaMin == null && usoLeido != null && usoLeido >= AGENTE.USO_AGOTADO_PCT) {
    // Sin marca de tiempo de Amazon, el minuto de la lectura (cota superior)
    agotadaMin = minutoLectura ?? local.hora * 60 + local.minutos
  }

  const fuente: DiaDeUso['fuente'] = usoLeido != null ? 'api' : lectura.porEstado ? 'estado' : (antes?.fuente ?? 'estado')

  return {
    campaignId: lectura.campaignId,
    fechaLocal: fecha,
    presupuesto,
    presupuestoPrimera,
    usoPct,
    usoMaxPct,
    gastoEstimado,
    agotadaMin,
    agotadaPorEstado: (antes?.agotadaPorEstado ?? false) || lectura.porEstado,
    estadoCampana: lectura.estadoCampana ?? antes?.estadoCampana ?? null,
    fuente,
    leidoAt: new Date(ahora).toISOString(),
  }
}

/** ¿Cuenta como ENABLED? Sin estado conocido, sí (el máximo posible es una cota: mejor de más que de menos) */
function estaActiva(d: DiaDeUso): boolean {
  return d.estadoCampana == null || d.estadoCampana.toUpperCase() === 'ENABLED'
}

/** La fila de `ads_gasto_hora`: Σ gasto estimado de la cuenta en esa fecha y Σ presupuesto de las ENABLED (null si no hay ninguno) */
export function horaDeCuenta(dias: readonly DiaDeUso[], fecha: string, hora: number): HoraDeCuenta {
  const deHoy = dias.filter((d) => d.fechaLocal === fecha)
  const presupuestos = deHoy.filter((d) => estaActiva(d) && d.presupuesto != null).map((d) => d.presupuesto as number)
  return {
    fechaLocal: fecha,
    hora,
    gastoAcum: gastoDeHoy(dias, fecha),
    sumaPresupuestos: presupuestos.length ? redondear2(presupuestos.reduce((s, x) => s + x, 0)) : null,
  }
}

/** Σ gasto estimado de las filas de esa fecha (toda campaña leída hoy cuenta, aunque luego se pause) */
export function gastoDeHoy(dias: readonly DiaDeUso[], fecha: string): number {
  return redondear2(dias.filter((d) => d.fechaLocal === fecha).reduce((s, d) => s + (d.gastoEstimado ?? 0), 0))
}

/** Lo más que puede gastar hoy la cuenta: Σ presupuesto de las ENABLED × 1,25 (Amazon deja pasarse un 25 % en un día) */
export function gastoMaximoPosible(dias: readonly DiaDeUso[], fecha: string): number {
  const suma = dias.filter((d) => d.fechaLocal === fecha && estaActiva(d)).reduce((s, d) => s + (d.presupuesto ?? 0), 0)
  return redondear2(suma * AGENTE.EXCESO_DIARIO_AMAZON)
}

/** La curva lineal: al acabar la hora h se lleva (h + 1) / 24 del día */
function curvaLineal(): number[] {
  return Array.from({ length: 24 }, (_, h) => (h + 1) / 24)
}

/**
 * La curva del día de la cuenta: `curva[h]` = fracción del gasto diario que suele llevar al ACABAR la hora local h (curva[23] = 1).
 * Media de `gastoAcum(h) / gastoAcum(23)` en los 14 últimos días (las horas que se pasan son días CERRADOS: el de hoy no debe entrar) con gasto ≥ 1 y fila de las 23.
 * Una hora sin lectura toma la última anterior del día. Con menos de 5 días válidos → lineal.
 */
export function curvaHoraria(horas: readonly HoraDeCuenta[]): number[] {
  const porDia = new Map<string, Map<number, number>>()
  for (const h of horas) {
    if (!Number.isInteger(h.hora) || h.hora < 0 || h.hora > 23 || !Number.isFinite(h.gastoAcum)) continue
    let m = porDia.get(h.fechaLocal)
    if (!m) porDia.set(h.fechaLocal, (m = new Map()))
    m.set(h.hora, h.gastoAcum)
  }
  const validos = Array.from(porDia.entries())
    .filter(([, m]) => (m.get(23) ?? 0) >= 1)
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .slice(0, AGENTE.CURVA_DIAS)
  if (validos.length < AGENTE.CURVA_DIAS_MIN) return curvaLineal()

  const suma = new Array<number>(24).fill(0)
  for (const [, m] of validos) {
    const total = m.get(23) as number
    let ultimo = 0
    for (let h = 0; h < 24; h++) {
      const v = m.get(h)
      if (v != null) ultimo = Math.max(ultimo, v)
      suma[h] += Math.min(1, Math.max(0, ultimo / total))
    }
  }
  const curva = suma.map((s) => s / validos.length)
  // Acumulada: nunca baja, y acaba en 1
  for (let h = 1; h < 24; h++) curva[h] = Math.max(curva[h], curva[h - 1])
  curva[23] = 1
  return curva.map((x) => Math.round(x * 10000) / 10000)
}

/**
 * El gasto de hoy proyectado al final del día: `gastoHoy / max(0,1, fracción)`, con la fracción interpolada entre el final de la hora anterior y el de esta.
 * `minutos` es el minuto dentro de la hora (si llega el minuto del día, se toma su resto).
 */
export function proyectarHoy(gastoHoy: number, hora: number, minutos: number, curva: readonly number[]): number {
  const c = curva.length === 24 ? curva : curvaLineal()
  const h = Math.min(23, Math.max(0, Math.floor(hora)))
  const m = Math.min(60, Math.max(0, minutos >= 60 ? minutos % 60 : minutos))
  const antes = h > 0 ? c[h - 1] : 0
  const fraccion = antes + (c[h] - antes) * (m / 60)
  return redondear2(Math.max(0, gastoHoy) / Math.max(AGENTE.CURVA_FRACCION_MIN, fraccion))
}
