'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { ChevronLeft, ChevronRight, Flag } from 'lucide-react'
import { addMonths, monthKeyOf, monthLongLabel } from '@/lib/types/employees'
import {
  addDays,
  dayNumber,
  isWeekend,
  monthDayKeys,
  weekdayIndex,
  WEEKDAYS_SHORT,
} from '@/lib/types/vacations'
import type { DiaOcupado } from '@/lib/vacations/calendario'
import { iniciales, mezcla, TACTIL_CUADRADO } from '@/components/ui-ls'
import { cn } from '@/lib/utils'
import { RAYADO, type Seleccion } from './modelo'

/**
 * EL CALENDARIO DEL MES, CON TODA LA EMPRESA DENTRO
 * =================================================
 * Cada día laborable enseña quién está fuera (avatares en el PC, puntos en el móvil, con el color de cada persona; las
 * pendientes con trazo discontinuo), los festivos de quien mira, y en RAYADO los días en que los demás ya ocupan todo el
 * cupo de la empresa (no pueden irse dos a la vez).
 *
 * ELEGIR UN RANGO: igual que el calendario anterior, y por lo mismo.
 *   · Con ratón: se pincha y se arrastra (pointerdown + pointermove).
 *   · Con el dedo: se toca el primer día y el último. Se resuelve en `click`, que el navegador solo emite cuando el gesto
 *     fue un toque de verdad: anclar en pointerdown dejaría el rango anclado cuando el gesto acaba siendo un scroll.
 *     Y no se bloquea el scroll de la página (sin touch-action: none), para poder pasar de mes con el dedo.
 * Los extremos se recortan al laborable más cercano hacia dentro: un rango puede ATRAVESAR un fin de semana, pero no
 * empezar ni acabar en él. Quien cuenta los días es el mismo cálculo que el servidor.
 */

export interface CalendarioEmpresaProps {
  /** 'yyyy-MM-01' */
  mes: string
  onMes: (mes: string) => void
  hoy: string
  ocupacion: Map<string, DiaOcupado>
  festivos: Map<string, { nombre: string; descuenta: boolean }>
  yoId: string | null
  seleccion: Seleccion | null
  onSeleccion: (s: Seleccion | null) => void
  /** Se puede elegir un rango (tiene ficha o es admin) */
  puedeElegir: boolean
  /** Días de la selección que chocan con el cupo de la empresa */
  diasEnChoque: ReadonlySet<string>
  /** El día cuyo detalle se enseña al lado (quién está fuera) */
  diaEnfocado: string | null
  onEnfocar: (dia: string) => void
}

const esLaborableAqui = (dia: string, festivos: CalendarioEmpresaProps['festivos']) => !isWeekend(dia) && !festivos.get(dia)?.descuenta

export function CalendarioEmpresa({
  mes,
  onMes,
  hoy,
  ocupacion,
  festivos,
  yoId,
  seleccion,
  onSeleccion,
  puedeElegir,
  diasEnChoque,
  diaEnfocado,
  onEnfocar,
}: CalendarioEmpresaProps) {
  const anclaRef = useRef<string | null>(null)
  const arrastrando = useRef(false)
  const movido = useRef(false)
  const toquePendiente = useRef(false)
  const [esperandoFin, setEsperandoFin] = useState(false)
  const [direccion, setDireccion] = useState(0)

  const dias = useMemo(() => monthDayKeys(mes), [mes])
  const huecos = dias.length ? weekdayIndex(dias[0]) : 0
  const mesDeHoy = monthKeyOf(hoy)

  function recortar(a: string, b: string): Seleccion | null {
    let start = a <= b ? a : b
    let end = a <= b ? b : a
    while (start <= end && !esLaborableAqui(start, festivos)) start = addDays(start, 1)
    while (end >= start && !esLaborableAqui(end, festivos)) end = addDays(end, -1)
    return start <= end ? { start, end } : null
  }

  function empezar(dia: string, tipo: string) {
    onEnfocar(dia)
    if (!puedeElegir || isWeekend(dia)) return
    if (esperandoFin && anclaRef.current) {
      onSeleccion(recortar(anclaRef.current, dia))
      setEsperandoFin(false)
      arrastrando.current = false
      return
    }
    anclaRef.current = dia
    onSeleccion(recortar(dia, dia))
    movido.current = false
    if (tipo === 'touch') setEsperandoFin(true)
    else arrastrando.current = true
  }

  function extender(dia: string) {
    if (!arrastrando.current || !anclaRef.current) return
    const sig = recortar(anclaRef.current, dia)
    if ((sig === null && seleccion === null) || (sig && seleccion && sig.start === seleccion.start && sig.end === seleccion.end)) return
    movido.current = true
    onSeleccion(sig)
  }

  useEffect(() => {
    function parar() {
      if (!arrastrando.current) return
      arrastrando.current = false
      setEsperandoFin(!movido.current)
    }
    window.addEventListener('pointerup', parar)
    window.addEventListener('pointercancel', parar)
    return () => {
      window.removeEventListener('pointerup', parar)
      window.removeEventListener('pointercancel', parar)
    }
  }, [])

  useEffect(() => {
    if (seleccion === null) {
      anclaRef.current = null
      setEsperandoFin(false)
    }
  }, [seleccion])

  const irA = (n: number) => {
    setDireccion(n)
    onMes(addMonths(mes, n))
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-w-0 flex-col gap-3">
        {/* Navegación del mes */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => irA(-1)} aria-label="Mes anterior" className={cn('flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]', TACTIL_CUADRADO)}>
              <ChevronLeft className="h-[18px] w-[18px]" />
            </button>
            <h3 className="min-w-[9.5rem] text-center text-[16px] font-semibold capitalize tracking-[-0.015em] text-[var(--ls-t1)] tabular-nums">{monthLongLabel(mes)}</h3>
            <button type="button" onClick={() => irA(1)} aria-label="Mes siguiente" className={cn('flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]', TACTIL_CUADRADO)}>
              <ChevronRight className="h-[18px] w-[18px]" />
            </button>
            {mes !== mesDeHoy && (
              <button type="button" onClick={() => { setDireccion(mes < mesDeHoy ? 1 : -1); onMes(mesDeHoy) }} className="ml-1 rounded-full border border-[var(--ls-linea2)] px-3 py-1 text-[12px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]">
                Hoy
              </button>
            )}
          </div>
          {puedeElegir && (
            <p className="hidden text-right text-[12px] text-[var(--ls-t4)] sm:block" aria-live="polite">
              {esperandoFin ? 'Ahora pulsa el último día' : 'Arrastra sobre los días, o pulsa el primero y el último'}
            </p>
          )}
        </div>

        {/* Cabecera de días */}
        <div className="grid select-none grid-cols-7 gap-1 sm:gap-1.5">
          {WEEKDAYS_SHORT.map((d, i) => (
            <div key={`${d}-${i}`} className={cn('text-center text-[11px] font-semibold uppercase tracking-wider', i >= 5 ? 'text-[var(--ls-t4)] opacity-60' : 'text-[var(--ls-t4)]')}>
              {d}
            </div>
          ))}
        </div>

        {/* En el móvil la rejilla reserva siempre 6 semanas (6 × 48 px + 5 huecos de 4 px): un mes de 4, 5 o 6 filas
            cambiaba la altura de la página 52–104 px a cada flecha y la leyenda y las tarjetas de debajo saltaban.
            En el PC (sm y más) se queda como estaba. */}
        <div className="relative min-h-[308px] overflow-hidden sm:min-h-0">
          <AnimatePresence mode="popLayout" initial={false} custom={direccion}>
            <motion.div
              key={mes}
              custom={direccion}
              initial={{ opacity: 0, x: direccion * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direccion * -24 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="grid select-none grid-cols-7 gap-1 sm:gap-1.5"
            >
              {Array.from({ length: huecos }).map((_, i) => <div key={`h${i}`} aria-hidden />)}
              {dias.map((dia) => (
                <Casilla
                  key={dia}
                  dia={dia}
                  hoy={hoy}
                  ocupado={ocupacion.get(dia)}
                  festivo={festivos.get(dia)}
                  yoId={yoId}
                  enSeleccion={!!seleccion && dia >= seleccion.start && dia <= seleccion.end && esLaborableAqui(dia, festivos)}
                  choca={diasEnChoque.has(dia)}
                  enfocado={dia === diaEnfocado}
                  puedeElegir={puedeElegir}
                  onDown={(tipo, e) => {
                    if (tipo === 'touch') { toquePendiente.current = true; return }
                    toquePendiente.current = false
                    e.preventDefault()
                    empezar(dia, tipo)
                  }}
                  onMove={() => extender(dia)}
                  onTap={() => {
                    if (toquePendiente.current) { toquePendiente.current = false; empezar(dia, 'touch'); return }
                  }}
                  onKey={() => empezar(dia, 'touch')}
                />
              ))}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* La línea está siempre (invisible si no toca) para que el primer toque no empuje la leyenda hacia abajo */}
        {puedeElegir && (
          <p aria-hidden={!esperandoFin} className={cn('text-[12.5px] font-medium text-[var(--ls-acc)] sm:hidden', !esperandoFin && 'invisible')}>Ahora pulsa el último día</p>
        )}

        {/* Leyenda */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-[var(--ls-t3)]">
          <Leyenda muestra={<span className="h-3 w-3 rounded-full" style={{ background: 'var(--ls-mod-personas)' }} />} texto="Aprobadas" />
          <Leyenda muestra={<span className="h-3 w-3 rounded-full border-[1.5px] border-dashed" style={{ borderColor: 'var(--ls-mod-personas)' }} />} texto="Pendientes" />
          <Leyenda muestra={<span className="h-3 w-4 rounded-[3px] border border-[var(--ls-linea2)]" style={{ backgroundImage: RAYADO }} />} texto="Cupo lleno" />
          <Leyenda muestra={<Flag className="h-3 w-3 text-[var(--ls-e-ambar)]" />} texto="Festivo" />
          {puedeElegir && <Leyenda muestra={<span className="h-3 w-4 rounded-[3px]" style={{ background: 'var(--ls-acc-graf)' }} />} texto="Tu selección" />}
        </div>
      </div>
    </MotionConfig>
  )
}

function Leyenda({ muestra, texto }: { muestra: React.ReactNode; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {muestra}
      {texto}
    </span>
  )
}

interface CasillaProps {
  dia: string
  hoy: string
  ocupado: DiaOcupado | undefined
  festivo: { nombre: string; descuenta: boolean } | undefined
  yoId: string | null
  enSeleccion: boolean
  choca: boolean
  enfocado: boolean
  puedeElegir: boolean
  onDown: (tipo: string, e: React.PointerEvent) => void
  onMove: () => void
  onTap: () => void
  onKey: () => void
}

function Casilla({ dia, hoy, ocupado, festivo, yoId, enSeleccion, choca, enfocado, puedeElegir, onDown, onMove, onTap, onKey }: CasillaProps) {
  const finde = isWeekend(dia)
  const pasado = dia < hoy
  const personas = ocupado?.personas ?? []
  const mio = personas.find((p) => p.employee_id === yoId)
  const lleno = !!ocupado?.lleno && !mio
  const esHoy = dia === hoy

  const partes: string[] = []
  if (festivo) partes.push(festivo.descuenta ? `Festivo: ${festivo.nombre}` : `Festivo nacional en España: ${festivo.nombre}`)
  for (const p of personas) partes.push(`${p.employee_id === yoId ? 'Tú' : p.nombre} (${p.status === 'aprobada' ? 'aprobadas' : 'pendientes'})`)
  if (lleno) partes.push('Cupo de la empresa lleno')
  if (finde) partes.push('Fin de semana')
  const etiqueta = `${dayNumber(dia)}${partes.length ? `. ${partes.join(', ')}` : ''}`

  const color = mio?.color
  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={partes.join(' · ') || undefined}
      aria-pressed={enSeleccion}
      onPointerDown={(e) => onDown(e.pointerType, e)}
      onPointerMove={onMove}
      onClick={onTap}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onKey() }
      }}
      className={cn(
        'group relative flex min-h-[48px] flex-col items-stretch justify-between overflow-hidden rounded-[10px] border p-1 text-left outline-none transition-[background-color,border-color,box-shadow,transform] duration-150 sm:min-h-[92px] sm:rounded-[12px] sm:p-1.5',
        'focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]',
        finde ? 'border-transparent bg-transparent' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] hover:border-[var(--ls-linea2)]',
        puedeElegir && !finde && 'cursor-pointer active:scale-[0.97]',
        pasado && !enSeleccion && 'opacity-55',
        enfocado && !enSeleccion && 'ring-1 ring-[var(--ls-linea2)]',
        enSeleccion && !choca && 'border-[var(--ls-acc-graf)] shadow-[0_0_0_1px_var(--ls-acc-graf),0_6px_18px_-10px_var(--ls-acc-graf)]',
        enSeleccion && choca && 'border-[var(--ls-e-rojo)] shadow-[0_0_0_1px_var(--ls-e-rojo)]',
      )}
      style={{
        backgroundImage: lleno && !finde ? RAYADO : undefined,
        backgroundColor: enSeleccion
          ? mezcla(choca ? 'var(--ls-e-rojo)' : 'var(--ls-acc-graf)', 20)
          : color
            ? mezcla(color, mio?.status === 'aprobada' ? 22 : 10)
            : festivo?.descuenta
              ? mezcla('var(--ls-e-ambar)', 9)
              : undefined,
      }}
    >
      <span className="flex items-start justify-between gap-1">
        <span
          className={cn(
            'inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-[12.5px] font-semibold leading-none tabular-nums sm:text-[13px]',
            esHoy ? 'bg-[var(--ls-acc-graf)] text-white shadow-[0_0_14px_-2px_var(--ls-acc-graf)]' : finde ? 'text-[var(--ls-t4)] opacity-60' : 'text-[var(--ls-t2)]',
          )}
        >
          {dayNumber(dia)}
        </span>
        {/* Arriba solo en sm y más: en una casilla de 375 px quedan ~29 px y el número (22) + la bandera (12) no caben:
            la bandera salía cortada por la mitad. En el móvil va abajo, junto a los puntos */}
        {festivo && <Flag className={cn('mt-[3px] hidden h-3 w-3 shrink-0 sm:block', festivo.descuenta ? 'text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t4)]')} aria-hidden />}
      </span>

      {festivo && (
        <span className={cn('hidden truncate text-[10.5px] leading-tight sm:block', festivo.descuenta ? 'text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t4)]')}>{festivo.nombre}</span>
      )}

      {festivo && personas.length === 0 && (
        <Flag className={cn('h-2.5 w-2.5 shrink-0 sm:hidden', festivo.descuenta ? 'text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t4)]')} aria-hidden />
      )}

      {personas.length > 0 && (
        <>
          {/* PC: avatares con iniciales */}
          <span className="hidden items-center sm:flex">
            {personas.slice(0, 3).map((p, i) => (
              <span
                key={p.id}
                className={cn('inline-flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold ring-2 ring-[var(--ls-sup)]', i > 0 && '-ml-[7px]')}
                style={
                  p.status === 'aprobada'
                    ? { background: p.color, color: '#fff' }
                    : { background: mezcla(p.color, 16), color: p.color, outline: `1.5px dashed ${p.color}`, outlineOffset: '-1.5px' }
                }
              >
                {iniciales(p.employee_id === yoId ? 'Tú' : p.nombre)}
              </span>
            ))}
            {personas.length > 3 && <span className="-ml-[7px] inline-flex h-[24px] min-w-[24px] items-center justify-center rounded-full bg-[var(--ls-sup3)] px-1 text-[9.5px] font-bold text-[var(--ls-t2)] ring-2 ring-[var(--ls-sup)]">+{personas.length - 3}</span>}
          </span>
          {/* Móvil: puntos de color */}
          <span className="flex flex-wrap items-center gap-[3px] sm:hidden">
            {festivo && <Flag className={cn('h-2.5 w-2.5 shrink-0', festivo.descuenta ? 'text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t4)]')} aria-hidden />}
            {personas.slice(0, 4).map((p) => (
              <span
                key={p.id}
                className="h-[7px] w-[7px] rounded-full"
                style={p.status === 'aprobada' ? { background: p.color } : { boxShadow: `inset 0 0 0 1.5px ${p.color}` }}
              />
            ))}
          </span>
        </>
      )}
    </button>
  )
}
