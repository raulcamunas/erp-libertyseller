/**
 * SINCRONIZAR PRECIO MÍNIMO Y MÁXIMO: LA REGLA.
 * =============================================
 * PURA: no toca la base de datos ni Amazon, y por eso se comprueba entera con
 * lib/precios-limites/diagnostico.prueba.ts.
 *
 *
 * ============ QUÉ ES UN «ERROR DE PRECIO» ============
 *
 * Un listing con fijación automática de precios lleva dos límites en su oferta:
 * el MÍNIMO y el MÁXIMO que el vendedor le deja tocar. Cuando el precio que
 * tiene publicado se sale de ese rango, Amazon lo marca como «Error de precio»
 * y deja de venderlo:
 *
 *     precio 62,73   mínimo 63,99   máximo 75,90   ->  62,73 < 63,99  ->  ERROR
 *     precio 37,19   mínimo 44,59   máximo 51,75   ->  37,19 < 44,59  ->  ERROR
 *
 * Son dos casos y solo dos: el precio por DEBAJO del mínimo o por ENCIMA del
 * máximo. Un precio dentro del rango, o un listing sin límites, no es un error.
 *
 *
 * ============ QUÉ SE HACE ============
 *
 * Lo que se pidió: que el límite roto pase a valer el precio.
 *
 *   precio por debajo del mínimo  ->  el mínimo pasa a ser el precio
 *   precio por encima del máximo  ->  el máximo pasa a ser el precio
 *
 * SOLO SE TOCA EL LÍMITE QUE ESTÁ ROTO. Un listing con el precio por debajo del
 * mínimo conserva su máximo tal cual: moverlo no arregla nada y le quitaría al
 * vendedor un tope que puso a propósito.
 *
 * Y NO SE CALCULA NADA. El límite nuevo es el MISMO NÚMERO que el precio, no un
 * precio más o menos algo: no hay aritmética, así que no hay nada que pueda
 * salir sucio. (En Precios Shoplamp 24,99 + 11 daba 35.989999999999995 y eso
 * llegaba crudo al PATCH; aquí no se suma ni se resta, se copia.)
 *
 *
 * ============ EL DESVÍO, QUE ES LO QUE HAY QUE MIRAR ============
 *
 * Esta herramienta arregla el síntoma —el límite— dando por buena la cifra que
 * hoy tiene el precio. Casi siempre es lo correcto: el precio lo ha movido el
 * propio ERP o un fichero y el mínimo se quedó viejo. Pero si el precio está un
 * 70 % por debajo de su mínimo, lo raro puede ser el PRECIO y no el mínimo, y
 * «arreglarlo» bajando el suelo dejaría vender a un precio que nadie quería.
 *
 * Por eso se calcula el desvío: no cambia lo que se hace, cambia lo que se ve.
 */

/** A partir de este desvío se avisa: lo raro puede ser el precio y no el límite */
export const DESVIO_SOSPECHOSO = 0.25

export type EstadoLimites =
  /** El precio está dentro del rango, o no hay rango roto: nada que hacer */
  | 'ok'
  /** Precio por debajo del mínimo */
  | 'bajo_minimo'
  /** Precio por encima del máximo */
  | 'sobre_maximo'
  /** Los dos límites están rotos a la vez (mínimo por encima del máximo) */
  | 'ambos'
  /** La oferta no tiene precio: no hay con qué comparar ni qué copiar */
  | 'sin_precio'

export interface OfertaEntrada {
  precio: number | null
  precioMinimo: number | null
  precioMaximo: number | null
}

export interface Diagnostico {
  estado: EstadoLimites
  /** El mínimo que debería quedar. null = no se toca */
  minimoNuevo: number | null
  /** El máximo que debería quedar. null = no se toca */
  maximoNuevo: number | null
  /** Cuánto se aparta el precio del límite roto, en fracción (0,25 = 25 %) */
  desvio: number
}

const valido = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0

/**
 * Se compara en CÉNTIMOS: 62,73 contra 62,73 tiene que ser igual aunque uno
 * venga de una cadena y otro de una suma. Comparar decimales a pelo daría
 * «error» en un listing cuyo mínimo ya es exactamente su precio.
 */
const cts = (n: number) => Math.round(n * 100)

export function diagnosticar(oferta: OfertaEntrada): Diagnostico {
  const { precio, precioMinimo, precioMaximo } = oferta

  if (!valido(precio)) {
    return { estado: 'sin_precio', minimoNuevo: null, maximoNuevo: null, desvio: 0 }
  }

  const bajo = valido(precioMinimo) && cts(precio) < cts(precioMinimo)
  const sobre = valido(precioMaximo) && cts(precio) > cts(precioMaximo)

  if (!bajo && !sobre) {
    return { estado: 'ok', minimoNuevo: null, maximoNuevo: null, desvio: 0 }
  }

  const desvioBajo = bajo ? (precioMinimo - precio) / precioMinimo : 0
  const desvioSobre = sobre ? (precio - precioMaximo) / precioMaximo : 0

  return {
    estado: bajo && sobre ? 'ambos' : bajo ? 'bajo_minimo' : 'sobre_maximo',
    minimoNuevo: bajo ? precio : null,
    maximoNuevo: sobre ? precio : null,
    desvio: Math.max(desvioBajo, desvioSobre),
  }
}

/** ¿Hay algo que corregir? */
export function tieneError(d: Diagnostico): boolean {
  return d.estado === 'bajo_minimo' || d.estado === 'sobre_maximo' || d.estado === 'ambos'
}

export const ESTADO_LABELS: Record<EstadoLimites, string> = {
  ok: 'Bien',
  bajo_minimo: 'Precio bajo el mínimo',
  sobre_maximo: 'Precio sobre el máximo',
  ambos: 'Mínimo y máximo cruzados',
  sin_precio: 'Sin precio',
}

/** Los alcances de la búsqueda. Ver el comentario de cada uno en la ruta */
export type Alcance = 'sin_comprar' | 'con_stock' | 'todo'

export const ALCANCES: { id: Alcance; rotulo: string; pista: string }[] = [
  {
    id: 'sin_comprar',
    rotulo: 'Los que no se pueden comprar',
    pista:
      'Listings que Amazon tiene visibles pero no comprables. Es donde caen los errores de ' +
      'precio, y es lo más rápido: unos minutos.',
  },
  {
    id: 'con_stock',
    rotulo: 'Todos los que tienen stock',
    pista: 'Los que se pueden vender ahora mismo, estén como estén.',
  },
  {
    id: 'todo',
    rotulo: 'Todo el catálogo con precio',
    pista:
      'Mira cada referencia en Amazon. En un catálogo de 15.000 son varios minutos, y es la ' +
      'única forma de estar seguro de que no queda ninguno.',
  },
]

/** Cuántos SKU se leen de Amazon por petición. Lo comparten la pantalla y la ruta */
export const MAX_LEER = 400
/** Cuántos se corrigen por petición: 5 por segundo y 200 son unos 40 s de HTTP */
export const MAX_CORREGIR = 200
