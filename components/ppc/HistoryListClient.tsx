'use client'

import { HistoryList } from './HistoryList'

interface HistoryListClientProps {
  snapshots: Array<{
    id: string
    week_start_date: string
    total_spend: number
    total_sales: number
    global_acos: number
    roas: number | null
    avg_cpc: number | null
    avg_ctr: number | null
    total_clicks: number | null
    ai_summary: string | null
    created_at: string
  }>
  currency: string
  clientId: string
}

export function HistoryListClient({ snapshots, currency, clientId }: HistoryListClientProps) {
  const handleDelete = () => {
    // Recargar la página para mostrar los datos actualizados
    window.location.reload()
  }

  return <HistoryList snapshots={snapshots} currency={currency} clientId={clientId} onDelete={handleDelete} />
}

