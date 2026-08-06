'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Check, Loader2, UserX, X } from 'lucide-react'
import {
  NOTICE_DAYS,
  formatDayRange,
  formatDays,
  noticeDaysAhead,
  type VacationBalance,
  type VacationEmployee,
  type VacationRequest,
} from '@/lib/types/vacations'
import {
  cancelledBy,
  cardShell,
  dangerButton,
  fieldInput,
  ghostButton,
  primaryButton,
  registeredBy,
  resolvedBy,
  statusLabel,
  statusPill,
} from './shared'

/**
 * UNA PETICIÓN, con todo lo que hace falta para decidir sobre ella.
 *
 * La usan la cola del admin y la lista del empleado; cambia lo que se puede
 * hacer, no lo que se ve. Quien aprueba necesita en la misma tarjeta: de quién
 * es, qué días, cuántos LABORABLES consume, si entró fuera de plazo y cómo le
 * queda el saldo. Si para saber cualquiera de esas cosas hay que abrir otra
 * pantalla, se acaba aprobando sin mirar.
 *
 * EL RECHAZO PIDE MOTIVO Y NO ES OPCIONAL —lo obliga también el CHECK de la
 * migración 116—. «Me lo denegaron y no sé por qué» es exactamente lo que este
 * módulo viene a quitar de en medio.
 */

export interface PeticionCardProps {
  request: VacationRequest
  employee: VacationEmployee
  /** Nombre de cada perfil citado en created_by / resolved_by */
  people: Record<string, string>
  /** El saldo de esa persona, para poder decir cómo queda si se aprueba */
  balance?: VacationBalance | null
  today: string
  /** Enseña el nombre de la persona (cola del admin). En «Mis vacaciones» sobra */
  showName?: boolean
  isAdmin: boolean
  busy?: boolean
  onApprove?: () => void
  onReject?: (reason: string) => void
  onCancel?: () => void
}

export function PeticionCard({
  request,
  employee,
  people,
  balance,
  today,
  showName = false,
  isAdmin,
  busy = false,
  onApprove,
  onReject,
  onCancel,
}: PeticionCardProps) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  const pendiente = request.status === 'pendiente'
  const author = registeredBy(request, people, employee.user_id)
  const resolver = resolvedBy(request, people)
  const canceller = cancelledBy(request, people)
  const notice = noticeDaysAhead(request.start_date, today)

  // Quien la pidió solo puede retirarla mientras espera respuesta; un admin
  // también puede anular unas ya aprobadas, porque los planes cambian y si no
  // esos días se quedarían gastados para siempre.
  const puedeRetirar = onCancel && (pendiente || (isAdmin && request.status === 'aprobada'))

  function confirmReject() {
    const texto = reason.trim()
    if (!texto || !onReject) return
    onReject(texto)
    setRejecting(false)
    setReason('')
  }

  return (
    <div className={`${cardShell} p-3 min-w-0`}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          {showName && (
            <p className="text-[13px] font-semibold text-white truncate flex items-center gap-1.5">
              {employee.name}
              {/* Sin cuenta en el ERP: importa porque explica por qué la
                  petición la ha tecleado otra persona y por qué esa persona no
                  puede pedirlas ella misma. */}
              {!employee.user_id && (
                <span
                  title="No tiene cuenta en el ERP: no puede pedirlas ella misma"
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-white/40 border border-white/15 rounded-full px-1.5 py-0.5"
                >
                  <UserX className="h-2.5 w-2.5" />
                  Sin cuenta
                </span>
              )}
            </p>
          )}
          <p className={`${showName ? 'text-[11px] text-white/55' : 'text-[13px] text-white'} truncate`}>
            {formatDayRange(request.start_date, request.end_date)}
          </p>
        </div>

        <span className={statusPill(request.status)}>{statusLabel(request.status)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-white/45">
        <span className="text-white/70 font-medium tabular-nums">
          {formatDays(request.working_days)} laborables
        </span>

        {pendiente && balance && (
          <span
            className={balance.available < 0 ? 'text-red-400' : 'text-white/45'}
            title="Las peticiones pendientes ya restan del saldo, así que aprobarla no cambia este número"
          >
            {balance.available < 0
              ? `Se pasa: le faltan ${formatDays(Math.abs(balance.available))}`
              : `Le quedarían ${formatDays(balance.available)}`}
          </span>
        )}

        {author && <span>Registrada por {author}</span>}
      </div>

      {/* FUERA DE PLAZO: avisa, nunca bloquea. La regla existe para poder
          organizar el trabajo, no para que una urgencia familiar no se pueda
          ni pedir; y como la aprueba una persona, la decisión ya es suya. */}
      {request.late_notice && pendiente && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-yellow-300 leading-snug">
          <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span>
            Fuera de plazo:{' '}
            {notice < 0
              ? 'estas fechas ya han empezado'
              : `se pidió con ${notice} ${notice === 1 ? 'día' : 'días'} de antelación y hay que avisar con ${NOTICE_DAYS}`}
            .
          </span>
        </p>
      )}

      {request.reason && (
        <p className="mt-2 text-[11px] text-white/50 leading-snug break-words">
          «{request.reason}»
        </p>
      )}

      {request.rejection_reason && (
        <p className="mt-2 text-[11px] text-red-300 leading-snug break-words">
          Motivo del rechazo: {request.rejection_reason}
        </p>
      )}

      {/* LAS DOS FIRMAS, cuando hay dos. Unas vacaciones concedidas por Mario y
          anuladas después por Raúl enseñan las dos líneas: quién las dio y
          quién las quitó. Con una sola columna para las dos cosas, la primera
          desaparecía en cuanto alguien anulaba. */}
      {!pendiente && resolver && (
        <p className="mt-1.5 text-[10px] text-white/30">
          {request.status === 'rechazada'
            ? 'Rechazada'
            : request.status === 'cancelada'
              ? 'Estaba aprobada'
              : 'Aprobada'}{' '}
          por {resolver}
        </p>
      )}
      {request.status === 'cancelada' && canceller && (
        <p className="mt-0.5 text-[10px] text-white/30">Retirada por {canceller}</p>
      )}

      {/* Acciones */}
      {(pendiente && isAdmin && (onApprove || onReject)) || puedeRetirar ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {pendiente && isAdmin && onApprove && (
            <button type="button" onClick={onApprove} disabled={busy} className={primaryButton}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Aprobar
            </button>
          )}
          {pendiente && isAdmin && onReject && !rejecting && (
            <button
              type="button"
              onClick={() => setRejecting(true)}
              disabled={busy}
              className={dangerButton}
            >
              <X className="h-3 w-3" />
              Rechazar
            </button>
          )}
          {puedeRetirar && (
            <button type="button" onClick={onCancel} disabled={busy} className={ghostButton}>
              {request.status === 'aprobada' ? 'Anular' : 'Retirar'}
            </button>
          )}
        </div>
      ) : null}

      {rejecting && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 space-y-1.5"
        >
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Por qué se rechaza. Lo va a leer quien lo pidió."
            className={`${fieldInput} resize-none`}
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={confirmReject}
              disabled={busy || reason.trim() === ''}
              className={dangerButton}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Rechazar
            </button>
            <button
              type="button"
              onClick={() => {
                setRejecting(false)
                setReason('')
              }}
              className={ghostButton}
            >
              Cancelar
            </button>
            {reason.trim() === '' && (
              <span className="text-[10px] text-white/35">El motivo es obligatorio</span>
            )}
          </div>
        </motion.div>
      )}
    </div>
  )
}
