'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addMonths, monthKeyOf, monthLongLabel } from '@/lib/types/employees'
import {
  addDays,
  dayNumber,
  formatDayRange,
  isWorkingDay,
  isWeekend,
  monthDayKeys,
  occupiedDays,
  weekdayIndex,
  VACATION_STATUS_LABELS,
  WEEKDAYS_SHORT,
  type VacationRequest,
} from '@/lib/types/vacations'

/**
 * EL CALENDARIO DE VACACIONES
 * ===========================
 * Es la pieza que más se va a usar del módulo, así que resuelve una sola cosa
 * y la resuelve bien: elegir un rango de días y ver a la vez lo que ya está
 * pedido.
 *
 * NO REUTILIZA AgendaCalendar, y es a propósito: aquel resuelve el problema
 * contrario —una semana partida en franjas de hora, con drag & drop de citas,
 * presencia en vivo y sincronización con Google—. Unas vacaciones son un
 * evento de DÍA COMPLETO en una vista de MES: no tienen hora de inicio ni de
 * fin, y no hay solapes que repartir en columnas. Acoplarse a aquellas 1.100
 * líneas para aprovechar el estilo significaría que tocar vacaciones puede
 * romper las citas. La rejilla está modelada sobre la de HoursTracker, que ya
 * demuestra que el patrón simple funciona en este ERP.
 *
 * LAS DOS FORMAS DE ELEGIR, Y POR QUÉ HAY DOS
 * -------------------------------------------
 * Con ratón se pincha y se arrastra, que es lo natural en un escritorio.
 * En una pantalla táctil NO se arrastra: se toca el primer día y se toca el
 * último. Y no es una simplificación, es lo contrario: para arrastrar sobre
 * una rejilla táctil hay que bloquear el scroll de la página con
 * `touch-action: none`, y entonces el dedo no puede desplazar el calendario
 * para llegar al mes siguiente. Un módulo que se va a abrir sobre todo desde
 * el móvil no puede permitirse eso, así que en táctil se toca dos veces y el
 * scroll sigue funcionando.
 *
 * Y POR ESO EL TOQUE SE RESUELVE EN `click`, NO EN `pointerdown`
 * -------------------------------------------------------------
 * Cuando el dedo aterriza sobre la rejilla, el navegador TODAVÍA NO SABE si
 * ese gesto va a ser un toque o un scroll. Anclar la selección en
 * `pointerdown` la compromete antes de saberlo: si el gesto acaba siendo un
 * scroll —arrastrar la página con el dedo apoyado sobre el calendario, que en
 * el móvil es lo normal—, el navegador se lleva el gesto y emite
 * `pointercancel`, pero el ancla se queda puesta. El siguiente toque, el
 * primero de verdad, no ancla: CIERRA un rango desde el día por el que se pasó
 * arrastrando. En una pantalla de móvil el resumen «Has elegido» queda debajo
 * del pliegue, así que se manda la petición equivocada sin llegar a verla.
 *
 * `click` solo lo emite el navegador cuando el gesto acabó siendo un toque de
 * verdad, así que ahí ya no hay nada que adivinar. El ratón sigue por
 * `pointerdown`, que es lo que necesita para arrastrar.
 *
 * Las dos formas comparten el mismo estado (`anchor` + `awaitingEnd`), así que
 * no hay dos máquinas de selección que puedan discrepar.
 *
 * EL FIN DE SEMANA NI SE SELECCIONA NI CUENTA
 * -------------------------------------------
 * No se puede empezar ni terminar en sábado o domingo —al soltar, los extremos
 * se recortan hasta el laborable más cercano hacia dentro—, pero un rango SÍ
 * puede atravesarlos: del viernes al lunes son cuatro días de calendario y dos
 * de vacaciones. Por eso el rango que sale de aquí es el rango real
 * (viernes→lunes) y quien cuenta los días es `workingDaysBetween`, que es la
 * misma función que usa el servidor al guardar.
 *
 * FESTIVOS: AQUÍ NO HAY, Y NO SE ACEPTAN COMO PROP
 * -----------------------------------------------
 * Las funciones de lib/types/vacations.ts sí los aceptan y ahí seguirán
 * (ver su cabecera). Lo que no puede haber es un `holidays` que solo respete
 * la mitad del recorrido: este componente pintaba «4 días» con un festivo
 * dentro y la ruta POST guardaba 5, porque a `checkVacationRequest` del
 * servidor nadie le pasaba nada. Un parámetro que solo obedece la pantalla es
 * peor que no tenerlo: es un descuadre silencioso en el saldo de alguien.
 *
 * El día que haya una tabla de festivos, tiene que entrar por el SERVIDOR y
 * llegar a la vez a app/api/vacations/route.ts y a este componente, o no
 * entrar.
 */

export interface DaySelection {
  /** 'yyyy-MM-dd' */
  start: string
  /** 'yyyy-MM-dd', incluido */
  end: string
}

export interface VacacionesCalendarProps {
  /** Mes visible, 'yyyy-MM-01' */
  month: string
  onMonthChange: (period: string) => void
  /** «Hoy» en hora de España, calculado en el servidor */
  today: string
  /** Las peticiones de ESA persona. Las vivas pintan; las rechazadas y canceladas no */
  requests: VacationRequest[]
  selection: DaySelection | null
  onSelectionChange: (selection: DaySelection | null) => void
  /** Solo consulta: se ve lo pedido pero no se puede elegir nada */
  readOnly?: boolean
}

export function VacacionesCalendar({
  month,
  onMonthChange,
  today,
  requests,
  selection,
  onSelectionChange,
  readOnly = false,
}: VacacionesCalendarProps) {
  // El ancla vive en un ref además de en el estado: durante un arrastre, el
  // `pointerenter` de la casilla siguiente puede llegar antes de que React haya
  // vuelto a pintar, y leyendo el estado se extendería desde el ancla anterior.
  const [anchor, setAnchor] = useState<string | null>(null)
  const anchorRef = useRef<string | null>(null)
  const dragging = useRef(false)
  const moved = useRef(false)
  /**
   * Hay un dedo posado sobre la rejilla esperando a ver en qué acaba.
   *
   * Se pone en el `pointerdown` táctil y solo lo consume el `click`, que es el
   * evento que el navegador emite únicamente si el gesto fue un toque. Si acabó
   * siendo un scroll no llega ningún `click` y esto se queda a true sin haber
   * tocado nada: el siguiente `pointerdown` lo vuelve a poner (táctil) o lo
   * apaga (ratón), así que no puede quedarse pegado.
   */
  const touchPending = useRef(false)

  /** Se ha elegido el primer día y falta el último (los dos toques / los dos clics) */
  const [awaitingEnd, setAwaitingEnd] = useState(false)

  const days = useMemo(() => monthDayKeys(month), [month])
  const leadingBlanks = days.length ? weekdayIndex(days[0]) : 0

  // Solo pintan las peticiones vivas: `occupiedDays` ya descarta las
  // rechazadas y canceladas (no reservan ningún día) y los fines de semana.
  const busy = useMemo(() => occupiedDays(requests), [requests])

  /**
   * Recorta los extremos hasta que caigan en día laborable.
   *
   * Devuelve null cuando entre los dos no hay ni un día de trabajo (un sábado
   * suelto, o un fin de semana entero): eso no son vacaciones, no consume
   * saldo y no debe quedar seleccionado.
   */
  function trimToWorkingDays(a: string, b: string): DaySelection | null {
    let start = a <= b ? a : b
    let end = a <= b ? b : a
    while (start <= end && !isWorkingDay(start)) start = addDays(start, 1)
    while (end >= start && !isWorkingDay(end)) end = addDays(end, -1)
    return start <= end ? { start, end } : null
  }

  function begin(key: string, pointerType: string) {
    if (readOnly || !isWorkingDay(key)) return

    // Segundo clic / segundo toque: cierra el rango abierto.
    if (awaitingEnd && anchorRef.current) {
      onSelectionChange(trimToWorkingDays(anchorRef.current, key))
      setAwaitingEnd(false)
      dragging.current = false
      return
    }

    anchorRef.current = key
    setAnchor(key)
    onSelectionChange(trimToWorkingDays(key, key))
    moved.current = false

    if (pointerType === 'touch') {
      // En táctil no se arrastra (ver cabecera): queda esperando el segundo
      // toque desde ya, sin pasar por el `pointerup`.
      setAwaitingEnd(true)
    } else {
      dragging.current = true
    }
  }

  /**
   * Extiende el rango mientras se arrastra.
   *
   * Va colgada de `pointermove` y no de `pointerenter` a propósito: enter y
   * leave no se disparan solos, los sintetiza React a partir de los `over` /
   * `out` del navegador, y ese camino se rompe con facilidad —basta con que la
   * celda se vuelva a montar debajo del cursor para que el enter no llegue y el
   * arrastre se quede pegado en el día del que salió—. `pointermove` se
   * dispara sobre la casilla que hay bajo el puntero, burbujea y no depende de
   * ninguna síntesis.
   *
   * El precio es que salta decenas de veces por casilla, y por eso lo primero
   * que hace es comprobar si el rango cambiaría: sin eso, cada píxel de
   * movimiento crearía un objeto nuevo y volvería a pintar el mes entero.
   */
  function extend(key: string) {
    if (!dragging.current || !anchorRef.current) return

    const next = trimToWorkingDays(anchorRef.current, key)
    const igual =
      (next === null && selection === null) ||
      (next !== null &&
        selection !== null &&
        next.start === selection.start &&
        next.end === selection.end)
    if (igual) return

    moved.current = true
    onSelectionChange(next)
  }

  // El arrastre termina donde termine el dedo o el ratón, también fuera de la
  // rejilla: si solo se escuchara el `pointerup` de las casillas, soltar en el
  // hueco de un fin de semana dejaría el calendario pegado al cursor.
  useEffect(() => {
    function stop() {
      if (!dragging.current) return
      dragging.current = false
      // Un clic sin arrastrar deja el rango abierto esperando el último día.
      setAwaitingEnd(!moved.current)
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [])

  // Si la selección se borra desde fuera (al enviar la petición, o con el
  // botón de limpiar), aquí no puede quedarse un rango a medias esperando un
  // segundo clic que ya no tiene ancla.
  useEffect(() => {
    if (selection === null) {
      anchorRef.current = null
      setAnchor(null)
      setAwaitingEnd(false)
    }
  }, [selection])

  // El mes en el que cae «hoy», para el botón de volver. monthKeyOf trocea el
  // texto en vez de pasar por new Date(), que en Latinoamérica devolvería el
  // mes anterior a última hora del día.
  const currentMonth = monthKeyOf(today)

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {/* Navegación de mes */}
      <div className="flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-1 py-1">
          <button
            type="button"
            onClick={() => onMonthChange(addMonths(month, -1))}
            aria-label="Mes anterior"
            className="h-7 w-7 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[13px] font-semibold text-white px-1.5 capitalize whitespace-nowrap tabular-nums">
            {monthLongLabel(month)}
          </span>
          <button
            type="button"
            onClick={() => onMonthChange(addMonths(month, 1))}
            aria-label="Mes siguiente"
            className="h-7 w-7 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {month !== currentMonth && (
            <button
              type="button"
              onClick={() => onMonthChange(currentMonth)}
              className="text-[11px] text-white/40 hover:text-white px-2 transition-colors"
            >
              Hoy
            </button>
          )}
        </div>

        {!readOnly && (
          <p className="text-[10px] text-white/35 text-right leading-tight hidden sm:block">
            {awaitingEnd ? 'Pulsa el último día' : 'Pincha y arrastra, o pulsa el primer día y el último'}
          </p>
        )}
      </div>

      {/* Cabecera de días. select-none: sin esto, arrastrar por la rejilla
          selecciona los números como si fuera texto. */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5 select-none">
        {WEEKDAYS_SHORT.map((d, i) => (
          <div
            key={`${d}-${i}`}
            className={`text-center text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider ${
              i >= 5 ? 'text-white/20' : 'text-white/30'
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 auto-rows-fr gap-1 sm:gap-1.5 select-none">
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <div key={`blank-${i}`} />
        ))}

        {days.map((key) => {
          const weekend = isWeekend(key)
          const selectable = !readOnly && !weekend

          const inSelection =
            !!selection && key >= selection.start && key <= selection.end && !weekend

          const on = busy.get(key)
          const approved = on?.some((r) => r.status === 'aprobada') ?? false
          const pending = !approved && (on?.some((r) => r.status === 'pendiente') ?? false)

          // EL SOLAPE, VISTO ANTES DE ENVIAR. Un día que se está eligiendo y
          // que ya está pedido se pinta en rojo aquí mismo, en vez de que el
          // servidor conteste que no después de darle al botón.
          const clash = inSelection && !!on && on.length > 0

          const isToday = key === today
          const isPast = key < today

          const tone = weekend
            ? 'border-transparent bg-white/[0.01]'
            : clash
              ? 'border-red-500/60 bg-red-500/20'
              : inSelection
                ? 'border-[#FF6600] bg-[#FF6600]/25'
                : approved
                  ? 'border-green-500/30 bg-green-500/15 hover:border-green-500/50'
                  : pending
                    ? 'border-yellow-500/30 bg-yellow-400/[0.12] hover:border-yellow-500/50'
                    : 'border-white/[0.07] hover:border-white/25 hover:bg-white/[0.04]'

          const numberTone = weekend
            ? 'text-white/20'
            : isToday
              ? 'text-[#FF6600] font-bold'
              : inSelection || approved || pending
                ? 'text-white/80'
                : 'text-white/45'

          const label = on?.length
            ? `${VACATION_STATUS_LABELS[on[0].status]} · ${formatDayRange(on[0].start_date, on[0].end_date)}`
            : weekend
              ? 'Fin de semana: no cuenta como vacaciones'
              : undefined

          return (
            <button
              key={key}
              type="button"
              disabled={!selectable && !label}
              title={label}
              aria-pressed={inSelection}
              aria-label={`${dayNumber(key)}${label ? `. ${label}` : ''}`}
              onPointerDown={(e) => {
                if (e.pointerType === 'touch') {
                  // AQUÍ NO SE DECIDE NADA (ver cabecera): el navegador aún no
                  // sabe si esto va a ser un toque o un scroll. Tampoco
                  // preventDefault, que cancelaría el scroll y dejaría el
                  // calendario clavado.
                  touchPending.current = true
                  return
                }
                touchPending.current = false
                e.preventDefault()
                begin(key, e.pointerType)
              }}
              onPointerMove={() => extend(key)}
              // Solo llega si el gesto acabó siendo un toque de verdad. Para el
              // ratón ya se resolvió en pointerdown, y `touchPending` a false lo
              // deja pasar de largo.
              onClick={() => {
                if (!touchPending.current) return
                touchPending.current = false
                begin(key, 'touch')
              }}
              className={`relative min-h-[40px] sm:min-h-[52px] rounded-lg sm:rounded-xl border flex flex-col items-start justify-between p-1.5 sm:p-2 transition-colors ${tone} ${
                selectable ? 'cursor-pointer active:scale-[0.97]' : 'cursor-default'
              } ${isPast && !inSelection && !on ? 'opacity-45' : ''}`}
            >
              <span className={`text-[12px] sm:text-[13px] leading-none tabular-nums ${numberTone}`}>
                {dayNumber(key)}
              </span>

              {/* Un punto por cada estado presente: en una casilla de móvil no
                  cabe texto, y el color de fondo por sí solo no distingue
                  «aprobada» de «seleccionada» para quien no ve bien el matiz. */}
              {(approved || pending || inSelection) && (
                <span className="self-end flex items-center gap-0.5">
                  {clash && <span className="h-1.5 w-1.5 rounded-full bg-red-400" />}
                  {!clash && inSelection && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[#FF6600]" />
                  )}
                  {approved && <span className="h-1.5 w-1.5 rounded-full bg-green-400" />}
                  {pending && <span className="h-1.5 w-1.5 rounded-full bg-yellow-300" />}
                </span>
              )}

              {isToday && (
                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-[#FF6600]" />
              )}
            </button>
          )
        })}
      </div>

      {/* Leyenda. Sin ella, cuatro fondos de colores no significan nada */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/40 pt-0.5">
        <Legend className="bg-[#FF6600]" label="Eligiendo ahora" />
        <Legend className="bg-yellow-300" label="Pendiente de aprobar" />
        <Legend className="bg-green-400" label="Aprobadas" />
        <Legend className="bg-red-400" label="Se pisa con otra petición" />
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] border border-white/10 bg-white/[0.01]" />
          Fin de semana: no cuenta
        </span>
      </div>

      {anchor && awaitingEnd && !readOnly && (
        <p className="text-[11px] text-[#FF6600] sm:hidden">Ahora pulsa el último día</p>
      )}
    </div>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className={`h-2.5 w-2.5 rounded-[3px] ${className}`} />
      {label}
    </span>
  )
}
