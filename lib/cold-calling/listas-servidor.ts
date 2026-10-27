import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import {
  ALCANCES,
  LEADS_POR_PAGINA,
  MAXIMO_DEL_BANCO_POR_OPERACION,
  MAXIMO_POR_OPERACION,
  TIENDAS_POR_PAGINA,
  claveDeLista,
  esUuid,
  filtroDeBancoParaLaBase,
  filtroParaLaBase,
  limpiarNombreDeLista,
  nombreCortoDePersona,
  nombreDeListaSugerido,
  resumirLeads,
  type AlcanceDeAsignar,
  type FiltroDeBanco,
  type FiltroDeLeads,
  type FilaDeLead,
  type FilaDelBanco,
  type FilaDeResumen,
  type LeadParaResumir,
  type ListaRegistrada,
  type Movimiento,
  type PersonaDelEquipo,
  type ResultadoDeAnadir,
  type ResultadoDeMover,
  type ResumenDelBanco,
} from './listas'

// Los tipos y las constantes que comparten la pantalla y el servidor viven en listas.ts (puro); se reexportan aquí para quien ya los importaba de este fichero
export { ALCANCES, LEADS_POR_PAGINA, TIENDAS_POR_PAGINA }
export type { AlcanceDeAsignar, FilaDeLead, FilaDelBanco, Movimiento, PersonaDelEquipo, ResultadoDeAnadir, ResultadoDeMover, ResumenDelBanco }

/**
 * LAS LISTAS DE LEADS: LO QUE HACE EL SERVIDOR CON LA BASE — SOLO SERVIDOR.
 * ==========================================================================
 * Envuelve las funciones SQL de la migración 257 (donde está el trabajo de verdad: mover, asignar, deshacer, añadir del banco, de forma atómica y con rastro) y pone
 * el mensaje en español a cada error. listas-servidor.prueba.ts comprueba lo que hace este fichero contra una base falsa; las funciones SQL en sí se validaron aparte
 * contra un Postgres de verdad (125 comprobaciones, y con 40.000 leads y 23.320 tiendas cada llamada tarda menos de 0,3 s).
 *
 * QUIÉN LLAMA tiene que haber comprobado ya que la persona puede gestionar listas (lib/cold-calling/listas-acceso.ts): estas funciones se ejecutan con la clave de servicio
 * y se saltan la RLS. Las funciones SQL lo vuelven a comprobar por dentro (`p_actor`), así que un olvido aquí no deja pasar a nadie que no pueda.
 *
 * SIN LA MIGRACIÓN 257 la pantalla enseña igualmente las listas y lo usadas que están (se resumen los leads aquí mismo), pero no se puede cambiar nada: lo que escribe
 * contesta con FALTA_LA_MIGRACION_257 y un 503.
 */

type Servicio = Pick<SupabaseClient, 'from' | 'rpc'>

export const FALTA_LA_MIGRACION_257 =
  'Falta lanzar la migración 257_listas_de_leads_y_puestos.sql en el editor SQL de Supabase: hasta entonces las listas se pueden ver, pero no crear, mover ni asignar desde aquí.'

const FALLO_GENERICO = 'No se ha podido completar la operación. Vuelve a intentarlo en un momento.'

/** Un error con el estado HTTP que le toca y una frase que se puede enseñar tal cual */
export class ErrorDeListas extends Error {
  constructor(
    mensaje: string,
    readonly estado: number
  ) {
    super(mensaje)
    this.name = 'ErrorDeListas'
  }
}

/**
 * Lo que dice la base, en una frase para quien usa la pantalla. Los mensajes de las funciones SQL (RAISE EXCEPTION con su código) están escritos para eso y se
 * enseñan tal cual; cualquier otro error —un tiempo agotado, una caída— se queda en el registro y a la pantalla le llega una frase genérica.
 */
export function aErrorDeListas(error: unknown): ErrorDeListas {
  if (error instanceof ErrorDeListas) return error
  const e = (error ?? {}) as { code?: string; message?: string }
  if (isMissingSchema(error)) return new ErrorDeListas(FALTA_LA_MIGRACION_257, 503)
  const nuestro = typeof e.message === 'string' && e.message !== ''
  if (e.code === '42501') return new ErrorDeListas(nuestro ? e.message! : 'No tienes permiso para hacer esto.', 403)
  if (e.code === '22023') return new ErrorDeListas(nuestro ? e.message! : 'Lo que se ha mandado no vale.', 400)
  if (e.code === '23505') return new ErrorDeListas(nuestro ? e.message! : 'Eso ya existe.', 409)
  console.error('Cold Calling · listas: fallo de la base', { codigo: e.code ?? null, mensaje: typeof e.message === 'string' ? e.message.slice(0, 200) : null })
  return new ErrorDeListas(FALLO_GENERICO, 500)
}

async function rpc<T>(service: Servicio, nombre: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await service.rpc(nombre, args)
  if (error) throw aErrorDeListas(error)
  return data as T
}

/* ------------------------------------------------------------------ */
/* Leer: las listas, sus leads y el historial                          */
/* ------------------------------------------------------------------ */

export interface PanelDeListas {
  registro: ListaRegistrada[]
  filas: FilaDeResumen[]
  /** false = falta la migración 257: se enseña lo que hay pero no se puede cambiar nada */
  migracion: boolean
}

const COLUMNAS_DEL_REGISTRO = 'id, nombre, descripcion, responsable, archivada, creada_por, created_at'

/** Todos los leads, solo con lo que hace falta para resumirlos (a tramos de 1.000: PostgREST no da más de golpe) */
async function leerLeadsParaResumir(service: Servicio): Promise<LeadParaResumir[]> {
  const salida: LeadParaResumir[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await service
      .from('cold_leads')
      .select('source_list, assigned_to, tipo_lead, status, vende_en_amazon, call_attempts, last_contacted_at')
      .order('id', { ascending: true })
      .range(desde, desde + 999)
    if (error) throw aErrorDeListas(error)
    const filas = (data ?? []) as unknown as LeadParaResumir[]
    salida.push(...filas)
    if (filas.length < 1000) break
  }
  return salida
}

export async function leerPanel(service: Servicio): Promise<PanelDeListas> {
  const [registro, resumen] = await Promise.all([
    service.from('cold_lead_lists').select(COLUMNAS_DEL_REGISTRO).order('nombre', { ascending: true }),
    service.rpc('cold_listas_resumen'),
  ])
  if (registro.error && !isMissingSchema(registro.error)) throw aErrorDeListas(registro.error)
  if (resumen.error && !isMissingSchema(resumen.error)) throw aErrorDeListas(resumen.error)
  const migracion = !registro.error && !resumen.error
  return {
    registro: migracion ? ((registro.data ?? []) as unknown as ListaRegistrada[]) : [],
    filas: migracion ? ((resumen.data ?? []) as FilaDeResumen[]) : resumirLeads(await leerLeadsParaResumir(service)),
    migracion,
  }
}

/* ------------------------------------------------------------------ */
/* El equipo: a quién se le puede asignar una lista                    */
/* ------------------------------------------------------------------ */

const PUESTOS_QUE_LLAMAN: readonly string[] = ['comercial', 'manager_comercial']

export interface PersonasDelPanel {
  /** Las personas a las que tiene sentido asignar una lista o unos leads */
  equipo: PersonaDelEquipo[]
  /** El nombre de TODAS las personas del ERP, por id: para decir quién movió qué o a quién pertenece cada lead, aunque esa persona no esté en el equipo */
  nombres: Record<string, string>
}

/**
 * Las personas del panel de listas. El equipo son las que llaman (`is_comercial`), las que tienen puesto de comercial o de manager comercial y los empleados con acceso a
 * Cold Calling; un administrador o un partner solo salen si también llaman. Antes de la migración 257 no existe la columna `puesto` y se sigue adelante sin ella.
 */
export async function leerPersonas(service: Servicio): Promise<PersonasDelPanel> {
  const columnas = 'id, full_name, email, role, is_comercial'
  let perfiles = await service.from('profiles').select(`${columnas}, puesto`)
  if (perfiles.error && isMissingSchema(perfiles.error)) perfiles = await service.from('profiles').select(columnas)
  if (perfiles.error) throw aErrorDeListas(perfiles.error)
  const permisos = await service.from('user_app_permissions').select('user_id').eq('app_id', 'cold-calling').eq('can_access', true)
  if (permisos.error) throw aErrorDeListas(permisos.error)

  const conAcceso = new Set(((permisos.data ?? []) as unknown as Array<{ user_id: string }>).map((f) => f.user_id))
  const filas = (perfiles.data ?? []) as unknown as Array<{ id: string; full_name: string | null; email: string | null; role: string; is_comercial: boolean | null; puesto?: string | null }>
  const equipo: PersonaDelEquipo[] = []
  const nombres: Record<string, string> = {}
  for (const f of filas) {
    const delCorreo = (f.email ?? '').split('@')[0].replace(/[._-]+/g, ' ').trim()
    const nombre = f.full_name?.trim() || (delCorreo === '' ? 'Sin nombre' : delCorreo.charAt(0).toUpperCase() + delCorreo.slice(1))
    nombres[f.id] = nombre
    if (f.role === 'cliente') continue
    const direccion = f.role === 'admin' || f.role === 'partner'
    const llama = f.is_comercial === true
    const puesto = f.puesto ?? null
    const coldCalling = direccion || conAcceso.has(f.id)
    const entra = llama || (puesto !== null && PUESTOS_QUE_LLAMAN.includes(puesto)) || (!direccion && coldCalling)
    if (!entra) continue
    equipo.push({ id: f.id, nombre, rol: f.role, puesto, llama, coldCalling })
  }
  equipo.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
  return { equipo, nombres }
}

export async function leerEquipo(service: Servicio): Promise<PersonaDelEquipo[]> {
  return (await leerPersonas(service)).equipo
}

export async function leadsDelFiltro(service: Servicio, filtro: FiltroDeLeads, pagina: number, tamano = LEADS_POR_PAGINA): Promise<{ total: number; filas: FilaDeLead[] }> {
  const limite = Math.min(Math.max(Math.trunc(tamano) || LEADS_POR_PAGINA, 1), 500)
  const r = await rpc<{ total: number; filas: FilaDeLead[] }>(service, 'cold_leads_buscar', {
    p_filtro: filtroParaLaBase(filtro),
    p_limite: limite,
    p_desde: Math.max(Math.trunc(pagina) || 0, 0) * limite,
    p_solo_ids: false,
  })
  return { total: r?.total ?? 0, filas: r?.filas ?? [] }
}

/** Los id de todos los leads que cumplen el filtro (sin los excluidos). Hasta MAXIMO_POR_OPERACION; más, es un error */
export async function idsDelFiltro(service: Servicio, filtro: FiltroDeLeads, excluidos: readonly string[] = []): Promise<string[]> {
  const r = await rpc<{ total: number; ids: string[] }>(service, 'cold_leads_buscar', { p_filtro: filtroParaLaBase(filtro), p_limite: MAXIMO_POR_OPERACION, p_desde: 0, p_solo_ids: true })
  const total = r?.total ?? 0
  if (total > MAXIMO_POR_OPERACION) throw new ErrorDeListas(`Son ${total.toLocaleString('es-ES')} leads: de una vez solo se pueden cambiar ${MAXIMO_POR_OPERACION.toLocaleString('es-ES')}. Afina el filtro.`, 400)
  const fuera = new Set(excluidos.map((x) => x.toLowerCase()))
  return (r?.ids ?? []).filter((id) => !fuera.has(id.toLowerCase()))
}

export async function movimientosRecientes(service: Servicio, limite = 40): Promise<Movimiento[]> {
  return (await rpc<Movimiento[] | null>(service, 'cold_movimientos_recientes', { p_limite: limite })) ?? []
}

/* ------------------------------------------------------------------ */
/* Cambiar: listas y leads                                             */
/* ------------------------------------------------------------------ */

const exigirUuid = (v: unknown, que: string): string => {
  if (!esUuid(v)) throw new ErrorDeListas(`${que} no es válido.`, 400)
  return v.toLowerCase()
}

export async function crearLista(service: Servicio, actor: string, datos: { nombre: unknown; descripcion?: unknown; responsable?: unknown }): Promise<{ id: string; nombre: string }> {
  const nombre = limpiarNombreDeLista(datos.nombre)
  if (!nombre || nombre.length > 80) throw new ErrorDeListas('El nombre de la lista tiene que tener entre 1 y 80 caracteres.', 400)
  if (nombre === '__sin_lista__') throw new ErrorDeListas('Ese nombre no se puede usar.', 400)
  return rpc(service, 'cold_lista_crear', {
    p_actor: actor,
    p_nombre: nombre,
    p_descripcion: typeof datos.descripcion === 'string' ? datos.descripcion : null,
    p_responsable: datos.responsable == null || datos.responsable === '' ? null : exigirUuid(datos.responsable, 'La persona'),
  })
}

export async function renombrarLista(service: Servicio, actor: string, id: unknown, nombre: unknown): Promise<{ id: string; nombre: string; leads: number }> {
  const limpio = limpiarNombreDeLista(nombre)
  if (!limpio || limpio.length > 80) throw new ErrorDeListas('El nombre de la lista tiene que tener entre 1 y 80 caracteres.', 400)
  return rpc(service, 'cold_lista_renombrar', { p_actor: actor, p_id: exigirUuid(id, 'La lista'), p_nombre: limpio })
}

export async function archivarLista(service: Servicio, actor: string, id: unknown, archivada: boolean): Promise<{ id: string; nombre: string; archivada: boolean }> {
  return rpc(service, 'cold_lista_archivar', { p_actor: actor, p_id: exigirUuid(id, 'La lista'), p_archivada: archivada })
}

/** Asigna una lista a una persona (y, según el alcance, sus leads). `dueno` null quita al responsable */
export async function asignarLista(service: Servicio, actor: string, id: unknown, dueno: unknown, alcance: unknown): Promise<ResultadoDeMover & { nombre: string }> {
  const a = ALCANCES.includes(alcance as AlcanceDeAsignar) ? (alcance as AlcanceDeAsignar) : 'ninguno'
  return rpc(service, 'cold_lista_responsable', {
    p_actor: actor,
    p_id: exigirUuid(id, 'La lista'),
    p_dueno: dueno == null || dueno === '' ? null : exigirUuid(dueno, 'La persona'),
    p_alcance: a,
  })
}

export interface PeticionDeMover {
  /** Los leads elegidos uno a uno */
  ids?: readonly string[]
  /** O todos los que cumplen un filtro (menos los excluidos) */
  filtro?: FiltroDeLeads
  excluidos?: readonly string[]
  /** Si está (aunque sea null), cambia la lista: null = sacarlos de toda lista */
  lista?: string | null
  /** Si está (aunque sea null), cambia el dueño: null = dejarlos sin dueño */
  dueno?: string | null
}

export async function moverLeads(service: Servicio, actor: string, p: PeticionDeMover): Promise<ResultadoDeMover> {
  const cambiaLista = p.lista !== undefined
  const cambiaDueno = p.dueno !== undefined
  if (!cambiaLista && !cambiaDueno) throw new ErrorDeListas('No hay nada que cambiar.', 400)
  let ids: string[]
  if (p.filtro) ids = await idsDelFiltro(service, p.filtro, p.excluidos ?? [])
  else {
    const dados = [...new Set((p.ids ?? []).map((x) => exigirUuid(x, 'Un lead').toLowerCase()))]
    if (dados.length > MAXIMO_POR_OPERACION) throw new ErrorDeListas(`Son demasiados leads de una vez (el máximo son ${MAXIMO_POR_OPERACION.toLocaleString('es-ES')}).`, 400)
    ids = dados
  }
  if (ids.length === 0) throw new ErrorDeListas('No hay ningún lead elegido.', 400)
  const lista = cambiaLista ? limpiarNombreDeLista(p.lista) : null
  return rpc(service, 'cold_leads_mover', {
    p_actor: actor,
    p_ids: ids,
    p_cambia_lista: cambiaLista,
    p_lista: lista,
    p_cambia_dueno: cambiaDueno,
    p_dueno: cambiaDueno && p.dueno ? exigirUuid(p.dueno, 'La persona') : null,
  })
}

export async function deshacerMovimiento(service: Servicio, actor: string, id: unknown): Promise<{ deshechos: number; conservados: number; accion: string }> {
  return rpc(service, 'cold_leads_deshacer', { p_actor: actor, p_movimiento: exigirUuid(id, 'El movimiento') })
}

/**
 * La lista de una persona nueva: «Ana V1» (o la versión que toque), asignada a ella y vacía, lista para que le lleguen leads. Para cuando se da de alta a un comercial.
 * No lanza: si falta la migración o la base falla, el alta del usuario sigue su camino y se devuelve null.
 */
export async function crearListaParaPersona(service: Servicio, actor: string, persona: { id: string; nombre: string | null; correo: string | null }): Promise<string | null> {
  try {
    const { data, error } = await service.from('cold_lead_lists').select('nombre')
    if (error) return null
    const existentes = ((data ?? []) as Array<{ nombre: string }>).map((f) => f.nombre)
    const nombre = nombreDeListaSugerido(nombreCortoDePersona(persona.nombre, persona.correo), existentes)
    const r = await crearLista(service, actor, { nombre, responsable: persona.id })
    return r.nombre
  } catch (error) {
    console.error('Cold Calling · listas: no se ha podido crear la lista de una persona nueva', { mensaje: error instanceof Error ? error.message : 'desconocido' })
    return null
  }
}

/* ------------------------------------------------------------------ */
/* El banco de tiendas                                                 */
/* ------------------------------------------------------------------ */

export async function resumenDelBanco(service: Servicio): Promise<ResumenDelBanco> {
  return rpc(service, 'cold_banco_resumen', {})
}

export async function buscarEnElBanco(service: Servicio, filtro: FiltroDeBanco, pagina: number, tamano = TIENDAS_POR_PAGINA): Promise<{ total: number; filas: FilaDelBanco[] }> {
  const limite = Math.min(Math.max(Math.trunc(tamano) || TIENDAS_POR_PAGINA, 1), 200)
  const r = await rpc<{ total: number; filas: FilaDelBanco[] }>(service, 'cold_banco_buscar', {
    p_filtro: filtroDeBancoParaLaBase(filtro),
    p_limite: limite,
    p_desde: Math.max(Math.trunc(pagina) || 0, 0) * limite,
    p_solo_dominios: false,
  })
  return { total: r?.total ?? 0, filas: r?.filas ?? [] }
}

export interface PeticionDeAnadir {
  /** Las tiendas elegidas una a una (por su dominio) */
  dominios?: readonly string[]
  /** O las primeras `primeras` que cumplen el filtro, por orden de prioridad (nivel y ventas) */
  filtro?: FiltroDeBanco
  primeras?: number
  /** La lista donde entran: tiene que existir */
  lista: string
  /** De quién son los leads que entran: una persona, o null para dejarlos sin dueño */
  dueno: string | null
}

const DOMINIO = /^[a-z0-9][a-z0-9.-]*\.[a-z0-9-]{2,}$/

export async function anadirDelBanco(service: Servicio, actor: string, p: PeticionDeAnadir): Promise<ResultadoDeAnadir> {
  const lista = limpiarNombreDeLista(p.lista)
  if (!lista) throw new ErrorDeListas('Elige la lista a la que se añaden.', 400)
  let dominios: string[]
  if (p.dominios) {
    dominios = [...new Set(p.dominios.map((d) => String(d).trim().toLowerCase()).filter((d) => DOMINIO.test(d)))]
  } else if (p.filtro) {
    const cuantas = Math.min(Math.max(Math.trunc(p.primeras ?? 0), 0), MAXIMO_DEL_BANCO_POR_OPERACION)
    if (cuantas === 0) throw new ErrorDeListas('Di cuántas tiendas quieres añadir.', 400)
    const r = await rpc<{ total: number; dominios: string[] }>(service, 'cold_banco_buscar', { p_filtro: filtroDeBancoParaLaBase(p.filtro), p_limite: cuantas, p_desde: 0, p_solo_dominios: true })
    dominios = r?.dominios ?? []
  } else {
    throw new ErrorDeListas('Elige las tiendas que se añaden.', 400)
  }
  if (dominios.length === 0) throw new ErrorDeListas('No hay ninguna tienda que añadir con esos filtros.', 400)
  if (dominios.length > MAXIMO_DEL_BANCO_POR_OPERACION) throw new ErrorDeListas(`Son demasiadas tiendas de una vez (el máximo son ${MAXIMO_DEL_BANCO_POR_OPERACION.toLocaleString('es-ES')}).`, 400)
  return rpc(service, 'cold_banco_anadir', {
    p_actor: actor,
    p_dominios: dominios,
    p_lista: lista,
    p_dueno: p.dueno ? exigirUuid(p.dueno, 'La persona') : null,
  })
}

/** Para saber si una lista del registro es la que se pide (sin mayúsculas ni espacios de los lados) */
export const esLaMisma = (a: string | null | undefined, b: string | null | undefined): boolean => claveDeLista(a) === claveDeLista(b)
