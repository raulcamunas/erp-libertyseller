'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { Sparkles, ChevronDown, RefreshCw, AlertCircle } from 'lucide-react'
import { TranscriptionStatus } from '@/lib/types/appointments'

interface TranscriptionPanelProps {
  appointmentId: string
  hasRecording: boolean
  transcription: string | null
  transcriptionSummary: string | null
  transcriptionStatus: TranscriptionStatus
  transcriptionError: string | null
  canEdit: boolean
  onUpdated: (fields: {
    transcription: string | null
    transcription_summary: string | null
    transcription_status: TranscriptionStatus
    transcription_error: string | null
  }) => void
}

/** Renderiza el resumen simple (líneas con **Título:**) como texto formateado */
function SummaryText({ text }: { text: string }) {
  const lines = text.split('\n').filter(Boolean)
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const match = line.match(/^\*\*(.+?):\*\*\s*(.*)$/)
        if (match) {
          return (
            <p key={i} className="text-[12px] text-white/80 leading-snug">
              <span className="font-semibold text-white">{match[1]}:</span> {match[2]}
            </p>
          )
        }
        return (
          <p key={i} className="text-[12px] text-white/70 leading-snug">
            {line}
          </p>
        )
      })}
    </div>
  )
}

export function TranscriptionPanel({
  appointmentId,
  hasRecording,
  transcription,
  transcriptionSummary,
  transcriptionStatus,
  transcriptionError,
  canEdit,
  onUpdated,
}: TranscriptionPanelProps) {
  const [loading, setLoading] = useState(false)
  const [showFull, setShowFull] = useState(false)

  if (!hasRecording) return null

  async function handleTranscribe() {
    setLoading(true)
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/transcribe`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al transcribir')
      onUpdated({
        transcription: data.transcription ?? null,
        transcription_summary: data.transcription_summary ?? null,
        transcription_status: 'done',
        transcription_error: null,
      })
      toast.success('Transcripción lista')
    } catch (err) {
      console.error('Error transcribiendo:', err)
      onUpdated({
        transcription,
        transcription_summary: transcriptionSummary,
        transcription_status: 'error',
        transcription_error: (err as Error).message,
      })
      toast.error('No se pudo transcribir la grabación')
    } finally {
      setLoading(false)
    }
  }

  const isBusy = loading || transcriptionStatus === 'processing'
  const hasResult = transcriptionStatus === 'done' && (transcription || transcriptionSummary)

  return (
    <div className="pt-2">
      <div className="text-[12px] text-white/40 mb-1.5 flex items-center gap-1.5">
        <Sparkles className="h-3 w-3" /> Transcripción con IA
      </div>

      {!hasResult && (
        <button
          type="button"
          onClick={handleTranscribe}
          disabled={isBusy || !canEdit}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-3 py-2.5 text-xs font-medium text-white/70 hover:border-[#FF6600]/40 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isBusy ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#FF6600]" />
              Transcribiendo con IA... puede tardar 1-2 min
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5 text-[#FF6600]" />
              Transcribir y resumir con IA
            </>
          )}
        </button>
      )}

      {transcriptionStatus === 'error' && transcriptionError && (
        <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-300/90">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          {transcriptionError}
        </div>
      )}

      {hasResult && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2"
        >
          {transcriptionSummary && <SummaryText text={transcriptionSummary} />}

          {transcription && (
            <div className="pt-1 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={() => setShowFull((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-white/40 hover:text-white/70 transition-colors mt-1.5"
              >
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${showFull ? 'rotate-180' : ''}`}
                />
                {showFull ? 'Ocultar transcripción completa' : 'Ver transcripción completa'}
              </button>
              <AnimatePresence>
                {showFull && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="text-[11px] text-white/55 leading-relaxed whitespace-pre-wrap mt-2 max-h-56 overflow-y-auto"
                  >
                    {transcription}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={handleTranscribe}
              disabled={isBusy}
              className="flex items-center gap-1 text-[11px] text-white/40 hover:text-white/70 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${isBusy ? 'animate-spin' : ''}`} />
              Volver a transcribir
            </button>
          )}
        </motion.div>
      )}
    </div>
  )
}
