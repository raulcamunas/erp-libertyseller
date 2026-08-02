'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ImagePlus, X, FileText, ExternalLink, Loader2 } from 'lucide-react'
import { UserProfile } from '@/lib/supabase/get-user-profile'

export interface AppointmentAttachment {
  id: string
  appointment_id: string
  uploaded_by: string | null
  file_url: string
  file_path: string | null
  filename: string
  mime_type: string | null
  file_size: number | null
  created_at: string
}

interface AttachmentsFieldProps {
  appointmentId: string
  currentUser: UserProfile
  canEdit: boolean
}

const ACCEPTED = /^(image\/(png|jpe?g|webp|gif|heic)|application\/pdf)$/i

function isAllowed(file: File) {
  if (ACCEPTED.test(file.type)) return true
  return /\.(png|jpe?g|webp|gif|heic|pdf)$/i.test(file.name)
}

/**
 * Capturas de la conversación. No todas las citas salen de una llamada:
 * las que se cierran por correo o WhatsApp no tienen grabación, pero sí
 * una captura que vale igual como prueba.
 */
export function AttachmentsField({
  appointmentId,
  currentUser,
  canEdit,
}: AttachmentsFieldProps) {
  const supabase = createClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<AppointmentAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    supabase
      .from('appointment_attachments')
      .select('*')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!active) return
        setItems((data as AppointmentAttachment[]) || [])
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [appointmentId, supabase])

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => {
      if (isAllowed(f)) return true
      toast.error(`${f.name}: solo se admiten imágenes o PDF`)
      return false
    })
    if (list.length === 0) return

    setUploading(true)
    try {
      for (const file of list) {
        const path = `${appointmentId}/${Date.now()}-${file.name}`
        const { error: uploadError } = await supabase.storage
          .from('appointment-attachments')
          .upload(path, file)
        if (uploadError) throw uploadError

        const {
          data: { publicUrl },
        } = supabase.storage.from('appointment-attachments').getPublicUrl(path)

        const { data, error } = await supabase
          .from('appointment_attachments')
          .insert({
            appointment_id: appointmentId,
            uploaded_by: currentUser.id,
            file_url: publicUrl,
            file_path: path,
            filename: file.name,
            mime_type: file.type || null,
            file_size: file.size,
          })
          .select('*')
          .single()
        if (error) throw error

        setItems((prev) => [...prev, data as AppointmentAttachment])
      }
      toast.success(list.length === 1 ? 'Captura subida' : `${list.length} archivos subidos`)
    } catch (err) {
      console.error('Error subiendo adjunto:', err)
      toast.error('No se pudo subir el archivo')
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove(item: AppointmentAttachment) {
    try {
      const { error } = await supabase
        .from('appointment_attachments')
        .delete()
        .eq('id', item.id)
      if (error) throw error
      if (item.file_path) {
        await supabase.storage.from('appointment-attachments').remove([item.file_path])
      }
      setItems((prev) => prev.filter((i) => i.id !== item.id))
    } catch (err) {
      console.error('Error borrando adjunto:', err)
      toast.error('No se pudo borrar el archivo')
    }
  }

  if (loading) {
    return (
      <p className="text-[11px] text-white/25 flex items-center gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" /> Cargando adjuntos...
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          <AnimatePresence initial={false}>
            {items.map((item) => {
              const isImage = (item.mime_type ?? '').startsWith('image/')
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="group relative aspect-square rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden"
                >
                  <a
                    href={item.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block h-full w-full"
                    title={item.filename}
                  >
                    {isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.file_url}
                        alt={item.filename}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="h-full w-full flex flex-col items-center justify-center gap-1 px-1">
                        <FileText className="h-5 w-5 text-[#FF6600]" />
                        <span className="text-[9px] text-white/45 text-center line-clamp-2 break-all">
                          {item.filename}
                        </span>
                      </span>
                    )}
                    <span className="absolute inset-0 bg-black/0 group-hover:bg-black/45 transition-colors flex items-center justify-center">
                      <ExternalLink className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </span>
                  </a>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => handleRemove(item)}
                      className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/70 flex items-center justify-center text-white/70 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Quitar"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {!canEdit ? (
        items.length === 0 && <p className="text-[11px] text-white/25">Sin capturas</p>
      ) : (
        <motion.div
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files)
          }}
          onPaste={(e) => {
            // Pegar directamente con Ctrl+V: es como llega una captura
            const files = Array.from(e.clipboardData?.files ?? [])
            if (files.length) {
              e.preventDefault()
              uploadFiles(files)
            }
          }}
          onClick={() => inputRef.current?.click()}
          tabIndex={0}
          animate={{
            borderColor: isDragging ? '#FF6600' : 'rgba(255,255,255,0.12)',
            backgroundColor: isDragging ? 'rgba(255,102,0,0.08)' : 'rgba(255,255,255,0.02)',
          }}
          className="rounded-xl border border-dashed px-3 py-3 flex flex-col items-center justify-center gap-1 text-center cursor-pointer transition-colors outline-none focus:border-[#FF6600]"
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.png,.jpg,.jpeg,.webp,.heic,.pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) uploadFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <ImagePlus
            className={`h-4 w-4 ${isDragging ? 'text-[#FF6600]' : 'text-white/30'}`}
          />
          <p className="text-[11px] text-white/45">
            {uploading ? (
              'Subiendo...'
            ) : (
              <>
                Arrastra o pega una captura, o{' '}
                <span className="text-[#FF6600] font-medium">selecciónala</span>
              </>
            )}
          </p>
          <p className="text-[10px] text-white/25">
            Para citas cerradas por correo o WhatsApp
          </p>
        </motion.div>
      )}
    </div>
  )
}
