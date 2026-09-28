'use client'

import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { FileText, UploadCloud, X, Download } from 'lucide-react'
import { CrmDocument, CrmDocumentKind } from '@/lib/types/crm'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toMadrid } from '@/lib/timezone'

interface CrmDocumentsProps {
  clientId: string
  kind: CrmDocumentKind
  label: string
  documents: CrmDocument[]
  onChange: (docs: CrmDocument[]) => void
  /**
   * ¿Puede subir y quitar PDFs, o solo abrir los que ya hay?
   *
   * Solo dirección. `crm_documents` se quedó FUERA del permiso suelto
   * 'equipo-comercial' a propósito (ver la 212): el bucket 'crm-documents' es
   * público desde la 080, así que el `file_url` que guarda esa tabla abre el
   * contrato sin pedir nada. Quien solo supervisa llamadas no necesita eso.
   *
   * Efecto práctico, para que no se diagnostique como un fallo: a quien entra
   * por el permiso suelto la RLS le devuelve CERO filas —sin error, porque una
   * política filtra, no revienta— y esta sección le sale con el texto de
   * «sin subir». Y el INSERT y el DELETE del bucket siguen pidiendo
   * is_admin_or_partner (080), así que enseñarle el recuadro de «arrastra un
   * PDF» sería prometer una subida que acaba en «No se pudo subir el
   * documento» y nada más. Se esconde.
   */
  puedeEditar: boolean
}

function isPdf(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

function prettySize(bytes: number | null) {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

/**
 * Ranura de documentos de un tipo concreto (propuesta o contrato).
 * Admite varios ficheros por si se manda una propuesta revisada.
 */
export function CrmDocuments({
  clientId,
  kind,
  label,
  documents,
  onChange,
  puedeEditar,
}: CrmDocumentsProps) {
  const supabase = createClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)

  const mine = documents.filter((d) => d.kind === kind)

  async function uploadFile(file: File) {
    if (!isPdf(file)) {
      toast.error('Solo se admiten PDFs')
      return
    }
    setUploading(true)
    try {
      const path = `${clientId}/${kind}/${Date.now()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('crm-documents')
        .upload(path, file, { contentType: 'application/pdf' })
      if (uploadError) throw uploadError

      const {
        data: { publicUrl },
      } = supabase.storage.from('crm-documents').getPublicUrl(path)

      const { data, error } = await supabase
        .from('crm_documents')
        .insert({
          client_id: clientId,
          kind,
          file_url: publicUrl,
          file_path: path,
          filename: file.name,
          file_size: file.size,
        })
        .select('*')
        .single()
      if (error) throw error

      onChange([...documents, data as CrmDocument])
      toast.success(`${label} subida`)
    } catch (err) {
      console.error('Error subiendo documento:', err)
      toast.error('No se pudo subir el documento')
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove(doc: CrmDocument) {
    try {
      const { error } = await supabase.from('crm_documents').delete().eq('id', doc.id)
      if (error) throw error
      if (doc.file_path) {
        await supabase.storage.from('crm-documents').remove([doc.file_path])
      }
      onChange(documents.filter((d) => d.id !== doc.id))
    } catch (err) {
      console.error('Error borrando documento:', err)
      toast.error('No se pudo borrar el documento')
    }
  }

  return (
    <div className="space-y-1.5">
      {mine.map((doc) => (
        <div
          key={doc.id}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2"
        >
          <FileText className="h-3.5 w-3.5 text-[#FF6600] flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-white truncate">{doc.filename}</p>
            <p className="text-[10px] text-white/30">
              {format(toMadrid(doc.created_at), "d MMM yyyy", { locale: es })}
              {doc.file_size ? ` · ${prettySize(doc.file_size)}` : ''}
            </p>
          </div>
          <a
            href={doc.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/40 hover:text-white transition-colors flex-shrink-0"
            title="Abrir PDF"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
          {/* Quitar un PDF es DELETE en el bucket, y eso sigue siendo de
              dirección (080). Quien solo supervisa lo abre, no lo retira. */}
          {puedeEditar && (
            <button
              type="button"
              onClick={() => handleRemove(doc)}
              className="text-white/30 hover:text-red-400 transition-colors flex-shrink-0"
              title="Quitar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}

      {/* EL RECUADRO DE SUBIR SOLO PARA DIRECCIÓN. El bucket 'crm-documents'
          pide is_admin_or_partner para el INSERT (080) y el permiso suelto
          'equipo-comercial' no lo cambia: enseñarlo sería prometer una subida
          que acaba en «No se pudo subir el documento» y nada más. */}
      {puedeEditar && (
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
        className="rounded-lg border border-dashed px-3 py-2.5 flex items-center justify-center gap-2 text-center cursor-pointer transition-colors"
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) uploadFile(file)
            e.target.value = ''
          }}
        />
        <UploadCloud
          className={`h-4 w-4 flex-shrink-0 ${isDragging ? 'text-[#FF6600]' : 'text-white/30'}`}
        />
        <span className="text-[11px] text-white/45">
          {uploading ? 'Subiendo...' : `Arrastra el PDF de ${label.toLowerCase()} o selecciónalo`}
        </span>
      </motion.div>
      )}

      {/* Sin el recuadro y sin ningún PDF, la sección quedaría en blanco y
          parecería que está cargando todavía. */}
      {!puedeEditar && mine.length === 0 && (
        <p className="text-[11px] text-white/25">
          Sin {label.toLowerCase()} subida. Subirla es de dirección.
        </p>
      )}
    </div>
  )
}
