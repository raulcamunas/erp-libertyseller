import type { EstadoSku, IdTramo, InventarioDeCliente, SkuInventario } from '@/lib/fba/inventario'
import type { IdTramoAmazon } from '@/lib/fba/planificacion'
import type { TonoEstado } from '@/lib/estilo/denso'
import type { Confianza, EnCamino, EnvioPropuestoGuardado, LineaPlan, PlanParaCliente, Prioridad, RitmoSku } from '@/lib/fba/plan-tipos'
import { estadoDeStock, ORDEN_PRIORIDAD, type CalidadParaBanda, type EstadoStock } from '../comun/estilo-plan'
import { diasEntre, dinero, entero, sumarDias } from '../formato'

/**
 * FORMATOS Y CUENTAS PURAS DEL STOCK Y DEL RESUMEN DEL CLIENTE (spec remesas-pro §1.5, §8, D11, D25, D26, D41).
 *
 * Sin React ni red: se prueba con `npx tsx components/remesas/inventario/formato.prueba.ts`.
 *
 * API (lo de siempre, lo usan también PropuestaIaDialog y TarjetaAnalisisIa)
 *   n0, n1, n2, m3, eur, eurFino, eur2, pct, hace, ESTADO_SKU, COLOR_TRAMO, COLOR_TRAMO_AMAZON
 *
 * API (nueva)
 *   din(v, moneda)                         dinero en la moneda del cliente («1.234 €», «1.200 $»)
 *   LineaDeStock                           lo que la sección Stock lee de una línea del plan: vale la de la agencia (LineaPlan)
 *                                          y la recortada del cliente externo (PlanParaCliente, sin €, prioridad ni avisos)
 *   filasDeStock(skus, lineas, opciones)   UNA fila por referencia del inventario con ritmo, cobertura, rotura y estado.
 *                                          «Un único número por pregunta» (§1.1): si el plan tiene la referencia, mandan las del
 *                                          plan (origen 'plan'); si no hay plan o no la tiene, las del inventario (origen 'inventario').
 *   calidadDeInventario(datos, hoy)        la calidad de datos para la banda cuando no hay plan (solo con el inventario)
 *   barraDeStock(datos)                    vendible · de camino · reservado · no apto (la barra apilada del Resumen)
 *   ventanaDeVentas(porDia, n, desde?)     ventas de los últimos n días frente a los n anteriores (null si el libro no llega)
 *   topCobertura(lineas, n)                las n referencias que antes se quedan sin stock (con ritmo), para el mapa
 *   llegadasAproximadas(linea, enCamino, hoy, plazoHastaLaVenta?)  las llegadas de una referencia para ProyeccionStock
 *   proximoEnvioPropuesto(envios)          el envío propuesto activo más urgente (prioridad y luego fecha de salida)
 *   diasDesde(fecha, hoy)                  días que han pasado (0 si es hoy o futura; null sin fecha)
 */

const ES = 'es-ES'

/** 1.234 (con punto de miles también en 4 cifras, que es-ES no pone: «3.290», no «3290») */
export const n0 = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : entero(v))

/** 1.234,5 — un decimal, y sin el «,0» sobrante */
export const n1 = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : v.toLocaleString(ES, { maximumFractionDigits: 1 }))

/** 0,25 — dos decimales, para ritmos de venta */
export const n2 = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : v.toLocaleString(ES, { maximumFractionDigits: 2 }))

/** Metros cúbicos: tres decimales cuando es poco, uno cuando es mucho */
export const m3 = (v: number): string => `${v.toLocaleString(ES, { maximumFractionDigits: v < 1 ? 3 : 1 })} m³`

/** 1.234 € (sin decimales: en un panel de cientos de filas los céntimos solo estorban) */
export const eur = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : v.toLocaleString(ES, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

/**
 * 0,03 € o 1.234 €: con céntimos cuando la cifra es pequeña y sin ellos cuando no. Los costes de
 * almacenaje que da Amazon por referencia son de céntimos, y con `eur` saldrían todos «0 €».
 */
export const eurFino = (v: number | null | undefined): string =>
  v === null || v === undefined
    ? '—'
    : v.toLocaleString(ES, { style: 'currency', currency: 'EUR', minimumFractionDigits: Math.abs(v) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 })

/** 1.234,56 € */
export const eur2 = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : v.toLocaleString(ES, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 0,215 → «21,5 %» */
export const pct = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${(v * 100).toLocaleString(ES, { maximumFractionDigits: 1 })} %`)

/** «hoy», «ayer» o «hace 5 d» a partir de los días que han pasado */
export const hace = (dias: number | null | undefined): string => {
  if (dias === null || dias === undefined) return '—'
  if (dias <= 0) return 'hoy'
  if (dias === 1) return 'ayer'
  return `hace ${dias} d`
}

/** Dinero en la moneda del cliente (Portico vende en dólares): «1.234 €», «1.200 $» */
export const din = (v: number | null | undefined, moneda: string | null | undefined = 'EUR'): string => dinero(v ?? null, moneda ?? 'EUR')

export const ESTADO_SKU: Record<EstadoSku, { texto: string; tono: TonoEstado; ayuda: string }> = {
  agotado: { texto: 'Agotado', tono: 'rojo', ayuda: 'Sin stock vendible y con ventas en los últimos 90 días: se están perdiendo ventas' },
  urgente: { texto: 'Urgente', tono: 'naranja', ayuda: 'Se agota en 14 días o menos al ritmo actual: hay que reponer ya' },
  bajo: { texto: 'Stock bajo', tono: 'ambar', ayuda: 'Entre 15 y 30 días de stock al ritmo actual' },
  ok: { texto: 'Bien', tono: 'verde', ayuda: 'Entre 30 y 120 días de stock al ritmo actual' },
  exceso: { texto: 'Exceso', tono: 'azul', ayuda: 'Más de 120 días de stock al ritmo actual: de sobra' },
  parado: { texto: 'Parado', tono: 'magenta', ayuda: 'Lleva 60 días o más sin venderse y sigue ocupando almacén' },
  sin_ventas: { texto: 'Sin ventas', tono: 'gris', ayuda: 'No se ha vendido nada en 90 días, pero lleva poco tiempo en Amazon como para darlo por parado' },
  sin_datos: { texto: 'Sin datos', tono: 'gris', ayuda: 'No hay libro mayor leído de este cliente: no se sabe cuánto vende' },
}

/** La ayuda de cada estado de stock de la tabla nueva (los textos de ESTADO_STOCK son de estilo-plan, S7) */
export const AYUDA_ESTADO_STOCK: Record<EstadoStock, string> = {
  agotado: 'Sin stock vendible y con ventas: se están perdiendo ventas',
  urgente: 'Se queda sin stock antes de que pueda llegar un envío, o casi',
  bajo: 'Hay que mandar pronto: rompe en las próximas semanas',
  ok: 'Tiene stock para rato',
  exceso: 'Más stock del que se vende en la cobertura máxima: de sobra',
  parado: 'Lleva mucho sin venderse y sigue ocupando almacén',
  sin_ventas: 'No se ha vendido nada en 90 días',
  sin_datos: 'Sin ventas leídas suficientes para saber cuánto dura',
}

export const COLOR_TRAMO: Record<IdTramo, string> = {
  t0: 'var(--ls-e-verde)',
  t91: 'var(--ls-e-ambar)',
  t181: 'var(--ls-e-naranja)',
  t271: 'var(--ls-e-rojo)',
  t366: 'var(--ls-e-magenta)',
}

/** Los siete tramos de Seller Central, del verde de lo recién llegado al magenta de lo que lleva más de un año */
export const COLOR_TRAMO_AMAZON: Record<IdTramoAmazon, string> = {
  a0: 'var(--ls-e-verde)',
  a61: 'color-mix(in srgb, var(--ls-e-verde) 50%, var(--ls-e-ambar))',
  a91: 'var(--ls-e-ambar)',
  a181: 'var(--ls-e-naranja)',
  a331: 'color-mix(in srgb, var(--ls-e-naranja) 50%, var(--ls-e-rojo))',
  a366: 'var(--ls-e-rojo)',
  a456: 'var(--ls-e-magenta)',
}

/* ------------------------------------------------------------------ */
/* Fechas                                                              */
/* ------------------------------------------------------------------ */

/** Días que han pasado desde `fecha` hasta `hoy`; 0 si es hoy o futura; null sin fecha */
export function diasDesde(fecha: string | null | undefined, hoy: string): number | null {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}/.test(fecha)) return null
  return Math.max(0, diasEntre(fecha.slice(0, 10), hoy))
}

/* ------------------------------------------------------------------ */
/* Filas de la tabla de stock: inventario + plan                       */
/* ------------------------------------------------------------------ */

type LineaCliente = PlanParaCliente['lineas'][number]

/**
 * Lo que la sección Stock lee de una línea del plan. La del cliente externo trae solo lo de `PlanParaCliente`; la de la
 * agencia, además, prioridad, motivo, avisos, cantidad y el ritmo entero.
 */
export type LineaDeStock = Omit<LineaCliente, 'ritmo'> &
  Partial<Pick<LineaPlan, 'prioridad' | 'fuera' | 'avisos' | 'cantidad' | 'reservadas' | 'comprometido' | 'dudoso' | 'entranteSinRemesa'
    | 'aLaVentaObjetivo' | 'salirAntesDe' | 'decidirAntesDe' | 'porque' | 'precio' | 'moneda' | 'eurosEnRiesgo' | 'fechaPrimerHueco'>> & {
    ritmo: Pick<RitmoSku, 'base' | 'confianza' | 'explicacion'> & Partial<RitmoSku>
  }

export interface FilaStock {
  sku: SkuInventario
  /** La línea del plan de esta referencia; null = no está en el plan (o no hay plan) */
  linea: LineaDeStock | null
  /** De dónde salen ritmo, cobertura y rotura */
  origen: 'plan' | 'inventario'
  /** ud/día (bruto, el que se enseña: D12) */
  ritmo: number | null
  ritmoExplicacion: string | null
  confianza: Confianza | null
  /** Días que dura con lo que viene (plan) o con lo vendible (inventario) */
  cobertura: number | null
  rotura: string | null
  estado: EstadoStock
  /** El stock de esta referencia sale de otro mercado y es viejo (D11) */
  stockViejo: boolean
}

/** El estado de stock cuando la línea no trae prioridad (cliente externo o inventario): por la cobertura */
function estadoPorCobertura(s: SkuInventario, ritmo: number | null, cobertura: number | null, coberturaMaxima: number): EstadoStock {
  if (s.estado === 'parado' || s.estado === 'sin_ventas' || s.estado === 'sin_datos') return s.estado
  const vende = (ritmo ?? 0) > 0 || s.vendidas.d30 > 0
  if (s.vendibles <= 0 && vende && (cobertura === null || cobertura <= 0)) return 'agotado'
  if (!vende || cobertura === null) return s.estado === 'agotado' ? 'agotado' : 'sin_ventas'
  if (cobertura <= 14) return 'urgente'
  if (cobertura <= 30) return 'bajo'
  if (cobertura > coberturaMaxima) return 'exceso'
  return 'ok'
}

const tienePrioridad = (l: LineaDeStock): l is LineaDeStock & { prioridad: Prioridad; fuera: LineaPlan['fuera'] } =>
  typeof l.prioridad === 'string' && l.fuera !== undefined

/**
 * Una fila por referencia del inventario (las del plan que no están en el inventario no salen: la tabla es lo que hay en
 * Amazon). Ritmo, cobertura y rotura: los del plan si lo tiene; si no, los del inventario.
 */
export function filasDeStock(
  skus: readonly SkuInventario[],
  lineas: readonly LineaDeStock[] | null | undefined,
  opciones: { coberturaMaxima?: number | null } = {},
): FilaStock[] {
  const porSku = new Map<string, LineaDeStock>()
  for (const l of lineas ?? []) porSku.set(l.sku, l)
  const maxima = opciones.coberturaMaxima ?? 120
  return skus.map((s) => {
    const l = porSku.get(s.sku) ?? null
    if (!l) {
      const sinDatos = s.estado === 'sin_datos'
      const ritmo = sinDatos ? null : s.ritmoPlan
      const cobertura = sinDatos ? null : s.vendibles <= 0 ? 0 : s.cobertura
      return {
        sku: s, linea: null, origen: 'inventario', ritmo, ritmoExplicacion: null, confianza: null,
        cobertura, rotura: s.seAgotaEl, estado: s.estado, stockViejo: false,
      }
    }
    const cobertura = l.coberturaConLoQueViene ?? l.coberturaDias
    const ritmo = l.ritmo.base
    const estado = tienePrioridad(l)
      ? estadoDeStock(l as Parameters<typeof estadoDeStock>[0], maxima)
      : estadoPorCobertura(s, ritmo, cobertura, maxima)
    return {
      sku: s, linea: l, origen: 'plan', ritmo, ritmoExplicacion: l.ritmo.explicacion || null, confianza: l.ritmo.confianza,
      cobertura, rotura: l.fechaRotura, estado, stockViejo: (l.avisos ?? []).includes('stock_viejo'),
    }
  })
}

/* ------------------------------------------------------------------ */
/* Calidad de datos sin plan                                           */
/* ------------------------------------------------------------------ */

/** Para la banda cuando no hay plan: lo que se sabe del inventario (libro, atraso, último error, sin conexión) */
export function calidadDeInventario(datos: Pick<InventarioDeCliente, 'libro' | 'leidoHasta' | 'conectado' | 'lectura' | 'marketplaceId'>, hoy: string): CalidadParaBanda {
  return {
    libro: datos.libro,
    leidoHasta: datos.leidoHasta,
    diasAtraso: datos.leidoHasta ? Math.max(0, diasEntre(datos.leidoHasta, hoy)) : null,
    avisos: [],
    ultimoError: datos.lectura?.error ?? null,
    sinConexion: !datos.conectado,
    mercado: datos.marketplaceId,
  }
}

/* ------------------------------------------------------------------ */
/* Barra de stock                                                      */
/* ------------------------------------------------------------------ */

export interface BarraDeStock {
  vendible: number
  camino: number
  reservado: number
  noApto: number
  /** Amazon ha dado el desglose de reservado y no apto. Sin él, «no apto» es «no vendible» (mezcla reservado y dañado) */
  conDesglose: boolean
  total: number
}

export function barraDeStock(datos: Pick<InventarioDeCliente, 'skus' | 'resumen'>): BarraDeStock {
  const conDesglose = datos.skus.some((s) => s.reservadas != null)
  const reservado = conDesglose ? datos.skus.reduce((t, s) => t + Math.max(0, s.reservadas ?? 0), 0) : 0
  const vendible = Math.max(0, datos.resumen.vendibles)
  const camino = Math.max(0, datos.resumen.entrante)
  const noApto = Math.max(0, datos.resumen.noDisponibles)
  return { vendible, camino, reservado, noApto, conDesglose, total: vendible + camino + reservado + noApto }
}

/* ------------------------------------------------------------------ */
/* Ventas: una ventana frente a la anterior                            */
/* ------------------------------------------------------------------ */

export interface VentanaDeVentas {
  unidades: number
  euros: number | null
  udDia: number
  /** null = el libro no llega a cubrir la ventana anterior entera: no se compara */
  anterior: { unidades: number; euros: number | null } | null
}

const sumaEuros = (xs: ReadonlyArray<{ euros: number | null }>): number | null =>
  xs.some((x) => x.euros !== null) ? xs.reduce((t, x) => t + (x.euros ?? 0), 0) : null

/**
 * Los últimos `n` días de `porDia` (ordenado por fecha) frente a los `n` de antes. Si no hay 2n días o el libro empieza
 * después del primer día de la ventana anterior (`leidoDesde`), no hay comparación.
 */
export function ventanaDeVentas(
  porDia: ReadonlyArray<{ fecha: string; unidades: number; euros: number | null }>,
  n: number,
  leidoDesde?: string | null,
): VentanaDeVentas {
  const orden = [...porDia].sort((a, b) => a.fecha.localeCompare(b.fecha))
  const actual = orden.slice(-n)
  const previa = orden.length >= 2 * n ? orden.slice(-2 * n, -n) : []
  const unidades = actual.reduce((t, x) => t + (x.unidades || 0), 0)
  const completa = previa.length === n && (!leidoDesde || leidoDesde <= previa[0].fecha)
  return {
    unidades,
    euros: sumaEuros(actual),
    udDia: actual.length > 0 ? unidades / actual.length : 0,
    anterior: completa ? { unidades: previa.reduce((t, x) => t + (x.unidades || 0), 0), euros: sumaEuros(previa) } : null,
  }
}

/* ------------------------------------------------------------------ */
/* Mapa de cobertura                                                   */
/* ------------------------------------------------------------------ */

/** Las `n` referencias que antes se quedan sin stock, entre las que venden (ritmo > 0). Las de rotura sin fecha, detrás */
export function topCobertura<L extends Pick<LineaDeStock, 'sku' | 'coberturaConLoQueViene' | 'coberturaDias' | 'fechaRotura'> & { ritmo: { base: number | null } }>(
  lineas: readonly L[],
  n = 15,
): L[] {
  const dias = (l: L) => l.coberturaConLoQueViene ?? l.coberturaDias ?? Number.POSITIVE_INFINITY
  return lineas
    .filter((l) => (l.ritmo.base ?? 0) > 0)
    .sort((a, b) => dias(a) - dias(b) || (a.fechaRotura ?? '9999').localeCompare(b.fechaRotura ?? '9999') || a.sku.localeCompare(b.sku))
    .slice(0, n)
}

/* ------------------------------------------------------------------ */
/* Llegadas para la proyección de una referencia                       */
/* ------------------------------------------------------------------ */

export interface LlegadaAproximada {
  fecha: string
  unidades: number
  dudoso: boolean
  nombre: string | null
}

/**
 * La línea del plan dice CUÁNTO viene de camino (deCamino, ya sin lo dudoso; dudoso aparte; entrante sin remesa dentro) pero no CUÁNDO llega cada
 * unidad. Para dibujar la proyección se reparte así (y la ficha lo dice):
 *   · lo de camino que cuenta → en la llegada prevista más próxima de los envíos de camino del cliente que no son dudosos
 *     (o, si no hay ninguno, en hoy + plazo hasta la venta);
 *   · lo entrante sin remesa → en hoy + plazo hasta la venta (como lo cuenta el plan, D2);
 *   · lo dudoso → una llegada hueca (no suma) en la del envío dudoso más antiguo.
 */
export function llegadasAproximadas(
  linea: Pick<LineaDeStock, 'deCamino' | 'dudoso' | 'entranteSinRemesa'>,
  enCamino: ReadonlyArray<Pick<EnCamino, 'llegadaPrevista' | 'dudoso' | 'nombre'>>,
  hoy: string,
  plazoHastaLaVenta?: number | null,
): LlegadaAproximada[] {
  const dudoso = Math.max(0, linea.dudoso ?? 0)
  const sinRemesa = Math.max(0, linea.entranteSinRemesa ?? 0)
  // `deCamino` del plan ya viene SIN lo dudoso (llegadas.ts: max(ERP, Amazon) − dudoso) y CON lo entrante sin remesa
  const cuenta = Math.max(0, linea.deCamino - sinRemesa)
  const porDefecto = sumarDias(hoy, Math.max(1, plazoHastaLaVenta ?? 14))
  const vivos = enCamino.filter((c) => !c.dudoso && c.llegadaPrevista).sort((a, b) => (a.llegadaPrevista ?? '').localeCompare(b.llegadaPrevista ?? ''))
  const dudosos = enCamino.filter((c) => c.dudoso)
  const salida: LlegadaAproximada[] = []
  if (cuenta > 0) {
    const v = vivos[0]
    const f = v?.llegadaPrevista && v.llegadaPrevista > hoy ? v.llegadaPrevista : v?.llegadaPrevista ? hoy : porDefecto
    salida.push({ fecha: f, unidades: cuenta, dudoso: false, nombre: v?.nombre ?? 'De camino' })
  }
  if (sinRemesa > 0) salida.push({ fecha: porDefecto, unidades: sinRemesa, dudoso: false, nombre: 'Entrante en Amazon sin remesa' })
  if (dudoso > 0) {
    const d = dudosos[0]
    salida.push({ fecha: d?.llegadaPrevista && d.llegadaPrevista > hoy ? d.llegadaPrevista : hoy, unidades: dudoso, dudoso: true, nombre: d?.nombre ?? 'Envío dudoso' })
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* El próximo envío propuesto                                          */
/* ------------------------------------------------------------------ */

const ACTIVOS_SIN_PREPARAR = new Set(['nuevo', 'hablado', 'esperando_cliente'])

/** El activo (sin preparar) más urgente: por prioridad y, a igualdad, el que antes tiene que salir */
export function proximoEnvioPropuesto<E extends Pick<EnvioPropuestoGuardado, 'estado' | 'prioridad' | 'salirAntesDe'>>(envios: readonly E[]): E | null {
  const activos = envios.filter((e) => ACTIVOS_SIN_PREPARAR.has(e.estado))
  if (activos.length === 0) return null
  return [...activos].sort((a, b) => ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] || a.salirAntesDe.localeCompare(b.salirAntesDe))[0]
}
