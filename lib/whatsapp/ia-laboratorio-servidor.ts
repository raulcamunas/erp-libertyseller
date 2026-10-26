import { validarNombreDeVersion } from '@/lib/correo/ia-version'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import type { createServiceClient } from '@/lib/supabase/service'
import { PERFIL_DE_SERIE, copiaDelPerfil, perfilDesdeLaBase, validarPerfilDeWhatsapp, type PerfilDeWhatsapp } from './ia-perfil'

/**
 * LO QUE LA CONFIGURACIÓN DE LA IA DE WHATSAPP LEE Y ESCRIBE EN LA BASE — SOLO SERVIDOR.
 * ======================================================================================
 * Las versiones del perfil de la IA (migración 250). La tabla está cerrada al navegador: las rutas de /api/correo/laboratorio/whatsapp comprueban el permiso «Configuración
 * de la IA» y llaman aquí con el cliente de servicio. Se comprueba con ia-laboratorio-servidor.prueba.ts.
 *
 * EL CICLO DE UNA VERSIÓN: nace como BORRADOR (se edita libremente, se prueba con leads de ejemplo y reales sin enviar nada) y se PUBLICA cuando convence: desde ese momento la
 * usa todo el equipo y es la única en producción (las demás dejan de estarlo, no se borran). UNA VERSIÓN QUE YA HA ESTADO EN PRODUCCIÓN NO CAMBIA DE CONTENIDO (se duplica y se
 * edita la copia): así el historial dice de verdad qué se le pidió a la IA cada día. El nombre y las notas sí se pueden tocar siempre, salvo en la original.
 *
 * LA IA NUNCA SE QUEDA SIN ESCRIBIR POR ESTO. Si la tabla no existe (migración sin lanzar), no hay ninguna en producción o la lectura falla, `perfilEnProduccion` devuelve la
 * configuración de serie y el mensaje sale igual.
 */

type Servicio = ReturnType<typeof createServiceClient>

export const FALTA_MIGRACION_250 = 'Falta lanzar la migración 250_whatsapp_ia_versiones.sql en el editor SQL de Supabase. Hasta entonces la IA de WhatsApp escribe con la configuración de serie y no se puede calibrar nada.'

/** Los errores de la base llegan como objetos sueltos, no como `Error`: se envuelven para no perder el código */
const fallo = (mensaje: string, causa: unknown): Error => new Error(mensaje, { cause: causa })
export const esFaltaDeLaMigracion250 = (error: unknown): boolean => isMissingSchema(error) || isMissingSchema((error as { cause?: unknown } | null)?.cause)

interface FilaDeVersion {
  id: string
  nombre: string
  notas: string | null
  perfil: unknown
  en_produccion: boolean
  es_base: boolean
  archivada: boolean
  publicada_at: string | null
  publicada_por: string | null
  creada_por: string | null
  creada_at: string
  actualizada_at: string
}

const COLUMNAS = 'id, nombre, notas, perfil, en_produccion, es_base, archivada, publicada_at, publicada_por, creada_por, creada_at, actualizada_at'

export interface VersionDeWhatsapp {
  id: string
  nombre: string
  notas: string | null
  perfil: PerfilDeWhatsapp
  enProduccion: boolean
  esBase: boolean
  archivada: boolean
  /** Cuándo se puso en producción por última vez. null = nunca: es un borrador */
  publicadaAt: string | null
  publicadaPor: string | null
  /** Ya ha estado en producción (o es la original): su contenido no se edita, se duplica */
  bloqueada: boolean
  creadaPor: string | null
  creadaAt: string
  actualizadaAt: string
}

export function aVersion(f: FilaDeVersion): VersionDeWhatsapp {
  return {
    id: f.id,
    nombre: f.nombre,
    notas: f.notas,
    // Lo que falte en la base (una versión escrita a mano en SQL, por ejemplo) se completa con lo de serie en vez de dejar un hueco
    perfil: perfilDesdeLaBase(f.perfil),
    enProduccion: f.en_produccion,
    esBase: f.es_base,
    archivada: f.archivada,
    publicadaAt: f.publicada_at,
    publicadaPor: f.publicada_por,
    bloqueada: f.es_base || f.publicada_at !== null,
    creadaPor: f.creada_por,
    creadaAt: f.creada_at,
    actualizadaAt: f.actualizada_at,
  }
}

export type ResultadoDeEscritura<T> = { ok: true; valor: T; avisos: string[] } | { ok: false; estado: number; error: string }

/* ------------------------------------------------------------------ */
/* Leer                                                                */
/* ------------------------------------------------------------------ */

export async function listarVersiones(service: Servicio): Promise<VersionDeWhatsapp[]> {
  const { data, error } = await service.from('whatsapp_ia_versiones').select(COLUMNAS).order('creada_at', { ascending: true })
  if (error) throw fallo('No se han podido leer las versiones de WhatsApp.', error)
  return ((data ?? []) as unknown as FilaDeVersion[]).map(aVersion)
}

export async function leerVersion(service: Servicio, id: string): Promise<VersionDeWhatsapp | null> {
  const { data, error } = await service.from('whatsapp_ia_versiones').select(COLUMNAS).eq('id', id).maybeSingle()
  if (error) throw fallo('No se ha podido leer la versión.', error)
  return data ? aVersion(data as unknown as FilaDeVersion) : null
}

/**
 * Crea la versión original si todavía no existe: es la de serie del código y se lleva la producción mientras nadie haya publicado otra. Es lo que se ve al abrir la
 * pantalla por primera vez, y a lo que se vuelve si una versión nueva sale mal.
 */
export async function sembrarBase(service: Servicio, userId: string | null): Promise<void> {
  const { data: base, error: errorBase } = await service.from('whatsapp_ia_versiones').select('id').eq('es_base', true).limit(1)
  if (errorBase) throw fallo('No se ha podido leer la versión original.', errorBase)
  if ((base ?? []).length > 0) return
  // Si ya hay una en producción (alguien publicó antes de que existiera la original, que no debería pasar) la original no le quita el sitio
  const { data: vivas, error: errorVivas } = await service.from('whatsapp_ia_versiones').select('id').eq('en_produccion', true).limit(1)
  if (errorVivas) throw fallo('No se ha podido leer la versión en producción.', errorVivas)
  const ahora = new Date().toISOString()
  const { error: errorAlta } = await service.from('whatsapp_ia_versiones').insert({
    nombre: 'Versión original',
    notas: 'La configuración de serie. No se edita: es el punto de partida de las demás y a lo que se vuelve si una versión nueva sale mal.',
    perfil: PERFIL_DE_SERIE,
    en_produccion: (vivas ?? []).length === 0,
    es_base: true,
    publicada_at: ahora,
    publicada_por: userId,
    creada_por: userId,
  })
  // 23505: otra petición la creó a la vez (hay un índice único): está, que es lo que se quería
  if (errorAlta && (errorAlta as { code?: string }).code !== '23505') throw fallo('No se ha podido crear la versión original.', errorAlta)
}

/* ------------------------------------------------------------------ */
/* Escribir                                                            */
/* ------------------------------------------------------------------ */

export interface DatosDeVersion {
  nombre: unknown
  notas?: unknown
  perfil: unknown
}

const limpiarNotas = (v: unknown): string | null => (typeof v === 'string' ? v.trim().slice(0, 1000) || null : null)

/** Una versión nueva: nace como BORRADOR (sin publicar). El perfil que llega se comprueba y se limpia */
export async function crearVersion(service: Servicio, datos: DatosDeVersion, userId: string): Promise<ResultadoDeEscritura<VersionDeWhatsapp>> {
  const nombre = validarNombreDeVersion(datos.nombre)
  if (!nombre.ok) return { ok: false, estado: 400, error: nombre.error }
  const perfil = validarPerfilDeWhatsapp(datos.perfil)
  if (!perfil.ok) return { ok: false, estado: 400, error: perfil.error }
  const { data, error } = await service
    .from('whatsapp_ia_versiones')
    .insert({ nombre: nombre.nombre, notas: limpiarNotas(datos.notas), perfil: perfil.perfil, en_produccion: false, es_base: false, creada_por: userId })
    .select(COLUMNAS)
    .single()
  if (error) throw fallo('No se ha podido crear la versión.', error)
  return { ok: true, valor: aVersion(data as unknown as FilaDeVersion), avisos: perfil.avisos }
}

export interface CambiosDeVersion {
  nombre?: unknown
  notas?: unknown
  perfil?: unknown
  archivada?: unknown
}

export async function actualizarVersion(service: Servicio, id: string, cambios: CambiosDeVersion): Promise<ResultadoDeEscritura<VersionDeWhatsapp>> {
  const actual = await leerVersion(service, id)
  if (!actual) return { ok: false, estado: 404, error: 'No se encuentra esa versión.' }

  const parche: Record<string, unknown> = { actualizada_at: new Date().toISOString() }
  const avisos: string[] = []

  if (cambios.archivada !== undefined) {
    if (cambios.archivada === true) {
      if (actual.esBase) return { ok: false, estado: 409, error: 'La versión original no se puede archivar: es el punto de partida y de vuelta atrás.' }
      if (actual.enProduccion) return { ok: false, estado: 409, error: 'Esta es la versión que usa el equipo ahora: publica otra antes de archivarla.' }
    }
    parche.archivada = cambios.archivada === true
  }
  // La original conserva su nombre y sus notas
  if (cambios.notas !== undefined && !actual.esBase) parche.notas = limpiarNotas(cambios.notas)
  if (cambios.nombre !== undefined && !actual.esBase) {
    const n = validarNombreDeVersion(cambios.nombre)
    if (!n.ok) return { ok: false, estado: 400, error: n.error }
    parche.nombre = n.nombre
  }

  if (cambios.perfil !== undefined) {
    if (actual.bloqueada) {
      return {
        ok: false,
        estado: 409,
        error: actual.esBase
          ? 'La versión original no se edita: duplícala y cambia la copia.'
          : 'Esta versión ya ha estado en producción: si cambias su contenido, el historial dejaría de decir qué se le pidió a la IA cada día. Duplícala y cambia la copia.',
      }
    }
    const p = validarPerfilDeWhatsapp(cambios.perfil)
    if (!p.ok) return { ok: false, estado: 400, error: p.error }
    parche.perfil = p.perfil
    avisos.push(...p.avisos)
  }

  const { data, error } = await service.from('whatsapp_ia_versiones').update(parche).eq('id', id).select(COLUMNAS).single()
  if (error) throw fallo('No se ha podido guardar la versión.', error)
  return { ok: true, valor: aVersion(data as unknown as FilaDeVersion), avisos }
}

/**
 * Pone una versión en producción: la usa todo el equipo desde ya. Las demás dejan de estarlo (no se borran ni se archivan: se puede volver a cualquiera publicándola de nuevo).
 * Si falla a mitad, se intenta dejar la que estaba antes: sin ninguna en producción la IA usaría lo de serie, que es seguro pero no es lo que se quería.
 */
export async function publicarVersion(service: Servicio, id: string, userId: string): Promise<ResultadoDeEscritura<VersionDeWhatsapp[]>> {
  const versiones = await listarVersiones(service)
  const elegida = versiones.find((v) => v.id === id)
  if (!elegida) return { ok: false, estado: 404, error: 'No se encuentra esa versión.' }
  if (elegida.archivada) return { ok: false, estado: 409, error: 'Esta versión está archivada: recupérala antes de publicarla.' }
  if (elegida.enProduccion) return { ok: true, valor: versiones, avisos: [] }

  const anterior = versiones.find((v) => v.enProduccion) ?? null
  const ahora = new Date().toISOString()
  if (anterior) {
    const { error } = await service.from('whatsapp_ia_versiones').update({ en_produccion: false, actualizada_at: ahora }).eq('id', anterior.id)
    if (error) throw fallo('No se ha podido quitar de producción la versión anterior.', error)
  }
  const { error } = await service.from('whatsapp_ia_versiones').update({ en_produccion: true, publicada_at: ahora, publicada_por: userId, actualizada_at: ahora }).eq('id', id)
  if (error) {
    if (anterior) await service.from('whatsapp_ia_versiones').update({ en_produccion: true, actualizada_at: ahora }).eq('id', anterior.id)
    throw fallo('No se ha podido poner la versión en producción.', error)
  }
  olvidarPerfil()
  return { ok: true, valor: await listarVersiones(service), avisos: [] }
}

/* ------------------------------------------------------------------ */
/* El perfil con el que se escribe UN mensaje                          */
/* ------------------------------------------------------------------ */

export interface PerfilEnProduccion {
  perfil: PerfilDeWhatsapp
  /** La versión que está en producción, o null si se usa lo de serie sin pasar por la tabla (migración sin lanzar, o ninguna publicada) */
  version: { id: string; nombre: string } | null
}

const DURACION_DE_LA_CACHE_MS = 30_000
const DURACION_DE_LA_CACHE_SI_FALLA_MS = 10_000
let cache: { hasta: number; valor: PerfilEnProduccion } | null = null

/** Para las pruebas, y al publicar: lo que hay guardado en este proceso deja de valer */
export function olvidarPerfil(): void {
  cache = null
}

const deSerie = (): PerfilEnProduccion => ({ perfil: copiaDelPerfil(PERFIL_DE_SERIE), version: null })

/**
 * El perfil que usa el equipo ahora. NUNCA lanza: ante cualquier fallo, lo de serie. Se guarda 30 segundos en cada proceso (la ruta que escribe se llama muchas veces y el perfil
 * cambia pocas): una publicación tarda como mucho ese rato en llegar a otro proceso.
 */
export async function perfilEnProduccion(service: Servicio, ahora = Date.now()): Promise<PerfilEnProduccion> {
  // Cada quien recibe su propia copia: lo que guarda el proceso no se puede estropear tocando lo que se devuelve
  const copia = (v: PerfilEnProduccion): PerfilEnProduccion => ({ perfil: copiaDelPerfil(v.perfil), version: v.version ? { ...v.version } : null })
  if (cache && cache.hasta > ahora) return copia(cache.valor)
  try {
    const { data, error } = await service.from('whatsapp_ia_versiones').select('id, nombre, perfil').eq('en_produccion', true).maybeSingle()
    if (error) throw fallo('No se ha podido leer la versión en producción.', error)
    const fila = data as { id: string; nombre: string; perfil: unknown } | null
    const valor: PerfilEnProduccion = fila ? { perfil: perfilDesdeLaBase(fila.perfil), version: { id: fila.id, nombre: fila.nombre } } : deSerie()
    cache = { hasta: ahora + DURACION_DE_LA_CACHE_MS, valor }
    return copia(valor)
  } catch (error) {
    if (!esFaltaDeLaMigracion250(error)) console.warn('[whatsapp-ia] no se ha podido leer la versión en producción: se usa la configuración de serie', { mensaje: error instanceof Error ? error.message : 'desconocido' })
    const valor = deSerie()
    cache = { hasta: ahora + (esFaltaDeLaMigracion250(error) ? DURACION_DE_LA_CACHE_MS : DURACION_DE_LA_CACHE_SI_FALLA_MS), valor }
    return copia(valor)
  }
}
