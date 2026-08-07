'use client'

import { AlarmClock, CalendarRange, Info, PencilLine, TrendingUp } from 'lucide-react'
import {
  formatDayLong,
  formatDays,
  round2,
  type VacationBalance,
  type VacationEmployee,
} from '@/lib/types/vacations'
import { balanceTone, cardShell, warnBox } from './shared'

/**
 * EL SALDO DE UNA PERSONA EN UN AÑO NATURAL.
 *
 *   Devengado    meses de ESE AÑO ya cerrados × su tarifa
 *   Arrastre     lo que sobró del año anterior. CADUCA EL 31 DE MARZO
 *   Aprobados    los días ya concedidos: los «canjeados»
 *   Pendientes   días de peticiones sin resolver
 *   Disponibles  devengado + arrastre − caducado − deuda − aprobados − pendientes
 *
 * LO PRIMERO QUE TIENE QUE DECIR ESTA PANTALLA ES DE QUÉ AÑO HABLA. Desde que
 * el período es el año natural, «tienes 9,15 días» sin más es una frase
 * incompleta: el 31 de diciembre significa una cosa y el 1 de enero otra. El
 * año va escrito en la cabecera y en cada cifra que dependa de él.
 *
 * Y LO SEGUNDO, LA CADUCIDAD DEL ARRASTRE. Si a alguien le van a caducar días
 * el 31 de marzo tiene que enterarse MIRANDO LA PANTALLA, no en abril cuando
 * ya no se puede hacer nada. Por eso el arrastre vivo no es una cifra más en
 * la rejilla: sale además en un aviso ámbar con su fecha, del mismo color que
 * el resto de «ojo con esto» del ERP.
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
  /**
   * El contenedor YA ENSEÑA el aviso de caducidad, así que aquí no se repite.
   * Lo usan «Mis vacaciones» (que lo pinta en el héroe) y la pestaña Saldos del
   * panel (que lo lista para todo el equipo de una vez). Sin esto salían dos
   * copias seguidas del mismo párrafo en la pantalla de la empleada y cuatro en
   * la del admin, y un aviso repetido deja de leerse.
   */
  sinAvisoCaducidad?: boolean
}

export function BalanceResumen({
  employee,
  balance,
  size = 'compacto',
  onEditFicha,
  sinAvisoCaducidad = false,
}: BalanceResumenProps) {
  const { accrual, year } = balance
  const big = size === 'amplio'
  // En «Mis vacaciones» le habla a la persona; en el panel del admin, de ella.
  const propio = big

  const cifras: { label: string; value: number; hint: string; tone: string }[] = [
    {
      label: `Devengado ${year}`,
      value: balance.generated,
      hint: `${accrual.monthsCompleted} de ${accrual.monthsInYear} ${
        accrual.monthsInYear === 1 ? 'mes' : 'meses'
      } de ${year} × ${formatDays(accrual.perMonth ?? 0)}`,
      tone: 'text-white',
    },
  ]

  /**
   * EL ARRASTRE QUE CUENTA, NO EL BRUTO.
   *
   * La columna enseñaba `carriedIn`, y a partir del 1 de abril ese número ya no
   * está disponible: con 21,96 arrastrados de los que se perdieron 16,96, la
   * fila decía «Devengado 7,32 · Arrastre 21,96 · Aprobados 5 · Disponibles
   * 7,32» y no había forma de sumarla con el dedo. Lo caducado solo aparecía en
   * una nota de 10 px al 35 % de opacidad.
   *
   * Con el arrastre que SIGUE CONTANDO —el vivo más el ya usado, o sea
   * `carriedIn − carriedExpired`— la fila cuadra siempre:
   *
   *   Devengado + Arrastre − Aprobados − Pendientes = Disponibles
   *
   * El bruto y lo que se perdió pasan al hint, que es donde se explican.
   *
   * ARRASTRE Y DEUDA NO PUEDEN CONVIVIR: el saldo de cierre del año anterior es
   * positivo o negativo, y `carriedIn`/`debt` salen de ese mismo signo. Por eso
   * se reparten una sola columna y la rejilla nunca pasa de cinco. Antes la
   * deuda no era columna, así que con −6,70 arrastrados la fila decía «0, 0, 0»
   * y Disponibles saltaba a −6,70 sin que nada lo explicara.
   */
  if (balance.carriedIn > 0) {
    cifras.push({
      label: `Arrastre ${year - 1}`,
      value: round2(balance.carriedIn - balance.carriedExpired),
      hint: balance.carriedAlive
        ? balance.carriedLeft === 0
          ? `Usados los ${formatDays(balance.carriedIn)}: no queda nada por caducar`
          : balance.carriedUsed > 0
            ? `${formatDays(balance.carriedLeft)} caducan el 31 de marzo · ${formatDays(
                balance.carriedUsed
              )} ya usados`
            : `Sobraron de ${year - 1}. Caducan el 31 de marzo`
        : balance.carriedExpired > 0
          ? `De ${formatDays(balance.carriedIn)} se perdieron ${formatDays(
              balance.carriedExpired
            )} el 31 de marzo`
          : 'Se usaron todos antes del 31 de marzo',
      // Amarillo y no ámbar: es el único aviso que globals.css sabe traducir a
      // tema claro. En ámbar esta cifra salía lavada, a 1,37:1.
      tone: balance.carriedLeft > 0 ? 'text-yellow-300' : 'text-white/40',
    })
  } else if (balance.debt > 0) {
    cifras.push({
      label: `Deuda ${year - 1}`,
      value: -balance.debt,
      hint: `Se gastaron de más en ${year - 1}. Al contrario que el arrastre, no caduca`,
      tone: 'text-red-400',
    })
  }

  cifras.push(
    {
      label: 'Aprobados',
      value: balance.approved,
      hint:
        balance.approved > 0
          ? `${formatDays(balance.taken)} ya disfrutados · ${formatDays(balance.booked)} reservados`
          : `Todavía no ha cogido ninguno de ${year}`,
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
        ? 'Ha pedido más días de los que tiene'
        : `Lo que puede pedir hoy de ${year}`,
      tone: balance.overdrawn ? 'text-red-400' : balanceTone(balance.available),
    }
  )

  // Con cinco cifras el modo compacto conserva su escalón intermedio: la rama
  // `lg:grid-cols-5` a secas se aplicaba a los dos tamaños y le quitaba al
  // compacto su `sm:grid-cols-4`, de modo que entre `sm` y `lg` —que es el
  // ancho del panel de dirección, donde se miran todos los saldos seguidos— las
  // cinco cifras se apilaban en tres filas de dos y la lista se hacía el triple
  // de larga. No se ve hoy porque nadie tiene arrastre: aparecerá el 1 de enero
  // de 2027 para todo el equipo a la vez.
  const columnas =
    cifras.length === 5
      ? big
        ? 'lg:grid-cols-5'
        : 'sm:grid-cols-3 lg:grid-cols-5'
      : big
        ? 'lg:grid-cols-4'
        : 'sm:grid-cols-4'

  return (
    <div className="space-y-2 min-w-0">
      {/* DE QUÉ AÑO ESTAMOS HABLANDO. Va primero porque sin esto ninguna de las
          cifras de abajo significa nada. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-white/40">
        <span className="uppercase tracking-wider text-white/55 font-semibold">Año {year}</span>
        <span className="text-white/25">·</span>
        <span>del 1 de enero al 31 de diciembre</span>
      </div>

      <div className={`grid grid-cols-2 ${columnas} gap-2`}>
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

      {/* EL AVISO QUE TIENE QUE VERSE. Mientras el arrastre siga vivo, con su
          fecha de caducidad delante. */}
      {balance.carriedLeft > 0 && !sinAvisoCaducidad && (
        <div className={`${warnBox} flex items-start gap-1.5`}>
          <AlarmClock className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span>
            <strong className="font-semibold">
              {propio ? 'Te caducan' : `A ${employee.name} le caducan`}{' '}
              {formatDays(balance.carriedLeft)}
            </strong>{' '}
            el {formatDayLong(balance.carriedExpiresOn)}. Sobraron de {year - 1} y son los primeros
            que se gastan: cualquier día que {propio ? 'pidas' : 'pida'} antes de esa fecha sale de
            ahí. Lo que quede sin usar el 1 de abril se pierde.
          </span>
        </div>
      )}

      {/* Ya caducó: se dice igual, porque explica por qué el saldo bajó solo */}
      {balance.carriedExpired > 0 && (
        <p className="flex items-start gap-1.5 text-[10px] text-white/35 leading-snug">
          <AlarmClock className="h-3 w-3 flex-shrink-0 mt-px" />
          <span>
            {formatDays(balance.carriedExpired)} que sobraban de {year - 1} caducaron el{' '}
            {formatDayLong(balance.carriedExpiresOn)} sin usarse. Ya no cuentan en el saldo de
            arriba.
          </span>
        </p>
      )}

      {/* La deuda del año pasado. No caduca: por eso se explica aparte */}
      {balance.debt > 0 && (
        <p className="flex items-start gap-1.5 text-[10px] text-red-300/80 leading-snug">
          <Info className="h-3 w-3 flex-shrink-0 mt-px" />
          <span>
            En {year - 1} se gastaron {formatDays(balance.debt)} de más, y esos días se descuentan
            de {year}. Al contrario que el arrastre, una deuda no caduca el 31 de marzo.
          </span>
        </p>
      )}

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

      {/* CUÁNTO SUMARÁ EL AÑO AL TERMINARLO. Es la mitad de la información:
          «tienes 9,15» sin «y este año llegarás a 18,30» invita a pedir de
          menos por si acaso. */}
      {accrual.accrues && !accrual.missingStartDate && balance.remaining > 0 && (
        <p className="flex items-start gap-1.5 text-[10px] text-white/35 leading-snug">
          <TrendingUp className="h-3 w-3 flex-shrink-0 mt-px" />
          <span>
            Antes de que acabe {year} sumará{' '}
            <span className="text-white/60">{formatDays(balance.remaining)}</span> más, hasta{' '}
            {formatDays(balance.yearTotal)} en todo el año.
          </span>
        </p>
      )}

      {/* El mes a medias: se enseña, pero NO está sumado arriba */}
      {accrual.inProgress &&
        (accrual.inProgress.counts ? (
          <div className="flex items-start gap-1.5 text-[10px] text-white/35 leading-snug">
            <Info className="h-3 w-3 flex-shrink-0 mt-px" />
            <span>
              Mes en curso: lleva {accrual.inProgress.daysElapsed} de{' '}
              {accrual.inProgress.daysInCycle} días. Sumará{' '}
              <span className="text-white/60">{formatDays(accrual.inProgress.willAdd)}</span> el{' '}
              {formatDayLong(accrual.inProgress.completesOn)}, cuando se cierre. Todavía no está
              contado arriba.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-1.5 text-[10px] text-white/35 leading-snug">
            <Info className="h-3 w-3 flex-shrink-0 mt-px" />
            <span>
              Este mes no llega a contar: solo se devengan meses trabajados enteros y este{' '}
              {accrual.endedOn ? 'termina con la baja dentro' : 'ya había empezado en el alta'}. El
              primer mes que cuenta arranca el {formatDayLong(accrual.inProgress.completesOn)}.
            </span>
          </div>
        ))}
    </div>
  )
}
