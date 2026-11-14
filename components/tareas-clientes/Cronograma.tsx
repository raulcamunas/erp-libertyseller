'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import { porFecha } from '@/lib/tareas-clientes/filtros'
import { colorDeTarea, deFecha, diasEntre, estaHechaLaTarea, hoyTexto, lunesDe, rangoDeTarea, sumarDias, type MapaDeClientes } from './vistas'

/**
 * EL CRONOGRAMA: cada tarea con fecha es una barra desde su inicio hasta su fin, sobre una escala de días. Se ve de dos semanas a tres meses, se desplaza por semanas y la
 * línea de hoy atraviesa todas las filas. A la izquierda, el nombre de cada tarea se queda fijo. Las que no tienen fecha se cuentan abajo (se les pone fecha desde el
 * calendario o el panel).
 */

const ESCALAS = [
  { id: 14, nombre: '2 semanas' },
  { id: 42, nombre: '6 semanas' },
  { id: 91, nombre: '3 meses' },
] as const

const ABR_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function Cronograma({ tareas, clientes, tareaAbierta, onAbrir }: { tareas: readonly TareaLigera[]; clientes: MapaDeClientes; tareaAbierta: string | null; onAbrir: (id: string) => void }) {
  const [escala, setEscala] = useState<(typeof ESCALAS)[number]['id']>(42)
  const [inicio, setInicio] = useState(() => sumarDias(lunesDe(hoyTexto()), -7))
  const hoy = hoyTexto()
  const fin = sumarDias(inicio, escala - 1)

  const dias = useMemo(() => Array.from({ length: escala }, (_, i) => sumarDias(inicio, i)), [inicio, escala])
  const conFecha = useMemo(() => porFecha(tareas.filter((t) => rangoDeTarea(t))), [tareas])
  const visibles = conFecha.filter((t) => {
    const r = rangoDeTarea(t)!
    return r.hasta >= inicio && r.desde <= fin
  })
  const sinFecha = tareas.length - conFecha.length
  const pct = (d: string) => (diasEntre(inicio, d) / escala) * 100

  return (
    <div className="tc-crono">
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <button type="button" aria-label="Retroceder" onClick={() => setInicio(sumarDias(inicio, -7 * Math.max(1, Math.round(escala / 14))))} className="tc-icono-boton !h-7 !w-7"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" aria-label="Avanzar" onClick={() => setInicio(sumarDias(inicio, 7 * Math.max(1, Math.round(escala / 14))))} className="tc-icono-boton !h-7 !w-7"><ChevronRight className="h-4 w-4" /></button>
        <button type="button" onClick={() => setInicio(sumarDias(lunesDe(hoy), -7))} className="tc-boton-suave">Hoy</button>
        <span className="text-[12.5px] tabular-nums text-[var(--ls-t3)]">{Number(inicio.slice(8))} {ABR_MES[Number(inicio.slice(5, 7)) - 1]} – {Number(fin.slice(8))} {ABR_MES[Number(fin.slice(5, 7)) - 1]} {fin.slice(0, 4)}</span>
        <div className="ml-auto flex gap-0.5 rounded-[8px] bg-[var(--ls-sup2)] p-0.5" role="group" aria-label="Escala">
          {ESCALAS.map((e) => <button key={e.id} type="button" aria-pressed={escala === e.id} onClick={() => setEscala(e.id)} className="rounded-[6px] px-2.5 py-1 text-[11.5px] text-[var(--ls-t3)] aria-pressed:bg-[var(--ls-sup3)] aria-pressed:text-[var(--ls-t1)]">{e.nombre}</button>)}
        </div>
      </div>

      <div className="tc-crono-caja" role="table" aria-label="Cronograma" style={{ '--dias': escala } as CSSProperties}>
        <div className="tc-crono-fila tc-crono-cabecera" role="row">
          <div className="tc-crono-nombre" role="columnheader">Tarea</div>
          <div className="tc-crono-pista" role="columnheader">
            {dias.map((d, i) => {
              const esLunes = deFecha(d).getUTCDay() === 1
              return escala > 42 && !esLunes ? null : <span key={d} className="tc-crono-marca" data-semana={esLunes ? 'true' : undefined} style={{ left: `${(i / escala) * 100}%` }}>{escala > 42 || esLunes ? `${Number(d.slice(8))} ${ABR_MES[Number(d.slice(5, 7)) - 1]}` : ''}</span>
            })}
          </div>
        </div>
        {visibles.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-[var(--ls-t4)]">No hay tareas con fecha en estas semanas.</p>}
        {visibles.map((t, i) => {
          const r = rangoDeTarea(t)!
          const desde = r.desde < inicio ? inicio : r.desde
          const hasta = r.hasta > fin ? fin : r.hasta
          const izquierda = pct(desde)
          const ancho = Math.max(((diasEntre(desde, hasta) + 1) / escala) * 100, 1.2)
          const hecha = estaHechaLaTarea(t, clientes)
          return (
            <div key={t.id} className="tc-crono-fila" role="row" style={{ '--i': Math.min(i, 18) } as CSSProperties}>
              <button type="button" role="rowheader" className="tc-crono-nombre" onClick={() => onAbrir(t.id)} data-activa={tareaAbierta === t.id ? 'true' : undefined} title={t.titulo}>
                <span className="w-5 shrink-0 text-center">{t.icono ?? ''}</span>
                <span className={`truncate ${hecha ? 'tc-hecha' : ''}`}>{t.titulo || 'Sin título'}</span>
              </button>
              <div className="tc-crono-pista" role="cell">
                <button type="button" onClick={() => onAbrir(t.id)} aria-label={`Abrir ${t.titulo}`} className="tc-barra-crono" data-activa={tareaAbierta === t.id ? 'true' : undefined} data-corta={ancho < 8 ? 'true' : undefined} style={{ left: `${izquierda}%`, width: `${ancho}%`, '--tono': `var(--tc-${colorDeTarea(t, clientes)})` } as CSSProperties}>
                  <span className="truncate">{t.titulo}</span>
                </button>
              </div>
            </div>
          )
        })}
        {hoy >= inicio && hoy <= fin && <div className="tc-crono-hoy" aria-hidden style={{ left: `calc(var(--tc-crono-nombre, 240px) + (100% - var(--tc-crono-nombre, 240px)) * ${(diasEntre(inicio, hoy) + 0.5) / escala})` }} />}
      </div>
      {sinFecha > 0 && <p className="mt-2 text-[12px] text-[var(--ls-t4)]">{sinFecha} {sinFecha === 1 ? 'tarea no tiene' : 'tareas no tienen'} fecha y no sale{sinFecha === 1 ? '' : 'n'} aquí.</p>}
    </div>
  )
}
