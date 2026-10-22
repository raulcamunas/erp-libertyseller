'use client'

import { formatoDe, type DiaDeSemana, type Kpi, type Metrica } from '@/lib/rendimiento/informe'
import { Cambio } from '../CifrasDelPeriodo'
import { BarrasDeLaSemana } from './BarrasDeLaSemana'

/**
 * LAS OCHO CIFRAS DEL EQUIPO EN LA SEMANA, CADA UNA CON SU CAMBIO Y SUS SIETE DÍAS.
 *
 * Pulsar una cifra enseña esa misma cifra día a día y persona a persona en la tabla de debajo.
 */

interface Props {
  kpis: Kpi[]
  dias: DiaDeSemana[]
  /** Con qué se compara, para el texto que sale al pasar el ratón por el cambio */
  contra: string
  metrica: Metrica
  onElegir: (m: Metrica) => void
}

export function CifrasDeLaSemana({ kpis, dias, contra, metrica, onElegir }: Props) {
  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5" aria-label="Cifras de la semana">
      {kpis.map((k) => {
        const elegida = k.metrica === metrica
        return (
          <button
            key={k.id}
            type="button"
            onClick={() => onElegir(k.metrica)}
            aria-pressed={elegida}
            title="Pulsa para ver esta cifra día a día y por persona"
            className={`text-left rounded-2xl border p-3.5 transition-colors ${
              elegida ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.06]' : 'border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]'
            }`}
          >
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/40">{k.etiqueta}</p>
            <div className="flex items-baseline justify-between gap-2 mt-2">
              <p className="text-white font-bold text-[32px] leading-none tabular-nums">{k.valor}</p>
              <Cambio v={k.cambio} contra={contra} />
            </div>
            <p className="text-[11px] text-white/40 mt-1.5 leading-snug min-h-[1.5em]">{k.detalle}</p>
            <div className="mt-3">
              <BarrasDeLaSemana dias={dias} actual={k.diario} anterior={k.diarioAnterior} formato={(n) => formatoDe(k.metrica, n)} alto={30} compacto nombre={k.etiqueta} />
            </div>
          </button>
        )
      })}
    </section>
  )
}
