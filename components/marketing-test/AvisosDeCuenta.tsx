'use client'

import { useEffect, useState } from 'react'
import { BellRing, ChevronDown } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { Aviso } from '@/lib/ads/avisos-calculo'
import { llamar } from './llamar'

const COLOR: Record<Aviso['gravedad'], string> = { grave: COLOR_ESTADO.rojo, atencion: COLOR_ESTADO.ambar, info: COLOR_ESTADO.azul }

/** Cache por cuenta: cambiar de pestaña no vuelve a pedirlos (5 min) */
const CACHE = new Map<string, { avisos: Aviso[]; en: number }>()

/**
 * LOS AVISOS DE LA CUENTA, arriba del todo: sin presupuesto hoy, gasto sin ventas, productos anunciados sin stock y problemas de la cuenta (pago, suspensión). Sin avisos no ocupa sitio.
 */
export function AvisosDeCuenta({ perfilId, verCampana }: { perfilId: string; verCampana?: (campaignId: string) => void }) {
  const [avisos, setAvisos] = useState<Aviso[] | null>(() => CACHE.get(perfilId)?.avisos ?? null)
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    const c = CACHE.get(perfilId)
    if (c && Date.now() - c.en < 5 * 60_000) {
      setAvisos(c.avisos)
      return
    }
    let vivo = true
    llamar<{ avisos: Aviso[] }>(`/api/ads/cuenta/avisos?perfilId=${perfilId}`)
      .then((r) => {
        CACHE.set(perfilId, { avisos: r.avisos, en: Date.now() })
        if (vivo) setAvisos(r.avisos)
      })
      .catch(() => vivo && setAvisos([]))
    return () => {
      vivo = false
    }
  }, [perfilId])

  if (!avisos || avisos.length === 0) return null
  const graves = avisos.filter((a) => a.gravedad === 'grave').length
  const color = graves > 0 ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar
  const visibles = abierto ? avisos : avisos.slice(0, 3)

  return (
    <section className="overflow-hidden rounded-[12px] border" style={{ borderColor: `color-mix(in srgb, ${color} 35%, var(--ls-linea))`, background: `color-mix(in srgb, ${color} 5%, var(--ls-sup))` }}>
      <div className="flex items-center gap-2 px-4 py-[9px]">
        <BellRing className="h-[14px] w-[14px]" style={{ color }} />
        <span className="text-[13px] font-semibold text-[var(--ls-t1)]">
          {avisos.length} {avisos.length === 1 ? 'aviso' : 'avisos'}
        </span>
        {graves > 0 && <span className="text-[11.5px]" style={{ color }}>{graves} {graves === 1 ? 'grave' : 'graves'}</span>}
        {avisos.length > 3 && (
          <button type="button" onClick={() => setAbierto((x) => !x)} className="ml-auto inline-flex items-center gap-1 text-[12px] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
            {abierto ? 'Ver menos' : `Ver los ${avisos.length}`} <ChevronDown className={`h-3 w-3 transition-transform ${abierto ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      <ul className="flex flex-col border-t border-[var(--ls-linea)]">
        {visibles.map((a, i) => (
          <li key={i} className="flex items-start gap-3 border-t border-[var(--ls-linea)] px-4 py-[8px] first:border-t-0">
            <span className="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: COLOR[a.gravedad] }} />
            <div className="min-w-0 flex-1 text-[12.5px] leading-[1.45]">
              <span className="font-semibold text-[var(--ls-t1)]">{a.titulo}</span> <span className="text-[var(--ls-t2)]">· {a.detalle}</span>
            </div>
            {a.campaignId && verCampana && (
              <button type="button" onClick={() => verCampana(a.campaignId as string)} className="shrink-0 text-[12px] font-medium text-[var(--ls-t2)] hover:text-[var(--ls-t1)]">
                Ver
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
