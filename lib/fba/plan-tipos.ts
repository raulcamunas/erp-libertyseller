/**
 * CONTRATO DEL PLANIFICADOR DE REPOSICIÓN FBA (spec remesas-pro §11.5).
 * Solo tipos. No se amplía desde un paquete: cualquier cambio pasa por el orquestador.
 */

export type Confianza = 'alta' | 'media' | 'baja' | 'sin_datos'
export type Prioridad = 'tarde' | 'urgente' | 'esta_semana' | 'proximas_2' | 'este_mes' | 'mas_adelante'
export type MotivoFuera =
  | 'sin_ventas' | 'descatalogada' | 'no_comprable' | 'sin_datos' | 'stock_de_sobra' | 'aun_no_toca'
  | 'cantidad_ridicula' | 'parado' | 'antiguo' | 'en_cuarentena' | 'agotado_largo' | 'talla_sin_ventas' | 'exceso'
export type OrigenEtapa = 'manual' | 'medido' | 'partida'
export type EstadoEnvioPropuesto = 'nuevo' | 'hablado' | 'esperando_cliente' | 'en_preparacion' | 'enviado' | 'descartado' | 'caducado'
export const ESTADOS_ACTIVOS: readonly EstadoEnvioPropuesto[] = ['nuevo', 'hablado', 'esperando_cliente', 'en_preparacion']
export type MotivoDescarte = 'cliente_sin_stock' | 'cliente_no_quiere' | 'ya_enviado_aparte' | 'datos_erroneos' | 'producto_cambia' | 'descatalogada' | 'otro'
export type Moneda = string // 'EUR' | 'USD' | 'GBP' | 'SEK' | 'PLN' …
export type Libro = 'ok' | 'corto' | 'sin_leer'
export type TonoSalud = 'rojo' | 'ambar' | 'verde' | 'gris'
export type AvisoLinea =
  | 'devoluciones_altas' | 'antiguo' | 'sin_precio' | 'plazo_de_partida' | 'adelantada' | 'recortada_capacidad'
  | 'provisional' | 'pedido_grande' | 'entrante_sin_remesa' | 'envio_dudoso' | 'comprometido_parado'
  | 'stock_viejo' | 'llega_tarde_campana' | 'tope_estacional' | 'merma_alta' | 'almacen_cliente_corto' | 'solo_r14'

/* ------------------------------ Plazo y ajustes ------------------------------ */

export interface PlazoEtapas {
  preparacion: number; transporte: number; recepcion: number; margen: number
  origen: { preparacion: OrigenEtapa; transporte: OrigenEtapa; recepcion: OrigenEtapa; margen: OrigenEtapa }
  /** L = preparación + transporte + recepción */
  hastaLaVenta: number
  /** Nadie ha pulsado «Confirmar plazos» y alguna etapa es de partida */
  sinConfirmar: boolean
  /** Días del transporte urgente (avión) si el cliente lo tiene puesto */
  transporteUrgente: number | null
}

export interface MedidasCliente {
  transporteMediano: number | null; recepcionP75: number | null; enviosMedidos: number
  cadenciaDias: number | null; tamanoTipico: number | null
}

export interface AjustesReposicion {
  coberturaObjetivo: number        // 45
  coberturaMaxima: number          // 90
  multiploCaja: number | null      // null = sin caja del cliente
  minLinea: number                 // 3
  minEnvio: number                 // medido (40 % del tamaño típico) o 30
  ventanaAgrupacion: number        // medido (cadencia, 3-30) o 7
  capacidadUnidades: number | null // null = sin límite conocido
  topeEstacional: number           // 1,8
  campanaHasta: string | null      // 'MM-DD'
  transporteUrgenteDias: number | null
  activo: boolean                  // el planificador corre para este cliente
  avisarChat: boolean
  /** De dónde sale cada valor, para la pantalla de ajustes («medido: cada 9 días, ~110 ud») */
  origen: { minEnvio: 'manual' | 'medido' | 'partida'; ventanaAgrupacion: 'manual' | 'medido' | 'partida' }
}

/* ------------------------------ Ritmo ------------------------------ */

export interface RitmoSku {
  base: number | null; previsto: number | null
  /** Factor máximo aplicado en el horizonte (informativo); la simulación usa perfilSemanal */
  factorEstacional: number
  /** 53 factores por semana ISO (índice 1..53; el 0 no se usa), media 1. null = plano */
  perfilSemanal: number[] | null
  origenPerfil: 'sku' | 'cliente' | 'modelo' | null
  /** El año pasado, factor de pico SIN topar (para la frase «×5,8: el plan usa ×1,8») */
  picoAnoPasado: number | null
  r14: number | null; r30: number | null; r60: number | null; r90: number | null
  diasConStock90: number; ventas90: number; ventas30: number; ventas180: number
  tendencia: 'sube' | 'estable' | 'baja' | null
  confianza: Confianza; origen: 'sku' | 'modelo' | 'ultimo_periodo'
  /** Si el ritmo sale del último periodo con stock (agotado largo): hasta cuándo */
  ultimoPeriodoHasta: string | null
  pedidoGrande: boolean; serieDeStockFiable: boolean; anclajeEstimado: boolean
  tasaDevolucionVendible: number   // 0..0,3
  mermaDiaria: number              // ud/día que pasan de vendible a no vendible o se retiran
  /** consumo = previsto × (1 − tasaDevolucionVendible) + mermaDiaria */
  consumoNeto: number | null
  /** p. ej. «2,1 ud/día · media de 14/30/90 días con stock (78 de 90)» */
  explicacion: string
}

export interface SerieSku {
  fechas: string[]; ventas: number[]; stockInicio: number[]
  /** null = día sin libro (atraso): ni con stock ni sin stock */
  conStock: Array<boolean | null>
  fiable: boolean; anclajeEstimado: boolean
}

/* ------------------------------ Llegadas ------------------------------ */

export type OrigenLlegada = 'camino' | 'comprometido' | 'amazon_sin_remesa' | 'envio_hablado'
export interface LlegadaPrevista {
  fecha: string; unidades: number; origen: OrigenLlegada
  remesaId: string | null; envioPropuestoId: string | null; nombre: string | null
  /** Dudoso: no cuenta para la cobertura */
  dudoso: boolean
  /** Fecha de salida del envío (para «si llega el envío del 20 sep…») */
  fechaEnvio: string | null
  /** Estado de la remesa sin salir (borrador | aprobada | encajando | lista), solo en `comprometido` */
  estadoRemesa?: string | null
}

/** Una remesa sin salir que ya lleva esta referencia (para el aviso del envío: no prometer «añádelo ahí» si no se puede) */
export interface RemesaSinSalirDeLinea { remesaId: string; nombre: string | null; estado: string | null; fechaEnvio: string | null; unidades: number }

/** Llegadas que NO cuentan pero se cuentan en la frase */
export interface LlegadaDescartada { unidades: number; motivo: 'dudoso' | 'propuesta_parada'; nombre: string | null; desde: string | null }

/* ------------------------------ Entrada y línea ------------------------------ */

export interface EntradaSku {
  sku: string; asin: string | null; fnsku: string | null; nombre: string | null
  modelo: string | null; talla: string | null; precio: number | null; moneda: Moneda
  vendibles: number; reservadas: number | null; entranteAmazon: number
  llegadas: LlegadaPrevista[]; llegadasDescartadas: LlegadaDescartada[]
  ritmo: RitmoSku
  comprable: boolean; descatalogada: boolean; excluida: { motivo: string } | null
  cajaSku: number | null; cajaDeducida: number | null; coberturaSku: number | null
  diasSinVenta: number | null; pctMasDe180: number | null; tasaDevolucion90: number | null
  ventas90: number; enCuarentena: { prioridad: Prioridad } | null
  provisional: boolean
  /** Stock de otro mercado y viejo (D11): días de antigüedad */
  stockViejoDias: number | null
  almacenCliente: number | null
}

export interface LineaPlan {
  sku: string; asin: string | null; fnsku: string | null; nombre: string | null
  modelo: string | null; talla: string | null; precio: number | null; moneda: Moneda
  vendibles: number; deCamino: number; comprometido: number; reservadas: number | null
  entranteSinRemesa: number; dudoso: number
  ritmo: RitmoSku
  /** El ritmo previsto que usa la frase y el plan (media de la demanda de las próximas 4 semanas, con la temporada); lo que enseña la pantalla como «previsto» */
  ritmoPrevisto?: number | null
  coberturaDias: number | null; coberturaConLoQueViene: number | null
  /** Rotura que decide (≥ H + L) */
  fechaRotura: string | null
  /** Primer hueco sin stock, aunque sea inevitable (informativo) */
  fechaPrimerHueco: string | null
  aLaVentaObjetivo: string | null; salirAntesDe: string | null; decidirAntesDe: string | null
  vaTarde: boolean; diasSinStockInevitables: number
  coberturaEfectiva: number
  necesidad: number; tope: number; cantidad: number
  caja: { unidades: number; origen: 'sku' | 'deducida' | 'cliente' } | null
  cajas: number | null
  eurosEnRiesgo: number | null; eurosSiVaTarde: number | null
  prioridad: Prioridad
  fuera: MotivoFuera | null
  avisos: AvisoLinea[]
  adelantada: boolean
  /** Alternativa en avión (D9): fecha a la venta si sale urgente */
  aLaVentaUrgente: string | null
  /** Una frase con cifras y fechas «3 dic» */
  porque: string
  /** Remesas sin salir que ya llevan esta referencia (opcional: las pasadas viejas no lo traen) */
  remesasSinSalir?: RemesaSinSalirDeLinea[]
  ajusteIa: { tipo: AjusteIa['tipo']; valor: number | null; motivo: string } | null
}

/* ------------------------------ Envíos propuestos ------------------------------ */

export interface EnvioPropuestoCalculado {
  clave: string; clienteId: string; connectionId: string | null; moneda: Moneda
  salirAntesDe: string; decidirAntesDe: string; aLaVenta: string
  prioridad: Prioridad; confianza: Confianza
  lineas: LineaPlan[]; unidades: number; cajasEstimadas: number | null; cajasAproximadas: boolean
  eurosEnRiesgo: number | null; porque: string[]; provisional: boolean
}

/** Lo mínimo que necesita reconciliarEnvios */
export interface EnvioGuardadoMinimo {
  id: string; clave: string; estado: EstadoEnvioPropuesto; prioridad: Prioridad
  salirAntesDe: string; unidades: number; skus: string[]
  remesaId: string | null; estadoCambiadoAt: string
  /** Lineas actuales (para cambios_desde_ayer) */
  lineas: Array<{ sku: string; cantidad: number }>
  /**
   * Las referencias que ya no cambian con el plan: las de lo hablado (`lineas_aceptadas`) o las que fueron a la remesa (en
   * preparación). null = todo sigue al plan (nuevo, o hablado sin líneas aceptadas: convertir usa `lineas`, que se reescriben)
   */
  skusFijos?: string[] | null
}

export interface CambiosDesdeAyer {
  unidadesAntes: number; unidadesAhora: number; salidaAntes: string | null; salidaAhora: string
  prioridadAntes: Prioridad | null; prioridadAhora: Prioridad; frases: string[]
}

export interface ResultadoReconciliacion {
  insertar: EnvioPropuestoCalculado[]
  actualizar: Array<{ id: string; calculado: EnvioPropuestoCalculado; soloLineas: boolean; anotarHistorial: boolean; cambios: CambiosDesdeAyer | null }>
  caducar: Array<{ id: string; motivo: string }>
  marcarPlanYaNoLoPide: string[]
  /** en_preparacion sin remesa → hablado */
  huerfanosAHablado: string[]
}

/** La fila de fba_envios_propuestos en camelCase */
export interface EnvioPropuestoGuardado {
  id: string; clienteId: string; clienteNombre: string; connectionId: string | null; clave: string
  estado: EstadoEnvioPropuesto; prioridad: Prioridad; confianza: Confianza; provisional: boolean; moneda: Moneda
  salirAntesDe: string; decidirAntesDe: string; aLaVenta: string | null; fechaLimite: string
  responsableId: string | null; responsableNombre: string | null
  unidades: number; cajasEstimadas: number | null; eurosEnRiesgo: number | null; porque: string[]
  lineas: LineaPlan[]; lineasAceptadas: LineaPlan[] | null; cambiosDesdeAyer: CambiosDesdeAyer | null
  planYaNoLoPide: boolean; ajustesAplicados: AjusteIa[]; ia: RevisionIa | null
  motivoDescarte: MotivoDescarte | null; nota: string | null
  remesaId: string | null; esperandoDesde: string | null; pasadaId: string | null
  version: number; creadoAt: string; actualizadoAt: string; estadoCambiadoAt: string
  vencido: boolean
}

/* ------------------------------ Calidad y plan ------------------------------ */

export interface CalidadDatos {
  libro: Libro; leidoHasta: string | null; leidoDesde: string | null; diasAtraso: number | null
  ultimoError: string | null; mercado: string | null; mercadoRemesa: string | null
  sinConexion: boolean; conexionesActivas: number
  plazoDePartida: boolean; sinPrecio: number; provisional: boolean
  refsFueraDeCatalogo: number; pctMerma90: number | null
  calculadoAt: string | null; horasDesdeCalculo: number | null
  avisos: string[] // ya redactados, en orden de gravedad
}

export interface EnCamino {
  remesaId: string; nombre: string; referenciaEnvio: string | null; estadoAmazon: string | null
  fechaEnvio: string | null; llegadaPrevista: string | null; unidades: number; recibidas: number; dudoso: boolean
}

export interface ResumenPlan {
  referencias: number; conPropuesta: number; fuera: Partial<Record<MotivoFuera, number>>
  roturas14: number; roturas30: number; eurosEnRiesgo: number; moneda: Moneda; unidadesPropuestas: number
  primeraRotura: string | null; coberturaMediana: number | null
  agotadosConVentas: number; vendibles: number; deCamino: number
}

export interface PlanCliente {
  clienteId: string; connectionId: string | null; hoy: string; moneda: Moneda
  plazo: PlazoEtapas; ajustes: AjustesReposicion; medidas: MedidasCliente
  calidad: CalidadDatos
  lineas: LineaPlan[]          // TODAS las referencias, con o sin propuesta
  envios: EnvioPropuestoCalculado[]
  enCamino: EnCamino[]
  resumen: ResumenPlan
  /** ±% del ritmo previsto hace 30 días frente a las ventas reales; null si no hay pasada de entonces */
  acierto: { errorPct: number; desde: string } | null
}

/** Lo que ve el cliente externo (D26): sin €, prioridades, ajustes, IA ni envíos */
export interface PlanParaCliente {
  clienteId: string; hoy: string; calculadoAt: string | null
  calidad: Pick<CalidadDatos, 'libro' | 'leidoHasta' | 'diasAtraso' | 'mercado' | 'avisos'>
  lineas: Array<Pick<LineaPlan, 'sku' | 'asin' | 'nombre' | 'modelo' | 'talla' | 'vendibles' | 'deCamino' | 'coberturaDias' | 'coberturaConLoQueViene' | 'fechaRotura'>
    & { ritmo: Pick<RitmoSku, 'base' | 'confianza' | 'explicacion'> }>
  enCamino: EnCamino[]
  resumen: Pick<ResumenPlan, 'referencias' | 'vendibles' | 'deCamino' | 'primeraRotura' | 'coberturaMediana'>
}

/* ------------------------------ IA ------------------------------ */

export type AjusteIa =
  | { tipo: 'factor_ritmo'; sku: string; valor: number; motivo: string }  // 0,7..1,3
  | { tipo: 'excluir'; sku: string; motivo: string }
  | { tipo: 'mover_envio'; sku: string; dias: number; motivo: string }   // −7..+7

export interface RespuestaPlanIa {
  resumen: string
  avisos: Array<{ gravedad: 'alta' | 'media' | 'info'; sku: string | null; texto: string }>
  orden: Array<{ clave: string; motivo: string }>
  ajustes: Array<{ tipo: AjusteIa['tipo']; sku: string; valor: number | null; motivo: string }>
  mensajeCliente: string; mensajeEquipo: string
}

export interface RevisionIa {
  resumen: string; avisos: RespuestaPlanIa['avisos']; orden: RespuestaPlanIa['orden']
  ajustesValidos: Array<AjusteIa & { recalculo: { antes: number; despues: number } }>
  ajustesRechazados: Array<{ ajuste: RespuestaPlanIa['ajustes'][number]; motivo: string }>
  mensajeCliente: string; mensajeEquipo: string
  modelo: string | null; costeUsd: number | null; aviso: string | null; creadoAt: string
}

/* ------------------------------ Pendientes ------------------------------ */

export type TipoPendiente =
  | 'envio_vencido' | 'sin_responsable' | 'vence_esta_semana' | 'esperando_cliente'
  | 'remesa_parada' | 'acepto_sin_revisar' | 'cerrar_envio' | 'envio_dudoso' | 'cerrado_con_faltantes'
  | 'entrante_sin_remesa' | 'modelo_agotado' | 'agotado_se_repone' | 'merma_alta' | 'calidad_datos'

export interface TareaPendiente {
  id: string; tipo: TipoPendiente; gravedad: 'alta' | 'media' | 'baja'
  /** Qué hacer, imperativo y de tú: «Pregunta a Amazon por el envío del 20 sep» */
  titulo: string
  /** Por qué, con cifras */
  detalle: string
  clienteId: string; clienteNombre: string
  euros: number | null; moneda: Moneda | null
  /** Cuenta atrás (p. ej. días para reclamar); null si no aplica */
  diasRestantes: number | null
  ir: { vista: 'hoy' | 'plan' | 'cliente' | 'tablero' | 'alertas'; seccion?: string; params?: Record<string, string> }
  envioPropuestoId: string | null; remesaId: string | null
}

/* ------------------------------ Stock entre mercados ------------------------------ */

export interface FilaStock {
  marketplaceId: string; sku: string; vendibles: number; entrante: number; reservadas: number | null
  noApto: number | null; precio: number | null; moneda: Moneda | null; listingStatus: string[] | null
  updatedAt: string | null
}
export interface StockElegido extends FilaStock { deOtroMercado: boolean; viejoDias: number | null }

/* ------------------------------ Lotes (FIFO) ------------------------------ */

export interface LoteEnvio {
  remesaId: string; nombre: string; referenciaEnvio: string | null
  fechaEnvio: string | null; fechaLlegada: string | null; diasTransito: number | null; estadoAmazon: string | null
  referencias: number
  embudo: { enviadas: number; noLlegaron: number; recibidas: number; vendidas: number; retiradasYMermas: number
    devueltasVendibles: number; quedanVendibles: number; noVendibles: number }
  hitos: { d50: number | null; d80: number | null; d100: number | null }
  duracionDias: number | null; duracionEstimada: number | null; agotaraElEstimado: string | null; estimado: boolean
  curva: Array<{ dia: number; pctVendido: number }>
  porSku: Array<{ sku: string; nombre: string | null; enviadas: number; recibidas: number; vendidas: number
    retiradasYMermas: number; quedan: number; d100: number | null; estimada: number | null; loteVivo: boolean }>
  vivo: boolean
}
export interface ResumenLotes {
  duracionMediana: number | null; transitoMediano: number | null; pctNoLlegadoMedio: number | null
  vivos: number; velocidadComparada: Array<{ remesaId: string; pct: number }>
}

/* ------------------------------ Ventas ------------------------------ */

export interface VentasFba {
  dias: 7 | 30 | 90 | 365; desde: string; hasta: string; moneda: Moneda
  porDia: Array<{ fecha: string; unidades: number; euros: number | null }>
  /** Con 365 días, agregado por semana (lunes) */
  porSemana: Array<{ semana: string; unidades: number; euros: number | null }> | null
  anterior: Array<{ fecha: string; unidades: number; euros: number | null }>
  anteriorCompleto: boolean
  totales: { unidades: number; euros: number | null; udDia: number; devoluciones: number
    variacionUnidades: number | null; variacionEuros: number | null }
  top: Array<{ sku: string; nombre: string | null; unidades: number; euros: number | null; serie30: number[]; udDia: number }>
  /** País del ALMACÉN de Amazon (columna Country del libro), no del comprador */
  salidasPorAlmacen: Array<{ pais: string; unidades: number }>
}

/* ------------------------------ Salud y resumen global ------------------------------ */

export interface SaludCliente { tono: TonoSalud; motivo: string }

export interface ResumenGlobal {
  calculadoAt: string; migracion316: boolean
  kpis: { salenEstaSemana: number; roturas14: number; eurosEnJuego: Array<{ moneda: Moneda; total: number }>
    deCaminoEnvios: number; deCaminoUnidades: number; pendientesVencidos: number; pendientesEstaSemana: number }
  clientes: Array<{ clienteId: string; nombre: string; salud: SaludCliente; resumen: ResumenPlan | null
    calidad: CalidadDatos | null; proximoEnvio: { id: string; salirAntesDe: string; unidades: number } | null; chispa30: number[] }>
  salidasPorSemana: Array<{ semana: string; porCliente: Record<string, number> }>
  enCamino: EnCamino[]
}

/* ------------------------------ Firmas de las funciones puras ------------------------------ */
// Cada paquete implementa exactamente estas firmas (se exportan con estos nombres).

export type FnPlazoDelCliente = (
  config: { diasPreparacion: number | null; diasTransporte: number | null; diasRecepcion: number | null; diasMargen: number | null; total: number | null } | null,
  medido: MedidasCliente | null, hoy: string, ajustes: Pick<AjustesReposicion, 'transporteUrgenteDias'>, plazoSku?: number | null,
) => PlazoEtapas

export type FnSimularStock = (
  v: number, llegadas: LlegadaPrevista[], consumoDia: (fecha: string) => number, hoy: string, horizonte: number, hastaLaVenta: number,
) => { fechaRotura: string | null; fechaPrimerHueco: string | null; stockEn(f: string): number
  diasSinStock(desde: string, hasta: string): number; proyeccion: Array<{ fecha: string; stock: number }> }

export type FnPlanificarSku = (
  e: EntradaSku, hoy: string, plazo: PlazoEtapas, ajustes: AjustesReposicion, medidas: MedidasCliente,
  opciones?: { llegadaForzada?: string; factorIa?: number },
) => LineaPlan

export type FnAgruparEnvios = (
  lineas: LineaPlan[], clienteId: string, connectionId: string | null, hoy: string, ajustes: AjustesReposicion, plazo: PlazoEtapas,
  recalcular: (l: LineaPlan, nuevaSalida: string) => LineaPlan, ocupado: number,
  /** Vuelve a cuadrar las tallas de un modelo (caja y mínimo del modelo) dentro de cada envío, tras recalcular (ajustarPorModelo) */
  ajustarModelo?: (lineas: LineaPlan[]) => LineaPlan[],
  /** Si llega, se llena con lo que se deja fuera de los envíos: sku → por qué (esas líneas pasan a «aún no toca») */
  apartadas?: Map<string, string>,
) => EnvioPropuestoCalculado[]

export type FnReconciliarEnvios = (
  guardados: EnvioGuardadoMinimo[], recientesCerrados: EnvioGuardadoMinimo[], calculados: EnvioPropuestoCalculado[],
  hoy: string, opciones: {
    completo: boolean
    /** Envíos hablados cuyas líneas cuentan como llegada en esta pasada: el plan ya no pide sus SKU POR ellos mismos */
    habladosQueCuentan?: ReadonlySet<string>
    /** Ahora (ISO): un en_preparacion sin remesa solo es huérfano si lleva así MINUTOS_HUERFANO; sin él, siempre */
    ahora?: string
  },
) => ResultadoReconciliacion
