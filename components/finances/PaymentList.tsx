'use client'

import { FinancePayment } from '@/lib/types/finances'
import { Trash2, FileText, Download, Edit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { useState } from 'react'
import { EditPaymentModal } from './EditPaymentModal'

interface PaymentListProps {
  payments: FinancePayment[]
  periodId?: string
  onPaymentDeleted: () => void
  onPaymentUpdated?: () => void
}

export function PaymentList({ payments, periodId, onPaymentDeleted, onPaymentUpdated }: PaymentListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingPayment, setEditingPayment] = useState<FinancePayment | null>(null)
  const supabase = createClient()

  const handleDelete = async (paymentId: string) => {
    if (!confirm('¿Estás seguro de eliminar este pago?')) return

    setDeletingId(paymentId)
    try {
      // SE COMPRUEBA EL ERROR A PROPÓSITO.
      //
      // QUÉ PROBLEMA RESUELVE: supabase-js NO LANZA cuando una escritura falla.
      // Devuelve `{ error }` y sigue. Comprobado contra la base real: un
      // `.update()` contra una tabla que no existe no tira excepción, el fallo
      // solo aparece si se desestructura `{ error }`.
      //
      // O sea que el `catch` de abajo NUNCA se ejecutaba por un fallo de la
      // base: si el borrado no salía —una política RLS que no deja, la fila ya
      // no está, la red— se llamaba a onPaymentDeleted() igual, sin un mensaje
      // y sin una línea en ningún log. Esto es tesorería: el pago sigue en la
      // base y nadie se entera de que el borrado no ocurrió.
      //
      // NO SE TOCA LO QUE VE LA PERSONA: no se añade ningún aviso nuevo y se
      // sigue llamando a onPaymentDeleted() pase lo que pase, que es lo que
      // hace hoy (y como esa recarga vuelve a leer de la base, el pago que no
      // se borró reaparece solo). Lo único que cambia es que ahora queda
      // rastro. Cortar el flujo o avisar en pantalla sí sería un cambio
      // visible, y eso lo decide una persona.
      const { error } = await supabase
        .from('finance_payments')
        .delete()
        .eq('id', paymentId)

      if (error) {
        console.error(`No se pudo borrar el pago ${paymentId} de finance_payments:`, error)
      }

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

  const handlePaymentUpdated = () => {
    if (onPaymentUpdated) {
      onPaymentUpdated()
    }
    setEditingPayment(null)
  }

  return (
    <>
      <div className="space-y-3">
        {payments.map((payment) => {
          const isExpense = payment.type === 'expense'
          const isConversion = payment.type === 'conversion'
          
          return (
            <div
              key={payment.id}
              className="glass-card-light p-3 border border-white/10 rounded-xl cursor-pointer hover:border-white/20 transition-colors"
              onClick={() => setEditingPayment(payment)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    {isConversion ? (
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                        CONVERTIDO
                      </span>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        isExpense 
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30' 
                          : 'bg-green-500/20 text-green-400 border border-green-500/30'
                      }`}>
                        {isExpense ? 'GASTO' : 'INGRESO'}
                      </span>
                    )}
                    {payment.external_id && (
                      <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded" title="Sincronizado desde Wise">
                        🏦
                      </span>
                    )}
                    <h3 className="text-sm font-semibold text-white">
                      {payment.client_name}
                    </h3>
                    <span className={`text-base font-bold ml-auto ${
                      isConversion ? 'text-yellow-400' : isExpense ? 'text-red-400' : 'text-green-400'
                    }`}>
                      {isConversion ? '' : isExpense ? '-' : '+'}€{Number(payment.amount).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  
                  {payment.description && (
                    <p className="text-white/60 text-xs mb-1.5">{payment.description}</p>
                  )}

                  {payment.payment_date && (
                    <p className="text-white/40 text-xs mb-1.5">
                      {format(new Date(payment.payment_date), 'dd/MM/yyyy', { locale: es })}
                    </p>
                  )}

                  {/* Attachments */}
                  {payment.attachments && payment.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {payment.attachments.map((attachment) => (
                        <a
                          key={attachment.id}
                          href={attachment.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1.5 px-2 py-1 bg-white/[0.05] border border-white/10 rounded text-xs text-white/60 hover:text-white hover:bg-white/[0.1] transition-colors"
                        >
                          <FileText className="h-3 w-3" />
                          <span className="truncate max-w-[120px]">{attachment.file_name}</span>
                          <Download className="h-2.5 w-2.5" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingPayment(payment)
                    }}
                    className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 h-8 w-8"
                    title="Editar"
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(payment.id)
                    }}
                    disabled={deletingId === payment.id}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-8 w-8"
                    title="Eliminar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {editingPayment && (
        <EditPaymentModal
          payment={editingPayment}
          onClose={() => setEditingPayment(null)}
          onPaymentUpdated={handlePaymentUpdated}
        />
      )}
    </>
  )
}

