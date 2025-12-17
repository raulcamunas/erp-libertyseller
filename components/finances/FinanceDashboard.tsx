'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FinancePeriod, FinancePayment, MonthlySummary } from '@/lib/types/finances'
import { MonthSelector } from './MonthSelector'
import { PaymentList } from './PaymentList'
import { AddPaymentModal } from './AddPaymentModal'
import { FinanceChart } from './FinanceChart'
import { Plus, TrendingUp, TrendingDown, DollarSign, Wallet, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export function FinanceDashboard() {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [periods, setPeriods] = useState<FinancePeriod[]>([])
  const [payments, setPayments] = useState<FinancePayment[]>([])
  const [monthlySummaries, setMonthlySummaries] = useState<MonthlySummary[]>([])
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [wiseBalance, setWiseBalance] = useState<number | null>(null)
  const [wiseBalances, setWiseBalances] = useState<Array<{ currency: string; amount: number }>>([])
  const [wiseBalanceLoading, setWiseBalanceLoading] = useState(false)
  const supabase = createClient()

  const currentPeriod = periods.find(
    p => p.year === selectedYear && p.month === selectedMonth
  )

  useEffect(() => {
    loadData()
    loadWiseBalance()
  }, [selectedYear, selectedMonth])

  const loadWiseBalance = async () => {
    setWiseBalanceLoading(true)
    try {
      const response = await fetch('/api/finance/balance')
      const data = await response.json()
      
      console.log('Wise balance response:', data)
      console.log('Response status:', response.status)
      console.log('Data success:', data.success)
      console.log('Data balances:', data.balances)
      console.log('Data balance:', data.balance)
      
      if (data.success && data.balances && Array.isArray(data.balances) && data.balances.length > 0) {
        console.log('Setting balances:', data.balances)
        setWiseBalances(data.balances)
        // Mantener compatibilidad: usar el balance en EUR si existe
        const eurBalance = data.balances.find((b: any) => b.currency === 'EUR')
        setWiseBalance(eurBalance ? Number(eurBalance.amount) : null)
      } else if (data.success && data.balance !== null && data.balance !== undefined && data.balance > 0) {
        // Fallback para compatibilidad
        console.log('Using fallback balance:', data.balance)
        setWiseBalance(Number(data.balance))
        setWiseBalances([{ currency: 'EUR', amount: Number(data.balance) }])
      } else {
        console.warn('Wise balance no disponible:', {
          success: data.success,
          error: data.error,
          message: data.message,
          balances: data.balances,
          balance: data.balance
        })
        setWiseBalance(null)
        setWiseBalances([])
      }
    } catch (error) {
      console.error('Error loading Wise balance:', error)
      setWiseBalance(null)
      setWiseBalances([])
    } finally {
      setWiseBalanceLoading(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      console.log(`Iniciando sincronización con Wise para ${selectedYear}-${selectedMonth}...`)
      const response = await fetch('/api/finance/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          year: selectedYear,
          month: selectedMonth
        })
      })
      
      const data = await response.json()
      console.log('Respuesta de sincronización:', data)
      
      if (data.success) {
        // Recargar datos después de sincronizar
        // Forzar recarga completa de los datos
        setLoading(true)
        await loadData()
        await loadWiseBalance()
        setLoading(false)
      } else {
        console.error('Error en sincronización:', data.error)
        alert(`❌ Error al sincronizar: ${data.message || data.error}\n\n${data.errors ? data.errors.join('\n') : ''}`)
      }
    } catch (error: any) {
      console.error('Error syncing:', error)
      alert(`❌ Error al sincronizar: ${error.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const loadData = async () => {
    setLoading(true)
    try {
      // Cargar o crear periodo actual
      let { data: periodData } = await supabase
        .from('finance_periods')
        .select('*')
        .eq('year', selectedYear)
        .eq('month', selectedMonth)
        .single()

      if (!periodData) {
        const { data: newPeriod } = await supabase
          .from('finance_periods')
          .insert([{ year: selectedYear, month: selectedMonth }])
          .select()
          .single()
        periodData = newPeriod
      }

      // Cargar todos los periodos para el gráfico
      const { data: allPeriods } = await supabase
        .from('finance_periods')
        .select('*')
        .order('year', { ascending: false })
        .order('month', { ascending: false })
        .limit(12)

      setPeriods(allPeriods || [])

      // Cargar pagos del periodo actual
      if (periodData) {
        const { data: paymentsData, error: paymentsError } = await supabase
          .from('finance_payments')
          .select(`
            *,
            attachments:finance_attachments(*)
          `)
          .eq('period_id', periodData.id)
          .order('payment_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })

        if (paymentsError) {
          console.error('Error cargando pagos:', paymentsError)
        }

        // Ordenar manualmente por fecha de pago (más recientes primero)
        const sortedPayments = (paymentsData || []).sort((a, b) => {
          const dateA = a.payment_date ? new Date(a.payment_date).getTime() : 0
          const dateB = b.payment_date ? new Date(b.payment_date).getTime() : 0
          if (dateB !== dateA) return dateB - dateA
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        })

        setPayments(sortedPayments)
        console.log(`Cargados ${sortedPayments.length} pagos para ${selectedYear}-${selectedMonth}`)
      }

      // Calcular resúmenes mensuales
      if (allPeriods && allPeriods.length > 0) {
        const summaries: MonthlySummary[] = []
        
        for (const period of allPeriods) {
          const { data: periodPayments } = await supabase
            .from('finance_payments')
            .select('amount, type')
            .eq('period_id', period.id)

          const totalIncome = periodPayments
            ?.filter(p => p.type === 'income')
            .reduce((sum, p) => sum + Number(p.amount), 0) || 0
          
          const totalExpenses = periodPayments
            ?.filter(p => p.type === 'expense')
            .reduce((sum, p) => sum + Number(p.amount), 0) || 0
          
          const profit = totalIncome - totalExpenses

          summaries.push({
            month: format(new Date(period.year, period.month - 1), 'MMMM', { locale: es }),
            year: period.year,
            monthNumber: period.month,
            totalIncome,
            totalExpenses,
            profit
          })
        }

        setMonthlySummaries(summaries.reverse())
      }
    } catch (error) {
      console.error('Error loading finance data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePaymentAdded = () => {
    loadData()
    setIsAddModalOpen(false)
  }

  const handlePaymentDeleted = () => {
    loadData()
  }

  const totalIncome = payments
    .filter(p => p.type === 'income')
    .reduce((sum, p) => sum + Number(p.amount), 0)
  
  const totalExpenses = payments
    .filter(p => p.type === 'expense')
    .reduce((sum, p) => sum + Number(p.amount), 0)
  
  const profit = totalIncome - totalExpenses

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-white/50">Cargando...</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header con botón de sincronización */}
      <div className="flex items-center justify-end">
        <Button 
          onClick={handleSync} 
          disabled={syncing}
          className="gap-2"
          variant="glass"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Sincronizando...' : 'Sincronizar Banco'}
        </Button>
      </div>

      {/* Stats Cards - Compactas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-white/70">
              Ingresos del Mes
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-xl font-bold text-green-400">
              €{totalIncome.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-white/70">
              Gastos del Mes
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-xl font-bold text-red-400">
              €{totalExpenses.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-white/70">
              Beneficio Neto
            </CardTitle>
            <DollarSign className={`h-4 w-4 ${profit >= 0 ? 'text-green-600' : 'text-red-400'}`} />
          </CardHeader>
          <CardContent className="pt-0">
            <div className={`text-xl font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-400'}`}>
              €{profit.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-white/70">
              Tesorería (Cash)
            </CardTitle>
            <Wallet className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent className="pt-0">
            {wiseBalanceLoading ? (
              <div className="text-white/50 text-sm">Cargando...</div>
            ) : wiseBalances.length > 0 ? (
              <div className="space-y-1.5">
                {wiseBalances.map((balance, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="text-sm text-white/60 font-medium">{balance.currency}:</span>
                    <span className="text-xl font-bold text-blue-400">
                      {balance.currency === 'EUR' ? '€' : balance.currency === 'USD' ? '$' : balance.currency === 'GBP' ? '£' : balance.currency + ' '}
                      {balance.amount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            ) : wiseBalance !== null ? (
              <div className="text-xl font-bold text-blue-400">
                €{wiseBalance.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            ) : (
              <div className="text-white/50 text-sm">No configurado</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Layout: Gráfico arriba, Lista de movimientos y selector abajo */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Gráfico - Ocupa todo el ancho arriba */}
        <div className="lg:col-span-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-white">Evolución Financiera</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <FinanceChart data={monthlySummaries} />
            </CardContent>
          </Card>
        </div>

        {/* Lista de Movimientos - Ocupa 3 columnas a la izquierda */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm text-white">
                Movimientos de {format(new Date(selectedYear, selectedMonth - 1), 'MMMM yyyy', { locale: es })}
              </CardTitle>
              <Button onClick={() => setIsAddModalOpen(true)} size="sm" className="gap-2 h-8">
                <Plus className="h-3 w-3" />
                Agregar
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              <PaymentList
                payments={payments}
                periodId={currentPeriod?.id}
                onPaymentDeleted={handlePaymentDeleted}
                onPaymentUpdated={handlePaymentAdded}
              />
            </CardContent>
          </Card>
        </div>

        {/* Selector de Mes - Abajo a la derecha, 2 columnas */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-white">Seleccionar Mes</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <MonthSelector
                selectedYear={selectedYear}
                selectedMonth={selectedMonth}
                onYearChange={setSelectedYear}
                onMonthChange={setSelectedMonth}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add Payment Modal */}
      {isAddModalOpen && currentPeriod && (
        <AddPaymentModal
          periodId={currentPeriod.id}
          onClose={() => setIsAddModalOpen(false)}
          onPaymentAdded={handlePaymentAdded}
        />
      )}
    </div>
  )
}

