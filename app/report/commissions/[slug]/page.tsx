import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CommissionReportView } from '@/components/commissions/CommissionReportView'

export default async function PublicCommissionReportPage({
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
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Reporte no encontrado</h1>
          <p className="text-white/70">
            El reporte que buscas no existe o ha sido eliminado.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#080808]">
      <div className="liquid-glass-bg"></div>
      <div className="relative z-10 p-6 lg:p-8 max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="heading-medium text-white mb-2">
                Reporte de Comisiones: {report.period || report.slug}
              </h1>
              <p className="text-white/50">
                Cliente: {report.clients?.name || 'Desconocido'}
              </p>
            </div>
          </div>
        </div>
        <CommissionReportView report={report} />
      </div>
    </div>
  )
}

