'use client'

import { memo } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarClock, MessagesSquare } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { toMadrid } from '@/lib/timezone'
import { CRM_STAGE_DOTS, type CrmClientWithDetails, type CrmStage } from '@/lib/types/crm'
import { ETIQUETA_CORTA, type ResumenDeFila } from '@/lib/crm/lista'
import { INTERES } from './etiquetas'

/** Los seis tramos del camino, llenos hasta la fase en la que está: verde si se cerró, rojo si se perdió, naranja mientras sigue vivo */
function Tramos({ indice, stage }: { indice: number; stage: CrmStage }) {
  const color = stage === 'ganado' ? COLOR_ESTADO.verde : stage === 'perdido' ? COLOR_ESTADO.rojo : 'var(--ls-acc-graf)'
  return (
    <span className="flex shrink-0 items-center gap-[2px]" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className="h-[3px] w-[10px] rounded-[1px]" style={{ backgroundColor: i <= indice ? color : 'var(--ls-linea2)', opacity: stage === 'perdido' && i === indice ? 0.55 : 1 }} />
      ))}
    </span>
  )
}

const corto = (iso: string) => format(toMadrid(new Date(iso)), 'd MMM', { locale: es })

const Fila = memo(function Fila({ c, r, activa, onElegir }: { c: CrmClientWithDetails; r: ResumenDeFila; activa: boolean; onElegir: (id: string) => void }) {
  const estadoCita = c.appointment?.status
  const colorAccion = r.accion?.estado === 'vencida' ? COLOR_ESTADO.rojo : r.accion?.estado === 'hoy' ? COLOR_ESTADO.ambar : undefined
  return (
    <button
      type="button"
      onClick={() => onElegir(c.id)}
      aria-current={activa ? 'true' : undefined}
      className={`relative block w-full border-b border-[var(--ls-linea)] px-[11px] py-[7px] text-left outline-none hover:bg-[var(--ls-sup3)] focus-visible:bg-[var(--ls-sup3)] ${activa ? 'bg-[var(--ls-sel)]' : ''}`}
    >
      {activa && <span className="absolute inset-y-0 left-0 w-[2px] bg-[var(--ls-acc-graf)]" />}
      <div className="flex items-center gap-2">
        <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: CRM_STAGE_DOTS[c.stage] }} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[var(--ls-t1)]">{r.nombre}</span>
        {/* Si la cita está cualificada o no: separa lo que ya ha generado comisión de lo que está por decidir */}
        {estadoCita && (
          <span
            className="shrink-0 whitespace-nowrap text-[10.5px] font-medium leading-none"
            style={{ color: estadoCita === 'qualified' ? COLOR_ESTADO.verde : estadoCita === 'not_qualified' ? COLOR_ESTADO.rojo : 'var(--ls-t4)' }}
            title={estadoCita === 'qualified' ? 'Cita cualificada: genera comisión' : estadoCita === 'not_qualified' ? 'Cita no cualificada' : 'La cita todavía no se ha cualificado'}
          >
            {estadoCita === 'qualified' ? 'Cualif.' : estadoCita === 'not_qualified' ? 'No cualif.' : 'Sin decidir'}
          </span>
        )}
      </div>
      <p className="truncate pl-[15px] text-[11px] text-[var(--ls-t3)]">{r.empresa ?? 'Sin empresa'}</p>
      <div className="mt-[3px] flex items-center gap-2 pl-[15px]">
        <Tramos indice={r.indice} stage={r.stage} />
        <span className="min-w-0 truncate text-[10.5px] tabular-nums text-[var(--ls-t4)]">
          {ETIQUETA_CORTA[r.stage]}
          {r.diasEnLaFase !== null ? ` · ${r.diasEnLaFase} d` : ''}
        </span>
        <span className="flex-1" />
        {r.interes && (
          <span className="shrink-0 text-[10.5px] font-medium" style={{ color: COLOR_ESTADO[INTERES[r.interes].tono] }} title={INTERES[r.interes].texto}>
            {r.interes === 'alto' ? '▲' : r.interes === 'medio' ? '◆' : r.interes === 'bajo' ? '▽' : r.interes === 'ninguno' ? '✕' : '·'}
          </span>
        )}
        {r.notas > 0 && (
          <span className="inline-flex shrink-0 items-center gap-[2px] text-[10.5px] tabular-nums text-[var(--ls-t4)]" title={`${r.notas} reunión${r.notas === 1 ? '' : 'es'} con notas${r.porAnalizar ? ' (alguna por analizar)' : ''}`}>
            <MessagesSquare className="h-[11px] w-[11px]" />
            {r.notas}
          </span>
        )}
      </div>
      {r.accion && (r.accion.texto || r.accion.fecha) && (
        <p className="mt-[3px] flex items-center gap-1 truncate pl-[15px] text-[11px]" style={{ color: colorAccion ?? 'var(--ls-t3)' }}>
          <CalendarClock className="h-[11px] w-[11px] shrink-0" />
          <span className="truncate">
            {r.accion.texto || 'Acción'}
            {r.accion.fecha ? ` · ${corto(`${r.accion.fecha.slice(0, 10)}T12:00:00Z`)}` : ''}
          </span>
        </p>
      )}
    </button>
  )
})

export function ListaClientes({ filas, resumenes, seleccionado, onElegir, vacio }: { filas: readonly CrmClientWithDetails[]; resumenes: ReadonlyMap<string, ResumenDeFila>; seleccionado: string | null; onElegir: (id: string) => void; vacio: string }) {
  if (filas.length === 0) return <p className="px-4 py-8 text-center text-[12px] leading-[1.5] text-[var(--ls-t3)]">{vacio}</p>
  return (
    <>
      {filas.map((c) => {
        const r = resumenes.get(c.id)
        return r ? <Fila key={c.id} c={c} r={r} activa={c.id === seleccionado} onElegir={onElegir} /> : null
      })}
    </>
  )
}
