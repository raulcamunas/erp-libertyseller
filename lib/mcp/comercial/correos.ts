import { UUID } from '@/lib/correo/acceso'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { diaMadrid, hoyMadrid } from '@/lib/rendimiento/dia'
import { aTexto, entero, opcion, texto } from '../argumentos'
import type { ContextoMcp, Servicio } from '../contexto'
import { ErrorDeHerramienta, type Herramienta } from '../protocolo'
import {
  ajustarAlTamano,
  comprobar,
  datosDePagina,
  fallo,
  fechaHora,
  fetchAll,
  instantesDe,
  paginaArg,
  patronDeBusqueda,
  personasPorId,
  rangoOUltimosDias,
  recortar,
  recortarLargo,
  servicioDe,
  trocear,
} from './comun'
import { elegirBuzon, type BuzonElegible } from './secuencias'

/**
 * EL CORREO DEL EQUIPO, PARA CLAUDE: LOS ENVIADOS, LAS CONVERSACIONES Y UN HILO ENTERO.
 * SOLO SERVIDOR. Lo puro (`armar…`, `nombreEnElRastro`) se prueba en correos.prueba.ts con una base en memoria.
 *
 * Esto son los buzones que el equipo conecta en la aplicación Correo. Un administrador los lee todos, pero NO EN SILENCIO: cada vez que Claude abre el
 * buzón de otra persona deja una fila en `correo_accesos` (el rastro que ya dejan Correo y la supervisión, solo visible para administradores) con el
 * nombre de quien preguntó y «vía el conector de Claude». Si el rastro no se puede escribir, NO se enseña el correo: la herramienta cierra en vez de abrir.
 *
 * Los textos de los correos son de clientes y de personas del equipo: se recortan y se dice cuando se corta. Lo que hay en la cola de envíos
 * automáticos está en secuencias.ts (correo_envios, correo_cola).
 */

/* ------------------------------------------------------------------ */
/* Los buzones y el rastro                                             */
/* ------------------------------------------------------------------ */

export interface BuzonDelEquipo extends BuzonElegible {
  user_id: string
  propietario: { id: string; nombre: string }
}

interface BuzonLeido {
  id: string
  user_id: string
  direccion: string
  nombre: string | null
}

/** Todos los buzones conectados, con el nombre de su dueño */
export async function buzonesDelEquipo(s: Servicio): Promise<BuzonDelEquipo[]> {
  const { data } = comprobar(await s.from('correo_buzones').select('id, user_id, direccion, nombre').order('direccion', { ascending: true }), 'correo_buzones (migración 236)')
  const filas = (data ?? []) as BuzonLeido[]
  const dueños = await personasPorId(s, filas.map((b) => b.user_id))
  return filas.map((b) => ({ id: b.id, user_id: b.user_id, direccion: b.direccion, nombre: b.nombre, propietario: { id: b.user_id, nombre: dueños.get(b.user_id)?.nombre ?? 'Sin nombre' } }))
}

/** Cómo se apunta en el rastro quien preguntó: su nombre y que fue Claude quien miró */
export const nombreEnElRastro = (nombre: string): string => `${nombre} (vía el conector de Claude)`.slice(0, 200)

const SIN_REPETIR_MS = 30 * 60_000
const RECIENTES = new Map<string, number>()

/** Solo para las pruebas: olvida lo que se miró hace poco, para que cada caso empiece sin rastro previo */
export function olvidarAccesosRecientes(): void {
  RECIENTES.clear()
}

export type AccionDeRastro = 'lista' | 'hilo' | 'busqueda'

/**
 * Apunta que un administrador ha mirado, por el conector, buzones que no son suyos. Mirar lo mismo varias veces seguidas deja UNA fila (como en Correo).
 * SI NO SE PUEDE APUNTAR, LANZA: quien llama no enseña el correo sin dejar rastro.
 */
export async function dejarRastro(
  s: Servicio,
  e: { usuarioId: string; nombre: string; buzones: ReadonlyArray<{ id: string; user_id: string }>; accion: AccionDeRastro; hilo?: { id: string; asunto: string } | null; ahora?: number }
): Promise<void> {
  const ahora = e.ahora ?? Date.now()
  const ajenos = e.buzones.filter((b) => b.user_id !== e.usuarioId)
  const filas = []
  for (const b of ajenos) {
    const clave = `${e.usuarioId}|${b.id}|${e.accion}|${e.hilo?.id ?? ''}`
    const ultima = RECIENTES.get(clave)
    if (ultima !== undefined && ahora - ultima < SIN_REPETIR_MS) continue
    filas.push({ clave, fila: { buzon_id: b.id, usuario_id: e.usuarioId, usuario_nombre: nombreEnElRastro(e.nombre), accion: e.accion, hilo_id: e.hilo?.id ?? null, asunto: e.hilo ? e.hilo.asunto.slice(0, 300) : null } })
  }
  if (filas.length === 0) return
  const { error } = await s.from('correo_accesos').insert(filas.map((f) => f.fila))
  if (error) {
    // Sin la migración 236 no hay correo que enseñar; con ella, un fallo al apuntar cierra la herramienta (la excepción no viaja: lleva nombres de tablas)
    if (isMissingSchema(error)) fallo(error, 'correo_accesos (migración 236)')
    throw new Error('No se ha podido dejar constancia del acceso al buzón.', { cause: error })
  }
  for (const f of filas) RECIENTES.set(f.clave, ahora)
  if (RECIENTES.size > 5000) for (const [k, t] of RECIENTES) if (ahora - t >= SIN_REPETIR_MS) RECIENTES.delete(k)
}

/** El nombre de quien pregunta, para el rastro */
async function nombreDeQuienPregunta(s: Servicio, ctx: ContextoMcp): Promise<string> {
  const p = (await personasPorId(s, [ctx.usuario.id])).get(ctx.usuario.id)
  return p?.nombre ?? ctx.usuario.email ?? 'Un administrador'
}

/* ------------------------------------------------------------------ */
/* Pequeñas ayudas                                                     */
/* ------------------------------------------------------------------ */

interface DestinatarioLeido {
  nombre?: string | null
  direccion?: string | null
}

/** «Ana López <ana@…>», o solo la dirección */
export function personaDeCorreo(d: DestinatarioLeido | null | undefined): string {
  if (!d) return ''
  const dir = (d.direccion ?? '').trim()
  const nombre = (d.nombre ?? '').trim()
  return nombre && dir ? `${nombre} <${dir}>` : dir || nombre
}

export const listaDeCorreos = (v: unknown): string[] => (Array.isArray(v) ? (v as DestinatarioLeido[]).map(personaDeCorreo).filter(Boolean) : [])

interface AdjuntoLeido {
  nombre?: string | null
  filename?: string | null
  tipo?: string | null
  tamano?: number | null
}

const adjuntosDe = (v: unknown): Array<{ nombre: string | null; tipo: string | null; kb: number | null }> =>
  Array.isArray(v)
    ? (v as AdjuntoLeido[]).map((a) => ({ nombre: a.nombre ?? a.filename ?? null, tipo: a.tipo ?? null, kb: typeof a.tamano === 'number' ? Math.max(1, Math.round(a.tamano / 1024)) : null }))
    : []

const aFecha = (iso: string | null | undefined): string | null => fechaHora(iso)

/* ------------------------------------------------------------------ */
/* correos_enviados                                                    */
/* ------------------------------------------------------------------ */

export interface MensajeEnviadoLeido {
  id: string
  buzon_id: string
  hilo_id: string
  message_id: string | null
  de_nombre: string | null
  de_direccion: string
  para: unknown
  cc: unknown
  asunto: string
  fecha: string
  vista_previa: string
  adjuntos: unknown
}

const CAMPOS_ENVIADO = 'id, buzon_id, hilo_id, message_id, de_nombre, de_direccion, para, cc, asunto, fecha, vista_previa, adjuntos'
const ORIGENES = ['todos', 'automaticos', 'a_mano'] as const

export interface EntradaDeEnviados {
  mensajes: readonly MensajeEnviadoLeido[]
  /** message_id de los correos que salieron de una secuencia automática */
  automaticos: ReadonlySet<string>
  origen: (typeof ORIGENES)[number]
}

export function esAutomatico(m: Pick<MensajeEnviadoLeido, 'message_id'>, automaticos: ReadonlySet<string>): boolean {
  return !!m.message_id && automaticos.has(m.message_id)
}

/** Los correos que cumplen el origen pedido, del más reciente al más antiguo */
export function filtrarEnviados(e: EntradaDeEnviados): MensajeEnviadoLeido[] {
  return e.mensajes
    .filter((m) => (e.origen === 'todos' ? true : e.origen === 'automaticos' ? esAutomatico(m, e.automaticos) : !esAutomatico(m, e.automaticos)))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.id < b.id ? -1 : 1))
}

export function resumenDeEnviados(lista: readonly MensajeEnviadoLeido[], e: { buzones: ReadonlyMap<string, BuzonDelEquipo>; automaticos: ReadonlySet<string> }): Record<string, unknown> {
  const porBuzon = new Map<string, { enviados: number; automaticos: number }>()
  const porDia = new Map<string, number>()
  for (const m of lista) {
    const b = porBuzon.get(m.buzon_id) ?? { enviados: 0, automaticos: 0 }
    b.enviados += 1
    if (esAutomatico(m, e.automaticos)) b.automaticos += 1
    porBuzon.set(m.buzon_id, b)
    const dia = diaMadrid(m.fecha)
    porDia.set(dia, (porDia.get(dia) ?? 0) + 1)
  }
  return {
    total: lista.length,
    por_buzon: [...porBuzon.entries()]
      .map(([id, v]) => ({ buzon: etiquetaDeBuzon(e.buzones.get(id)), enviados: v.enviados, seguimientos_automaticos: v.automaticos, a_mano: v.enviados - v.automaticos }))
      .sort((a, b) => b.enviados - a.enviados),
    por_dia: [...porDia.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([dia, n]) => ({ dia, enviados: n })),
  }
}

export const etiquetaDeBuzon = (b: BuzonDelEquipo | undefined): string => (b ? `${b.propietario.nombre} (${b.direccion})` : 'Un buzón que ya no está')

export function tarjetaDeEnviado(m: MensajeEnviadoLeido, e: { buzones: ReadonlyMap<string, BuzonDelEquipo>; automaticos: ReadonlySet<string>; hilosConRespuesta: ReadonlySet<string> }): Record<string, unknown> {
  const adjuntos = adjuntosDe(m.adjuntos)
  return {
    mensaje_id: m.id,
    hilo_id: m.hilo_id,
    cuando: aFecha(m.fecha),
    desde: etiquetaDeBuzon(e.buzones.get(m.buzon_id)),
    para: listaDeCorreos(m.para),
    cc: listaDeCorreos(m.cc),
    asunto: recortar(m.asunto, 160) ?? '(sin asunto)',
    tipo: esAutomatico(m, e.automaticos) ? 'seguimiento automático' : 'a mano',
    el_hilo_tiene_respuesta: e.hilosConRespuesta.has(m.hilo_id),
    adelanto: recortar(m.vista_previa, 220),
    adjuntos: adjuntos.length > 0 ? adjuntos : null,
  }
}

/** Las filas de pasos de secuencia enviados en la ventana: de ahí se sabe qué correos fueron automáticos */
async function idsDeEnviosAutomaticos(s: Servicio, desdeIso: string, hastaIso: string): Promise<Set<string>> {
  const salida = new Set<string>()
  try {
    const filas = await fetchAll<{ message_id: string | null }>((de, a) =>
      s.from('correo_secuencia_pasos').select('message_id').eq('estado', 'enviado').gte('enviado_at', desdeIso).lt('enviado_at', hastaIso).order('id', { ascending: true }).range(de, a)
    )
    for (const f of filas) if (f.message_id) salida.add(f.message_id)
  } catch (error) {
    // Sin la migración 245 no hay seguimientos automáticos: todo lo enviado fue a mano
    if (isMissingSchema(error)) return salida
    throw error
  }
  return salida
}

async function hilosConRespuestas(s: Servicio, hiloIds: readonly string[]): Promise<Set<string>> {
  const salida = new Set<string>()
  for (const trozo of trocear([...new Set(hiloIds)], 100)) {
    const { data } = comprobar(await s.from('correo_hilos').select('id, entrantes').in('id', trozo), 'correo_hilos (migración 236)')
    for (const h of (data ?? []) as Array<{ id: string; entrantes: number | null }>) if ((h.entrantes ?? 0) > 0) salida.add(h.id)
  }
  return salida
}

export const correosEnviados: Herramienta<ContextoMcp> = {
  nombre: 'correos_enviados',
  titulo: 'Correo: lo que ha enviado el equipo',
  descripcion:
    'Los correos que han salido de los buzones del equipo (la aplicación Correo): cuándo, desde qué buzón, a quién, con qué asunto y un adelanto del texto, si fue un seguimiento automático o lo escribió la persona a mano, y ' +
    'si el hilo ya tiene respuesta. Con totales por buzón y por día de todo lo que cumple el filtro. Filtra por persona o buzón, por días, por texto (asunto o destinatario) y por origen. Para leer un correo o ' +
    'la conversación entera usa correo_hilo con el `hilo_id`. Los de seguimiento que todavía no han salido están en correo_cola. Cada vez que se mira el buzón de otra persona queda anotado en el rastro de Correo.',
  esquema: {
    type: 'object',
    properties: {
      buzon: { type: 'string', description: 'La persona o el buzón: la dirección, el nombre de su dueño (o parte) o su id. Por defecto, todos.' },
      desde: { type: 'string', description: 'Primer día (AAAA-MM-DD, «hoy» o «ayer»). Sin fechas, los últimos 3 días.' },
      hasta: { type: 'string', description: 'Último día, incluido. Máximo 31 días de rango.' },
      texto: { type: 'string', description: 'Parte del asunto o de la dirección del destinatario.' },
      origen: { type: 'string', enum: [...ORIGENES], description: 'automaticos = seguimientos que envió el motor · a_mano = los escribió la persona · todos (por defecto).' },
      limite: { type: 'integer', description: 'Correos por página. Por defecto 25, hasta 100.' },
      pagina: { type: 'integer', description: 'Empieza en 0.' },
    },
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const s = servicioDe(ctx)
    const hoy = hoyMadrid()
    const rango = rangoOUltimosDias(args, { porDefecto: 3, maxDias: 31, hoy })
    const { desde, hasta } = instantesDe(rango)
    const p = paginaArg(args, { limite: 25, max: 100 })
    const origen = opcion<(typeof ORIGENES)[number]>(args, 'origen', ORIGENES, 'todos')
    const busqueda = texto(args, 'texto', { max: 80 })
    const consulta = texto(args, 'buzon', { max: 120 })

    const todos = await buzonesDelEquipo(s)
    const elegido = consulta ? elegirBuzon(todos, consulta) : null
    const buzones = new Map((elegido ? [elegido] : todos).map((b) => [b.id, b]))
    if (buzones.size === 0) return { texto: aTexto({ aviso: 'No hay ningún buzón conectado.' }) }

    // El rastro va ANTES de leer: sin él no se enseña nada
    await dejarRastro(s, { usuarioId: ctx.usuario.id, nombre: await nombreDeQuienPregunta(s, ctx), buzones: [...buzones.values()], accion: busqueda ? 'busqueda' : 'lista' })

    const ids = [...buzones.keys()]
    const mensajes = await fetchAll<MensajeEnviadoLeido>((de, a) => {
      let q = s.from('correo_mensajes').select(CAMPOS_ENVIADO).eq('direccion', 'saliente').gte('fecha', desde).lt('fecha', hasta)
      q = ids.length === 1 ? q.eq('buzon_id', ids[0]) : q.in('buzon_id', ids)
      if (busqueda) {
        const pat = patronDeBusqueda(busqueda)
        q = q.or(`asunto.ilike.${pat},destinatarios.ilike.${pat}`)
      }
      return q.order('fecha', { ascending: false }).order('id', { ascending: true }).range(de, a)
    }).catch((e) => fallo(e, 'correo_mensajes (migración 236)'))

    const automaticos = await idsDeEnviosAutomaticos(s, new Date(Date.parse(desde) - 3_600_000).toISOString(), new Date(Date.parse(hasta) + 3_600_000).toISOString())
    const lista = filtrarEnviados({ mensajes, automaticos, origen })
    const pagina = lista.slice(p.desde, p.hasta + 1)
    const respondidos = await hilosConRespuestas(s, pagina.map((m) => m.hilo_id))

    return {
      texto: aTexto(
        ajustarAlTamano(
        {
          periodo: { desde: rango.desde, hasta: rango.hasta },
          filtro: { buzon: elegido ? etiquetaDeBuzon(elegido) : 'todos', texto: busqueda ?? null, origen },
          resumen: resumenDeEnviados(lista, { buzones, automaticos }),
          ...datosDePagina(p, lista.length, pagina.length),
          correos: pagina.map((m) => tarjetaDeEnviado(m, { buzones, automaticos, hilosConRespuesta: respondidos })),
        },
        'correos',
        27_000
        ),
        30_000
      ),
    }
  },
}

/* ------------------------------------------------------------------ */
/* correo_hilos: las conversaciones                                    */
/* ------------------------------------------------------------------ */

export interface HiloLeido {
  id: string
  buzon_id: string
  asunto: string
  contraparte: string
  contraparte_direccion: string
  mensajes: number
  entrantes: number
  salientes: number
  no_leidos: number
  tiene_adjuntos: boolean
  vista_previa: string
  primer_mensaje_at: string
  ultimo_mensaje_at: string
  ultimo_es_entrante: boolean
  automatico: boolean
}

const CAMPOS_HILO = 'id, buzon_id, asunto, contraparte, contraparte_direccion, mensajes, entrantes, salientes, no_leidos, tiene_adjuntos, vista_previa, primer_mensaje_at, ultimo_mensaje_at, ultimo_es_entrante, automatico'

export function tarjetaDeHilo(h: HiloLeido, buzones: ReadonlyMap<string, BuzonDelEquipo>): Record<string, unknown> {
  return {
    hilo_id: h.id,
    buzon: etiquetaDeBuzon(buzones.get(h.buzon_id)),
    asunto: recortar(h.asunto, 160) ?? '(sin asunto)',
    con: h.contraparte && h.contraparte_direccion ? `${h.contraparte} <${h.contraparte_direccion}>` : h.contraparte_direccion || h.contraparte || null,
    mensajes: h.mensajes,
    enviados: h.salientes,
    recibidos: h.entrantes,
    sin_leer: h.no_leidos,
    ultimo_mensaje: aFecha(h.ultimo_mensaje_at),
    el_ultimo_es_del_otro: h.ultimo_es_entrante,
    automatico: h.automatico,
    con_adjuntos: h.tiene_adjuntos,
    adelanto: recortar(h.vista_previa, 220),
  }
}

const ESTADOS_DE_HILO = ['todos', 'esperando_respuesta_nuestra', 'con_respuesta', 'sin_respuesta', 'sin_leer'] as const

export const correoHilos: Herramienta<ContextoMcp> = {
  nombre: 'correo_hilos',
  titulo: 'Correo: las conversaciones de un buzón',
  descripcion:
    'Las conversaciones (hilos) de los buzones del equipo, con quién hablan, cuántos mensajes llevan, cuándo fue el último y de quién, y un adelanto. Sirve para ver qué han contestado los clientes y qué está esperando ' +
    'respuesta nuestra: `esperando_respuesta_nuestra` son los hilos cuyo último mensaje es del otro y todavía no hemos contestado; `con_respuesta` los que ya tienen algún mensaje recibido; `sin_respuesta` los ' +
    'que enviamos y nadie ha contestado; `sin_leer` los que tienen mensajes sin abrir. Se ordenan por el último mensaje. Para leer una conversación entera usa correo_hilo. Cada vez que se mira el buzón de otra persona queda anotado en el rastro de Correo.',
  esquema: {
    type: 'object',
    properties: {
      buzon: { type: 'string', description: 'La persona o el buzón: la dirección, el nombre de su dueño (o parte) o su id. Por defecto, todos.' },
      estado: { type: 'string', enum: [...ESTADOS_DE_HILO], description: 'Qué hilos: todos (por defecto), esperando_respuesta_nuestra, con_respuesta, sin_respuesta, sin_leer.' },
      desde: { type: 'string', description: 'Solo hilos cuyo último mensaje es de este día en adelante (AAAA-MM-DD, «hoy» o «ayer»). Sin fechas, los últimos 14 días.' },
      hasta: { type: 'string', description: 'Hasta este día, incluido. Máximo 92 días de rango.' },
      texto: { type: 'string', description: 'Parte del asunto, del nombre o de la dirección de la otra persona, o del adelanto.' },
      limite: { type: 'integer', description: 'Hilos por página. Por defecto 25, hasta 60.' },
      pagina: { type: 'integer', description: 'Empieza en 0.' },
    },
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const s = servicioDe(ctx)
    const hoy = hoyMadrid()
    const rango = rangoOUltimosDias(args, { porDefecto: 14, maxDias: 92, hoy })
    const { desde, hasta } = instantesDe(rango)
    const p = paginaArg(args, { limite: 25, max: 60 })
    const estado = opcion<(typeof ESTADOS_DE_HILO)[number]>(args, 'estado', ESTADOS_DE_HILO, 'todos')
    const busqueda = texto(args, 'texto', { max: 80 })
    const consulta = texto(args, 'buzon', { max: 120 })

    const todos = await buzonesDelEquipo(s)
    const elegido = consulta ? elegirBuzon(todos, consulta) : null
    const buzones = new Map((elegido ? [elegido] : todos).map((b) => [b.id, b]))
    if (buzones.size === 0) return { texto: aTexto({ aviso: 'No hay ningún buzón conectado.' }) }
    await dejarRastro(s, { usuarioId: ctx.usuario.id, nombre: await nombreDeQuienPregunta(s, ctx), buzones: [...buzones.values()], accion: busqueda ? 'busqueda' : 'lista' })

    const ids = [...buzones.keys()]
    let q = s.from('correo_hilos').select(CAMPOS_HILO, { count: 'exact' }).gte('ultimo_mensaje_at', desde).lt('ultimo_mensaje_at', hasta)
    q = ids.length === 1 ? q.eq('buzon_id', ids[0]) : q.in('buzon_id', ids)
    if (estado === 'esperando_respuesta_nuestra') q = q.eq('ultimo_es_entrante', true)
    else if (estado === 'con_respuesta') q = q.gt('entrantes', 0)
    else if (estado === 'sin_respuesta') q = q.eq('entrantes', 0)
    else if (estado === 'sin_leer') q = q.gt('no_leidos', 0)
    if (busqueda) {
      const pat = patronDeBusqueda(busqueda)
      q = q.or(`asunto.ilike.${pat},contraparte.ilike.${pat},contraparte_direccion.ilike.${pat},vista_previa.ilike.${pat}`)
    }
    const { data, count } = comprobar(await q.order('ultimo_mensaje_at', { ascending: false }).order('id', { ascending: true }).range(p.desde, p.hasta), 'correo_hilos (migración 236)')
    const hilos = (data ?? []) as HiloLeido[]
    return {
      texto: aTexto(
        ajustarAlTamano(
        {
          periodo: { desde: rango.desde, hasta: rango.hasta },
          filtro: { buzon: elegido ? etiquetaDeBuzon(elegido) : 'todos', estado, texto: busqueda ?? null },
          ...datosDePagina(p, count ?? hilos.length, hilos.length),
          hilos: hilos.map((h) => tarjetaDeHilo(h, buzones)),
        },
        'hilos',
        27_000
        ),
        30_000
      ),
    }
  },
}

/* ------------------------------------------------------------------ */
/* correo_hilo: una conversación entera                                */
/* ------------------------------------------------------------------ */

export interface MensajeLeido {
  id: string
  buzon_id: string
  direccion: 'entrante' | 'saliente'
  de_nombre: string | null
  de_direccion: string
  para: unknown
  cc: unknown
  asunto: string
  fecha: string
  texto: string
  automatico: boolean
  adjuntos: unknown
}

const CAMPOS_MENSAJE = 'id, buzon_id, direccion, de_nombre, de_direccion, para, cc, asunto, fecha, texto, automatico, adjuntos'

/** Hasta cuántos caracteres de cada correo se devuelven por defecto y como máximo */
export const CARACTERES_POR_CORREO = 2500
export const MAX_CARACTERES_POR_CORREO = 8000

export function tarjetaDeMensaje(m: MensajeLeido, max: number): Record<string, unknown> {
  const cuerpo = recortarLargo(m.texto, max)
  const adjuntos = adjuntosDe(m.adjuntos)
  return {
    mensaje_id: m.id,
    cuando: aFecha(m.fecha),
    sentido: m.direccion === 'saliente' ? 'enviado' : 'recibido',
    de: personaDeCorreo({ nombre: m.de_nombre, direccion: m.de_direccion }),
    para: listaDeCorreos(m.para),
    cc: listaDeCorreos(m.cc),
    asunto: m.asunto,
    automatico: m.automatico,
    texto: cuerpo.texto ?? '(sin texto)',
    texto_recortado: cuerpo.recortado ? `se enseñan ${max} de ${cuerpo.caracteres} caracteres` : null,
    adjuntos: adjuntos.length > 0 ? adjuntos : null,
  }
}

export const correoHilo: Herramienta<ContextoMcp> = {
  nombre: 'correo_hilo',
  titulo: 'Correo: leer una conversación',
  descripcion:
    'Lee una conversación de correo entera: todos los mensajes en orden (quién escribió, a quién, cuándo, asunto y texto, sin las firmas HTML ni los adjuntos). Se pide con el `hilo_id` (sale en correos_enviados y ' +
    'correo_hilos) o con el `mensaje_id` de uno de sus mensajes. Los textos largos se recortan y se dice cuánto. Es el correo real de personas y clientes: léelo solo si hace falta y no copies lo que no sea necesario. ' +
    'Si el buzón no es del administrador que pregunta, queda anotado en el rastro de Correo.',
  esquema: {
    type: 'object',
    properties: {
      hilo_id: { type: 'string', description: 'El id de la conversación.' },
      mensaje_id: { type: 'string', description: 'El id de un mensaje; se devuelve su conversación. Sirve si no tienes el hilo_id.' },
      max_mensajes: { type: 'integer', description: 'Cuántos mensajes, los más recientes. Por defecto 12, hasta 40.' },
      max_caracteres: { type: 'integer', description: `Caracteres de cada mensaje. Por defecto ${CARACTERES_POR_CORREO}, hasta ${MAX_CARACTERES_POR_CORREO}.` },
    },
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const s = servicioDe(ctx)
    const hiloArg = texto(args, 'hilo_id', { max: 60 })
    const mensajeArg = texto(args, 'mensaje_id', { max: 60 })
    if (!hiloArg && !mensajeArg) throw new ErrorDeHerramienta('Falta `hilo_id` o `mensaje_id`. Los dan correos_enviados y correo_hilos.')
    const maxMensajes = entero(args, 'max_mensajes', { min: 1, max: 40, defecto: 12 })
    const maxCaracteres = entero(args, 'max_caracteres', { min: 300, max: MAX_CARACTERES_POR_CORREO, defecto: CARACTERES_POR_CORREO })
    if ((hiloArg && !UUID.test(hiloArg)) || (mensajeArg && !UUID.test(mensajeArg))) throw new ErrorDeHerramienta('El id no es válido: tiene que ser el que dan correos_enviados o correo_hilos, con el formato 00000000-0000-0000-0000-000000000000.')

    let hiloId = hiloArg?.toLowerCase() ?? null
    if (!hiloId && mensajeArg) {
      const { data } = comprobar(await s.from('correo_mensajes').select('hilo_id').eq('id', mensajeArg.toLowerCase()).maybeSingle(), 'correo_mensajes (migración 236)')
      hiloId = (data as { hilo_id: string } | null)?.hilo_id ?? null
      if (!hiloId) throw new ErrorDeHerramienta('No existe ningún mensaje con ese id.')
    }
    const { data: hiloFila } = comprobar(await s.from('correo_hilos').select('id, buzon_id, asunto, mensajes').eq('id', hiloId).maybeSingle(), 'correo_hilos (migración 236)')
    const hilo = hiloFila as { id: string; buzon_id: string; asunto: string; mensajes: number } | null
    if (!hilo) throw new ErrorDeHerramienta('No existe ninguna conversación con ese id.')

    const buzon = (await buzonesDelEquipo(s)).find((b) => b.id === hilo.buzon_id)
    if (!buzon) throw new ErrorDeHerramienta('El buzón de esa conversación ya no está conectado.')
    // El rastro va ANTES de leer el texto: sin él no se enseña nada
    await dejarRastro(s, { usuarioId: ctx.usuario.id, nombre: await nombreDeQuienPregunta(s, ctx), buzones: [buzon], accion: 'hilo', hilo: { id: hilo.id, asunto: hilo.asunto } })

    const { data } = comprobar(await s.from('correo_mensajes').select(CAMPOS_MENSAJE).eq('hilo_id', hilo.id).order('fecha', { ascending: true }).order('id', { ascending: true }).limit(500), 'correo_mensajes (migración 236)')
    const todos = (data ?? []) as MensajeLeido[]
    const mostrados = todos.slice(-maxMensajes)
    return {
      texto: aTexto(
        ajustarAlTamano(
        {
          hilo_id: hilo.id,
          buzon: etiquetaDeBuzon(buzon),
          asunto: hilo.asunto,
          mensajes_en_total: todos.length,
          mensajes_mostrados: mostrados.length,
          aviso: todos.length > mostrados.length ? `Hay ${todos.length - mostrados.length} mensajes anteriores que no se enseñan: pide más con max_mensajes.` : null,
          mensajes: mostrados.map((m) => tarjetaDeMensaje(m, maxCaracteres)),
        },
        'mensajes',
        30_000
        ),
        32_000
      ),
    }
  },
}

export const HERRAMIENTAS_DE_CORREOS: readonly Herramienta<ContextoMcp>[] = [correosEnviados, correoHilos, correoHilo]
