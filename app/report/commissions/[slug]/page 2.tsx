import { createServiceClient } from '@/lib/supabase/service'
import { CommissionReportView } from '@/components/commissions/CommissionReportView'
import { Logo } from '@/components/ui/Logo'

/**
 * EL DESGLOSE QUE SE LE PASA AL CLIENTE. SIGUE SIENDO PÚBLICO, SIN SESIÓN.
 *
 * Lo único que cambia respecto a antes es CON QUÉ LLAVE se lee, y no es un
 * detalle: esta página es de SERVIDOR, así que la consulta la hace el servidor
 * y el navegador nunca habla con la base de datos. El enlace que ya tenga un
 * cliente abre exactamente igual.
 *
 * ANTES SE LEÍA CON LA CLAVE ANÓNIMA, y eso era el problema. Esa clave viaja
 * dentro del JavaScript de la web —la tiene cualquiera que abra el ERP— y la
 * política de la migración 011 decía:
 *
 *     ON public.commission_reports FOR SELECT TO anon USING (slug IS NOT NULL)
 *
 * `USING (slug IS NOT NULL)` NO acota a un slug: el `.eq('slug', …)` de abajo
 * lo pone quien consulta, y RLS no lo ve. Así que con esa clave se podía pedir
 * la TABLA ENTERA —todos los informes de todos los clientes— sin adivinar
 * ningún enlace. Y dentro de `data` iba el CSV fiscal crudo, con ciudad, código
 * postal y país de entrega de cada pedido.
 *
 * Con la clave de servicio, que solo existe en el servidor, este `.eq('slug')`
 * sí es la única puerta: se devuelve UN informe, el de ese enlace, y nada más.
 * Es el mismo arreglo que hizo la migración 136 con los informes de auditoría.
 *
 * EL ORDEN IMPORTA: esto se despliega ANTES de lanzar la migración que quita
 * las políticas. Al revés, los enlaces ya repartidos dejarían de abrir hasta
 * que entrara el despliegue.
 */
export const dynamic = 'force-dynamic'

export default async function PublicCommissionReportPage({
  params
}: {
  params: { slug: string }
}) {
  const supabase = createServiceClient()
  
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

