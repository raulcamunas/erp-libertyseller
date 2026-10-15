/**
 * CUMPLIMIENTO DE LISTINGS · LOS TIPOS Y LOS ROTULOS.
 * Sin dependencias: se importa igual desde el servidor que desde la pantalla.
 *
 * Qué es esto: Amazon, al leer un listing por la API de listados, devuelve una
 * lista de «incidencias» (`issues`): lo que le falta, lo que está mal y lo que ha
 * hecho por ello (ocultarlo de las búsquedas, impedir su compra...). Aquí se
 * guardan tal cual, con un tema por incidencia para poder agruparlas.
 *
 * QUÉ NO ES: el panel «Gestionar su cumplimiento» / «Salud de la cuenta» de Seller
 * Central. Ese panel (GPSR, certificados pedidos por Amazon, casos abiertos) no
 * lo expone ninguna API. Lo que sí se ve aquí es todo lo que Amazon pega al
 * propio listing, que incluye los atributos de seguridad de producto y de
 * mercancías peligrosas cuando faltan.
 */

export type Gravedad = 'error' | 'aviso' | 'info'

/**
 * Los temas, en ORDEN DE PRIORIDAD: ante dos incidencias igual de graves, la que
 * esté antes en esta lista es la que da nombre al listing en la tabla.
 */
export const TEMAS = [
  'normativa',
  'peligrosas',
  'aprobacion',
  'marca',
  'identificadores',
  'imagenes',
  'precio',
  'duplicado',
  'datos',
  'otros',
] as const

export type Tema = (typeof TEMAS)[number]

export const ROTULO_TEMA: Record<Tema, { corto: string; largo: string }> = {
  normativa: {
    corto: 'Normativa',
    largo: 'Normativa y seguridad de producto (GPSR, certificados, etiquetado)',
  },
  peligrosas: {
    corto: 'Peligrosas',
    largo: 'Mercancías peligrosas y baterías',
  },
  aprobacion: {
    corto: 'Aprobación',
    largo: 'Necesita aprobación de Amazon o está restringido',
  },
  marca: { corto: 'Marca', largo: 'Marca' },
  identificadores: {
    corto: 'Códigos',
    largo: 'Códigos de producto (EAN, GTIN, exención)',
  },
  imagenes: { corto: 'Imágenes', largo: 'Imágenes' },
  precio: { corto: 'Precio', largo: 'Precio' },
  duplicado: { corto: 'Duplicado', largo: 'Listing duplicado' },
  datos: {
    corto: 'Datos',
    largo: 'Datos de la ficha que faltan o son incorrectos',
  },
  otros: { corto: 'Otros', largo: 'Otros motivos' },
}

/** Lo que Amazon hace con el listing por culpa de una incidencia */
export const ACCION_ES: Record<string, string> = {
  SEARCH_SUPPRESSED: 'Oculto en las búsquedas',
  LISTING_SUPPRESSED: 'Anuncio oculto: no se puede comprar',
  ATTRIBUTE_SUPPRESSED: 'Se ha ocultado un dato de la ficha',
  CATALOG_ITEM_REMOVED: 'Retirado del catálogo',
}

/**
 * Las acciones que sacan al listing de la venta o de las búsquedas.
 * `ATTRIBUTE_SUPPRESSED` NO está: oculta un dato, no el producto.
 */
export const ACCIONES_QUE_OCULTAN: ReadonlySet<string> = new Set([
  'SEARCH_SUPPRESSED',
  'LISTING_SUPPRESSED',
  'CATALOG_ITEM_REMOVED',
])

/** Una incidencia de un listing, ya limpia. Es lo que se guarda en el JSONB */
export interface Incidencia {
  /** El código de Amazon. Suele ser numérico («90220») pero se guarda como texto */
  codigo: string
  gravedad: Gravedad
  /** Con las palabras de Amazon, en español (issueLocale es_ES) */
  mensaje: string
  atributos: string[]
  /** MISSING_ATTRIBUTE, INVALID_IMAGE, QUALIFICATION_REQUIRED... tal cual */
  categorias: string[]
  /** SEARCH_SUPPRESSED, LISTING_SUPPRESSED... tal cual */
  acciones: string[]
  /** Si Amazon concede un plazo para arreglarlo: su estado y cuándo caduca */
  exencion: { estado: string; caduca: string | null } | null
  tema: Tema
  /** ISO. La primera vez que se vio esta incidencia abierta en este listing */
  desde: string
}

/** Lo mismo, antes de saber desde cuándo está abierta */
export type IncidenciaNueva = Omit<Incidencia, 'desde'>

/** Lo que cuelga de un listing para pintar la lista sin abrir cada incidencia */
export interface ResumenCumplimiento {
  errores: number
  avisos: number
  /** ¿Alguna incidencia lo oculta de verdad, sin plazo de gracia vigente? */
  suprimido: boolean
  /** El tema de la incidencia más grave. null = limpio */
  tema: Tema | null
  temas: Tema[]
}

/** Una fila de la tabla `listing_cumplimiento`, tal y como la lee la pantalla */
export interface FilaCumplimiento {
  sku: string
  asin: string | null
  titulo: string | null
  marketplace_id: string
  estado: string[]
  en_amazon: boolean
  errores: number
  avisos: number
  suprimido: boolean
  tema: Tema | null
  temas: Tema[]
  desde: string | null
  incidencias: Incidencia[]
  con_stock: boolean
  es_padre: boolean
  revisado_at: string
}

/**
 * Cómo se llama en pantalla el estado de un listing según Amazon.
 *
 * `BUYABLE` = se puede comprar. `DISCOVERABLE` = se encuentra pero no se puede
 * comprar (sin stock, sin Buy Box...). Ninguno de los dos = Amazon no lo muestra.
 */
export function estadoDeFicha(estado: readonly string[]): 'comprable' | 'visible' | 'oculto' {
  if (estado.includes('BUYABLE')) return 'comprable'
  if (estado.includes('DISCOVERABLE')) return 'visible'
  return 'oculto'
}

/* ------------------------------------------------------------------ */
/* Lo que se pide y se devuelve a la pantalla                          */
/* ------------------------------------------------------------------ */

/** Qué listings se enseñan: los que necesitan atención, solo los avisos, o todos los que tienen algo */
export type FiltroGravedad = 'atencion' | 'avisos' | 'todo'

export interface FiltrosCumplimiento {
  /** Un marketplace, o 'todos' */
  mercado: string
  gravedad: FiltroGravedad
  /** Un tema, o 'todos' */
  tema: Tema | 'todos'
  soloStock: boolean
  /** SKU, ASIN o parte del título */
  busca: string
}

export const FILTROS_POR_DEFECTO: FiltrosCumplimiento = {
  mercado: 'todos',
  gravedad: 'atencion',
  tema: 'todos',
  soloStock: false,
  busca: '',
}

/** Las cifras de arriba de la pantalla, de un cliente (y de un país si se ha elegido) */
export interface ResumenPanel {
  ok: true
  /** Los países con listings, con cuántos se han revisado de cuántos */
  mercados: Array<{ id: string; nombre: string; total: number; revisados: number }>
  /** Listings del catálogo del ERP en lo elegido */
  total: number
  /** De ellos, los que Amazon ha devuelto en alguna revisión */
  revisados: number
  ultimaRevision: string | null
  /** Con errores u ocultos */
  atencion: number
  conErrores: number
  suprimidos: number
  /** Con avisos pero sin errores ni ocultación */
  soloAvisos: number
  /** Necesitan atención Y tienen stock: lo que se está perdiendo hoy */
  atencionConStock: number
  /** Los que necesitan atención, por el tema de su incidencia más grave */
  porTema: Array<{ tema: Tema; n: number }>
}

export type RespuestaResumen =
  | ResumenPanel
  | { ok: false; faltaMigracion: true }
  | { ok: false; faltaMigracion?: false; error: string }

export interface PaginaCumplimiento {
  filas: FilaCumplimiento[]
  hayMas: boolean
}

export const TAMANO_PAGINA = 100
