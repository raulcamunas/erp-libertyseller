import { isMissingSchema } from '@/lib/plataforma/eventos'
import { diaMadrid, esDia, horaMadrid, hoyMadrid, inicioDelDia, sumarDias } from '@/lib/rendimiento/dia'
import { fetchAll, trocear } from '@/lib/supabase/paginacion'
import { createServiceClient } from '@/lib/supabase/service'
import { entero, texto } from '../argumentos'
import type { ContextoMcp, Servicio } from '../contexto'
import { ErrorDeHerramienta } from '../protocolo'

/**
 * LO COMÚN DE LAS HERRAMIENTAS DEL EQUIPO COMERCIAL (Cold Calling, correo y Mi rendimiento).
 * SOLO SERVIDOR, pero casi todo es puro y se prueba en comun.prueba.ts.
 *
 * Las herramientas de lib/mcp/herramientas.ts trabajan con las cuentas de Amazon de UN cliente. Estas trabajan con el equipo de ventas y con los leads de
 * Cold Calling (tiendas a las que se llama en frío), así que no hay `cliente` y sí se puede mirar a todo el equipo a la vez. Son de SOLO LECTURA y las
 * puede usar quien ya pasa la puerta del conector: un administrador (lib/mcp/auth.ts).
 *
 * Cuatro reglas que se repiten en todas:
 *   · LOS DÍAS SON LOS DE MADRID, como en Mi rendimiento. Un día es «AAAA-MM-DD» (también «hoy» y «ayer») y las horas que se devuelven son de Madrid.
 *   · PostgREST CORTA A 1.000 FILAS sin avisar: lo que puede pasar de ahí se lee por tramos (`fetchAll`) o se pide con tope y se dice cuántas hay.
 *   · LO QUE SE DEVUELVE TIENE TOPE: las listas llevan `total` y `hay_mas`, y los textos largos (comentarios, correos, transcripciones) se recortan DICIÉNDOLO.
 *   · SI FALTA UNA MIGRACIÓN, SE DICE CUÁL en vez de devolver una lista vacía que parezca «no hay nada».
 */

export type { ContextoMcp, Servicio }

/** La base con la que se lee: la del contexto (pruebas) o, en producción, un cliente de servicio nuevo */
export const servicioDe = (ctx: ContextoMcp): Servicio => ctx.servicio ?? createServiceClient()

/* ------------------------------------------------------------------ */
/* Los días                                                            */
/* ------------------------------------------------------------------ */

export const DIAS_MAX_EN_LISTAS = 92
export const DIAS_MAX_EN_RESUMEN = 400

/** Un día de los argumentos: «AAAA-MM-DD», «hoy» o «ayer». `undefined` si no viene */
export function diaArg(args: Record<string, unknown>, nombre: string, opciones: { requerido?: boolean; hoy?: string } = {}): string | undefined {
  const v = texto(args, nombre, { requerido: opciones.requerido, max: 10 })
  if (v === undefined) return undefined
  const hoy = opciones.hoy ?? hoyMadrid()
  const t = v.toLowerCase()
  if (t === 'hoy') return hoy
  if (t === 'ayer') return sumarDias(hoy, -1)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || !esDia(t)) {
    throw new ErrorDeHerramienta(`«${nombre}» tiene que ser un día con el formato AAAA-MM-DD (por ejemplo ${hoy}), o «hoy» o «ayer».`)
  }
  return t
}

export interface RangoDeDias {
  /** Primer día, incluido */
  desde: string
  /** Último día, incluido */
  hasta: string
}

/**
 * El rango `desde`–`hasta` (ambos incluidos). Sin ninguno, hoy. Con uno solo, ese día (y si es `desde`, hasta hoy si ya pasó). El rango no puede ser mayor
 * que `maxDias`: una pregunta de un año entero se contesta pidiendo que se acote, no con 40.000 filas.
 */
export function rangoArg(args: Record<string, unknown>, opciones: { maxDias?: number; hoy?: string } = {}): RangoDeDias {
  const hoy = opciones.hoy ?? hoyMadrid()
  const maxDias = opciones.maxDias ?? DIAS_MAX_EN_LISTAS
  const d = diaArg(args, 'desde', { hoy })
  const h = diaArg(args, 'hasta', { hoy })
  let desde: string
  let hasta: string
  if (d === undefined && h === undefined) {
    desde = hoy
    hasta = hoy
  } else if (d !== undefined && h === undefined) {
    desde = d
    hasta = d <= hoy ? hoy : d
  } else if (d === undefined && h !== undefined) {
    desde = h
    hasta = h
  } else {
    desde = d as string
    hasta = h as string
  }
  if (desde > hasta) throw new ErrorDeHerramienta(`«desde» (${desde}) no puede ser posterior a «hasta» (${hasta}).`)
  const dias = diasEntre(desde, hasta) + 1
  if (dias > maxDias) {
    throw new ErrorDeHerramienta(`El rango es de ${dias} días y el máximo es ${maxDias}. Acótalo con «desde» y «hasta», o pide por partes.`)
  }
  return { desde, hasta }
}

/**
 * Como rangoArg, pero SIN `desde` ni `hasta` mira los últimos `porDefecto` días (hoy incluido) en vez de solo hoy: para listas de cosas que no pasan cada
 * minuto (apuntes, llamadas, citas) un «hoy» a las 8 de la mañana sería una lista vacía que parece «no se ha hecho nada».
 */
export function rangoOUltimosDias(args: Record<string, unknown>, opciones: { porDefecto: number; maxDias?: number; hoy?: string }): RangoDeDias {
  const hoy = opciones.hoy ?? hoyMadrid()
  const d = diaArg(args, 'desde', { hoy })
  const h = diaArg(args, 'hasta', { hoy })
  if (d === undefined && h === undefined) return { desde: sumarDias(hoy, -(opciones.porDefecto - 1)), hasta: hoy }
  return rangoArg(args, { maxDias: opciones.maxDias, hoy })
}

/** Días de calendario entre dos días (positivo si `b` es posterior) */
export function diasEntre(a: string, b: string): number {
  const f = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
  return Math.round((f(b) - f(a)) / 86_400_000)
}

/** Los instantes (ISO, UTC) que delimitan un rango de días de Madrid: `>= desde` y `< hasta` (el día siguiente al último a las 00:00) */
export function instantesDe(r: RangoDeDias): { desde: string; hasta: string } {
  return { desde: inicioDelDia(r.desde).toISOString(), hasta: inicioDelDia(sumarDias(r.hasta, 1)).toISOString() }
}

/** «2026-10-27 10:42», hora de Madrid. `null` si no hay instante */
export function fechaHora(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return `${diaMadrid(t)} ${horaMadrid(t)}`
}

/** «2026-10-27» de un instante (día de Madrid) */
export const diaDe = (iso: string | null | undefined): string | null => (iso && Number.isFinite(Date.parse(iso)) ? diaMadrid(iso) : null)

/** Segundos a minutos con un decimal («3,5»), o 0 */
export const aMinutos = (segundos: number | null | undefined): number => (typeof segundos === 'number' && segundos > 0 ? Math.round((segundos / 60) * 10) / 10 : 0)

/* ------------------------------------------------------------------ */
/* Las páginas                                                         */
/* ------------------------------------------------------------------ */

export interface PaginaPedida {
  /** Empieza en 0 */
  pagina: number
  limite: number
  /** Para `.range(desde, hasta)` */
  desde: number
  hasta: number
}

export function paginaArg(args: Record<string, unknown>, opciones: { limite?: number; max?: number } = {}): PaginaPedida {
  const max = opciones.max ?? 100
  const limite = entero(args, 'limite', { min: 1, max, defecto: Math.min(opciones.limite ?? 25, max) })
  const pagina = entero(args, 'pagina', { min: 0, max: 10_000, defecto: 0 })
  return { pagina, limite, desde: pagina * limite, hasta: pagina * limite + limite - 1 }
}

export interface DatosDePagina {
  pagina: number
  limite: number
  /** Cuántas filas cumplen el filtro en total */
  total: number
  devueltas: number
  hay_mas: boolean
  /** Qué pedir para ver la siguiente */
  siguiente_pagina: number | null
}

export function datosDePagina(p: PaginaPedida, total: number, devueltas: number): DatosDePagina {
  const hayMas = p.desde + devueltas < total
  return { pagina: p.pagina, limite: p.limite, total, devueltas, hay_mas: hayMas, siguiente_pagina: hayMas ? p.pagina + 1 : null }
}

/**
 * Una lista que cabe en `tope` caracteres. Si la respuesta se pasa, se quitan elementos del FINAL hasta que quepa y se dice en la propia respuesta
 * (`aviso_de_tamano`) cuántos se enseñan y qué hacer. Es mejor que dejar que `aTexto` corte el JSON a la mitad: una lista cortada en silencio, o con el
 * JSON roto, parece completa. Las cifras de `total` y de los resúmenes no se tocan.
 */
export function ajustarAlTamano<T extends Record<string, unknown>>(salida: T, clave: keyof T & string, tope: number): T {
  const lista = salida[clave]
  if (!Array.isArray(lista) || JSON.stringify(salida, null, 1).length <= tope) return salida
  const enteras = lista.length
  const copia: Record<string, unknown> = { ...salida, [clave]: [...lista] }
  const elementos = copia[clave] as unknown[]
  while (elementos.length > 1 && JSON.stringify(copia, null, 1).length > tope - 400) elementos.pop()
  copia.aviso_de_tamano = `La respuesta no cabía entera: se enseñan ${elementos.length} de los ${enteras} de esta página. Pide un \`limite\` más pequeño (por ejemplo ${elementos.length}) para no perder los demás.`
  return copia as T
}

/* ------------------------------------------------------------------ */
/* Los errores de la base                                              */
/* ------------------------------------------------------------------ */

/**
 * Un fallo de la base. «Falta la migración» (tabla o columna que no existe) se cuenta con el nombre de lo que falta; cualquier otro se lanza tal cual para que
 * lo apunte el log del servidor y el modelo reciba un error genérico (no se le enseña el mensaje de Postgres).
 */
export function fallo(error: unknown, queFalta: string): never {
  if (isMissingSchema(error)) {
    throw new ErrorDeHerramienta(`Esta parte del ERP todavía no está activada en la base de datos (${queFalta}). Hay que lanzar su migración en el editor SQL de Supabase.`)
  }
  throw error
}

export function comprobar<T extends { error: unknown }>(r: T, queFalta: string): T {
  if (r.error) fallo(r.error, queFalta)
  return r
}

/* ------------------------------------------------------------------ */
/* Las personas                                                        */
/* ------------------------------------------------------------------ */

export interface Persona {
  id: string
  nombre: string
  email: string | null
}

interface PerfilLeido {
  id: string
  full_name: string | null
  email: string | null
}

export const nombreDePerfil = (p: { full_name: string | null; email: string | null }): string => p.full_name?.trim() || p.email || 'Sin nombre'

const aPersona = (p: PerfilLeido): Persona => ({ id: p.id, nombre: nombreDePerfil(p), email: p.email })

/** El equipo comercial: los perfiles marcados `is_comercial`, por nombre */
export async function equipoComercial(s: Servicio): Promise<Persona[]> {
  const { data } = comprobar(await s.from('profiles').select('id, full_name, email').eq('is_comercial', true).order('full_name', { ascending: true }).order('id', { ascending: true }), 'perfiles')
  return ((data ?? []) as PerfilLeido[]).map(aPersona)
}

/** Cualquier persona por su id (comerciales y no comerciales: quien es dueño de un buzón o de una cita puede no ser comercial) */
export async function personasPorId(s: Servicio, ids: readonly string[]): Promise<Map<string, Persona>> {
  const salida = new Map<string, Persona>()
  const unicos = [...new Set(ids.filter((x) => !!x))]
  for (const trozo of trocear(unicos, 100)) {
    const { data } = comprobar(await s.from('profiles').select('id, full_name, email').in('id', trozo), 'perfiles')
    for (const p of (data ?? []) as PerfilLeido[]) salida.set(p.id, aPersona(p))
  }
  return salida
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Minúsculas y sin acentos, para que «maria fernanda» encuentre «María Fernanda» */
export const normalizar = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/**
 * La persona a la que se refiere el texto: su id, su correo o su nombre (entero o parte: «maoli», «maria f»). Si no hay ninguna o hay varias, el error
 * dice cuáles hay para que el modelo acierte a la segunda.
 */
export function elegirPersona(lista: readonly Persona[], consulta: string, rotulo = 'comercial'): Persona {
  const q = normalizar(consulta)
  if (UUID.test(consulta.trim())) {
    const p = lista.find((x) => x.id === consulta.trim().toLowerCase())
    if (p) return p
  }
  const porCorreo = lista.filter((p) => p.email && normalizar(p.email) === q)
  if (porCorreo.length === 1) return porCorreo[0]

  const palabras = q.split(' ').filter(Boolean)
  const coinciden = lista.filter((p) => {
    const nombre = normalizar(p.nombre)
    const correo = p.email ? normalizar(p.email.split('@')[0]) : ''
    return palabras.length > 0 && palabras.every((w) => nombre.includes(w) || correo.includes(w))
  })
  if (coinciden.length === 1) return coinciden[0]
  // Varias: si una se llama exactamente así, o su primer nombre es lo escrito, es esa
  const exacta = coinciden.filter((p) => normalizar(p.nombre) === q)
  if (exacta.length === 1) return exacta[0]
  const porPrimerNombre = coinciden.filter((p) => normalizar(p.nombre).split(' ')[0] === q)
  if (porPrimerNombre.length === 1) return porPrimerNombre[0]

  const nombres = (coinciden.length > 1 ? coinciden : lista).map((p) => p.nombre).join(', ')
  if (coinciden.length > 1) throw new ErrorDeHerramienta(`«${consulta}» puede ser varios ${rotulo}es: ${nombres}. Escribe el nombre completo.`)
  throw new ErrorDeHerramienta(`No hay ningún ${rotulo} que se llame «${consulta}». Los que hay: ${nombres || '(ninguno)'}.`)
}

/* ------------------------------------------------------------------ */
/* Los leads por su nombre                                             */
/* ------------------------------------------------------------------ */

export interface NombreDeLead {
  id: string
  nombre: string
  empresa: string | null
}

/** El nombre de los leads (tiendas de Cold Calling) por su id. Los que no existen ya no salen */
export async function nombresDeLeads(s: Servicio, ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, NombreDeLead>> {
  const salida = new Map<string, NombreDeLead>()
  const unicos = [...new Set(ids.filter((x): x is string => !!x))]
  for (const trozo of trocear(unicos, 100)) {
    const { data } = comprobar(await s.from('cold_leads').select('id, store_name, company').in('id', trozo), 'cold_leads')
    for (const f of (data ?? []) as Array<{ id: string; store_name: string; company: string | null }>) salida.set(f.id, { id: f.id, nombre: f.store_name, empresa: f.company })
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Textos                                                              */
/* ------------------------------------------------------------------ */

/** Un texto libre recortado a `max` caracteres, con los saltos de línea en una línea. `null` si no hay */
export function recortar(t: string | null | undefined, max: number): string | null {
  if (t === null || t === undefined) return null
  const limpio = t.replace(/\s+/g, ' ').trim()
  if (limpio === '') return null
  return limpio.length > max ? `${limpio.slice(0, max - 1).trimEnd()}…` : limpio
}

/** Un texto largo (un correo, una transcripción) recortado conservando los saltos de línea. Dice si lo ha cortado */
export function recortarLargo(t: string | null | undefined, max: number): { texto: string | null; recortado: boolean; caracteres: number } {
  if (t === null || t === undefined || t.trim() === '') return { texto: null, recortado: false, caracteres: 0 }
  const limpio = t.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (limpio.length <= max) return { texto: limpio, recortado: false, caracteres: limpio.length }
  return { texto: `${limpio.slice(0, max - 1).trimEnd()}…`, recortado: true, caracteres: limpio.length }
}

/** El patrón de un `ilike` que contiene el texto, sin los caracteres que lo romperían (comas, paréntesis, comodines) */
export function patronDeBusqueda(t: string): string {
  const limpio = t
    .replace(/[,()%*\\"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return `%${limpio}%`
}

/* ------------------------------------------------------------------ */
/* Lecturas por tramos                                                 */
/* ------------------------------------------------------------------ */

export { fetchAll, trocear }
