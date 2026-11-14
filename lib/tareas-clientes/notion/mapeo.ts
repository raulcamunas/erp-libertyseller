import type { ColorNotion, EsquemaNotion, GrupoDeEstado, OpcionDeEstado, OpcionSimple, OpcionesDelCliente, PropiedadNotion, ResponsableNotion, TareaTC } from '../tipos'
import { COLORES_NOTION } from '../tipos'
import { esTipoSoportado, limpiarValor, MAX_EXTRAS, type PropiedadExtra } from '../propiedades'
import type { DataSourceNotion, PaginaNotion, PropiedadDelEsquema, PropiedadDePagina } from './cliente'

/**
 * LAS COLUMNAS DE NOTION, TRADUCIDAS A UNA TAREA Y AL REVÉS.
 *
 * Cada base de Notion llama distinto a sus columnas («Nombre» o «Tarea», «Resposable» con la errata, «Fecha» o «Fecha de inicio») y las del estado pueden ser de tipo
 * «status» o «select». Aquí se detecta cuál es cuál UNA vez por base (`esquemaDe`) y se guarda en el cliente; desde ahí, leer y escribir una página es mecánico.
 *
 * SIN RED: puro, y se comprueba con mapeo.prueba.ts con la forma real de las bases de Notion.
 */

const color = (c: string | undefined): ColorNotion => (c && (COLORES_NOTION as readonly string[]).includes(c) ? (c as ColorNotion) : 'default')

/* ------------------------------------------------------------------ */
/* Qué columna es cuál                                                 */
/* ------------------------------------------------------------------ */

const primeraDe = (props: PropiedadDelEsquema[], tipos: string[], nombre?: RegExp): PropiedadDelEsquema | undefined =>
  (nombre ? props.find((p) => tipos.includes(p.type) && nombre.test(p.name)) : undefined) ?? props.find((p) => tipos.includes(p.type))

const comoPropiedad = (p: PropiedadDelEsquema | undefined): PropiedadNotion | undefined => (p ? { nombre: p.name, tipo: p.type } : undefined)

export function esquemaDe(fuente: Pick<DataSourceNotion, 'properties'>): EsquemaNotion {
  const props = Object.values(fuente.properties)
  const usadas = new Set<string>()
  const tomar = (p: PropiedadDelEsquema | undefined) => {
    if (p) usadas.add(p.name)
    return comoPropiedad(p)
  }
  const sinUsar = () => props.filter((p) => !usadas.has(p.name))

  const titulo = tomar(props.find((p) => p.type === 'title'))
  const estado = tomar(primeraDe(sinUsar(), ['status', 'select'], /estado|status/i))
  // El departamento es un «select» que NO es el estado
  const departamento = tomar(sinUsar().find((p) => p.type === 'select' && /departamento|area|área|categor/i.test(p.name)) ?? sinUsar().find((p) => p.type === 'select'))
  const responsable = tomar(primeraDe(sinUsar(), ['people'], /respons|resposable|asignad|owner|persona/i))
  const fecha = tomar(primeraDe(sinUsar(), ['date'], /fecha|date|inicio/i))
  const progreso = tomar(primeraDe(sinUsar(), ['number'], /progreso|progress/i))
  const url = tomar(primeraDe(sinUsar(), ['url'], /url|enlace|link/i))
  // Lo que queda y se sabe mostrar y escribir son las columnas propias de esa base
  const extras: PropiedadExtra[] = sinUsar()
    .filter((p) => esTipoSoportado(p.type))
    .slice(0, MAX_EXTRAS)
    .map((p) => {
      const opciones = p.type === 'select' ? p.select?.options : p.type === 'multi_select' ? p.multi_select?.options : undefined
      return { nombre: p.name, tipo: p.type as PropiedadExtra['tipo'], ...(opciones ? { opciones: opciones.map((o) => ({ nombre: o.name, color: color(o.color) })) } : {}) }
    })
  return { titulo, estado, departamento, responsable, fecha, progreso, url, ...(extras.length > 0 ? { extras } : {}) }
}

/* ------------------------------------------------------------------ */
/* Las opciones de estado y departamento de una base                   */
/* ------------------------------------------------------------------ */

/** Dónde cae un estado cuando la base no lo dice (una columna «select» no tiene grupos) */
export function grupoPorNombre(nombre: string): GrupoDeEstado {
  const n = nombre.toLowerCase()
  if (/complet|hecho|hecha|done|cerrad|cierre|hito|finaliz|entregad/.test(n)) return 'hecho'
  if (/backlog|pendiente|por hacer|todo|to-do|idea|nueva/.test(n)) return 'pendiente'
  return 'en_curso'
}

const GRUPO_DE_NOTION: Record<string, GrupoDeEstado> = { 'to-do': 'pendiente', todo: 'pendiente', 'in progress': 'en_curso', complete: 'hecho', completed: 'hecho' }

export function opcionesDe(fuente: Pick<DataSourceNotion, 'properties'>, esquema: EsquemaNotion): OpcionesDelCliente {
  const estadoProp = esquema.estado ? fuente.properties[esquema.estado.nombre] : undefined
  const estados: OpcionDeEstado[] = []
  if (estadoProp?.type === 'status') {
    const opciones = estadoProp.status?.options ?? []
    const grupos = estadoProp.status?.groups ?? []
    // Un grupo de Notion dice a qué opciones agrupa por NOMBRE o por id; aquí llega por nombre en `option_ids` solo si la API los trae así, y si no, por heurística
    for (const o of opciones) {
      const grupo = grupos.find((g) => g.option_ids?.includes(o.id ?? '▲'))
      const nombreGrupo = grupo?.name?.toLowerCase()
      estados.push({ nombre: o.name, color: color(o.color), grupo: (nombreGrupo && GRUPO_DE_NOTION[nombreGrupo]) || grupoPorNombre(o.name) })
    }
  } else if (estadoProp?.type === 'select') {
    for (const o of estadoProp.select?.options ?? []) estados.push({ nombre: o.name, color: color(o.color), grupo: grupoPorNombre(o.name) })
  }

  const depProp = esquema.departamento ? fuente.properties[esquema.departamento.nombre] : undefined
  const departamentos: OpcionSimple[] = (depProp?.select?.options ?? []).map((o) => ({ nombre: o.name, color: color(o.color) }))
  return { estados, departamentos }
}

/* ------------------------------------------------------------------ */
/* De la página de Notion a los campos de la tarea                     */
/* ------------------------------------------------------------------ */

/** Los campos de una tarea que salen de una página de Notion */
export type CamposDeTarea = Pick<
  TareaTC,
  'titulo' | 'icono' | 'estado' | 'departamento' | 'fecha_inicio' | 'fecha_fin' | 'fecha_con_hora' | 'progreso' | 'url' | 'responsables' | 'responsables_notion' | 'archivada' | 'notion_page_id' | 'notion_url' | 'notion_editado'
>

/** Qué persona del ERP es una de Notion: por su id de Notion, o por su nombre si todavía no se ha enlazado */
export type ResolutorDePersonas = (notionUserId: string, nombre: string | null) => string | null

const textoPlano = (rt: unknown): string =>
  Array.isArray(rt) ? rt.map((x) => (x as { plain_text?: string }).plain_text ?? '').join('') : ''

const propiedad = (pagina: PaginaNotion, p: PropiedadNotion | undefined): PropiedadDePagina | undefined => (p ? pagina.properties[p.nombre] : undefined)

function nombreDeOpcion(p: PropiedadDePagina | undefined): string | null {
  if (!p) return null
  const valor = p[p.type] as { name?: string } | null | undefined
  return valor?.name ?? null
}

/** «2026-11-05» es un día; «2026-11-05T10:00:00.000+01:00» es un día con hora */
const conHora = (iso: string | null | undefined) => Boolean(iso && iso.length > 10)

export function camposDesdePagina(pagina: PaginaNotion, esquema: EsquemaNotion, personas: ResolutorDePersonas, estadoPorDefecto = 'Backlog'): CamposDeTarea {
  const titulo = textoPlano((propiedad(pagina, esquema.titulo)?.title as unknown[]) ?? [])
  const fecha = (propiedad(pagina, esquema.fecha)?.date as { start?: string; end?: string | null } | null | undefined) ?? null
  const progresoBruto = propiedad(pagina, esquema.progreso)?.number as number | null | undefined
  const gente = ((propiedad(pagina, esquema.responsable)?.people as Array<{ id: string; name?: string }> | undefined) ?? []).map((u) => ({ id: u.id, nombre: u.name ?? '' }))

  const responsables: string[] = []
  const sinEnlazar: ResponsableNotion[] = []
  for (const u of gente) {
    const mio = personas(u.id, u.nombre || null)
    if (mio) responsables.push(mio)
    else sinEnlazar.push(u)
  }

  return {
    titulo,
    icono: pagina.icon?.type === 'emoji' ? (pagina.icon.emoji ?? null) : null,
    estado: nombreDeOpcion(propiedad(pagina, esquema.estado)) ?? estadoPorDefecto,
    departamento: nombreDeOpcion(propiedad(pagina, esquema.departamento)),
    fecha_inicio: fecha?.start ?? null,
    fecha_fin: fecha?.end ?? null,
    fecha_con_hora: conHora(fecha?.start),
    progreso: aProgreso(progresoBruto),
    url: ((propiedad(pagina, esquema.url)?.url as string | null | undefined) ?? null) || null,
    responsables,
    responsables_notion: sinEnlazar,
    archivada: Boolean(pagina.archived || pagina.in_trash),
    notion_page_id: pagina.id,
    notion_url: pagina.url ?? null,
    notion_editado: pagina.last_edited_time,
  }
}

/** El progreso de Notion es un número: si viene como fracción (0,5) se lleva a porcentaje; todo se queda entre 0 y 100 */
export function aProgreso(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0
  const pct = n > 0 && n < 1 ? n * 100 : n
  return Math.max(0, Math.min(100, Math.round(pct)))
}

/* ------------------------------------------------------------------ */
/* De la tarea a las propiedades que se mandan a Notion                */
/* ------------------------------------------------------------------ */

/** Qué persona de Notion es una del ERP; null si todavía no se ha enlazado (entonces no se manda) */
export type ResolutorInverso = (perfilId: string) => string | null

type CambiosDeTarea = Partial<Pick<TareaTC, 'titulo' | 'estado' | 'departamento' | 'fecha_inicio' | 'fecha_fin' | 'progreso' | 'url' | 'responsables' | 'responsables_notion'>>

const rt = (texto: string) => [{ type: 'text', text: { content: texto.slice(0, 2000) } }]

/** Solo las propiedades que han cambiado: así no se pisa en Notion lo que no se ha tocado aquí */
export function propiedadesParaNotion(cambios: CambiosDeTarea, esquema: EsquemaNotion, personas: ResolutorInverso): Record<string, unknown> {
  const salida: Record<string, unknown> = {}
  if ('titulo' in cambios && esquema.titulo) salida[esquema.titulo.nombre] = { title: rt(cambios.titulo ?? '') }
  if ('estado' in cambios && esquema.estado && cambios.estado) {
    salida[esquema.estado.nombre] = esquema.estado.tipo === 'status' ? { status: { name: cambios.estado } } : { select: { name: cambios.estado } }
  }
  if ('departamento' in cambios && esquema.departamento) salida[esquema.departamento.nombre] = { select: cambios.departamento ? { name: cambios.departamento } : null }
  if (('fecha_inicio' in cambios || 'fecha_fin' in cambios) && esquema.fecha) {
    salida[esquema.fecha.nombre] = { date: cambios.fecha_inicio ? { start: cambios.fecha_inicio, end: cambios.fecha_fin ?? null } : null }
  }
  if ('progreso' in cambios && esquema.progreso) salida[esquema.progreso.nombre] = { number: cambios.progreso ?? 0 }
  if ('url' in cambios && esquema.url) salida[esquema.url.nombre] = { url: cambios.url || null }
  if (('responsables' in cambios || 'responsables_notion' in cambios) && esquema.responsable) {
    // Los que están enlazados + los que Notion tenía y aquí aún no se reconocen: así quitar a uno aquí no borra a los demás en Notion
    const ids = new Set<string>()
    for (const id of cambios.responsables ?? []) {
      const n = personas(id)
      if (n) ids.add(n)
    }
    for (const r of cambios.responsables_notion ?? []) ids.add(r.id)
    salida[esquema.responsable.nombre] = { people: [...ids].map((id) => ({ id })) }
  }
  return salida
}

/** La portada del icono de la página */
export const iconoParaNotion = (emoji: string | null | undefined) => (emoji ? { type: 'emoji', emoji } : null)


/* ------------------------------------------------------------------ */
/* Las propiedades propias de cada base                                */
/* ------------------------------------------------------------------ */

/** Los valores de las columnas propias de una página de Notion, ya en la forma que guarda el ERP (propiedades.ts) */
export function propiedadesExtraDesdePagina(pagina: PaginaNotion, extras: readonly PropiedadExtra[]): Record<string, unknown> {
  const salida: Record<string, unknown> = {}
  for (const x of extras) {
    const p = pagina.properties[x.nombre]
    if (!p || p.type !== x.tipo) continue
    const v = p[p.type] as unknown
    let valor: unknown
    switch (x.tipo) {
      case 'select':
        valor = (v as { name?: string } | null)?.name ?? null
        break
      case 'multi_select':
        valor = Array.isArray(v) ? (v as Array<{ name?: string }>).map((o) => o.name ?? '').filter(Boolean) : []
        break
      case 'rich_text':
        valor = textoPlano(v) || null
        break
      case 'date': {
        const d = v as { start?: string; end?: string | null } | null
        valor = d?.start ? { start: d.start, end: d.end ?? null } : null
        break
      }
      case 'checkbox':
        valor = v === true
        break
      case 'number':
        valor = typeof v === 'number' && Number.isFinite(v) ? v : null
        break
      default:
        valor = typeof v === 'string' && v ? v : null
    }
    salida[x.nombre] = valor
  }
  return salida
}

/** Las propiedades de Notion a mandar para estos valores. Solo las que el cliente tiene y de un valor que vale; una que no se reconoce no se manda */
export function propiedadesExtraParaNotion(valores: Record<string, unknown> | null | undefined, extras: readonly PropiedadExtra[]): Record<string, unknown> {
  const salida: Record<string, unknown> = {}
  for (const x of extras) {
    if (!valores || !(x.nombre in valores)) continue
    const v = limpiarValor(x, valores[x.nombre])
    if (v === undefined) continue
    switch (x.tipo) {
      case 'select':
        salida[x.nombre] = { select: v ? { name: v as string } : null }
        break
      case 'multi_select':
        salida[x.nombre] = { multi_select: (v as string[]).map((name) => ({ name })) }
        break
      case 'rich_text':
        salida[x.nombre] = { rich_text: v ? rt(v as string) : [] }
        break
      case 'date':
        salida[x.nombre] = { date: v }
        break
      case 'checkbox':
        salida[x.nombre] = { checkbox: v === true }
        break
      case 'number':
        salida[x.nombre] = { number: v as number | null }
        break
      default:
        salida[x.nombre] = { [x.tipo]: (v as string | null) ?? null }
    }
  }
  return salida
}
