/**
 * AMAZON ADS · EL AGENTE PPC: TIPOS Y CONSTANTES COMPARTIDOS. PURO (nada de servidor).
 *
 * El agente es el modo «agente» del motor: lo enciende un administrador, decide y APLICA solo (3 días de ensayo y luego una rampa de 7 días), vigila el gasto de hoy contra el presupuesto,
 * mide lo que hace y avisa en #notificaciones-erp. Las cifras salen SIEMPRE de reglas (los *-calculo.ts); la IA solo clasifica, da una postura dentro de rangos y redacta.
 * Objetivos y techo automáticos se CONGELAN: nada se mide contra sí mismo. Un «día» es el día del marketplace (horaLocal), no el de Madrid.
 * Todas las constantes están aquí (AGENTE) para que las pruebas y la pantalla usen los mismos números.
 */

import type { UmbralesEstimados } from '../umbrales'

export type EstadoDelAgente = 'apagado' | 'ensayo' | 'activo' | 'frenado'
export type Postura = 'crecer' | 'mantener' | 'recortar'
export type FuenteDePostura = 'ia' | 'reglas' | 'ritmo' | 'stock'
export type RitmoDelMes = 'recorte' | 'normal' | 'crecer'
export type Presion = 'subir' | 'bajar'
export type EtiquetaDeTermino = 'relevante' | 'otro_producto' | 'marca_ajena' | 'intencion_mala' | 'dudoso'
export type Veredicto = 'mejoro' | 'empeoro' | 'neutro' | 'sin_muestra' | 'mezclado'
export type ClaseDeCambio = 'negativizar' | 'promover' | 'puja_subir' | 'puja_bajar' | 'puja_bajar_sin_pedidos' | 'pausar' | 'presupuesto_subir' | 'presupuesto_bajar' | 'pausar_campana'
export type ClaseDeTope = Exclude<ClaseDeCambio, 'puja_bajar_sin_pedidos'>
export type PasoDelAgente = 'vigilar' | 'aplicar' | 'objetivos' | 'cerebro' | 'resumen' | 'efectos' | 'terminos_semana' | 'calibrar'
export type MotivoDeFreno = 'gasto_disparado' | 'acos_cuenta' | 'errores_amazon' | 'datos_viejos' | 'ventas_caidas' | 'manual'
export type FuenteDeObjetivo = 'humano' | 'equilibrio' | 'acos_real' | 'tacos'
export type FaseDeProducto = 'lanzamiento' | 'normal'
export type FaseDeEvento = 'previo' | 'durante' | 'posterior'
export type TipoDeErrorDeAmazon = 'transporte' | 'autorizacion' | 'validacion'
export type DecisionDeStock = 'pausar_campana' | 'pausar_anuncio' | 'solo_recortar' | 'nada'
export type TipoDeEvento =
  | 'encendido' | 'apagado' | 'ensayo_saltado' | 'ensayo_fin' | 'veda' | 'rampa' | 'freno' | 'reanudado' | 'reanudar_rechazado' | 'deshacer_freno'
  | 'postura' | 'objetivo_auto' | 'objetivo_revisado' | 'techo_auto' | 'ritmo' | 'agotada_top' | 'mover_presupuesto' | 'deshacer_auto' | 'deshacer_fallo'
  | 'calibracion' | 'ia_fallo' | 'ia_tope' | 'stock' | 'stock_vuelve' | 'stock_fallo' | 'uso_error' | 'primera_escritura' | 'parada_general' | 'topes' | 'producto' | 'temporada'

export const ORDEN_DE_POSTURA: Record<Postura, number> = { recortar: 0, mantener: 1, crecer: 2 }

export type TopesDelAgente = Record<ClaseDeTope, number>

export const TOPES_DE_PARTIDA: TopesDelAgente = {
  negativizar: 15,
  promover: 5,
  puja_subir: 8,
  puja_bajar: 20,
  pausar: 8,
  presupuesto_subir: 3,
  presupuesto_bajar: 5,
  pausar_campana: 3,
}

/** Lo que cuesta cada paso (ms): solo se empieza si queda ese tiempo en la pasada */
export const COSTE_DE_PASO_MS: Record<PasoDelAgente, number> = {
  vigilar: 15_000,
  aplicar: 40_000,
  objetivos: 15_000,
  cerebro: 75_000,
  resumen: 20_000,
  efectos: 30_000,
  terminos_semana: 15_000,
  calibrar: 15_000,
}

/** Rampa tras el ensayo: desde el día (0 = primer día activo; 6 = día 7) → factor de los topes y restricciones. Con errores de Amazon en 7 días, el factor no pasa de 0,75 */
export const RAMPA: ReadonlyArray<{ desdeDia: number; factor: number; soloBajadas: boolean; sinPresupuestoSubir: boolean }> = [
  { desdeDia: 0, factor: 0.25, soloBajadas: true, sinPresupuestoSubir: true },
  { desdeDia: 1, factor: 0.5, soloBajadas: false, sinPresupuestoSubir: true },
  { desdeDia: 3, factor: 0.75, soloBajadas: false, sinPresupuestoSubir: false },
  { desdeDia: 6, factor: 1, soloBajadas: false, sinPresupuestoSubir: false },
]

/** Todos los números del agente. Cambiar uno aquí lo cambia en reglas, pruebas y pantalla */
export const AGENTE = {
  // pasada y pasos
  DIAS_DE_ENSAYO: 3,
  MIN_ENTRE_VIGILAR: 30,
  MIN_ENTRE_APLICAR: 10,
  MAX_APLICAR_POR_PASADA: 8,
  MAX_PASOS_POR_CUENTA: 3,
  PRESUPUESTO_PASADA_MS: 240_000,
  RESERVA_CUENTA_S: 330,
  MARGEN_FIN_APLICAR_MS: 15_000,
  HORA_CEREBRO_MANANA: 8,
  HORA_CEREBRO_TARDE: 15,
  HORA_RESUMEN: 9,
  HORA_EFECTOS_LOCAL: 6,
  HORA_PRESION_LOCAL: 3,
  DIAS_ENTRE_CALIBRACIONES: 28,
  // uso de presupuesto
  USO_PCT_MAX: 200,
  USO_AGOTADO_PCT: 95,
  USO_LOTE: 100,
  USO_REINTENTO_HORAS: 6,
  USO_ERROR_SIN_REGLAS_HORAS: 12,
  EXCESO_DIARIO_AMAZON: 1.25,
  CURVA_DIAS: 14,
  CURVA_DIAS_MIN: 5,
  CURVA_FRACCION_MIN: 0.1,
  // reglas intradía
  MINUTO_AGOTADO_TEMPRANO: 18 * 60,
  MINUTO_AGOTADO_MUY_TEMPRANO: 14 * 60,
  DIAS_AGOTADA_MINIMOS: 2,
  PEDIDOS_R1: 3,
  PEDIDOS_R3: 3,
  SUBIDA_PRESUPUESTO: 0.2,
  SUBIDA_PRESUPUESTO_CRECER: 0.3,
  ACOS_MALO_X: 1.2,
  USO_BAJO: 0.5,
  ACOS_BUENO_X: 0.8,
  USO_SOBREDIMENSIONADO: 0.4,
  USO_DONANTE: 0.6,
  DIAS_CON_DATOS_7: 5,
  DIAS_CON_DATOS_14: 10,
  HOLGURA_MEDIA: 1.3,
  HOLGURA_MAXIMO: 1.1,
  BAJADA_MINIMA: 0.2,
  PRESUPUESTO_MINIMO: 1,
  DIAS_TRAS_RECORTE: 3,
  // ritmo del mes (una vez al día, días cerrados, con histéresis)
  RITMO_DIA_MINIMO: 4,
  RITMO_RECORTE_ENTRA: 1.05,
  RITMO_RECORTE_ENTRA_ULTIMA_SEMANA: 1.0,
  RITMO_RECORTE_SALE: 0.97,
  RITMO_CRECER_ENTRA: 0.85,
  RITMO_CRECER_SALE: 0.95,
  RITMO_DIAS_ENTRE_CAMBIOS: 3,
  RECORTE_PUJAS_PCT_GASTO: 0.2,
  RECORTE_PRESUPUESTO: 0.2,
  RECORTE_PRESUPUESTO_DIAS: 3,
  RECORTE_PRESUPUESTO_X: 1.1,
  // techo y guardarraíles
  /** Techo automático = max(gasto 30 d, TACoS objetivo × ventas totales proyectadas), creciendo como mucho un 25 % (sobre el gasto de 30 d y, en la revisión mensual, sobre el techo anterior) */
  TECHO_AUTO_CRECER_X: 1.25,
  DIAS_MES_MEDIO: 30.4,
  /** La suma REAL de presupuestos puede llegar a techo ÷ 30,4 × 1,1 (o a la suma al encender, si era mayor); la ÚTIL, a eso × PRESUPUESTO_UTIL_X (topesDeSuma) */
  HOLGURA_SUMA_PRESUPUESTOS: 1.1,
  PRESUPUESTO_UTIL_X: 1.3,
  SUBIDA_MAX_7_DIAS: 1.3,
  SUBIDA_MINIMA_UTIL: 0.05,
  PESO_MES_EVENTO: 1.3,
  PUJA_CAMBIO_MAX: 0.25,
  PUJA_MINIMA: 0.02,
  PUJA_MAX_X: 1.2,
  PUJA_MAX_ABSOLUTA: 3,
  UBICACION_RARA_PCT: 100,
  CUENTA_PEQUENA_GASTO30: 300,
  CUENTA_PEQUENA_TOPE_SUBIR: 3,
  CUENTA_PEQUENA_PEDIDOS_SUBIR: 3,
  // freno
  FRENO_GASTO_X: 1.6,
  FRENO_GASTO_EVENTO_X: 2.5,
  FRENO_SUMA_PRESUPUESTOS_X: 1.6,
  FRENO_MINUTO_DESDE: 600,
  FRENO_GASTO_MIN: 20,
  FRENO_MEDIA7_MIN: 5,
  FRENO_ACOS_X: 1.5,
  FRENO_ACOS_INICIO_X: 1.25,
  /** Días de activo en que el freno de ACoS tolera el ACoS malo de partida (después: ACoS 7 d > 1,5 × objetivo, sin más) */
  FRENO_ACOS_TOLERANCIA_DIAS: 7,
  FRENO_GASTO7_MIN: 15,
  FRENO_GASTO7_CPA_X: 3,
  FRENO_ERRORES_SEGUIDOS: 3,
  FRENO_ERRORES_24H: 5,
  FRENO_DATOS_HORAS: 36,
  FRENO_STOCK_HORAS: 48,
  /** Media diaria de 7 días cerrados frente a la de los 23 anteriores (no hay ventas totales día a día: 0,7 en vez del 0,5 de la spec para 3 días) */
  FRENO_VENTAS_CAIDAS_X: 0.7,
  FRENO_VENTAS_GASTO_NORMAL_X: 0.7,
  FRENO_DESHACER_HORAS: 48,
  FRENO_DESHACER_MAX: 10,
  FRENO_IGNORAR_HORAS: 24,
  /** Aplicar solo si el último vigilar que terminó bien (con el freno evaluado) es de hace menos de estos minutos */
  VIGILAR_OK_MAX_MIN: 45,
  /** Vigilar fallidos seguidos que frenan el agente («datos_viejos») */
  VIGILAR_FALLOS_FRENO: 3,
  // stock
  STOCK_REACTIVAR: 5,
  STOCK_CERO_LECTURAS: 2,
  STOCK_CERO_HORAS_ENTRE: 6,
  /** Una fila de stock (SKU) con más de estas horas de retraso frente a la más reciente del ASIN es un SKU muerto: no cuenta para la frescura */
  STOCK_SKU_MUERTO_HORAS: 168,
  LISTING_FRESCO_HORAS: 6,
  /** Una pausa por stock que lleva más de estas horas pendiente (sin tope ese día, frenado, esperando) se caduca: la decisión exigía un listado de < 6 h. Si sigue a 0, vigilar la vuelve a proponer */
  STOCK_PAUSA_PENDIENTE_HORAS: 12,
  COBERTURA_RECORTAR_DIAS: 7,
  COBERTURA_MANTENER_DIAS: 14,
  // objetivos automáticos (congelados)
  ACOS_AUTO_EQUILIBRIO_X: 0.8,
  ACOS_AUTO_REAL_X: 0.9,
  ACOS_AUTO_MIN: 10,
  ACOS_AUTO_MAX: 40,
  ACOS_AUTO_EQ_MIN: 5,
  ACOS_AUTO_EQ_MAX: 60,
  ACOS_AUTO_PEDIDOS_MIN: 5,
  ACOS_AUTO_SUBIDA_MAX_PTS: 2,
  ACOS_AUTO_DIA_REVISION: 4,
  LANZAMIENTO_DIAS: 60,
  LANZAMIENTO_PAUSA_X_MUESTRA: 2,
  MARCA_ACOS_X: 0.5,
  MARCA_LETRAS_MIN: 3,
  // posturas y combinación
  CRECER_ACOS_X: 1.1,
  CRECER_TOPE_EQUILIBRIO_X: 0.95,
  CRECER_SUBIR_PCT_MAS: 5,
  CRECER_SUBIR_PCT_MAX: 20,
  CRECER_SUBIR_X_MAS: 0.1,
  RECORTAR_ACOS_X: 0.85,
  RECORTAR_BAJAR_X_MENOS: 0.1,
  PRESION_SUBIR_X_MAS: 0.15,
  SUBIR_X_MAX: 0.85,
  PEDIDOS_SUBIR_MIN: 2,
  PCT_CAMBIO_MAX: 25,
  POSTURA_ACOS_MALO_X: 1.3,
  POSTURA_TACOS_MALO_X: 1.2,
  // IA
  IA_TOPE_USD_MES: 2,
  IA_MAX_SALIDA: 12_000,
  IA_TIMEOUT_MS: 45_000,
  IA_REINTENTOS: 0,
  IA_CONFIANZA: 0.85,
  IA_MAX_TERMINOS: 120,
  IA_MAX_PROPUESTAS: 30,
  IA_MAX_PRODUCTOS: 25,
  IA_HORAS_ESPERA: 30,
  IA_TERMINO_MAX_CAR: 80,
  IA_ETIQUETA_DIAS: 180,
  IA_VALIDACION_MUESTRA: 50,
  IA_VALIDACION_ACUERDO: 0.8,
  // rareza
  RARA_PAUSA_GASTO_X: 0.1,
  RARA_BAJADA_PEDIDOS: 5,
  RARA_PRESUPUESTO_CAMBIO: 0.3,
  RARA_PAUSA_A_BAJADA: 0.25,
  RARA_BAJADA_MAX: 0.1,
  RARA_RAPIDA_DIAS: 3,
  RARA_CAIDA_VENTAS: 0.3,
  // efectos y calibración
  EFECTOS_VENTANA: 14,
  EFECTOS_PROVISIONAL: 7,
  EFECTOS_SIN_CERRAR: 3,
  EFECTOS_CLICS_MIN: 12,
  EFECTOS_CONTROL_MIN: 3,
  EFECTOS_CONTROL_CLICS: 5,
  EFECTOS_MAX_POR_PASADA: 10,
  /** Una subida (puja o presupuesto) medida como «empeoró» o deshecha sola no se vuelve a proponer en la misma segmentación o campaña en estos días (sin esto, subir → deshacer → subir cada 2-3 semanas) */
  DIAS_SIN_REPETIR_SUBIDA_EMPEORADA: 45,
  DESHACER_MAX_POR_PASADA: 2,
  DESHACER_ACOS_X: 1.3,
  NEGOCIO_BAJADA_VENTAS_X: 0.95,
  NEGATIVAS_SEMANAS_DESPUES: 5,
  CALIBRAR_MIN_VEREDICTOS: 20,
  CALIBRAR_MEJORA: 0.6,
  CALIBRAR_EMPEORA: 0.4,
  CALIBRAR_VENTANA_DIAS: 60,
  CALIBRAR_DESVIO_MAX: 0.5,
  // temporada
  EVENTO_DIAS_PREVIOS: 2,
  EVENTO_DIAS_POSTERIORES: 7,
  VEDA_DIAS_ANTES: 7,
  VEDA_DIAS_DESPUES: 2,
  // conservación
  DIAS_USO_SE_CONSERVAN: 35,
  SEMANAS_TERMINOS_SE_CONSERVAN: 26,
} as const

export const FALTA_MIGRACION_315 = 'Falta lanzar la migración 315 en Supabase (agente PPC).'

/** El error de deshacer como agente con el interruptor general puesto: no se ha intentado (quien deshace varias seguidas corta, y la medición lo aplaza) */
export const ERROR_INTERRUPTOR_GENERAL = 'Interruptor general: no escribo en Amazon'

/** Un evento de temporada (BF/CM, Navidad…); fechas YYYY-MM-DD locales del marketplace, ambas incluidas */
export interface EventoDeTemporada {
  nombre: string
  desde: string
  hasta: string
  /** null = todos los países */
  paises: readonly string[] | null
  /** Abre veda de activación (no se pasa de ensayo a activo cerca de él) */
  veda: boolean
}

export interface MarcasDePasos {
  vigilarAt: string | null
  aplicarAt: string | null
  cerebroAt: string | null
  cerebroTardeDia: string | null
  resumenDia: string | null
  efectosDia: string | null
  efectosResto: boolean
  objetivosDia: string | null
  terminosSemana: string | null
  limpiezaDia: string | null
  calibradoAt: string | null
}

export interface ConfigDelAgente {
  perfilId: string
  estado: EstadoDelAgente
  encendidoAt: string | null
  encendidoPor: string | null
  ensayoHasta: string | null
  activoDesde: string | null
  rampaDesde: string | null
  frenadoAt: string | null
  frenoMotivo: MotivoDeFreno | null
  frenoDetalle: string | null
  ignorarFreno: { motivo: MotivoDeFreno; hasta: string } | null
  acos7Inicio: number | null
  topes: TopesDelAgente
  topeIaUsdMes: number
  pujaMax: number | null
  picoEventos: boolean
  eventosManuales: EventoDeTemporada[]
  presion: Record<string, Presion>
  presionFecha: string | null
  ritmo: RitmoDelMes
  ritmoFecha: string | null
  ritmoCambiadoAt: string | null
  ritmoMesAnterior: RitmoDelMes | null
  /** Día local en que ENTRÓ en recorte (no cambia al salir: sirve para los días tras el recorte) */
  recorteDesde: string | null
  /** Presupuesto de cada campaña el día que entró en recorte (campaignId → presupuesto) */
  recortePresupuestos: Record<string, number>
  techoMensual: number | null
  techoAutomatico: boolean
  techoCongeladoAt: string | null
  sumaPresupuestosInicio: number | null
  usoError: string | null
  usoErrorAt: string | null
  primeraEscrituraAt: string | null
  rarasSinIa: number
  pensarYa: boolean
  marcas: MarcasDePasos
  /** El último vigilar que TERMINÓ bien, con el freno ya evaluado (sin uno reciente no se aplica nada) */
  vigilarOkAt: string | null
  /** Vigilar fallidos seguidos */
  vigilarFallos: number
}

/** Lo que el agente le pasa a la generación diaria de pujas (motor-pujas.ts) */
export interface AjustesDelAgenteParaPujas {
  /** Por ASIN: objetivo para BAJAR (efectivo con postura), para SUBIR (base, nunca efectivo), umbrales ya combinados y acotados */
  porAsin: Record<string, {
    acosParaBajar: number
    acosParaSubir: number
    umbrales: UmbralesEstimados
    postura: Postura
    sinSubidas: boolean
    soloDefensivo: boolean
    fase: FaseDeProducto
    marca: string | null
    pujaMaxima: number | null
  }>
  /** Por campaignId: la presión del día (R2/R3, días cerrados) */
  presion: Record<string, Presion>
  /** Campañas de marca (por rol o nombre): sin subidas, objetivo × MARCA_ACOS_X */
  campanasDeMarca: string[]
  /** Campañas con ajuste de ubicación > 100 %: sus subidas de puja son raras */
  campanasConUbicacionAlta: string[]
  /** Ritmo recorte, rampa sin subidas, techo nulo, cuenta pequeña sin subidas, 7 días tras un evento */
  sinSubidas: boolean
  /** En modo agente los presupuestos los decide el ritmo (R1/R4): motor-pujas no propone presupuesto */
  presupuestosLosHaceElAgente: boolean
  /** Segmentaciones (objetivo_id) y campañas con un efecto abierto (sin medición provisional): no se tocan */
  bloqueadasPorEfecto: string[]
  campanasBloqueadasPorEfecto: string[]
  /** Segmentaciones (objetivo_id) cuya SUBIDA de puja empeoró o se deshizo sola hace menos de DIAS_SIN_REPETIR_SUBIDA_EMPEORADA: no se vuelven a SUBIR (bajar sí). Sin el dato, ninguna */
  subidasVetadas?: string[]
  /** Muestra mínima de clics para subir (ficha) */
  muestraMinimaClics: number
  cuentaPequena: boolean
}

/** Una propuesta que crea el propio agente (vigilar): la inserta motor-nucleo con insertarPropuestasDelAgente */
export interface FilaDePropuestaDelAgente {
  tipo: 'presupuesto' | 'pausar-campana' | 'pausar'
  asin: string | null
  campaignId: string
  campaignNombre: string
  /** Solo para pausar el anuncio de un ASIN en una campaña con varios */
  objetivoTipo?: 'anuncio'
  objetivoId?: string
  motivo: string
  metricas: Record<string, unknown>
  valorActual: number | null
  valorNuevo: number | null
}

/** El uso del presupuesto de una campaña en un día local (una fila por campaña y día) */
export interface DiaDeUso {
  campaignId: string
  fechaLocal: string
  presupuesto: number | null
  presupuestoPrimera: number | null
  usoPct: number | null
  usoMaxPct: number | null
  gastoEstimado: number | null
  /** Primer minuto local (por usageUpdatedTimestamp) con uso ≥ 95; null si no llegó o solo se sabe por el estado */
  agotadaMin: number | null
  agotadaPorEstado: boolean
  estadoCampana: string | null
  fuente: 'api' | 'estado'
  leidoAt: string
}

/** El gasto acumulado de la cuenta a una hora local */
export interface HoraDeCuenta {
  fechaLocal: string
  hora: number
  gastoAcum: number
  sumaPresupuestos: number | null
}

/** Una lectura de uso de la API ya interpretada */
export interface LecturaDeUso {
  campaignId: string
  usoPct: number | null
  presupuesto: number | null
  actualizadoAt: string | null
}

/** Los datos de una campaña para las reglas de ritmo (ritmo-calculo.ts) */
export interface CampanaParaRitmo {
  campaignId: string
  nombre: string
  asin: string
  presupuesto: number
  /** Minuto local en que hoy llegó al 95 % según la API (null = no ha llegado o solo por estado) */
  agotadaHoyMin: number | null
  agotadaHoyPorEstado: boolean
  /** De los 3 últimos días cerrados: cuántos se agotó (uso máx ≥ 95 % del presupuesto de ESE día) y cuántos antes de las 18:00 */
  agotadaDias3: number
  agotadaAntes18Dias3: number
  gasto7: number
  ventas7: number
  pedidos7: number
  clics7: number
  diasConDatos7: number
  gasto14: number
  ventas14: number
  pedidos14: number
  clics14: number
  mediaGasto14: number
  maxGasto14: number
  diasConDatos14: number
  acosParaSubir: number
  acosParaBajar: number
  muestraMinima: number
  tieneEquilibrio: boolean
  postura: Postura
  soloDefensivo: boolean
  esMarca: boolean
  fase: FaseDeProducto
  /** Propuesta de presupuesto pendiente, resuelta o ensayada en la cuarentena, cambio a mano o efecto abierto */
  bloqueadaPresupuesto: boolean
  /**
   * Bloqueada SOLO por una SUBIDA de presupuesto pendiente (retenida o esperando a aplicar): eso no frena una BAJADA (recorte, R4, donante), que gana y
   * caduca esa subida al insertarse (insertarPropuestasDelAgente). Sin el dato (undefined), como false.
   */
  soloSubidaPendiente?: boolean
  /** Su última SUBIDA de presupuesto empeoró o se deshizo sola hace menos de DIAS_SIN_REPETIR_SUBIDA_EMPEORADA: R1 no la vuelve a subir (bajar sí). Sin el dato, false */
  subidaVetada?: boolean
  /** Su portfolio tiene presupuesto o reglas de presupuesto activas */
  portfolioTopado: boolean
  /** Si el mes anterior acabó en recorte y estamos en sus 3 primeros días: el presupuesto de antes del recorte */
  presupuestoAntesDelRecorte: number | null
  /**
   * El máximo de gasto de 14 días con el que cuenta esta campaña en la suma de presupuestos ÚTILES (presupuestoUtil): el de los 14 días con eventos, y null sin
   * 14 días de datos (cuenta el presupuesto entero). Sin el dato (undefined) un donante libera de suma útil lo mismo que baja de presupuesto.
   */
  maxGasto14Util?: number | null
}

export interface PropuestaDeRitmo {
  tipo: 'presupuesto'
  clase: 'presupuesto_subir' | 'presupuesto_bajar'
  regla: 'R1' | 'R1_financiada' | 'R4' | 'donante' | 'recorte'
  campaignId: string
  nombre: string
  asin: string
  presupuestoActual: number
  presupuestoNuevo: number
  motivo: string
  metricas: { clics: number; gasto: number; pedidos: number; ventas: number; acosPct: number | null; usoPct?: number }
}

export interface ResultadoDeRitmo {
  propuestas: PropuestaDeRitmo[]
  /** Campañas con aviso (portfolio topado, R1 sin hueco…) */
  avisos: Array<{ campaignId: string; texto: string }>
}

export interface EstadoDelMes {
  gastoMes: number
  techo: number | null
  proyeccion: number | null
  media7: number
  diasRestantes: number
  ritmo: RitmoDelMes
  /** true si hoy ha cambiado el ritmo (para el evento «ritmo») */
  cambiado: boolean
  motivo: string
}

/** Lo que el servidor reúne de una cuenta para el cerebro, el resumen y el panel */
export interface ProductoDelContexto {
  asin: string
  nombre: string
  acosObjetivoPct: number | null
  fuenteObjetivo: FuenteDeObjetivo | null
  objetivoCongeladoAt: string | null
  soloDefensivo: boolean
  equilibrioPct: number | null
  cpaObjetivo: number | null
  fase: FaseDeProducto
  marca: string | null
  acos14Pct: number | null
  acos30Pct: number | null
  tacos30Pct: number | null
  clics14: number
  gasto30: number
  ventas30: number
  pedidos30: number
  ventasTotales30: number | null
  ventasTotalesMes: number | null
  ventasTotalesMesAnterior: number | null
  tacosMesPct: number | null
  tacosMesAnteriorPct: number | null
  /** % de ventas TOTALES de los últimos 30 días frente a los 30 anteriores */
  tendenciaVentasTotalesPct: number | null
  stock: number | null
  stockActualizadoAt: string | null
  /** El stock es de hace ≥ LISTING_FRESCO_HORAS (o sin fecha): para subir cuenta como desconocido. Sin el dato, fresco */
  stockViejo?: boolean
  coberturaDias: number | null
  postura: Postura
  fuentePostura: FuenteDePostura | null
  motivoPostura: string | null
}

export interface ContextoDelAgente {
  perfilId: string
  nombreCuenta: string
  pais: string
  moneda: string | null
  zonaHoraria: string
  fechaLocal: string
  tacosObjetivoPct: number
  acosObjetivoMedioPct: number | null
  muestraMinimaClics: number
  techo: { techo: number | null; automatico: boolean; congeladoAt: string | null }
  mes: EstadoDelMes
  evento: { nombre: string; fase: FaseDeEvento } | null
  cuentaPequena: boolean
  /** false = la lectura del stock ha FALLADO (no es «stock desconocido»): no se tocan las posturas puestas por stock. Sin el dato, leído */
  stockLeido?: boolean
  cuenta: {
    gasto7: number; ventas7: number; acos7Pct: number | null; hasta7: string
    acos30Pct: number | null; tacos30Pct: number | null; ventasAds30: number; ventasTotales30: number | null
    ventasTotalesMes: number | null; ventasTotalesMesAnterior: number | null; tacosMesPct: number | null; tacosMesAnteriorPct: number | null
    gastoAyer: number; ventasAyer: number; gasto30: number
    marca: { gasto7: number; ventas7: number; acos7Pct: number | null } | null
  }
  productos: ProductoDelContexto[]
}

export interface EstadoParaIa {
  cuenta: Record<string, string | number | boolean | null>
  productos: Array<Record<string, string | number | boolean | null>>
  propuestasRaras: Array<{ ref: number; tipo: string; asin: string | null; que: string; motivo: string; clics: number; gasto: number; pedidos: number; ventas: number }>
  terminos: Array<{ ref: number; asin: string; producto: string; termino: string; clics: number; gasto: number }>
  resultados: { porClase: Partial<Record<ClaseDeCambio, { mejoro: number; empeoro: number; neutro: number }>>; ultimosEmpeorados: string[] }
  ayer: { aplicadas: number; ensayadas: number; deshechas: number; retenidas: number; gasto: number; ventas: number; acosPct: null }
}

export interface SalidaDelCerebro {
  posturas: Array<{ asin: string; postura: Postura; motivo: string }>
  propuestas: Array<{ ref: number; decision: 'aplicar' | 'retener'; motivo: string }>
  terminos: Array<{ ref: number; etiqueta: EtiquetaDeTermino; confianza: number; razon: string }>
  informe: { titular: string; puntos: string[]; necesitaPersona: string[] }
}

/** Métricas de una ventana (segmentación, campaña o agregado de control) */
export interface MetricasDeVentana {
  clics: number
  gasto: number
  ventas: number
  pedidos: number
  dias: number
}

export interface MedicionDeEfecto {
  antes: MetricasDeVentana
  despues: MetricasDeVentana
  /** Para pausar y negativizar: la campaña entera */
  campanaAntes?: MetricasDeVentana
  campanaDespues?: MetricasDeVentana
  controlAntes: MetricasDeVentana | null
  controlDespues: MetricasDeVentana | null
  /** Ventas TOTALES del ASIN (ads_ventas_asin) en las dos ventanas, con sus días */
  ventasTotalesAntes: { ventas: number; dias: number } | null
  ventasTotalesDespues: { ventas: number; dias: number } | null
  acosObjetivoPct: number
  cvr: number
  muestraMinimaClics: number
  cpaObjetivo: number | null
  /** Otro cambio en la misma unidad (o su campaña) en [d−14, d+14] */
  mezclado: boolean
  /** Nombre del evento si alguna ventana toca uno */
  evento: string | null
  fase: FaseDeProducto
}

export interface DatosDelResumen {
  nombreCuenta: string
  moneda: string | null
  fecha: string
  enEnsayo: boolean
  rampa: { dia: number; de: number } | null
  frenado: { motivo: MotivoDeFreno; detalle: string | null } | null
  evento: { nombre: string; fase: FaseDeEvento } | null
  veda: { nombre: string; hasta: string } | null
  negocio: { ventasTotalesMes: number | null; ventasTotalesMesAnterior: number | null; tacosMesPct: number | null; tacosMesAnteriorPct: number | null; tacosObjetivoPct: number }
  ayer: { gasto: number; ventas: number }
  cerrado7: { acosPct: number | null; acosObjetivoMedioPct: number | null; hasta: string }
  mes: EstadoDelMes
  hechos: Partial<Record<ClaseDeCambio, number>>
  deshechos: string[]
  veredictos: { mejoro: number; empeoro: number; neutro: number; mezclado: number }
  marca: { gasto7: number; acos7Pct: number | null } | null
  informeIa: SalidaDelCerebro['informe'] | null
  necesitaPersona: string[]
}

/** Una fila de la línea de tiempo de la pantalla */
export interface EventoDeLinea {
  id: string
  at: string
  tipo: 'cambio' | 'evento'
  titulo: string
  detalle: string | null
  clase: ClaseDeCambio | null
  propuestaId: string | null
  /** Estado de la propuesta (aplicada, ensayada, deshecha, error…) o tipo de evento */
  estado: string
  ensayo: boolean
  veredicto: Veredicto | null
  deshechoAuto: boolean
  deshacible: boolean
}

export interface PanelDelAgente {
  faltaMigracion: number | null
  esAdmin: boolean
  paradaGeneral: { parado: boolean; motivo: string | null; porEntorno: boolean }
  modoDelMotor: string
  fichaFirmada: boolean
  config: ConfigDelAgente | null
  /** «En ensayo hasta el jueves 19 nov, 14:00», «Activo (rampa, día 2 de 7)», «Frenado: …», «Ensayo terminado: activo desde el 3 dic (Black Friday)» */
  estadoTexto: string
  /** El ensayo no se puede saltar mientras ninguna cuenta haya escrito en Amazon */
  puedeSaltarEnsayo: boolean
  rampa: { dia: number; de: number; factor: number; soloBajadas: boolean } | null
  evento: { nombre: string; fase: FaseDeEvento } | null
  veda: { nombre: string; hasta: string } | null
  cuentaPequena: boolean
  moneda: string | null
  objetivos: {
    tacosObjetivoPct: number
    techoMensual: number | null
    techoAutomatico: boolean
    techoCongeladoAt: string | null
    productos: ProductoDelContexto[]
  }
  ritmo: {
    hoy: { gastoEstimado: number; maximoPosible: number; mediaDiaria7: number; proyeccion: number | null; leidoAt: string | null; campanas: Array<{ campaignId: string; nombre: string; presupuesto: number | null; usoPct: number | null; agotadaA: string | null; presion: Presion | null }> }
    mes: EstadoDelMes
    usoDisponible: boolean
    usoError: string | null
  }
  linea: EventoDeLinea[]
  veredictosPorClase: Partial<Record<ClaseDeCambio, { mejoro: number; empeoro: number; neutro: number; sinMuestra: number; mezclado: number }>>
  ia: { costeMesUsd: number; topeUsd: number; llamadasMes: number; ultimaAt: string | null; ultimoError: string | null; ultimoInforme: SalidaDelCerebro['informe'] | null; validacion: { resueltas: number; deAcuerdo: number; ok: boolean } }
  topes: TopesDelAgente
  topesHoy: TopesDelAgente
  hechosHoy: Partial<Record<ClaseDeTope, number>>
  retenidas: number
}
