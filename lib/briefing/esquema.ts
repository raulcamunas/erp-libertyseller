import { diasEntre, esDia } from '@/lib/correo/secuencias/fechas'
import type {
  Briefing,
  CorreoPendiente,
  EquipoComercial,
  EquipoDeCuentas,
  NivelDeAviso,
  PuntoARevisar,
  TareasDeClientes,
} from './tipos'

/**
 * LIMPIAR EL BRIEFING QUE LLEGA DE LA RUTINA ANTES DE GUARDARLO Y DE PINTARLO.
 * ============================================================================
 * PURO. Se comprueba con esquema.prueba.ts.
 *
 * Lo escribe un modelo (la rutina «Briefing diario Liberty Seller») a partir de correos, tableros de Notion y un calendario, y se enseña a la gente del equipo,
 * así que no se da por bueno tal cual:
 *
 *   · Solo se conocen las claves de lib/briefing/tipos.ts; el resto se tira. Cada cadena se limpia (sin caracteres de control ni saltos de línea) y se recorta
 *     a un tope. Cada lista tiene su tope. Un número que no es número es null (nunca se inventa un cero).
 *   · Un enlace solo vale si es https. Nada de `javascript:`, `data:` ni `http:`.
 *   · NADA SE PINTA COMO HTML: la pantalla escribe estos textos como texto. Aun así, lo que se guarda ya viene limpio.
 *   · Se es GENEROSO con lo que falta o sobra (la rutina puede no traer una sección, o pasarse de largo en una frase) y ESTRICTO solo con lo imprescindible: que haya
 *     un titular y que el conjunto no pase de un tamaño razonable. Todo lo que se recorta o se descarta se cuenta en `avisos`, para que la rutina lo sepa.
 *
 * Cada punto de «Revisa hoy» y de «Correo» recibe aquí una CLAVE estable (de su área y su título): es lo que la pantalla guarda al marcarlo como resuelto, y no
 * cambia si la rutina vuelve a publicar el mismo día.
 */

export const LIMITES = {
  titular: 200,
  fechaLabel: 80,
  actualizado: 40,
  titulo: 200,
  texto: 500,
  area: 60,
  fuente: 200,
  nota: 160,
  nombre: 80,
  punto: 160,
  enlace: 1000,
  agenda: 12,
  revisar: 30,
  correo: 30,
  personasComerciales: 20,
  alertas: 12,
  personasDeCuentas: 20,
  puntosPorPersona: 8,
  sinBriefing: 20,
  comentarios: 40,
  enRevision: 40,
  destacadas: 40,
  porCliente: 80,
  /** Lo más que ocupa un briefing ya limpio, en caracteres de su JSON. El real ronda los 12.000 */
  tamanoTotal: 100_000,
} as const

type Acumulador = { recortes: number; enlaces: number; topes: Set<string> }

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/** Una frase limpia: sin caracteres de control, en una sola línea y con tope. Un número se escribe tal cual; cualquier otra cosa, vacío */
function frase(v: unknown, max: number, a: Acumulador): string {
  let t: string
  if (typeof v === 'string') t = v
  else if (typeof v === 'number' && Number.isFinite(v)) t = String(v)
  else return ''
  t = t.replace(CONTROL, '').replace(/\s*[\r\n]+\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim()
  if (t.length <= max) return t
  a.recortes += 1
  return `${t.slice(0, max - 1).trimEnd()}…`
}

/** Un número, o null. Acepta «37» como texto y «3,5» con coma; nunca devuelve NaN ni infinitos */
function numero(v: unknown): number | null {
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim())) n = Number(v.trim().replace(',', '.'))
  else return null
  if (!Number.isFinite(n)) return null
  return Math.max(-1_000_000_000, Math.min(1_000_000_000, Math.round(n * 100) / 100))
}

/** Un enlace https o null. Lo que venía y no vale se cuenta */
function enlace(v: unknown, a: Acumulador): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(CONTROL, '').trim()
  if (t === '') return null
  if (t.length > LIMITES.enlace || !/^https:\/\//i.test(t)) {
    a.enlaces += 1
    return null
  }
  try {
    if (new URL(t).protocol !== 'https:') throw new Error('no https')
  } catch {
    a.enlaces += 1
    return null
  }
  return t
}

/** Los elementos de una lista, normalizados, con tope. Lo que no es un objeto o no vale se salta */
function lista<T>(v: unknown, max: number, nombre: string, a: Acumulador, mapear: (x: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(v)) return []
  if (v.length > max) a.topes.add(nombre)
  const salida: T[] = []
  for (const x of v.slice(0, max)) {
    if (!esObjeto(x)) continue
    const m = mapear(x)
    if (m !== null) salida.push(m)
  }
  return salida
}

/** Una lista de frases cortas (los puntos de «hecho», «en curso» y «bloqueos») */
function puntos(v: unknown, nombre: string, a: Acumulador): string[] {
  if (!Array.isArray(v)) return []
  if (v.length > LIMITES.puntosPorPersona) a.topes.add(nombre)
  return v
    .slice(0, LIMITES.puntosPorPersona)
    .map((x) => frase(x, LIMITES.punto, a))
    .filter((x) => x !== '')
}

const nivelDe = (v: unknown): NivelDeAviso => (v === 'alta' ? 'alta' : 'media')

/* ------------------------------------------------------------------ */
/* Claves de los puntos que se pueden marcar                           */
/* ------------------------------------------------------------------ */

/** Quita tildes, signos y mayúsculas: «Entrais · 180 listings» y «entrais  180 listings» son lo mismo */
function sinAdornos(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
}

/** FNV-1a de 32 bits, en 8 cifras hexadecimales. No es seguridad: es un nombre corto y estable para un punto */
export function huellaCorta(texto: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** «r-1a2b3c4d» para un punto de «Revisa hoy», «c-…» para uno de «Correo». Con la misma área y título, siempre la misma */
export function claveDeUnPunto(prefijo: 'r' | 'c', area: string, titulo: string): string {
  return `${prefijo}-${huellaCorta(`${sinAdornos(area)}|${sinAdornos(titulo)}`)}`
}

/** Si dos puntos salen con la misma clave (mismo área y título), el segundo lleva un «-2», el tercero un «-3»… */
function conClavesUnicas<T extends { clave: string }>(items: T[]): T[] {
  const vistas = new Map<string, number>()
  return items.map((it) => {
    const n = (vistas.get(it.clave) ?? 0) + 1
    vistas.set(it.clave, n)
    return n === 1 ? it : { ...it, clave: `${it.clave}-${n}` }
  })
}

/* ------------------------------------------------------------------ */
/* El briefing                                                         */
/* ------------------------------------------------------------------ */

export type ResultadoDeNormalizar = { ok: true; briefing: Briefing; avisos: string[] } | { ok: false; error: string }

function comerciales(v: unknown, a: Acumulador): EquipoComercial | null {
  if (!esObjeto(v)) return null
  const t = esObjeto(v.totales) ? v.totales : {}
  return {
    periodo: frase(v.periodo, LIMITES.nota, a),
    totales: { llamadas: numero(t.llamadas), whatsapps: numero(t.whatsapps), respuestas: numero(t.respuestas), citas: numero(t.citas) },
    kpi_nota_llamadas: frase(v.kpi_nota_llamadas, LIMITES.nota, a),
    kpi_nota_citas: frase(v.kpi_nota_citas, LIMITES.nota, a),
    lectura: frase(v.lectura, LIMITES.texto, a),
    alertas: lista(v.alertas, LIMITES.alertas, 'alertas de comerciales', a, (x) => {
      const texto = frase(x.texto, LIMITES.texto, a)
      return texto ? { quien: frase(x.quien, LIMITES.nombre, a), texto } : null
    }),
    personas: lista(v.personas, LIMITES.personasComerciales, 'comerciales', a, (x) => {
      const nombre = frase(x.nombre, LIMITES.nombre, a)
      if (!nombre) return null
      return {
        nombre,
        url: enlace(x.url, a),
        llamadas: numero(x.llamadas),
        whatsapps: numero(x.whatsapps),
        respuestas: numero(x.respuestas),
        citas: numero(x.citas),
        resumen: frase(x.resumen, LIMITES.texto, a),
      }
    }),
  }
}

function equipo(v: unknown, a: Acumulador): EquipoDeCuentas | null {
  if (!esObjeto(v)) return null
  return {
    periodo: frase(v.periodo, LIMITES.nota, a),
    personas: lista(v.personas, LIMITES.personasDeCuentas, 'personas del equipo de cuentas', a, (x) => {
      const nombre = frase(x.nombre, LIMITES.nombre, a)
      if (!nombre) return null
      return {
        nombre,
        rol: frase(x.rol, LIMITES.nota, a),
        fecha_label: frase(x.fecha_label, LIMITES.nombre, a),
        url: enlace(x.url, a),
        hecho: puntos(x.hecho, 'puntos «hecho»', a),
        en_curso: puntos(x.en_curso, 'puntos «en curso»', a),
        bloqueos: puntos(x.bloqueos, 'puntos «bloqueos»', a),
      }
    }),
    sin_briefing: lista(v.sin_briefing, LIMITES.sinBriefing, 'personas sin briefing', a, (x) => {
      const nombre = frase(x.nombre, LIMITES.nombre, a)
      return nombre ? { nombre, ultimo: frase(x.ultimo, 40, a) } : null
    }),
  }
}

function tareas(v: unknown, a: Acumulador): TareasDeClientes | null {
  if (!esObjeto(v)) return null
  const t = esObjeto(v.totales) ? v.totales : {}
  const tarea = (x: Record<string, unknown>) => frase(x.tarea, LIMITES.titulo, a)
  return {
    nota: frase(v.nota, LIMITES.nota, a),
    totales: { en_progreso: numero(t.en_progreso), en_revision: numero(t.en_revision), sin_responsable: numero(t.sin_responsable), clientes: numero(t.clientes) },
    comentarios: lista(v.comentarios, LIMITES.comentarios, 'comentarios de tareas', a, (x) => {
      const nombre = tarea(x)
      if (!nombre) return null
      return {
        tarea: nombre,
        cliente: frase(x.cliente, LIMITES.nombre, a),
        autor: frase(x.autor, LIMITES.nombre, a),
        fecha: frase(x.fecha, 40, a),
        texto: frase(x.texto, LIMITES.texto, a),
        pide: x.pide === true,
        url: enlace(x.url, a),
      }
    }),
    en_revision: lista(v.en_revision, LIMITES.enRevision, 'tareas en revisión', a, (x) => {
      const nombre = tarea(x)
      if (!nombre) return null
      return { tarea: nombre, cliente: frase(x.cliente, LIMITES.nombre, a), responsable: frase(x.responsable, LIMITES.nombre, a), checklist: frase(x.checklist, 20, a), url: enlace(x.url, a) }
    }),
    destacadas: lista(v.destacadas, LIMITES.destacadas, 'tareas destacadas', a, (x) => {
      const nombre = tarea(x)
      if (!nombre) return null
      return {
        tarea: nombre,
        cliente: frase(x.cliente, LIMITES.nombre, a),
        responsable: frase(x.responsable, LIMITES.nombre, a),
        checklist: frase(x.checklist, 20, a),
        texto: frase(x.texto, LIMITES.texto, a),
        url: enlace(x.url, a),
      }
    }),
    por_cliente: lista(v.por_cliente, LIMITES.porCliente, 'clientes con tareas', a, (x) => {
      const cliente = frase(x.cliente, LIMITES.nombre, a)
      if (!cliente) return null
      return { cliente, pendientes: Math.max(0, numero(x.pendientes) ?? 0), en_revision: Math.max(0, numero(x.en_revision) ?? 0) }
    }),
  }
}

/**
 * El JSON de la rutina → un briefing limpio, o el motivo por el que no vale. Acepta el objeto o su texto JSON (un modelo a veces pasa uno u otro).
 * Solo es obligatorio el titular.
 */
export function normalizarBriefing(entrada: unknown): ResultadoDeNormalizar {
  let crudo: unknown = entrada
  if (typeof entrada === 'string') {
    try {
      crudo = JSON.parse(entrada)
    } catch {
      return { ok: false, error: 'El briefing no es un JSON válido. Manda el objeto con las claves de siempre (fecha_label, actualizado, titular, agenda, revisar, comerciales, equipo, tareas, correo, pie).' }
    }
  }
  if (!esObjeto(crudo)) return { ok: false, error: 'El briefing tiene que ser un objeto JSON con las claves de siempre (titular, revisar, comerciales…).' }

  const a: Acumulador = { recortes: 0, enlaces: 0, topes: new Set() }
  const titular = frase(crudo.titular, LIMITES.titular, a)
  if (titular === '') return { ok: false, error: 'Falta el titular del briefing («titular»): es lo primero que se lee.' }

  const revisar = conClavesUnicas(
    lista<PuntoARevisar>(crudo.revisar, LIMITES.revisar, 'puntos de «Revisa hoy»', a, (x) => {
      const titulo = frase(x.titulo, LIMITES.titulo, a)
      if (!titulo) return null
      const area = frase(x.area, LIMITES.area, a)
      return { clave: claveDeUnPunto('r', area, titulo), nivel: nivelDe(x.nivel), area, titulo, texto: frase(x.texto, LIMITES.texto, a), fuente: frase(x.fuente, LIMITES.fuente, a), url: enlace(x.url, a) }
    })
  )
  const correo = conClavesUnicas(
    lista<CorreoPendiente>(crudo.correo, LIMITES.correo, 'correos', a, (x) => {
      const titulo = frase(x.titulo, LIMITES.titulo, a)
      if (!titulo) return null
      const de = frase(x.de, LIMITES.nombre, a)
      return { clave: claveDeUnPunto('c', de, titulo), nivel: nivelDe(x.nivel), titulo, de, fecha: frase(x.fecha, 40, a), texto: frase(x.texto, LIMITES.texto, a), url: enlace(x.url, a) }
    })
  )

  const briefing: Briefing = {
    fecha_label: frase(crudo.fecha_label, LIMITES.fechaLabel, a),
    actualizado: frase(crudo.actualizado, LIMITES.actualizado, a),
    titular,
    agenda: lista(crudo.agenda, LIMITES.agenda, 'puntos de agenda', a, (x) => {
      const titulo = frase(x.titulo, LIMITES.titulo, a)
      return titulo ? { hora: frase(x.hora, 40, a), titulo, nota: frase(x.nota, LIMITES.nota, a) } : null
    }),
    revisar,
    comerciales: comerciales(crudo.comerciales, a),
    equipo: equipo(crudo.equipo, a),
    tareas: tareas(crudo.tareas, a),
    correo,
    pie: frase(crudo.pie, LIMITES.texto, a),
  }

  if (JSON.stringify(briefing).length > LIMITES.tamanoTotal) {
    return { ok: false, error: `El briefing es demasiado grande (pasa de ${LIMITES.tamanoTotal.toLocaleString('es-ES')} caracteres). Acórtalo: frases cortas y menos puntos por lista.` }
  }

  const avisos: string[] = []
  if (a.recortes > 0) avisos.push(`Se han recortado ${a.recortes} ${a.recortes === 1 ? 'texto largo' : 'textos largos'}.`)
  if (a.enlaces > 0) avisos.push(`Se han descartado ${a.enlaces} ${a.enlaces === 1 ? 'enlace que no era https' : 'enlaces que no eran https'}.`)
  for (const t of a.topes) avisos.push(`Había demasiados ${t}: se han guardado los primeros.`)
  return { ok: true, briefing, avisos }
}

/* ------------------------------------------------------------------ */
/* El día                                                              */
/* ------------------------------------------------------------------ */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const NOMBRES_DE_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

const dosCifras = (n: number) => String(n).padStart(2, '0')

/**
 * El día que dice un texto como «Martes 27 de octubre de 2026» (el año es opcional: sin él, el de `hoy`). null si no hay ninguno o no existe
 * («31 de febrero»).
 */
export function diaEnElTexto(texto: string, hoy: string): string | null {
  const m = /(\d{1,2})\s+de\s+([a-záéíóúñ]+)(?:\s+(?:de|del)\s+(\d{4}))?/i.exec(texto)
  if (!m) return null
  const nombre = m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const mes = nombre === 'setiembre' ? 8 : MESES.findIndex((x) => x === nombre)
  if (mes < 0) return null
  const anio = m[3] ? Number(m[3]) : Number(hoy.slice(0, 4))
  const dia = `${anio}-${dosCifras(mes + 1)}-${dosCifras(Number(m[1]))}`
  return esDia(dia) ? dia : null
}

/** «Martes 27 de octubre de 2026» para un día AAAA-MM-DD */
export function etiquetaDelDia(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number)
  const f = new Date(Date.UTC(a, m - 1, d))
  const nombre = NOMBRES_DE_DIA[f.getUTCDay()]
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${d} de ${MESES[m - 1]} de ${a}`
}

/** Los días hacia atrás y hacia delante que se aceptan para publicar, contando desde hoy: un briefing de hace un mes o de dentro de una semana es un error */
export const DIAS_ATRAS_PERMITIDOS = 7
export const DIAS_ADELANTE_PERMITIDOS = 1

export type ResultadoDeDia = { ok: true; dia: string; origen: 'argumento' | 'fecha_label' | 'hoy' } | { ok: false; error: string }

/**
 * Para qué día es el briefing: el que diga la rutina (`dia`), si no el que diga su `fecha_label`, y si tampoco hoy. Tiene que ser un día razonable
 * (de una semana atrás a mañana): publicar «en el pasado lejano» casi siempre es un error de fecha.
 */
export function resolverDia(opciones: { dia?: unknown; fechaLabel: string; hoy: string }): ResultadoDeDia {
  const { hoy } = opciones
  let dia: string
  let origen: 'argumento' | 'fecha_label' | 'hoy'
  if (opciones.dia !== undefined && opciones.dia !== null && opciones.dia !== '') {
    if (typeof opciones.dia !== 'string' || !esDia(opciones.dia.trim())) return { ok: false, error: '«dia» tiene que ser una fecha AAAA-MM-DD que exista (por ejemplo 2026-10-27).' }
    dia = opciones.dia.trim()
    origen = 'argumento'
  } else {
    const deLaEtiqueta = diaEnElTexto(opciones.fechaLabel, hoy)
    dia = deLaEtiqueta ?? hoy
    origen = deLaEtiqueta ? 'fecha_label' : 'hoy'
  }
  const distancia = diasEntre(hoy, dia)
  if (distancia < -DIAS_ATRAS_PERMITIDOS || distancia > DIAS_ADELANTE_PERMITIDOS) {
    return { ok: false, error: `El día ${dia} queda fuera de lo razonable (hoy es ${hoy}): solo se publica de ${DIAS_ATRAS_PERMITIDOS} días atrás a ${DIAS_ADELANTE_PERMITIDOS} día por delante.` }
  }
  return { ok: true, dia, origen }
}

/** Una línea para contestarle a la rutina qué se ha publicado */
export function resumenDelBriefing(dia: string, b: Briefing): string {
  const partes = [`${b.revisar.length} ${b.revisar.length === 1 ? 'punto' : 'puntos'} en «Revisa hoy»`]
  if (b.comerciales) partes.push(`${b.comerciales.personas.length} comerciales`)
  if (b.equipo) partes.push(`${b.equipo.personas.length} del equipo de cuentas`)
  if (b.tareas) partes.push(`${b.tareas.por_cliente.length} clientes con tareas`)
  partes.push(`${b.correo.length} ${b.correo.length === 1 ? 'correo' : 'correos'}`)
  return `Briefing del ${dia} («${b.titular}»): ${partes.join(' · ')}.`
}
