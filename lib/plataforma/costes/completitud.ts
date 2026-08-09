/**
 * ¿ESTE COSTE VALE PARA CALCULAR UN MARGEN? — DOMINIO PURO
 * =======================================================
 * Sin base de datos y sin reloj. Es la pieza de A5 de la que cuelga todo lo
 * demás: la pantalla de cobertura, la ficha de un SKU y —cuando se construyan—
 * el margen de A3 y la comparación FBM↔FBA de A4.
 *
 *
 * ============ LA REGLA, Y POR QUÉ ES TERNARIA Y NO BOOLEANA ============
 *
 * Un SKU está en uno de tres sitios, nunca en dos:
 *
 *   · SIN COSTE     — no hay ninguna fila de coste vigente en esa fecha. No es
 *                     un coste de cero: es que no lo sabemos.
 *   · INCOMPLETO    — sabemos lo que costó comprarlo y NO sabemos lo que cuesta
 *                     ponerlo en manos del cliente final.
 *   · COMPLETO      — están todas las patas del canal por el que se vende.
 *
 * Y `total` vale null en los dos primeros casos. SIEMPRE. Es lo que impide el
 * fallo que este módulo existe para evitar: un margen calculado sobre un coste a
 * medias sale mejor que el real, es perfectamente creíble y acaba en una
 * presentación para el cliente. Un hueco se ve; un número inflado, no.
 *
 *
 * ============ QUÉ PATAS HACEN FALTA, Y POR QUÉ ============
 *
 * Salen del estudio de la SP-API, no de una opinión:
 *
 *   ENVÍO PROPIO (FBM y SFP) → hace falta `coste_envio`.
 *     El FOEP de Amazon es PRECIO DE LISTING, SIN ENVÍO. Cuando el paquete sale
 *     de nuestro almacén, el porte lo pagamos nosotros y no aparece en ninguna
 *     respuesta de la API. Sin esa cifra el margen de todo el catálogo FBM se
 *     calcula como si mandar un paquete fuera gratis — y el cliente de 13.700
 *     referencias es justo el que más FBM tiene.
 *
 *   FBA → hacen falta `coste_almacen_fba` y `coste_flete_fba`.
 *     Las tarifas que devuelve Product Fees NO incluyen ni el almacenamiento
 *     mensual ni el flete de entrada al centro logístico. Si al canal propio se
 *     le descuenta un coste real y al de Amazon no, la comparación entre los dos
 *     está amañada a favor de FBA antes de empezar, y lo que sale de ahí es una
 *     recomendación de mandar inventario a un almacén de Amazon.
 *
 * Las dos exigencias se pueden APAGAR por cliente (`PoliticaCostes`), porque hay
 * casos legítimos: el cliente cuyo porte paga íntegro el comprador, o el que
 * negocia el flete dentro del precio de compra. Apagarlas es una decisión que
 * queda escrita en la política, no un descuido que se hereda en silencio.
 */

import type { CanalCoste, CosteA5, PoliticaCostes } from './tipos'

/* ------------------------------------------------------------------ */
/* Lo mínimo que hace falta de un coste                                */
/* ------------------------------------------------------------------ */

/**
 * El subconjunto de campos que juzga esta función.
 *
 * Es un `Pick` y no `CosteA5` entero para que se pueda evaluar una fila que
 * todavía no está guardada —la que va a escribir una importación, la que alguien
 * está tecleando en la pantalla— sin inventarle un id ni una fecha de creación.
 */
export type CosteEvaluable = Pick<
  CosteA5,
  | 'coste'
  | 'moneda'
  | 'coste_envio'
  | 'coste_almacen_fba'
  | 'coste_flete_fba'
  | 'iva_incluido'
  | 'iva_porcentaje'
>

export type EstadoCoste = 'sin_coste' | 'incompleto' | 'completo'

export const ESTADO_COSTE_LABELS: Record<EstadoCoste, string> = {
  sin_coste: 'Sin coste',
  incompleto: 'Incompleto',
  completo: 'Completo',
}

/** Una pata que falta, con su nombre en pantalla y por qué importa */
export interface FaltaCoste {
  campo: 'coste' | 'coste_envio' | 'coste_almacen_fba' | 'coste_flete_fba' | 'iva_porcentaje'
  etiqueta: string
  porque: string
}

export const ETIQUETA_PATA: Record<FaltaCoste['campo'], string> = {
  coste: 'precio de compra',
  coste_envio: 'coste de envío',
  coste_almacen_fba: 'almacenamiento en Amazon',
  coste_flete_fba: 'flete de entrada',
  iva_porcentaje: 'tipo de IVA',
}

export interface VeredictoCoste {
  estado: EstadoCoste
  /** Qué falta para poder dar un número. Vacío cuando el estado es 'completo' */
  faltan: FaltaCoste[]
  /**
   * El coste unitario TOTAL en la divisa del coste.
   *
   * null en cuanto el estado no es 'completo'. Nunca un parcial, y nunca cero:
   * quien lo consuma tiene que quedarse sin número, no con un número optimista.
   */
  total: number | null
  /** El precio de compra ya sin IVA. null si no se puede saber */
  base: number | null
  moneda: string | null
  /** Frase en español lista para pantalla. Es lo que se enseña en vez del hueco */
  motivo: string
}

/** Qué patas exige este cliente. Sale de `PoliticaCostes` */
export interface Exigencias {
  envioPropio: boolean
  costesFba: boolean
}

export function exigenciasDe(politica: Pick<PoliticaCostes, 'exigir_envio_propio' | 'exigir_costes_fba'>): Exigencias {
  return { envioPropio: politica.exigir_envio_propio, costesFba: politica.exigir_costes_fba }
}

/** Lo estricto, que es lo que se aplica mientras nadie diga lo contrario */
export const EXIGENCIAS_ESTRICTAS: Exigencias = { envioPropio: true, costesFba: true }

/* ------------------------------------------------------------------ */
/* La base imponible                                                   */
/* ------------------------------------------------------------------ */

/**
 * El precio de compra sin IVA.
 *
 * Devuelve null —y no el importe tal cual— cuando el coste viene con IVA y no
 * consta el tipo. Dar por bueno el bruto infla el coste un 21 % y hunde el
 * margen calculado; suponer un 21 % es inventarse un dato que ningún endpoint de
 * la SP-API da con los roles que tenemos, y que además cambia por país y por
 * categoría. Entre las dos, no dar número.
 */
export function costeBase(coste: Pick<CosteEvaluable, 'coste' | 'iva_incluido' | 'iva_porcentaje'>): number | null {
  if (!Number.isFinite(coste.coste)) return null
  if (!coste.iva_incluido) return coste.coste

  const tipo = coste.iva_porcentaje
  if (tipo === null || !Number.isFinite(tipo) || tipo < 0 || tipo >= 100) return null
  return coste.coste / (1 + tipo / 100)
}

/* ------------------------------------------------------------------ */
/* El veredicto                                                        */
/* ------------------------------------------------------------------ */

/**
 * Juzga un coste para un canal concreto.
 *
 * `coste` es null cuando no hay ningún tramo vigente en la fecha que se está
 * mirando — que es lo que devuelve costeVigente() de A1 y NO es lo mismo que un
 * coste de cero.
 */
export function evaluarCoste(
  coste: CosteEvaluable | null,
  canal: CanalCoste,
  exigencias: Exigencias = EXIGENCIAS_ESTRICTAS
): VeredictoCoste {
  if (coste === null) {
    return {
      estado: 'sin_coste',
      faltan: [
        {
          campo: 'coste',
          etiqueta: ETIQUETA_PATA.coste,
          porque:
            'Amazon no sabe lo que costó comprar el producto: lo tiene el cliente. ' +
            'Sin él no hay margen que calcular.',
        },
      ],
      total: null,
      base: null,
      moneda: null,
      motivo:
        'No hay ningún coste vigente para este SKU en esta fecha. No es un coste de cero: es que no lo sabemos.',
    }
  }

  const faltan: FaltaCoste[] = []
  const base = costeBase(coste)

  if (base === null) {
    faltan.push({
      campo: 'iva_porcentaje',
      etiqueta: ETIQUETA_PATA.iva_porcentaje,
      porque:
        'El coste viene con IVA incluido y no consta el tipo, así que no se puede llevar a base imponible. ' +
        'Ningún endpoint de la SP-API da el tipo de IVA con los roles que tenemos: es un dato de configuración.',
    })
  }

  if (canal === 'propio' && exigencias.envioPropio && coste.coste_envio === null) {
    faltan.push({
      campo: 'coste_envio',
      etiqueta: ETIQUETA_PATA.coste_envio,
      porque:
        'El SKU lo enviamos nosotros, y el precio destacado que calcula Amazon (FOEP) es precio de listing SIN ENVÍO. ' +
        'Sin esta cifra, el margen se calcula como si mandar el paquete fuera gratis.',
    })
  }

  if (canal === 'fba' && exigencias.costesFba) {
    if (coste.coste_almacen_fba === null) {
      faltan.push({
        campo: 'coste_almacen_fba',
        etiqueta: ETIQUETA_PATA.coste_almacen_fba,
        porque:
          'Las tarifas que devuelve Product Fees no incluyen el almacenamiento. Sin él, comparar FBM contra FBA sale a favor de FBA por construcción.',
      })
    }
    if (coste.coste_flete_fba === null) {
      faltan.push({
        campo: 'coste_flete_fba',
        etiqueta: ETIQUETA_PATA.coste_flete_fba,
        porque:
          'Product Fees tampoco incluye el flete de entrada al centro logístico, y meter inventario en Amazon cuesta dinero antes de vender una unidad.',
      })
    }
  }

  if (faltan.length > 0) {
    return {
      estado: 'incompleto',
      faltan,
      total: null,
      base,
      moneda: coste.moneda,
      motivo:
        `Se sabe lo que costó comprarlo, pero falta ${listar(faltan.map((f) => f.etiqueta))}. ` +
        'El margen no se calcula con lo que hay: saldría mejor que el de verdad.',
    }
  }

  // A partir de aquí `base` no puede ser null: si lo fuera, habría entrado en
  // `faltan` justo arriba. El operador ?? 0 NO está aquí a propósito — si algún
  // día esta invariante se rompiera, se vería en el tipo antes que en un margen.
  const total =
    (base as number) +
    (canal === 'propio' ? (coste.coste_envio ?? 0) : 0) +
    (canal === 'fba' ? (coste.coste_almacen_fba ?? 0) + (coste.coste_flete_fba ?? 0) : 0)

  return {
    estado: 'completo',
    faltan: [],
    total,
    base,
    moneda: coste.moneda,
    motivo:
      canal === 'propio'
        ? 'Precio de compra sin IVA más el porte que pagamos nosotros.'
        : 'Precio de compra sin IVA más almacenamiento y flete de entrada.',
  }
}

/**
 * El mismo coste juzgado para VARIOS canales a la vez.
 *
 * Hace falta porque un SKU puede estar en FBA en un país y salir de nuestro
 * almacén en otro —pasa en cuanto un cliente abre un segundo marketplace sin
 * mandar inventario allí— y entonces necesita las patas de los dos: el porte del
 * país donde enviamos nosotros Y el almacenamiento del país donde está en FBA.
 *
 * Se queda con el veredicto MÁS ESTRICTO y junta lo que falta sin repetirlo. El
 * `total` solo sale cuando los dos canales lo dan, y cuando los dos dan número y
 * son distintos, se devuelve null: un coste unitario único para dos canales con
 * costes distintos sería una media que no significa nada. Quien necesite el
 * número de un canal concreto llama a evaluarCoste() con ese canal, que es lo
 * que hará A4 cuando compare FBM contra FBA.
 */
export function evaluarCosteEnCanales(
  coste: CosteEvaluable | null,
  canales: CanalCoste[],
  exigencias: Exigencias = EXIGENCIAS_ESTRICTAS
): VeredictoCoste {
  if (canales.length === 0) return evaluarCoste(coste, 'propio', exigencias)
  if (canales.length === 1) return evaluarCoste(coste, canales[0], exigencias)

  const veredictos = canales.map((canal) => evaluarCoste(coste, canal, exigencias))
  const peor = veredictos.find((v) => v.estado === 'sin_coste') ??
    veredictos.find((v) => v.estado === 'incompleto')

  if (peor) {
    const vistos = new Set<string>()
    const faltan: FaltaCoste[] = []
    for (const veredicto of veredictos) {
      for (const falta of veredicto.faltan) {
        if (vistos.has(falta.campo)) continue
        vistos.add(falta.campo)
        faltan.push(falta)
      }
    }
    return { ...peor, faltan }
  }

  const totales = new Set(veredictos.map((v) => Math.round((v.total as number) * 1e6)))
  return {
    ...veredictos[0],
    total: totales.size === 1 ? veredictos[0].total : null,
    motivo:
      totales.size === 1
        ? veredictos[0].motivo
        : 'Este SKU se vende por los dos canales y su coste total no es el mismo en cada uno. Mira el margen por canal, no en conjunto.',
  }
}

/**
 * La frase que hay que enseñar donde iría un margen que no se puede calcular.
 *
 * Existe por la misma razón que porQueSinBsr() en modelo-negocio.ts: un hueco
 * explicado no es un hueco, y uno sin explicar parece una avería. Quien consuma
 * esto —A3 y A4— tiene que enseñar ESTA frase, no un cero ni un guion.
 */
export function porQueSinMargen(veredicto: VeredictoCoste, sku: string): string {
  if (veredicto.estado === 'completo') return ''
  if (veredicto.estado === 'sin_coste') {
    return `${sku}: no evaluable, no tenemos su coste. El coste no está en Amazon, lo manda el cliente en su fichero.`
  }
  return `${sku}: no evaluable, el coste está incompleto (falta ${listar(
    veredicto.faltan.map((f) => f.etiqueta)
  )}).`
}

/* ------------------------------------------------------------------ */
/* La cobertura de un cliente                                          */
/* ------------------------------------------------------------------ */

/**
 * Lo que devuelve la función SQL `plataforma_cobertura_costes`, fila a fila.
 *
 * Son HECHOS, no veredictos: la función de Postgres cuenta predicados concretos
 * y el veredicto se compone AQUÍ, con la misma regla que juzga un coste suelto.
 * Si la regla viviera también en el SQL habría dos, y el día que cambie una sola
 * de las dos la pantalla de cobertura diría una cosa y la ficha del SKU otra.
 */
export interface FilaCoberturaCostes {
  connection_id: string
  marketplace_id: string
  skus: number
  en_seguimiento: number
  con_coste: number
  sin_coste: number
  propio_sin_envio: number
  fba_sin_almacen: number
  fba_sin_flete: number
  con_iva_sin_tipo: number
  monedas: string[]
  coste_mas_antiguo: string | null
  coste_mas_nuevo: string | null
  dias_mediana: number | null
}

export interface ResumenCobertura extends FilaCoberturaCostes {
  /**
   * SKU con coste al que le falta alguna pata.
   *
   * COTA SUPERIOR, no cifra exacta, y hay que decirlo donde se enseñe: un mismo
   * SKU de FBA puede estar contado a la vez en `fba_sin_almacen` y en
   * `fba_sin_flete`. Contar los distintos de verdad obligaría a traerse el
   * catálogo entero al servidor, que es exactamente lo que la función SQL evita.
   * Para lo que sirve la cifra —saber si el margen de este cliente es fiable—
   * una cota superior es suficiente y es la prudente.
   */
  incompletosMax: number
  /** Los que dan número: tienen coste y no les falta ninguna pata */
  completosMin: number
  /** 0..1. null cuando no hay ningún SKU que medir */
  cobertura: number | null
  /** 0..1 sobre los que además están completos */
  coberturaCompleta: number | null
}

export function clasificarCobertura(
  fila: FilaCoberturaCostes,
  exigencias: Exigencias = EXIGENCIAS_ESTRICTAS
): ResumenCobertura {
  const incompletosMax =
    (exigencias.envioPropio ? fila.propio_sin_envio : 0) +
    (exigencias.costesFba ? fila.fba_sin_almacen + fila.fba_sin_flete : 0) +
    fila.con_iva_sin_tipo

  // El tope: no puede haber más incompletos que SKU con coste. La suma de arriba
  // puede pasarse porque un mismo SKU cuenta en dos predicados.
  const acotado = Math.min(incompletosMax, fila.con_coste)

  return {
    ...fila,
    incompletosMax: acotado,
    completosMin: Math.max(0, fila.con_coste - acotado),
    cobertura: fila.skus === 0 ? null : fila.con_coste / fila.skus,
    coberturaCompleta: fila.skus === 0 ? null : Math.max(0, fila.con_coste - acotado) / fila.skus,
  }
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

/** «a», «a y b», «a, b y c» */
function listar(partes: string[]): string {
  if (partes.length === 0) return ''
  if (partes.length === 1) return partes[0]
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}
