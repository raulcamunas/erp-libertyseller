'use client'

import { CalendarRange, Info, PencilLine } from 'lucide-react'
import {
  formatDayLong,
  formatDays,
  type VacationBalance,
  type VacationEmployee,
} from '@/lib/types/vacations'
import { balanceTone, cardShell, warnBox } from './shared'

/**
 * EL SALDO DE UNA PERSONA, EN CUATRO NÚMEROS QUE HAY QUE PODER DISTINGUIR.
 *
 *   Generados    meses COMPLETOS trabajados × su tarifa
 *   Aprobados    los días ya concedidos: los «canjeados»
 *   Pendientes   días de peticiones sin resolver
 *   Disponibles  generados − aprobados − pendientes
 *
 * LO PENDIENTE RESTA, y la pantalla lo dice con todas las letras debajo del
 * número. Si no restara se podrían pedir los mismos cinco días dos veces y las
 * dos peticiones parecerían caber; al aprobar la segunda el saldo ya estaría en
 * rojo sin que nada lo hubiera avisado.
 *
 * Y DE QUÉ FECHA SE ESTÁ CONTANDO
 * -------------------------------
 * Debajo va siempre la fecha de alta con la que se ha hecho la cuenta. No es
 * un adorno: en varias fichas ese dato lo dedujo la migración 112 del primer
 * mes en que la persona aparecía facturando en Tesorería, no de su contrato.
 * Todo el saldo cuelga de ahí —a 1,83 días por mes, un año de diferencia son
 * 22 días—, así que quien mire esta pantalla tiene que ver de dónde sale el
 * número y poder corregirlo. De ahí el botón de abrir la ficha.
 */

export interface BalanceResumenProps {
  employee: VacationEmployee
  balance: VacationBalance
  /** Compacto para las listas de admin; amplio para «Mis vacaciones» */
  size?: 'compacto' | 'amplio'
  /** Abre la ficha del empleado para corregir la fecha de alta. Solo admin */
  onEditFicha?: () => void
}

export function BalanceResumen({
  employee,
  balance,
  size = 'compacto',
  onEditFicha,
}: BalanceResumenProps) {
  const { accrual } = balance
  const big = size === 'amplio'

  const cifras = [
    {
      label: 'Generados',
      value: balance.generated,
      hint: `${accrual.monthsCompleted} ${accrual.monthsCompleted === 1 ? 'mes completo' : 'meses completos'} × ${formatDays(accrual.perMonth ?? 0)}`,
      tone: 'text-white',
    },
    {
      label: 'Aprobados',
      value: balance.approved,
      hint:
        balance.approved > 0
          ? `${formatDays(balance.taken)} ya disfrutados · ${formatDays(balance.booked)} reservados`
          : 'Todavía no ha cogido ninguno',
      tone: balance.approved > 0 ? 'text-green-300' : 'text-white/40',
    },
    {
      label: 'Pendientes',
      value: balance.pending,
      hint:
        balance.pendingCount > 0
          ? `${balance.pendingCount} ${balance.pendingCount === 1 ? 'petición sin resolver' : 'peticiones sin resolver'}: ya restan`
          : 'Nada esperando respuesta',
      tone: balance.pending > 0 ? 'text-yellow-300' : 'text-white/40',
    },
    {
      label: 'Disponibles',
      value: balance.available,
      hint: balance.overdrawn
        ? 'Ha pedido más días de los que ha generado'
        : 'Lo que puede pedir hoy',
      tone: balance.overdrawn ? 'text-red-400' : balanceTone(balance.available),
    },
  ]

  return (
    <div className="space-y-2 min-w-0">
      <div className={`grid grid-cols-2 ${big ? 'lg:grid-cols-4' : 'sm:grid-cols-4'} gap-2`}>
        {cifras.map((c) => (
          <div key={c.label} className={`${cardShell} px-2.5 py-2 min-w-0`}>
            <p className="text-[10px] uppercase tracking-wider text-white/35 truncate">{c.label}</p>
            <p
              className={`font-bold ${big ? 'text-[26px]' : 'text-[19px]'} mt-0.5 tabular-nums leading-none ${c.tone}`}
            >
              {formatDays(c.value)}
            </p>
            <p className="text-[10px] text-white/30 mt-1 leading-snug">{c.hint}</p>
          </div>
        ))}
      </div>

      {/* De dónde sale la cuenta */}
      {accrual.missingStartDate ? (
        <div className={warnBox}>
          {employee.name} no tiene fecha de alta en su ficha, así que su saldo sale a cero. No
          es que no haya generado vacaciones: es que no se sabe desde cuándo contar.
          {onEditFicha && (
            <button
              type="button"
              onClick={onEditFicha}
              className="ml-1 underline underline-offset-2 hover:text-yellow-200"
            >
              Ponerla ahora
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/35">
          <span className="flex items-center gap-1.5">
            <CalendarRange className="h-3 w-3 flex-shrink-0" />
            Contando desde el {accrual.startedOn ? formatDayLong(accrual.startedOn) : '—'}
            {accrual.endedOn && ` · deja de generar el ${formatDayLong(accrual.endedOn)}`}
          </span>
          {onEditFicha && (
            <button
              type="button"
              onClick={onEditFicha}
              className="flex items-center gap-1 text-white/40 hover:text-white transition-colors underline underline-offset-2"
            >
              <PencilLine className="h-3 w-3" />
              Corregir en su ficha
            </button>
          )}
        </div>
      )}

      {/* El mes a medias: se enseña, pero NO está sumado arriba */}
      {accrual.inProgress && (
        <div className="flex items-start gap-1.5 text-[10px] text-white/35 leading-snug">
          <Info className="h-3 w-3 flex-shrink-0 mt-px" />
          <span>
            Mes en curso: lleva {accrual.inProgress.daysElapsed} de{' '}
            {accrual.inProgress.daysInCycle} días. Sumará{' '}
            <span className="text-white/60">{formatDays(accrual.inProgress.willAdd)}</span> el{' '}
            {formatDayLong(accrual.inProgress.completesOn)}, cuando lo complete. Todavía no está
            contado arriba.
          </span>
        </div>
      )}
    </div>
  )
}
