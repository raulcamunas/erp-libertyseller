import { INFO_RED, componer, estadoDeRed, redesEsperadas, type Red } from '@/lib/contenido/redes'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { hoyMadrid, indiceDeSemana, sumarDias } from '@/lib/rendimiento/dia'
import { ETIQUETA_ESTADO, ETIQUETA_TIPO, NOMBRE_DIA, pesoLegible, type EstadoEncargo, type TipoPieza } from '@/lib/types/contenido'
import { aTexto, entero, opcion, texto } from '../argumentos'
import { DIAS_MAX_EN_LISTAS, ajustarAlTamano, comprobar, datosDePagina, diaArg, diasEntre, elegirPersona, fallo, fechaHora, fetchAll, normalizar, paginaArg, personasPorId, recortar, servicioDe, trocear, type Persona, type Servicio } from '../comercial/comun'
import type { ContextoMcp } from '../contexto'
import { ErrorDeHerramienta, type Herramienta } from '../protocolo'

/**
 * EL CALENDARIO DE CONTENIDO PARA CLAUDE: QUÉ SE PUBLICA EN LAS REDES, QUIÉN LO PUBLICA, CON QUÉ TEXTO Y DÓNDE SE DESCARGA EL VÍDEO.
 * SOLO SERVIDOR; lo puro se prueba en herramientas.prueba.ts con una base en memoria. SOLO LECTURA, como todo el conector: no marca nada como publicado ni toca el calendario.
 *
 * Es la pantalla «Calendario de contenido» del ERP (`/dashboard/contenido`) contada para un chat de Claude que tiene además el conector de Metricool: de aquí sale lo que hay que
 * programar (la pieza, el texto DE CADA RED listo para pegar, el día) y el enlace del fichero; Metricool lo programa o lo publica.
 *
 *   · `contenido_piezas` es el material (un vídeo MP4 o un carrusel: un ZIP con sus láminas, y cada lámina también suelta como imagen en `vistas`) y existe una vez aunque lo publiquen varias personas.
 *   · `contenido_calendario` son los ENCARGOS: esta pieza, esta persona, este día, con su estado (programado · publicado · saltado).
 *   · `contenido_textos` guarda el texto de Instagram, TikTok y Facebook; el de LinkedIn sigue en `contenido_piezas.texto_post` y lleva sus hashtags DENTRO.
 *   · Los ficheros están en el bucket PÚBLICO `contenido` de Supabase Storage: su enlace es estable y lo puede leer cualquiera que lo tenga (Metricool incluido), sin caducar.
 */

/* ------------------------------------------------------------------ */
/* Lo leído de la base                                                 */
/* ------------------------------------------------------------------ */

export interface PiezaLeida {
  id: string
  tipo: TipoPieza
  titulo: string
  slug: string
  texto_post: string | null
  angulo: string | null
  origen: string | null
  fichero_path: string | null
  fichero_nombre: string | null
  fichero_bytes: number | string | null
  fichero_mime: string | null
  /** Las láminas de un carrusel o el fotograma de portada de un vídeo (migración 218) */
  vistas?: string[] | null
  creado_at: string
}

export interface EncargoLeido {
  id: string
  fecha: string
  pieza_id: string
  responsable_id: string
  estado: EstadoEncargo
  publicado_at: string | null
  nota: string | null
  creado_at: string
}

export interface TextoLeido {
  pieza_id: string
  red: Red
  texto: string | null
  hashtags: string[] | null
  comentario_fijado: string | null
  actualizado_at: string | null
}

const ESTADOS = ['programado', 'publicado', 'saltado'] as const
const TIPOS = ['video', 'carrusel'] as const

/** Un argumento opcional que, si viene, es uno de `validas`. Sin él, '' (y el mensaje de error que lee el modelo no lista un «vacío» entre las opciones) */
function opcionOVacia<T extends string>(args: Record<string, unknown>, nombre: string, validas: readonly T[]): T | '' {
  const v = args[nombre]
  if (v === undefined || v === null || v === '') return ''
  return opcion<T>(args, nombre, validas, validas[0])
}

const CAMPOS_DE_ENCARGO = 'id, fecha, pieza_id, responsable_id, estado, publicado_at, nota, creado_at'
const CAMPOS_DE_TEXTO = 'pieza_id, red, texto, hashtags, comentario_fijado, actualizado_at'
/** Cuántos días mira `contenido_calendario` si no se le dice más: esta semana y la siguiente */
const DIAS_POR_DEFECTO = 14

/* ------------------------------------------------------------------ */
/* Los enlaces de los ficheros                                         */
/* ------------------------------------------------------------------ */

/**
 * El enlace PÚBLICO de un fichero del bucket `contenido` (el mismo que usa la pantalla del ERP). Con `descargarComo`, el navegador lo baja con ese nombre en vez
 * de abrirlo. `null` si la pieza no tiene fichero o si no está configurada la URL de Supabase.
 */
export function urlDeFichero(ruta: string | null | undefined, descargarComo?: string | null): string | null {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
  if (!ruta || !base) return null
  const partes = ruta
    .split('/')
    .filter((p) => p !== '')
    .map(encodeURIComponent)
    .join('/')
  return `${base}/storage/v1/object/public/contenido/${partes}${descargarComo ? `?download=${encodeURIComponent(descargarComo)}` : ''}`
}

const bytesDe = (p: Pick<PiezaLeida, 'fichero_bytes'>): number | null => {
  const n = Number(p.fichero_bytes)
  return p.fichero_bytes === null || p.fichero_bytes === undefined || !Number.isFinite(n) || n <= 0 ? null : n
}

/** El fichero de una pieza: nombre, tipo, peso y los dos enlaces (verlo y descargarlo). `null` si no se ha subido */
export function ficheroDe(p: PiezaLeida): Record<string, unknown> | null {
  if (!p.fichero_path) return null
  const bytes = bytesDe(p)
  return {
    nombre: p.fichero_nombre ?? p.fichero_path.split('/').pop() ?? null,
    tipo_mime: p.fichero_mime,
    peso: bytes === null ? null : pesoLegible(bytes),
    url: urlDeFichero(p.fichero_path),
    url_de_descarga: urlDeFichero(p.fichero_path, p.fichero_nombre ?? p.fichero_path.split('/').pop()),
  }
}

/* ------------------------------------------------------------------ */
/* Los días                                                            */
/* ------------------------------------------------------------------ */

/** El lunes de la semana de un día (el lunes es el primero, como en el calendario del ERP) */
export const lunesDeLaSemana = (dia: string): string => sumarDias(dia, -indiceDeSemana(dia))

export const nombreDelDia = (dia: string): string => NOMBRE_DIA[indiceDeSemana(dia)]

const hoyDe = (ctx: ContextoMcp): string => hoyMadrid(ctx.ahora === undefined ? undefined : new Date(ctx.ahora))

/**
 * Los días que mira `contenido_calendario`. Sin ninguno: desde el lunes de esta semana, 14 días (esta semana y la siguiente). Solo `desde`: 14 días desde él.
 * Solo `hasta`: los 14 días hasta él. Los dos: tal cual. El rango no pasa de DIAS_MAX_EN_LISTAS.
 */
export function rangoDelCalendario(desde: string | undefined, hasta: string | undefined, hoy: string): { desde: string; hasta: string } {
  const primero = desde ?? (hasta === undefined ? lunesDeLaSemana(hoy) : sumarDias(hasta, -(DIAS_POR_DEFECTO - 1)))
  const ultimo = hasta ?? sumarDias(primero, DIAS_POR_DEFECTO - 1)
  if (ultimo < primero) throw new ErrorDeHerramienta(`«hasta» (${ultimo}) no puede ser anterior a «desde» (${primero}).`)
  const dias = diasEntre(primero, ultimo) + 1
  if (dias > DIAS_MAX_EN_LISTAS) throw new ErrorDeHerramienta(`El rango es de ${dias} días y el máximo es ${DIAS_MAX_EN_LISTAS}. Acótalo con «desde» y «hasta», o pide por partes.`)
  return { desde: primero, hasta: ultimo }
}

/* ------------------------------------------------------------------ */
/* Los textos de cada red                                              */
/* ------------------------------------------------------------------ */

export interface TextoDeUnaRed {
  red: Red
  nombre: string
  /** Hay texto escrito para esta red */
  listo: boolean
  caracteres: number
  limite: number
  nivel: 'ok' | 'cerca' | 'pasa'
  /** Cuántos hashtags lleva lo que se publica: los de la lista y los escritos dentro del propio texto */
  hashtags_en_total: number
  /** LO QUE SE PEGA EN LA RED, tal cual: el texto y, debajo, los hashtags. Es lo que mide el límite. `null` si todavía no hay texto */
  texto_para_publicar: string | null
  /** Los hashtags que el ERP guarda aparte del texto (ya vienen dentro de `texto_para_publicar`). Solo salen si los hay: los de LinkedIn van escritos dentro del texto */
  hashtags_aparte?: string[]
  primer_comentario: string | null
  actualizado: string | null
}

/**
 * El texto de cada red en que se publica una pieza (un vídeo, en LinkedIn, Instagram, TikTok y Facebook; un carrusel, solo en LinkedIn), con lo que mide y si se pasa.
 * El de LinkedIn sale de la propia pieza (`texto_post`); los demás, de `contenido_textos`.
 */
export function textosDeLaPieza(pieza: PiezaLeida, filas: readonly TextoLeido[]): TextoDeUnaRed[] {
  const porRed = new Map(filas.filter((f) => f.pieza_id === pieza.id).map((f) => [f.red, f]))
  return redesEsperadas(pieza.tipo).map((red) => {
    const fila = red === 'linkedin' ? null : (porRed.get(red) ?? null)
    const base = red === 'linkedin' ? (pieza.texto_post ?? '') : (fila?.texto ?? '')
    const hashtags = red === 'linkedin' ? [] : (fila?.hashtags ?? [])
    const estado = estadoDeRed(red, { texto: base, hashtags })
    return {
      red,
      nombre: INFO_RED[red].nombre,
      listo: estado.tiene,
      caracteres: estado.caracteres,
      limite: estado.limite,
      nivel: estado.nivel,
      hashtags_en_total: estado.hashtags,
      texto_para_publicar: estado.tiene ? componer(base, hashtags) : null,
      ...(estado.tiene && hashtags.length > 0 ? { hashtags_aparte: [...hashtags] } : {}),
      primer_comentario: red === 'linkedin' ? null : (fila?.comentario_fijado?.trim() || null),
      actualizado: red === 'linkedin' ? null : fechaHora(fila?.actualizado_at),
    }
  })
}

/** Lo que hay que mirar antes de publicar una pieza: textos que faltan, que se pasan o que llevan demasiados hashtags, y un fichero que no está */
export function avisosDeLaPieza(pieza: PiezaLeida, textos: readonly TextoDeUnaRed[]): string[] {
  const avisos: string[] = []
  const faltan = textos.filter((t) => !t.listo).map((t) => t.nombre)
  if (faltan.length > 0) avisos.push(`Falta el texto de ${faltan.join(', ')}.`)
  for (const t of textos) {
    if (!t.listo) continue
    if (t.nivel === 'pasa') avisos.push(`El texto de ${t.nombre} se pasa del límite orientativo (${t.caracteres} de ${t.limite} caracteres).`)
    const max = INFO_RED[t.red].maxHashtags
    if (max !== null && t.hashtags_en_total > max) avisos.push(`${t.nombre} lleva ${t.hashtags_en_total} hashtags y ${INFO_RED[t.red].hashtagsDuros ? 'admite' : 'recomienda'} como mucho ${max}.`)
  }
  if (!pieza.fichero_path) avisos.push('La pieza no tiene fichero subido: no hay nada que descargar ni publicar.')
  return avisos
}

/* ------------------------------------------------------------------ */
/* Lecturas                                                            */
/* ------------------------------------------------------------------ */

async function piezasPorId(s: Servicio, ids: readonly string[]): Promise<Map<string, PiezaLeida>> {
  const salida = new Map<string, PiezaLeida>()
  for (const trozo of trocear([...new Set(ids)], 100)) {
    const { data } = comprobar(await s.from('contenido_piezas').select('*').in('id', trozo), 'contenido_piezas')
    for (const p of (data ?? []) as PiezaLeida[]) salida.set(p.id, p)
  }
  return salida
}

/** Todas las piezas, la más reciente primero. Son decenas o pocos cientos: se leen enteras y se filtran aquí, sin distinguir acentos */
async function todasLasPiezas(s: Servicio): Promise<PiezaLeida[]> {
  return fetchAll<PiezaLeida>((de, a) => s.from('contenido_piezas').select('*').order('creado_at', { ascending: false }).order('id', { ascending: true }).range(de, a)).catch((e) => fallo(e, 'contenido_piezas'))
}

/** Los textos por red de unas piezas. Si la migración 229 no está lanzada, `sinTabla` y solo existe el texto de LinkedIn */
async function textosDe(s: Servicio, piezaIds: readonly string[]): Promise<{ filas: TextoLeido[]; sinTabla: boolean }> {
  const filas: TextoLeido[] = []
  for (const trozo of trocear([...new Set(piezaIds)], 100)) {
    const r = await s.from('contenido_textos').select(CAMPOS_DE_TEXTO).in('pieza_id', trozo)
    if (r.error) {
      if (isMissingSchema(r.error)) return { filas: [], sinTabla: true }
      fallo(r.error, 'contenido_textos')
    }
    filas.push(...((r.data ?? []) as TextoLeido[]))
  }
  return { filas, sinTabla: false }
}

/** Quienes publican: las personas con algún encargo en el calendario (no se adivina por el rol: es lo que de verdad hay) */
async function quienesPublican(s: Servicio): Promise<Persona[]> {
  const filas = await fetchAll<{ responsable_id: string }>((de, a) => s.from('contenido_calendario').select('responsable_id').order('id', { ascending: true }).range(de, a)).catch((e) => fallo(e, 'contenido_calendario'))
  return [...(await personasPorId(s, filas.map((f) => f.responsable_id))).values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

const NOTA_SIN_TEXTOS = 'Falta lanzar la migración 229 en Supabase: los textos de Instagram, TikTok y Facebook no están disponibles (solo el de LinkedIn).'

/* ------------------------------------------------------------------ */
/* Tarjetas                                                            */
/* ------------------------------------------------------------------ */

/** La pieza en pocas líneas: para listas, donde no caben los textos enteros (esos, y sus medidas, los da `contenido_pieza`) */
export function resumenDePieza(p: PiezaLeida, textos: readonly TextoDeUnaRed[]): Record<string, unknown> {
  const faltan = textos.filter((t) => !t.listo).map((t) => t.nombre)
  const sePasan = textos.filter((t) => t.listo && t.nivel === 'pasa').map((t) => t.nombre)
  // Lo que no hay no se escribe (un `null` por campo, por pieza y por página, es contexto que el modelo no necesita), salvo el fichero: «sin fichero» sí es un dato
  return {
    slug: p.slug,
    titulo: p.titulo,
    tipo: ETIQUETA_TIPO[p.tipo] ?? p.tipo,
    ...(p.angulo ? { angulo: p.angulo } : {}),
    se_publica_en: textos.map((t) => t.nombre).join(', '),
    ...(faltan.length > 0 ? { faltan_textos: faltan } : {}),
    ...(sePasan.length > 0 ? { textos_que_se_pasan: sePasan } : {}),
    fichero: p.fichero_path ? { nombre: p.fichero_nombre, peso: bytesDe(p) === null ? null : pesoLegible(bytesDe(p)), url: urlDeFichero(p.fichero_path) } : null,
  }
}

export interface EntornoDeTarjeta {
  hoy: string
  personas: ReadonlyMap<string, Persona>
  piezas: ReadonlyMap<string, PiezaLeida>
  textos: readonly TextoLeido[]
}

/** Un encargo que sigue en «programado» aunque su día ya pasó: o se publicó y nadie lo cerró en el ERP, o se olvidó */
export const esPasadaSinCerrar = (e: Pick<EncargoLeido, 'estado' | 'fecha'>, hoy: string): boolean => e.estado === 'programado' && e.fecha < hoy

/** Una pieza «está en el calendario» si tiene algún día programado o ya publicado; con solo días saltados (o ninguno) es material sin programar */
export const estaEnElCalendario = (encargosDeLaPieza: ReadonlyArray<Pick<EncargoLeido, 'estado'>>): boolean => encargosDeLaPieza.some((e) => e.estado !== 'saltado')

/** Un encargo del calendario con su pieza, su persona y el estado de sus textos */
export function tarjetaDeEncargo(e: EncargoLeido, entorno: EntornoDeTarjeta): Record<string, unknown> {
  const pieza = entorno.piezas.get(e.pieza_id)
  const persona = entorno.personas.get(e.responsable_id)
  const nota = recortar(e.nota, 300)
  const base = {
    fecha: e.fecha,
    dia: nombreDelDia(e.fecha),
    estado: ETIQUETA_ESTADO[e.estado] ?? e.estado,
    ...(esPasadaSinCerrar(e, entorno.hoy) ? { pasada_de_fecha_y_sin_cerrar: true } : {}),
    publica: persona?.nombre ?? 'Alguien que ya no está',
    ...(e.publicado_at ? { publicado_el: fechaHora(e.publicado_at) } : {}),
    ...(nota ? { nota } : {}),
  }
  if (!pieza) return { ...base, pieza: 'una pieza que ya no existe' }
  const textos = textosDeLaPieza(pieza, entorno.textos)
  return { ...base, ...resumenDePieza(pieza, textos) }
}

/* ------------------------------------------------------------------ */
/* contenido_calendario                                                */
/* ------------------------------------------------------------------ */

export const contenidoCalendario: Herramienta<ContextoMcp> = {
  nombre: 'contenido_calendario',
  titulo: 'Calendario de contenido: qué se publica cada día',
  descripcion:
    'El Calendario de contenido del ERP: qué pieza (vídeo o carrusel) se publica cada día, QUIÉN la publica, su estado (programado, publicado o saltado) y, de cada una, en qué redes va, si ya tiene el texto escrito para cada red ' +
    '(y cuáles faltan o se pasan del límite) y el enlace del fichero para descargarlo. Es lo primero que hay que mirar para saber qué programar o publicar. Sin fechas: esta semana y la siguiente (de lunes a domingo). ' +
    'Filtra por persona, por estado y por tipo. Para el texto entero de una pieza, pide `contenido_pieza` con su `slug`. Del día más antiguo al más reciente; las listas llevan `total` y `hay_mas`.',
  esquema: {
    type: 'object',
    properties: {
      desde: { type: 'string', description: 'Primer día (AAAA-MM-DD, «hoy» o «ayer»). Sin fechas se mira desde el lunes de esta semana, 14 días.' },
      hasta: { type: 'string', description: 'Último día, incluido. Si solo das `desde`, son 14 días desde él; si solo das `hasta`, los 14 días hasta él. Máximo 92 días de rango.' },
      responsable: { type: 'string', description: 'Quién publica: nombre (o parte), correo o id.' },
      estado: { type: 'string', enum: [...ESTADOS], description: 'programado · publicado · saltado.' },
      tipo: { type: 'string', enum: [...TIPOS], description: 'video · carrusel.' },
      limite: { type: 'integer', description: 'Publicaciones por página. Por defecto 30, hasta 100.' },
      pagina: { type: 'integer', description: 'Empieza en 0.' },
    },
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const s = servicioDe(ctx)
    const hoy = hoyDe(ctx)
    const quien = texto(args, 'responsable', { max: 120 })
    const estado = opcionOVacia(args, 'estado', ESTADOS)
    const tipo = opcionOVacia(args, 'tipo', TIPOS)
    const p = paginaArg(args, { limite: 30, max: 100 })
    const rango = rangoDelCalendario(diaArg(args, 'desde', { hoy }), diaArg(args, 'hasta', { hoy }), hoy)
    const persona = quien ? elegirPersona(await quienesPublican(s), quien, 'colaborador') : null

    const encargos = await fetchAll<EncargoLeido>((de, a) => {
      let q = s.from('contenido_calendario').select(CAMPOS_DE_ENCARGO).gte('fecha', rango.desde).lte('fecha', rango.hasta)
      if (persona) q = q.eq('responsable_id', persona.id)
      if (estado) q = q.eq('estado', estado)
      return q.order('fecha', { ascending: true }).order('creado_at', { ascending: true }).order('id', { ascending: true }).range(de, a)
    }).catch((e) => fallo(e, 'contenido_calendario'))

    const piezas = await piezasPorId(s, encargos.map((e) => e.pieza_id))
    const delTipo = encargos.filter((e) => !tipo || piezas.get(e.pieza_id)?.tipo === tipo)
    const { filas: textos, sinTabla } = await textosDe(s, delTipo.map((e) => e.pieza_id))
    const personas = await personasPorId(s, delTipo.map((e) => e.responsable_id))
    const entorno: EntornoDeTarjeta = { hoy, personas, piezas, textos }

    const porEstado: Record<string, number> = { programado: 0, publicado: 0, saltado: 0 }
    const porPersona: Record<string, number> = {}
    for (const e of delTipo) {
      porEstado[e.estado] = (porEstado[e.estado] ?? 0) + 1
      const nombre = personas.get(e.responsable_id)?.nombre ?? 'Alguien que ya no está'
      porPersona[nombre] = (porPersona[nombre] ?? 0) + 1
    }

    // Lo que hay que mirar de todo el rango (no solo de la página): fechas pasadas sin cerrar y textos que faltan en lo que aún se tiene que publicar
    const avisos: string[] = []
    const sinCerrar = delTipo.filter((e) => esPasadaSinCerrar(e, hoy))
    if (sinCerrar.length > 0) avisos.push(`${sinCerrar.length} publicación${sinCerrar.length === 1 ? '' : 'es'} ya pasó de fecha y sigue «programado»: o se publicó y no se marcó, o se olvidó (${sinCerrar.slice(0, 5).map((e) => `${e.fecha} ${piezas.get(e.pieza_id)?.titulo ?? '¿?'}`).join('; ')}${sinCerrar.length > 5 ? '…' : ''}).`)
    const porHacer = delTipo.filter((e) => e.estado === 'programado' && e.fecha >= hoy)
    const sinTexto = porHacer.flatMap((e) => {
      const pieza = piezas.get(e.pieza_id)
      if (!pieza) return []
      const faltan = textosDeLaPieza(pieza, textos).filter((t) => !t.listo).map((t) => t.nombre)
      return faltan.length > 0 ? [`${e.fecha} «${pieza.titulo}»: falta el texto de ${faltan.join(', ')}`] : []
    })
    if (sinTexto.length > 0) avisos.push(`Textos por escribir antes de publicar: ${sinTexto.slice(0, 8).join(' · ')}${sinTexto.length > 8 ? '…' : ''}.`)
    if (sinTabla) avisos.push(NOTA_SIN_TEXTOS)

    const pagina = delTipo.slice(p.desde, p.hasta + 1)
    return {
      texto: aTexto(
        ajustarAlTamano(
          {
            periodo: { desde: rango.desde, hasta: rango.hasta, hoy },
            filtro: { responsable: persona?.nombre ?? null, estado: estado || null, tipo: tipo || null },
            por_estado: porEstado,
            por_persona: porPersona,
            avisos,
            ...datosDePagina(p, delTipo.length, pagina.length),
            publicaciones: pagina.map((e) => tarjetaDeEncargo(e, entorno)),
          },
          'publicaciones',
          27_000
        ),
        30_000
      ),
    }
  },
}

/* ------------------------------------------------------------------ */
/* contenido_piezas                                                    */
/* ------------------------------------------------------------------ */

export const contenidoPiezas: Herramienta<ContextoMcp> = {
  nombre: 'contenido_piezas',
  titulo: 'Contenido: la biblioteca de piezas (vídeos y carruseles)',
  descripcion:
    'Todas las piezas de contenido del ERP (cada vídeo y cada carrusel, la más reciente primero): título, tipo, ángulo, en qué redes se publica, si le faltan textos, su fichero con enlace y en qué días está programada y por quién. ' +
    'Sirve para buscar («el vídeo de Black Friday», «lo del stock»), para ver qué piezas no tienen ninguna publicación programada y para encontrar el `slug` que pide `contenido_pieza`. La búsqueda mira el título, el slug, el ángulo y el texto ' +
    'del post, sin distinguir acentos ni mayúsculas.',
  esquema: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Parte del título, slug, ángulo o texto del post.' },
      tipo: { type: 'string', enum: [...TIPOS], description: 'video · carrusel.' },
      programacion: { type: 'string', enum: ['todas', 'sin_programar', 'en_el_calendario'], description: 'sin_programar = piezas que no están en ningún día del calendario (nunca se programaron, o solo se saltaron); en_el_calendario = las que tienen algún día programado o ya publicado. Por defecto todas.' },
      limite: { type: 'integer', description: 'Piezas por página. Por defecto 30, hasta 60.' },
      pagina: { type: 'integer', description: 'Empieza en 0.' },
    },
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const s = servicioDe(ctx)
    const hoy = hoyDe(ctx)
    const busqueda = texto(args, 'texto', { max: 120 })
    const tipo = opcionOVacia(args, 'tipo', TIPOS)
    const programacion = opcion<'todas' | 'sin_programar' | 'en_el_calendario'>(args, 'programacion', ['todas', 'sin_programar', 'en_el_calendario'], 'todas')
    const p = paginaArg(args, { limite: 30, max: 60 })

    const todas = await todasLasPiezas(s)
    const q = busqueda ? normalizar(busqueda) : null
    const filtradas = todas.filter((pz) => (!tipo || pz.tipo === tipo) && (!q || [pz.titulo, pz.slug, pz.angulo ?? '', pz.texto_post ?? ''].some((t) => normalizar(t).includes(q))))

    const encargos = await fetchAll<EncargoLeido>((de, a) => s.from('contenido_calendario').select(CAMPOS_DE_ENCARGO).order('fecha', { ascending: true }).order('id', { ascending: true }).range(de, a)).catch((e) => fallo(e, 'contenido_calendario'))
    const porPieza = new Map<string, EncargoLeido[]>()
    for (const e of encargos) porPieza.set(e.pieza_id, [...(porPieza.get(e.pieza_id) ?? []), e])
    const elegidas = filtradas.filter((pz) => programacion === 'todas' || (programacion === 'en_el_calendario') === estaEnElCalendario(porPieza.get(pz.id) ?? []))

    const pagina = elegidas.slice(p.desde, p.hasta + 1)
    const { filas: textos, sinTabla } = await textosDe(s, pagina.map((pz) => pz.id))
    const personas = await personasPorId(s, pagina.flatMap((pz) => (porPieza.get(pz.id) ?? []).map((e) => e.responsable_id)))
    const avisos = sinTabla ? [NOTA_SIN_TEXTOS] : []
    return {
      texto: aTexto(
        ajustarAlTamano(
          {
            filtro: { texto: busqueda ?? null, tipo: tipo || null, programacion },
            avisos,
            ...datosDePagina(p, elegidas.length, pagina.length),
            piezas: pagina.map((pz) => ({
              ...resumenDePieza(pz, textosDeLaPieza(pz, textos)),
              creada: fechaHora(pz.creado_at),
              programada_para: (porPieza.get(pz.id) ?? []).map((e) => ({ fecha: e.fecha, publica: personas.get(e.responsable_id)?.nombre ?? 'Alguien que ya no está', estado: ETIQUETA_ESTADO[e.estado] ?? e.estado })),
            })),
          },
          'piezas',
          27_000
        ),
        30_000
      ),
    }
  },
}

/* ------------------------------------------------------------------ */
/* contenido_pieza                                                     */
/* ------------------------------------------------------------------ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** La pieza a la que se refiere el texto: su id, su slug o parte de su título/slug. Si no hay ninguna o hay varias, el error dice cuáles para acertar a la segunda */
export function elegirPieza(piezas: readonly PiezaLeida[], consulta: string): PiezaLeida {
  const c = consulta.trim()
  if (UUID.test(c)) {
    const porId = piezas.find((p) => p.id === c.toLowerCase())
    if (porId) return porId
  }
  const q = normalizar(c)
  const porSlug = piezas.filter((p) => normalizar(p.slug) === q)
  if (porSlug.length === 1) return porSlug[0]
  const exactas = piezas.filter((p) => normalizar(p.titulo) === q)
  if (exactas.length === 1) return exactas[0]
  const coinciden = piezas.filter((p) => normalizar(p.slug).includes(q) || normalizar(p.titulo).includes(q))
  if (coinciden.length === 1) return coinciden[0]
  if (coinciden.length > 1) {
    const lista = coinciden.slice(0, 8).map((p) => `«${p.titulo}» (${p.slug})`).join('; ')
    throw new ErrorDeHerramienta(`«${consulta}» encaja con ${coinciden.length} piezas: ${lista}${coinciden.length > 8 ? '…' : ''}. Pide una por su slug.`)
  }
  throw new ErrorDeHerramienta(`No hay ninguna pieza que encaje con «${consulta}». Busca con \`contenido_piezas\` para ver las que hay.`)
}

export const contenidoPieza: Herramienta<ContextoMcp> = {
  nombre: 'contenido_pieza',
  titulo: 'Contenido: una pieza entera, lista para publicar',
  descripcion:
    'Una pieza de contenido con TODO lo necesario para publicarla: título y ángulo, el texto de CADA red (LinkedIn, Instagram, TikTok y Facebook para un vídeo; solo LinkedIn para un carrusel) con `texto_para_publicar` ya compuesto ' +
    '(texto + hashtags, listo para pegar), los hashtags, el primer comentario, los caracteres frente al límite y los avisos; el fichero con su enlace público para verlo y para descargarlo (el vídeo MP4, o el ZIP con todas las láminas de un carrusel), ' +
    'cada lámina del carrusel como imagen suelta y en orden (o la portada del vídeo) y todos los días en que está programada y por quién. Se pide por su `slug`, su id o parte del título.',
  esquema: {
    type: 'object',
    properties: {
      pieza: { type: 'string', description: 'El slug de la pieza (lo da contenido_calendario o contenido_piezas), su id, o parte del título.' },
    },
    required: ['pieza'],
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const s = servicioDe(ctx)
    const hoy = hoyDe(ctx)
    const consulta = texto(args, 'pieza', { requerido: true, max: 160 }) as string
    const pieza = elegirPieza(await todasLasPiezas(s), consulta)
    const [{ filas: textos, sinTabla }, encargosRes] = await Promise.all([textosDe(s, [pieza.id]), s.from('contenido_calendario').select(CAMPOS_DE_ENCARGO).eq('pieza_id', pieza.id).order('fecha', { ascending: true }).order('id', { ascending: true })])
    const { data: encargosData } = comprobar(encargosRes, 'contenido_calendario')
    const encargos = (encargosData ?? []) as EncargoLeido[]
    const personas = await personasPorId(s, encargos.map((e) => e.responsable_id))
    const porRedes = textosDeLaPieza(pieza, textos)
    const avisos = [...avisosDeLaPieza(pieza, porRedes), ...(sinTabla ? [NOTA_SIN_TEXTOS] : [])]
    const vistas = (Array.isArray(pieza.vistas) ? pieza.vistas : []).map((ruta, i) => ({ orden: i + 1, url: urlDeFichero(ruta) }))
    return {
      texto: aTexto(
        {
          slug: pieza.slug,
          titulo: pieza.titulo,
          tipo: ETIQUETA_TIPO[pieza.tipo] ?? pieza.tipo,
          angulo: pieza.angulo,
          origen: pieza.origen,
          creada: fechaHora(pieza.creado_at),
          avisos,
          fichero: ficheroDe(pieza),
          [pieza.tipo === 'carrusel' ? 'laminas' : 'portada']: pieza.tipo === 'carrusel' ? vistas : (vistas[0] ?? null),
          textos_por_red: porRedes,
          programada_para: encargos.map((e) => {
            const nota = recortar(e.nota, 300)
            return {
              fecha: e.fecha,
              dia: nombreDelDia(e.fecha),
              publica: personas.get(e.responsable_id)?.nombre ?? 'Alguien que ya no está',
              estado: ETIQUETA_ESTADO[e.estado] ?? e.estado,
              ...(esPasadaSinCerrar(e, hoy) ? { pasada_de_fecha_y_sin_cerrar: true } : {}),
              ...(nota ? { nota } : {}),
            }
          }),
        },
        30_000
      ),
    }
  },
}

/* ------------------------------------------------------------------ */
/* contenido_pendientes                                                */
/* ------------------------------------------------------------------ */

export const contenidoPendientes: Herramienta<ContextoMcp> = {
  nombre: 'contenido_pendientes',
  titulo: 'Contenido: lo que falta o se ha pasado de fecha',
  descripcion:
    'Lo que hay que atender en el Calendario de contenido: las publicaciones que ya pasaron de fecha y siguen «programado», lo que se publica HOY, lo de los próximos días al que le falta algún texto o el fichero, y las piezas que todavía no ' +
    'están en ningún día del calendario. Pensada para empezar el día («¿qué publicamos hoy y qué nos falta?»). No cambia nada: marcar algo como publicado se hace en el ERP.',
  esquema: {
    type: 'object',
    properties: {
      dias: { type: 'integer', description: 'Cuántos días hacia delante mira (por defecto 14, hasta 60).' },
    },
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const s = servicioDe(ctx)
    const hoy = hoyDe(ctx)
    const dias = entero(args, 'dias', { min: 1, max: 60, defecto: 14 })
    const limite = sumarDias(hoy, dias)

    const todas = await todasLasPiezas(s)
    const encargos = await fetchAll<EncargoLeido>((de, a) => s.from('contenido_calendario').select(CAMPOS_DE_ENCARGO).order('fecha', { ascending: true }).order('id', { ascending: true }).range(de, a)).catch((e) => fallo(e, 'contenido_calendario'))
    const piezas = new Map(todas.map((p) => [p.id, p]))
    const { filas: textos, sinTabla } = await textosDe(s, todas.map((p) => p.id))

    const sinCerrar = encargos.filter((e) => esPasadaSinCerrar(e, hoy))
    const deHoy = encargos.filter((e) => e.estado === 'programado' && e.fecha === hoy)
    const proximos = encargos.filter((e) => e.estado === 'programado' && e.fecha > hoy && e.fecha <= limite)
    const personas = await personasPorId(s, [...sinCerrar, ...deHoy, ...proximos].map((e) => e.responsable_id))
    const entorno: EntornoDeTarjeta = { hoy, personas, piezas, textos }

    const conFaltas = (lista: readonly EncargoLeido[]) =>
      lista.flatMap((e) => {
        const pz = piezas.get(e.pieza_id)
        if (!pz) return []
        const faltan = textosDeLaPieza(pz, textos).filter((t) => !t.listo).map((t) => t.nombre)
        const sinFichero = !pz.fichero_path
        return faltan.length > 0 || sinFichero ? [{ ...tarjetaDeEncargo(e, entorno), falta: [...(faltan.length > 0 ? [`texto de ${faltan.join(', ')}`] : []), ...(sinFichero ? ['el fichero'] : [])] }] : []
      })

    const enElCalendario = new Set(encargos.filter((e) => estaEnElCalendario([e])).map((e) => e.pieza_id))
    const sinProgramar = todas.filter((p) => !enElCalendario.has(p.id))
    const tope = 20
    return {
      texto: aTexto(
        ajustarAlTamano(
          {
            hoy,
            mira_hasta: limite,
            avisos: sinTabla ? [NOTA_SIN_TEXTOS] : [],
            resumen: {
              pasadas_sin_cerrar: sinCerrar.length,
              se_publican_hoy: deHoy.length,
              proximos_dias_programados: proximos.length,
              proximos_dias_con_algo_que_falta: conFaltas(proximos).length,
              piezas_sin_programar: sinProgramar.length,
            },
            pasadas_sin_cerrar: sinCerrar.slice(-tope).map((e) => tarjetaDeEncargo(e, entorno)),
            se_publican_hoy: deHoy.map((e) => ({ ...tarjetaDeEncargo(e, entorno), falta: conFaltas([e])[0]?.falta ?? [] })),
            proximos_con_algo_que_falta: conFaltas(proximos).slice(0, tope),
            piezas_sin_programar: sinProgramar.slice(0, tope).map((p) => ({ slug: p.slug, titulo: p.titulo, tipo: ETIQUETA_TIPO[p.tipo] ?? p.tipo, creada: fechaHora(p.creado_at) })),
          },
          'proximos_con_algo_que_falta',
          27_000
        ),
        30_000
      ),
    }
  },
}

export const HERRAMIENTAS_DE_CONTENIDO: readonly Herramienta<ContextoMcp>[] = [contenidoCalendario, contenidoPendientes, contenidoPiezas, contenidoPieza]

export const INSTRUCCIONES_DE_CONTENIDO = [
  'CALENDARIO DE CONTENIDO (las publicaciones en redes del equipo). Es la pantalla «Calendario de contenido» del ERP. Aquí NO hay «cliente». Por dónde empezar:',
  '· `contenido_pendientes` — para empezar el día: lo que ya pasó de fecha y sigue sin cerrar, lo que se publica hoy y lo de los próximos días al que le falta un texto o el fichero.',
  '· `contenido_calendario` — qué pieza se publica cada día y QUIÉN la publica (por defecto esta semana y la siguiente), con el estado de los textos de cada red y el enlace del fichero.',
  '· `contenido_piezas` — la biblioteca: buscar una pieza, ver cuáles no están programadas en ningún día.',
  '· `contenido_pieza` — UNA pieza entera por su `slug`: el texto de cada red LISTO PARA PEGAR (`texto_para_publicar`), los hashtags, el primer comentario, los avisos y los enlaces para ver y descargar el fichero (`url` y `url_de_descarga`).',
  'Una pieza es un vídeo MP4 (se publica en LinkedIn, Instagram, TikTok y Facebook, cada una con SU texto) o un carrusel (solo LinkedIn: su fichero es un ZIP con todas las láminas y `laminas` da cada una como imagen suelta, en orden). Un encargo es un día + una pieza + la persona que la publica (`publica`); el mismo día publican varias personas. El estado de un encargo es programado, publicado o saltado.',
  'PARA PROGRAMARLO EN METRICOOL (o en la herramienta que haya conectada): usa `texto_para_publicar` TAL CUAL en cada red —ya lleva sus hashtags y está escrito para esa red, no mezcles los de una con los de otra—, de medio el `url` del vídeo (o, en un carrusel, las `laminas` en orden: son imágenes sueltas; el ZIP es solo para descargarlas todas de una vez) y la `fecha` del encargo. Los `url` son enlaces públicos y estables del ERP: sirven para que otra herramienta descargue el fichero, y `url_de_descarga` lo baja con su nombre. El ERP guarda el DÍA, no la hora: si no te la dan, pregúntala. Las cuentas de redes de cada persona no están en el ERP: no adivines en cuál va; pregúntalo si no está claro. Los límites de caracteres y de hashtags son orientativos y vienen en cada texto; mira siempre los `avisos` antes de publicar.',
  'Este conector es de SOLO LECTURA: no programa nada, no sube nada a las redes y no marca ninguna publicación como publicada. Si programas o publicas con otra herramienta, dile a la persona que marque el encargo como publicado en el ERP (Calendario de contenido): por eso hay encargos de fechas pasadas que siguen en «Programado» aunque ya se publicaran; pregunta antes de volver a programar uno. Cuidado con los textos que hablan del tiempo («faltan seis semanas para…»): pueden haber caducado.',
].join('\n\n')
