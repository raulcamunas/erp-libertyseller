import { isMissingSchema } from '@/lib/plataforma/eventos'
import type { createServiceClient } from '@/lib/supabase/service'
import { ejemplosParaLead, type EjemploGanador } from './ia-ejemplos'
import { INSTRUCCIONES, SECCIONES_BASE, compilarInstrucciones, validarSecciones, type SeccionesDeInstrucciones } from './ia-prompt'
import { montarEjemplos, validarEjemplo, validarModelo, validarNombreDeVersion, validarPeso, versionParaBorrador, type EjemploPropio, type VersionDeIa } from './ia-version'

/**
 * LO QUE LA CONFIGURACIÓN DE CORREOS LEE Y ESCRIBE EN LA BASE — SOLO SERVIDOR.
 * ============================================================================
 * Versiones de la IA y ejemplos propios (migración 243). Las tablas están cerradas al navegador: las rutas de /api/correo/laboratorio
 * comprueban el permiso «Configuración de la IA» y llaman aquí con el cliente de servicio.
 *
 * LO QUE UNA VERSIÓN YA USADA NO ADMITE. Con un solo borrador apuntado con ella, no se pueden cambiar sus instrucciones, sus ejemplos ni su
 * modelo (se duplica y se edita la copia): si se cambiaran a mitad, las respuestas de antes y de después se mezclarían bajo el mismo nombre
 * y los resultados no dirían nada. Nombre, notas, peso, «en marcha» y archivar sí se pueden tocar siempre. Y un ejemplo propio que lee una
 * versión ya usada queda igual de bloqueado, por lo mismo.
 *
 * LA IA NUNCA SE QUEDA SIN REDACTAR POR ESTO. Si las tablas no existen (migración sin lanzar) o la lectura falla, `resolverConfiguracion`
 * devuelve la configuración de siempre —las instrucciones originales y los ejemplos automáticos— y el borrador sale igual.
 */

type Servicio = ReturnType<typeof createServiceClient>

export const FALTA_MIGRACION_CONFIGURACION = 'Falta lanzar la migración 243_correo_ia_configuracion.sql en el editor SQL de Supabase. Hasta entonces la IA usa las instrucciones de siempre y no se puede configurar nada.'

/** Los errores de la base llegan como objetos sueltos, no como `Error`: se envuelven para no perder el código */
const fallo = (mensaje: string, causa: unknown): Error => new Error(mensaje, { cause: causa })
export const esFaltaDeConfiguracion = (error: unknown): boolean => isMissingSchema(error) || isMissingSchema((error as { cause?: unknown } | null)?.cause)

/* ------------------------------------------------------------------ */
/* Versiones                                                           */
/* ------------------------------------------------------------------ */

interface FilaDeVersion {
  id: string
  nombre: string
  notas: string | null
  secciones: Partial<SeccionesDeInstrucciones> | null
  ejemplos_ids: string[] | null
  usar_ganadores: boolean
  modelo: string | null
  peso: number
  activa: boolean
  es_base: boolean
  archivada: boolean
  creada_por: string | null
  creada_at: string
  actualizada_at: string
}

const COLUMNAS_DE_VERSION = 'id, nombre, notas, secciones, ejemplos_ids, usar_ganadores, modelo, peso, activa, es_base, archivada, creada_por, creada_at, actualizada_at'

export interface VersionConFechas extends VersionDeIa {
  creadaPor: string | null
  creadaAt: string
  actualizadaAt: string
}

export function aVersion(f: FilaDeVersion): VersionConFechas {
  return {
    id: f.id,
    nombre: f.nombre,
    notas: f.notas,
    // Una sección que falte en la base (una versión escrita a mano en SQL, por ejemplo) se completa con la original en vez de dejar un hueco
    secciones: { ...SECCIONES_BASE, ...(f.secciones ?? {}) },
    ejemplosIds: f.ejemplos_ids ?? [],
    usarGanadores: f.usar_ganadores,
    modelo: f.modelo,
    peso: f.peso,
    activa: f.activa,
    esBase: f.es_base,
    archivada: f.archivada,
    creadaPor: f.creada_por,
    creadaAt: f.creada_at,
    actualizadaAt: f.actualizada_at,
  }
}

/** Crea la versión original si todavía no existe. Es la de siempre (SECCIONES_BASE) y empieza llevándose todo el reparto */
export async function sembrarBase(service: Servicio, userId: string | null): Promise<void> {
  const { data, error } = await service.from('correo_ia_versiones').select('id').eq('es_base', true).limit(1)
  if (error) throw fallo('No se ha podido leer la versión original.', error)
  if ((data ?? []).length > 0) return
  const { error: errorAlta } = await service.from('correo_ia_versiones').insert({
    nombre: 'Versión original',
    notas: 'La que la IA ha usado desde el principio. No se edita: es el punto de comparación de todas las demás.',
    secciones: SECCIONES_BASE,
    ejemplos_ids: [],
    usar_ganadores: true,
    modelo: null,
    peso: 100,
    activa: true,
    es_base: true,
    creada_por: userId,
  })
  // 23505: otra petición la creó a la vez (hay un índice único): está, que es lo que se quería
  if (errorAlta && (errorAlta as { code?: string }).code !== '23505') throw fallo('No se ha podido crear la versión original.', errorAlta)
}

export async function listarVersiones(service: Servicio): Promise<VersionConFechas[]> {
  const { data, error } = await service.from('correo_ia_versiones').select(COLUMNAS_DE_VERSION).order('creada_at', { ascending: true })
  if (error) throw fallo('No se han podido leer las versiones.', error)
  return ((data ?? []) as unknown as FilaDeVersion[]).map(aVersion)
}

export interface UsoDeVersion {
  generados: number
  enviados: number
}

/** Cuántos borradores ha escrito cada versión y cuántos se han enviado. Los borradores de antes de las versiones (sin version_id) cuentan como de la original */
export async function usoDeVersiones(service: Servicio, versiones: readonly VersionConFechas[]): Promise<Map<string, UsoDeVersion>> {
  const contar = async (version: VersionConFechas, soloEnviados: boolean): Promise<number> => {
    let consulta = service.from('correo_ia_borradores').select('id', { count: 'exact', head: true })
    // Los borradores sin versión son de antes del laboratorio: eran, por definición, los de la original
    consulta = version.esBase ? consulta.or(`version_id.eq.${version.id},version_id.is.null`) : consulta.eq('version_id', version.id)
    if (soloEnviados) consulta = consulta.not('enviado_at', 'is', null)
    const { count, error } = await consulta
    if (error) throw fallo('No se ha podido contar el uso de una versión.', error)
    return count ?? 0
  }
  const filas = await Promise.all(versiones.map(async (v) => [v.id, { generados: await contar(v, false), enviados: await contar(v, true) }] as const))
  return new Map(filas)
}

export interface DatosDeVersion {
  nombre: unknown
  notas?: unknown
  secciones: unknown
  ejemplosIds?: unknown
  usarGanadores?: unknown
  modelo?: unknown
  peso?: unknown
  activa?: unknown
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Los ids de ejemplos que llegan del editor: solo los que existen, sin repetir y como mucho 8 */
async function ejemplosQueExisten(service: Servicio, ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids)) return []
  const pedidos = [...new Set(ids.filter((x): x is string => typeof x === 'string' && UUID.test(x)).map((x) => x.toLowerCase()))].slice(0, 8)
  if (pedidos.length === 0) return []
  const { data, error } = await service.from('correo_ia_ejemplos').select('id').in('id', pedidos)
  if (error) throw fallo('No se han podido comprobar los ejemplos.', error)
  const existen = new Set(((data ?? []) as Array<{ id: string }>).map((e) => e.id))
  return pedidos.filter((id) => existen.has(id))
}

export type ResultadoDeEscritura<T> = { ok: true; valor: T; avisos: string[] } | { ok: false; estado: number; error: string }

export async function crearVersion(service: Servicio, datos: DatosDeVersion, userId: string): Promise<ResultadoDeEscritura<VersionConFechas>> {
  const nombre = validarNombreDeVersion(datos.nombre)
  if (!nombre.ok) return { ok: false, estado: 400, error: nombre.error }
  const secciones = validarSecciones(datos.secciones)
  if (!secciones.ok) return { ok: false, estado: 400, error: secciones.error }
  const modelo = validarModelo(datos.modelo)
  if (!modelo.ok) return { ok: false, estado: 400, error: modelo.error }
  const peso = datos.peso === undefined ? ({ ok: true, peso: 0 } as const) : validarPeso(datos.peso)
  if (!peso.ok) return { ok: false, estado: 400, error: peso.error }
  const notas = typeof datos.notas === 'string' ? datos.notas.trim().slice(0, 1000) || null : null

  const { data, error } = await service
    .from('correo_ia_versiones')
    .insert({
      nombre: nombre.nombre,
      notas,
      secciones: secciones.secciones,
      ejemplos_ids: await ejemplosQueExisten(service, datos.ejemplosIds),
      usar_ganadores: datos.usarGanadores === undefined ? true : datos.usarGanadores === true,
      modelo: modelo.modelo,
      peso: peso.peso,
      // Una versión nueva nace PAUSADA y sin peso: no se manda a los comerciales hasta que quien la hizo la pruebe y la ponga en marcha
      activa: datos.activa === true && peso.peso > 0,
      es_base: false,
      creada_por: userId,
    })
    .select(COLUMNAS_DE_VERSION)
    .single()
  if (error) throw fallo('No se ha podido crear la versión.', error)
  return { ok: true, valor: aVersion(data as unknown as FilaDeVersion), avisos: secciones.avisos }
}

export async function leerVersion(service: Servicio, id: string): Promise<VersionConFechas | null> {
  const { data, error } = await service.from('correo_ia_versiones').select(COLUMNAS_DE_VERSION).eq('id', id).maybeSingle()
  if (error) throw fallo('No se ha podido leer la versión.', error)
  return data ? aVersion(data as unknown as FilaDeVersion) : null
}

/** ¿Tiene ya algún borrador apuntado? Con uno solo, su contenido deja de poder cambiar */
export async function versionUsada(service: Servicio, version: Pick<VersionConFechas, 'id' | 'esBase'>): Promise<boolean> {
  if (version.esBase) return true
  const { count, error } = await service.from('correo_ia_borradores').select('id', { count: 'exact', head: true }).eq('version_id', version.id)
  if (error) throw fallo('No se ha podido comprobar si la versión se ha usado.', error)
  return (count ?? 0) > 0
}

export async function actualizarVersion(service: Servicio, id: string, cambios: Partial<DatosDeVersion> & { archivada?: unknown }): Promise<ResultadoDeEscritura<VersionConFechas>> {
  const actual = await leerVersion(service, id)
  if (!actual) return { ok: false, estado: 404, error: 'No se encuentra esa versión.' }
  const usada = await versionUsada(service, actual)

  const parche: Record<string, unknown> = { actualizada_at: new Date().toISOString() }
  const avisos: string[] = []

  // Lo que siempre se puede tocar (la original también: poner el reparto es el trabajo)
  if (cambios.peso !== undefined) {
    const p = validarPeso(cambios.peso)
    if (!p.ok) return { ok: false, estado: 400, error: p.error }
    parche.peso = p.peso
  }
  if (cambios.activa !== undefined) parche.activa = cambios.activa === true
  if (cambios.archivada !== undefined) {
    if (actual.esBase && cambios.archivada === true) return { ok: false, estado: 409, error: 'La versión original no se puede archivar: es el punto de comparación.' }
    parche.archivada = cambios.archivada === true
    // Archivar la saca del reparto
    if (cambios.archivada === true) parche.activa = false
  }
  if (cambios.notas !== undefined && !actual.esBase) parche.notas = typeof cambios.notas === 'string' ? cambios.notas.trim().slice(0, 1000) || null : null
  if (cambios.nombre !== undefined && !actual.esBase) {
    const n = validarNombreDeVersion(cambios.nombre)
    if (!n.ok) return { ok: false, estado: 400, error: n.error }
    parche.nombre = n.nombre
  }

  // Lo que cambia el correo que escribe: solo si todavía no se ha usado
  const tocaElContenido = cambios.secciones !== undefined || cambios.ejemplosIds !== undefined || cambios.usarGanadores !== undefined || cambios.modelo !== undefined
  if (tocaElContenido) {
    if (usada) {
      return {
        ok: false,
        estado: 409,
        error: actual.esBase
          ? 'La versión original no se edita: duplícala y cambia la copia.'
          : 'Esta versión ya ha escrito borradores: si cambias sus instrucciones, sus ejemplos o su modelo, los resultados de antes y de después se mezclarían. Duplícala y cambia la copia.',
      }
    }
    if (cambios.secciones !== undefined) {
      const s = validarSecciones(cambios.secciones)
      if (!s.ok) return { ok: false, estado: 400, error: s.error }
      parche.secciones = s.secciones
      avisos.push(...s.avisos)
    }
    if (cambios.ejemplosIds !== undefined) parche.ejemplos_ids = await ejemplosQueExisten(service, cambios.ejemplosIds)
    if (cambios.usarGanadores !== undefined) parche.usar_ganadores = cambios.usarGanadores === true
    if (cambios.modelo !== undefined) {
      const m = validarModelo(cambios.modelo)
      if (!m.ok) return { ok: false, estado: 400, error: m.error }
      parche.modelo = m.modelo
    }
  }

  const { data, error } = await service.from('correo_ia_versiones').update(parche).eq('id', id).select(COLUMNAS_DE_VERSION).single()
  if (error) throw fallo('No se ha podido guardar la versión.', error)
  return { ok: true, valor: aVersion(data as unknown as FilaDeVersion), avisos }
}

/**
 * «Que todas usen ésta»: la deja en marcha con todo el peso y pausa las demás. Es declarar una ganadora. Las otras no se borran ni se
 * archivan: se pueden volver a poner en marcha cuando se quiera probar algo contra ella.
 */
export async function declararGanadora(service: Servicio, id: string): Promise<ResultadoDeEscritura<VersionConFechas[]>> {
  const versiones = await listarVersiones(service)
  const elegida = versiones.find((v) => v.id === id)
  if (!elegida || elegida.archivada) return { ok: false, estado: 404, error: 'No se encuentra esa versión.' }
  const ahora = new Date().toISOString()
  const { error: errorElegida } = await service.from('correo_ia_versiones').update({ peso: 100, activa: true, actualizada_at: ahora }).eq('id', id)
  if (errorElegida) throw fallo('No se ha podido poner la versión en marcha.', errorElegida)
  const otras = versiones.filter((v) => v.id !== id && v.activa).map((v) => v.id)
  if (otras.length > 0) {
    const { error } = await service.from('correo_ia_versiones').update({ activa: false, actualizada_at: ahora }).in('id', otras)
    if (error) throw fallo('No se han podido pausar las otras versiones.', error)
  }
  return { ok: true, valor: await listarVersiones(service), avisos: [] }
}

/* ------------------------------------------------------------------ */
/* Ejemplos propios                                                    */
/* ------------------------------------------------------------------ */

interface FilaDeEjemplo {
  id: string
  titulo: string
  asunto: string
  texto: string
  tipo: EjemploPropio['tipo']
  nota: string | null
  activo: boolean
  creado_por: string | null
  creado_at: string
  actualizado_at: string
}

const COLUMNAS_DE_EJEMPLO = 'id, titulo, asunto, texto, tipo, nota, activo, creado_por, creado_at, actualizado_at'

export interface EjemploConFechas extends EjemploPropio {
  creadoPor: string | null
  creadoAt: string
  actualizadoAt: string
}

const aEjemplo = (f: FilaDeEjemplo): EjemploConFechas => ({ id: f.id, titulo: f.titulo, asunto: f.asunto, texto: f.texto, tipo: f.tipo, nota: f.nota, activo: f.activo, creadoPor: f.creado_por, creadoAt: f.creado_at, actualizadoAt: f.actualizado_at })

export async function listarEjemplos(service: Servicio): Promise<EjemploConFechas[]> {
  const { data, error } = await service.from('correo_ia_ejemplos').select(COLUMNAS_DE_EJEMPLO).order('creado_at', { ascending: false })
  if (error) throw fallo('No se han podido leer los ejemplos.', error)
  return ((data ?? []) as unknown as FilaDeEjemplo[]).map(aEjemplo)
}

/** Los ejemplos que lee alguna versión que ya ha escrito borradores: no se pueden cambiar (ver arriba) */
export function ejemplosBloqueados(versiones: readonly VersionConFechas[], uso: ReadonlyMap<string, UsoDeVersion>): Set<string> {
  const bloqueados = new Set<string>()
  for (const v of versiones) {
    if ((uso.get(v.id)?.generados ?? 0) === 0) continue
    for (const id of v.ejemplosIds) bloqueados.add(id)
  }
  return bloqueados
}

export async function crearEjemplo(service: Servicio, entrada: unknown, userId: string): Promise<ResultadoDeEscritura<EjemploConFechas>> {
  const v = validarEjemplo(entrada)
  if (!v.ok) return { ok: false, estado: 400, error: v.error }
  const { data, error } = await service.from('correo_ia_ejemplos').insert({ ...v.ejemplo, creado_por: userId }).select(COLUMNAS_DE_EJEMPLO).single()
  if (error) throw fallo('No se ha podido guardar el ejemplo.', error)
  return { ok: true, valor: aEjemplo(data as unknown as FilaDeEjemplo), avisos: v.avisos }
}

export async function actualizarEjemplo(service: Servicio, id: string, entrada: unknown, bloqueado: boolean): Promise<ResultadoDeEscritura<EjemploConFechas>> {
  const v = validarEjemplo(entrada)
  if (!v.ok) return { ok: false, estado: 400, error: v.error }
  const activo = (entrada as { activo?: unknown } | null)?.activo
  const { data: previo, error: errorPrevio } = await service.from('correo_ia_ejemplos').select(COLUMNAS_DE_EJEMPLO).eq('id', id).maybeSingle()
  if (errorPrevio) throw fallo('No se ha podido leer el ejemplo.', errorPrevio)
  if (!previo) return { ok: false, estado: 404, error: 'No se encuentra ese ejemplo.' }
  const actual = aEjemplo(previo as unknown as FilaDeEjemplo)
  const cambiaElContenido = actual.asunto !== v.ejemplo.asunto || actual.texto !== v.ejemplo.texto || actual.tipo !== v.ejemplo.tipo || (activo !== undefined && (activo === true) !== actual.activo)
  if (bloqueado && cambiaElContenido) {
    return { ok: false, estado: 409, error: 'Una versión que ya ha escrito borradores usa este ejemplo: si lo cambias, los resultados de antes y de después se mezclarían. Crea uno nuevo con los cambios.' }
  }
  const parche: Record<string, unknown> = { ...v.ejemplo, actualizado_at: new Date().toISOString() }
  if (activo !== undefined) parche.activo = activo === true
  const { data, error } = await service.from('correo_ia_ejemplos').update(parche).eq('id', id).select(COLUMNAS_DE_EJEMPLO).single()
  if (error) throw fallo('No se ha podido guardar el ejemplo.', error)
  return { ok: true, valor: aEjemplo(data as unknown as FilaDeEjemplo), avisos: v.avisos }
}

export async function borrarEjemplo(service: Servicio, id: string, bloqueado: boolean): Promise<{ ok: true } | { ok: false; estado: number; error: string }> {
  if (bloqueado) return { ok: false, estado: 409, error: 'Una versión que ya ha escrito borradores usa este ejemplo: no se puede borrar. Desmárcalo en una versión nueva y deja éste como está.' }
  const { error } = await service.from('correo_ia_ejemplos').delete().eq('id', id)
  if (error) throw fallo('No se ha podido borrar el ejemplo.', error)
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* La configuración con la que se escribe UN borrador                  */
/* ------------------------------------------------------------------ */

export interface ConfiguracionDeBorrador {
  /** La versión que escribe este borrador, o null si se usa la de siempre sin pasar por las tablas (migración sin lanzar, o ninguna en marcha) */
  version: { id: string; nombre: string } | null
  /** Las instrucciones ya compiladas */
  instrucciones: string
  ejemplos: Array<{ asunto: string; texto: string }>
  /** null = el modelo de siempre */
  modelo: string | null
}

/** La configuración de siempre: las instrucciones originales y los correos del equipo que funcionaron */
export function configuracionPorDefecto(ganadores: readonly EjemploGanador[], tipo: EjemploGanador['tipo']): ConfiguracionDeBorrador {
  return { version: null, instrucciones: INSTRUCCIONES, ejemplos: ejemplosParaLead(ganadores, tipo, 4).map((g) => ({ asunto: g.asunto, texto: g.texto })), modelo: null }
}

/**
 * Elige la versión de un borrador (se sortea entre las que están en marcha, o se mantiene la del cuadro de correo que redacta de nuevo) y
 * devuelve con qué se va a escribir. NUNCA lanza: ante cualquier fallo, la configuración de siempre.
 */
export async function resolverConfiguracion(
  service: Servicio,
  datos: { versionPedida?: string | null; tipo: EjemploGanador['tipo']; ganadores: readonly EjemploGanador[]; azar?: number }
): Promise<ConfiguracionDeBorrador> {
  try {
    const versiones = (await listarVersiones(service)).filter((v) => !v.archivada)
    const elegida = versionParaBorrador(versiones, datos.versionPedida ?? null, datos.azar ?? Math.random())
    if (!elegida) return configuracionPorDefecto(datos.ganadores, datos.tipo)
    const propios = elegida.ejemplosIds.length > 0 ? await ejemplosDeLaVersion(service, elegida.ejemplosIds) : []
    return {
      version: { id: elegida.id, nombre: elegida.nombre },
      instrucciones: compilarInstrucciones(elegida.secciones),
      ejemplos: montarEjemplos({ elegidos: propios, ganadores: datos.ganadores, tipo: datos.tipo, usarGanadores: elegida.usarGanadores }),
      modelo: elegida.modelo,
    }
  } catch (error) {
    if (!esFaltaDeConfiguracion(error)) console.warn('[correo-ia] no se han podido leer las versiones: se usa la configuración de siempre', { mensaje: error instanceof Error ? error.message : 'desconocido' })
    return configuracionPorDefecto(datos.ganadores, datos.tipo)
  }
}

/* ------------------------------------------------------------------ */
/* Con qué se prueba                                                   */
/* ------------------------------------------------------------------ */

export interface ConfiguracionAProbar {
  secciones: SeccionesDeInstrucciones
  ejemplosIds: string[]
  usarGanadores: boolean
  modelo: string | null
  /** Avisos de las instrucciones (pedirle a la IA algo que las reglas fijas prohíben, por ejemplo) */
  avisos: string[]
}

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Con qué configuración se prueba: una versión guardada (`versionId`) o lo que hay en el editor ahora, sin guardar (`secciones`, `ejemplosIds`, `usarGanadores`, `modelo`). Es lo que
 * comparten las dos rutas de prueba (un lead, o varias personas de prueba). No lanza por una versión que no existe: devuelve el 404.
 */
export async function configuracionDePrueba(
  service: Servicio,
  cuerpo: Record<string, unknown>
): Promise<{ ok: true; valor: ConfiguracionAProbar } | { ok: false; estado: number; error: string }> {
  if (typeof cuerpo.versionId === 'string' && ES_UUID.test(cuerpo.versionId) && cuerpo.secciones === undefined) {
    const v = await leerVersion(service, cuerpo.versionId.toLowerCase())
    if (!v) return { ok: false, estado: 404, error: 'No se encuentra esa versión.' }
    return { ok: true, valor: { secciones: v.secciones, ejemplosIds: v.ejemplosIds, usarGanadores: v.usarGanadores, modelo: v.modelo, avisos: [] } }
  }
  const s = validarSecciones(cuerpo.secciones)
  if (!s.ok) return { ok: false, estado: 400, error: s.error }
  const m = validarModelo(cuerpo.modelo)
  if (!m.ok) return { ok: false, estado: 400, error: m.error }
  return {
    ok: true,
    valor: {
      secciones: s.secciones,
      ejemplosIds: Array.isArray(cuerpo.ejemplosIds) ? cuerpo.ejemplosIds.filter((x): x is string => typeof x === 'string' && ES_UUID.test(x)).slice(0, 8) : [],
      usarGanadores: cuerpo.usarGanadores !== false,
      modelo: m.modelo,
      avisos: s.avisos,
    },
  }
}

export async function ejemplosDeLaVersion(service: Servicio, ids: readonly string[]): Promise<EjemploPropio[]> {
  const { data, error } = await service.from('correo_ia_ejemplos').select(COLUMNAS_DE_EJEMPLO).in('id', [...ids])
  if (error) throw fallo('No se han podido leer los ejemplos de la versión.', error)
  const porId = new Map(((data ?? []) as unknown as FilaDeEjemplo[]).map((f) => [f.id, aEjemplo(f)]))
  // En el orden en que la versión los eligió
  return ids.map((id) => porId.get(id)).filter((e): e is EjemploConFechas => e !== undefined)
}
