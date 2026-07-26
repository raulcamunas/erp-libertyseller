'use client'

import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Music, UploadCloud, X } from 'lucide-react'

interface AudioRecordingFieldProps {
  appointmentId: string
  recordingUrl: string | null
  recordingFilename: string | null
  canEdit: boolean
  /** Se llama tras subir/quitar el audio, para reflejarlo en el resto del ERP */
  onChange: (url: string | null, filename: string | null) => void
}

const ACCEPTED_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
]

function isAudioFile(file: File) {
  if (ACCEPTED_TYPES.includes(file.type)) return true
  return /\.(mp3|wav|m4a|ogg|mp4)$/i.test(file.name)
}

export function AudioRecordingField({
  appointmentId,
  recordingUrl,
  recordingFilename,
  canEdit,
  onChange,
}: AudioRecordingFieldProps) {
  const supabase = createClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)

  async function uploadFile(file: File) {
    if (!isAudioFile(file)) {
      toast.error('Solo se admiten archivos de audio (mp3, wav, m4a...)')
      return
    }
    setUploading(true)
    try {
      const path = `${appointmentId}/${Date.now()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('call-recordings')
        .upload(path, file)
      if (uploadError) throw uploadError

      const {
        data: { publicUrl },
      } = supabase.storage.from('call-recordings').getPublicUrl(path)

      const { error: updateError } = await supabase
        .from('appointments')
        .update({ recording_url: publicUrl, recording_filename: file.name })
        .eq('id', appointmentId)
      if (updateError) throw updateError

      onChange(publicUrl, file.name)
      toast.success('Grabación subida')
    } catch (err) {
      console.error('Error subiendo grabación:', err)
      toast.error('No se pudo subir la grabación')
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove() {
    setUploading(true)
    try {
      const { error } = await supabase
        .from('appointments')
        .update({ recording_url: null, recording_filename: null })
        .eq('id', appointmentId)
      if (error) throw error
      onChange(null, null)
    } catch (err) {
      console.error('Error quitando grabación:', err)
      toast.error('No se pudo quitar la grabación')
    } finally {
      setUploading(false)
    }
  }

  if (recordingUrl) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-white/60 flex items-center gap-1.5 truncate">
            <Music className="h-3.5 w-3.5 text-[#FF6600] flex-shrink-0" />
            <span className="truncate">{recordingFilename || 'Grabación'}</span>
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={uploading}
              className="text-white/30 hover:text-red-400 transition-colors flex-shrink-0"
              title="Quitar grabación"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio controls src={recordingUrl} className="w-full h-9" />
      </div>
    )
  }

  if (!canEdit) {
    return <p className="text-xs text-white/30">Sin grabación</p>
  }

  return (
    <motion.div
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragging(false)
        const file = e.dataTransfer.files?.[0]
        if (file) uploadFile(file)
      }}
      onClick={() => inputRef.current?.click()}
      animate={{
        borderColor: isDragging ? '#FF6600' : 'rgba(255,255,255,0.12)',
        backgroundColor: isDragging ? 'rgba(255,102,0,0.08)' : 'rgba(255,255,255,0.02)',
      }}
      className="rounded-xl border border-dashed p-4 flex flex-col items-center justify-center gap-1.5 text-center cursor-pointer transition-colors"
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) uploadFile(file)
          e.target.value = ''
        }}
      />
      <UploadCloud className={`h-5 w-5 ${isDragging ? 'text-[#FF6600]' : 'text-white/30'}`} />
      <p className="text-xs text-white/50">
        {uploading ? (
          'Subiendo...'
        ) : (
          <>
            Arrastra un audio aquí o{' '}
            <span className="text-[#FF6600] font-medium">selecciónalo</span>
          </>
        )}
      </p>
      <p className="text-[10px] text-white/25">MP3, WAV, M4A</p>
    </motion.div>
  )
}
