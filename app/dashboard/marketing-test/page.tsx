import { redirect } from 'next/navigation'
import { FlaskConical } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { clientesGrowth } from '@/lib/growth/clientes'
import { clientesConAds, cuentasDeClientes } from '@/lib/ads/cuenta'
import { APP_MARKETING_TEST, ceoSinCasilla } from '@/lib/ads/acceso'
import { Vacio } from '@/components/plataforma/comun'
import { MarketingTest } from '@/components/marketing-test/MarketingTest'

/**
 * /dashboard/marketing-test — MARKETING TEST. SOLO ADMIN.
 *
 * La gestión de Amazon Ads de UN cliente, con la forma de un submódulo de Growth Partner (el cliente se elige arriba, y todo cuelga de él) pero como app aparte:
 *
 *   · Ficha de cuenta   los parámetros del SOP que se firman una vez por cuenta.
 *   · Productos         los que se anuncian, con su coste: de ahí sale el ACoS de equilibrio.
 *   · Crear campañas    a un clic, la estructura de 4 campañas con la nomenclatura del SOP (nacen PAUSADAS).
 *   · Log de cambios    todo lo que se crea o se cambia en la cuenta, con valor anterior, valor nuevo y motivo.
 *
 * ESCRIBE en las cuentas de publicidad de los clientes: solo administradores, cerrado en middleware.ts, en APPS_SOLO_ADMIN, aquí (que corre en el servidor) y en cada ruta de /api/ads/cuenta.
 * Todo cuelga de UN cliente y de UNA cuenta de anunciante (un país): no hay ninguna vista que mezcle varios.
 */
export const dynamic = 'force-dynamic'

export default async function MarketingTestPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  if (perfil.role !== 'admin') redirect('/dashboard')
  // Un CEO es un administrador cuyo acceso a cada app lo deciden las casillas
  if (perfil.puesto === 'ceo') {
    const { data: permiso } = await supabase.from('user_app_permissions').select('can_access').eq('user_id', user.id).eq('app_id', APP_MARKETING_TEST).maybeSingle()
    if (ceoSinCasilla(perfil.role, perfil.puesto, new Set(permiso?.can_access ? [APP_MARKETING_TEST] : []))) redirect('/dashboard')
  }

  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  const [todos, conAds] = await Promise.all([clientesGrowth(), clientesConAds().catch(() => new Set<string>())])
  const clientes = todos.filter((c) => c.amazonClientId && conAds.has(c.amazonClientId))

  if (clientes.length === 0) {
    return (
      <Vacio icono={<FlaskConical />} titulo="Ningún cliente tiene una cuenta de Amazon Ads en uso">
        Se conectan y se encienden («Se usa») en <strong>Amazon API · Publicidad</strong>. En cuanto una esté, el cliente aparece aquí con los países que tenga encendidos.
      </Vacio>
    )
  }

  // Todos los clientes con sus cuentas, de una vez: la pantalla cambia de cliente y de país sin volver al servidor
  const cuentas = await cuentasDeClientes(clientes.map((c) => c.amazonClientId as string))
  const paraLaBarra = clientes.map((c) => ({ slug: c.slug, nombre: c.nombre, cuentas: (cuentas.get(c.amazonClientId as string) ?? []).map((x) => ({ id: x.id, pais: x.pais, moneda: x.moneda, nombre: x.nombre })) }))

  // El cliente de la URL, o el primero. Un enlace viejo o un slug que ya no existe cae en uno de la lista, no en pantalla en blanco
  const cliente = paraLaBarra.find((c) => c.slug === uno(searchParams.c)) ?? paraLaBarra[0]
  const cuenta = cliente.cuentas.find((c) => c.id === uno(searchParams.p)) ?? cliente.cuentas[0] ?? null

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)] min-w-0">
      <MarketingTest clientes={paraLaBarra} clienteInicial={cliente.slug} cuentaInicial={cuenta?.id ?? null} pestana={uno(searchParams.t) ?? 'resumen'} />
    </div>
  )
}
