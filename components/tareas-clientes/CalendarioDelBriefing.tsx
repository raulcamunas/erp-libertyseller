'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, History } from 'lucide-react'
import { resumirDia, semanasDelMes, sumarMeses, type DiaConApuntes, type PuntoDelPlan } from '@/lib/tareas-clientes/mi-dia'
import { BASE, pedir } from './api'

/**
 * EL CALENDARIO DE «MI DÍA»: un mes con una marca en cada día que tiene plan o anotaciones, para saltar a lo que se hizo cualquier día con un clic (lo que en Notion era
 * abrir la página «Briefing de …» de esa fecha). Debajo, la lista de los días con apuntes del mes con el principio de lo escrito.
 *
 * El día abierto se pinta con lo que hay en pantalla (plan y anotaciones sin guardar todavía), no con lo último leído del servidor.
 */

const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

const nombreDelMes = (mes: string): string =>
  new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${mes}-01T00:00:00Z`))

const diaCorto = (dia: string): string =>
  new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${dia}T00:00:00Z`))

export interface PropsDelCalendario {
  /** El día abierto */
  dia: string
  hoy: string
  /** De quién es el briefing (null = mío) */
  usuario: string | null
  /** Lo que hay ahora en pantalla del día abierto */
  plan: readonly PuntoDelPlan[]
  revision: string
  /** Mis tareas que vencen cada día (AAAA-MM-DD → cuántas) */
  tareasPorDia: ReadonlyMap<string, number>
  onElegir: (dia: string) => void
}

export function CalendarioDelBriefing({ dia, hoy, usuario, plan, revision, tareasPorDia, onElegir }: PropsDelCalendario) {
  const [mes, setMes] = useState(dia.slice(0, 7))
  const [dias, setDias] = useState<Map<string, DiaConApuntes>>(new Map())
  const [cargando, setCargando] = useState(true)

  // Si el día cambia desde fuera (flechas, «Hoy», el selector de fecha), el calendario va a su mes
  useEffect(() => setMes(dia.slice(0, 7)), [dia])

  const semanas = useMemo(() => semanasDelMes(mes), [mes])
  const desde = semanas[0][0]
  const hasta = semanas[5][6]

  useEffect(() => {
    let vivo = true
    setCargando(true)
    const q = new URLSearchParams({ desde, hasta })
    if (usuario) q.set('usuario', usuario)
    pedir<{ disponible: boolean; dias: DiaConApuntes[] }>(`${BASE}/mi-dia/dias?${q}`)
      .then((r) => vivo && setDias(new Map(r.dias.map((d) => [d.dia, d]))))
      .catch(() => vivo && setDias(new Map()))
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [desde, hasta, usuario])

  // El día abierto, con lo que hay escrito ahora mismo
  const marcas = useMemo(() => {
    const m = new Map(dias)
    const ahora = resumirDia(dia, plan, revision)
    if (ahora) m.set(dia, ahora)
    else m.delete(dia)
    return m
  }, [dias, dia, plan, revision])

  const delMes = useMemo(() => [...marcas.values()].filter((d) => d.dia.startsWith(mes)).sort((a, b) => b.dia.localeCompare(a.dia)), [marcas, mes])

  return (
    <section className="tc-dia-tarjeta" aria-label="Calendario del briefing">
      <div className="mb-2 flex items-center gap-1">
        <h2 className="tc-seccion-titulo !mb-0 min-w-0 flex-1"><CalendarDays className="h-3.5 w-3.5" /> <span className="truncate first-letter:uppercase">{nombreDelMes(mes)}</span></h2>
        <button type="button" className="tc-icono-boton" aria-label="Mes anterior" onClick={() => setMes(sumarMeses(mes, -1))}><ChevronLeft className="h-3.5 w-3.5" /></button>
        <button type="button" className="tc-icono-boton" aria-label="Mes siguiente" onClick={() => setMes(sumarMeses(mes, 1))}><ChevronRight className="h-3.5 w-3.5" /></button>
      </div>

      <div className="tc-cal-mes" role="grid" aria-busy={cargando}>
        {DIAS_SEMANA.map((d) => <span key={d} className="tc-cal-cabecera" role="columnheader">{d}</span>)}
        {semanas.flat().map((d) => {
          const marca = marcas.get(d)
          const tareas = tareasPorDia.get(d) ?? 0
          const estado = !marca ? undefined : marca.total > 0 && marca.hechos === marca.total ? 'completo' : marca.hechos > 0 ? 'parcial' : 'apuntado'
          const titulo = [
            marca ? (marca.total > 0 ? `${marca.hechos}/${marca.total} del plan` : 'Con anotaciones') : 'Sin apuntes',
            tareas > 0 ? `${tareas} tarea${tareas === 1 ? '' : 's'} vence${tareas === 1 ? '' : 'n'}` : '',
            marca?.extracto ?? '',
          ].filter(Boolean).join(' · ')
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              onClick={() => onElegir(d)}
              className="tc-cal-dia"
              data-fuera={d.slice(0, 7) !== mes ? 'true' : undefined}
              data-hoy={d === hoy ? 'true' : undefined}
              aria-selected={d === dia}
              data-estado={estado}
              title={titulo}
              aria-label={`${d.slice(8)} · ${titulo}`}
            >
              <span className="tc-cal-numero">{Number(d.slice(8))}</span>
              <span className="tc-cal-marcas">
                {marca && <span className="tc-cal-punto" />}
                {tareas > 0 && <span className="tc-cal-punto" data-tipo="tarea" />}
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--ls-t4)]">
        <span className="inline-flex items-center gap-1"><span className="tc-cal-punto" data-leyenda="apuntado" /> Con apuntes</span>
        <span className="inline-flex items-center gap-1"><span className="tc-cal-punto" data-leyenda="completo" /> Plan completo</span>
        <span className="inline-flex items-center gap-1"><span className="tc-cal-punto" data-tipo="tarea" /> Vencen tareas</span>
      </p>

      <h3 className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]"><History className="h-3 w-3" /> Días con apuntes <span className="tc-contador">{delMes.length}</span></h3>
      {delMes.length === 0 ? (
        <p className="mt-1 text-[12px] text-[var(--ls-t4)]">{cargando ? 'Cargando…' : 'Nada apuntado este mes.'}</p>
      ) : (
        <ul className="tc-cal-lista">
          {delMes.map((d) => (
            <li key={d.dia}>
              <button type="button" onClick={() => onElegir(d.dia)} className="tc-dia-item" aria-current={d.dia === dia ? 'date' : undefined}>
                <span className="flex items-center gap-2 text-[11.5px]">
                  <b className="font-medium capitalize text-[var(--ls-t2)]">{d.dia === hoy ? 'Hoy' : diaCorto(d.dia)}</b>
                  {d.total > 0 && <span className="tabular-nums text-[var(--ls-t4)]">{d.hechos}/{d.total}</span>}
                </span>
                {d.extracto && <span className="mt-0.5 line-clamp-2 text-[12px] text-[var(--ls-t3)]">{d.extracto}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
