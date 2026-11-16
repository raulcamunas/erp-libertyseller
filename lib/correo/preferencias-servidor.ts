import type { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { cargarReglaEnBloque, type ReglaEnBloque } from './lectores-servidor'
import { SIN_SILENCIOS, estaSilenciado, hastaDeDuracion, quienRecibeElAviso, type CambioDePreferencia, type Preferencia, type Silencios } from './preferencias'

/**
 * «MIS CORREOS», SILENCIOS Y A QUIÉN SE AVISA — SOLO SERVIDOR, SIN IMAP.
 * ======================================================================
 * Lee y escribe lo personal de la migración 318 (correo_buzon_preferencias, correo_hilo_silencios, correo_remitente_silencios) y decide a quién se le
 * escribe el aviso de un correo nuevo. La regla está en preferencias.ts (pura); aquí solo se lee la base y se le pasa.
 *
 * SIN LA MIGRACIÓN 318 NADA SE ROMPE: lo que se iba a leer sale vacío (nadie ha elegido ni silenciado nada) y los avisos van solo al dueño, como antes.
 * Lo que se iba a escribir lanza FaltaMigracion318, y la ruta contesta 503 con FALTA_MIGRACION_318.
 *
 * NUNCA IMPORTA servidor.ts (ni mailparser ni IMAP): solo preferencias, lectores-servidor y la base.
 */

type Servicio = ReturnType<typeof createServiceClient>

import { CODIGO_FALTA_318, FALTA_MIGRACION_318 } from './preferencias'
export { CODIGO_FALTA_318, FALTA_MIGRACION_318 }

/** El 503 de «falta la 318», con su código para que la pantalla no lo confunda con un 503 de paso */
export const cuerpoDeFalta318 = (): { error: string; codigo: string } => ({ error: FALTA_MIGRACION_318, codigo: CODIGO_FALTA_318 })

export class FaltaMigracion318 extends Error {
  constructor() {
    super(FALTA_MIGRACION_318)
    this.name = 'FaltaMigracion318'
  }
}

interface FilaDePreferencia {
  user_id?: string
  buzon_id: string
  en_mis_correos: boolean | null
  orden: number | null
  silenciado: boolean | null
  silenciado_hasta: string | null
}

const aPreferencia = (f: FilaDePreferencia): Preferencia => ({
  buzonId: f.buzon_id,
  enMisCorreos: typeof f.en_mis_correos === 'boolean' ? f.en_mis_correos : null,
  orden: typeof f.orden === 'number' ? f.orden : null,
  silenciado: f.silenciado === true,
  silenciadoHasta: f.silenciado_hasta ?? null,
})

const COLUMNAS_DE_PREFERENCIA = 'buzon_id, en_mis_correos, orden, silenciado, silenciado_hasta'

/* ------------------------------------------------------------------ */
/* Leer lo de una persona                                              */
/* ------------------------------------------------------------------ */

/** Lo que esta persona ha decidido de cada buzón. Sin la 318, nada y `disponible: false`. Otro fallo se propaga */
export async function leerPreferencias(service: Servicio, userId: string): Promise<{ disponible: boolean; porBuzon: Map<string, Preferencia> }> {
  const { data, error } = await service.from('correo_buzon_preferencias').select(COLUMNAS_DE_PREFERENCIA).eq('user_id', userId)
  if (error) {
    if (isMissingSchema(error)) return { disponible: false, porBuzon: new Map() }
    throw new Error('No se han podido leer tus preferencias de correo.', { cause: error })
  }
  return { disponible: true, porBuzon: new Map(((data ?? []) as FilaDePreferencia[]).map((f) => [f.buzon_id, aPreferencia(f)])) }
}

/** Hilos y remitentes que esta persona tiene silenciados (también los ya vencidos: la regla mira la fecha). Sin la 318, ninguno */
export async function leerSilencios(service: Servicio, userId: string): Promise<Silencios> {
  return (await silenciosDe(service, [userId])).get(userId) ?? { hilos: new Map(), remitentes: new Map() }
}

/** Los silencios de varias personas en dos consultas. Quien no tiene ninguno no sale en el mapa */
async function silenciosDe(service: Servicio, userIds: string[]): Promise<Map<string, Silencios>> {
  const salida = new Map<string, Silencios>()
  if (userIds.length === 0) return salida
  const [hilos, remitentes] = await Promise.all([
    service.from('correo_hilo_silencios').select('user_id, hilo_id, hasta').in('user_id', userIds),
    service.from('correo_remitente_silencios').select('user_id, direccion, hasta').in('user_id', userIds),
  ])
  for (const r of [hilos, remitentes]) {
    if (r.error && !isMissingSchema(r.error)) throw new Error('No se han podido leer los silencios.', { cause: r.error })
  }
  const de = (id: string): Silencios => {
    let s = salida.get(id)
    if (!s) {
      s = { hilos: new Map(), remitentes: new Map() }
      salida.set(id, s)
    }
    return s
  }
  for (const f of (hilos.error ? [] : hilos.data ?? []) as Array<{ user_id: string; hilo_id: string; hasta: string | null }>) de(f.user_id).hilos.set(f.hilo_id, f.hasta ?? null)
  for (const f of (remitentes.error ? [] : remitentes.data ?? []) as Array<{ user_id: string; direccion: string; hasta: string | null }>) de(f.user_id).remitentes.set(f.direccion.trim().toLowerCase(), f.hasta ?? null)
  return salida
}

/**
 * Conversaciones sin leer por buzón SIN las silenciadas por esta persona (por hilo o por remitente): el número de la barra y del menú.
 * Sin la 318 (sin la función correo_sin_leer_de), las de siempre: correo_resumen_buzones, sin descontar nada. Un buzón sin nada sin leer sale con 0.
 */
export async function sinLeerMios(service: Servicio, userId: string, buzonIds: string[]): Promise<Map<string, number>> {
  const salida = new Map<string, number>(buzonIds.map((id) => [id, 0]))
  if (buzonIds.length === 0) return salida
  const { data, error } = await service.rpc('correo_sin_leer_de', { p_user: userId, p_buzones: buzonIds })
  if (!error) {
    for (const f of (data ?? []) as Array<{ buzon_id: string; hilos_sin_leer: number | string }>) salida.set(f.buzon_id, Number(f.hilos_sin_leer) || 0)
    return salida
  }
  if (!isMissingSchema(error)) throw new Error('No se han podido contar los correos sin leer.', { cause: error })
  const resumen = await service.rpc('correo_resumen_buzones', { p_buzones: buzonIds })
  if (resumen.error) throw new Error('No se han podido contar los correos sin leer.', { cause: resumen.error })
  for (const f of (resumen.data ?? []) as Array<{ buzon_id: string; hilos_sin_leer: number | string }>) salida.set(f.buzon_id, Number(f.hilos_sin_leer) || 0)
  return salida
}

/* ------------------------------------------------------------------ */
/* Guardar                                                             */
/* ------------------------------------------------------------------ */

const lanzarSiFalta = (error: unknown, que: string): never => {
  if (isMissingSchema(error)) throw new FaltaMigracion318()
  throw new Error(`No se ha podido guardar ${que}.`, { cause: error })
}

/**
 * Guarda los cambios de «Elegir mis correos» y de silenciar un buzón o un remitente. Ya validados (validarPeticionDePreferencias) y con cada buzón ya autorizado
 * para LEER por quien llama. Lo que un cambio no menciona se queda como estaba. Lanza FaltaMigracion318 si falta la migración.
 */
export async function guardarPreferencias(service: Servicio, userId: string, cambios: CambioDePreferencia[], opciones: { ahora?: number } = {}): Promise<void> {
  const ahora = new Date(opciones.ahora ?? Date.now())
  const deBuzon = cambios.filter((c): c is Extract<CambioDePreferencia, { buzonId: string }> => typeof c.buzonId === 'string')
  const deRemitente = cambios.filter((c): c is Extract<CambioDePreferencia, { remitente: string }> => typeof c.remitente === 'string')

  if (deBuzon.length > 0) {
    const { data, error } = await service.from('correo_buzon_preferencias').select(COLUMNAS_DE_PREFERENCIA).eq('user_id', userId).in('buzon_id', deBuzon.map((c) => c.buzonId))
    if (error) lanzarSiFalta(error, 'tus correos')
    const antes = new Map(((data ?? []) as FilaDePreferencia[]).map((f) => [f.buzon_id, f]))
    const filas = deBuzon.map((c) => {
      const a = antes.get(c.buzonId)
      const fila = {
        user_id: userId,
        buzon_id: c.buzonId,
        en_mis_correos: c.enMisCorreos !== undefined ? c.enMisCorreos : a?.en_mis_correos ?? null,
        orden: c.orden !== undefined ? c.orden : a?.orden ?? null,
        silenciado: a?.silenciado === true,
        silenciado_hasta: a?.silenciado_hasta ?? null,
        actualizado_at: ahora.toISOString(),
      }
      if (c.silencio === 'quitar') {
        fila.silenciado = false
        fila.silenciado_hasta = null
      } else if (c.silencio !== undefined) {
        fila.silenciado = true
        fila.silenciado_hasta = hastaDeDuracion(c.silencio, ahora)
      }
      return fila
    })
    const r = await service.from('correo_buzon_preferencias').upsert(filas, { onConflict: 'user_id,buzon_id' })
    if (r.error) lanzarSiFalta(r.error, 'tus correos')
  }

  const quitar = deRemitente.filter((c) => c.silencio === 'quitar').map((c) => c.remitente)
  const poner = deRemitente.filter((c) => c.silencio !== 'quitar')
  if (quitar.length > 0) {
    const { error } = await service.from('correo_remitente_silencios').delete().eq('user_id', userId).in('direccion', quitar)
    if (error) lanzarSiFalta(error, 'el silencio del remitente')
  }
  if (poner.length > 0) {
    const filas = poner.map((c) => ({ user_id: userId, direccion: c.remitente, hasta: c.silencio === 'quitar' ? null : hastaDeDuracion(c.silencio, ahora), creado_at: ahora.toISOString() }))
    const { error } = await service.from('correo_remitente_silencios').upsert(filas, { onConflict: 'user_id,direccion' })
    if (error) lanzarSiFalta(error, 'el silencio del remitente')
  }
}

/* ------------------------------------------------------------------ */
/* «Silenciados», en «Elige tus correos»                              */
/* ------------------------------------------------------------------ */

export interface ListaDeSilenciados {
  /** Lo que ha decidido de cada buzón que todavía lee */
  preferencias: Preferencia[]
  /** Remitentes silenciados AHORA */
  remitentes: Array<{ direccion: string; hasta: string | null }>
  /** Conversaciones silenciadas AHORA, solo de buzones que todavía lee */
  hilos: Array<{ hiloId: string; asunto: string; hasta: string | null }>
  /** false = falta la migración 318 */
  disponible: boolean
}

/**
 * Lo que la persona tiene silenciado, para «Silenciados» en «Elige tus correos». Las conversaciones de un buzón que ya NO lee (se lo quitaron, o se lo bloquearon) no salen: ni su
 * asunto ni su id. Lo mismo con las preferencias de esos buzones. Lo vencido no sale (ya no silencia nada).
 */
export async function listarSilenciados(service: Servicio, userId: string, puedeLeer: (buzonId: string) => boolean, opciones: { ahora?: number } = {}): Promise<ListaDeSilenciados> {
  const ahora = opciones.ahora ?? Date.now()
  const [prefs, silencios] = await Promise.all([leerPreferencias(service, userId), leerSilencios(service, userId)])
  if (!prefs.disponible) return { preferencias: [], remitentes: [], hilos: [], disponible: false }

  const preferencias = [...prefs.porBuzon.values()].filter((p) => puedeLeer(p.buzonId))
  const remitentes = [...silencios.remitentes]
    .filter(([, hasta]) => estaSilenciado(hasta, true, ahora))
    .map(([direccion, hasta]) => ({ direccion, hasta }))
    .sort((a, b) => a.direccion.localeCompare(b.direccion, 'es'))

  const vigentes = [...silencios.hilos].filter(([, hasta]) => estaSilenciado(hasta, true, ahora))
  let hilos: ListaDeSilenciados['hilos'] = []
  if (vigentes.length > 0) {
    const { data, error } = await service.from('correo_hilos').select('id, buzon_id, asunto').in('id', vigentes.map(([id]) => id))
    if (error) throw new Error('No se han podido leer las conversaciones silenciadas.', { cause: error })
    const porId = new Map(((data ?? []) as Array<{ id: string; buzon_id: string; asunto: string | null }>).map((h) => [h.id, h]))
    hilos = vigentes
      .map(([id, hasta]) => ({ h: porId.get(id), hasta }))
      .filter((x): x is { h: { id: string; buzon_id: string; asunto: string | null }; hasta: string | null } => x.h !== undefined && puedeLeer(x.h.buzon_id))
      .map(({ h, hasta }) => ({ hiloId: h.id, asunto: h.asunto?.trim() || '(sin asunto)', hasta }))
  }
  return { preferencias, remitentes, hilos, disponible: true }
}

/* ------------------------------------------------------------------ */
/* A quién se le escribe el aviso de un correo nuevo                   */
/* ------------------------------------------------------------------ */

export interface DestinatarioDeAviso {
  personaId: string
  /** Su nombre, para el rastro ('aviso') de quien no es el dueño */
  nombre: string
  /** Sus silencios de hilo y de remitente: se aplican por persona con filtrarAvisos */
  silencios: Silencios
  esDueno: boolean
  asignado: boolean
  /**
   * El aviso puede llevar asunto y vista previa: el dueño y quien lo tiene asignado (a este último, solo si su rastro 'aviso' se puede escribir). Quien solo lo SIGUE
   * («Mis correos» sin asignación) recibe siempre «Correo nuevo en <dirección>»: el contenido, al abrirlo (y ahí deja su rastro).
   */
  conContenido: boolean
}

/** Puede recibir avisos de correo: tiene la app, no es partner y no está desactivado. Además tiene que poder leer el buzón */
export function puedeRecibirAvisos(regla: ReglaEnBloque, personaId: string, buzon: { id: string; user_id: string }): boolean {
  const p = regla.persona(personaId)
  if (!p || !p.appCorreo || !p.activo || p.role === 'partner') return false
  return regla.evaluar(personaId, buzon, 'leer').ok
}

/**
 * Lo mismo que destinatariosDeAvisos, devolviendo también la regla cargada (la campana la reutiliza para los rebotes, sin volver a cargarla). `regla` es null sin la 318.
 */
export async function destinatariosConRegla(
  service: Servicio,
  buzon: { id: string; user_id: string },
  opciones: { ahora?: number } = {},
): Promise<{ destinatarios: DestinatarioDeAviso[]; regla: ReglaEnBloque | null }> {
  const ahora = opciones.ahora ?? Date.now()
  const soloElDueno = (nombre = ''): DestinatarioDeAviso[] => [{ personaId: buzon.user_id, nombre, silencios: SIN_SILENCIOS, esDueno: true, asignado: false, conContenido: true }]

  const { data, error } = await service.from('correo_buzon_preferencias').select('user_id, en_mis_correos, silenciado, silenciado_hasta').eq('buzon_id', buzon.id)
  if (error) {
    // Sin la 318: solo el dueño, como siempre (sin silencios, que tampoco existen)
    if (isMissingSchema(error)) return { destinatarios: soloElDueno(), regla: null }
    throw new Error('No se han podido leer quién sigue este buzón.', { cause: error })
  }
  const filas = (data ?? []) as Array<{ user_id: string; en_mis_correos: boolean | null; silenciado: boolean | null; silenciado_hasta: string | null }>

  const regla = await cargarReglaEnBloque(service, { ahora })
  const asignadoA = (id: string): boolean => {
    const d = regla.evaluar(id, buzon, 'leer')
    return d.ok && d.asignado
  }
  const asignados = regla.personas.filter((id) => id !== buzon.user_id && asignadoA(id))
  const ids = quienRecibeElAviso({
    duenoId: buzon.user_id,
    asignados: asignados.map((personaId) => ({ personaId })),
    seguidores: filas.filter((f) => f.en_mis_correos === true).map((f) => f.user_id),
    quitadoDeMisCorreos: filas.filter((f) => f.en_mis_correos === false).map((f) => f.user_id),
    silenciadoPor: new Map(filas.filter((f) => f.silenciado === true).map((f) => [f.user_id, f.silenciado_hasta ?? null])),
    puedeLeer: (id) => puedeRecibirAvisos(regla, id, buzon),
    ahora,
  })
  if (ids.length === 0) return { destinatarios: [], regla }

  const silencios = await silenciosDe(service, ids)
  const destinatarios = ids.map<DestinatarioDeAviso>((id) => {
    const esDueno = id === buzon.user_id
    const asignado = !esDueno && asignadoA(id)
    return { personaId: id, nombre: regla.persona(id)?.nombre ?? 'Sin nombre', silencios: silencios.get(id) ?? SIN_SILENCIOS, esDueno, asignado, conContenido: esDueno || asignado }
  })
  return { destinatarios, regla }
}

/**
 * A quién se le escribe el aviso de un correo nuevo en este buzón, y cómo. SIN CACHÉ: solo se llama cuando entra correo nuevo, y así nada que cambie en «Quién ve qué»,
 * en Asignaciones o en Gestión de usuarios tiene que invalidarla.
 *
 *   · Regla: el dueño, quien lo tiene asignado y quien lo sigue en «Mis correos», salvo que lo haya quitado de «Mis correos» o lo tenga silenciado (preferencias.ts, `avisaA`).
 *   · Además: puede leerlo HOY (decidirAcceso, cargada en bloque), tiene la app «Correo», no es partner y no está desactivado.
 *   · Sin la 318: solo el dueño, como antes.
 */
export async function destinatariosDeAvisos(service: Servicio, buzon: { id: string; user_id: string }, opciones: { ahora?: number } = {}): Promise<DestinatarioDeAviso[]> {
  return (await destinatariosConRegla(service, buzon, opciones)).destinatarios
}
