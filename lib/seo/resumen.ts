/**
 * SEO · EL RESUMEN DE UN PRODUCTO A PARTIR DE SUS BÚSQUEDAS Y SU FICHA. PURO.
 *
 * Cuatro números que dicen de un vistazo cómo está un producto:
 *   · cuota de compras: de todas las compras que se hicieron en Amazon tras SUS búsquedas, qué parte fue suya (suma de lo suyo ÷ suma del total, no la media de porcentajes);
 *   · cuota de impresiones: igual, con las impresiones (¿sale cuando se busca?). Con los totales de impresiones (lo normal) es suma ÷ suma, LA MISMA cuenta que hace la evolución
 *     (función seo_evolucion): antes aquí se ponderaba por volumen y la cifra de arriba no se podía comparar con su «antes», que sí era suma ÷ suma. Sin totales (datos viejos), por volumen;
 *   · cobertura: de sus 20 búsquedas con más volumen, cuántas tienen todas sus palabras en la ficha;
 *   · la búsqueda principal: la de más volumen.
 */

import { coberturaDe, palabras, tokens, type TextosDeFicha } from './cobertura'

export interface ConsultaParaResumen {
  consulta: string
  volumen: number | null
  impresionesAsin?: number | null
  impresionesTotal?: number | null
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
  // Con totales: suma de lo suyo ÷ suma del total (como la evolución). Sin ellos, la cuota ponderada por volumen
  const conTotales = ordenadas.filter((c) => c.impresionesTotal != null && c.impresionesAsin != null && (c.impresionesTotal as number) > 0)
  let cuotaImpresiones: number | null
  if (conTotales.length > 0) {
    cuotaImpresiones = conTotales.reduce((s, c) => s + (c.impresionesAsin as number), 0) / conTotales.reduce((s, c) => s + (c.impresionesTotal as number), 0)
  } else {
    const conImp = ordenadas.filter((c) => c.cuotaImpresiones != null && (c.volumen ?? 0) > 0)
    const pesoImp = conImp.reduce((s, c) => s + (c.volumen ?? 0), 0)
    cuotaImpresiones = pesoImp > 0 ? conImp.reduce((s, c) => s + (c.cuotaImpresiones as number) * (c.volumen as number), 0) / pesoImp : null
  }
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
  // Por raíz (para que «tarjeta» y «tarjetas» sumen juntas), con la forma que se vio primero para enseñarla
  const por = new Map<string, { forma: string; peso: number; busquedas: number }>()
  for (const c of [...consultas].sort((a, b) => (b.volumen ?? 0) - (a.volumen ?? 0)).slice(0, top)) {
    for (const t of new Map(tokens(c.consulta).map((x) => [x.raiz, x.forma]))) {
      const [p, forma] = t
      if (enTitulo.has(p) || forma.length < 3) continue
      const x = por.get(p) ?? { forma, peso: 0, busquedas: 0 }
      x.peso += c.volumen ?? 0
      x.busquedas += 1
      por.set(p, x)
    }
  }
  return [...por.entries()]
    .map(([r, x]) => ({ palabra: x.forma, peso: x.peso, busquedas: x.busquedas, enBullets: enBullets.has(r), enBackend: enBackend.has(r) }))
    .sort((a, b) => b.peso - a.peso)
    .slice(0, max)
}
