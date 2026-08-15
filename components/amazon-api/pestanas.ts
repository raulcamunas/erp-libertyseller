import {
  BarChart3,
  Coins,
  Database,
  Eye,
  FolderInput,
  HeartPulse,
  Megaphone,
  Plug,
  Store,
  Tags,
  type LucideIcon,
} from 'lucide-react'

/**
 * LAS OCHO PESTAÑAS DE AMAZON API, Y SU ORDEN.
 *
 * Amazon API son LAS TRIPAS: aquí se configura con qué va a trabajar la agencia
 * en la cuenta de cada cliente y aquí se ve toda la información que guardamos de
 * sus productos. El trabajo sobre esa cuenta —sincronizar, vigilar la Buy Box,
 * decidir un FBM→FBA— es el otro módulo, Growth Partner.
 *
 * La regla que decide dónde va una pantalla nueva, para no tener que
 * rediscutirlo cada vez:
 *
 *     CONFIGURAR va aquí. TRABAJAR va en Growth Partner.
 *
 * De dónde llega el fichero de un cliente se configura aquí (pestaña Origen); el
 * sincronizar de verdad vive allí. Qué marcas son suyas se decide aquí (pestaña
 * Marcas); el análisis FBM→FBA que usa esa marca vive allí.
 *
 *
 * EL ORDEN NO ES ALFABÉTICO NI CAPRICHOSO: es el orden en que hay que rellenar
 * las cosas para que un cliente nuevo quede operativo. Cuentas primero, porque
 * sin saber si es marca propia o reventa no se puede decidir ni el BSR ni casi
 * nada de lo que viene detrás. Ingesta al final, porque es lo que se mira cuando
 * ya está todo puesto y quieres saber si anoche corrió.
 *
 * AÑADIR UNA PESTAÑA MAÑANA son dos líneas: una entrada aquí y una entrada en el
 * mapa PANELES de Carcasa.tsx. Nada más. Si hace falta tocar otra cosa, es que
 * la carcasa se ha estropeado.
 */

export type PestanaId =
  | 'cuentas'
  | 'catalogo'
  | 'marcas'
  | 'seguimiento'
  | 'costes'
  | 'origen'
  | 'bsr'
  | 'publicidad'
  | 'ingesta'
  | 'sistema'

export interface Pestana {
  id: PestanaId
  /** Lo que se lee en el botón. Una palabra siempre que se pueda */
  nombre: string
  icono: LucideIcon
  /** Una línea, para el `title` del botón. NO se pinta en medio de la pantalla */
  pista: string
}

export const PESTANAS: readonly Pestana[] = [
  {
    id: 'cuentas',
    nombre: 'Cuentas',
    icono: Plug,
    pista: 'Conexiones, modelo de negocio de cada cliente y su política de BSR',
  },
  {
    id: 'catalogo',
    nombre: 'Catálogo',
    icono: Store,
    pista: 'Precios y stock de cada cuenta, y los cambios que se mandan a Amazon',
  },
  {
    id: 'marcas',
    nombre: 'Marcas',
    icono: Tags,
    pista: 'Cuáles son marcas propias del cliente y cuáles revende',
  },
  {
    id: 'seguimiento',
    nombre: 'Seguimiento',
    icono: Eye,
    pista: 'Qué referencias entran en el refresco diario y de cuáles se mide el BSR',
  },
  {
    id: 'costes',
    nombre: 'Costes',
    icono: Coins,
    pista: 'Coste de cada producto: alta a mano e importación del fichero del cliente',
  },
  {
    id: 'origen',
    nombre: 'Origen',
    icono: FolderInput,
    pista: 'De dónde sale el fichero de cada cliente, o que este cliente no sincroniza',
  },
  {
    id: 'bsr',
    nombre: 'BSR',
    icono: BarChart3,
    pista: 'Rankings de los productos y su evolución',
  },
  {
    // Va después de BSR y antes de Ingesta: es configuración de un cliente
    // —igual que Origen o Marcas— y no información de lo que ya guardamos.
    id: 'publicidad',
    nombre: 'Publicidad',
    icono: Megaphone,
    pista: 'La conexión con Amazon Ads y qué cuentas de anunciante se trabajan',
  },
  {
    id: 'ingesta',
    nombre: 'Ingesta',
    icono: Database,
    pista: 'Trabajos contra Amazon, cobertura de datos y ficha de cada SKU',
  },
  {
    id: 'sistema',
    nombre: 'Sistema',
    icono: HeartPulse,
    pista: 'Si los procesos automáticos están corriendo, y el botón para lanzarlos a mano',
  },
] as const

/** La que se abre si la URL no dice otra cosa: lo primero que hay que rellenar */
export const PESTANA_POR_DEFECTO: PestanaId = 'cuentas'

/** El parámetro de la URL. Corto porque se comparte por chat */
export const PARAM_PESTANA = 'p'

/**
 * Traduce lo que venga en la URL a una pestaña real.
 *
 * Nunca lanza ni deja la pantalla en blanco: una dirección vieja, un enlace mal
 * copiado o un `?p=` a mano acaban en la pestaña por defecto, que es una
 * pantalla útil. Es la diferencia entre «me han pasado un enlace roto» y «el
 * módulo no carga».
 */
export function pestanaDesdeUrl(valor: string | null | undefined): PestanaId {
  if (!valor) return PESTANA_POR_DEFECTO
  const encontrada = PESTANAS.find((p) => p.id === valor)
  return encontrada ? encontrada.id : PESTANA_POR_DEFECTO
}
