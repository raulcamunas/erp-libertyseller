'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Wallet,
  Users,
  Plus,
  Trash2,
  Check,
  CopyPlus,
  CalendarDays,
} from 'lucide-react'
import {
  TreasuryClient,
  TreasuryClientMonth,
  TreasuryExpense,
  ExpenseCategory,
  EXPENSE_CATEGORIES,
  EXPENSE_LABELS,
  EXPENSE_COLORS,
  periodKey,
  periodLabel,
  previousPeriod,
  euros,
  eurosPrecise,
  expenseInEuros,
} from '@/lib/types/treasury'

interface TreasuryBoardProps {
  clients: TreasuryClient[]
  initialMonths: TreasuryClientMonth[]
  initialExpenses: TreasuryExpense[]
  usdEur: number
  partners: number
}

// Sin ancho: quien lo use decide. Antes llevaba `w-full` de serie y en la
// fila de gastos ganaba sobre el `w-[78px]` del importe, dejando el campo
// del concepto con ancho cero — se veía solo el número.
const numInputBase =
  'bg-transparent hover:bg-white/[0.05] focus:bg-white/[0.08] border border-transparent focus:border-[#FF6600] rounded px-1.5 py-1 text-[13px] text-white text-right outline-none transition-colors tabular-nums placeholder:text-white/20'

const numInput = `w-full ${numInputBase}`

// Par validado para daltonismo sobre fondo oscuro: verde y rosa se
// separan por tono Y por luminosidad, no solo por color. Un verde/rojo
// clasico es justo el par que no distingue un deuteranope.
const CHART_INCOME = '#34D399'
const CHART_EXPENSE = '#FB7185'

export function TreasuryBoard({
  clients: initialClients,
  initialMonths,
  initialExpenses,
  usdEur,
  partners,
}: TreasuryBoardProps) {
  const supabase = createClient()
  const [clients, setClients] = useState(initialClients)
  const [months, setMonths] = useState(initialMonths)
  const [expenses, setExpenses] = useState(initialExpenses)
  const [offset, setOffset] = useState(0)
  const [busy, setBusy] = useState(false)
  const chartScrollRef = useRef<HTMLDivElement>(null)

  const period = useMemo(() => periodKey(offset), [offset])

  // ---------- Datos del mes ----------
  const monthByClient = useMemo(() => {
    const map = new Map<string, TreasuryClientMonth>()
    for (const m of months) if (m.period === period) map.set(m.client_id, m)
    return map
  }, [months, period])

  const periodExpenses = useMemo(
    () => expenses.filter((e) => e.period === period),
    [expenses, period]
  )

  const visibleClients = useMemo(
    () =>
      clients
        .filter((c) => c.is_active || monthByClient.has(c.id))
        .sort((a, b) => (a.position ?? 999) - (b.position ?? 999)),
    [clients, monthByClient]
  )

  const income = useMemo(
    () =>
      visibleClients.reduce((sum, c) => {
        const m = monthByClient.get(c.id)
        return sum + (Number(m?.fee) || 0) + (Number(m?.commission) || 0)
      }, 0),
    [visibleClients, monthByClient]
  )

  const expenseTotal = useMemo(
    () => periodExpenses.reduce((s, e) => s + expenseInEuros(e, usdEur), 0),
    [periodExpenses, usdEur]
  )

  const profit = income - expenseTotal
  const perPartner = partners > 0 ? profit / partners : profit
  const pending = useMemo(
    () =>
      visibleClients.reduce((sum, c) => {
        const m = monthByClient.get(c.id)
        if (!m || m.paid) return sum
        return sum + (Number(m.fee) || 0) + (Number(m.commission) || 0)
      }, 0),
    [visibleClients, monthByClient]
  )

  // ---------- Evolución de los últimos 12 meses ----------
  const evolution = useMemo(() => {
    const keys = Array.from({ length: 12 }, (_, i) => periodKey(offset - 11 + i))
    return keys.map((k) => {
      const inc = months
        .filter((m) => m.period === k)
        .reduce((s, m) => s + (Number(m.fee) || 0) + (Number(m.commission) || 0), 0)
      const exp = expenses
        .filter((e) => e.period === k)
        .reduce((s, e) => s + expenseInEuros(e, usdEur), 0)
      return { key: k, income: inc, expense: exp }
    })
  }, [months, expenses, offset, usdEur])

  const evoMax = Math.max(1, ...evolution.flatMap((e) => [e.income, e.expense]))

  // El mes en curso es el último de la serie: se abre mostrándolo, no
  // enseñando el de hace un año y obligando a desplazarse.
  useEffect(() => {
    const el = chartScrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [evolution])

  // ---------- Guardado ----------
  async function saveMonth(clientId: string, patch: Partial<TreasuryClientMonth>) {
    const existing = monthByClient.get(clientId)
    try {
      const { data, error } = await supabase
        .from('treasury_client_months')
        .upsert(
          {
            ...(existing ? { id: existing.id } : {}),
            client_id: clientId,
            period,
            fee: existing?.fee ?? null,
            commission: existing?.commission ?? null,
            invoice_sent: existing?.invoice_sent ?? false,
            paid: existing?.paid ?? false,
            ...patch,
          },
          { onConflict: 'client_id,period' }
        )
        .select('*')
        .single()
      if (error) throw error
      const row = data as TreasuryClientMonth
      setMonths((prev) =>
        prev.some((m) => m.id === row.id)
          ? prev.map((m) => (m.id === row.id ? row : m))
          : [...prev, row]
      )
    } catch (err) {
      console.error('Error guardando el mes del cliente:', err)
      toast.error('No se pudo guardar')
    }
  }

  async function saveClient(id: string, patch: Partial<TreasuryClient>) {
    const { error } = await supabase.from('treasury_clients').update(patch).eq('id', id)
    if (error) {
      console.error('Error guardando el cliente:', error)
      toast.error('No se pudo guardar el cliente')
      return
    }
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  /** Alta rápida: se crea la fila y se rellena en la propia tabla */
  async function addClient() {
    const nextPos = Math.max(0, ...clients.map((c) => c.position ?? 0)) + 1
    const { data, error } = await supabase
      .from('treasury_clients')
      .insert({ name: 'Nuevo cliente', is_active: true, position: nextPos })
      .select('*')
      .single()
    if (error) {
      console.error('Error creando cliente:', error)
      toast.error('No se pudo crear el cliente')
      return
    }
    setClients((prev) => [...prev, data as TreasuryClient])
    toast.success('Cliente añadido: ponle nombre y su fee')
  }

  async function saveExpense(id: string, patch: Partial<TreasuryExpense>) {
    const { error } = await supabase.from('treasury_expenses').update(patch).eq('id', id)
    if (error) {
      console.error('Error guardando gasto:', error)
      toast.error('No se pudo guardar el gasto')
      return
    }
    setExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  async function addExpense(category: ExpenseCategory) {
    const { data, error } = await supabase
      .from('treasury_expenses')
      .insert({
        period,
        category,
        concept: 'Nuevo gasto',
        amount: 0,
        currency: category === 'equipo' ? 'USD' : 'EUR',
        is_recurring: category === 'equipo' || category === 'software',
      })
      .select('*')
      .single()
    if (error) {
      console.error('Error creando gasto:', error)
      toast.error('No se pudo añadir')
      return
    }
    setExpenses((prev) => [...prev, data as TreasuryExpense])
  }

  async function removeExpense(id: string) {
    const { error } = await supabase.from('treasury_expenses').delete().eq('id', id)
    if (error) {
      toast.error('No se pudo borrar')
      return
    }
    setExpenses((prev) => prev.filter((e) => e.id !== id))
  }

  /**
   * Arranca el mes copiando lo del anterior: el fee de cada cliente activo
   * y los gastos marcados como recurrentes. Las comisiones no se copian —
   * varían cada mes y arrastrarlas induciría a error.
   */
  async function copyFromPrevious() {
    const prev = previousPeriod(period)
    setBusy(true)
    try {
      const prevMonths = months.filter((m) => m.period === prev)

      // Todo cliente activo que facturara el mes pasado entra este mes con
      // el mismo fee, incluidos los dados de alta hace poco. Se rellenan
      // también las filas que ya existan vacías: si no, un cliente al que
      // se le abrió el mes sin importe se quedaba fuera para siempre.
      // Lo que ya tiene fee puesto no se toca, y las comisiones nunca se
      // arrastran: cambian cada mes.
      const newMonths = clients
        .filter((c) => c.is_active)
        .map((c) => {
          const existing = monthByClient.get(c.id)
          if (existing && existing.fee != null) return null
          const fee = prevMonths.find((m) => m.client_id === c.id)?.fee ?? c.default_fee ?? null
          if (fee == null) return null
          return {
            ...(existing ? { id: existing.id } : {}),
            client_id: c.id,
            period,
            fee,
            commission: existing?.commission ?? null,
            invoice_sent: existing?.invoice_sent ?? false,
            paid: existing?.paid ?? false,
          }
        })
        .filter(Boolean) as Array<Record<string, unknown>>

      if (newMonths.length > 0) {
        const { data, error } = await supabase
          .from('treasury_client_months')
          .upsert(newMonths, { onConflict: 'client_id,period' })
          .select('*')
        if (error) throw error
        const rows = (data as TreasuryClientMonth[]) ?? []
        setMonths((prev2) => {
          const byId = new Map(prev2.map((m) => [m.id, m]))
          for (const r of rows) byId.set(r.id, r)
          return [...byId.values()]
        })
      }

      const already = new Set(periodExpenses.map((e) => `${e.category}|${e.concept}`))
      const newExpenses = expenses
        .filter((e) => e.period === prev && e.is_recurring)
        .filter((e) => !already.has(`${e.category}|${e.concept}`))
        .map((e) => ({
          period,
          category: e.category,
          concept: e.concept,
          amount: e.amount,
          currency: e.currency,
          is_recurring: true,
        }))

      if (newExpenses.length > 0) {
        const { data, error } = await supabase
          .from('treasury_expenses')
          .insert(newExpenses)
          .select('*')
        if (error) throw error
        setExpenses((prev2) => [...prev2, ...((data as TreasuryExpense[]) ?? [])])
      }

      const total = newMonths.length + newExpenses.length
      toast.success(
        total > 0
          ? `Traído de ${periodLabel(prev)}: ${newMonths.length} clientes, ${newExpenses.length} gastos`
          : 'No había nada nuevo que traer'
      )
    } catch (err) {
      console.error('Error copiando del mes anterior:', err)
      toast.error('No se pudo traer el mes anterior')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col h-full gap-3 min-w-0">
      {/* Navegación de mes */}
      <div className="flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-1.5 py-1">
          <button
            onClick={() => setOffset((o) => o - 1)}
            className="h-7 w-7 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <AnimatePresence mode="wait">
            <motion.span
              key={period}
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 3 }}
              transition={{ duration: 0.15 }}
              className="text-[14px] font-semibold text-white px-2 capitalize whitespace-nowrap flex items-center gap-1.5"
            >
              <CalendarDays className="h-3.5 w-3.5 text-[#FF6600]" />
              {periodLabel(period)}
            </motion.span>
          </AnimatePresence>
          <button
            onClick={() => setOffset((o) => o + 1)}
            className="h-7 w-7 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {offset !== 0 && (
            <button
              onClick={() => setOffset(0)}
              className="text-[11px] text-white/40 hover:text-white px-2 transition-colors"
            >
              Este mes
            </button>
          )}
        </div>

        <button
          onClick={copyFromPrevious}
          disabled={busy}
          title="Copiar los fees de los clientes activos y los gastos recurrentes del mes anterior"
          className="h-9 px-4 rounded-full border border-white/10 bg-white/[0.03] text-white/80 text-[13px] font-medium flex items-center gap-2 hover:bg-white/[0.06] hover:border-white/20 transition-colors disabled:opacity-50"
        >
          <CopyPlus className="h-4 w-4" />
          {busy ? 'Trayendo...' : 'Traer del mes anterior'}
        </button>
      </div>

      {/* Resultado del mes */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 flex-shrink-0">
        {[
          { icon: TrendingUp, label: 'Ingresos', value: eurosPrecise(income), tone: 'text-green-300' },
          { icon: TrendingDown, label: 'Gastos', value: eurosPrecise(expenseTotal), tone: 'text-red-300' },
          {
            icon: Wallet,
            label: 'Beneficio',
            value: eurosPrecise(profit),
            tone: profit >= 0 ? 'text-white' : 'text-red-300',
          },
          {
            icon: Users,
            label: `Para cada socio (÷${partners})`,
            value: eurosPrecise(perPartner),
            tone: 'text-[#FF6600]',
          },
        ].map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
          >
            <p className="text-[10px] uppercase tracking-wider text-white/35 flex items-center gap-1.5">
              <k.icon className="h-3 w-3" /> {k.label}
            </p>
            <p className={`font-bold text-[19px] mt-0.5 tabular-nums ${k.tone}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-3 overflow-y-auto xl:overflow-hidden">
        {/* Clientes */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between flex-shrink-0">
            <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider flex items-center gap-2">
              Clientes · {periodLabel(period)}
              <button
                type="button"
                onClick={addClient}
                title="Dar de alta un cliente nuevo"
                className="normal-case tracking-normal text-[11px] font-medium text-white/45 hover:text-white transition-colors flex items-center gap-1"
              >
                <Plus className="h-3 w-3" /> Nuevo
              </button>
            </h3>
            {income > 0 &&
              (pending > 0 ? (
                <span className="text-[11px] text-yellow-300 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
                  {eurosPrecise(pending)} sin cobrar
                </span>
              ) : (
                <span className="text-[11px] text-green-300/80 flex items-center gap-1.5">
                  <Check className="h-3 w-3" /> Todo cobrado
                </span>
              ))}
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-[12px] border-collapse">
              <thead className="sticky top-0 bg-[#0d0d0d] z-10">
                <tr>
                  <th className="text-left px-2.5 py-1.5 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10">
                    Cliente
                  </th>
                  <th className="text-center px-1 py-1.5 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 w-[44px]">
                    Día
                  </th>
                  <th className="text-right px-1 py-1.5 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 w-[92px]">
                    Fee
                  </th>
                  <th className="text-right px-1 py-1.5 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 w-[92px]">
                    Comisiones
                  </th>
                  <th className="text-right px-2 py-1.5 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 w-[92px]">
                    Total
                  </th>
                  <th className="text-center px-1 py-1.5 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 w-[62px]">
                    Enviado
                  </th>
                  <th className="text-center px-1 py-1.5 text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 w-[60px]">
                    Cobrado
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleClients.map((c) => {
                  const m = monthByClient.get(c.id)
                  const total = (Number(m?.fee) || 0) + (Number(m?.commission) || 0)
                  return (
                    <tr
                      key={c.id}
                      // Verde al marcar cobrado: al repasar el mes se ve de
                      // un vistazo lo que ya ha entrado sin leer casilla a
                      // casilla.
                      className={`border-b border-white/[0.04] group transition-colors ${
                        m?.paid
                          ? 'bg-green-500/[0.07]'
                          : m?.invoice_sent
                            ? 'bg-yellow-400/[0.06]'
                            : ''
                      }`}
                    >
                      <td className="px-1.5 py-1 text-white font-medium">
                        <input
                          defaultValue={c.name}
                          key={`name-${c.id}`}
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            if (v && v !== c.name) saveClient(c.id, { name: v })
                          }}
                          className="w-full bg-transparent hover:bg-white/[0.05] focus:bg-white/[0.08] border border-transparent focus:border-[#FF6600] rounded px-1.5 py-1 text-[12px] text-white font-medium outline-none transition-colors"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          defaultValue={c.payment_day != null ? String(c.payment_day) : ''}
                          key={`day-${c.id}`}
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            const parsed = v === '' ? null : Math.round(Number(v))
                            if (parsed !== null && (Number.isNaN(parsed) || parsed < 1 || parsed > 31)) {
                              toast.error('El día de pago va del 1 al 31')
                              e.target.value = c.payment_day != null ? String(c.payment_day) : ''
                              return
                            }
                            if ((c.payment_day ?? null) === parsed) return
                            saveClient(c.id, { payment_day: parsed })
                          }}
                          inputMode="numeric"
                          placeholder="—"
                          className="w-full bg-transparent hover:bg-white/[0.05] focus:bg-white/[0.08] border border-transparent focus:border-[#FF6600] rounded px-1 py-1 text-[11px] text-white/60 text-center outline-none transition-colors tabular-nums placeholder:text-white/20"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          defaultValue={m?.fee != null ? String(m.fee) : ''}
                          key={`fee-${c.id}-${period}`}
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            const parsed = v === '' ? null : Number(v.replace(',', '.'))
                            if (parsed !== null && Number.isNaN(parsed)) return
                            if ((m?.fee ?? null) === parsed) return
                            saveMonth(c.id, { fee: parsed })
                          }}
                          inputMode="decimal"
                          placeholder="—"
                          className={numInput}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          defaultValue={m?.commission != null ? String(m.commission) : ''}
                          key={`com-${c.id}-${period}`}
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            const parsed = v === '' ? null : Number(v.replace(',', '.'))
                            if (parsed !== null && Number.isNaN(parsed)) return
                            if ((m?.commission ?? null) === parsed) return
                            saveMonth(c.id, { commission: parsed })
                          }}
                          inputMode="decimal"
                          placeholder="—"
                          className={numInput}
                        />
                      </td>
                      <td className="px-2 py-1 text-right text-white font-semibold tabular-nums">
                        {total > 0 ? eurosPrecise(total) : <span className="text-white/20">—</span>}
                      </td>
                      <td className="px-1 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => saveMonth(c.id, { invoice_sent: !m?.invoice_sent })}
                          className={`h-5 w-5 rounded border flex items-center justify-center transition-colors mx-auto ${
                            m?.invoice_sent
                              ? 'bg-yellow-400/25 border-yellow-400/60 text-yellow-300'
                              : 'border-white/15 text-transparent hover:border-white/35'
                          }`}
                          title={m?.invoice_sent ? 'Factura enviada' : 'Marcar como enviada'}
                        >
                          <Check className="h-3 w-3" />
                        </button>
                      </td>
                      <td className="px-1 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => saveMonth(c.id, { paid: !m?.paid })}
                          className={`h-5 w-5 rounded border flex items-center justify-center transition-colors mx-auto ${
                            m?.paid
                              ? 'bg-green-500/25 border-green-500/50 text-green-300'
                              : 'border-white/15 text-transparent hover:border-white/35'
                          }`}
                          title={m?.paid ? 'Cobrado' : 'Marcar como cobrado'}
                        >
                          <Check className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="sticky bottom-0 bg-[#0d0d0d]">
                <tr>
                  <td
                    colSpan={4}
                    className="px-2.5 py-2 text-[11px] uppercase tracking-wider text-white/40 border-t border-white/10"
                  >
                    Total facturado
                  </td>
                  <td className="px-2 py-2 text-right text-green-300 font-bold tabular-nums border-t border-white/10">
                    {eurosPrecise(income)}
                  </td>
                  <td className="border-t border-white/10" />
                  <td className="border-t border-white/10" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Gastos */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between flex-shrink-0">
            <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider">
              Gastos · {periodLabel(period)}
            </h3>
            <span className="text-[11px] text-white/35">cambio USD {usdEur}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2.5">
            {EXPENSE_CATEGORIES.map((cat) => {
              const rows = periodExpenses.filter((e) => e.category === cat)
              const subtotal = rows.reduce((s, e) => s + expenseInEuros(e, usdEur), 0)
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-white/60">
                      <span
                        className="h-2 w-2 rounded-sm"
                        style={{ backgroundColor: EXPENSE_COLORS[cat] }}
                      />
                      {EXPENSE_LABELS[cat]}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] text-white/45 tabular-nums">
                        {eurosPrecise(subtotal)}
                      </span>
                      <button
                        type="button"
                        onClick={() => addExpense(cat)}
                        className="h-5 w-5 rounded flex items-center justify-center text-white/30 hover:text-white hover:bg-white/[0.08] transition-colors"
                        title={`Añadir gasto de ${EXPENSE_LABELS[cat].toLowerCase()}`}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </span>
                  </div>

                  {rows.length === 0 ? (
                    <p className="text-[10px] text-white/20 pl-3.5">Sin gastos</p>
                  ) : (
                    <div className="space-y-0.5">
                      {rows.map((e) => (
                        <div
                          key={e.id}
                          className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-white/[0.03] transition-colors"
                        >
                          <input
                            defaultValue={e.concept}
                            onBlur={(ev) => {
                              const v = ev.target.value.trim()
                              if (v && v !== e.concept) saveExpense(e.id, { concept: v })
                            }}
                            placeholder="Concepto"
                            className="flex-1 min-w-[80px] bg-transparent hover:bg-white/[0.05] focus:bg-white/[0.08] border border-transparent focus:border-[#FF6600] rounded px-1.5 py-1 text-[12px] text-white/80 outline-none transition-colors placeholder:text-white/20"
                          />
                          <input
                            defaultValue={String(e.amount)}
                            onBlur={(ev) => {
                              const parsed = Number(ev.target.value.replace(',', '.')) || 0
                              if (parsed !== Number(e.amount)) saveExpense(e.id, { amount: parsed })
                            }}
                            inputMode="decimal"
                            className={`${numInputBase} w-[74px] flex-shrink-0`}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              saveExpense(e.id, { currency: e.currency === 'EUR' ? 'USD' : 'EUR' })
                            }
                            className="w-6 flex-shrink-0 text-[11px] font-semibold text-white/45 hover:text-white transition-colors"
                            title="Cambiar divisa"
                          >
                            {e.currency === 'USD' ? '$' : '€'}
                          </button>
                          {/* En dólares se enseña también el equivalente, que es
                              lo que suma al total del mes */}
                          <span className="w-[62px] flex-shrink-0 text-right text-[10px] text-white/30 tabular-nums">
                            {e.currency === 'USD' ? eurosPrecise(expenseInEuros(e, usdEur)) : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeExpense(e.id)}
                            className="h-5 w-5 flex-shrink-0 rounded flex items-center justify-center text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="px-3 py-2 border-t border-white/10 flex items-center justify-between flex-shrink-0">
            <span className="text-[11px] uppercase tracking-wider text-white/40">
              Total gastos
            </span>
            <span className="text-red-300 font-bold tabular-nums">{eurosPrecise(expenseTotal)}</span>
          </div>
        </div>
      </div>

      {/* Evolución */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 pt-3 pb-2 flex-shrink-0">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider">
            Últimos 12 meses
          </h3>
          <span className="flex items-center gap-3 text-[10px] text-white/45">
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-[2px]"
                style={{ backgroundColor: CHART_INCOME }}
              />
              Ingresos
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-[2px]"
                style={{ backgroundColor: CHART_EXPENSE }}
              />
              Gastos
            </span>
          </span>
        </div>

        {/* Se desplaza en horizontal: con doce meses y las cifras de cada
            uno debajo no caben todos a la vez en pantallas estrechas. La
            rueda del ratón mueve de lado, que es lo que se espera aquí. */}
        <div
          ref={chartScrollRef}
          onWheel={(ev) => {
            const el = ev.currentTarget
            if (el.scrollWidth <= el.clientWidth) return
            // Solo se secuestra la rueda vertical; un trackpad que ya
            // manda desplazamiento lateral se deja en paz.
            if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
              el.scrollLeft += ev.deltaY
            }
          }}
          className="relative overflow-x-auto pb-1"
        >
          <div className="min-w-max">
            {/* Referencia superior: sin ella no hay contra qué medir alturas */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9px] text-white/25 tabular-nums w-16 flex-shrink-0">
                {euros(evoMax)}
              </span>
              <span className="flex-1 border-t border-dashed border-white/[0.07]" />
            </div>

            <div className="flex items-end gap-1 h-[104px] pl-16">
              {evolution.map((e, i) => {
                const isCurrent = e.key === period
                return (
                  <button
                    key={e.key}
                    onClick={() => setOffset((o) => o + (i - 11))}
                    className="group w-[92px] flex-shrink-0 h-full flex flex-col justify-end items-center rounded-t-md hover:bg-white/[0.03] transition-colors"
                  >
                    <span className="w-full flex items-end justify-center gap-[3px] h-full px-1">
                      <span
                        className="w-1/2 max-w-[18px] rounded-t-[4px] transition-opacity"
                        style={{
                          backgroundColor: CHART_INCOME,
                          opacity: isCurrent ? 1 : 0.75,
                          height: `${Math.max(e.income > 0 ? 3 : 0, (e.income / evoMax) * 100)}%`,
                        }}
                      />
                      <span
                        className="w-1/2 max-w-[18px] rounded-t-[4px] transition-opacity"
                        style={{
                          backgroundColor: CHART_EXPENSE,
                          opacity: isCurrent ? 1 : 0.7,
                          height: `${Math.max(e.expense > 0 ? 3 : 0, (e.expense / evoMax) * 100)}%`,
                        }}
                      />
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Línea base y, debajo, las cifras del mes */}
            <div className="border-t border-white/10 flex gap-1 pl-16 pt-1.5">
              {evolution.map((e) => {
                const isCurrent = e.key === period
                return (
                  <span
                    key={e.key}
                    className="w-[92px] flex-shrink-0 flex flex-col items-center gap-0.5"
                  >
                    <span
                      className={`text-[9px] uppercase tracking-wider ${
                        isCurrent ? 'text-white font-bold' : 'text-white/30'
                      }`}
                    >
                      {periodLabel(e.key).slice(0, 3)}
                    </span>
                    <span
                      className="text-[10px] font-semibold tabular-nums"
                      style={{ color: CHART_INCOME, opacity: e.income > 0 ? 1 : 0.3 }}
                    >
                      {euros(e.income)}
                    </span>
                    <span
                      className="text-[10px] tabular-nums"
                      style={{ color: CHART_EXPENSE, opacity: e.expense > 0 ? 0.9 : 0.3 }}
                    >
                      {euros(e.expense)}
                    </span>
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
