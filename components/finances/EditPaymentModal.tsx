'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FinancePayment } from '@/lib/types/finances'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { X, Upload, FileText, Trash2, Download } from 'lucide-react'
import { LibertyButton } from '@/components/ui/LibertyButton'

interface EditPaymentModalProps {
  payment: FinancePayment
  onClose: () => void
  onPaymentUpdated: () => void
}

export function EditPaymentModal({ payment, onClose, onPaymentUpdated }: EditPaymentModalProps) {
  const [clientName, setClientName] = useState(payment.client_name)
  const [amount, setAmount] = useState(String(payment.amount))
  const [type, setType] = useState<'income' | 'expense'>(payment.type)
  const [description, setDescription] = useState(payment.description || '')
  const [paymentDate, setPaymentDate] = useState(
    payment.payment_date ? new Date(payment.payment_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
  )
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null)
  const [currentAttachments, setCurrentAttachments] = useState(payment.attachments || [])
  const supabase = createClient()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files))
    }
  }

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!confirm('¿Estás seguro de eliminar este archivo?')) return

    setDeletingAttachmentId(attachmentId)
    try {
      // Obtener el attachment para saber el nombre del archivo
      const { data: attachment } = await supabase
        .from('finance_attachments')
        .select('*')
        .eq('id', attachmentId)
        .single()

      if (attachment) {
        // Extraer el path del archivo desde la URL
        const url = new URL(attachment.file_url)
        const pathParts = url.pathname.split('/')
        const fileName = pathParts[pathParts.length - 2] + '/' + pathParts[pathParts.length - 1]

        // Eliminar del storage
        await supabase.storage
          .from('finance-attachments')
          .remove([fileName])

        // Eliminar de la base de datos
        await supabase
          .from('finance_attachments')
          .delete()
          .eq('id', attachmentId)
        
        // Actualizar la lista de attachments localmente
        setCurrentAttachments(prev => prev.filter(a => a.id !== attachmentId))
      }
    } catch (error: any) {
      console.error('Error deleting attachment:', error)
      alert('Error al eliminar el archivo: ' + error.message)
    } finally {
      setDeletingAttachmentId(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clientName || !amount) {
      alert('Por favor completa los campos requeridos')
      return
    }

    setUploading(true)
    try {
      // Actualizar el pago
      const { error: paymentError } = await supabase
        .from('finance_payments')
        .update({
          client_name: clientName,
          amount: parseFloat(amount),
          type: type,
          description: description || null,
          payment_date: paymentDate || null
        })
        .eq('id', payment.id)

      if (paymentError) throw paymentError

      // Subir archivos nuevos si hay
      if (files.length > 0) {
        for (const file of files) {
          const fileExt = file.name.split('.').pop()
          const fileName = `${payment.id}/${Date.now()}.${fileExt}`
          
          const { error: uploadError } = await supabase.storage
            .from('finance-attachments')
            .upload(fileName, file)

          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage
              .from('finance-attachments')
              .getPublicUrl(fileName)

            await supabase
              .from('finance_attachments')
              .insert([
                {
                  payment_id: payment.id,
                  file_name: file.name,
                  file_url: publicUrl,
                  file_type: file.type,
                  file_size: file.size
                }
              ])
          }
        }
      }

      onPaymentUpdated()
      onClose()
    } catch (error: any) {
      console.error('Error updating payment:', error)
      alert('Error al actualizar el pago: ' + error.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-white">Editar Movimiento</CardTitle>
            <CardDescription>
              Modifica los datos del pago o adjunta archivos
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Tipo de Movimiento */}
            <div className="space-y-2">
              <label className="label-uppercase text-white/70">
                Tipo de Movimiento *
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setType('income')}
                  className={`px-4 py-3 rounded-xl border transition-all ${
                    type === 'income'
                      ? 'bg-green-500/[0.2] border-green-500 text-green-400'
                      : 'bg-white/[0.05] border-white/10 text-white/70 hover:bg-white/[0.1]'
                  }`}
                >
                  <div className="font-semibold">Ingreso</div>
                  <div className="text-xs opacity-70">Dinero recibido</div>
                </button>
                <button
                  type="button"
                  onClick={() => setType('expense')}
                  className={`px-4 py-3 rounded-xl border transition-all ${
                    type === 'expense'
                      ? 'bg-red-500/[0.2] border-red-500 text-red-400'
                      : 'bg-white/[0.05] border-white/10 text-white/70 hover:bg-white/[0.1]'
                  }`}
                >
                  <div className="font-semibold">Gasto</div>
                  <div className="text-xs opacity-70">Dinero gastado</div>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="clientName" className="label-uppercase text-white/70">
                {type === 'income' ? 'Nombre del Cliente' : 'Concepto'} *
              </label>
              <Input
                id="clientName"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder={type === 'income' ? 'Ej: Cliente ABC' : 'Ej: Servicios, Materiales, etc.'}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="amount" className="label-uppercase text-white/70">
                  Monto (€) *
                </label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="paymentDate" className="label-uppercase text-white/70">
                  Fecha de Pago
                </label>
                <Input
                  id="paymentDate"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="description" className="label-uppercase text-white/70">
                Descripción / Anotaciones
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notas adicionales sobre el pago..."
                className="input-glass min-h-[100px] resize-none"
              />
            </div>

            {/* Archivos existentes */}
            {currentAttachments.length > 0 && (
              <div className="space-y-2">
                <label className="label-uppercase text-white/70">
                  Archivos Adjuntos Existentes
                </label>
                <div className="space-y-2">
                  {currentAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center justify-between px-3 py-2 bg-white/[0.05] border border-white/10 rounded-lg"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <FileText className="h-4 w-4 text-white/60 flex-shrink-0" />
                        <a
                          href={attachment.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-white/70 hover:text-white truncate"
                        >
                          <span className="truncate">{attachment.file_name}</span>
                          <Download className="h-3 w-3 flex-shrink-0" />
                        </a>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteAttachment(attachment.id)}
                        disabled={deletingAttachmentId === attachment.id}
                        className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10 flex-shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="files" className="label-uppercase text-white/70">
                Adjuntar Nuevos Archivos (Facturas, Recibos, etc.)
              </label>
              <div className="flex items-center gap-4">
                <label
                  htmlFor="file-upload"
                  className="flex items-center gap-2 px-4 py-2 bg-white/[0.05] border border-white/10 rounded-xl cursor-pointer hover:bg-white/[0.1] transition-colors"
                >
                  <Upload className="h-4 w-4" />
                  <span className="text-sm text-white/70">Seleccionar archivos</span>
                </label>
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
                {files.length > 0 && (
                  <div className="flex items-center gap-2 text-sm text-white/50">
                    <FileText className="h-4 w-4" />
                    {files.length} archivo(s) seleccionado(s)
                  </div>
                )}
              </div>
              {files.length > 0 && (
                <div className="mt-2 space-y-1">
                  {files.map((file, index) => (
                    <div key={index} className="text-xs text-white/50 flex items-center gap-2">
                      <FileText className="h-3 w-3" />
                      {file.name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-4 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1"
              >
                Cancelar
              </Button>
              <LibertyButton
                type="submit"
                disabled={uploading}
                className="flex-1"
              >
                {uploading ? 'Guardando...' : 'Guardar Cambios'}
              </LibertyButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

