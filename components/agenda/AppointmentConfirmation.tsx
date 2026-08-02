'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toMadrid } from '@/lib/timezone'
import {
  Check,
  Video,
  User,
  Building2,
  Mail,
  Phone,
  Copy,
  X,
  CalendarCheck,
} from 'lucide-react'
import { AppointmentWithPeople, colorForAgent } from '@/lib/types/appointments'

interface AppointmentConfirmationProps {
  appointment: AppointmentWithPeople
  onClose: () => void
}

const MONTHS_SHORT = [
  'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
  'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC',
]

function initials(name: string | null | undefined, fallback: string) {
  const source = (name || fallback || '?').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/**
 * Resumen de la cita recién agendada, pensado para capturarlo y mandarlo
 * al grupo de WhatsApp: formato vertical, mucho contraste y todo lo que
 * el equipo necesita saber sin tener que abrir el ERP.
 */
export function AppointmentConfirmation({
  appointment,
  onClose,
}: AppointmentConfirmationProps) {
  const [copied, setCopied] = useState(false)
  const start = toMadrid(appointment.start_time)
  const end = toMadrid(appointment.end_time)

  const weekday = format(start, 'EEEE', { locale: es })
  const dayLabel = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}`
  const timeRange = `${format(start, 'HH:mm')} – ${format(end, 'HH:mm')}`

  const closer =
    appointment.assigned_closer?.full_name ||
    appointment.comercial?.full_name ||
    appointment.comercial?.email ||
    '—'
  const closerPerson = appointment.assigned_closer ?? appointment.comercial ?? null

  /** Mismo resumen en texto plano, por si prefieren pegarlo que capturarlo */
  function copySummary() {
    const lines = [
      '✅ CITA AGENDADA',
      '',
      `📅 ${dayLabel} ${start.getDate()} de ${format(start, 'MMMM', { locale: es })} · ${timeRange} (hora de España)`,
      `👤 ${appointment.lead_name}`,
      appointment.lead_company ? `🏢 ${appointment.lead_company}` : null,
      appointment.lead_phone ? `📞 ${appointment.lead_phone}` : null,
      appointment.lead_email ? `✉️ ${appointment.lead_email}` : null,
      `🎯 Closer: ${closer}`,
      appointment.google_meet_link ? `🎥 ${appointment.google_meet_link}` : null,
    ].filter(Boolean)

    navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    toast.success('Resumen copiado, listo para pegar')
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className="relative w-full max-w-[440px] max-h-[92vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#0d0d0d] shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 h-7 w-7 rounded-full flex items-center justify-center text-white/35 hover:text-white hover:bg-white/[0.08] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Cabecera con el visto: lo primero que se ve en la captura */}
        <div className="relative overflow-hidden px-6 pt-7 pb-5 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 h-52 w-52 rounded-full bg-[#FF6600]/25 blur-3xl"
          />
          <div className="relative">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.08, type: 'spring', stiffness: 260, damping: 18 }}
              className="mx-auto h-14 w-14 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] flex items-center justify-center shadow-[0_8px_28px_-6px_rgba(255,102,0,0.7)]"
            >
              <Check className="h-7 w-7 text-white" strokeWidth={3} />
            </motion.div>
            <h2 className="text-white text-[22px] font-bold mt-3 leading-tight">
              Cita agendada
            </h2>
            <p className="text-[13px] text-white/45 mt-0.5">
              Sesión de Consultoría Estratégica Amazon
            </p>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-[#FF6600] uppercase mt-2">
              Liberty Seller
            </p>
          </div>
        </div>

        {/* Fecha, al estilo de la confirmación de Google */}
        <div className="mx-5 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5 flex items-center gap-4">
          <div className="flex-shrink-0 text-center w-[52px]">
            <p className="text-white text-[30px] font-bold leading-none">
              {start.getDate()}
            </p>
            <p className="text-[11px] font-semibold tracking-wider text-[#FF6600] mt-0.5">
              {MONTHS_SHORT[start.getMonth()]}
            </p>
          </div>
          <div className="w-px self-stretch bg-white/10" />
          <div className="min-w-0">
            <p className="text-white text-[15px] font-semibold capitalize">{dayLabel}</p>
            <p className="text-white/70 text-[15px] font-semibold tabular-nums">
              {timeRange}
            </p>
            <p className="text-[11px] text-white/35 mt-0.5">
              (GMT+02:00) Hora de España · Madrid
            </p>
          </div>
        </div>

        {/* Datos del lead */}
        <div className="mx-5 mt-3 rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/[0.06]">
          {[
            { icon: User, label: 'Contacto', value: appointment.lead_name },
            { icon: Building2, label: 'Empresa', value: appointment.lead_company },
            { icon: Phone, label: 'Teléfono', value: appointment.lead_phone },
            { icon: Mail, label: 'Email', value: appointment.lead_email },
          ]
            .filter((r) => r.value)
            .map((r) => (
              <div key={r.label} className="flex items-center gap-3 px-4 py-2.5">
                <r.icon className="h-3.5 w-3.5 text-white/30 flex-shrink-0" />
                <span className="text-[11px] text-white/35 w-[62px] flex-shrink-0">
                  {r.label}
                </span>
                <span className="text-[13px] text-white font-medium truncate">
                  {r.value}
                </span>
              </div>
            ))}

          <div className="flex items-center gap-3 px-4 py-2.5">
            <CalendarCheck className="h-3.5 w-3.5 text-white/30 flex-shrink-0" />
            <span className="text-[11px] text-white/35 w-[62px] flex-shrink-0">Closer</span>
            <span className="flex items-center gap-1.5 min-w-0">
              {closerPerson && (
                <span
                  className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                  style={{
                    backgroundColor: colorForAgent(
                      closerPerson.id,
                      closerPerson.calendar_color
                    ),
                  }}
                >
                  {initials(closerPerson.full_name, closerPerson.email || '')}
                </span>
              )}
              <span className="text-[13px] text-white font-medium truncate">{closer}</span>
            </span>
          </div>
        </div>

        {/* Meet */}
        {appointment.google_meet_link && (
          <div className="mx-5 mt-3">
            <a
              href={appointment.google_meet_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 hover:border-white/25 transition-colors"
            >
              <Video className="h-4 w-4 text-[#FF6600] flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[13px] text-white font-medium">Google Meet</p>
                <p className="text-[11px] text-white/35 truncate">
                  {appointment.google_meet_link.replace('https://', '')}
                </p>
              </div>
            </a>
          </div>
        )}

        {/* Acciones: fuera de la parte que se captura */}
        <div className="flex items-center gap-2 px-5 py-4 mt-1">
          <button
            type="button"
            onClick={copySummary}
            className="flex-1 h-10 rounded-full border border-white/12 bg-white/[0.04] text-white/80 text-[13px] font-medium flex items-center justify-center gap-2 hover:bg-white/[0.08] hover:text-white transition-colors"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-green-400" /> Copiado
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" /> Copiar para WhatsApp
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-5 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[13px] font-semibold shadow-[0_4px_16px_-6px_rgba(255,102,0,0.6)]"
          >
            Hecho
          </button>
        </div>
      </motion.div>
    </div>
  )
}
