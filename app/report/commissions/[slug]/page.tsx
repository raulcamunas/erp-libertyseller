import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CommissionReportView } from '@/components/commissions/CommissionReportView'
import { Logo } from '@/components/ui/Logo'

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
      <div className="relative z-10 p-4 sm:p-6 lg:p-6 max-w-7xl mx-auto">
        {/* Logo y Header */}
        <div className="mb-6 sm:mb-8">
          <div className="mb-4 sm:mb-6">
            <Logo width={150} height={40} />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-2">
              Reporte de Comisiones: {report.period || report.slug}
            </h1>
            <p className="text-sm sm:text-base text-white/50">
              Cliente: {report.clients?.name || 'Desconocido'}
            </p>
          </div>
        </div>
        <CommissionReportView report={report} />
      </div>
    </div>
  )
}

