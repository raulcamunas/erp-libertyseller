import { redirect } from 'next/navigation'
import { SearchCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { clientesGrowth } from '@/lib/growth/clientes'
import { cuentasSeoDeClientes } from '@/lib/seo/datos'
import { entraEnApp } from '@/lib/cuentas/acceso'
import { Vacio } from '@/components/plataforma/comun'
import { SeoTest } from '@/components/seo-test/SeoTest'

/**
 * /dashboard/seo-test — SEO TEST. SOLO ADMIN (un CEO, solo con la casilla).
 *
 * El posicionamiento de los productos con datos gratis de Amazon: las búsquedas de Brand Analytics donde aparece cada producto (y qué parte de las compras se lleva) y su ficha revisada contra esas
 * búsquedas. Clientes y países a la izquierda, como Marketing Test. Solo LEE de Amazon.
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

  const cliente = clientes.find((c) => c.slug === uno(searchParams.c)) ?? clientes[0]
  const cuenta = cliente.cuentas.find((c) => c.id === uno(searchParams.p)) ?? cliente.cuentas[0] ?? null

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)] min-w-0">
      <SeoTest clientes={clientes} clienteInicial={cliente.slug} cuentaInicial={cuenta?.id ?? null} pestana={uno(searchParams.t) ?? 'hoy'} />
    </div>
  )
}
