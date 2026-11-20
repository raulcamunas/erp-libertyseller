'use client'

import { Clock } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { franjaDeMexico, horaLocal } from '@/lib/mexico/zona-horaria'
import { esDeAmazonMexico, type ColdLead } from '@/lib/types/cold-leads'
import { tinte } from './ui'

/**
 * LA FRANJA HORARIA Y LA HORA LOCAL DE UN LEAD DE MÉXICO (lib/mexico/zona-horaria.ts): una insignia en la fila de la lista y de la tabla, y una línea en la ficha.
 * Solo para leads de México (Amazon México o lista «MEX …»). En ámbar si allí es antes de las 9 o después de las 19. Un solo reloj para todas las filas.
 */

type LeadMx = Pick<ColdLead, 'province' | 'phone' | 'seller_url' | 'source_list'>

const esDeMexico = (l: LeadMx) => esDeAmazonMexico(l) || /^MEX\b/i.test(l.source_list ?? '')

// Un reloj compartido que avisa cada minuto (no un intervalo por fila)
let minuto = Math.floor(Date.now() / 60_000)
const oyentes = new Set<() => void>()
let reloj: ReturnType<typeof setInterval> | null = null
function suscribir(cb: () => void) {
  oyentes.add(cb)
  if (!reloj) {
    reloj = setInterval(() => {
      const m = Math.floor(Date.now() / 60_000)
      if (m !== minuto) {
        minuto = m
        oyentes.forEach((f) => f())
      }
    }, 5_000)
  }
  return () => {
    oyentes.delete(cb)
    if (oyentes.size === 0 && reloj) {
      clearInterval(reloj)
      reloj = null
    }
  }
}
export const useMinuto = () => useSyncExternalStore(suscribir, () => minuto, () => 0)

function useFranja(lead: LeadMx) {
  const m = useMinuto()
  if (!esDeMexico(lead)) return null
  const f = franjaDeMexico(lead.province, lead.phone)
  if (!f || m === 0) return null
  return { ...f, ...horaLocal(f.iana) }
}

/** La insignia de la fila: «Centro 11:24» */
export function MarcaDeHoraMexico({ lead }: { lead: LeadMx }) {
  const f = useFranja(lead)
  if (!f) return null
  const titulo = `Franja ${f.nombre} (${f.utc}): allí son las ${f.texto}${f.fueraDeHorario ? ', fuera del horario de oficina' : ''}${f.origen === 'telefono' ? ' · sacado de la lada del teléfono' : ''}`
  return (
    <span
      role="img"
      aria-label={titulo}
      title={titulo}
      className="inline-flex h-[17px] shrink-0 items-center gap-1 rounded-[4px] px-1.5 text-[10.5px] font-semibold leading-none tabular-nums"
      style={f.fueraDeHorario ? { color: COLOR_ESTADO.ambar, background: tinte('ambar') } : { color: 'var(--ls-t3)', background: 'var(--ls-sup2)' }}
    >
      <Clock className="h-[11px] w-[11px]" aria-hidden />
      {f.nombre} {f.texto}
    </span>
  )
}

/** La línea de la ficha: «Franja Centro (UTC−6) · allí son las 11:24» */
export function HoraMexicoDeLaFicha({ lead }: { lead: LeadMx }) {
  const f = useFranja(lead)
  if (!f) return null
  return (
    <p className="flex items-center gap-1.5 px-4 pt-2 text-[12px] max-sm:px-3" style={{ color: f.fueraDeHorario ? COLOR_ESTADO.ambar : 'var(--ls-t3)' }}>
      <Clock className="h-3.5 w-3.5" aria-hidden />
      <span>
        Franja <b className="font-semibold">{f.nombre}</b> ({f.utc}) · allí son las <b className="font-semibold tabular-nums">{f.texto}</b>
        {f.fueraDeHorario && ' · fuera del horario de oficina'}
        {f.origen === 'telefono' && <span className="text-[var(--ls-t4)]"> · sacado de la lada (el estado no se entiende)</span>}
      </span>
    </p>
  )
}
