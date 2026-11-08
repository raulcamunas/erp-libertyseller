'use client'

import { memo, type CSSProperties } from 'react'
import { AlertCircle, CalendarDays, CheckSquare, MessageSquare } from 'lucide-react'
import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import type { ClienteTC, OpcionDeEstado, PersonaTC } from '@/lib/tareas-clientes/tipos'
import { colorValido } from '@/lib/tareas-clientes/colores'
import { colorDePersona } from '@/components/rendimiento/ui'
import { Etiqueta, fechaCorta, hoyISO, PilaDeAvatares } from './ui'

/**
 * UNA TARJETA DEL TABLERO. Lleva el color de su columna (o el suyo propio) como un tinte suave, la fecha en rojo si ya pasó, quién la lleva, su departamento, su checklist
 * con una barra y cuántos comentarios tiene. Es lo que se arrastra: no abre nada por sí sola hasta que se pulsa sin moverla.
 */

export interface PropsDeTarjeta {
  tarea: TareaLigera
  estado: OpcionDeEstado | undefined
  cliente?: Pick<ClienteTC, 'nombre' | 'icono' | 'color'> | null
  personas: readonly PersonaTC[]
  departamentoColor?: string
  activa?: boolean
  superpuesta?: boolean
  fantasma?: boolean
  indice?: number
  onAbrir?: (id: string) => void
  /** Selección de varias: si la tarjeta está marcada, si hay alguna marcada en el tablero, y cómo marcarla o desmarcarla (clic con Mayús/Ctrl/Cmd, o clic normal si ya hay selección) */
  seleccionada?: boolean
  haySeleccion?: boolean
  onSeleccionar?: (id: string) => void
}

export const Tarjeta = memo(function Tarjeta({ tarea, estado, cliente, personas, departamentoColor, activa, superpuesta, fantasma, indice = 0, onAbrir, seleccionada, haySeleccion, onSeleccionar }: PropsDeTarjeta) {
  // Sin color propio la tarjeta es neutra (el color de la columna ya está en su filo); con color propio se tiñe entera
  const color = colorValido(tarea.color ?? estado?.color)
  const hecha = estado?.grupo === 'hecho'
  const dia = tarea.fecha_fin?.slice(0, 10) ?? tarea.fecha_inicio?.slice(0, 10) ?? null
  const vencida = Boolean(dia && !hecha && dia < hoyISO())
  // El color de quien la lleva, el mismo de su avatar; una persona de Notion sin enlazar con el equipo saca el suyo de su nombre
  const quienes = tarea.responsables.length > 0 ? tarea.responsables : tarea.responsables_notion.map((r) => r.nombre || r.id)
  const colorResp = tarea.color || quienes.length === 0 ? null : colorDePersona(quienes[0])
  const colorResp2 = colorResp && quienes.length > 1 ? colorDePersona(quienes[1]) : null
  const porcentaje = tarea.checklist_total > 0 ? Math.round((tarea.checklist_hecho / tarea.checklist_total) * 100) : 0

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Abrir la tarea ${tarea.titulo || 'sin título'}`}
      data-tarea-id={superpuesta ? undefined : tarea.id}
      data-seleccionada={seleccionada ? 'true' : undefined}
      data-activa={activa ? 'true' : undefined}
      data-color={tarea.color ? 'propio' : undefined}
      data-resp={colorResp ? (colorResp2 && colorResp2 !== colorResp ? 'varios' : 'uno') : undefined}
      data-superpuesta={superpuesta ? 'true' : undefined}
      data-fantasma={fantasma ? 'true' : undefined}
      onClick={(e) => (onSeleccionar && (e.metaKey || e.ctrlKey || e.shiftKey || haySeleccion) ? onSeleccionar(tarea.id) : onAbrir?.(tarea.id))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onAbrir?.(tarea.id)
        }
      }}
      className="tc-tarjeta group/t"
      style={{ '--tono': `var(--tc-${color})`, '--i': Math.min(indice, 14), ...(colorResp ? { '--resp': colorResp, '--resp2': colorResp2 ?? colorResp } : {}) } as CSSProperties}
    >
      <div className="flex items-start gap-2">
        {tarea.icono ? <span className="mt-px text-[15px] leading-none">{tarea.icono}</span> : null}
        <p className={`min-w-0 flex-1 text-[13px] font-medium leading-[1.35] text-[var(--ls-t1)] ${hecha ? 'tc-hecha' : ''}`}>{tarea.titulo || <span className="text-[var(--ls-t4)]">Sin título</span>}</p>
        {tarea.sync_estado === 'error' && (
          <span title={tarea.sync_error ?? 'No se ha podido enviar a Notion'} className="mt-px text-[var(--ls-e-rojo)]">
            <AlertCircle className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      {cliente && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--ls-t3)]">
          <span>{cliente.icono ?? '•'}</span>
          <span className="truncate">{cliente.nombre}</span>
        </p>
      )}

      {dia && (
        <p className={`mt-1.5 inline-flex items-center gap-1 text-[11.5px] tabular-nums ${vencida ? 'font-medium text-[var(--ls-e-rojo)]' : 'text-[var(--ls-t3)]'}`}>
          <CalendarDays className="h-3 w-3" />
          {fechaCorta(tarea.fecha_inicio, tarea.fecha_con_hora)}
          {tarea.fecha_fin && tarea.fecha_fin !== tarea.fecha_inicio ? ` → ${fechaCorta(tarea.fecha_fin)}` : ''}
        </p>
      )}

      {(tarea.responsables.length > 0 || tarea.responsables_notion.length > 0) && (
        <div className="mt-2 flex items-center gap-1.5">
          <PilaDeAvatares ids={tarea.responsables} personas={personas} maximo={3} />
          <span className="truncate text-[11.5px] text-[var(--ls-t2)]">
            {tarea.responsables.length > 0 ? (personas.find((p) => p.id === tarea.responsables[0])?.nombre ?? '') : tarea.responsables_notion[0]?.nombre}
            {tarea.responsables.length + tarea.responsables_notion.length > 1 ? ` +${tarea.responsables.length + tarea.responsables_notion.length - 1}` : ''}
          </span>
        </div>
      )}

      {tarea.departamento && (
        <div className="mt-2">
          <Etiqueta color={departamentoColor ?? 'gray'} pequena>
            {tarea.departamento}
          </Etiqueta>
        </div>
      )}

      {(tarea.checklist_total > 0 || tarea.comentarios > 0) && (
        <div className="mt-2 flex items-center gap-2.5 text-[11.5px] tabular-nums text-[var(--ls-t3)]">
          {tarea.checklist_total > 0 && (
            <span className="flex min-w-0 flex-1 items-center gap-1.5" title={`${tarea.checklist_hecho} de ${tarea.checklist_total} hechas · ${porcentaje}%`}>
              <CheckSquare className="h-3 w-3" style={{ color: tarea.checklist_hecho === tarea.checklist_total ? 'var(--ls-e-verde)' : undefined }} />
              {tarea.checklist_hecho}/{tarea.checklist_total}
              <span className="tc-barra" data-completa={porcentaje === 100 ? 'true' : undefined} style={{ '--p': `${porcentaje}%` } as CSSProperties} />
            </span>
          )}
          {tarea.comentarios > 0 && (
            <span className="inline-flex items-center gap-1" title={`${tarea.comentarios} comentarios`}>
              <MessageSquare className="h-3 w-3" />
              {tarea.comentarios}
            </span>
          )}
        </div>
      )}
    </div>
  )
})
