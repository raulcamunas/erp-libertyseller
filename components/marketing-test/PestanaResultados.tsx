'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * RESULTADOS DE LOS CAMBIOS: lo que ha pasado tras cada cambio que ha aplicado el agente (ads_efectos), en euros al día. Arriba, por tipo de cambio: cuántos
 * mejoran, empeoran o no se notan y cuánto suman en gasto y ventas al día. Debajo, cada cambio medido con su antes y después. /api/ads/cuenta/resultados
 */

interface PorClase {
  clase: string
  medidos: number
  mejoro: number
  empeoro: number
  neutro: number
  ahorroGastoDia: number
  ventasDiaDeMas: number
}
interface Cambio {
  propuestaId: string
  clase: string
  termino: string
  campana: string | null
  medidoAt: string
  veredicto: string
  detalle: string | null
  gastoDiaAntes: number
  gastoDiaDespues: number
  ventasDiaAntes: number
  ventasDiaDespues: number
  acosAntes: number | null
  acosDespues: number | null
  deshechoAuto: boolean
}

const CLASE: Record<string, string> = {
  negativizar: 'Negativas',
  promover: 'Cosechas',
  puja_subir: 'Subidas de puja',
  puja_bajar: 'Bajadas de puja',
  puja_bajar_sin_pedidos: 'Bajadas sin pedidos',
  pausar: 'Pausas',
  presupuesto_subir: 'Subidas de presupuesto',
  presupuesto_bajar: 'Bajadas de presupuesto',
  pausar_campana: 'Campañas pausadas',
}
const VEREDICTO: Record<string, { t: string; c: string }> = {
  mejoro: { t: 'Mejoró', c: '#34D399' },
  empeoro: { t: 'Empeoró', c: '#F87171' },
  neutro: { t: 'Sin cambio', c: 'var(--ls-t3)' },
  sin_muestra: { t: 'Poca muestra', c: 'var(--ls-t4)' },
  mezclado: { t: 'Mezclado', c: '#F5B942' },
}

export function PestanaResultados({ perfilId, moneda }: { perfilId: string; moneda: string | null }) {
  const [dias, setDias] = useState(60)
  const [d, setD] = useState<{ disponible: boolean; porClase: PorClase[]; cambios: Cambio[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const din = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: moneda || 'EUR', maximumFractionDigits: 2 })
  const conSigno = (n: number) => `${n > 0 ? '+' : ''}${din(n)}`

  useEffect(() => {
    let vivo = true
    setD(null)
    setError(null)
    fetch(`/api/ads/cuenta/resultados?perfilId=${encodeURIComponent(perfilId)}&dias=${dias}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!vivo) return
        if (!r.ok) setError((j as { error?: string }).error ?? 'No se han podido leer los resultados.')
        else setD(j as { disponible: boolean; porClase: PorClase[]; cambios: Cambio[] })
      })
      .catch(() => vivo && setError('No se han podido leer los resultados.'))
    return () => {
      vivo = false
    }
  }, [perfilId, dias])

  if (error) return <p className="text-[12.5px] text-[#F87171]">{error}</p>
  if (!d)
    return (
      <p className="flex items-center gap-2 py-6 text-[12.5px] text-[var(--ls-t3)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Leyendo lo que ha pasado tras cada cambio…
      </p>
    )
  if (!d.disponible || d.porClase.length === 0) return <p className="py-6 text-[12.5px] text-[var(--ls-t4)]">Todavía no hay cambios medidos en este periodo (cada cambio se mide unos días después de aplicarlo).</p>

  const tot = d.porClase.reduce((a, c) => ({ medidos: a.medidos + c.medidos, mejoro: a.mejoro + c.mejoro, empeoro: a.empeoro + c.empeoro, ahorro: a.ahorro + c.ahorroGastoDia, ventas: a.ventas + c.ventasDiaDeMas }), { medidos: 0, mejoro: 0, empeoro: 0, ahorro: 0, ventas: 0 })
  return (
    <div className="flex flex-col gap-4 pb-10">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] text-[var(--ls-t3)]">Lo que ha pasado después de cada cambio del agente, en {moneda || 'EUR'} al día (ventana antes frente a ventana después).</p>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Periodo" className="h-8 shrink-0 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2 text-[16px] text-[var(--ls-t2)] sm:text-[12.5px]">
          <option value={30}>30 días</option>
          <option value={60}>60 días</option>
          <option value={120}>120 días</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { t: 'Cambios medidos', v: tot.medidos.toLocaleString('es-ES'), c: 'var(--ls-t1)' },
          { t: 'Mejoran / empeoran', v: `${tot.mejoro} / ${tot.empeoro}`, c: tot.mejoro >= tot.empeoro ? '#34D399' : '#F87171' },
          { t: 'Gasto al día', v: conSigno(-tot.ahorro), c: tot.ahorro >= 0 ? '#34D399' : '#F5B942' },
          { t: 'Ventas al día', v: conSigno(tot.ventas), c: tot.ventas >= 0 ? '#34D399' : '#F87171' },
        ].map((x) => (
          <div key={x.t} className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2.5">
            <div className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ls-t4)]">{x.t}</div>
            <div className="text-[19px] font-semibold tabular-nums" style={{ color: x.c }}>{x.v}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
        <table className="w-full min-w-[620px] text-[12.5px]">
          <thead className="border-b border-[var(--ls-linea)] text-[11px] uppercase tracking-wide text-[var(--ls-t4)]">
            <tr>
              <th className="px-3 py-2 text-left">Tipo de cambio</th>
              <th className="px-3 py-2 text-right">Medidos</th>
              <th className="px-3 py-2 text-right">Mejoran</th>
              <th className="px-3 py-2 text-right">Empeoran</th>
              <th className="px-3 py-2 text-right">Gasto/día</th>
              <th className="px-3 py-2 text-right">Ventas/día</th>
            </tr>
          </thead>
          <tbody>
            {d.porClase.map((c) => (
              <tr key={c.clase} className="border-b border-[var(--ls-linea)] last:border-0">
                <td className="px-3 py-2 text-[var(--ls-t1)]">{CLASE[c.clase] ?? c.clase}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.medidos}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[#34D399]">{c.mejoro}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[#F87171]">{c.empeoro}</td>
                <td className="px-3 py-2 text-right tabular-nums">{conSigno(-c.ahorroGastoDia)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{conSigno(c.ventasDiaDeMas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="divide-y divide-[var(--ls-linea)] rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
        {d.cambios.map((c) => {
          const v = VEREDICTO[c.veredicto] ?? { t: c.veredicto, c: 'var(--ls-t3)' }
          return (
            <li key={c.propuestaId} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-[var(--ls-t1)]" title={c.detalle ?? ''}>
                  <span className="text-[var(--ls-t4)]">{CLASE[c.clase] ?? c.clase} · </span>
                  {c.termino || '—'}
                </div>
                <div className="truncate text-[11px] text-[var(--ls-t4)]">
                  {c.campana ?? ''} · medido el {new Date(c.medidoAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                  {c.deshechoAuto ? ' · deshecho solo' : ''}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] tabular-nums text-[var(--ls-t3)]">
                <span>Gasto {din(c.gastoDiaAntes)} → {din(c.gastoDiaDespues)}</span>
                <span>Ventas {din(c.ventasDiaAntes)} → {din(c.ventasDiaDespues)}</span>
                <span>ACoS {c.acosAntes ?? '—'} → {c.acosDespues ?? '—'} %</span>
                <span className="font-semibold" style={{ color: v.c }}>{v.t}</span>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
