import { UUID } from './acceso'
import type { Duracion } from './tipos'

/** Lo que contesta (503) una ruta de Correo cuando falta lanzar la migración 318. Vive aquí (pura) para que la pantalla lo pueda reconocer */
export const FALTA_MIGRACION_318 =
  'Falta lanzar la migración 318_correo_mis_asignaciones_silencios.sql en el editor SQL de Supabase: hasta entonces no se pueden elegir, asignar ni silenciar correos. El resto de Correo funciona.'
/** El `codigo` que acompaña a ese 503 en el cuerpo: `{ error: FALTA_MIGRACION_318, codigo: CODIGO_FALTA_318 }` */
export const CODIGO_FALTA_318 = 'FALTA_MIGRACION_318'

/**
 * ¿Este fallo es de verdad «falta la 318»? Solo un 503 con el código (o con la frase exacta). Un 503 de paso (el proxy mientras se reinicia la
 * aplicación tras desplegar, otra migración que falta) NO lo es: con él la bandeja no se puede apagar para el resto de la sesión.
 */
export function esFaltaDe318(r: { estado: number; mensaje?: string | null; extra?: Record<string, unknown> | null }): boolean {
  if (r.estado !== 503) return false
  return r.extra?.codigo === CODIGO_FALTA_318 || r.mensaje === FALTA_MIGRACION_318
}

/**
 * «MIS CORREOS» Y SILENCIOS: LA REGLA, SIN BASE DE DATOS.
 * ======================================================
 * Todo lo que decide quién recibe un aviso de correo (campana, aviso abajo a la derecha, número del menú) pasa por UNA sola regla, `avisaA`:
 *
 *     avisa = (es el dueño, o lo tiene asignado, o lo sigue) y no lo ha quitado de «Mis correos» y no lo tiene silenciado ahora
 *
 * `misBuzonesQueAvisan` (lo que ve quien mira) y `quienRecibeElAviso` (a quién se le escribe) la usan las dos, así que nunca se contradicen.
 *
 * Silenciar es PERSONAL: un buzón, un hilo o un remitente (la dirección, en todos los buzones que se leen), durante 8 h, hasta mañana a las 8:00, una
 * semana o siempre. Pasada la fecha vuelve a avisar sin tocar nada. Lo silenciado no se oculta: solo deja de avisar y de sumar.
 *
 * Lo que NUNCA se silencia: los rebotes (`correo_rebote`), las respuestas de una secuencia (`respuesta_lead`), los avisos de asignación
 * (`correo_asignado`) y los de las secuencias (`secuencia_*`). Los rebotes además van por su propio camino: `destinatariosDeRebote`.
 *
 * «Silenciar remitente» compara la dirección del REMITENTE del mensaje (`de_direccion`) en los avisos y la CONTRAPARTE del hilo (`contraparte_direccion`)
 * en las cuentas y en la bandeja. Está bien así: un aviso es de un mensaje; una cuenta, de un hilo.
 */

export type { Duracion }

export const DURACIONES: readonly Duracion[] = ['8h', 'manana', 'semana', 'siempre']

/** Lo que una persona ha decidido sobre un buzón (tabla correo_buzon_preferencias, migración 318) */
export interface Preferencia {
  buzonId: string
  /** null = lo de por defecto (propio o asignado: sí; el resto: no) */
  enMisCorreos: boolean | null
  orden: number | null
  silenciado: boolean
  /** Con silenciado = true: null = para siempre; una fecha = hasta entonces */
  silenciadoHasta: string | null
}

/** Hilos y remitentes que una persona ha silenciado: id del hilo / dirección en minúsculas → hasta (null = siempre) */
export interface Silencios {
  hilos: Map<string, string | null>
  remitentes: Map<string, string | null>
}

export const SIN_SILENCIOS: Silencios = { hilos: new Map(), remitentes: new Map() }

/** Un cambio de POST /api/correo/preferencias: sobre un buzón, o silenciar (o dejar de silenciar) un remitente */
export interface CambioDeBuzon {
  buzonId: string
  enMisCorreos?: boolean | null
  orden?: number | null
  silencio?: Duracion | 'quitar'
  remitente?: undefined
}
export interface CambioDeRemitente {
  remitente: string
  silencio: Duracion | 'quitar'
  buzonId?: undefined
}
export type CambioDePreferencia = CambioDeBuzon | CambioDeRemitente

export const MAX_CAMBIOS_DE_PREFERENCIAS = 50
export const MAX_LARGO_DE_DIRECCION = 320

/* ------------------------------------------------------------------ */
/* ¿Silenciado ahora?                                                   */
/* ------------------------------------------------------------------ */

/**
 * ¿Hay un silencio en vigor? `existe` = hay fila (o la casilla está puesta); `hasta` null = para siempre.
 * Una fecha que no se entiende se trata como vencida: mejor un aviso de más que uno perdido para siempre.
 */
export function estaSilenciado(hasta: string | null | undefined, existe: boolean, ahora: number): boolean {
  if (!existe) return false
  if (hasta === null || hasta === undefined) return true
  const t = Date.parse(hasta)
  return Number.isFinite(t) && t > ahora
}

/** ¿Está en «Mis correos»? Lo elegido por la persona manda; si no ha elegido nada, entran los propios y los asignados */
export function enMisCorreos(b: { esMio: boolean; asignado: boolean }, p: Preferencia | undefined): boolean {
  return p?.enMisCorreos ?? (b.esMio || b.asignado)
}

export function buzonSilenciado(p: Preferencia | undefined, ahora: number): boolean {
  return !!p && estaSilenciado(p.silenciadoHasta, p.silenciado, ahora)
}

/**
 * LA regla de los avisos (campana, abajo a la derecha y número del menú).
 * Se avisa a quien es dueño, lo tiene asignado o lo sigue (en_mis_correos = true), salvo que lo haya quitado de «Mis correos» o lo tenga silenciado.
 */
export function avisaA(e: { esDueno: boolean; asignado: boolean; seguidor: boolean }, p: Preferencia | undefined, ahora: number): boolean {
  return (e.esDueno || e.asignado || e.seguidor) && p?.enMisCorreos !== false && !buzonSilenciado(p, ahora)
}

/**
 * Los buzones (de los que quien mira ya puede leer) que le avisan y suman en su número: los de «Mis correos» que no tiene silenciados.
 * Mismo orden que la entrada.
 */
export function misBuzonesQueAvisan(
  buzones: Array<{ id: string; esMio: boolean; asignado: boolean }>,
  prefs: Map<string, Preferencia>,
  ahora: number,
): string[] {
  return buzones
    .filter((b) => {
      const p = prefs.get(b.id)
      return avisaA({ esDueno: b.esMio, asignado: b.asignado, seguidor: p?.enMisCorreos === true }, p, ahora)
    })
    .map((b) => b.id)
}

/**
 * A quién se le escribe el aviso de un correo nuevo en un buzón: las personas para las que `avisaA` es true y que todavía pueden leerlo. Sin repetidos,
 * primero el dueño, luego las asignadas y luego las que lo siguen.
 *
 * `quitadoDeMisCorreos` (personas con en_mis_correos = false en ese buzón) es lo que hace falta para que el dueño o una asignada que lo ha quitado de
 * «Mis correos» deje de recibir avisos, igual que deja de sumarle en el número. Sin él, se supone que nadie lo ha quitado.
 *
 * Los REBOTES no pasan por aquí: `destinatariosDeRebote`.
 */
export function quienRecibeElAviso(e: {
  duenoId: string
  asignados: Array<{ personaId: string }>
  /** Personas con en_mis_correos = true en ese buzón */
  seguidores: string[]
  /** Personas con en_mis_correos = false en ese buzón */
  quitadoDeMisCorreos?: Iterable<string>
  /** Personas que tienen el buzón silenciado → hasta (null = siempre) */
  silenciadoPor: Map<string, string | null>
  /** Ya calculado con decidirAcceso (modo 'leer') */
  puedeLeer: (personaId: string) => boolean
  ahora: number
}): string[] {
  const asignados = new Set(e.asignados.map((a) => a.personaId))
  const seguidores = new Set(e.seguidores)
  const quitados = new Set(e.quitadoDeMisCorreos ?? [])
  const salida: string[] = []
  const vistos = new Set<string>()
  for (const id of [e.duenoId, ...asignados, ...seguidores]) {
    if (!id || vistos.has(id)) continue
    vistos.add(id)
    const p: Preferencia = {
      buzonId: '',
      enMisCorreos: quitados.has(id) ? false : seguidores.has(id) ? true : null,
      orden: null,
      silenciado: e.silenciadoPor.has(id),
      silenciadoHasta: e.silenciadoPor.get(id) ?? null,
    }
    if (!avisaA({ esDueno: id === e.duenoId, asignado: asignados.has(id), seguidor: seguidores.has(id) }, p, e.ahora)) continue
    if (!e.puedeLeer(id)) continue
    salida.push(id)
  }
  return salida
}

/**
 * A quién se avisa de un REBOTE: al dueño siempre y a quien lo envió desde el ERP (enviado_por del último saliente del mismo hilo), si lo hay y todavía
 * lee el buzón. Sin silencios ni «Mis correos», ni seguidores ni supervisores: un correo que no ha llegado no se puede perder.
 */
export function destinatariosDeRebote(e: { duenoId: string; enviadoPor: string | null; puedeLeer: (id: string) => boolean }): string[] {
  const salida = e.duenoId ? [e.duenoId] : []
  if (e.enviadoPor && e.enviadoPor !== e.duenoId && e.puedeLeer(e.enviadoPor)) salida.push(e.enviadoPor)
  return salida
}

/**
 * Los buzones que hay que mirar SOLO por sus rebotes (el aviso de abajo a la derecha): los propios y los asignados que NO avisan (silenciados
 * o quitados de «Mis correos»). Los seguidos no: quien solo sigue un buzón no envía desde él y no recibe sus rebotes. Mismo orden que la entrada.
 */
export function buzonesSoloPorRebotes(buzones: Array<{ id: string; via: 'propio' | 'asignado' | 'seguido' }>, queAvisan: readonly string[]): string[] {
  const avisan = new Set(queAvisan)
  return buzones.filter((b) => (b.via === 'propio' || b.via === 'asignado') && !avisan.has(b.id)).map((b) => b.id)
}

/**
 * De los rebotes de un buzón que no avisa, los que le tocan a quien mira, con la misma regla que la campana (`destinatariosDeRebote`): todos si el
 * buzón es suyo; si lo tiene asignado, los de los hilos cuyo último saliente envió él (`enviadoPorHilo`: hilo → quien envió).
 */
export function rebotesQueMeTocan<T extends { buzon_id: string; hilo_id: string; rebote: boolean }>(
  filas: readonly T[],
  e: { userId: string; propios: ReadonlySet<string>; enviadoPorHilo: ReadonlyMap<string, string> },
): T[] {
  return filas.filter((f) => f.rebote && (e.propios.has(f.buzon_id) || (!!e.userId && e.enviadoPorHilo.get(f.hilo_id) === e.userId)))
}

/* ------------------------------------------------------------------ */
/* Hilos y remitentes                                                   */
/* ------------------------------------------------------------------ */

const direccion = (d: string | null | undefined): string => (d ?? '').trim().toLowerCase()

/** ¿Este hilo está silenciado para quien mira, por el hilo o por su contraparte? (cuentas y bandeja) */
export function hiloSilenciado(h: { id: string; contraparteDireccion: string }, s: Silencios, ahora: number): boolean {
  if (estaSilenciado(s.hilos.get(h.id), s.hilos.has(h.id), ahora)) return true
  const d = direccion(h.contraparteDireccion)
  return d !== '' && estaSilenciado(s.remitentes.get(d), s.remitentes.has(d), ahora)
}

/** Tipos de aviso que no se silencian nunca */
export function noSeSilenciaNunca(tipo: string | null | undefined): boolean {
  if (!tipo) return false
  return tipo === 'correo_rebote' || tipo === 'respuesta_lead' || tipo === 'correo_asignado' || tipo.startsWith('secuencia_')
}

/**
 * Quita de una lista de mensajes por avisar los de hilos o remitentes silenciados. El remitente se mira en `de_direccion` (quien escribe el mensaje).
 * Nunca quita un rebote (`rebote: true`) ni un aviso de un tipo que no se silencia (`tipo`).
 */
export function filtrarAvisos<T extends { hilo_id: string; de_direccion: string; rebote?: boolean | null; tipo?: string | null }>(
  filas: T[],
  s: Silencios,
  ahora: number,
): T[] {
  if (s.hilos.size === 0 && s.remitentes.size === 0) return filas
  return filas.filter((f) => {
    if (f.rebote === true || noSeSilenciaNunca(f.tipo)) return true
    if (estaSilenciado(s.hilos.get(f.hilo_id), s.hilos.has(f.hilo_id), ahora)) return false
    const d = direccion(f.de_direccion)
    return !(d !== '' && estaSilenciado(s.remitentes.get(d), s.remitentes.has(d), ahora))
  })
}

/* ------------------------------------------------------------------ */
/* Duraciones                                                           */
/* ------------------------------------------------------------------ */

const HORA = 3_600_000

/** Diferencia (ms) entre la hora de la pared en `zona` y UTC en ese instante */
function desfase(instante: number, zona: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instante))
  const n = (t: string) => Number(partes.find((p) => p.type === t)?.value)
  const pared = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return pared - Math.floor(instante / 1000) * 1000
}

/** El instante de la fecha (año, mes 0-11, día) a esa hora de la pared en `zona` */
function aLaHoraDe(anio: number, mes: number, dia: number, hora: number, zona: string): number {
  const supuesto = Date.UTC(anio, mes, dia, hora)
  const primero = supuesto - desfase(supuesto, zona)
  // Si entre medias cambia la hora (verano/invierno), se corrige con el desfase del instante ya calculado
  return supuesto - desfase(primero, zona)
}

/**
 * Hasta cuándo dura un silencio que empieza `ahora`. null = siempre.
 *   · '8h'      dentro de 8 horas
 *   · 'manana'  mañana (el día siguiente del calendario en `zona`) a las 8:00 de `zona`
 *   · 'semana'  dentro de 7 días
 */
export function hastaDeDuracion(d: Duracion, ahora: Date, zona = 'Europe/Madrid'): string | null {
  const t = ahora.getTime()
  switch (d) {
    case '8h':
      return new Date(t + 8 * HORA).toISOString()
    case 'semana':
      return new Date(t + 7 * 24 * HORA).toISOString()
    case 'manana': {
      const hoy = new Date(t + desfase(t, zona))
      return new Date(aLaHoraDe(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + 1, 8, zona)).toISOString()
    }
    case 'siempre':
      return null
  }
}

export const esDuracion = (v: unknown): v is Duracion => typeof v === 'string' && (DURACIONES as readonly string[]).includes(v)
const esSilencio = (v: unknown): v is Duracion | 'quitar' => v === 'quitar' || esDuracion(v)

/* ------------------------------------------------------------------ */
/* La petición                                                          */
/* ------------------------------------------------------------------ */

/** Normaliza una dirección para silenciarla: minúsculas, sin espacios, con @ que no vaya al principio y como mucho 320 caracteres. null si no vale */
export function normalizarRemitente(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const d = v.trim().toLowerCase()
  if (d.length === 0 || d.length > MAX_LARGO_DE_DIRECCION || d.indexOf('@') < 1 || /\s/.test(d)) return null
  return d
}

/** El cuerpo de POST /api/correo/preferencias, validado: `{ cambios: CambioDePreferencia[] }`, entre 1 y 50, sin repetir buzón ni remitente */
export function validarPeticionDePreferencias(entrada: unknown): { ok: true; cambios: CambioDePreferencia[] } | { ok: false; error: string } {
  if (typeof entrada !== 'object' || entrada === null) return { ok: false, error: 'El cuerpo no es válido.' }
  const { cambios } = entrada as { cambios?: unknown }
  if (!Array.isArray(cambios) || cambios.length === 0) return { ok: false, error: 'No hay ningún cambio que guardar.' }
  if (cambios.length > MAX_CAMBIOS_DE_PREFERENCIAS) return { ok: false, error: `Demasiados cambios de golpe (máximo ${MAX_CAMBIOS_DE_PREFERENCIAS}).` }

  const buzones = new Set<string>()
  const remitentes = new Set<string>()
  const salida: CambioDePreferencia[] = []
  for (const c of cambios) {
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return { ok: false, error: 'Uno de los cambios no es válido.' }
    const { buzonId, remitente, enMisCorreos, orden, silencio } = c as Record<string, unknown>

    if (remitente !== undefined) {
      if (buzonId !== undefined) return { ok: false, error: 'Un cambio es de un buzón o de un remitente, no de los dos.' }
      if (enMisCorreos !== undefined || orden !== undefined) return { ok: false, error: 'A un remitente solo se le puede silenciar o dejar de silenciar.' }
      const d = normalizarRemitente(remitente)
      if (!d) return { ok: false, error: 'Una de las direcciones no es válida.' }
      if (!esSilencio(silencio)) return { ok: false, error: 'Falta decir cuánto tiempo se silencia el remitente.' }
      if (remitentes.has(d)) return { ok: false, error: 'Una misma dirección sale dos veces en la petición.' }
      remitentes.add(d)
      salida.push({ remitente: d, silencio })
      continue
    }

    if (typeof buzonId !== 'string' || !UUID.test(buzonId)) return { ok: false, error: 'Uno de los buzones no es válido.' }
    const id = buzonId.toLowerCase()
    if (buzones.has(id)) return { ok: false, error: 'Un mismo buzón sale dos veces en la petición.' }
    buzones.add(id)
    if (enMisCorreos !== undefined && enMisCorreos !== null && typeof enMisCorreos !== 'boolean') return { ok: false, error: '«Mis correos» tiene que ser sí, no o lo de por defecto.' }
    if (orden !== undefined && orden !== null && !(typeof orden === 'number' && Number.isInteger(orden) && orden >= 0 && orden <= 32767)) {
      return { ok: false, error: 'El orden no es válido.' }
    }
    if (silencio !== undefined && !esSilencio(silencio)) return { ok: false, error: 'La duración del silencio no es válida.' }
    if (enMisCorreos === undefined && orden === undefined && silencio === undefined) return { ok: false, error: 'Uno de los cambios no cambia nada.' }

    const cambio: CambioDeBuzon = { buzonId: id }
    if (enMisCorreos !== undefined) cambio.enMisCorreos = enMisCorreos as boolean | null
    if (orden !== undefined) cambio.orden = orden as number | null
    if (silencio !== undefined) cambio.silencio = silencio
    salida.push(cambio)
  }
  return { ok: true, cambios: salida }
}
