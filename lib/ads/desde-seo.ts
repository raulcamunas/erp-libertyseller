/**
 * MARKETING TEST · LAS PALABRAS QUE VIENEN DE SEO (Brand Analytics). PURO (se prueba sin base de datos).
 *
 * SEO diagnostica cada búsqueda del producto (lib/seo/embudo.ts). Aquí se quedan las que PPC puede aprovechar, con QUÉ hacer en la cuenta:
 *   · INFRAEXPUESTA: te compran más que a la media cuando te ven, pero te ven poco → exposición con publicidad (lo primero).
 *   · TE COMPRAN SIN EXACTA: ya tienes 2 compras o más en esa búsqueda y no hay keyword EXACTA en las campañas del producto → EXACTA DOMINIO.
 *   · EMPUJAR: «falta visibilidad», ya está entera en el título (el trabajo de SEO está hecho) y sigue saliendo poco → EXACTA para empujarla.
 *   · ATAQUE DE MARCA: lleva la marca de un competidor (lib/seo/marcas.ts). No es del producto ni va en la ficha; si se puja, en una campaña aparte de ataque de marca.
 * Nunca salen las que SEO descarta (ruido, otro precio, ajenas o «¿ajena?»), ni las ASIN, ni las que se compran poco en todo Amazon.
 */

import type { ConsultaGuardada } from '@/lib/seo/datos'
import { normalizar } from '@/lib/seo/cobertura'
import { esDelProducto, type BusquedaDiagnosticada } from '@/lib/seo/embudo'

export type MotivoDesdeSeo = 'infraexpuesta' | 'te-compran' | 'empujar' | 'ataque-marca'

export interface PalabraDesdeSeo {
  consulta: string
  motivo: MotivoDesdeSeo
  /** Qué hacer en la cuenta, en una frase */
  accion: string
  /** Por qué sale, con las cifras */
  porque: string
  volumen: number | null
  comprasMercado: number | null
  comprasAsin: number | null
  cuotaImpresiones: number | null
  cuotaCompras: number | null
  /** Ya hay keyword EXACTA para ella en las campañas del producto */
  enExacta: boolean
  /** Se puja por ella, pero en amplia o frase */
  enOtraConcordancia: boolean
  /** Está entera en el título */
  enTitulo: boolean
}

export const MAX_DESDE_SEO = 25
const ORDEN: Record<MotivoDesdeSeo, number> = { infraexpuesta: 0, 'te-compran': 1, empujar: 2, 'ataque-marca': 3 }
/** Como mucho estas de marca ajena (van al final y no quitan sitio a las del producto) */
export const MAX_ATAQUE_MARCA = 8

const esAsin = (t: string) => /^b0[a-z0-9]{8}$/i.test(t.trim())
const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`)
const ent = (x: number | null) => (x == null ? '—' : Math.round(x).toLocaleString('es-ES'))

export function palabrasDesdeSeo(
  busquedas: ReadonlyArray<BusquedaDiagnosticada<ConsultaGuardada>>,
  keywords: { exactas: ReadonlySet<string>; otras: ReadonlySet<string> },
  enTitulo: (consulta: string) => boolean,
  max = MAX_DESDE_SEO
): PalabraDesdeSeo[] {
  const vistas = new Set<string>()
  const salida: PalabraDesdeSeo[] = []
  const deMarca: PalabraDesdeSeo[] = []
  for (const b of busquedas) {
    const f = b.fila
    const k = normalizar(f.consulta)
    if (b.veredicto.tipo === 'ajena' && b.veredicto.marca && k && !vistas.has(k) && (f.comprasTotal ?? 0) > 0 && !keywords.exactas.has(k)) {
      vistas.add(k)
      deMarca.push({
        consulta: f.consulta, volumen: f.volumen, comprasMercado: f.comprasTotal, comprasAsin: f.comprasAsin, cuotaImpresiones: f.cuotaImpresiones, cuotaCompras: f.cuotaCompras,
        enExacta: false, enOtraConcordancia: keywords.otras.has(k), enTitulo: false, motivo: 'ataque-marca',
        porque: `Lleva «${b.veredicto.marca}», una marca de la competencia (${(f.comprasTotal ?? 0).toLocaleString('es-ES')} compras en Amazon).`,
        accion: 'Nunca en la ficha. Si se quiere pujar, en una campaña aparte de ataque de marca (o atacando los ASIN de esa marca), con su propio presupuesto.',
      })
      continue
    }
    if (!k || vistas.has(k) || esAsin(k) || !esDelProducto(b)) continue
    if ((f.comprasTotal ?? 0) <= 0) continue
    const enExacta = keywords.exactas.has(k)
    const enOtra = keywords.otras.has(k)
    const titulo = enTitulo(f.consulta)
    const base = { consulta: f.consulta, volumen: f.volumen, comprasMercado: f.comprasTotal, comprasAsin: f.comprasAsin, cuotaImpresiones: f.cuotaImpresiones, cuotaCompras: f.cuotaCompras, enExacta, enOtraConcordancia: enOtra, enTitulo: titulo }
    let p: PalabraDesdeSeo | null = null
    if (b.veredicto.tipo === 'infraexpuesta') {
      p = {
        ...base,
        motivo: 'infraexpuesta',
        porque: `Te ven en el ${pct(f.cuotaImpresiones)} de las búsquedas y te llevas el ${pct(f.cuotaCompras)} de las compras: cuando apareces, vendes más que la media.`,
        accion: enExacta
          ? 'Ya tiene EXACTA: sube su puja o su ajuste de Top of Search para salir más.'
          : enOtra
            ? 'Solo se puja en amplia o frase: crea la keyword EXACTA (EXACTA DOMINIO).'
            : 'Crea una keyword EXACTA (EXACTA DOMINIO) para esta búsqueda.',
      }
    } else if (!enExacta && (f.comprasAsin ?? 0) >= 2) {
      p = {
        ...base,
        motivo: 'te-compran',
        porque: `Ya te compran ahí (${ent(f.comprasAsin)} compras, ${pct(f.cuotaCompras)} de la búsqueda) y no tiene keyword EXACTA.`,
        accion: enOtra ? 'Pásala a EXACTA: ahora solo entra por amplia o frase.' : 'Crea la keyword EXACTA (EXACTA DOMINIO).',
      }
    } else if (!enExacta && b.veredicto.tipo === 'visibilidad' && titulo) {
      p = {
        ...base,
        motivo: 'empujar',
        porque: `Está entera en el título y aun así sales en el ${pct(f.cuotaImpresiones)} de las búsquedas (${ent(f.comprasTotal)} compras en Amazon).`,
        accion: 'La ficha ya está hecha: empújala con una keyword EXACTA.',
      }
    }
    if (!p) continue
    vistas.add(k)
    salida.push(p)
  }
  const delProducto = salida.sort((a, b) => ORDEN[a.motivo] - ORDEN[b.motivo] || (b.comprasMercado ?? 0) - (a.comprasMercado ?? 0)).slice(0, max)
  return [...delProducto, ...deMarca.sort((a, b) => (b.comprasMercado ?? 0) - (a.comprasMercado ?? 0)).slice(0, MAX_ATAQUE_MARCA)]
}
