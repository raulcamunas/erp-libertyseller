import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { PlataformaBoard } from '@/components/plataforma/PlataformaBoard'
import { TITULO } from '@/lib/estilo/denso'

/**
 * /dashboard/plataforma — EL MÓDULO A1. SOLO ADMIN.
 *
 * La capa base de datos de la plataforma: la ingesta del catálogo de los
 * clientes desde Amazon, el histórico que se va construyendo y el criterio de
 * qué SKU se refrescan a diario. De aquí cuelgan A2 (Buy Box), A3 (auditoría de
 * repricing), A4 (FBM→FBA) y A5 (costes) cuando se construyan.
 *
 *
 * ============ POR QUÉ SOLO ADMIN, IGUAL QUE AMAZON API ============
 *
 * Porque aquí se ve el catálogo entero de las tiendas de los clientes y desde
 * aquí se lanzan barridos que gastan el cupo de Amazon de esas cuentas. Está
 * cerrado en cuatro sitios, y solo los dos últimos mandan de verdad:
 *
 *   1. middleware.ts, que evita el viaje.
 *   2. Los filtros de app/dashboard/page.tsx y components/layout/AppSidebar.tsx,
 *      para que no salga ni en la rejilla ni en el menú.
 *   3. requireAmazonAdmin() en cada ruta de /api/plataforma. Esta es la que
 *      cuenta: en middleware.ts todo lo que empieza por /api/ está en la lista
 *      de rutas públicas, así que una ruta que no comprueba nada contesta a
 *      cualquiera.
 *   4. Las políticas RLS de las migraciones 118 y 123, que le retiran a
 *      `authenticated` cualquier permiso sobre estas tablas. Todo lo que se
 *      pinta aquí viene del servidor, con service_role y listas de columnas
 *      explícitas que no incluyen el token de nadie.
 *
 * A1 SOLO LEE de Amazon. Desde esta pantalla no se cambia ni un precio ni una
 * unidad de stock en la tienda de ningún cliente: eso es el módulo Amazon API.
 * Lo único que se escribe aquí es NUESTRA decisión de de qué SKU nos ocupamos.
 */

export const dynamic = 'force-dynamic'

export default async function PlataformaPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  if (profile.role !== 'admin') redirect('/dashboard')

  return (
    // El alto fijo con scroll interno es el patrón de las pantallas con tabla del
    // ERP. El `min-w-0` es el eslabón de esta pantalla en la cadena que mantiene
    // el scroll horizontal DENTRO de la tabla: sin él, once columnas arrastran la
    // página de lado y se llevan la barra lateral por delante.
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)] min-w-0">
      <div className="mb-2 flex-shrink-0">
        <h1 className={TITULO.pantalla}>Plataforma · Datos de Amazon</h1>
        <p className={`${TITULO.entradilla} max-w-[92ch]`}>
          La capa base: qué se ha traído de cada cuenta, de qué datos disponemos y de qué SKU nos
          ocupamos cada día. Solo lee de Amazon — los cambios de precio y stock siguen en Amazon
          API.
        </p>
      </div>

      <div className="flex-1 min-h-0 min-w-0">
        <PlataformaBoard />
      </div>
    </div>
  )
}
