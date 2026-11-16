/**
 * LO QUE VA A LLEGAR A AMAZON DE UNA REFERENCIA, Y CUÁNDO (spec remesas-pro §11 D2 y D3). PURO: `hoy` llega inyectado.
 * =====================================================================================================================
 * Se prueba con llegadas.prueba.ts. La lectura (remesas enviadas, comprometido, envíos hablados) la hace el servidor
 * (plan-datos, con comprometido-datos.ts); aquí solo se decide qué cuenta, qué no y en qué fecha.
 *
 * Cuatro orígenes:
 *
 *   camino              remesas `enviada` con estado de Amazon vivo: lo que falta por recibir (enviadas − recibidas).
 *                       Llega el día max(fecha de envío + transporte, hoy + recepción): un envío con la fecha teórica
 *                       ya pasada no «llegó ayer», llega como pronto cuando Amazon lo procese. Si Amazon ya lo está
 *                       recibiendo (RECEIVING, CHECKED_IN), hoy + recepción.
 *   amazon_sin_remesa   lo que Amazon da como entrante (fba_inbound_quantity) por ENCIMA de lo que el ERP tiene de
 *                       camino. Creative Toys tenía 600 ud de T7-0CG9-DSP7 entrantes sin remesa y el plan pedía 470
 *                       «urgente». Llega hoy + transporte + recepción (no se sabe cuándo salió).
 *   comprometido        remesas que aún no han salido (borrador, aprobada, encajando, lista). Llegan el día
 *                       max(fecha prevista, hoy + preparación que le queda) + transporte + recepción.
 *   envio_hablado       envíos propuestos que el equipo ya ha hablado con el cliente (hablado, esperando_cliente):
 *                       el plan no los vuelve a pedir. Llegan max(salir antes de, hoy + preparación) + transporte + recepción.
 *
 * Y dos cosas que NO cuentan para la cobertura (lo prudente frente a una rotura es no darlas por hechas):
 *
 *   dudoso              un envío de camino con más de max(30, 2,5 × transporte) días y NADA recibido. FBA15MH74MQB
 *                       (Creative Toys) salió el 20 sep y a 15 nov seguía IN_TRANSIT con 0 de 300. Se devuelve en
 *                       `llegadas` con `dudoso: true` y en `descartadas`, para la frase «si llega el envío del 20 sep…».
 *   propuesta_parada    un borrador que lleva 21 días o más sin moverse: nadie lo está preparando.
 *
 * `deCamino` = max(camino del ERP, entrante de Amazon) − dudoso: lo que de verdad se espera.
 */

import type { LlegadaDescartada, LlegadaPrevista, PlazoEtapas } from './plan-tipos'

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

export const UMBRALES_LLEGADAS = {
  /** Un envío es dudoso si lleva más de max(dudosoMinDias, dudosoFactorTransporte × transporte) sin recibir nada */
  dudosoMinDias: 30,
  dudosoFactorTransporte: 2.5,
  /** Un borrador parado este tiempo o más no cuenta como comprometido */
  borradorParadoDias: 21,
} as const

/**
 * Cuánta preparación le queda a una remesa según su fase, como fracción de la etapa de preparación del cliente.
 * Una propuesta en borrador está entera por preparar; una que ya está encajando va por la mitad; una lista solo
 * espera a crear el envío en Amazon.
 */
/** Remesas sin salir que ya pueden tener el envío creado en Amazon (su entrante aparece como `inboundWorking`) */
const ESTADOS_CON_ENVIO_EN_AMAZON = new Set(['encajando', 'lista'])

export const PREPARACION_RESTANTE: Record<string, number> = {
  borrador: 1,
  aprobada: 0.75,
  encajando: 0.5,
  lista: 0.15,
}

/* ------------------------------------------------------------------ */
/* Fechas (días, en UTC: 'YYYY-MM-DD')                                 */
/* ------------------------------------------------------------------ */

const DIA_MS = 86_400_000
const aMs = (f: string): number => Date.parse(`${f.slice(0, 10)}T00:00:00Z`)

function sumarDias(f: string, n: number): string {
  return new Date(aMs(f) + Math.round(n) * DIA_MS).toISOString().slice(0, 10)
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((aMs(hasta) - aMs(desde)) / DIA_MS)
}

const maxFecha = (a: string, b: string): string => (a >= b ? a : b)

const esFecha = (f: unknown): f is string => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}/.test(f) && !Number.isNaN(aMs(f))

const entero = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0)

/* ------------------------------------------------------------------ */
/* Envío dudoso                                                        */
/* ------------------------------------------------------------------ */

/**
 * ¿Un envío de camino es dudoso? Sí si lleva más de max(30, 2,5 × transporte mediano) días desde que salió y Amazon no
 * ha recibido NADA de él. Sin transporte medido, el umbral es 30 días.
 *
 * `recibidas` son las del envío ENTERO, no las de una referencia: un envío del que Amazon ya ha recibido algo existe,
 * aunque a una línea le falten unidades (eso es «cerrado con faltantes», otra cosa).
 */
export function esEnvioDudoso(edadDias: number, recibidas: number, transporteMediano: number | null): boolean {
  if (!Number.isFinite(edadDias)) return false
  if (recibidas > 0) return false
  const transporte = transporteMediano !== null && Number.isFinite(transporteMediano) && transporteMediano > 0 ? transporteMediano : 0
  const umbral = Math.max(UMBRALES_LLEGADAS.dudosoMinDias, UMBRALES_LLEGADAS.dudosoFactorTransporte * transporte)
  return edadDias > umbral
}

/**
 * El transporte con el que se mide si un envío es dudoso. UNA sola regla para el plan, los Pendientes de «Hoy», el Resumen
 * global y el detalle de un envío: el transporte mediano medido (primer Receipt) y, si no hay medida, el del plazo (manual o
 * de partida). Antes cada pantalla usaba el suyo: Portico (transporte manual 45 d) con un envío de 35 días no era dudoso en el
 * plan (umbral 112) y sí en «Hoy» y en el Resumen (umbral 30), que decían «el plan no lo cuenta» cuando sí lo contaba. Puro.
 */
export function transporteParaDudoso(transporteMediano: number | null | undefined, transportePlazo: number | null | undefined): number | null {
  const valido = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0
  if (valido(transporteMediano)) return transporteMediano
  if (valido(transportePlazo)) return transportePlazo
  return null
}

/** Estados de Amazon en los que el envío ya está en el almacén (recibiendo) */
export const ESTADOS_AMAZON_RECIBIENDO = ['RECEIVING', 'CHECKED_IN']

/**
 * Cuándo llega un envío de camino (la misma regla en el plan y en el Resumen global): si Amazon ya lo está recibiendo,
 * hoy + recepción; si salió, max(salida + transporte, hoy + recepción); sin fecha de salida, hoy + transporte + recepción. Puro.
 */
export function llegadaPrevistaDeCamino(
  r: { estadoAmazon: string | null; fechaEnvio: string | null },
  hoy: string,
  plazo: Pick<PlazoEtapas, 'transporte' | 'recepcion'>,
): string {
  const estado = (r.estadoAmazon ?? '').toUpperCase()
  const transporte = entero(plazo.transporte)
  const recepcion = entero(plazo.recepcion)
  if (ESTADOS_AMAZON_RECIBIENDO.includes(estado)) return sumarDias(hoy, recepcion)
  if (r.fechaEnvio && esFecha(r.fechaEnvio)) return maxFecha(sumarDias(r.fechaEnvio, transporte), sumarDias(hoy, recepcion))
  return sumarDias(hoy, transporte + recepcion)
}

/** ¿Es dudoso un envío de camino? La regla única: edad desde la salida, recibidas del envío entero y `transporteParaDudoso`. Puro. */
export function caminoEsDudoso(
  r: { fechaEnvio: string | null; recibidas: number | null },
  hoy: string,
  transporteMediano: number | null | undefined,
  transportePlazo: number | null | undefined,
): boolean {
  if (!r.fechaEnvio || !esFecha(r.fechaEnvio)) return false
  return esEnvioDudoso(diasEntre(r.fechaEnvio, hoy), Math.max(0, r.recibidas ?? 0), transporteParaDudoso(transporteMediano, transportePlazo))
}

/* ------------------------------------------------------------------ */
/* Llegadas de una referencia                                          */
/* ------------------------------------------------------------------ */

export interface CaminoErp {
  remesaId: string
  nombre: string | null
  /** 'YYYY-MM-DD' en que salió el envío */
  fechaEnvio: string | null
  estadoAmazon: string | null
  /** Unidades de ESTA referencia que faltan por recibir (enviadas − recibidas) */
  pendiente: number
  /** Unidades recibidas de TODO el envío (para decir si es dudoso) */
  recibidas: number
  /** Amazon ya lo está recibiendo (RECEIVING, CHECKED_IN…) */
  enRecepcion: boolean
}

export interface ComprometidoRemesa {
  remesaId: string
  nombre: string | null
  /** borrador | aprobada | encajando | lista */
  estado: string
  /** Fecha prevista de envío de la remesa */
  fechaEnvio: string | null
  /** Días desde el último cambio de la remesa */
  diasParada: number | null
  unidades: number
}

export interface EnvioHablado {
  envioPropuestoId: string
  salirAntesDe: string
  unidades: number
}

export interface EntradaLlegadas {
  sku: string
  hoy: string
  plazo: PlazoEtapas
  caminoErp: CaminoErp[]
  /** fba_inbound_quantity de Amazon para esta referencia */
  entranteAmazon: number
  comprometido: ComprometidoRemesa[]
  hablados: EnvioHablado[]
  /** Transporte mediano medido (envío → primer Receipt); sin medida, el del plazo */
  transporteMediano: number | null
}

export interface ResultadoLlegadas {
  /** Ordenadas por fecha. Las dudosas van con `dudoso: true` (no cuentan para la cobertura) */
  llegadas: LlegadaPrevista[]
  /** Lo que no cuenta: envíos dudosos y propuestas paradas */
  descartadas: LlegadaDescartada[]
  /** max(camino del ERP, entrante de Amazon − lo comprometido en «lista»/«encajando») − dudoso */
  deCamino: number
  /** Entrante de Amazon por encima de lo que el ERP tiene de camino */
  entranteSinRemesa: number
  /** Unidades de camino que no se cuentan por dudosas */
  dudoso: number
}

export function llegadasDeSku(entrada: EntradaLlegadas): ResultadoLlegadas {
  const { hoy, plazo } = entrada
  const transporte = entero(plazo.transporte)
  const recepcion = entero(plazo.recepcion)
  const preparacion = entero(plazo.preparacion)
  // Para el umbral de «dudoso»: el medido; si no hay, el del plazo (Portico tarda 60 días y no es dudoso a los 31)
  const transporteDudoso = transporteParaDudoso(entrada.transporteMediano, transporte)

  const llegadas: LlegadaPrevista[] = []
  const descartadas: LlegadaDescartada[] = []

  /* ---------- camino: remesas enviadas ---------- */
  let caminoErp = 0
  let dudoso = 0
  for (const c of entrada.caminoErp) {
    const pendiente = entero(c.pendiente)
    if (pendiente <= 0) continue
    caminoErp += pendiente

    const fechaEnvio = esFecha(c.fechaEnvio) ? c.fechaEnvio.slice(0, 10) : null
    const edad = fechaEnvio ? diasEntre(fechaEnvio, hoy) : null
    const esDudoso = edad !== null && esEnvioDudoso(edad, entero(c.recibidas), transporteDudoso)

    let fecha: string
    if (c.enRecepcion) fecha = sumarDias(hoy, recepcion)
    else if (fechaEnvio) fecha = maxFecha(sumarDias(fechaEnvio, transporte), sumarDias(hoy, recepcion))
    // Sin fecha de salida no se sabe: lo prudente es la llegada más tardía razonable
    else fecha = sumarDias(hoy, transporte + recepcion)

    llegadas.push({
      fecha, unidades: pendiente, origen: 'camino',
      remesaId: c.remesaId, envioPropuestoId: null, nombre: c.nombre ?? null,
      dudoso: esDudoso, fechaEnvio,
    })
    if (esDudoso) {
      dudoso += pendiente
      descartadas.push({ unidades: pendiente, motivo: 'dudoso', nombre: c.nombre ?? null, desde: fechaEnvio })
    }
  }

  /* ---------- lo que Amazon da como entrante y el ERP no tiene ---------- */
  // El entrante de Amazon incluye el `inboundWorking`: aparece en cuanto se crea el envío en Amazon («Enviar a Amazon» o el
  // manifiesto), con la remesa aún en «lista» o «encajando». Esas unidades ya cuentan como comprometidas: no se cuentan dos veces
  const entranteAmazon = entero(entrada.entranteAmazon)
  let comprometidoVivo = 0
  for (const r of entrada.comprometido) if (ESTADOS_CON_ENVIO_EN_AMAZON.has(r.estado)) comprometidoVivo += entero(r.unidades)
  const entranteSinRemesa = Math.max(0, entranteAmazon - caminoErp - comprometidoVivo)
  if (entranteSinRemesa > 0) {
    llegadas.push({
      fecha: sumarDias(hoy, transporte + recepcion), unidades: entranteSinRemesa, origen: 'amazon_sin_remesa',
      remesaId: null, envioPropuestoId: null, nombre: null, dudoso: false, fechaEnvio: null,
    })
  }

  /* ---------- comprometido: remesas que aún no han salido ---------- */
  for (const r of entrada.comprometido) {
    const unidades = entero(r.unidades)
    if (unidades <= 0) continue
    const fechaEnvio = esFecha(r.fechaEnvio) ? r.fechaEnvio.slice(0, 10) : null
    const parada = r.diasParada !== null && Number.isFinite(r.diasParada) ? Math.max(0, Math.round(r.diasParada)) : null

    if (r.estado === 'borrador' && parada !== null && parada >= UMBRALES_LLEGADAS.borradorParadoDias) {
      descartadas.push({ unidades, motivo: 'propuesta_parada', nombre: r.nombre ?? null, desde: sumarDias(hoy, -parada) })
      continue
    }

    const fraccion = PREPARACION_RESTANTE[r.estado] ?? 1
    const listoPara = sumarDias(hoy, Math.ceil(preparacion * fraccion))
    const salida = fechaEnvio ? maxFecha(fechaEnvio, listoPara) : listoPara
    llegadas.push({
      fecha: sumarDias(salida, transporte + recepcion), unidades, origen: 'comprometido',
      remesaId: r.remesaId, envioPropuestoId: null, nombre: r.nombre ?? null, dudoso: false, fechaEnvio: fechaEnvio,
      estadoRemesa: r.estado ?? null,
    })
  }

  /* ---------- envíos propuestos ya hablados con el cliente ---------- */
  for (const h of entrada.hablados) {
    const unidades = entero(h.unidades)
    if (unidades <= 0 || !esFecha(h.salirAntesDe)) continue
    const salida = maxFecha(h.salirAntesDe.slice(0, 10), sumarDias(hoy, preparacion))
    llegadas.push({
      fecha: sumarDias(salida, transporte + recepcion), unidades, origen: 'envio_hablado',
      remesaId: null, envioPropuestoId: h.envioPropuestoId, nombre: null, dudoso: false, fechaEnvio: null,
    })
  }

  llegadas.sort((a, b) => a.fecha.localeCompare(b.fecha) || Number(a.dudoso) - Number(b.dudoso))

  return {
    llegadas,
    descartadas,
    deCamino: Math.max(0, Math.max(caminoErp, entranteAmazon - comprometidoVivo) - dudoso),
    entranteSinRemesa,
    dudoso,
  }
}
