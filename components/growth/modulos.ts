import { ArrowRightLeft, Boxes, Crown, SlidersHorizontal, Tags, type LucideIcon } from 'lucide-react'

/**
 * LOS SUBMÓDULOS DE GROWTH PARTNER.
 *
 * Growth Partner es EL TRABAJO: lo que hacemos para que la cuenta de un cliente
 * crezca. Configurar con qué se trabaja es el otro módulo, Amazon API.
 *
 * Ese corte es la regla que decide dónde va una pantalla nueva:
 *
 *     CONFIGURAR va en Amazon API. TRABAJAR va aquí.
 *
 * De dónde llega el fichero de un cliente se configura allí; sincronizarlo de
 * verdad se hace aquí. Qué marcas son suyas se decide allí; el análisis FBM→FBA
 * que usa esa marca se hace aquí.
 *
 *
 * ============ AÑADIR UN SUBMÓDULO SON DOS LÍNEAS ============
 *
 * Una entrada en MODULOS (aquí) y una entrada en el mapa PANELES de
 * app/dashboard/growth/page.tsx. Nada más: ni tocar la carcasa, ni el selector de
 * cliente, ni la navegación. La auditoría de repricing llega después y tiene que
 * entrar así; si para meterla hay que rehacer algo, es que la carcasa se ha
 * estropeado.
 *
 * El orden de esta lista es el orden en que se pintan los botones. Primero lo
 * que se usa cada semana, después lo que se mira cuando hay tiempo.
 */

export type ModuloId = 'stock-sync' | 'buybox' | 'fbm-fba' | 'precios-shoplamp' | 'limites-precio'

export interface Modulo {
  id: ModuloId
  nombre: string
  icono: LucideIcon
  /** Una línea, para el `title` del botón. NO se pinta en medio de la pantalla */
  pista: string
  /**
   * ¿Necesita que el cliente mande volcado de stock?
   *
   * Sirve para decir «este cliente no tiene esto» en vez de enseñar una pantalla
   * vacía que se lee como una avería. Ver lib/growth/clientes.ts: hay clientes
   * que solo están en un lado, y los dos casos son normales.
   */
  necesita: 'amazon' | 'stock'
  /**
   * EL SLUG DEL ÚNICO CLIENTE QUE LO TIENE, si es de uno solo.
   *
   * «Precios Shoplamp» aplica un recargo fijo en euros que es un acuerdo con ESE
   * cliente. Enseñar el botón con otro cliente elegido arriba sería ofrecer
   * publicarle precios calculados con una regla que nadie ha acordado con él, y
   * el botón se pulsa mirando la pantalla, no leyendo el nombre de arriba.
   *
   * Esto es la COMODIDAD de no verlo donde no toca. Lo que de verdad lo cierra
   * es que el constructor del plan resuelve el cliente por slug dentro de sí
   * mismo: ver lib/precios-shoplamp/plan.ts.
   */
  soloCliente?: string
}

export const MODULOS: readonly Modulo[] = [
  {
    id: 'stock-sync',
    nombre: 'Sincronismo de stock',
    icono: Boxes,
    pista: 'Del volcado del ERP del cliente al fichero de stock que se sube a Amazon',
    necesita: 'stock',
  },
  {
    id: 'buybox',
    nombre: 'Buy Box',
    icono: Crown,
    pista: 'Dónde la ganamos, dónde no, por qué, y qué haría falta',
    necesita: 'amazon',
  },
  {
    id: 'fbm-fba',
    nombre: 'FBM → FBA',
    icono: ArrowRightLeft,
    pista: 'Qué referencias merecen pasar a logística de Amazon',
    necesita: 'amazon',
  },
  {
    id: 'limites-precio',
    nombre: 'Sincronizar precio Min y Max',
    icono: SlidersHorizontal,
    pista: 'Arregla los «Error de precio»: el mínimo o el máximo roto pasa a valer el precio',
    necesita: 'amazon',
  },
  {
    id: 'precios-shoplamp',
    nombre: 'Precios Shoplamp',
    icono: Tags,
    pista: 'España manda: +7 € en Francia e Italia, +6 € en Alemania',
    necesita: 'amazon',
    soloCliente: 'shoplamp',
  },
] as const

/** El que se abre si la URL no dice otra cosa: el que se usa cada semana */
export const MODULO_POR_DEFECTO: ModuloId = 'stock-sync'

/** Los parámetros de la URL. Cortos porque estas direcciones se pasan por chat */
export const PARAM_MODULO = 'm'
export const PARAM_CLIENTE = 'c'

/**
 * Traduce lo que venga en la URL a un submódulo real.
 *
 * Nunca lanza ni deja la pantalla en blanco: una dirección vieja o un enlace mal
 * copiado acaban en el submódulo por defecto, que es una pantalla útil.
 */
export function moduloDesdeUrl(valor: string | null | undefined): ModuloId {
  if (!valor) return MODULO_POR_DEFECTO
  const encontrado = MODULOS.find((m) => m.id === valor)
  return encontrado ? encontrado.id : MODULO_POR_DEFECTO
}

/** El cliente al que pertenece un submódulo, si es de uno solo */
export function clienteDelModulo(modulo: ModuloId): string | null {
  return MODULOS.find((m) => m.id === modulo)?.soloCliente ?? null
}

/**
 * Los submódulos que tienen sentido con ESTE cliente elegido arriba.
 *
 * Se aplica DESPUÉS del filtro de permisos, nunca en su lugar: lo primero dice
 * a qué puede entrar esta persona y lo segundo qué toca enseñarle ahora.
 */
export function modulosDelCliente(
  permitidos: readonly ModuloId[],
  slugCliente: string | null | undefined
): readonly ModuloId[] {
  return permitidos.filter((id) => {
    const solo = clienteDelModulo(id)
    return solo === null || solo === slugCliente
  })
}
