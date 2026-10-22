'use client'

import { ChevronLeft, ChevronRight, FileBarChart, Loader2, Users } from 'lucide-react'
import { sumarDias } from '@/lib/rendimiento/dia'
import { empiezaEnElFuturo, etiquetaDePeriodo, moverPeriodo, type Periodo } from '@/lib/rendimiento/periodos'

/**
 * LA BARRA DE PERIODO: arriba del todo, y manda sobre toda la página.
 *
 *   [Hoy] [Ayer] [Semana] [Mes]   ‹ Esta semana · 19–25 oct ›              Ver: [Todo el equipo ▾]
 *
 * Hoy y Ayer son un día; Semana y Mes son el que contiene el día en el que se esté. Las flechas mueven un periodo
 * (un día salta los fines de semana) y no dejan avanzar a uno que todavía no ha empezado.
 *
 * Quien supervisa elige además de quién es el panel: «Todo el equipo» o una persona. Cambiar de persona no cambia
 * el periodo: es lo que se quiere cuando se compara a dos personas en la misma semana. Y tiene un enlace al informe
 * semanal, la página de la semana entera para la reunión del lunes.
 */

export interface PersonaDelSelector {
  id: string
  nombre: string
  /** Se avisa de quién todavía no tiene Rinkel vinculado */
  sinRinkel: boolean
}

interface Props {
  periodo: Periodo
  hoy: string
  cargando: boolean
  onPeriodo: (p: Periodo) => void
  /** Solo para quien supervisa. Sin esto no hay selector */
  personas?: PersonaDelSelector[]
  /** null = todo el equipo */
  personaId?: string | null
  yoId?: string
  onPersona?: (id: string | null) => void
  /** Solo para quien supervisa: la dirección del informe semanal. Sin esto no hay enlace */
  enlaceInforme?: string
}

const CHIP = 'px-3 h-8 rounded-full border text-[12px] font-medium transition-colors'
const CHIP_ACTIVO = 'border-[#FF6600]/50 bg-[#FF6600]/15 text-white'
const CHIP_QUIETO = 'border-white/10 text-white/55 hover:text-white hover:border-white/25'

export function BarraDePeriodo({ periodo, hoy, cargando, onPeriodo, personas, personaId, yoId, onPersona, enlaceInforme }: Props) {
  const ayer = sumarDias(hoy, -1)
  const siguiente = moverPeriodo(periodo, 1)
  const puedeAvanzar = !empiezaEnElFuturo(siguiente, hoy)

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5" role="group" aria-label="Periodo">
          <button type="button" onClick={() => onPeriodo({ tipo: 'dia', ancla: hoy })} aria-pressed={periodo.tipo === 'dia' && periodo.ancla === hoy} className={`${CHIP} ${periodo.tipo === 'dia' && periodo.ancla === hoy ? CHIP_ACTIVO : CHIP_QUIETO}`}>
            Hoy
          </button>
          <button type="button" onClick={() => onPeriodo({ tipo: 'dia', ancla: ayer })} aria-pressed={periodo.tipo === 'dia' && periodo.ancla === ayer} className={`${CHIP} ${periodo.tipo === 'dia' && periodo.ancla === ayer ? CHIP_ACTIVO : CHIP_QUIETO}`}>
            Ayer
          </button>
          <button type="button" onClick={() => onPeriodo({ tipo: 'semana', ancla: periodo.ancla })} aria-pressed={periodo.tipo === 'semana'} className={`${CHIP} ${periodo.tipo === 'semana' ? CHIP_ACTIVO : CHIP_QUIETO}`}>
            Semana
          </button>
          <button type="button" onClick={() => onPeriodo({ tipo: 'mes', ancla: periodo.ancla })} aria-pressed={periodo.tipo === 'mes'} className={`${CHIP} ${periodo.tipo === 'mes' ? CHIP_ACTIVO : CHIP_QUIETO}`}>
            Mes
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-1 h-8">
          <button
            type="button"
            onClick={() => onPeriodo(moverPeriodo(periodo, -1))}
            aria-label="Periodo anterior"
            className="h-6 w-6 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[12px] font-semibold text-white px-1.5 whitespace-nowrap" aria-live="polite">
            {etiquetaDePeriodo(periodo, hoy)}
          </span>
          <button
            type="button"
            onClick={() => puedeAvanzar && onPeriodo(siguiente)}
            disabled={!puedeAvanzar}
            aria-label="Periodo siguiente"
            className="h-6 w-6 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-white/60"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {cargando && <Loader2 className="h-4 w-4 animate-spin text-white/40" aria-label="Cargando" />}
      </div>

      {((personas && onPersona) || enlaceInforme) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {enlaceInforme && (
            <a
              href={enlaceInforme}
              title="La semana entera del equipo en una página, para la reunión del lunes"
              className={`${CHIP} ${CHIP_QUIETO} inline-flex items-center gap-1.5`}
            >
              <FileBarChart className="h-3.5 w-3.5" /> Informe semanal
            </a>
          )}
          {personas && onPersona && (
        <div className="flex items-center gap-2">
          <label htmlFor="persona-rendimiento" className="text-[12px] text-white/45 flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Ver
          </label>
          <select
            id="persona-rendimiento"
            value={personaId ?? 'equipo'}
            onChange={(e) => onPersona(e.target.value === 'equipo' ? null : e.target.value)}
            className="h-8 rounded-full border border-white/10 bg-white/[0.03] px-3 text-[12px] text-white/80 outline-none focus:border-[#FF6600] transition-colors cursor-pointer"
          >
            <option value="equipo" className="bg-[#1a1a1a]">
              Todo el equipo
            </option>
            {personas.map((p) => (
              <option key={p.id} value={p.id} className="bg-[#1a1a1a]">
                {p.id === yoId ? `${p.nombre} (yo)` : p.nombre}
                {p.sinRinkel ? ' · sin Rinkel' : ''}
              </option>
            ))}
          </select>
        </div>
          )}
        </div>
      )}
    </div>
  )
}
