'use client'

import { Clock, FlaskConical, LogOut } from 'lucide-react'
import { diaCorto, diaDeMadrid, horaDeMadrid } from '@/lib/correo/secuencias/fechas'
import { BOTON_SECUNDARIO } from '../ui'

/**
 * LA BARRA DE LA DEMOSTRACIÓN: lo que avisa de que lo que se ve es de mentira y el reloj para avanzar los días.
 *
 * Mientras se enseña la demostración (gente inventada, el motor de verdad en memoria, nada de la base ni del correo) esta franja va siempre debajo de la cabecera, para que nadie confunda
 * lo que ve con lo real. El reloj mueve la demostración por días hábiles: con «+3 días» el motor ha seguido trabajando tres días más y se ven los seguimientos que han salido, las
 * respuestas que han llegado y los leads que se han cerrado.
 */

const SALTOS = [0, 1, 2, 3, 5, 7] as const

interface Props {
  /** Cuántos días hábiles se ha avanzado y hasta cuántos se puede */
  dias: number
  maximo: number
  /** El «ahora» de la demostración, para decir qué día y qué hora es en ella */
  ahora: number | null
  onDias: (dias: number) => void
  onSalir: () => void
}

export function BarraDeLaDemo({ dias, maximo, ahora, onDias, onSalir }: Props) {
  return (
    <section
      aria-label="Demostración"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-[var(--ls-linea)] border-l-2 border-l-[var(--ls-acc)] bg-[var(--ls-sup)] px-3 py-2.5"
    >
      <p className="flex min-w-0 flex-1 basis-72 items-start gap-2 text-[12px] leading-snug text-[var(--ls-t3)]">
        <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ls-acc)]" aria-hidden />
        <span>
          <strong className="font-semibold text-[var(--ls-t1)]">Demostración.</strong> Personas y correos inventados: el motor es el de verdad, pero aquí no sale nada ni se guarda nada.
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Reloj de la demostración">
        <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t3)]">
          <Clock className="h-3.5 w-3.5 text-[var(--ls-t4)]" aria-hidden />
          {ahora ? (
            <>
              <strong className="font-semibold text-[var(--ls-t1)]">
                {diaCorto(diaDeMadrid(ahora))} · {horaDeMadrid(ahora)}
              </strong>
            </>
          ) : (
            'Reloj'
          )}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {SALTOS.filter((n) => n <= maximo).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={dias === n}
              onClick={() => onDias(n)}
              className={`inline-flex h-7 items-center whitespace-nowrap rounded-[6px] border px-2.5 text-[12px] font-medium transition-colors ${
                dias === n ? 'border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup2)] text-[var(--ls-t2)] hover:border-[var(--ls-linea2)] hover:text-[var(--ls-t1)]'
              }`}
              title={n === 0 ? 'Volver a hoy' : `Avanza el reloj ${n} ${n === 1 ? 'día hábil' : 'días hábiles'}: el motor sigue trabajando`}
            >
              {n === 0 ? 'Hoy' : `+${n} ${n === 1 ? 'día' : 'días'}`}
            </button>
          ))}
        </div>
        <button type="button" onClick={onSalir} className={BOTON_SECUNDARIO}>
          <LogOut className="h-3.5 w-3.5" aria-hidden /> Salir
        </button>
      </div>
    </section>
  )
}
