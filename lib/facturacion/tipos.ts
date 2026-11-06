/**
 * FACTURAR, ENVIAR Y COBRAR CONTRA ZOHO BOOKS, DESDE UNA PANTALLA.
 *
 * Zoho guarda la factura; Tesorería dice cuánto se le cobra a cada cliente cada
 * mes. Esta pantalla los junta y escribe en Zoho, para no tener que entrar allí.
 */

/**
 * NORMALIZAR UN NOMBRE PARA PODER CRUZARLO.
 *
 * Tesorería y la calculadora de comisiones son dos listas de clientes distintas:
 * «SHOPLAMP» en una, «Shoplamp» en la otra. Lo usa Comisiones para encontrar la pareja.
 */
export function normalizarNombre(valor: string): string {
  return valor
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export type EstadoFila =
  /** Ni importes ni factura: este mes no hay nada que hacer */
  | 'sin_importes'
  /** Hay importes en Tesorería y aún no hay factura en Zoho */
  | 'por_crear'
  | 'borrador'
  | 'enviada'
  | 'parcial'
  | 'vencida'
  | 'cobrada'

export const ETIQUETA_ESTADO: Record<EstadoFila, string> = {
  sin_importes: 'Sin importes',
  por_crear: 'Por crear',
  borrador: 'Borrador',
  enviada: 'Enviada',
  parcial: 'Cobro parcial',
  vencida: 'Vencida',
  cobrada: 'Cobrada',
}

export interface FacturaZoho {
  id: string
  numero: string
  fecha: string
  vence: string | null
  total: number
  saldo: number
  moneda: string
  estadoZoho: string
}

export interface InformeDeComision {
  nombre: string
  url: string
  /** La comisión que dice el informe, sin redondear. null si no se puede leer (el de Keslem no la guarda ahí) */
  importe?: number | null
  /** Es una de las cuentas de un cliente que se factura junto (Tapas Party y Poker Shop) */
  cuenta?: boolean
}

/** Un cliente y su mes */
export interface FilaFacturacion {
  /** null: la factura está en Zoho, pero ese contacto no tiene cliente en Tesorería */
  treasuryClientId: string | null
  nombre: string
  contactoId: string | null
  contactoNombre: string | null
  contactoTieneCorreo: boolean
  /** Las direcciones de Tesorería, por si en Zoho no hay ninguna */
  correosTesoreria: string[]
  /** La pareja se ha deducido por el nombre y aún no está guardada */
  parejaDeducida: boolean
  fee: number | null
  comision: number | null
  totalTesoreria: number
  cobradoEnTesoreria: boolean
  estado: EstadoFila
  factura: FacturaZoho | null
  /** Otras facturas vivas del mismo cliente y mes */
  otrasFacturas: number
  /** Lo que se propone como número: «Creative Toys | Noviembre 2026» */
  numeroPropuesto: string
  informes: InformeDeComision[]
  /** Lo que no cuadra entre Zoho y Tesorería. Vacío si todo está bien */
  avisos: string[]
}

export interface ContactoZoho {
  id: string
  nombre: string
}

export interface Tablero {
  filas: FilaFacturacion[]
  contactos: ContactoZoho[]
  zohoOk: boolean
  errorZoho: string | null
  faltaMigracion: boolean
}

export interface LineaFactura {
  descripcion: string
  importe: number
}

/** Una factura con sus líneas, para editar el borrador */
export interface DetalleFactura extends FacturaZoho {
  lineas: LineaFactura[]
  plantillaPdfId: string | null
  contactoId: string
}

export interface DestinatarioZoho {
  email: string
  nombre: string
  marcado: boolean
}

export interface PlantillaResumen {
  id: string
  nombre: string
}

/** El correo de una factura, ya rellenado por Zoho con la plantilla elegida */
export interface CorreoPreparado {
  asunto: string
  cuerpo: string
  destinatarios: DestinatarioZoho[]
  cc: string[]
  plantillas: PlantillaResumen[]
  plantillaId: string
  plantillasPdf: PlantillaResumen[]
  plantillaPdfId: string | null
  estadoFactura: string
}

export interface PlantillaCompleta {
  id: string
  nombre: string
  asunto: string
  cuerpo: string
  esPorDefecto: boolean
  marcadores: { nombre: string; valor: string }[]
}

export interface FacturaPendiente extends FacturaZoho {
  clienteId: string
  cliente: string
  diasVencida: number
}

export interface CuentaBancaria {
  id: string
  nombre: string
  moneda: string
  monedaId: string
  saldo: number
  sinCategorizar: number
  esPayset: boolean
}

export interface MovimientoSinCategorizar {
  id: string
  cuentaId: string
  cuentaNombre: string
  fecha: string
  importe: number
  moneda: string
  /** Entra dinero (en Zoho, `debit`) o sale (`credit`) */
  entrada: boolean
  concepto: string
  referencia: string
}

export interface CuentaDeGasto {
  id: string
  nombre: string
}

export interface CobroReciente {
  id: string
  fecha: string
  cliente: string
  importe: number
  moneda: string
  referencia: string
  cuenta: string
}

export interface DatosDeCobros {
  pendientes: FacturaPendiente[]
  cuentas: CuentaBancaria[]
  movimientos: MovimientoSinCategorizar[]
  cuentasDeGasto: CuentaDeGasto[]
  cobros: CobroReciente[]
}

export type TipoRegistro =
  | 'borrador'
  | 'borrador_editado'
  | 'borrador_borrado'
  | 'envio'
  | 'cobro'
  | 'gasto'
  | 'plantilla'
  | 'contacto'

export interface FilaRegistro {
  id: string
  tipo: TipoRegistro
  numero: string | null
  cliente: string | null
  importe: number | null
  moneda: string | null
  detalle: Record<string, unknown>
  hecho_por_nombre: string | null
  creado_en: string
}

export const ETIQUETA_REGISTRO: Record<TipoRegistro, string> = {
  borrador: 'Borrador creado',
  borrador_editado: 'Borrador editado',
  borrador_borrado: 'Borrador borrado',
  envio: 'Factura enviada',
  cobro: 'Cobro registrado',
  gasto: 'Gasto registrado',
  plantilla: 'Plantilla guardada',
  contacto: 'Cliente enlazado',
}
