'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, DragOverlay, type DragEndEvent } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import { aFecha, colorDeTarea, deFecha, estaHechaLaTarea, fechasMovidas, hoyTexto, lunesDe, rangoDeTarea, sumarDias, type MapaDeClientes } from './vistas'

/**
 * EL CALENDARIO: un mes, con cada tarea en su día (una tarea con fecha de fin se ve en todos los días que cubre). Arrastrar una tarea a otro día la mueve conservando lo que
 * dura. Las tareas sin fecha esperan arriba, y se arrastran al día que toque para ponérsela.
 */

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const POR_DIA = 3

export function Calendario({ tareas, clientes, tareaAbierta, onAbrir, onCambiar }: { tareas: readonly TareaLigera[]; clientes: MapaDeClientes; tareaAbierta: string | null; onAbrir: (id: string) => void; onCambiar: (id: string, cambios: Record<string, unknown>) => void }) {
  const [mes, setMes] = useState(() => hoyTexto().slice(0, 7))
  const [activa, setActiva] = useState<string | null>(null)
  const hoy = hoyTexto()
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const dias = useMemo(() => {
    const primero = `${mes}-01`
    const inicio = lunesDe(primero)
    const ultimoDelMes = aFecha(new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)))
    const semanas = Math.ceil((deFecha(lunesDe(ultimoDelMes)).getTime() - deFecha(inicio).getTime()) / (7 * 86_400_000)) + 1
    return Array.from({ length: semanas * 7 }, (_, i) => sumarDias(inicio, i))
  }, [mes])

  const porDia = useMemo(() => {
    const m = new Map<string, TareaLigera[]>()
    for (const t of tareas) {
      const r = rangoDeTarea(t)
      if (!r) continue
      // Un rango muy largo no llena el mes de chips: se pinta hasta 62 días
      for (let d = r.desde, n = 0; d <= r.hasta && n < 62; d = sumarDias(d, 1), n++) {
        if (d < dias[0] || d > dias[dias.length - 1]) continue
        m.set(d, [...(m.get(d) ?? []), t])
      }
    }
    return m
  }, [tareas, dias])

  const sinFecha = useMemo(() => tareas.filter((t) => !t.fecha_inicio && !estaHechaLaTarea(t, clientes)), [tareas, clientes])
  const cambiarMes = (delta: number) => {
    const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + delta, 1))
    setMes(aFecha(d).slice(0, 7))
  }

  const alSoltar = (e: DragEndEvent) => {
    setActiva(null)
    const dia = e.over ? String(e.over.id).replace(/^dia:/, '') : null
    const t = tareas.find((x) => x.id === String(e.active.id).replace(/^t:/, ''))
    if (!dia || !t) return
    const r = rangoDeTarea(t)
    if (r?.desde === dia) return
    onCambiar(t.id, fechasMovidas(t, dia))
  }
  const tareaActiva = activa ? tareas.find((t) => t.id === activa.replace(/^t:/, '')) : null

  return (
    <DndContext sensors={sensores} onDragStart={(e) => setActiva(String(e.active.id))} onDragEnd={alSoltar} onDragCancel={() => setActiva(null)}>
      <div className="tc-calendario">
        <div className="flex items-center gap-2 pb-2">
          <h2 className="min-w-[150px] text-[15px] font-semibold text-[var(--ls-t1)]" aria-live="polite">{MESES[Number(mes.slice(5, 7)) - 1]} {mes.slice(0, 4)}</h2>
          <button type="button" aria-label="Mes anterior" onClick={() => cambiarMes(-1)} className="tc-icono-boton !h-7 !w-7"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" aria-label="Mes siguiente" onClick={() => cambiarMes(1)} className="tc-icono-boton !h-7 !w-7"><ChevronRight className="h-4 w-4" /></button>
          <button type="button" onClick={() => setMes(hoy.slice(0, 7))} className="tc-boton-suave">Hoy</button>
        </div>

        {sinFecha.length > 0 && (
          <div className="tc-sin-fecha" aria-label="Tareas sin fecha">
            <span className="shrink-0 text-[11.5px] font-medium text-[var(--ls-t3)]">Sin fecha ({sinFecha.length})</span>
            <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5">{sinFecha.slice(0, 40).map((t) => <Chip key={t.id} t={t} clientes={clientes} onAbrir={onAbrir} abierta={tareaAbierta === t.id} />)}</div>
          </div>
        )}

        <div className="tc-mes" role="grid" aria-label="Calendario del mes">
          {DIAS.map((d) => <div key={d} role="columnheader" className="tc-mes-dia-nombre">{d}</div>)}
          {dias.map((d, i) => {
            const lista = porDia.get(d) ?? []
            return <Celda key={d} dia={d} fueraDelMes={!d.startsWith(mes)} esHoy={d === hoy} indice={i}>
              {lista.slice(0, POR_DIA).map((t) => <Chip key={t.id} t={t} clientes={clientes} onAbrir={onAbrir} abierta={tareaAbierta === t.id} continuacion={rangoDeTarea(t)?.desde !== d} />)}
              {lista.length > POR_DIA && <span className="px-1 text-[11px] text-[var(--ls-t4)]" title={lista.slice(POR_DIA).map((t) => t.titulo).join('\n')}>+{lista.length - POR_DIA} más</span>}
            </Celda>
          })}
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 180 }}>{tareaActiva ? <div className="tc-chip" data-superpuesta="true" style={{ '--tono': `var(--tc-${colorDeTarea(tareaActiva, clientes)})` } as CSSProperties}>{tareaActiva.titulo || 'Sin título'}</div> : null}</DragOverlay>
    </DndContext>
  )
}

function Celda({ dia, fueraDelMes, esHoy, indice, children }: { dia: string; fueraDelMes: boolean; esHoy: boolean; indice: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `dia:${dia}` })
  return (
    <div ref={setNodeRef} role="gridcell" data-fuera={fueraDelMes ? 'true' : undefined} data-hoy={esHoy ? 'true' : undefined} data-sobre={isOver ? 'true' : undefined} className="tc-celda" style={{ '--i': Math.min(indice, 20) } as CSSProperties}>
      <span className="tc-celda-numero">{Number(dia.slice(8))}</span>
      <div className="flex flex-col gap-[3px]">{children}</div>
    </div>
  )
}

function Chip({ t, clientes, onAbrir, abierta, continuacion = false }: { t: TareaLigera; clientes: MapaDeClientes; onAbrir: (id: string) => void; abierta: boolean; continuacion?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `t:${t.id}` })
  return (
    <button ref={setNodeRef} type="button" {...attributes} {...listeners} onClick={() => onAbrir(t.id)} data-activa={abierta ? 'true' : undefined} data-continua={continuacion ? 'true' : undefined} data-fantasma={isDragging ? 'true' : undefined} title={t.titulo} className="tc-chip" style={{ '--tono': `var(--tc-${colorDeTarea(t, clientes)})` } as CSSProperties}>
      {!continuacion && t.icono ? <span>{t.icono}</span> : null}
      <span className={`truncate ${estaHechaLaTarea(t, clientes) ? 'tc-hecha' : ''}`}>{t.titulo || 'Sin título'}</span>
    </button>
  )
}
