/**
 * FACTURAR UN MES ENTERO DESDE UNA SOLA PANTALLA.
 *
 * El recorrido que sustituye, tal y como se hacía a mano y por cliente:
 * bajar los ficheros de Seller Central, subirlos a la calculadora, copiar el
 * enlace del desglose, montar la factura fuera del ERP, copiar su enlace,
 * abrir el correo y pegarlo todo en una plantilla. Once clientes, un día.
 *
 * Aquí eso son tres estados y un botón por cliente.
 */

/** Quién emite. Una sola fila en la base: `billing_issuer` (migración 176). */
export interface Emisor {
  legal_name: string
  tax_id: string
  address: string
  email: string
  phone: string | null
  bank_name: string | null
  iban: string | null
  bic: string | null
  invoice_prefix: string
  footer_note: string | null
}

/**
 * En qué punto está el mes de un cliente.
 *
 * Es una escalera, no un conjunto de casillas: no se puede enviar lo que no
 * está emitido, ni cobrar lo que no se ha enviado. Tenerlo como un solo valor
 * —en vez de tres booleanos sueltos— impide que la pantalla muestre estados
 * que no existen, como «enviada» sin factura.
 */
export type EstadoFacturacion =
  /** Ni importes ni factura: no hay nada que facturar todavía */
  | 'sin_importes'
  /** Hay importes puestos en Tesorería, falta emitir */
  | 'por_emitir'
  /** Factura emitida, todavía sin mandar */
  | 'emitida'
  /** Correo enviado al cliente */
  | 'enviada'
  /** Marcada como cobrada en Tesorería */
  | 'cobrada'

export const ETIQUETA_ESTADO: Record<EstadoFacturacion, string> = {
  sin_importes: 'Sin importes',
  por_emitir: 'Por emitir',
  emitida: 'Emitida',
  enviada: 'Enviada',
  cobrada: 'Cobrada',
}

/** Una fila de la pantalla: un cliente y su mes */
export interface FilaFacturacion {
  treasuryClientId: string
  nombre: string
  email: string | null
  emailAlt: string | null
  taxId: string | null
  taxAddress: string | null
  vatRate: number
  feeConcept: string | null
  /** Lo apuntado en Tesorería para ese mes */
  fee: number | null
  comision: number | null
  cobrado: boolean
  /**
   * La casilla «Enviado» de Tesorería, que hasta ahora se pulsaba a mano.
   *
   * Se trae porque durante la mudanza va a haber meses marcados como enviados
   * SIN factura en el ERP: son los que se mandaron desde fuera. Sin este dato,
   * la pantalla los enseñaría como «por emitir» y se le acabaría mandando al
   * cliente una segunda factura del mismo mes.
   */
  marcadoEnviadoAMano: boolean
  estado: EstadoFacturacion
  /** La factura de ese mes, si ya se emitió */
  factura: {
    id: string
    numero: string
    total: number
    estado: string
    emailEnviadoEl: string | null
    reportUrl: string | null
  } | null
  /**
   * El desglose público que le corresponde, buscado por nombre y periodo.
   *
   * Puede ser null y no pasa nada: hay clientes de cuota fija que no llevan
   * comisión y por tanto no tienen desglose que enseñar.
   */
  desglose: {
    slug: string
    periodo: string | null
    url: string
  } | null
}

/**
 * NORMALIZAR UN NOMBRE PARA PODER CRUZARLO.
 *
 * Tesorería y la calculadora de comisiones son DOS LISTAS DE CLIENTES
 * distintas —«SHOPLAMP» en una, «Shoplamp» en la otra— y unificarlas está
 * pendiente desde hace tiempo. Mientras tanto, el desglose se encuentra
 * comparando nombres normalizados, que es como ya lo hace la migración 163
 * para enlazar clientes de Amazon.
 *
 * Es una heurística, no una verdad: por eso la pantalla enseña qué desglose ha
 * encontrado y deja quitarlo. Un enlace equivocado en un correo a un cliente es
 * peor que no mandar enlace.
 */
export function normalizarNombre(valor: string): string {
  return valor
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** 2026-09-01 -> «septiembre de 2026» */
export function nombreDelMes(period: string): string {
  const [a, m] = period.split('-').map(Number)
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ]
  return `${meses[(m || 1) - 1]} de ${a}`
}
