/**
 * SEO · HELIUM 10 CONTRA BRAND ANALYTICS. PURO (se prueba sin base de datos).
 *
 * Helium 10 (Cerebro, Magnet) estima el volumen de palabras en las que el producto puede no haber salido nunca; Brand Analytics (Search Query
 * Performance) solo enseña las búsquedas donde el producto YA aparece. Lo que está en Helium 10 y no en Brand Analytics es justo lo que falta: la
 * oportunidad. El Keyword Tracker añade el rango orgánico por palabra, que ninguna API de Amazon da.
 *
 * La puntuación de oportunidad ordena, no decide: volumen de Helium 10, más si las palabras no están en la ficha y si el rango orgánico es malo o no hay.
 */

import { claveDeBusqueda } from './embudo'
import { coberturaDe, type TextosDeFicha } from './cobertura'
import { normalizarConsulta } from './top-terminos'

export interface KeywordH10 {
  keyword: string
  volumen: number | null
  cerebroIq: number | null
  tendencia: number | null
  competidores: number | null
  densidad: number | null
  pujaSugerida: number | null
  rangoOrganico: number | null
  rangoPatrocinado: number | null
  rangosRivales: Record<string, number>
}

export interface KeywordCruzada extends KeywordH10 {
  enBrandAnalytics: boolean
  /** Todas sus palabras están en algún sitio de la ficha */
  enFicha: boolean
  /** Enteras en el título */
  enTitulo: boolean
  faltan: string[]
  /** 0 = no es oportunidad (ya sale en Brand Analytics); cuanto más, mejor */
  oportunidad: number
  motivo: string
  /** «No es nuestro producto» / «Sí es nuestro» (la misma decisión que en Búsquedas, migración 333; la puede tomar una persona o la IA al revisar las oportunidades) */
  decision: 'ajena' | 'nuestra' | null
}

/** Junta lo de varias importaciones de un producto: el Cerebro/Magnet más reciente pone volumen e IQ; el Keyword Tracker más reciente pone el rango */
export function juntarImportaciones(cerebro: readonly KeywordH10[], tracker: readonly Pick<KeywordH10, 'keyword' | 'volumen' | 'rangoOrganico' | 'rangoPatrocinado'>[]): KeywordH10[] {
  const mapa = new Map<string, KeywordH10>()
  for (const k of cerebro) mapa.set(normalizarConsulta(k.keyword), { ...k, keyword: normalizarConsulta(k.keyword) })
  for (const t of tracker) {
    const clave = normalizarConsulta(t.keyword)
    const ya = mapa.get(clave)
    if (ya) mapa.set(clave, { ...ya, rangoOrganico: t.rangoOrganico ?? ya.rangoOrganico, rangoPatrocinado: t.rangoPatrocinado ?? ya.rangoPatrocinado, volumen: ya.volumen ?? t.volumen })
    else mapa.set(clave, { keyword: clave, volumen: t.volumen, cerebroIq: null, tendencia: null, competidores: null, densidad: null, pujaSugerida: null, rangoOrganico: t.rangoOrganico, rangoPatrocinado: t.rangoPatrocinado, rangosRivales: {} })
  }
  return [...mapa.values()]
}

/** Las palabras de Helium 10 cruzadas con las búsquedas de Brand Analytics del producto y con su ficha, ordenadas por oportunidad */
export function cruzarConBrandAnalytics(
  keywords: readonly KeywordH10[],
  consultasBA: readonly string[],
  ficha: TextosDeFicha | null,
  decisiones: { ajenas: ReadonlySet<string>; nuestras: ReadonlySet<string> } = { ajenas: new Set(), nuestras: new Set() },
): KeywordCruzada[] {
  const ba = new Set(consultasBA.map(normalizarConsulta))
  return keywords
    .map((k) => {
      const enBrandAnalytics = ba.has(normalizarConsulta(k.keyword))
      const cob = ficha ? coberturaDe(k.keyword, ficha) : null
      const enFicha = cob ? cob.faltan.length === 0 : false
      const vol = k.volumen ?? 0
      let oportunidad = 0
      let motivo = enBrandAnalytics ? 'Ya sale en Brand Analytics' : 'No sale en Brand Analytics'
      if (!enBrandAnalytics && vol > 0) {
        const factorFicha = enFicha ? 1 : 1.5
        const r = k.rangoOrganico
        const factorRango = r == null ? 1.2 : r > 50 ? 1.2 : r > 10 ? 1 : 0.5
        oportunidad = Math.round(vol * factorFicha * factorRango)
        motivo = !enFicha ? `Tiene ${vol.toLocaleString('es-ES')} búsquedas y faltan en la ficha: ${cob?.faltan.join(', ') ?? 'todas'}` : r == null || r > 10 ? `Las palabras ya están en la ficha pero no posiciona${r ? ` (puesto ${r})` : ''}` : `Posiciona en el puesto ${r} aunque Brand Analytics no la registra aún`
      }
      const clave = claveDeBusqueda(k.keyword)
      const decision = decisiones.ajenas.has(clave) ? ('ajena' as const) : decisiones.nuestras.has(clave) ? ('nuestra' as const) : null
      // Una palabra de otro producto no es una oportunidad, por mucho volumen que tenga: ni sale en la lista ni le llega a la IA de la propuesta
      if (decision === 'ajena') return { ...k, enBrandAnalytics, enFicha, enTitulo: cob?.titulo ?? false, faltan: cob?.faltan ?? [], oportunidad: 0, motivo: 'No es nuestro producto', decision }
      return { ...k, enBrandAnalytics, enFicha, enTitulo: cob?.titulo ?? false, faltan: cob?.faltan ?? [], oportunidad, motivo, decision }
    })
    .sort((a, b) => b.oportunidad - a.oportunidad || (b.volumen ?? 0) - (a.volumen ?? 0))
}

/**
 * Lo que se le pasa a la IA: las mejores oportunidades de Helium 10, sin las que llevan un ASIN. Aquí NO se quitan las marcas de otros (Helium 10 no dice cuáles son): lo hace quien llama
 * (propuesta-servidor.ts) con las marcas de los rivales que se siguen, antes de recortar a `max`.
 */
export function oportunidadesParaLaIa(cruzadas: readonly KeywordCruzada[], max = 25): Array<{ keyword: string; volumen: number | null; rangoOrganico: number | null; enLaFicha: boolean }> {
  return cruzadas
    .filter((k) => k.oportunidad > 0 && !/\bb0[a-z0-9]{8}\b/i.test(k.keyword))
    .slice(0, max)
    .map((k) => ({ keyword: k.keyword, volumen: k.volumen, rangoOrganico: k.rangoOrganico, enLaFicha: k.enFicha }))
}
