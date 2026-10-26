import type { createServiceClient } from '@/lib/supabase/service'
import { MARGEN_DE_RELOJ_MS, VENTANA_DE_NOVEDAD_MS, avisosDeCorreo, type MensajeParaAviso } from './avisos'
import { avisoDeCorreoNuevo, claveDeMensaje, sinRepetidos, type AvisoParaLaCampana, type DetalleDeRebote } from './campana'
import { TIPOS_DE_AVISO_DE_CORREO } from './campana-tipos'
import { extraerDireccionesFallidas, motivoDeRebote } from './verificacion/rebotes'

/**
 * ESCRIBIR LOS AVISOS DE CORREO EN LA CAMPANA DE CADA PERSONA — SOLO SERVIDOR.
 * ============================================================================
 * Los textos están en campana.ts. Aquí se escriben en `notifications` (migración 251), se avisa de los correos que acaban de entrar en un buzón y
 * se marcan como leídos los avisos de lo que la persona ya ha leído.
 *
 * NADA DE ESTO PUEDE ESTROPEAR EL CORREO. Quien llama (la lectura de un buzón, el motor de seguimientos, abrir un hilo) lo envuelve en un try/catch:
 * un aviso que no se puede escribir es un aviso menos, no un correo sin leer ni un seguimiento sin enviar.
 *
 * SIN LA MIGRACIÓN 251 la base rechaza el aviso (el tipo nuevo, la columna `clave`, el índice): se apunta UNA vez en el registro, se deja de intentar
 * durante una hora y el resto del ERP sigue como siempre.
 */

type Servicio = ReturnType<typeof createServiceClient>

export const FALTA_LA_MIGRACION_251 =
  'Falta lanzar la migración 251_campana_avisos_de_correo.sql en el editor SQL de Supabase: sin ella los avisos de correo de la campana no se pueden escribir (el correo y los seguimientos funcionan igual).'

/** Lo que contesta la base cuando falta la migración: un tipo que no admite (23514), una columna que no existe (42703, PGRST204) o un ON CONFLICT sin su índice (42P10) */
const CODIGOS_DE_MIGRACION_FALTANTE = new Set(['23514', '42703', 'PGRST204', '42P10'])

/** Hasta cuándo no se vuelve a intentar escribir porque la base lo rechazó (falta la 251). Vive lo que vive el proceso */
let sinLa251Hasta = 0
const ESPERA_SIN_LA_251_MS = 3_600_000

/** Solo para las pruebas: vuelve a intentar escribir aunque antes se hubiera rechazado */
export function reiniciarLaCampanaDeCorreo(): void {
  sinLa251Hasta = 0
  ultimaPurga = 0
}

const iso = (ms: number): string => new Date(ms).toISOString()

/** Los avisos como filas de `notifications` */
function filas(avisos: readonly AvisoParaLaCampana[], datosPrevios?: ReadonlyMap<string, Record<string, unknown>>) {
  return avisos.map((a) => ({
    user_id: a.userId,
    type: a.tipo,
    title: a.titulo,
    message: a.mensaje,
    clave: a.clave,
    datos: { ...(datosPrevios?.get(`${a.userId}\u0000${a.clave}`) ?? {}), ...a.datos },
  }))
}

function esDeMigracionFaltante(error: { code?: string } | null): boolean {
  return Boolean(error && error.code && CODIGOS_DE_MIGRACION_FALTANTE.has(error.code))
}

/**
 * Escribe avisos en la campana. Los que no son «mejoras» no se repiten (si ya hay uno con esa clave para esa persona, se deja el que había); los
 * que lo son (`enriquecer`) cambian el texto del que ya hubiera con esa clave —sin tocar si estaba leído— y, si no hay ninguno, se crean.
 * Devuelve cuántos ha intentado escribir y si la base los ha rechazado por falta de la migración. Lanza si la base falla por otra cosa.
 */
export async function escribirAvisosDeCorreo(service: Servicio, avisos: readonly AvisoParaLaCampana[], reloj: () => number = Date.now): Promise<{ escritos: number; faltaMigracion: boolean }> {
  const lista = sinRepetidos(avisos).filter((a) => a.userId && a.clave && a.titulo)
  if (lista.length === 0) return { escritos: 0, faltaMigracion: false }
  if (reloj() < sinLa251Hasta) return { escritos: 0, faltaMigracion: true }

  const nuevos = lista.filter((a) => !a.enriquecer)
  const mejoras = lista.filter((a) => a.enriquecer)

  const fallo = (error: { code?: string; message?: string }, que: string): { escritos: number; faltaMigracion: true } => {
    if (esDeMigracionFaltante(error)) {
      sinLa251Hasta = reloj() + ESPERA_SIN_LA_251_MS
      console.warn('Correo · campana:', FALTA_LA_MIGRACION_251)
      return { escritos: 0, faltaMigracion: true }
    }
    throw new Error(`No se han podido escribir los avisos de la campana (${que}).`, { cause: error })
  }

  let escritos = 0
  if (nuevos.length > 0) {
    const { error } = await service.from('notifications').upsert(filas(nuevos), { onConflict: 'user_id,clave', ignoreDuplicates: true })
    if (error) return fallo(error, 'nuevos')
    escritos += nuevos.length
  }
  if (mejoras.length > 0) {
    // Una mejora conserva lo que el aviso ya llevaba (de qué buzón y de qué hilo es): se mezclan los datos antes de escribir
    const { data, error: errorLectura } = await service.from('notifications').select('user_id, clave, datos').in('clave', mejoras.map((a) => a.clave))
    if (errorLectura) return fallo(errorLectura, 'lectura previa')
    const previos = new Map<string, Record<string, unknown>>()
    for (const f of (data ?? []) as Array<{ user_id: string; clave: string; datos: Record<string, unknown> | null }>) previos.set(`${f.user_id}\u0000${f.clave}`, f.datos ?? {})
    const { error } = await service.from('notifications').upsert(filas(mejoras, previos), { onConflict: 'user_id,clave' })
    if (error) return fallo(error, 'mejoras')
    escritos += mejoras.length
  }
  return { escritos, faltaMigracion: false }
}

/* ------------------------------------------------------------------ */
/* Correo que acaba de entrar en un buzón                              */
/* ------------------------------------------------------------------ */

/** Cuántos correos nuevos de una lectura avisan como mucho: lo que pase de aquí no es una persona escribiendo, es una importación */
export const MAX_AVISOS_POR_LECTURA = 25

const dominioDe = (direccion: string): string => (direccion.split('@')[1] ?? '').trim().toLowerCase()

/**
 * Avisa en la campana de su dueño de los correos de PERSONAS (y de los rebotes) que han entrado en el buzón desde `desde` (el momento en que empezó la
 * lectura): sin leer, con fecha de las últimas horas (lo antiguo que entra de golpe al conectar un buzón no es un correo que acabe de llegar) y no
 * automáticos. Es la misma cuenta que hace el aviso de abajo a la derecha (lib/correo/avisos.ts), de modo que la campana y el aviso hablan de lo mismo.
 *
 * Idempotente: el aviso lleva la clave del correo, así que repetir la consulta (dos lecturas a la vez, o la siguiente, cuyo margen de reloj se solapa
 * con esta) no escribe nada más.
 */
export async function avisarDeCorreoNuevo(
  service: Servicio,
  buzon: { id: string; user_id: string },
  opciones: { desde: number; ahora?: number; reloj?: () => number }
): Promise<{ avisos: number; faltaMigracion: boolean }> {
  const ahora = opciones.ahora ?? Date.now()
  const { data, error } = await service
    .from('correo_mensajes')
    .select('id, buzon_id, hilo_id, de_nombre, de_direccion, asunto, vista_previa, fecha, automatico')
    .eq('buzon_id', buzon.id)
    .eq('direccion', 'entrante')
    .eq('leido', false)
    .gt('creado_at', iso(opciones.desde - MARGEN_DE_RELOJ_MS))
    .gte('fecha', iso(ahora - VENTANA_DE_NOVEDAD_MS))
    .order('fecha', { ascending: false })
    .limit(MAX_AVISOS_POR_LECTURA)
  if (error) throw new Error('No se han podido leer los correos nuevos para avisar.', { cause: error })

  const candidatos = avisosDeCorreo((data ?? []) as MensajeParaAviso[], MAX_AVISOS_POR_LECTURA)
  if (candidatos.length === 0) return { avisos: 0, faltaMigracion: false }

  // De un rebote se lee la dirección que falló y por qué: hace falta el texto del aviso, que no se trae con los demás para no cargar cuerpos enteros
  const detalles = new Map<string, DetalleDeRebote>()
  const rebotes = candidatos.filter((c) => c.rebote)
  if (rebotes.length > 0) {
    const [{ data: textos }, { data: buzones }] = await Promise.all([
      service.from('correo_mensajes').select('id, texto').in('id', rebotes.map((r) => r.id)),
      service.from('correo_buzones').select('direccion'),
    ])
    const dominiosPropios = new Set(((buzones ?? []) as Array<{ direccion: string }>).map((b) => dominioDe(b.direccion)).filter(Boolean))
    for (const t of (textos ?? []) as Array<{ id: string; texto: string | null }>) {
      const texto = t.texto ?? ''
      const direcciones = extraerDireccionesFallidas(texto, dominiosPropios)
      detalles.set(t.id, { direccion: direcciones.length === 1 ? direcciones[0] : null, motivo: motivoDeRebote(texto) })
    }
  }

  const avisos = candidatos.map((c) => avisoDeCorreoNuevo(buzon.user_id, c, detalles.get(c.id) ?? null))
  const r = await escribirAvisosDeCorreo(service, avisos, opciones.reloj)
  return { avisos: r.escritos, faltaMigracion: r.faltaMigracion }
}

/* ------------------------------------------------------------------ */
/* Lo que se lee, se apaga                                             */
/* ------------------------------------------------------------------ */

/** Marca como leídos los avisos de esos correos (la persona los acaba de leer: ya no hay nada que avisarle). Un fallo aquí no se propaga */
export async function marcarAvisosDeCorreoLeidos(service: Servicio, mensajeIds: readonly string[]): Promise<void> {
  if (mensajeIds.length === 0) return
  try {
    const { error } = await service.from('notifications').update({ read: true }).in('clave', mensajeIds.map(claveDeMensaje)).eq('read', false)
    // Sin la migración no hay columna `clave`: es lo esperado hasta que se lance y no merece ruido
    if (error && !esDeMigracionFaltante(error)) console.warn('Correo · campana: no se han podido marcar como leídos los avisos', { codigo: error.code ?? null })
  } catch (e) {
    console.warn('Correo · campana: no se han podido marcar como leídos los avisos', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
  }
}

/* ------------------------------------------------------------------ */
/* Limpieza                                                            */
/* ------------------------------------------------------------------ */

/** Cuánto vive un aviso de correo: pasado esto ni se mira ni hace falta */
export const DIAS_DE_VIDA_DE_UN_AVISO = 45
const ENTRE_PURGAS_MS = 6 * 3_600_000
let ultimaPurga = 0

/**
 * Borra los avisos de correo de más de 45 días (los de otras cosas —leads web, Amazon, alarmas— no se tocan). Como mucho una vez cada seis horas
 * por proceso. Nunca lanza.
 */
export async function purgarAvisosDeCorreoViejos(service: Servicio, ahora: number = Date.now()): Promise<boolean> {
  if (ahora - ultimaPurga < ENTRE_PURGAS_MS) return false
  ultimaPurga = ahora
  try {
    const { error } = await service
      .from('notifications')
      .delete()
      .in('type', [...TIPOS_DE_AVISO_DE_CORREO])
      .lt('created_at', iso(ahora - DIAS_DE_VIDA_DE_UN_AVISO * 86_400_000))
    if (error) {
      if (!esDeMigracionFaltante(error)) console.warn('Correo · campana: no se han podido borrar los avisos viejos', { codigo: error.code ?? null })
      return false
    }
    return true
  } catch (e) {
    console.warn('Correo · campana: no se han podido borrar los avisos viejos', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
    return false
  }
}
