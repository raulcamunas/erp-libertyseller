import { createServiceClient } from '@/lib/supabase/service'
import { arbolParaNotion, bloquesDesdeNotion, contarChecklist, contenidoParaNotion, esUrlDeNotion, filaParaNotion, huellaDeContenido, planDeContenido, progresoDeChecklist, textoPlano, tipoDeNotionDe, type Bloque, type TramoNuevo } from '../bloques'
import { encolar } from '../servidor'
import { estadosDe, type ClienteTC, type TareaTC } from '../tipos'
import {
  actualizarBloque,
  actualizarPagina,
  anadirBloques,
  bloquesDe,
  borrarBloque,
  comentariosDe,
  crearComentario,
  crearPagina,
  ErrorDeNotion,
  leerDataSource,
  leerPagina,
  leerUsuario,
  notionConfigurado,
  paginasDeLaBase,
  type PaginaNotion,
} from './cliente'
import { camposDesdePagina, esquemaDe, iconoParaNotion, opcionesDe, propiedadesParaNotion } from './mapeo'
import { rehospedarImagenes } from './imagenes'
import { tablaDePersonas, type TablaDePersonas } from './personas'

/**
 * LA SINCRONIZACIÓN CON NOTION, EN LOS DOS SENTIDOS.
 * SOLO SERVIDOR.
 *
 *   NOTION → ERP (`traerCliente`)   Cada pasada trae las páginas de cada base editadas desde la última vez, y los cuerpos y comentarios por tandas.
 *   ERP → NOTION (`vaciarCola`)     Cada cambio hecho aquí dejó una fila en `tc_notion_cola`; se manda en orden y, si falla, se reintenta con espera creciente.
 *
 * ¿QUIÉN GANA SI SE TOCA LO MISMO A LA VEZ? La última edición. Una tarea con cambios aquí todavía sin enviar no se pisa desde Notion (primero sale lo nuestro); y una
 * página que Notion editó antes de lo último que ya vimos se ignora. Lo que mandamos solo lleva los campos que cambiaron, así que lo que se toque en otro campo en Notion no
 * se pierde. Cuando mandamos algo, nos guardamos la hora que Notion le pone a su edición: así su propio eco no vuelve a entrar como si fuera un cambio de otra persona.
 *
 * ESCRIBIR EN NOTION está ACTIVO por defecto (desde que Raúl lo pidió, 8 nov 2026, tras la primera lectura completa sin errores). `NOTION_ESCRITURA=0` en el servidor lo
 * apaga de golpe (la sincronización vuelve a solo LEER) sin tocar código. Cada cambio hecho en el ERP sale a los pocos segundos (pronto.ts); la pasada periódica del cron
 * es la red de seguridad (reintentos y lo que se quedó a medias si el servidor se reinició).
 */

const MARGEN_DE_RELOJ_MS = 120_000
const TANDA_DE_CUERPOS = 25
const TANDA_DE_COMENTARIOS = 20
/** Peticiones de comentarios por pasada, entre todos los clientes: a 3 por segundo, 300 (20 por cliente) eran ~100 s de cada pasada */
const COMENTARIOS_POR_PASADA = 40
/** Si Notion dice que la integración no puede leer comentarios, no se vuelve a probar en un buen rato */
const ESPERA_SIN_PERMISO_DE_COMENTARIOS_MS = 30 * 60_000
let comentariosSinPermisoHasta = 0
const INTENTOS_ANTES_DE_ERROR = 6

export const escrituraPermitida = (): boolean => (process.env.NOTION_ESCRITURA ?? '').trim() !== '0'

export interface ResultadoDeSync {
  ok: boolean
  motivo?: string
  clientes: number
  creadas: number
  actualizadas: number
  cuerpos: number
  comentarios: number
  enviadas: number
  fallidas: number
  tiempoMs: number
}

const vacio = (): ResultadoDeSync => ({ ok: true, clientes: 0, creadas: 0, actualizadas: 0, cuerpos: 0, comentarios: 0, enviadas: 0, fallidas: 0, tiempoMs: 0 })

/* ------------------------------------------------------------------ */
/* Un solo turno a la vez                                              */
/* ------------------------------------------------------------------ */

const ID_DEL_TURNO = 'sync-turno'
const DURACION_MAX_DEL_TURNO_MS = 4 * 60_000

async function cogerTurno(): Promise<boolean> {
  const service = createServiceClient()
  const caducado = new Date(Date.now() - DURACION_MAX_DEL_TURNO_MS).toISOString()
  const { data } = await service.from('tc_notion_eventos').update({ recibido_en: new Date().toISOString(), tipo: 'turno' }).eq('id', ID_DEL_TURNO).lt('recibido_en', caducado).select('id')
  if ((data ?? []).length > 0) return true
  const { error } = await service.from('tc_notion_eventos').insert({ id: ID_DEL_TURNO, tipo: 'turno' })
  return !error
}

async function soltarTurno() {
  await createServiceClient().from('tc_notion_eventos').update({ recibido_en: new Date(0).toISOString() }).eq('id', ID_DEL_TURNO)
}

/* ------------------------------------------------------------------ */
/* Personas                                                            */
/* ------------------------------------------------------------------ */

async function cargarPersonas(): Promise<TablaDePersonas> {
  const service = createServiceClient()
  const [perfiles, enlaces] = await Promise.all([service.from('profiles').select('id, full_name, email'), service.from('tc_personas').select('perfil_id, notion_user_id')])
  return tablaDePersonas(
    ((perfiles.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => ({ id: p.id, nombre: (p.full_name ?? '').trim() || (p.email ?? '') })),
    (enlaces.data ?? []) as Array<{ perfil_id: string | null; notion_user_id: string | null }>
  )
}

async function guardarEnlacesNuevos(tabla: TablaDePersonas) {
  if (tabla.nuevos.length === 0) return
  await createServiceClient()
    .from('tc_personas')
    .upsert(tabla.nuevos.map((n) => ({ ...n, confirmada: false })), { onConflict: 'notion_user_id', ignoreDuplicates: true })
  tabla.nuevos.length = 0
}

/* ------------------------------------------------------------------ */
/* Notion → ERP                                                        */
/* ------------------------------------------------------------------ */

type FilaDeTarea = Pick<TareaTC, 'id' | 'notion_page_id' | 'notion_editado' | 'estado' | 'orden' | 'sync_estado'>

/** Lee la base de un cliente y deja su esquema y sus opciones al día */
async function prepararCliente(c: ClienteTC): Promise<ClienteTC> {
  if (!c.notion_ds_id) return c
  const ds = await leerDataSource(c.notion_ds_id)
  const esquema = esquemaDe(ds)
  const opciones = opcionesDe(ds, esquema)
  const nuevo = { notion_esquema: esquema, opciones: { ...c.opciones, ...opciones } }
  if (JSON.stringify(nuevo.notion_esquema) !== JSON.stringify(c.notion_esquema) || JSON.stringify(nuevo.opciones) !== JSON.stringify(c.opciones)) {
    await createServiceClient().from('tc_clientes').update(nuevo).eq('id', c.id)
  }
  return { ...c, ...nuevo } as ClienteTC
}

/** Las tareas que tienen un cambio mío esperando a salir hacia Notion: no se pisan */
async function tareasConCambiosPendientes(clienteId: string): Promise<Set<string>> {
  const { data } = await createServiceClient().from('tc_notion_cola').select('tarea_id').eq('cliente_id', clienteId).is('hecho_en', null)
  return new Set((data ?? []).map((f: { tarea_id: string | null }) => f.tarea_id).filter((x): x is string => Boolean(x)))
}

/**
 * Pone al día UNA página de Notion en el ERP. Devuelve qué ha hecho y el id de la tarea (para traer su cuerpo y sus comentarios).
 */
async function aplicarPagina(c: ClienteTC, pagina: PaginaNotion, personas: TablaDePersonas, existentes: Map<string, FilaDeTarea>, pendientes: Set<string>, finalDeColumna: Map<string, number>): Promise<{ accion: 'creada' | 'actualizada' | 'igual'; tareaId: string | null }> {
  const service = createServiceClient()
  const campos = camposDesdePagina(pagina, c.notion_esquema, personas.deNotion, estadosDe(c)[0]?.nombre ?? 'Backlog')
  const previa = existentes.get(pagina.id)

  if (!previa) {
    const orden = (finalDeColumna.get(campos.estado) ?? 0) + 1024
    finalDeColumna.set(campos.estado, orden)
    const { data, error } = await service
      .from('tc_tareas')
      .insert({ ...campos, cliente_id: c.id, orden, origen: 'notion', sync_estado: 'ok' })
      .select('id')
      .single()
    if (error || !data) throw new Error(`No se ha podido crear la tarea de Notion «${campos.titulo}»: ${error?.message ?? 'sin respuesta'}`)
    return { accion: 'creada', tareaId: data.id }
  }
  // Con cambios nuestros todavía sin enviar, no se pisa; y una edición de Notion que ya vimos tampoco se repite
  if (pendientes.has(previa.id)) return { accion: 'igual', tareaId: previa.id }
  if (previa.notion_editado && pagina.last_edited_time <= previa.notion_editado) return { accion: 'igual', tareaId: previa.id }

  const cambiaDeColumna = previa.estado !== campos.estado
  const orden = cambiaDeColumna ? (finalDeColumna.get(campos.estado) ?? 0) + 1024 : previa.orden
  if (cambiaDeColumna) finalDeColumna.set(campos.estado, orden)
  const { error } = await service.from('tc_tareas').update({ ...campos, orden, sync_estado: 'ok', sync_error: null }).eq('id', previa.id)
  if (error) throw new Error(`No se ha podido actualizar la tarea «${campos.titulo}»: ${error.message}`)
  return { accion: 'actualizada', tareaId: previa.id }
}

/** El cuerpo de una página de Notion, traído al editor. No pisa un cuerpo con cambios nuestros sin enviar */
export async function traerContenido(tareaId: string): Promise<boolean> {
  const service = createServiceClient()
  const { data: t } = await service.from('tc_tareas').select('id, cliente_id, progreso, notion_page_id, notion_contenido_hash, contenido').eq('id', tareaId).maybeSingle()
  if (!t?.notion_page_id) return false
  const { data: pendiente } = await service.from('tc_notion_cola').select('id').eq('tarea_id', tareaId).in('operacion', ['contenido', 'crear']).is('hecho_en', null).limit(1)
  if ((pendiente ?? []).length > 0) return false

  const leidos = bloquesDesdeNotion(await bloquesDe(t.notion_page_id))
  const huella = huellaDeContenido(leidos)
  const marca = { notion_contenido_revisado: new Date().toISOString() }
  // Lo guardado puede tener una imagen con dirección de Notion (que caduca): aunque nada haya cambiado, se vuelve a leer para copiarla a nuestro almacén
  const conImagenCaducable = ((t.contenido ?? []) as Bloque[]).some((b) => b.tipo === 'imagen' && esUrlDeNotion(b.url))
  if (huella === t.notion_contenido_hash && !conImagenCaducable) {
    await service.from('tc_tareas').update(marca).eq('id', tareaId)
    return false
  }
  const { bloques } = await rehospedarImagenes(leidos, tareaId)
  const lista = contarChecklist(bloques)
  // El progreso es casillas hechas ÷ casillas. Si alguien marcó una casilla en Notion, el «Progreso» de Notion se quedó atrás: aquí se corrige y se manda a Notion
  // (antes lo hacía una automatización de n8n). Una tarea sin casillas conserva su progreso.
  const progreso = progresoDeChecklist(lista)
  const cambiaElProgreso = progreso !== null && progreso !== Number(t.progreso)
  await service
    .from('tc_tareas')
    .update({ ...marca, contenido: bloques, contenido_texto: textoPlano(bloques).slice(0, 200_000), checklist_total: lista.total, checklist_hecho: lista.hecho, notion_contenido_hash: huella, ...(cambiaElProgreso ? { progreso } : {}) })
    .eq('id', tareaId)
  if (cambiaElProgreso && t.cliente_id) await encolar(t.cliente_id as string, tareaId, 'propiedades', { campos: ['progreso'] })
  return true
}

/** Los comentarios de una página de Notion que todavía no están aquí */
export async function traerComentarios(tareaId: string, nombres: Map<string, string>): Promise<number> {
  const service = createServiceClient()
  const { data: t } = await service.from('tc_tareas').select('id, notion_page_id').eq('id', tareaId).maybeSingle()
  if (!t?.notion_page_id) return 0
  const [remotos, locales] = await Promise.all([comentariosDe(t.notion_page_id), service.from('tc_comentarios').select('notion_comment_id').eq('tarea_id', tareaId).not('notion_comment_id', 'is', null)])
  const vistos = new Set((locales.data ?? []).map((l: { notion_comment_id: string }) => l.notion_comment_id))
  let nuevos = 0
  for (const r of remotos) {
    if (vistos.has(r.id)) continue
    const autorId = r.created_by?.id ?? ''
    let nombre = r.created_by?.name ?? nombres.get(autorId) ?? ''
    if (!nombre && autorId) {
      nombre = await leerUsuario(autorId).then((u) => u.name ?? '').catch(() => '')
      nombres.set(autorId, nombre)
    }
    const cuerpo = r.rich_text.map((x) => x.plain_text ?? x.text?.content ?? '').join('')
    if (!cuerpo.trim()) continue
    const { error } = await service.from('tc_comentarios').insert({ tarea_id: tareaId, autor_nombre: nombre || 'Notion', cuerpo, origen: 'notion', notion_comment_id: r.id, notion_discussion_id: r.discussion_id ?? null, creado_en: r.created_time })
    if (!error) nuevos += 1
  }
  const { count } = await service.from('tc_comentarios').select('id', { count: 'exact', head: true }).eq('tarea_id', tareaId).eq('borrado', false)
  await service.from('tc_tareas').update({ notion_comentarios_revisados: new Date().toISOString(), comentarios: count ?? 0 }).eq('id', tareaId)
  return nuevos
}

/** Trae de Notion todo lo nuevo de la base de un cliente */
async function traerCliente(c0: ClienteTC, personas: TablaDePersonas, completa: boolean, resultado: ResultadoDeSync, limite: number, comentarios: { restantes: number }): Promise<void> {
  if (!c0.notion_ds_id) return
  const service = createServiceClient()
  const c = await prepararCliente(c0)
  const desde = !completa && c.sync_ultima ? new Date(Date.parse(c.sync_ultima) - MARGEN_DE_RELOJ_MS).toISOString() : undefined
  const empezo = new Date().toISOString()
  const paginas = await paginasDeLaBase(c.notion_ds_id as string, desde)

  const [{ data: filas }, pendientes] = await Promise.all([
    service.from('tc_tareas').select('id, notion_page_id, notion_editado, estado, orden, sync_estado').eq('cliente_id', c.id).not('notion_page_id', 'is', null).limit(20000),
    tareasConCambiosPendientes(c.id),
  ])
  const existentes = new Map((filas ?? []).map((f: FilaDeTarea) => [f.notion_page_id as string, f] as const))
  const finalDeColumna = new Map<string, number>()
  for (const f of (filas ?? []) as FilaDeTarea[]) finalDeColumna.set(f.estado, Math.max(finalDeColumna.get(f.estado) ?? 0, Number(f.orden)))

  const tocadas: string[] = []
  for (const p of paginas) {
    if (Date.now() > limite) break
    const r = await aplicarPagina(c, p, personas, existentes, pendientes, finalDeColumna)
    if (r.accion === 'creada') resultado.creadas += 1
    if (r.accion === 'actualizada') resultado.actualizadas += 1
    if (r.accion !== 'igual' && r.tareaId) tocadas.push(r.tareaId)
  }
  await guardarEnlacesNuevos(personas)

  // Los cuerpos y los comentarios, por tandas: lo que cambió ahora y lo que todavía no se ha mirado nunca
  const nombres = new Map<string, string>()
  const { data: sinCuerpo } = await service.from('tc_tareas').select('id').eq('cliente_id', c.id).not('notion_page_id', 'is', null).is('notion_contenido_revisado', null).limit(TANDA_DE_CUERPOS)
  const paraCuerpo = [...new Set([...tocadas, ...(sinCuerpo ?? []).map((s: { id: string }) => s.id)])].slice(0, TANDA_DE_CUERPOS)
  for (const id of paraCuerpo) {
    if (Date.now() > limite) break
    if (await traerContenido(id).catch(() => false)) resultado.cuerpos += 1
  }
  const { data: sinComentarios } = await service.from('tc_tareas').select('id').eq('cliente_id', c.id).not('notion_page_id', 'is', null).eq('archivada', false).order('notion_comentarios_revisados', { ascending: true, nullsFirst: true }).limit(TANDA_DE_COMENTARIOS)
  for (const s of (sinComentarios ?? []) as Array<{ id: string }>) {
    if (Date.now() > limite || comentarios.restantes <= 0 || Date.now() < comentariosSinPermisoHasta) break
    comentarios.restantes -= 1
    try {
      resultado.comentarios += await traerComentarios(s.id, nombres)
    } catch (e) {
      // Sin la capacidad «Leer comentarios» Notion contesta 403 a todas: no se insiste con las demás (y no se marca ninguna como revisada)
      if (e instanceof ErrorDeNotion && e.estado === 403) {
        comentariosSinPermisoHasta = Date.now() + ESPERA_SIN_PERMISO_DE_COMENTARIOS_MS
        break
      }
    }
  }
  // Solo se adelanta la marca si se leyó todo lo que había: si se cortó por tiempo, la próxima pasada sigue por donde iba
  if (Date.now() <= limite) await service.from('tc_clientes').update({ sync_ultima: empezo, sync_error: null }).eq('id', c.id)
}

/** Una página concreta, avisada por un webhook de Notion: se trae ella sola, sin esperar a la próxima pasada */
export async function sincronizarPagina(paginaId: string): Promise<'hecha' | 'ajena'> {
  if (!notionConfigurado()) return 'ajena'
  const service = createServiceClient()
  const pagina = await leerPagina(paginaId)
  const dsId = pagina.parent?.data_source_id
  const dbId = pagina.parent?.database_id
  const { data: cliente } = await service.from('tc_clientes').select('*').or([dsId ? `notion_ds_id.eq.${dsId}` : '', dbId ? `notion_db_id.eq.${dbId}` : ''].filter(Boolean).join(',') || 'id.is.null').limit(1).maybeSingle()
  if (!cliente) return 'ajena'
  const c = cliente as ClienteTC
  const personas = await cargarPersonas()
  const [{ data: filas }, pendientes] = await Promise.all([service.from('tc_tareas').select('id, notion_page_id, notion_editado, estado, orden, sync_estado').eq('cliente_id', c.id).eq('notion_page_id', paginaId), tareasConCambiosPendientes(c.id)])
  const existentes = new Map((filas ?? []).map((f: FilaDeTarea) => [f.notion_page_id as string, f] as const))
  const finalDeColumna = new Map<string, number>()
  const { data: maximos } = await service.from('tc_tareas').select('estado, orden').eq('cliente_id', c.id).order('orden', { ascending: false }).limit(2000)
  for (const m of (maximos ?? []) as Array<{ estado: string; orden: number }>) if (!finalDeColumna.has(m.estado)) finalDeColumna.set(m.estado, Number(m.orden))
  const r = await aplicarPagina(c, pagina, personas, existentes, pendientes, finalDeColumna)
  await guardarEnlacesNuevos(personas)
  if (r.tareaId) {
    await traerContenido(r.tareaId).catch(() => false)
    await traerComentarios(r.tareaId, new Map()).catch(() => 0)
  }
  return 'hecha'
}

/* ------------------------------------------------------------------ */
/* ERP → Notion                                                        */
/* ------------------------------------------------------------------ */

interface FilaDeCola {
  id: number
  tarea_id: string | null
  cliente_id: string | null
  operacion: 'crear' | 'propiedades' | 'contenido' | 'archivar' | 'comentar'
  payload: Record<string, unknown>
  intentos: number
}

const TODOS_LOS_CAMPOS = ['titulo', 'icono', 'estado', 'departamento', 'fecha_inicio', 'fecha_fin', 'progreso', 'url', 'responsables'] as const

async function empujarPropiedades(t: TareaTC, c: ClienteTC, campos: readonly string[], personas: TablaDePersonas): Promise<PaginaNotion> {
  const cambios: Record<string, unknown> = {}
  for (const k of campos) if (k !== 'icono') cambios[k] = (t as unknown as Record<string, unknown>)[k]
  if (campos.includes('responsables')) cambios.responsables_notion = t.responsables_notion
  const propiedades = propiedadesParaNotion(cambios, c.notion_esquema, personas.haciaNotion)
  return actualizarPagina(t.notion_page_id as string, { ...(Object.keys(propiedades).length > 0 ? { properties: propiedades } : {}), ...(campos.includes('icono') ? { icon: iconoParaNotion(t.icono) } : {}) })
}

const aTrozos = <T>(lista: T[], n: number): T[][] => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, (i + 1) * n))

/** Añade bloques al final de una página: Notion admite 100 por petición */
async function anadirAlFinal(paginaId: string, bloques: Bloque[]) {
  for (const trozo of aTrozos(arbolParaNotion(bloques), 100)) await anadirBloques(paginaId, trozo)
}

/** Añade un tramo de bloques nuevos detrás de `despues` (o al final si no se sabe): los trozos siguientes van detrás del último creado */
async function anadirTramo(paginaId: string, tramo: TramoNuevo) {
  let despues = tramo.despues ?? undefined
  for (const trozo of aTrozos(arbolParaNotion(tramo.bloques), 100)) {
    const r = await anadirBloques(paginaId, trozo, despues)
    if (despues !== undefined) despues = r.results?.at(-1)?.id ?? despues
  }
}

const textoDeCelda = (c: Bloque['filas']) => JSON.stringify(c)

/**
 * Una tabla que ya está en Notion: se mandan solo las filas que cambian (cada una con su identificador), se borran las que ya no están y las nuevas se añaden detrás de la
 * última. Las columnas no se tocan (Notion no deja cambiar el ancho de una tabla): el editor no las ofrece cuando la tabla ya está en Notion.
 */
async function actualizarTabla(nuevo: Bloque, previo: Bloque | undefined): Promise<void> {
  const tablaId = nuevo.notion_id as string
  const filas = nuevo.filas ?? []
  const ids = nuevo.filaIds ?? []
  const idsPrevios = previo?.filaIds ?? []
  const conservadas = new Set(ids.filter(Boolean))
  for (const id of idsPrevios) if (id && !conservadas.has(id)) await borrarBloque(id).catch(ignorarSiNoExiste)
  const ancho = Math.max(1, previo?.filas ? Math.max(...previo.filas.map((f) => f.length)) : Math.max(...filas.map((f) => f.length)))
  let ultimo: string | undefined
  for (let i = 0; i < filas.length; i++) {
    const id = ids[i]
    if (id) {
      const anterior = previo?.filas?.[idsPrevios.indexOf(id)]
      if (!anterior || textoDeCelda([anterior]) !== textoDeCelda([filas[i]])) {
        const fila = filaParaNotion(filas[i], ancho)
        await actualizarBloque(id, { table_row: fila.table_row })
      }
      ultimo = id
    } else {
      const r = await anadirBloques(tablaId, [filaParaNotion(filas[i], ancho)], ultimo)
      ultimo = r.results?.at(-1)?.id ?? ultimo
    }
  }
  if (previo && (Boolean(previo.encabezadoFila) !== Boolean(nuevo.encabezadoFila) || Boolean(previo.encabezadoColumna) !== Boolean(nuevo.encabezadoColumna))) {
    await actualizarBloque(tablaId, { table: { has_column_header: Boolean(nuevo.encabezadoFila), has_row_header: Boolean(nuevo.encabezadoColumna) } })
  }
}

async function empujarContenido(t: TareaTC): Promise<void> {
  const pagina = t.notion_page_id as string
  const actual = bloquesDesdeNotion(await bloquesDe(pagina))
  const plan = planDeContenido(actual, (t.contenido ?? []) as Bloque[])
  if (plan.modo === 'nada') return
  const bloquesDeArriba = new Set(actual.filter((b) => (b.nivel ?? 0) === 0).map((b) => b.notion_id))
  // Primero se escribe lo nuevo y solo después se borra lo viejo: si algo falla a medias, no se pierde el cuerpo
  if (plan.modo === 'reemplazar') {
    await anadirAlFinal(pagina, plan.crear)
    for (const id of plan.borrar.filter((x) => bloquesDeArriba.has(x))) await borrarBloque(id).catch(ignorarSiNoExiste)
    return
  }
  for (const b of plan.actualizar) {
    // Las imágenes ya subidas no se tocan; una tabla se actualiza fila a fila
    if (b.tipo === 'imagen') continue
    if (b.tipo === 'tabla') {
      await actualizarTabla(b, actual.find((x) => x.notion_id === b.notion_id))
      continue
    }
    const tipo = tipoDeNotionDe(b)
    const cuerpo = contenidoParaNotion(b)
    if (b.notion_id && tipo && cuerpo) await actualizarBloque(b.notion_id, { [tipo]: cuerpo })
  }
  for (const tramo of plan.tramos) await anadirTramo(pagina, tramo)
  for (const id of plan.borrar) await borrarBloque(id).catch(ignorarSiNoExiste)
}

function ignorarSiNoExiste(e: unknown) {
  if (e instanceof ErrorDeNotion && e.estado === 404) return
  throw e
}

const esperaTrasFallo = (intentos: number) => new Date(Date.now() + Math.min(2 ** intentos, 360) * 60_000).toISOString()

/** Manda a Notion lo que hay en la cola. Una tarea cada vez, con sus operaciones en orden */
async function vaciarCola(personas: TablaDePersonas, resultado: ResultadoDeSync, limite: number): Promise<void> {
  const service = createServiceClient()
  const { data } = await service.from('tc_notion_cola').select('id, tarea_id, cliente_id, operacion, payload, intentos').is('hecho_en', null).lte('proximo_intento', new Date().toISOString()).order('id').limit(300)
  const filas = (data ?? []) as FilaDeCola[]
  const porTarea = new Map<string, FilaDeCola[]>()
  for (const f of filas) if (f.tarea_id) porTarea.set(f.tarea_id, [...(porTarea.get(f.tarea_id) ?? []), f])

  for (const [tareaId, ops] of porTarea) {
    if (Date.now() > limite) break
    const { data: tarea } = await service.from('tc_tareas').select('*').eq('id', tareaId).maybeSingle()
    const { data: cliente } = await service.from('tc_clientes').select('*').eq('id', ops[0].cliente_id).maybeSingle()
    if (!tarea || !cliente?.notion_ds_id) {
      await service.from('tc_notion_cola').update({ hecho_en: new Date().toISOString(), error: 'La tarea o su cliente ya no existen' }).in('id', ops.map((o) => o.id))
      continue
    }
    let t = tarea as TareaTC
    const c = cliente as ClienteTC
    const hechas: number[] = []
    try {
      const crear = ops.find((o) => o.operacion === 'crear')
      if (crear && !t.notion_page_id) {
        const props = propiedadesParaNotion(Object.fromEntries(TODOS_LOS_CAMPOS.filter((k) => k !== 'icono').map((k) => [k, (t as unknown as Record<string, unknown>)[k]])), c.notion_esquema, personas.haciaNotion)
        const arbol = arbolParaNotion((t.contenido ?? []) as Bloque[])
        const pagina = await crearPagina(c.notion_ds_id as string, props, { ...(t.icono ? { icon: iconoParaNotion(t.icono) } : {}), ...(arbol.length > 0 ? { children: arbol.slice(0, 100) } : {}) })
        for (const trozo of aTrozos(arbol.slice(100), 100)) await anadirBloques(pagina.id, trozo)
        await service.from('tc_tareas').update({ notion_page_id: pagina.id, notion_url: pagina.url ?? null, notion_editado: pagina.last_edited_time, notion_contenido_revisado: null, notion_comentarios_revisados: null }).eq('id', tareaId)
        t = { ...t, notion_page_id: pagina.id, notion_editado: pagina.last_edited_time }
      }
      if (!t.notion_page_id) throw new Error('La tarea todavía no tiene página en Notion')

      const campos = [...new Set(ops.filter((o) => o.operacion === 'propiedades').flatMap((o) => ((o.payload.campos as string[] | undefined) ?? [...TODOS_LOS_CAMPOS])))]
      if (campos.length > 0 && !crear) {
        const pagina = await empujarPropiedades(t, c, campos, personas)
        await service.from('tc_tareas').update({ notion_editado: pagina.last_edited_time }).eq('id', tareaId)
      }
      if (ops.some((o) => o.operacion === 'contenido') && !crear) {
        await empujarContenido(t)
        // Se vuelve a leer para que los bloques nuevos reciban su identificador de Notion
        await service.from('tc_tareas').update({ notion_contenido_revisado: null, notion_contenido_hash: null }).eq('id', tareaId)
      }
      const archivar = [...ops].reverse().find((o) => o.operacion === 'archivar')
      if (archivar) {
        const pagina = await actualizarPagina(t.notion_page_id, { in_trash: archivar.payload.archivada === true })
        await service.from('tc_tareas').update({ notion_editado: pagina.last_edited_time }).eq('id', tareaId)
      }
      for (const o of ops.filter((x) => x.operacion === 'comentar')) {
        const { data: com } = await service.from('tc_comentarios').select('id, autor_nombre, cuerpo, notion_comment_id').eq('id', o.payload.comentarioId as string).maybeSingle()
        if (com && !com.notion_comment_id) {
          const nota = await crearComentario(t.notion_page_id, [
            { type: 'text', text: { content: `${com.autor_nombre}: ` }, annotations: { bold: true } },
            { type: 'text', text: { content: String(com.cuerpo).slice(0, 1900) } },
          ])
          await service.from('tc_comentarios').update({ notion_comment_id: nota.id }).eq('id', com.id)
        }
      }
      hechas.push(...ops.map((o) => o.id))
      resultado.enviadas += ops.length
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : 'Error desconocido'
      resultado.fallidas += ops.length
      for (const o of ops) {
        await service.from('tc_notion_cola').update({ intentos: o.intentos + 1, error: mensaje.slice(0, 500), proximo_intento: esperaTrasFallo(o.intentos + 1) }).eq('id', o.id)
      }
      if (Math.max(...ops.map((o) => o.intentos)) + 1 >= INTENTOS_ANTES_DE_ERROR) await service.from('tc_tareas').update({ sync_estado: 'error', sync_error: mensaje.slice(0, 500) }).eq('id', tareaId)
      continue
    }
    await service.from('tc_notion_cola').update({ hecho_en: new Date().toISOString(), error: null }).in('id', hechas)
    const { data: quedan } = await service.from('tc_notion_cola').select('id').eq('tarea_id', tareaId).is('hecho_en', null).limit(1)
    if ((quedan ?? []).length === 0) await service.from('tc_tareas').update({ sync_estado: 'ok', sync_error: null }).eq('id', tareaId)
  }
}

/**
 * Solo manda lo que hay en la cola, sin leer nada de Notion: es lo que se lanza a los pocos segundos de cada cambio (pronto.ts). Comparte el turno con la pasada entera, así
 * que nunca van las dos a la vez; si el turno está cogido devuelve `ocupado` y quien llama lo reintenta. `proximoEnMs`: cuándo toca el siguiente reintento de algo que falló.
 */
export async function vaciarSoloLaCola(presupuestoMs = 40_000): Promise<{ ocupado: boolean; proximoEnMs: number | null }> {
  if (!escrituraPermitida() || !notionConfigurado()) return { ocupado: false, proximoEnMs: null }
  if (!(await cogerTurno())) return { ocupado: true, proximoEnMs: null }
  const service = createServiceClient()
  try {
    const personas = await cargarPersonas()
    await vaciarCola(personas, vacio(), Date.now() + presupuestoMs)
  } finally {
    await soltarTurno()
  }
  const { data } = await service.from('tc_notion_cola').select('proximo_intento').is('hecho_en', null).order('proximo_intento').limit(1)
  const siguiente = data?.[0]?.proximo_intento ? Date.parse(data[0].proximo_intento as string) - Date.now() : null
  return { ocupado: false, proximoEnMs: siguiente === null || Number.isNaN(siguiente) ? null : Math.max(siguiente, 5_000) }
}

/* ------------------------------------------------------------------ */
/* Una pasada entera                                                   */
/* ------------------------------------------------------------------ */

export async function sincronizarTodo(opciones: { completa?: boolean; presupuestoMs?: number; clienteId?: string } = {}): Promise<ResultadoDeSync> {
  const inicio = Date.now()
  const r = vacio()
  if (!notionConfigurado()) return { ...r, ok: false, motivo: 'Falta la clave de Notion (NOTION_TOKEN) en el servidor.' }
  if (!(await cogerTurno())) return { ...r, ok: false, motivo: 'Ya hay una sincronización en marcha.' }
  const limite = inicio + (opciones.presupuestoMs ?? 50_000)
  const service = createServiceClient()
  try {
    let consulta = service.from('tc_clientes').select('*').eq('activo', true).not('notion_ds_id', 'is', null).order('orden')
    if (opciones.clienteId) consulta = consulta.eq('id', opciones.clienteId)
    const { data: clientes } = await consulta
    const personas = await cargarPersonas()
    // PRIMERO SALE LO NUESTRO, y con su propio tiempo: antes se mandaba al final, y si leer los clientes se comía el presupuesto lo del ERP no llegaba nunca a Notion
    if (escrituraPermitida()) await vaciarCola(personas, r, Math.min(limite, Date.now() + 40_000))
    const comentarios = { restantes: COMENTARIOS_POR_PASADA }
    for (const c of (clientes ?? []) as ClienteTC[]) {
      if (Date.now() > limite) break
      try {
        await traerCliente(c, personas, Boolean(opciones.completa), r, limite, comentarios)
        r.clientes += 1
      } catch (e) {
        const motivo = e instanceof Error ? e.message : 'Error desconocido'
        await service.from('tc_clientes').update({ sync_error: motivo.slice(0, 500) }).eq('id', c.id)
        r.ok = false
        r.motivo = motivo
      }
    }
  } finally {
    await soltarTurno()
    r.tiempoMs = Date.now() - inicio
  }
  return r
}
