/**
 * EL CUERPO DE UNA TAREA: BLOQUES.
 *
 * Una lista plana de bloques. La sangría se guarda como `nivel` (0, 1, 2…) y no como un árbol: así el editor se mueve por una lista, y al hablar con Notion se vuelve a
 * armar el árbol (un bloque cuelga del anterior que tenga menos nivel).
 *
 * LO QUE EL EDITOR NO SABE EDITAR NO SE PIERDE. Una tabla, una base de datos dentro de la página, un bloque sincronizado… llegan como un bloque `notion` de solo
 * lectura, con su identificador: se enseña, no se puede tocar y, al mandar cambios a Notion, jamás se borra ni se recrea. Solo se envía lo que el editor entiende.
 *
 * SIN NADA DE RED NI DE REACT: es puro, y se comprueba con bloques.prueba.ts.
 */

/** Un trozo de texto con su formato: negrita, cursiva, subrayado, tachado, código, enlace y color */
export interface Segmento {
  t: string
  b?: boolean
  i?: boolean
  u?: boolean
  s?: boolean
  c?: boolean
  /** Enlace */
  l?: string
  /** Color de Notion: `red`, `blue_background`… */
  k?: string
}

export type TipoDeBloque = 'parrafo' | 'h1' | 'h2' | 'h3' | 'vineta' | 'numerada' | 'tarea' | 'cita' | 'aviso' | 'divisor' | 'codigo' | 'imagen' | 'notion'

export interface Bloque {
  id: string
  tipo: TipoDeBloque
  texto: Segmento[]
  hecho?: boolean
  nivel?: number
  /** El emoji de un aviso */
  icono?: string
  lenguaje?: string
  /** Una imagen: su dirección y su pie */
  url?: string
  /** El bloque de Notion que le corresponde. Un bloque nuevo, creado aquí, no lo tiene hasta que llega a Notion */
  notion_id?: string
  /** De qué tipo es el bloque de Notion que no sabemos editar (`table`, `child_database`…) */
  notion_tipo?: string
  /** Lo que se enseña de un bloque `notion` */
  vista?: string
}

/** Los tipos que el editor sabe crear y editar */
export const TIPOS_EDITABLES: readonly TipoDeBloque[] = ['parrafo', 'h1', 'h2', 'h3', 'vineta', 'numerada', 'tarea', 'cita', 'aviso', 'divisor', 'codigo']

const TIPOS_CON_TEXTO: ReadonlySet<TipoDeBloque> = new Set(['parrafo', 'h1', 'h2', 'h3', 'vineta', 'numerada', 'tarea', 'cita', 'aviso', 'codigo'])

export const conTexto = (tipo: TipoDeBloque): boolean => TIPOS_CON_TEXTO.has(tipo)

/** Un bloque está bloqueado si el editor no puede tocarlo: no se edita, no se mueve y no se manda a Notion */
export const estaBloqueado = (b: Bloque): boolean => b.tipo === 'notion' || (b.tipo === 'imagen' && !b.url)

let contador = 0
/** Un identificador de bloque que no se repite en esta pantalla */
export function nuevoIdDeBloque(): string {
  contador += 1
  return `b${Date.now().toString(36)}${contador.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function bloqueNuevo(tipo: TipoDeBloque = 'parrafo', texto = ''): Bloque {
  return { id: nuevoIdDeBloque(), tipo, texto: texto ? [{ t: texto }] : [], ...(tipo === 'tarea' ? { hecho: false } : {}) }
}

/* ------------------------------------------------------------------ */
/* Lo que se ve: texto plano, checklist y huella                       */
/* ------------------------------------------------------------------ */

export const textoDe = (segmentos: readonly Segmento[]): string => segmentos.map((s) => s.t).join('')

/** Todo el texto del cuerpo, para buscar */
export function textoPlano(bloques: readonly Bloque[]): string {
  return bloques
    .map((b) => (conTexto(b.tipo) ? textoDe(b.texto) : b.tipo === 'notion' ? (b.vista ?? '') : ''))
    .filter(Boolean)
    .join('\n')
}

/** Cuántas casillas hay y cuántas están marcadas: es lo que se pinta como «5/6» en la tarjeta */
export function contarChecklist(bloques: readonly Bloque[]): { total: number; hecho: number } {
  let total = 0
  let hecho = 0
  for (const b of bloques) {
    if (b.tipo !== 'tarea') continue
    total += 1
    if (b.hecho) hecho += 1
  }
  return { total, hecho }
}

/** El porcentaje que lleva una tarea por su checklist; sin casillas, null (el progreso lo decide quien la lleva) */
export function progresoDeChecklist(c: { total: number; hecho: number }): number | null {
  return c.total === 0 ? null : Math.round((c.hecho / c.total) * 100)
}

/** Una huella del contenido que no depende de los ids de aquí: dos cuerpos iguales dan la misma, y cambia en cuanto cambia algo que se ve */
export function huellaDeContenido(bloques: readonly Bloque[]): string {
  const forma = bloques.map((b) => [b.tipo, b.texto.map((s) => [s.t, s.b ? 1 : 0, s.i ? 1 : 0, s.u ? 1 : 0, s.s ? 1 : 0, s.c ? 1 : 0, s.l ?? '', s.k ?? '']), b.hecho ? 1 : 0, b.nivel ?? 0, b.icono ?? '', b.lenguaje ?? '', b.url ?? '', b.notion_id ?? ''])
  const texto = JSON.stringify(forma)
  let h = 5381
  for (let i = 0; i < texto.length; i++) h = ((h * 33) ^ texto.charCodeAt(i)) >>> 0
  return `${texto.length.toString(36)}-${h.toString(36)}`
}

/** ¿Tiene el cuerpo algo que el editor no entiende? Cambia cómo se manda a Notion */
export const tieneBloquesAjenos = (bloques: readonly Bloque[]): boolean => bloques.some(estaBloqueado)

/* ------------------------------------------------------------------ */
/* Texto con formato: de Notion y a Notion                             */
/* ------------------------------------------------------------------ */

/** Lo que Notion llama un trozo de texto enriquecido */
export interface TextoNotion {
  type?: string
  plain_text?: string
  href?: string | null
  text?: { content?: string; link?: { url?: string } | null }
  annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean; code?: boolean; color?: string }
}

export function segmentosDesdeNotion(texto: readonly TextoNotion[] | undefined): Segmento[] {
  const salida: Segmento[] = []
  for (const x of texto ?? []) {
    const t = x.plain_text ?? x.text?.content ?? ''
    if (!t) continue
    const a = x.annotations ?? {}
    const s: Segmento = { t }
    if (a.bold) s.b = true
    if (a.italic) s.i = true
    if (a.underline) s.u = true
    if (a.strikethrough) s.s = true
    if (a.code) s.c = true
    const enlace = x.href ?? x.text?.link?.url
    if (enlace) s.l = enlace
    if (a.color && a.color !== 'default') s.k = a.color
    salida.push(s)
  }
  return juntarIguales(salida)
}

const MAX_TEXTO_NOTION = 2000

export function textoParaNotion(segmentos: readonly Segmento[]): TextoNotion[] {
  const salida: TextoNotion[] = []
  for (const s of segmentos) {
    for (let desde = 0; desde < s.t.length || (s.t.length === 0 && desde === 0); desde += MAX_TEXTO_NOTION) {
      if (s.t.length === 0) break
      salida.push({
        type: 'text',
        text: { content: s.t.slice(desde, desde + MAX_TEXTO_NOTION), link: s.l ? { url: s.l } : null },
        annotations: { bold: Boolean(s.b), italic: Boolean(s.i), strikethrough: Boolean(s.s), underline: Boolean(s.u), code: Boolean(s.c), color: s.k ?? 'default' },
      })
    }
  }
  return salida
}

const mismoFormato = (a: Segmento, b: Segmento) => Boolean(a.b) === Boolean(b.b) && Boolean(a.i) === Boolean(b.i) && Boolean(a.u) === Boolean(b.u) && Boolean(a.s) === Boolean(b.s) && Boolean(a.c) === Boolean(b.c) && (a.l ?? '') === (b.l ?? '') && (a.k ?? '') === (b.k ?? '')

/** Une los trozos vecinos con el mismo formato: «ho» + «la» en negrita es «hola» en negrita */
export function juntarIguales(segmentos: readonly Segmento[]): Segmento[] {
  const salida: Segmento[] = []
  for (const s of segmentos) {
    const ultimo = salida[salida.length - 1]
    if (ultimo && mismoFormato(ultimo, s)) ultimo.t += s.t
    else salida.push({ ...s })
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Bloques: de Notion al editor                                        */
/* ------------------------------------------------------------------ */

/** Un bloque de Notion tal como lo devuelve la API, con sus hijos ya traídos en `children` */
export interface BloqueNotion {
  id: string
  type: string
  has_children?: boolean
  children?: BloqueNotion[]
  [clave: string]: unknown
}

type Contenido = { rich_text?: TextoNotion[]; checked?: boolean; icon?: { type?: string; emoji?: string } | null; language?: string; caption?: TextoNotion[]; type?: string; file?: { url?: string }; external?: { url?: string } }

const contenidoDe = (b: BloqueNotion): Contenido => (b[b.type] ?? {}) as Contenido

const TIPO_DE_NOTION: Record<string, TipoDeBloque> = {
  paragraph: 'parrafo',
  heading_1: 'h1',
  heading_2: 'h2',
  heading_3: 'h3',
  bulleted_list_item: 'vineta',
  numbered_list_item: 'numerada',
  to_do: 'tarea',
  quote: 'cita',
  callout: 'aviso',
  divider: 'divisor',
  code: 'codigo',
}

/** Qué se enseña de un bloque que no sabemos editar */
function vistaDeBloqueAjeno(b: BloqueNotion): string {
  const c = contenidoDe(b) as { title?: string; rich_text?: TextoNotion[]; caption?: TextoNotion[]; url?: string }
  const texto = textoDe(segmentosDesdeNotion(c.rich_text ?? c.caption)) || c.title || c.url || ''
  const nombres: Record<string, string> = { table: 'Tabla', child_database: 'Base de datos', child_page: 'Página', toggle: 'Desplegable', column_list: 'Columnas', synced_block: 'Bloque sincronizado', bookmark: 'Marcador', embed: 'Contenido incrustado', file: 'Archivo', pdf: 'PDF', video: 'Vídeo', audio: 'Audio', equation: 'Ecuación', link_preview: 'Vista previa de enlace', table_of_contents: 'Índice', breadcrumb: 'Ruta' }
  const nombre = nombres[b.type] ?? b.type
  return texto ? `${nombre}: ${texto}` : nombre
}

/**
 * Convierte los bloques de Notion en la lista plana del editor. Los hijos de un bloque que sabemos editar se aplanan con un nivel más; un bloque que no sabemos editar
 * se queda entero (con sus hijos dentro de Notion).
 */
export function bloquesDesdeNotion(lista: readonly BloqueNotion[], nivel = 0): Bloque[] {
  const salida: Bloque[] = []
  for (const n of lista) {
    const tipo = TIPO_DE_NOTION[n.type]
    const base = { id: nuevoIdDeBloque(), notion_id: n.id, ...(nivel > 0 ? { nivel } : {}) }
    if (tipo) {
      const c = contenidoDe(n)
      const bloque: Bloque = { ...base, tipo, texto: tipo === 'divisor' ? [] : segmentosDesdeNotion(c.rich_text) }
      if (tipo === 'tarea') bloque.hecho = Boolean(c.checked)
      if (tipo === 'aviso') bloque.icono = c.icon?.type === 'emoji' ? c.icon.emoji : '💡'
      if (tipo === 'codigo') bloque.lenguaje = c.language ?? 'plain text'
      salida.push(bloque)
      if (n.children?.length) salida.push(...bloquesDesdeNotion(n.children, nivel + 1))
    } else if (n.type === 'image') {
      const c = contenidoDe(n)
      const url = c.type === 'external' ? c.external?.url : c.file?.url
      salida.push({ ...base, tipo: 'imagen', texto: segmentosDesdeNotion(c.caption), ...(url ? { url } : {}), notion_tipo: 'image', vista: 'Imagen' })
    } else {
      salida.push({ ...base, tipo: 'notion', texto: [], notion_tipo: n.type, vista: vistaDeBloqueAjeno(n) })
    }
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Bloques: del editor a Notion                                        */
/* ------------------------------------------------------------------ */

const TIPO_A_NOTION: Partial<Record<TipoDeBloque, string>> = {
  parrafo: 'paragraph',
  h1: 'heading_1',
  h2: 'heading_2',
  h3: 'heading_3',
  vineta: 'bulleted_list_item',
  numerada: 'numbered_list_item',
  tarea: 'to_do',
  cita: 'quote',
  aviso: 'callout',
  divisor: 'divider',
  codigo: 'code',
}

/** El tipo de Notion que le toca a un bloque del editor; undefined si no se puede mandar (un bloque ajeno) */
export const tipoDeNotionDe = (b: Bloque): string | undefined => TIPO_A_NOTION[b.tipo]

/** Lo que va dentro de `{ [tipo]: ... }` al crear o actualizar un bloque en Notion */
export function contenidoParaNotion(b: Bloque): Record<string, unknown> | null {
  const tipo = TIPO_A_NOTION[b.tipo]
  if (!tipo) return null
  const rich_text = textoParaNotion(b.texto)
  switch (b.tipo) {
    case 'divisor':
      return {}
    case 'tarea':
      return { rich_text, checked: Boolean(b.hecho) }
    case 'aviso':
      return { rich_text, icon: { type: 'emoji', emoji: b.icono || '💡' } }
    case 'codigo':
      return { rich_text, language: b.lenguaje || 'plain text' }
    default:
      return { rich_text }
  }
}

/** Un bloque nuevo para `append children`, sin hijos */
export function bloqueParaCrear(b: Bloque): Record<string, unknown> | null {
  const tipo = TIPO_A_NOTION[b.tipo]
  const contenido = contenidoParaNotion(b)
  if (!tipo || !contenido) return null
  return { object: 'block', type: tipo, [tipo]: contenido }
}

/**
 * Arma el árbol que pide Notion al crear varios bloques de una vez: cada bloque cuelga del anterior que tenga menos nivel. Un bloque ajeno se deja fuera (y con él su
 * sangría: lo que cuelga de él sube al nivel del padre que le quede).
 */
export function arbolParaNotion(bloques: readonly Bloque[]): Array<Record<string, unknown>> {
  const raiz: Array<Record<string, unknown>> = []
  const pila: Array<{ nivel: number; hijos: Array<Record<string, unknown>> }> = [{ nivel: -1, hijos: raiz }]
  for (const b of bloques) {
    const crear = bloqueParaCrear(b)
    if (!crear) continue
    const nivel = b.nivel ?? 0
    while (pila.length > 1 && pila[pila.length - 1].nivel >= nivel) pila.pop()
    const padre = pila[pila.length - 1]
    padre.hijos.push(crear)
    const tipo = crear.type as string
    const cuerpo = crear[tipo] as Record<string, unknown>
    const hijos: Array<Record<string, unknown>> = []
    cuerpo.children = hijos
    pila.push({ nivel, hijos })
  }
  // Un bloque sin hijos no lleva la lista vacía: Notion la rechaza en algunos tipos
  const limpiar = (lista: Array<Record<string, unknown>>) => {
    for (const x of lista) {
      const cuerpo = x[x.type as string] as { children?: Array<Record<string, unknown>> }
      if (cuerpo.children && cuerpo.children.length === 0) delete cuerpo.children
      else if (cuerpo.children) limpiar(cuerpo.children)
    }
  }
  limpiar(raiz)
  return raiz
}

/* ------------------------------------------------------------------ */
/* Cambios entre dos versiones del cuerpo                              */
/* ------------------------------------------------------------------ */

/** Lo que hay que hacer en Notion para que su cuerpo sea el del editor */
export type PlanDeContenido =
  | { modo: 'nada' }
  /** El cuerpo entero se sustituye: solo cuando NO hay ningún bloque ajeno, porque no se puede recrear lo que no se entiende */
  | { modo: 'reemplazar'; borrar: string[]; crear: Bloque[] }
  /** Hay bloques ajenos: se toca solo lo que cambió, sin borrar ni mover lo que no se entiende */
  | { modo: 'diferencial'; actualizar: Bloque[]; borrar: string[]; crear: Bloque[] }

const iguales = (a: Bloque, b: Bloque) => huellaDeContenido([{ ...a, notion_id: undefined }]) === huellaDeContenido([{ ...b, notion_id: undefined }])

/**
 * Compara lo último que se sabe de Notion (`anterior`, con sus `notion_id`) con lo que hay ahora en el editor (`nuevo`).
 */
export function planDeContenido(anterior: readonly Bloque[], nuevo: readonly Bloque[]): PlanDeContenido {
  if (huellaDeContenido(anterior) === huellaDeContenido(nuevo)) return { modo: 'nada' }

  if (!tieneBloquesAjenos(anterior) && !tieneBloquesAjenos(nuevo)) {
    return { modo: 'reemplazar', borrar: anterior.map((b) => b.notion_id).filter((x): x is string => Boolean(x)), crear: nuevo.map((b) => ({ ...b, notion_id: undefined })) }
  }

  const antes = new Map(anterior.filter((b) => b.notion_id).map((b) => [b.notion_id as string, b]))
  const vistos = new Set<string>()
  const actualizar: Bloque[] = []
  const crear: Bloque[] = []
  const borrar: string[] = []
  for (const b of nuevo) {
    if (estaBloqueado(b)) {
      if (b.notion_id) vistos.add(b.notion_id)
      continue
    }
    const previo = b.notion_id ? antes.get(b.notion_id) : undefined
    if (!previo) {
      crear.push({ ...b, notion_id: undefined })
      continue
    }
    vistos.add(b.notion_id as string)
    if (tipoDeNotionDe(previo) !== tipoDeNotionDe(b)) {
      // Notion no deja cambiar el tipo de un bloque: se borra y se crea otro
      borrar.push(b.notion_id as string)
      crear.push({ ...b, notion_id: undefined })
    } else if (!iguales(previo, b)) {
      actualizar.push(b)
    }
  }
  for (const [id, b] of antes) if (!vistos.has(id) && !estaBloqueado(b)) borrar.push(id)
  return { modo: 'diferencial', actualizar, borrar, crear }
}
