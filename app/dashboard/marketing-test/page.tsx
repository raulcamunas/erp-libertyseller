import { redirect } from 'next/navigation'
import { FlaskConical } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { clientesGrowth } from '@/lib/growth/clientes'
import { clientesConAds, cuentasDeClientes } from '@/lib/ads/cuenta'
import { entraEnApp } from '@/lib/cuentas/acceso'
import { Vacio } from '@/components/plataforma/comun'
import { MarketingTest } from '@/components/marketing-test/MarketingTest'
import { PanelDeClientes, VolverATodos } from '@/components/plataforma/PanelDeClientes'
import { panelPpc } from '@/lib/ads/panel-clientes'

/**
 * /dashboard/marketing-test — MARKETING TEST. Administradores y quien lleve cuentas.
 *
 * La gestión de Amazon Ads de UN cliente, con la forma de un submódulo de Growth Partner (el cliente se elige arriba, y todo cuelga de él) pero como app aparte:
 *
 *   · Ficha de cuenta   los parámetros del SOP que se firman una vez por cuenta.
 *   · Productos         los que se anuncian, con su coste: de ahí sale el ACoS de equilibrio.
 *   · Crear campañas    a un clic, la estructura de 4 campañas con la nomenclatura del SOP (nacen PAUSADAS).
 *   · Log de cambios    todo lo que se crea o se cambia en la cuenta, con valor anterior, valor nuevo y motivo.
 *
 * ESCRIBE en las cuentas de publicidad de los clientes. Desde el 14 nov 2026 la usan también los administrativos que llevan cuentas, con su casilla (lib/cuentas/acceso.ts): aquí, en middleware.ts y en cada ruta de /api/ads/cuenta.
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
  // Administradores y quien lleve cuentas con la casilla (lib/cuentas/acceso.ts); un partner o un cliente, nunca
  if (!(await entraEnApp(supabase, user.id, perfil.role, perfil.puesto, 'marketing-test'))) redirect('/dashboard')

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
  const paraLaBarra = clientes.map((c) => ({ slug: c.slug, nombre: c.nombre, amazonClientId: c.amazonClientId as string, cuentas: (cuentas.get(c.amazonClientId as string) ?? []).map((x) => ({ id: x.id, pais: x.pais, moneda: x.moneda, nombre: x.nombre })) }))

  // SIN CLIENTE EN LA URL: el panel de todos (la pantalla de inicio del módulo, vista de pájaro con lo de cada uno)
  if (!uno(searchParams.c)) {
    const { clientes: tarjetas, resumen } = await panelPpc(clientes.map((c) => ({ slug: c.slug, nombre: c.nombre, amazonClientId: c.amazonClientId as string, cuentas: cuentas.get(c.amazonClientId as string) ?? [] })))
    return <PanelDeClientes titulo="PPC · Amazon Ads" subtitulo="Todos los clientes con publicidad: lo de los últimos 7 días frente a los 7 anteriores. Pulsa uno para entrar." icono="ppc" yoId={user.id} clientes={tarjetas} resumen={resumen} />
  }

  // El cliente de la URL. Un enlace viejo o un slug que ya no existe cae en uno de la lista, no en pantalla en blanco
  const cliente = paraLaBarra.find((c) => c.slug === uno(searchParams.c)) ?? paraLaBarra[0]
  const cuenta = cliente.cuentas.find((c) => c.id === uno(searchParams.p)) ?? cliente.cuentas[0] ?? null

  // Altura fija SOLO en escritorio (lg): ahí la pantalla tiene su propio scroll interno y la cabecera se queda a la vista. En el móvil y la tableta la página corre con el
  // scroll de la ventana: con `h-[calc(100dvh-8rem)]` la cabecera (título, desplegables y pestañas, ~360 px) se quedaba clavada y el contenido se leía en una caja de 380 px de
  // 740, con una franja vacía debajo, el dedo no pasaba de la caja a la página y, al esconderse la barra de direcciones, el `dvh` cambiaba y la caja se volvía a maquetar
  return (
    <div className="flex flex-col min-w-0 lg:h-[calc(100vh-4rem)]">
      <VolverATodos href="/dashboard/marketing-test" />
      <MarketingTest clientes={paraLaBarra} clienteInicial={cliente.slug} cuentaInicial={cuenta?.id ?? null} pestana={uno(searchParams.t) ?? 'resumen'} />
    </div>
  )
}
