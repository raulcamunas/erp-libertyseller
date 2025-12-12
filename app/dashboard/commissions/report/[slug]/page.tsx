import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CommissionReportView } from '@/components/commissions/CommissionReportView'

export default async function CommissionReportPage({
  params
}: {
  params: { slug: string }
}) {
  const supabase = await createClient()
  
  const { data: report, error } = await supabase
    .from('commission_reports')
    .select(`
      *,
      clients:clients(name)
    `)
    .eq('slug', params.slug)
    .single()

  if (error || !report) {
    redirect('/dashboard/commissions/reports')
  }

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="heading-medium text-white mb-2">
              Reporte: {report.period || report.slug}
            </h1>
            <p className="text-white/50">
              Cliente: {report.clients?.name || 'Desconocido'}
            </p>
          </div>
          <a
            href="/dashboard/commissions/reports"
            className="btn-glass"
          >
            Volver a Reportes
          </a>
        </div>
      </div>
      <CommissionReportView report={report} />
    </div>
  )
}

