import { isMissingSchema } from '@/lib/plataforma/eventos'
import type { createServiceClient } from '@/lib/supabase/service'
import { MARGEN_DE_RELOJ_MS, VENTANA_DE_NOVEDAD_MS, avisosDeCorreo, type MensajeParaAviso } from './avisos'
import { avisoDeCorreoNuevo, claveDeMensaje, sinRepetidos, type AvisoParaLaCampana, type DetalleDeRebote } from './campana'
import { TIPOS_DE_AVISO_DE_CORREO } from './campana-tipos'
import { SIN_SILENCIOS, destinatariosDeRebote, filtrarAvisos } from './preferencias'
import { destinatariosConRegla, puedeRecibirAvisos, type DestinatarioDeAviso } from './preferencias-servidor'
import type { ReglaEnBloque } from './lectores-servidor'
import { registrarAcceso } from './quien-servidor'
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
 *
 * DESDE LA MIGRACIÓN 318 un correo nuevo no avisa solo al dueño: también a quien tiene el buzón asignado y a quien lo sigue en «Mis correos», con sus silencios
 * (preferencias-servidor.ts decide a quién). Quien no es el dueño deja rastro ('aviso') antes de recibir asunto y vista previa; si no se puede, su aviso va sin contenido.
 * Los avisos 'correo_asignado' van por su PROPIA vía (escribirAvisoDeAsignacion), con su propio interruptor: que la base rechace ese tipo nuevo (318 sin lanzar) no puede
 * dejar una hora sin avisos de correo nuevo.
 *
 * NUNCA IMPORTA servidor.ts (ni mailparser ni IMAP).
 */

type Servicio = ReturnType<typeof createServiceClient>

export const FALTA_LA_MIGRACION_251 =
  'Falta lanzar la migración 251_campana_avisos_de_correo.sql en el editor SQL de Supabase: sin ella los avisos de correo de la campana no se pueden escribir (el correo y los seguimientos funcionan igual).'

/** Lo que contesta la base cuando falta la migración: un tipo que no admite (23514), una columna que no existe (42703, PGRST204) o un ON CONFLICT sin su índice (42P10) */
const CODIGOS_DE_MIGRACION_FALTANTE = new Set(['23514', '42703', 'PGRST204', '42P10'])

/** Hasta cuándo no se vuelve a intentar escribir porque la base lo rechazó (falta la 251). Vive lo que vive el proceso */
let sinLa251Hasta = 0
const ESPERA_SIN_LA_251_MS = 3_600_000
/** Lo mismo para los avisos 'correo_asignado' (falta la 318). Un interruptor APARTE: no apaga los demás avisos */
let sinLa318Hasta = 0

export const FALTA_LA_MIGRACION_318_EN_LA_CAMPANA =
  'Falta lanzar la migración 318_correo_mis_asignaciones_silencios.sql en el editor SQL de Supabase: sin ella la campana no admite los avisos de asignación (el resto de avisos funciona igual).'

/** Solo para las pruebas: vuelve a intentar escribir aunque antes se hubiera rechazado */
export function reiniciarLaCampanaDeCorreo(): void {
  sinLa251Hasta = 0
  sinLa318Hasta = 0
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
  const todos = sinRepetidos(avisos).filter((a) => a.userId && a.clave && a.titulo)
  // Los de asignación, por su vía (y su interruptor): un rechazo suyo no apaga los demás
  const deAsignacion = todos.filter((a) => a.tipo === 'correo_asignado')
  const lista = todos.filter((a) => a.tipo !== 'correo_asignado')
  const asig = deAsignacion.length > 0 ? await escribirAvisoDeAsignacion(service, deAsignacion, reloj) : { escritos: 0, faltaMigracion: false }
  if (lista.length === 0) return asig
  const r = await escribirSinMirarElTipo(service, lista, () => {
    sinLa251Hasta = reloj() + ESPERA_SIN_LA_251_MS
    console.warn('Correo · campana:', FALTA_LA_MIGRACION_251)
  }, () => reloj() < sinLa251Hasta)
  return { escritos: r.escritos + asig.escritos, faltaMigracion: r.faltaMigracion || asig.faltaMigracion }
}

/**
 * Escribe avisos 'correo_asignado' (te han encargado un hilo, te han asignado un buzón, o se lo han asignado a alguien en el tuyo). Vía PROPIA:
 *   · Antes comprueba que existe correo_buzon_asignaciones (la 318): si no, ni lo intenta.
 *   · Si la base rechaza el tipo (23514: la 318 no ha ampliado la lista de la campana) o una columna, se deja de intentar una hora CON SU PROPIO INTERRUPTOR: los avisos de
 *     correo nuevo siguen escribiéndose.
 * Devuelve cuántos ha intentado escribir y si falta la migración. Lanza si la base falla por otra cosa.
 */
export async function escribirAvisoDeAsignacion(service: Servicio, avisos: readonly AvisoParaLaCampana[], reloj: () => number = Date.now): Promise<{ escritos: number; faltaMigracion: boolean }> {
  const lista = sinRepetidos(avisos).filter((a) => a.userId && a.clave && a.titulo)
  if (lista.length === 0) return { escritos: 0, faltaMigracion: false }
  if (reloj() < sinLa318Hasta) return { escritos: 0, faltaMigracion: true }
  const apagar = () => {
    sinLa318Hasta = reloj() + ESPERA_SIN_LA_251_MS
    console.warn('Correo · campana:', FALTA_LA_MIGRACION_318_EN_LA_CAMPANA)
  }
  const existe = await service.from('correo_buzon_asignaciones').select('buzon_id', { count: 'exact', head: true }).limit(1)
  if (existe.error) {
    if (isMissingSchema(existe.error)) {
      apagar()
      return { escritos: 0, faltaMigracion: true }
    }
    throw new Error('No se ha podido comprobar si la campana admite los avisos de asignación.', { cause: existe.error })
  }
  return escribirSinMirarElTipo(service, lista, apagar, () => false)
}

/** Escribe en `notifications`. Si la base contesta que falta una migración, llama a `alFaltar` (que apaga SU interruptor) y lo dice */
async function escribirSinMirarElTipo(
  service: Servicio,
  lista: readonly AvisoParaLaCampana[],
  alFaltar: () => void,
  apagado: () => boolean,
): Promise<{ escritos: number; faltaMigracion: boolean }> {
  if (lista.length === 0) return { escritos: 0, faltaMigracion: false }
  if (apagado()) return { escritos: 0, faltaMigracion: true }

  const nuevos = lista.filter((a) => !a.enriquecer)
  const mejoras = lista.filter((a) => a.enriquecer)

  const fallo = (error: { code?: string; message?: string }, que: string): { escritos: number; faltaMigracion: true } => {
    if (esDeMigracionFaltante(error)) {
      alFaltar()
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
 * Avisa en la campana de los correos de PERSONAS (y de los rebotes) que han entrado en el buzón desde `desde` (el momento en que empezó la lectura): sin leer,
 * con fecha de las últimas horas (lo antiguo que entra de golpe al conectar un buzón no es un correo que acabe de llegar) y no automáticos. Es la misma cuenta que
 * hace el aviso de abajo a la derecha (lib/correo/avisos.ts), de modo que la campana y el aviso hablan de lo mismo.
 *
 * A QUIÉN (migración 318; sin ella, solo al dueño, como antes):
 *   · Un correo de una persona: a quien dice destinatariosDeAvisos (dueño, asignados y seguidores que pueden leerlo, tienen la app y no lo tienen quitado ni silenciado),
 *     y a cada uno sin los hilos ni los remitentes que tiene silenciados. Al dueño y a quien lo tiene asignado, con asunto y vista previa; a quien no es el dueño, solo
 *     si su rastro 'aviso' se puede escribir antes (si no, «Correo nuevo en <dirección>»). A quien solo lo sigue, siempre sin contenido.
 *   · Un REBOTE: al dueño siempre y a quien envió desde el ERP el último saliente de ese hilo (si todavía lo puede leer). Sin silencios ni «Mis correos»: un correo que no
 *     ha llegado no se puede perder.
 *
 * Idempotente: el aviso lleva la clave del correo, así que repetir la consulta (dos lecturas a la vez, o la siguiente, cuyo margen de reloj se solapa con esta) no
 * escribe nada más. Cada persona tiene su propio aviso con esa clave.
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

  const filasLeidas = (data ?? []) as MensajeParaAviso[]
  const candidatos = avisosDeCorreo(filasLeidas, MAX_AVISOS_POR_LECTURA)
  if (candidatos.length === 0) return { avisos: 0, faltaMigracion: false }
  const remitenteDe = new Map(filasLeidas.map((f) => [f.id, f.de_direccion]))

  // De un rebote se lee la dirección que falló y por qué: hace falta el texto del aviso, que no se trae con los demás para no cargar cuerpos enteros
  const detalles = new Map<string, DetalleDeRebote>()
  const rebotes = candidatos.filter((c) => c.rebote)
  let direccionDelBuzon: string | null = null
  if (rebotes.length > 0) {
    const [{ data: textos }, { data: buzones }] = await Promise.all([
      service.from('correo_mensajes').select('id, texto').in('id', rebotes.map((r) => r.id)),
      service.from('correo_buzones').select('id, direccion'),
    ])
    const todos = (buzones ?? []) as Array<{ id: string; direccion: string }>
    direccionDelBuzon = todos.find((b) => b.id === buzon.id)?.direccion ?? null
    const dominiosPropios = new Set(todos.map((b) => dominioDe(b.direccion)).filter(Boolean))
    for (const t of (textos ?? []) as Array<{ id: string; texto: string | null }>) {
      const texto = t.texto ?? ''
      const direcciones = extraerDireccionesFallidas(texto, dominiosPropios)
      detalles.set(t.id, { direccion: direcciones.length === 1 ? direcciones[0] : null, motivo: motivoDeRebote(texto) })
    }
  }

  // A quién. Si no se puede saber (la base falla), al dueño y solo a él: nunca se avisa de más por no haber podido comprobar
  let destinatarios: DestinatarioDeAviso[]
  let regla: ReglaEnBloque | null = null
  try {
    const r = await destinatariosConRegla(service, buzon, { ahora })
    destinatarios = r.destinatarios
    regla = r.regla
  } catch (e) {
    console.warn('Correo · campana: no se ha podido saber a quién avisar; solo al dueño', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
    destinatarios = [{ personaId: buzon.user_id, nombre: '', silencios: SIN_SILENCIOS, esDueno: true, asignado: false, conContenido: true }]
  }

  const direccion = async (): Promise<string> => {
    if (direccionDelBuzon === null) {
      const { data: fila } = await service.from('correo_buzones').select('direccion').eq('id', buzon.id).maybeSingle()
      direccionDelBuzon = (fila as { direccion?: string } | null)?.direccion ?? ''
    }
    return direccionDelBuzon || 'un buzón que lees'
  }

  const avisos: AvisoParaLaCampana[] = []

  // 1. Los correos de personas, a cada uno con sus silencios
  const dePersonas = candidatos.filter((c) => !c.rebote)
  if (dePersonas.length > 0) {
    const filas = dePersonas.map((c) => ({ ...c, hilo_id: c.hiloId, de_direccion: remitenteDe.get(c.id) ?? '' }))
    for (const d of destinatarios) {
      const suyos = filtrarAvisos(filas, d.silencios, ahora)
      if (suyos.length === 0) continue
      let conContenido = d.conContenido
      if (conContenido && !d.esDueno) {
        // Quien no es el dueño deja rastro ANTES de ver el contenido. Si no se puede anotar, el aviso va sin contenido
        try {
          await registrarAcceso(service, { userId: d.personaId, nombre: d.nombre || 'Sin nombre' }, buzon.id, 'aviso', null, { ahora })
        } catch {
          conContenido = false
        }
      }
      const como = conContenido ? {} : { sinContenidoEn: await direccion() }
      for (const c of suyos) avisos.push(avisoDeCorreoNuevo(d.personaId, c, null, como))
    }
  }

  // 2. Los rebotes: al dueño y a quien envió el correo que ha rebotado
  if (rebotes.length > 0) {
    const enviadoPorHilo = await quienEnvioPorHilo(service, buzon.id, [...new Set(rebotes.map((r) => r.hiloId))])
    for (const c of rebotes) {
      const enviadoPor = enviadoPorHilo.get(c.hiloId) ?? null
      const ids = destinatariosDeRebote({ duenoId: buzon.user_id, enviadoPor, puedeLeer: (id) => (regla ? puedeRecibirAvisos(regla, id, buzon) : false) })
      for (const id of ids) {
        avisos.push(id === buzon.user_id ? avisoDeCorreoNuevo(id, c, detalles.get(c.id) ?? null) : avisoDeCorreoNuevo(id, c, detalles.get(c.id) ?? null, { enviadoDesde: await direccion() }))
      }
    }
  }

  if (avisos.length === 0) return { avisos: 0, faltaMigracion: false }
  const r = await escribirAvisosDeCorreo(service, avisos, opciones.reloj)
  return { avisos: r.escritos, faltaMigracion: r.faltaMigracion }
}

/**
 * Quién del ERP envió el último saliente de cada hilo (correo_mensajes.enviado_por, migración 318; solo se rellena cuando no es el dueño). Consulta APARTE y tolerante:
 * sin la columna (o si falla), nadie.
 */
export async function quienEnvioPorHilo(service: Servicio, buzonId: string, hilos: string[]): Promise<Map<string, string>> {
  const salida = new Map<string, string>()
  if (hilos.length === 0) return salida
  try {
    const { data, error } = await service
      .from('correo_mensajes')
      .select('hilo_id, enviado_por, fecha')
      .eq('buzon_id', buzonId)
      .in('hilo_id', hilos)
      .eq('direccion', 'saliente')
      .not('enviado_por', 'is', null)
      .order('fecha', { ascending: false })
      .limit(200)
    if (error) {
      if (!isMissingSchema(error)) console.warn('Correo · campana: no se ha podido saber quién envió el correo que ha rebotado', { codigo: (error as { code?: string }).code ?? null })
      return salida
    }
    for (const f of (data ?? []) as Array<{ hilo_id: string; enviado_por: string | null }>) {
      if (f.enviado_por && !salida.has(f.hilo_id)) salida.set(f.hilo_id, f.enviado_por)
    }
  } catch {
    // Nada: el rebote le llega al dueño igual
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Lo que se lee, se apaga                                             */
/* ------------------------------------------------------------------ */

/**
 * Marca como leídos los avisos de esos correos de UNA persona: la que los acaba de leer. La misma clave la tienen el dueño, las personas
 * asignadas y quien sigue el buzón (y el rebote va al dueño y a quien envió): que Patricia abra un hilo de daniela@ no puede apagarle a Daniela
 * lo que le llega a su buzón. Un fallo aquí no se propaga
 */
export async function marcarAvisosDeCorreoLeidos(service: Servicio, userId: string, mensajeIds: readonly string[]): Promise<void> {
  if (mensajeIds.length === 0 || !userId) return
  try {
    const { error } = await service
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .in('clave', mensajeIds.map(claveDeMensaje))
      .eq('read', false)
    // Sin la migración no hay columna `clave`: es lo esperado hasta que se lance y no merece ruido
    if (error && !esDeMigracionFaltante(error)) console.warn('Correo · campana: no se han podido marcar como leídos los avisos', { codigo: error.code ?? null })
  } catch (e) {
    console.warn('Correo · campana: no se han podido marcar como leídos los avisos', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
  }
}

/**
 * Al ABRIR un hilo (GET /api/correo/hilos/[id]): quien no puede responder desde ese buzón (lo sigue en «Mis correos», lo tiene asignado
 * «solo avisos», o lo supervisa) recibe avisos desde la 318, pero no puede marcar el hilo como leído (eso pide responder). Verlo apaga SUS avisos
 * de los mensajes que se le enseñan, leídos o no por el dueño; el estado del buzón no se toca. Quien puede responder lo apaga con el PATCH
 * {leido:true}, como siempre. Nunca lanza. Devuelve cuántos mensajes se han mirado (0 = no hacía falta).
 */
export async function apagarAvisosAlAbrirHilo(
  service: Servicio,
  userId: string,
  hilo: { puedeResponder: boolean; mensajes: ReadonlyArray<{ id: string; direccion: 'entrante' | 'saliente' }> }
): Promise<number> {
  if (hilo.puedeResponder) return 0
  const ids = hilo.mensajes.filter((m) => m.direccion === 'entrante').map((m) => m.id)
  await marcarAvisosDeCorreoLeidos(service, userId, ids)
  return ids.length
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
