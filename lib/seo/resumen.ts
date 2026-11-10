/**
 * SEO · EL RESUMEN DE UN PRODUCTO A PARTIR DE SUS BÚSQUEDAS Y SU FICHA. PURO.
 *
 * Cuatro números que dicen de un vistazo cómo está un producto:
 *   · cuota de compras: de todas las compras que se hicieron en Amazon tras SUS búsquedas, qué parte fue suya (suma de lo suyo ÷ suma del total, no la media de porcentajes);
 *   · cuota de impresiones: igual, con las impresiones (¿sale cuando se busca?);
 *   · cobertura: de sus 20 búsquedas con más volumen, cuántas tienen todas sus palabras en la ficha;
 *   · la búsqueda principal: la de más volumen.
 */

import { coberturaDe, palabras, type TextosDeFicha } from './cobertura'

export interface ConsultaParaResumen {
  consulta: string
  volumen: number | null
  impresionesAsin?: number | null
  cuotaImpresiones: number | null
  comprasAsin: number | null
  comprasTotal: number | null
  cuotaCompras: number | null
}

export interface ResumenSeo {
  busquedas: number
  volumenTotal: number
  cuotaCompras: number | null
  cuotaImpresiones: number | null
  /** 0..1 sobre las 20 de más volumen; null sin ficha leída */
  cobertura: number | null
  principal: string | null
  /** Las de más volumen a las que les falta alguna palabra en toda la ficha */
  faltanEnFicha: number | null
}

export const TOP_COBERTURA = 20

export function resumenDeProducto(consultas: readonly ConsultaParaResumen[], ficha: TextosDeFicha | null): ResumenSeo {
  const ordenadas = [...consultas].sort((a, b) => (b.volumen ?? 0) - (a.volumen ?? 0))
  const volumenTotal = ordenadas.reduce((s, c) => s + (c.volumen ?? 0), 0)
  const compAsin = ordenadas.reduce((s, c) => s + (c.comprasAsin ?? 0), 0)
  const compTotal = ordenadas.reduce((s, c) => s + (c.comprasTotal ?? 0), 0)
  // Cuota de impresiones ponderada por volumen (Amazon no da el total de impresiones de forma comparable entre búsquedas)
  const conImp = ordenadas.filter((c) => c.cuotaImpresiones != null && (c.volumen ?? 0) > 0)
  const pesoImp = conImp.reduce((s, c) => s + (c.volumen ?? 0), 0)
  const cuotaImpresiones = pesoImp > 0 ? conImp.reduce((s, c) => s + (c.cuotaImpresiones as number) * (c.volumen as number), 0) / pesoImp : null
  let cobertura: number | null = null
  let faltanEnFicha: number | null = null
  if (ficha) {
    const top = ordenadas.slice(0, TOP_COBERTURA)
    if (top.length > 0) {
      const res = top.map((c) => coberturaDe(c.consulta, ficha))
      cobertura = res.filter((r) => r.faltan.length === 0).length / top.length
      faltanEnFicha = res.filter((r) => r.faltan.length > 0).length
    }
  }
  return { busquedas: ordenadas.length, volumenTotal, cuotaCompras: compTotal > 0 ? compAsin / compTotal : null, cuotaImpresiones, cobertura, principal: ordenadas[0]?.consulta ?? null, faltanEnFicha }
}

export interface PalabraQueFalta {
  palabra: string
  /** Volumen de búsqueda sumado de las búsquedas donde aparece */
  peso: number
  /** En cuántas de esas búsquedas sale */
  busquedas: number
  enBullets: boolean
  enBackend: boolean
}

/**
 * LAS PALABRAS QUE MÁS PESAN EN LAS BÚSQUEDAS DEL PRODUCTO Y NO ESTÁN EN EL TÍTULO, ordenadas por el volumen de búsqueda que arrastran. Es la lista con la que se reescribe un título: lo que la gente
 * busca y la ficha no dice donde más cuenta. Se miran las `top` búsquedas de más volumen.
 */
export function palabrasQueFaltanEnElTitulo(consultas: readonly ConsultaParaResumen[], ficha: TextosDeFicha, top = 30, max = 15): PalabraQueFalta[] {
  const enTitulo = new Set(palabras(ficha.titulo ?? ''))
  const enBullets = new Set(palabras(ficha.bullets.join(' ')))
  const enBackend = new Set(palabras(ficha.backend ?? ''))
  const por = new Map<string, { peso: number; busquedas: number }>()
  for (const c of [...consultas].sort((a, b) => (b.volumen ?? 0) - (a.volumen ?? 0)).slice(0, top)) {
    for (const p of new Set(palabras(c.consulta))) {
      if (enTitulo.has(p) || p.length < 3) continue
      const x = por.get(p) ?? { peso: 0, busquedas: 0 }
      x.peso += c.volumen ?? 0
      x.busquedas += 1
      por.set(p, x)
    }
  }
  return [...por.entries()]
    .map(([palabra, x]) => ({ palabra, ...x, enBullets: enBullets.has(palabra), enBackend: enBackend.has(palabra) }))
    .sort((a, b) => b.peso - a.peso)
    .slice(0, max)
}
