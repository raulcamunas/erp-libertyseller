/**
 * AMAZON ADS · LA COSECHA DESDE SEO Y HELIUM 10. PURO (se prueba en cosecha-seo.prueba.ts).
 *
 * Raúl (25 nov 2026): «que se deje de aprobaciones; el sistema tiene que ser lo suficientemente inteligente para saber si usar o no palabras y ver si ya están en las campañas».
 * El motor ya cosecha de los TÉRMINOS DE BÚSQUEDA de las campañas (lo que ya ha vendido por publicidad). Esto añade lo que la publicidad aún no ha visto y SEO sí:
 *   · SEO (Brand Analytics, lib/ads/desde-seo.ts): «te compran sin EXACTA», «infraexpuesta» sin EXACTA y «empujar» → keyword EXACTA en la EXACTA del producto (DOMINIO o
 *     ESTABILIDAD). Ya venden en Amazon: lo seguro es pujar por ellas en exacta.
 *   · HELIUM 10 (Cerebro guardado del producto): palabras con volumen donde el producto no aparece, que SEO da por suyas (ni de otro producto, ni de una marca de la competencia)
 *     → keyword de FRASE en la AMPLIA del producto: es descubrir, así que en frase y con la puja de partida.
 * Lo decide sin preguntar, con estas reglas (una palabra que no las pasa, no entra):
 *   · no está ya en las campañas del producto (en exacta, si va a EXACTA; en cualquier concordancia, si viene de Helium);
 *   · no se ha negativizado, ni se ha cosechado o descartado hace poco, ni hay otra cosecha pendiente igual (`bloqueadas`);
 *   · nunca marcas de la competencia, ASIN, ni palabras sueltas (una sola palabra es demasiado genérica);
 *   · de Helium, solo con volumen ≥ VOLUMEN_MINIMO y sin estar ya en el top 20 orgánico;
 *   · como mucho MAX_SEO + MAX_HELIUM por producto y pasada, de más a menos valor.
 * Después, el agente las aplica con sus frenos de siempre (tope diario de cosechas, puja de partida limitada a la puja máxima del producto, nada si no hay stock o la
 * postura es recortar…) y el motor las vigila como a cualquier keyword: si gastan sin vender, baja la puja y acaba pausándolas.
 */

import type { Rol } from './estructura'
import type { PalabraDesdeSeo } from './desde-seo'

export const MAX_SEO = 5
export const MAX_HELIUM = 5
export const VOLUMEN_MINIMO = 300
export const RANGO_ORGANICO_BUENO = 20

export interface PalabraHelium {
  keyword: string
  volumen: number | null
  rangoOrganico: number | null
  /** > 0 = oportunidad (no sale en Brand Analytics) */
  oportunidad: number
  decision: 'ajena' | 'nuestra' | null
}

export interface Cosecha {
  /** Tal cual (en minúsculas, con sus tildes): es el texto de la keyword. Para comparar se normaliza aparte */
  termino: string
  rol: Extract<Rol, 'MANUAL EXACTA / DOMINIO' | 'MANUAL AMPLIA'>
  fuente: 'seo' | 'helium'
  motivo: string
  volumen: number | null
}

export const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
const esAsin = (t: string) => /^b0[a-z0-9]{8}$/i.test(t.trim())
const palabras = (t: string) => norm(t).split(' ').filter(Boolean)

export function cosechaDesdeSeo(e: {
  seo: readonly PalabraDesdeSeo[]
  helium: readonly PalabraHelium[]
  /** Términos (normalizados) que ya son keyword EXACTA en las campañas del producto */
  exactas: ReadonlySet<string>
  /** Términos (normalizados) que ya están en las campañas del producto en cualquier concordancia */
  cualquiera: ReadonlySet<string>
  /** Negativizados, cosechados o descartados hace poco, o con otra cosecha pendiente (normalizados) */
  bloqueadas: ReadonlySet<string>
  /** ¿Lleva una marca de la competencia? */
  esDeMarca: (termino: string) => boolean
}): Cosecha[] {
  const vistas = new Set<string>()
  const vale = (t: string) => {
    const k = norm(t)
    if (!k || vistas.has(k) || e.bloqueadas.has(k) || esAsin(k) || palabras(k).length < 2 || e.esDeMarca(t)) return null
    return k
  }

  const seo: Cosecha[] = []
  for (const p of e.seo) {
    if (p.motivo === 'ataque-marca' || p.enExacta) continue
    const k = vale(p.consulta)
    if (!k || e.exactas.has(k)) continue
    vistas.add(k)
    seo.push({ termino: p.consulta.trim().toLowerCase().replace(/\s+/g, ' '), rol: 'MANUAL EXACTA / DOMINIO', fuente: 'seo', volumen: p.volumen, motivo: `Desde SEO (Brand Analytics): ${p.porque}` })
    if (seo.length >= MAX_SEO) break
  }

  const helium: Cosecha[] = []
  const candidatas = [...e.helium].filter((h) => h.oportunidad > 0 && h.decision !== 'ajena' && (h.volumen ?? 0) >= VOLUMEN_MINIMO && !(h.rangoOrganico != null && h.rangoOrganico <= RANGO_ORGANICO_BUENO)).sort((a, b) => (b.volumen ?? 0) - (a.volumen ?? 0))
  for (const h of candidatas) {
    const k = vale(h.keyword)
    if (!k || e.cualquiera.has(k)) continue
    vistas.add(k)
    helium.push({ termino: h.keyword.trim().toLowerCase().replace(/\s+/g, ' '), rol: 'MANUAL AMPLIA', fuente: 'helium', volumen: h.volumen, motivo: `Desde Helium 10: ${(h.volumen ?? 0).toLocaleString('es-ES')} búsquedas al mes${h.rangoOrganico ? ` y el producto está en la posición orgánica ${h.rangoOrganico}` : ' y el producto no aparece en el orgánico'}; no está en ninguna campaña del producto` })
    if (helium.length >= MAX_HELIUM) break
  }
  return [...seo, ...helium]
}
