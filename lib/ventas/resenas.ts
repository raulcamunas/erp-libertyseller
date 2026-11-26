/**
 * RESEÑAS · LO PURO. Qué campaña le toca a un pedido y cuándo se pide su reseña.
 *
 * La reseña se pide con la API oficial de Amazon (Solicitations), que manda el mismo correo que el botón «Solicitar una reseña» de Seller Central.
 * Amazon solo la ofrece entre 5 y 30 días después de la entrega y una vez por pedido. La entrega no la sabemos: se estima como compra + 2 días
 * (FBA en Europa). Si a la hora prevista Amazon aún no la ofrece, se reintenta al día siguiente.
 */

export const DIAS_HASTA_ENTREGA = 2
/** Pasados estos días desde la compra sin que Amazon la ofrezca, ya no la va a ofrecer (ya pedida por otro lado o pedido no apto) */
export const DIAS_SIN_OFRECER = 14
/** Amazon deja pedirla hasta 30 días después de la entrega */
export const DIAS_MAXIMO = DIAS_HASTA_ENTREGA + 30

export type EstadoEnvio = 'en_cola' | 'enviada' | 'no_disponible' | 'caducada' | 'error' | 'descartada' | 'reembolsado'

export const ESTADOS: Record<EstadoEnvio, { texto: string; color: string }> = {
  en_cola: { texto: 'En cola', color: '#60A5FA' },
  enviada: { texto: 'Enviada', color: '#34D399' },
  no_disponible: { texto: 'Amazon no la ofrece', color: '#A1A1AA' },
  caducada: { texto: 'Fuera de plazo', color: '#71717A' },
  error: { texto: 'Error', color: '#F87171' },
  descartada: { texto: 'Descartada', color: '#52525B' },
  reembolsado: { texto: 'Reembolsado', color: '#FB923C' },
}

export interface Campana {
  id: string
  connection_id: string
  nombre: string
  prioridad: number
  activa: boolean
  desde: string
  hasta: string | null
  dias_tras_entrega: number
  hora: number
  excluir_fbm: boolean
  excluir_promo: boolean
  mercados: string[] | null
  productos_modo: 'todos' | 'solo' | 'excepto'
  skus: string[]
}

export interface PedidoParaCola {
  pedido: string
  marketplace_id: string
  /** Instante de compra (ISO) */
  fecha: string
  /** Día de compra en el país del pedido (YYYY-MM-DD) */
  dia: string
  fbm: boolean
  promo: number
  skus: string[]
  importe: number
}

/** La campaña (activa, por prioridad) que se lleva el pedido, o null si ninguna lo acepta */
export function campanaDelPedido(p: PedidoParaCola, campanas: readonly Campana[]): Campana | null {
  const orden = [...campanas].filter((c) => c.activa).sort((a, b) => a.prioridad - b.prioridad)
  for (const c of orden) {
    if (p.dia < c.desde) continue
    if (c.hasta && p.dia > c.hasta) continue
    if (c.mercados && c.mercados.length && !c.mercados.includes(p.marketplace_id)) continue
    if (c.excluir_fbm && p.fbm) continue
    if (c.excluir_promo && p.promo > 0) continue
    if (c.productos_modo === 'solo' && !p.skus.some((s) => c.skus.includes(s))) continue
    if (c.productos_modo === 'excepto' && p.skus.every((s) => c.skus.includes(s))) continue
    return c
  }
  return null
}

/** El pedido de un movimiento de reembolso (su clave es «r|pedido|sku|fecha|importe», lib/ventas/lectura.ts) */
export const pedidoDeReembolso = (clave: string): string | null => (clave.startsWith('r|') ? clave.split('|')[1] || null : null)

export const sumarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** El instante UTC de «ese día a esa hora en Madrid» (con su horario de verano) */
export function instanteEnMadrid(dia: string, hora: number): Date {
  const supuesto = Date.parse(`${dia}T${String(hora).padStart(2, '0')}:00:00Z`)
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(supuesto))
  const v = (t: string) => Number(partes.find((x) => x.type === t)?.value)
  const enMadrid = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'))
  return new Date(supuesto - (enMadrid - supuesto))
}

/** Cuándo se pide la reseña de un pedido con esa campaña: compra + entrega estimada + los días de la campaña, a su hora de Madrid */
export function cuandoPedir(diaCompra: string, c: Pick<Campana, 'dias_tras_entrega' | 'hora'>): Date {
  return instanteEnMadrid(sumarDias(diaCompra, DIAS_HASTA_ENTREGA + c.dias_tras_entrega), c.hora)
}

/** Qué hacer con un pedido al que Amazon NO le ofrece pedir la reseña ahora mismo */
export function siNoLaOfrece(diaCompra: string, hoy: string): { estado: EstadoEnvio; reintentarEl: string | null } {
  const dias = (Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${diaCompra}T00:00:00Z`)) / 86_400_000
  if (dias > DIAS_MAXIMO) return { estado: 'caducada', reintentarEl: null }
  if (dias >= DIAS_SIN_OFRECER) return { estado: 'no_disponible', reintentarEl: null }
  return { estado: 'en_cola', reintentarEl: sumarDias(hoy, 1) }
}
