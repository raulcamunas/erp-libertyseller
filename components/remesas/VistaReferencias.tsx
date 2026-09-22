'use client'

import { motion } from 'framer-motion'
import type { SkuDePanel } from '@/lib/fba/datos'
import { colorDeCobertura, fecha } from './formato'

/**
 * POR REFERENCIA: LA QUE DICE CUÁNDO HAY QUE REPONER.
 *
 * Ordenada por lo que se agota antes. Cada fila junta todos los envíos de ese
 * SKU, así que «quedan» aquí es el total vivo, no el de un envío.
 */

const TH =
  'px-2 py-1.5 text-left text-[9px] font-semibold text-white/35 uppercase tracking-wider whitespace-nowrap border-b border-white/[0.08]'
const TD = 'px-2 py-1.5 text-[12px] text-white/80 whitespace-nowrap'

export function VistaReferencias({ skus }: { skus: SkuDePanel[] }) {
  if (skus.length === 0) {
    return <p className="p-10 text-center text-[12px] text-white/35">Sin referencias todavía.</p>
  }
  return (
    <div className="overflow-auto rounded-2xl border border-white/10 bg-white/[0.02]">
      <table className="w-full">
        <thead className="sticky top-0 z-10 bg-[#0d0d0d]">
          <tr>
            <th className={TH}>SKU</th>
            <th className={TH}>Producto</th>
            <th className={TH}>ASIN</th>
            <th className={`${TH} text-right`}>Enviadas</th>
            <th className={`${TH} text-right`}>Quedan</th>
            <th className={`${TH} text-right`}>Vendibles</th>
            <th className={`${TH} text-right`}>Ud/día</th>
            <th className={`${TH} text-right`}>Cobertura</th>
            <th className={TH}>Se agota</th>
            <th className={`${TH} text-right`}>En Amazon</th>
            <th className={`${TH} text-right`} title="Lo que Amazon tiene menos lo que explican las remesas">
              Descuadre
            </th>
            <th className={`${TH} text-right`} title="Ventas que ningún envío registrado podía absorber: stock de antes">
              Sin envío
            </th>
          </tr>
        </thead>
        <tbody>
          {skus.map((s, i) => (
            <motion.tr
              key={s.sku}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(i * 0.01, 0.3) }}
              className={`border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] ${s.quedan === 0 ? 'opacity-50' : ''}`}
            >
              <td className={`${TD} font-mono text-[11px] text-white/60`}>{s.sku}</td>
              <td className={`${TD} max-w-[240px] truncate`} title={s.nombre ?? ''}>
                {s.nombre ?? <span className="text-white/25">—</span>}
              </td>
              <td className={`${TD} font-mono text-[10px] text-white/40`}>{s.asin ?? '—'}</td>
              <td className={`${TD} text-right text-white/45`}>{s.enviadas}</td>
              <td className={`${TD} text-right font-semibold`}>{s.quedan}</td>
              <td className={`${TD} text-right ${s.quedanVendibles !== s.quedan ? 'text-amber-400' : 'text-white/45'}`}>
                {s.quedanVendibles}
              </td>
              <td className={`${TD} text-right text-white/45`}>{s.velocidad || '—'}</td>
              <td className={`${TD} text-right font-semibold ${colorDeCobertura(s.diasDeCobertura)}`}>
                {s.diasDeCobertura === null ? 'sin ventas' : `${s.diasDeCobertura} d`}
              </td>
              <td className={`${TD} ${colorDeCobertura(s.diasDeCobertura)}`}>
                {s.quedan === 0 ? 'agotada' : fecha(s.seAgotaEl)}
              </td>
              <td className={`${TD} text-right text-white/45`}>{s.stockReal ?? '—'}</td>
              <td className={`${TD} text-right ${!s.descuadre ? 'text-white/20' : 'text-amber-400'}`}>
                {s.descuadre === null ? '—' : s.descuadre > 0 ? `+${s.descuadre}` : s.descuadre}
              </td>
              <td className={`${TD} text-right ${s.sinAtribuir > 0 ? 'text-white/50' : 'text-white/20'}`}>
                {s.sinAtribuir || '—'}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
