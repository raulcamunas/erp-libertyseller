'use client'

import { memo, type PointerEvent as EventoDePuntero } from 'react'
import { Video } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { colorForAgent, type AppointmentWithPeople } from '@/lib/types/appointments'
import type { Colocada } from '@/lib/agenda/colocar'
import { ESTADO_DE_CITA, ESTADOS_APAGADOS } from './estados'
import type { EntradaDePresencia } from './usePresencia'

/**
 * UN BLOQUE DEL CALENDARIO: una cita del ERP o un hueco ocupado de Google.
 *
 * LAS CITAS DEL ERP son lo que se viene a mirar: una barra del color de su comercial a la izquierda, la hora y el nombre, y el estado con su glifo. El fondo es ese mismo
 * color mezclado con la superficie (`color-mix`), así que en tema claro y oscuro queda legible sin escribir dos paletas.
 *
 * LOS HUECOS DE GOOGLE son el ruido: en producción hay 5.889 (una reunión semanal repetida durante años) contra 50 citas del ERP. Van rayados y apagados, y sin el texto
 * «Hueco no disponible» repetido en cada uno — todos se llaman igual y no dicen nada. Siguen siendo pulsables (la ficha enseña de qué evento se trata).
 *
 * SIN ANIMACIONES POR BLOQUE. Cada bloque llevaba `layout`, `initial/animate` y `whileHover` de framer-motion: con docenas de bloques, cada movimiento del ratón por el
 * calendario los medía todos. El realce al pasar por encima es CSS, y el bloque está memorizado: solo se repinta si cambia su cita o su sitio.
 */

const RAYAS = 'repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--ls-linea2) 60%, transparent) 5px 6px)'

interface Props {
  colocada: Colocada<AppointmentWithPeople>
  puedeArrastrar: boolean
  /** Se está arrastrando: en su sitio solo queda el «fantasma» que pinta la columna */
  oculta: boolean
  /** Otra persona la está editando ahora mismo */
  editor?: EntradaDePresencia
  onAbrir: (cita: AppointmentWithPeople) => void
  onArrastrar: (e: EventoDePuntero, cita: AppointmentWithPeople) => void
}

function BloqueSinMemoria({ colocada, puedeArrastrar, oculta, editor, onAbrir, onArrastrar }: Props) {
  if (oculta) return null
  const { cita: a, col, totalCols, top, height, hora } = colocada
  const ancho = 100 / totalCols
  const posicion = { top, height, left: `calc(${col * ancho}% + 2px)`, width: `calc(${ancho}% - 4px)` }

  if (a.is_external) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onAbrir(a)
        }}
        title="Hueco no disponible · importado de Google Calendar"
        aria-label={`Hueco ocupado a las ${hora}, importado de Google Calendar`}
        style={{ ...posicion, backgroundImage: RAYAS }}
        className="absolute z-[5] overflow-hidden rounded-[5px] border border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-1.5 text-left transition-colors hover:border-[var(--ls-t4)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ls-acc-graf)]"
      >
        {height >= 30 && <span className="block truncate pt-[3px] text-[10.5px] text-[var(--ls-t4)]">Ocupado</span>}
      </button>
    )
  }

  const color = a.comercial ? colorForAgent(a.comercial.id, a.comercial.calendar_color) : '#FF6600'
  const estado = ESTADO_DE_CITA[a.status]
  const Glifo = estado.icono
  const apagada = ESTADOS_APAGADOS.has(a.status)
  const compacta = height < 40

  return (
    <>
      <button
        type="button"
        onPointerDown={puedeArrastrar ? (e) => onArrastrar(e, a) : undefined}
        onClick={(e) => {
          e.stopPropagation()
          onAbrir(a)
        }}
        title={`${a.lead_name}${a.lead_company ? ` · ${a.lead_company}` : ''} — ${estado.largo}`}
        aria-label={`${a.lead_name}, ${hora}, ${estado.largo}`}
        style={{
          ...posicion,
          touchAction: puedeArrastrar ? 'none' : undefined,
          background: `color-mix(in srgb, ${color} 15%, var(--ls-sup))`,
          borderColor: `color-mix(in srgb, ${color} 42%, var(--ls-linea))`,
        }}
        className={`absolute z-10 overflow-hidden rounded-[6px] border py-[3px] pl-[9px] pr-1.5 text-left transition-shadow hover:z-30 hover:shadow-[0_6px_18px_-8px_rgba(0,0,0,0.55)] focus-visible:z-30 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ls-acc-graf)] ${
          apagada ? 'opacity-50' : ''
        } ${puedeArrastrar ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
        <span className="flex min-w-0 items-center gap-1">
          {a.google_meet_link && <Video className="h-[11px] w-[11px] shrink-0 text-[var(--ls-t3)]" aria-hidden />}
          <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--ls-t3)]">{hora}</span>
          <span className={`min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--ls-t1)] ${apagada ? 'line-through' : ''}`}>{a.lead_name}</span>
          {compacta && <Glifo className="h-[12px] w-[12px] shrink-0" style={{ color: COLOR_ESTADO[estado.tono] }} aria-hidden />}
        </span>
        {!compacta && a.lead_company && <span className="block truncate text-[11px] leading-[1.35] text-[var(--ls-t3)]">{a.lead_company}</span>}
        {!compacta && height >= 56 && (
          <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-[var(--ls-t2)]">
            <Glifo className="h-[12px] w-[12px] shrink-0" style={{ color: COLOR_ESTADO[estado.tono] }} aria-hidden />
            <span className="truncate">{estado.corto}</span>
          </span>
        )}
      </button>

      {editor && (
        <span
          className="pointer-events-none absolute z-20"
          style={{ top: top - 3, left: `calc(${(col + 1) * ancho}% - 12px)` }}
          title={`${editor.fullName || editor.email} está editando esta cita`}
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: editor.color }} />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-[var(--ls-fondo)]" style={{ backgroundColor: editor.color }} />
          </span>
        </span>
      )}
    </>
  )
}

export const BloqueDeCita = memo(BloqueSinMemoria)
