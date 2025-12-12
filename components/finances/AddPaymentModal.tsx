'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { X, Upload, FileText } from 'lucide-react'
import { LibertyButton } from '@/components/ui/LibertyButton'

interface AddPaymentModalProps {
  periodId: string
  onClose: () => void
  onPaymentAdded: () => void
}

export function AddPaymentModal({ periodId, onClose, onPaymentAdded }: AddPaymentModalProps) {
  const [clientName, setClientName] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const supabase = createClient()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files))
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
      // Crear el pago
      const { data: payment, error: paymentError } = await supabase
        .from('finance_payments')
        .insert([
          {
            period_id: periodId,
            client_name: clientName,
            amount: parseFloat(amount),
            description: description || null,
            payment_date: paymentDate || null
          }
        ])
        .select()
        .single()

      if (paymentError) throw paymentError

      // Subir archivos si hay
      if (files.length > 0 && payment) {
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

      onPaymentAdded()
    } catch (error: any) {
      console.error('Error creating payment:', error)
      alert('Error al crear el pago: ' + error.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-white">Agregar Pago</CardTitle>
            <CardDescription>
              Registra un nuevo pago recibido
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
            <div className="space-y-2">
              <label htmlFor="clientName" className="label-uppercase text-white/70">
                Nombre del Cliente *
              </label>
              <Input
                id="clientName"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Ej: Cliente ABC"
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
                Descripción
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notas adicionales sobre el pago..."
                className="input-glass min-h-[100px] resize-none"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="files" className="label-uppercase text-white/70">
                Adjuntar Archivos (Facturas, Recibos, etc.)
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
                {uploading ? 'Guardando...' : 'Guardar Pago'}
              </LibertyButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

