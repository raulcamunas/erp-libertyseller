/**
 * ESTILO DEL PLAN DE REPOSICIÓN: UNA SOLA TABLA DE TONOS Y TEXTOS (spec remesas-pro §6.2, D41 y D42).
 *
 * Puro (sin React): se prueba con `npx tsx components/remesas/comun/piezas.prueba.ts`. Los tonos son los de
 * `COLOR_ESTADO` (lib/estilo/denso) y se pintan con la `Insignia` del kit: `<Insignia {...insigniaDePrioridad(p)} />`.
 *
 * API
 *   EstiloEstado = { tono, texto, corto, variante, vivo? }       lo que necesita una Insignia del kit
 *   PRIORIDAD[p], ORDEN_PRIORIDAD[p], compararPrioridad(a, b)    tarde rojo sólida y late · urgente rojo · esta semana naranja ·
 *                                                                 próximas 2 ámbar · este mes azul · más adelante gris
 *   EstadoStock, ESTADO_STOCK[e], estadoDeStock(linea, maxima?)  agotado · urgente · bajo · ok · exceso · parado · sin ventas · sin datos
 *   ESTADO_ENVIO[e]                                               nuevo azul · hablado cian · esperando ámbar · preparación violeta ·
 *                                                                 enviado verde · descartado gris · caducado gris contorno
 *   CONFIANZA[c] (null = sin insignia, la alta)                   media gris · baja ámbar contorno · sin datos gris
 *   SALUD[t]                                                      rojo · ámbar · verde · gris («sin datos», detrás de rojo y ámbar)
 *   ORIGEN_ETAPA[o], MOTIVO_FUERA[m], AVISO_LINEA[a], MOTIVO_DESCARTE[m]   textos cortos para la pantalla
 *   avisosDeBanda(calidad, opciones)                              los avisos de la BandaDeCalidad, con tono y acción
 *   Formatos: fechaCorta («3 dic»), dias, unidades, ritmo, dinero (con moneda), dineroPorMoneda, entero, decimal (de ../formato)
 */

import type { TonoEstado } from '@/lib/estilo/denso'
import type {
  AvisoLinea, CalidadDatos, Confianza, EstadoEnvioPropuesto, LineaPlan, MotivoDescarte, MotivoFuera, OrigenEtapa, Prioridad, TonoSalud,
} from '@/lib/fba/plan-tipos'
import { fechaCorta } from '../formato'

export {
  decimal, dias, diasEntre, dinero, dineroPorMoneda, entero, fecha, fechaCorta, porcentaje, ritmo, simboloDe, sumarDias, unidades,
} from '../formato'

export interface EstiloEstado {
  tono: TonoEstado
  /** La palabra larga: «Esta semana» */
  texto: string
  /** Para chips estrechos y el móvil: «Semana» */
  corto: string
  variante: 'suave' | 'solida' | 'contorno'
  /** Punto que late (solo lo pinta el escritorio; la Insignia del kit ya se para en el móvil) */
  vivo?: boolean
}

/* ------------------------------------------------------------------ */
/* Prioridad                                                           */
/* ------------------------------------------------------------------ */

export const PRIORIDAD: Record<Prioridad, EstiloEstado> = {
  tarde: { tono: 'rojo', texto: 'Tarde', corto: 'Tarde', variante: 'solida', vivo: true },
  urgente: { tono: 'rojo', texto: 'Urgente', corto: 'Urgente', variante: 'suave' },
  esta_semana: { tono: 'naranja', texto: 'Esta semana', corto: 'Semana', variante: 'suave' },
  proximas_2: { tono: 'ambar', texto: 'Próximas 2 semanas', corto: '2 semanas', variante: 'suave' },
  este_mes: { tono: 'azul', texto: 'Este mes', corto: 'Mes', variante: 'suave' },
  mas_adelante: { tono: 'gris', texto: 'Más adelante', corto: 'Después', variante: 'suave' },
}

export const ORDEN_PRIORIDAD: Record<Prioridad, number> = { tarde: 0, urgente: 1, esta_semana: 2, proximas_2: 3, este_mes: 4, mas_adelante: 5 }

/** Para `sort`: lo más urgente primero */
export const compararPrioridad = (a: Prioridad, b: Prioridad): number => ORDEN_PRIORIDAD[a] - ORDEN_PRIORIDAD[b]

/* ------------------------------------------------------------------ */
/* Estado del stock de una referencia                                  */
/* ------------------------------------------------------------------ */

export type EstadoStock = 'agotado' | 'urgente' | 'bajo' | 'ok' | 'exceso' | 'parado' | 'sin_ventas' | 'sin_datos'

export const ESTADO_STOCK: Record<EstadoStock, EstiloEstado> = {
  agotado: { tono: 'rojo', texto: 'Agotado', corto: 'Agotado', variante: 'solida' },
  urgente: { tono: 'rojo', texto: 'Rompe pronto', corto: 'Urgente', variante: 'suave' },
  bajo: { tono: 'ambar', texto: 'Stock bajo', corto: 'Bajo', variante: 'suave' },
  ok: { tono: 'verde', texto: 'Bien', corto: 'Bien', variante: 'suave' },
  exceso: { tono: 'violeta', texto: 'De sobra', corto: 'Exceso', variante: 'suave' },
  parado: { tono: 'magenta', texto: 'Parado', corto: 'Parado', variante: 'suave' },
  sin_ventas: { tono: 'gris', texto: 'Sin ventas', corto: 'Sin ventas', variante: 'suave' },
  sin_datos: { tono: 'gris', texto: 'Sin datos', corto: 'Sin datos', variante: 'contorno' },
}

type LineaParaEstado = Pick<LineaPlan, 'vendibles' | 'fuera' | 'prioridad' | 'coberturaConLoQueViene' | 'coberturaDias'> & {
  ritmo: Pick<LineaPlan['ritmo'], 'confianza' | 'base' | 'ventas30'>
}

/**
 * El estado de stock de una línea del plan, en este orden: parado y sin ventas (lo dice el plan) → sin datos →
 * agotado (V = 0 y vende) → exceso (lo dice el plan, o cubre más que la cobertura máxima) → urgente (tarde o urgente)
 * → bajo (esta semana o próximas 2) → bien.
 */
export function estadoDeStock(l: LineaParaEstado, coberturaMaxima?: number | null): EstadoStock {
  if (l.fuera === 'parado') return 'parado'
  if (l.fuera === 'sin_ventas') return 'sin_ventas'
  const vende = (l.ritmo.base ?? 0) > 0 || (l.ritmo.ventas30 ?? 0) > 0
  if (l.vendibles <= 0 && vende && l.ritmo.confianza !== 'sin_datos') return 'agotado'
  if (l.fuera === 'sin_datos' || l.ritmo.confianza === 'sin_datos') return l.vendibles <= 0 && vende ? 'agotado' : 'sin_datos'
  const cobertura = l.coberturaConLoQueViene ?? l.coberturaDias
  if (l.fuera === 'exceso' || (coberturaMaxima != null && cobertura != null && cobertura > coberturaMaxima)) return 'exceso'
  if (l.fuera === null || l.fuera === 'aun_no_toca' || l.fuera === 'cantidad_ridicula' || l.fuera === 'en_cuarentena') {
    if (l.prioridad === 'tarde' || l.prioridad === 'urgente') return 'urgente'
    if (l.prioridad === 'esta_semana' || l.prioridad === 'proximas_2') return 'bajo'
  }
  return 'ok'
}

/* ------------------------------------------------------------------ */
/* Estado del envío propuesto                                          */
/* ------------------------------------------------------------------ */

export const ESTADO_ENVIO: Record<EstadoEnvioPropuesto, EstiloEstado> = {
  nuevo: { tono: 'azul', texto: 'Nuevo', corto: 'Nuevo', variante: 'suave' },
  hablado: { tono: 'cian', texto: 'Hablado', corto: 'Hablado', variante: 'suave' },
  esperando_cliente: { tono: 'ambar', texto: 'Esperando al cliente', corto: 'Esperando', variante: 'suave' },
  en_preparacion: { tono: 'violeta', texto: 'En preparación', corto: 'Preparando', variante: 'suave' },
  enviado: { tono: 'verde', texto: 'Enviado', corto: 'Enviado', variante: 'suave' },
  descartado: { tono: 'gris', texto: 'Descartado', corto: 'Descartado', variante: 'suave' },
  caducado: { tono: 'gris', texto: 'Caducado', corto: 'Caducado', variante: 'contorno' },
}

/* ------------------------------------------------------------------ */
/* Confianza y salud                                                   */
/* ------------------------------------------------------------------ */

/** La confianza alta no lleva insignia: es lo normal y no hace falta decirlo */
export const CONFIANZA: Record<Confianza, EstiloEstado | null> = {
  alta: null,
  media: { tono: 'gris', texto: 'Confianza media', corto: 'media', variante: 'suave' },
  baja: { tono: 'ambar', texto: 'Confianza baja', corto: 'baja', variante: 'contorno' },
  sin_datos: { tono: 'gris', texto: 'Sin datos suficientes', corto: 'sin datos', variante: 'suave' },
}

export const SALUD: Record<TonoSalud, EstiloEstado> = {
  rojo: { tono: 'rojo', texto: 'Hay que actuar', corto: 'Actuar', variante: 'suave' },
  ambar: { tono: 'ambar', texto: 'Vigilar', corto: 'Vigilar', variante: 'suave' },
  verde: { tono: 'verde', texto: 'Al día', corto: 'Al día', variante: 'suave' },
  gris: { tono: 'gris', texto: 'Sin datos', corto: 'Sin datos', variante: 'contorno' },
}

/* ------------------------------------------------------------------ */
/* Textos cortos                                                       */
/* ------------------------------------------------------------------ */

export const ORIGEN_ETAPA: Record<OrigenEtapa, { texto: string; tono: TonoEstado }> = {
  manual: { texto: 'puesto a mano', tono: 'verde' },
  medido: { texto: 'medido', tono: 'cian' },
  partida: { texto: 'de partida', tono: 'ambar' },
}

export const MOTIVO_FUERA: Record<MotivoFuera, string> = {
  sin_ventas: 'Sin ventas en 90 días',
  descatalogada: 'Descatalogada',
  no_comprable: 'No se puede comprar en Amazon',
  sin_datos: 'Sin datos suficientes',
  stock_de_sobra: 'Tiene stock de sobra',
  aun_no_toca: 'Aún no toca',
  cantidad_ridicula: 'Cubre menos de una semana',
  parado: 'Stock parado',
  antiguo: 'Stock antiguo: que rote antes',
  en_cuarentena: 'Descartado hace poco',
  agotado_largo: 'Agotado hace tiempo: ¿se repone?',
  talla_sin_ventas: 'Talla sin ventas en 180 días',
  exceso: 'Exceso de stock',
}

export const AVISO_LINEA: Record<AvisoLinea, { texto: string; tono: TonoEstado }> = {
  devoluciones_altas: { texto: 'Muchas devoluciones: revisar', tono: 'ambar' },
  antiguo: { texto: 'Stock antiguo', tono: 'magenta' },
  sin_precio: { texto: 'Sin precio', tono: 'gris' },
  plazo_de_partida: { texto: 'Plazo de partida', tono: 'ambar' },
  adelantada: { texto: 'Se adelanta para aprovechar el envío', tono: 'azul' },
  recortada_capacidad: { texto: 'Recortada por capacidad', tono: 'ambar' },
  provisional: { texto: 'Provisional', tono: 'ambar' },
  pedido_grande: { texto: 'Pedido grande que no cuenta', tono: 'gris' },
  entrante_sin_remesa: { texto: 'Entrante en Amazon sin remesa', tono: 'ambar' },
  envio_dudoso: { texto: 'Envío dudoso que no cuenta', tono: 'rojo' },
  comprometido_parado: { texto: 'Propuesta parada que no cuenta', tono: 'ambar' },
  stock_viejo: { texto: 'Stock de otro mercado y viejo', tono: 'gris' },
  llega_tarde_campana: { texto: 'Llega tarde a la campaña', tono: 'rojo' },
  tope_estacional: { texto: 'Temporada topada', tono: 'azul' },
  merma_alta: { texto: 'Merma alta', tono: 'magenta' },
  almacen_cliente_corto: { texto: 'El cliente tiene menos en su almacén', tono: 'ambar' },
  solo_r14: { texto: 'Solo 14 días de ritmo', tono: 'gris' },
}

export const MOTIVO_DESCARTE: Record<MotivoDescarte, string> = {
  cliente_sin_stock: 'El cliente no tiene stock',
  cliente_no_quiere: 'El cliente no quiere enviarlo',
  ya_enviado_aparte: 'Ya se envió por otro lado',
  datos_erroneos: 'Los datos están mal',
  producto_cambia: 'El producto cambia',
  descatalogada: 'Se deja de vender',
  otro: 'Otro motivo',
}

/* ------------------------------------------------------------------ */
/* Avisos de la banda de calidad                                       */
/* ------------------------------------------------------------------ */

export type AccionDeBanda = 'leer' | 'plazos' | 'importar' | null

export interface AvisoDeBanda {
  id: string
  tono: TonoEstado
  gravedad: 'alta' | 'media' | 'info'
  texto: string
  accion: AccionDeBanda
}

/** Lo que la banda sabe leer: el `CalidadDatos` entero del plan o el recorte del cliente externo */
export type CalidadParaBanda = Pick<CalidadDatos, 'libro' | 'leidoHasta' | 'diasAtraso' | 'avisos'> & Partial<Omit<CalidadDatos, 'libro' | 'leidoHasta' | 'diasAtraso' | 'avisos'>>

/** Atraso (días) a partir del cual la banda avisa en ámbar; > 7 el plan sale provisional (§1.1) */
export const ATRASO_AVISO = 3
export const ATRASO_PROVISIONAL = 7
/** Horas desde el cálculo del plan a partir de las cuales se avisa (D28) */
export const HORAS_PLAN_VIEJO = 36

/**
 * Los textos de `calidad.avisos` que ya cubre un aviso con su campo (plan-cliente.ts → avisosDeCalidad redacta los mismos
 * hechos). Los que no encajan aquí (el aviso de la lectura elegida, cualquiera que se añada mañana) salen tal cual, en gris.
 */
const YA_CUBIERTOS = [
  /^Sin API de Amazon/i, /no se han leído/i, /^No te fíes/i, /^La última lectura/i, /^Ventas leídas hasta/i, /^El libro solo cubre/i,
  /conexiones de Amazon activas/i, /Plazo «de partida»/i, /sin precio/i, /no están? en la base de datos/i, /pierde el .* %/i,
]

/**
 * Los avisos de la banda, de más a menos grave. Cada uno con su tono y, si la tiene, su acción:
 *   leer     → «Leer de Amazon» (solo admin; los demás leen «Pide a un administrador que lea las ventas»)
 *   plazos   → «Confirmar plazos» / «Poner plazos»
 */
export function avisosDeBanda(c: CalidadParaBanda | null, opciones: { hoy?: string | null } = {}): AvisoDeBanda[] {
  if (!c) return []
  const a: AvisoDeBanda[] = []
  const hasta = c.leidoHasta ? fechaCorta(c.leidoHasta, opciones.hoy) : null
  const atraso = c.diasAtraso ?? null

  if (c.sinConexion) {
    a.push({ id: 'sin_conexion', tono: 'gris', gravedad: 'alta', accion: null, texto: 'Sin API de Amazon: las ventas no se descuentan solas y no se puede planificar' })
  }
  if (c.libro === 'sin_leer') {
    a.push({ id: 'sin_leer', tono: 'rojo', gravedad: 'alta', accion: c.sinConexion ? null : 'leer', texto: 'No hay ventas leídas: no se puede planificar' })
  } else if ((c.provisional || (atraso !== null && atraso > ATRASO_PROVISIONAL)) && hasta) {
    a.push({ id: 'provisional', tono: 'rojo', gravedad: 'alta', accion: 'leer', texto: `No te fíes de las fechas: las ventas están leídas hasta el ${hasta} (${atraso ?? '?'} días). El plan es provisional` })
  } else if (atraso !== null && atraso > ATRASO_AVISO && hasta) {
    a.push({ id: 'atraso', tono: 'ambar', gravedad: 'media', accion: 'leer', texto: `Ventas leídas hasta el ${hasta} (${atraso} días de atraso)` })
  }
  if (c.ultimoError) {
    a.push({ id: 'error', tono: 'rojo', gravedad: 'alta', accion: 'leer', texto: `La última lectura de Amazon falló: ${c.ultimoError.slice(0, 160)}` })
  }
  if (c.libro === 'corto') {
    a.push({ id: 'corto', tono: 'ambar', gravedad: 'media', accion: null, texto: 'El libro de ventas es corto: el ritmo de 90 días y la temporada van a medias' })
  }
  if (c.plazoDePartida) {
    a.push({ id: 'plazo', tono: 'ambar', gravedad: 'media', accion: 'plazos', texto: 'Plazos «de partida»: nadie los ha confirmado. Confírmalos o ponlos para que las fechas sean de verdad' })
  }
  if (c.horasDesdeCalculo != null && c.horasDesdeCalculo > HORAS_PLAN_VIEJO) {
    const d = Math.floor(c.horasDesdeCalculo / 24)
    a.push({ id: 'plan_viejo', tono: 'ambar', gravedad: 'media', accion: null, texto: `El plan se calculó hace ${d >= 2 ? `${d} días` : `${Math.round(c.horasDesdeCalculo)} h`}: puede no estar al día` })
  }
  if (c.conexionesActivas != null && c.conexionesActivas > 1) {
    a.push({ id: 'conexiones', tono: 'gris', gravedad: 'info', accion: null, texto: `Hay ${c.conexionesActivas} conexiones de Amazon activas: el plan usa la de la lectura elegida` })
  }
  if (c.refsFueraDeCatalogo != null && c.refsFueraDeCatalogo > 0) {
    const n = c.refsFueraDeCatalogo
    a.push({ id: 'catalogo', tono: 'ambar', gravedad: 'media', accion: null, texto: `${n} referencia${n === 1 ? '' : 's'} que vende${n === 1 ? '' : 'n'} no está${n === 1 ? '' : 'n'} en la base de datos` })
  }
  if (c.pctMerma90 != null && c.pctMerma90 > 5) {
    a.push({ id: 'merma', tono: 'magenta', gravedad: 'media', accion: null, texto: `Se pierde el ${String(Math.round(c.pctMerma90 * 10) / 10).replace('.', ',')} % de lo vendido por daños y retiradas: revisa el embalaje y reclama` })
  }
  if (c.sinPrecio != null && c.sinPrecio > 0) {
    const n = c.sinPrecio
    a.push({ id: 'sin_precio', tono: 'gris', gravedad: 'info', accion: null, texto: `${n} referencia${n === 1 ? '' : 's'} sin precio: su € en juego no se puede calcular` })
  }
  for (const [i, t] of (c.avisos ?? []).entries()) {
    if (!t || YA_CUBIERTOS.some((r) => r.test(t))) continue
    a.push({ id: `texto_${i}`, tono: 'gris', gravedad: 'info', accion: null, texto: t })
  }
  const peso = { alta: 0, media: 1, info: 2 } as const
  return a.map((x, i) => ({ x, i })).sort((p, q) => peso[p.x.gravedad] - peso[q.x.gravedad] || p.i - q.i).map((p) => p.x)
}
