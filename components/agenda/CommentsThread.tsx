'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Send } from 'lucide-react'
import { AppointmentComment, colorForAgent } from '@/lib/types/appointments'
import { UserProfile } from '@/lib/supabase/get-user-profile'

interface CommentsThreadProps {
  appointmentId: string
  currentUser: UserProfile
}

function initials(name: string | null | undefined, fallback: string) {
  const source = (name || fallback || '?').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

const COMMENT_SELECT = `
  *,
  author:profiles!appointment_comments_author_id_fkey(id, full_name, email, calendar_color)
`

export function CommentsThread({ appointmentId, currentUser }: CommentsThreadProps) {
  const supabase = createClient()
  const [comments, setComments] = useState<AppointmentComment[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    supabase
      .from('appointment_comments')
      .select(COMMENT_SELECT)
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (active) setComments((data as AppointmentComment[]) || [])
        setLoading(false)
      })

    const channel = supabase
      .channel(`appointment_comments_${appointmentId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'appointment_comments',
          filter: `appointment_id=eq.${appointmentId}`,
        },
        async (payload) => {
          const { data } = await supabase
            .from('appointment_comments')
            .select(COMMENT_SELECT)
            .eq('id', (payload.new as { id: string }).id)
            .single()
          if (!data) return
          const comment = data as AppointmentComment
          setComments((prev) =>
            prev.some((c) => c.id === comment.id) ? prev : [...prev, comment]
          )
        }
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [appointmentId, supabase])

  async function handleSend() {
    const body = text.trim()
    if (!body) return
    setSending(true)
    try {
      const { error } = await supabase
        .from('appointment_comments')
        .insert({ appointment_id: appointmentId, author_id: currentUser.id, body })
      if (error) throw error
      setText('')
    } catch (err) {
      console.error('Error enviando comentario:', err)
      toast.error('No se pudo enviar el comentario')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-2">
      {loading ? (
        <p className="text-[11px] text-white/30">Cargando comentarios...</p>
      ) : comments.length === 0 ? (
        <p className="text-[11px] text-white/30">Todavía no hay comentarios.</p>
      ) : (
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {comments.map((c) => {
            const color = colorForAgent(c.author_id, c.author?.calendar_color)
            return (
              <div key={c.id} className="flex items-start gap-2">
                <span
                  className="h-5 w-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: color }}
                >
                  {initials(c.author?.full_name, c.author?.email || '')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[11px] font-semibold text-white">
                      {c.author?.full_name || c.author?.email || 'Alguien'}
                    </span>
                    <span className="text-[10px] text-white/30">
                      {format(new Date(c.created_at), "d MMM, HH:mm", { locale: es })}
                    </span>
                  </div>
                  <p className="text-[12px] text-white/75 whitespace-pre-wrap break-words leading-snug">
                    {c.body}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-1.5 pt-0.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="Añadir un comentario..."
          className="flex-1 bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-[#FF6600] transition-colors"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !text.trim()}
          className="h-7 w-7 rounded-lg bg-[#FF6600] flex items-center justify-center text-white disabled:opacity-40 flex-shrink-0"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
