import { type CajaEnEdicion, type LineaParaEncajar } from './encaje-resumen'

/**
 * LO QUE SE PUEDE HACER CON LAS CAJAS EN LA PÁGINA DEL CLIENTE.
 * =============================================================
 * PURO: cada operación recibe las cajas y devuelve las nuevas, sin tocar las de entrada. La página
 * solo enseña y llama a esto; así lo que importa —que nadie se pase de unidades, que al quitar una
 * caja las demás se renumeren, que mover una línea no la duplique— se comprueba sin abrir un
 * navegador (encaje-operaciones.prueba.ts).
 *
 * Ninguna operación deja las cajas en un estado que el servidor rechazaría: no hay forma de meter
 * más unidades de las declaradas ni de repetir un SKU dentro de una caja.
 */

export type CampoDeMedida = 'largoCm' | 'anchoCm' | 'altoCm' | 'pesoKg'

const unidadesDe = (c: CajaEnEdicion, sku: string): number => c.contenido.find((x) => x.sku === sku)?.unidades ?? 0
const declaradasDe = (lineas: LineaParaEncajar[], sku: string): number => lineas.find((l) => l.sku === sku)?.unidades ?? 0
const encajadasEnTotal = (cajas: CajaEnEdicion[], sku: string): number => cajas.reduce((s, c) => s + unidadesDe(c, sku), 0)

/** Cuántas unidades de este SKU faltan por meter en alguna caja (nunca negativo) */
export const pendientesDe = (lineas: LineaParaEncajar[], cajas: CajaEnEdicion[], sku: string): number =>
  Math.max(0, declaradasDe(lineas, sku) - encajadasEnTotal(cajas, sku))

/** Cuántas unidades de este SKU caben en ESTA caja: lo declarado menos lo que ya está en las OTRAS */
export function maximoEnCaja(lineas: LineaParaEncajar[], cajas: CajaEnEdicion[], numero: number, sku: string): number {
  const enOtras = cajas.filter((c) => c.numero !== numero).reduce((s, c) => s + unidadesDe(c, sku), 0)
  return Math.max(0, declaradasDe(lineas, sku) - enOtras)
}

const conLaCaja = (cajas: CajaEnEdicion[], numero: number, cambio: (c: CajaEnEdicion) => CajaEnEdicion): CajaEnEdicion[] =>
  cajas.map((c) => (c.numero === numero ? cambio(c) : c))

/** Una caja nueva, con el número siguiente. `copiarMedidasDe` le pone las mismas medidas que otra (el peso no: cada caja pesa lo suyo) */
export function anadirCaja(cajas: CajaEnEdicion[], copiarMedidasDe?: number): CajaEnEdicion[] {
  const base = copiarMedidasDe === undefined ? undefined : cajas.find((c) => c.numero === copiarMedidasDe)
  const numero = Math.max(0, ...cajas.map((c) => c.numero)) + 1
  return [...cajas, { numero, largoCm: base?.largoCm ?? null, anchoCm: base?.anchoCm ?? null, altoCm: base?.altoCm ?? null, pesoKg: null, contenido: [] }]
}

export interface ResultadoDeDuplicar {
  cajas: CajaEnEdicion[]
  /** El número de la caja nueva. null si la de origen no existe y no se ha hecho nada */
  nueva: number | null
  /** Unidades que se han copiado a la caja nueva */
  copiadas: number
  /** De lo que llevaba la de origen, lo que NO se ha podido copiar porque ya no quedaba por encajar de esa referencia */
  sinCopiar: number
}

/**
 * «OTRA IGUAL»: una caja nueva que repite una que ya está hecha —las mismas medidas, el mismo peso y
 * lo mismo dentro—, en lo que quede por encajar.
 *
 * Es lo que se espera de «otra igual»: cuando un producto tiene seis unidades y la primera caja lleva
 * tres, la segunda lleva las otras tres sin volver a buscarlas una a una. Pero el envío tiene las
 * unidades que tiene: de cada referencia se copia lo que quepa, nunca más de lo que queda, y lo que no
 * cabe se dice (`sinCopiar`) para que la pantalla avise en vez de dejar creer que se ha copiado todo.
 *
 * El PESO solo se copia si la copia es entera: con menos dentro la caja pesa menos, y un peso heredado
 * que no es el de verdad es peor que uno en blanco, porque nadie se acuerda de corregirlo.
 */
export function duplicarCaja(cajas: CajaEnEdicion[], lineas: LineaParaEncajar[], numero: number): ResultadoDeDuplicar {
  const origen = cajas.find((c) => c.numero === numero)
  if (!origen) return { cajas, nueva: null, copiadas: 0, sinCopiar: 0 }

  let acc = anadirCaja(cajas, numero)
  const nueva = acc[acc.length - 1].numero
  let copiadas = 0
  let sinCopiar = 0
  for (const x of origen.contenido) {
    const caben = Math.min(x.unidades, pendientesDe(lineas, acc, x.sku))
    if (caben > 0) {
      acc = ponerUnidades(acc, lineas, nueva, x.sku, caben)
      copiadas += caben
    }
    sinCopiar += x.unidades - caben
  }
  if (sinCopiar === 0 && origen.pesoKg !== null) acc = ponerMedida(acc, nueva, 'pesoKg', origen.pesoKg)
  return { cajas: acc, nueva, copiadas, sinCopiar }
}

/**
 * Quita una caja. Las demás se RENUMERAN de 1 en adelante: el número de caja acaba en la plantilla de
 * embalaje de Amazon y «Caja 1, Caja 3» sin la 2 es un hueco que luego hay que explicar. Lo que
 * tuviera dentro vuelve a «por encajar» solo, porque eso se calcula de lo que hay en las cajas.
 */
export function quitarCaja(cajas: CajaEnEdicion[], numero: number): CajaEnEdicion[] {
  return cajas
    .filter((c) => c.numero !== numero)
    .sort((a, b) => a.numero - b.numero)
    .map((c, i) => ({ ...c, numero: i + 1 }))
}

export function ponerMedida(cajas: CajaEnEdicion[], numero: number, campo: CampoDeMedida, valor: number | null): CajaEnEdicion[] {
  return conLaCaja(cajas, numero, (c) => ({ ...c, [campo]: valor }))
}

/**
 * Fija cuántas unidades de un SKU hay en una caja. Se ajusta a lo posible —entre 0 y lo que queda por
 * encajar más lo que ya hay en esta caja— y cero quita la línea. Una línea nueva va al final y una
 * que ya estaba conserva su sitio, para que al teclear no salte de posición.
 */
export function ponerUnidades(cajas: CajaEnEdicion[], lineas: LineaParaEncajar[], numero: number, sku: string, pedidas: number): CajaEnEdicion[] {
  const unidades = Math.min(Math.max(0, Math.floor(Number.isFinite(pedidas) ? pedidas : 0)), maximoEnCaja(lineas, cajas, numero, sku))
  return conLaCaja(cajas, numero, (c) => {
    const estaba = c.contenido.some((x) => x.sku === sku)
    if (unidades === 0) return { ...c, contenido: c.contenido.filter((x) => x.sku !== sku) }
    return { ...c, contenido: estaba ? c.contenido.map((x) => (x.sku === sku ? { sku, unidades } : x)) : [...c.contenido, { sku, unidades }] }
  })
}

/** Mete en la caja todo lo que falta de ese SKU (se suma a lo que ya hubiera) */
export function meterPendientes(cajas: CajaEnEdicion[], lineas: LineaParaEncajar[], numero: number, sku: string): CajaEnEdicion[] {
  const pendientes = pendientesDe(lineas, cajas, sku)
  if (pendientes === 0) return cajas
  const caja = cajas.find((c) => c.numero === numero)
  return caja ? ponerUnidades(cajas, lineas, numero, sku, unidadesDe(caja, sku) + pendientes) : cajas
}

/** Mete en la caja todo lo que falta de TODAS las referencias: para el envío que cabe en una sola caja */
export function meterTodoLoPendiente(cajas: CajaEnEdicion[], lineas: LineaParaEncajar[], numero: number): CajaEnEdicion[] {
  return lineas.reduce((acc, l) => meterPendientes(acc, lineas, numero, l.sku), cajas)
}

/** Pasa las unidades de un SKU de una caja a otra. Si en la de destino ya había de ese SKU, se suman */
export function moverLinea(cajas: CajaEnEdicion[], sku: string, desde: number, hasta: number): CajaEnEdicion[] {
  if (desde === hasta) return cajas
  const origen = cajas.find((c) => c.numero === desde)
  const destino = cajas.find((c) => c.numero === hasta)
  const unidades = origen ? unidadesDe(origen, sku) : 0
  if (!origen || !destino || unidades === 0) return cajas
  return cajas.map((c) => {
    if (c.numero === desde) return { ...c, contenido: c.contenido.filter((x) => x.sku !== sku) }
    if (c.numero === hasta) {
      const yaHabia = c.contenido.some((x) => x.sku === sku)
      return { ...c, contenido: yaHabia ? c.contenido.map((x) => (x.sku === sku ? { sku, unidades: x.unidades + unidades } : x)) : [...c.contenido, { sku, unidades }] }
    }
    return c
  })
}
