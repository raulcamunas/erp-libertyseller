'use client'

import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MonthSelectorProps {
  selectedYear: number
  selectedMonth: number
  onYearChange: (year: number) => void
  onMonthChange: (month: number) => void
}

const months = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

export function MonthSelector({
  selectedYear,
  selectedMonth,
  onYearChange,
  onMonthChange
}: MonthSelectorProps) {
  const handlePrevYear = () => {
    onYearChange(selectedYear - 1)
  }

  const handleNextYear = () => {
    onYearChange(selectedYear + 1)
  }

  return (
    <div className="space-y-4">
      {/* Year Selector */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          onClick={handlePrevYear}
          className="h-8 w-8"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-lg font-semibold text-white">{selectedYear}</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleNextYear}
          className="h-8 w-8"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Month Grid */}
      <div className="grid grid-cols-3 gap-2">
        {months.map((month, index) => {
          const monthNumber = index + 1
          const isSelected = monthNumber === selectedMonth
          
          return (
            <button
              key={monthNumber}
              onClick={() => onMonthChange(monthNumber)}
              className={cn(
                "px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                isSelected
                  ? "bg-[#FF6600] text-white"
                  : "bg-white/[0.05] text-white/70 hover:bg-white/[0.1] hover:text-white"
              )}
            >
              {month.slice(0, 3)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

