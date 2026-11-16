import type { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { estaSilenciado } from './preferencias'
import type { HiloAbierto, HiloDeLista } from './tipos'

/**
 * LO NUEVO DE LA 318 ENCIMA DE LAS LISTAS Y DE LOS HILOS — SOLO SERVIDOR, SIN IMAP.
 * =================================================================================
 * Quién envió cada correo (correo_mensajes.enviado_por), qué tiene silenciado quien mira (hilo o remitente) y quién es la persona encargada de cada
 * conversación (correo_hilo_asignaciones). Todo en consultas APARTE de las de siempre, y todas tolerantes: sin la migración 318 (tabla o columna que
 * no existe: 42703, PGRST204, isMissingSchema) devuelven lo de por defecto —nadie envió por otro, nada silenciado, nadie encargado— y la lista y el
 * hilo salen igual que hoy. Por eso enviado_por NUNCA se pide en el select principal de correo_mensajes.
 *
 * Un fallo que NO es de migración también se traga (con un console.error): esto adorna la pantalla, no decide quién ve qué. Lo que decide el acceso
 * (quienPide, decidirAcceso) sí falla cerrado, y vive en quien-servidor.ts.
 *
 * Nunca importa servidor.ts (ver la sección 9.3 de la especificación): solo preferencias.ts (puro), los tipos e isMissingSchema.
 */

type Servicio = ReturnType<typeof createServiceClient>

const nombreDe = (p: { full_name: string | null; email: string | null }): string => p.full_name?.trim() || p.email || 'Sin nombre'

/** ¿Es un error de «falta la migración» (tabla, columna o función que no existe)? */
function esFaltaDeEsquema(error: unknown): boolean {
  const c = (error as { code?: unknown } | null)?.code
  return c === '42703' || c === 'PGRST204' || isMissingSchema(error)
}

/** Lee algo opcional: si falla, se queda en `porDefecto`. Solo avisa en el registro si el fallo no es de migración */
async function tolerante<T>(que: string, leer: () => PromiseLike<{ data: unknown; error: unknown }>, porDefecto: T, convertir: (data: unknown) => T): Promise<T> {
  try {
    const { data, error } = await leer()
    if (error) {
      if (!esFaltaDeEsquema(error)) console.error(`Correo · enriquecer: no se ha podido leer ${que}`, { codigo: (error as { code?: unknown }).code ?? null })
      return porDefecto
    }
    return convertir(data)
  } catch (e) {
    console.error(`Correo · enriquecer: no se ha podido leer ${que}`, { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
    return porDefecto
  }
}

/* ------------------------------------------------------------------ */
/* Las filas de correo_hilos tal y como las enseña una lista           */
/* ------------------------------------------------------------------ */

/** Las columnas de siempre de correo_hilos (todas de la 236): con esto se pinta una fila de la lista */
export const CAMPOS_DE_LISTA =
  'id, buzon_id, asunto, contraparte, contraparte_direccion, vista_previa, ultimo_mensaje_at, mensajes, no_leidos, entrantes, salientes, tiene_adjuntos, destacado, ultimo_es_entrante, automatico'

export interface FilaDeLista {
  id: string
  buzon_id: string
  asunto: string
  contraparte: string
  contraparte_direccion: string
  vista_previa: string
  ultimo_mensaje_at: string
  mensajes: number
  no_leidos: number
  entrantes: number
  salientes: number
  tiene_adjuntos: boolean
  destacado: boolean
  ultimo_es_entrante: boolean
  automatico: boolean
}

/** Una fila de la lista sin adornar (sin silencio ni encargada): lo de hoy más el buzón */
export const hiloDeLista = (f: FilaDeLista): HiloDeLista => ({
  id: f.id,
  asunto: f.asunto,
  contraparte: f.contraparte,
  contraparteDireccion: f.contraparte_direccion,
  vistaPrevia: f.vista_previa,
  ultimoMensajeAt: f.ultimo_mensaje_at,
  mensajes: f.mensajes,
  noLeidos: f.no_leidos,
  entrantes: f.entrantes,
  salientes: f.salientes,
  tieneAdjuntos: f.tiene_adjuntos,
  destacado: f.destacado,
  esperandoRespuesta: f.ultimo_es_entrante,
  automatico: f.automatico,
  buzonId: f.buzon_id,
  silenciado: false,
  asignadoA: null,
})

/* ------------------------------------------------------------------ */
/* Nombres                                                             */
/* ------------------------------------------------------------------ */

/** Nombres de personas por id (para la encargada de un hilo). Lo que no se pueda leer no sale en el mapa */
export async function nombresDePersonas(service: Servicio, ids: Iterable<string>): Promise<Map<string, string>> {
  const lista = [...new Set([...ids].filter(Boolean))]
  if (lista.length === 0) return new Map()
  return tolerante(
    'los nombres de las personas',
    () => service.from('profiles').select('id, full_name, email').in('id', lista),
    new Map<string, string>(),
    (data) => new Map(((data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, nombreDe(p)]))
  )
}

/* ------------------------------------------------------------------ */
/* Quién envió cada correo                                             */
/* ------------------------------------------------------------------ */

export interface AutorLeido {
  enviado_por: string | null
  enviado_por_nombre: string | null
}

/**
 * Quién del ERP envió cada uno de estos mensajes (solo salen los que lo tienen anotado). Sin las columnas de la 318 (42703, PGRST204 o falta de
 * esquema), un mapa vacío: nadie envió por otro.
 */
export async function leerAutoresDeEnvio(service: Servicio, ids: readonly string[]): Promise<Map<string, AutorLeido>> {
  const lista = [...new Set(ids)]
  if (lista.length === 0) return new Map()
  return tolerante(
    'quién envió cada correo',
    () => service.from('correo_mensajes').select('id, enviado_por, enviado_por_nombre').in('id', lista),
    new Map<string, AutorLeido>(),
    (data) =>
      new Map(
        ((data ?? []) as Array<{ id: string; enviado_por: string | null; enviado_por_nombre: string | null }>)
          .filter((f) => f.enviado_por !== null || (f.enviado_por_nombre ?? '') !== '')
          .map((f) => [f.id, { enviado_por: f.enviado_por ?? null, enviado_por_nombre: f.enviado_por_nombre ?? null }])
      )
  )
}

/**
 * Lo que la pantalla enseña de un mensaje enviado por otra persona («Enviado por Patricia»). null si no hay autor anotado o si fue el propio dueño
 * del buzón (lo normal: nadie lo anota, pero una fila antigua o colada no tiene que enseñarlo).
 */
export function enviadoPorDe(autor: AutorLeido | undefined, duenoId: string): { id: string | null; nombre: string } | null {
  if (!autor) return null
  if (autor.enviado_por !== null && autor.enviado_por === duenoId) return null
  const nombre = (autor.enviado_por_nombre ?? '').trim()
  if (autor.enviado_por === null && nombre === '') return null
  return { id: autor.enviado_por, nombre: nombre || 'Otra persona del equipo' }
}

/* ------------------------------------------------------------------ */
/* Silencios y encargada de varios hilos                               */
/* ------------------------------------------------------------------ */

const minusculas = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase()

/** Los silencios de hilo de esta persona en estos hilos: id → hasta (null = siempre). Sin la 318, ninguno */
async function silenciosDeHilos(service: Servicio, userId: string, hiloIds: string[]): Promise<Map<string, string | null>> {
  if (hiloIds.length === 0) return new Map()
  return tolerante(
    'los hilos silenciados',
    () => service.from('correo_hilo_silencios').select('hilo_id, hasta').eq('user_id', userId).in('hilo_id', hiloIds),
    new Map<string, string | null>(),
    (data) => new Map(((data ?? []) as Array<{ hilo_id: string; hasta: string | null }>).map((f) => [f.hilo_id, f.hasta ?? null]))
  )
}

/** Los silencios de remitente de esta persona en estas direcciones: dirección → hasta. Sin la 318, ninguno */
async function silenciosDeRemitentes(service: Servicio, userId: string, direcciones: string[]): Promise<Map<string, string | null>> {
  const lista = [...new Set(direcciones.map(minusculas).filter((d) => d.includes('@')))]
  if (lista.length === 0) return new Map()
  return tolerante(
    'los remitentes silenciados',
    () => service.from('correo_remitente_silencios').select('direccion, hasta').eq('user_id', userId).in('direccion', lista),
    new Map<string, string | null>(),
    (data) => new Map(((data ?? []) as Array<{ direccion: string; hasta: string | null }>).map((f) => [minusculas(f.direccion), f.hasta ?? null]))
  )
}

interface FilaDeAsignacionDeHilo {
  hilo_id: string
  persona_id: string
  asignado_por: string | null
  nota: string | null
  asignado_at: string
}

/** La encargada (sin «hecho») de estos hilos. Sin la 318, ninguna */
async function encargadasDeHilos(service: Servicio, hiloIds: string[]): Promise<Map<string, FilaDeAsignacionDeHilo>> {
  if (hiloIds.length === 0) return new Map()
  return tolerante(
    'las personas encargadas',
    () => service.from('correo_hilo_asignaciones').select('hilo_id, persona_id, asignado_por, nota, asignado_at').in('hilo_id', hiloIds).is('hecho_at', null),
    new Map<string, FilaDeAsignacionDeHilo>(),
    (data) => new Map(((data ?? []) as FilaDeAsignacionDeHilo[]).map((f) => [f.hilo_id, f]))
  )
}

/**
 * Las filas de correo_hilos convertidas en filas de la lista, con su buzón, si quien mira las tiene silenciadas (por el hilo o por su remitente,
 * la CONTRAPARTE del hilo) y quién las lleva. Tres consultas aparte (silencios de hilo, de remitente y encargadas) más una de nombres, todas
 * tolerantes: sin la 318 salen sin silenciar y sin encargada. Mismo orden que la entrada.
 *
 * `silenciadoYa` (opcional): el silencio que ya trae la fila (la RPC de la bandeja lo calcula): no se vuelve a consultar.
 * `asignadoYa` (opcional): la persona encargada que ya trae la fila (la RPC de la bandeja): solo se buscan los nombres.
 */
export async function enriquecerHilos(
  service: Servicio,
  userId: string,
  filas: ReadonlyArray<FilaDeLista & { silenciado?: boolean | null; asignado_a?: string | null }>,
  ahora: number = Date.now()
): Promise<HiloDeLista[]> {
  if (filas.length === 0) return []
  const ids = filas.map((f) => f.id)
  const traenSilencio = filas.every((f) => typeof f.silenciado === 'boolean')
  const traenEncargada = filas.every((f) => f.asignado_a !== undefined)

  const [hilosCallados, remitentesCallados, encargadas] = await Promise.all([
    traenSilencio ? Promise.resolve(new Map<string, string | null>()) : silenciosDeHilos(service, userId, ids),
    traenSilencio ? Promise.resolve(new Map<string, string | null>()) : silenciosDeRemitentes(service, userId, filas.map((f) => f.contraparte_direccion)),
    traenEncargada ? Promise.resolve(new Map<string, FilaDeAsignacionDeHilo>()) : encargadasDeHilos(service, ids),
  ])

  const personaDe = (f: (typeof filas)[number]): string | null => (traenEncargada ? f.asignado_a ?? null : encargadas.get(f.id)?.persona_id ?? null)
  const nombres = await nombresDePersonas(
    service,
    filas.map(personaDe).filter((p): p is string => p !== null)
  )

  return filas.map((f) => {
    const silenciado = traenSilencio
      ? f.silenciado === true
      : estaSilenciado(hilosCallados.get(f.id), hilosCallados.has(f.id), ahora) ||
        estaSilenciado(remitentesCallados.get(minusculas(f.contraparte_direccion)), remitentesCallados.has(minusculas(f.contraparte_direccion)), ahora)
    const persona = personaDe(f)
    return { ...hiloDeLista(f), silenciado, asignadoA: persona ? { id: persona, nombre: nombres.get(persona) ?? 'Persona sin nombre' } : null }
  })
}

/* ------------------------------------------------------------------ */
/* Un hilo abierto                                                     */
/* ------------------------------------------------------------------ */

/**
 * Lo que la 318 añade a un hilo abierto para quien mira: qué tiene silenciado (el hilo, o a su remitente en todos los buzones) y quién lo lleva.
 * Sin la 318: nada silenciado y nadie encargado.
 */
export async function enriquecerHiloAbierto(
  service: Servicio,
  userId: string,
  hilo: { id: string; contraparteDireccion: string },
  ahora: number = Date.now()
): Promise<Pick<HiloAbierto, 'silenciado' | 'asignacion'>> {
  const remitente = minusculas(hilo.contraparteDireccion)
  const [hilosCallados, remitentesCallados, encargadas] = await Promise.all([
    silenciosDeHilos(service, userId, [hilo.id]),
    silenciosDeRemitentes(service, userId, [remitente]),
    encargadasDeHilos(service, [hilo.id]),
  ])
  const encargada = encargadas.get(hilo.id) ?? null
  const nombres = encargada ? await nombresDePersonas(service, [encargada.persona_id, encargada.asignado_por ?? '']) : new Map<string, string>()
  return {
    silenciado: {
      hilo: estaSilenciado(hilosCallados.get(hilo.id), hilosCallados.has(hilo.id), ahora),
      remitente: estaSilenciado(remitentesCallados.get(remitente), remitentesCallados.has(remitente), ahora),
    },
    asignacion: encargada
      ? {
          personaId: encargada.persona_id,
          nombre: nombres.get(encargada.persona_id) ?? 'Persona sin nombre',
          asignadoPor: encargada.asignado_por ? nombres.get(encargada.asignado_por) ?? null : null,
          nota: encargada.nota ?? null,
          asignadoAt: encargada.asignado_at,
        }
      : null,
  }
}
