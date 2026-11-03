import { sigueVivo, ESTADO_INBOUND_TEXTO } from './inbound-estados'
import { costeMensual, mesDe } from './almacenaje'
import { diasEntreInv, sumarDiasInv, type EnvioInventario, type InventarioCliente, type SkuInventario } from './inventario'

/**
 * ALERTAS DE LOGÍSTICA FBA: QUÉ VA MAL, DICHO ANTES DE QUE HAYA QUE MIRARLO.
 * ==========================================================================
 * PURO: sin base de datos, sin red, sin IA. Se comprueba con alertas.prueba.ts.
 *
 * Remesas a FBA ya sabe cuánto stock queda, a qué ritmo se vende y por dónde va cada envío. Lo que no hacía era DECIRLO: había que entrar
 * cliente por cliente. Aquí está la parte que decide qué merece un aviso; quien lee la base y escribe las alertas es alertas-datos.ts.
 *
 *
 * ============ LAS ALERTAS ============
 *
 *   ROTURA DE STOCK (una por referencia, la clave es la referencia)
 *     agotado          sin stock vendible y con ventas: se está perdiendo dinero ahora mismo
 *     rotura_proxima   se agota antes de que llegue lo que viene de camino
 *     reponer_ya       aun contando lo que viene de camino, pedir hoy llega TARDE (el stock dura menos que el plazo de reposición)
 *     reponer_pronto   todavía se llega a tiempo, pero queda poco margen para pedir
 *   ENVÍOS (una por envío)
 *     envio_atascado   lleva demasiados días sin cambiar de estado
 *     envio_incompleto Amazon lo cerró con menos unidades de las enviadas: reclamable
 *   CUADRE CON AMAZON
 *     descuadre        Amazon tiene más unidades de las que explican las entradas del libro mayor
 *     perdidas         ajustes de inventario NEGATIVOS recientes (perdidas o dañadas dentro del almacén)
 *     no_vendibles     unidades en la red de Amazon que no se pueden vender
 *     sin_comprar      el listing con stock y ventas no figura como comprable
 *   STOCK PARADO (una por cliente)
 *     stock_parado     referencias sin salida
 *     stock_antiguo    unidades que ya pasan, o están a punto de pasar, de los 270 días
 *   VENTAS
 *     caida_ventas     se vende bastante menos que hace un par de meses
 *     pico_ventas      se vende el doble que de costumbre: el stock durará menos de lo previsto
 *
 *
 * ============ EL PLAZO DE REPOSICIÓN LO PONE EL EQUIPO ============
 *
 * Es el número que más pesa y el que ningún dato de Amazon puede dar: depende de dónde se fabrique, de cómo se transporte y de lo que tarde
 * la recepción. Se guarda por cliente y, si hace falta, por referencia. Sin configurar se usa un plazo de partida y la alerta lo dice, para
 * que nadie se fíe de un aviso hecho con un número inventado.
 *
 *
 * ============ LA CUENTA DE LA ROTURA ============
 *
 *   diasHastaRotura       vendibles ÷ ritmo                       lo que dura lo que hay en la estantería
 *   diasConLoQueViene     (vendibles + de camino) ÷ ritmo         y contando lo que ya está en camino
 *   reponer_ya            diasConLoQueViene <= plazo               un pedido de hoy llega después de quedarse sin nada
 *   reponer_pronto        plazo < diasConLoQueViene <= plazo + antelación
 *
 * El ritmo es el de planificación del inventario (mezcla de 14 y 30 días) multiplicado por un factor ESTACIONAL: si el año pasado, en el
 * tramo de fechas que va a cubrir el pedido, se vendía bastante más que justo antes, ese producto se acelera por estas fechas y se cuenta
 * con ello. Solo SUBE el ritmo, nunca lo baja: un aviso de menos por confiar en el calendario es peor que uno de más.
 */

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export const TIPOS_ALERTA = [
  'agotado',
  'rotura_proxima',
  'reponer_ya',
  'reponer_pronto',
  'envio_atascado',
  'envio_incompleto',
  'descuadre',
  'perdidas',
  'no_vendibles',
  'sin_comprar',
  'stock_parado',
  'stock_antiguo',
  'caida_ventas',
  'pico_ventas',
] as const
export type TipoAlerta = (typeof TIPOS_ALERTA)[number]

export const SEVERIDADES = ['critica', 'alta', 'media', 'info'] as const
export type Severidad = (typeof SEVERIDADES)[number]

/** Para ordenar: 0 es lo más grave */
export const ORDEN_SEVERIDAD: Record<Severidad, number> = { critica: 0, alta: 1, media: 2, info: 3 }

/** Qué grupo de la pantalla es cada tipo */
export type FamiliaAlerta = 'reposicion' | 'envios' | 'cuadre' | 'parado' | 'ventas'
export const FAMILIA_DE_TIPO: Record<TipoAlerta, FamiliaAlerta> = {
  agotado: 'reposicion',
  rotura_proxima: 'reposicion',
  reponer_ya: 'reposicion',
  reponer_pronto: 'reposicion',
  envio_atascado: 'envios',
  envio_incompleto: 'envios',
  descuadre: 'cuadre',
  perdidas: 'cuadre',
  no_vendibles: 'cuadre',
  sin_comprar: 'cuadre',
  stock_parado: 'parado',
  stock_antiguo: 'parado',
  caida_ventas: 'ventas',
  pico_ventas: 'ventas',
}

export const NOMBRE_DE_FAMILIA: Record<FamiliaAlerta, string> = {
  reposicion: 'Reposición',
  envios: 'Envíos',
  cuadre: 'Cuadre con Amazon',
  parado: 'Stock parado',
  ventas: 'Ventas',
}

export interface AlertaFba {
  /** Qué alerta es dentro del cliente. La misma clave es la misma alerta de un día para otro */
  clave: string
  tipo: TipoAlerta
  severidad: Severidad
  sku: string | null
  remesaId: string | null
  titulo: string
  detalle: string
  /** Dinero en juego, para ordenar dentro de la misma gravedad. 0 si no se sabe */
  impacto: number
  /** Lo que la pantalla enseña en el desplegable. JSON puro */
  datos: Record<string, unknown>
}

export interface ConfigAlertas {
  /** Días desde que se pide la mercancía hasta que está a la venta */
  plazoDias: number
  /** false = nadie ha puesto el plazo de este cliente: se usa el de partida y se dice */
  plazoConfigurado: boolean
  /** Días por encima del plazo con los que se avisa de «reponer pronto» */
  antelacionDias: number
  /** El plazo de una referencia concreta, si es distinto del del cliente */
  plazoPorSku: Record<string, number>
}

export const CONFIG_ALERTAS_POR_DEFECTO: ConfigAlertas = { plazoDias: 45, plazoConfigurado: false, antelacionDias: 14, plazoPorSku: {} }

export const LIMITES_ALERTAS = {
  plazo: { min: 1, max: 365 },
  antelacion: { min: 0, max: 120 },
} as const

const entero = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : Number.NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : null
}

/** Un plazo que llega de fuera, dentro de los límites. null si no es un número */
export const plazoValido = (v: unknown): number | null => entero(v, LIMITES_ALERTAS.plazo.min, LIMITES_ALERTAS.plazo.max)
export const antelacionValida = (v: unknown): number | null => entero(v, LIMITES_ALERTAS.antelacion.min, LIMITES_ALERTAS.antelacion.max)

/** Los envíos que el motor mira, con el momento en que se VIO el último cambio de estado */
export type EnvioParaAlertas = EnvioInventario & {
  /** ISO. null = no hay historial (envío de antes del seguimiento horario) */
  ultimoCambioAt: string | null
}

/** Las ventas del año pasado, por día: sku → fecha → unidades. Solo hace falta el tramo de fechas que cubre el pedido y el mes anterior */
export type VentasDelAnoPasado = Record<string, Record<string, number>>

export interface EntradaAlertas {
  hoy: string
  inventario: InventarioCliente
  envios: EnvioParaAlertas[]
  config: ConfigAlertas
  ventasAnoPasado?: VentasDelAnoPasado
  /** Referencias cuyo listing NO figura como comprable. Quien lo pasa se asegura de que el dato existe (ver alertas-datos.ts) */
  noComprables?: readonly string[]
  /** Ajustes de inventario recientes por referencia, en neto (negativo = Amazon ha dado de baja unidades) */
  ajustesRecientes?: ReadonlyArray<{ sku: string; neto: number }>
}

/* ------------------------------------------------------------------ */
/* Los umbrales                                                        */
/* ------------------------------------------------------------------ */

export const UMBRALES_ALERTAS = {
  /** Una referencia solo da alertas de rotura si se vende de verdad: tres ventas en un mes o ocho en tres */
  ventas30Min: 3,
  ventas90Min: 8,
  /** Días sin cambiar de estado, por fase del envío: [media, alta]. Pasado el segundo, crítica */
  envio: {
    previo: { media: 5, alta: 10 },
    transito: { alta: 14, critica: 25 },
    entregado: { alta: 5, critica: 10 },
    recibiendo: { alta: 14, critica: 25 },
  },
  incompleto: { minUnidades: 3, minPorcentaje: 0.02, altaUnidades: 50, altaPorcentaje: 0.1 },
  descuadre: { minUnidades: 5, minPorcentaje: 0.1, altaUnidades: 50, altaPorcentaje: 0.25, diasDeMargenDelLibro: 30 },
  perdidas: { minUnidades: 5, altaUnidades: 25, ventanaDias: 45 },
  noVendibles: { minUnidades: 10 },
  caida: { minVentas60: 12, proporcion: 0.5 },
  pico: { minVentas7: 6, proporcion: 2 },
  antiguo: { dias: 270, avisoDias: 30 },
  parado: { unidadesMedia: 50 },
  /** Hasta cuánto puede subir el ritmo por estacionalidad, y a partir de cuánto se tiene en cuenta */
  estacional: { max: 2.5, minimo: 1.15, unidadesMin: 12, diasPrevios: 30 },
} as const

/* ------------------------------------------------------------------ */
/* Pequeñas ayudas de texto                                            */
/* ------------------------------------------------------------------ */

const redondea = (n: number, dec = 1) => Math.round(n * 10 ** dec) / 10 ** dec
/** 12,5 · 0,05: los ritmos de una talla suelta son de 0,05 al día y con un decimal saldrían «0» */
const f = (n: number): string => {
  const dec = Math.abs(n) < 1 ? 2 : Math.abs(n) < 100 ? 1 : 0
  return redondea(n, dec).toLocaleString('es-ES', { maximumFractionDigits: dec })
}
const u = (n: number): string => Math.round(n).toLocaleString('es-ES')
const dinero = (n: number, moneda: string | null): string => `${Math.round(n).toLocaleString('es-ES')} ${moneda === 'EUR' || !moneda ? '€' : moneda}`
const nombreCorto = (s: SkuInventario): string => {
  const n = (s.nombre ?? '').trim()
  return n ? `${n.length > 60 ? `${n.slice(0, 59).trimEnd()}…` : n} (${s.sku})` : s.sku
}

/* ------------------------------------------------------------------ */
/* Estacionalidad                                                      */
/* ------------------------------------------------------------------ */

/**
 * Cuánto hay que acelerar el ritmo de un producto por lo que pasó el año pasado en las mismas fechas.
 *
 * Se compara el ritmo diario del tramo que va a cubrir un pedido de hoy (del mismo día de hace un año a `horizonte` días más) con el del
 * mes anterior a ese día. Con pocas ventas no se cree ninguno de los dos y el factor es 1. Solo sube.
 */
export function factorEstacional(ventas: Record<string, number> | undefined, hoy: string, horizonte: number): number {
  if (!ventas) return 1
  const E = UMBRALES_ALERTAS.estacional
  const base = sumarDiasInv(hoy, -365)
  const inicioPrevio = sumarDiasInv(base, -E.diasPrevios)
  const finProximo = sumarDiasInv(base, Math.max(1, horizonte))
  let previo = 0
  let proximo = 0
  for (const [fecha, n] of Object.entries(ventas)) {
    if (fecha >= inicioPrevio && fecha < base) previo += n
    else if (fecha >= base && fecha < finProximo) proximo += n
  }
  if (previo + proximo < E.unidadesMin || previo <= 0) return 1
  const ritmoPrevio = previo / E.diasPrevios
  const ritmoProximo = proximo / Math.max(1, horizonte)
  const factor = ritmoProximo / ritmoPrevio
  if (!Number.isFinite(factor) || factor < E.minimo) return 1
  return redondea(Math.min(E.max, factor), 2)
}

/* ------------------------------------------------------------------ */
/* Rotura de stock                                                     */
/* ------------------------------------------------------------------ */

function alertaDeReposicion(s: SkuInventario, e: EntradaAlertas): AlertaFba | null {
  const U = UMBRALES_ALERTAS
  const vendeDeVerdad = s.vendidas.d30 >= U.ventas30Min || s.vendidas.d90 >= U.ventas90Min
  if (!vendeDeVerdad || s.ritmoPlan <= 0) return null

  const plazo = e.config.plazoPorSku[s.sku] ?? e.config.plazoDias
  const antelacion = e.config.antelacionDias
  const factor = factorEstacional(e.ventasAnoPasado?.[s.sku], e.hoy, plazo + antelacion)
  const ritmo = s.ritmoPlan * factor
  const precio = s.precio ?? 0
  const sinConfigurar = !e.config.plazoConfigurado && e.config.plazoPorSku[s.sku] === undefined
  const nota = `${sinConfigurar ? ` El plazo de reposición de este cliente está sin configurar: se ha usado ${plazo} días.` : ''}`
  const estacional = factor > 1 ? ` El año pasado, por estas fechas, se vendía ×${f(factor)} más: el ritmo ya lo cuenta.` : ''

  const diasHastaRotura = s.vendibles / ritmo
  const diasConLoQueViene = (s.vendibles + s.entrante) / ritmo
  const datos: Record<string, unknown> = {
    sku: s.sku,
    nombre: s.nombre,
    vendibles: s.vendibles,
    entrante: s.entrante,
    ritmo: redondea(ritmo, 2),
    factorEstacional: factor,
    plazoDias: plazo,
    plazoConfigurado: !sinConfigurar,
    diasHastaRotura: redondea(diasHastaRotura),
    diasConLoQueViene: redondea(diasConLoQueViene),
    seAgotaEl: s.vendibles > 0 ? sumarDiasInv(e.hoy, Math.floor(diasHastaRotura)) : null,
    tendencia: s.tendencia,
    moneda: s.moneda,
    precio: s.precio,
  }
  const base = { sku: s.sku, remesaId: null, clave: `reposicion:${s.sku}` }

  // Sin nada vendible
  if (s.vendibles <= 0) {
    const porDia = ritmo * precio
    const viene = s.entrante > 0
    return {
      ...base,
      tipo: 'agotado',
      severidad: viene ? 'alta' : 'critica',
      titulo: `Agotado: ${nombreCorto(s)}`,
      detalle:
        `Sin stock vendible y se vende a ${f(ritmo)} ud/día.` +
        (viene ? ` Hay ${u(s.entrante)} de camino.` : ' No hay nada de camino.') +
        (precio > 0 ? ` Cada día sin stock son unos ${dinero(porDia, s.moneda)} que no entran.` : '') +
        estacional +
        nota,
      impacto: porDia * Math.min(plazo, 30),
      datos: { ...datos, diasHastaRotura: 0 },
    }
  }

  const ventaEnRiesgo = Math.max(0, plazo - diasConLoQueViene) * ritmo * precio
  const aviso = ventaEnRiesgo > 0 && precio > 0 ? ` Ventas en riesgo: unos ${dinero(ventaEnRiesgo, s.moneda)}.` : ''
  const viene = s.entrante > 0 ? ` (${f(diasConLoQueViene)} contando las ${u(s.entrante)} que vienen de camino)` : ''

  if (diasConLoQueViene <= plazo) {
    const critica = diasConLoQueViene <= plazo / 2 || diasHastaRotura <= 7
    return {
      ...base,
      tipo: 'reponer_ya',
      severidad: critica ? 'critica' : 'alta',
      titulo: `Reponer ya: ${nombreCorto(s)}`,
      detalle:
        `Le quedan ${f(diasHastaRotura)} días de stock${viene} y reponer tarda ${plazo}: aunque se pida hoy, se quedará unos ${f(plazo - diasConLoQueViene)} días sin producto.` +
        aviso +
        estacional +
        nota,
      impacto: ventaEnRiesgo,
      datos: { ...datos, ventaEnRiesgo: redondea(ventaEnRiesgo, 0) },
    }
  }

  // Se agota antes de que llegue lo que ya viene, aunque a la larga el total alcance
  if (s.entrante > 0 && diasHastaRotura <= 10) {
    return {
      ...base,
      tipo: 'rotura_proxima',
      severidad: 'alta',
      titulo: `Se agota antes de que llegue el envío: ${nombreCorto(s)}`,
      detalle:
        `Con lo que hay en la estantería le quedan ${f(diasHastaRotura)} días y lo que viene de camino (${u(s.entrante)}) aún no está a la venta. ` +
        `Si el envío se retrasa, habrá días sin stock.` +
        estacional +
        nota,
      impacto: ritmo * precio * 7,
      datos,
    }
  }

  if (diasConLoQueViene <= plazo + antelacion) {
    return {
      ...base,
      tipo: 'reponer_pronto',
      severidad: 'media',
      titulo: `Reponer pronto: ${nombreCorto(s)}`,
      detalle:
        `Le quedan ${f(diasConLoQueViene)} días de stock${s.entrante > 0 ? ' contando lo que viene de camino' : ''} y reponer tarda ${plazo}. ` +
        `Hay que pedir en los próximos ${Math.max(0, Math.floor(diasConLoQueViene - plazo))} días para no quedarse sin producto.` +
        estacional +
        nota,
      impacto: 0,
      datos,
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Envíos                                                              */
/* ------------------------------------------------------------------ */

type FaseEnvio = 'previo' | 'transito' | 'entregado' | 'recibiendo'

const FASE_DE_ESTADO: Record<string, FaseEnvio> = {
  WORKING: 'previo',
  READY_TO_SHIP: 'previo',
  SHIPPED: 'transito',
  IN_TRANSIT: 'transito',
  DELIVERED: 'entregado',
  CHECKED_IN: 'entregado',
  RECEIVING: 'recibiendo',
}

const nombreDeEnvio = (v: EnvioInventario): string => (v.nombre?.trim() ? v.nombre.trim() : v.referenciaEnvio ?? 'Envío sin nombre')

function alertasDeEnvios(e: EntradaAlertas): AlertaFba[] {
  const salida: AlertaFba[] = []
  const U = UMBRALES_ALERTAS
  const precios = new Map(e.inventario.skus.map((s) => [s.sku, s.precio ?? 0]))
  const monedaDe = e.inventario.skus.find((s) => s.moneda)?.moneda ?? null

  for (const v of e.envios) {
    // Una propuesta todavía no ha salido: no puede estar atascada
    if (v.estado !== 'enviada' && v.estado !== 'cerrada') continue
    const enviadas = v.lineas.reduce((s, l) => s + l.unidades, 0)
    const recibidas = v.lineas.reduce((s, l) => s + (l.recibidas ?? 0), 0)
    const hayRecibidas = v.lineas.some((l) => l.recibidas !== null)
    const desde = (v.ultimoCambioAt ?? v.fechaEnvio).slice(0, 10)
    const diasSinCambio = Math.max(0, diasEntreInv(desde, e.hoy))

    /* --- vivo: atascado --- */
    if (v.estado === 'enviada' && v.estadoAmazon && sigueVivo(v.estadoAmazon)) {
      const fase = FASE_DE_ESTADO[v.estadoAmazon]
      if (!fase) continue
      const corte = U.envio[fase]
      let severidad: Severidad | null = null
      if (fase === 'previo') {
        const c = corte as typeof U.envio.previo
        severidad = diasSinCambio >= c.alta ? 'alta' : diasSinCambio >= c.media ? 'media' : null
      } else {
        const c = corte as typeof U.envio.transito
        severidad = diasSinCambio >= c.critica ? 'critica' : diasSinCambio >= c.alta ? 'alta' : null
      }
      if (!severidad) continue
      const estadoTexto = ESTADO_INBOUND_TEXTO[v.estadoAmazon]?.texto ?? v.estadoAmazon
      const recibidasTexto = hayRecibidas && enviadas > 0 ? ` Amazon ha recibido ${u(recibidas)} de ${u(enviadas)} unidades.` : enviadas > 0 ? ` Son ${u(enviadas)} unidades.` : ''
      const sinHistorial = v.ultimoCambioAt === null ? ' (cuenta desde la fecha de envío: no hay historial de cambios)' : ''
      salida.push({
        clave: `envio:${v.id}:atascado`,
        tipo: 'envio_atascado',
        severidad,
        sku: null,
        remesaId: v.id,
        titulo: `Envío parado: ${nombreDeEnvio(v)}`,
        detalle: `Lleva ${diasSinCambio} días en «${estadoTexto}» sin cambiar${sinHistorial}.${recibidasTexto} Mientras no esté recibido, esa mercancía no se vende.`,
        impacto: v.lineas.reduce((s, l) => s + Math.max(0, l.unidades - (l.recibidas ?? 0)) * (precios.get(l.sku) ?? 0), 0),
        datos: {
          envio: nombreDeEnvio(v),
          referencia: v.referenciaEnvio,
          estadoAmazon: v.estadoAmazon,
          diasSinCambio,
          enviadas,
          recibidas: hayRecibidas ? recibidas : null,
          fechaEnvio: v.fechaEnvio,
        },
      })
      continue
    }

    /* --- cerrado: recibido de menos --- */
    if (v.estadoAmazon === 'CLOSED' && hayRecibidas && enviadas > 0) {
      const faltan = enviadas - recibidas
      const I = U.incompleto
      if (faltan < Math.max(I.minUnidades, Math.ceil(I.minPorcentaje * enviadas))) continue
      const porSku = v.lineas
        .map((l) => ({ sku: l.sku, faltan: l.unidades - (l.recibidas ?? 0) }))
        .filter((l) => l.faltan > 0)
        .sort((a, b) => b.faltan - a.faltan)
      const valor = porSku.reduce((s, l) => s + l.faltan * (precios.get(l.sku) ?? 0), 0)
      const alta = faltan >= I.altaUnidades || faltan / enviadas >= I.altaPorcentaje
      salida.push({
        clave: `envio:${v.id}:incompleto`,
        tipo: 'envio_incompleto',
        severidad: alta ? 'alta' : 'media',
        sku: null,
        remesaId: v.id,
        titulo: `Recibido de menos: ${nombreDeEnvio(v)}`,
        detalle:
          `Amazon cerró el envío con ${u(recibidas)} de ${u(enviadas)} unidades: faltan ${u(faltan)}` +
          (valor > 0 ? ` (unos ${dinero(valor, monedaDe)} a precio de venta)` : '') +
          `. Si no están en otro envío, se pueden reclamar a Amazon desde Seller Central.`,
        impacto: valor,
        datos: {
          envio: nombreDeEnvio(v),
          referencia: v.referenciaEnvio,
          enviadas,
          recibidas,
          faltan,
          cerradoHace: v.ultimoCambioAt ? Math.max(0, diasEntreInv(v.ultimoCambioAt.slice(0, 10), e.hoy)) : null,
          porSku: porSku.slice(0, 10),
        },
      })
    }
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Cuadre con Amazon                                                   */
/* ------------------------------------------------------------------ */

function alertasDeCuadre(e: EntradaAlertas): AlertaFba[] {
  const salida: AlertaFba[] = []
  const U = UMBRALES_ALERTAS
  const inv = e.inventario
  const porSku = new Map(inv.skus.map((s) => [s.sku, s]))

  /* --- descuadre: más unidades en Amazon de las que explican las entradas --- */
  for (const s of inv.skus) {
    const D = U.descuadre
    // Solo si el libro cubre toda la vida del producto: si el producto ya estaba en Amazon antes del libro, ese stock de antes es normal
    if (inv.libro !== 'ok' || !s.primeraEntrada || !inv.libroDesde) continue
    if (diasEntreInv(inv.libroDesde, s.primeraEntrada) < D.diasDeMargenDelLibro) continue
    const sinExplicar = s.anteriorALaLectura
    if (sinExplicar < Math.max(D.minUnidades, Math.ceil(D.minPorcentaje * Math.max(1, s.vendibles)))) continue
    const alta = sinExplicar >= D.altaUnidades || sinExplicar / Math.max(1, s.vendibles) >= D.altaPorcentaje
    salida.push({
      clave: `descuadre:${s.sku}`,
      tipo: 'descuadre',
      severidad: alta ? 'alta' : 'media',
      sku: s.sku,
      remesaId: null,
      titulo: `Amazon tiene ${u(sinExplicar)} unidades más de las que cuadran: ${nombreCorto(s)}`,
      detalle:
        `Entre las entradas del libro mayor y lo que viene de camino salen menos unidades de las que Amazon dice tener vendibles (${u(s.vendibles)}). ` +
        `Puede ser una recepción que nadie ha registrado, un envío mal apuntado o un error de Amazon: conviene mirarlo en Seller Central.`,
      impacto: sinExplicar * (s.precio ?? 0),
      datos: { sku: s.sku, nombre: s.nombre, vendibles: s.vendibles, sinExplicar, descuadre: s.descuadre },
    })
  }

  /* --- perdidas: ajustes negativos recientes, en un solo aviso por cliente --- */
  const perdidas = (e.ajustesRecientes ?? [])
    .filter((a) => a.neto < 0)
    .map((a) => ({ sku: a.sku, unidades: -a.neto, precio: porSku.get(a.sku)?.precio ?? 0 }))
    .sort((a, b) => b.unidades - a.unidades)
  const totalPerdidas = perdidas.reduce((s, p) => s + p.unidades, 0)
  if (totalPerdidas >= U.perdidas.minUnidades) {
    const valor = perdidas.reduce((s, p) => s + p.unidades * p.precio, 0)
    salida.push({
      clave: 'perdidas',
      tipo: 'perdidas',
      severidad: totalPerdidas >= U.perdidas.altaUnidades ? 'alta' : 'media',
      sku: null,
      remesaId: null,
      titulo: `Amazon ha dado de baja ${u(totalPerdidas)} unidades en ${U.perdidas.ventanaDias} días`,
      detalle:
        `Son ajustes de inventario negativos (mercancía perdida o dañada dentro del almacén) en ${perdidas.length} referencia${perdidas.length === 1 ? '' : 's'}` +
        (valor > 0 ? `, unos ${dinero(valor, inv.skus.find((s) => s.moneda)?.moneda ?? null)} a precio de venta` : '') +
        `. Se pueden pedir como reembolso en Seller Central.`,
      impacto: valor,
      datos: { unidades: totalPerdidas, ventanaDias: U.perdidas.ventanaDias, items: perdidas.slice(0, 10).map(({ sku, unidades }) => ({ sku, unidades, nombre: porSku.get(sku)?.nombre ?? null })) },
    })
  }

  /* --- no vendibles: en un solo aviso por cliente --- */
  const noVend = inv.skus.filter((s) => s.noDisponibles >= 3 && s.noDisponibles >= 0.15 * Math.max(1, s.enAmazon)).sort((a, b) => b.noDisponibles - a.noDisponibles)
  const totalNoVend = noVend.reduce((s, k) => s + k.noDisponibles, 0)
  if (totalNoVend >= U.noVendibles.minUnidades) {
    salida.push({
      clave: 'no_vendibles',
      tipo: 'no_vendibles',
      severidad: 'info',
      sku: null,
      remesaId: null,
      titulo: `${u(totalNoVend)} unidades en Amazon que no se pueden vender`,
      detalle:
        `En ${noVend.length} referencia${noVend.length === 1 ? '' : 's'} hay unidades dentro de la red de Amazon que no están a la venta (dañadas, reservadas o en tránsito sin registrar). ` +
        `Desde aquí no se pueden separar: si son muchas, mírelas en Seller Central.`,
      impacto: noVend.reduce((s, k) => s + k.noDisponibles * (k.precio ?? 0), 0),
      datos: { unidades: totalNoVend, items: noVend.slice(0, 10).map((s) => ({ sku: s.sku, unidades: s.noDisponibles, nombre: s.nombre })) },
    })
  }

  /* --- sin comprar: stock y ventas, pero el listing no figura como comprable --- */
  for (const sku of e.noComprables ?? []) {
    const s = porSku.get(sku)
    if (!s || s.vendibles <= 0 || s.vendidas.d90 <= 0) continue
    salida.push({
      clave: `sin_comprar:${s.sku}`,
      tipo: 'sin_comprar',
      severidad: 'alta',
      sku: s.sku,
      remesaId: null,
      titulo: `No se puede comprar: ${nombreCorto(s)}`,
      detalle:
        `Tiene ${u(s.vendibles)} unidades en Amazon y ha vendido ${u(s.vendidas.d90)} en 90 días, pero el listing no figura como comprable (suprimido, sin oferta o con un problema de cuenta). ` +
        `Mientras siga así no vende.`,
      impacto: s.ritmoPlan * (s.precio ?? 0) * 7,
      datos: { sku: s.sku, nombre: s.nombre, vendibles: s.vendibles, vendidas90: s.vendidas.d90 },
    })
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Stock parado y antiguo                                              */
/* ------------------------------------------------------------------ */

function alertasDeParado(e: EntradaAlertas): AlertaFba[] {
  const salida: AlertaFba[] = []
  const U = UMBRALES_ALERTAS
  const inv = e.inventario
  const mes = mesDe(e.hoy)
  const moneda = inv.skus.find((s) => s.moneda)?.moneda ?? null

  /* --- parado: sin salida --- */
  if (inv.libro !== 'sin_leer') {
    const paradas = inv.skus.filter((s) => s.estado === 'parado' && s.enAmazon > 0).sort((a, b) => (b.valorStock ?? 0) - (a.valorStock ?? 0) || b.enAmazon - a.enAmazon)
    const unidades = paradas.reduce((s, k) => s + k.enAmazon, 0)
    if (paradas.length > 0 && unidades > 0) {
      const valor = paradas.reduce((s, k) => s + (k.valorStock ?? 0), 0)
      const coste = costeMensual(unidades, mes)
      salida.push({
        clave: 'parado',
        tipo: 'stock_parado',
        severidad: unidades >= U.parado.unidadesMedia ? 'media' : 'info',
        sku: null,
        remesaId: null,
        titulo: `${u(paradas.length)} referencia${paradas.length === 1 ? '' : 's'} sin salida (${u(unidades)} unidades)`,
        detalle:
          `Llevan semanas sin venderse` +
          (valor > 0 ? ` y suman unos ${dinero(valor, moneda)} a precio de venta` : '') +
          `. Guardarlas cuesta unos ${dinero(coste, moneda)} al mes (estimación). Conviene bajar el precio, lanzar una promoción o retirarlas antes de que pasen de antigüedad.`,
        impacto: valor,
        datos: {
          unidades,
          referencias: paradas.length,
          valor: redondea(valor, 0),
          costeMes: redondea(coste, 0),
          items: paradas.slice(0, 10).map((s) => ({ sku: s.sku, nombre: s.nombre, unidades: s.enAmazon, diasSinVenta: s.diasSinVenta, valor: s.valorStock })),
        },
      })
    }
  }

  /* --- antiguo: ya pasan de 270 días, o van a pasar en un mes --- */
  const pasadas = inv.resumen.unidadesAntiguas
  const pasadasDeAnio = inv.resumen.porTramo.t366
  const porCruzar = inv.skus.reduce(
    (suma, s) => suma + s.lotes.filter((l) => l.edadDias > U.antiguo.dias - U.antiguo.avisoDias && l.edadDias <= U.antiguo.dias).reduce((x, l) => x + l.quedan, 0),
    0
  )
  if (pasadas > 0 || porCruzar > 0) {
    const severidad: Severidad = pasadasDeAnio > 0 ? 'alta' : pasadas > 0 ? 'media' : 'info'
    const conAntiguedad = inv.skus
      .map((s) => ({ s, antiguas: s.porTramo.t271 + s.porTramo.t366 }))
      .filter((x) => x.antiguas > 0)
      .sort((a, b) => b.antiguas - a.antiguas)
    const partes: string[] = []
    if (pasadasDeAnio > 0) partes.push(`${u(pasadasDeAnio)} unidades llevan más de un año`)
    if (pasadas - pasadasDeAnio > 0) partes.push(`${u(pasadas - pasadasDeAnio)} llevan entre 270 y 365 días`)
    if (porCruzar > 0) partes.push(`${u(porCruzar)} cumplen 270 días en el próximo mes`)
    salida.push({
      clave: 'antiguo',
      tipo: 'stock_antiguo',
      severidad,
      sku: null,
      remesaId: null,
      titulo: pasadas > 0 ? `${u(pasadas)} unidades con más de 270 días en Amazon` : `${u(porCruzar)} unidades van a cumplir 270 días`,
      detalle: `${partes.join('; ')}. A partir de los 270 días Amazon empieza a cobrar de más por tenerlas. Hay que venderlas o retirarlas antes.`,
      impacto: inv.resumen.valorPorTramo.t271 + inv.resumen.valorPorTramo.t366,
      datos: {
        mas365: pasadasDeAnio,
        de271a365: pasadas - pasadasDeAnio,
        cumplen270enUnMes: porCruzar,
        items: conAntiguedad.slice(0, 10).map(({ s, antiguas }) => ({ sku: s.sku, nombre: s.nombre, unidades: antiguas, edadMaxDias: s.edadMaxDias })),
      },
    })
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Ventas                                                              */
/* ------------------------------------------------------------------ */

function alertasDeVentas(e: EntradaAlertas): AlertaFba[] {
  const salida: AlertaFba[] = []
  const U = UMBRALES_ALERTAS
  for (const s of e.inventario.skus) {
    const { d7, d14, d30, d60 } = s.vendidas
    // Una caída solo es una señal si hay producto que vender: sin stock las ventas bajan solas
    if (s.vendibles > 0 && d60 >= U.caida.minVentas60) {
      const antes = d60 / 60
      const ahora = d14 / 14
      if (antes > 0 && ahora <= U.caida.proporcion * antes) {
        salida.push({
          clave: `caida:${s.sku}`,
          tipo: 'caida_ventas',
          severidad: 'media',
          sku: s.sku,
          remesaId: null,
          titulo: `Ventas a la baja: ${nombreCorto(s)}`,
          detalle:
            `En las últimas dos semanas vende ${f(ahora)} ud/día, frente a ${f(antes)} de media en los dos últimos meses (${Math.round((1 - ahora / antes) * 100)} % menos). ` +
            `Hay stock, así que merece mirar el precio, la oferta destacada y la ficha.`,
          impacto: (antes - ahora) * (s.precio ?? 0) * 30,
          datos: { sku: s.sku, nombre: s.nombre, ritmoAhora: redondea(ahora, 2), ritmoAntes: redondea(antes, 2), vendibles: s.vendibles },
        })
        continue
      }
    }
    if (d7 >= U.pico.minVentas7 && d30 > 0 && d7 / 7 >= U.pico.proporcion * (d30 / 30)) {
      salida.push({
        clave: `pico:${s.sku}`,
        tipo: 'pico_ventas',
        severidad: 'info',
        sku: s.sku,
        remesaId: null,
        titulo: `Ventas disparadas: ${nombreCorto(s)}`,
        detalle:
          `Esta semana vende ${f(d7 / 7)} ud/día, más del doble que su media del mes (${f(d30 / 30)}). ` +
          `Con ese ritmo, los ${u(s.vendibles)} que tiene durarían ${s.vendibles > 0 ? `${f(s.vendibles / (d7 / 7))} días` : 'nada'}: puede quedarse sin stock antes de lo previsto.`,
        impacto: 0,
        datos: { sku: s.sku, nombre: s.nombre, ritmo7: redondea(d7 / 7, 2), ritmo30: redondea(d30 / 30, 2), vendibles: s.vendibles },
      })
    }
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Todo junto                                                          */
/* ------------------------------------------------------------------ */

export const compararAlertas = (a: Pick<AlertaFba, 'severidad' | 'impacto' | 'titulo'>, b: Pick<AlertaFba, 'severidad' | 'impacto' | 'titulo'>): number =>
  ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad] || b.impacto - a.impacto || a.titulo.localeCompare(b.titulo)

/** Todas las alertas de un cliente, de la más grave a la menos. Sin libro mayor leído no se dice nada de ventas ni de stock: no hay base */
export function calcularAlertas(entrada: EntradaAlertas): AlertaFba[] {
  const inv = entrada.inventario
  const salida: AlertaFba[] = []

  // Los envíos no dependen del libro mayor: están en Amazon y en el ERP
  salida.push(...alertasDeEnvios(entrada))

  if (inv.libro !== 'sin_leer') {
    for (const s of inv.skus) {
      const a = alertaDeReposicion(s, entrada)
      if (a) salida.push(a)
    }
    salida.push(...alertasDeCuadre(entrada))
    salida.push(...alertasDeVentas(entrada))
  }
  salida.push(...alertasDeParado(entrada))
  return salida.sort(compararAlertas)
}

/* ------------------------------------------------------------------ */
/* Reconciliar con lo que ya hay guardado                              */
/* ------------------------------------------------------------------ */

export interface FilaDeAlerta {
  clave: string
  estado: 'abierta' | 'resuelta' | 'silenciada'
  severidad: Severidad
  silenciadaHasta: string | null
  severidadAvisada: Severidad | null
}

export interface PlanDeAlertas {
  /** Las que hay que escribir (nuevas o actualizadas), con el estado en que quedan */
  escribir: Array<{ alerta: AlertaFba; estado: 'abierta' | 'silenciada'; nueva: boolean; reabierta: boolean }>
  /** Las claves que dejaron de pasar y se dan por resueltas */
  resolver: string[]
  /** Las que merecen un aviso en la campana: nuevas o más graves que la última vez que se avisó, y solo críticas o altas */
  avisar: AlertaFba[]
}

/** ¿Es `a` más grave que `b`? (null = nunca se avisó) */
const masGrave = (a: Severidad, b: Severidad | null): boolean => b === null || ORDEN_SEVERIDAD[a] < ORDEN_SEVERIDAD[b]

/**
 * Compara lo calculado hoy con lo guardado. NO resuelve nada si `completo` es false: una lectura que falló a medias no puede dar por
 * arregladas alertas que simplemente no se han vuelto a mirar.
 */
export function planearAlertas(guardadas: readonly FilaDeAlerta[], calculadas: readonly AlertaFba[], hoy: string, completo = true): PlanDeAlertas {
  const previas = new Map(guardadas.map((g) => [g.clave, g]))
  const escribir: PlanDeAlertas['escribir'] = []
  const avisar: AlertaFba[] = []
  const vistas = new Set<string>()

  for (const a of calculadas) {
    if (vistas.has(a.clave)) continue
    vistas.add(a.clave)
    const previa = previas.get(a.clave)
    const silenciada = previa?.estado === 'silenciada' && previa.silenciadaHasta !== null && previa.silenciadaHasta >= hoy
    const estado = silenciada ? 'silenciada' : 'abierta'
    const nueva = !previa
    const reabierta = previa?.estado === 'resuelta'
    escribir.push({ alerta: a, estado, nueva, reabierta })
    if (estado === 'abierta' && (a.severidad === 'critica' || a.severidad === 'alta') && (nueva || reabierta || masGrave(a.severidad, previa?.severidadAvisada ?? null))) {
      avisar.push(a)
    }
  }

  const resolver = completo ? guardadas.filter((g) => g.estado !== 'resuelta' && !vistas.has(g.clave)).map((g) => g.clave) : []
  return { escribir, resolver, avisar }
}

/** Cuántas alertas de cada gravedad */
export function contarPorSeveridad(alertas: ReadonlyArray<Pick<AlertaFba, 'severidad'>>): Record<Severidad, number> {
  const c: Record<Severidad, number> = { critica: 0, alta: 0, media: 0, info: 0 }
  for (const a of alertas) c[a.severidad] += 1
  return c
}
