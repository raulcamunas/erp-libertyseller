import { redirect } from 'next/navigation'
import { SearchCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { clientesGrowth } from '@/lib/growth/clientes'
import { cuentasSeoDeClientes } from '@/lib/seo/datos'
import { entraEnApp } from '@/lib/cuentas/acceso'
import { Vacio } from '@/components/plataforma/comun'
import { SeoTest } from '@/components/seo-test/SeoTest'
import { PanelDeClientes, VolverATodos } from '@/components/plataforma/PanelDeClientes'
import { panelSeo } from '@/lib/seo/panel-clientes'

/**
 * /dashboard/seo-test — SEO TEST. Administradores y quien tenga la casilla de la app (lib/cuentas/acceso.ts). Pueden validar y aplicar cambios de ficha
 * en Amazon, siempre con validación previa (VALIDATION_PREVIEW), confirmación y registro de quién lo hizo (decisión de Raúl, 14 nov 2026).
 *
 * El posicionamiento de los productos con datos gratis de Amazon: las búsquedas de Brand Analytics donde aparece cada producto (y qué parte de las compras se lleva) y su ficha revisada contra esas
 * búsquedas. Clientes y países a la izquierda, como Marketing Test. Solo escribe en Amazon desde el editor de ficha y la propuesta con IA, con confirmación.
 */
export const dynamic = 'force-dynamic'

export default async function SeoTestPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  // Administradores y quien lleve cuentas con la casilla (lib/cuentas/acceso.ts); un partner o un cliente, nunca
  if (!(await entraEnApp(supabase, user.id, perfil.role, perfil.puesto, 'seo-test'))) redirect('/dashboard')

  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const todos = (await clientesGrowth()).filter((c) => c.amazonClientId)
  const cuentas = await cuentasSeoDeClientes(todos.map((c) => c.amazonClientId as string))
  const clientes = todos
    .map((c) => ({ slug: c.slug, nombre: c.nombre, cuentas: (cuentas.get(c.amazonClientId as string) ?? []).map((x) => ({ id: x.id, pais: x.pais, moneda: x.moneda, nombre: x.nombre })) }))
    .filter((c) => c.cuentas.length > 0)

  if (clientes.length === 0) {
    return (
      <Vacio icono={<SearchCheck />} titulo="Ningún cliente tiene la cuenta de vendedor conectada">
        Se conectan en <strong>Amazon API · Cuentas</strong>.
      </Vacio>
    )
  }

  // Sin cliente en la dirección: el panel de todos los clientes (vista de pájaro). Al entrar en uno, SeoTest siempre deja ?c= en la dirección
  if (!uno(searchParams.c)) {
    const panel = await panelSeo(todos.map((c) => ({ slug: c.slug, nombre: c.nombre, cuentas: cuentas.get(c.amazonClientId as string) ?? [] })).filter((c) => c.cuentas.length > 0))
    return <PanelDeClientes titulo="SEO de fichas" subtitulo="Todos los clientes de un vistazo: cambios aplicados, propuestas por decidir y lectura de Brand Analytics" icono="seo" clientes={panel.clientes} resumen={panel.resumen} />
  }

  const cliente = clientes.find((c) => c.slug === uno(searchParams.c)) ?? clientes[0]
  const cuenta = cliente.cuentas.find((c) => c.id === uno(searchParams.p)) ?? cliente.cuentas[0] ?? null

  return (
    <div className="flex min-w-0 flex-col lg:h-[calc(100vh-4rem)]">
      <VolverATodos href="/dashboard/seo-test" />
      <SeoTest clientes={clientes} clienteInicial={cliente.slug} cuentaInicial={cuenta?.id ?? null} pestana={uno(searchParams.t) ?? 'hoy'} />
    </div>
  )
}
