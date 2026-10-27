import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { normalizarBriefing } from './esquema'
import { TIPO_DE_BRIEFING, type Briefing, type BriefingGuardado, type DiaConBriefing, type EstadoDelConector, type MarcaDeResuelto } from './tipos'

export type { EstadoDelConector }

/**
 * EL BRIEFING EN LA BASE DE DATOS Y EL ENLACE SECRETO DEL CONECTOR.
 * =================================================================
 * SOLO SERVIDOR. Se comprueba con servidor.prueba.ts contra una base de mentira en memoria.
 *
 * Las tres tablas (migración 254) están CERRADAS al navegador: ni lectura ni escritura con la sesión de nadie. Todo pasa por el cliente de servicio, DESPUÉS
 * de que la ruta o la pantalla haya comprobado quién es y si tiene la casilla «Briefing» (lib/briefing/tipos.ts: APP_BRIEFING).
 *
 *   · `briefings`        un briefing por día, ya limpio (esquema.ts). Volver a publicar el mismo día lo SUSTITUYE y conserva la fecha de la primera publicación.
 *   · `briefing_marcas`  qué puntos se han marcado como resueltos, por quién y cuándo. Cuelga del día: borrar un día borra sus marcas.
 *   · `briefing_conector` EL ENLACE SECRETO con el que la rutina publica. Solo se guarda su huella SHA-256: el enlace entero se enseña UNA vez, al crearlo.
 *
 * SIN LA MIGRACIÓN NADA REVIENTA: cada función que escribe lanza FaltaMigracionDelBriefing (con la frase de qué fichero lanzar) y las de lectura contestan
 * «no hay nada». La pantalla y el conector lo traducen a un aviso.
 */

type Servicio = ReturnType<typeof createServiceClient>

export const FALTA_MIGRACION_BRIEFING = 'Falta lanzar la migración 254_briefing.sql en el editor SQL de Supabase: hasta entonces no se puede guardar ni leer el briefing.'

export class FaltaMigracionDelBriefing extends Error {
  constructor() {
    super(FALTA_MIGRACION_BRIEFING)
    this.name = 'FaltaMigracionDelBriefing'
  }
}

/** Lanza FaltaMigracionDelBriefing si el error es que la tabla no existe; si no, lo deja como una frase nuestra (sin el cuerpo del error) */
function fallar(error: unknown, frase: string): never {
  if (isMissingSchema(error)) throw new FaltaMigracionDelBriefing()
  throw new Error(frase, { cause: error })
}

const ahoraIso = () => new Date().toISOString()

/* ------------------------------------------------------------------ */
/* Los briefings                                                       */
/* ------------------------------------------------------------------ */

/** Guarda el briefing de un día, o lo sustituye si ya había uno. `nuevo` dice si es la primera vez */
export async function publicarBriefing(service: Servicio, entrada: { dia: string; briefing: Briefing }): Promise<{ nuevo: boolean }> {
  const { dia, briefing } = entrada
  const previo = await service.from('briefings').select('dia').eq('tipo', TIPO_DE_BRIEFING).eq('dia', dia).maybeSingle()
  if (previo.error) fallar(previo.error, 'No se ha podido comprobar si ya había un briefing de ese día.')
  const nuevo = !previo.data

  // Sin `publicado_at` en el upsert: en una sustitución la fecha de la primera publicación se queda como estaba
  const { error } = await service.from('briefings').upsert(
    {
      tipo: TIPO_DE_BRIEFING,
      dia,
      contenido: briefing,
      titular: briefing.titular.slice(0, 300),
      puntos_revisar: briefing.revisar.length,
      actualizado_at: ahoraIso(),
    },
    { onConflict: 'tipo,dia' }
  )
  if (error) fallar(error, 'No se ha podido guardar el briefing.')
  return { nuevo }
}

/** El briefing de un día (null = el último que haya). null si no hay ninguno; un contenido que ya no se lee bien se trata como si no estuviera */
export async function leerBriefing(service: Servicio, dia: string | null): Promise<BriefingGuardado | null> {
  const base = service.from('briefings').select('dia, contenido, publicado_at, actualizado_at').eq('tipo', TIPO_DE_BRIEFING)
  const { data, error } = await (dia ? base.eq('dia', dia).maybeSingle() : base.order('dia', { ascending: false }).limit(1).maybeSingle())
  if (error) {
    if (isMissingSchema(error)) return null
    throw new Error('No se ha podido leer el briefing.', { cause: error })
  }
  if (!data) return null
  const fila = data as { dia: string; contenido: unknown; publicado_at: string; actualizado_at: string }
  // Se vuelve a limpiar al leer: si el código aprendió campos nuevos desde que se guardó, el briefing viejo los trae por defecto
  const limpio = normalizarBriefing(fila.contenido)
  if (!limpio.ok) {
    console.error('[briefing] un briefing guardado ya no se lee', { dia: fila.dia })
    return null
  }
  return { dia: fila.dia, briefing: limpio.briefing, publicadoAt: fila.publicado_at, actualizadoAt: fila.actualizado_at }
}

/** ¿Está lanzada la migración 254? Una lectura de nada: la pantalla lo usa para decir qué fichero lanzar en vez de enseñar un briefing vacío sin explicación */
export async function migracionLanzada(service: Servicio): Promise<boolean> {
  const { error } = await service.from('briefings').select('dia').limit(1)
  if (!error) return true
  if (isMissingSchema(error)) return false
  throw new Error('No se ha podido comprobar la migración del briefing.', { cause: error })
}

/** Los últimos días con briefing, del más nuevo al más viejo, para el selector de la pantalla */
export async function diasConBriefing(service: Servicio, limite = 60): Promise<DiaConBriefing[]> {
  const { data, error } = await service.from('briefings').select('dia, titular, puntos_revisar').eq('tipo', TIPO_DE_BRIEFING).order('dia', { ascending: false }).limit(limite)
  if (error) {
    if (isMissingSchema(error)) return []
    throw new Error('No se han podido leer los días con briefing.', { cause: error })
  }
  return ((data ?? []) as Array<{ dia: string; titular: string; puntos_revisar: number }>).map((f) => ({ dia: f.dia, titular: f.titular, puntosARevisar: f.puntos_revisar }))
}

/* ------------------------------------------------------------------ */
/* Las marcas de «resuelto»                                            */
/* ------------------------------------------------------------------ */

/** Las marcas de un día, por clave, con el nombre de quien las puso */
export async function marcasDelDia(service: Servicio, dia: string): Promise<Record<string, MarcaDeResuelto>> {
  const { data, error } = await service.from('briefing_marcas').select('clave, hecho_por, hecho_at').eq('tipo', TIPO_DE_BRIEFING).eq('dia', dia)
  if (error) {
    if (isMissingSchema(error)) return {}
    throw new Error('No se han podido leer las marcas del briefing.', { cause: error })
  }
  const filas = (data ?? []) as Array<{ clave: string; hecho_por: string | null; hecho_at: string }>
  const ids = [...new Set(filas.map((f) => f.hecho_por).filter((x): x is string => !!x))]
  const nombres = new Map<string, string>()
  if (ids.length > 0) {
    const perfiles = await service.from('profiles').select('id, full_name').in('id', ids)
    // Sin los nombres se enseña igualmente quién marcó… sin nombre: no es motivo para perder las marcas
    if (!perfiles.error) for (const p of (perfiles.data ?? []) as Array<{ id: string; full_name: string | null }>) if (p.full_name) nombres.set(p.id, p.full_name)
  }
  const salida: Record<string, MarcaDeResuelto> = {}
  for (const f of filas) salida[f.clave] = { por: f.hecho_por ? (nombres.get(f.hecho_por) ?? null) : null, cuando: f.hecho_at }
  return salida
}

/** Marca (hecho = true) o desmarca un punto de un día */
export async function marcarPunto(service: Servicio, entrada: { dia: string; clave: string; hecho: boolean; userId: string }): Promise<void> {
  const { dia, clave, hecho, userId } = entrada
  if (hecho) {
    const { error } = await service.from('briefing_marcas').upsert({ tipo: TIPO_DE_BRIEFING, dia, clave, hecho_por: userId, hecho_at: ahoraIso() }, { onConflict: 'tipo,dia,clave' })
    if (error) fallar(error, 'No se ha podido marcar el punto.')
    return
  }
  const { error } = await service.from('briefing_marcas').delete().eq('tipo', TIPO_DE_BRIEFING).eq('dia', dia).eq('clave', clave)
  if (error) fallar(error, 'No se ha podido quitar la marca del punto.')
}

/** ¿Es una clave de punto con la forma que da el validador? («r-1a2b3c4d», «c-1a2b3c4d-2») */
export const esClaveDePunto = (v: unknown): v is string => typeof v === 'string' && /^[rc]-[0-9a-f]{8}(-\d{1,3})?$/.test(v)

/** ¿Existe ese punto en ese briefing? Así una marca no puede apuntar a algo que no está */
export function claveExisteEn(briefing: Briefing, clave: string): boolean {
  return briefing.revisar.some((p) => p.clave === clave) || briefing.correo.some((c) => c.clave === clave)
}

/* ------------------------------------------------------------------ */
/* El enlace secreto del conector                                      */
/* ------------------------------------------------------------------ */

/** La huella de un enlace: es lo único que se guarda. Con 32 bytes al azar no se puede recuperar el enlace desde ella */
export const huellaDelEnlace = (token: string): string => createHash('sha256').update(token).digest('hex')

/** Un enlace nuevo: 32 bytes al azar en base64url (43 caracteres) */
export const enlaceNuevo = (): string => randomBytes(32).toString('base64url')

/** La forma que tiene que tener un enlace para ni mirar la base (los de 43 caracteres de enlaceNuevo, con algo de margen) */
const FORMA_DEL_ENLACE = /^[A-Za-z0-9_-]{32,64}$/

/** Crea un enlace nuevo (el anterior deja de valer) y lo devuelve ENTERO: es la única vez que se puede ver */
export async function crearEnlaceDelConector(service: Servicio, userId: string): Promise<{ token: string }> {
  const token = enlaceNuevo()
  const { error } = await service.from('briefing_conector').upsert({ id: true, token_hash: huellaDelEnlace(token), creado_at: ahoraIso(), creado_por: userId, ultimo_uso_at: null }, { onConflict: 'id' })
  if (error) fallar(error, 'No se ha podido crear el enlace del conector.')
  return { token }
}

/** Anula el enlace: la rutina deja de poder publicar hasta que se cree otro */
export async function anularEnlaceDelConector(service: Servicio): Promise<void> {
  const { error } = await service.from('briefing_conector').delete().eq('id', true)
  if (error) fallar(error, 'No se ha podido anular el enlace del conector.')
}

export async function estadoDelConector(service: Servicio): Promise<EstadoDelConector> {
  const { data, error } = await service.from('briefing_conector').select('creado_at, ultimo_uso_at').eq('id', true).maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return { hayEnlace: false, creadoAt: null, ultimoUsoAt: null }
    throw new Error('No se ha podido leer el estado del conector.', { cause: error })
  }
  if (!data) return { hayEnlace: false, creadoAt: null, ultimoUsoAt: null }
  const f = data as { creado_at: string; ultimo_uso_at: string | null }
  return { hayEnlace: true, creadoAt: f.creado_at, ultimoUsoAt: f.ultimo_uso_at }
}

/** Cada cuánto se apunta que el enlace se ha usado (no hace falta una escritura por cada mensaje) */
const MS_ENTRE_USOS_APUNTADOS = 5 * 60_000

/**
 * ¿Es válido este enlace? 'invalido' = no es el de ahora (o no hay ninguno); 'error' = no se ha podido comprobar (la base no contesta: la ruta contesta 503 y no
 * 404, para que Claude no dé por muerto un enlace bueno). La comparación es de huellas y a tiempo constante.
 */
export async function comprobarEnlaceDelConector(service: Servicio, token: string, ahora = Date.now()): Promise<'ok' | 'invalido' | 'error'> {
  if (!FORMA_DEL_ENLACE.test(token)) return 'invalido'
  try {
    const { data, error } = await service.from('briefing_conector').select('token_hash, ultimo_uso_at').eq('id', true).maybeSingle()
    if (error) return isMissingSchema(error) ? 'invalido' : 'error'
    if (!data) return 'invalido'
    const f = data as { token_hash: string; ultimo_uso_at: string | null }
    const esperada = Buffer.from(f.token_hash, 'hex')
    const recibida = Buffer.from(huellaDelEnlace(token), 'hex')
    if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return 'invalido'
    const ultimo = f.ultimo_uso_at ? Date.parse(f.ultimo_uso_at) : 0
    if (!Number.isFinite(ultimo) || ahora - ultimo >= MS_ENTRE_USOS_APUNTADOS) {
      // Sin esperar y sin que un fallo estropee la petición: es solo para que la pantalla diga «usado hace…»
      void Promise.resolve(service.from('briefing_conector').update({ ultimo_uso_at: new Date(ahora).toISOString() }).eq('id', true)).catch(() => undefined)
    }
    return 'ok'
  } catch {
    return 'error'
  }
}
