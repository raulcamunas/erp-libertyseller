/**
 * PLATAFORMA · MÓDULO A2 — A QUIÉN LE TOCA EL FOEP ESTA NOCHE
 * ===========================================================
 * FUNCIONES PURAS.
 *
 *
 * ============ POR QUÉ EXISTE ESTE FICHERO ============
 *
 * `getFeaturedOfferExpectedPriceBatch` va a UNA PETICIÓN CADA TREINTA SEGUNDOS.
 * Con 40 SKU por llamada, las 13.700 referencias del cliente grande son 343
 * llamadas: 2 HORAS Y 53 MINUTOS por marketplace. En España más Alemania,
 * Francia e Italia —que comparten cubeta— once horas y media. No cabe en ninguna
 * ventana nocturna, ni en dos.
 *
 * Las ofertas, en cambio, se barren enteras en 23 minutos por marketplace. Así
 * que el diseño que sí cabe, y que es el que recomienda la propia documentación
 * de Amazon («rely on push notifications instead of polling mechanisms»), es:
 *
 *   · OFERTAS  -> barrido completo cada noche.
 *   · FOEP     -> rotación: a cada SKU le toca cada N noches. Con N = 7 son 25
 *                 minutos por noche en vez de tres horas.
 *              -> MÁS una cola que adelanta el turno de los SKU que acaban de
 *                 perder la oferta destacada, que son los que necesitan el techo
 *                 hoy y no dentro de seis días.
 *
 *
 * ============ POR QUÉ LA ROTACIÓN VA POR HASH Y NO POR ORDEN ============
 *
 * Porque tiene que ser DETERMINISTA y REPARTIDA a la vez:
 *
 *   · determinista -> el mismo SKU cae siempre en el mismo día de la rotación,
 *     así que su serie de FOEP tiene un paso regular. Con un reparto aleatorio,
 *     un SKU podría pasar dos semanas sin techo por mala suerte y otro tenerlo
 *     dos noches seguidas, y la serie no se podría interpretar.
 *
 *   · repartida -> «los primeros 2.000 SKU del alfabeto el lunes» agrupa por
 *     marca (los SKU suelen llevar prefijo de proveedor), y entonces el lunes se
 *     mide una marca entera y el martes otra. Cualquier comparación entre marcas
 *     saldría movida por el día de medición y no por el mercado.
 *
 * El hash es FNV-1a de 32 bits, escrito a mano: no hace falta criptografía —esto
 * reparte, no protege— y no se arrastra una dependencia por catorce líneas.
 */

/**
 * El día de rotación de una fecha.
 *
 * Días enteros desde la época, EN UTC. Se usa UTC y no la hora local a propósito:
 * el contenedor puede estar en otra zona que el cliente, y con hora local el
 * cambio de día se movería dos veces al año con el horario de verano — un SKU se
 * quedaría sin su turno o le tocaría dos veces esa noche.
 */
export function diaDeRotacion(fecha: Date): number {
  return Math.floor(fecha.getTime() / 86400000)
}

/** FNV-1a de 32 bits. Reparte, no protege */
export function hashSku(sku: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < sku.length; i++) {
    h ^= sku.charCodeAt(i)
    // El desplazamiento es la multiplicación por 16777619 sin desbordar a doble.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

/**
 * ¿Le toca hoy a este SKU?
 *
 * Con `rotacionDias <= 1` le toca a todos todas las noches, que es lo correcto
 * para un cliente de catálogo corto: 400 referencias son 10 llamadas, cinco
 * minutos, y no hay razón para repartirlas.
 */
export function leTocaFoep(sku: string, dia: number, rotacionDias: number): boolean {
  if (rotacionDias <= 1) return true
  return hashSku(sku) % rotacionDias === ((dia % rotacionDias) + rotacionDias) % rotacionDias
}

/**
 * Cuánto se tarda en pedir el FOEP de N referencias.
 *
 * Está aquí y no en un comentario porque la pantalla lo enseña: quien configura
 * la rotación tiene que ver el precio de lo que está eligiendo, en minutos, con
 * su catálogo real delante. Un «7 días» sin el número al lado es una casilla
 * más; con «esto son 25 minutos por noche en vez de 2 h 53 min» es una decisión.
 */
export function minutosDeFoep(skus: number, porLlamada = 40, segundosPorLlamada = 30.3): number {
  if (skus <= 0) return 0
  return Math.round((Math.ceil(skus / porLlamada) * segundosPorLlamada) / 60)
}

/** Lo mismo para el barrido de ofertas: 20 por llamada, una cada 2 segundos */
export function minutosDeOfertas(skus: number): number {
  if (skus <= 0) return 0
  return Math.round((Math.ceil(skus / 20) * 2) / 60)
}

/* ------------------------------------------------------------------ */
/* La cadencia automática                                              */
/* ------------------------------------------------------------------ */

/**
 * Los saltos a los que se redondea.
 *
 * Se enseña en pantalla y se lee en voz alta, así que «cada 64 minutos» no vale:
 * nadie razona con ese número. Se sube al siguiente escalón de esta lista, que
 * son todos divisores o múltiplos cómodos del día.
 */
const ESCALONES = [15, 30, 60, 120, 180, 240, 360, 480, 720, 1440, 2880, 4320]

/** Nunca por debajo de esto, aunque el catálogo sea de cuatro referencias */
export const FOEP_MINUTOS_SUELO = 15

/**
 * CADA CUÁNTO PEDIR EL FOEP, CALCULADO A PARTIR DE CUÁNTAS REFERENCIAS HAY.
 *
 * La regla es una: **la cadencia tiene que ser mayor que lo que tarda un
 * barrido**. Si son iguales, la pasada siguiente arranca antes de que termine la
 * anterior y el trabajo no alcanza nunca — no daría error, simplemente iría
 * acumulando retraso para siempre.
 *
 * Se usa el DOBLE del barrido, y ese factor no es prudencia genérica: la otra
 * mitad del tiempo la necesita LA COLA. Cuando el barrido de ofertas ve que un
 * SKU ha perdido la oferta destacada, ese SKU pide FOEP inmediatamente y se
 * salta la rotación. Sin holgura, la cola y el barrido se pelean por el mismo
 * cupo y el que pierde es el que corre urgente.
 *
 * El cálculo entra por parámetro y sale un número: sin reloj, sin base y sin
 * red. Con 2.500 referencias con stock son 63 llamadas → 32 minutos de barrido →
 * cadencia de 64 → escalón de 120.
 */
export function cadenciaFoepAutomatica(skusConStock: number): number {
  if (skusConStock <= 0) return ESCALONES[ESCALONES.length - 1]
  const barrido = minutosDeFoep(skusConStock)
  const conHolgura = Math.max(FOEP_MINUTOS_SUELO, barrido * 2)
  return ESCALONES.find((e) => e >= conHolgura) ?? ESCALONES[ESCALONES.length - 1]
}

/**
 * Por qué ha salido ese número, en una frase para la pantalla.
 *
 * Un automatismo que decide sin decir por qué se desactiva a la primera vez que
 * alguien no entiende un número: aquí la cuenta cabe en una línea, así que se
 * enseña y deja de ser magia.
 */
export function porQueEsaCadencia(skusConStock: number): string {
  if (skusConStock <= 0) {
    /**
     * Se dice DÓNDE mirar, no solo que salió cero.
     *
     * Un cero aquí casi nunca significa que el cliente no tenga existencias:
     * significa que el catálogo no se ha leído todavía, o que la cuenta se quedó
     * mirando la población equivocada —que es lo que pasó—. Un mensaje que
     * afirma «no hay stock» delante de una pantalla con medio catálogo con
     * existencias no es un aviso, es un desmentido de lo que se está viendo.
     */
    return (
      'Ninguna referencia con existencias en el espejo del catálogo, así que no hay nada que ' +
      'preguntar. Si el cliente sí tiene stock, es que el censo todavía no ha corrido.'
    )
  }
  const llamadas = Math.ceil(skusConStock / 40)
  const barrido = minutosDeFoep(skusConStock)
  return (
    `${skusConStock} referencias con stock son ${llamadas} llamadas a una cada 30 s: ` +
    `${barrido} min por barrido. Se deja el doble para que quepa también la cola de los que ` +
    'acaban de perder la Buy Box.'
  )
}
