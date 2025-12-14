import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { PPCReportView } from '@/components/ppc/PPCReportView'
import { Logo } from '@/components/ui/Logo'
import { notFound } from 'next/navigation'

export default async function PublicPPCReportPage({
  params
}: {
  params: { slug: string }
}) {
  // Usar cliente anónimo para acceso público (sin autenticación)
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  
  const { data: report, error } = await supabase
    .from('ppc_optimization_reports')
    .select(`
      *,
      ppc_clients:ppc_clients(name, currency)
    `)
    .eq('slug', params.slug)
    .single()

  if (error || !report) {
    notFound()
  }

  // Obtener el snapshot de esa semana para usar los datos exactos del dashboard
  const { data: snapshot } = await supabase
    .from('ppc_weekly_snapshots')
    .select('*')
    .eq('client_id', report.client_id)
    .eq('week_start_date', report.week_start_date)
    .single()

  // Si hay snapshot, usar esos datos en lugar de los del reporte
  if (snapshot) {
    report.metrics = {
      total_spend: Number(snapshot.total_spend) || 0,
      total_sales: Number(snapshot.total_sales) || 0,
      total_clicks: Number(snapshot.total_clicks) || 0,
      global_acos: Number(snapshot.global_acos) || 0,
      avg_cpc: Number(snapshot.avg_cpc) || 0,
      avg_ctr: Number(snapshot.avg_ctr) || 0,
      roas: snapshot.roas ? Number(snapshot.roas) : (snapshot.total_spend > 0 ? (snapshot.total_sales / snapshot.total_spend) : 0),
      target_acos: report.metrics?.target_acos || 0,
      avg_acos: report.metrics?.avg_acos || 0,
    }
  }

  return (
    <div className="min-h-screen bg-[#080808]">
      <div className="liquid-glass-bg"></div>
      <div className="relative z-10 p-4 sm:p-6 lg:p-8 max-w-[95%] 2xl:max-w-[90%] mx-auto">
        {/* Logo y Header */}
        <div className="mb-6 sm:mb-8">
          <div className="mb-4 sm:mb-6">
            <Logo width={150} height={40} />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-2">
              Reporte de Optimización PPC
            </h1>
            <p className="text-sm sm:text-base text-white/50">
              Cliente: {report.ppc_clients?.name || 'Desconocido'} | 
              Semana: {new Date(report.week_start_date).toLocaleDateString('es-ES', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
            </p>
          </div>
        </div>
        <PPCReportView report={report} />
      </div>
    </div>
  )
}

