'use client'

import { FinancePayment } from '@/lib/types/finances'
import { Trash2, FileText, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { useState } from 'react'

interface PaymentListProps {
  payments: FinancePayment[]
  periodId?: string
  onPaymentDeleted: () => void
}

export function PaymentList({ payments, periodId, onPaymentDeleted }: PaymentListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const supabase = createClient()

  const handleDelete = async (paymentId: string) => {
    if (!confirm('¿Estás seguro de eliminar este pago?')) return

    setDeletingId(paymentId)
    try {
      await supabase
        .from('finance_payments')
        .delete()
        .eq('id', paymentId)
      
      onPaymentDeleted()
    } catch (error) {
      console.error('Error deleting payment:', error)
      alert('Error al eliminar el pago')
    } finally {
      setDeletingId(null)
    }
  }

  if (payments.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-white/50">No hay pagos registrados para este mes</p>
        <p className="text-white/30 text-sm mt-2">
          Haz clic en "Agregar Pago" para comenzar
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {payments.map((payment) => (
        <div
          key={payment.id}
          className="glass-card-light p-4 border border-white/10 rounded-xl"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-lg font-semibold text-white">
                  {payment.client_name}
                </h3>
                <span className="text-xl font-bold text-[#FF6600]">
                  €{Number(payment.amount).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              
              {payment.description && (
                <p className="text-white/70 text-sm mb-2">{payment.description}</p>
              )}

              {payment.payment_date && (
                <p className="text-white/50 text-xs">
                  Fecha: {format(new Date(payment.payment_date), 'dd/MM/yyyy', { locale: es })}
                </p>
              )}

              {/* Attachments */}
              {payment.attachments && payment.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {payment.attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={attachment.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.05] border border-white/10 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/[0.1] transition-colors"
                    >
                      <FileText className="h-4 w-4" />
                      <span className="truncate max-w-[150px]">{attachment.file_name}</span>
                      <Download className="h-3 w-3" />
                    </a>
                  ))}
                </div>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleDelete(payment.id)}
              disabled={deletingId === payment.id}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

