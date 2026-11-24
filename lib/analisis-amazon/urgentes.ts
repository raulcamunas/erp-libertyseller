/**
 * INFORMES URGENTES (24 nov 2026, Raúl): «que los comerciales tengan un botón de "Generar informe" por si algún cliente no lo tiene y lo
 * necesitan como prioridad, que se ponga a la cola como prio 1 después de la siguiente pasada, y que les diga cuánto tardará».
 *
 * urgentes.json (Storage, bucket `analisis-keepa`): la lista de pedidos, en orden de llegada. La recogida (recogida.ts) hace los pendientes
 * ANTES que todo lo demás (prioridad.json, el foco y los turnos) y sin consumir turno; no mira saltados.json (pedirlo es volver a intentarlo).
 *   · Hecho: el pedido se quita (el lead ya tiene `analisis_amazon_at`) y se avisa en la campana a quien lo pidió y al comercial del lead.
 *   · No se ha podido (sin web, Keepa no lo conoce…): se queda con estado 'saltado' y el motivo, para que la ficha lo diga; se puede volver
 *     a pedir.
 *
 * Aquí solo lo puro: la lista y la estimación de espera (se prueba en urgentes.prueba.ts).
 */
import type { TipoDeCola } from './turnos'

export type PedidoUrgente = {
  lead: string
  tipo: TipoDeCola
  tienda: string
  /** Quién lo pidió (perfil) */
  por: string | null
  at: string
  estado: 'pendiente' | 'saltado'
  motivo?: string
  resueltoAt?: string
}

/** Cuántos pedidos resueltos sin informe se guardan (para que la ficha diga el motivo) */
const TOPE_DE_SALTADOS = 300

export const pendientesUrgentes = (lista: readonly PedidoUrgente[]) => lista.filter((p) => p.estado === 'pendiente')

/** Añade un pedido; si el lead ya estaba pendiente lo deja donde estaba, y si se había saltado lo vuelve a poner (al final) */
export function anadirPedido(lista: readonly PedidoUrgente[], p: Omit<PedidoUrgente, 'estado'>): PedidoUrgente[] {
  if (lista.some((x) => x.lead === p.lead && x.estado === 'pendiente')) return [...lista]
  return [...lista.filter((x) => x.lead !== p.lead), { ...p, estado: 'pendiente' }]
}

/** Aplica lo que resolvió una pasada sobre la lista RELEÍDA (por si alguien pidió otro mientras tanto) */
export function resolverPedidos(
  lista: readonly PedidoUrgente[],
  resueltos: ReadonlyArray<{ lead: string; hecho: boolean; motivo?: string; at: string }>,
): PedidoUrgente[] {
  const porLead = new Map(resueltos.map((r) => [r.lead, r] as const))
  const fuera: PedidoUrgente[] = []
  for (const p of lista) {
    const r = p.estado === 'pendiente' ? porLead.get(p.lead) : undefined
    if (!r) fuera.push(p)
    else if (!r.hecho) fuera.push({ ...p, estado: 'saltado', motivo: (r.motivo ?? 'no se ha podido').slice(0, 200), resueltoAt: r.at })
  }
  const saltados = fuera.filter((p) => p.estado === 'saltado')
  const sobran = new Set(saltados.slice(0, Math.max(0, saltados.length - TOPE_DE_SALTADOS)))
  return fuera.filter((p) => !sobran.has(p))
}

/**
 * Minutos hasta que esté el informe del pedido en el puesto `costes.length` (costes = lo que gasta cada pedido pendiente hasta él, incluido).
 * Keepa recarga `ritmo` tokens por minuto y la recogida empieza una tienda en cuanto tiene saldo para ella (el cron va cada minuto).
 * `min`: con el saldo de ahora. `max`: si una pasada en curso se gasta antes una tienda de la cola normal (la más cara, 280).
 */
export function minutosDeEspera(costes: readonly number[], saldo: number, ritmo: number, enCurso = 280): { min: number; max: number } {
  const r = Math.max(1, ritmo)
  const simular = (inicial: number) => {
    let tokens = inicial
    let minutos = 0
    for (const c of costes) {
      if (tokens < c) {
        const espera = Math.ceil((c - tokens) / r)
        minutos += espera
        tokens += espera * r
      }
      tokens -= c
    }
    // + el minuto del cron y lo que tarda la tienda en hacerse (segundos)
    return minutos + 1
  }
  return { min: simular(saldo), max: simular(saldo - enCurso) }
}

/** «unos 6 min», «entre 6 y 19 min», «1 h 10 min» */
export function textoDeEspera(m: { min: number; max: number }): string {
  const t = (n: number) => (n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}` : `${n} min`)
  return m.max - m.min <= 2 ? `unos ${t(m.max)}` : `entre ${t(m.min)} y ${t(m.max)}`
}

/** El ID de vendedor de Amazon de `cold_leads.seller_url` (`seller=…`) y de qué Amazon es */
export function vendedorDeUrl(url: string | null | undefined): { seller: string; mercado: 'es' | 'mx' } | null {
  const m = /[?&]seller=([A-Z0-9]{8,20})/i.exec(url ?? '')
  if (!m) return null
  return { seller: m[1].toUpperCase(), mercado: /amazon\.com\.mx/i.test(url ?? '') ? 'mx' : 'es' }
}
