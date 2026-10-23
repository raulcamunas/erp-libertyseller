'use client'

import { ChevronLeft, ChevronRight, Eye, FileBarChart, MailCheck, Users } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { sumarDias } from '@/lib/rendimiento/dia'
import { empiezaEnElFuturo, etiquetaDePeriodo, moverPeriodo, type Periodo } from '@/lib/rendimiento/periodos'
import { BarraDeCarga } from './ui'

/**
 * LA BARRA DE PERIODO: arriba del todo, y manda sobre toda la página.
 *
 *   [Hoy|Ayer|Semana|Mes]   ‹ Esta semana · 19–25 oct ›        [Informe semanal] [Actividad del equipo]  Ver: [Todo el equipo ▾]
 *
 * Hoy y Ayer son un día; Semana y Mes son el que contiene el día en el que se esté. La opción elegida la marca una
 * pastilla que se desliza de una a otra, el nombre del periodo entra desde un lado cada vez que cambia y una raya
 * recorre el borde de abajo mientras se leen datos nuevos. Las flechas mueven un periodo (un día salta los fines de
 * semana) y no dejan avanzar a uno que todavía no ha empezado.
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
  /** Solo para quien tiene el permiso «Actividad del equipo» (o es administrador): la dirección de esa pantalla. Sin esto no hay botón */
  enlaceActividad?: string
  /** Solo para quien tiene el permiso «Configuración de correos» (o es administrador): la dirección de esa pantalla. Sin esto no hay botón */
  enlaceCorreos?: string
}

const useEfectoDeDiseno = typeof window !== 'undefined' ? useLayoutEffect : useEffect

const BOTON_ICONO =
  'flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--ls-t3)]'

export function BarraDePeriodo({ periodo, hoy, cargando, onPeriodo, personas, personaId, yoId, onPersona, enlaceInforme, enlaceActividad, enlaceCorreos }: Props) {
  const ayer = sumarDias(hoy, -1)
  const siguiente = moverPeriodo(periodo, 1)
  const puedeAvanzar = !empiezaEnElFuturo(siguiente, hoy)

  const segmentos = [
    { id: 'hoy', texto: 'Hoy', activo: periodo.tipo === 'dia' && periodo.ancla === hoy, elegir: () => onPeriodo({ tipo: 'dia', ancla: hoy }) },
    { id: 'ayer', texto: 'Ayer', activo: periodo.tipo === 'dia' && periodo.ancla === ayer, elegir: () => onPeriodo({ tipo: 'dia', ancla: ayer }) },
    { id: 'semana', texto: 'Semana', activo: periodo.tipo === 'semana', elegir: () => onPeriodo({ tipo: 'semana', ancla: periodo.ancla }) },
    { id: 'mes', texto: 'Mes', activo: periodo.tipo === 'mes', elegir: () => onPeriodo({ tipo: 'mes', ancla: periodo.ancla }) },
  ]
  const indiceActivo = segmentos.findIndex((s) => s.activo)

  // La pastilla que marca la opción elegida: se coloca midiendo el botón y se desliza al cambiar
  const botones = useRef<Array<HTMLButtonElement | null>>([])
  const [pastilla, setPastilla] = useState<{ izquierda: number; ancho: number } | null>(null)
  const [animar, setAnimar] = useState(false)
  useEfectoDeDiseno(() => {
    const medir = () => {
      const el = indiceActivo >= 0 ? botones.current[indiceActivo] : null
      setPastilla(el ? { izquierda: el.offsetLeft, ancho: el.offsetWidth } : null)
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [indiceActivo])
  // La primera colocación no se anima: sería ver cómo la pastilla viaja desde la esquina
  useEffect(() => {
    const cuadro = requestAnimationFrame(() => setAnimar(true))
    return () => cancelAnimationFrame(cuadro)
  }, [])

  const etiqueta = etiquetaDePeriodo(periodo, hoy)

  return (
    <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative inline-flex items-center rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-0.5" role="group" aria-label="Periodo">
          <span
            aria-hidden
            className={`absolute bottom-0.5 top-0.5 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup3)] shadow-[0_1px_2px_rgba(0,0,0,0.25)] ${animar ? 'transition-[left,width,opacity] duration-300 ease-[cubic-bezier(0.22,0.8,0.3,1)]' : ''}`}
            style={{ left: pastilla?.izquierda ?? 0, width: pastilla?.ancho ?? 0, opacity: pastilla ? 1 : 0 }}
          />
          {segmentos.map((s, i) => (
            <button
              key={s.id}
              ref={(el) => {
                botones.current[i] = el
              }}
              type="button"
              onClick={s.elegir}
              aria-pressed={s.activo}
              className={`relative z-10 h-6 rounded-[6px] px-3 text-[12px] font-medium transition-colors ${s.activo ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'}`}
            >
              {s.texto}
            </button>
          ))}
        </div>

        <div className="flex h-7 items-center gap-0.5 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-0.5">
          <button type="button" onClick={() => onPeriodo(moverPeriodo(periodo, -1))} aria-label="Periodo anterior" className={BOTON_ICONO}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[132px] overflow-hidden px-1.5 text-center text-[12px] font-semibold text-[var(--ls-t1)] whitespace-nowrap" aria-live="polite">
            <span key={etiqueta} className="rend-desliza inline-block">
              {etiqueta}
            </span>
          </span>
          <button type="button" onClick={() => puedeAvanzar && onPeriodo(siguiente)} disabled={!puedeAvanzar} aria-label="Periodo siguiente" className={BOTON_ICONO}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {((personas && onPersona) || enlaceInforme || enlaceActividad || enlaceCorreos) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {enlaceInforme && (
            <a
              href={enlaceInforme}
              title="La semana entera del equipo en una página, para la reunión del lunes"
              className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2.5 text-[12px] text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
            >
              <FileBarChart className="h-3.5 w-3.5 text-[var(--ls-acc)]" /> Informe semanal
            </a>
          )}
          {enlaceActividad && (
            <Link
              href={enlaceActividad}
              title="Cuándo entra cada persona al ERP, qué hace y cuánto rato está activa"
              className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2.5 text-[12px] text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
            >
              <Eye className="h-3.5 w-3.5 text-[var(--ls-acc)]" /> Actividad del equipo
            </Link>
          )}
          {enlaceCorreos && (
            <Link
              href={enlaceCorreos}
              title="Afina los correos que escribe la IA, prueba versiones y mira cuál consigue más respuestas"
              className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2.5 text-[12px] text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
            >
              <MailCheck className="h-3.5 w-3.5 text-[var(--ls-acc)]" /> Configuración de correos
            </Link>
          )}
          {personas && onPersona && (
            <div className="flex items-center gap-2">
              <label htmlFor="persona-rendimiento" className="flex items-center gap-1.5 text-[12px] text-[var(--ls-t4)]">
                <Users className="h-3.5 w-3.5" /> Ver
              </label>
              <select
                id="persona-rendimiento"
                value={personaId ?? 'equipo'}
                onChange={(e) => onPersona(e.target.value === 'equipo' ? null : e.target.value)}
                className="h-7 cursor-pointer rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2.5 text-[12px] text-[var(--ls-t1)] outline-none transition-colors hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)]"
              >
                <option value="equipo" className="bg-[var(--ls-sup)]">
                  Todo el equipo
                </option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id} className="bg-[var(--ls-sup)]">
                    {p.id === yoId ? `${p.nombre} (yo)` : p.nombre}
                    {p.sinRinkel ? ' · sin Rinkel' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <BarraDeCarga activa={cargando} />
    </div>
  )
}
