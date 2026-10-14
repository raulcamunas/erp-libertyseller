import type { EstadoRemesa, Actor } from './flujo'

/**
 * LO QUE DECIDE QUÉ SE VE DÓNDE EN REMESAS A FBA.
 * PURA: sin base de datos ni red. Se comprueba con vista.prueba.ts.
 *
 *
 * ============ DOS COSAS DISTINTAS, DOS PANTALLAS ============
 *
 *   ENVÍOS       lo que ya ha salido: remesas `enviada` o `cerrada`. Existen en
 *                Seller Central, se pueden seguir y venden. Es lo VERÍDICO.
 *   PROPUESTAS   lo que se está trabajando con el cliente: `borrador`,
 *                `aprobada`, `encajando` y `lista`. Todavía no existe en Amazon.
 *
 * Una propuesta se convierte en envío al marcarla como enviada, y para eso hay
 * que enlazarla con su número de envío FBA (ver lib/fba/flujo.ts). Las remesas
 * antiguas que se dieron por cerradas sin número siguen siendo envíos, pero
 * «sin enlazar»: se enseñan aparte, no se pierden.
 */

type Con<K extends string, V> = { [P in K]: V }

export const ESTADOS_ENVIO: readonly EstadoRemesa[] = ['enviada', 'cerrada']
export const FASES_PROPUESTA = ['borrador', 'aprobada', 'encajando', 'lista'] as const
export type FasePropuesta = (typeof FASES_PROPUESTA)[number]

export const esEnvio = (r: Con<'estado', EstadoRemesa>): boolean => ESTADOS_ENVIO.includes(r.estado)
export const esPropuesta = (r: Con<'estado', EstadoRemesa>): boolean => !esEnvio(r)

/** ¿Está enlazada con un envío de Amazon? Basta con que tenga su número */
export const estaEnlazada = (r: { referenciaEnvio: string | null }): boolean =>
  (r.referenciaEnvio ?? '').trim() !== ''

/* ------------------------------------------------------------------ */
/* El recorrido REAL de un envío en Amazon                             */
/* ------------------------------------------------------------------ */

/**
 * Los pasos de «Progreso del envío» de Seller Central, con los estados de la API
 * que caen en cada uno. SHIPPED e IN_TRANSIT son el mismo paso para quien mira:
 * Seller Central tampoco los separa.
 */
export const PASOS_AMAZON = [
  { id: 'creado', texto: 'Creado', estados: ['WORKING', 'READY_TO_SHIP'] },
  { id: 'transito', texto: 'En tránsito', estados: ['SHIPPED', 'IN_TRANSIT'] },
  { id: 'entregado', texto: 'Entregado', estados: ['DELIVERED'] },
  { id: 'registrado', texto: 'Registrado', estados: ['CHECKED_IN'] },
  { id: 'recibiendo', texto: 'Recibiendo', estados: ['RECEIVING'] },
  { id: 'cerrado', texto: 'Cerrado', estados: ['CLOSED'] },
] as const

/** Los estados en los que el envío no va a ninguna parte */
export const ESTADOS_AMAZON_MALOS: readonly string[] = ['CANCELLED', 'DELETED', 'ERROR']

/** En qué paso va. -1 si no se sabe o si el envío está cancelado o con error */
export function indicePasoAmazon(estado: string | null | undefined): number {
  if (!estado) return -1
  return PASOS_AMAZON.findIndex((p) => (p.estados as readonly string[]).includes(estado))
}

/** Está de camino o recibiéndose: ni preparándose ni cerrado */
export function estaEnCamino(estado: string | null | undefined): boolean {
  const i = indicePasoAmazon(estado)
  return i >= 1 && i <= 4
}

export interface EventoSimple {
  vistoAt: string
  estadoAmazon: string | null
}

/**
 * Cuándo se VIO cada paso por primera vez. null = se pasó por él sin que ninguna
 * consulta lo cogiera (el envío se mira cada hora, y a veces salta dos pasos de
 * golpe). La hora es la de la observación, no la de Amazon.
 */
export function fechasDePasos(eventos: EventoSimple[]): Array<string | null> {
  const salida: Array<string | null> = PASOS_AMAZON.map(() => null)
  for (const e of [...eventos].sort((a, b) => a.vistoAt.localeCompare(b.vistoAt))) {
    const i = indicePasoAmazon(e.estadoAmazon)
    if (i >= 0 && salida[i] === null) salida[i] = e.vistoAt
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* De quién es el turno en una propuesta                               */
/* ------------------------------------------------------------------ */

export interface Turno {
  /** Quién tiene que mover la propuesta ahora */
  quien: Actor
  /** Lo que se le dice a la AGENCIA */
  paraAgencia: string
  /** Lo que se le dice al CLIENTE */
  paraCliente: string
}

/**
 * De quién es el turno, según el paso en el que está. Es el reparto del flujo
 * (lib/fba/flujo.ts) puesto en una frase:
 *
 *   borrador     la agencia monta, el cliente aprueba
 *   aprobada     el cliente etiqueta y pasa a encajar
 *   encajando    el cliente mete la mercancía en cajas
 *   lista        la agencia crea el envío en Seller Central
 */
export function turnoDe(estado: EstadoRemesa, lineas: number): Turno {
  switch (estado) {
    case 'borrador':
      return lineas === 0
        ? { quien: 'agencia', paraAgencia: 'Hay que montar qué se manda', paraCliente: 'Liberty Seller está montando la propuesta' }
        : { quien: 'cliente', paraAgencia: 'Esperando el OK del cliente', paraCliente: 'Te toca aprobar la propuesta' }
    case 'aprobada':
      return { quien: 'cliente', paraAgencia: 'Esperando que el cliente etiquete y encaje', paraCliente: 'Te toca etiquetar y empezar a encajar' }
    case 'encajando':
      return { quien: 'cliente', paraAgencia: 'Esperando las cajas del cliente', paraCliente: 'Te toca encajar: medidas, pesos y qué va en cada caja' }
    case 'lista':
      return { quien: 'agencia', paraAgencia: 'Te toca crear el envío en Seller Central', paraCliente: 'Liberty Seller está preparando el envío en Amazon' }
    default:
      return { quien: 'agencia', paraAgencia: 'Enviada', paraCliente: 'Enviada' }
  }
}

/** ¿Le toca mover a quien mira? */
export function leToca(turno: Turno, quienMira: Actor): boolean {
  return turno.quien === quienMira
}

/* ------------------------------------------------------------------ */
/* Pequeñas cuentas                                                    */
/* ------------------------------------------------------------------ */

/** Días enteros entre dos fechas 'YYYY-MM-DD' (o ISO). Negativo si `hasta` es anterior */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${hasta.slice(0, 10)}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/** «hoy», «ayer» o «hace 5 días» */
export function haceCuanto(iso: string | null | undefined, hoy: string): string {
  if (!iso) return '—'
  const d = diasEntre(iso, hoy)
  if (d <= 0) return 'hoy'
  if (d === 1) return 'ayer'
  return `hace ${d} días`
}
