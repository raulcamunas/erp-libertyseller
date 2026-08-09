/**
 * PLATAFORMA · MÓDULO A4 — EL IMPUESTO DEL MARKETPLACE. DOMINIO PURO.
 * ==================================================================
 * Sin base de datos y sin reloj. Aquí no hay ni una consulta: entran parámetros
 * y sale si se puede llevar un precio a base imponible o no.
 *
 *
 * =====================================================================
 *  ██  POR QUÉ ESTO ES UN FICHERO Y NO UN `/ 1.21` EN LA FÓRMULA  ██
 * =====================================================================
 *
 * La fórmula del margen que pide la especificación empieza así:
 *
 *     margen = FOEP / (1 + IVA) - coste - referral - fba_fee
 *
 * Y ese `(1 + IVA)` esconde DOS decisiones distintas, no una:
 *
 *   1. CUÁNTO ES EL IVA. Cambia por país y por categoría, y NINGÚN endpoint de
 *      la SP-API lo da con los roles que tenemos: los informes de IVA están
 *      detrás de roles fiscales restringidos que no están concedidos. Así que es
 *      forzosamente una tabla de configuración, con fecha de vigencia y con
 *      dueño, porque los tipos cambian por ley y el margen de marzo se calcula
 *      con el tipo de marzo.
 *
 *   2. SI EL PRECIO LO LLEVA DENTRO. En la Unión Europea el precio que se ve en
 *      la ficha —y el que devuelve `listingPrice`— es CON impuesto. En Estados
 *      Unidos el sales tax va FUERA y se añade en la pasarela de pago. DIVIDIR
 *      POR (1 + IVA) EN ESTADOS UNIDOS ES UN ERROR QUE HUNDE EL MARGEN un 20 %
 *      sin dar ningún aviso, y no dividir en España lo infla otro tanto.
 *
 * Las dos son datos que alguien tiene que escribir. Mientras no estén escritas,
 * ESTE MÓDULO NO DA NÚMERO. No hay valor por defecto y no es pereza: un margen
 * calculado con un IVA supuesto es indistinguible de uno calculado con el de
 * verdad, y acaba en una presentación para el cliente.
 *
 *
 * =====================================================================
 *  LA SUGERENCIA NO ES UN VALOR POR DEFECTO
 * =====================================================================
 *
 * `SUGERENCIA_FISCAL` de aquí abajo existe para que rellenar la ficha de un
 * marketplace conocido sea un clic y no una búsqueda. NO LA USA EL MOTOR. La
 * lee la pantalla, la enseña como propuesta y hace falta que una persona la
 * guarde para que exista; a partir de ahí la fila tiene fecha de vigencia y
 * dueño, que es lo que convierte un número en un dato auditable.
 */

/* ------------------------------------------------------------------ */
/* 1. Los parámetros                                                   */
/* ------------------------------------------------------------------ */

/**
 * Lo que hace falta saber del impuesto de UN marketplace para poder calcular un
 * margen.
 *
 * Los dos campos son ANULABLES y los dos hacen falta. `false` y `null` NO son lo
 * mismo en `precioIncluyeImpuesto`: `false` es «aquí el impuesto va fuera, lo
 * sabemos»; `null` es «nadie lo ha dicho», y con `null` no se calcula nada.
 */
export interface ParametrosFiscales {
  marketplaceId: string
  /** Tanto por ciento. null = NADIE LO HA CONFIGURADO. Nunca 0 por descuido */
  ivaPorcentaje: number | null
  /** ¿El precio de listing lleva el impuesto dentro? null = sin decidir */
  precioIncluyeImpuesto: boolean | null
  /** Desde cuándo rige, 'YYYY-MM-DD'. Los tipos cambian por ley */
  validoDesde: string | null
  /** Quién lo puso. Un tipo impositivo sin dueño no se puede auditar */
  actualizadoPor: string | null
  /** Si viene de la fila general (sin cliente) o de una excepción del cliente */
  ambito: 'cliente' | 'general' | 'sin_configurar'
  notas: string | null
}

/** Un marketplace del que no se ha configurado nada. Es el estado de arranque */
export function fiscalSinConfigurar(marketplaceId: string): ParametrosFiscales {
  return {
    marketplaceId,
    ivaPorcentaje: null,
    precioIncluyeImpuesto: null,
    validoDesde: null,
    actualizadoPor: null,
    ambito: 'sin_configurar',
    notas: null,
  }
}

/** ¿Se puede llevar un precio a base imponible con esto? */
export function fiscalCompleto(fiscal: ParametrosFiscales): boolean {
  return fiscal.precioIncluyeImpuesto !== null && (
    fiscal.precioIncluyeImpuesto === false || tipoValido(fiscal.ivaPorcentaje)
  )
}

function tipoValido(tipo: number | null): tipo is number {
  return tipo !== null && Number.isFinite(tipo) && tipo >= 0 && tipo < 100
}

/**
 * EL PRECIO SIN IMPUESTO. La pieza que rompe la fórmula si se escribe mal.
 *
 * Devuelve `null` —y no el precio tal cual— cuando falta cualquiera de los dos
 * parámetros. Devolver el bruto «mientras tanto» sería exactamente el error que
 * este fichero existe para impedir: en España infla el margen un 21 % y la
 * pantalla no da ningún aviso porque el número es perfectamente creíble.
 *
 * Y cuando el impuesto va fuera (Estados Unidos), NO SE DIVIDE: el precio de
 * listing ya es la base. Que el tipo esté a null en ese caso es correcto y no
 * bloquea nada.
 */
export function precioSinImpuesto(precio: number | null, fiscal: ParametrosFiscales): number | null {
  if (precio === null || !Number.isFinite(precio)) return null
  if (fiscal.precioIncluyeImpuesto === null) return null
  if (fiscal.precioIncluyeImpuesto === false) return precio
  if (!tipoValido(fiscal.ivaPorcentaje)) return null
  return precio / (1 + fiscal.ivaPorcentaje / 100)
}

/** Qué falta por configurar de un marketplace, en español y listo para pantalla */
export function faltaFiscal(fiscal: ParametrosFiscales): string[] {
  const falta: string[] = []
  if (fiscal.precioIncluyeImpuesto === null) {
    falta.push(
      'Si el precio de este marketplace lleva el impuesto dentro. En la Unión Europea sí; en ' +
        'Estados Unidos el impuesto va fuera y dividir por (1 + IVA) allí hunde el margen un 20 %.'
    )
  }
  if (fiscal.precioIncluyeImpuesto !== false && !tipoValido(fiscal.ivaPorcentaje)) {
    falta.push(
      'El tipo de IVA del marketplace. Ningún endpoint de Amazon lo da con los roles que tenemos: ' +
        'es una tabla de configuración con fecha de vigencia y dueño.'
    )
  }
  return falta
}

/* ------------------------------------------------------------------ */
/* 2. La sugerencia — QUE NO ES UN VALOR POR DEFECTO                   */
/* ------------------------------------------------------------------ */

export interface SugerenciaFiscal {
  ivaPorcentaje: number
  precioIncluyeImpuesto: boolean
  /** Por qué se propone eso. Se enseña al lado del campo, no se guarda sola */
  nota: string
}

/**
 * Lo que la pantalla PROPONE al rellenar un marketplace conocido.
 *
 * NO LO CONSUME EL MOTOR y no se guarda solo. Es el tipo general del país, que
 * es lo que aplica a la enorme mayoría del catálogo; los tipos reducidos —libros,
 * alimentación, farmacia— van por categoría y en ese caso hay que corregirlo a
 * mano, que es justo lo que dice la nota.
 *
 * Estados Unidos entra a propósito con IVA 0 y el impuesto FUERA: es el caso que
 * la fórmula de la especificación se come, y tenerlo en la lista hace que se vea
 * al configurarlo en vez de descubrirlo en un margen raro.
 */
export const SUGERENCIA_FISCAL: Record<string, SugerenciaFiscal> = {
  // --- Unión Europea y Reino Unido: el precio de listing va CON impuesto ---
  A1RKKUPIHCS9HS: { ivaPorcentaje: 21, precioIncluyeImpuesto: true, nota: 'Tipo general de España. Los reducidos (libros, alimentación) van por categoría y hay que corregirlos.' },
  A1PA6795UKMFR9: { ivaPorcentaje: 19, precioIncluyeImpuesto: true, nota: 'Tipo general de Alemania.' },
  A13V1IB3VIYZZH: { ivaPorcentaje: 20, precioIncluyeImpuesto: true, nota: 'Tipo general de Francia.' },
  APJ6JRA9NG5V4: { ivaPorcentaje: 22, precioIncluyeImpuesto: true, nota: 'Tipo general de Italia.' },
  A1805IZSGTT6HS: { ivaPorcentaje: 21, precioIncluyeImpuesto: true, nota: 'Tipo general de Países Bajos.' },
  A1F83G8C2ARO7P: { ivaPorcentaje: 20, precioIncluyeImpuesto: true, nota: 'Tipo general del Reino Unido.' },

  // --- Norteamérica: el impuesto va FUERA del precio de listing ---
  ATVPDKIKX0DER: { ivaPorcentaje: 0, precioIncluyeImpuesto: false, nota: 'En Estados Unidos el sales tax se añade en el pago y NO está en el precio de listing: no se divide.' },
  A2EUQ1WTGCTBG2: { ivaPorcentaje: 0, precioIncluyeImpuesto: false, nota: 'En Canadá los impuestos se añaden en el pago: no se dividen del precio de listing.' },
  A1AM78C64UM0Y8: { ivaPorcentaje: 0, precioIncluyeImpuesto: false, nota: 'En México el IVA suele venir incluido: COMPRUÉBALO antes de guardarlo tal cual.' },
}

export function sugerenciaFiscal(marketplaceId: string): SugerenciaFiscal | null {
  return SUGERENCIA_FISCAL[marketplaceId] ?? null
}
