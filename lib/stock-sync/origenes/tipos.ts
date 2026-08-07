/**
 * DE DÓNDE SALE EL FICHERO: LA INTERFAZ COMÚN.
 *
 * El usuario todavía no sabe qué va a poder darle cada cliente —uno dejará el
 * volcado en una carpeta de Drive, otro solo sabrá mandarlo por correo, otro
 * tendrá un SFTP— así que el origen tiene que ser ENCHUFABLE: añadir uno nuevo
 * es escribir un fichero en esta carpeta y meterlo en el registro de index.ts,
 * sin tocar el lector, ni el cruce, ni la pantalla, ni la base de datos.
 *
 * LO QUE HACE QUE ESO SEA VERDAD Y NO UNA BUENA INTENCIÓN:
 *
 *   1. Todos devuelven lo mismo, un FicheroOrigen: un nombre, unos bytes y una
 *      huella. A partir de ahí el proceso es idéntico venga de donde venga.
 *
 *   2. Cada conector DESCRIBE SU PROPIA CONFIGURACIÓN (`campos`). La pantalla
 *      de configuración no sabe qué es una carpeta de Drive ni un host de SFTP:
 *      pinta los campos que el conector declara. Sin esto, cada origen nuevo
 *      obligaría a tocar el formulario, que es justo lo que se quiere evitar.
 *
 *   3. La configuración va en `origen_config`, el único JSONB de la tabla. Un
 *      origen nuevo no necesita migración.
 *
 * LO QUE NINGÚN CONECTOR HACE: guardar contraseñas en `origen_config`. Ese
 * campo se lee y se escribe desde la pantalla y acaba en el navegador. El día
 * que un conector necesite una credencial del cliente, irá cifrada en su propia
 * columna con el patrón de lib/amazon/crypto.ts (AES-256-GCM y su propio AAD).
 */

import type { StockProfileOrigin } from '@/lib/types/stock-sync'
import type { WorkbookInput } from '../engine'

/**
 * Un fichero traído de donde sea, listo para el lector.
 *
 * `bytes` es un WorkbookInput porque es exactamente lo que consumen leerStock()
 * y leerEan(): un ArrayBuffer de `fetch` o de `File.arrayBuffer()` entra sin
 * conversión.
 */
export interface FicheroOrigen {
  nombre: string
  bytes: WorkbookInput
  /** Identificador en el sistema de origen (el fileId de Drive), para volver a él */
  idExterno: string | null
  /**
   * CON QUÉ SE DECIDE QUE EL FICHERO ES NUEVO.
   *
   * Un md5 si el origen lo da, y si no la fecha de modificación. Es lo que evita
   * releer y reprocesar el mismo volcado cada quince minutos: sin esto el
   * historial se llena de ejecuciones idénticas y la única señal útil —«hoy el
   * fichero ha cambiado»— se pierde entre el ruido.
   */
  huella: string | null
  modificadoAt: string | null
  tamano: number
}

/** Un fichero que se ve en el origen, sin descargar. Para la pantalla y el diagnóstico */
export interface CandidatoOrigen {
  nombre: string
  idExterno: string | null
  modificadoAt: string | null
  tamano: number | null
  /** true si es el que se cogería al procesar */
  elegido: boolean
  /** Si no se coge, por qué: «no encaja con el patrón» */
  descarte: string | null
}

/** Lo que el conector necesita para trabajar */
export interface ContextoOrigen {
  /** El `origen_config` del perfil, tal cual */
  config: Record<string, unknown>
  /** Nombre del perfil; solo para redactar los mensajes de error */
  perfil: string
  /** Tope de tamaño, el mismo que el de las subidas a mano */
  maxBytes: number
  /**
   * El fichero que ya venía en la petición. Solo lo usa el conector 'manual':
   * los demás lo ignoran, y por eso es opcional.
   */
  subida?: { nombre: string; bytes: WorkbookInput; tamano: number } | null
}

/** Resultado de comprobar un origen sin procesar nada */
export interface EstadoOrigen {
  ok: boolean
  /** En español y accionable. Si algo falla, dice QUÉ hacer */
  mensaje: string
  /** Lo que se ve ahora mismo en el origen, si el conector sabe mirarlo */
  candidatos: CandidatoOrigen[]
}

/** Cómo se pinta un campo de configuración del conector */
export interface CampoOrigen {
  clave: string
  etiqueta: string
  tipo: 'texto' | 'booleano'
  /** Debajo del campo, explicando la consecuencia de dejarlo mal */
  ayuda: string
  requerido: boolean
  ejemplo?: string
}

/**
 * Un origen de ficheros.
 *
 * `construido: false` es un conector DECLARADO pero sin implementar: aparece en
 * la pantalla en gris y explica qué falta. Es mejor que esconderlo, porque la
 * pregunta «¿puedo recibirlo por SFTP?» se contesta mirando la pantalla en vez
 * de leyendo el código.
 */
export interface ConectorOrigen {
  id: StockProfileOrigin
  etiqueta: string
  /** Una frase: qué es y cuándo se usa */
  descripcion: string
  construido: boolean
  campos: CampoOrigen[]
  /** Mira el origen sin descargar nada. Es lo que contesta el botón «Comprobar» */
  comprobar(ctx: ContextoOrigen): Promise<EstadoOrigen>
  /** Trae el fichero que toca procesar */
  traer(ctx: ContextoOrigen): Promise<FicheroOrigen>
}

/**
 * Fallo de un origen, con una frase que se pueda leer.
 *
 * Se distingue de StockSyncError porque son problemas de naturaleza distinta:
 * un StockSyncError es «el fichero no encaja con el perfil» y se arregla
 * mirando el Excel; esto es «no llego al fichero» y se arregla en Drive, en el
 * servidor o llamando al cliente.
 */
export class OrigenError extends Error {
  /** El fallo se arregla compartiendo la carpeta o dando permisos, no tocando el ERP */
  readonly esDeAcceso: boolean

  constructor(message: string, options: { esDeAcceso?: boolean } = {}) {
    super(message)
    this.name = 'OrigenError'
    this.esDeAcceso = options.esDeAcceso ?? false
  }
}

/* ------------------------------------------------------------------ */
/* Utilidades que comparten los conectores                             */
/* ------------------------------------------------------------------ */

/** Texto de `origen_config`, recortado; '' si no está o no es texto */
export function textoConfig(config: Record<string, unknown>, clave: string): string {
  const v = config[clave]
  return typeof v === 'string' ? v.trim() : ''
}

/** Booleano de `origen_config`. Acepta el true de JSON y el 'true' de un formulario */
export function booleanoConfig(config: Record<string, unknown>, clave: string): boolean {
  const v = config[clave]
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return ['true', '1', 'si', 'sí', 'on'].includes(v.trim().toLowerCase())
  return false
}

/**
 * ¿Encaja este nombre de fichero con el patrón del perfil?
 *
 * El patrón se escribe como se escribe en cualquier explorador de archivos
 * («ARTICULOS_STOCK*.xlsx»), no como una expresión regular: lo va a teclear
 * quien da de alta al cliente mirando el nombre del fichero, no quien programó
 * esto. Solo `*` (cualquier cosa) y `?` (un carácter).
 *
 * Todo lo demás se ESCAPA antes de construir la expresión. Sin escapar, un
 * punto del nombre —que los hay siempre, por la extensión— valdría por
 * cualquier carácter, y «ARTICULOS.STOCK.xlsx» casaría con
 * «ARTICULOSxSTOCKyxlsx». Peor: un paréntesis suelto en el patrón, que aparece
 * en cuanto alguien pega «fichero (1).xlsx», reventaría el RegExp en tiempo de
 * ejecución.
 *
 * Sin patrón, todo encaja: es lo correcto para una carpeta en la que el cliente
 * solo deja un fichero.
 */
export function encajaPatron(nombre: string, patron: string): boolean {
  const p = patron.trim()
  if (!p) return true

  const regex = new RegExp(
    `^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`,
    // Sin distinguir mayúsculas: los ERP exportan «ARTICULOS_STOCK.XLSX» un día
    // y «Articulos_stock.xlsx» al siguiente, y eso no debería romper nada.
    'i'
  )
  return regex.test(nombre)
}

/**
 * Extensiones que el motor sabe abrir. Se comprueba en el conector para poder
 * descartar el PDF de la factura que alguien dejó en la misma carpeta ANTES de
 * bajarse dos megas y estrellar el lector con un mensaje incomprensible.
 */
export const EXTENSIONES = ['.xlsx', '.xls', '.csv']

export function extensionValida(nombre: string): boolean {
  const lower = nombre.toLowerCase()
  return EXTENSIONES.some((ext) => lower.endsWith(ext))
}
