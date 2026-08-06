'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Clock,
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
import {
  cellsForPeriod,
  type EmployeeMonthCell,
  type EmployeesCostResponse,
  type EmployeesMonthTotalWire,
} from '@/lib/employees/payload'
import { EmployeesMonthBlock } from './EmployeesMonthBlock'

interface TreasuryBoardProps {
  clients: TreasuryClient[]
  initialMonths: TreasuryClientMonth[]
  initialExpenses: TreasuryExpense[]
  /**
   * Lo que cuesta el equipo, ya calculado por el servidor para una ventana
   * ancha de meses. No son filas de gasto: los sueldos salieron de
   * treasury_expenses en la migración 112 y ahora viven en Control empleados.
   */
  initialEmployeeCost: EmployeesCostResponse
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

/**
 * Si esta pantalla sabe pintar esa categoría. Fuera del componente para que
 * los useMemo que la usan no dependan de una función nueva en cada render.
 */
function knownCategory(category: string): boolean {
  return (EXPENSE_CATEGORIES as string[]).includes(category)
}

export function TreasuryBoard({
  clients: initialClients,
  initialMonths,
  initialExpenses,
  initialEmployeeCost,
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

  // ---------- Coste del equipo ----------
  // Cacheado por mes: el servidor manda una ventana ancha y solo se pide al
  // API si alguien se va a un mes que no venía. Se guarda por clave de mes y
  // no como respuesta entera porque las respuestas llegan a trozos.
  const [employeeTotals, setEmployeeTotals] = useState<Record<string, EmployeesMonthTotalWire>>(
    () => Object.fromEntries(initialEmployeeCost.totals.map((t) => [t.period, t]))
  )
  const [employeeCells, setEmployeeCells] = useState<Record<string, EmployeeMonthCell[]>>(() =>
    Object.fromEntries(
      initialEmployeeCost.periods.map((p) => [p, cellsForPeriod(initialEmployeeCost, p)])
    )
  )
  const [employeesLoading, setEmployeesLoading] = useState(false)
  const employeeDetail = initialEmployeeCost.detail

  // ---------- Datos del mes ----------
  const monthByClient = useMemo(() => {
    const map = new Map<string, TreasuryClientMonth>()
    for (const m of months) if (m.period === period) map.set(m.client_id, m)
    return map
  }, [months, period])

  /**
   * UNA FILA CON UNA CATEGORÍA QUE LA INTERFAZ YA NO CONOCE NO PUEDE SUMAR EN
   * SILENCIO.
   * El panel de gastos pinta recorriendo EXPENSE_CATEGORIES, así que una fila
   * con otra categoría —las viejas de 'equipo', por ejemplo— no aparece en
   * ninguna sección. Si además entrara en el total, esos euros estarían
   * contados sin que nadie pueda verlos, y en el caso de los sueldos estarían
   * contados DOS VECES: una por la fila y otra por el bloque «Empleados al
   * mes», que es calculado.
   *
   * La migración 112 se lleva esas filas de la base, pero el orden entre
   * desplegar el código y pegar el SQL no lo fuerza nadie, y el «deshacer» de
   * esa misma migración las devuelve. Así que la separación se hace también
   * aquí: lo conocido suma y se pinta, y lo que quede fuera se enseña como
   * aviso con su importe. Descartarlo callando sería perder dinero en vez de
   * duplicarlo, que no es mejor.
   */
  const periodExpenses = useMemo(
    () => expenses.filter((e) => e.period === period && knownCategory(e.category)),
    [expenses, period]
  )

  /** Filas del mes con una categoría que esta interfaz ya no sabe pintar */
  const strayExpenses = useMemo(
    () => expenses.filter((e) => e.period === period && !knownCategory(e.category)),
    [expenses, period]
  )

  /** Y las de cualquier otro mes, para no decir que está limpio cuando no lo está */
  const strayOtherMonths = useMemo(
    () => expenses.filter((e) => e.period !== period && !knownCategory(e.category)).length,
    [expenses, period]
  )

  const strayTotal = useMemo(
    () => strayExpenses.reduce((s, e) => s + expenseInEuros(e, usdEur), 0),
    [strayExpenses, usdEur]
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

  /**
   * LOS SUELDOS ENTRAN AL TOTAL POR AQUÍ, Y SOLO POR AQUÍ.
   * No hay filas de gasto que los representen —la migración 112 las sacó de
   * treasury_expenses y prohibió la categoría en la propia base—, así que este
   * sumando es la única vía. Y si alguna fila de sueldo sobreviviera, no puede
   * colarse por el otro lado: `periodExpenses` ya solo admite las categorías
   * que esta pantalla sabe pintar.
   */
  const employeesEur = employeeTotals[period]?.eur ?? 0

  const expenseTotal = useMemo(
    () => periodExpenses.reduce((s, e) => s + expenseInEuros(e, usdEur), 0) + employeesEur,
    [periodExpenses, usdEur, employeesEur]
  )

  const profit = income - expenseTotal
  const perPartner = partners > 0 ? profit / partners : profit

  /**
   * CUÁNDO LAS TRES CIFRAS DE ABAJO NO SON DEFINITIVAS.
   * Dos casos, y el segundo es el que se colaba: además de que falte el coste
   * del equipo por calcular, está el mes EN CURSO con gente que cobra por
   * horas. Ahí el sueldo que se suma es lo devengado hasta hoy —el día 6 de
   * agosto, cuatro días de trabajo— mientras que los ingresos del mes ya están
   * apuntados enteros. El beneficio y el reparto entre socios salen inflados y
   * van bajando solos según el equipo ficha. No es un error de cálculo, es un
   * mes a medias, y hay que decirlo en vez de enseñarlo como un cierre.
   */
  const employeesAccruing = employeeTotals[period]?.accruing ?? 0
  /** Falta el dato: la cifra está CORTA y por eso se apaga entera */
  const employeesPartial = !(period in employeeTotals)
  /** El dato está, pero el mes sigue corriendo: la cifra es cierta y va a moverse */
  const accruingNote =
    !employeesPartial && employeesAccruing > 0
      ? `${employeesAccruing === 1 ? 'una persona cobra' : `${employeesAccruing} personas cobran`} por horas`
      : ''
  const accruingTitle = `El mes no ha terminado: ${accruingNote} y su sueldo sube cada día que trabaja, mientras que los ingresos ya están apuntados enteros. El gasto va a crecer y el beneficio a bajar.`
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
  // OJO: esta gráfica vuelve a sumar los gastos por su cuenta, NO reutiliza
  // expenseTotal. Es el sitio que se olvida al tocar el total del mes: si los
  // sueldos entraran solo arriba, la tarjeta de «Gastos» cuadraría y las doce
  // barras de aquí abajo dirían otra cosa.
  const evolution = useMemo(() => {
    const keys = Array.from({ length: 12 }, (_, i) => periodKey(offset - 11 + i))
    return keys.map((k) => {
      const inc = months
        .filter((m) => m.period === k)
        .reduce((s, m) => s + (Number(m.fee) || 0) + (Number(m.commission) || 0), 0)
      // Mismo filtro por categoría que arriba, y por el mismo motivo: si aquí
      // entrara una fila que la interfaz no pinta, las doce barras dirían una
      // cosa y la tarjeta de «Gastos» otra.
      const exp =
        expenses
          .filter((e) => e.period === k && knownCategory(e.category))
          .reduce((s, e) => s + expenseInEuros(e, usdEur), 0) + (employeeTotals[k]?.eur ?? 0)
      return { key: k, income: inc, expense: exp }
    })
  }, [months, expenses, offset, usdEur, employeeTotals])

  const evoMax = Math.max(1, ...evolution.flatMap((e) => [e.income, e.expense]))

  /**
   * Los meses de la gráfica que todavía no tienen coste de equipo calculado.
   * Mientras haya alguno, las cifras de arriba están incompletas y hay que
   * decirlo: un total que se queda corto sin avisar es peor que uno que tarda.
   */
  const employeesMissing = useMemo(
    () => evolution.map((e) => e.key).filter((k) => !(k in employeeTotals)),
    [evolution, employeeTotals]
  )

  // Se piden de golpe los meses que falten. Van seguidos —son una ventana de
  // doce— así que un solo tramo los cubre todos.
  useEffect(() => {
    if (employeesMissing.length === 0) return
    const from = employeesMissing[0]
    const last = employeesMissing[employeesMissing.length - 1]
    const keys = Array.from({ length: 12 }, (_, i) => periodKey(offset - 11 + i))
    // `count`, no `months`: ahí arriba `months` son las filas de facturación
    // de los clientes y confundirlas costaría un rato.
    const count = keys.indexOf(last) - keys.indexOf(from) + 1

    let cancelled = false
    setEmployeesLoading(true)
    fetch(`/api/employees/monthly-cost?from=${from}&months=${count}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((res: EmployeesCostResponse) => {
        if (cancelled) return
        setEmployeeTotals((prev) => {
          const next = { ...prev }
          for (const t of res.totals) next[t.period] = t
          return next
        })
        if (res.detail) {
          setEmployeeCells((prev) => {
            const next = { ...prev }
            for (const p of res.periods) next[p] = cellsForPeriod(res, p)
            return next
          })
        }
      })
      .catch((err) => {
        console.error('Error trayendo el coste del equipo:', err)
        toast.error('No se ha podido calcular el coste del equipo de esos meses')
      })
      .finally(() => {
        if (!cancelled) setEmployeesLoading(false)
      })

    return () => {
      cancelled = true
    }
    // `offset` entra para poder reconstruir la ventana; `employeesMissing` ya
    // cambia con él y con lo que haya en caché.
  }, [employeesMissing, offset])

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
        // Ya no hay rama para 'equipo': los sueldos no se apuntan aquí. Si
        // vuelve a hacer falta, no es esto lo que hay que tocar sino Control
        // empleados, o el mes se contaría dos veces.
        currency: 'EUR',
        is_recurring: category === 'software',
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
      // No se filtra por «activo»: esa marca viene del Excel y no es de
      // fiar — hay clientes marcados como inactivos que facturaron el mes
      // pasado, y se quedaban fuera. Lo que decide es el hecho: si te
      // facturó el mes anterior, sigue siendo cliente este mes.
      const newMonths = clients
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

      // Ya no arrastra sueldos: las filas de «equipo» eran todas recurrentes y
      // este botón las recreaba cada mes. Salieron de la tabla en la migración
      // 112 y la categoría dejó de existir en el CHECK, así que aquí no queda
      // nada de equipo que copiar. El bloque «Empleados al mes» no necesita
      // que nadie le traiga nada: se calcula solo para cualquier mes.
      const already = new Set(periodExpenses.map((e) => `${e.category}|${e.concept}`))
      const newExpenses = expenses
        // El filtro por categoría no es de adorno: si quedara viva alguna fila
        // de sueldos —todas eran recurrentes—, este botón la recrearía cada
        // mes y volvería a llenar la tabla de lo que la 112 vino a sacar.
        .filter((e) => e.period === prev && e.is_recurring && knownCategory(e.category))
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
          {
            icon: TrendingUp,
            label: 'Ingresos',
            value: eurosPrecise(income),
            tone: 'text-green-300',
            // Los ingresos no dependen del coste del equipo: nunca quedan a medias
            partial: false,
            note: '',
          },
          {
            icon: TrendingDown,
            label: 'Gastos',
            value: eurosPrecise(expenseTotal),
            tone: 'text-red-300',
            partial: employeesPartial,
            note: accruingNote && `sin cerrar: ${accruingNote}`,
          },
          {
            icon: Wallet,
            label: 'Beneficio',
            value: eurosPrecise(profit),
            tone: profit >= 0 ? 'text-white' : 'text-red-300',
            partial: employeesPartial,
            note: accruingNote && 'sin cerrar: bajará según fichen',
          },
          {
            icon: Users,
            label: `Para cada socio (÷${partners})`,
            value: eurosPrecise(perPartner),
            tone: 'text-[#FF6600]',
            partial: employeesPartial,
            note: accruingNote && 'sin cerrar: bajará según fichen',
          },
        ].map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
          >
            <p className="text-[10px] uppercase tracking-wider text-white/35 flex items-center gap-1.5">
              <k.icon className="h-3 w-3" /> {k.label}
            </p>
            {/* Dos cosas distintas y se dicen distinto. Si FALTA el coste del
                equipo, la cifra está corta y se apaga entera. Si el dato está
                pero el mes sigue corriendo —hay quien cobra por horas y lleva
                cuatro días trabajados mientras los ingresos ya están apuntados
                enteros—, la cifra es cierta pero se va a mover, y eso se avisa
                debajo en vez de enseñarla como un cierre. Un beneficio del mes
                en curso leído como definitivo se lleva por delante el reparto
                entre socios. */}
            <p
              className={`font-bold text-[19px] mt-0.5 tabular-nums ${k.tone} ${
                k.partial ? 'opacity-50' : ''
              }`}
              title={k.partial ? 'Falta por sumar el coste del equipo de este mes' : undefined}
            >
              {k.value}
            </p>
            {k.note && (
              <p
                className="text-[10px] text-yellow-400/90 truncate flex items-center gap-1"
                title={accruingTitle}
              >
                <Clock className="h-2.5 w-2.5 flex-shrink-0" />
                {k.note}
              </p>
            )}
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
            {/* Va el primero, en el sitio exacto que ocupaba la categoría
                «Equipo»: es el gasto más grande del mes y lo primero que se
                mira. La diferencia es que ya no son filas, es un cálculo. */}
            <EmployeesMonthBlock
              period={period}
              total={employeeTotals[period] ?? null}
              cells={employeeCells[period] ?? []}
              detail={employeeDetail}
              usdEur={usdEur}
              loading={employeesLoading}
              pendingSetup={initialEmployeeCost.pendingSetup}
            />

            {/* Filas con una categoría que esta pantalla ya no pinta —las
                viejas de «equipo» si la migración 112 todavía no se ha
                pegado, o si alguien ha deshecho la importación—. No suman al
                total (los sueldos ya entran por el bloque de arriba y se
                contarían dos veces), pero tampoco se callan: el importe está
                escrito en la base y quien mira el mes tiene que saberlo. */}
            {(strayExpenses.length > 0 || strayOtherMonths > 0) && (
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-400/[0.06] px-2.5 py-2">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-yellow-200">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                  Gastos con una categoría retirada
                </p>
                <p className="mt-1 text-[10px] text-white/55 leading-relaxed">
                  {strayExpenses.length > 0 ? (
                    <>
                      {strayExpenses.length}{' '}
                      {strayExpenses.length === 1 ? 'fila' : 'filas'} de {periodLabel(period)} por{' '}
                      <strong className="text-white/80">{eurosPrecise(strayTotal)}</strong>. No
                      están sumadas arriba: si son sueldos, ya entran por «Empleados al mes» y
                      contarlas otra vez doblaría el gasto del mes.
                    </>
                  ) : (
                    <>
                      Este mes no tiene ninguna, pero quedan {strayOtherMonths} en otros meses.
                    </>
                  )}{' '}
                  Lanza la migración 112 o cámbialas de categoría en la base.
                </p>
                {strayExpenses.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {strayExpenses.map((e) => (
                      <p
                        key={e.id}
                        className="flex items-center justify-between gap-2 text-[10px] text-white/45"
                      >
                        <span className="truncate">
                          {e.concept} · {e.category}
                        </span>
                        <span className="tabular-nums flex-shrink-0">
                          {eurosPrecise(expenseInEuros(e, usdEur))}
                        </span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

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
