/**
 * PRECIOS DINÁMICOS EN PCCOMPONENTES — LA REGLA. PURO.
 *
 * Para cada oferta de Entrais, con lo que hay en PcComponentes en ese momento:
 *
 *   · Hay alguien más barato (o igual)  → ponerse `centimos` por debajo de él.
 *   · Somos los más baratos             → SUBIR hasta quedar `centimos` por debajo del siguiente (si `subir`): lo que hay entre medias se regalaba.
 *   · Nadie más lo vende                → se deja como está.
 *   · Y siempre: nunca por debajo del MÍNIMO (el precio que deja el margen mínimo). Si para ser el más barato hay que bajar de ahí, se queda en el mínimo.
 *
 * Se compara el precio TOTAL de cada oferta (con su envío), que es lo que ve y paga el comprador: una tienda a 69,95 € con envío gratis gana a otra a
 * 69,90 € que cobra el envío. Nuestro precio nuevo se saca de ese total quitándole lo que nuestro envío le suma.
 */

export interface OfertaRival {
  tienda: string | null
  /** Con IVA, sin envío */
  precio: number
  /** Con IVA y envío: lo que paga el comprador */
  total: number
}

export interface EntradaDinamica {
  /** Nuestro precio actual (con IVA, sin envío) */
  precio: number
  /** Nuestro total actual en PcComponentes (con envío). null = no se ha visto nuestra oferta en la lista: se toma el precio */
  total: number | null
  /** Las ofertas de las demás tiendas que se pueden comprar (activas y con stock) */
  rivales: OfertaRival[]
  /** El precio con IVA que deja el margen mínimo. null = no se conoce el coste: no se toca */
  minimo: number | null
  centimos: number
  subir: boolean
}

export type MotivoDinamico =
  | 'bajar_bajo_rival'
  | 'subir_bajo_siguiente'
  | 'al_minimo_rival_mas_barato'
  | 'subir_al_minimo'
  | 'sin_rivales'
  | 'ya_esta'
  | 'sin_coste'

export interface DecisionDinamica {
  /** El precio que hay que poner (con IVA). null = no se toca */
  precio: number | null
  motivo: MotivoDinamico
  rival: OfertaRival | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function decidirPrecio(e: EntradaDinamica): DecisionDinamica {
  if (e.minimo === null || !(e.minimo > 0)) return { precio: null, motivo: 'sin_coste', rival: null }
  const envio = e.total !== null ? Math.max(0, r2(e.total - e.precio)) : 0
  const rivales = [...e.rivales].filter((r) => r.total > 0).sort((a, b) => a.total - b.total)
  const rival = rivales[0] ?? null
  const cambia = (precio: number, motivo: MotivoDinamico): DecisionDinamica => (Math.abs(precio - e.precio) < 0.005 ? { precio: null, motivo: 'ya_esta', rival } : { precio: r2(precio), motivo, rival })

  if (!rival) {
    // Nadie más lo vende: no hay contra quién ponerse. Solo se corrige si estamos por debajo del mínimo
    if (e.precio < e.minimo) return cambia(e.minimo, 'subir_al_minimo')
    return { precio: null, motivo: 'sin_rivales', rival: null }
  }

  const objetivo = r2(rival.total - e.centimos - envio)
  if (objetivo < e.minimo) return cambia(e.minimo, e.precio < e.minimo ? 'subir_al_minimo' : 'al_minimo_rival_mas_barato')
  if (objetivo < e.precio) return cambia(objetivo, 'bajar_bajo_rival')
  if (objetivo > e.precio) return e.subir ? cambia(objetivo, 'subir_bajo_siguiente') : { precio: null, motivo: 'ya_esta', rival }
  return { precio: null, motivo: 'ya_esta', rival }
}

export const TEXTO_MOTIVO: Record<MotivoDinamico, string> = {
  bajar_bajo_rival: 'Baja para quedar por debajo del más barato',
  subir_bajo_siguiente: 'Sube: ya era el más barato y había hueco hasta el siguiente',
  al_minimo_rival_mas_barato: 'Al mínimo: el más barato está por debajo de nuestro margen mínimo',
  subir_al_minimo: 'Sube al mínimo: estaba por debajo del margen mínimo',
  sin_rivales: 'Nadie más lo vende: se deja',
  ya_esta: 'Ya está donde tiene que estar',
  sin_coste: 'Sin coste conocido: no se toca',
}
