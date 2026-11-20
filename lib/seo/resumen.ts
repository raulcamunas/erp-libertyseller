/**
 * SEO · EL RESUMEN DE UN PRODUCTO A PARTIR DE SUS BÚSQUEDAS Y SU FICHA. PURO.
 *
 * Cuatro números que dicen de un vistazo cómo está un producto, SOLO con sus búsquedas relevantes (fuera ruido, otro precio, las marcadas como ajenas y las que pueden ser de otro producto: se
 * diagnostican dentro con lib/seo/embudo.ts). Antes contaban todas y la principal de Opinas salía «google»:
 *   · cuota de compras: de todas las compras que se hicieron en Amazon tras SUS búsquedas, qué parte fue suya (suma de lo suyo ÷ suma del total, no la media de porcentajes);
 *   · cuota de impresiones: igual, con las impresiones (¿sale cuando se busca?). Con los totales de impresiones (lo normal) es suma ÷ suma, LA MISMA cuenta que hace la evolución
 *     (función seo_evolucion): antes aquí se ponderaba por volumen y la cifra de arriba no se podía comparar con su «antes», que sí era suma ÷ suma. Sin totales (datos viejos), por volumen;
 *   · cobertura: de sus 20 búsquedas que más compras mueven, cuántas tienen todas sus palabras en la ficha;
 *   · la búsqueda principal: la que más compras mueve en el mercado (no la de más volumen: «google» se busca mucho y no compra).
 */

import { coberturaDe, palabras, tokens, type TextosDeFicha } from './cobertura'
import { diagnosticarTodas, esDelProducto, type DecisionesDeBusquedas, type FilaDeEmbudo } from './embudo'

export interface ConsultaParaResumen {
  consulta: string
  volumen: number | null
  impresionesAsin?: number | null
  impresionesTotal?: number | null
  cuotaImpresiones: number | null
  comprasAsin: number | null
  comprasTotal: number | null
  cuotaCompras: number | null
  /** Con el resto del embudo el diagnóstico es más fino; sin él, se diagnostica con lo que haya */
  clicsTotal?: number | null
  clicsAsin?: number | null
  cuotaClics?: number | null
  carritosTotal?: number | null
  carritosAsin?: number | null
  cuotaCarritos?: number | null
  precioMedianoTotal?: number | null
  precioMedianoAsin?: number | null
}

export interface ResumenSeo {
  /** Búsquedas relevantes del producto (las que cuentan) */
  busquedas: number
  volumenTotal: number
  cuotaCompras: number | null
  cuotaImpresiones: number | null
  /** 0..1 sobre las 20 que más compras mueven; null sin ficha leída */
  cobertura: number | null
  principal: string | null
  /** De esas 20, a cuántas les falta alguna palabra en toda la ficha */
  faltanEnFicha: number | null
}

export const TOP_COBERTURA = 20

const comoFila = (c: ConsultaParaResumen): FilaDeEmbudo & { consulta: string } => ({
  ...c,
  cuotaClics: c.cuotaClics ?? null,
  cuotaCarritos: c.cuotaCarritos ?? null,
})

/**
 * EL RESUMEN DE UN PRODUCTO. Firma compatible con la de antes: `precioListing` (para descartar las de otro precio; sin él, se estima con lo que nos compran) y las decisiones a mano son opcionales.
 * La ficha, además de para la cobertura, sirve para marcar las posibles ajenas.
 */
export function resumenDeProducto(consultas: readonly ConsultaParaResumen[], ficha: (TextosDeFicha & { highlights?: string | null }) | null, precioListing?: number | null, decisiones: DecisionesDeBusquedas = {}): ResumenSeo {
  const { busquedas } = diagnosticarTodas(consultas.map(comoFila), precioListing ?? null, { ficha, ...decisiones })
  const relevantes = busquedas.filter(esDelProducto).map((d) => d.fila)
  const ordenadas = [...relevantes].sort((a, b) => (b.comprasTotal ?? 0) - (a.comprasTotal ?? 0) || (b.volumen ?? 0) - (a.volumen ?? 0))
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
